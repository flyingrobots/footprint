# Output

footprint speaks the [Parley output protocol](https://github.com/flyingrobots/parley) (spec v0.2)
through `@flyingrobots/parley-emit`. This page is the reference for what a caller receives; the
[test plan](test-plan.md) beside it is the contract ledger.

## The streams

| Stream | Carries |
| --- | --- |
| stdout | The bootstrap line, one `result` line, the `end` line. JSON Lines, always; nothing depends on a TTY. |
| stderr | Structured `error` and `warning` lines, and nothing else. |
| receipt | `.parley/receipts/<run>.jsonl` under the working directory: the head with `argv` and the resolved interpretation (range, both commit ids, the graft setting), one `receipt.step` per decision, the file listing and the Markdown beside the result, and `end`. |

`--human` (alias `--humanize`) prints the Markdown comment instead, and only it on success, so
this still works:

```bash
footprint --human | gh pr comment 42 --body-file -
```

## The result

One line, schema `footprint.composition` 1.0.0 (`schemas/footprint.composition.schema.json`):

| Field | Meaning |
| --- | --- |
| `range` | The git range compared, as given to `git diff` |
| `composition` | `files`, `added`, `removed`, `binaryFiles`, and `byCategory` rows that sum to the totals (the invariant under test) |
| `gut_check` | The `headline` and the `flags`, observations and never verdicts |
| `structural` | `available: false` when graft could not be resolved or failed; otherwise the counts and `breakingChanges`. The section is stated, never omitted. |
| `digest` | SHA-256 over the canonical JSON of the four fields above, so two runs compare with one string |

The receipt copy of the same line also carries `files` (the listing from `git diff --numstat`) and
`markdown` (what `--human` prints).

## Identity

Every line carries the run id. The bootstrap line and the receipt head also carry `inv`, the
identity of the question: SHA-256 over the tool name and version, the command, and the resolved
interpretation, which is the range after the default base is applied, **both ends as commit ids**,
and the `FOOTPRINT_GRAFT` setting. footprint declares no file inputs, because the subject matter
is the two commits rather than files on disk; the commit ids are its content addresses, so the
same `inv` means the same comparison of the same trees, and a new commit on either end changes it.
What `inv` does not cover: which graft version answered, so a structural section can differ under
one `inv` when graft is upgraded. The derivation is the writer's, documented in
`@flyingrobots/parley-emit`'s README.

## Errors

| Code | When | Exit |
| --- | --- | --- |
| `base.not_found` | No base given and none of `origin/main`, `origin/master`, `main`, `master` exists | 2 |
| `git.diff_failed` | `git diff --numstat` exited non-zero; `problem` carries git's message | 2 |
| `uncaught.exception` | A defect in footprint; `detail.stack` is in the receipt | 2 |

A warning, `graft.review_failed`, says graft resolved but its review could not be read; the run
still succeeds with `structural.available: false`.

## Discovery

`footprint --help` and `footprint --schema` are runs too: they bootstrap, write a receipt, emit
one `command` line and the schemas footprint can emit, and close with `end`. `--help` carries
`footprint.composition` and `parley.error`; `--schema` adds every protocol schema the writer
itself emits.

## Exit status

`0` success, `2` a structured error was reported, `3` no writable receipt location (one
`startup.failed` line on stderr), `4` the output or receipt could not be written. Spec §3.4.

## Retention and hygiene

Fifty receipts per location; the oldest bundles beyond that are deleted at the start of a run and
the deletion is recorded as a step. `.parley/.gitignore` is created with `*` on first use and never
overwritten, so the receipts stay out of the repository.
