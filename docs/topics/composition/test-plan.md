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
| CO-8 | An agent skill is configuration an agent executes, not documentation: Markdown (`.md`, `.mdx`) under a `skills/` path component, and any file named `SKILL.md`, classify as `config`, so a change to a skill is never "documentation only" (flyingrobots/footprint#34) |
| CO-10 | Vendored code (a `vendor/` path component), the common lockfiles of each major ecosystem and the common generated-source names are `generated`; the lockfile and name rules come after the test rules, so a fixture with such a name stays `test` (flyingrobots/footprint#68) |

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
| CO-7a | `packages/parley-emit-py/LICENSE`, `NOTICE`, `LICENSE`, `LICENSE.APACHE`, `COPYING`, `a/b/NOTICE` | each `classify()` is `docs` | `classify > licence and notice files are docs, at any depth` | implemented |
| CO-7b | `node_modules/x/LICENSE`, `test/fixtures/repo/LICENSE` | `generated` and `test`: the earlier, more specific rules still win | `classify > a licence file under a generated or test path keeps that category` | implemented |
| CO-7c | `src/NOTICES`, `COPYINGX`, `MYLICENSE` | `source` each: the rule names whole file names and nothing that merely contains them | `classify > only the named licence files are docs, not names that merely contain them` | implemented |
| CO-7d | `unsupportedLanguages` over `packages/parley-emit-py/LICENSE` and `packages/parley-emit-py/NOTICE` (the flyingrobots/parley#89 case) | no unanalysed language reported | `classify > licence files are not reported as an unanalysed language` | implemented |
| CO-8a | `skills/footprint/SKILL.md`, `skills/footprint/reference.md`, `packages/a/skills/b/notes.mdx`, `.claude/skills/x/SKILL.md`, `SKILL.md`, `docs/agents/SKILL.md` | each `classify()` is `config` | `classify > an agent skill's Markdown is config, not docs` | implemented |
| CO-8b | `test/fixtures/skills/x/SKILL.md`, `docs/skills.md`, `myskills/x.md`, `skills/x/run.ts`, `skills/x/logo.png` | `test`, `docs`, `docs`, `source`, `assets`: only Markdown under a whole `skills` component moves, and the test rule still wins | `classify > only Markdown under a skills/ component, or SKILL.md, moves out of docs` | implemented |
| CO-8c | `compose` and `gutCheck` over a change to `skills/footprint/SKILL.md` alone; `unsupportedLanguages` over it | one `config` row, no "Documentation only" flag; no unanalysed language (why `config` and not `source`) | `classify > a skill-only change is not flagged documentation only, nor an unanalysed language` | implemented |
| CO-9a | `spec/parley-v0.2.md`, `spec/x.mdx`, `spec/notes.txt`, `spec/a/b.rst`, `docs/spec/x.md` | each `classify()` is `docs`: a specification directory's prose is documentation | `classify > Markdown under spec/ is docs, not test` | implemented |
| CO-9b | `spec/models/user_spec.rb`, `spec/foo.spec.ts`, `spec/helpers.ts`, `spec/fixtures/x.json`, `spec/fixtures/x.md`, `tests/spec/x.md` | each `classify()` is `test`: code and data under `spec/`, and prose under another test directory, stay test | `classify > code and fixtures under spec/ stay test` | implemented |
| CO-10a | `vendor/github.com/x/y.go`, `app/vendor/autoload.php`, `packages/a/vendor/lib.rb` | each `generated` | `vendored code, lockfiles and generated sources are generated (flyingrobots/footprint#68) > a vendor/ directory at any depth is generated` | implemented |
| CO-10b | `Gemfile.lock`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `composer.lock`, `flake.lock`, `mix.lock`, `pubspec.lock`, `Podfile.lock`, `npm-shrinkwrap.json`, `packages.lock.json`, `Package.resolved`, `gradle.lockfile`, `services/api/poetry.lock` | each `generated` | `... > the common lockfiles of each major ecosystem are generated` | implemented |
| CO-10c | `src/api.generated.ts`, `gen/user.pb.go`, `proto/user_pb2.py`, `proto/user_pb2_grpc.py`, `lib/model.g.dart` | each `generated` | `... > common generated-source names are generated` | implemented |
| CO-10d | `src/lock.ts`, `src/vendor.ts`, `src/generated_report.py`, `docs/locking.md` | `source`, `source`, `source`, `docs`: names that only resemble one keep their kind | `... > a name that only resembles one stays what it was` | implemented |
| CO-10e | 900 lines under `vendor/` beside 13 hand-written lines | the generated-share flag is raised | `... > a mostly vendored change raises the generated-share flag` | implemented |
| CO-10f | `test/fixtures/Gemfile.lock`, `test/fixtures/package-lock.json`, `tests/data/poetry.lock`, `testdata/user.pb.go`, `test/fixtures/api.generated.ts`, `test/fixtures/user_pb2.py`, `src/api.generated.test.ts` | each `test` | `a test fixture with a lockfile or generated-source name stays a test (flyingrobots/footprint#68) > a lockfile or a generated-looking name under a test path is test` | implemented |
| CO-10g | `test/fixtures/vendor/lib.go`, `test/fixtures/node_modules/x/index.js` | each `generated`: a generated directory still wins, as in CO-7b | `... > a generated directory under a test path is still generated` | implemented |

## Known gaps

- **Rules still above the test rules** (CO-10): generated directories, minified files and source maps
  (`test/fixtures/x.min.js` is `generated`), and the `ci` rules (`test/fixtures/Dockerfile` is `ci`).
- **`vendor/` as a domain word** (CO-10): any `vendor/` path component is `generated`, so hand-written
  code such as `app/models/vendor/order.rb` or `src/vendor/api.ts` is too (flyingrobots/footprint#69).
- **A real lockfile under a test directory** (CO-10f): `tests/e2e/package-lock.json` is `test`, not
  `generated`, because the name rules come after the test rules.
- **Lockfiles not covered** (CO-10): `.terraform.lock.hcl`, Julia's `Manifest.toml`, `conda-lock.yml`, and
  `requirements.txt`, which the landing plan treats as a Python lockfile but which classifies as `docs`.
- CO-6a runs against this repository's own last commit, so which categories it
  names depends on that commit; the invariant it pins is the sum, not a fixed category list.
