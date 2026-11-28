# footprint

<img width="1774" height="887" alt="footprint-git" src="https://github.com/user-attachments/assets/94ac676b-b63f-4ccc-afae-f128a1249344" />

**See what a change actually touches.**

`footprint` reads a diff and reports its composition: how many files changed, what kind they are, and what share of the change each kind accounts for. You can tell at a glance whether the change has the shape you expect.

## Usage

```bash
bun src/cli.ts                    # compare the default branch to HEAD; JSON Lines on stdout
bun src/cli.ts origin/main        # explicit base
bun src/cli.ts abc123..def456     # explicit range
bun src/cli.ts --human > report.md                       # the Markdown comment
bun src/cli.ts comment 42 --report report.md --change "First report" --reason "Pull request opened"
                                  # post it as pull request 42's one Footprint comment, updated in place
bun src/cli.ts --help             # what it emits, as JSON Lines
```

- **From a clone:** run `bun src/cli.ts`, as above.
- **Installed** (`bun add -g @flyingrobots/footprint`): `git footprint` takes the same arguments. The package ships a `git-footprint` binary, which git runs as a subcommand. For help, run `git-footprint --help`: git turns `git footprint --help` into a man-page lookup. The package runs on Bun, not Node.
- **From npm (once published):** `bunx @flyingrobots/footprint` also takes the same arguments.
- **On macOS:** never type a bare `footprint`; use `git footprint` when installed, or `bun src/cli.ts` from a clone. `/usr/bin/footprint` is an unrelated Apple memory tool that comes first on `PATH`.
- **For agents:** a skill covers the whole workflow for reviewing a pull request: [`skills/footprint/SKILL.md`](skills/footprint/SKILL.md).

### Output

footprint follows the [Parley output protocol](https://github.com/flyingrobots/parley):

- **stdout:** four `result` lines.
  1. The composition, with its gut check, structural summary and digest.
  2. The landing plan.
  3. The blast radius.
  4. The cross-pull-request overlap.
- **stderr:** errors, as structured lines.
- **Receipts:** each run writes a receipt to `.parley/receipts/`, with every decision and the file listing.
- **Prose:** `--human` opts in.

See [`docs/topics/output/README.md`](docs/topics/output/README.md). `footprint comment` keeps one Footprint comment per pull request, with a Changelog of its runs: [`docs/topics/comment/README.md`](docs/topics/comment/README.md).

## Why

Both reasons come from real failures.

**Branches balloon unnoticed.** Working fast, a branch can grow to hundreds of files and nothing tells you. One look at the composition does.

**Scrutiny should match blast radius.** That judgment needs an instrument. A docs-only change and a migration carry different risk, and "it looked small" is not evidence.

## What it does not do

It reports; it does not judge. A large change isn't automatically risky, and a one-line change to an auth check outweighs a thousand lines of prose. Use the output as input to a decision, never as a gate. A gate gets gamed.

## Every figure is computed

Nothing is estimated. Totals come from `git diff --numstat`, and a test requires the category rows to sum to the reported total. This rule exists because the original hand-written version reported `+151` for a `+157` change, with hand-estimated shares.

## How it lands

Merging is not landing, so footprint also reports what it takes to land a change.

**Before merge** covers what the changed-file list itself shows:
- Migrations and their ordering constraint.
- Generated files.
- A manifest whose lockfile is missing.
- A loud warning when a source change carries no migration, flag or version entry to gate or record it.

**After merge** lists steps *read out of the repository's own `RELEASE.md` and `AGENTS.md`*, each citing the file and heading it came from. If neither document declares any, it says so rather than guessing. If the change touches no executable surface, it says there is nothing to do.

The guard rule behind the warning is documented path patterns, never a judgement: [`docs/topics/landing/README.md`](docs/topics/landing/README.md).

## Blast radius: which exports moved

When graft is available, a run also reports its **export surface**. This is the exported symbols the change added, removed or re-signed. Each entry gives the file, the name, and **where it is called from**. It appears as the third result line (`footprint.blast_radius` 1.1.0) and as a `## Blast radius` section in the Markdown comment. A renamed export shows up as a removal plus an addition.

- **Symbols:** they come from graft's CLI contract, `graft struct exports <base-ref> <head-ref> --json`, passed through verbatim. A three-dot range is compared from the merge base.
- **When graft can't answer:** if graft is absent, failing, or speaking a contract version footprint doesn't read, the result says so with a reason. It never silently omits the section.
- **Call sites:** these are footprint's own, because no graft contract returns a call site's line. They are every whole-word occurrence of the symbol's name in the tracked, non-binary files of the working tree, which is `grep -w`'s rule and nothing cleverer.
- **Unreferenced symbols:** they are listed with an empty list, not dropped.
- **Limits:** the count includes the declaration, comments and prose. It can't see dynamic dispatch or a re-export under another name. It is evidence a reviewer can check with one `grep`, not a call graph, and the test suite checks it against exactly that.

See [`docs/topics/blast-radius/README.md`](docs/topics/blast-radius/README.md).

## Cross-pull-request overlap

The fourth result names the **open pull requests** that change a file this change also changes, by number and title. It proposes an order the open pull requests could land in, as waves, with the shared files named for every edge.

Each shared file is also compared at the **symbol level**. Each side's changed lines are attributed to the top-level symbols graft finds in the file. The file is then reported as one of:
- `symbol-disjoint`, with the symbols named.
- `symbol-overlapping`.
- `undetermined`, with the reason.

A symbol-disjoint edge is reported but does not put two pull requests in different waves. An undetermined edge does split them, as a file-level edge does.

Open pull requests come from `gh pr list` and their files from `gh pr diff --name-only`. Nothing is merged or rebased, so the order is a proposal, not a gate. If `gh` is absent or can't answer, the result says so with a code and `gh`'s own message, and the run still succeeds. An omitted section would read as "nothing overlaps."

See [`docs/topics/overlap/README.md`](docs/topics/overlap/README.md).

## Structural analysis is optional

With [graft](https://github.com/flyingrobots/graft) available, the report adds what paths can't tell you: whether a source file's **symbols** actually moved, or whether the diff was only formatting.

Both `bun install` and `npm install` get it. A transitive native dependency of graft has no prebuild on newer Node, so this repo's `.npmrc` skips dependency install scripts. Nothing on the structural path needs that native module. graft is also declared optional, so an install that can't read that `.npmrc` still succeeds.

If graft is unavailable, the report says the structural section is unavailable instead of quietly omitting it. A degraded run should never read as a clean one.

## Status

**v0.7.1** includes:
- Composition.
- The landing plan.
- The export-surface diff, with each changed symbol's call sites grouped by system.
- Unanalysed languages.
- Cross-pull-request overlap down to the symbol level.
- The single Footprint comment per pull request.

All of it is emitted as JSON Lines through the Parley output protocol. A release is published on GitHub when its tag is pushed. The npm package `@flyingrobots/footprint` is staged for the owner to approve (see [the release workflow](docs/workflows/release/README.md)).

## Docs

- Documentation: [`docs/README.md`](docs/README.md)
- Working agreement: [`AGENTS.md`](AGENTS.md)

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
