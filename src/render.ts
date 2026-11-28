// The comment. Format follows the 2026-10-28 reflection: the gut check first, everything else
// collapsed, and every figure computed rather than estimated.

import type { Composition, FileChange } from "./footprint.ts";
import { mermaidPie } from "./footprint.ts";
import { classify } from "./classify.ts";
import { structuralSummary, type StructuralReview } from "./graft.ts";
import type { BeforeMergeKind, Landing } from "./landing.ts";
import type { Exports, ExportedSymbol } from "./exports.ts";
import { surfaceCallSiteRows } from "./exports.ts";
import { MITIGATION_RULE, NONE_NEEDED, SYSTEM_RULE_DETAIL, groupBySystem, type SystemGroup, type SystemRow } from "./systems.ts";
import type { UnsupportedLanguage } from "./languages.ts";
import type { Overlap } from "./overlap.ts";
import type { SymbolLevel } from "./symbols.ts";
import { IMPACT_COLUMNS, IMPACT_NOTE, NOT_ASSESSED, type ImpactIndex } from "./impact.ts";
import { cellText, noMentions } from "./cell.ts";
import { BLAST_LIMITS, COMPOSITION_BUDGET, LANDING_BUDGET, REPORT_LIMIT, clamp, shrinkToFit, type BlastLimits, type Rendered } from "./bound.ts";

export interface GutCheck {
  readonly headline: string;
  readonly flags: readonly string[];
}

/**
 * The one line a reviewer reads. Flags are observations, never verdicts: a large change is not
 * automatically a risky one, and this must not become a gate people game.
 */
export function gutCheck(c: Composition, largeFileCount = 40): GutCheck {
  const lines = c.added + c.removed;
  const headline = `${c.files} file${c.files === 1 ? "" : "s"}, +${c.added}/-${c.removed}`;
  const flags: string[] = [];

  const source = c.byCategory.find((x) => x.category === "source");
  const test = c.byCategory.find((x) => x.category === "test");
  const generated = c.byCategory.find((x) => x.category === "generated");

  if (c.files >= largeFileCount) {
    flags.push(`**${c.files} files changed.** Worth checking this is the change you meant to make.`);
  }
  if (source !== undefined && test === undefined) {
    flags.push("**Source changed, no tests changed.** Intentional, or missing?");
  }
  if (generated !== undefined && generated.share >= 50) {
    flags.push(
      `**${generated.share}% of changed lines are generated or vendored.** Review the ${
        lines - generated.added - generated.removed
      } hand-written lines; skim the rest.`,
    );
  }
  if (c.byCategory.length === 1 && c.byCategory[0]?.category === "docs") {
    flags.push("Documentation only. No executable surface touched.");
  }
  return { headline, flags };
}

function table(c: Composition): string {
  const head = "| Kind | Files | +/- | Share |\n| --- | ---: | ---: | ---: |";
  const rows = c.byCategory.map(
    (r) => `| ${r.category} | ${r.files} | +${r.added}/-${r.removed} | ${r.share}% |`,
  );
  // Computed like each row's share (flyingrobots/footprint#67): a change with no changed lines
  // has 0% of nothing, not 100%.
  const totalShare = c.added + c.removed === 0 ? 0 : 100;
  const total = `| **total** | **${c.files}** | **+${c.added}/-${c.removed}** | **${totalShare}%** |`;
  return [head, ...rows, total].join("\n");
}

