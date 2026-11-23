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
import { computeOverlap, underReview, unavailableOverlap, type Overlap, type RangeHead } from "./overlap.ts";
import { isFailure, listOpenPullRequests, resolveGh } from "./pulls.ts";
import { analyseSymbols, graftOutliner, type Symbols } from "./symbols.ts";
import { ghRemote } from "./remote.ts";
import { COMPOSITION_SCHEMA, COMPOSITION_TYPE, compositionRecord, LANDING_SCHEMA, LANDING_TYPE, landingRecord, OVERLAP_SCHEMA, OVERLAP_TYPE, overlapRecord } from "./report.ts";
import { BLAST_RADIUS_SCHEMA, BLAST_RADIUS_TYPE, attachCallSites, exportSurface, rangeBase, rangeEnds, exportsRecord, surfaceCallSiteRows, surfaceSymbols } from "./exports.ts";
import { unsupportedLanguages } from "./languages.ts";
import { BLAST_LIMITS, COMPOSITION_BUDGET, LANDING_BUDGET, MIN_REPORT_CHARS, OVERLAP_BUDGET, REPORT_LIMIT, blastBudget } from "./bound.ts";
import { parseArgs } from "./args.ts";
import { impactIndex, parseImpact, unmatchedEntries, type ImpactIndex } from "./impact.ts";
import { COMMENT_SCHEMA, COMMENT_TYPE, commentCommand, commentProse } from "./comment.ts";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

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
    // flyingrobots/footprint#59: the one Footprint comment of a pull request, found and updated in
    // place or created, with a Changelog row per run. Named first on the command line:
    // `footprint comment <pr> --report <file> --change <text> --reason <text> [--remarks <text>]`.
    comment: {
      intent: "Post a footprint --human report as the pull request's one Footprint comment: find the comment whose first line is <!-- footprint:report --> (or adopt the most recent unmarked '## Footprint' comment by the current gh user), carry its Changelog rows over verbatim, append one row (UTC timestamp, the head's short SHA, --change, --reason, --remarks), and update it in place or create it; never edits another user's comment; at most 65536 characters",
      effects: { reads: ["<--report>"], writes: ["github:<pr> issue comment (one, created or edited in place)"], network: true, idempotent: false },
      secrets: [],
      emits: [{ ...COMMENT_TYPE, schema: COMMENT_SCHEMA }],
    },
  },
  retention: { count: 50 },
  human: (line) => {
    if (line.event !== "result") return null;
    const id = (line._schema as { id?: string } | undefined)?.id;
    if (id === LANDING_TYPE.id) return landingMarkdown;
    if (id === BLAST_RADIUS_TYPE.id) return blastMarkdown;
    if (id === OVERLAP_TYPE.id) return overlapMarkdown;
    if (id === COMMENT_TYPE.id) return commentProse(line);
    return markdown;
  },
});

async function defaultBase(): Promise<string | null> {
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow().then((r) => r.exitCode === 0)) return ref;
  }
  return null;
}

const USAGE = "footprint [<range>] [--max-chars <n>] [--impact <file.jsonl>]";

