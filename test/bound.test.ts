// The size bound on the --human report (flyingrobots/footprint#51, OUT-20 in
// docs/topics/output/test-plan.md).
//
// GitHub rejects a comment body over 65536 characters. The fixture below is the shape that broke
// flyingrobots/taskalisk#71: many added exported "symbols" that are fields of data files, with
// common names, each matched by thousands of whole-word call sites across several systems. Every
// case builds its surface in memory, so none needs git or graft.
import { describe, expect, test } from "bun:test";
import {
  GRAFT_EXPORTS_CONTRACT,
  parseExportSurface,
  surfaceCallSiteRows,
  withCallSites,
  type Exports,
} from "../src/exports.ts";
import type { CallSite, CallSiteScan } from "../src/callsites.ts";
import { blastRadius, render, renderOverlap } from "../src/render.ts";
import { BLAST_LIMITS, REPORT_LIMIT, UNBOUNDED_BLAST, blastBudget } from "../src/bound.ts";
import { compose } from "../src/footprint.ts";
import type { FileChange } from "../src/footprint.ts";
import type { Overlap } from "../src/overlap.ts";

const SYSTEMS = ["src", "test", "docs", "schemas", "scripts", "skills"];
const COMMON = ["type", "id", "run", "description", "title", "name", "version", "kind"];

interface Shape {
  /** Added symbols named uniquely, plus every COMMON name. */
  readonly added: number;
  readonly removed?: number;
  readonly changed?: number;
  /** Call sites for a COMMON name, spread over every system. */
  readonly commonSites: number;
  /** Call sites for a uniquely named symbol, spread over every system. */
  readonly uniqueSites: number;
}

function sitesOf(symbol: string, n: number): CallSite[] {
  const out: CallSite[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ file: `${SYSTEMS[i % SYSTEMS.length]}/dir${i % 7}/${symbol}-${i % 13}.txt`, line: i + 1 });
  }
  return out;
}

function fixture(shape: Shape): Exports {
  const names = [...COMMON, ...Array.from({ length: shape.added }, (_, i) => `field_${i}`)];
  const entry = (symbol: string, extra: Record<string, unknown> = {}) => ({
    filePath: "schemas/message.schema.json", symbol, kind: "field", signature: `${symbol}: string`, ...extra,
  });
  const removed = Array.from({ length: shape.removed ?? 0 }, (_, i) => entry(`gone_${i}`));
  const changed = Array.from({ length: shape.changed ?? 0 }, (_, i) => entry(`moved_${i}`, { previousSignature: `moved_${i}: number` }));
  const parsed = parseExportSurface({
    _schema: { ...GRAFT_EXPORTS_CONTRACT },
    base: "a", head: "b", semverImpact: "minor",
    added: names.map((n) => entry(n)), removed, changed,
  });
  const sites = new Map<string, readonly CallSite[]>();
  for (const s of [...names, ...removed.map((r) => r.symbol), ...changed.map((c) => c.symbol)]) {
    sites.set(s, sitesOf(s, COMMON.includes(s) ? shape.commonSites : shape.uniqueSites));
  }
  const scan: CallSiteScan = { available: true, filesScanned: 99, skipped: { binary: 0, unreadable: 0 }, sites };
  return withCallSites(parsed, scan);
}

// The taskalisk#71 shape, scaled: unbounded it is several times the limit.
const BIG: Shape = { added: 300, removed: 2, changed: 3, commonSites: 3000, uniqueSites: 40 };