function details(summary: string, body: string): string {
  // A blank line after <details> is required or GitHub renders the body as raw HTML.
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function render(
  c: Composition,
  changes: readonly FileChange[],
  range: string,
  review?: StructuralReview | null,
  budget: number = COMPOSITION_BUDGET,
): string {
  const fit = shrinkToFit({ files: FILES_SHOWN, formatting: FORMATTING_SHOWN }, (l) => renderComposition(c, changes, range, review, l.files, l.formatting), budget);
  return clamp(fit.text, budget, "the composition section");
}

/** How many formatting-labelled paths the structural note names before it counts the rest. */
const FORMATTING_SHOWN = 20;

/** How many files the Files list names before it counts the rest. */
const FILES_SHOWN = 200;

function renderComposition(
  c: Composition,
  changes: readonly FileChange[],
  range: string,
  review: StructuralReview | null | undefined,
  filesLimit: number,
  formattingLimit: number,
): Rendered<"files" | "formatting"> {
  const gut = gutCheck(c);
  const out: string[] = ["## Footprint", "", `**${gut.headline}** · \`${range}\``, ""];
  if (gut.flags.length > 0) out.push(...gut.flags.map((f) => `- ${f}`), "");

  let formattingSize = 0;
  if (review != null) {
    const s = structuralSummary(review);
    const symbols = s.symbolsAdded + s.symbolsRemoved + s.symbolsChanged;
    out.push(
      `**Structural**, as \`graft struct review\` reads it: ${s.structural} file${s.structural === 1 ? "" : "s"} changed shape` +
        ` (+${s.symbolsAdded}/-${s.symbolsRemoved}/~${s.symbolsChanged} symbols), ` +
        `${s.formatting} labelled \`formatting\`.`,
      "",
    );
    const formatting = review.files.filter((f) => f.category === "formatting");
    if (formatting.length > 0) {
      const shown = formatting.slice(0, Math.max(0, formattingLimit));
      const left = formatting.length - shown.length;
      const names = shown.map((f) => `\`${f.path}\``).join(", ") +
        (left > 0 ? `${shown.length > 0 ? ", and " : ""}${left} more formatting-labelled file${left === 1 ? "" : "s"} omitted (the \`files\` field of the receipt and graft's own output name every one)` : "");
      const note =
        `- graft's label, not footprint's claim: it saw no symbol added, removed or changed in ` +
        `${names}. A changed value inside an existing symbol ` +
        `(a rule table, a constant) can carry that label, so read the diff.`;
      formattingSize = note.length;
      out.push(note, "");
    }
    if (review.breakingChanges.length > 0) {
      out.push(`- **${review.breakingChanges.length} breaking change(s)**, as \`graft struct review\` lists them.`, "");
    }
    if (symbols === 0 && s.structural === 0) {
      out.push("- No symbol was added, removed or changed. Nothing's public shape moved.", "");
    }
  } else {
    out.push("<sub>Structural analysis unavailable: graft could not be resolved.</sub>", "");
  }

  const pie = mermaidPie(c);
  if (pie !== "") out.push(details("Composition", `${pie}\n\n${table(c)}`), "");

  const byCategory = new Map<string, FileChange[]>();
  for (const f of changes) {
    const k = classify(f.path);
    byCategory.set(k, [...(byCategory.get(k) ?? []), f]);
  }
  // The list is cut at `filesLimit` files, in the order it would be printed, and the cut is
  // stated with its count: a reviewer must not read a short list as the whole change.
  let room = filesLimit;
  const groups: string[] = [];
  for (const [k, fs] of byCategory.entries()) {
    const shown = fs.slice(0, Math.max(0, room));
    room -= shown.length;
    if (shown.length === 0) continue;
    groups.push(`**${k}**\n\n${shown.map((f) => `- \`${f.path}\` ${f.binary ? "(binary)" : `+${f.added}/-${f.removed}`}`).join("\n")}`);
  }
  const omitted = Math.max(0, changes.length - filesLimit);
  if (omitted > 0) {
    groups.push(`<sub>${omitted} more file${omitted === 1 ? "" : "s"} omitted to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; the \`files\` field of the receipt carries every one.</sub>`);
  }
  const listing = groups.join("\n\n");
  const listed = listing === "" ? "" : details(`Files (${c.files})`, listing);
  if (listed !== "") out.push(listed, "");

  out.push("<sub>Figures computed from `git diff --numstat`. Composition is a sanity check, not a verdict.</sub>");
  return { text: out.join("\n"), sizes: { files: listed.length, formatting: formattingSize } };
}

const BEFORE_MERGE_LABEL: Record<BeforeMergeKind, string> = {
  migration: "Migration.",
  generated: "Generated files.",
  regenerate: "May need regenerating.",
};

/**
 * The two landing sections of the comment. Separate from `render` and from the composition result:
 * one says what the change is, this says what it takes to land it. The unguarded warning is a
 * GitHub alert because it is the one line here a reader must not scroll past — it is still an
 * observation about paths, not a verdict, and the sentence says which rule found it.
 */
export function renderLanding(l: Landing, budget: number = LANDING_BUDGET): string {
  return clamp(shrinkToFit({ rows: LANDING_ROWS_SHOWN }, (x) => landingSection(l, x.rows), budget).text, budget, "the landing section");
}

