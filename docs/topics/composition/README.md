# Composition

The composition report answers one question: **is this change shaped the way you think it is?**

## Reading it

```bash
bun src/cli.ts origin/main --human
```

The default output is JSON Lines (see [Output](../output/README.md)); `--human` prints the
comment. The comment opens with the gut check — a file and line count, then any flags — because that is what
a reviewer reads first. Everything else is collapsed behind `<details>`.

| Flag | Fires when |
| --- | --- |
| `N files changed` | 40 or more files, the threshold where a branch has usually grown past its intent |
| `Source changed, no tests changed` | a `source` row exists and a `test` row does not |
| `% generated or vendored` | `generated` is at least half the changed lines, so most of the diff needs skimming rather than reading |
| `Documentation only` | exactly one category, and it is `docs` |

Flags are observations, not verdicts. A large change is not automatically risky.

## Categories

`source`, `test`, `docs`, `config`, `ci`, `generated`, `assets`. Classification is an ordered rule
list in `src/classify.ts`, first match wins, and the order matters: a test fixture classifies as
`test` before extension rules apply, and a lockfile as `generated` before the JSON rule claims it.

Unrecognised files fall through to `source` on purpose — an unknown file should look like code that
needs review rather than disappear.

## Computed, not estimated

Totals come from `git diff --numstat`. Category rows are required by test to sum to the reported
total. Binary files report no line counts and are counted separately rather than as zero-line text
files.

The range uses three dots (`base...HEAD`), so the comparison is against the merge base and
unrelated commits on the default branch are excluded.

## Structural signal

When graft resolves, the report adds a line path-based classification cannot produce:

```text
**Structural:** 1 file changed shape (+2/-0/~0 symbols), 1 formatting-only.
```

Graft classifies a changed file by what happened to its **symbols**, so a source file whose diff
adds, removes and changes nothing is reported as *formatting*, not as a behavior change. Breaking
changes are surfaced in the gut check.

The two views are complementary and both are shown: composition answers "what kind of files", the
structural signal answers "did anything's shape actually move".

When graft is unavailable the report says so explicitly. It never omits the section silently.

## Known gaps

- **No call-site analysis yet.** Graft has the primitives — `struct exports`, `symbol blame`,
  `symbol difficulty` — but footprint does not use them yet.
- **Thresholds are fixed.** The 40-file and 50% figures are not configurable.
- **No rename detection.** A renamed file is counted at its new path with its real line delta.
