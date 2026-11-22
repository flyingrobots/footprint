# Blast radius

What a change does to the **export surface**: which exported symbols it added, which it removed,
which kept their name but changed signature, and **where each of them is called from**. One result
line per run, `footprint.blast_radius` 1.1.0, emitted after the landing plan.

Composition answers how much changed. This answers what moved, which is the part a reviewer cannot
get from a file list: a renamed export is two lines in a diff and a broken call site everywhere
else.

## Where the facts come from

The symbols come from graft's CLI JSON contract, and nothing else:

```bash
graft struct exports <base-ref> <head-ref> --json
```

footprint binds to that contract's exact `_schema` pair, `graft.cli.struct_exports` **1.0.0**, which
is the version [`AGENTS.md`](../../../AGENTS.md) records as decided in flyingrobots/footprint#8. It
does not import a graft module and does not read anything under `node_modules/@flyingrobots/graft/dist`.
graft's substrate is slated to move off git-warp; a consumer bound to the CLI contract does not
notice that.

Every symbol, kind and signature in the result is graft's, passed through verbatim. footprint
derives exactly two things: the `counts`, which are the lengths of the three lists, and the
ordering, which is by file then symbol so that the digest follows the surface rather than graft's
internal order. The `semver_impact` is graft's own judgement, carried through unchanged — footprint
does not compute a semver impact and does not second-guess one.

## What is listed

| List | Meaning |
| --- | --- |
| `added` | Exported at head, not at the base |
| `removed` | Exported at the base, not at head |
| `signature_changed` | Exported at both ends under the same name, with a different signature; carries `previous_signature` when graft reported one |

Each entry carries `symbol` and `file`, plus `kind` and `signature` when graft reported them, and
its `call_sites`. A
renamed export therefore appears twice: the old name under `removed`, the new one under `added`.
Nothing in graft's answer says "renamed", and footprint does not infer it — a removal and an
addition that happen to be a rename and a removal that is a deletion look the same from the
outside, and guessing which is which would be a figure that was not computed.

The base is the **merge base** when the range is written with three dots (`origin/main...HEAD`,
which is the default), so symbols the default branch moved elsewhere are not attributed to this
change. A two-dot range is compared end to end, exactly as given.

## Call sites, and why they are footprint's own

Each listed symbol carries `call_sites`, every one with a `file` and a `line`. These are **not**
graft's: no graft CLI contract answers with a call site's line. Checked against graft 0.14.0, the
version this repository pins:

| Subcommand | What it answers with | A line? |
| --- | --- | --- |
| `graft symbol blame <name> --json` | `referenceCount`, an integer | No — there is no per-reference list in the payload at all |
| `graft struct review --json` | `breakingChanges[].impactedFilePaths` | No — file paths |
| `graft symbol difficulty --json` | `friction.referencingFiles` | No — file paths |
| `graft struct test-coverage --json` | `referencingTestFiles` | No — file paths |

All four read graft's WARP index rather than the tree, and `symbol blame` answered
`referenceCount: 0` for a symbol with live references in a checkout that had not been indexed.
Waiting for a contract that carries a line would mean shipping no call sites.

So footprint computes them itself, with the most conservative rule that an independent oracle can
check:

> A call site is a **whole-word occurrence** of the symbol's name in a tracked, non-binary file of
> the working tree.

"Whole word" is `grep -w`'s own rule — the match may be neither preceded nor followed by a word
character, which is a letter, a digit or an underscore **in any script** (`[\p{L}\p{N}_]`) —
which is exactly why footprint's answer can be compared with real `grep -I -n -w` over
`git ls-files`, line for line, instead of with a hand-written expectation. That comparison is the
test, not a one-off: OUT-13a in the [output test plan](../output/test-plan.md).

The Unicode part is not decoration. A differential fuzz against real grep, 2,400 comparisons over
random hostile text, caught an ASCII-only `[A-Za-z0-9_]` reporting a call site for `r` inside
`rünïcode`; grep in a UTF-8 locale reports none, and an identifier scan must not either. One limit
remains, stated rather than papered over: for a symbol name that is **not** ASCII the two can
disagree, because grep's word characters are its locale's and BSD grep's `-w` does not handle a
multibyte pattern consistently with its own rule. Every symbol in the golden case, and every
symbol graft has produced for this repository, is ASCII.

The scan is over `git ls-files` of the **working tree**, so it reports what a reviewer would find
in the checkout in front of them. One entry per line, however many times the name occurs on it,
because that is what `grep -n` reports. Ordered by file then line, so the digest follows the tree
rather than the order git listed it in. A file holding a NUL byte in its first 8192 is skipped, as
`grep -I` skips it, and counted under `files_skipped.binary`; a tracked file that is no longer on
disk is counted under `files_skipped.unreadable` and is not an error.

**What it over-reports.** The declaration itself, a mention in a comment, a string, a changelog or
prose, the same name belonging to something else entirely, and a name in a lockfile. A 71-call-site
`render` in this repository includes its own `export function render`, its tests, and the word
"render" in documentation.

