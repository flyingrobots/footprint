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
| `publish` | In the GitHub environment `npm`, stages the version with `npm stage publish` and OIDC provenance through npm trusted publishing; no token lives in the repository. Nothing is installable yet |

**A release ends with the owner's approval.** The trusted publisher is allowed to stage and
nothing else, so a workflow cannot put code in front of users on its own. The owner lists what is
waiting and approves it with their one-time password, or does the same on the package's **Staged
Packages** tab on npmjs.com:

```bash
npm stage list @flyingrobots/footprint
npm stage approve <stage-id>
```

`npm stage view <stage-id>` and `npm stage download <stage-id>` show what would be published;
`npm stage reject <stage-id>` discards it. These commands need an interactive login and cannot be
run from CI.

The tarball on the GitHub release and the one on npm hold the same files, but not necessarily the
same bytes. The `release` job packs with the runner's npm and the `publish` job stages with
`npx -y npm@latest`, so two npm versions can pack one tagged tree. The same files gzipped by different npm or zlib versions
give different `.tgz` bytes, so the `SHA256SUMS` digest on the release matches an npm tarball only
when the same npm packed it. What is guaranteed is the contents; what is not is the archive digest.
To check a tarball, compare its files and their digests, not the digest of the archive
([below](#verifying-a-tarballs-contents)). The tag check is also made locally:
`test/release.test.ts` (OUT-17b) fails when the manifest version has no dated changelog heading.

## Verifying a tarball's contents

Unpack both tarballs and compare the sorted list of files with a SHA-256 of each:

```bash
mkdir -p a b npm
tar -xzf flyingrobots-footprint-X.Y.Z.tgz -C a        # the GitHub release asset
npm pack @flyingrobots/footprint@X.Y.Z --pack-destination npm
tar -xzf npm/flyingrobots-footprint-X.Y.Z.tgz -C b     # the npm tarball
for d in a b; do (cd "$d/package" && find . -type f | sort | xargs shasum -a 256 | shasum -a 256); done
diff -r a b && echo CONTENTS-IDENTICAL
```

Two identical digest lines, or an empty `diff -r`, mean the same files with the same contents. The
npm tarball goes in its own directory because both tarballs are named
`flyingrobots-footprint-X.Y.Z.tgz`.

**Captured example, 2026-11-22.** This is a real run, not an illustration. The release asset is
`flyingrobots-footprint-0.3.1.tgz` from the `v0.3.1` GitHub release. The other tarball is
`npm pack` of the same tagged tree (`git archive v0.3.1`) with npm 11.20.0 on macOS; 0.3.1 was not
yet on npm, so this stands in for the npm tarball. The archive digests differ:

```text
46f614f3bea511c5d8651c0932bf0efbf7cfedcf855bf0d82296b47d250512d1  release asset (SHA256SUMS)
8c91dd6de9d6643de8e6d0ab99f67a4f0e76bcb98880bb994646624e82a69714  npm pack, npm 11.20.0
```

and the contents do not (`diff -r a b` printed nothing; the digest of the sorted per-file digests
is the same for both):

```text
9631373b9ba9f71351e1c5e3dddc1db3a41ac325a22d602621d1040b6115c7e2  -
9631373b9ba9f71351e1c5e3dddc1db3a41ac325a22d602621d1040b6115c7e2  -
```

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

On npmjs.com, under the package's **Settings → Trusted Publisher**, add a GitHub Actions publisher
with exactly these values:

| Field | Value |
| --- | --- |
| Organization or user | `flyingrobots` |
| Repository | `footprint` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |
| Allow `npm publish` | unchecked |
| Allow `npm dist-tag` | unchecked |

With both boxes unchecked the publisher may run `npm stage publish` and nothing else. A workflow
that runs `npm publish` against it is refused with `OIDC permission denied for this action`.

The repository also needs a GitHub environment named `npm` (**Settings → Environments**). Until
both exist, the `publish` job fails and nothing is staged; the GitHub release from the `release`
job still exists.

The settings page exists only once the package name does. Staging a package npm has never seen claims the name with a public
placeholder version, `0.0.0-stage`; the staged contents stay private until approved.
