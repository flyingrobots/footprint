// The system a call site lives in, and the mitigation its row carries
// (flyingrobots/footprint#11, OUT-14 in docs/topics/output/test-plan.md).
//
// Two pure functions over paths, so almost every case here needs neither git nor graft. The one
// live case is OUT-14e: it scans this repository for the symbols of the real signature change at
// 543477a and holds every mitigation it produces to an allowlist of forms this file declares for
// itself, so a padded mitigation written into `src/` cannot pass by agreeing with `src/`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  MITIGATION_RULE,
  NONE_NEEDED,
  SYSTEM_RULE,
  SYSTEM_RULE_DETAIL,
  UNASSIGNED_SYSTEM,
  assignCallSite,
  groupBySystem,
  mitigationBasis,
  mitigationFor,
  systemCounts,
  systemOf,
} from "../src/systems.ts";
import {
  BLAST_RADIUS_SCHEMA,
  BLAST_RADIUS_TYPE,
  exportsRecord,
  parseExportSurfaceText,
  surfaceCallSiteRows,
  surfaceSymbols,
  withCallSites,
  type Exports,
} from "../src/exports.ts";
import { scanCallSites, type CallSite, type CallSiteScan } from "../src/callsites.ts";
import { blastRadius } from "../src/render.ts";

const ROOT = resolve(import.meta.dir, "..");
const SIGNATURE_CHANGE = readFileSync(join(ROOT, "test/fixtures/graft.struct_exports.signature_change.json"), "utf8");

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(BLAST_RADIUS_SCHEMA);

function enveloped(record: Record<string, unknown>) {
  return { ...record, t: 1, seq: 2, run: "01JTESTTESTTESTTESTTESTTEST", _schema: BLAST_RADIUS_TYPE };
}

function available(e: Exports) {
  if (!e.available) throw new Error(`expected an available export surface, got ${e.reason.code}: ${e.reason.detail}`);
  return e.surface;
}

/** A scan over a fixed site map: the symbols of the signature-change fixture, nothing read. */
function scanOf(sites: Record<string, readonly CallSite[]>): CallSiteScan {
  return {
    available: true,
    filesScanned: 12,
    skipped: { binary: 0, unreadable: 0 },
    sites: new Map<string, readonly CallSite[]>(Object.entries(sites)),
  };
}

/** Every symbol of the fixture gets a key, so no symbol is silently absent from the scan. */
function fullScan(sites: Record<string, readonly CallSite[]>): CallSiteScan {
  const surface = available(parseExportSurfaceText(SIGNATURE_CHANGE));
  const all: Record<string, readonly CallSite[]> = {};
  for (const s of surfaceSymbols(surface)) all[s.symbol] = sites[s.symbol] ?? [];
  return scanOf(all);
}

function exportsOf(sites: Record<string, readonly CallSite[]>): Exports {
  return withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), fullScan(sites));
}

function grouping(e: Exports): Record<string, unknown> {
  const line = enveloped(exportsRecord("origin/main...HEAD", e, [])) as Record<string, unknown>;
  if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
  const ex = (line as { exports: Record<string, unknown> }).exports;
  return ex.call_site_systems as Record<string, unknown>;
}

function wireSites(e: Exports): Array<Record<string, unknown>> {
  const line = enveloped(exportsRecord("origin/main...HEAD", e, [])) as Record<string, unknown>;
  const ex = (line as { exports: Record<string, unknown> }).exports;
  const out: Array<Record<string, unknown>> = [];
  for (const key of ["added", "removed", "signature_changed"]) {
    for (const s of ex[key] as Array<Record<string, unknown>>) {
      for (const site of (s.call_sites ?? []) as Array<Record<string, unknown>>) out.push(site);
    }
  }
  return out;
}

// ---- the grouping rule -------------------------------------------------------------------------

