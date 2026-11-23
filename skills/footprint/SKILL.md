---
name: footprint
description: >-
  Run footprint on a pull request's range, post its report as a PR comment, and act on what it
  lists before and after the merge. Use whenever a pull request is open, or is about to be opened,
  reviewed, updated or merged, and whenever someone asks to "post the footprint", for a footprint
  report, or for what a change touches, its blast radius, its overlap with other pull requests or
  how it lands.
---

# footprint

footprint reads a diff and reports what it touches: its composition by file kind, the exported
symbols that moved and where they are called from, what to check before the merge and do after
it, and which other open pull requests change the same files. It **reports; it does not judge**.
Nothing in its output is a verdict, an approval or a merge gate, and this skill must never present
it as one.

Source and reference: <https://github.com/flyingrobots/footprint>.

## 1. Find the program — never a bare `footprint`

On macOS, `/usr/bin/footprint` is an unrelated Apple memory tool and comes first on `PATH`. Never
run a bare `footprint`. Use, in this order:

1. **The published package**, when `npm view @flyingrobots/footprint version` answers:

   ```bash
   fp() { bunx @flyingrobots/footprint "$@"; }
   ```

2. **Before the package is published**, a clone of `flyingrobots/footprint` with its dependencies
   installed. Use one the user already has, or make one in a scratch directory:

   ```bash
   git clone https://github.com/flyingrobots/footprint "$SCRATCH/footprint"
   (cd "$SCRATCH/footprint" && bun install)
   fp() { bun "$SCRATCH/footprint/src/cli.ts" "$@"; }
   ```

   `$SCRATCH` stands for whatever directory you use for temporary files; do not write a
   machine-specific path into any repository.

`fp` is a shell function, not a variable holding a command, because zsh (the macOS default shell)
does not word-split an unquoted variable: `FP="bun …"; $FP` runs the whole string as one command
name and exits 127. A function runs the same in bash and zsh. Shell state may not survive from one
tool call to the next, so define `fp` in the same command that runs it.

footprint runs on **Bun**. Its structural analysis comes from graft, which runs on **Node**, so
`node` must be on `PATH` (`command -v node`). Without it the report still posts, but says the
structural section is unavailable; fix `PATH` and re-run rather than posting a degraded report
when you can.

Always run footprint **from inside the repository under review**: it reads that repository's git
history, its `RELEASE.md` and its `AGENTS.md`.

## 2. Resolve the range

```bash
git fetch origin
BASE=$(gh pr view "$PR" --json baseRefName -q .baseRefName)
HEAD_REF=$(gh pr view "$PR" --json headRefName -q .headRefName)
RANGE="origin/$BASE...origin/$HEAD_REF"
```

Three dots: the change since the branch left its base, not the base's own later commits. For a
pull request from a fork, `origin/$HEAD_REF` does not exist; fetch the pull request's head instead and
use it:

```bash
git fetch origin "pull/$PR/head:refs/remotes/origin/pr-$PR"
RANGE="origin/$BASE...origin/pr-$PR"
```

Before the pull request exists, use the local branch: `RANGE="origin/main...HEAD"`, after pushing
it.

## 3. Run it and post the report

```bash
OUT="$SCRATCH/footprint-$PR.md"
fp "$RANGE" --human > "$OUT"
gh pr comment "$PR" --body-file "$OUT"
```

`--human` is the Markdown comment. Without it footprint writes JSON Lines, which is what to parse
if you need a field rather than the prose. Post the report as footprint wrote it; do not edit,
trim or summarise it into the comment.

The report is bounded to GitHub's 65536-character comment limit in total, whatever the change, so a large change prints
summaries and says what it omitted (`N more ... omitted`, or a `Symbols with more than 50 call
sites` table with a count per system). It is already the whole report that can be posted; the
rest is in the JSON Lines result lines and the receipt (its `files` field for the file list), which are not bounded.

## 4. Follow what it lists

Read the posted report and act on every item below. Each one is either handled in the pull
request or answered in a PR comment that says why it needs nothing. Silence is neither.

- **Before merge.** Every item: a migration and its ordering constraint, a generated file, a
  manifest changed without its lockfile. If the report shows the unguarded-change warning (source
  changed and no migration, flag, version or changelog entry), either add what the repository's
  working agreement asks for or say why none applies.
- **Breaking changes.** Each one graft names, and each removed or signature-changed export on the
  blast radius: confirm the callers were updated, or the change is versioned as breaking.
- **Call sites outside the changed file.** Every row whose mitigation is not `None needed` names
  a call site in another system, or outside every known system. Check each: updated, unaffected
  (say why), or followed up. Where the report says it omitted call sites, or counted a symbol's
  sites instead of listing them, its own figure says how many carry a mitigation other than `None
  needed`; read those from the `footprint.blast_radius` result (run `fp "$RANGE"` without
  `--human`) and check them the same way.
- **Overlap.** Each open pull request that shares a file, and the proposed merge order. Tell the
  authors of overlapping pull requests, and land in the proposed waves unless there is a reason not
  to, which you state.
- **After merge.** Once the pull request has merged, do each step the report quoted from the
  repository's `RELEASE.md` or `AGENTS.md`, in order. footprint quotes them; it never runs them.
  If it said no steps are declared, it invented none, and neither should you.

## 5. Re-run after the last push

Every push changes the range. After the last push before merge, run steps 2 and 3 again and
post the fresh report, then check step 4 against it. A report on an earlier head is a report on a
different change.

## What never to do

- Never call the report a pass, a fail, an approval or a verdict, and never block or merge on it
  alone. It is input to a decision.
- Never reshape a diff only to make the report quieter. The moment the output becomes a gate,
  diffs get shaped to satisfy it and the report stops meaning anything.
- Never fill in a number or a step the report did not state. Every figure in it is computed;
  anything added by hand is not.
