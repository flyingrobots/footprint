# The agent skill — test plan

Evidence lives in `test/skill.test.ts`, which reads `skills/footprint/SKILL.md` and runs its
commands as written, under real `bash` and real `zsh`, against the stand-in `gh` of
`test/fixtures/fake-gh` (flyingrobots/footprint#59). Both shells must be installed: CI installs
`zsh` on `ubuntu-latest`, and the cases fail rather than skip when either is missing.

| ID | Requirement |
| --- | --- |
| SK-1 | The skill's commands run the same in bash and in zsh. zsh, the macOS default shell, does not word-split an unquoted parameter, so no command in the skill may depend on splitting one; the program is named by a shell function, `fp`, which both shells call the same way (flyingrobots/footprint#37) |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| SK-1a | Every line of every `bash` block in `SKILL.md` | no command word is an unquoted parameter expansion (`$FP …`, `${FP} …`) | `the skill's commands > no command is an unquoted parameter expansion` | implemented |
| SK-1b | Step 1's clone-form `fp` definition and step 5's posting block, both copied verbatim from `SKILL.md`, run under `bash -c` from this checkout with `$SCRATCH/footprint` linked to it, `RANGE=HEAD..HEAD`, an empty `$IMPACT` file, `CHANGE`, `REASON` and `REMARKS` set, and the stand-in `gh` of `test/fixtures/fake-gh` holding the pull request with no comment | exit 0; stderr names no `command not found` or `no such file or directory`; `$OUT` holds the report for that range, opening ``No changes in `HEAD..HEAD`.`` and carrying `## After merge`; the stand-in holds one comment, first line `<!-- footprint:report -->`, carrying the report and a Changelog row of the three values; its call log shows one POST and no other write. Before flyingrobots/footprint#59 the oracle was one `gh pr comment <PR> --body-file <OUT>` call | `the skill's commands > the posting step runs verbatim and creates the one Footprint comment under bash` | implemented |
| SK-1c | The same under `zsh -f -c` (`-f` skips the user's startup files, which could put the real `gh` back in front of the stand-in; it changes no option, so zsh still does not word-split) | the same | `the skill's commands > the posting step runs verbatim and creates the one Footprint comment under zsh` | implemented |
| SK-1f | Step 5's posting block | its report command passes `--max-chars` equal to `COMMENT_REPORT_LIMIT` (57344) and `--impact "$IMPACT"` (MC-1c in [the comment test plan](../comment/test-plan.md)) | `the skill's commands > the report is bounded to leave the Changelog its room` | implemented |
| SK-1d | Control: the 0.3.0 form, `FP="bun $SCRATCH/footprint/src/cli.ts"; $FP --help`, under both shells | exit 0 under bash, 127 under zsh, so SK-1c is able to fail | `the skill's commands > the 0.3.0 form fails under zsh and not bash, so the harness can tell` | implemented |
| SK-1e | Steps 1 to 3 of `SKILL.md`, pasted into an interactive `zsh` and into `bash` on the pull request that makes this change | both produce the same report; the zsh one is posted as the pull request's footprint comment (by hand) | by hand on flyingrobots/footprint#40 at `32db3878`, steps 1 (clone form) to 3 under `zsh -c` and `bash -c`: both exit 0 and wrote byte-identical reports (`diff` empty) for `origin/main...origin/skill-zsh`; the zsh one is the footprint comment on the pull request | implemented |
