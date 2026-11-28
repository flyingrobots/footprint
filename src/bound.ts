// The size bound on the --human report (flyingrobots/footprint#51).
//
// GitHub rejects a comment body longer than 65536 characters, and the report is posted as one
// comment. The four sections the CLI prints (composition, landing, blast radius, overlap) share
// that limit. Landing is read from the repository's own release documents and is not trimmed; the
// other three each get a budget and trim their lists to it, *stating* every omission with its
// count. The JSON Lines records are never trimmed: they carry every row the Markdown leaves out.

import { noMentions } from "./cell.ts";

/** GitHub's maximum comment body, in characters. */
export const REPORT_LIMIT = 65536;

/**
 * The smallest bound `--max-chars` accepts: the reserved budgets of composition, landing and
 * overlap (32768 together) and at least 8192 for the blast radius.
 */
export const MIN_REPORT_CHARS = 40960;

/**
 * The bound the skill runs the report at when it is posted with `footprint comment`
 * (flyingrobots/footprint#59): it leaves the marker and the Changelog 8192 characters of the
 * comment's 65536.
 */
export const COMMENT_REPORT_LIMIT = 57344;

/** What the composition section may take: its Files list is the only part that grows. */
export const COMPOSITION_BUDGET = 16384;

/**
 * What the overlap section is held to. It is rendered last, after the blast radius has already
 * been written, so its room is reserved rather than measured. A report with no overlapping pull
 * request wastes most of it; that is the price of not reordering the run.
 */
export const OVERLAP_BUDGET = 8192;

/** What the landing section may take: the steps it reads out of the repository's own documents. */
export const LANDING_BUDGET = 8192;

/** Newlines the output protocol puts between the four sections, with margin. */
const JOIN_SLACK = 16;

/**
 * The room left for the blast-radius section once composition and landing have been rendered,
 * under `limit` (`--max-chars`, REPORT_LIMIT unless given).
 * Each of the other three sections is clamped to its own budget, so with composition and landing
 * at most COMPOSITION_BUDGET and LANDING_BUDGET this is never below 32752 at the default limit,
 * and never below 8176 at MIN_REPORT_CHARS.
 */
export function blastBudget(compositionLength: number, landingLength: number, limit: number = REPORT_LIMIT): number {
  return Math.max(0, limit - compositionLength - landingLength - OVERLAP_BUDGET - JOIN_SLACK);
}

/**
 * How much of the blast radius is written out before the remainder is counted instead.
 *
 * - `symbols`: rows of the exported-symbols table. Signature-changed and removed symbols are kept
 *   before added ones.
 * - `sites`: rows of each system's call-site table, and of the summary table, and names in the
 *   lists of symbols with no call site. Rows whose mitigation is not `None needed` are kept first.
 * - `summariseAbove`: a symbol with more call sites than this, in all systems together, is
 *   summarised as a count per system instead of being listed. A name like `type` or `id`, which
 *   a data file's field gives a symbol, matches tens of thousands of whole-word sites; listing
 *   them tells a reviewer nothing a count does not. The scan still counts them all, and the
 *   record still carries each one.
 *
 * `symbols` and `sites` are the starting point: the CLI halves the larger section until the
 * report fits. `summariseAbove` is never shrunk.
 */
export interface BlastLimits {
  readonly symbols: number;
  readonly sites: number;
  readonly summariseAbove: number;
}

export const BLAST_LIMITS: BlastLimits = { symbols: 100, sites: 100, summariseAbove: 50 };

/** No trimming at all: what the section was before the bound, and what the tests measure against. */
export const UNBOUNDED_BLAST: BlastLimits = { symbols: Infinity, sites: Infinity, summariseAbove: Infinity };

/** A rendering and how many characters each of its trimmable sections took. */
export interface Rendered<K extends string> {
  readonly text: string;
  readonly sizes: Readonly<Record<K, number>>;
}

/**
 * Render with `start` limits; while the text is over `budget`, halve the limit of the section that
 * took the most characters (ties by key order) and render again. Deterministic: the same input and
 * budget give the same text. Stops when every limit is zero, returning that rendering, which may
 * still be over the budget when what is left is not trimmable; the caller says so.
 */
export function shrinkToFit<K extends string>(
  start: Readonly<Record<K, number>>,
  build: (limits: Readonly<Record<K, number>>) => Rendered<K>,
  budget: number,
): Rendered<K> {
  let limits = { ...start };
  // Measured as posted: escaped, so the space noMentions adds after each @ counts against the
  // budget instead of overrunning it (flyingrobots/footprint#78).
  const escaped = (r: Rendered<K>): Rendered<K> => ({ ...r, text: noMentions(r.text) });
  let out = escaped(build(limits));
  const keys = Object.keys(start) as K[];
  while (out.text.length > budget) {
    const open = keys.filter((k) => limits[k] > 0);
    if (open.length === 0) break;
    const largest = open.reduce((a, b) => (out.sizes[b] > out.sizes[a] ? b : a));
    const current = limits[largest];
    // An unlimited section is first cut to what it actually printed, so halving means something.
    const next = Number.isFinite(current) ? Math.floor(current / 2) : Math.max(0, Math.floor(out.sizes[largest] / 2));
    limits = { ...limits, [largest]: next };
    out = escaped(build(limits));
  }
  return out;
}

/**
 * The last resort, which makes the bound total: whatever a section's lists were cut to, text over
 * `max` is cut again here, at a line boundary, so no input can exceed it. Any `<details>` the cut
 * left open is closed, and the end says how many characters were cut and from what, so even this
 * is never silent. Reached only by a section that is not a list, or by lists whose cut-to-nothing
 * form is still too long.
 */
export function clamp(raw: string, max: number, what: string): string {
  // Cut as posted, escaped (flyingrobots/footprint#78); escaping again later changes nothing.
  const text = noMentions(raw);
  if (text.length <= max) return text;
  const notice = (cut: number): string =>
    `<sub>${cut} character${cut === 1 ? "" : "s"} of ${what} omitted to keep the comment under GitHub's ${REPORT_LIMIT}-character limit.</sub>`;
  let keep = Math.max(0, max - 400);
  for (;;) {
    let prefix = text.slice(0, keep);
    const newline = prefix.lastIndexOf("\n");
    if (newline > 0) prefix = prefix.slice(0, newline);
    const open = Math.max(0, (prefix.match(/<details>/g) ?? []).length - (prefix.match(/<\/details>/g) ?? []).length);
    const out = `${prefix}\n\n${"</details>\n\n".repeat(open)}${notice(text.length - prefix.length)}`;
    if (out.length <= max) return out;
    if (keep === 0) return notice(text.length).slice(0, max);
    keep = Math.max(0, keep - Math.max(1, out.length - max));
  }
}
