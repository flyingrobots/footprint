# Blast radius

What a change does to the **export surface**: which exported symbols it added, which it removed,
which kept their name but changed signature, and **where each of them is called from, grouped by the
system that contains it**. One result line per run, `footprint.blast_radius` 1.1.0, emitted after
the landing plan.

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

The report carries two statements about breakage, and each names its source. The composition
section's count of breaking changes is `breakingChanges` from `graft struct review --json`
(`graft.cli.struct_review`); this section's reading is `semverImpact` from `graft struct exports
--json` (`graft.cli.struct_exports`). They are two graft subcommands answering two questions over
the same range, and footprint reports both without choosing one. A change can be listed as
breaking by the first while the second reads it as minor; neither is footprint's verdict.

## What is listed

| List | Meaning |
| --- | --- |
| `added` | Exported at head, not at the base |
| `removed` | Exported at the base, not at head |
| `signature_changed` | Exported at both ends under the same name, with a different signature; carries `previous_signature` when graft reported one |

Each entry carries `symbol` and `file`, plus `kind` and `signature` when graft reported them, and
its `call_sites`, each of which names the system containing it and carries that row's mitigation. A
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

## Grouping by system

A flat list of call sites does not tell a reviewer which parts of the system a change reaches, so
the call sites are grouped (flyingrobots/footprint#11). Two things have to be defined precisely for
that grouping to be a report rather than an opinion, and both are stated on every record that
carries it, under `exports.call_site_systems`.

### What a system is

> A **system** is the first path segment of a call site's repository-relative path: the directory
> immediately under the repository root, however deep the file sits inside it. A file at the
> repository root has no such segment and is grouped under **`(unassigned)`**.

On the wire that rule is named `path_prefix`, and `rule_detail` carries it in words so the output
explains its own grouping. `src/render.ts` and `src/nested/deep/thing.ts` are both `src`;
`.github/workflows/ci.yml` is `.github`; `CHANGELOG.md` and `package.json` are `(unassigned)`.

`(unassigned)` is a group, not a gap. It is named, listed **last**, and carries its call sites like
any other — the edge flyingrobots/footprint#11 names, "a call site outside every known system",
is a table, not a silence. Systems are otherwise ordered by name, so the grouping follows the tree
rather than the order the scan happened to find the sites in; that is what lets it sit inside the
digest.

Two rules were considered and rejected, and the owner may overrule either:

- **`src/` descending one more level.** `src/` in this repository is flat, so the extra clause
  would never fire on the run that proves the feature. A rule whose extra clause nobody can check
  is worse than no extra clause.
- **A configurable list of systems.** It would make the grouping depend on a setting rather than on
  the tree, and a reviewer reading the output could not tell which systems were even considered.

The per-system `call_sites` counts sum to `counts.call_sites`, because every call site is in
exactly one system, `(unassigned)` included. That sum is asserted, not assumed: OUT-14f and
OUT-14j.

### What a mitigation is

Every row carries one, and `AGENTS.md`'s rule applies in full: **report, never judge.** So a
mitigation here is not advice. It is one of exactly three sentences, chosen by two facts about the
call site and nothing else — whether the call site is in the very file the symbol is exported from,
and what [`classify()`](../composition/README.md) calls that file:

| `mitigation_basis` | When | `mitigation` |
| --- | --- | --- |
| `declaring_file` | The call site is in the very file the symbol is exported from | `None needed` |
| `test_file` | `classify()` calls the call site's file a `test` | `None needed` |
| `other_system` | Any other call site, inside a system | `Call site in <system>, outside the changed file.` (the `--human` table writes `<system>` as a code span; the result line carries the sentence as shown) |
| `unassigned` | Any other call site, in no system | `Call site outside every known system, outside the changed file.` |

The order is load-bearing. The declaring file wins over everything, because a symbol declared in a
test file is still its own declaration; `classify()` wins over the system, because a test fixture
at the repository root is a test file before it is a file in no system.

Both `None needed` bases are facts a reviewer can check in one line rather than assessments. The
declaring file is the file whose export surface moved, so a call site in it *is* the change rather
than something the change reaches. A test file is what `classify()`'s documented, ordered,
first-match-wins rules say it is.

**What a mitigation deliberately does not say:** whether a call site matters, whether it will
break, whether it is covered, or what anyone should do about it. The moment a mitigation reads
"consider adding a test" it is a verdict, and footprint stops being a report. That is
flyingrobots/footprint#11's named failure mode — a padded mitigation — and the guard against it is
OUT-14e: every mitigation of the real Definition-of-Done run is matched against an allowlist of the
three forms above, declared in the test rather than imported from `src/`, so a fourth form cannot
add itself to its own oracle.

`mitigation_basis` rides every call site beside the sentence, so the derivation is checkable from
the record without re-deriving it.

### How much of it `--human` prints

The call-site tables are the longest part of the comment, so they are bounded: a symbol with more
than 50 call sites is summarised as a count per system, and rows past a per-section limit are
counted rather than printed, the whole comment staying under GitHub's 65536 characters. What is
cut and how is in [Output](../output/README.md#the-size-of-the---human-report). The result line
always carries every site.

### The run it was built on, captured

**Captured output**, not illustrative: this is the `--human` blast-radius section of
`footprint 543477a~1..543477a --human` run against this repository on 2026-11-22 — the Definition
of Done of flyingrobots/footprint#11, the same real signature change (`render` gaining
`review?: StructuralReview | null`) that the call-site work of flyingrobots/footprint#10 used. Four
systems, 168 call sites, 70 scanned files. It was captured **before** the bound above existed:
today `render`, with 82 call sites, would be one summary row rather than rows in each table, and
the `…and 62 more for \`render\`` line would not appear. It is **abridged**: the `docs` and `(unassigned)` tables
are complete, `src` keeps five of its 28 rows and `test` is reduced to its last line, and the
elisions are marked. Line numbers are of the working tree as checked out, so they move.