/** How many before-merge items and after-merge steps are written out before the rest are counted. */
const LANDING_ROWS_SHOWN = 50;

function landingSection(l: Landing, limit: number): Rendered<"rows"> {
  // Opens with a blank line: this follows the composition comment on the same stream, and two
  // Markdown blocks run together without one.
  const out: string[] = ["", "## Before merge", ""];
  if (l.before_merge.unguarded) {
    out.push("> [!WARNING]", `> **Nothing in this change guards it.** ${l.before_merge.unguarded_because}`, "");
  }
  for (const item of l.before_merge.items.slice(0, limit)) out.push(`- **${BEFORE_MERGE_LABEL[item.kind]}** ${item.says}`);
  const itemsLeft = l.before_merge.items.length - Math.min(limit, l.before_merge.items.length);
  if (itemsLeft > 0) out.push(`- <sub>${itemsLeft} more before-merge item${itemsLeft === 1 ? "" : "s"} omitted to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; the landing result line carries every one.</sub>`);
  if (l.before_merge.items.length > 0) out.push("");
  if (!l.before_merge.unguarded && l.before_merge.items.length === 0) out.push(`- ${l.before_merge.unguarded_because}`, "");

  out.push("## After merge", "", l.after_merge.statement, "");
  const mark = out.length;
  for (const s of l.after_merge.steps.slice(0, limit)) out.push(`- [ ] ${noMentions(s.step)} <sub>— \`${s.file}\` › ${noMentions(s.heading)}</sub>`);
  const left = l.after_merge.steps.slice(limit);
  if (left.length > 0) {
    const files = [...new Set(left.map((s) => s.file))].map((f) => `\`${f}\``).join(", ");
    out.push(`- <sub>${left.length} more step${left.length === 1 ? "" : "s"} omitted to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; read them in ${files} or in the landing result line.</sub>`);
  }
  const size = out.slice(mark).join("\n").length + out.slice(0, mark).filter((x) => x.startsWith("- **")).join("\n").length;
  if (l.after_merge.steps.length > 0) out.push("");
  out.push("<sub>After-merge steps are read from this repository's own `RELEASE.md` and `AGENTS.md`, never invented. The guard rule is path patterns, documented in footprint's `docs/topics/landing/README.md`.</sub>");
  return { text: out.join("\n"), sizes: { rows: size } };
}

// ---- blast radius (flyingrobots/footprint#9) ---------------------------------------------------

/**
 * The export-surface section of the comment. One section whatever the outcome: a list when
 * symbols moved, a sentence when none did, and the stated reason when graft could not answer —
 * an absent section would read like a clean one.
 *
 * The section is held to `budget` characters (flyingrobots/footprint#51): when the full rendering
 * is over it, the larger of the symbols table and the call-site tables is cut in half until it
 * fits, and every cut says how many rows it left out. `limits` is where that starts.
 *
 * `impact` is the posting agent's reading of the call sites (`--impact`, flyingrobots/footprint#59):
 * given, every call-site table gains its two columns and the section says whose reading they are;
 * not given, the tables are exactly what they were. The columns count against the same budget.
 */
export function blastRadius(
  exports: Exports,
  unanalysed: readonly UnsupportedLanguage[] = [],
  budget: number = REPORT_LIMIT,
  limits: BlastLimits = BLAST_LIMITS,
  impact?: ImpactIndex,
): string {
  const start = { symbols: limits.symbols, sites: limits.sites };
  return clamp(shrinkToFit(start, (l) => blastSections(exports, unanalysed, { ...limits, ...l }, impact), budget).text, budget, "the blast-radius section");
}