async function footprint(run: Run, args: string[]): Promise<void> {
  const parsed = parseArgs(args, ["--max-chars", "--impact"]);
  if (!parsed.ok || parsed.positionals.length > 1) {
    run.error({ code: "args.invalid", problem: parsed.ok ? `expected at most one range, got ${JSON.stringify(parsed.positionals)}` : parsed.problem, remedy: `usage: ${USAGE}` });
    return;
  }
  // The bound on the --human report (flyingrobots/footprint#59): GitHub's 65536 unless a caller
  // needs room beside it, as `footprint comment` does for the Changelog.
  const maxCharsText = parsed.flags["--max-chars"];
  const maxChars = maxCharsText === undefined ? REPORT_LIMIT : /^[0-9]+$/.test(maxCharsText) ? Number(maxCharsText) : NaN;
  if (!(maxChars >= MIN_REPORT_CHARS && maxChars <= REPORT_LIMIT)) {
    run.error({ code: "args.invalid", problem: `--max-chars must be a whole number from ${MIN_REPORT_CHARS} to ${REPORT_LIMIT}, got ${JSON.stringify(maxCharsText)}`, remedy: `usage: ${USAGE}` });
    return;
  }
  // The posting agent's reading of the call sites, rendered in --human only (flyingrobots/footprint#59).
  let impact: ImpactIndex | undefined;
  const impactPath = parsed.flags["--impact"];
  if (impactPath !== undefined) {
    const at = resolvePath(run.cwd, impactPath);
    let text: string;
    try {
      text = readFileSync(at, "utf8");
    } catch (e) {
      run.error({ code: "impact.invalid", problem: `the impact file ${at} could not be read: ${e instanceof Error ? e.message : String(e)}`, remedy: "write one JSON object per line, {symbol, system, file?, impact, dataFlow}; an empty file is allowed", remedy_target: at });
      return;
    }
    const entries = parseImpact(text);
    if (!entries.ok) {
      run.error({ code: "impact.invalid", problem: `${at} line ${entries.line}: ${entries.problem}`, remedy: "write one JSON object per line, {symbol, system, file?, impact, dataFlow}", remedy_target: `${at}:${entries.line}` });
      return;
    }
    impact = impactIndex(entries.entries);
    run.step(`impact columns from ${entries.entries.length} entr${entries.entries.length === 1 ? "y" : "ies"}`, "--impact was given: the posting agent's reading of the call sites, rendered in the --human call-site tables only and labelled as the agent's; no result line carries it");
  }
  const given = parsed.positionals[0];
  const spec = given ?? (await defaultBase());
  if (spec === null) {
    run.error({ code: "base.not_found", problem: "No default branch found: none of origin/main, origin/master, main or master exists", remedy: "pass a base explicitly", remedy_target: "<base>" });
    return;
  }
  // Three dots: compare against the merge base, so unrelated default-branch commits are excluded.
  const range = spec.includes("..") ? spec : `${spec}...HEAD`;
  run.step(`compare ${range}`, given === undefined ? `no base was given; ${spec} is the first of origin/main, origin/master, main, master that exists` : given.includes("..") ? "the range was given on the command line" : "the base was given on the command line; three dots compare against the merge base");

  // Both ends pinned to commit ids before anything is read (flyingrobots/footprint#56): the run
  // takes minutes of gh calls, and a branch that advances meanwhile must not be read once for the
  // changed files and again for the symbols. Every section compares the pinned range; `range`, as
  // written, is what the report shows. A range git cannot resolve stays as written, so the diff
  // below fails with git's own message.
  const ends = rangeEnds(range);
  const commitOf = async (ref: string) => (await $`git rev-parse --verify --quiet ${`${ref}^{commit}`}`.quiet().nothrow()).text().trim() || null;
  const baseId = await commitOf(ends.base);
  const headId = await commitOf(ends.head);
  const pinned = baseId !== null && headId !== null ? `${baseId}${ends.threeDot ? "..." : ".."}${headId}` : range;

  const diff = await $`git diff --numstat ${pinned}`.quiet().nothrow();
  if (diff.exitCode !== 0) {
    run.error({ code: "git.diff_failed", problem: `git diff --numstat ${range} exited ${diff.exitCode}: ${diff.stderr.toString().trim() || "(no message)"}`, remedy: "pass a range git can resolve", remedy_target: range });
    return;
  }
  const changes = parseNumstat(diff.text());
  const head = headId ?? ends.head;
  const baseRef = await rangeBase(run.cwd, pinned);

  const graft = await resolveGraft(process.env.FOOTPRINT_GRAFT);
  run.step(graft === null ? "structural analysis unavailable" : `structural analysis via ${graft}`, graft === null ? "graft could not be resolved through the package or PATH; the report states the limitation rather than omitting the section" : "graft resolved through the package dependency, PATH or FOOTPRINT_GRAFT");
  const review = graft === null || changes.length === 0 || !baseRef.ok ? null : await structuralReview(graft, run.cwd, baseRef.ref, head);
  if (graft !== null && changes.length > 0 && review === null) {
    run.warning({ code: "graft.review_failed", problem: baseRef.ok ? "graft struct review failed or returned output footprint could not read; structural analysis unavailable for this run" : `${baseRef.detail}; structural analysis unavailable for this run`, remedy: "run graft struct review --json by hand to see why", remedy_target: graft });
  }

  const composition = compose(changes);
  const gut = gutCheck(composition);
  markdown = changes.length === 0 ? `No changes in \`${range}\`.` : render(composition, changes, range, review, COMPOSITION_BUDGET);
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
  landingMarkdown = renderLanding(landing, LANDING_BUDGET);
  run.result(landingRecord(range, landing), LANDING_TYPE, { markdown: landingMarkdown });

  // The export surface, the third result in the same run (flyingrobots/footprint#9), and the call
  // sites of every symbol it names (flyingrobots/footprint#10).
  const graftSurface = await exportSurface(graft, run.cwd, pinned);
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
  // The report is posted as one GitHub comment, which holds at most REPORT_LIMIT characters
  // (flyingrobots/footprint#51): the blast radius gets what composition and landing left.
  blastMarkdown = blastRadius(surface, unanalysed, blastBudget(markdown.length, landingMarkdown.length, maxChars), BLAST_LIMITS, impact);
  if (impact !== undefined) {
    const rows = surface.available && surface.surface.callSiteScan.available ? surfaceCallSiteRows(surface.surface) : [];
    const unmatched = unmatchedEntries(impact, rows);
    if (unmatched.length > 0) {
      run.warning({
        code: "impact.unmatched",
        problem: `${unmatched.length} impact entr${unmatched.length === 1 ? "y matches" : "ies match"} no call-site row of this range: ${unmatched.slice(0, 20).map((e) => `${e.symbol} in ${e.system}${e.file === undefined ? "" : ` at ${e.file}`}`).join("; ")}${unmatched.length > 20 ? `; and ${unmatched.length - 20} more` : ""}`,
        remedy: "check each entry's symbol, system and file against the call-site tables of this head; an entry for an earlier head is stale",
      });
    }
  }
  run.result(exportsRecord(range, surface, unanalysed), BLAST_RADIUS_TYPE, { markdown: blastMarkdown });

  // Cross-pull-request overlap: the fourth result in the same run, after the blast radius.
  const overlap = await crossPullRequest(run, changes.map((c) => c.path), { ref: ends.head, commit: headId }, baseRef, graft);
  overlapMarkdown = renderOverlap(overlap, OVERLAP_BUDGET);
  run.result(overlapRecord(range, overlap), OVERLAP_TYPE, { markdown: overlapMarkdown });
}

