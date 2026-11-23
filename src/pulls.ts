// The open pull requests, from `gh`. This is the only impure half of the overlap feature: it
// shells out, and everything it returns is a plain `{number, title, isDraft, files}` record for
// `src/overlap.ts` to compute over.
//
// Two `gh` calls per run plus one per pull request, all read-only:
//
//   gh pr list --state open --json number,title,isDraft,headRefOid,headRefName,isCrossRepository,baseRefName --limit <n>
//   gh pr diff <number> --name-only
//
// `gh` missing, unauthenticated or rate-limited is a stated limitation, never an omitted section:
// an absent signal that reads as a clean signal is worse than no signal.

import { $ } from "bun";
import { LIST_LIMIT, type PullRequest } from "./overlap.ts";

export interface PullsFailure {
  readonly code: string;
  readonly reason: string;
}

export interface Pulls {
  readonly pullRequests: readonly PullRequest[];
  readonly limit: number;
}

export type PullsResult = Pulls | PullsFailure;

export function isFailure(r: PullsResult): r is PullsFailure {
  return (r as PullsFailure).code !== undefined;
}

/** `gh` on PATH, or null. Nothing is installed and nothing is prompted for. */
export function resolveGh(): string | null {
  return Bun.which("gh");
}

/**
 * Why `gh` could not answer, from what it said. The codes are stable; the reason is gh's own
 * message, because a paraphrase of an authentication failure helps nobody.
 */
export function classifyFailure(stderr: string, exitCode: number): PullsFailure {
  const said = stderr.trim().split("\n").filter((l) => l !== "").join("; ") || `(no message, exit ${exitCode})`;
  if (/rate limit/i.test(said)) return { code: "gh.rate_limited", reason: said };
  if (/auth login|not logged in|requires authentication|authentication failed|bad credentials|HTTP 401/i.test(said)) {
    return { code: "gh.unauthenticated", reason: said };
  }
  if (/no git remotes|not a git repository|known GitHub host|could not determine/i.test(said)) {
    return { code: "gh.no_remote", reason: said };
  }
  return { code: "gh.list_failed", reason: said };
}

interface Listed {
  number?: unknown;
  title?: unknown;
  isDraft?: unknown;
  headRefOid?: unknown;
  headRefName?: unknown;
  isCrossRepository?: unknown;
  baseRefName?: unknown;
}

/**
 * List the open pull requests and their changed files. A file list that `gh` would not give is
 * `null`, which the computation reports as undetermined rather than treating as disjoint.
 */
export async function listOpenPullRequests(gh: string, cwd: string, limit: number = LIST_LIMIT): Promise<PullsResult> {
  const listed = await $`${gh} pr list --state open --json number,title,isDraft,headRefOid,headRefName,isCrossRepository,baseRefName --limit ${limit}`.cwd(cwd).quiet().nothrow();
  if (listed.exitCode !== 0) return classifyFailure(listed.stderr.toString(), listed.exitCode);

  let rows: Listed[];
  try {
    const parsed = JSON.parse(listed.text()) as unknown;
    if (!Array.isArray(parsed)) throw new TypeError("gh pr list did not return an array");
    rows = parsed as Listed[];
  } catch (e) {
    return { code: "gh.list_unreadable", reason: `gh pr list --json returned output footprint could not read: ${e instanceof Error ? e.message : String(e)}` };
  }

  const pullRequests: PullRequest[] = [];
  for (const row of rows) {
    if (typeof row.number !== "number") continue;
    pullRequests.push({
      number: row.number,
      title: typeof row.title === "string" ? row.title : "",
      isDraft: row.isDraft === true,
      files: await changedFiles(gh, cwd, row.number),
      ...(typeof row.headRefOid === "string" ? { headCommit: row.headRefOid } : {}),
      ...(typeof row.headRefName === "string" ? { headBranch: row.headRefName } : {}),
      ...(typeof row.isCrossRepository === "boolean" ? { crossRepository: row.isCrossRepository } : {}),
      ...(typeof row.baseRefName === "string" ? { baseBranch: row.baseRefName } : {}),
    });
  }

  return { pullRequests, limit };
}

/** The paths one pull request changes, or null when `gh pr diff` would not say. */
export async function changedFiles(gh: string, cwd: string, number: number): Promise<readonly string[] | null> {
  const diff = await $`${gh} pr diff ${number} --name-only`.cwd(cwd).quiet().nothrow();
  if (diff.exitCode !== 0) return null;
  return diff.text().split("\n").map((l) => l.trim()).filter((l) => l !== "");
}
