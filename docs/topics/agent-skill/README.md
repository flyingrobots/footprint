# The agent skill

`skills/footprint/SKILL.md` is an agent skill: instructions an agent loads when a pull request is
open, or about to be opened, reviewed or merged, telling it how to run footprint on that pull
request, post the report, and act on it. This page is the reference for what the skill does and
how to install it. The skill itself is the source of truth for the steps; this page does not
repeat them.

## What it does

1. **Finds the program** without ever running a bare `footprint`, because on macOS
   `/usr/bin/footprint` is an unrelated Apple memory tool that comes first on `PATH`. It uses
   `bunx @flyingrobots/footprint` once the package is on npm, and before then `bun <clone>/src/cli.ts`
   from a clone of this repository, named by a shell function `fp` rather than a variable, so the
   same commands run in bash and in zsh, which does not word-split an unquoted variable
   (flyingrobots/footprint#37). It checks that `node` is on `PATH`, which graft needs.
2. **Resolves the range** as `origin/<base>...origin/<head>` after `git fetch`, or the fetched
   `pull/<n>/head` for a pull request from a fork.
3. **Runs footprint with `--human --max-chars 57344`** from inside the repository under review and
   reads the call-site tables.
4. **Assesses the call sites**: the agent reads the code and writes its Impact and Data flow
   reading of each call site of a removed or signature-changed symbol outside the declaring file
   and the tests, per system where the report summarises, to a JSON Lines file for `--impact`.
5. **Posts the one Footprint comment** with `footprint comment`, which updates the pull request's
   existing Footprint comment in place, or creates it, and appends a Changelog row whose Change,
   Reason and Remarks the agent writes ([the pull-request comment](../comment/README.md)). It never
   uses `gh pr comment`, which would make a second comment.
6. **Follows the report**: each Before merge item, each breaking change, each call site outside the
   changed file, the overlap and its proposed merge order, and, once merged, each After merge
   step. Each is handled in the pull request or answered in a comment saying why it needs nothing.
7. **Re-runs after every push**, because a report on an earlier head describes a different
   change; the same comment is updated and gains a row.

It never presents the report as a verdict, and never presents its own Impact and Data flow reading
as footprint's measurement; the comment labels them as the agent's. footprint reports and does not judge
([`AGENTS.md`](../../../AGENTS.md)), and a skill that turned it into a gate would teach people to
shape diffs to satisfy it.

## Installing it

The skill is a directory, `skills/footprint/`, holding one `SKILL.md` with `name: footprint` in
its frontmatter. Install it the way your agent loads skills: copy or link the directory into the
agent's skills directory, or point a skill manager at it. It is also shipped inside the npm
package, under `skills/footprint/`.

After a release that changes `skills/footprint/`, reinstall it, so the installed copy matches the
release; [`RELEASE.md`](../../../RELEASE.md) lists that as an after-merge step.

## What it needs

| Needs | Why |
| --- | --- |
| Bun | footprint runs on Bun, not Node |
| Node on `PATH` | graft, the optional structural analysis, runs on Node; without it the report says the structural section is unavailable |
| `gh`, authenticated | to read the pull request, find, create or edit its Footprint comment, and find overlapping pull requests |
| bash or zsh | the commands are checked under both ([test plan](test-plan.md)) |
| A checkout of the repository under review | footprint reads its git history, `RELEASE.md` and `AGENTS.md` |
