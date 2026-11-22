// The comment. Format follows the 2026-10-28 reflection: the gut check first, everything else
// collapsed, and every figure computed rather than estimated.

import type { Composition, FileChange } from "./footprint.ts";
import { mermaidPie } from "./footprint.ts";
import { classify } from "./classify.ts";
import { structuralSummary, type StructuralReview } from "./graft.ts";
import type { BeforeMergeKind, Landing } from "./landing.ts";

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
      `**Structural:** ${s.structural} file${s.structural === 1 ? "" : "s"} changed shape` +
        ` (+${s.symbolsAdded}/-${s.symbolsRemoved}/~${s.symbolsChanged} symbols), ` +
        `${s.formatting} formatting-only.`,
      "",
    );
    if (review.breakingChanges.length > 0) {
      out.push(`- **${review.breakingChanges.length} breaking change(s).**`, "");
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
