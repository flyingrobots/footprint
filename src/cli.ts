#!/usr/bin/env bun
// footprint speaks the Parley output protocol (flyingrobots/parley, spec v0.2): JSON Lines on
// stdout and stderr, a receipt per run, `--human` for the Markdown comment.
import { $ } from "bun";
import { defineTool, main, type Run } from "@flyingrobots/parley-emit";
import pkg from "../package.json" with { type: "json" };
import { compose, parseNumstat } from "./footprint.ts";
import { gutCheck, render, renderOverlap } from "./render.ts";
import { resolveGraft, structuralReview } from "./graft.ts";
import { computeOverlap, unavailableOverlap, type Overlap } from "./overlap.ts";
import { isFailure, listOpenPullRequests, resolveGh } from "./pulls.ts";
import { COMPOSITION_SCHEMA, COMPOSITION_TYPE, OVERLAP_SCHEMA, OVERLAP_TYPE, compositionRecord, overlapRecord } from "./report.ts";

let markdown = "";
let overlapMarkdown = "";

const tool = defineTool({
  name: "footprint",
  version: pkg.version,
  commands: {
    footprint: {
      intent: "Report what a change touches: its composition by file kind, the gut-check flags, and whether anything's shape moved",
      // The network is read-only and optional: `gh` for the open pull requests, nothing else.
      effects: { reads: ["<cwd>/.git"], writes: [], network: true, idempotent: true },
      // No secret reaches footprint: `gh` holds its own credential and footprint never reads it.
      secrets: [],
      emits: [{ ...COMPOSITION_TYPE, schema: COMPOSITION_SCHEMA }, { ...OVERLAP_TYPE, schema: OVERLAP_SCHEMA }],
    },
  },
  retention: { count: 50 },
  human: (line) => (line.event !== "result" ? null : (line._schema as { id?: string } | undefined)?.id === OVERLAP_TYPE.id ? overlapMarkdown : markdown),
});

async function defaultBase(): Promise<string | null> {
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow().then((r) => r.exitCode === 0)) return ref;
  }
  return null;
}

async function footprint(run: Run, args: string[]): Promise<void> {
  const given = args.find((a) => !a.startsWith("-"));
  const spec = given ?? (await defaultBase());
  if (spec === null) {
    run.error({ code: "base.not_found", problem: "No default branch found: none of origin/main, origin/master, main or master exists", remedy: "pass a base explicitly", remedy_target: "<base>" });
    return;
  }
  // Three dots: compare against the merge base, so unrelated default-branch commits are excluded.
  const range = spec.includes("..") ? spec : `${spec}...HEAD`;
  run.step(`compare ${range}`, given === undefined ? `no base was given; ${spec} is the first of origin/main, origin/master, main, master that exists` : given.includes("..") ? "the range was given on the command line" : "the base was given on the command line; three dots compare against the merge base");

  const diff = await $`git diff --numstat ${range}`.quiet().nothrow();
  if (diff.exitCode !== 0) {
    run.error({ code: "git.diff_failed", problem: `git diff --numstat ${range} exited ${diff.exitCode}: ${diff.stderr.toString().trim() || "(no message)"}`, remedy: "pass a range git can resolve", remedy_target: range });
    return;
  }
  const changes = parseNumstat(diff.text());
  const [base, head = "HEAD"] = range.split("...");

  const graft = await resolveGraft(process.env.FOOTPRINT_GRAFT);
  run.step(graft === null ? "structural analysis unavailable" : `structural analysis via ${graft}`, graft === null ? "graft could not be resolved through the package or PATH; the report states the limitation rather than omitting the section" : "graft resolved through the package dependency, PATH or FOOTPRINT_GRAFT");
  const review = graft === null || changes.length === 0 ? null : await structuralReview(graft, run.cwd, base!, head);
  if (graft !== null && changes.length > 0 && review === null) {
    run.warning({ code: "graft.review_failed", problem: "graft struct review failed or returned output footprint could not read; structural analysis unavailable for this run", remedy: "run graft struct review --json by hand to see why", remedy_target: graft });
  }

  const composition = compose(changes);
  const gut = gutCheck(composition);
  markdown = changes.length === 0 ? `No changes in \`${range}\`.` : render(composition, changes, range, review);
  run.result(compositionRecord(range, composition, gut, review), COMPOSITION_TYPE, { files: changes, markdown });

  // Cross-pull-request overlap: a second result in the same run, after the composition.
  const overlap = await crossPullRequest(run, changes.map((c) => c.path));
  overlapMarkdown = renderOverlap(overlap);
  run.result(overlapRecord(range, overlap), OVERLAP_TYPE, { markdown: overlapMarkdown });
}

