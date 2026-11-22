# Working agreement

General rules live in `~/.agents/AGENTS.md`. This records what is specific to `footprint`.

## The local gate

```bash
bun test
```

No build step. One runtime dependency, `@flyingrobots/parley-emit`; Bun runs the TypeScript directly.

## The rule that matters

**Never report a figure that was not computed.** Every number in the output derives from
`git diff --numstat`. A footprint that estimates is worse than no footprint, because it is
believed. There is a test asserting the category rows sum to the reported total; do not delete it.

**Report, never judge.** Flags are observations. The moment this becomes a merge gate, people will
shape diffs to satisfy it.

## Output

footprint emits through `@flyingrobots/parley-emit`. The results' contracts are
`schemas/footprint.composition.schema.json` and `schemas/footprint.overlap.schema.json`, one
result type per message and each versioned on its own; `test/cli.test.ts` runs the CLI against
this repository and validates every stream line by line. Do not write to stdout or stderr directly;
go through the run (`run.result`, `run.step`, `run.warning`, `run.error`). Prose is `--human`
only. A new field on the result is a schema version bump.

The package is versioned on its own and the schemas shipped inside it are the parley drafts at a
pinned commit; `bun install` needs the package on npm, or a `bun link` to a local checkout of
`flyingrobots/parley` while it is not.

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

**Depend on the CLI's JSON contract, never on graft's internals.** `struct review --json`
carries a `_schema` with an id and version; treat that as the interface. Do not import graft
modules, and do not reach into `node_modules/@flyingrobots/graft/dist`.

This is not fastidiousness. graft's substrate is slated to be rewritten from git-warp onto Echo,
which changes how structural history is stored at a fundamental level. A consumer bound to the CLI
contract does not notice that; a consumer bound to internals gets rewritten with it.

**`overrides` forces a patched `zod`.** graft pins `zod` at exactly `4.3.6`, which is below the
`4.6.6` that fixes a high-severity memory-exhaustion advisory (oversized constrained collections).
footprint overrides it to `^4.6.6`; verified graft still produces identical `struct review --json`
output under `4.6.7`. Remove the override once graft bumps its own pin.

**Only one-shot subcommands.** Never `graft serve` and never `graft daemon`. footprint must not
hold a long-lived process, and the daemon has known memory growth.

When graft is missing or fails, the report says so as a stated limitation. It must never
silently omit the structural section — an absent signal that looks like a clean signal is worse
than no tool at all.

### Why it is optional *and* why `.npmrc` exists

Both pieces are load-bearing, for different failure modes.

The chain is `@flyingrobots/graft` -> `@git-stunts/git-warp@16.0.1` -> `roaring@^2.7.0`, a hard
dependency. roaring publishes no prebuild for `darwin-arm64` at Node 26's module version (147), so
`node-pre-gyp` falls back to compiling and `make` exits 2. The upstream fix exists — current
git-warp drops roaring — but its API moved far enough that adopting it is close to a rewrite of
graft, so graft stays pinned to 16.0.1. Expect no fix from that direction.

**`.npmrc` sets `ignore-scripts=true`** so the native build never runs. Nothing on the structural
path uses roaring's native module, so skipping it costs nothing and graft installs cleanly. This
does not affect `npm run`, only dependency install scripts. Bun already blocks untrusted
postinstalls by default, which is why it always worked.

**`optionalDependencies` is the backstop** for the case `.npmrc` cannot reach: a global install,
or a consumer whose own config re-enables scripts. There the build fails, npm skips graft, and the
install still exits 0.

Verified:

| Install | graft | Exit |
| --- | --- | --- |
| `bun install` | present | 0 |
| `npm install` (with this `.npmrc`) | **present** | 0 |
| `npm install` (scripts enabled, no `.npmrc`) | skipped | 0 |

Never move graft to `dependencies`. The optional declaration is what keeps the third row from
being a failed install.

## Hard don'ts

- Do not weaken a test to go green.
- Do not invoke `graft serve` or `graft daemon`.
- Do not add a dependency without a reason the README can state.
- Do not make the output a gate.
