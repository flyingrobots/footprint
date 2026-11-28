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

/**
 * `git diff --numstat -z` output (flyingrobots/footprint#66). Each record is
 * `added\tremoved\tpath\0`, or for a rename or copy `added\tremoved\t\0old\0new\0`; a binary file
 * counts as `-\t-`. Paths are verbatim: `-z` turns off git's C-quoting and its `{old => new}`
 * rename text, neither of which names a real file. A change is reported under its new path, as
 * `gh pr diff --name-only` names it.
 */
export function parseNumstat(numstat: string): FileChange[] {
  const out: FileChange[] = [];
  const fields = numstat.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i]!;
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const second = tab < 0 ? -1 : record.indexOf("\t", tab + 1);
    if (second < 0) continue;
    const a = record.slice(0, tab);
    const r = record.slice(tab + 1, second);
    let path = record.slice(second + 1);
    if (path === "") {
      // A rename or copy: the old path and the new path are the next two fields.
      path = fields[i + 2] ?? "";
      i += 2;
      if (path === "") continue;
    }
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