/**
 * The open pull requests that share a file with this change, and an order they could land in.
 * `gh` absent, unauthenticated or rate-limited is a stated limitation and the run still succeeds:
 * an omitted section would read as "nothing overlaps", which is a different claim.
 */
async function crossPullRequest(
  run: Run,
  changed: readonly string[],
  headRef: { readonly ref: string; readonly commit: string | null },
  baseRef: { ok: true; ref: string } | { ok: false; detail: string },
  graft: string | null,
): Promise<Overlap> {
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
  const self = underReview(pulls.pullRequests, await rangeHead(headRef.ref, headRef.commit));
  const fileLevel = computeOverlap(changed, pulls.pullRequests, { self, limit: pulls.limit });
  // The symbol level of every shared file (flyingrobots/footprint#33), bounded: only the shared
  // files of pairs that share one, an outline budget per run and a timeout per graft call.
  const outliner = graft === null ? null : graftOutliner(graft);
  let symbols: Symbols | undefined;
  try {
    symbols = await analyseSymbols({
      repo: run.cwd,
      prs: pulls.pullRequests,
      conflicts: fileLevel.conflicts,
      overlapping: fileLevel.overlapping,
      range: baseRef.ok ? { base: baseRef.ref, head: headRef.commit ?? headRef.ref } : { code: "git.merge_base", reason: `${baseRef.detail}, so this change has no merge base to compare symbols from` },
      outliner,
      remote: ghRemote(gh, run.cwd),
    });
  } catch (e) {
    // The symbol level is enrichment: a fault in it leaves every edge undetermined (file-level),
    // stated as a warning, rather than costing the run its overlap section.
    run.warning({ code: "symbols.analysis_failed", problem: `the symbol-level comparison of the shared files failed, so every edge is file-level: ${e instanceof Error ? e.message : String(e)}`, remedy: "report it with the range; the file-level overlap is unaffected" });
  } finally {
    // A directory that will not go away is a warning: the levels are already computed, and a
    // throw here would cost the run its overlap section (flyingrobots/footprint#56).
    const cleanup = outliner?.dispose() ?? null;
    if (cleanup !== null) run.warning({ code: cleanup.code, problem: cleanup.reason, remedy: "remove the directory by hand; the overlap result is unaffected" });
  }
  const overlap = computeOverlap(changed, pulls.pullRequests, { self, limit: pulls.limit, symbols });
  const counted = (lv: string) => overlap.conflicts.filter((c) => c.symbolLevel.level === lv).length;
  if (symbols !== undefined) run.step(
    `symbol level of ${overlap.conflicts.length} edge${overlap.conflicts.length === 1 ? "" : "s"}: ${counted("symbol-disjoint")} disjoint, ${counted("symbol-overlapping")} overlapping, ${counted("undetermined")} undetermined`,
    `each side's changed lines from git diff -U0 against its merge base, attributed to the top-level symbols of graft read outline at the merge base and the head; ${symbols.analysis.outlinesRun} of at most ${symbols.analysis.outlineBudget} outline calls, each stopped after ${symbols.analysis.outlineTimeoutMs} ms; a pull request whose commits are not in the clone is read over read-only gh api calls by commit id, never fetched (${symbols.analysis.remoteCalls} of at most ${symbols.analysis.remoteBudget}, each stopped after ${symbols.analysis.remoteTimeoutMs} ms); a symbol-disjoint edge does not separate waves`,
  );
  if (self !== null) run.step(`#${self} is the pull request under review`, "its head commit is the range's head commit (or, failing a commit match, its same-repository head branch is the range's head branch), so it is excluded from the overlap rather than listed against itself");
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
 * The range's head as the pull-request match needs it: the commit id pinned at the start of the
 * run, and the branch name when the head is a branch (HEAD resolves to the checked-out branch;
 * `origin/x` is branch `x`; a commit id or a tag has no branch name).
 */
async function rangeHead(ref: string, commit: string | null): Promise<RangeHead> {
  const text = async (...cmd: string[]) => (await $`${cmd}`.quiet().nothrow()).text().trim() || null;
  let branch: string | null = null;
  const exists = async (full: string) => (await $`git show-ref --verify --quiet ${full}`.quiet().nothrow()).exitCode === 0;
  if (ref === "HEAD") branch = await text("git", "symbolic-ref", "--short", "--quiet", "HEAD");
  else if (await exists(`refs/heads/${ref}`)) branch = ref;
  else if (ref.startsWith("origin/") && (await exists(`refs/remotes/${ref}`))) branch = ref.slice("origin/".length);
  return { commit, branch };
}

/**
 * The resolved interpretation (spec §5), which is also the inv preimage: the range after the
 * default base is applied, both ends as commit ids, and the graft setting. The commit ids are the
 * content addresses of the subject matter, so inv moves when the compared trees move; without
 * them a footprint run would declare no inputs and its inv would cover the arguments alone.
 */
async function resolved(args: string[], command: string): Promise<Record<string, unknown>> {
  // Never throws: an argument the handler will refuse is still recorded, so the refusal is an
  // error line with exit 2 rather than a startup failure.
  const parsed = parseArgs(args, command === "comment" ? ["--report", "--change", "--reason", "--remarks"] : ["--max-chars", "--impact"]);
  const flags = parsed.ok ? parsed.flags : {};
  if (command === "comment") {
    return { command, pull_request: parsed.ok ? parsed.positionals[0] ?? null : null, report: flags["--report"] ?? null, change: flags["--change"] ?? null, reason: flags["--reason"] ?? null, remarks: flags["--remarks"] ?? null };
  }
  const given = (parsed.ok ? parsed.positionals[0] : args.find((a) => !a.startsWith("-"))) ?? null;
  const spec = given ?? (await defaultBase());
  const range = spec === null ? null : spec.includes("..") ? spec : `${spec}...HEAD`;
  const ends = range === null ? [null, null] : range.split(/\.{2,3}/);
  const rev = async (ref: string | null) => (ref === null ? null : (await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow()).text().trim() || null);
  return {
    command: "footprint", base: given, default_base: given === null ? spec : null, range, base_commit: await rev(ends[0] ?? null), head_commit: await rev(ends[1] || "HEAD"), graft: process.env.FOOTPRINT_GRAFT ?? null,
    // Only when given, so a run without them resolves exactly as it did before they existed.
    ...(flags["--max-chars"] === undefined ? {} : { max_chars: flags["--max-chars"] }),
    ...(flags["--impact"] === undefined ? {} : { impact: flags["--impact"] }),
  };
}

/** The files a run reads besides the repository: the report a comment posts, the impact entries a report renders. */
function inputs(args: string[], command: string): { path: string }[] {
  const parsed = parseArgs(args, command === "comment" ? ["--report", "--change", "--reason", "--remarks"] : ["--max-chars", "--impact"]);
  if (!parsed.ok) return [];
  const path = command === "comment" ? parsed.flags["--report"] : parsed.flags["--impact"];
  return path === undefined ? [] : [{ path }];
}

// `footprint` is the default command: `footprint <range>` names none, so it is named here unless
// the first positional argument is `comment` (flyingrobots/footprint#59).
const argv = process.argv.slice(2);
const named = argv.find((a) => !a.startsWith("-")) === "comment" ? "comment" : "footprint";
const status = await main(tool, ["footprint", ...(named === "comment" ? argv : ["footprint", ...argv])], (run, args) => (named === "comment" ? commentCommand(run, args) : footprint(run, args)), { resolved, inputs });
process.exit(status);
