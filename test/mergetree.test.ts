// git merge-tree on overlap edges (flyingrobots/footprint#80). The fixture is real git: a bare
// "origin" holding pull request heads as refs/pull/<n>/head, as GitHub does, and a clone that, like
// any plain clone, does not have them (cloned over file://, so git copies only the objects the
// cloned refs reach, as a network clone does; a plain path clone hard-links the whole store). The oracle for clean and conflicted is git itself on a
// throwaway merge: the fixture's branches are built to conflict, or not, on purpose.
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeRunner, type Side } from "../src/mergetree.ts";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
let origin = "";
let clone = "";
const head: Record<number, string> = {};

function git(cwd: string, ...a: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "user.name=f", "-c", "user.email=f@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.toString().trim();
}
const lines = (tag: string, at: number) => Array.from({ length: 10 }, (_, i) => (i === at ? `${tag}\n` : `line ${i}\n`)).join("");

beforeAll(() => {
  const work = mkdtempSync(join(tmpdir(), "footprint-mt-work-"));
  origin = mkdtempSync(join(tmpdir(), "footprint-mt-origin-"));
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(work, "init", "-q", "-b", "main");
  writeFileSync(join(work, "f.txt"), lines("", -1));
  writeFileSync(join(work, "g.txt"), lines("", -1));
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "base");
  git(work, "push", "-q", origin, "main");
  // #1 and #2 change the same line of f.txt: they conflict. #3 and #4 change different lines of
  // g.txt: they share the file and merge cleanly.
  for (const [n, file, tag, at] of [[1, "f.txt", "one", 0], [2, "f.txt", "two", 0], [3, "g.txt", "three", 0], [4, "g.txt", "four", 9]] as const) {
    git(work, "checkout", "-q", "-B", `b${n}`, "main");
    writeFileSync(join(work, file), lines(tag, at));
    git(work, "commit", "-q", "-am", `pr ${n}`);
    head[n] = git(work, "rev-parse", "HEAD");
    git(work, "push", "-q", origin, `HEAD:refs/pull/${n}/head`);
  }
  clone = mkdtempSync(join(tmpdir(), "footprint-mt-clone-"));
  git(clone, "clone", "-q", `file://${origin}`, ".");
});

const pr = (n: number): Side => ({ commit: head[n]!, pr: n });
const run = (fetch = true) => mergeRunner({ repo: clone, fetch });

describe("git merge-tree on two pull request heads (flyingrobots/footprint#80)", () => {
  test("the fixture's clone lacks the pull request heads, as a plain clone does", () => {
    const r = Bun.spawnSync(["git", "cat-file", "-e", `${head[1]}^{commit}`], { cwd: clone, env: ENV });
    expect(r.exitCode).not.toBe(0);
  });

  test("two heads that change the same line conflict, with the path named", async () => {
    expect(await run().merge(pr(1), pr(2))).toEqual({ result: "conflicted", paths: ["f.txt"] });
  });

  test("two heads that change different lines of one file merge cleanly", async () => {
    expect(await run().merge(pr(3), pr(4))).toEqual({ result: "clean" });
  });

  test("a missing head is fetched read-only into refs/footprint/, and counted", async () => {
    const r = run();
    await r.merge(pr(3), pr(4));
    expect(git(clone, "rev-parse", "refs/footprint/pull/3")).toBe(head[3]!);
    expect(r.analysis().fetched).toBeGreaterThanOrEqual(0);
    expect(r.analysis().mergesRun).toBe(1);
  });

  test("with --no-fetch a missing head is unavailable, with the command to run", async () => {
    const bare = mkdtempSync(join(tmpdir(), "footprint-mt-nofetch-"));
    git(bare, "clone", "-q", `file://${origin}`, ".");
    const m = await mergeRunner({ repo: bare, fetch: false }).merge(pr(1), pr(2));
    expect(m).toMatchObject({ result: "unavailable", code: "git.head_missing" });
    expect(m.result === "unavailable" && m.reason).toContain("git fetch origin pull/1/head");
    expect(m.result === "unavailable" && m.reason).toContain("--no-fetch");
  });

  test("a head that moved since gh listed it is unavailable, never merged at the new head", async () => {
    const stale = mkdtempSync(join(tmpdir(), "footprint-mt-moved-"));
    git(stale, "clone", "-q", `file://${origin}`, ".");
    const listed: Side = { commit: "1".repeat(40), pr: 1 };
    expect(await mergeRunner({ repo: stale, fetch: true }).merge(listed, pr(2))).toMatchObject({ result: "unavailable", code: "git.head_moved" });
  });

  test("a git without merge-tree --write-tree is a stated limitation", async () => {
    const bin = mkdtempSync(join(tmpdir(), "footprint-mt-oldgit-"));
    const real = Bun.which("git")!;
    writeFileSync(join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--write-tree" ] && { echo "error: unknown option \\\`write-tree'" >&2; echo "usage: git merge-tree [--write-tree] [<options>] <branch1> <branch2>" >&2; exit 129; }; done\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const m = await mergeRunner({ repo: clone, fetch: true, git: join(bin, "git") }).merge(pr(3), pr(4));
    expect(m).toMatchObject({ result: "unavailable", code: "git.merge_tree_unsupported" });
  });

  test("past the merge budget an edge is unavailable, merge.budget_spent", async () => {
    const r = mergeRunner({ repo: clone, fetch: true, mergeBudget: 1 });
    expect((await r.merge(pr(3), pr(4))).result).toBe("clean");
    expect(await r.merge(pr(1), pr(2))).toMatchObject({ result: "unavailable", code: "merge.budget_spent" });
    expect(r.analysis()).toMatchObject({ mergesRun: 1, mergeBudget: 1 });
  });

  test("the same pair merged twice is merged once", async () => {
    const r = run();
    await r.merge(pr(3), pr(4));
    await r.merge(pr(4), pr(3));
    expect(r.analysis().mergesRun).toBe(1);
  });
});