```markdown
<summary>Call sites by system (168 across 4 systems, 70 scanned files)</summary>

**`docs`** — 8 call sites

| Symbol | Call site | Mitigation |
| --- | --- | --- |
| `render` | `docs/topics/blast-radius/README.md:97` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/blast-radius/README.md:98` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/blast-radius/README.md:125` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/output/test-plan.md:112` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/output/test-plan.md:117` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/output/test-plan.md:122` | Call site in `docs`, outside the changed file. |
| `render` | `docs/topics/output/test-plan.md:133` | Call site in `docs`, outside the changed file. |
| `StructuralReview` | `docs/topics/output/test-plan.md:112` | Call site in `docs`, outside the changed file. |

**`src`** — 28 call sites

| Symbol | Call site | Mitigation |
| --- | --- | --- |
| `render` | `src/cli.ts:8` | Call site in src, outside the changed file. |
| `render` | `src/render.ts:66` | None needed |
| `render` | `src/report.ts:10` | Call site in src, outside the changed file. |
| `resolveGraft` | `src/graft.ts:30` | None needed |
| `StructuralReview` | `src/report.ts:34` | Call site in src, outside the changed file. |
                                      … 23 further rows elided from this capture …

**`test`** — 129 call sites

| Symbol | Call site | Mitigation |
| --- | --- | --- |
| `devDependencies` | `test/callsites.test.ts:174` | None needed |
                                      … 128 further rows elided from this capture …

<sub>…and 62 more for `render`; the result line carries every one.</sub>

**`(unassigned)`** — 3 call sites

