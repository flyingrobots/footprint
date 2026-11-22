# footprint

What a change actually touches.

`footprint` reads a diff and reports its composition — how many files, of what kind, and what share
of the change each kind accounts for — so you can tell at a glance whether the change is shaped the
way you think it is.

```bash
bun src/cli.ts                    # compare the default branch to HEAD
bun src/cli.ts origin/main        # explicit base
bun src/cli.ts abc123..def456     # explicit range
bun src/cli.ts | gh pr comment 42 --body-file -
```

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

## Structural analysis is optional

With [graft](https://github.com/flyingrobots/graft) available, the report adds what paths cannot
tell you — whether a source file's **symbols** actually moved, or whether the diff was only
formatting.

It is an `optionalDependency` on purpose. `bun install` gets it; `npm install` may skip it on
newer Node, because a transitive native dependency has no prebuild there. Either way the install
succeeds, and without graft the report says the structural section is unavailable rather than
quietly omitting it.

## Status

**v0.1** — composition only. Call-site blast radius, cross-pull-request merge ordering, and
post-merge landing plans are [tracked as issues](https://github.com/flyingrobots/footprint/issues).

Documentation: [`docs/README.md`](docs/README.md). Working agreement: [`AGENTS.md`](AGENTS.md).
