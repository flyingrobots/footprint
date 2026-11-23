// What kind of file is this? The categories exist to answer one question at a glance:
// "is this change shaped the way I think it is?"

export type Category =
  | "source"
  | "test"
  | "docs"
  | "config"
  | "ci"
  | "generated"
  | "assets";

/** Ordered: the first matching rule wins, so a test fixture counts as a test, not a source file. */
const RULES: ReadonlyArray<readonly [Category, RegExp]> = [
  ["generated", /(^|\/)(dist|build|out|target|node_modules)\//],
  ["generated", /(^|\/)(package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum)$/],
  ["generated", /\.(min\.js|min\.css|map)$/],
  ["ci", /(^|\/)\.github\//],
  ["ci", /(^|\/)(Dockerfile|compose\.ya?ml|docker-compose\.ya?ml|\.dockerignore)$/],
  ["test", /(^|\/)(tests?|__tests__|fixtures?|testdata)\//],
  // `spec/` holds RSpec-style test code, and also a specification-first repository's prose
  // (flyingrobots/footprint#42): a documentation extension there falls through to the docs rules.
  ["test", /(^|\/)spec\/(?!.*\.(md|mdx|rst|adoc|txt)$)/i],
  ["test", /\.(test|spec)\.[cm]?[jt]sx?$/],
  ["test", /_test\.(go|py|rs)$/],
  // Agent skills are instructions an agent executes, not documentation: Markdown under a `skills/`
  // path component, and any SKILL.md. `config` rather than a new category, which would change the
  // shipped footprint.composition schema's enum (flyingrobots/footprint#34). Before the docs rules,
  // after the test rules, so a skill fixture stays a test.
  ["config", /(^|\/)skills\/(.+\/)?[^/]+\.mdx?$/i],
  ["config", /(^|\/)SKILL\.md$/],
  // Licence and notice texts, by whole file name: extensionless, so without this they fall through
  // to source and read as code in an unanalysed language (flyingrobots/footprint#36).
  ["docs", /(^|\/)(LICENSE(\.[^/]+)?|NOTICE|COPYING)$/],
  ["docs", /(^|\/)docs?\//],
  ["docs", /\.(md|mdx|rst|adoc|txt)$/i],
  ["assets", /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|mp4|webm|pdf)$/i],
  ["config", /\.(json|ya?ml|toml|ini|env|conf|cfg)$/i],
  ["config", /(^|\/)\.[^/]+rc(\.[a-z]+)?$/],
  ["config", /(^|\/)(\.gitignore|\.gitattributes|\.editorconfig|tsconfig[^/]*\.json)$/],
];

export function classify(path: string): Category {
  for (const [category, pattern] of RULES) {
    if (pattern.test(path)) return category;
  }
  return "source";
}
