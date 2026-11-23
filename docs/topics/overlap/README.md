# Cross-pull-request overlap

Two open pull requests that change the same file conflict, and nothing says so until the second
merge fails. footprint answers two questions in one run, as the fourth result beside the
composition, the landing plan and the blast radius:

1. **Which open pull requests touch a file this change touches?** Named by number and title.
2. **In what order could the open pull requests land?** As waves, with a reason for every edge
   that forces one.

It reports. It does not merge anything, does not rebase anything, and is not a gate.

## Where the facts come from

| Fact | Command |
| --- | --- |
| The open pull requests, their head commits and base branches | `gh pr list --state open --json number,title,isDraft,headRefOid,headRefName,isCrossRepository,baseRefName --limit 100` |
| What each one changes | `gh pr diff <number> --name-only` |
| Each side's changed lines in a shared file | `git diff -U0 <merge-base> <head> -- <file>`, local and read-only |
| The top-level symbols of that file at each end | `graft read outline <file> --json`, its jump table |

The two `gh` calls are the whole of footprint's contact with GitHub. Everything after them is
computation over `{number, title, isDraft, files}` records, which is why the test suite needs
neither the network nor an open pull request on this repository.

Two pull requests are joined by an edge when they change a common file. That edge is then
compared at the [symbol level](#the-symbol-level), file by file. A file-level overlap is a reason to
look. A symbol-level one is a sharper reason. Neither proves there will be a textual conflict.

## The conflict graph

A node is an open pull request. An edge joins two pull requests whose changed-file lists
intersect, and carries the intersection:

```
#15 ──(docs/topics/output/test-plan.md, test/cli.test.ts)── #16
```

Every edge is in the result's `conflicts`, with `sharedFiles`, a `reason` that names them in
prose, and a `symbolLevel`. An edge is a statement about files, not about semantics: it says these
two pull requests write to the same place.

A pull request with no changed files has no edges. A pull request whose file list `gh` would not
report — a fork whose head is gone, a deleted branch, a failed call — is **not** given an empty
file list, because that would make it look disjoint. It goes to `undetermined`, out of the graph
and out of the waves, and the run emits a `gh.diff_failed` warning.

## The symbol level

For every shared file of every edge, and of every pull request that overlaps this change, footprint
asks whether the two sides change the same **top-level symbols**. graft's `struct diff` cannot
answer that, because it lists only signature-level changes. On this repository at
`65d6a405..3fa62c37` it reported `src/cli.ts` as `=5 unchanged` even though the function
`footprint` had edits in its body. Its lists cover only part of what changed, so two disjoint lists
prove nothing. footprint does the attribution itself, from facts that git and graft each report:

1. **Each side's changed lines.** For a pull request this is `git diff -U0` from the merge base of
   its head commit and its base branch (`origin/<baseRefName>`, else `<baseRefName>`). For this
   change it is the same diff over the range's own merge base, the one `rangeBase()` gives every
   other section. Whitespace-only lines are skipped. They are in no symbol, and counting them would
   leave every added function undetermined because of the blank line before it.
2. **The spans of the file's top-level symbols.** These come from the jump table of
   `graft read outline --json` (`graft.cli.read_outline` 3.x), taken at the merge base for removed
   lines and at the head for added ones. The file's content at each end is written to a private
   temporary directory, outlined there, and the directory is removed when the run ends.
3. **Attribution.** A changed line belongs to every symbol whose span holds it. A line that no span
   holds (a comment, an import or top-level code) counts toward that side's `outside`.

A file is then:

| Level | When | Carries |
| --- | --- | --- |
| `symbol-overlapping` | the two sides name a common symbol | each side's `symbols` and `outside`, and the `shared` symbols |
| `symbol-disjoint` | no common symbol, and at most one side has lines outside every symbol | each side's `symbols` and `outside` |
| `undetermined` | anything else | a `code` and a `reason` |

An edge is `symbol-overlapping` if any of its shared files is, and `symbol-disjoint` only if every
one is. Otherwise it is `undetermined`.

**A rename is never read as disjoint.** graft's diff reads `alpha` -> `gamma` as one symbol removed
and another added. Here the removed line sits inside `alpha`'s span at the merge base, and the added
line sits inside `gamma`'s span at the head. The side therefore names both symbols, and it overlaps
anything that touches either name.

**The granularity is top-level.** graft's jump table lists top-level symbols only, so a class is one
symbol. Two pull requests that change different methods of one class are reported as
`symbol-overlapping` on the class. Doc comments above a function lie outside its span.

**When in doubt, undetermined.** Every code:

| Code | Why |
| --- | --- |
| `graft.not_resolved` | graft could not be resolved, so the file is compared by name only |
| `language.unsupported` | graft has no grammar for the file's extension (Markdown, for one); no graft call is spent on it |
| `graft.outline_failed`, `graft.outline_unreadable`, `graft.outline_refused`, `graft.outline_partial` | graft exited non-zero, answered a contract footprint does not read, refused the file, or returned a partial outline |
| `graft.outline_timeout` | a graft call did not answer within the timeout and was stopped |
| `budget.spent` | the run's outline budget was used up before this file was reached |
| `gh.head_unknown` | `gh` did not report the pull request's head commit |
| `git.head_missing` | the head commit is not in the local repository; `git fetch origin pull/<n>/head` makes it available. A fork's pull request is usually the case |
| `git.base_missing`, `git.merge_base` | the base branch is not local, or has no common commit with the head |
| `git.diff_failed`, `git.show_failed`, `git.binary` | git could not give the lines or the content, or the file is binary |
| `symbols.outside` | both sides change lines outside every symbol, which no symbol can tell apart |
| `symbols.not_analysed` | no symbol analysis was run, as in a library call to `computeOverlap` that did not pass one |

### Bounded

graft can be slow on large files, so the analysis has three limits:

- **What is analysed.** Only the shared files of pairs that share a file. The overlaps with this
  change come first, then the edges in order of pull-request number.
- **How many outline calls are made.** At most 24 graft outline calls per run (`OUTLINE_BUDGET` in
  `src/symbols.ts`). Outlines are cached by blob, so two pull requests cut from the same commit
  share the merge base's outline at no extra cost.
- **How long each call may take.** Each call is stopped after 20 seconds (`OUTLINE_TIMEOUT_MS`).

Past either limit the file is `undetermined` with the reason. `symbolAnalysis` on the result
records the calls made, the budget and the timeout.

### Decision: a symbol-disjoint edge does not separate waves

This decision was made under the owner's delegation of 2026-11-22 and is recorded on
flyingrobots/footprint#33. The owner may overrule it.

- A **symbol-disjoint** edge stays in `conflicts`, with each side's symbols named. footprint
  reports; it does not judge. The edge does **not** put the two pull requests in different waves.
- A **symbol-overlapping** or **undetermined** edge separates waves, just as every edge did before
  symbol-level analysis existed.

Symbol-disjoint is **not** a claim that git will merge the two cleanly. Two pull requests that each
append a different function at the end of one file are symbol-disjoint, and git can still report a
textual conflict between them. Predicting textual conflicts is out of scope.

The waves invariant changed from "no two in a wave share a file" to "... unless the edge is
symbol-disjoint", so the result's schema moved to a new major version: `footprint.overlap` 2.0.0.

### On a real pair

Captured on 2026-11-22: footprint on flyingrobots/taskalisk#21's range
(`origin/main...ff6eb7a0`), with #19 and #66 open. Abridged to the #19 entry:

```
- **#19** fix: validate edge edits before optimistic publication _(draft)_ — `skills/taskalisk/SKILL.md`, `skills/taskalisk/scripts/taskalisk.py`, `tests/fake_gh.py`, `tests/test_taskalisk.py`
  - `skills/taskalisk/SKILL.md`: symbol level undetermined — graft has no grammar for .md files, so the file has no symbols to compare
  - `skills/taskalisk/scripts/taskalisk.py`: the same symbols — `collect_frontmatter_dag`, `compile_from_github`
  - `tests/fake_gh.py`: the same symbols — `main`
  - `tests/test_taskalisk.py`: different symbols — this change `CrossRepositoryPRs`; #19 `Mutation`, `Parsing`, `Trust`
```

The symbol sets for both Python files match an independent check: Python's own `ast` spans for
top-level definitions, applied to the same `git diff -U0`.

## Merge waves

Wave 1 is a set of pull requests that can land in any order: no two of them share a file, except
across a symbol-disjoint edge.
Wave 2 is the same for what is left, and lands after wave 1. The assignment is **greedy
first-fit**: the pull requests are sorted by number, and each goes into the first wave that holds
nothing it conflicts with.

```
#15 ─┐
     ├─ wave 1: #15, #17      (no shared file between them)
#17 ─┘
#16 ──── wave 2: #16          (after wave 1: shares two files with #15)
```

Two properties worth being plain about:

- **It is deterministic.** The input is sorted by pull-request number first, so the plan does not
  depend on the order `gh` happened to list them.
- **It is a proposal, not a minimum.** Greedy colouring of a conflict graph can use more waves
  than the graph strictly needs. footprint says what it computed; it does not claim the plan is
  optimal, and there is no attempt to minimise the wave count.

The algorithm is a **reimplementation** of graft's `findParallelGroups`
(`src/operations/footprint-parallelism.ts`), which groups non-overlapping `{tool, files, symbols}`
footprints for concurrent execution. Swap "tool call" for "pull request" and it is merge-wave
planning. It is reimplemented in `src/overlap.ts` rather than imported because footprint depends
on graft's **CLI contract** and never on its source: graft's package barrel does not export the
function, so importing it would mean reaching into `node_modules/@flyingrobots/graft/dist`, which
is exactly the coupling [`AGENTS.md`](../../../AGENTS.md) forbids. graft's substrate is slated to
be rewritten; twenty lines of greedy first-fit is a cheaper thing to own than that coupling.

## The pull request under review

A report on an open pull request must not list that pull request against itself. `self` carries
the number of the open pull request whose **head commit equals the range's resolved head commit**
(`gh pr list --json headRefOid` against `git rev-parse <head>^{commit}`). It is excluded from
`overlapping`, and from the count in `summary` ("1 of 2 other open pull requests"), and kept in
the waves, because it still has to land somewhere in the order. `--human` runs print a step naming it.

Only when no pull request's head commit matches does the head **branch name** decide, and only for
a same-repository pull request (`isCrossRepository` false): a fork's branch that happens to share
the name is a different change and stays listed. The range's head has a branch name when it is
`HEAD` on a branch, a local branch, or `origin/<branch>`; a commit id or a tag has none, so only
the commit comparison applies. If several pull requests share the deciding fact the lowest number
is named.

`self` is always present on an available result and is null when no pull request matches: the
branch has none yet, or the range is not an open pull request's head.

## When gh cannot answer

The section is **stated, never omitted**. An overlap section that silently disappears reads as
"nothing overlaps", which is a different and possibly false claim. So `overlap.available` is
`false`, with a stable `code`, `gh`'s own message as the `reason`, and a `summary` that says the
limitation in one sentence. The run still exits 0, and the composition result is unaffected.

The codes are listed in [the output reference](../output/README.md#errors).

## What is not here

- **Textual conflict prediction.** A symbol-disjoint edge says the two change different symbols,
  not that git will merge them cleanly.
- **Symbols below the top level.** Methods of one class are one symbol, because graft's jump table
  is top-level only.
- **Performing merges.** footprint proposes an order; a human merges.
- **Pull requests beyond the limit.** 100 open pull requests are listed; if the list comes back at
  the limit, `truncated` is true, a `gh.list_truncated` warning is emitted, and the comment says
  there may be more.

## The contract ledger

The requirements and evidence for this result live with the rest of the output contract, in
[`docs/topics/output/test-plan.md`](../output/test-plan.md) as OUT-8 and its rows: one result type
per message, one ledger for the messages.

## Reading it

The JSON Lines result is `footprint.overlap` 2.0.0 — fields in
[the output reference](../output/README.md#the-overlap-result). `--human` renders the same record
as an `### Open pull requests` section: the summary, the overlapping pull requests with the files
they share and a nested line per file at the symbol level, and a collapsed merge order. Each list
is bounded to the section's budget and says how many entries it left out.
