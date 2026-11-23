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
  ["test", /(^|\/)(tests?|__tests__|spec|fixtures?|testdata)\//],
  ["test", /\.(test|spec)\.[cm]?[jt]sx?$/],
  ["test", /_test\.(go|py|rs)$/],
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
