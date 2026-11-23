// The Impact and Data flow columns of the call-site tables (flyingrobots/footprint#59).
//
// footprint cannot know what a change does at a call site at run time: it reports and does not
// judge (AGENTS.md), and its call sites are a whole-word scan. The agent running the skill can,
// by reading the code, and supplies its reading with `--impact <file>`: one JSON object per line,
//
//   {"symbol": "...", "system": "...", "file": "...", "impact": "...", "dataFlow": "..."}
//
// with `file` optional. footprint renders the text in the `--human` tables, labelled as the
// agent's reading, and never puts it in a result line: those stay footprint's measurement.
import type { SystemRow } from "./systems.ts";

/**
 * The two column headers, in one place. The owner named "impact"; "Data flow" is the
 * coordinator's reading of the second column (flyingrobots/footprint#59) and may be renamed here.
 */
export const IMPACT_COLUMNS = { impact: "Impact", dataFlow: "Data flow" } as const;

/** What a row no entry covers says: never blank, never invented. */
export const NOT_ASSESSED = "not assessed";

export const IMPACT_NOTE =
  `<sub>**${IMPACT_COLUMNS.impact}** and **${IMPACT_COLUMNS.dataFlow}** are the reading of the agent that posted this report, from the code at this head, ` +
  `not footprint's measurement: footprint found the call sites and cannot see run-time behaviour. \`${NOT_ASSESSED}\` marks a row the agent did not assess.</sub>`;

export interface ImpactEntry {
  readonly symbol: string;
  readonly system: string;
  readonly file?: string;
  readonly impact: string;
  readonly dataFlow: string;
}

export interface Assessment {
  readonly impact: string;
  readonly dataFlow: string;
}

const KEYS = new Set(["symbol", "system", "file", "impact", "dataFlow"]);
const REQUIRED = ["symbol", "system", "impact", "dataFlow"] as const;

export type ParsedImpact = { readonly ok: true; readonly entries: readonly ImpactEntry[] } | { readonly ok: false; readonly line: number; readonly problem: string };

/** One JSON object per line; blank lines are skipped. Line numbers are 1-based. */
export function parseImpact(text: string): ParsedImpact {
  const entries: ImpactEntry[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const line = i + 1;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch (e) {
      return { ok: false, line, problem: `not JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, line, problem: "not a JSON object" };
    const o = v as Record<string, unknown>;
    const unknown = Object.keys(o).filter((k) => !KEYS.has(k));
    if (unknown.length > 0) return { ok: false, line, problem: `unknown key${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}; the keys are ${[...KEYS].join(", ")}` };
    for (const k of [...REQUIRED, ...("file" in o ? (["file"] as const) : [])]) {
      if (typeof o[k] !== "string" || (o[k] as string).trim() === "") return { ok: false, line, problem: `${k} must be a non-empty string` };
    }
    const entry = o as unknown as ImpactEntry;
    const key = keyOf(entry.symbol, entry.system, entry.file);
    if (seen.has(key)) return { ok: false, line, problem: `a second entry for symbol ${entry.symbol} in ${entry.system}${entry.file === undefined ? "" : ` at ${entry.file}`}` };
    seen.add(key);
    entries.push(entry);
  }
  return { ok: true, entries };
}

function keyOf(symbol: string, system: string, file: string | undefined): string {
  return JSON.stringify([symbol, system, file ?? null]);
}

/** The entries, looked up by call-site row. */
export interface ImpactIndex {
  readonly entries: readonly ImpactEntry[];
  /** The row's assessment: the entry for its file, else the one for its system, else none. */
  forRow(symbol: string, system: string, file: string): Assessment | null;
  /** The system-wide entry for a symbol, which is what a summarised symbol's row shows. */
  forSystem(symbol: string, system: string): Assessment | null;
}

export function impactIndex(entries: readonly ImpactEntry[]): ImpactIndex {
  const by = new Map(entries.map((e) => [keyOf(e.symbol, e.system, e.file), e] as const));
  const get = (k: string) => {
    const e = by.get(k);
    return e === undefined ? null : { impact: e.impact, dataFlow: e.dataFlow };
  };
  return {
    entries,
    forRow: (symbol, system, file) => get(keyOf(symbol, system, file)) ?? get(keyOf(symbol, system, undefined)),
    forSystem: (symbol, system) => get(keyOf(symbol, system, undefined)),
  };
}

/** The entries that cover no call-site row at all: a typo, or a symbol this head no longer has. */
export function unmatchedEntries(index: ImpactIndex, rows: readonly SystemRow[]): ImpactEntry[] {
  const present = new Set<string>();
  for (const r of rows) {
    present.add(keyOf(r.symbol, r.site.system, r.site.file));
    present.add(keyOf(r.symbol, r.site.system, undefined));
  }
  return index.entries.filter((e) => !present.has(keyOf(e.symbol, e.system, e.file)));
}
