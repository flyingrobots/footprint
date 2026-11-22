# Output — test plan

Evidence lives in `test/cli.test.ts`, which runs the CLI as a subprocess against this repository
and validates every line of every stream against the schema for its exact `(id, version)` pair:
the protocol schemas shipped by `@flyingrobots/parley-emit`,
`schemas/footprint.composition.schema.json` and `schemas/footprint.overlap.schema.json`. The
computation behind the second result lives in `test/overlap.test.ts`, over
`{number, title, isDraft, files}` records and over the text `gh` writes when it fails, so no test
needs the network or an open pull request on this repository.

| ID | Requirement |
| --- | --- |
| OUT-1 | Every line on stdout and stderr is a JSON object that validates against its declared schema; the run opens with the bootstrap line and closes with `end` |
| OUT-2 | A run writes the receipt the bootstrap line names, with a step per decision and the file listing |
| OUT-3 | A range with no changes is a result, not prose |
| OUT-4 | A git failure is a structured error with a stable code and exit 2 |
| OUT-5 | `--human` prints the Markdown comment |
| OUT-6 | `--help` and `--schema` are runs that describe the tool |
| OUT-7 | The head carries the resolved range with both commit ids; `inv` is stable for one comparison and differs between comparisons |
| OUT-8 | A second result, `footprint.overlap` 1.0.0, follows the composition in the same run: the open pull requests that share a file with this change, the conflict graph between them with a reason per edge, and the proposed merge waves. When `gh` is absent, unauthenticated or rate-limited the result carries `available: false` with a code and a reason and the run still succeeds; the section is stated, never omitted |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| OUT-1a | `HEAD~1..HEAD` against this repository | every line validates; `run` at `seq: 0` first; `end` with status 0 last; category rows sum to the totals | `the CLI speaks the Parley output protocol > a real range validates line by line and closes with end` | implemented |
| OUT-2a | The same run's receipt | exists at the absolute path; head first, `end` last; a `compare` step; a result copy carrying `files` | same test | implemented |
| OUT-3a | `HEAD..HEAD` | `composition.files` is 0 and `gut_check.flags` is empty; exit 0 | `... > a range with no changes is a result with zero files, not prose` | implemented |
| OUT-4a | `no-such-ref-9f8e7d..HEAD` | `error` with code `git.diff_failed` on stderr; `end` status 2; no result; exit 2 | `... > a base that does not exist is a structured error and exit 2` | implemented |
| OUT-5a | `HEAD~1..HEAD --human` | stdout contains the `## Footprint` comment and its computed-figures footer | `... > --human prints the Markdown comment` | implemented |
| OUT-7a | `HEAD~1..HEAD` twice and `HEAD~2..HEAD~1` once | `resolved.range`, 40-hex `base_commit` and `head_commit`; equal `inv` for the repeat, different for the other range | `... > the head carries the resolved range with both commit ids, and inv moves with them` | implemented |
| OUT-6a | `--help`, `--schema` | runs with one `command` line; `--help` carries exactly the two result schemas and the error schema; `--schema` more; receipts exist | `... > --help and --schema are runs that describe the tool` | implemented |
| OUT-8a | One open pull request sharing a file with this change | reported with its number, title and the shared files; the summary counts it | `overlap with this change > a pull request sharing a file is reported with its number and title` | implemented |
| OUT-8b | One open pull request sharing no file | not reported as overlapping; the summary says so in prose | `overlap with this change > a disjoint pull request is not reported as overlapping` | implemented |
| OUT-8c | No open pull requests | empty overlapping, conflicts and waves, and a plain statement rather than an empty section | `overlap with this change > no open pull requests is a plain statement, not an empty section` | implemented |
| OUT-8d | This change's own pull request among the open ones | excluded from the overlap list, still present in the merge plan | `overlap with this change > this change's own pull request is excluded from the overlap, and kept in the plan` | implemented |
| OUT-8e | A draft pull request sharing a file | reported with `isDraft: true` rather than dropped | `overlap with this change > a draft pull request is reported as a draft rather than hidden` | implemented |
| OUT-8f | A pull request whose file list `gh` did not report | listed as undetermined with a reason, kept out of the conflict graph and the waves, counted in the summary | `overlap with this change > a pull request whose files could not be read is undetermined, never assumed disjoint` | implemented |
| OUT-8g | A pull-request list exactly at the query limit | `truncated: true`; below the limit, false | `overlap with this change > a list at the limit says it is truncated` | implemented |
| OUT-8h | Two pull requests sharing two files, a third sharing none | one edge, naming both shared files, sorted; no edge to the third | `the conflict graph > an edge names the files the two pull requests share` | implemented |
| OUT-8i | A pull request with an empty file list | conflicts with nothing and shares a wave | `the conflict graph > a pull request with no files conflicts with nothing` | implemented |
| OUT-8j | Two overlapping and one disjoint pull request | the overlapping two are in different waves, the disjoint one shares the first | `merge waves > overlapping pull requests land in different waves and disjoint ones share a wave` | implemented |
| OUT-8k | The same three pull requests in a different listing order | the identical plan | `merge waves > the plan does not depend on the order the pull requests were listed` | implemented |
| OUT-8l | One pull request, and none | one wave; no waves | `merge waves > one pull request is one wave`, `merge waves > no pull requests is no waves` | implemented |
| OUT-8m | An unavailable overlap | `available: false` with the code, the reason and a summary that states the limitation | `the stated limitation > an unavailable overlap carries a code and a reason, and is still a result` | implemented |
| OUT-8n | `HEAD~1..HEAD` with a PATH that has no `gh` | two results in order, composition then overlap; `available: false`, code `gh.not_found`; exit 0; the receipt carries the second result and an overlap step | `the CLI speaks the Parley output protocol > overlap is a second result after the composition, and states its limitation when gh is unavailable` | implemented |
| OUT-8o | The same run with `--human` | the Markdown carries the `### Open pull requests` section and the stated limitation | `the CLI speaks the Parley output protocol > --human carries the overlap section, including the stated limitation` | implemented |
| OUT-8p | Each thing `gh` says when it will not list: `gh auth login`, not logged in, HTTP 401, rate limit exceeded, no known GitHub host, anything else | the codes `gh.unauthenticated` (three cases), `gh.rate_limited`, `gh.no_remote`, `gh.list_failed`, and `gh`'s own message kept verbatim as the reason | `why gh could not answer > "<message>" is <code>`, six parameterised cases | implemented |
| OUT-8q | A failure `gh` wrote nothing for, and one it wrote several lines for | the reason names the exit code; the lines are kept, joined with `; ` | `why gh could not answer > a silent failure still carries a reason, with the exit code`, `why gh could not answer > a multi-line message is kept whole` | implemented |

## Known gaps

- The structural branch is exercised with whatever graft the test machine has; no test pins
  `structural.available: true`, because graft is optional and the test must pass without it.
- No test runs the CLI with `gh` present, so `overlap.available: true` is never asserted
  end to end. The suite removes `gh` from the PATH deliberately: a test that listed this
  repository's open pull requests would depend on the network and on which pull requests happen to
  be open. Everything between the records and the result — the conflict graph, the waves and the
  prose — is covered over fixed records in `test/overlap.test.ts`; what is not covered is the `gh`
  invocation itself and the parse of its JSON.
