// Call sites for each changed exported symbol (flyingrobots/footprint#10).
//
// footprint finds them itself, with a conservative whole-word identifier scan of the tracked files
// at head: no graft CLI contract answers with a call site's *line* (see docs/topics/blast-radius).
// The scan is therefore held to `grep`'s own word boundary, and the golden case here compares it
// with real `grep -I -n -w` over `git ls-files` rather than with a hand-written expectation.
//
//   test/fixtures/graft.struct_exports.signature_change.json
//     `graft struct exports 543477a~1 543477a --json` on this repository, the commit where the
//     exported `render` in src/render.ts gained `review?: StructuralReview | null`.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  SCAN_METHOD,
  WORD_CHARACTER,
  isBinary,
  matchLines,
  notRunScan,
  scanCallSites,
  sitesFor,
  type CallSite,
  type CallSiteScan,
} from "../src/callsites.ts";
import {
  BLAST_RADIUS_SCHEMA,
  BLAST_RADIUS_TYPE,
  exportsRecord,
  parseExportSurfaceText,
  withCallSites,
  type ExportSurface,
  type Exports,
} from "../src/exports.ts";
import { blastRadius } from "../src/render.ts";

const ROOT = resolve(import.meta.dir, "..");
const SIGNATURE_CHANGE = readFileSync(join(ROOT, "test/fixtures/graft.struct_exports.signature_change.json"), "utf8");

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(BLAST_RADIUS_SCHEMA);

function enveloped(record: Record<string, unknown>) {
  return { ...record, t: 1, seq: 2, run: "01JTESTTESTTESTTESTTESTTEST", _schema: BLAST_RADIUS_TYPE };
}

function available(e: Exports): ExportSurface {
  if (!e.available) throw new Error(`expected an available export surface, got ${e.reason.code}: ${e.reason.detail}`);
  return e.surface;
}

function scanned(s: CallSiteScan) {
  if (!s.available) throw new Error(`expected an available scan, got ${s.reason.code}: ${s.reason.detail}`);
  return s;
}

function pairs(sites: readonly CallSite[]): Set<string> {
  return new Set(sites.map((s) => `${s.file}:${s.line}`));
}

/**
 * The oracle: real `grep`, one process per batch of files, over the same `git ls-files` listing.
 * The file enumeration is shared on purpose -- what is being checked is footprint's *matching*,
 * against an implementation of `-w` nobody here wrote. `/dev/null` keeps grep's `file:line:`
 * prefix even when a batch holds one file.
 */
function grepOracle(symbol: string, cwd = ROOT): Set<string> {
  const ls = Bun.spawnSync(["git", "ls-files", "-z"], { cwd });
  if (ls.exitCode !== 0) throw new Error(`git ls-files failed in ${cwd}`);
  const files = new TextDecoder().decode(ls.stdout).split("\0").filter((f) => f !== "");
  const found = new Set<string>();
  for (let i = 0; i < files.length; i += 200) {
    const g = Bun.spawnSync(["grep", "-I", "-n", "-w", "--", symbol, "/dev/null", ...files.slice(i, i + 200)], { cwd });
    for (const line of new TextDecoder().decode(g.stdout).split("\n")) {
      if (line === "") continue;
      const m = /^(.+?):(\d+):/.exec(line);
      if (m === null) throw new Error(`grep said something this oracle cannot read: ${line}`);
      found.add(`${m[1]}:${m[2]}`);
    }
  }
  return found;
}

