// How a change lands: what the diff itself puts in front of a reviewer before the merge, and what
// to do after it.
//
// The after-merge steps are **read from the repository**, never invented. A repository's
// `RELEASE.md` and `AGENTS.md` already state how a change lands there; a tool that makes up
// post-merge steps makes up wrong ones, and wrong ones are worse than none because they are
// believed. Where no document declares any, this says so and stops.
//
// Everything here is a pure function of a changed-file list and the text of those documents, so
// the derivation is testable without git and without a network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classify } from "./classify.ts";

/** The documents footprint reads, in the order it reads them. */
export const LANDING_DOCUMENTS = ["RELEASE.md", "AGENTS.md"] as const;

export type GuardKind = "migration" | "flag" | "version";
export interface Guard {
  readonly path: string;
  readonly kind: GuardKind;
}

/**
 * The guard rule. A guard is a **path pattern**, not a judgement: footprint cannot tell whether a
 * change is risky, and the moment it tries, the answer becomes arguable and the warning becomes
 * noise. These patterns say only "a file whose path means this change is gated, switchable or
 * recorded is in the diff". Ordered, first match wins per file, like `classify`.
 */
const GUARD_RULES: ReadonlyArray<readonly [GuardKind, RegExp]> = [
  ["migration", /(^|\/)(migrations?|migrate)\//i],
  ["migration", /(^|\/)\d{3,}[-_][^/]*\.(sql|[cm]?[jt]s|py|rb|go)$/],
  ["migration", /\.migration\.[a-z]+$/i],
  ["flag", /(^|\/)(feature[-_]?flags?|flags?)\//i],
  ["flag", /(^|\/)(feature[-_.]?flags?|flags?)\.(json|ya?ml|toml|[cm]?[jt]sx?)$/i],
  ["version", /(^|\/)(CHANGELOG|CHANGES|HISTORY|NEWS|RELEASES?)(\.[a-z]+)?$/i],
  ["version", /(^|\/)(VERSION|version\.txt|\.version)$/i],
  ["version", /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod|composer\.json|gradle\.properties)$/],
];

/** Every changed file that matches the guard rule, in diff order, with its first matching kind. */
export function guardsIn(paths: readonly string[]): Guard[] {
  const out: Guard[] = [];
  for (const path of paths) {
    for (const [kind, pattern] of GUARD_RULES) {
      if (pattern.test(path)) {
        out.push({ path, kind });
        break;
      }
    }
  }
  return out;
}

/**
 * A dependency manifest changed with no lockfile beside it in the same change: the lockfile is a
 * generated artifact that may need regenerating. Pure path patterns again — footprint does not
 * read the manifest, so it cannot know whether the dependency set actually moved.
 */
const REGENERATE_RULES: ReadonlyArray<readonly [RegExp, RegExp, string]> = [
  [/(^|\/)package\.json$/, /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/, "a JavaScript lockfile"],
  [/(^|\/)Cargo\.toml$/, /(^|\/)Cargo\.lock$/, "`Cargo.lock`"],
  [/(^|\/)(pyproject\.toml|requirements\.in)$/, /(^|\/)(poetry\.lock|uv\.lock|requirements\.txt)$/, "a Python lockfile"],
  [/(^|\/)go\.mod$/, /(^|\/)go\.sum$/, "`go.sum`"],
];

export type BeforeMergeKind = "migration" | "generated" | "regenerate";
export interface BeforeMergeItem {
  readonly kind: BeforeMergeKind;
  readonly paths: readonly string[];
  readonly says: string;
}

export interface BeforeMerge {
  readonly items: readonly BeforeMergeItem[];
  readonly guards: readonly Guard[];
  readonly unguarded: boolean;
  readonly unguarded_because: string;
}

export interface DeclaredStep {
  readonly step: string;
  readonly file: string;
  readonly heading: string;
}

export interface DocumentRead {
  readonly file: string;
  readonly present: boolean;
  readonly headings: readonly string[];
}

export interface AfterMerge {
  readonly read: readonly DocumentRead[];
  readonly steps: readonly DeclaredStep[];
  readonly declared: boolean;
  readonly nothing_to_do: boolean;
  readonly statement: string;
}

export interface Landing {
  readonly before_merge: BeforeMerge;
  readonly after_merge: AfterMerge;
}

export interface LandingDoc {
  readonly file: string;
  /** `null` when the document is not there, which is reported rather than skipped. */
  readonly text: string | null;
}

/**
 * A heading that names the landing process. Deliberately narrow: footprint reads how a change
 * lands, not how a system is deployed, and `--help` would be a poor place to discover that it
 * had quietly adopted a "Deployment" section as merge instructions.
 */
const LANDING_HEADING = /\b(releases?|releasing|publish(?:es|ing)?|after[-\s]?(?:the[-\s]?)?merge|post[-\s]?merge|landing|lands|ship(?:ping)?)\b/i;

/** A top-level list item: `- x`, `* x`, `+ x`, `1. x`, `1) x`, with up to three spaces of indent. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const CHECKBOX = /^\[[ xX]\]\s*/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Walk a document once, reporting the headings of its landing sections and the list items under
 * them.
 *
 * Three rules keep this from reading things that were never declared as steps:
 *
 * - **A heading is never a step.** Only a list item is, which is also why a paragraph of prose
 *   under a `## Release` heading contributes nothing.
 * - **A fenced code block is never a step.** A command shown as an example was not declared as
 *   one, and footprint is not in the business of deciding which lines of a script to run.
 * - **The document's title is not a section.** The first heading, when it is top-level, names the
 *   document; treating `# RELEASE` as a landing section would make the whole file one.
 */
function walk(
  text: string,
  onHeading: (heading: string) => void,
  onStep: (step: string, heading: string) => void,
): void {
  let fence: string | null = null;
  let seenHeading = false;
  let openDepth: number | null = null;
  let heading = "";
  for (const line of text.split("\n")) {
    const fenced = FENCE.exec(line);
    if (fenced !== null) {
      const marker = fenced[1]![0]!;
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const head = HEADING.exec(line);
    if (head !== null) {
      const depth = head[1]!.length;
      const title = head[2]!.trim();
      const isDocumentTitle = !seenHeading && depth === 1;
      seenHeading = true;
      if (isDocumentTitle) continue;
      heading = title;
      // A heading at or above the depth that opened the section closes it.
      if (openDepth !== null && depth <= openDepth) openDepth = null;
      if (openDepth === null && LANDING_HEADING.test(title)) openDepth = depth;
      if (openDepth !== null) onHeading(title);
      continue;
    }

    if (openDepth === null) continue;
    const item = LIST_ITEM.exec(line);
    if (item === null) continue;
    const step = item[1]!.replace(CHECKBOX, "").trim();
    if (step !== "") onStep(step, heading);
  }
}

/** The steps one document declares, in document order, each quoting the document verbatim. */
export function declaredSteps(file: string, text: string): DeclaredStep[] {
  const steps: DeclaredStep[] = [];
  walk(text, () => {}, (step, heading) => steps.push({ step, file, heading }));
  return steps;
}

/** The headings inside a document's landing sections, including the heading that opened each. */
export function landingHeadings(text: string): string[] {
  const headings: string[] = [];
  walk(text, (h) => headings.push(h), () => {});
  return headings;
}

/** Read the landing documents from a directory. A document that is not there reads as absent. */
export function readLandingDocs(dir: string): LandingDoc[] {
  return LANDING_DOCUMENTS.map((file) => {
    try {
      return { file, text: readFileSync(join(dir, file), "utf8") };
    } catch {
      return { file, text: null };
    }
  });
}

function list(paths: readonly string[]): string {
  return paths.map((p) => `\`${p}\``).join(", ");
}

function beforeMerge(paths: readonly string[]): BeforeMerge {
  const guards = guardsIn(paths);
  const sources = paths.filter((p) => classify(p) === "source");
  const items: BeforeMergeItem[] = [];

  const migrations = guards.filter((g) => g.kind === "migration").map((g) => g.path);
  if (migrations.length > 0) {
    items.push({
      kind: "migration",
      paths: migrations,
      says:
        `${migrations.length} migration file${migrations.length === 1 ? "" : "s"} in this change: ${list(migrations)}. ` +
        "A migration and the code that depends on it land in one order or the other, and whichever merges first runs first: " +
        "confirm the migration is applied before the code that reads what it changes.",
    });
  }

  const generated = paths.filter((p) => classify(p) === "generated");
  if (generated.length > 0) {
    items.push({
      kind: "generated",
      paths: generated,
      says:
        `${generated.length} generated or vendored file${generated.length === 1 ? "" : "s"} in this change: ${list(generated)}. ` +
        "These are produced by a tool rather than written, so they are worth confirming as regenerated rather than hand-edited.",
    });
  }

  const stale: string[] = [];
  const wants: string[] = [];
  for (const [manifest, lock, what] of REGENERATE_RULES) {
    const changed = paths.filter((p) => manifest.test(p));
    if (changed.length === 0 || paths.some((p) => lock.test(p))) continue;
    stale.push(...changed);
    if (!wants.includes(what)) wants.push(what);
  }
  if (stale.length > 0) {
    items.push({
      kind: "regenerate",
      paths: stale,
      says: `${list(stale)} changed and no lockfile is in this change; ${wants.join(" and ")} may need regenerating.`,
    });
  }

  const unguarded = sources.length > 0 && guards.length === 0;
  const unguarded_because = unguarded
    ? `${sources.length} source file${sources.length === 1 ? "" : "s"} changed and no changed file is a migration, a feature flag, or a version or changelog entry: ` +
      "by path, nothing in this change gates it, switches it off, or records that it happened."
    : sources.length === 0
      ? "The guard rule does not apply, because no source file changed."
      : `${guards.length} changed file${guards.length === 1 ? "" : "s"} match the guard rule: ${guards.map((g) => `\`${g.path}\` (${g.kind})`).join(", ")}.`;

  return { items, guards, unguarded, unguarded_because };
}

function fallback(read: readonly DocumentRead[]): string {
  if (read.length === 0) {
    return "No landing steps are declared: footprint read no document, so it states none rather than inventing them.";
  }
  const parts = read.map((d) =>
    !d.present
      ? `\`${d.file}\` is absent`
      : d.headings.length > 0
        ? `\`${d.file}\` has a landing section (${d.headings.join(", ")}) with no steps listed under it`
        : `\`${d.file}\` declares no release or landing section`,
  );
  return `No landing steps are declared: ${parts.join("; ")}. footprint states none rather than inventing them.`;
}

