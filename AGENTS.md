# Working agreement

General rules live in `~/.agents/AGENTS.md`. This records what is specific to `footprint`.

## The local gate

```bash
bun test
```

No build step and no `package.json` dependencies: Bun runs the TypeScript directly.

## The rule that matters

**Never report a figure that was not computed.** Every number in the output derives from
`git diff --numstat`. A footprint that estimates is worse than no footprint, because it is
believed. There is a test asserting the category rows sum to the reported total; do not delete it.

**Report, never judge.** Flags are observations. The moment this becomes a merge gate, people will
shape diffs to satisfy it.

## Classification

`src/classify.ts` is an ordered rule list, first match wins. Order is load-bearing — a test fixture
must classify as `test` before the extension rules see it, and a lockfile as `generated` before the
JSON rule claims it. Add a test when you add a rule.

Anything unrecognised falls through to `source`, deliberately: an unknown file should look like
code that needs review, not vanish.

## graft

Structural enrichment is optional and comes from [`@flyingrobots/graft`](https://github.com/flyingrobots/graft),
a dev dependency. No global install is needed: `resolveGraft()` finds the binary through
`import.meta.resolve("@flyingrobots/graft/package.json")`, falls back to `PATH`, and returns
`null` rather than throwing.

**Only one-shot subcommands.** Never `graft serve` and never `graft daemon`. footprint must not
hold a long-lived process, and the daemon has known memory growth.

When graft is missing or fails, the report says so as a stated limitation. It must never
silently omit the structural section — an absent signal that looks like a clean signal is worse
than no tool at all.

Install note: `bun add` works because Bun blocks untrusted postinstalls by default. `npm install -g`
fails on graft's native `cbor-extract` build, which these code paths do not need.

## Hard don'ts

- Do not weaken a test to go green.
- Do not invoke `graft serve` or `graft daemon`.
- Do not add a dependency without a reason the README can state.
- Do not make the output a gate.
