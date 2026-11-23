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

Licence and notice texts are `docs` by whole file name, at any depth: `LICENSE`, `LICENSE.<anything>`,
`NOTICE` and `COPYING`. They have no extension for the other rules to see, and without that rule
they would count as source and read as code in an unanalysed language. One under a generated or
test path keeps that category, because those rules come first.

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

### Structural history cost

flyingrobots/footprint#7 measured what building graft's structural history costs on a repository
that has none, from a cold start, on three repositories (small, medium, large; commands and full
output in that issue's comment):

| Repo | Size | Cold `graft struct review --json` | Full-history `graft index` (no `--path`) |
| --- | --- | --- | --- |
| footprint (small) | 14 commits, 32 files, 4,926 lines | 1.1s wall, no `.git` growth | succeeds: 12 files indexed, 2.3s, `.git` +0.7 MB |
| theme-book (medium) | 17 commits, 41 files, 7,159 lines | 1.3s wall, no `.git` growth | succeeds: 16 files indexed, 3.0s, `.git` +1.1 MB |
| git-warp (large) | 5,027 commits, 3,944 files, 495,627 lines | 23.9s wall, no `.git` growth | refused: `indexHead refused to index 3493 files in one call. Lazy indexing policy allows at most 64 files; pass explicit paths or index on read.` |

graft has no single command that builds a repository's full structural history up front: `graft
index` without `--path` is lazy and capped at 64 files per call, and above that cap it refuses
rather than chunking the work itself. The number that matters for CI is the cost of the first real
call instead — `graft struct review --json` against a cold repository that has never been
indexed. That cost tracked total indexable file count, not the size of the diff being reviewed:
about a second on footprint- and theme-book-sized repositories, about 24 seconds on a
5,000-commit, ~496k-line repository reviewing a 10-commit range.

**Verdict:** a first-run `graft struct review --json` is acceptable inside a CI job at every size
measured here, but because its cost scales with the repository's indexable surface rather than
the pull request's diff, a much larger monorepo should be measured before assuming the same holds.

## Known gaps

- **No call-site analysis yet.** Graft has the primitives — `struct exports`, `symbol blame`,
  `symbol difficulty` — but footprint does not use them yet.
- **Thresholds are fixed.** The 40-file and 50% figures are not configurable.
- **No rename detection.** A renamed file is counted at its new path with its real line delta.