/** One rendering of the section at the given limits, with how much each trimmable part took. */
function blastSections(exports: Exports, unanalysed: readonly UnsupportedLanguage[], limits: BlastLimits, impact: ImpactIndex | undefined): Rendered<"symbols" | "sites"> {
  const out: string[] = ["## Blast radius", ""];
  const sizes = { symbols: 0, sites: 0 };
  if (!exports.available) {
    out.push(
      `<sub>Export-surface diff unavailable (\`${exports.reason.code}\`): ${exports.reason.detail}.</sub>`,
      "",
      FROM_GRAFT,
      "",
      unanalysedSection(unanalysed),
    );
    return { text: out.join("\n"), sizes };
  }

  const s = exports.surface;
  const rows = [
    ...s.added.map((x) => ["added", x] as const),
    ...s.removed.map((x) => ["removed", x] as const),
    ...s.signatureChanged.map((x) => ["signature-changed", x] as const),
  ];
  const scan = s.callSiteScan;
  out.push(
    `**+${s.added.length} added / -${s.removed.length} removed / ~${s.signatureChanged.length} signature-changed exported symbols**` +
      ` · \`${s.base}\` → \`${s.head}\`` +
      (s.semverImpact === null ? "" : ` · \`graft struct exports\` reads this as a **${s.semverImpact}** change`),
    "",
  );
  if (rows.length === 0) {
    out.push("- No exported symbol was added, removed or re-signed.", "");
  } else {
    const head = scan.available
      ? "| Change | Symbol | File | Kind | Call sites | Signature |\n| --- | --- | --- | --- | ---: | --- |"
      : "| Change | Symbol | File | Kind | Signature |\n| --- | --- | --- | --- | --- |";
    // Past the limit the table keeps the symbols whose change matters most -- signature-changed,
    // then removed, then added -- and prints them in the order the full table would.
    const kept = keepFirst(rows, limits.symbols, ([change]) => (change === "signature-changed" ? 0 : change === "removed" ? 1 : 2));
    const body = kept.map(([change, x]) =>
      `| ${change} | \`${x.symbol}\` | \`${x.file}\` | ${x.kind ?? ""} | ` +
      (scan.available ? `${x.callSites === undefined ? "—" : x.callSites.length} | ` : "") +
      `${cell(x.previousSignature === undefined ? x.signature : `${x.previousSignature} → ${x.signature ?? ""}`)} |`,
    );
    const left = rows.length - kept.length;
    const parts = [...(body.length > 0 ? [[head, ...body].join("\n")] : [])];
    if (left > 0) {
      parts.push(
        `<sub>${left} more exported symbol${left === 1 ? "" : "s"} omitted (${kept.length} of ${rows.length} shown, signature-changed and removed first) ` +
          `to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; the blast-radius result line carries every one.</sub>`,
      );
    }
    const block = details(`Exported symbols (${rows.length})`, parts.join("\n\n"));
    sizes.symbols = block.length;
    out.push(block, "");
  }

  // The call sites themselves, grouped by system: one table per system
  // (flyingrobots/footprint#11). Collapsed, because this is the longest part of the comment, and
  // stated when the scan could not run: an absent list would read as a symbol nothing calls.
  if (!scan.available) {
    out.push(`<sub>Call sites not listed (\`${scan.reason.code}\`): ${scan.reason.detail}.</sub>`, "");
  } else if (rows.length > 0) {
    const siteRows = surfaceCallSiteRows(s);
    const groups = groupBySystem(siteRows);
    const total = rows.reduce((n, [, x]) => n + (x.callSites?.length ?? 0), 0);
    const heavy = heavySymbols(siteRows, limits.summariseAbove);
    const body = [
      ...(heavy.length > 0 ? [heavyTable(heavy, limits.summariseAbove, limits.sites, impact)] : []),
      ...groups.map((g) => systemTable(g, limits.sites, new Set(heavy.map((h) => h.symbol)), impact)),
      ...unreferenced(rows.map(([, x]) => x), limits.sites),
    ].join("\n\n");
    const summary =
      `Call sites by system (${total} across ${groups.length} system${groups.length === 1 ? "" : "s"}, ` +
      `${scan.filesScanned} scanned file${scan.filesScanned === 1 ? "" : "s"})`;
    const block = details(summary, body);
    sizes.sites = block.length;
    out.push(block, "");
    if (impact !== undefined) out.push(IMPACT_NOTE, "");
  }

  out.push(FROM_GRAFT);
  if (scan.available) out.push("", FROM_SCAN, "", FROM_GROUPING);
  out.push("", unanalysedSection(unanalysed));
  return { text: out.join("\n"), sizes };
}

/**
 * The first `limit` items by `priority` (lower first, ties by position), returned in their
 * original order, so a cut table reads like the full one with rows missing rather than reordered.
 */
