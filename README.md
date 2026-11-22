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

footprint speaks the [Parley output protocol](https://github.com/flyingrobots/parley): one
`result` line on stdout with the composition, the gut check, the structural summary and a digest,
a second with the cross-pull-request overlap;
errors on stderr as structured lines; a receipt per run under `.parley/receipts/` with every
decision and the file listing. `--human` is the opt-in for prose. See
[`docs/topics/output/README.md`](docs/topics/output/README.md).

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

## Cross-pull-request overlap

A second result says which **open pull requests** change a file this change changes — by number and
title — and proposes an order the open pull requests could land in, as waves where no two pull
requests in a wave share a file, with the shared files named for every edge that forces one. The
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

Composition and cross-pull-request overlap. Call-site blast radius, symbol-level overlap and
post-merge landing plans are [tracked as issues](https://github.com/flyingrobots/footprint/issues).

Documentation: [`docs/README.md`](docs/README.md). Working agreement: [`AGENTS.md`](AGENTS.md).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
