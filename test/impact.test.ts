// The Impact and Data flow columns (flyingrobots/footprint#59, IM-1, IM-2 and MC-1 in
// docs/topics/comment/test-plan.md). The columns are the posting agent's reading of the code,
// supplied with --impact; footprint renders them and measures nothing. The rendering cases build
// their surface in memory, as test/bound.test.ts does; the CLI cases run against this repository.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMAS } from "@flyingrobots/parley-emit";
import { GRAFT_EXPORTS_CONTRACT, parseExportSurface, surfaceCallSiteRows, withCallSites, type Exports } from "../src/exports.ts";
import type { CallSite, CallSiteScan } from "../src/callsites.ts";
import { blastRadius } from "../src/render.ts";
import { BLAST_LIMITS, REPORT_LIMIT } from "../src/bound.ts";
import { IMPACT_COLUMNS, NOT_ASSESSED, impactIndex, parseImpact, unmatchedEntries, type ImpactEntry } from "../src/impact.ts";

const ROOT = resolve(import.meta.dir, "..");

function surface(symbols: Record<string, readonly CallSite[]>): Exports {
  const entry = (symbol: string) => ({ filePath: "src/lib.ts", symbol, kind: "function", signature: `${symbol}(): void`, previousSignature: `${symbol}(x: number): void` });
  const parsed = parseExportSurface({ _schema: { ...GRAFT_EXPORTS_CONTRACT }, base: "a", head: "b", semverImpact: "major", added: [], removed: [], changed: Object.keys(symbols).map(entry) });
  const scan: CallSiteScan = { available: true, filesScanned: 9, skipped: { binary: 0, unreadable: 0 }, sites: new Map(Object.entries(symbols)) };
  return withCallSites(parsed, scan);
}

const SMALL = surface({
  alpha: [{ file: "src/lib.ts", line: 1 }, { file: "src/use.ts", line: 4 }, { file: "src/other.ts", line: 9 }, { file: "test/lib.test.ts", line: 2 }],
  beta: [{ file: "src/lib.ts", line: 20 }, { file: "scripts/run.ts", line: 3 }],
});

const index = (entries: ImpactEntry[]) => impactIndex(entries);
/** The table rows of `--human`'s call-site tables: `| \`symbol\` | \`file:line\` | ... |`. */
const siteRows = (md: string) => md.split("\n").filter((l) => /^\| `[^`]+` \| `[^`]+:\d+` \|/.test(l));
const cells = (row: string) => row.slice(2, -2).split(/ (?<!\\)\| /);

