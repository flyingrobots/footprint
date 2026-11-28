import { expect, test, describe } from "bun:test";
import { classify } from "../src/classify.ts";
import { compose, parseNumstat, mermaidPie } from "../src/footprint.ts";
import { blastRadius, gutCheck, render } from "../src/render.ts";
import { parseStructuralReview, structuralSummary } from "../src/graft.ts";
import { unsupportedLanguages } from "../src/languages.ts";

describe("classify", () => {
  test("orders rules so a test fixture is a test, not a source file", () => {
    expect(classify("test/fixtures/sample.ts")).toBe("test");
    expect(classify("src/footprint.ts")).toBe("source");
    expect(classify("src/footprint.test.ts")).toBe("test");
  });

  test("Markdown under spec/ is docs, not test", () => {
    for (const f of ["spec/parley-v0.2.md", "spec/x.mdx", "spec/notes.txt", "spec/a/b.rst", "docs/spec/x.md"]) {
      expect(classify(f)).toBe("docs");
    }
  });

  test("code and fixtures under spec/ stay test", () => {
    for (const f of [
      "spec/models/user_spec.rb",
      "spec/foo.spec.ts",
      "spec/helpers.ts",
      "spec/fixtures/x.json",
      "spec/fixtures/x.md",
      "tests/spec/x.md",
    ]) {
      expect(classify(f)).toBe("test");
    }
  });

  test("a lockfile is generated, not config, even though it is JSON", () => {
    expect(classify("package-lock.json")).toBe("generated");
    expect(classify("bun.lock")).toBe("generated");
    expect(classify("package.json")).toBe("config");
  });

  test("docs beat extension rules", () => {
    expect(classify("docs/topics/x/README.md")).toBe("docs");
    expect(classify("README.md")).toBe("docs");
    expect(classify("docs/assets/diagram.svg")).toBe("docs");
  });

  test("CI and container files are ci", () => {
    expect(classify(".github/workflows/ci.yml")).toBe("ci");
    expect(classify("server/Dockerfile")).toBe("ci");
  });

  test("anything unrecognised is source, never silently dropped", () => {
    expect(classify("weird/thing.xyz")).toBe("source");
  });

  // flyingrobots/footprint#36: extensionless licence files fell through to source.
  test("licence and notice files are docs, at any depth", () => {
    for (const p of ["packages/parley-emit-py/LICENSE", "NOTICE", "LICENSE", "LICENSE.APACHE", "COPYING", "a/b/NOTICE"]) {
      expect([p, classify(p)]).toEqual([p, "docs"]);
    }
  });

  test("a licence file under a generated or test path keeps that category", () => {
    expect(classify("node_modules/x/LICENSE")).toBe("generated");
    expect(classify("test/fixtures/repo/LICENSE")).toBe("test");
  });

  test("only the named licence files are docs, not names that merely contain them", () => {
    for (const p of ["src/NOTICES", "COPYINGX", "MYLICENSE"]) expect([p, classify(p)]).toEqual([p, "source"]);
  });

  // flyingrobots/footprint#34: a skill is instructions an agent executes, so not documentation.
  test("an agent skill's Markdown is config, not docs", () => {
    for (const p of ["skills/footprint/SKILL.md", "skills/footprint/reference.md", "packages/a/skills/b/notes.mdx", ".claude/skills/x/SKILL.md", "SKILL.md", "docs/agents/SKILL.md"]) {
      expect([p, classify(p)]).toEqual([p, "config"]);
    }
  });

  test("only Markdown under a skills/ component, or SKILL.md, moves out of docs", () => {
    const cases: Array<[string, string]> = [
      ["test/fixtures/skills/x/SKILL.md", "test"],
      ["docs/skills.md", "docs"],
      ["myskills/x.md", "docs"],
      ["skills/x/run.ts", "source"],
      ["skills/x/logo.png", "assets"],
    ];
    for (const [p, want] of cases) expect([p, classify(p)]).toEqual([p, want]);
  });

  test("a skill-only change is not flagged documentation only, nor an unanalysed language", () => {
    const c = compose([{ path: "skills/footprint/SKILL.md", added: 3, removed: 1, binary: false }]);
    expect(c.byCategory.map((r) => r.category)).toEqual(["config"]);
    expect(gutCheck(c).flags.some((f) => f.startsWith("Documentation only"))).toBe(false);
    expect(unsupportedLanguages(["skills/footprint/SKILL.md"])).toEqual([]);
  });

  test("licence files are not reported as an unanalysed language", () => {
    expect(unsupportedLanguages(["packages/parley-emit-py/LICENSE", "packages/parley-emit-py/NOTICE"])).toEqual([]);
  });
});

