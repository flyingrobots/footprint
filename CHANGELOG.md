# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

### Added

- A second result in the same run, `footprint.landing` 1.0.0
  (`schemas/footprint.landing.schema.json`), and two `--human` sections, **Before merge** and
  **After merge**. The after-merge steps are read out of the repository's own `RELEASE.md` and
  `AGENTS.md` — list items under a heading that names the landing process — and each cites the
  file and heading it came from; where neither document declares any, the result states that
  fallback rather than inventing steps, and where the change touches no executable surface it says
  "nothing to do after merge" plainly. Before merge reports what the changed-file list shows:
  migrations with their ordering constraint, generated files, a manifest changed with no lockfile
  beside it, and a loud warning when the diff changes source and no changed file is a migration, a
  flag, or a version or changelog entry. The guard rule is documented path patterns, never a
  judgement: [`docs/topics/landing/README.md`](docs/topics/landing/README.md).
  (flyingrobots/footprint#3)
- **Blast radius: the export-surface diff.** A second result line per run,
  `footprint.blast_radius` 1.0.0 (`schemas/footprint.blast_radius.schema.json`), emitted after the
  composition result, listing the exported symbols the change added, removed and signature-changed,
  each with its file and name. `--human` gains a `## Blast radius` section. The facts come from
  graft's CLI contract `graft struct exports <base-ref> <head-ref> --json`, bound to `_schema`
  `graft.cli.struct_exports` 1.0.0; a three-dot range is compared from the merge base. When graft
  is absent, fails, or answers under another contract version, the result carries
  `exports.available: false` with a `reason` — the section is stated, never omitted — and a
  `graft.exports_failed` warning is emitted when graft resolved but could not be read.
  (flyingrobots/footprint#9)
- `docs/topics/blast-radius/README.md`: what the export-surface diff lists, which graft contract it
  comes from, and the two failure modes it inherits (re-exports read as changes, dynamic dispatch
  invisible).

### Decided

- footprint#2's call-site/structural analysis depends on graft's **CLI JSON contract**, not a
  library import: `struct review --json` (`graft.cli.struct_review` 2.0.0, already wired),
  `struct exports --json` (`graft.cli.struct_exports` 1.0.0), `struct diff --json`
  (`graft.cli.struct_diff` 2.0.0), and `symbol blame --json` (`graft.cli.symbol_blame` 1.0.0).
  Rejected: graft's MCP tools (ruled out by footprint#2 §2a — the agent must not be in the
  computation path) and waiting on a library barrel graft does not export today (its installed
  `exports` map resolves only `"."`, and the capability thought to require one,
  export-surface diffing, is already reachable as `struct exports`). (flyingrobots/footprint#8)

## [0.2.0] — 2026-11-22

### Changed

- **Breaking.** The default output is JSON Lines on stdout and stderr, through
  `@flyingrobots/parley-emit` (the Parley output protocol, spec v0.2): a bootstrap line, one
  `footprint.composition` 1.0.0 result, an `end` line; structured errors on stderr; a receipt per
  run under `.parley/receipts/`. The Markdown comment is `--human`. Pipelines that posted the
  default output to a pull request need `--human`. (flyingrobots/footprint#4)
- "No changes" is a result with zero files; a failing `git diff` is a `git.diff_failed` error and
  exit 2; a missing default branch is `base.not_found`.

### Added

- `schemas/footprint.composition.schema.json`, validated against real output in `test/cli.test.ts`.
- `--help` and `--schema` as runs that describe the tool.
- The receipt head's resolved interpretation carries the range after the default base, both
  commit ids and the graft setting, so `inv` identifies the comparison of two trees rather than
  the arguments alone.

## [0.1.0] — 2026-11-22

### Added

- Composition report: file and line counts by category, a mermaid pie, a gut check, and a
  collapsed file listing. Every figure computed from `git diff --numstat`.
- `src/classify.ts`: ordered, first-match-wins classification into `source`, `test`, `docs`,
  `config`, `ci`, `generated`, `assets`.
