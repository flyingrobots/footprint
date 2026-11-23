# Releasing footprint

What to do once a pull request has merged to `main`. footprint reads this file and quotes the list
below back in the **After merge** section of its own report, so keep each step a top-level list
item under the heading. How to prepare a release before the merge, and what the release workflow
does, is in [`docs/workflows/release/README.md`](docs/workflows/release/README.md).

## After merge

- If the merged change moved `version` in `package.json`, tag the merge commit on `main` as `vX.Y.Z` with the same number and push the tag; `.github/workflows/release.yml` does the rest. If it did not, this is not a release and nothing below applies.
- Confirm the workflow's `sanity`, `release` and `publish` jobs all succeeded, and that the GitHub release and `npm view @flyingrobots/footprint version` name the same version.
- If `skills/footprint/` changed, reinstall the skill wherever your agents load skills from, so the installed copy matches the release.
