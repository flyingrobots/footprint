// A loud gate, not a quiet one (flyingrobots/footprint#25). flyingrobots/footprint#10 found by
// accident that `@flyingrobots/graft` can install on `ubuntu-latest` and still never answer, so
// every graft-backed assertion in test/cli.test.ts quietly takes its "unavailable" branch while
// the suite reads green. This file is the honest alternative: with `FOOTPRINT_REQUIRE_GRAFT=1`
// set, it runs the CLI on a small real range of this repository and asserts the blast radius
// reports graft as *available* -- answered, not merely installed. Without the variable it is
// skipped, visibly, by name, so a local run with no graft (or no interest in asserting it) still
// passes.
//
// The failure case this guards against is named in the issue: "a test that checks graft is
// installed rather than that it answered." Checking `exports.available` on the blast-radius
// result is what tells the two apart -- `graft.not_resolved` and `graft.exports_failed` both read
// as "did not answer" here, exactly as they should.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CLI_TIMEOUT = 60_000;
const REQUIRE_GRAFT = process.env.FOOTPRINT_REQUIRE_GRAFT === "1";

type BlastRadiusResult = {
  readonly _schema?: { readonly id?: string };
  readonly exports?: {
    readonly available?: boolean;
    readonly reason?: { readonly code?: string; readonly detail?: string };
  };
};

/**
 * Mirrors test/cli.test.ts's own restricted PATH: only `git` and `node` are on it, so graft's own
 * `#!/usr/bin/env node` bin can run and `gh` stays out. `node` must be on PATH or every graft
 * subcommand fails to execute before it ever gets a chance to answer -- flyingrobots/footprint#10's
 * own finding, repeated here so this file does not depend on test/cli.test.ts's module-level BIN.
 */
const BIN = mkdtempSync(join(tmpdir(), "footprint-require-graft-bin-"));
for (const exe of ["git", "node"]) {
  const found = Bun.which(exe);
  if (found !== null) symlinkSync(found, join(BIN, exe));
}

/**
 * graft writes its own lazy WARP index as git objects in the repository it reads (`git
 * commit-tree`, by way of `@git-stunts/plumbing`). That plumbing layer sanitises the environment
 * it hands to its own git subprocesses down to a short whitelist that does not include `HOME`, so
 * git has no `~/.gitconfig` to read an identity from; on a container's root user with no GECOS
 * name on its passwd entry, git's own fallback identity construction fails too, and `commit-tree`
 * exits 128 -- "Git command failed with code 128" from graft, surfacing here as
 * `graft.exports_failed`. `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/
 * `GIT_COMMITTER_EMAIL` are the four identity variables that whitelist does carry through, so
 * setting them is what lets graft answer rather than silently failing its own write path.
 */
async function cli(args: string[]): Promise<{ stdout: string; status: number }> {
  const env = {
    ...process.env,
    PATH: BIN,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-require-graft-state-")),
    GIT_AUTHOR_NAME: "footprint-ci",
    GIT_AUTHOR_EMAIL: "footprint-ci@example.invalid",
    GIT_COMMITTER_NAME: "footprint-ci",
    GIT_COMMITTER_EMAIL: "footprint-ci@example.invalid",
  };
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, status };
}

describe("graft answered, proven rather than assumed (flyingrobots/footprint#25)", () => {
  test.skipIf(!REQUIRE_GRAFT)(
    REQUIRE_GRAFT
      ? "FOOTPRINT_REQUIRE_GRAFT=1: the blast radius over HEAD~1..HEAD reports graft as available"
      : "skipped: FOOTPRINT_REQUIRE_GRAFT is not set in this environment, so nothing here asserts graft answered",
    async () => {
      const r = await cli(["HEAD~1..HEAD"]);
      expect(r.status).toBe(0);

      const lines = r.stdout
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as BlastRadiusResult);
      const blast = lines.find((l) => l._schema?.id === "footprint.blast_radius");
      if (blast === undefined) {
        throw new Error("the run produced no footprint.blast_radius result at all; graft never had a chance to answer");
      }

      const exportsSection = blast.exports;
      if (exportsSection === undefined) {
        throw new Error("the blast-radius result carries no exports section; graft never had a chance to answer");
      }

      if (exportsSection.available !== true) {
        const code = exportsSection.reason?.code ?? "(no code)";
        const detail = exportsSection.reason?.detail ?? "(no detail)";
        throw new Error(
          `graft did not answer: footprint.blast_radius.exports.available is false (${code}: ${detail}). ` +
            "FOOTPRINT_REQUIRE_GRAFT=1 asserts graft answered, not merely that it installed -- see docs/workflows/ci/README.md.",
        );
      }
      expect(exportsSection.available).toBe(true);
    },
    CLI_TIMEOUT,
  );
});
