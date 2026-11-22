# Output — test plan

Evidence lives in `test/cli.test.ts`, which runs the CLI as a subprocess against this repository
and validates every line of every stream against the schema for its exact `(id, version)` pair:
the protocol schemas shipped by `@flyingrobots/parley-emit`, `schemas/footprint.composition.schema.json`
and `schemas/footprint.landing.schema.json`. The landing plan's derivation is pure, so its evidence
is in `test/landing.test.ts`, over the fixture repositories under `test/fixtures/landing/` — each a
directory holding the documents footprint reads and a `changed-files.txt` standing in for the diff,
so the suite needs neither git nor the network.

| ID | Requirement |
| --- | --- |
| OUT-1 | Every line on stdout and stderr is a JSON object that validates against its declared schema; the run opens with the bootstrap line and closes with `end` |
| OUT-2 | A run writes the receipt the bootstrap line names, with a step per decision and the file listing |
| OUT-3 | A range with no changes is a result, not prose |
| OUT-4 | A git failure is a structured error with a stable code and exit 2 |
| OUT-5 | `--human` prints the Markdown comment |
| OUT-6 | `--help` and `--schema` are runs that describe the tool |
| OUT-7 | The head carries the resolved range with both commit ids; `inv` is stable for one comparison and differs between comparisons |
| OUT-9 | A run emits a `footprint.landing` 1.0.0 result after the composition result: separate Before merge and After merge sections, after-merge steps that cite the file and heading they were read from, a stated fallback when no document declares steps, "nothing to do after merge" when the change touches no executable surface, and a loud warning when the diff changes source and no changed file is a migration, a flag, or a version/changelog entry |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| OUT-1a | `HEAD~1..HEAD` against this repository | every line validates; `run` at `seq: 0` first; `end` with status 0 last; category rows sum to the totals | `the CLI speaks the Parley output protocol > a real range validates line by line and closes with end` | implemented |
| OUT-2a | The same run's receipt | exists at the absolute path; head first, `end` last; a `compare` step; a result copy carrying `files` | same test | implemented |
| OUT-3a | `HEAD..HEAD` | `composition.files` is 0 and `gut_check.flags` is empty; exit 0 | `... > a range with no changes is a result with zero files, not prose` | implemented |
| OUT-4a | `no-such-ref-9f8e7d..HEAD` | `error` with code `git.diff_failed` on stderr; `end` status 2; no result; exit 2 | `... > a base that does not exist is a structured error and exit 2` | implemented |
| OUT-5a | `HEAD~1..HEAD --human` | stdout contains the `## Footprint` comment and its computed-figures footer | `... > --human prints the Markdown comment` | implemented |
| OUT-7a | `HEAD~1..HEAD` twice and `HEAD~2..HEAD~1` once | `resolved.range`, 40-hex `base_commit` and `head_commit`; equal `inv` for the repeat, different for the other range | `... > the head carries the resolved range with both commit ids, and inv moves with them` | implemented |
| OUT-6a | `--help`, `--schema` | runs with one `command` line; `--help` carries exactly the result and error schemas; `--schema` more; receipts exist | `... > --help and --schema are runs that describe the tool` | implemented |
| OUT-9a | `test/fixtures/landing/with-release` | five steps in document order, each citing `RELEASE.md` and its own heading; `declared` true; `AGENTS.md` read with no landing heading | `after merge: steps read from the repository's own documents > a repository with a RELEASE.md yields its steps, each citing file and heading` | planned |
| OUT-9b | The same `RELEASE.md` text through `declaredSteps` | neither heading is a step; no line of the fenced block is a step; no item under a non-landing heading is a step | `... > a heading is never a step, and neither is a line in a fenced code block` | planned |
| OUT-9c | `test/fixtures/landing/no-release` | `declared` false, no steps, and a statement naming the absent `RELEASE.md`, the read `AGENTS.md` and that footprint states none rather than inventing them | `... > no RELEASE.md and an AGENTS.md with no landing section is a stated fallback` | planned |
| OUT-9d | `test/fixtures/landing/empty-release` (a zero-byte `RELEASE.md`, an `AGENTS.md` whose `Releasing` heading has nothing under it) | the heading is reported as read and still declares nothing; the same stated fallback | `... > an empty RELEASE.md, and a landing heading with nothing under it, declare nothing` | planned |
| OUT-9e | `test/fixtures/landing/docs-only` (a `RELEASE.md` that does declare steps) | `nothing_to_do` true, the statement contains "nothing to do after merge", no steps apply, and the headings read are still reported | `... > a documentation-only change says nothing to do after merge, plainly` | planned |
| OUT-9f | An empty changed-file list | `nothing_to_do` true with the same plain sentence | `... > a range that changes no file says nothing to do after merge` | planned |
| OUT-9g | `test/fixtures/landing/no-release` (`src/app.ts` alone) | `unguarded` true, no guards, and `unguarded_because` naming the rule's three guard kinds | `before merge: the guard rule is path patterns, computed > a source change with no migration, flag or version entry is unguarded` | planned |
| OUT-9h | `test/fixtures/landing/with-release` (`src/app.ts`, `src/app.test.ts`, `CHANGELOG.md`) | `unguarded` false with `CHANGELOG.md` cited as a `version` guard | `... > a changelog entry among the changed files is a guard, so the warning stays quiet` | planned |
| OUT-9i | `test/fixtures/landing/docs-only` | `unguarded` false because no changed file is source | `... > a change touching no source file is not unguarded, because nothing needs a guard` | planned |
| OUT-9j | Path lists covering each guard pattern and two non-guards | every guard path classified `migration`, `flag` or `version`; `src/app.ts` and `docs/README.md` are not guards | `... > guardsIn classifies migrations, flags and version entries by path` | planned |
| OUT-9k | `test/fixtures/landing/migration` | the migration item names `db/migrations/0003_add_index.sql` and states the ordering constraint; the change is guarded | `... > a migration in the diff is named with its ordering constraint` | planned |
| OUT-9l | `package.json` changed without a lockfile, then with `bun.lock` | the first yields a `regenerate` item naming `package.json`; the second yields none | `... > a manifest changed with no lockfile beside it is an artifact to regenerate` | planned |
| OUT-9m | `dist/bundle.js` among the changed files | a `generated` item naming the path, as an observation | `... > generated files in the diff are reported as generated, not judged` | planned |
| OUT-9n | `renderLanding` over the unguarded fixture | `## Before merge` precedes `## After merge`; the warning renders as a GitHub `[!WARNING]` alert with the bold sentence | `the two --human sections > Before merge and After merge are separate sections, and the warning is loud` | planned |
| OUT-9o | `renderLanding` over the with-release fixture | every step renders with `` `RELEASE.md` › <heading>``; no warning | `... > every after-merge step is rendered with the file and heading it was read from` | planned |
| OUT-9p | `renderLanding` over the docs-only fixture | the plain sentence, and no step list | `... > a docs-only change renders the plain sentence and no step list` | planned |
| OUT-9q | `HEAD~1..HEAD` against this repository | two results in order, `footprint.composition` then `footprint.landing`; the landing line validates; `after_merge.read` names `RELEASE.md` then `AGENTS.md`; both results are in the receipt | `the CLI speaks the Parley output protocol > the landing result follows the composition result in the same run` | planned |
| OUT-9r | `HEAD~1..HEAD --human` | the composition comment, then `## Before merge`, then `## After merge` | `... > --human prints Before merge and After merge after the composition comment` | planned |
| OUT-9s | `--help` | the declared schemas are `footprint.composition`, `footprint.landing` and `parley.error`, in that order | `... > --help and --schema are runs that describe the tool` | planned |

## Known gaps

- The structural branch is exercised with whatever graft the test machine has; no test pins
  `structural.available: true`, because graft is optional and the test must pass without it.
