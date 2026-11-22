#!/usr/bin/env bun
// footprint speaks the Parley output protocol (flyingrobots/parley, spec v0.2): JSON Lines on
// stdout and stderr, a receipt per run, `--human` for the Markdown comment.
import { $ } from "bun";
import { defineTool, main, type Run } from "@flyingrobots/parley-emit";
import pkg from "../package.json" with { type: "json" };
import { compose, parseNumstat } from "./footprint.ts";
import { gutCheck, render } from "./render.ts";
import { resolveGraft, structuralReview } from "./graft.ts";
import { landingPlan, readLandingDocs, LANDING_DOCUMENTS } from "./landing.ts";
import { renderLanding } from "./render.ts";
import { COMPOSITION_SCHEMA, COMPOSITION_TYPE, compositionRecord, LANDING_SCHEMA, LANDING_TYPE, landingRecord } from "./report.ts";

let markdown = "";
let landingMarkdown = "";

const tool = defineTool({
  name: "footprint",
  version: pkg.version,
  commands: {
    footprint: {
      intent: "Report what a change touches: its composition by file kind, the gut-check flags, whether anything's shape moved, and how it lands -- what the diff puts before a reviewer, and the after-merge steps read from the repository's own RELEASE.md and AGENTS.md",
      effects: { reads: ["<cwd>/.git"], writes: [], network: false, idempotent: true },
      secrets: [],
      emits: [{ ...COMPOSITION_TYPE, schema: COMPOSITION_SCHEMA }, { ...LANDING_TYPE, schema: LANDING_SCHEMA }],
    },
  },
  retention: { count: 50 },
  human: (line) => (line.event !== "result" ? null : (line._schema as { id?: string } | undefined)?.id === LANDING_TYPE.id ? landingMarkdown : markdown),
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
