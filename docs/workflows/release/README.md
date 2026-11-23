# Releasing footprint

How a version of `@flyingrobots/footprint` reaches a GitHub release and npm. This is a contributor
operation. What to do once a release pull request has merged is also listed in
[`RELEASE.md`](../../../RELEASE.md), which footprint itself reads and reports.

## The order

1. Move everything under `## [Unreleased]` in `CHANGELOG.md` to a new heading
   `## [X.Y.Z] — YYYY-MM-DD`, dated the day of the release, and leave `## [Unreleased]` empty above
   it. A schema version listed in that section stops being a draft: from then on a change to it is
   a new version (see `AGENTS.md`, Output).
2. Set `version` in `package.json` to the same number, and regenerate `package-lock.json` with
   `npm install --package-lock-only` so it names it too.
3. Update the status line in `README.md`.
4. Merge that through a pull request; CI must be green.
5. Tag the merge commit on `main` as `vX.Y.Z` and push the tag:

   ```bash
   git fetch origin
   git tag vX.Y.Z origin/main
   git push origin vX.Y.Z
   ```

The tag starts [`.github/workflows/release.yml`](../../../.github/workflows/release.yml):

| Job | Does |
| --- | --- |
| `sanity` | Refuses a tag whose version differs from `package.json`, a version with no dated `## [X.Y.Z] — YYYY-MM-DD` heading in `CHANGELOG.md`, and a tagged commit that is not on `main`; checks the manifest's publishing fields (`bin`, `files`, `engines`, `publishConfig.access: public` among them); runs `bun test` with the same environment as CI; dry-runs the pack; and fails if npm would publish a different manifest than the one tagged (below) |
| `release` | Creates the GitHub release named after the tag, with that version's changelog section as notes and the tarball plus `SHA256SUMS` attached |
| `publish` | In the GitHub environment `npm`, publishes with OIDC provenance through npm trusted publishing; no token lives in the repository |

The tarball on the GitHub release and the one on npm are the same bytes; compare the digest when
in doubt. The tag check is also made locally: `test/release.test.ts` (OUT-17b) fails when the
manifest version has no dated changelog heading.

## The manifest npm publishes

npm normalizes `package.json` at publish time and silently drops what it considers invalid, with
only a warning in the publish log. At `v0.3.0` it removed `bin.footprint`, then written
`./src/cli.ts`, so the package would have installed with no command (flyingrobots/footprint#35).
The `bin` path is written `src/cli.ts`, with no leading `./`, which npm keeps.

The `sanity` job's last step makes any such correction a failure rather than a warning:

```bash
bun scripts/manifest-check.ts --npm "npx -y npm@latest"
```

It runs, with the same npm the `publish` job uses, `npm pkg fix` on a copy of `package.json` and
fails on every field that would change (`kind: "manifest_rewrite"`), then `npm publish --dry-run
--access public` and fails on every correction it reports (`kind: "publish_correction"`) or if
the dry run itself fails. Its output is JSON Lines ending in one `kind: "manifest_check"` line
whose `ok` says which; exit 1 when it is false. Run it locally the same way before tagging. It
fails on a version already on npm, because a dry run of a published version is refused; that is
why `test/manifest.test.ts` exercises it on throwaway packages instead (OUT-18).

## One-time setup

**The first publish of a new package is manual.** npm trusted publishing is configured on the
package's settings page, and a package that does not exist yet has none. The owner publishes the
first version by hand, from the tagged commit, with their one-time password:

```bash
git checkout vX.Y.Z
bun install --frozen-lockfile
npm publish --access public
```

Then, on npmjs.com, under the package's **Settings → Trusted publishing**, add a GitHub Actions
publisher with exactly these values:

| Field | Value |
| --- | --- |
| Organization or user | `flyingrobots` |
| Repository | `footprint` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

The repository also needs a GitHub environment named `npm` (**Settings → Environments**). Until
both exist, the `publish` job fails with an authentication error and nothing is published; the
GitHub release from the `release` job still exists, and the version can be published by hand as
above.
