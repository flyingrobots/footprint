# CI

What runs automatically, where it runs, and the command that reproduces it locally.

## What runs

A single GitHub Actions workflow, [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml),
triggers on every push to `main` and on every pull request. One job, `test`, on `ubuntu-latest`:

1. Checks out the repository.
2. Installs Bun with [`oven-sh/setup-bun@v2`](https://github.com/oven-sh/setup-bun).
3. Installs dependencies with `bun install --frozen-lockfile`, against the committed `bun.lock`.
4. Runs the gate: `bun test`, with five environment variables set (below) that a local run does
   not need.

`@flyingrobots/graft`, the optional structural-enrichment dependency some CLI tests exercise, is
an `optionalDependency` resolved at runtime through
`import.meta.resolve("@flyingrobots/graft/package.json")` (see `src/graft.ts` and the "Why it is
optional *and* why `.npmrc` exists" section of [`AGENTS.md`](../../../AGENTS.md)). `bun install`
installs it on its own; the workflow needs no separate install step, global package or PATH entry
for it.

## Proving graft answered, not merely that it installed

`@flyingrobots/graft` can install cleanly on `ubuntu-latest` and still never answer a single
question: flyingrobots/footprint#10 found by accident that `test/cli.test.ts`'s graft-backed
assertions were quietly taking their "unavailable" branch, because `node` was off the restricted
PATH those tests build for the spawned CLI. That particular cause is fixed, but the shape of the
failure — a green suite that proves nothing about the subject it claims to cover — is not
something one fix retires for good. `test/require-graft.test.ts` is the standing guard against it:
set `FOOTPRINT_REQUIRE_GRAFT=1` and it runs the CLI over `HEAD~1..HEAD` of this repository and
asserts `footprint.blast_radius`'s `exports.available` is `true`, failing with graft's own stated
reason when it is not. Unset, it is skipped, visibly, by name, so a local run is never forced to
depend on graft just to pass. The workflow sets the variable; a local `bun test` does not.

**Why graft did not answer in CI, and what fixed it.** graft maintains its own lazy WARP index as
git objects written directly into the repository it reads — `git hash-object`, `git mktree`, `git
commit-tree` — through `@git-stunts/plumbing`'s `NodeShellRunner`. That runner sanitises the
environment it hands to its own git subprocesses down to a short whitelist (`EnvironmentPolicy`,
in `@git-stunts/plumbing`'s source), and that whitelist does not include `HOME`. Without `HOME`,
git has no `~/.gitconfig` to read a committer identity from; on `ubuntu-latest`'s runner user (and
reproduced locally in a plain `node:24-bookworm` container), git's own fallback identity
construction then fails too, and `git commit-tree` exits 128. graft surfaces that as "Git command
failed with code 128" and exits 1; footprint records it as `graft.exports_failed` —
`exports.available: false` — exactly as if graft had never run at all. No WARP index, cache
directory or `node` setup was missing; the fix is four environment variables that
`EnvironmentPolicy`'s whitelist *does* carry through: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
`GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL`, set on the `Run the gate` step so every graft
subprocess — not only `test/require-graft.test.ts`'s own — has an identity to write its index
with.

## Where

Results show up as a check on the pull request and on the commit for pushes to `main`, at
`github.com/flyingrobots/footprint/actions`.

## Running the same thing locally

```bash
bun install --frozen-lockfile
bun test
```

This is `AGENTS.md`'s local gate, and it is enough: without `FOOTPRINT_REQUIRE_GRAFT=1` nothing
new runs, and a sandbox lacking a usable git identity for graft's own writes still passes, because
nothing here is asserting that it must not. To run the stronger check locally — the one CI runs —
set the same five variables the workflow does:

```bash
FOOTPRINT_REQUIRE_GRAFT=1 \
GIT_AUTHOR_NAME=you GIT_AUTHOR_EMAIL=you@example.com \
GIT_COMMITTER_NAME=you GIT_COMMITTER_EMAIL=you@example.com \
bun test
```
