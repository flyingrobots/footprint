// Which changed files footprint does not recognise as a language graft's tree-sitter grammars can
// parse, by extension, with a count (flyingrobots/footprint#12). tree-sitter has grammars for some
// languages; a changed file in another language is invisible to symbol analysis. Silently
// skipping it reads as "nothing moved", which is the absent-signal failure AGENTS.md forbids — so
// the blast-radius result names it instead.
//
// This is a pure function of paths, and nothing else: it never looks at whether graft ran, or
// what it returned. That is deliberate, not an oversight — a changed file in a *supported*
// language whose parse failed (or whose diff was formatting-only, with no symbol to report) must
// not be counted as unsupported. Basing this on absence from graft's own output would conflate
// "no grammar" with "graft failed" or "nothing changed here"; basing it on the extension alone
// cannot.
//
// The set of supported extensions mirrors graft's own tree-sitter language support
// (`SUPPORTED_LANGS` in `@flyingrobots/graft`'s `dist/parser/lang.js`, as of graft 0.14.0). graft
// does not publish this list through its package exports map or any CLI contract, so footprint
// keeps its own copy by hand; it will drift if graft's grammar coverage changes before this list
// is updated. Asking graft to expose its supported-language set through a versioned CLI contract,
// instead of footprint mirroring it privately, is a decision the owner may want to make instead.
import { classify } from "./classify.ts";

/**
 * Extensions footprint believes graft's export-surface analysis (`graft struct exports`) can
 * read. Out of scope: adding grammars (flyingrobots/footprint#12 §5) — this only names the gap.
 */
const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".mts", ".cts",
  ".tsx", ".jsx",
  ".js", ".mjs", ".cjs",
  ".rs",
  ".graphql", ".gql", ".graphqls",
  ".py", ".pyi",
  ".go",
  ".json",
  ".toml",
  ".yaml", ".yml",
]);

export interface UnsupportedLanguage {
  readonly extension: string;
  readonly count: number;
}

/**
 * The extension of a path: the basename's last dot onward, lowercase. `""` when the basename
 * carries no dot (an extensionless file such as `Makefile`).
 */
export function extensionOf(path: string): string {
  const normalized = path.trim().toLowerCase();
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const basename = lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized;
  const lastDot = basename.lastIndexOf(".");
  return lastDot > 0 ? basename.slice(lastDot) : "";
}

/**
 * Changed files classify() calls "source" (docs, config, tests, CI and generated files were never
 * going to be symbol-analysed regardless of extension, so flagging them would be noise, not
 * signal) whose extension is not one footprint recognises as supported, grouped by extension with
 * a count. Sorted by extension, so the result — and any digest built over it — does not follow
 * input order. `[]` when every changed file was in a supported language: present, never absent.
 */
export function unsupportedLanguages(paths: readonly string[]): UnsupportedLanguage[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    if (classify(path) !== "source") continue;
    const ext = extensionOf(path);
    if (SUPPORTED_EXTENSIONS.has(ext)) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([extension, count]) => ({ extension: extension === "" ? "(none)" : extension, count }))
    .sort((a, b) => a.extension.localeCompare(b.extension));
}
