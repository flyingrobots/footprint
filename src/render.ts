// The comment. Format follows the 2026-10-28 reflection: the gut check first, everything else
// collapsed, and every figure computed rather than estimated.

import type { Composition, FileChange } from "./footprint.ts";
import { mermaidPie } from "./footprint.ts";
import { classify } from "./classify.ts";
import { structuralSummary, type StructuralReview } from "./graft.ts";
import type { BeforeMergeKind, Landing } from "./landing.ts";
import type { Exports, ExportedSymbol } from "./exports.ts";
import { surfaceCallSiteRows } from "./exports.ts";
import { MITIGATION_RULE, SYSTEM_RULE_DETAIL, groupBySystem, type SystemGroup } from "./systems.ts";
import type { UnsupportedLanguage } from "./languages.ts";
import type { Overlap } from "./overlap.ts";

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
  const total = `| **total** | **${c.files}** | **+${c.added}/-${c.removed}** | **100%** |`;
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
): string {
  const gut = gutCheck(c);
  const out: string[] = ["## Footprint", "", `**${gut.headline}** · \`${range}\``, ""];

  if (gut.flags.length > 0) out.push(...gut.flags.map((f) => `- ${f}`), "");

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
      out.push(
        `- graft's label, not footprint's claim: it saw no symbol added, removed or changed in ` +
          `${formatting.map((f) => `\`${f.path}\``).join(", ")}. A changed value inside an existing symbol ` +
          `(a rule table, a constant) can carry that label, so read the diff.`,
        "",
      );
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
  const listing = [...byCategory.entries()]
    .map(([k, fs]) => `**${k}**\n\n${fs.map((f) => `- \`${f.path}\` ${f.binary ? "(binary)" : `+${f.added}/-${f.removed}`}`).join("\n")}`)
    .join("\n\n");
  if (listing !== "") out.push(details(`Files (${c.files})`, listing), "");

  out.push("<sub>Figures computed from `git diff --numstat`. Composition is a sanity check, not a verdict.</sub>");
  return out.join("\n");
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
export function renderLanding(l: Landing): string {
  // Opens with a blank line: this follows the composition comment on the same stream, and two
  // Markdown blocks run together without one.
  const out: string[] = ["", "## Before merge", ""];
  if (l.before_merge.unguarded) {
    out.push("> [!WARNING]", `> **Nothing in this change guards it.** ${l.before_merge.unguarded_because}`, "");
  }
  for (const item of l.before_merge.items) out.push(`- **${BEFORE_MERGE_LABEL[item.kind]}** ${item.says}`);
  if (l.before_merge.items.length > 0) out.push("");
  if (!l.before_merge.unguarded && l.before_merge.items.length === 0) out.push(`- ${l.before_merge.unguarded_because}`, "");

  out.push("## After merge", "", l.after_merge.statement, "");
  for (const s of l.after_merge.steps) out.push(`- [ ] ${s.step} <sub>— \`${s.file}\` › ${s.heading}</sub>`);
  if (l.after_merge.steps.length > 0) out.push("");
  out.push("<sub>After-merge steps are read from this repository's own `RELEASE.md` and `AGENTS.md`, never invented. The guard rule is path patterns, documented in footprint's `docs/topics/landing/README.md`.</sub>");
  return out.join("\n");
}

// ---- blast radius (flyingrobots/footprint#9) ---------------------------------------------------

/**
 * The export-surface section of the comment. One section whatever the outcome: a list when
 * symbols moved, a sentence when none did, and the stated reason when graft could not answer —
 * an absent section would read like a clean one.
 */
