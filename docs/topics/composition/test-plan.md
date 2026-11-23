# Composition — test plan

Evidence lives in `test/footprint.test.ts`.

| ID | Requirement |
| --- | --- |
| CO-1 | Reported totals equal the sum of the category rows |
| CO-2 | Classification order is stable: a more specific rule wins over a general one |
| CO-3 | Binary files are counted without producing `NaN` line counts |
| CO-4 | A change with no line edits does not divide by zero |
| CO-5 | Unrecognised files classify as `source` rather than being dropped |
| CO-7 | A licence or notice file — `LICENSE`, `LICENSE.<anything>`, `NOTICE`, `COPYING`, at any depth — is `docs`, so it neither inflates the source share nor reads as code in an unanalysed language (flyingrobots/footprint#36) |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| CO-1a | Category rows sum to the total | summed rows equal `added + removed` | `compose > totals are the sum of the parts, never estimated` | implemented |
| CO-1b | Shares sum to 100 | within 0.2 rounding slack | `compose > shares sum to 100 for a non-empty change` | implemented |
| CO-2a | Fixture is a test, not source | `classify("test/fixtures/sample.ts") === "test"` | `classify > orders rules so a test fixture is a test, not a source file` | implemented |
| CO-2b | Lockfile is generated, not config | `classify("package-lock.json") === "generated"` | `classify > a lockfile is generated, not config, even though it is JSON` | implemented |
| CO-3a | Binary reports zeroes and a flag | `{added: 0, removed: 0, binary: true}` | `parseNumstat > a binary file reports no line counts rather than NaN` | implemented |
| CO-4a | Zero-line change has share 0 | no `NaN` | `compose > a change with no line edits does not divide by zero` | implemented |
| CO-5a | Unknown extension is source | `classify("weird/thing.xyz") === "source"` | `classify > anything unrecognised is source, never silently dropped` | implemented |
| CO-6a | End-to-end against a real range | the result's category rows sum to its totals; every line validates | `the CLI speaks the Parley output protocol > a real range validates line by line and closes with end` (`test/cli.test.ts`) | implemented |
| CO-7a | `packages/parley-emit-py/LICENSE`, `NOTICE`, `LICENSE`, `LICENSE.APACHE`, `COPYING`, `a/b/NOTICE` | each `classify()` is `docs` | `classify > licence and notice files are docs, at any depth` | planned |
| CO-7b | `node_modules/x/LICENSE`, `test/fixtures/repo/LICENSE` | `generated` and `test`: the earlier, more specific rules still win | `classify > a licence file under a generated or test path keeps that category` | planned |
| CO-7c | `src/NOTICES`, `COPYINGX`, `MYLICENSE` | `source` each: the rule names whole file names and nothing that merely contains them | `classify > only the named licence files are docs, not names that merely contain them` | planned |
| CO-7d | `unsupportedLanguages` over `packages/parley-emit-py/LICENSE` and `packages/parley-emit-py/NOTICE` (the flyingrobots/parley#89 case) | no unanalysed language reported | `classify > licence files are not reported as an unanalysed language` | planned |

## Known gaps

- None recorded. CO-6a runs against this repository's own last commit, so which categories it
  names depends on that commit; the invariant it pins is the sum, not a fixed category list.
