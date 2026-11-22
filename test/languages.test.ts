// Which changed files footprint does not recognise as a language graft's grammars can parse,
// grouped by extension with a count. Pure over paths: no git, no graft. The fixture changed-file
// lists under test/fixtures/languages/ follow the same convention as test/fixtures/landing/.
//
// flyingrobots/footprint#12.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extensionOf, unsupportedLanguages } from "../src/languages.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures/languages");

function paths(name: string): string[] {
  return readFileSync(join(FIXTURES, name, "changed-files.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

describe("unsupportedLanguages: changed files in languages graft's grammars cannot parse", () => {
  test("a Haskell file among supported ones is reported by extension with a count of one", () => {
    const out = unsupportedLanguages(paths("unanalysed"));
    expect(out).toEqual([{ extension: ".hs", count: 1 }]);
  });

  test("every changed file in a supported language is an empty list, not an absent one", () => {
    const out = unsupportedLanguages(paths("all-supported"));
    expect(out).toEqual([]);
    expect(Array.isArray(out)).toBe(true);
  });

  test("a changed file in a supported language is never counted, however graft's run turned out", () => {
    // Detection is extension-only: it takes no Exports/graft outcome at all, so there is no way
    // for a parse failure in src/app.ts to make its way into this list.
    const out = unsupportedLanguages(["src/app.ts"]);
    expect(out).toEqual([]);
  });

  test("multiple unsupported extensions, uneven counts, out of input order, group and sort by extension", () => {
    const out = unsupportedLanguages([
      "src/Main.hs",
      "src/other.zig",
      "src/Second.hs",
      "src/app.ts",
      "src/another.zig",
      "src/third.zig",
    ]);
    expect(out).toEqual([
      { extension: ".hs", count: 2 },
      { extension: ".zig", count: 3 },
    ]);
  });

  test("non-source files are never flagged: docs, config, tests, CI and generated were never going to be symbol-analysed", () => {
    const out = unsupportedLanguages([
      "docs/guide.md",
      "config.ini",
      "test/fixtures/weird.hs", // under a test/ directory: classified as test, not source
      ".github/workflows/ci.yml",
      "dist/bundle.wasm",
      "image.png",
    ]);
    expect(out).toEqual([]);
  });

  test("extensionOf reads the basename's last dot, lowercase, and \"\" when there is none", () => {
    expect(extensionOf("src/Main.hs")).toBe(".hs");
    expect(extensionOf("src/Widget.TSX")).toBe(".tsx");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("a/b/c.tar.gz")).toBe(".gz");
  });
});