describe("the system a call site lives in is its first path segment", () => {
  // OUT-14k
  test("the rule, the label and the mitigation forms are the ones the schema and the docs name", () => {
    expect(SYSTEM_RULE).toBe("path_prefix");
    expect(UNASSIGNED_SYSTEM).toBe("(unassigned)");
    expect(NONE_NEEDED).toBe("None needed");

    const text = readFileSync(join(ROOT, "schemas/footprint.blast_radius.schema.json"), "utf8");
    expect(text).toContain(SYSTEM_RULE);
    expect(text).toContain(UNASSIGNED_SYSTEM);
    expect(text).toContain(NONE_NEEDED);

    const reference = readFileSync(join(ROOT, "docs/topics/blast-radius/README.md"), "utf8");
    expect(reference).toContain(UNASSIGNED_SYSTEM);
    expect(reference).toContain(NONE_NEEDED);
    expect(reference).toContain(SYSTEM_RULE);
    // The rule and the derivation are stated once, in the code, and quoted on the record.
    expect(SYSTEM_RULE_DETAIL.length).toBeGreaterThan(40);
    expect(MITIGATION_RULE.length).toBeGreaterThan(40);
  });

  test("a path under a directory belongs to that directory, however deep", () => {
    expect(systemOf("src/render.ts")).toBe("src");
    expect(systemOf("src/nested/deep/thing.ts")).toBe("src");
    expect(systemOf("test/cli.test.ts")).toBe("test");
    expect(systemOf(".github/workflows/ci.yml")).toBe(".github");
    expect(systemOf("docs/topics/output/README.md")).toBe("docs");
  });

  // OUT-14c, the rule's half of it: a root file belongs to no system.
  test("a file at the repository root belongs to no system", () => {
    expect(systemOf("package.json")).toBe(UNASSIGNED_SYSTEM);
    expect(systemOf("CHANGELOG.md")).toBe(UNASSIGNED_SYSTEM);
    expect(systemOf("")).toBe(UNASSIGNED_SYSTEM);
  });
});

// ---- the mitigation derivation -----------------------------------------------------------------

describe("a mitigation is derived from two reported facts and nothing else", () => {
  // OUT-14d: the whole derivation, over both facts it reads.
  test("the four bases are the declaring file, a test file, another system, and no system", () => {
    const declared = "src/render.ts";
    const cases: Array<[string, string, string]> = [
      [declared, "declaring_file", NONE_NEEDED],
      ["test/cli.test.ts", "test_file", NONE_NEEDED],
      ["src/cli.ts", "other_system", "Call site in src, outside the changed file."],
      ["CHANGELOG.md", "unassigned", "Call site outside every known system, outside the changed file."],
    ];
    for (const [file, basis, text] of cases) {
      const site = assignCallSite(declared, { file, line: 3 });
      expect(mitigationBasis(declared, file)).toBe(basis);
      expect(site.mitigationBasis).toBe(basis);
      expect(site.mitigation).toBe(text);
      expect(site.file).toBe(file);
      expect(site.line).toBe(3);
    }
  });

  test("the declaring file wins over the system it sits in, and a test file over its own", () => {
    // A symbol declared in a test file: the same file is still `declaring_file`, not `test_file`.
    expect(mitigationBasis("test/helper.ts", "test/helper.ts")).toBe("declaring_file");
    // A test fixture is a test file by `classify()`, wherever it lives.
    expect(mitigationBasis("src/render.ts", "test/fixtures/x.json")).toBe("test_file");
    // A root file that is a test file is `None needed`, not `unassigned`.
    expect(mitigationFor(mitigationBasis("src/render.ts", "cli.test.ts"), UNASSIGNED_SYSTEM)).toBe(NONE_NEEDED);
  });

  test("the mitigation of a row in another system names that system and nothing more", () => {
    expect(mitigationFor("other_system", "docs")).toBe("Call site in docs, outside the changed file.");
    expect(mitigationFor("other_system", ".github")).toBe("Call site in .github, outside the changed file.");
  });
});

// ---- the grouping itself -----------------------------------------------------------------------

