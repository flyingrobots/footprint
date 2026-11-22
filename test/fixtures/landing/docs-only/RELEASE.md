# RELEASE

How a change lands in this fixture repository.

## Before you start

- This heading is not a landing section, so nothing under it is a step.

## Release

1. Update both changelogs.
2. Bump the version in `package.json`.
3. Tag the commit and push the tag.

```bash
# A command in a fenced block is not a step: nobody declared it as one.
bun run release
```

### Afterwards

- [ ] Create the GitHub release from the tag.
- [x] Confirm `sync-agents --check` is clean.

## Support

- Not a landing section either.
