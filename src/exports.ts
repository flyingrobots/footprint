// The export-surface diff: which exported symbols a change added, removed or re-signed.
//
// The facts come from graft's CLI contract, `graft struct exports <base-ref> <head-ref> --json`,
// which carries `_schema` `graft.cli.struct_exports` 1.0.0 (AGENTS.md, flyingrobots/footprint#8).
// footprint binds to that exact (id, version) pair: a different version is an unavailable section
// with a stated reason, never a crash and never a silent omission. Nothing here imports a graft
// module, and nothing reaches into its dist.
//
// Reading graft's answer is `parseExportSurface`, a pure function over the parsed JSON, so the
// test suite needs no graft at all; `exportSurface` is the only part that runs a process.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { canonical, sha256 } from "@flyingrobots/parley-emit";
import { SCAN_METHOD, notRunScan, scanCallSites, sitesFor, type CallSite, type CallSiteScan } from "./callsites.ts";

export const BLAST_RADIUS_SCHEMA = JSON.parse(
  readFileSync(join(import.meta.dir, "../schemas/footprint.blast_radius.schema.json"), "utf8"),
) as Record<string, unknown>;
export const BLAST_RADIUS_TYPE = { id: "footprint.blast_radius", version: "1.1.0" } as const;

/** The one graft contract this reads. A different version is stated as unavailable. */
export const GRAFT_EXPORTS_CONTRACT = { id: "graft.cli.struct_exports", version: "1.0.0" } as const;

export type UnavailableCode =
  | "graft.not_resolved"
  | "graft.exports_failed"
  | "graft.output_unreadable"
  | "graft.schema_mismatch"
  | "range.unresolved";

export interface ExportedSymbol {
  readonly symbol: string;
  readonly file: string;
  readonly kind?: string;
  readonly signature?: string;
  readonly previousSignature?: string;
  /**
   * Where the symbol's name occurs in the tracked files at head, with file and line. Present once
   * a call-site scan has been attached (`withCallSites`); absent, never `[]`, when none has, so an
   * unscanned symbol can never be read as one nothing references.
   */
  readonly callSites?: readonly CallSite[];
}

export interface ExportSurface {
  readonly base: string;
  readonly head: string;
  readonly added: readonly ExportedSymbol[];
  readonly removed: readonly ExportedSymbol[];
  readonly signatureChanged: readonly ExportedSymbol[];
  /** graft's own judgement, passed through verbatim; footprint derives no semver impact. */
  readonly semverImpact: string | null;
  /** How the call sites on the symbols above were found, or that they were not looked for. */
  readonly callSiteScan: CallSiteScan;
}

export type Exports =
  | { readonly available: true; readonly surface: ExportSurface }
  | { readonly available: false; readonly reason: { readonly code: UnavailableCode; readonly detail: string } };

export function unavailableExports(code: UnavailableCode, detail: string): Exports {
  return { available: false, reason: { code, detail } };
}

/**
 * Read graft's answer. Pure: the same JSON always gives the same surface, in the same order.
 *
 * Entries are sorted by file then symbol so the result's digest follows the surface rather than
 * graft's internal ordering. An entry without a symbol or a file makes the whole section
 * unavailable with a reason: dropping it would be a silent omission, which is worse.
 */
