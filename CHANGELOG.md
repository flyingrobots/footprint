# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

### Added

- CI: a GitHub Actions workflow (`.github/workflows/ci.yml`) runs `bun install --frozen-lockfile`
  and `bun test` on every push to `main` and on every pull request. See
  [`docs/workflows/ci/README.md`](docs/workflows/ci/README.md). (flyingrobots/footprint#22)
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
- **Blast radius: the export-surface diff.** A third result line per run,
  `footprint.blast_radius` (`schemas/footprint.blast_radius.schema.json`), emitted after the
  landing plan, listing the exported symbols the change added, removed and signature-changed,
  each with its file and name. `--human` gains a `## Blast radius` section. The facts come from
  graft's CLI contract `graft struct exports <base-ref> <head-ref> --json`, bound to `_schema`
  `graft.cli.struct_exports` 1.0.0; a three-dot range is compared from the merge base. When graft
  is absent, fails, or answers under another contract version, the result carries
  `exports.available: false` with a `reason` — the section is stated, never omitted — and a
  `graft.exports_failed` warning is emitted when graft resolved but could not be read.
  (flyingrobots/footprint#9)
  - **1.1.0** (still unreleased, so recorded in this same entry rather than a new one): a required
    `unanalysed_languages` field names the changed source files, by extension with a count, in
    languages footprint does not recognise as one graft's grammars can parse — present and empty
    when every changed file was in a supported language, never omitted. Independent of `exports`:
    a parse failure in a *supported* language is never counted, because detection is extension-only
    and never looks at whether graft ran or what it returned. `--human`'s `## Blast radius` section
    states it alongside the symbol list. (flyingrobots/footprint#12)
- `docs/topics/blast-radius/README.md`: what the export-surface diff lists, which graft contract it
  comes from, and the two failure modes it inherits (re-exports read as changes, dynamic dispatch
  invisible).
- **Call sites for each changed symbol, with file and line.** Every symbol on the blast radius
  carries `call_sites`, each a `{ file, line }`; a symbol nothing references is listed with an
  empty list rather than dropped. `exports.call_site_scan` says how they were found and
  `counts.call_sites` adds them up, and the `## Blast radius` section of `--human` gains a
  **Call sites** column and a collapsed `file:line` list per symbol. These are footprint's own,
  not graft's: no graft CLI contract answers with a call site's *line* — `symbol blame --json`
  carries a `referenceCount` and no per-reference list, and `struct review`, `symbol difficulty`
  and `struct test-coverage` carry referencing file paths only. So the rule is the most
  conservative one an independent oracle can check: every whole-word occurrence of the name in the
  tracked, non-binary files of the working tree, `grep -w`'s boundary — a letter, digit or
  underscore in any script, which a differential fuzz against real grep proved had to be Unicode
  rather than ASCII. It counts the declaration, comments, strings and prose, and misses dynamic dispatch and a re-export under another name;
  both limits are stated in the result, in the schema and under the list in the comment. A binary
  file is skipped exactly as `grep -I` skips it and a tracked file no longer on disk is counted,
  not fatal; a scan that could not run is `call_site_scan.available: false` with a reason and a
  `callsites.scan_failed` warning, and then no symbol carries `call_sites` at all.
  (flyingrobots/footprint#10)
- **Call sites grouped by system, with a mitigation on every row.** Each call site now names the
  `system` containing it and carries a `mitigation` and the `mitigation_basis` that derived it, and
  `exports.call_site_systems` names the grouping rule, the mitigation derivation and every system
  with its call-site count — counts that sum to `counts.call_sites`. `--human`'s `## Blast radius`
  section renders one Markdown table per system, `| Symbol | Call site | Mitigation |`.
  A **system** is the first path segment of a call site's repository-relative path, the directory
  immediately under the repository root; a file at the repository root is grouped under
  `(unassigned)`, which is named and listed last rather than dropped. A **mitigation** is one of
  exactly three sentences, chosen by two reported facts and nothing else — whether the call site is
  in the very file the symbol is exported from, and what `classify()` calls that file: `None
  needed` for the declaring file or a test file, otherwise the system it is in, or that it is
  outside every known system. It is never a judgement about importance, risk or coverage and never
  advice, because footprint reports and does not judge (`AGENTS.md`); the guard is a test that
  matches every mitigation of the real Definition-of-Done run against an allowlist of those three
  forms, declared in the test rather than imported from `src/`. A scan that did not run carries no
  grouping at all, so an absent grouping can never be read as a change that reaches no system.
  **Still on the unreleased 1.1.0 draft rather than the 1.2.0 the issue proposed**: 1.1.0 has never
  been in a release, so `AGENTS.md`'s rule (spec §4.5) is to record the change in this entry rather
  than cut a second unreleased version. (flyingrobots/footprint#11)
- `test/languages-drift.test.ts`: checks `src/languages.ts`'s hand-mirrored extension list against
  the extensions the *installed* `@flyingrobots/graft` actually recognises, by reading its
  `dist/parser/lang.js` from disk and running footprint's extensions through its own `detectLang`.
  Fails loudly, naming the path, if that module moves or no longer exports what the test depends
  on, rather than skipping. (flyingrobots/footprint#21)
- **Cross-pull-request overlap.** A fourth result in the same run, `footprint.overlap` 1.0.0
  (`schemas/footprint.overlap.schema.json`), emitted after the blast radius: the open pull requests
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

### Decided

- footprint#2's call-site/structural analysis depends on graft's **CLI JSON contract**, not a
  library import: `struct review --json` (`graft.cli.struct_review` 2.0.0, already wired),
  `struct exports --json` (`graft.cli.struct_exports` 1.0.0), `struct diff --json`
  (`graft.cli.struct_diff` 2.0.0), and `symbol blame --json` (`graft.cli.symbol_blame` 1.0.0).
  Rejected: graft's MCP tools (ruled out by footprint#2 §2a — the agent must not be in the
  computation path) and waiting on a library barrel graft does not export today (its installed
  `exports` map resolves only `"."`, and the capability thought to require one,
  export-surface diffing, is already reachable as `struct exports`). (flyingrobots/footprint#8)

### Schemas

- `footprint.blast_radius` **1.0.0 → 1.1.0**, additive: `call_sites` on every symbol of `added`,
  `removed` and `signature_changed`; `exports.call_site_scan`; `counts.call_sites`. When
  `call_site_scan.available` is true the schema *requires* `call_sites` on every listed symbol, so
  "listed with an empty list, not dropped" is structural rather than a convention. A consumer
  pinned to 1.0.0 keeps reading every field it already read. (flyingrobots/footprint#10)

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
