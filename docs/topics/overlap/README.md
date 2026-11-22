# Cross-pull-request overlap

Two open pull requests that change the same file conflict, and nothing says so until the second
merge fails. footprint answers two questions in one run, as a second result beside the
composition:

1. **Which open pull requests touch a file this change touches?** Named by number and title.
2. **In what order could the open pull requests land?** As waves, with a reason for every edge
   that forces one.

It reports. It does not merge anything, does not rebase anything, and is not a gate.

## Where the facts come from

| Fact | Command |
| --- | --- |
| The open pull requests | `gh pr list --state open --json number,title,isDraft --limit 100` |
| What each one changes | `gh pr diff <number> --name-only` |
| This change's own pull request | `gh pr view --json number` |

Those three read-only calls are the whole of footprint's contact with GitHub. Everything after
them is computation over `{number, title, isDraft, files}` records, which is why the test suite
needs neither the network nor an open pull request on this repository.

The comparison is **file-level**. Two pull requests that change different functions in one file
are reported as overlapping, because at this level that is all that can honestly be said; a
file-level overlap is a reason to look, not a proof of a textual conflict. Symbol-level overlap is
not implemented.

## The conflict graph

A node is an open pull request. An edge joins two pull requests whose changed-file lists
intersect, and carries the intersection:

```
#15 ──(docs/topics/output/test-plan.md, test/cli.test.ts)── #16
```

Every edge is in the result's `conflicts`, with `sharedFiles` and a `reason` that names them in
prose. An edge is a statement about files, not about semantics: it says these two pull requests
write to the same place.

A pull request with no changed files has no edges. A pull request whose file list `gh` would not
report — a fork whose head is gone, a deleted branch, a failed call — is **not** given an empty
file list, because that would make it look disjoint. It goes to `undetermined`, out of the graph
and out of the waves, and the run emits a `gh.diff_failed` warning.

## Merge waves

Wave 1 is a set of pull requests no two of which share a file, so they can land in any order.
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

## This change's own pull request

When the branch being reported on already has a pull request, `self` carries its number. It is
excluded from `overlapping` — a pull request does not overlap itself — and kept in the waves,
because it still has to land somewhere in the order.

When the branch has no pull request yet, `self` is null and every open pull request is a candidate
for overlap.

## When gh cannot answer

The section is **stated, never omitted**. An overlap section that silently disappears reads as
"nothing overlaps", which is a different and possibly false claim. So `overlap.available` is
`false`, with a stable `code`, `gh`'s own message as the `reason`, and a `summary` that says the
limitation in one sentence. The run still exits 0, and the composition result is unaffected.

The codes are listed in [the output reference](../output/README.md#errors).

## What is not here

- **Symbol-level overlap.** Two pull requests in one file but in different functions are an edge
  all the same. Tracked separately.
- **Performing merges.** footprint proposes an order; a human merges.
- **Pull requests beyond the limit.** 100 open pull requests are listed; if the list comes back at
  the limit, `truncated` is true, a `gh.list_truncated` warning is emitted, and the comment says
  there may be more.

## Reading it

The JSON Lines result is `footprint.overlap` 1.0.0 — fields in
[the output reference](../output/README.md#the-overlap-result). `--human` renders the same record
as an `### Open pull requests` section: the summary, the overlapping pull requests with the files
they share, and a collapsed merge order.