| Symbol | Call site | Mitigation |
| --- | --- | --- |
| `devDependencies` | `bun.lock:10` | Call site outside every known system, outside the changed file. |
| `devDependencies` | `package.json:27` | None needed |
| `resolveGraft` | `AGENTS.md:51` | Call site outside every known system, outside the changed file. |
```

Four things in that capture are worth reading, and all four are the rules above rather than
coincidences:

- **`src/render.ts:66` is `None needed`** and `src/cli.ts:8` is not, for the same symbol in the
  same system. `render` is exported from `src/render.ts`, so a call site there is the declaring
  file — the change itself — and the basis is `declaring_file`, not the system.
- **The whole `test` system is `None needed`**, 129 rows of it, by `classify()` and nothing else.
  That is also what makes it the cheapest row to skim, which is the point of grouping.
- **`package.json:27` is `None needed` inside `(unassigned)`.** `devDependencies` is exported from
  `package.json`, so the declaring-file basis wins over the group a reviewer might expect to be
  uniformly "outside".
- **`bun.lock:10` and `AGENTS.md:51` are in the capture at all.** The scan over-reports by design
  (a lockfile entry; the word `resolveGraft` in a sentence of `AGENTS.md`), and the grouping does
  not hide that — it places it, which is the honest thing for a tool that reports rather than
  judges.

### When the grouping is absent

`exports.call_site_systems` is present exactly when `call_site_scan.available` is true. A grouping
of call sites nobody looked for is not a figure, so a scan that did not run carries no grouping at
all — and an absent grouping can therefore never be read as a change that reaches no system. The
schema enforces both directions.

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
footprint origin/main --human > report.md   # the Markdown section; post it with footprint comment
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius") | .exports.counts'
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius") | .unanalysed_languages'
```

```bash
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius")
  | .exports.signature_changed[] | {symbol, sites: (.call_sites | length)}'
footprint origin/main | jq -c 'select(._schema.id == "footprint.blast_radius")
  | .exports.call_site_systems.systems'
footprint origin/main | jq -r 'select(._schema.id == "footprint.blast_radius")
  | .exports.signature_changed[].call_sites[] | [.system, .file + ":" + (.line|tostring), .mitigation] | @tsv'
```

The field-by-field reference is in [Output](../output/README.md); the contract is
`schemas/footprint.blast_radius.schema.json`, and the cases that hold it are OUT-10, OUT-11,
OUT-12, OUT-13 and OUT-14 in the [output test plan](../output/test-plan.md).

## Performance

The call-site scan is a whole-word identifier scan of every changed symbol over every tracked,
non-binary file — `O(symbols × files)` by construction, because each symbol gets its own pass over
the file set. flyingrobots/footprint#13 is the one measured run that states a bound rather than
leaving the question open:

| | |
| --- | --- |
| Repository | [`flyingrobots/bijou`](https://github.com/flyingrobots/bijou) at `2d131ce3feee6612015422347ed37e9d8b369dc4` |
| Range | `d83fe2810028fdf21e965dc5bfbdfc6a83e5adc3..2d131ce3feee6612015422347ed37e9d8b369dc4` (`HEAD~20..HEAD`) |
| Tracked files | 4,823 |
| Changed files | 169 |
| Changed symbols | 142 (140 added, 0 removed, 2 signature-changed) |
| Call sites found | 7,735 |
| graft | answered (`exports.available: true`) |
| Wall time, three runs | 37.25s, 38.72s, 48.31s — **median 38.72s** |
| Machine | Apple M5 MacBook Air, 16 GB RAM, macOS 26.6 |
| Measured | 2026-11-22 |

All figures above are measured, not estimated. The median sits under the sixty-second bound a
reviewer would wait for on a pull request comment, so this is stated as the bound rather than
optimised — scope for #13 was one measured run and the recorded number, not a faster algorithm.
A repository with substantially more tracked files or more changed symbols than this one will take
longer, proportionally to both.

## What this is not

Not a call graph, and the call-site section above says exactly where that line is. Not a risk
score either: the grouping places a call site and the mitigation restates two facts about it, and
neither is a judgement about what the change will do.

Not language reporting. flyingrobots/footprint#2 §3's feature is complete except for that, which
is still only `unanalysed_languages` naming the gap.