/**
 * The open pull requests that share a file with this change, and an order they could land in.
 * `gh` absent, unauthenticated or rate-limited is a stated limitation and the run still succeeds:
 * an omitted section would read as "nothing overlaps", which is a different claim.
 */
async function crossPullRequest(run: Run, changed: readonly string[]): Promise<Overlap> {
  const gh = resolveGh();
  if (gh === null) {
    run.step("cross-pull-request overlap unavailable", "gh is not on PATH; the result states the limitation rather than omitting the section");
    return unavailableOverlap("gh.not_found", "gh is not installed or not on PATH");
  }
  const pulls = await listOpenPullRequests(gh, run.cwd);
  if (isFailure(pulls)) {
    run.step("cross-pull-request overlap unavailable", `gh resolved but could not list the open pull requests (${pulls.code}); the result states the limitation rather than omitting the section`);
    run.warning({ code: pulls.code, problem: `gh could not list the open pull requests: ${pulls.reason}`, remedy: "run gh pr list by hand to see why; the composition result is unaffected", remedy_target: gh });
    return unavailableOverlap(pulls.code, pulls.reason);
  }
  const overlap = computeOverlap(changed, pulls.pullRequests, { self: pulls.self, limit: pulls.limit });
  run.step(`cross-pull-request overlap over ${overlap.openPullRequests} open pull request${overlap.openPullRequests === 1 ? "" : "s"}`, "gh listed the open pull requests and gh pr diff --name-only their files; waves are greedy first-fit over the conflict graph, a proposal rather than a minimum");
  if (overlap.undetermined.length > 0) {
    run.warning({ code: "gh.diff_failed", problem: `gh pr diff --name-only would not report the changed files of ${overlap.undetermined.map((u) => `#${u.number}`).join(", ")}; those pull requests are reported as undetermined rather than assumed disjoint`, remedy: "run gh pr diff --name-only by hand to see why", remedy_target: gh });
  }
  if (overlap.truncated) {
    run.warning({ code: "gh.list_truncated", problem: `gh returned ${overlap.openPullRequests} open pull requests, the limit asked for; there may be more that were not considered`, measured: overlap.openPullRequests, limit: overlap.limit, remedy: "narrow the question, or raise the limit in src/pulls.ts" });
  }
  return overlap;
}

/**
 * The resolved interpretation (spec §5), which is also the inv preimage: the range after the
 * default base is applied, both ends as commit ids, and the graft setting. The commit ids are the
 * content addresses of the subject matter, so inv moves when the compared trees move; without
 * them a footprint run would declare no inputs and its inv would cover the arguments alone.
 */
async function resolved(args: string[]): Promise<Record<string, unknown>> {
  const given = args.find((a) => !a.startsWith("-")) ?? null;
  const spec = given ?? (await defaultBase());
  const range = spec === null ? null : spec.includes("..") ? spec : `${spec}...HEAD`;
  const ends = range === null ? [null, null] : range.split(/\.{2,3}/);
  const rev = async (ref: string | null) => (ref === null ? null : (await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow()).text().trim() || null);
  return { command: "footprint", base: given, default_base: given === null ? spec : null, range, base_commit: await rev(ends[0] ?? null), head_commit: await rev(ends[1] || "HEAD"), graft: process.env.FOOTPRINT_GRAFT ?? null };
}

const status = await main(tool, ["footprint", ...process.argv.slice(2)], footprint, { resolved });
process.exit(status);
