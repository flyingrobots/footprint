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

## Hard don'ts

- Do not weaken a test to go green.
- Do not add a dependency without a reason the README can state.
- Do not make the output a gate.