export function blastRadius(exports: Exports, unanalysed: readonly UnsupportedLanguage[] = []): string {
  const out: string[] = ["## Blast radius", ""];
  if (!exports.available) {
    out.push(
      `<sub>Export-surface diff unavailable (\`${exports.reason.code}\`): ${exports.reason.detail}.</sub>`,
      "",
      FROM_GRAFT,
      "",
      unanalysedSection(unanalysed),
    );
    return out.join("\n");
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
    const body = rows.map(([change, x]) =>
      `| ${change} | \`${x.symbol}\` | \`${x.file}\` | ${x.kind ?? ""} | ` +
      (scan.available ? `${x.callSites === undefined ? "—" : x.callSites.length} | ` : "") +
      `${cell(x.previousSignature === undefined ? x.signature : `${x.previousSignature} → ${x.signature ?? ""}`)} |`,
    );
    out.push(details(`Exported symbols (${rows.length})`, [head, ...body].join("\n")), "");
  }

  // The call sites themselves, grouped by system: one table per system
  // (flyingrobots/footprint#11). Collapsed, because this is the longest part of the comment, and
  // stated when the scan could not run: an absent list would read as a symbol nothing calls.
  if (!scan.available) {
    out.push(`<sub>Call sites not listed (\`${scan.reason.code}\`): ${scan.reason.detail}.</sub>`, "");
  } else if (rows.length > 0) {
    const groups = groupBySystem(surfaceCallSiteRows(s));
    const total = rows.reduce((n, [, x]) => n + (x.callSites?.length ?? 0), 0);
    const body = [
      ...groups.map(systemTable),
      ...unreferenced(rows.map(([, x]) => x)),
    ].join("\n\n");
    const summary =
      `Call sites by system (${total} across ${groups.length} system${groups.length === 1 ? "" : "s"}, ` +
      `${scan.filesScanned} scanned file${scan.filesScanned === 1 ? "" : "s"})`;
    out.push(details(summary, body), "");
  }

  out.push(FROM_GRAFT);
  if (scan.available) out.push("", FROM_SCAN, "", FROM_GROUPING);
  out.push("", unanalysedSection(unanalysed));
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

/** One system, one table: a row per call site, each with the mitigation its basis derived. */
function systemTable(group: SystemGroup): string {
  const head = "| Symbol | Call site | Mitigation |\n| --- | --- | --- |";
  const body: string[] = [];
  const elided = new Map<string, number>();
  let symbol: string | null = null;
  let shown = 0;
  for (const row of group.rows) {
    if (row.symbol !== symbol) {
      symbol = row.symbol;
      shown = 0;
    }
    shown += 1;
    if (shown <= CALL_SITES_SHOWN) {
      body.push(`| \`${row.symbol}\` | \`${row.site.file}:${row.site.line}\` | ${pipes(row.site.mitigation)} |`);
    } else {
      elided.set(row.symbol, (elided.get(row.symbol) ?? 0) + 1);
    }
  }
  const title = `**\`${group.system}\`** — ${group.rows.length} call site${group.rows.length === 1 ? "" : "s"}`;
  const rest = [...elided.entries()].map(([sym, n]) => `…and ${n} more for \`${sym}\``);
  const tail = rest.length === 0 ? [] : ["", `<sub>${rest.join(", ")}; the result line carries every one.</sub>`];
  return [title, "", head, ...body, ...tail].join("\n");
}

/**
 * The symbols with no call site at all. They belong to no system, so no table holds them, and
 * leaving them out would read as a symbol that was never looked up — which is a different claim
 * from one nothing references.
 */
function unreferenced(symbols: readonly ExportedSymbol[]): string[] {
  const none = symbols.filter((x) => x.callSites !== undefined && x.callSites.length === 0).map((x) => `\`${x.symbol}\``);
  const missing = symbols.filter((x) => x.callSites === undefined).map((x) => `\`${x.symbol}\``);
  const out: string[] = [];
  if (none.length > 0) out.push(`<sub>No call site found in the tracked files for ${none.join(", ")}.</sub>`);
  if (missing.length > 0) out.push(`<sub>Not scanned, and so in no system: ${missing.join(", ")}. The scan carries no entry for them.</sub>`);
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
export function renderOverlap(o: Overlap): string {
  // The leading blank line keeps the heading off the end of the composition section above it.
  const out: string[] = ["", "### Open pull requests", ""];

  if (!o.available) {
    out.push(`<sub>${o.summary}</sub>`);
    return out.join("\n");
  }

  out.push(`**${o.summary}**`, "");

  for (const p of o.overlapping) {
    out.push(`- **#${p.number}** ${p.title}${p.isDraft ? " _(draft)_" : ""} — ${p.sharedFiles.map((f) => `\`${f}\``).join(", ")}`);
  }
  if (o.overlapping.length > 0) out.push("");

  for (const u of o.undetermined) out.push(`- **#${u.number}** ${u.title} — files unknown: ${u.reason}`);
  if (o.undetermined.length > 0) out.push("");

  if (o.waves.length > 0) {
    const waves = o.waves
      .map((w) => `**Wave ${w.wave}** — ${w.pullRequests.map((n) => `#${n}`).join(", ")}${w.wave === 1 ? "" : `, after wave ${w.wave - 1}`}`)
      .join("\n\n");
    const edges = o.conflicts.length === 0
      ? "No two open pull requests change the same file, so they can land in any order."
      : o.conflicts.map((c) => `- ${c.reason}`).join("\n");
    out.push(details(`Proposed merge order (${o.waves.length} wave${o.waves.length === 1 ? "" : "s"})`, `${waves}\n\n${edges}`), "");
  }

  if (o.truncated) out.push(`<sub>The pull-request list came back at the ${o.limit}-request limit; there may be more.</sub>`, "");
  out.push("<sub>Pull requests from `gh pr list`; their files from `gh pr diff --name-only`. Merge waves are greedy first-fit over the conflict graph: a proposal, not a minimum, and not a gate.</sub>");
  return out.join("\n");
}
