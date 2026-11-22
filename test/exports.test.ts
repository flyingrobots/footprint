// The export-surface diff. Parsing graft's answer is a pure function over its JSON, so the suite
// needs no graft: the fixtures beside this file were captured from the real command.
//
//   test/fixtures/graft.struct_exports.rename.json
//     `graft struct exports HEAD~1 HEAD --json` on a commit of this repository that renamed the
//     exported `mermaidPie` in src/footprint.ts to `pieChart` (the Definition of Done of
//     flyingrobots/footprint#9).
//   test/fixtures/graft.struct_exports.unchanged.json
//     the same command on `HEAD~1 HEAD` at e1e9ce6, where no exported symbol changed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  BLAST_RADIUS_SCHEMA,
  BLAST_RADIUS_TYPE,
  GRAFT_EXPORTS_CONTRACT,
  exportsRecord,
  parseExportSurface,
  parseExportSurfaceText,
  unavailableExports,
  type Exports,
} from "../src/exports.ts";
import { blastRadius } from "../src/render.ts";
import { unsupportedLanguages } from "../src/languages.ts";

const ROOT = resolve(import.meta.dir, "..");
const fixture = (name: string) => readFileSync(join(ROOT, "test/fixtures", name), "utf8");
const RENAME = fixture("graft.struct_exports.rename.json");
const UNCHANGED = fixture("graft.struct_exports.unchanged.json");

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(BLAST_RADIUS_SCHEMA);

/** The envelope the writer adds, so a record can be validated against the whole schema here. */
function enveloped(record: Record<string, unknown>) {
  return { ...record, t: 1, seq: 2, run: "01JTESTTESTTESTTESTTESTTEST", _schema: BLAST_RADIUS_TYPE };
}

function available(e: Exports) {
  if (!e.available) throw new Error(`expected an available export surface, got ${e.reason.code}: ${e.reason.detail}`);
  return e.surface;
}

