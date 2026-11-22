# Output — test plan

Evidence lives in `test/cli.test.ts`, which runs the CLI as a subprocess against this repository
and validates every line of every stream against the schema for its exact `(id, version)` pair:
the protocol schemas shipped by `@flyingrobots/parley-emit`, `schemas/footprint.composition.schema.json`,
`schemas/footprint.landing.schema.json`, `schemas/footprint.blast_radius.schema.json` and
`schemas/footprint.overlap.schema.json`. The landing plan's derivation is pure, so its evidence
is in `test/landing.test.ts`, over the fixture repositories under `test/fixtures/landing/` — each a
directory holding the documents footprint reads and a `changed-files.txt` standing in for the diff,
so the suite needs neither git nor the network. `test/exports.test.ts` holds the export-surface
cases, which are a pure function over graft's JSON and run without graft: its fixtures under
`test/fixtures/` were captured from real `graft struct exports --json` runs on this repository.
`test/languages.test.ts` holds the unanalysed-language cases, over the fixture changed-file lists
under `test/fixtures/languages/`, in the same `changed-files.txt` convention as the landing
fixtures: a pure function over paths, needing neither git nor graft. The computation behind the
fourth result lives in `test/overlap.test.ts`, over `{number, title, isDraft, files}` records and
over the text `gh` writes when it fails, so no test needs the network or an open pull request on
this repository. `test/languages-drift.test.ts` holds the drift case against the *installed*
graft (flyingrobots/footprint#21): it reads `src/languages.ts`'s extension list from source and
the installed `@flyingrobots/graft`'s own `dist/parser/lang.js` from disk, so it needs graft
installed and fails loudly, naming the path, rather than skipping, if either is missing.

| ID | Requirement |
| --- | --- |
| OUT-1 | Every line on stdout and stderr is a JSON object that validates against its declared schema; the run opens with the bootstrap line and closes with `end` |
| OUT-2 | A run writes the receipt the bootstrap line names, with a step per decision and the file listing |
| OUT-3 | A range with no changes is a result, not prose |
| OUT-4 | A git failure is a structured error with a stable code and exit 2 |
| OUT-5 | `--human` prints the Markdown comment |
| OUT-6 | `--help` and `--schema` are runs that describe the tool |
| OUT-7 | The head carries the resolved range with both commit ids; `inv` is stable for one comparison and differs between comparisons |
| OUT-8 | A fourth result, `footprint.overlap` 1.0.0, follows the blast radius in the same run: the open pull requests that share a file with this change, the conflict graph between them with a reason per edge, and the proposed merge waves. When `gh` is absent, unauthenticated or rate-limited the result carries `available: false` with a code and a reason and the run still succeeds; the section is stated, never omitted |
| OUT-9 | A run emits a `footprint.landing` 1.0.0 result after the composition result: separate Before merge and After merge sections, after-merge steps that cite the file and heading they were read from, a stated fallback when no document declares steps, "nothing to do after merge" when the change touches no executable surface, and a loud warning when the diff changes source and no changed file is a migration, a flag, or a version/changelog entry |
| OUT-10 | A run emits a third result line, `footprint.blast_radius` 1.1.0, after the landing plan; it validates against its schema, reaches the receipt, and `--help` declares it |
| OUT-11 | The export surface is parsed from graft's `graft.cli.struct_exports` 1.0.0 JSON by a pure function: a renamed export is reported removed and added, and a failed, unreadable or differently versioned answer is `available: false` with a stated reason, never a throw |
| OUT-12 | The blast-radius result (`footprint.blast_radius` 1.1.0) names the changed files, by file extension with a count, in languages footprint does not recognise as one graft's grammars can parse; the list is present and empty when every changed file was in a supported language; a parse failure in a *supported* language is never counted here, because detection is extension-only and never looks at whether graft ran or what it answered |
| OUT-12g | The extension list behind OUT-12 is checked against the *installed* graft, not just against fixtures: a grammar graft adds or drops cannot change footprint's `unanalysed_languages` output without a test turning red (flyingrobots/footprint#21) |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| OUT-1a | `HEAD~1..HEAD` against this repository | every line validates; `run` at `seq: 0` first; `end` with status 0 last; category rows sum to the totals | `the CLI speaks the Parley output protocol > a real range validates line by line and closes with end` | implemented |
| OUT-2a | The same run's receipt | exists at the absolute path; head first, `end` last; a `compare` step; a result copy carrying `files` | same test | implemented |
| OUT-3a | `HEAD..HEAD` | `composition.files` is 0 and `gut_check.flags` is empty; exit 0 | `... > a range with no changes is a result with zero files, not prose` | implemented |
| OUT-4a | `no-such-ref-9f8e7d..HEAD` | `error` with code `git.diff_failed` on stderr; `end` status 2; no result; exit 2 | `... > a base that does not exist is a structured error and exit 2` | implemented |
| OUT-5a | `HEAD~1..HEAD --human` | stdout contains the `## Footprint` comment and its computed-figures footer | `... > --human prints the Markdown comment` | implemented |
| OUT-7a | `HEAD~1..HEAD` twice and `HEAD~2..HEAD~1` once | `resolved.range`, 40-hex `base_commit` and `head_commit`; equal `inv` for the repeat, different for the other range | `... > the head carries the resolved range with both commit ids, and inv moves with them` | implemented |
| OUT-6a | `--help`, `--schema` | runs with one `command` line; `--help` carries exactly the four result schemas and the error schema, in emission order; `--schema` more; receipts exist | `... > --help and --schema are runs that describe the tool` | implemented |
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
| OUT-8n | `HEAD~1..HEAD` with a PATH that has no `gh` | four results in order, the overlap last; `available: false`, code `gh.not_found`; exit 0; the receipt carries the overlap result and an overlap step | `the CLI speaks the Parley output protocol > overlap is the fourth result, after the blast radius, and states its limitation when gh is unavailable` | implemented |
| OUT-8o | The same run with `--human` | the Markdown carries the `### Open pull requests` section and the stated limitation | `the CLI speaks the Parley output protocol > --human carries the overlap section, including the stated limitation` | implemented |
| OUT-8p | Each thing `gh` says when it will not list: `gh auth login`, not logged in, HTTP 401, rate limit exceeded, no known GitHub host, anything else | the codes `gh.unauthenticated` (three cases), `gh.rate_limited`, `gh.no_remote`, `gh.list_failed`, and `gh`'s own message kept verbatim as the reason | `why gh could not answer > "<message>" is <code>`, six parameterised cases | implemented |
| OUT-8q | A failure `gh` wrote nothing for, and one it wrote several lines for | the reason names the exit code; the lines are kept, joined with `; ` | `why gh could not answer > a silent failure still carries a reason, with the exit code`, `why gh could not answer > a multi-line message is kept whole` | implemented |
| OUT-9a | `test/fixtures/landing/with-release` | five steps in document order, each citing `RELEASE.md` and its own heading; `declared` true; `AGENTS.md` read with no landing heading | `after merge: steps read from the repository's own documents > a repository with a RELEASE.md yields its steps, each citing file and heading` | implemented |
| OUT-9b | The same `RELEASE.md` text through `declaredSteps` | neither heading is a step; no line of the fenced block is a step; no item under a non-landing heading is a step | `... > a heading is never a step, and neither is a line in a fenced code block` | implemented |
| OUT-9c | `test/fixtures/landing/no-release` | `declared` false, no steps, and a statement naming the absent `RELEASE.md`, the read `AGENTS.md` and that footprint states none rather than inventing them | `... > no RELEASE.md and an AGENTS.md with no landing section is a stated fallback` | implemented |
| OUT-9d | `test/fixtures/landing/empty-release` (a zero-byte `RELEASE.md`, an `AGENTS.md` whose `Releasing` heading has nothing under it) | the heading is reported as read and still declares nothing; the same stated fallback | `... > an empty RELEASE.md, and a landing heading with nothing under it, declare nothing` | implemented |
| OUT-9e | `test/fixtures/landing/docs-only` (a `RELEASE.md` that does declare steps) | `nothing_to_do` true, the statement contains "nothing to do after merge", no steps apply, and the headings read are still reported | `... > a documentation-only change says nothing to do after merge, plainly` | implemented |
| OUT-9f | An empty changed-file list | `nothing_to_do` true with the same plain sentence | `... > a range that changes no file says nothing to do after merge` | implemented |
| OUT-9g | `test/fixtures/landing/no-release` (`src/app.ts` alone) | `unguarded` true, no guards, and `unguarded_because` naming the rule's three guard kinds | `before merge: the guard rule is path patterns, computed > a source change with no migration, flag or version entry is unguarded` | implemented |
| OUT-9h | `test/fixtures/landing/with-release` (`src/app.ts`, `src/app.test.ts`, `CHANGELOG.md`) | `unguarded` false with `CHANGELOG.md` cited as a `version` guard | `... > a changelog entry among the changed files is a guard, so the warning stays quiet` | implemented |
| OUT-9i | `test/fixtures/landing/docs-only` | `unguarded` false because no changed file is source | `... > a change touching no source file is not unguarded, because nothing needs a guard` | implemented |
| OUT-9j | Path lists covering each guard pattern and two non-guards | every guard path classified `migration`, `flag` or `version`; `src/app.ts` and `docs/README.md` are not guards | `... > guardsIn classifies migrations, flags and version entries by path` | implemented |
| OUT-9k | `test/fixtures/landing/with-migration` | the migration item names `db/migrations/0003_add_index.sql` and states the ordering constraint; the change is guarded | `... > a migration in the diff is named with its ordering constraint` | implemented |
| OUT-9l | `package.json` changed without a lockfile, then with `bun.lock` | the first yields a `regenerate` item naming `package.json`; the second yields none | `... > a manifest changed with no lockfile beside it is an artifact to regenerate` | implemented |
| OUT-9m | `dist/bundle.js` among the changed files | a `generated` item naming the path, as an observation | `... > generated files in the diff are reported as generated, not judged` | implemented |
| OUT-9n | `renderLanding` over the unguarded fixture | `## Before merge` precedes `## After merge`; the warning renders as a GitHub `[!WARNING]` alert with the bold sentence | `the two --human sections > Before merge and After merge are separate sections, and the warning is loud` | implemented |
| OUT-9o | `renderLanding` over the with-release fixture | every step renders with `` `RELEASE.md` › <heading>``; no warning | `... > every after-merge step is rendered with the file and heading it was read from` | implemented |
| OUT-9p | `renderLanding` over the docs-only fixture | the plain sentence, and no step list | `... > a docs-only change renders the plain sentence and no step list` | implemented |
| OUT-9q | `HEAD~1..HEAD` against this repository | four results in order, the landing plan second after `footprint.composition`; the landing line validates; `after_merge.read` names `RELEASE.md` then `AGENTS.md`; every result is in the receipt | `the CLI speaks the Parley output protocol > the landing result follows the composition result in the same run` | implemented |
| OUT-9r | `HEAD~1..HEAD --human` | the composition comment, then `## Before merge`, then `## After merge` | `... > --human prints Before merge and After merge after the composition comment` | implemented |
| OUT-9s | `--help` | the declared schemas are `footprint.composition`, `footprint.landing`, `footprint.blast_radius`, `footprint.overlap` and `parley.error`, in that order | `... > --help and --schema are runs that describe the tool` | implemented |
| OUT-10a | `HEAD~1..HEAD` against this repository | four result lines in order, the blast radius third; the blast-radius line validates, carries the range and a 64-hex digest, `counts` equal to the list lengths when available and a stated `reason` when not; every result reaches the receipt; `--human` prints the `## Blast radius` section | `the CLI speaks the Parley output protocol > the blast-radius result follows the composition result in the same run` | implemented |
| OUT-10b | `--help` | the declared schemas are `footprint.composition@1.0.0`, `footprint.landing@1.0.0`, `footprint.blast_radius@1.1.0`, `footprint.overlap@1.0.0`, `parley.error@2.0.0`, in that order | `... > --help and --schema are runs that describe the tool` | implemented |
| OUT-11a | `graft.struct_exports.rename.json`, captured from the real command on a commit renaming the exported `mermaidPie` to `pieChart` | `removed` is exactly `mermaidPie` and `added` exactly `pieChart`, both with file, kind and signature; `signatureChanged` empty; `semverImpact` `major` | `the export surface is a pure function of graft's JSON > a renamed export is reported removed and added` | implemented |
| OUT-11b | A `changed` entry carrying `previousSignature` | the previous and new signatures are both kept, verbatim | `... > a signature change carries the previous signature` | implemented |
| OUT-11c | `graft.struct_exports.unchanged.json` | three empty lists and `counts` all zero with `available: true` — an empty surface is not an unavailable one | `... > no exported symbol changed is three empty lists, not an unavailable section` | implemented |
| OUT-11d | Entries given out of order | sorted by file then symbol, so the digest does not follow graft's ordering | `... > symbols are listed in a stable order, so the digest does not follow graft's ordering` | implemented |
| OUT-11e | graft not resolved | `available: false`, `reason.code` `graft.not_resolved`, a non-empty detail, and no symbol lists | `... > graft that could not be resolved is available: false with a stated reason` | implemented |
| OUT-11f | The rename fixture with `_schema.version` set to `2.0.0`, and with `_schema.id` set to another graft contract | `available: false`, `reason.code` `graft.schema_mismatch`, the detail naming both versions; no throw | `... > a different graft.cli.struct_exports version is unavailable and stated, never a throw` | implemented |
| OUT-11g | Empty output, non-JSON text, `{}`, an envelope with no arrays, and an entry with no `filePath` | `available: false` with `graft.output_unreadable` or `graft.schema_mismatch`; no throw | `... > output that is not graft's answer is unavailable and stated` | implemented |
| OUT-11h | The record from each of the three surfaces, with the writer's envelope | every line validates against `schemas/footprint.blast_radius.schema.json`; the digest is 64 hex; `contract` names `graft.cli.struct_exports` 1.0.0 | `... > the record validates against schemas/footprint.blast_radius.schema.json, available or not` | implemented |
| OUT-11i | The same surface twice, and a different surface | equal digests for the repeat, different for the other | `... > the digest is the same for the same surface and moves when the surface does` | implemented |
| OUT-11j | The Markdown section for the rename fixture, the unchanged fixture, a multi-line signature and an unavailable surface | the symbols, their files and the graft subcommand appear; every table row closes with a pipe; an empty surface says no exported symbol moved; an unavailable one states the reason | `the blast-radius section of the Markdown comment > lists added, removed and signature-changed symbols with file and name`, `... > says no exported symbol moved rather than printing an empty table`, `... > states the limitation when graft is unavailable` | implemented |
| OUT-12a | `test/fixtures/languages/unanalysed` (a Haskell file among TypeScript ones) | `unsupportedLanguages` reports exactly `[{ extension: ".hs", count: 1 }]` | `unsupportedLanguages: changed files in languages graft's grammars cannot parse > a Haskell file among supported ones is reported by extension with a count of one` | implemented |
| OUT-12b | `test/fixtures/languages/all-supported` (TypeScript, TSX, Rust, Go, Python, GraphQL) | `unsupportedLanguages` reports `[]` — present, not absent | `... > every changed file in a supported language is an empty list, not an absent one` | implemented |
| OUT-12c | A changed `.ts` file, with an `Exports` whose `available` is `false` (`graft.exports_failed`) | the `.ts` file is never counted as unanalysed: detection is extension-only and does not consult `exports` at all | `... > a changed file in a supported language is never counted, however graft's run turned out`, `the unanalysed-languages field on the blast-radius result > a changed file in a supported language is never counted here, whatever graft's run turned out` | implemented |
| OUT-12d | Changed files across several unsupported extensions, uneven counts, out of order | grouped by extension with the right count each, sorted by extension so the digest does not follow input order | `... > multiple unsupported extensions, uneven counts, out of input order, group and sort by extension` | implemented |
| OUT-12e | `exportsRecord` with and without an unanalysed-languages list | the record validates against `schemas/footprint.blast_radius.schema.json` 1.1.0 either way; `unanalysed_languages` is present and empty when there is nothing to report; the digest moves when the list does | `the unanalysed-languages field on the blast-radius result > the record validates against schemas/footprint.blast_radius.schema.json 1.1.0, with or without unanalysed languages`, `... > unanalysed_languages is present and empty when there is nothing to report`, `... > a changed Haskell file is named by extension with a count`, `... > the digest moves when the unanalysed-languages list does, same exports surface otherwise` | implemented |
| OUT-12f | `blastRadius` rendering with and without unanalysed languages | the `## Blast radius` section lists the extensions and counts, or states that every changed file was in a supported language | `... > --human lists the unanalysed languages by extension and count`, `... > --human states that every changed file was in a supported language when there is nothing to report`, `... > the unanalysed-languages section appears even when the export surface itself is unavailable` | implemented |
| OUT-12g | `src/languages.ts`'s extensions against the installed `@flyingrobots/graft`'s `dist/parser/lang.js` | every footprint extension maps, through graft's own `detectLang`, to exactly graft's `SUPPORTED_LANGS`; editing one extension out of `src/languages.ts` turns this red | `footprint's supported-language list against the installed graft > every footprint extension maps, through graft's own detectLang, to exactly graft's SUPPORTED_LANGS` | implemented |
| OUT-12h | graft's module missing from its expected path, or missing `SUPPORTED_LANGS`/`detectLang` | the test fails with a message naming the path, never skips or passes | by inspection of the `existsSync`/export-type guards in `test/languages-drift.test.ts`; no fixture simulates a missing module (see "Known gaps") | not implemented |

## Known gaps

- The structural branch is exercised with whatever graft the test machine has; no test pins
  `structural.available: true`, because graft is optional and the test must pass without it. The
  same holds for the blast radius: OUT-10a accepts either branch from the live CLI, and the
  export-surface behavior is pinned by OUT-11's fixtures instead.
- No test asserts that graft's live output still matches the fixtures. A graft release that changed
  the shape under the same `_schema` version would be caught only by OUT-10a's `counts` invariant.
- OUT-12h (graft's language module missing, or missing the exports the drift test depends on) is
  not exercised by an automated case: doing so would mean moving or breaking the real installed
  `@flyingrobots/graft`, which no fixture stands in for. The guard is in the code
  (`test/languages-drift.test.ts`'s `existsSync` and export-type checks throwing with the path
  named) and was read, not run.
- No test runs the CLI with `gh` present, so `overlap.available: true` is never asserted
  end to end. The suite removes `gh` from the PATH deliberately: a test that listed this
  repository's open pull requests would depend on the network and on which pull requests happen to
  be open. Everything between the records and the result — the conflict graph, the waves and the
  prose — is covered over fixed records in `test/overlap.test.ts`; what is not covered is the `gh`
  invocation itself and the parse of its JSON.