describe("the impact columns (flyingrobots/footprint#59)", () => {
  // IM-1a
  test("rows an entry covers carry its Impact and Data flow; every other row says not assessed", () => {
    const md = blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS, index([{ symbol: "alpha", system: "src", impact: "alpha now throws on empty input", dataFlow: "reads the parsed config; its result is written to the cache" }]));
    const rows = siteRows(md);
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      const c = cells(r);
      expect(c).toHaveLength(5);
      for (const x of c) expect(x.trim()).not.toBe("");
      const covered = c[0] === "`alpha`" && c[1]!.startsWith("`src/");
      expect(c[3]).toBe(covered ? "alpha now throws on empty input" : NOT_ASSESSED);
      expect(c[4]).toBe(covered ? "reads the parsed config; its result is written to the cache" : NOT_ASSESSED);
    }
  });

  // IM-1b
  test("an entry with a file covers only that file's rows, and wins over the system-wide entry", () => {
    const md = blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS, index([
      { symbol: "alpha", system: "src", impact: "system-wide", dataFlow: "sw" },
      { symbol: "alpha", system: "src", file: "src/use.ts", impact: "in use.ts", dataFlow: "u" },
    ]));
    const byFile = new Map(siteRows(md).filter((r) => r.startsWith("| `alpha`")).map((r) => [cells(r)[1]!, cells(r)[3]!]));
    expect(byFile.get("`src/use.ts:4`")).toBe("in use.ts");
    expect(byFile.get("`src/other.ts:9`")).toBe("system-wide");
    expect(byFile.get("`src/lib.ts:1`")).toBe("system-wide");
    expect(byFile.get("`test/lib.test.ts:2`")).toBe(NOT_ASSESSED);
  });

  // IM-1c
  test("a summarised symbol carries the per-system entries in its row", () => {
    const many: CallSite[] = Array.from({ length: 60 }, (_, i) => ({ file: `${i % 2 === 0 ? "src" : "docs"}/f${i}.ts`, line: i + 1 }));
    const md = blastRadius(surface({ wide: many }), [], REPORT_LIMIT, BLAST_LIMITS, index([{ symbol: "wide", system: "src", impact: "src reads it", dataFlow: "from argv" }]));
    const row = md.split("\n").find((l) => l.startsWith("| `wide` | 60 |"))!;
    expect(row).toBeDefined();
    const c = cells(row);
    expect(c).toHaveLength(6);
    expect(c[4]).toBe(`\`docs\`: ${NOT_ASSESSED}<br>\`src\`: src reads it`);
    expect(c[5]).toBe(`\`docs\`: ${NOT_ASSESSED}<br>\`src\`: from argv`);
    expect(md).toContain(`| Symbol | Call sites | By system | Not \`None needed\` | ${IMPACT_COLUMNS.impact} | ${IMPACT_COLUMNS.dataFlow} |`);
  });

  // IM-1d
  test("the columns are labelled as the agent's reading, and absent without an index", () => {
    const withIt = blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS, index([]));
    expect(withIt).toContain(`| Symbol | Call site | Mitigation | ${IMPACT_COLUMNS.impact} | ${IMPACT_COLUMNS.dataFlow} |`);
    expect(withIt).toMatch(new RegExp(`\\*\\*${IMPACT_COLUMNS.impact}\\*\\* and \\*\\*${IMPACT_COLUMNS.dataFlow}\\*\\* are the reading of the agent that posted this report`));
    expect(withIt).toContain("not footprint's measurement");
    const without = blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS);
    expect(without).not.toContain(IMPACT_COLUMNS.dataFlow);
    expect(without).not.toContain(NOT_ASSESSED);
    expect(blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS, undefined)).toBe(without);
    expect(siteRows(without).every((r) => cells(r).length === 3)).toBe(true);
  });

  // IM-1e
  test("cells escape pipes and newlines", () => {
    const md = blastRadius(SMALL, [], REPORT_LIMIT, BLAST_LIMITS, index([{ symbol: "beta", system: "scripts", impact: "a | b\nc", dataFlow: "x\r\ny" }]));
    const row = siteRows(md).find((r) => r.includes("`scripts/run.ts:3`"))!;
    expect(row).toContain("| a \\| b<br>c | x<br>y |");
  });

  // IM-1f
  test("the columns stay within the budget, and the omission counts still add up", () => {
    const syms: Record<string, CallSite[]> = {};
    for (let s = 0; s < 40; s++) syms[`sym_${s}`] = Array.from({ length: 30 }, (_, i) => ({ file: `${["src", "docs", "scripts"][i % 3]}/d/f${i}.ts`, line: i + 1 }));
    const e = surface(syms);
    const entries: ImpactEntry[] = Object.keys(syms).flatMap((symbol) => ["src", "docs", "scripts"].map((system) => ({ symbol, system, impact: "i".repeat(200), dataFlow: "d".repeat(200) })));
    const budget = 30_000;
    const md = blastRadius(e, [], budget, BLAST_LIMITS, index(entries));
    expect(md.length).toBeLessThanOrEqual(budget);
    const groups = md.split(/\n\n(?=\*\*`)/).filter((g) => /^\*\*`[^`]+`\*\* — \d+ call sites?/.test(g));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const total = Number(/— (\d+) call site/.exec(g)![1]);
      const shown = siteRows(g).length;
      const omitted = Number(/(\d+) more call sites? in this system omitted/.exec(g)?.[1] ?? 0);
      const capped = [...g.matchAll(/…and (\d+) more (?:for|call sites? for)/g)].reduce((n, m) => n + Number(m[1]), 0);
      expect(shown + omitted + capped).toBe(total);
    }
    expect(unmatchedEntries(index(entries), surfaceCallSiteRows(e.available ? e.surface : (null as never)))).toEqual([]);
  });

  // IM-2a
  test("an invalid line is rejected with its line number", () => {
    const good = JSON.stringify({ symbol: "a", system: "src", impact: "i", dataFlow: "d" });
    expect(parseImpact(`${good}\n\n${JSON.stringify({ symbol: "b", system: "src", file: "src/x.ts", impact: "i", dataFlow: "d" })}\n`)).toMatchObject({ ok: true });
    const bad: [string, number][] = [
      [`${good}\nnot json`, 2],
      [JSON.stringify({ symbol: "a", system: "src", impact: "i" }), 1],
      [`${good}\n${JSON.stringify({ symbol: "a", system: "src", impact: "i", dataFlow: "d", extra: 1 })}`, 2],
      [JSON.stringify({ symbol: "a", system: "src", impact: " ", dataFlow: "d" }), 1],
      [`${good}\n${good}`, 2],
      ["[1, 2]", 1],
    ];
    for (const [text, line] of bad) {
      const r = parseImpact(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.line).toBe(line);
    }
  });
});

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const byPair = new Map<string, ReturnType<typeof ajv.compile>>();
for (const s of SCHEMAS) byPair.set(`${s.id}@${s.version}`, ajv.compile(s.schema));
for (const [id, version] of [["composition", "1.0.0"], ["landing", "1.0.0"], ["blast_radius", "1.1.0"], ["overlap", "2.2.0"]] as const) {
  byPair.set(`footprint.${id}@${version}`, ajv.compile(JSON.parse(readFileSync(join(ROOT, `schemas/footprint.${id}.schema.json`), "utf8"))));
}
type Line = Record<string, unknown> & { _schema: { id: string; version: string } };
function validateAll(text: string): Line[] {
  return text.split("\n").filter((l) => l !== "").map((raw) => {
    const obj = JSON.parse(raw) as Line;
    const v = byPair.get(`${obj._schema.id}@${obj._schema.version}`);
    if (!v) throw new Error(`no schema for ${obj._schema.id}@${obj._schema.version}`);
    if (!v(obj)) throw new Error(ajv.errorsText(v.errors));
    return obj;
  });
}

