# The pull-request comment

A pull request carries **one** Footprint comment. `footprint comment` finds it and updates it in
place, or creates it, and appends a row to the **Changelog** at its foot saying when it was run,
on which head, what changed and why (flyingrobots/footprint#59). The report it posts can carry two
columns on its call-site tables, **Impact** and **Data flow**, which are the posting agent's
reading of the code, never footprint's measurement. This page is the reference for both; the
[test plan](test-plan.md) beside it is the contract ledger. The agent's procedure is in
[`skills/footprint/SKILL.md`](../../../skills/footprint/SKILL.md).

## The flow

```bash
footprint origin/main...origin/my-branch --human --max-chars 57344 --impact impact.jsonl > report.md
footprint comment 42 --report report.md --change "First report" --reason "Pull request opened" --remarks "none"
```

Run both from inside the repository the pull request belongs to: `gh` resolves the repository from
the working directory.

## `footprint comment`

```text
footprint comment <pr> --report <file> --change <text> --reason <text> [--remarks <text>]
```

`comment` must be the first argument that is not a flag. Every flag takes a value; an unknown flag
is an error. `--dry-run` does everything but the write, and its result says what it would have
done.

### Which comment it writes

1. The most recent comment whose first line is `<!-- footprint:report -->` and that the current
   `gh` user (`gh api user`) wrote. It is edited in place.
2. Failing that, if a comment carrying the marker was written by **someone else**, nothing is
   written: the command stops with `comment.other_author`. footprint never edits another user's
   comment, and posting a second one would break the one-comment rule.
3. Failing that, the most recent comment by the current user whose body begins `## Footprint`: a
   report posted before the marker existed. It is **adopted**: edited in place, given the marker,
   and the new row's Remarks end `Adopted an earlier Footprint comment that carried no marker.`
   Its old body carries no Changelog, so the new one starts with this row.
4. Failing that, a new comment.

When the current user has more than one marked (or, in case 3, more than one unmarked) Footprint
comment, the most recent is written and the others are named in a `comment.duplicates` warning.
They are never deleted.

### The comment's shape

```text
<!-- footprint:report -->
<the report, as footprint --human wrote it>

<details><summary>Changelog</summary>

| Timestamp | SHA | Change | Reason | Remarks |
| --------- | --- | ------ | ------ | ------- |
| 2026-11-23T14:03:12Z | 1a2b3c4 | First report | Pull request opened | none |

</details>
```

<sub>Illustrative: the row is an example of the form, not output captured from a run.</sub>

- The marker is an HTML comment, so it does not render. It is the comment's only identity: a
  comment that loses its first line is no longer found, and the next run creates a new one.
- The Changelog is always the last thing in the comment. Its summary line and its two header lines
  are the owner's, byte for byte. The blank line after the summary is not in the owner's shape and
  is needed: without it GitHub renders the table as raw text, as checked with `gh api markdown`.
- Rows are append-only, oldest first. Every earlier row is carried over **verbatim**; the new row
  is the time in UTC (ISO-8601, to the second), the first 7 characters of the pull request's head
  commit as `gh pr view` reports it when the command runs, and the Change, Reason and Remarks given.
  In a cell `|` is escaped as `\|`, every newline becomes `<br>`, and an empty value is `—`.

### The size bound

GitHub rejects a comment body over 65536 characters. The report is the bulk of it, so the report is
run with `--max-chars 57344`, leaving 8192 for the marker and the Changelog. When the rows do not
all fit, the **newest** are kept and the Changelog ends with
`<sub>N older Changelog rows dropped to keep this comment within GitHub's 65536-character limit.</sub>`,
where `N` counts every row dropped by every run. When the report leaves no room for even the new
row, the command stops with `comment.too_long` and writes nothing.

### The result

One `footprint.comment` 1.0.0 line (`schemas/footprint.comment.schema.json`):

| Field | Meaning |
| --- | --- |
| `pull_request` | The pull request number |
| `action` | `created` or `updated`; under `--dry-run`, what would have been done |
| `adopted` | True when an unmarked `## Footprint` comment was adopted |
| `dry_run` | True under `--dry-run`; nothing was written |
| `comment` | `id` and `url` (`html_url`) as GitHub answered the write; `null` where a dry run has none |
| `head_sha` | The 7-character head SHA written in the row |
| `row` | The row appended, before escaping |
| `changelog` | `rows` in the comment now, `carried` from before, `dropped` in all |
| `chars`, `limit` | The body's length and 65536 |

`--human` prints one sentence instead: what was done, the comment's URL and the row count.

### Errors and warnings

| Code | When | Exit |
| --- | --- | --- |
| `args.invalid` | No pull request number, or not a number; a missing `--report`, `--change` or `--reason`; an unknown flag or one without a value | 2 |
| `report.unreadable` | The `--report` file cannot be read, or is empty | 2 |
| `gh.not_found` | `gh` is not on `PATH` | 2 |
| `gh.unauthenticated`, `gh.rate_limited`, `gh.no_remote`, `gh.call_failed` | A `gh` call failed; `problem` carries gh's own message | 2 |
| `comment.other_author` | The Footprint comment was written by another user; nothing was written | 2 |
| `comment.too_long` | The report leaves no room for one Changelog row under 65536 characters; nothing was written | 2 |
| `comment.duplicates` (warning) | The current user has more than one Footprint comment; the most recent is written, the rest are named | 0 |

### What it asks `gh`

```text
gh api user --jq .login
gh pr view <pr> --json headRefOid --jq .headRefOid
gh api repos/{owner}/{repo}/issues/<pr>/comments --paginate --jq <id, author, body, created_at per comment>
gh api --method POST  repos/{owner}/{repo}/issues/<pr>/comments --input -     (create)
gh api --method PATCH repos/{owner}/{repo}/issues/comments/<id> --input -     (update)
```

The body goes on standard input as `{"body": ...}`, never on the command line.

## `--max-chars`

`footprint <range> --human --max-chars <n>` bounds the report to `n` characters, from 40960 to
65536 (default 65536). Composition, landing and overlap keep their own budgets (16384, 8192 and
8192); the blast radius gets what they leave of `n`, so a lower bound trims the call-site and
symbol tables first, and every trim says how many rows it left out. Outside the range it is
`args.invalid`.

## The Impact and Data flow columns

footprint finds call sites by a whole-word scan; it cannot see what a change does at one at run
time, and it reports rather than judges ([`AGENTS.md`](../../../AGENTS.md)). The agent running the
skill can read the code, and supplies its reading with `--impact <file>`:

```json
{"symbol": "blastRadius", "system": "src", "impact": "...", "dataFlow": "..."}
{"symbol": "blastRadius", "system": "src", "file": "src/cli.ts", "impact": "...", "dataFlow": "..."}
```

<sub>Illustrative: the `...` are where the agent's reading goes.</sub>

- **Impact**: how run-time behaviour changes at the call site and downstream of it in that system.
- **Data flow**: what reads the value, what writes it, where the call's arguments come from.

The header names are one constant, `IMPACT_COLUMNS` in `src/impact.ts`. The owner named the first;
"Data flow" is a reading of the second and may be renamed there.

How entries apply:

| Entry | Covers |
| --- | --- |
| `symbol`, `system`, `file` | That symbol's rows in that file. Wins over the system-wide entry |
| `symbol`, `system` | Every row of that symbol in that system, and that system's line in the summarised-symbols table |
| none | The row says `not assessed`. A cell is never blank, and nothing is filled in for the agent |

With `--impact`, every call-site table gains the two columns and the section carries a note that
they are the posting agent's reading of the code at this head, not footprint's measurement. The
summarised-symbols table gets them too, one line per system. Without `--impact` the tables are
exactly what they were. No result line ever carries the entries: the JSON Lines stay footprint's
measurement. The columns count against the report's size bound like every other cell.

The file is one JSON object per line, blank lines skipped, with exactly the keys above, each a
non-empty string, and no `(symbol, system, file)` twice; anything else is `impact.invalid` naming
the line, and the run writes no report. An entry that matches no call-site row of the range is an
`impact.unmatched` warning, because it is a typo or was written for an earlier head. Entries are
never carried from one run to the next: every run is a new head and is assessed again.