function keepFirst<T>(items: readonly T[], limit: number, priority: (item: T) => number): T[] {
  if (items.length <= limit) return [...items];
  const chosen = items
    .map((item, index) => ({ index, p: priority(item) }))
    .sort((a, b) => a.p - b.p || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((x) => x.index)
    .sort((a, b) => a - b);
  return chosen.map((i) => items[i]!);
}

/** A symbol with more call sites than the summarising threshold, and what it comes to per system. */
interface HeavySymbol {
  readonly symbol: string;
  readonly total: number;
  readonly bySystem: ReadonlyMap<string, number>;
  /** Call sites whose mitigation is not `None needed`: the ones the skill asks a reader to check. */
  readonly needLook: number;
}

function heavySymbols(rows: readonly SystemRow[], above: number): HeavySymbol[] {
  if (!Number.isFinite(above)) return [];
  const by = new Map<string, { total: number; bySystem: Map<string, number>; needLook: number }>();
  for (const r of rows) {
    const e = by.get(r.symbol) ?? { total: 0, bySystem: new Map<string, number>(), needLook: 0 };
    e.total += 1;
    e.bySystem.set(r.site.system, (e.bySystem.get(r.site.system) ?? 0) + 1);
    if (r.site.mitigation !== NONE_NEEDED) e.needLook += 1;
    by.set(r.symbol, e);
  }
  return [...by.entries()]
    .filter(([, e]) => e.total > above)
    .map(([symbol, e]) => ({ symbol, ...e }))
    .sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));
}

/**
 * The symbols too widely matched to list: one row each, with the count per system. A name such as
 * `type` is a whole-word match in nearly every file, so its sites are not evidence of reach; the
 * count says so, and the result line still carries every site.
 */
function heavyTable(heavy: readonly HeavySymbol[], above: number, limit: number, impact: ImpactIndex | undefined): string {
  const shown = heavy.slice(0, Math.max(0, limit));
  const rows = shown.map((h) => {
    const systems = [...h.bySystem.entries()].sort(([a], [b]) => a.localeCompare(b));
    const per = systems.map(([sys, n]) => `\`${sys}\` ${n}`).join(", ");
    // A summarised symbol is assessed per system: one line per system it is called in.
    const assessed = (pick: "impact" | "dataFlow") =>
      systems.map(([sys]) => `\`${sys}\`: ${cellText(impact?.forSystem(h.symbol, sys)?.[pick] ?? NOT_ASSESSED)}`).join("<br>");
    return `| \`${h.symbol}\` | ${h.total} | ${per} | ${h.needLook} |` + (impact === undefined ? "" : ` ${assessed("impact")} | ${assessed("dataFlow")} |`);
  });
  const out = [
    `**Symbols with more than ${above} call sites** — counted by system instead of listed, because a name that common matches whole-word almost anywhere. The result line carries every site.`,
  ];
  const head = impact === undefined
    ? "| Symbol | Call sites | By system | Not `None needed` |\n| --- | ---: | --- | ---: |"
    : `| Symbol | Call sites | By system | Not \`None needed\` | ${IMPACT_COLUMNS.impact} | ${IMPACT_COLUMNS.dataFlow} |\n| --- | ---: | --- | ---: | --- | --- |`;
  if (rows.length > 0) out.push("", `${head}\n${rows.join("\n")}`);
  const left = heavy.length - shown.length;
  if (left > 0) {
    out.push("", `<sub>${left} more symbol${left === 1 ? "" : "s"} with more than ${above} call sites omitted; the blast-radius result line carries every one.</sub>`);
  }
  return out.join("\n");
}

/**
 * How many call sites of one symbol are spelled out inside one system's table before the comment
 * just says how many more there are. The result line carries every one of them; this is a
 * pull-request comment, and a symbol with four hundred call sites would bury everything else in
 * it. The remainder is a sentence under the table rather than a row, because a row with nothing in
 * its mitigation cell is exactly the padded row flyingrobots/footprint#11 forbids.
 */
const CALL_SITES_SHOWN = 20;

/** How many symbols one system's table names a capped remainder for, before counting the rest together. */
const NOTES_SHOWN = 10;

/**
 * One system, one table: a row per call site, each with the mitigation its basis derived. Symbols
 * in `skip` are the summarised ones and have no row here. At most `limit` rows are written; the
 * ones with a mitigation other than `None needed` are kept first, and the rest are counted.
 */
