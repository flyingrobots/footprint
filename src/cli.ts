#!/usr/bin/env bun
import { $ } from "bun";
import { compose, parseNumstat } from "./footprint.ts";
import { render } from "./render.ts";

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
  console.log(`footprint — what a change actually touches

Usage:
  footprint [<base>]      compare <base>...HEAD (default: the default branch)
  footprint <base>..<head>

Prints a Markdown comment. Pipe it to \`gh pr comment --body-file -\`.`);
  process.exit(0);
}

async function defaultBase(): Promise<string> {
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (await $`git rev-parse --verify --quiet ${ref}`.quiet().nothrow().then((r) => r.exitCode === 0)) return ref;
  }
  throw new Error("no default branch found; pass a base explicitly");
}

const spec = arg ?? (await defaultBase());
// Three dots: compare against the merge base, so unrelated default-branch commits are excluded.
const range = spec.includes("..") ? spec : `${spec}...HEAD`;
const numstat = await $`git diff --numstat ${range}`.text();
const changes = parseNumstat(numstat);

if (changes.length === 0) {
  console.log(`No changes in \`${range}\`.`);
  process.exit(0);
}
console.log(render(compose(changes), changes, range));
