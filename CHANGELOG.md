# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). Pre-1.0: anything may change between minor versions.

## [Unreleased]

## [0.6.0] — 2026-11-23

### Added

- **One Footprint comment per pull request** (flyingrobots/footprint#59). `footprint comment <pr>
  --report <file> --change <text> --reason <text> [--remarks <text>]` posts a `--human` report as
  the pull request's one Footprint comment:
  - it finds the comment whose first line is the hidden marker `<!-- footprint:report -->`, written
    by the current `gh` user, and edits it in place; failing that it adopts the most recent
    comment by that user beginning `## Footprint`, and says so in the row's Remarks; failing that
    it creates one;
  - it never edits another user's comment: a marked comment by someone else is
    `comment.other_author`, and nothing is written;
  - every earlier row of the **Changelog** at the comment's foot is carried over verbatim, and one
    row is appended: UTC timestamp, the head's 7-character SHA, Change, Reason, Remarks, with `|`
    escaped and newlines as `<br>`;
  - the comment stays within 65536 characters: when the Changelog does not fit, the newest rows are
    kept and the comment states how many older rows were dropped, across runs;
  - a new result type, **`footprint.comment` 1.0.0** (`schemas/footprint.comment.schema.json`);
    `--dry-run` writes nothing.
- **`--impact <file>`**: the posting agent's reading of the call sites, one JSON object per line
  (`{symbol, system, file?, impact, dataFlow}`), rendered as **Impact** and **Data flow** columns
  in every call-site table of `--human`, `not assessed` where no entry covers a row, and labelled
  as the agent's reading rather than footprint's measurement. No result line carries it. An
  invalid file is `impact.invalid`; an entry that matches no row is an `impact.unmatched` warning.
- **`--max-chars <n>`** (40960 to 65536) bounds `--human` below GitHub's 65536, so the Changelog
  has room beside the report; the skill uses 57344.

### Changed

- **The skill** (`skills/footprint/SKILL.md`) posts with `footprint comment` instead of `gh pr
  comment`, runs the report at `--max-chars 57344`, has the agent assess the call sites for
  `--impact` proportionately, and says what to write in Change, Reason and Remarks. Reinstall it.
- An unknown flag, a flag without its value, or a second range is now `args.invalid` (exit 2);
  before, an unknown flag was ignored and a flag's value could be read as the range.
- `footprint --help` still describes the default command; `footprint comment --help` describes the
  new one, and `--schema` both.

## [0.5.0] — 2026-11-23

### Added

- **Symbol-level overlap for pull requests whose commits are not in the local clone**
  (flyingrobots/footprint#55). A pull request whose head or base commit is absent locally, as a
  fork's head is in CI, was always `undetermined` with `git.head_missing`. It is now read over
  read-only `gh api` calls pinned to exact commit ids, and never fetched (`git fetch` writes to
  `.git`; footprint declares no writes):
  - `gh api repos/{owner}/{repo}/compare/<baseRefOid>...<headRefOid>` gives the merge base
    (`merge_base_commit.sha`) and each file's patch from that merge base to the head, the same
    comparison `git diff` makes locally. `gh pr diff` is not used: it diffs against the pull
    request's current merge base, which can differ from the pinned one;
  - the file's content at the merge base and at the head comes from
    `gh api -H 'Accept: application/vnd.github.raw' repos/{owner}/{repo}/contents/<path>?ref=<sha>`,
    each path segment percent-encoded;
  - nothing is sent but full commit ids and the file's own path, and every call is a GET;
  - bounded like the outline calls: at most 32 calls per run (`REMOTE_BUDGET`), each stopped after
    20 seconds (`REMOTE_TIMEOUT_MS`), contents over 1 MiB not read, and no call after a rate limit;
  - the rule of 0.4.1 holds: a merge base the compare does not state as a commit id, a file with
    no patch or renamed, a file the compare did not list, a failed, timed-out or rate-limited call,
    and a head that moved or a base `gh` did not report all leave the file `undetermined` with the
    reason, never `symbol-disjoint`.
  - `--human` marks a file whose side was read over the API, and the overlap section counts the
    calls.

### Changed

- **`footprint.overlap` 2.2.0.** Additive. `symbolLevel.files[].github` (`["a"]`, `["b"]` or both)
  names the sides read over the GitHub API; the undetermined `code` enum gains `gh.remote_failed`,
  `gh.rate_limited`, `gh.timeout`, `gh.budget_spent`, `gh.compare_unpinned`,
  `gh.compare_incomplete`, `gh.patch_unavailable` and `gh.content_too_large`; `symbolAnalysis`
  gains `remoteCalls`, `remoteBudget` and `remoteTimeoutMs`.
- The second side of a shared file is not resolved once the first is undetermined, so a pair
  already undetermined spends no `gh api` call.

## [0.4.1] — 2026-11-22

### Fixed

- **Symbol-level overlap no longer calls an edge `symbol-disjoint` when the comparison is not
  exact.** Fourteen review claims on flyingrobots/footprint#54, each reproduced with a failing test
  or refuted. When the analysis cannot be tied to exact commits or exact content, the file is now
  `undetermined` with the reason (flyingrobots/footprint#56):
  - a pull request's merge base is taken against the base commit `gh` reports (`baseRefOid`),
    never a local branch tip, which on a fork could already hold the head and make the diff empty.
    An unreported base is `gh.base_unknown`; a base commit that is not local is `git.base_missing`;
  - `gh pr list` runs again after the file lists, and a pull request whose head commit moved is
    `gh.head_moved`;
  - a file listed as changed whose own diff changes no line of it is `symbols.file_unchanged`;
  - the range's two ends are pinned to commit ids before any section reads them, so a branch that
    advances during the `gh` calls is not read once for the files and again for the symbols;
  - the attribution diff reads raw content (`--no-textconv`) and takes the path root-relative and
    literally (`:(top,literal)`, `--no-relative`), so a textconv driver, a run from a subdirectory
    or a `[` in a file name cannot empty or merge its hunks;
  - a whitespace-only line inside a symbol's span is attributed to that symbol;
  - outlines are cached by blob and path, since graft picks the grammar by the path;
  - valid JSON of the wrong shape from `graft read outline` is `graft.outline_unreadable`, not a
    throw that cost every edge its symbol level;
  - the outline timeout covers reading graft's output, not only its exit;
  - a pair with one side already undetermined spends no outline call;
  - a failure to remove the outline directory is a `symbols.cleanup_failed` warning, not an
    uncaught exception that lost the overlap result.
- The `docs/topics/overlap` reference describes wave 1 as a plan, not a promise that its pull
  requests merge in any order.
- `test/symbols.test.ts` skips its real-graft cases by name when graft does not resolve (and runs
  them under `FOOTPRINT_REQUIRE_GRAFT=1`, as CI does), removes the directories it makes, and links
  `git` and `node` into its stand-in PATH instead of wrapping them in a shell script that split a
  path holding a space.
- `package-lock.json` names the package version again; it had been left at 0.3.3.

### Changed

- **`footprint.overlap` 2.1.0.** The undetermined `code` enum gains `gh.head_moved`,
  `gh.base_unknown` and `symbols.file_unchanged`. `gh pr list` also asks for `baseRefOid`.
  (flyingrobots/footprint#56)

## [0.4.0] — 2026-11-22

### Added

- **Symbol-level overlap between open pull requests.** A file shared by two open pull requests
  (or by this change and an open pull request) is now compared symbol by symbol. Each side's
  changed lines, from `git diff -U0` against its own merge base, are attributed to the top-level
  symbols in `graft read outline`'s jump table: removed lines at the merge base, added lines at the
  head. A rename is therefore never read as disjoint from an edit to the old name. The file is
  reported as `symbol-disjoint` with each side's symbols named, as `symbol-overlapping` with the
  shared symbols named, or as `undetermined` with a stable code and a reason (graft absent, no
  grammar, timeout, budget spent, head commit not local, and others). The analysis covers only the
  shared files of pairs that share a file. It is limited to 24 outline calls per run, cached by
  blob, with a 20-second timeout on each. `--human` names the symbols in nested lines under each
  shared file, inside the overlap section's budget. On flyingrobots/taskalisk#21 against #19 it
  reports `tests/test_taskalisk.py` as different symbols (`CrossRepositoryPRs` against
  `Mutation`, `Parsing`, `Trust`) and `taskalisk.py` as the same symbols
  (`collect_frontmatter_dag`, `compile_from_github`). (flyingrobots/footprint#33)

### Changed

- **`footprint.overlap` 2.0.0.** `overlapping[]` and `conflicts[]` carry a required `symbolLevel`,
  and the result carries `symbolAnalysis`. An edge's `reason` now states its symbol level. A
  **symbol-disjoint edge no longer separates waves**, so two pull requests in one wave may share a
  file. That breaks 1.0.0's waves invariant, which is why this is a major version of the message
  schema. Overlapping and undetermined edges separate waves as before. `gh pr list` also asks for
  `baseRefName`, the branch each pull request's merge base is taken against.
  (flyingrobots/footprint#33)

## [0.3.3] — 2026-11-22

### Fixed

- **The `--human` report always fits one GitHub comment.** On flyingrobots/taskalisk#71 it was
  284007 characters and GitHub refused it at 65536. It is now bounded to 65536 characters in total:
  the `Files` list, the exported-symbols table, each system's call-site table, the lists of symbols
  with no call site, and the overlap section are cut to a limit, and each cut says how many entries
  it left out and that the result line carries every one; if the report is still too long the larger
  table is halved until it fits, deterministically. A symbol with more than 50 call sites (the
  fields of a JSON Schema file, such as `type` and `id`, were the cause) is summarised as a count per
  system instead of a row per site. footprint still scans for those names and still records every
  site. The same range now renders at 54368 characters. The JSON Lines records are unchanged and not
  bounded. The landing section, the formatting-labelled paths and the per-symbol remainder notes are
  bounded too, and a last-resort clamp on every section makes the total bound hold for any input,
  stating what it cut. (flyingrobots/footprint#51)

## [0.3.2] — 2026-11-22

### Fixed

- **The structural section compares a three-dot range from the merge base.** `footprint
  origin/main...origin/branch` handed `graft struct review` the base ref itself, `origin/main`'s
  tip, while the composition and exports sections used the merge base. Every symbol the default
  branch gained after the branch was cut was reported as removed by the branch and as a breaking
  change (35 of them on a one-file test change in flyingrobots/school). graft is now given the
  merge base, from the same `rangeBase` the exports section uses, so the three sections compare
  one range. A two-dot range, which was split on `...` and so handed graft the whole range as one
  ref, is now compared from its written base. A range with no merge base states the limitation
  as a `graft.review_failed` warning. No schema moved. (flyingrobots/footprint#39)

- **Markdown under `spec/` is documentation, not test.** The `spec/` directory rule, meant for
  RSpec-style test code, classified a specification repository's prose (`spec/parley-v0.2.md`) as
  `test`. A documentation extension under `spec/` is now `docs`; code and fixtures there stay
  `test`. No schema changed; compositions of such repositories shift from `test` to `docs`.
  (flyingrobots/footprint#42)

- **The release page no longer says the npm and GitHub tarballs are the same bytes.** They hold
  the same files, but different npm versions gzip them differently: for `v0.3.1` the release
  asset's SHA-256 is `46f614f3...` and `npm pack` of the same tree under npm 11.20.0 gives
  `8c91dd6d...`, with `diff -r` of the unpacked contents empty. The page now says what is
  guaranteed and how to verify contents by comparing a file list and per-file digests, with the
  captured comparison. (flyingrobots/footprint#47)

- **The Structural line names graft as the source of its `formatting` reading.** It read "1
  formatting-only" for a change whose only edit was a new entry in a rule table, as if footprint
  had judged the change cosmetic. graft's own `struct review --json` labels such a file
  `formatting` (reproduced on flyingrobots/footprint#43's range with graft 0.14.0), so the label is
  graft's; the line now reads "as `graft struct review` reads it", says "labelled `formatting`",
  and lists each such file beneath it with a note that the label is graft's and that a changed
  value inside an existing symbol can carry it. The wording is the only change; no schema moved.
  graft's side is flyingrobots/graft#276. (flyingrobots/footprint#44)

## [0.3.1] — 2026-11-22

Fixes found by the first real use of 0.3.0 and the footprint skill. **Publish this, not 0.3.0**:
0.3.0 as tagged would publish without its `bin`. No schema changed: `footprint.composition` 1.0.0,
`footprint.landing` 1.0.0, `footprint.blast_radius` 1.1.0 and `footprint.overlap` 1.0.0 are as
0.3.0 shipped them. Two classification changes move composition shares: licence files and agent
skills are no longer counted as `source` and `docs` respectively. Reinstall the skill.

### Added

- **The release fails on a manifest npm would correct.** `scripts/manifest-check.ts`, run as the
  `sanity` job's last step with the npm the `publish` job uses, fails when `npm pkg fix` would
  change any field or `npm publish --dry-run` reports a correction. See
  [`docs/workflows/release/README.md`](docs/workflows/release/README.md#the-manifest-npm-publishes).
  (flyingrobots/footprint#35)

### Fixed

- **A change to an agent skill is not documentation only.** Markdown under a `skills/` path
  component, and any `SKILL.md`, classified as `docs`, so a skill-only change read "Documentation
  only" and the landing plan set aside the after-merge steps, including this repository's own
  "reinstall the skill". They now classify as `config`, which changes no schema; compositions of
  changes to skills shift from `docs` to `config`. (flyingrobots/footprint#34)
- **Licence files are docs.** `LICENSE`, `LICENSE.*`, `NOTICE` and `COPYING`, at any depth, fell
  through to `source`, so a change adding them inflated the source share and reported them as
  "changed files in unanalysed language: `(none)`". They now classify as `docs`; a composition
  that includes one shifts accordingly. (flyingrobots/footprint#36)
- **The skill's commands run in zsh.** `skills/footprint/SKILL.md` set `FP="bun …/src/cli.ts"` and
  ran `$FP …`, which zsh, the macOS default shell, does not word-split, so the command failed with
  exit 127. It now defines a shell function, `fp() { bun "$SCRATCH/footprint/src/cli.ts" "$@"; }`
  (or `bunx` once published), which bash and zsh call the same way; `test/skill.test.ts` runs the
  skill's step 3 verbatim under both. CI installs `zsh` for it. Reinstall the skill.
  (flyingrobots/footprint#37)
- **`bin.footprint` survives `npm publish`.** It was written `./src/cli.ts`, a form npm's
  publish-time normalization removes ("script name src/cli.ts was invalid and removed"), so 0.3.0
  as tagged would have published with no command and `bunx @flyingrobots/footprint` would have
  found nothing. It is now `src/cli.ts`. Do not publish 0.3.0. (flyingrobots/footprint#35)

## [0.3.0] — 2026-11-22

The first release to carry the landing plan, the blast radius and the cross-pull-request overlap.
**After this release no footprint schema is a draft**: `footprint.composition` 1.0.0,
`footprint.landing` 1.0.0, `footprint.blast_radius` 1.1.0 and `footprint.overlap` 1.0.0 have all
shipped, so a change to any of them is a new version of that schema, recorded under `### Schemas`,
rather than an edit to the entry below (spec §4.5).

### Added

- **A release workflow.** `.github/workflows/release.yml` runs on a tag `vX.Y.Z`: a `sanity` job
  refuses a tag that differs from `package.json`'s `version` or has no dated changelog heading,
  checks the manifest's publishing fields, runs the gate and dry-runs the pack; a `release` job
  creates the GitHub release with this section as its notes and the tarball plus `SHA256SUMS`
  attached; a `publish` job, in the GitHub environment `npm`, publishes with OIDC provenance
  through npm trusted publishing, with no token in the repository. The first publish of the package
  is manual. See [`docs/workflows/release/README.md`](docs/workflows/release/README.md).
  (flyingrobots/footprint#30)
- **`RELEASE.md`**, the after-merge steps in the form footprint's landing plan reads, so footprint
  run on a change to this repository reports its own landing steps. `test/release.test.ts` holds it
  to that form, and checks that the manifest version has a dated heading here. (flyingrobots/footprint#30)
- **The `footprint` agent skill**, `skills/footprint/SKILL.md`: on an open pull request, run
  footprint over its range, post the `--human` report as a comment, and act on what it lists
  before and after the merge, without reading it as a verdict. See
  [`docs/topics/agent-skill/README.md`](docs/topics/agent-skill/README.md). (flyingrobots/footprint#30)
- `package.json` carries `files`, `engines`, `publishConfig`, `homepage` and `bugs`, so the npm
  package ships the source, the schemas and the skill and nothing else.
- A measured wall-time bound for the call-site scan on a large repository: 4,823 tracked files,
  169 changed files, 142 changed symbols, 7,735 call sites, median 38.72s over three runs. See
  [Performance](docs/topics/blast-radius/README.md#performance). (flyingrobots/footprint#13)
- CI: a GitHub Actions workflow (`.github/workflows/ci.yml`) runs `bun install --frozen-lockfile`
  and `bun test` on every push to `main` and on every pull request. See
  [`docs/workflows/ci/README.md`](docs/workflows/ci/README.md). (flyingrobots/footprint#22)
- **CI proves graft answered, rather than merely installed.** `test/require-graft.test.ts` asserts
  `footprint.blast_radius`'s `exports.available` over a real range of this repository, naming graft
  and the reason it carried when that fails — but only when `FOOTPRINT_REQUIRE_GRAFT=1` is set, so
  a local run without it still passes. The workflow sets the variable, plus `GIT_AUTHOR_NAME`,
  `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`: graft writes its own lazy WARP
  index as git objects, through git-plumbing that strips `HOME` from the environment it hands its
  own git subprocesses, so without an identity in one of those four variables `git commit-tree`
  exited 128 on `ubuntu-latest` and every graft-backed assertion took its "unavailable" branch
  while the suite read green. See [`docs/workflows/ci/README.md`](docs/workflows/ci/README.md).
  (flyingrobots/footprint#25)
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
  `gh pr diff --name-only`; the pull request under review is the one whose head commit is the
  range's head commit (falling back to a same-repository head branch name), reported in `self`
  (null when none) and excluded from the overlap and its count while staying in the waves, so a
  report on an open pull request no longer lists it against itself. (flyingrobots/footprint#29) When `gh` is absent,
  unauthenticated, rate-limited, without a GitHub remote, or returns unreadable JSON, the result
  carries `available: false` with a stable code and `gh`'s own message, and the run still exits 0.
  A pull request whose files `gh` would not report is `undetermined` rather than assumed disjoint;
  a list that came back at the limit sets `truncated`.
- [`docs/topics/overlap/README.md`](docs/topics/overlap/README.md): the conflict graph, the merge
  waves, and why the greedy grouping is a reimplementation of graft's `findParallelGroups` rather
  than an import.

### Fixed

- `package-lock.json` was stale since 0.1.0: it named version 0.1.0 and lacked
  `@flyingrobots/parley-emit`. Regenerated.

### Changed

- The `--human` comment says where each severity statement comes from: "breaking change(s), as
  `graft struct review` lists them" and "`graft struct exports` reads this as a minor change", so
  the two cannot read as a contradiction. footprint reports both and picks neither.
  (flyingrobots/footprint#29)

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