function systemTable(group: SystemGroup, limit: number, skip: ReadonlySet<string>, impact: ImpactIndex | undefined): string {
  const head = impact === undefined
    ? "| Symbol | Call site | Mitigation |\n| --- | --- | --- |"
    : `| Symbol | Call site | Mitigation | ${IMPACT_COLUMNS.impact} | ${IMPACT_COLUMNS.dataFlow} |\n| --- | --- | --- | --- | --- |`;
  const candidates: SystemRow[] = [];
  const elided = new Map<string, number>();
  let symbol: string | null = null;
  let shown = 0;
  let summarised = 0;
  for (const row of group.rows) {
    if (skip.has(row.symbol)) {
      summarised += 1;
      continue;
    }
    if (row.symbol !== symbol) {
      symbol = row.symbol;
      shown = 0;
    }
    shown += 1;
    if (shown <= CALL_SITES_SHOWN) candidates.push(row);
    else elided.set(row.symbol, (elided.get(row.symbol) ?? 0) + 1);
  }
  const kept = keepFirst(candidates, limit, (r) => (r.site.mitigation === NONE_NEEDED ? 1 : 0));
  const assessed = (row: SystemRow): string => {
    if (impact === undefined) return "";
    const a = impact.forRow(row.symbol, row.site.system, row.site.file);
    return ` ${cellText(a?.impact ?? NOT_ASSESSED)} | ${cellText(a?.dataFlow ?? NOT_ASSESSED)} |`;
  };
  const body = kept.map((row) => `| \`${row.symbol}\` | \`${row.site.file}:${row.site.line}\` | ${pipes(row.site.mitigation)} |${assessed(row)}`);
  const title = `**\`${group.system}\`** — ${group.rows.length} call site${group.rows.length === 1 ? "" : "s"}`;
  const notes: string[] = [];
  // One note per capped symbol, up to NOTES_SHOWN of them and never more than the row limit; the
  // symbols past that are counted together, so the total of omitted sites stays exact.
  const all = [...elided.entries()];
  const noted = all.slice(0, Math.max(0, Math.min(limit, NOTES_SHOWN)));
  const rest = noted.map(([sym, n]) => `…and ${n} more for \`${sym}\``);
  const more = all.slice(noted.length);
  if (more.length > 0) {
    const sites = more.reduce((n, [, c]) => n + c, 0);
    rest.push(`…and ${sites} more call site${sites === 1 ? "" : "s"} for ${more.length} more symbol${more.length === 1 ? "" : "s"}`);
  }
  if (rest.length > 0) notes.push(`${rest.join(", ")}; the result line carries every one.`);
  if (summarised > 0) notes.push(`${summarised} call site${summarised === 1 ? "" : "s"} here belong to the symbols counted above rather than listed.`);
  const left = candidates.length - kept.length;
  if (left > 0) {
    const look = candidates.filter((r) => r.site.mitigation !== NONE_NEEDED).length - kept.filter((r) => r.site.mitigation !== NONE_NEEDED).length;
    notes.push(
      `${left} more call site${left === 1 ? "" : "s"} in this system omitted (${look} of them with a mitigation other than \`${NONE_NEEDED}\`) ` +
        `to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; the blast-radius result line carries every one.`,
    );
  }
  return [title, "", ...(body.length > 0 ? [head, ...body] : []), ...(notes.length === 0 ? [] : ["", `<sub>${notes.join(" ")}</sub>`])].join("\n");
}

/**
 * The symbols with no call site at all. They belong to no system, so no table holds them, and
 * leaving them out would read as a symbol that was never looked up — which is a different claim
 * from one nothing references.
 */
function unreferenced(symbols: readonly ExportedSymbol[], limit: number): string[] {
  const none = symbols.filter((x) => x.callSites !== undefined && x.callSites.length === 0).map((x) => `\`${x.symbol}\``);
  const missing = symbols.filter((x) => x.callSites === undefined).map((x) => `\`${x.symbol}\``);
  const names = (all: readonly string[]): string => {
    const shown = all.slice(0, Math.max(0, limit));
    const left = all.length - shown.length;
    if (left === 0) return shown.join(", ");
    return `${shown.length > 0 ? `${shown.join(", ")} and ` : ""}${left} more omitted (the blast-radius result line names every one)`;
  };
  const out: string[] = [];
  if (none.length > 0) out.push(`<sub>No call site found in the tracked files for ${names(none)}.</sub>`);
  if (missing.length > 0) out.push(`<sub>Not scanned, and so in no system: ${names(missing)}. The scan carries no entry for them.</sub>`);
  return out;
}

/** A table cell cannot carry a pipe. Mitigations are derived from paths, which may hold one. */
function pipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

