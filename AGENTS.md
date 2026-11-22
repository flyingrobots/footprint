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

### Why it is an optionalDependency

graft is declared in `optionalDependencies`, not `dependencies` or `devDependencies`. That is
deliberate, and the reason is not graft's fault.

The chain is `@flyingrobots/graft` -> `@git-stunts/git-warp@16.0.1` -> `roaring@^2.7.0`, a hard
dependency. roaring publishes no prebuild for `darwin-arm64` at Node 26's module version (147), so
`node-pre-gyp` falls back to compiling and `make` exits 2. Because roaring is required rather than
optional, a plain `npm install` of graft aborts.

The upstream fix exists — current git-warp drops roaring — but its API changed enough that
adopting it is close to a rewrite of graft, so graft stays pinned to 16.0.1.

`optionalDependencies` makes that someone else's problem rather than ours: npm tolerates the
failure, skips graft, and the install succeeds. Verified both ways:

| Manager | Result |
| --- | --- |
| `bun install` | graft installed; Bun blocks the untrusted postinstall, which these paths never need |
| `npm install` | **exit 0**, graft skipped, footprint degrades and says so |

Never move graft out of `optionalDependencies` to get the structural section working. The
degradation is the feature.

## Hard don'ts

- Do not weaken a test to go green.
- Do not invoke `graft serve` or `graft daemon`.
- Do not add a dependency without a reason the README can state.
- Do not make the output a gate.