/** A throwaway repository, so a deleted file and a binary file are real rather than mocked. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "footprint-callsites-"));
  for (const args of [["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]]) {
    const r = Bun.spawnSync(["git", ...args], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
  }
  return dir;
}

function gitAdd(dir: string, paths: string[]): void {
  const r = Bun.spawnSync(["git", "add", "--", ...paths], { cwd: dir });
  if (r.exitCode !== 0) throw new Error(`git add failed: ${new TextDecoder().decode(r.stderr)}`);
}

describe("the call-site scan is a pure function over one file's text", () => {
  test("a whole-word occurrence is a call site and a substring is not", () => {
    const text = [
      "import { render } from './render.ts';", // 1: two whole-word occurrences
      "renderAll(x);", // 2: a longer identifier, not a match
      "const prerender = 1;", // 3: not a match
      "const my_render_fn = 2;", // 4: underscore is a word character, not a match
      "obj.render();", // 5: a dot is not a word character, so this is a match
      "$render(x);", // 6: a dollar is not a word character either
      "// render is mentioned in a comment", // 7: a match; the scan cannot tell a mention apart
      "const s = 'render';", // 8: a match, for the same reason
    ].join("\n");
    expect(matchLines(text, ["render"]).get("render")).toEqual([1, 5, 6, 7, 8]);
  });

  test("one line that mentions the symbol twice is one call site", () => {
    expect(matchLines("render(render(x));", ["render"]).get("render")).toEqual([1]);
  });

  test("a symbol the text never mentions gets an empty list, not a missing key", () => {
    const m = matchLines("nothing to see", ["render", "absent"]);
    expect(m.get("render")).toEqual([]);
    expect(m.get("absent")).toEqual([]);
    expect([...m.keys()].sort()).toEqual(["absent", "render"]);
  });

  test("the boundary is grep's own: a real grep agrees line for line", () => {
    const dir = scratchRepo();
    try {
      const text = [
        "render(a);",
        "renderAll(b);",
        "x_render(c);",
        "obj.render();",
        "$render",
        "pre-render",
        "RENDER",
        // A differential fuzz against real grep caught an ASCII-only boundary claiming a call
        // site for `r` inside `rünïcode`. A letter is a word character in any script, and grep
        // in a UTF-8 locale agrees; these three lines are that bug, pinned.
        "rünïcode",
        "renderü(d);",
        "ürender(e);",
      ].join("\n");
      writeFileSync(join(dir, "sample.ts"), `${text}\n`);
      gitAdd(dir, ["sample.ts"]);
      for (const symbol of ["render", "r"]) {
        const mine = new Set((matchLines(text, [symbol]).get(symbol) ?? []).map((l) => `sample.ts:${l}`));
        expect([...mine].sort()).toEqual([...grepOracle(symbol, dir)].sort());
      }
      // The pinned regression, stated as itself rather than only as an oracle agreement.
      expect(matchLines("rünïcode", ["r"]).get("r")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a buffer with a NUL byte is binary, and text is not", () => {
    expect(isBinary(new TextEncoder().encode("render(x);\n"))).toBe(false);
    expect(isBinary(new Uint8Array([0x72, 0x65, 0x00, 0x6e]))).toBe(true);
    expect(isBinary(new Uint8Array(0))).toBe(false);
  });
});

describe("call sites are checked against an independent grep oracle", () => {
  test("every call site grep finds on a real signature change in this repository is listed", async () => {
    const surface = available(parseExportSurfaceText(SIGNATURE_CHANGE));
    const symbols = [...surface.added, ...surface.removed, ...surface.signatureChanged];
    expect(symbols.map((s) => s.symbol).sort()).toEqual([
      "StructuralFile",
      "StructuralReview",
      "devDependencies",
      "render",
      "resolveGraft",
      "structuralReview",
      "structuralSummary",
    ]);
    const changed = surface.signatureChanged[0]!;
    expect(changed.symbol).toBe("render");
    expect(changed.file).toBe("src/render.ts");
    expect(changed.previousSignature).toContain("render(c: Composition, changes: readonly FileChange[], range: string)");
    expect(changed.signature).toContain("review?: StructuralReview | null");

    const scan = scanned(await scanCallSites(ROOT, symbols.map((s) => s.symbol)));
    expect(scan.filesScanned).toBeGreaterThan(10);
    for (const s of symbols) {
      const mine = pairs(sitesFor(scan, s.symbol) ?? []);
      expect([...mine].sort()).toEqual([...grepOracle(s.symbol)].sort());
      expect(mine.size).toBeGreaterThan(0);
    }
  }, 120_000);

  test("sites are ordered by file then line, so the digest does not follow the filesystem", async () => {
    const scan = scanned(await scanCallSites(ROOT, ["render"]));
    const sites = sitesFor(scan, "render") ?? [];
    const sorted = [...sites].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    expect(sites).toEqual(sorted);
  }, 120_000);

  test("a symbol nothing references is listed with an empty list, not dropped", async () => {
    // Built at runtime: spelled out, the name would occur in this very file and be found.
    const absent = `zzAbsent${"Symbol"}InThisRepository`;
    const scan = scanned(await scanCallSites(ROOT, ["render", absent]));
    expect(sitesFor(scan, absent)).toEqual([]);
    expect((sitesFor(scan, "render") ?? []).length).toBeGreaterThan(0);
    expect(grepOracle(absent).size).toBe(0);
  }, 120_000);
});

describe("the scan over a real git repository", () => {
  test("a tracked file that is no longer on disk is skipped and counted, not a crash", async () => {
    const dir = scratchRepo();
    try {
      writeFileSync(join(dir, "kept.ts"), "render(x);\n");
      writeFileSync(join(dir, "gone.ts"), "export function render(x) {}\n");
      gitAdd(dir, ["kept.ts", "gone.ts"]);
      unlinkSync(join(dir, "gone.ts"));
      const scan = scanned(await scanCallSites(dir, ["render"]));
      expect(scan.skipped.unreadable).toBe(1);
      expect(scan.filesScanned).toBe(1);
      expect(sitesFor(scan, "render")).toEqual([{ file: "kept.ts", line: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a binary file is skipped and counted, exactly as grep -I skips it", async () => {
    const dir = scratchRepo();
    try {
      const name = new TextEncoder().encode("render");
      writeFileSync(join(dir, "blob.bin"), Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from(name), Buffer.from([0x00])]));
      writeFileSync(join(dir, "kept.ts"), "render(x);\n");
      gitAdd(dir, ["blob.bin", "kept.ts"]);
      const scan = scanned(await scanCallSites(dir, ["render"]));
      expect(scan.skipped.binary).toBe(1);
      expect(scan.filesScanned).toBe(1);
      expect(sitesFor(scan, "render")).toEqual([{ file: "kept.ts", line: 1 }]);
      expect([...grepOracle("render", dir)]).toEqual(["kept.ts:1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a scan that could not list the tracked files is stated, not an empty list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "footprint-not-a-repo-"));
    try {
      const scan = await scanCallSites(dir, ["render"]);
      expect(scan.available).toBe(false);
      if (scan.available) throw new Error("unreachable");
      expect(scan.reason.code).toBe("scan.ls_files_failed");
      expect(scan.reason.detail).toContain("git ls-files");
      expect(sitesFor(scan, "render")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no symbol to look up means no tree is read at all", async () => {
    const scan = scanned(await scanCallSites(ROOT, []));
    expect(scan.filesScanned).toBe(0);
    expect(scan.skipped).toEqual({ binary: 0, unreadable: 0 });
  });
});

describe("the record carries the call sites", () => {
  const SCAN: CallSiteScan = {
    available: true,
    filesScanned: 3,
    skipped: { binary: 1, unreadable: 0 },
    sites: new Map<string, readonly CallSite[]>([
      ["render", [{ file: "src/cli.ts", line: 7 }, { file: "test/cli.test.ts", line: 90 }]],
      ["devDependencies", []],
      ["StructuralFile", [{ file: "src/report.ts", line: 9 }]],
      ["StructuralReview", [{ file: "src/report.ts", line: 9 }]],
      ["resolveGraft", [{ file: "src/cli.ts", line: 9 }]],
      ["structuralReview", [{ file: "src/cli.ts", line: 9 }]],
      ["structuralSummary", [{ file: "src/render.ts", line: 5 }]],
    ]),
  };

  function record(exports: Exports) {
    return enveloped(exportsRecord("origin/main...HEAD", exports));
  }

  test("the record validates against schemas/footprint.blast_radius.schema.json at 1.1.0", () => {
    expect(BLAST_RADIUS_TYPE.version).toBe("1.1.0");
    const withSites = withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), SCAN);
    const line = record(withSites) as Record<string, unknown>;
    if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
    const ex = (line as { exports: Record<string, unknown> }).exports;
    expect((ex.call_site_scan as Record<string, unknown>).method).toBe(SCAN_METHOD);
    expect((ex.call_site_scan as Record<string, unknown>).available).toBe(true);
    expect((ex.call_site_scan as Record<string, unknown>).files_scanned).toBe(3);
    expect((ex.counts as Record<string, number>).call_sites).toBe(7);
    const changed = (ex.signature_changed as Array<Record<string, unknown>>)[0]!;
    expect(changed.call_sites).toEqual([{ file: "src/cli.ts", line: 7 }, { file: "test/cli.test.ts", line: 90 }]);
    const dev = (ex.added as Array<Record<string, unknown>>).find((s) => s.symbol === "devDependencies")!;
    expect(dev.call_sites).toEqual([]);
  });

  test("a surface parsed without a scan says so rather than listing empty call sites", () => {
    const line = record(parseExportSurfaceText(SIGNATURE_CHANGE)) as Record<string, unknown>;
    if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
    const ex = (line as { exports: Record<string, unknown> }).exports;
    expect(ex.call_site_scan).toEqual({ available: false, method: SCAN_METHOD, reason: { code: "scan.not_run", detail: expect.any(String) } });
    expect((ex.counts as Record<string, unknown>).call_sites).toBeUndefined();
    for (const s of ex.added as Array<Record<string, unknown>>) expect("call_sites" in s).toBe(false);
  });

  test("a scan that could not run is stated on the record, and no symbol carries call sites", () => {
    const unavailable: CallSiteScan = { available: false, reason: { code: "scan.ls_files_failed", detail: "git ls-files -z exited 128" } };
    const line = record(withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), unavailable)) as Record<string, unknown>;
    if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
    const ex = (line as { exports: Record<string, unknown> }).exports;
    expect((ex.call_site_scan as Record<string, unknown>).reason).toEqual({ code: "scan.ls_files_failed", detail: "git ls-files -z exited 128" });
    for (const s of ex.signature_changed as Array<Record<string, unknown>>) expect("call_sites" in s).toBe(false);
  });

  test("an unavailable surface is unchanged by a scan and still validates", () => {
    const line = record(withCallSites({ available: false, reason: { code: "graft.not_resolved", detail: "no graft" } }, SCAN)) as Record<string, unknown>;
    if (!validate(line)) throw new Error(ajv.errorsText(validate.errors));
    expect((line as { exports: Record<string, unknown> }).exports).toEqual({ available: false, reason: { code: "graft.not_resolved", detail: "no graft" } });
  });

  test("the digest moves when a call site moves", () => {
    const base = withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), SCAN);
    const moved: CallSiteScan = { ...SCAN, sites: new Map(SCAN.sites).set("render", [{ file: "src/cli.ts", line: 8 }, { file: "test/cli.test.ts", line: 90 }]) };
    const other = withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), moved);
    const digest = (e: Exports) => exportsRecord("r", e).digest as string;
    expect(digest(base)).toBe(digest(withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), SCAN)));
    expect(digest(base)).not.toBe(digest(other));
    expect(digest(base)).not.toBe(digest(parseExportSurfaceText(SIGNATURE_CHANGE)));
  });

  test("the scan's word boundary is the one the schema and the docs name", () => {
    expect(WORD_CHARACTER).toBe("[\\p{L}\\p{N}_]");
    expect(new RegExp(WORD_CHARACTER, "u").test("ü")).toBe(true);
    expect(new RegExp(WORD_CHARACTER, "u").test("-")).toBe(false);
    expect(notRunScan().available).toBe(false);
  });
});

describe("the blast-radius section carries the call sites", () => {
  const SCAN: CallSiteScan = {
    available: true,
    filesScanned: 42,
    skipped: { binary: 2, unreadable: 0 },
    sites: new Map<string, readonly CallSite[]>([
      ["render", [{ file: "src/cli.ts", line: 7 }, { file: "src/cli.ts", line: 66 }]],
      ["devDependencies", []],
      ["StructuralFile", [{ file: "src/report.ts", line: 9 }]],
      ["StructuralReview", [{ file: "src/report.ts", line: 9 }]],
      ["resolveGraft", [{ file: "src/cli.ts", line: 9 }]],
      ["structuralReview", [{ file: "src/cli.ts", line: 9 }]],
      ["structuralSummary", [{ file: "src/render.ts", line: 5 }]],
    ]),
  };

  test("call sites are listed with file and line under each symbol", () => {
    const md = blastRadius(withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), SCAN));
    expect(md).toContain("`src/cli.ts:7`");
    expect(md).toContain("`src/cli.ts:66`");
    expect(md).toContain("identifier scan");
    // A symbol nothing references says so rather than being left out of the section.
    expect(md).toContain("devDependencies");
    expect(md).toMatch(/no call site/i);
    for (const line of md.split("\n")) {
      if (line.startsWith("|")) expect(line.endsWith("|")).toBe(true);
    }
  });

  test("an unavailable call-site scan states its reason rather than reading as no call sites", () => {
    const md = blastRadius(withCallSites(parseExportSurfaceText(SIGNATURE_CHANGE), { available: false, reason: { code: "scan.ls_files_failed", detail: "git ls-files -z exited 128" } }));
    expect(md).toContain("scan.ls_files_failed");
    expect(md).toContain("git ls-files -z exited 128");
    expect(md).not.toMatch(/0 call sites/);
  });
});
