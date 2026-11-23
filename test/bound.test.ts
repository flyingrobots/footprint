// The size bound on the --human report (flyingrobots/footprint#51, OUT-21 in
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
import { blastRadius, render, renderLanding, renderOverlap } from "../src/render.ts";
import { BLAST_LIMITS, LANDING_BUDGET, REPORT_LIMIT, UNBOUNDED_BLAST, blastBudget, clamp } from "../src/bound.ts";
import { compose } from "../src/footprint.ts";
import type { FileChange } from "../src/footprint.ts";
import type { Overlap } from "../src/overlap.ts";
import { undeterminedLevel } from "../src/symbols.ts";
import type { Landing } from "../src/landing.ts";
import type { StructuralReview } from "../src/graft.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  /** How many systems the sites spread over; every one by default. */
  readonly systems?: number;
}

function sitesOf(symbol: string, n: number, systems = SYSTEMS.length): CallSite[] {
  const out: CallSite[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ file: `${SYSTEMS[i % systems]}/dir${i % 7}/${symbol}-${i % 13}.txt`, line: i + 1 });
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
    sites.set(s, sitesOf(s, COMMON.includes(s) ? shape.commonSites : shape.uniqueSites, shape.systems));
  }
  const scan: CallSiteScan = { available: true, filesScanned: 99, skipped: { binary: 0, unreadable: 0 }, sites };
  return withCallSites(parsed, scan);
}

// The taskalisk#71 shape, scaled: unbounded it is several times the limit.
const BIG: Shape = { added: 300, removed: 2, changed: 3, commonSites: 3000, uniqueSites: 40 };