describe("call sites are grouped by system, one group per system", () => {
  // OUT-14a
  test("two systems are two groups, in order, each carrying its own call sites", () => {
    const e = exportsOf({
      render: [{ file: "src/cli.ts", line: 7 }, { file: "test/cli.test.ts", line: 90 }],
      resolveGraft: [{ file: "src/cli.ts", line: 9 }],
    });
    const groups = groupBySystem(surfaceCallSiteRows(available(e)));
    expect(groups.map((g) => g.system)).toEqual(["src", "test"]);
    expect(groups[0]!.rows.map((r) => `${r.symbol} ${r.site.file}:${r.site.line}`)).toEqual([
      "render src/cli.ts:7",
      "resolveGraft src/cli.ts:9",
    ]);
    expect(groups[1]!.rows.map((r) => r.site.file)).toEqual(["test/cli.test.ts"]);

    const md = blastRadius(e, []);
    const tables = md.split("\n").filter((l) => l.startsWith("| --- |"));
    // One table for the symbol list, and one per system.
    expect(tables.length).toBe(3);
    expect(md).toContain("`src`");
    expect(md).toContain("`test`");
  });

  // OUT-14b
  test("one system is still one named group and one table, not a flat list", () => {
    const e = exportsOf({ render: [{ file: "src/cli.ts", line: 7 }, { file: "src/report.ts", line: 2 }] });
    const groups = groupBySystem(surfaceCallSiteRows(available(e)));
    expect(groups.map((g) => g.system)).toEqual(["src"]);
    expect(groups[0]!.rows.length).toBe(2);
    expect(grouping(e).systems).toEqual([{ system: "src", call_sites: 2 }]);
    expect(blastRadius(e, [])).toContain("`src`");
  });

  // OUT-14c
  test("a call site outside every known system is grouped, last, and never dropped", () => {
    const e = exportsOf({
      render: [{ file: "src/cli.ts", line: 7 }, { file: "package.json", line: 4 }],
      devDependencies: [{ file: "package.json", line: 12 }],
    });
    const groups = groupBySystem(surfaceCallSiteRows(available(e)));
    expect(groups.map((g) => g.system)).toEqual(["src", UNASSIGNED_SYSTEM]);
    expect(groups[1]!.rows.map((r) => `${r.symbol} ${r.site.line}`)).toEqual(["devDependencies 12", "render 4"]);
    expect(grouping(e).systems).toEqual([
      { system: "src", call_sites: 1 },
      { system: UNASSIGNED_SYSTEM, call_sites: 2 },
    ]);
    const md = blastRadius(e, []);
    expect(md).toContain(UNASSIGNED_SYSTEM);
    expect(md).toContain("`package.json:12`");
  });

  // OUT-14f
  test("the per-system counts sum to counts.call_sites, and the order does not follow the scan", () => {
    const sites = {
      render: [{ file: "test/cli.test.ts", line: 90 }, { file: "src/cli.ts", line: 7 }],
      structuralSummary: [{ file: "package.json", line: 1 }],
      resolveGraft: [{ file: "docs/topics/output/README.md", line: 5 }],
    };
    const e = exportsOf(sites);
    const g = grouping(e);
    expect(g.rule).toBe(SYSTEM_RULE);
    expect(g.systems).toEqual([
      { system: "docs", call_sites: 1 },
      { system: "src", call_sites: 1 },
      { system: "test", call_sites: 1 },
      { system: UNASSIGNED_SYSTEM, call_sites: 1 },
    ]);
    const line = enveloped(exportsRecord("r", e, [])) as { exports: { counts: Record<string, number> } };
    const total = (g.systems as Array<{ call_sites: number }>).reduce((n, s) => n + s.call_sites, 0);
    expect(total).toBe(line.exports.counts.call_sites);

    // The same sites in another arrival order group identically: the order is the rule's, not the scan's.
    const reversed = systemCounts(
      [...surfaceCallSiteRows(available(e))].reverse().map((r) => r.site),
    );
    expect(reversed).toEqual([
      { system: "docs", callSites: 1 },
      { system: "src", callSites: 1 },
      { system: "test", callSites: 1 },
      { system: UNASSIGNED_SYSTEM, callSites: 1 },
    ]);
  });
});

// ---- the record --------------------------------------------------------------------------------

describe("the record carries the grouping with the rule named", () => {
  // OUT-14g
  test("a scanned surface carries the rule, the systems, and a mitigation on every call site", () => {
    expect(BLAST_RADIUS_TYPE.version).toBe("1.1.0");
    const e = exportsOf({ render: [{ file: "src/cli.ts", line: 7 }, { file: "test/cli.test.ts", line: 90 }] });
    const g = grouping(e);
    expect(g.rule).toBe(SYSTEM_RULE);
    expect(g.rule_detail).toBe(SYSTEM_RULE_DETAIL);
    expect(g.mitigation_rule).toBe(MITIGATION_RULE);
    expect(g.unassigned).toBe(UNASSIGNED_SYSTEM);
    for (const site of wireSites(e)) {
      expect(typeof site.system).toBe("string");
      expect((site.mitigation as string).length).toBeGreaterThan(0);
      expect(typeof site.mitigation_basis).toBe("string");
    }
  });

  test("a surface with no scan carries no grouping at all, and no site-level field", () => {
    const line = enveloped(exportsRecord("r", parseExportSurfaceText(SIGNATURE_CHANGE), [])) as Record<string, unknown>;
    if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
    const ex = (line as { exports: Record<string, unknown> }).exports;
    expect("call_site_systems" in ex).toBe(false);
  });

  // OUT-14h
  test("the digest moves when a call site's system moves", () => {
    const here = { render: [{ file: "src/cli.ts", line: 7 }] };
    const there = { render: [{ file: "test/cli.ts", line: 7 }] };
    const digest = (s: Record<string, readonly CallSite[]>) => exportsRecord("r", exportsOf(s), []).digest as string;
    expect(digest(here)).toBe(digest(here));
    expect(digest(here)).not.toBe(digest(there));
  });
});

