# footprint

What a change actually touches.

`footprint` reads a diff and reports its composition — how many files, of what kind, and what share
of the change each kind accounts for — so you can tell at a glance whether the change is shaped the
way you think it is.

```bash
bun src/cli.ts                    # compare the default branch to HEAD; JSON Lines on stdout
bun src/cli.ts origin/main        # explicit base
bun src/cli.ts abc123..def456     # explicit range
bun src/cli.ts --human | gh pr comment 42 --body-file -   # the Markdown comment
bun src/cli.ts --help             # what it emits, as JSON Lines
```

From a clone, run it with `bun src/cli.ts` as above. Once the package is on npm,
`bunx @flyingrobots/footprint` takes the same arguments; the package runs on Bun, not Node. On
macOS, do not type a bare `footprint`: `/usr/bin/footprint` is an unrelated Apple memory tool that
comes first on `PATH`. For an agent reviewing a pull request there is a skill that does all of
this: [`skills/footprint/SKILL.md`](skills/footprint/SKILL.md).

footprint speaks the [Parley output protocol](https://github.com/flyingrobots/parley): four
`result` lines on stdout — the composition with its gut check, structural summary and digest, then
the landing plan, the blast radius and the cross-pull-request overlap; errors on stderr as
structured lines; a receipt per run under `.parley/receipts/` with every
decision and the file listing. `--human` is the opt-in for prose. See
[`docs/topics/output/README.md`](docs/topics/output/README.md).

## How it lands

Merging is not landing, so footprint also reports what it takes to land a change: a **Before
merge** section of what the changed-file list itself shows — migrations and their ordering
constraint, generated files, a manifest whose lockfile is missing, and a loud warning when a source
change carries no migration, flag or version entry to gate or record it — and an **After merge**
section whose steps are *read out of the repository's own `RELEASE.md` and `AGENTS.md`*, each
citing the file and heading it came from. Where neither document declares any, it says so instead
of guessing; where a change touches no executable surface, it says there is nothing to do. The
guard rule behind the warning is documented path patterns, never a judgement:
[`docs/topics/landing/README.md`](docs/topics/landing/README.md).

## Why

Two reasons, both from real failures.

**Branches balloon without you noticing.** Working fast, a branch grows to hundreds of files and
nothing tells you. One glance at the composition does.

**Scrutiny should be proportional to blast radius**, and that judgment needs an instrument. A
documentation-only change and a migration are not the same risk, and "it looked small" is not
evidence.

## What it does not do

It reports; it does not judge. A large change is not automatically risky, and a one-line change to
an auth check outweighs a thousand lines of prose. Treat the output as input to a decision, never
as a gate — a gate gets gamed.

## Every figure is computed

Nothing here is estimated. Totals come from `git diff --numstat`, and the category rows are
required by test to sum to the reported total. This is the bug that made the original hand-written
version untrustworthy: a draft reported `+151` for a `+157` change, with hand-estimated shares.

## Blast radius: which exports moved

With graft available, a run also reports its **export surface**: the exported symbols the change
added, removed or re-signed, each with its file and name **and where it is called from**, as the
third result line (`footprint.blast_radius` 1.1.0) and a `## Blast radius` section in the Markdown
comment. A renamed export shows up as a removal and an addition. The symbols come from graft's CLI
contract `graft struct exports <base-ref> <head-ref> --json`, passed through verbatim; a three-dot
range is compared from the merge base. When graft cannot answer — absent, failing, or speaking a
contract version footprint does not read — the result says so with a reason instead of omitting the
section.

The **call sites** are footprint's own, because no graft contract answers with a call site's line:
every whole-word occurrence of the symbol's name in the tracked, non-binary files of the working
tree, which is `grep -w`'s rule and nothing cleverer. A symbol nothing references is listed with an
empty list rather than dropped. It counts the declaration, comments and prose, and it cannot see
dynamic dispatch or a re-export under another name — it is evidence a reviewer can check with one
`grep`, not a call graph, and the test suite checks it against exactly that.
See [`docs/topics/blast-radius/README.md`](docs/topics/blast-radius/README.md).

## Cross-pull-request overlap

A fourth result says which **open pull requests** change a file this change changes — by number and
title — and proposes an order the open pull requests could land in, as waves, with the shared files
named for every edge. Each shared file is also compared at the **symbol level**. Each side's changed
lines are attributed to the top-level symbols graft finds in the file, and the file is reported as
`symbol-disjoint` with the symbols named, as `symbol-overlapping`, or as `undetermined` with the
reason. A symbol-disjoint edge is reported, but it does not split two pull requests into different
waves. An undetermined edge splits them, as a file-level edge does. The
open pull requests come from `gh pr list`, their files from `gh pr diff --name-only`, and nothing
is merged or rebased: the order is a proposal, not a gate. When `gh` is absent or cannot answer,
the result says so with a code and `gh`'s own message and the run still succeeds, because an
omitted section would read as "nothing overlaps". See
[`docs/topics/overlap/README.md`](docs/topics/overlap/README.md).

## Structural analysis is optional

With [graft](https://github.com/flyingrobots/graft) available, the report adds what paths cannot
tell you — whether a source file's **symbols** actually moved, or whether the diff was only
formatting.

Both `bun install` and `npm install` get it. A transitive native dependency of graft has no
prebuild on newer Node, so this repo's `.npmrc` skips dependency install scripts — nothing on the
structural path needs that native module. graft is also declared optional, so even an install that
cannot read that `.npmrc` succeeds rather than failing.

If graft is genuinely unavailable, the report says the structural section is unavailable rather
than quietly omitting it. A degraded run should never read as a clean one.

## Status

**v0.4.1** — composition, the landing plan, the export-surface diff with the call sites of each
changed symbol grouped by system, the unanalysed languages, and the cross-pull-request overlap
down to the symbol level, all as JSON Lines through the Parley output protocol. Released on GitHub
when its tag is pushed; on npm as `@flyingrobots/footprint` once its first publish is done (see
[the release workflow](docs/workflows/release/README.md)).

Documentation: [`docs/README.md`](docs/README.md). Working agreement: [`AGENTS.md`](AGENTS.md).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
