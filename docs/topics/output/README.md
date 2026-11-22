# Output

footprint speaks the [Parley output protocol](https://github.com/flyingrobots/parley) (spec v0.2)
through `@flyingrobots/parley-emit`. This page is the reference for what a caller receives; the
[test plan](test-plan.md) beside it is the contract ledger.

## The streams

| Stream | Carries |
| --- | --- |
| stdout | The bootstrap line, four `result` lines — the composition, the landing plan, the blast radius, then the cross-pull-request overlap — and the `end` line. JSON Lines, always; nothing depends on a TTY. |
| stderr | Structured `error` and `warning` lines, and nothing else. |
| receipt | `.parley/receipts/<run>.jsonl` under the working directory: the head with `argv` and the resolved interpretation (range, both commit ids, the graft setting), one `receipt.step` per decision, the file listing and the Markdown beside the result, and `end`. |

`--human` (alias `--humanize`) prints the Markdown comment instead, and only it on success — the
composition section, **Before merge** and **After merge**, `## Blast radius`, then the
`### Open pull requests` section — so this still works:

```bash
footprint --human | gh pr comment 42 --body-file -
```

## The results

Four result lines, in this order and in the same run: the composition, then the landing plan, then
the blast radius, then the cross-pull-request overlap. One result type per message, each with its
own schema and its own version.

### `footprint.composition` 1.0.0

What the change touches, schema `schemas/footprint.composition.schema.json`:

| Field | Meaning |
| --- | --- |
| `range` | The git range compared, as given to `git diff` |
| `composition` | `files`, `added`, `removed`, `binaryFiles`, and `byCategory` rows that sum to the totals (the invariant under test) |
| `gut_check` | The `headline` and the `flags`, observations and never verdicts |
| `structural` | `available: false` when graft could not be resolved or failed; otherwise the counts and `breakingChanges`. The section is stated, never omitted. |
| `digest` | SHA-256 over the canonical JSON of the four fields above, so two runs compare with one string |

The receipt copy of the same line also carries `files` (the listing from `git diff --numstat`) and
`markdown` (what `--human` prints).

### `footprint.landing` 1.0.0

How the change lands, schema `schemas/footprint.landing.schema.json`. The reference for what is
read and how the guard rule is computed is [landing](../landing/README.md).

| Field | Meaning |
| --- | --- |
| `range` | The git range compared, as given to `git diff` |
| `before_merge.items` | One entry per before-merge rule that matched the changed-file list: `migration` (with its ordering constraint), `generated`, `regenerate`. Each carries the `paths` that matched and what it `says`. |
| `before_merge.guards` | The changed files matching the guard rule, each with its `kind`: `migration`, `flag` or `version` |
| `before_merge.unguarded` | True when a changed file classifies as `source` and no changed file matches the guard rule. Path patterns only; an observation, never a verdict. |
| `before_merge.unguarded_because` | Always stated: the guards found, that no source file changed, or the rule that found none |
| `after_merge.read` | Every document footprint looked in — `RELEASE.md` then `AGENTS.md` — with `present` and the `headings` of its landing sections, whether or not it was there |
| `after_merge.steps` | The steps that apply, in document order; each quotes the document verbatim and cites the `file` and `heading` it was read from |
| `after_merge.declared` | True when any document declared a step. False means the fallback was stated, not that there is nothing to do. |
| `after_merge.nothing_to_do` | True when the change touches no executable surface; the statement then says "nothing to do after merge" plainly |
| `after_merge.statement` | The one plain sentence: the steps and where they came from, the stated fallback, or that there is nothing to do |
| `digest` | SHA-256 over the canonical JSON of `range`, `before_merge` and `after_merge` |

The receipt copy also carries `markdown`, the two `--human` sections. Under `--human` the landing
plan prints as **Before merge** and **After merge**, after the composition comment.

### `footprint.blast_radius` 1.1.0

The export-surface diff, the third result line of the run, after the landing plan
(`schemas/footprint.blast_radius.schema.json`). What it lists, and the graft contract it comes
from, is [Blast radius](../blast-radius/README.md); these are its fields:

| Field | Meaning |
| --- | --- |
| `range` | The git range compared, as given to `git diff` |
| `exports.available` | `false` when graft could not be resolved, failed, or answered under a contract version footprint does not read |
| `exports.reason` | Present when `available` is `false`: `code` — one of `graft.not_resolved`, `graft.exports_failed`, `graft.output_unreadable`, `graft.schema_mismatch`, `range.unresolved` — and a `detail` to act on. The section is stated, never omitted. |
| `exports.base`, `exports.head` | The refs passed to graft: the merge base for a three-dot range, the given base otherwise |
| `exports.added`, `exports.removed`, `exports.signature_changed` | The symbols, each with `symbol` and `file`, plus `kind` and `signature` when graft reported them, and `previous_signature` on a signature change. Sorted by file then symbol, so the digest follows the surface rather than graft's ordering. |
| `exports.counts` | `added`, `removed`, `signature_changed` — the lengths of those three lists, and footprint's only arithmetic here |
| `exports.semver_impact` | graft's own judgement, verbatim; `null` when it reported none. footprint derives no semver impact. |
| `exports.contract` | The graft CLI contract that answered: `graft.cli.struct_exports` 1.0.0 |
| `unanalysed_languages` | Changed source files in languages footprint does not recognise as one graft's grammars can parse, grouped by extension with a count. Present and empty when every changed file was in a supported language — never omitted. Independent of `exports`: a parse failure in a *supported* language is never counted here, because this is extension-only and does not depend on whether graft ran or what it returned. |
| `digest` | SHA-256 over the canonical JSON of `range`, `exports` and `unanalysed_languages` |

Everything under `added`, `removed` and `signature_changed` is graft's, passed through unchanged.
The receipt copy carries the `markdown` of this section.

### `footprint.overlap` 1.0.0

The fourth line in the same run, after the blast radius: schema `footprint.overlap` 1.0.0
(`schemas/footprint.overlap.schema.json`). What it means and how the waves are built is
[the overlap reference](../overlap/README.md); this is the field list.

| Field | Meaning |
| --- | --- |
| `range` | The git range whose files were compared against the open pull requests |
| `overlap.available` | `false` when `gh` could not answer; the section is stated, never omitted |
| `overlap.summary` | The plain statement, present in both cases: the counts, that there is no overlap, or the limitation |
| `overlap.code`, `overlap.reason` | Only when `available: false`: the stable code and `gh`'s own message |
| `overlap.self` | This change's own pull request, excluded from `overlapping` and kept in `waves`; null when the branch has none |
| `overlap.openPullRequests`, `limit`, `truncated` | How many open pull requests were listed, the `gh pr list --limit` used, and whether the list came back at it |
| `overlap.overlapping` | Open pull requests changing a file this change changes: `number`, `title`, `isDraft`, `sharedFiles`. Ascending by number |
| `overlap.conflicts` | One edge per pair of open pull requests sharing a file: `a`, `b`, `sharedFiles`, and a `reason` naming them |
| `overlap.waves` | The proposed merge order: `wave` and its `pullRequests`. No two in a wave share a file; wave N+1 lands after wave N |
| `overlap.undetermined` | Open pull requests whose files `gh` would not report, kept out of the graph and the waves rather than assumed disjoint |
| `digest` | SHA-256 over the canonical JSON of `range` and `overlap` |

`isDraft` is an observation, like every flag footprint emits. The receipt copy of this line also
carries `markdown`, the `### Open pull requests` section `--human` prints last.

Unlike the composition, this result is **live state**: it depends on which pull requests are open
right now, not on the two commits being compared. Two runs with the same `inv` can carry different
overlap, and the `digest` is what moves when they do.

`--human` prints every section in that order, the composition's `## Footprint`, then
**Before merge** and **After merge**, then `## Blast radius`, then `### Open pull requests`, so one
run is one comment.

## Identity

Every line carries the run id. The bootstrap line and the receipt head also carry `inv`, the
identity of the question: SHA-256 over the tool name and version, the command, and the resolved
interpretation, which is the range after the default base is applied, **both ends as commit ids**,
and the `FOOTPRINT_GRAFT` setting. footprint declares no file inputs, because the subject matter
is the two commits rather than files on disk; the commit ids are its content addresses, so the
same `inv` means the same comparison of the same trees, and a new commit on either end changes it.
What `inv` does not cover: which graft version answered, so a structural section can differ under
one `inv` when graft is upgraded, and which pull requests were open, so the overlap result can
differ under one `inv` as pull requests open and land. Resolving the range costs two `git rev-parse` calls before the
bootstrap line is written; that is the only work done before it. The derivation is the writer's, documented in
`@flyingrobots/parley-emit`'s README.

## Errors

| Code | When | Exit |
| --- | --- | --- |
| `base.not_found` | No base given and none of `origin/main`, `origin/master`, `main`, `master` exists | 2 |
| `git.diff_failed` | `git diff --numstat` exited non-zero; `problem` carries git's message | 2 |
| `uncaught.exception` | A defect in footprint; `detail.stack` is in the receipt | 2 |

### Stated limitations

A limitation is not an error: the run succeeds and the result says what it could not establish.
`structural.available` is false when graft could not be resolved or its review could not be read,
and `exports.available` is false with a stated `reason` when graft could not answer the
export-surface question. `overlap.available` is false for one of these, and `overlap.code` says
which:

| `overlap.code` | When |
| --- | --- |
| `gh.not_found` | `gh` is not installed or not on PATH |
| `gh.unauthenticated` | `gh` said it is not logged in, or GitHub answered 401 |
| `gh.rate_limited` | `gh` said the API rate limit was hit |
| `gh.no_remote` | No GitHub remote to ask about, or not a git repository |
| `gh.list_failed` | `gh pr list` failed for another reason; `reason` carries its message |
| `gh.list_unreadable` | `gh pr list --json` returned output footprint could not read |

### Warnings

| Code | When | Exit |
| --- | --- | --- |
| `graft.review_failed` | graft resolved but its review could not be read; `structural.available` is false | 0 |
| `graft.exports_failed` | graft resolved but the export surface could not be read; `exports.available` is false with the reason on the result. graft being absent entirely is not a warning — it is the `graft.not_resolved` reason and a step saying so | 0 |
| `gh.unauthenticated`, `gh.rate_limited`, `gh.no_remote`, `gh.list_failed`, `gh.list_unreadable` | `gh` resolved but could not list the open pull requests; `overlap.available` is false. No warning when `gh` is simply absent — that is not a failure of anything footprint ran | 0 |
| `gh.diff_failed` | `gh pr diff --name-only` would not report some pull request's files; they are in `overlap.undetermined` | 0 |
| `gh.list_truncated` | The pull-request list came back at the limit, so there may be more than were considered | 0 |

## Discovery

`footprint --help` and `footprint --schema` are runs too: they bootstrap, write a receipt, emit
one `command` line and the schemas footprint can emit, and close with `end`. `--help` carries
`footprint.composition`, `footprint.landing`, `footprint.blast_radius`, `footprint.overlap` and
`parley.error`, in that order; `--schema` adds every protocol schema the writer itself emits.

## Exit status

`0` success, `2` a structured error was reported, `3` no writable receipt location (one
`startup.failed` line on stderr), `4` the output or receipt could not be written. Spec §3.4.

## Retention and hygiene

Fifty receipts per location; the oldest bundles beyond that are deleted at the start of a run and
the deletion is recorded as a step. `.parley/.gitignore` is created with `*` on first use and never
overwritten, so the receipts stay out of the repository.
