# The pull-request comment — test plan

Evidence lives in `test/comment.test.ts` and `test/impact.test.ts` (flyingrobots/footprint#59).
The comment cases run the real CLI against a stand-in `gh`, `test/fixtures/fake-gh/gh`, which
keeps a pull request's comments in a JSON file, answers the `gh api` and `gh pr view` calls
`footprint comment` makes, records every call, and refuses a PATCH of a comment its user did not
write, as GitHub does. The shape of the Changelog and the escaping are pure functions in
`src/comment.ts` and are tested without `gh`. The impact cases render the blast radius from a
surface built in memory, as `test/bound.test.ts` does, so they need neither git nor graft, except
the CLI cases, which run against this repository.

| ID | Requirement |
| --- | --- |
| CM-1 | A pull request carries one Footprint comment. `footprint comment` finds the comment whose first line is `<!-- footprint:report -->` and updates it in place; with none, it adopts the most recent comment by the current `gh` user that begins `## Footprint` and says so in the new row's Remarks; with neither, it creates one. It never edits another user's comment: a marked comment by someone else is refused with an error and nothing is written |
| CM-2 | The comment ends with the Changelog: `<details><summary>Changelog</summary>`, a blank line, the owner's two header lines byte for byte, one row per run oldest first, and `</details>` as the last line. Earlier rows are carried verbatim; the new row is a UTC ISO-8601 timestamp to the second, the head's 7-character SHA, and the Change, Reason and Remarks given, with `\|` escaped and newlines as `<br>` |
| CM-3 | The whole comment is at most 65536 characters. A Changelog that would not fit keeps the newest rows and states how many older rows were dropped, counting every run's drops; a report too long to leave room for one row is an error and nothing is written |
| CM-4 | `footprint comment` speaks the output contract: every line validates against its declared schema, `footprint.comment` 1.0.0 for the result; `--help` declares it; `gh` absent, a failing `gh` call and bad arguments are error lines with exit 2; `--dry-run` writes nothing |
| IM-1 | `footprint --impact <file>` adds two columns, Impact and Data flow, to every call-site table and to the table of summarised symbols in `--human`. An entry `{symbol, system, file?, impact, dataFlow}` with a `file` covers that symbol's rows in that file and wins over one without, which covers the symbol's rows in that system; a row no entry covers says `not assessed`. The section says the columns are the posting agent's reading, not footprint's measurement. Without `--impact` the tables are unchanged, and the JSON result lines never carry the columns |
| IM-2 | An impact file that is not one JSON object per line with exactly those keys, or that repeats a `(symbol, system, file)`, is an error with its line number and exit 2; an entry that matches no row is a `impact.unmatched` warning naming it |
| MC-1 | `footprint --max-chars <n>` bounds `--human` to `n` characters, for any `n` from 40960 to 65536; outside that range it is an error. The skill runs at 57344, `COMMENT_REPORT_LIMIT`, leaving the Changelog 8192 characters |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| CM-1a | Golden: a pull request with no comment | one comment, first line the marker, the report after it, a Changelog with one row; the call log shows one POST | `the Footprint comment (flyingrobots/footprint#59) > creates one marked comment with a one-row Changelog when the pull request has none` | implemented |
| CM-1b | Golden: the same pull request run a second time with a new head | still one comment, same id, PATCHed; the first row byte-identical and first, the new row last with the new SHA | `the Footprint comment (flyingrobots/footprint#59) > a second run updates that comment in place: one comment, rows preserved in order, the new row last` | implemented |
| CM-1c | Edge: two unmarked `## Footprint` comments by the current user | the more recent is PATCHed and gains the marker; the older is untouched; the row's Remarks say it was adopted | `the Footprint comment (flyingrobots/footprint#59) > adopts the most recent unmarked Footprint comment by the current user, and says so in Remarks` | implemented |
| CM-1d | Known failure mode: a marked comment by another user | error `comment.other_author`, exit 2, no POST and no PATCH | `the Footprint comment (flyingrobots/footprint#59) > never edits another user's comment: a marked comment by someone else is refused and nothing is written` | implemented |
| CM-1e | Edge: an unmarked `## Footprint` comment by another user only | it is untouched and a new marked comment is created | `the Footprint comment (flyingrobots/footprint#59) > an unmarked Footprint comment by another user is left alone and a new one is created` | implemented |
| CM-2a | Change, Reason and Remarks carrying `\|`, CRLF and LF | the cells carry `\|` and `<br>`, and the row has exactly five cells | `the Changelog > cell text has pipes escaped and newlines as <br>` | implemented |
| CM-2b | A built comment | the marker is the first line; `</details>` is the last; the summary and header lines are the owner's, byte for byte | `the Changelog > the Changelog is the last thing in the comment, in the owner's shape` | implemented |
| CM-2c | The row written by CM-1a | timestamp matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`; SHA is the first 7 characters of the stand-in head | `the Footprint comment (flyingrobots/footprint#59) > the row is a UTC timestamp to the second and the head's 7-character SHA` | implemented |
| CM-3a | 400 earlier rows of 300 characters beside a report near the limit | at most 65536 characters; the newest rows kept, the new row last; the notice states the exact number dropped | `the Changelog > a Changelog too long to fit keeps the newest rows and states how many were dropped` | implemented |
| CM-3b | A comment that already says 12 rows were dropped, and drops 5 more | the notice says 17 | `the Changelog > the dropped count accumulates across runs` | implemented |
| CM-3c | Stress: a 57344-character report and 300 earlier rows, through the CLI | the posted body is at most 65536 characters | `the Footprint comment (flyingrobots/footprint#59) > a report at the 57344 bound with a long Changelog posts at or under 65536` | implemented |
| CM-3d | A report of 65500 characters | error `comment.too_long`, exit 2, nothing written | `the Footprint comment (flyingrobots/footprint#59) > a report too long to leave room for one row is an error and nothing is written` | implemented |
| CM-4a | Every stream of CM-1a and CM-1b, and `comment --help` | every line validates; `--help` names the `comment` command and `footprint.comment@1.0.0` | `the Footprint comment (flyingrobots/footprint#59) > a second run updates that comment in place: one comment, rows preserved in order, the new row last` (its streams, and `comment --help` after it) | implemented |
| CM-4b | `gh` absent; and `--dry-run` with the stand-in | `gh.not_found`, exit 2; the dry run's result says what it would do and the call log holds no POST or PATCH | `the Footprint comment (flyingrobots/footprint#59) > gh absent is an error line, and --dry-run writes nothing` | implemented |
| CM-4c | No `--report`, no `--reason`, a pull request that is not a number, an unreadable report | error `args.invalid` or `report.unreadable`, exit 2, no `gh` write | `the Footprint comment (flyingrobots/footprint#59) > bad arguments are error lines and nothing is written` | implemented |
| IM-1a | Two symbols over two systems, one entry | the covered rows carry its text; every other row says `not assessed`; no cell is empty | `the impact columns (flyingrobots/footprint#59) > rows an entry covers carry its Impact and Data flow; every other row says not assessed` | implemented |
| IM-1b | A system-wide entry and a file entry for the same symbol | the file's rows carry the file entry; the symbol's other rows in that system the system-wide one | `the impact columns (flyingrobots/footprint#59) > an entry with a file covers only that file's rows, and wins over the system-wide entry` | implemented |
| IM-1c | A symbol with more call sites than the summarising threshold | its summary row carries each system's entry, named by system, and `not assessed` for a system with none | `the impact columns (flyingrobots/footprint#59) > a summarised symbol carries the per-system entries in its row` | implemented |
| IM-1d | The same surface with and without an index | with: the column headers come from `IMPACT_COLUMNS` and the note names them as the agent's reading; without: the rendering is byte-identical to the one before this change | `the impact columns (flyingrobots/footprint#59) > the columns are labelled as the agent's reading, and absent without an index` | implemented |
| IM-1e | Impact text with `\|` and a newline | escaped as in CM-2a | `the impact columns (flyingrobots/footprint#59) > cells escape pipes and newlines` | implemented |
| IM-1f | The oversized surface of `test/bound.test.ts` with a long entry for every symbol in every system | at most the budget, and each system's shown plus omitted rows still equal its total | `the impact columns (flyingrobots/footprint#59) > the columns stay within the budget, and the omission counts still add up` | implemented |
| IM-1g | The CLI on this repository with `--impact` and `--human`, and the same run's JSON Lines | `--human` carries the headers; every JSON line validates and no result carries `impact` or `dataFlow` | `the impact columns through the CLI > --impact adds the columns to --human only, and an unmatched entry is a warning` | implemented |
| IM-2a | Lines that are not JSON, miss `dataFlow`, carry an unknown key, an empty `impact`, or repeat a key | each rejected with its 1-based line number | `the impact columns (flyingrobots/footprint#59) > an invalid line is rejected with its line number` | implemented |
| IM-2b | `--impact` naming a missing file, and one with a bad line, through the CLI | error `impact.invalid`, exit 2 | `the impact columns through the CLI > an unreadable or invalid impact file is an error` | implemented |
| MC-1a | The oversized repository of OUT-21p with `--max-chars 40960` | the report is at most 40960 characters | `the impact columns through the CLI > --max-chars bounds the whole report` | implemented |
| MC-1b | `--max-chars 100`, `--max-chars 70000`, `--max-chars x` | error `args.invalid`, exit 2 | `the impact columns through the CLI > --max-chars outside 40960..65536 is an error` | implemented |
| MC-1c | The skill's report command | passes `--max-chars` equal to `COMMENT_REPORT_LIMIT` | `the skill's commands > the report is bounded to leave the Changelog its room` (`test/skill.test.ts`) | implemented |

## Known gaps

- The stand-in `gh` prints what the real `--jq` expressions print; it does not run them. The real
  expressions were exercised by hand on flyingrobots/footprint#60, whose Footprint comment was
  created and then updated in place by this command.
- The row's SHA is the pull request's head when `footprint comment` runs, not when the report was
  computed. A push between the two puts the newer SHA beside the older report; no test covers it,
  and the skill runs the two back to back.
