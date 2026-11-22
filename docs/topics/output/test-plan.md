# Output — test plan

Evidence lives in `test/cli.test.ts`, which runs the CLI as a subprocess against this repository
and validates every line of every stream against the schema for its exact `(id, version)` pair:
the protocol schemas shipped by `@flyingrobots/parley-emit` and `schemas/footprint.composition.schema.json`.

| ID | Requirement |
| --- | --- |
| OUT-1 | Every line on stdout and stderr is a JSON object that validates against its declared schema; the run opens with the bootstrap line and closes with `end` |
| OUT-2 | A run writes the receipt the bootstrap line names, with a step per decision and the file listing |
| OUT-3 | A range with no changes is a result, not prose |
| OUT-4 | A git failure is a structured error with a stable code and exit 2 |
| OUT-5 | `--human` prints the Markdown comment |
| OUT-6 | `--help` and `--schema` are runs that describe the tool |
| OUT-7 | The head carries the resolved range with both commit ids; `inv` is stable for one comparison and differs between comparisons |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| OUT-1a | `HEAD~1..HEAD` against this repository | every line validates; `run` at `seq: 0` first; `end` with status 0 last; category rows sum to the totals | `the CLI speaks the Parley output protocol > a real range validates line by line and closes with end` | implemented |
| OUT-2a | The same run's receipt | exists at the absolute path; head first, `end` last; a `compare` step; a result copy carrying `files` | same test | implemented |
| OUT-3a | `HEAD..HEAD` | `composition.files` is 0 and `gut_check.flags` is empty; exit 0 | `... > a range with no changes is a result with zero files, not prose` | implemented |
| OUT-4a | `no-such-ref-9f8e7d..HEAD` | `error` with code `git.diff_failed` on stderr; `end` status 2; no result; exit 2 | `... > a base that does not exist is a structured error and exit 2` | implemented |
| OUT-5a | `HEAD~1..HEAD --human` | stdout contains the `## Footprint` comment and its computed-figures footer | `... > --human prints the Markdown comment` | implemented |
| OUT-7a | `HEAD~1..HEAD` twice and `HEAD~2..HEAD~1` once | `resolved.range`, 40-hex `base_commit` and `head_commit`; equal `inv` for the repeat, different for the other range | `... > the head carries the resolved range with both commit ids, and inv moves with them` | implemented |
| OUT-6a | `--help`, `--schema` | runs with one `command` line; `--help` carries exactly the result and error schemas; `--schema` more; receipts exist | `... > --help and --schema are runs that describe the tool` | implemented |

## Known gaps

- The structural branch is exercised with whatever graft the test machine has; no test pins
  `structural.available: true`, because graft is optional and the test must pass without it.