export function parseExportSurface(value: unknown): Exports {
  if (value === null || typeof value !== "object") {
    return unavailableExports("graft.output_unreadable", `graft struct exports --json answered with ${value === null ? "null" : typeof value} rather than an object`);
  }
  const o = value as Record<string, unknown>;
  const schema = o._schema as { id?: unknown; version?: unknown } | undefined;
  const id = typeof schema?.id === "string" ? schema.id : null;
  const version = typeof schema?.version === "string" ? schema.version : null;
  if (id !== GRAFT_EXPORTS_CONTRACT.id || version !== GRAFT_EXPORTS_CONTRACT.version) {
    return unavailableExports(
      "graft.schema_mismatch",
      `graft answered under ${id ?? "no _schema id"}@${version ?? "no version"}; footprint reads ${GRAFT_EXPORTS_CONTRACT.id}@${GRAFT_EXPORTS_CONTRACT.version} and will not guess at another`,
    );
  }

  const lists: Array<[keyof ExportSurface & ("added" | "removed" | "signatureChanged"), string]> = [
    ["added", "added"],
    ["removed", "removed"],
    ["signatureChanged", "changed"],
  ];
  const parsed: Partial<Record<"added" | "removed" | "signatureChanged", ExportedSymbol[]>> = {};
  for (const [field, key] of lists) {
    const raw = o[key];
    if (!Array.isArray(raw)) {
      return unavailableExports("graft.output_unreadable", `graft's answer carries no ${key} array; footprint reads added, removed and changed`);
    }
    const out: ExportedSymbol[] = [];
    for (const [i, entry] of raw.entries()) {
      const symbol = str((entry as Record<string, unknown> | null)?.symbol);
      const file = str((entry as Record<string, unknown> | null)?.filePath);
      if (symbol === null || file === null) {
        return unavailableExports("graft.output_unreadable", `graft's ${key}[${i}] carries no symbol or no filePath; a symbol footprint cannot name is not reported as if it were absent`);
      }
      const kind = str((entry as Record<string, unknown>).kind);
      const signature = str((entry as Record<string, unknown>).signature);
      const previous = str((entry as Record<string, unknown>).previousSignature);
      out.push({
        symbol,
        file,
        ...(kind === null ? {} : { kind }),
        ...(signature === null ? {} : { signature }),
        ...(previous === null ? {} : { previousSignature: previous }),
      });
    }
    parsed[field] = out.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol));
  }

  const base = str(o.base);
  const head = str(o.head);
  if (base === null || head === null) {
    return unavailableExports("graft.output_unreadable", "graft's answer names no base or no head; the result would not say what was compared");
  }
  return {
    available: true,
    surface: {
      base,
      head,
      added: parsed.added!,
      removed: parsed.removed!,
      signatureChanged: parsed.signatureChanged!,
      semverImpact: str(o.semverImpact),
      callSiteScan: notRunScan(),
    },
  };
}

/** The same, from the raw stdout of the command; text that is not JSON is stated, never thrown. */
export function parseExportSurfaceText(text: string): Exports {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return unavailableExports("graft.output_unreadable", `graft struct exports --json did not answer with JSON: ${msg}`);
  }
  return parseExportSurface(value);
}

/**
 * Run the contract. `graft` is null when it could not be resolved, which is a stated limitation
 * rather than an error: enrichment is optional and the section is never omitted.
 *
 * A three-dot range is compared from the merge base, matching the composition's own semantics, so
 * exported symbols the default branch moved elsewhere are not reported as this change's doing.
 */
export async function exportSurface(graft: string | null, repo: string, range: string): Promise<Exports> {
  if (graft === null) {
    return unavailableExports("graft.not_resolved", "graft could not be resolved through the package dependency, PATH or FOOTPRINT_GRAFT");
  }
  const { base, head, threeDot } = rangeEnds(range);
  let baseRef = base;
  if (threeDot) {
    const mb = await $`git -C ${repo} merge-base ${base} ${head}`.quiet().nothrow();
    const sha = mb.text().trim();
    if (mb.exitCode !== 0 || sha === "") {
      return unavailableExports("range.unresolved", `git merge-base ${base} ${head} found no common commit, so there is no merge base to compare the export surface from`);
    }
    baseRef = sha;
  }
  const run = await $`${graft} --cwd ${repo} struct exports ${baseRef} ${head} --json`.quiet().nothrow();
  if (run.exitCode !== 0) {
    const why = run.stderr.toString().trim().split("\n")[0] ?? "(no message)";
    return unavailableExports("graft.exports_failed", `graft struct exports ${baseRef} ${head} --json exited ${run.exitCode}: ${why}`);
  }
  return parseExportSurfaceText(run.text());
}