describe("the --human report is bounded to the comment limit", () => {
  // OUT-21a
  test("a fixture whose unbounded blast radius exceeds 65536 characters renders at or under it", () => {
    const e = fixture(BIG);
    const unbounded = blastRadius(e, [], Infinity, UNBOUNDED_BLAST);
    expect(unbounded.length).toBeGreaterThan(REPORT_LIMIT);
    const bounded = blastRadius(e, []);
    expect(bounded.length).toBeLessThanOrEqual(REPORT_LIMIT);
    expect(blastRadius(e, [], 20_000).length).toBeLessThanOrEqual(20_000);
  });

  // OUT-21b
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

  // OUT-21c
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

  // OUT-21d
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

  // OUT-21e
  test("shrinking keeps the signature-changed and removed rows before the added ones", () => {
    const e = fixture(BIG);
    const md = blastRadius(e, [], 12_000);
    expect(md).toContain("| signature-changed | `moved_0`");
    expect(md).toContain("| removed | `gone_0`");
  });

  // OUT-21f
  test("the same input and budget render the same text", () => {
    const e = fixture(BIG);
    expect(blastRadius(e, [], 15_000)).toBe(blastRadius(e, [], 15_000));
  });

  // OUT-21g
  test("a surface under the bound renders with no omission statement and no summary", () => {
    const e = fixture({ added: 2, commonSites: 5, uniqueSites: 3 });
    const md = blastRadius(e, []);
    expect(md).not.toMatch(/omitted/);
    expect(md).not.toContain("more than");
    expect(surfaceCallSiteRows((e as Extract<Exports, { available: true }>).surface).length).toBe(8 * 5 + 2 * 3);
  });

  // OUT-21h
  test("the Files list names how many files it omitted", () => {
    const changes: FileChange[] = Array.from({ length: 4000 }, (_, i) => ({ path: `data/part-${i}/file-${i}.json`, added: 1, removed: 0, binary: false }));
    const c = compose(changes);
    const md = render(c, changes, "a...b", null, 10_000);
    expect(md.length).toBeLessThanOrEqual(10_000);
    const said = /(\d+) more files? omitted/.exec(md);
    expect(said).not.toBeNull();
    const listed = md.split("\n").filter((l) => /^- `data\//.test(l)).length;
    expect(listed + Number(said![1])).toBe(4000);
    expect(md).toContain("the `files` field of the receipt carries every one");
  });

  // OUT-21i
  test("the overlap section names how many pull requests it omitted", () => {
    const overlapping = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Pull request ${i} ${"x".repeat(80)}`, isDraft: false, sharedFiles: Array.from({ length: 30 }, (_, j) => `dir/file-${i}-${j}.ts`) })).map((p) => ({ ...p, symbolLevel: undeterminedLevel(p.sharedFiles, "symbols.not_analysed", "symbol-level analysis was not run") }));
    const o: Overlap = { available: true, self: null, openPullRequests: 100, limit: 100, truncated: false, overlapping, conflicts: [], waves: [], undetermined: [], symbolAnalysis: { outlinesRun: 0, outlineBudget: 0, outlineTimeoutMs: 0 }, summary: "100 open pull requests overlap" };
    const md = renderOverlap(o, 8192);
    expect(md.length).toBeLessThanOrEqual(8192);
    const said = /(\d+) more pull requests? omitted/.exec(md);
    expect(said).not.toBeNull();
    const listed = md.split("\n").filter((l) => /^- \*\*#\d+\*\*/.test(l)).length;
    expect(listed + Number(said![1])).toBe(100);
  });

  // OUT-21j
  test("the blast-radius budget is what the other three sections leave of the limit", () => {
    const budget = blastBudget(1000, 2000);
    expect(budget).toBeLessThan(REPORT_LIMIT - 3000);
    expect(budget).toBeGreaterThan(REPORT_LIMIT - 3000 - 10_000);
    expect(blastBudget(REPORT_LIMIT, REPORT_LIMIT)).toBeGreaterThanOrEqual(0);
  });

  // OUT-21l
  test("formatting-labelled paths are bounded and counted too", () => {
    const changes: FileChange[] = [{ path: "a.ts", added: 1, removed: 0, binary: false }];
    const review: StructuralReview = {
      breakingChanges: [],
      files: Array.from({ length: 2500 }, (_, i) => ({ path: `some/long/directory/name/formatting-only-${i}.json`, category: "formatting" })),
    } as unknown as StructuralReview;
    const md = render(compose(changes), changes, "a...b", review, 16_384);
    expect(md.length).toBeLessThanOrEqual(16_384);
    const said = /(\d+) more formatting-labelled files? omitted/.exec(md);
    expect(said).not.toBeNull();
    const listed = (md.match(/formatting-only-\d+\.json/g) ?? []).length;
    expect(listed + Number(said![1])).toBe(2500);
  });

  // OUT-21m
  test("per-symbol remainder notes are aggregated once there are many, and the count is kept", () => {
    // 3000 symbols with 30 call sites each, all in one system: none is summarised, each is capped at 20.
    const e = fixture({ added: 3000, commonSites: 0, uniqueSites: 30, systems: 1 });
    const md = blastRadius(e, [], 40_000);
    expect(md.length).toBeLessThanOrEqual(40_000);
    const title = /\*\*`src`\*\* — (\d+) call sites/.exec(md)!;
    const rows = md.split("\n").filter((l) => /^\| `field_\d+` \| `src\//.test(l)).length;
    const noted = [...md.matchAll(/…and (\d+) more for `/g)].reduce((n, m) => n + Number(m[1]), 0);
    const aggregated = [...md.matchAll(/…and (\d+) more call sites for (\d+) more symbols/g)].reduce((n, m) => n + Number(m[1]), 0);
    const omitted = [...md.matchAll(/(\d+) more call sites? in this system omitted/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(aggregated).toBeGreaterThan(0);
    expect(rows + noted + aggregated + omitted).toBe(Number(title[1]));
  });

  // OUT-21n
  test("the landing section is bounded, counts the steps it omitted and says where to read them", () => {
    const steps = Array.from({ length: 3000 }, (_, i) => ({ step: `Do step number ${i} ${"x".repeat(60)}`, file: "RELEASE.md", heading: "After merge" }));
    const landing: Landing = {
      before_merge: { items: [], guards: [], unguarded: false, unguarded_because: "A guard was found." },
      after_merge: { read: [], steps, declared: true, nothing_to_do: false, statement: "3000 steps" },
    };
    const md = renderLanding(landing, LANDING_BUDGET);
    expect(md.length).toBeLessThanOrEqual(LANDING_BUDGET);
    const said = /(\d+) more steps? omitted/.exec(md);
    expect(said).not.toBeNull();
    expect(md.split("\n").filter((l) => l.startsWith("- [ ]")).length + Number(said![1])).toBe(3000);
    expect(md).toContain("RELEASE.md");
  });

  // OUT-21o
  test("the last resort cuts any text to the bound, closes what it opened and states what it cut", () => {
    const text = `## S\n\n<details>\n<summary>x</summary>\n\n${"a line of text\n".repeat(5000)}\n</details>`;
    const out = clamp(text, 2000, "the composition section");
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toMatch(/\d+ characters? of the composition section omitted/);
    expect((out.match(/<details>/g) ?? []).length).toBe((out.match(/<\/details>/g) ?? []).length);
    expect(clamp("short", 2000, "x")).toBe("short");
    expect(clamp("z".repeat(10), 3, "x").length).toBeLessThanOrEqual(3);
  });

  // OUT-21p
  test("the whole report from the CLI on an oversized fixture is at most 65536 characters", () => {
    const repo = mkdtempSync(join(tmpdir(), "footprint-bound-"));
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "x\n");
    git("add", "-A"); git("commit", "-q", "-m", "base");
    mkdirSync(join(repo, "data"));
    for (let i = 0; i < 3000; i++) writeFileSync(join(repo, "data", `a-fairly-long-file-name-${i}.dat`), "x\n");
    const steps = Array.from({ length: 1500 }, (_, i) => `- [ ] Step ${i} ${"y".repeat(50)}`).join("\n");
    writeFileSync(join(repo, "RELEASE.md"), `# Releasing\n\n## After merge\n\n${steps}\n`);
    git("add", "-A"); git("commit", "-q", "-m", "head");
    const bin = mkdtempSync(join(tmpdir(), "footprint-bin-"));
    const out = execFileSync(process.execPath, [resolve(import.meta.dir, "../src/cli.ts"), "HEAD~1..HEAD", "--human"], {
      cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${dirname(Bun.which("git")!)}`, XDG_STATE_HOME: bin, FOOTPRINT_GRAFT: "/nonexistent/graft" },
    });
    expect(out.length).toBeLessThanOrEqual(REPORT_LIMIT);
    expect(out).toMatch(/\d+ more files? omitted/);
    expect(out).toMatch(/\d+ more steps? omitted/);
    expect(out).toContain("## Blast radius");
  }, 120_000);
});
