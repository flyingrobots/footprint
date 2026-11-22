# Output

footprint speaks the [Parley output protocol](https://github.com/flyingrobots/parley) (spec v0.2)
through `@flyingrobots/parley-emit`. This page is the reference for what a caller receives; the
[test plan](test-plan.md) beside it is the contract ledger.

## The streams

| Stream | Carries |
| --- | --- |
| stdout | The bootstrap line, the `result` lines, the `end` line. JSON Lines, always; nothing depends on a TTY. |
| stderr | Structured `error` and `warning` lines, and nothing else. |
| receipt | `.parley/receipts/<run>.jsonl` under the working directory: the head with `argv` and the resolved interpretation (range, both commit ids, the graft setting), one `receipt.step` per decision, the file listing and the Markdown beside the result, and `end`. |

`--human` (alias `--humanize`) prints the Markdown comment instead, and only it on success, so
this still works:

```bash
footprint --human | gh pr comment 42 --body-file -
```

## The results

Three result lines, in this order and in the same run: the composition, then the landing plan,
then the blast radius. One result type per message, each with its own schema and its own version.

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

### `footprint.blast_radius` 1.0.0

The export-surface diff, emitted after the composition result in the same run
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
| `digest` | SHA-256 over the canonical JSON of `range` and `exports` |

Everything under `added`, `removed` and `signature_changed` is graft's, passed through unchanged.
The receipt copy carries the `markdown` of this section.

`--human` prints both sections, the composition's `## Footprint` and then `## Blast radius`, so one
run is one comment.

## Identity

Every line carries the run id. The bootstrap line and the receipt head also carry `inv`, the
identity of the question: SHA-256 over the tool name and version, the command, and the resolved
interpretation, which is the range after the default base is applied, **both ends as commit ids**,
and the `FOOTPRINT_GRAFT` setting. footprint declares no file inputs, because the subject matter
is the two commits rather than files on disk; the commit ids are its content addresses, so the
same `inv` means the same comparison of the same trees, and a new commit on either end changes it.
What `inv` does not cover: which graft version answered, so a structural section can differ under
one `inv` when graft is upgraded. Resolving the range costs two `git rev-parse` calls before the
bootstrap line is written; that is the only work done before it. The derivation is the writer's, documented in
`@flyingrobots/parley-emit`'s README.

## Errors

| Code | When | Exit |
| --- | --- | --- |
| `base.not_found` | No base given and none of `origin/main`, `origin/master`, `main`, `master` exists | 2 |
| `git.diff_failed` | `git diff --numstat` exited non-zero; `problem` carries git's message | 2 |
| `uncaught.exception` | A defect in footprint; `detail.stack` is in the receipt | 2 |

Two warnings say graft resolved but could not be read, and the run still succeeds:
`graft.review_failed` with `structural.available: false`, and `graft.exports_failed` with
`exports.available: false` and the reason on the result. graft being absent entirely is not a
warning — it is the `graft.not_resolved` reason on the result and a step saying so.

## Discovery

`footprint --help` and `footprint --schema` are runs too: they bootstrap, write a receipt, emit
one `command` line and the schemas footprint can emit, and close with `end`. `--help` carries
`footprint.composition`, `footprint.landing` and `parley.error`; `--schema` adds every protocol
schema the writer itself emits.
`footprint.composition`, `footprint.blast_radius` and `parley.error`; `--schema` adds every
protocol schema the writer itself emits.

## Exit status

`0` success, `2` a structured error was reported, `3` no writable receipt location (one
`startup.failed` line on stderr), `4` the output or receipt could not be written. Spec §3.4.

## Retention and hygiene

Fifty receipts per location; the oldest bundles beyond that are deleted at the start of a run and
the deletion is recorded as a step. `.parley/.gitignore` is created with `*` on first use and never
overwritten, so the receipts stay out of the repository.
