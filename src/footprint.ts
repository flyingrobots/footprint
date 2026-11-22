// Composition of a change. Every figure here is computed from the file list; nothing is
// estimated. A footprint that reports a number it did not derive is worse than no footprint,
// because it is believed.

import { classify, type Category } from "./classify.ts";

export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  /** Binary files report no line counts. */
  readonly binary: boolean;
}

export interface CategoryTotal {
  readonly category: Category;
  readonly files: number;
  readonly added: number;
  readonly removed: number;
  /** Share of total changed lines, 0-100, rounded to one decimal. */
  readonly share: number;
}

export interface Composition {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
  readonly binaryFiles: number;
  readonly byCategory: readonly CategoryTotal[];
}

const ORDER: readonly Category[] = ["source", "test", "docs", "config", "ci", "generated", "assets"];

export function compose(changes: readonly FileChange[]): Composition {
  const buckets = new Map<Category, { files: number; added: number; removed: number }>();
  let added = 0;
  let removed = 0;
  let binaryFiles = 0;

  for (const change of changes) {
    const category = classify(change.path);
    const bucket = buckets.get(category) ?? { files: 0, added: 0, removed: 0 };
    bucket.files += 1;
    bucket.added += change.added;
    bucket.removed += change.removed;
    buckets.set(category, bucket);
    added += change.added;
    removed += change.removed;
    if (change.binary) binaryFiles += 1;
  }

  const totalLines = added + removed;
  const byCategory = ORDER.filter((c) => buckets.has(c)).map((category) => {
    const b = buckets.get(category)!;
    const lines = b.added + b.removed;
    return {
      category,
      files: b.files,
      added: b.added,
      removed: b.removed,
      // Guard the zero case: a pure rename or mode change has files but no lines.
      share: totalLines === 0 ? 0 : Math.round((lines / totalLines) * 1000) / 10,
    };
  });

  return { files: changes.length, added, removed, binaryFiles, byCategory };
}

/** `git diff --numstat` output. Binary files appear as `-\t-\tpath`. */
export function parseNumstat(numstat: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of numstat.split("\n")) {
    if (line.trim() === "") continue;
    const [a, r, ...rest] = line.split("\t");
    if (a === undefined || r === undefined || rest.length === 0) continue;
    // A rename reads `old => new`; git already gives the new path last.
    const path = rest.join("\t");
    const binary = a === "-" || r === "-";
    out.push({
      path,
      added: binary ? 0 : Number.parseInt(a, 10),
      removed: binary ? 0 : Number.parseInt(r, 10),
      binary,
    });
  }
  return out;
}

export function mermaidPie(composition: Composition): string {
  if (composition.byCategory.length === 0) return "";
  const rows = composition.byCategory
    .map((c) => `    "${c.category}" : ${c.added + c.removed}`)
    .join("\n");
  return ["```mermaid", "pie showData", '    title Changed lines by file kind', rows, "```"].join("\n");
}
