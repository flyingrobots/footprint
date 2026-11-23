# The agent skill — test plan

Evidence lives in `test/skill.test.ts`, which reads `skills/footprint/SKILL.md` and runs its
commands as written, under real `bash` and real `zsh`. Both shells must be installed: CI installs
`zsh` on `ubuntu-latest`, and the cases fail rather than skip when either is missing.

| ID | Requirement |
| --- | --- |
| SK-1 | The skill's commands run the same in bash and in zsh. zsh, the macOS default shell, does not word-split an unquoted parameter, so no command in the skill may depend on splitting one; the program is named by a shell function, `fp`, which both shells call the same way (flyingrobots/footprint#37) |

| ID | Case | Oracle | Evidence | Status |
| --- | --- | --- | --- | --- |
| SK-1a | Every line of every `bash` block in `SKILL.md` | no command word is an unquoted parameter expansion (`$FP …`, `${FP} …`) | `the skill's commands > no command is an unquoted parameter expansion` | planned |
| SK-1b | Step 1's clone-form `fp` definition and step 3's block, both copied verbatim from `SKILL.md`, run under `bash -c` from this checkout with `$SCRATCH/footprint` linked to it, `RANGE=HEAD..HEAD` and a stub `gh` that records its arguments | exit 0; `$OUT` holds the report, opening `## Footprint`; the stub was called as `gh pr comment <PR> --body-file <OUT>` | `the skill's commands > step 3 runs verbatim and posts the report under bash` | planned |
| SK-1c | The same under `zsh -c` | the same | `the skill's commands > step 3 runs verbatim and posts the report under zsh` | planned |
| SK-1d | Control: the 0.3.0 form, `FP="bun $SCRATCH/footprint/src/cli.ts"; $FP --help`, under both shells | exit 0 under bash, 127 under zsh, so SK-1c is able to fail | `the skill's commands > the 0.3.0 form fails under zsh and not bash, so the harness can tell` | planned |
| SK-1e | Steps 1 to 3 of `SKILL.md`, pasted into an interactive `zsh` and into `bash` on the pull request that makes this change | both produce the same report; the zsh one is posted as the pull request's footprint comment (by hand) | by hand on flyingrobots/footprint#37's pull request | planned |