const FROM_GROUPING = `<sub>**The grouping.** ${SYSTEM_RULE_DETAIL} **The mitigations.** ${MITIGATION_RULE}</sub>`;

const FROM_SCAN =
  "<sub>Call sites are footprint's own whole-word identifier scan, not graft's: every whole-word occurrence of the name in the tracked, non-binary files of the working tree (`grep -w`'s boundary -- a letter, digit or underscore in any script). It counts the declaration itself and a mention in a comment, a string or prose, and it cannot see a call through dynamic dispatch or a re-export under another name. Evidence to check, not a call graph.</sub>";

/**
 * The languages this change could not have been symbol-analysed in, independent of whether graft
 * itself ran: present whether the exports section above succeeded, failed, or was unavailable
 * (flyingrobots/footprint#12).
 */
function unanalysedSection(unanalysed: readonly UnsupportedLanguage[]): string {
  if (unanalysed.length === 0) {
    return "<sub>Every changed source file was in a language footprint recognises graft's grammars can parse.</sub>";
  }
  const total = unanalysed.reduce((n, u) => n + u.count, 0);
  const byExtension = unanalysed.map((u) => `${u.count} \`${u.extension}\``).join(", ");
  return `**${total} changed file${total === 1 ? "" : "s"} in unanalysed language${unanalysed.length === 1 ? "" : "s"}:** ${byExtension}.`;
}

const FROM_GRAFT =
  "<sub>Exported symbols from `graft struct exports --json` (`graft.cli.struct_exports` 1.0.0). Whatever graft parses counts as an export surface, including fields in config and lock files.</sub>";

/** A signature is verbatim in the result; a table cell cannot carry its newlines or pipes. */
function cell(signature: string | undefined): string {
  if (signature === undefined) return "";
  return `\`${signature.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()}\``;
}

/**
 * The cross-pull-request section of the comment, rendered from the same record the
 * `footprint.overlap` result carries. It is its own section with its own provenance note, so the
 * composition section above stays exactly what it was.
 */
export function renderOverlap(o: Overlap, budget: number = REPORT_LIMIT): string {
  return clamp(shrinkToFit({ pulls: PULLS_SHOWN }, (l) => overlapSection(o, l.pulls), budget).text, budget, "the overlap section");
}

/** How many pull requests, conflicts and waves the overlap section names before it counts the rest. */
const PULLS_SHOWN = 50;
/** How many shared files one overlapping pull request lists. */
const SHARED_FILES_SHOWN = 10;
/** How many symbols of one side of one shared file the section names. */
const SYMBOLS_SHOWN = 5;

/**
 * The symbol level of one overlap or edge, one nested bullet per shared file: the symbols each
 * side changes when disjoint, the shared ones when overlapping, the reason when undetermined.
 * Bounded like the file list it sits under, and each cut says how many it left out.
 */
function symbolLines(level: SymbolLevel, a: string, b: string, limit: number, indent: string): string[] {
  const cap = Math.min(limit, SHARED_FILES_SHOWN);
  const names = (xs: readonly string[]): string => {
    if (xs.length === 0) return "no symbol";
    const shown = xs.slice(0, Math.min(limit, SYMBOLS_SHOWN));
    const left = xs.length - shown.length;
    return shown.map((x) => `\`${x}\``).join(", ") + (left > 0 ? ` and ${left} more` : "");
  };
  const out = level.files.slice(0, cap).map((f) => {
    const via = f.github === undefined ? "" : ` <sub>(${f.github.map((x) => (x === "a" ? a : b)).join(" and ")} read over the GitHub API)</sub>`;
    if (f.level === "symbol-disjoint") return `${indent}- \`${f.path}\`: different symbols — ${a} ${names(f.a!.symbols)}; ${b} ${names(f.b!.symbols)}${via}`;
    if (f.level === "symbol-overlapping") return `${indent}- \`${f.path}\`: the same symbols — ${names(f.shared!)}${via}`;
    return `${indent}- \`${f.path}\`: symbol level undetermined — ${f.reason}`;
  });
  const left = level.files.length - Math.min(level.files.length, cap);
  if (left > 0) out.push(`${indent}- <sub>${left} more shared file${left === 1 ? "" : "s"} at the symbol level omitted; the overlap result line carries every one.</sub>`);
  return out;
}

