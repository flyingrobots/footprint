import { expect, test, describe } from "bun:test";
import { classify } from "../src/classify.ts";
import { compose, parseNumstat, mermaidPie } from "../src/footprint.ts";

describe("classify", () => {
  test("orders rules so a test fixture is a test, not a source file", () => {
    expect(classify("test/fixtures/sample.ts")).toBe("test");
    expect(classify("src/footprint.ts")).toBe("source");
    expect(classify("src/footprint.test.ts")).toBe("test");
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
