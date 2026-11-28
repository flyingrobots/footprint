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

describe("parseNumstat", () => {
  test("reads counts and paths", () => {
    const changes = parseNumstat("10\t2\tsrc/a.ts\n0\t5\tdocs/b.md\n");
    expect(changes).toEqual([
      { path: "src/a.ts", added: 10, removed: 2, binary: false },
      { path: "docs/b.md", added: 0, removed: 5, binary: false },
    ]);
  });

  test("a binary file reports no line counts rather than NaN", () => {
    const [change] = parseNumstat("-\t-\tdocs/logo.png\n");
    expect(change).toEqual({ path: "docs/logo.png", added: 0, removed: 0, binary: true });
  });

  test("ignores blank lines", () => {
    expect(parseNumstat("\n\n")).toEqual([]);
  });
});

describe("compose", () => {
  const changes = parseNumstat(
    ["100\t50\tsrc/a.ts", "20\t0\ttest/a.test.ts", "30\t0\tdocs/x.md", "-\t-\tdocs/logo.png"].join("\n"),
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
    const pie = mermaidPie(compose(parseNumstat("100\t50\tsrc/a.ts\n30\t0\tdocs/x.md")));
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
  const changes = parseNumstat("10\t2\tsrc/a.ts");
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

describe("the composition table's total share is computed (flyingrobots/footprint#67)", () => {
  const totalRow = (md: string) => md.split("\n").find((l) => l.startsWith("| **total** |"));

  test("a change with no changed lines reports a 0% total, as its rows do", () => {
    const changes = [{ path: "docs/logo.png", added: 0, removed: 0, binary: true }];
    expect(totalRow(render(compose(changes), changes, "a...b", null))).toBe("| **total** | **1** | **+0/-0** | **0%** |");
  });

  test("a change with changed lines reports a 100% total", () => {
    const changes = parseNumstat("10\t2\tsrc/a.ts");
    expect(totalRow(render(compose(changes), changes, "a...b", null))).toBe("| **total** | **1** | **+10/-2** | **100%** |");
  });
});

describe("vendored code, lockfiles and generated sources are generated (flyingrobots/footprint#68)", () => {
  test("a vendor/ directory at any depth is generated", () => {
    for (const f of ["vendor/github.com/x/y.go", "app/vendor/autoload.php", "packages/a/vendor/lib.rb"]) expect(classify(f)).toBe("generated");
  });

  test("the common lockfiles of each major ecosystem are generated", () => {
    for (const f of [
      "Gemfile.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "composer.lock", "flake.lock", "mix.lock",
      "pubspec.lock", "Podfile.lock", "npm-shrinkwrap.json", "packages.lock.json", "Package.resolved",
      "gradle.lockfile", "services/api/poetry.lock",
    ]) expect([f, classify(f)]).toEqual([f, "generated"]);
  });

  test("common generated-source names are generated", () => {
    for (const f of ["src/api.generated.ts", "gen/user.pb.go", "proto/user_pb2.py", "proto/user_pb2_grpc.py", "lib/model.g.dart"]) {
      expect([f, classify(f)]).toEqual([f, "generated"]);
    }
  });

  test("a name that only resembles one stays what it was", () => {
    expect(classify("src/lock.ts")).toBe("source");
    expect(classify("src/vendor.ts")).toBe("source");
    expect(classify("src/generated_report.py")).toBe("source");
    expect(classify("docs/locking.md")).toBe("docs");
  });

  test("a mostly vendored change raises the generated-share flag", () => {
    const flags = gutCheck(compose([
      { path: "vendor/lib/big.go", added: 900, removed: 0, binary: false },
      { path: "src/main.go", added: 10, removed: 2, binary: false },
      { path: "src/main_test.go", added: 1, removed: 0, binary: false },
    ])).flags;
    expect(flags.some((f) => f.includes("generated or vendored"))).toBe(true);
  });
});

// AGENTS.md: "a test fixture must classify as `test` before the extension rules see it". The
// lockfile and generated-name rules are name rules, so they come after the test rules
// (flyingrobots/footprint#68). Generated directories (`dist/`, `node_modules/`, `vendor/`) still
// come first, as `node_modules/x/LICENSE` already does (test-plan row CO-7b).
describe("a test fixture stays a test however it is named (flyingrobots/footprint#68)", () => {
  test("a lockfile or a generated-looking name under a test path is test", () => {
    for (const f of [
      "test/fixtures/Gemfile.lock", "test/fixtures/package-lock.json", "tests/data/poetry.lock",
      "testdata/user.pb.go", "test/fixtures/api.generated.ts", "test/fixtures/user_pb2.py", "src/api.generated.test.ts",
    ]) expect([f, classify(f)]).toEqual([f, "test"]);
  });

  test("a generated directory under a test path is still generated", () => {
    for (const f of ["test/fixtures/vendor/lib.go", "test/fixtures/node_modules/x/index.js"]) expect([f, classify(f)]).toEqual([f, "generated"]);
  });
});
