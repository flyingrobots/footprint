# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

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