function overlapSection(o: Overlap, limit: number): Rendered<"pulls"> {
  // The leading blank line keeps the heading off the end of the composition section above it.
  const out: string[] = ["", "### Open pull requests", ""];
  const omitted = (n: number, what: string): string =>
    `<sub>${n} more ${what} omitted to keep the comment under GitHub's ${REPORT_LIMIT}-character limit; the overlap result line carries every one.</sub>`;

  if (!o.available) {
    out.push(`<sub>${o.summary}</sub>`);
    const text = out.join("\n");
    return { text, sizes: { pulls: 0 } };
  }

  out.push(`**${o.summary}**`, "");

  const files = (fs: readonly string[]): string => {
    const shown = fs.slice(0, Math.min(limit, SHARED_FILES_SHOWN));
    const left = fs.length - shown.length;
    return shown.map((f) => `\`${f}\``).join(", ") + (left > 0 ? ` and ${left} more file${left === 1 ? "" : "s"}` : "");
  };
  for (const p of o.overlapping.slice(0, limit)) {
    out.push(`- **#${p.number}** ${noMentions(p.title)}${p.isDraft ? " _(draft)_" : ""} — ${files(p.sharedFiles)}`);
    out.push(...symbolLines(p.symbolLevel, "this change", `#${p.number}`, limit, "  "));
  }
  if (o.overlapping.length > limit) out.push("", omitted(o.overlapping.length - limit, `pull request${o.overlapping.length - limit === 1 ? "" : "s"}`));
  if (o.overlapping.length > 0) out.push("");

  for (const u of o.undetermined.slice(0, limit)) out.push(`- **#${u.number}** ${noMentions(u.title)} — files unknown: ${u.reason}`);
  if (o.undetermined.length > limit) out.push("", omitted(o.undetermined.length - limit, `pull requests whose files are unknown`));
  if (o.undetermined.length > 0) out.push("");

  if (o.waves.length > 0) {
    const waves = o.waves
      .slice(0, limit)
      .map((w) => `**Wave ${w.wave}** — ${w.pullRequests.map((n) => `#${n}`).join(", ")}${w.wave === 1 ? "" : `, after wave ${w.wave - 1}`}`)
      .join("\n\n");
    const edges = o.conflicts.length === 0
      ? "No two open pull requests change the same file, so they can land in any order."
      : o.conflicts.slice(0, limit).map((c) => [`- ${c.reason}`, ...symbolLines(c.symbolLevel, `#${c.a}`, `#${c.b}`, limit, "  ")].join("\n")).join("\n");
    const notes = [
      ...(o.waves.length > limit ? [omitted(o.waves.length - limit, `wave${o.waves.length - limit === 1 ? "" : "s"}`)] : []),
      ...(o.conflicts.length > limit ? [omitted(o.conflicts.length - limit, `conflict${o.conflicts.length - limit === 1 ? "" : "s"}`)] : []),
    ];
    const disjoint = o.conflicts.filter((c) => c.symbolLevel.level === "symbol-disjoint").length;
    const rule = disjoint === 0 ? "" : `<sub>${disjoint} symbol-disjoint edge${disjoint === 1 ? " is" : "s are"} listed but ${disjoint === 1 ? "does" : "do"} not separate waves; that is not a claim git will merge the two cleanly.</sub>`;
    out.push(details(`Proposed merge order (${o.waves.length} wave${o.waves.length === 1 ? "" : "s"})`, [waves, edges, rule, ...notes].filter((x) => x !== "").join("\n\n")), "");
  }

  if (o.truncated) out.push(`<sub>The pull-request list came back at the ${o.limit}-request limit; there may be more.</sub>`, "");
  out.push("<sub>Pull requests from `gh pr list`; their files from `gh pr diff --name-only`; the symbols of a shared file from `git diff -U0` against each side's merge base and the top-level symbols of `graft read outline` at both ends" +
    ` (${o.symbolAnalysis.outlinesRun} of at most ${o.symbolAnalysis.outlineBudget} outline calls${o.symbolAnalysis.remoteCalls > 0 ? ` and ${o.symbolAnalysis.remoteCalls} read-only \`gh api\` calls for pull requests not in the clone` : ""} this run). Merge waves are greedy first-fit over the conflict graph: a proposal, not a minimum, and not a gate.</sub>`);
  const text = out.join("\n");
  return { text, sizes: { pulls: text.length } };
}
