# CI

What runs automatically, where it runs, and the command that reproduces it locally.

## What runs

A single GitHub Actions workflow, [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml),
triggers on every push to `main` and on every pull request. One job, `test`, on `ubuntu-latest`:

1. Checks out the repository.
2. Installs Bun with [`oven-sh/setup-bun@v2`](https://github.com/oven-sh/setup-bun).
3. Installs dependencies with `bun install --frozen-lockfile`, against the committed `bun.lock`.
4. Runs the gate: `bun test`.

`@flyingrobots/graft`, the optional structural-enrichment dependency some CLI tests exercise, is
an `optionalDependency` resolved at runtime through
`import.meta.resolve("@flyingrobots/graft/package.json")` (see `src/graft.ts` and the "Why it is
optional *and* why `.npmrc` exists" section of [`AGENTS.md`](../../../AGENTS.md)). `bun install`
installs it on its own; the workflow needs no separate install step, global package or PATH entry
for it.

## Where

Results show up as a check on the pull request and on the commit for pushes to `main`, at
`github.com/flyingrobots/footprint/actions`.

## Running the same thing locally

```bash
bun install --frozen-lockfile
bun test
```

This is exactly `AGENTS.md`'s local gate — the workflow runs nothing additional and nothing less.