/** The two ends of a range, and whether it was written with three dots (merge-base semantics). */
export function rangeEnds(range: string): { base: string; head: string; threeDot: boolean } {
  const threeDot = range.includes("...");
  const [base = range, head = ""] = range.split(/\.{2,3}/);
  return { base, head: head === "" ? "HEAD" : head, threeDot };
}

/**
 * Attach a call-site scan to every symbol of a surface (flyingrobots#10). Pure: the same surface
 * and the same scan always give the same answer.
 *
 * A symbol the scan ran for always gets a list, empty included -- the issue's "listed with an
 * empty list, not dropped". A scan that did not run attaches nothing at all, so the wire carries
 * the stated reason rather than a column of zeroes. An unavailable surface has no symbol to look
 * up and passes through untouched.
 */
export function withCallSites(exports: Exports, scan: CallSiteScan): Exports {
  if (!exports.available) return exports;
  const attach = (s: ExportedSymbol): ExportedSymbol => {
    const sites = sitesFor(scan, s.symbol);
    return sites === null ? s : { ...s, callSites: sites };
  };
  const s = exports.surface;
  return {
    available: true,
    surface: {
      ...s,
      added: s.added.map(attach),
      removed: s.removed.map(attach),
      signatureChanged: s.signatureChanged.map(attach),
      callSiteScan: scan,
    },
  };
}

/** Every symbol the surface names, in the order the result lists them. */
export function surfaceSymbols(surface: ExportSurface): readonly ExportedSymbol[] {
  return [...surface.added, ...surface.removed, ...surface.signatureChanged];
}

/**
 * Run the scan for a surface's symbols and attach it. The one impure step: it reads the tracked
 * files of the working tree. An unavailable surface is returned unchanged and no tree is read.
 */
export async function attachCallSites(exports: Exports, repo: string): Promise<Exports> {
  if (!exports.available) return exports;
  const scan = await scanCallSites(repo, surfaceSymbols(exports.surface).map((s) => s.symbol));
  return withCallSites(exports, scan);
}

/** The result record. Semantic content only enters the digest, so two runs compare with one string. */
export function exportsRecord(range: string, exports: Exports): Record<string, unknown> {
  const semantic = { range, exports: exportsPayload(exports) };
  return { event: "result", ...semantic, digest: sha256(canonical(semantic)) };
}

function exportsPayload(exports: Exports): Record<string, unknown> {
  if (!exports.available) return { available: false, reason: { ...exports.reason } };
  const s = exports.surface;
  const scan = s.callSiteScan;
  const sites = scan.available ? surfaceSymbols(s).reduce((n, x) => n + (x.callSites?.length ?? 0), 0) : null;
  return {
    available: true,
    base: s.base,
    head: s.head,
    added: s.added.map(wire),
    removed: s.removed.map(wire),
    signature_changed: s.signatureChanged.map(wire),
    counts: {
      added: s.added.length,
      removed: s.removed.length,
      signature_changed: s.signatureChanged.length,
      // Present only when the scan ran: a count of call sites nobody looked for is not a figure.
      ...(sites === null ? {} : { call_sites: sites }),
    },
    semver_impact: s.semverImpact,
    call_site_scan: scanPayload(scan),
    contract: { ...GRAFT_EXPORTS_CONTRACT },
  };
}

/** How the call sites were found, or why they were not. Always stated, like every other section. */
function scanPayload(scan: CallSiteScan): Record<string, unknown> {
  if (!scan.available) return { available: false, method: SCAN_METHOD, reason: { ...scan.reason } };
  return {
    available: true,
    method: SCAN_METHOD,
    files_scanned: scan.filesScanned,
    files_skipped: { ...scan.skipped },
  };
}

function wire(s: ExportedSymbol): Record<string, unknown> {
  return {
    symbol: s.symbol,
    file: s.file,
    ...(s.kind === undefined ? {} : { kind: s.kind }),
    ...(s.signature === undefined ? {} : { signature: s.signature }),
    ...(s.previousSignature === undefined ? {} : { previous_signature: s.previousSignature }),
    ...(s.callSites === undefined ? {} : { call_sites: s.callSites.map((c) => ({ file: c.file, line: c.line })) }),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
