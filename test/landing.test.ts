// The landing plan: pure derivation over a changed-file list and the text of the documents a
// repository already uses to declare how a change lands. No network, no git: the fixture
// repositories under test/fixtures/landing/ carry the documents and a changed-file list.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  declaredSteps,
  guardsIn,
  landingPlan,
  readLandingDocs,
  type Landing,
} from "../src/landing.ts";
import { renderLanding } from "../src/render.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures/landing");

function fixture(name: string): Landing {
  const dir = join(FIXTURES, name);
  const paths = readFileSync(join(dir, "changed-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return landingPlan(paths, readLandingDocs(dir));
}

describe("after merge: steps read from the repository's own documents", () => {
  test("a repository with a RELEASE.md yields its steps, each citing file and heading", () => {
    const l = fixture("with-release");
    expect(l.after_merge.declared).toBe(true);
    expect(l.after_merge.nothing_to_do).toBe(false);
    expect(l.after_merge.steps).toEqual([
      { step: "Update both changelogs.", file: "RELEASE.md", heading: "Release" },
      { step: "Bump the version in `package.json`.", file: "RELEASE.md", heading: "Release" },
      { step: "Tag the commit and push the tag.", file: "RELEASE.md", heading: "Release" },
      { step: "Create the GitHub release from the tag.", file: "RELEASE.md", heading: "Afterwards" },
      { step: "Confirm `sync-agents --check` is clean.", file: "RELEASE.md", heading: "Afterwards" },
    ]);
    expect(l.after_merge.read.find((r) => r.file === "RELEASE.md")).toMatchObject({ present: true });
    expect(l.after_merge.read.find((r) => r.file === "AGENTS.md")).toMatchObject({ present: true, headings: [] });
    expect(l.after_merge.statement).toContain("RELEASE.md");
  });

  test("a heading is never a step, and neither is a line in a fenced code block", () => {
    const text = readFileSync(join(FIXTURES, "with-release/RELEASE.md"), "utf8");
    const steps = declaredSteps("RELEASE.md", text).map((s) => s.step);
    expect(steps).not.toContain("Release");
    expect(steps).not.toContain("Afterwards");
    expect(steps.some((s) => s.includes("bun run release"))).toBe(false);
    expect(steps.some((s) => s.includes("not a landing section"))).toBe(false);
  });

  test("no RELEASE.md and an AGENTS.md with no landing section is a stated fallback", () => {
    const l = fixture("no-release");
    expect(l.after_merge.declared).toBe(false);
    expect(l.after_merge.steps).toEqual([]);
    expect(l.after_merge.nothing_to_do).toBe(false);
    expect(l.after_merge.statement).toMatch(/RELEASE\.md is absent/);
    expect(l.after_merge.statement).toMatch(/AGENTS\.md/);
    expect(l.after_merge.statement).toMatch(/states none rather than inventing/);
  });

  test("an empty RELEASE.md, and a landing heading with nothing under it, declare nothing", () => {
    const l = fixture("empty-release");
    expect(l.after_merge.declared).toBe(false);
    expect(l.after_merge.steps).toEqual([]);
    expect(l.after_merge.read.find((r) => r.file === "RELEASE.md")).toMatchObject({ present: true, headings: [] });
    expect(l.after_merge.read.find((r) => r.file === "AGENTS.md")).toMatchObject({ present: true, headings: ["Releasing"] });
    expect(l.after_merge.statement).toMatch(/states none rather than inventing/);
  });

  test("a documentation-only change says nothing to do after merge, plainly", () => {
    const l = fixture("docs-only");
    expect(l.after_merge.nothing_to_do).toBe(true);
    expect(l.after_merge.statement.toLowerCase()).toContain("nothing to do after merge");
    expect(l.after_merge.steps).toEqual([]);
    expect(l.after_merge.read.find((r) => r.file === "RELEASE.md")?.headings).toEqual(["Release", "Afterwards"]);
  });

  test("a range that changes no file says nothing to do after merge", () => {
    const l = landingPlan([], readLandingDocs(join(FIXTURES, "with-release")));
    expect(l.after_merge.nothing_to_do).toBe(true);
    expect(l.after_merge.statement.toLowerCase()).toContain("nothing to do after merge");
  });
});

describe("before merge: the guard rule is path patterns, computed", () => {
  test("a source change with no migration, flag or version entry is unguarded", () => {
    const l = fixture("no-release");
    expect(l.before_merge.unguarded).toBe(true);
    expect(l.before_merge.guards).toEqual([]);
    expect(l.before_merge.unguarded_because).toMatch(/migration/);
    expect(l.before_merge.unguarded_because).toMatch(/flag/);
  });

  test("a changelog entry among the changed files is a guard, so the warning stays quiet", () => {
    const l = fixture("with-release");
    expect(l.before_merge.unguarded).toBe(false);
    expect(l.before_merge.guards).toEqual([{ path: "CHANGELOG.md", kind: "version" }]);
  });

  test("a change touching no source file is not unguarded, because nothing needs a guard", () => {
    const l = fixture("docs-only");
    expect(l.before_merge.unguarded).toBe(false);
    expect(l.before_merge.unguarded_because).toMatch(/no source file/);
  });

  test("guardsIn classifies migrations, flags and version entries by path", () => {
    expect(guardsIn(["db/migrations/0003_add_index.sql"])).toEqual([{ path: "db/migrations/0003_add_index.sql", kind: "migration" }]);
    expect(guardsIn(["migrations/0001_init.ts"])).toEqual([{ path: "migrations/0001_init.ts", kind: "migration" }]);
    expect(guardsIn(["src/flags/checkout.ts"])).toEqual([{ path: "src/flags/checkout.ts", kind: "flag" }]);
    expect(guardsIn(["config/feature-flags.yaml"])).toEqual([{ path: "config/feature-flags.yaml", kind: "flag" }]);
    expect(guardsIn(["CHANGELOG.md"])).toEqual([{ path: "CHANGELOG.md", kind: "version" }]);
    expect(guardsIn(["package.json"])).toEqual([{ path: "package.json", kind: "version" }]);
    expect(guardsIn(["src/app.ts", "docs/README.md"])).toEqual([]);
  });

  test("a migration in the diff is named with its ordering constraint", () => {
    const l = fixture("migration");
    const item = l.before_merge.items.find((i) => i.kind === "migration");
    expect(item?.paths).toEqual(["db/migrations/0003_add_index.sql"]);
    expect(item?.says).toContain("db/migrations/0003_add_index.sql");
    expect(item?.says.toLowerCase()).toContain("order");
    expect(l.before_merge.unguarded).toBe(false);
  });

  test("a manifest changed with no lockfile beside it is an artifact to regenerate", () => {
    const l = landingPlan(["package.json", "src/app.ts"], []);
    const item = l.before_merge.items.find((i) => i.kind === "regenerate");
    expect(item?.paths).toEqual(["package.json"]);
    expect(item?.says).toContain("package.json");
    expect(landingPlan(["package.json", "bun.lock", "src/app.ts"], []).before_merge.items.some((i) => i.kind === "regenerate")).toBe(false);
  });

  test("generated files in the diff are reported as generated, not judged", () => {
    const l = landingPlan(["dist/bundle.js", "src/app.ts", "CHANGELOG.md"], []);
    const item = l.before_merge.items.find((i) => i.kind === "generated");
    expect(item?.paths).toEqual(["dist/bundle.js"]);
  });
});

describe("the two --human sections", () => {
  test("Before merge and After merge are separate sections, and the warning is loud", () => {
    const md = renderLanding(fixture("no-release"));
    expect(md).toContain("## Before merge");
    expect(md).toContain("## After merge");
    expect(md.indexOf("## Before merge")).toBeLessThan(md.indexOf("## After merge"));
    expect(md).toContain("> [!WARNING]");
    expect(md).toContain("**Nothing in this change guards it.**");
  });

  test("every after-merge step is rendered with the file and heading it was read from", () => {
    const md = renderLanding(fixture("with-release"));
    expect(md).toContain("Update both changelogs.");
    expect(md).toContain("`RELEASE.md` › Release");
    expect(md).toContain("`RELEASE.md` › Afterwards");
    expect(md).not.toContain("> [!WARNING]");
  });

  test("a docs-only change renders the plain sentence and no step list", () => {
    const md = renderLanding(fixture("docs-only"));
    expect(md.toLowerCase()).toContain("nothing to do after merge");
    expect(md).not.toContain("Update both changelogs.");
  });
});
