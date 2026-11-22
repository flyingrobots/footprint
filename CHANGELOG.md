# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

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