describe("the export surface is a pure function of graft's JSON", () => {
  test("a renamed export is reported removed and added", () => {
    const s = available(parseExportSurfaceText(RENAME));
    expect(s.removed).toEqual([
      { symbol: "mermaidPie", file: "src/footprint.ts", kind: "function", signature: "mermaidPie(composition: Composition): string" },
    ]);
    expect(s.added).toEqual([
      { symbol: "pieChart", file: "src/footprint.ts", kind: "function", signature: "pieChart(composition: Composition): string" },
    ]);
    expect(s.signatureChanged).toEqual([]);
    expect(s.semverImpact).toBe("major");
    expect(s.base).toBe("HEAD~1");
    expect(s.head).toBe("HEAD");
  });

  test("a signature change carries the previous signature", () => {
    const changed = {
      _schema: { ...GRAFT_EXPORTS_CONTRACT },
      base: "a",
      head: "b",
      added: [],
      removed: [],
      changed: [{
        changeType: "signature_changed",
        filePath: "src/render.ts",
        kind: "function",
        symbol: "render",
        signature: "render(\n  c: Composition,\n  range: string,\n): string",
        previousSignature: "render(c: Composition, range: string): string",
      }],
      semverImpact: "minor",
    };
    const s = available(parseExportSurface(changed));
    expect(s.signatureChanged).toEqual([{
      symbol: "render",
      file: "src/render.ts",
      kind: "function",
      signature: "render(\n  c: Composition,\n  range: string,\n): string",
      previousSignature: "render(c: Composition, range: string): string",
    }]);
  });

  test("no exported symbol changed is three empty lists, not an unavailable section", () => {
    const s = available(parseExportSurfaceText(UNCHANGED));
    expect(s.added).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(s.signatureChanged).toEqual([]);
    expect(s.semverImpact).toBe("none");
    const record = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(UNCHANGED), []) as { exports: { available: boolean; counts: Record<string, number> } };
    expect(record.exports.available).toBe(true);
    expect(record.exports.counts).toEqual({ added: 0, removed: 0, signature_changed: 0 });
  });

  test("symbols are listed in a stable order, so the digest does not follow graft's ordering", () => {
    const shuffled = {
      _schema: { ...GRAFT_EXPORTS_CONTRACT },
      base: "a", head: "b", semverImpact: "minor", removed: [], changed: [],
      added: [
        { filePath: "src/z.ts", symbol: "b", kind: "function", signature: "b()" },
        { filePath: "src/a.ts", symbol: "z", kind: "function", signature: "z()" },
        { filePath: "src/a.ts", symbol: "a", kind: "function", signature: "a()" },
      ],
    };
    const s = available(parseExportSurface(shuffled));
    expect(s.added.map((x) => `${x.file}:${x.symbol}`)).toEqual(["src/a.ts:a", "src/a.ts:z", "src/z.ts:b"]);
  });

  test("graft that could not be resolved is available: false with a stated reason", () => {
    const e = unavailableExports("graft.not_resolved", "graft could not be resolved through the package or PATH");
    expect(e.available).toBe(false);
    const record = exportsRecord("origin/main...HEAD", e, []) as { exports: { available: boolean; reason: { code: string; detail: string } } };
    expect(record.exports.available).toBe(false);
    expect(record.exports.reason.code).toBe("graft.not_resolved");
    expect(record.exports.reason.detail.length).toBeGreaterThan(0);
    expect(Object.hasOwn(record.exports, "added")).toBe(false);
  });

  test("a different graft.cli.struct_exports version is unavailable and stated, never a throw", () => {
    const future = JSON.parse(RENAME) as { _schema: { id: string; version: string } };
    future._schema.version = "2.0.0";
    const e = parseExportSurface(future);
    expect(e.available).toBe(false);
    if (e.available) return;
    expect(e.reason.code).toBe("graft.schema_mismatch");
    expect(e.reason.detail).toContain("2.0.0");
    expect(e.reason.detail).toContain("1.0.0");

    const other = JSON.parse(RENAME) as { _schema: { id: string; version: string } };
    other._schema.id = "graft.cli.struct_diff";
    const f = parseExportSurface(other);
    expect(f.available).toBe(false);
    if (!f.available) expect(f.reason.code).toBe("graft.schema_mismatch");
  });

  test("output that is not graft's answer is unavailable and stated", () => {
    for (const text of ["", "not json at all", "{}", '{"_schema":{"id":"graft.cli.struct_exports","version":"1.0.0"}}']) {
      const e = parseExportSurfaceText(text);
      expect(e.available).toBe(false);
      if (!e.available) expect(["graft.output_unreadable", "graft.schema_mismatch"]).toContain(e.reason.code);
    }
    const noPath = {
      _schema: { ...GRAFT_EXPORTS_CONTRACT },
      base: "a", head: "b", removed: [], changed: [], semverImpact: "minor",
      added: [{ changeType: "added", kind: "function", signature: "x()" }],
    };
    const e = parseExportSurface(noPath);
    expect(e.available).toBe(false);
    if (!e.available) expect(e.reason.code).toBe("graft.output_unreadable");
  });

  test("the record validates against schemas/footprint.blast_radius.schema.json, available or not", () => {
    for (const e of [parseExportSurfaceText(RENAME), parseExportSurfaceText(UNCHANGED), unavailableExports("graft.not_resolved", "no graft")]) {
      const line = enveloped(exportsRecord("HEAD~1..HEAD", e, []));
      expect(validate(line), ajv.errorsText(validate.errors)).toBe(true);
    }
    const line = enveloped(exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), [])) as { digest: string; exports: { contract: unknown } };
    expect(line.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(line.exports.contract).toEqual({ id: "graft.cli.struct_exports", version: "1.0.0" });
  });

  test("the digest is the same for the same surface and moves when the surface does", () => {
    const a = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), []) as { digest: string };
    const b = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), []) as { digest: string };
    const c = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(UNCHANGED), []) as { digest: string };
    expect(a.digest).toBe(b.digest);
    expect(a.digest).not.toBe(c.digest);
  });
});

