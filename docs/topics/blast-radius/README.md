# Blast radius

What a change does to the **export surface**: which exported symbols it added, which it removed,
and which kept their name but changed signature. One result line per run, `footprint.blast_radius`
1.0.0, emitted after the landing plan.

Composition answers how much changed. This answers what moved, which is the part a reviewer cannot
get from a file list: a renamed export is two lines in a diff and a broken call site everywhere
else.

## Where the facts come from

From graft's CLI JSON contract, and nothing else:

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

Each entry carries `symbol` and `file`, plus `kind` and `signature` when graft reported them. A
renamed export therefore appears twice: the old name under `removed`, the new one under `added`.
Nothing in graft's answer says "renamed", and footprint does not infer it — a removal and an
addition that happen to be a rename and a removal that is a deletion look the same from the
outside, and guessing which is which would be a figure that was not computed.

The base is the **merge base** when the range is written with three dots (`origin/main...HEAD`,
which is the default), so symbols the default branch moved elsewhere are not attributed to this
change. A two-dot range is compared end to end, exactly as given.

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

The field-by-field reference is in [Output](../output/README.md); the contract is
`schemas/footprint.blast_radius.schema.json`, and the cases that hold it are OUT-10, OUT-11 and
OUT-12 in the [output test plan](../output/test-plan.md).

## What this is not

Not the call sites of those symbols, and not a grouping by system. Those are
flyingrobots/footprint#10 and #11, and they will land as fields on this result with a schema
version bump.
