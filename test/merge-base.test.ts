// flyingrobots/footprint#39: the structural section of a three-dot range compares from the merge
// base, as the composition and exports sections do, not from the base ref's tip.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const CLI_TIMEOUT = 60_000;

// A PATH of git and node only, as in cli.test.ts: no gh, and graft's `#!/usr/bin/env node` works.
const BIN = mkdtempSync(join(tmpdir(), "footprint-mb-bin-"));
for (const exe of ["git", "node"]) {
  const found = Bun.which(exe);
  if (found !== null) symlinkSync(found, join(BIN, exe));
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
}

/** main gains later.ts after feature was cut; feature adds mine.ts and never touches later.ts. */
async function fixture(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "footprint-mb-repo-"));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "base.ts"), "export function base(): number {\n  return 1;\n}\n");
  await git(dir, "add", "."); await git(dir, "commit", "-q", "-m", "base");
  await git(dir, "checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "mine.ts"), "export function mine(): number {\n  return 2;\n}\n");
  await git(dir, "add", "."); await git(dir, "commit", "-q", "-m", "feature adds mine");
  await git(dir, "checkout", "-q", "main");
  writeFileSync(join(dir, "later.ts"), "export function later(): number {\n  return 3;\n}\n");
  await git(dir, "add", "."); await git(dir, "commit", "-q", "-m", "main gains later");
  await git(dir, "checkout", "-q", "feature");
  return dir;
}

type Composition = { event: string; structural: { available: boolean; breakingChanges?: string[]; symbolsAdded?: number; symbolsRemoved?: number }; composition: { files: number } };

async function composition(dir: string, range: string): Promise<Composition> {
  const env = { ...process.env, PATH: BIN, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-mb-state-")) };
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), range], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, , status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(status).toBe(0);
  const lines = stdout.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Composition & { _schema: { id: string } });
  return lines.find((l) => l.event === "result" && l._schema.id === "footprint.composition")!;
}

describe("the structural section of a three-dot range", () => {
  test("ignores what the base gained after the branch was cut", async () => {
    const dir = await fixture();
    const result = await composition(dir, "main...feature");
    expect(result.composition.files).toBe(1);
    // graft must have answered: a limitation here would pass the next lines for the wrong reason.
    expect(result.structural.available).toBe(true);
    expect(result.structural.breakingChanges).toEqual([]);
    expect(result.structural.symbolsRemoved).toBe(0);
    expect(result.structural.symbolsAdded).toBe(1);
  }, CLI_TIMEOUT);

  test("compares a two-dot range end to end, as written", async () => {
    const dir = await fixture();
    const result = await composition(dir, "main..feature");
    expect(result.structural.available).toBe(true);
    expect(result.structural.breakingChanges!.some((b) => b.includes('"filePath":"later.ts"'))).toBe(true);
  }, CLI_TIMEOUT);
});
