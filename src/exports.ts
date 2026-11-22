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
import type { UnsupportedLanguage } from "./languages.ts";

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
}

export interface ExportSurface {
  readonly base: string;
  readonly head: string;
  readonly added: readonly ExportedSymbol[];
  readonly removed: readonly ExportedSymbol[];
  readonly signatureChanged: readonly ExportedSymbol[];
  /** graft's own judgement, passed through verbatim; footprint derives no semver impact. */
  readonly semverImpact: string | null;
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
 * The result record. Semantic content only enters the digest, so two runs compare with one
 * string. `unanalysed` is independent of `exports`: it names changed files in languages graft's
 * grammars cannot parse at all, regardless of whether graft ran or what it returned
 * (flyingrobots/footprint#12).
 */
export function exportsRecord(range: string, exports: Exports, unanalysed: readonly UnsupportedLanguage[]): Record<string, unknown> {
  const semantic = { range, exports: exportsPayload(exports), unanalysed_languages: unanalysed.map((u) => ({ ...u })) };
  return { event: "result", ...semantic, digest: sha256(canonical(semantic)) };
}

function exportsPayload(exports: Exports): Record<string, unknown> {
  if (!exports.available) return { available: false, reason: { ...exports.reason } };
  const s = exports.surface;
  return {
    available: true,
    base: s.base,
    head: s.head,
    added: s.added.map(wire),
    removed: s.removed.map(wire),
    signature_changed: s.signatureChanged.map(wire),
    counts: { added: s.added.length, removed: s.removed.length, signature_changed: s.signatureChanged.length },
    semver_impact: s.semverImpact,
    contract: { ...GRAFT_EXPORTS_CONTRACT },
  };
}

function wire(s: ExportedSymbol): Record<string, unknown> {
  return {
    symbol: s.symbol,
    file: s.file,
    ...(s.kind === undefined ? {} : { kind: s.kind }),
    ...(s.signature === undefined ? {} : { signature: s.signature }),
    ...(s.previousSignature === undefined ? {} : { previous_signature: s.previousSignature }),
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
