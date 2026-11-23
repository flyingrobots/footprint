// One Footprint comment per pull request (flyingrobots/footprint#59).
//
// `footprint comment <pr> --report <file> --change <text> --reason <text> [--remarks <text>]`
// finds the pull request's Footprint comment and updates it in place, or creates it, and appends
// one row to the Changelog at its foot. The comment is identified by a hidden marker on its first
// line. A comment someone else wrote is never edited. Every `gh` call is one of five, made through
// `gh api` and `gh pr view`:
//
//   gh api user --jq .login
//   gh pr view <pr> --json headRefOid --jq .headRefOid
//   gh api repos/{owner}/{repo}/issues/<pr>/comments --paginate --jq <one JSON object per comment>
//   gh api --method POST  repos/{owner}/{repo}/issues/<pr>/comments --input - --jq <id and url>
//   gh api --method PATCH repos/{owner}/{repo}/issues/comments/<id> --input - --jq <id and url>
//
// The Changelog's shape and the size bound are pure functions below; the run is `commentCommand`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Run } from "@flyingrobots/parley-emit";
import { COMMENT_REPORT_LIMIT, REPORT_LIMIT } from "./bound.ts";
import { parseArgs } from "./args.ts";
import { cellText } from "./cell.ts";
import { classifyFailure, resolveGh } from "./pulls.ts";

