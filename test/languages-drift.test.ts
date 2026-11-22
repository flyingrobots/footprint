// flyingrobots/footprint#21. src/languages.ts keeps a hand-mirrored copy of the extensions
// graft's tree-sitter grammars can parse, because graft does not publish that list through its
// package exports map or any CLI contract (see the comment at the top of src/languages.ts, and
// docs/topics/blast-radius/README.md). When graft adds or drops a grammar without this mirror
// being updated, footprint is silently wrong: a newly supported language reads as unanalysed, or
// a dropped one reads as analysed. This test exists so that drift fails the gate instead.
//
// What it compares: graft's dist/parser/lang.js exports SUPPORTED_LANGS (a list of language ids,
// e.g. "rust") and detectLang (extension -> language id | null), but it does NOT export the
// per-language extension table (LANGUAGE_SUFFIXES is a module-private const in that file) — so
// there is no exported extension list to diff textually. Instead, this test reads footprint's own
// extension set out of src/languages.ts's source text (never imported, since SUPPORTED_EXTENSIONS
// is module-private there too, and this test must not add an export to make that convenient — see
// the issue's "do not change src/languages.ts"), runs each extension through graft's real
// detectLang, and asserts that the resulting set of languages is exactly graft's SUPPORTED_LANGS.
// That catches both failure modes named above:
//   - a footprint extension graft no longer recognises -> detectLang returns null -> named directly
//   - a graft language no footprint extension maps to (added, or orphaned by an edit) -> the
//     final set-equality check catches it
//
// Fails loudly, never skips or passes quietly, when graft's module has moved or no longer exports
// what this test depends on.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(import.meta.dir, "..");

// The path graft's own lang.js lives at today, as of @flyingrobots/graft 0.14.0 — the same path
// named in src/languages.ts's doc comment. If graft moves or renames this file, this test must
// fail with a message naming the path, not skip.
const GRAFT_LANG_MODULE_PATH = resolve(
  REPO_ROOT,
  "node_modules/@flyingrobots/graft/dist/parser/lang.js",
);

const LANGUAGES_SOURCE_PATH = resolve(REPO_ROOT, "src/languages.ts");

function footprintSupportedExtensions(): string[] {
  if (!existsSync(LANGUAGES_SOURCE_PATH)) {
    throw new Error(
      `footprint's language list is missing: expected it at ${LANGUAGES_SOURCE_PATH}.`,
    );
  }
  const source = readFileSync(LANGUAGES_SOURCE_PATH, "utf8");
  const setLiteral = source.match(/SUPPORTED_EXTENSIONS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!setLiteral) {
    throw new Error(
      `could not find the SUPPORTED_EXTENSIONS set literal in ${LANGUAGES_SOURCE_PATH}; ` +
        "this drift test reads it from source rather than importing it, and that parse broke.",
    );
  }
  const extensions = [...setLiteral[1].matchAll(/"(\.[a-zA-Z0-9]+)"/g)].map((m) => m[1]);
  if (extensions.length === 0) {
    throw new Error(
      `parsed zero extensions out of ${LANGUAGES_SOURCE_PATH}'s SUPPORTED_EXTENSIONS set literal.`,
    );
  }
  return extensions;
}

describe("footprint's supported-language list against the installed graft", () => {
  test("every footprint extension maps, through graft's own detectLang, to exactly graft's SUPPORTED_LANGS", async () => {
    if (!existsSync(GRAFT_LANG_MODULE_PATH)) {
      throw new Error(
        `graft's language module is not at the path footprint expects: ${GRAFT_LANG_MODULE_PATH}. ` +
          "Either @flyingrobots/graft is not installed (run bun install), or graft moved, " +
          "renamed, or dropped dist/parser/lang.js.",
      );
    }

    const graftLang: Record<string, unknown> = await import(
      pathToFileURL(GRAFT_LANG_MODULE_PATH).href
    );

    if (!Array.isArray(graftLang.SUPPORTED_LANGS)) {
      throw new Error(
        `graft's module at ${GRAFT_LANG_MODULE_PATH} no longer exports SUPPORTED_LANGS as an ` +
          "array; this drift test can no longer read graft's supported-language set.",
      );
    }
    if (typeof graftLang.detectLang !== "function") {
      throw new Error(
        `graft's module at ${GRAFT_LANG_MODULE_PATH} no longer exports detectLang; this drift ` +
          "test can no longer map footprint's extensions to graft's languages.",
      );
    }

    const detectLang = graftLang.detectLang as (path: string) => string | null;
    const graftLanguages = new Set<string>(graftLang.SUPPORTED_LANGS as string[]);

    const unrecognizedExtensions: string[] = [];
    const derivedLanguages = new Set<string>();
    for (const extension of footprintSupportedExtensions()) {
      const language = detectLang(`probe${extension}`);
      if (language === null) {
        unrecognizedExtensions.push(extension);
        continue;
      }
      derivedLanguages.add(language);
    }

    expect(
      unrecognizedExtensions,
      `graft's detectLang (${GRAFT_LANG_MODULE_PATH}) no longer recognises extension(s) ` +
        `footprint's src/languages.ts still lists as supported: ${unrecognizedExtensions.join(", ")}`,
    ).toEqual([]);

    expect(
      [...derivedLanguages].sort(),
      "footprint's supported extensions, mapped through graft's detectLang, do not cover " +
        "exactly graft's SUPPORTED_LANGS — a language was added to or dropped from graft's " +
        "grammar coverage without src/languages.ts being updated to match",
    ).toEqual([...graftLanguages].sort());
  });
});