/**
 * The landing plan for a change: the before-merge observations from the changed-file list, and the
 * after-merge steps from the documents.
 *
 * A change that touches no executable surface — no files at all, or documentation only, by the
 * same rule the composition's gut check uses — has nothing to do after merge, and the declared
 * steps are set aside rather than repeated at a reader who cannot act on them. What was read is
 * still reported, so nothing is hidden.
 */
export function landingPlan(paths: readonly string[], docs: readonly LandingDoc[]): Landing {
  const read: DocumentRead[] = docs.map((d) => ({
    file: d.file,
    present: d.text !== null,
    headings: d.text === null ? [] : landingHeadings(d.text),
  }));
  const found = docs.flatMap((d) => (d.text === null ? [] : declaredSteps(d.file, d.text)));
  const declared = found.length > 0;
  const files = [...new Set(found.map((s) => s.file))].map((f) => `\`${f}\``);

  const empty = paths.length === 0;
  const docsOnly = !empty && paths.every((p) => classify(p) === "docs");
  const nothing_to_do = empty || docsOnly;

  const statement = empty
    ? "Nothing to do after merge: the range changes no files."
    : docsOnly
      ? declared
        ? `Nothing to do after merge: the change touches documentation only, so the ${found.length} step${found.length === 1 ? "" : "s"} declared in ${files.join(" and ")} do not apply.`
        : "Nothing to do after merge: the change touches documentation only, so no executable surface moved."
      : declared
        ? `${found.length} step${found.length === 1 ? "" : "s"} read from ${files.join(" and ")}.`
        : fallback(read);

  return {
    before_merge: beforeMerge(paths),
    after_merge: { read, steps: nothing_to_do ? [] : found, declared, nothing_to_do, statement },
  };
}
