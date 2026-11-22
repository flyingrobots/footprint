#!/usr/bin/env bun
// footprint speaks the Parley output protocol (flyingrobots/parley, spec v0.2): JSON Lines on
// stdout and stderr, a receipt per run, `--human` for the Markdown comment.
import { $ } from "bun";
import { defineTool, main, type Run } from "@flyingrobots/parley-emit";
import pkg from "../package.json" with { type: "json" };
import { compose, parseNumstat } from "./footprint.ts";
import { blastRadius, gutCheck, render, renderLanding, renderOverlap } from "./render.ts";
import { resolveGraft, structuralReview } from "./graft.ts";
import { landingPlan, readLandingDocs, LANDING_DOCUMENTS } from "./landing.ts";
import { computeOverlap, unavailableOverlap, type Overlap } from "./overlap.ts";
import { isFailure, listOpenPullRequests, resolveGh } from "./pulls.ts";
import { COMPOSITION_SCHEMA, COMPOSITION_TYPE, compositionRecord, LANDING_SCHEMA, LANDING_TYPE, landingRecord, OVERLAP_SCHEMA, OVERLAP_TYPE, overlapRecord } from "./report.ts";
import { BLAST_RADIUS_SCHEMA, BLAST_RADIUS_TYPE, attachCallSites, exportSurface, exportsRecord, surfaceSymbols } from "./exports.ts";
import { unsupportedLanguages } from "./languages.ts";

let markdown = "";
let landingMarkdown = "";
let blastMarkdown = "";
let overlapMarkdown = "";

const tool = defineTool({
  name: "footprint",
  version: pkg.version,
  commands: {
    footprint: {
      intent: "Report what a change touches: its composition by file kind, the gut-check flags, which exported symbols moved and where they are called from, how it lands -- what the diff puts before a reviewer, and the after-merge steps read from the repository's own RELEASE.md and AGENTS.md -- and which open pull requests it overlaps",
      // The network is read-only and optional: `gh` for the open pull requests, nothing else.
      // The working tree itself is read for the call sites of the changed symbols (#10).
      effects: { reads: ["<cwd>/.git", "<cwd>"], writes: [], network: true, idempotent: true },
      // No secret reaches footprint: `gh` holds its own credential and footprint never reads it.
      secrets: [],
      emits: [{ ...COMPOSITION_TYPE, schema: COMPOSITION_SCHEMA }, { ...LANDING_TYPE, schema: LANDING_SCHEMA }, { ...BLAST_RADIUS_TYPE, schema: BLAST_RADIUS_SCHEMA }, { ...OVERLAP_TYPE, schema: OVERLAP_SCHEMA }],
    },
  },
  retention: { count: 50 },
  human: (line) => {
    if (line.event !== "result") return null;
    const id = (line._schema as { id?: string } | undefined)?.id;
    if (id === LANDING_TYPE.id) return landingMarkdown;
    if (id === BLAST_RADIUS_TYPE.id) return blastMarkdown;
    if (id === OVERLAP_TYPE.id) return overlapMarkdown;
    return markdown;
  },
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

  // The landing plan is a second result in the same run: what the diff puts in front of a reviewer
  // before the merge, and the steps to take after, read from the repository rather than invented.
  const landing = landingPlan(changes.map((c) => c.path), readLandingDocs(run.cwd));
  run.step(
    `landing plan: ${landing.after_merge.statement}`,
    `after-merge steps are read from ${LANDING_DOCUMENTS.join(" and ")} under the working directory, never invented; ` +
      `the before-merge guard rule is path patterns over the changed files, and found ${landing.before_merge.guards.length}`,
    { read: landing.after_merge.read, guards: landing.before_merge.guards },
  );
  landingMarkdown = renderLanding(landing);
  run.result(landingRecord(range, landing), LANDING_TYPE, { markdown: landingMarkdown });

  // The export surface, the third result in the same run (flyingrobots/footprint#9), and the call
  // sites of every symbol it names (flyingrobots/footprint#10).
  const graftSurface = await exportSurface(graft, run.cwd, range);
  const surface = await attachCallSites(graftSurface, run.cwd);
  if (surface.available) {
    const scan = surface.surface.callSiteScan;
    const symbols = surfaceSymbols(surface.surface).length;
    run.step(
      scan.available
        ? `call sites of ${symbols} symbol${symbols === 1 ? "" : "s"}: ${scan.filesScanned} file${scan.filesScanned === 1 ? "" : "s"} scanned`
        : `call sites unavailable (${scan.reason.code})`,
      scan.available
        ? "every whole-word occurrence of each symbol's name in the tracked, non-binary files of the working tree, by git ls-files; no graft contract answers with a call site's line, so this is footprint's own scan and it counts declarations, comments and strings"
        : scan.reason.detail,
      scan.available ? { files_scanned: scan.filesScanned, files_skipped: { ...scan.skipped } } : undefined,
    );
    if (!scan.available) {
      run.warning({ code: "callsites.scan_failed", problem: `the call sites of the changed symbols could not be found (${scan.reason.code}): ${scan.reason.detail}`, remedy: "run footprint from inside a git repository", remedy_target: run.cwd });
    }
  }
  if (!surface.available && surface.reason.code !== "graft.not_resolved") {
    run.warning({ code: "graft.exports_failed", problem: `the export-surface diff is unavailable (${surface.reason.code}): ${surface.reason.detail}`, remedy: "run graft struct exports <base> <head> --json by hand to see why", remedy_target: graft ?? range });
  }
  // Changed files in languages graft's grammars cannot parse at all -- independent of whether
  // graft ran or what it returned (flyingrobots/footprint#12).
  const unanalysed = unsupportedLanguages(changes.map((c) => c.path));
  blastMarkdown = blastRadius(surface, unanalysed);
  run.result(exportsRecord(range, surface, unanalysed), BLAST_RADIUS_TYPE, { markdown: blastMarkdown });

  // Cross-pull-request overlap: the fourth result in the same run, after the blast radius.
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
