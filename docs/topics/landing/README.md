# Landing

Merging is not landing. After the merge button there is usually more to do, and it is easy to
forget once the pull request is green. This page is the reference for the `footprint.landing`
result: what footprint reads, what it computes, and what it refuses to do.

The contract ledger for this behavior is [OUT-9 in the output test
plan](../output/test-plan.md), beside the rest of the output contract it is part of.

## The one rule

**footprint does not invent after-merge steps.** It reads them out of the repository, quotes them
verbatim, and cites where each came from. A tool that makes up post-merge steps makes up wrong
ones, and wrong ones are worse than none, because they are believed. Where nothing is declared,
the result says so and stops.

The before-merge section is the other half, and it is the opposite kind of claim: it says only
what the changed-file list itself shows, by documented path rules. It is an observation, never a
verdict and never a gate.

## What is read

Two documents under the working directory, in this order:

| Document | Why |
| --- | --- |
| `RELEASE.md` | Where a repository that has a release process writes it down |
| `AGENTS.md` | Where this family of repositories records its working agreement, including how a change lands |

Both are reported in `after_merge.read` whether or not they exist, so an absent document is a
stated absence rather than a silent one.

### What counts as a step

A **landing section** is a heading whose text contains one of `release`, `releasing`, `publish`,
`publishing`, `after merge`, `post-merge`, `landing`, `lands`, `ship` or `shipping`. A heading
below one of those, at a deeper level, is still inside it; a heading at the same level or above
closes it.

Inside a landing section, a **step** is a top-level list item — `-`, `*`, `+`, `1.` or `1)`, with
up to three spaces of indent — with any `[ ]` or `[x]` checkbox stripped. The item's text is
quoted exactly as the document wrote it, and the nearest heading above it is cited with it.

Three things are deliberately *not* steps:

- **A heading.** `## Release` is where steps live, not a step. This is the failure mode the
  behavior was written against: a tool that treats headings as steps reports "Release" as
  something to do.
- **A line inside a fenced code block.** A command shown as an example was not declared as a step,
  and footprint does not get to decide which lines of a script someone meant to run.
- **The document's title.** The first heading, when it is top-level, names the document. Reading
  `# RELEASE` as a landing section would make every list in the file a step, including the ones
  under `## Support`.

A "Deployment" heading is not a landing section either. footprint reads how a change lands in the
repository; deploying a system is a different question, and quietly adopting a deployment runbook
as merge instructions would be exactly the invention this avoids.

### footprint's own steps

This repository declares its own after-merge steps in [`RELEASE.md`](../../../RELEASE.md), as
top-level list items under `## After merge`, so a run on a change here quotes them back, each
cited `` `RELEASE.md` › After merge``. `test/release.test.ts` (OUT-17a) reads the real file through
the same derivation and fails if it ever stops declaring steps in a form footprint reads. Because
every non-documentation change is reported with all of them, each step says when it applies.

### When nothing is declared

`after_merge.declared` is false and `after_merge.statement` is a **stated fallback** that names
each document and what was found there — absent, no landing section, or a landing section with
nothing listed under it — and says that footprint states none rather than inventing them.

### When there is nothing to do

A change that touches **no executable surface** — no files at all, or documentation only, by the
same rule the composition's gut check uses — has `nothing_to_do: true` and a statement that says
**"nothing to do after merge"** plainly. Any steps the documents declare are set aside rather than
recited at a reader who cannot act on them; the headings they were found under are still reported
in `after_merge.read`, so nothing is hidden. This is the other known failure mode: reading out
steps that do not apply teaches a reader to skip the section.

An agent skill is not documentation for this rule: its Markdown classifies as `config` (see
[Composition](../composition/README.md#categories)), so a change to `skills/<name>/SKILL.md` alone
reports the declared steps, such as this repository's "reinstall the skill".

## The guard rule

`before_merge.unguarded` is true when **both** of these hold over the changed-file list:

1. At least one changed file classifies as `source` (see [classification](../composition/README.md)).
2. No changed file matches a guard pattern.

A guard is a path pattern, in this order, first match winning per file:

| Kind | Pattern |
| --- | --- |
| `migration` | a path component `migrations`, `migration` or `migrate`; a filename starting with three or more digits then `-` or `_` and ending `.sql`, `.ts`, `.js`, `.mjs`, `.cjs`, `.py`, `.rb` or `.go`; a `.migration.<ext>` file |
| `flag` | a path component `flags`, `flag`, `feature-flags`, `feature_flags` or `featureflags`; a `flags`- or `feature-flags`-named `.json`, `.yaml`, `.yml`, `.toml` or JS/TS file |
| `version` | `CHANGELOG`, `CHANGES`, `HISTORY`, `NEWS`, `RELEASE`, `RELEASES` with any extension; `VERSION`, `version.txt`, `.version`; `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `composer.json`, `gradle.properties` |

`before_merge.unguarded_because` always states which of the three outcomes applied: the guards it
found, the fact that no source file changed, or the rule that found nothing. In `--human`, an
unguarded change renders as a GitHub `[!WARNING]` alert, because it is the one line in these two
sections a reader should not scroll past.

**Why a path rule and nothing cleverer.** "Is this change risky?" is a judgement, and the moment
footprint makes it, the answer is arguable, the warning becomes noise, and the output becomes a
gate people shape diffs to satisfy. A path rule is checkable: anyone can read the table above and
predict the answer.

**What it therefore cannot see**, stated rather than papered over:

- A path rule cannot tell whether the `version` field inside a changed manifest actually moved. A
  `package.json` touched to add a dependency counts as a version entry and silences the warning.
- A feature flag read from a database, an environment variable, or a service is invisible: nothing
  in the diff names it.
- A guard somewhere other than these paths — a flag defined inline in the source file it guards —
  is not found.

## The before-merge items

Three rules, each over the changed-file list, each reported with the paths that matched:

| Kind | When | What it says |
| --- | --- | --- |
| `migration` | a changed file matched a `migration` guard pattern | names each migration and the ordering constraint: a migration and the code that depends on it land in one order or the other, and whichever merges first runs first |
| `generated` | a changed file classifies as `generated` | names them, as something produced by a tool rather than written |
| `regenerate` | a dependency manifest changed and no lockfile that goes with it is in the same change | names the manifest and which lockfile may need regenerating |

The `regenerate` pairs are `package.json` with a JavaScript lockfile, `Cargo.toml` with
`Cargo.lock`, `pyproject.toml` or `requirements.in` with a Python lockfile, and `go.mod` with
`go.sum`. footprint does not read the manifest, so it cannot know whether the dependency set moved;
it reports only that the manifest changed and its lockfile did not.

## What this does not do

It does not **run** anything. Not a step, not a check, not a release. The steps are quoted for a
person or an agent to act on, and footprint's own effects declaration (`--help`) still says it
reads `.git` and writes nothing.

It does not integrate with a deployment system, and it does not judge. Like the rest of footprint,
treat it as input to a decision rather than a gate: a gate gets gamed.