// `git diff --numstat -z` records (flyingrobots/footprint#66): `added\tremoved\tpath\0`, or for a
// rename or copy `added\tremoved\t\0old\0new\0`. `z` writes the first form, so a fixture reads
// as the old line-per-file text did.
const z = (...lines: string[]) => lines.map((l) => `${l}\0`).join("");

describe("parseNumstat", () => {
  test("reads counts and paths", () => {
    const changes = parseNumstat(z("10\t2\tsrc/a.ts", "0\t5\tdocs/b.md"));
    expect(changes).toEqual([
      { path: "src/a.ts", added: 10, removed: 2, binary: false },
      { path: "docs/b.md", added: 0, removed: 5, binary: false },
    ]);
  });

  test("a binary file reports no line counts rather than NaN", () => {
    const [change] = parseNumstat(z("-\t-\tdocs/logo.png"));
    expect(change).toEqual({ path: "docs/logo.png", added: 0, removed: 0, binary: true });
  });

  test("empty output yields no changes", () => {
    expect(parseNumstat("")).toEqual([]);
  });

  test("a rename is reported under its new path, not git's {old => new} text", () => {
    expect(parseNumstat("3\t1\t\0src/auth.ts\0src/auth/index.ts\0")).toEqual([
      { path: "src/auth/index.ts", added: 3, removed: 1, binary: false },
    ]);
  });

  test("a binary rename is reported under its new path", () => {
    expect(parseNumstat("-\t-\t\0img/a.png\0assets/a.png\0")).toEqual([
      { path: "assets/a.png", added: 0, removed: 0, binary: true },
    ]);
  });

  test("a rename between ordinary entries keeps every record aligned", () => {
    const out = parseNumstat(`1\t0\ta.ts\0${"0\t0\t\0lib/old.py\0docs/notes.md\0"}2\t2\tb.ts\0`);
    expect(out.map((c) => c.path)).toEqual(["a.ts", "docs/notes.md", "b.ts"]);
  });

  test("a path holding a tab or a non-ASCII name is read verbatim, not C-quoted", () => {
    expect(parseNumstat(z("1\t0\tdocs/a\tb.md", "1\t0\tdocs/café.md")).map((c) => c.path)).toEqual(["docs/a\tb.md", "docs/café.md"]);
  });
});

