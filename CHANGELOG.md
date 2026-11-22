# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

### Added

- **Cross-pull-request overlap.** A second result in the same run, `footprint.overlap` 1.0.0
  (`schemas/footprint.overlap.schema.json`), emitted after the composition: the open pull requests
  that change a file this change changes, named by number and title; the conflict graph between the
  open pull requests, with the shared files and a reason for every edge; and a proposed merge order
  as waves, where no two pull requests in a wave share a file. `--human` renders it as an
  `### Open pull requests` section. (flyingrobots/footprint#1)
- The open pull requests come from `gh pr list --json` and their files from
  `gh pr diff --name-only`; this branch's own pull request comes from `gh pr view --json number`
  and is excluded from the overlap while staying in the waves. When `gh` is absent,
  unauthenticated, rate-limited, without a GitHub remote, or returns unreadable JSON, the result
  carries `available: false` with a stable code and `gh`'s own message, and the run still exits 0.
  A pull request whose files `gh` would not report is `undetermined` rather than assumed disjoint;
  a list that came back at the limit sets `truncated`.
- [`docs/topics/overlap/README.md`](docs/topics/overlap/README.md): the conflict graph, the merge
  waves, and why the greedy grouping is a reimplementation of graft's `findParallelGroups` rather
  than an import.

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
