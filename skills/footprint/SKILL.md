---
name: footprint
description: >-
  Run footprint on a pull request's range, post its report as the pull request's one Footprint
  comment (updated in place on every run, with a Changelog row and your Impact and Data flow
  reading of the call sites), and act on what it lists before and after the merge. Use whenever a pull request is open, or is about to be opened,
  reviewed, updated or merged, and whenever someone asks to "post the footprint", for a footprint
  report, or for what a change touches, its blast radius, its overlap with other pull requests or
  how it lands.
---

# footprint

footprint reads a diff and reports what it touches: its composition by file kind, the exported
symbols that moved and where they are called from, what to check before the merge and do after
it, and which other open pull requests change the same files. The report lives in one comment
per pull request, updated in place on every run, with a Changelog of the runs at its foot. It **reports; it does not judge**.
Nothing in its output is a verdict, an approval or a merge gate, and this skill must never present
it as one.

Source and reference: <https://github.com/flyingrobots/footprint>.

## 1. Find the program — never a bare `footprint`

On macOS, `/usr/bin/footprint` is an unrelated Apple memory tool and comes first on `PATH`. Never
run a bare `footprint`. Use, in this order:

1. **An installed package**, when `command -v git-footprint` answers: the package ships a
   `git-footprint` binary, which git runs as `git footprint`, so no name clash applies. For its
   help, run `git-footprint --help`: git turns `git footprint --help` into a man-page lookup.

   ```bash
   fp() { git footprint "$@"; }
   ```

2. **The published package**, when `npm view @flyingrobots/footprint version` answers:

   ```bash
   fp() { bunx @flyingrobots/footprint "$@"; }
   ```

3. **Before the package is published**, a clone of `flyingrobots/footprint` with its dependencies
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

## 3. Run the report and read it

```bash
OUT="$SCRATCH/footprint-$PR.md"
fp "$RANGE" --human --max-chars 57344 > "$OUT"
```

`--human` is the Markdown comment. Without it footprint writes JSON Lines, which is what to parse
if you need a field rather than the prose. `--max-chars 57344` holds the report to 57344
characters, leaving 8192 of GitHub's 65536-character comment limit for the Changelog that step 5
adds. Always pass it when the report will be posted.

The report is bounded, whatever the change, so a large change prints summaries and says what it
omitted (`N more ... omitted`, or a `Symbols with more than 50 call sites` table with a count per
system). The rest is in the JSON Lines result lines and the receipt (its `files` field for the
file list), which are not bounded.

Read the call-site tables (under **Call sites by system**) now: step 4 is about them.

## 4. Assess the call sites: the Impact and Data flow columns

footprint found the call sites; it cannot see what the change does at them at run time. You can,
by reading the code. Your reading goes into two columns of the call-site tables, and the comment
labels them as **your reading, not footprint's measurement**. Never present them as footprint's.

- **Impact**: how run-time behaviour changes at this call site, and downstream of it in that
  system. What now happens differently when this line runs, and what that changes further along.
  "None: the name appears in a comment" is an answer.
- **Data flow**: what reads the value, what writes it, and where the call's arguments come from.

Write one JSON object per line to `$IMPACT`, a fresh file for every run:

```json
{"symbol": "blastRadius", "system": "src", "impact": "...", "dataFlow": "..."}
{"symbol": "blastRadius", "system": "src", "file": "src/cli.ts", "impact": "...", "dataFlow": "..."}
```

<sub>Illustrative: the `...` are where your reading goes.</sub>

`symbol` and `system` are as the tables print them. Without `file` an entry covers every row of
that symbol in that system; with `file` it covers that symbol's rows in that file and wins over the
system-wide entry. A row no entry covers says `not assessed`. An empty file is allowed, and then
every row says `not assessed`.

Be proportionate, and say where you did not look:

- **Assess every row whose mitigation is not `None needed`** (not the declaring file, not a test
  file) for each **removed** or **signature-changed** symbol. Those are the rows where a caller
  can break.
- **Rows the report summarises** (the `Symbols with more than 50 call sites` table, or a table that
  says it omitted rows): assess per system, one entry without `file` for each system the symbol
  is called in. Read the omitted rows from the `footprint.blast_radius` result (`fp "$RANGE"`
  without `--human`).
- Added symbols, test files and the declaring file: assess when it matters; otherwise leave them
  to say `not assessed`.
- When you did not look at a row you were asked to assess, say so and why, rather than leave it
  to read as an oversight: `"impact": "not assessed: generated file"`.
- Never carry an earlier run's entries over. Every run is a new head; assess it again. An entry
  that matches no row of this head is reported as an `impact.unmatched` warning: fix or drop it.

## 5. Post it: the one Footprint comment

A pull request carries **one** Footprint comment. `fp comment` finds it and updates it in place,
or creates it, and appends one row to the **Changelog** at its foot. Never post the report with
`gh pr comment`; that makes a second comment.

Set the three cells of the new Changelog row:

```bash
CHANGE="First report: 4 files, +120/-8; two signature changes"
REASON="Pull request opened"
REMARKS="none"
```

<sub>Illustrative values.</sub>

- **Change**: what moved in the report since the previous row: files and lines, symbols added,
  removed or re-signed, a new overlap or a cleared one. On the first run, the headline.
- **Reason**: why footprint was run again: `Pull request opened`, `New commits pushed`, `Review
  fix`, `Merged main`.
- **Remarks**: anything a reader of the comment should know: a section that was unavailable and
  why, call sites you did not assess, a follow-up you opened. `none` when there is nothing.

Then render the report with your assessment and post it, from inside the repository under review
(`fp comment` reads the pull request's repository from the working directory, as `gh` does):

```bash
OUT="$SCRATCH/footprint-$PR.md"
fp "$RANGE" --human --max-chars 57344 --impact "$IMPACT" > "$OUT"
fp comment "$PR" --report "$OUT" --change "$CHANGE" --reason "$REASON" --remarks "$REMARKS"
```

Post the report as footprint wrote it; do not edit, trim or summarise it into the comment.

What `fp comment` does, so you can tell the user:

- It looks for the comment whose first line is `<!-- footprint:report -->`, written by the current
  `gh` user, and edits it in place. With none, it adopts the most recent comment by the current
  `gh` user that begins `## Footprint` (a report posted before this flow existed) and says so in
  the row's Remarks. With neither, it creates the comment.
- It carries every earlier Changelog row over verbatim, oldest first, and appends the new row: the
  UTC time, the pull request head's 7-character SHA, and your Change, Reason and Remarks.
- It keeps the whole comment within 65536 characters. If the Changelog grows too long, it keeps
  the newest rows and says how many older ones were dropped.
- It **never edits another user's comment**. If the Footprint comment was written by someone else,
  it stops with `comment.other_author` and writes nothing: tell the user, and do not post a second
  report another way.

Its result line (`footprint.comment`) names the comment's `url`, whether it was `created` or
`updated`, and the Changelog's row count. Pass `--dry-run` to see what it would do without
writing.

## 6. Follow what it lists

Read the posted report and act on every item below. Each one is either handled in the pull
request or answered in a PR comment that says why it needs nothing. Silence is neither.

- **Before merge.** Every item: a migration and its ordering constraint, a generated file, a
  manifest changed without its lockfile. If the report shows the unguarded-change warning (source
  changed and no migration, flag, version or changelog entry), either add what the repository's
  working agreement asks for or say why none applies.
- **Breaking changes.** Each one graft names, and each removed or signature-changed export on the
  blast radius: confirm the callers were updated, or the change is versioned as breaking. Your
  Impact column is where you have already read them.
- **Call sites outside the changed file.** Every row whose mitigation is not `None needed` names
  a call site in another system, or outside every known system. Check each: updated, unaffected
  (say why), or followed up. Where the report says it omitted call sites, or counted a symbol's
  sites instead of listing them, its own figure says how many carry a mitigation other than `None
  needed`; read those from the `footprint.blast_radius` result (run `fp "$RANGE"` without
  `--human`) and check them the same way.
- **Overlap.** Each open pull request that shares a file, what each shared file looks like at the
  symbol level, and the proposed merge order. Tell the authors of overlapping pull requests,
  naming the shared symbols when the report gives them. Land in the proposed waves unless there is
  a reason not to, and state that reason. A `different symbols` file does not separate waves, but
  git can still conflict on it: rerun footprint after the first of the two merges. An `undetermined`
  file is file-level overlap, and its reason says why (for example, a head commit that is not
  local: `git fetch origin pull/<n>/head`).
- **After merge.** Once the pull request has merged, do each step the report quoted from the
  repository's `RELEASE.md` or `AGENTS.md`, in order. footprint quotes them; it never runs them.
  If it said no steps are declared, it invented none, and neither should you.

## 7. Re-run after every push

Every push changes the range. After each push, and always after the last one before merge, run
steps 2 to 5 again: a fresh report, a fresh assessment, and `fp comment`, which updates the same
comment and adds a row saying what changed and why. Then check step 6 against it. A report on an
earlier head is a report on a different change.

## What never to do

- Never call the report a pass, a fail, an approval or a verdict, and never block or merge on it
  alone. It is input to a decision.
- Never reshape a diff only to make the report quieter. The moment the output becomes a gate,
  diffs get shaped to satisfy it and the report stops meaning anything.
- Never fill in a number or a step the report did not state. Every figure in it is computed;
  anything added by hand is not. Your Impact and Data flow entries are the one place your own
  reading goes, and the comment says so.
- Never post a second Footprint comment, and never edit or delete another user's.
- Never rely on an `@handle` in `--change`, `--reason`, `--remarks` or an Impact or Data flow cell to
  notify someone. footprint writes every handle there as code, as it does in quoted pull request
  titles and landing steps, so they notify no one. Tell people in a separate comment.