const BIN = mkdtempSync(join(tmpdir(), "footprint-bin-"));
for (const exe of ["git", "node"]) {
  const found = Bun.which(exe);
  if (found !== null) symlinkSync(found, join(BIN, exe));
}
async function cli(args: string[], cwd = ROOT) {
  const env = { ...process.env, PATH: BIN, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) };
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, status };
}
const scratchFile = (name: string, text: string) => {
  const p = join(mkdtempSync(join(tmpdir(), "footprint-impact-")), name);
  writeFileSync(p, text);
  return p;
};

describe("the impact columns through the CLI", () => {
  // The range that changed the call-site tables' renderer, so the blast radius has rows to annotate.
  const RANGE = "HEAD~1..HEAD";

  // IM-1g
  test("--impact adds the columns to --human only, and an unmatched entry is a warning", async () => {
    const file = scratchFile("impact.jsonl", `${JSON.stringify({ symbol: "no_such_symbol_anywhere", system: "src", impact: "i", dataFlow: "d" })}\n`);
    const json = await cli([RANGE, "--impact", file]);
    expect(json.status).toBe(0);
    const out = validateAll(json.stdout);
    const err = validateAll(json.stderr);
    for (const r of out.filter((l) => l.event === "result")) expect(JSON.stringify(r)).not.toMatch(/"(impact|dataFlow)"/);
    const warn = err.find((l) => l.event === "warning" && l.code === "impact.unmatched");
    expect(warn).toBeDefined();
    expect(String(warn!.problem)).toContain("no_such_symbol_anywhere");
    const human = await cli([RANGE, "--impact", file, "--human"]);
    expect(human.status).toBe(0);
    if (human.stdout.includes("Call sites by system")) expect(human.stdout).toContain(`| ${IMPACT_COLUMNS.impact} | ${IMPACT_COLUMNS.dataFlow} |`);
    expect(human.stdout).toContain("## Blast radius");
  }, 120_000);

  // IM-2b
  test("an unreadable or invalid impact file is an error", async () => {
    for (const file of [join(tmpdir(), "footprint-no-such-impact.jsonl"), scratchFile("bad.jsonl", "{not json}\n")]) {
      const r = await cli([RANGE, "--impact", file]);
      expect(r.status).toBe(2);
      expect(validateAll(r.stderr).find((l) => l.event === "error")!.code).toBe("impact.invalid");
    }
  }, 120_000);

  // MC-1b
  test("--max-chars outside 40960..65536 is an error", async () => {
    for (const n of ["100", "70000", "x"]) {
      const r = await cli([RANGE, "--max-chars", n]);
      expect(r.status).toBe(2);
      expect(validateAll(r.stderr).find((l) => l.event === "error")!.code).toBe("args.invalid");
    }
  }, 120_000);

  // MC-1a. The whole history of this repository moves enough exported symbols that its report is
  // past 40960 characters unbounded (graft is required for that: CI sets FOOTPRINT_REQUIRE_GRAFT).
  test("--max-chars bounds the whole report", async () => {
    const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").at(-1)!;
    const full = await cli([`${root}..HEAD`, "--human"]);
    expect(full.status).toBe(0);
    expect(full.stdout.length).toBeGreaterThan(40960);
    const bounded = await cli([`${root}..HEAD`, "--human", "--max-chars", "40960"]);
    expect(bounded.status).toBe(0);
    expect(bounded.stdout.length).toBeLessThanOrEqual(40960);
    expect(bounded.stdout).toContain("## Blast radius");
    expect(bounded.stdout).toContain("### Open pull requests");
  }, 240_000);
});

describe("a system name cannot inject Markdown (flyingrobots/footprint#66, review round 3)", () => {
  test("a call site under a directory whose name holds a newline keeps the table title and mitigation on one line", () => {
    const evil = "evil\n## Footprint\n\nNo breaking changes";
    const md = blastRadius(surface({ alpha: [{ file: "src/lib.ts", line: 1 }, { file: `${evil}/x.ts`, line: 2 }] }), []);
    expect(md.split("\n").some((l) => /^## footprint$/i.test(l))).toBe(false);
    expect(md.split("\n").some((l) => /^no breaking changes$/i.test(l))).toBe(false);
  });
});