describe("the blast-radius section of the Markdown comment", () => {
  test("lists added, removed and signature-changed symbols with file and name", () => {
    const md = blastRadius(parseExportSurfaceText(RENAME));
    expect(md).toContain("Blast radius");
    expect(md).toContain("mermaidPie");
    expect(md).toContain("pieChart");
    expect(md).toContain("src/footprint.ts");
    expect(md).toContain("graft struct exports");
    // A multi-line signature must not break the table it sits in.
    const changed = parseExportSurface({
      _schema: { ...GRAFT_EXPORTS_CONTRACT },
      base: "a", head: "b", added: [], removed: [], semverImpact: "minor",
      changed: [{ filePath: "src/render.ts", symbol: "render", kind: "function", signature: "render(\n  c: Composition,\n): string", previousSignature: "render(c: Composition): string" }],
    });
    for (const line of blastRadius(changed).split("\n")) {
      if (line.startsWith("|")) expect(line.endsWith("|")).toBe(true);
    }
  });

  test("says no exported symbol moved rather than printing an empty table", () => {
    const md = blastRadius(parseExportSurfaceText(UNCHANGED));
    expect(md).toContain("Blast radius");
    expect(md).toMatch(/No exported symbol/);
  });

  test("states the limitation when graft is unavailable", () => {
    const md = blastRadius(unavailableExports("graft.not_resolved", "graft could not be resolved through the package or PATH"));
    expect(md).toContain("Blast radius");
    expect(md).toMatch(/unavailable/i);
    expect(md).toContain("graft could not be resolved");
  });
});

// ---- unanalysed languages (flyingrobots/footprint#12) -------------------------------------------

describe("the unanalysed-languages field on the blast-radius result", () => {
  const HASKELL = unsupportedLanguages(["src/Main.hs", "src/app.ts"]);

  test("the record validates against schemas/footprint.blast_radius.schema.json 1.1.0, with or without unanalysed languages", () => {
    for (const unanalysed of [[], HASKELL]) {
      const line = enveloped(exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), unanalysed));
      expect(validate(line), ajv.errorsText(validate.errors)).toBe(true);
    }
  });

  test("unanalysed_languages is present and empty when there is nothing to report", () => {
    const record = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), []) as { unanalysed_languages: unknown[] };
    expect(record.unanalysed_languages).toEqual([]);
  });

  test("a changed Haskell file is named by extension with a count", () => {
    const record = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), HASKELL) as { unanalysed_languages: Array<{ extension: string; count: number }> };
    expect(record.unanalysed_languages).toEqual([{ extension: ".hs", count: 1 }]);
  });

  test("the digest moves when the unanalysed-languages list does, same exports surface otherwise", () => {
    const a = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), []) as { digest: string };
    const b = exportsRecord("HEAD~1..HEAD", parseExportSurfaceText(RENAME), HASKELL) as { digest: string };
    expect(a.digest).not.toBe(b.digest);
  });

  test("a changed file in a supported language is never counted here, whatever graft's run turned out", () => {
    // RENAME's surface is `available: true`; the unavailable-surface fixture exercises the other
    // branch. Either way, detection never consults `exports` -- only the changed-file list.
    const unavailable = unavailableExports("graft.exports_failed", "graft struct exports exited 1: parse error in src/app.ts");
    const record = exportsRecord("HEAD~1..HEAD", unavailable, unsupportedLanguages(["src/app.ts"])) as { unanalysed_languages: unknown[] };
    expect(record.unanalysed_languages).toEqual([]);
  });

  test("--human lists the unanalysed languages by extension and count", () => {
    const md = blastRadius(parseExportSurfaceText(RENAME), HASKELL);
    expect(md).toContain("Blast radius");
    expect(md).toContain(".hs");
    expect(md).toMatch(/1 changed file/);
  });

  test("--human states that every changed file was in a supported language when there is nothing to report", () => {
    const md = blastRadius(parseExportSurfaceText(RENAME), []);
    expect(md).toMatch(/every changed source file/i);
  });

  test("the unanalysed-languages section appears even when the export surface itself is unavailable", () => {
    const md = blastRadius(unavailableExports("graft.not_resolved", "graft could not be resolved through the package or PATH"), HASKELL);
    expect(md).toContain("Blast radius");
    expect(md).toMatch(/unavailable/i);
    expect(md).toContain(".hs");
  });
});
