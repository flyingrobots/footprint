# Composition — test plan

Evidence lives in `test/footprint.test.ts`.

| ID | Requirement |
| --- | --- |
| CO-1 | Reported totals equal the sum of the category rows |
| CO-2 | Classification order is stable: a more specific rule wins over a general one |
| CO-3 | Binary files are counted without producing `NaN` line counts |
| CO-4 | A change with no line edits does not divide by zero |
| CO-5 | Unrecognised files classify as `source` rather than being dropped |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| CO-1a | Category rows sum to the total | summed rows equal `added + removed` | `compose > totals are the sum of the parts, never estimated` | implemented |
| CO-1b | Shares sum to 100 | within 0.2 rounding slack | `compose > shares sum to 100 for a non-empty change` | implemented |
| CO-2a | Fixture is a test, not source | `classify("test/fixtures/sample.ts") === "test"` | `classify > orders rules so a test fixture is a test, not a source file` | implemented |
| CO-2b | Lockfile is generated, not config | `classify("package-lock.json") === "generated"` | `classify > a lockfile is generated, not config, even though it is JSON` | implemented |
| CO-3a | Binary reports zeroes and a flag | `{added: 0, removed: 0, binary: true}` | `parseNumstat > a binary file reports no line counts rather than NaN` | implemented |
| CO-4a | Zero-line change has share 0 | no `NaN` | `compose > a change with no line edits does not divide by zero` | implemented |
| CO-5a | Unknown extension is source | `classify("weird/thing.xyz") === "source"` | `classify > anything unrecognised is source, never silently dropped` | implemented |
| CO-6a | End-to-end against a real range | output names the right categories | — | **gap** |

## Known gaps

- **CO-6a has no automated evidence.** The CLI was run by hand against `theme-book@5e19fa3` and
  correctly reported "Documentation only. No executable surface touched.", but nothing pins that.