describe("compose", () => {
  const changes = parseNumstat(
    z("100\t50\tsrc/a.ts", "20\t0\ttest/a.test.ts", "30\t0\tdocs/x.md", "-\t-\tdocs/logo.png"),
  );

  test("totals are the sum of the parts, never estimated", () => {
    const c = compose(changes);
    expect(c.files).toBe(4);
    expect(c.added).toBe(150);
    expect(c.removed).toBe(50);
    expect(c.binaryFiles).toBe(1);
    // The invariant that the original hand-written footprint got wrong: the reported total
    // must equal the sum of the category rows.
    const summed = c.byCategory.reduce((n, r) => n + r.added + r.removed, 0);
    expect(summed).toBe(c.added + c.removed);
  });

  test("shares sum to 100 for a non-empty change", () => {
    const c = compose(changes);
    const total = c.byCategory.reduce((n, r) => n + r.share, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(0.2); // rounding slack
  });

  test("a change with no line edits does not divide by zero", () => {
    const c = compose([{ path: "docs/logo.png", added: 0, removed: 0, binary: true }]);
    expect(c.byCategory[0]!.share).toBe(0);
    expect(c.files).toBe(1);
  });

  test("empty input yields an empty composition, not a crash", () => {
    const c = compose([]);
    expect(c).toEqual({ files: 0, added: 0, removed: 0, binaryFiles: 0, byCategory: [] });
  });
});

describe("mermaidPie", () => {
  test("renders a pie whose slices are the category line totals", () => {
    const pie = mermaidPie(compose(parseNumstat(z("100\t50\tsrc/a.ts", "30\t0\tdocs/x.md"))));
    expect(pie).toContain("```mermaid");
    expect(pie).toContain("pie showData");
    expect(pie).toContain('"source" : 150');
    expect(pie).toContain('"docs" : 30');
  });

  test("an empty composition renders nothing rather than an empty chart", () => {
    expect(mermaidPie(compose([]))).toBe("");
  });
});

describe("structuralSummary", () => {
  test("counts files by shape and sums symbol deltas", () => {
    const summary = structuralSummary({
      files: [
        { path: "a.ts", category: "structural", added: 2, removed: 1, changed: 3 },
        { path: "b.ts", category: "formatting" },
        { path: "c.md", category: "docs" },
      ],
      breakingChanges: [],
    });
    expect(summary).toEqual({
      structural: 1, formatting: 1, symbolsAdded: 2, symbolsRemoved: 1, symbolsChanged: 3,
    });
  });

  test("a review with no structural files reports zeroes, not NaN", () => {
    expect(structuralSummary({ files: [], breakingChanges: [] })).toEqual({
      structural: 0, formatting: 0, symbolsAdded: 0, symbolsRemoved: 0, symbolsChanged: 0,
    });
  });
});

describe("render with and without graft", () => {
  const changes = parseNumstat(z("10\t2\tsrc/a.ts"));
  test("states the limitation when graft is unavailable rather than hiding it", () => {
    const out = render(compose(changes), changes, "a...b", null);
    expect(out).toContain("Structural analysis unavailable");
  });

  test("reports structural counts when graft is available", () => {
    const out = render(compose(changes), changes, "a...b", {
      files: [{ path: "src/a.ts", category: "structural", added: 2, removed: 0, changed: 0 }],
      breakingChanges: [],
    });
    expect(out).toContain("1 file changed shape");
    expect(out).toContain("+2/-0/~0 symbols");
    expect(out).not.toContain("unavailable");
  });

  test("surfaces breaking changes in the gut check", () => {
    const out = render(compose(changes), changes, "a...b", {
      files: [{ path: "src/a.ts", category: "structural", added: 0, removed: 1, changed: 0 }],
      breakingChanges: ["removed export foo"],
    });
    expect(out).toContain("1 breaking change(s)");
  });
});

describe("each severity statement names the graft command it comes from (flyingrobots/footprint#29)", () => {
  test("the breaking count names graft struct review and the semver reading names graft struct exports", () => {
    const changes = [{ path: "src/a.ts", added: 1, removed: 1, binary: false }];
    const md = render(compose(changes), changes, "a...b", {
      files: [{ path: "src/a.ts", category: "structural", added: 0, removed: 0, changed: 1 }],
      breakingChanges: ["signature of foo changed"],
    });
    expect(md).toContain("1 breaking change(s)");
    expect(md).toContain("graft struct review");
    const surface = { available: true, surface: { base: "a", head: "b", added: [], removed: [], signatureChanged: [], semverImpact: "minor", callSiteScan: { available: false, reason: { code: "x", detail: "y" } } } } as unknown as Parameters<typeof blastRadius>[0];
    const blast = blastRadius(surface);
    expect(blast).toContain("graft struct exports");
    expect(blast).toContain("**minor**");
  });
});

describe("the Structural line names graft as the source of its formatting reading (flyingrobots/footprint#44)", () => {
  test("an initializer-only change is graft's \"formatting\", stated as graft's, not footprint's claim", async () => {
    const text = await Bun.file(new URL("./fixtures/graft.struct_review.initializer_only.json", import.meta.url)).text();
    // The reading is graft's own: its JSON labels the file "formatting".
    expect(JSON.parse(text).files.find((f: { path: string }) => f.path === "src/classify.ts").category).toBe("formatting");
    const review = parseStructuralReview(text);
    expect(review).not.toBeNull();
    const changes = [{ path: "src/classify.ts", added: 1, removed: 0, binary: false }];
    const md = render(compose(changes), changes, "a...b", review);
    const line = md.split("\n").find((l) => l.startsWith("**Structural"))!;
    expect(line).toContain("graft struct review");
    expect(md).not.toContain("formatting-only");
    expect(md).toContain("`src/classify.ts`");
    expect(md).toMatch(/graft's (reading|label)/);
  });
});