// ---- the known failure mode: a padded mitigation -----------------------------------------------

describe("no row carries a mitigation that was not derived", () => {
  /**
   * The allowlist, declared here rather than imported, so a form added to `src/systems.ts` does
   * not add itself to the oracle. Anything else on a row -- advice, an adjective, a verdict --
   * turns this red, which is flyingrobots/footprint#11's named failure mode.
   */
  const FORMS: readonly RegExp[] = [
    /^None needed$/,
    /^Call site in [^,|]+, outside the changed file\.$/,
    /^Call site outside every known system, outside the changed file\.$/,
  ];

  function allowed(mitigation: string): boolean {
    return FORMS.some((f) => f.test(mitigation));
  }

  // OUT-14e
  test("every mitigation of the real DoD-run surface is one of three derived forms", async () => {
    const surface = available(parseExportSurfaceText(SIGNATURE_CHANGE));
    const scan = await scanCallSites(ROOT, surfaceSymbols(surface).map((s) => s.symbol));
    const e = withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), scan);
    const sites = wireSites(e);
    expect(sites.length).toBeGreaterThan(50);

    const seen = new Set<string>();
    for (const site of sites) {
      const m = site.mitigation as string;
      seen.add(m);
      if (!allowed(m)) throw new Error(`mitigation not derived: ${JSON.stringify(m)} at ${site.file}:${site.line}`);
    }
    // Not all one form either: the DoD run reaches more than the declaring file.
    expect(seen.size).toBeGreaterThan(2);
    expect(seen.has(NONE_NEEDED)).toBe(true);
  }, 180_000);

  test("the derivation produces nothing but those forms, over every basis and any system name", () => {
    for (const basis of ["declaring_file", "test_file", "other_system", "unassigned"] as const) {
      for (const system of ["src", "test", "docs", ".github", "a-b_c.d", UNASSIGNED_SYSTEM]) {
        const m = mitigationFor(basis, system);
        if (!allowed(m)) throw new Error(`mitigation not derived: ${JSON.stringify(m)}`);
      }
    }
  });
});

// ---- --human -----------------------------------------------------------------------------------

describe("--human renders one Markdown table per system", () => {
  // OUT-14i
  test("a long system is capped per symbol, with the remainder named below the table", () => {
    const many: CallSite[] = [];
    for (let i = 1; i <= 25; i += 1) many.push({ file: "src/cli.ts", line: i });
    const e = exportsOf({ render: many, devDependencies: [] });
    const md = blastRadius(e, []);

    const rows = md.split("\n").filter((l) => l.startsWith("|") && l.includes("src/cli.ts:"));
    expect(rows.length).toBe(20);
    expect(md).toContain("…and 5 more");
    // The overflow is a sentence, not a row with an empty mitigation cell.
    for (const line of md.split("\n")) {
      if (!line.startsWith("|")) continue;
      expect(line.endsWith("|")).toBe(true);
      const cells = line.split("|").slice(1, -1);
      if (cells.length === 3 && cells[1]!.includes(":")) expect(cells[2]!.trim().length).toBeGreaterThan(0);
    }
    // A symbol nothing references is still stated rather than left out.
    expect(md).toContain("devDependencies");
    expect(md).toMatch(/no call site/i);
  });

  test("the section names the grouping rule and the mitigation derivation", () => {
    const md = blastRadius(exportsOf({ render: [{ file: "src/cli.ts", line: 7 }] }), []);
    expect(md).toContain("first path segment");
    expect(md).toContain("Mitigation");
    expect(md).toContain(NONE_NEEDED);
  });
});