**What it under-reports.** A call through dynamic dispatch, a re-export under another name, a
symbol reached through a computed property. A diff of declarations cannot see those, and neither
can a scan of names.

**It is per name, not per declaration.** Two exported symbols that share a name in different files
share one call-site list, because an occurrence of the name is not attributable to one of them
without resolving imports. The list is the union, and it is the same list on both entries.

It is evidence a reviewer can check in one `grep`, not a call graph — and the `--human` section
says so under every list it prints.

### When the scan cannot run

`call_site_scan` states it rather than showing zeroes, and **no symbol carries `call_sites` at
all**, so a scan that did not run can never be read as one that found nothing:

| `reason.code` | When |
| --- | --- |
| `scan.not_run` | The surface was parsed without a scan attached; no tree was read |
| `scan.ls_files_failed` | `git ls-files -z` exited non-zero, so there was no file list to scan |

The second also emits a `callsites.scan_failed` warning on stderr, and the run still exits 0. With
no symbol to look up, nothing is read at all: the scan reports `files_scanned: 0` honestly rather
than claiming it searched the tree for nobody.

## What counts as an export

graft's notion, not footprint's: whatever graft parses has an export surface, so the fields of a
JSON file are exported symbols of that file. A change that touches `package-lock.json` or a schema
under `schemas/` will list `lockfileVersion` or `$defs` as added exports.

Nothing is filtered out. footprint reports and does not judge, and a filter would be a judgement
about which languages and file kinds matter, applied silently. The `--human` section says where
the list came from so the rows can be read for what they are.

Two known failure modes, both graft's and both unfixable from here:

- **Re-exports read as changes.** A barrel file that re-exports a symbol can report the symbol as
  added or removed when only the re-export moved.
- **Dynamic dispatch is invisible.** This is a diff of declarations, not of behavior.

## When graft cannot answer

The section is always present and says why it is empty, because a degraded run that looks clean is
worse than no tool at all. `exports.available` is `false` and `exports.reason` carries a code and a
detail:

| `reason.code` | When |
| --- | --- |
| `graft.not_resolved` | No graft binary through the package dependency, `PATH` or `FOOTPRINT_GRAFT` |
| `graft.exports_failed` | The subcommand exited non-zero; the detail carries its first line of stderr |
| `graft.output_unreadable` | The answer was not JSON, carried no `added`/`removed`/`changed` arrays, or held an entry with no `symbol` or no `filePath` |
| `graft.schema_mismatch` | A different `_schema` id or version; the detail names both what graft said and what footprint reads |
| `range.unresolved` | A three-dot range whose ends have no merge base |

A different contract version is a stated limitation, never a crash and never a guess. When graft
resolved but could not be read, the run also emits a `graft.exports_failed` warning on stderr and
still exits 0.

## Languages that were not analysed

tree-sitter has grammars for some languages; a changed file in another language is invisible to
symbol analysis. Silently skipping it would read as "nothing moved", so `unanalysed_languages`
names the gap: the changed source files whose extension footprint does not recognise as one
graft's grammars can parse, grouped by extension with a count. `[]`, present rather than absent,
when every changed file was in a supported language.

This is independent of `exports` and of whether graft ran at all: it is a static fact about the
extension, checked against a list footprint keeps of its own, mirroring graft's tree-sitter
language support. graft does not publish that list through its package exports map or any CLI
contract, so footprint's copy is kept by hand and can drift if graft's grammar coverage changes
before this list is updated — a decision the owner may want to make differently, for example by
asking graft to expose its supported-language set through a versioned CLI contract instead. That
hand-kept list is checked against the *installed* graft by `test/languages-drift.test.ts`
(flyingrobots/footprint#21), so a grammar graft adds or drops turns the gate red instead of
drifting silently.

Because detection never looks at `exports`, a changed file in a *supported* language is never
counted here, even when graft failed to parse it, failed to resolve, or the diff for that file had
no symbol to report. Those are different, already-reported outcomes (`exports.available: false`,
or simply nothing in `added`/`removed`/`signature_changed`) — not a missing grammar.

Only files `classify()` calls `source` are checked: docs, config, tests, CI and generated files
were never going to be symbol-analysed regardless of extension, so flagging them would be noise,
not signal. flyingrobots/footprint#12's Definition of Done: a fixture with a Haskell (`.hs`) file
reports it.

## Reading it

```bash
footprint origin/main --human | gh pr comment 42 --body-file -   # the Markdown section
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius") | .exports.counts'
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius") | .unanalysed_languages'
```

```bash
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius")
  | .exports.signature_changed[] | {symbol, sites: (.call_sites | length)}'
```

The field-by-field reference is in [Output](../output/README.md); the contract is
`schemas/footprint.blast_radius.schema.json`, and the cases that hold it are OUT-10, OUT-11,
OUT-12 and OUT-13 in the [output test plan](../output/test-plan.md).

## What this is not

Not a grouping by system: that is flyingrobots/footprint#11, and it will land as a field on this
result with a schema version bump. Not a call graph either, and the call-site section above says
exactly where that line is.