describe("the --human report is bounded to the comment limit", () => {
  // OUT-20a
  test("a fixture whose unbounded blast radius exceeds 65536 characters renders at or under it", () => {
    const e = fixture(BIG);
    const unbounded = blastRadius(e, [], Infinity, UNBOUNDED_BLAST);
    expect(unbounded.length).toBeGreaterThan(REPORT_LIMIT);
    const bounded = blastRadius(e, []);
    expect(bounded.length).toBeLessThanOrEqual(REPORT_LIMIT);
    expect(blastRadius(e, [], 20_000).length).toBeLessThanOrEqual(20_000);
  });

  // OUT-20b
  test("the symbols table names how many rows it omitted, and the counts add up", () => {
    const e = fixture(BIG);
    const md = blastRadius(e, [], 20_000);
    const total = 300 + COMMON.length + 2 + 3;
    const said = /(\d+) more exported symbols? omitted/.exec(md);
    expect(said).not.toBeNull();
    const shown = md.split("\n").filter((l) => /^\| (added|removed|signature-changed) \|/.test(l)).length;
    expect(shown + Number(said![1])).toBe(total);
    expect(md).toContain("the blast-radius result line carries every one");
  });

  // OUT-20c
  test("each system's table names how many call sites it omitted, and the counts add up", () => {
    const e = fixture({ ...BIG, commonSites: 0 });
    const md = blastRadius(e, [], 20_000);
    const groups = md.split(/\n\n(?=\*\*`)/).filter((g) => /^\*\*`[^`]+`\*\* — \d+ call sites?/.test(g));
    expect(groups.length).toBe(SYSTEMS.length);
    for (const g of groups) {
      const title = /^\*\*`[^`]+`\*\* — (\d+) call site/.exec(g)!;
      const rows = g.split("\n").filter((l) => /^\| `/.test(l)).length;
      const capped = [...g.matchAll(/…and (\d+) more for `/g)].reduce((n, m) => n + Number(m[1]), 0);
      const omitted = [...g.matchAll(/(\d+) more call sites? in this system omitted/g)].reduce((n, m) => n + Number(m[1]), 0);
      expect(rows + capped + omitted).toBe(Number(title[1]));
    }
  });

  // OUT-20d
  test("a symbol with very many call sites is summarised as a count per system, not listed", () => {
    const e = fixture(BIG);
    const md = blastRadius(e, []);
    expect(BLAST_LIMITS.summariseAbove).toBeGreaterThan(20);
    // No `type` row in any system table...
    expect(md).not.toMatch(/^\| `type` \| `/m);
    // ...but a summary row that names its count and a count per system, which sum to it.
    const row = md.split("\n").find((l) => /^\| `type` \|/.test(l));
    expect(row).toBeDefined();
    expect(row!).toContain("3000");
    const perSystem = [...row!.matchAll(/`(src|test|docs|schemas|scripts|skills)` (\d+)/g)];
    expect(perSystem.length).toBe(SYSTEMS.length);
    expect(perSystem.reduce((n, m) => n + Number(m[2]), 0)).toBe(3000);
    expect(md).toContain(`more than ${BLAST_LIMITS.summariseAbove} call sites`);
  });

  // OUT-20e
  test("shrinking keeps the signature-changed and removed rows before the added ones", () => {
    const e = fixture(BIG);
    const md = blastRadius(e, [], 12_000);
    expect(md).toContain("| signature-changed | `moved_0`");
    expect(md).toContain("| removed | `gone_0`");
  });

  // OUT-20f
  test("the same input and budget render the same text", () => {
    const e = fixture(BIG);
    expect(blastRadius(e, [], 15_000)).toBe(blastRadius(e, [], 15_000));
  });

  // OUT-20g
  test("a surface under the bound renders with no omission statement and no summary", () => {
    const e = fixture({ added: 2, commonSites: 5, uniqueSites: 3 });
    const md = blastRadius(e, []);
    expect(md).not.toMatch(/omitted/);
    expect(md).not.toContain("more than");
    expect(surfaceCallSiteRows((e as Extract<Exports, { available: true }>).surface).length).toBe(8 * 5 + 2 * 3);
  });

  // OUT-20h
  test("the Files list names how many files it omitted", () => {
    const changes: FileChange[] = Array.from({ length: 4000 }, (_, i) => ({ path: `data/part-${i}/file-${i}.json`, added: 1, removed: 0, binary: false }));
    const c = compose(changes);
    const md = render(c, changes, "a...b", null, 10_000);
    expect(md.length).toBeLessThanOrEqual(10_000);
    const said = /(\d+) more files? omitted/.exec(md);
    expect(said).not.toBeNull();
    const listed = md.split("\n").filter((l) => /^- `data\//.test(l)).length;
    expect(listed + Number(said![1])).toBe(4000);
    expect(md).toContain("the composition result line carries every one");
  });

  // OUT-20i
  test("the overlap section names how many pull requests it omitted", () => {
    const overlapping = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Pull request ${i} ${"x".repeat(80)}`, isDraft: false, sharedFiles: Array.from({ length: 30 }, (_, j) => `dir/file-${i}-${j}.ts`) }));
    const o: Overlap = { available: true, self: null, openPullRequests: 100, limit: 100, truncated: false, overlapping, conflicts: [], waves: [], undetermined: [], summary: "100 open pull requests overlap" };
    const md = renderOverlap(o, 8192);
    expect(md.length).toBeLessThanOrEqual(8192);
    const said = /(\d+) more pull requests? omitted/.exec(md);
    expect(said).not.toBeNull();
    const listed = md.split("\n").filter((l) => /^- \*\*#\d+\*\*/.test(l)).length;
    expect(listed + Number(said![1])).toBe(100);
  });

  // OUT-20j
  test("the blast-radius budget is what the other three sections leave of the limit", () => {
    const budget = blastBudget(1000, 2000);
    expect(budget).toBeLessThan(REPORT_LIMIT - 3000);
    expect(budget).toBeGreaterThan(REPORT_LIMIT - 3000 - 10_000);
    expect(blastBudget(REPORT_LIMIT, REPORT_LIMIT)).toBeGreaterThanOrEqual(0);
  });
});