export const COMMENT_SCHEMA = JSON.parse(readFileSync(new URL("../schemas/footprint.comment.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;
export const COMMENT_TYPE = { id: "footprint.comment", version: "1.0.0" } as const;

/** The first line of the Footprint comment, and the only thing that identifies it. */
export const MARKER = "<!-- footprint:report -->";
/** The owner's summary line, byte for byte. */
export const CHANGELOG_OPEN = "<details><summary>Changelog</summary>";
/** The owner's header lines, byte for byte. */
export const CHANGELOG_HEADER: readonly string[] = ["| Timestamp | SHA | Change | Reason | Remarks |", "| --------- | --- | ------ | ------ | ------- |"];
const CHANGELOG_CLOSE = "</details>";
/** How a comment posted before the marker existed is recognised: the report's own first heading. */
const LEGACY_HEADING = "## Footprint";
const ADOPTED = "Adopted an earlier Footprint comment that carried no marker.";
export { cellText };

export interface ChangelogRow {
  readonly timestamp: string;
  readonly sha: string;
  readonly change: string;
  readonly reason: string;
  readonly remarks: string;
}

export function rowLine(r: ChangelogRow): string {
  return `| ${[r.timestamp, r.sha, r.change, r.reason, r.remarks].map(cellText).join(" | ")} |`;
}

/** The rows a comment's Changelog already carries, verbatim, and how many it says were dropped. */
export interface Changelog {
  readonly rows: readonly string[];
  readonly dropped: number;
}

const DROPPED = /(\d+) older Changelog rows? dropped/;

function droppedNotice(n: number): string {
  return `<sub>${n} older Changelog row${n === 1 ? "" : "s"} dropped to keep this comment within GitHub's ${REPORT_LIMIT}-character limit.</sub>`;
}

/** The Changelog at the foot of a comment body; none is no rows. */
export function parseChangelog(body: string): Changelog {
  const lines = body.split(/\r?\n/);
  const at = lines.lastIndexOf(CHANGELOG_OPEN);
  if (at < 0) return { rows: [], dropped: 0 };
  const rows: string[] = [];
  let dropped = 0;
  for (const line of lines.slice(at + 1)) {
    if (line === CHANGELOG_CLOSE) break;
    if (line.startsWith("|") && !CHANGELOG_HEADER.includes(line)) rows.push(line);
    const m = DROPPED.exec(line);
    if (m !== null) dropped = Number(m[1]);
  }
  return { rows, dropped };
}

export interface Built {
  readonly body: string;
  /** Every row the body carries, the new one last. */
  readonly rows: readonly string[];
  /** Older rows dropped in all, this run's and every earlier run's. */
  readonly dropped: number;
}

function assemble(report: string, rows: readonly string[], dropped: number): string {
  return [
    MARKER,
    report.trimEnd(),
    "",
    // The blank line after the summary is not in the owner's shape, and is needed: without it
    // GitHub renders the table inside <details> as raw text (checked with `gh api markdown`).
    CHANGELOG_OPEN,
    "",
    ...CHANGELOG_HEADER,
    ...rows,
    ...(dropped > 0 ? ["", droppedNotice(dropped)] : []),
    "",
    CHANGELOG_CLOSE,
  ].join("\n");
}

/**
 * The comment: the marker, the report, and the Changelog with `row` appended, at most `limit`
 * characters. When every row does not fit, the oldest are dropped and the count is stated, added
 * to whatever earlier runs dropped. Throws when not even the new row fits beside the report.
 */
export function buildComment(report: string, changelog: Changelog, row: string, limit: number = REPORT_LIMIT): Built {
  const all = [...changelog.rows, row];
  for (let keep = all.length; keep >= 1; keep--) {
    const rows = all.slice(all.length - keep);
    const dropped = changelog.dropped + (all.length - keep);
    const body = assemble(report, rows, dropped);
    if (body.length <= limit) return { body, rows, dropped };
  }
  throw new Error(`the comment is too long: a ${report.length}-character report leaves no room for one Changelog row under ${limit} characters`);
}

export interface PullComment {
  readonly id: number;
  readonly login: string;
  readonly body: string;
  readonly created_at: string;
}

export type Target =
  | { readonly kind: "marked"; readonly comment: PullComment; readonly others: readonly PullComment[] }
  | { readonly kind: "legacy"; readonly comment: PullComment; readonly others: readonly PullComment[] }
  | { readonly kind: "foreign"; readonly comment: PullComment }
  | { readonly kind: "none" };

const isMarked = (c: PullComment) => c.body.split(/\r?\n/, 1)[0]!.trim() === MARKER;
const isLegacy = (c: PullComment) => c.body.trimStart().startsWith(LEGACY_HEADING);
const newestFirst = (a: PullComment, b: PullComment) => b.created_at.localeCompare(a.created_at) || b.id - a.id;

/**
 * Which comment to write. The most recent marked comment by `login`; failing that, a marked
 * comment by anyone else, which is refused; failing that, the most recent unmarked comment by
 * `login` that opens with the report's heading, which is adopted; failing that, none.
 */
export function findTarget(comments: readonly PullComment[], login: string): Target {
  const marked = comments.filter(isMarked).sort(newestFirst);
  const mine = marked.filter((c) => c.login === login);
  if (mine.length > 0) return { kind: "marked", comment: mine[0]!, others: mine.slice(1) };
  if (marked.length > 0) return { kind: "foreign", comment: marked[0]! };
  const legacy = comments.filter((c) => c.login === login && isLegacy(c)).sort(newestFirst);
  if (legacy.length > 0) return { kind: "legacy", comment: legacy[0]!, others: legacy.slice(1) };
  return { kind: "none" };
}

/** UTC ISO-8601 to the second. */
export function timestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** GitHub's own short form of a commit id. */
const SHORT_SHA = 7;

class Refused extends Error {
  constructor(readonly code: string, readonly problem: string, readonly remedy: string, readonly target?: string) {
    super(problem);
  }
}

function gh(bin: string, cwd: string, args: readonly string[], input?: string): string {
  const r = Bun.spawnSync([bin, ...args], { cwd, stdin: input === undefined ? "ignore" : Buffer.from(input), stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    const f = classifyFailure(r.stderr.toString(), r.exitCode ?? 1);
    const code = f.code === "gh.list_failed" ? "gh.call_failed" : f.code;
    throw new Refused(code, `gh ${args.slice(0, 3).join(" ")} failed: ${f.reason}`, "run the same gh command by hand to see why; nothing was written by this run unless its result line says so", bin);
  }
  return r.stdout.toString();
}

const COMMENTS_JQ = ".[] | {id, login: .user.login, body, created_at} | @json";
const WRITTEN_JQ = "{id, html_url} | @json";

/** The `comment` command. */
export async function commentCommand(run: Run, args: readonly string[]): Promise<void> {
  try {
    await post(run, args);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    run.error({ code: e.code, problem: e.problem, remedy: e.remedy, ...(e.target === undefined ? {} : { remedy_target: e.target }) });
  }
}

const USAGE = "footprint comment <pr> --report <file> --change <text> --reason <text> [--remarks <text>]";

async function post(run: Run, argv: readonly string[]): Promise<void> {
  const parsed = parseArgs(argv, ["--report", "--change", "--reason", "--remarks"]);
  if (!parsed.ok) throw new Refused("args.invalid", parsed.problem, `usage: ${USAGE}`);
  const { positionals, flags } = parsed;
  const pr = positionals[0];
  if (positionals.length !== 1 || pr === undefined || !/^[1-9][0-9]*$/.test(pr)) {
    throw new Refused("args.invalid", `expected one pull request number, got ${JSON.stringify(positionals)}`, `usage: ${USAGE}`);
  }
  for (const f of ["--report", "--change", "--reason"]) {
    if (flags[f] === undefined) throw new Refused("args.invalid", `${f} is required`, `usage: ${USAGE}`);
  }
  const reportPath = resolve(run.cwd, flags["--report"]!);
  let report: string;
  try {
    report = readFileSync(reportPath, "utf8");
  } catch (e) {
    throw new Refused("report.unreadable", `the report ${reportPath} could not be read: ${e instanceof Error ? e.message : String(e)}`, "write the report with `footprint <range> --human > <file>` first", reportPath);
  }
  if (report.trim() === "") throw new Refused("report.unreadable", `the report ${reportPath} is empty`, "write the report with `footprint <range> --human > <file>` first", reportPath);

  const bin = resolveGh();
  if (bin === null) throw new Refused("gh.not_found", "gh is not installed or not on PATH; the comment cannot be read or written without it", "install gh and run gh auth login");
  const login = gh(bin, run.cwd, ["api", "user", "--jq", ".login"]).trim();
  const head = gh(bin, run.cwd, ["pr", "view", pr, "--json", "headRefOid", "--jq", ".headRefOid"]).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Refused("gh.call_failed", `gh pr view ${pr} answered ${JSON.stringify(head)} for the head commit, not a commit id`, "run gh pr view by hand to see why", bin);
  const comments = gh(bin, run.cwd, ["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--paginate", "--jq", COMMENTS_JQ])
    .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as PullComment);

  const target = findTarget(comments, login);
  if (target.kind === "foreign") {
    throw new Refused(
      "comment.other_author",
      `the Footprint comment on #${pr} (${target.comment.id}) was written by ${target.comment.login}, not ${login}; footprint never edits another user's comment, and will not post a second one`,
      `run footprint comment as ${target.comment.login}, or ask them to remove the marker line from their comment`,
    );
  }
  run.step(
    target.kind === "none" ? `no Footprint comment on #${pr}: creating one` : `${target.kind === "legacy" ? "adopting" : "updating"} comment ${target.comment.id} on #${pr}`,
    target.kind === "marked"
      ? `its first line is ${MARKER} and ${login} wrote it`
      : target.kind === "legacy"
        ? `no comment carries ${MARKER}; this is the most recent by ${login} that opens with "${LEGACY_HEADING}"`
        : `no comment carries ${MARKER}, and none by ${login} opens with "${LEGACY_HEADING}"`,
  );
  if ((target.kind === "marked" || target.kind === "legacy") && target.others.length > 0) {
    run.warning({
      code: "comment.duplicates",
      problem: `${target.others.length} more Footprint comment${target.others.length === 1 ? "" : "s"} by ${login} on #${pr} left as they are: ${target.others.map((c) => c.id).join(", ")}`,
      remedy: "delete them by hand if they are no longer wanted; footprint updates only the most recent",
    });
  }

  const carried = target.kind === "marked" ? parseChangelog(target.comment.body) : { rows: [], dropped: 0 };
  const remarks = [flags["--remarks"] ?? "", target.kind === "legacy" ? ADOPTED : ""].filter((x) => x.trim() !== "").join(" ");
  const row: ChangelogRow = { timestamp: timestamp(), sha: head.slice(0, SHORT_SHA), change: flags["--change"]!, reason: flags["--reason"]!, remarks };
  let built: Built;
  try {
    built = buildComment(report, carried, rowLine(row));
  } catch (e) {
    throw new Refused("comment.too_long", e instanceof Error ? e.message : String(e), `write the report with --max-chars ${COMMENT_REPORT_LIMIT}`, reportPath);
  }
  const dropping = built.dropped - carried.dropped;
  run.step(
    `changelog: ${carried.rows.length} row${carried.rows.length === 1 ? "" : "s"} carried, one appended${dropping > 0 ? `, ${dropping} oldest dropped` : ""}`,
    `rows are append-only and carried verbatim, oldest first; the comment is held to GitHub's ${REPORT_LIMIT} characters, and the newest rows are kept when they do not all fit`,
  );

  let written: { id: number; html_url: string } | null = null;
  if (!run.dryRun) {
    const payload = JSON.stringify({ body: built.body });
    const answer = target.kind === "none"
      ? gh(bin, run.cwd, ["api", "--method", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "--input", "-", "--jq", WRITTEN_JQ], payload)
      : gh(bin, run.cwd, ["api", "--method", "PATCH", `repos/{owner}/{repo}/issues/comments/${target.comment.id}`, "--input", "-", "--jq", WRITTEN_JQ], payload);
    written = JSON.parse(answer.trim()) as { id: number; html_url: string };
  }
  const id = written?.id ?? (target.kind === "none" ? null : target.comment.id);
  run.result(
    {
      event: "result",
      pull_request: Number(pr),
      action: target.kind === "none" ? "created" : "updated",
      adopted: target.kind === "legacy",
      dry_run: run.dryRun,
      comment: { id, url: written?.html_url ?? null },
      head_sha: row.sha,
      row,
      changelog: { rows: built.rows.length, carried: carried.rows.length, dropped: built.dropped },
      chars: built.body.length,
      limit: REPORT_LIMIT,
    },
    COMMENT_TYPE,
  );
}

/** The one line `--human` prints for the result. */
export function commentProse(line: Record<string, unknown>): string {
  const c = line.comment as { id: number | null; url: string | null };
  const log = line.changelog as { rows: number; dropped: number };
  const verb = line.dry_run === true ? (line.action === "created" ? "Would create" : "Would update") : line.action === "created" ? "Created" : "Updated";
  return `${verb} the Footprint comment on #${String(line.pull_request)}${c.url === null ? "" : `: ${c.url}`}${line.adopted === true ? " (adopted an unmarked one)" : ""} — ${log.rows} Changelog row${log.rows === 1 ? "" : "s"}${log.dropped > 0 ? `, ${log.dropped} older dropped` : ""}.`;
}
