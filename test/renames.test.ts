// Renamed and unusually named files, read from real git (flyingrobots/footprint#66). Without -z,
// `git diff --numstat` writes a rename as `dir/{old => new}/file` and C-quotes a path holding a
// tab or a non-ASCII byte; footprint used to keep that text as the path. The oracle here is git
// itself: `git diff --name-only -z` names each changed file by its real post-change path.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseNumstat } from "../src/footprint.ts";

const ROOT = resolve(import.meta.dir, "..");
let repo = "";
const BLOCKS = [..."abcdefgh"].map((b) => [0, 1, 2, 3].map((i) => `${b}${i} = ${b}${i}`));
// Hermetic: no global or system git config can turn rename detection off, or anything else on.
const HERMETIC = {
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: repo, env: { ...process.env, ...HERMETIC }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

function write(path: string, text: string): void {
  mkdirSync(join(repo, path, ".."), { recursive: true });
  writeFileSync(join(repo, path), text);
}

// Fixed identity, dates and config, so the fixture is the same on every machine (no user config).
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "footprint-renames-"));
  git("init", "-q", "-b", "main");
  for (const [k, v] of [["user.name", "Fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"], ["core.quotepath", "true"]]) git("config", k!, v!);
  const body = Array.from({ length: 40 }, (_, i) => `export const line${i} = ${i};`).join("\n") + "\n";
  write("src/auth.ts", body);
  write("lib/old.py", Array.from({ length: 40 }, (_, i) => `x${i} = ${i}`).join("\n") + "\n");
  write("README.md", "# fixture\n");
  // Eight 4-line blocks; the head reorders them and edits one line. git's diff algorithms disagree
  // on this file (myers 20/20, histogram 28/28), so it shows whether user config moves the figures.
  write("src/alg.txt", BLOCKS.flat().join("\n") + "\n");
  git("add", "-A");
  // A submodule (a gitlink; the commit need not exist), so diff.ignoreSubmodules has a row to drop.
  git("update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,sub");
  git("commit", "-q", "-m", "base");
  git("tag", "base");
  mkdirSync(join(repo, "src/auth"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  git("mv", "src/auth.ts", "src/auth/index.ts");
  git("mv", "lib/old.py", "docs/notes.md");
  // Inexact renames: diff.renameLimit applies only to these, so the config test depends on -l1000.
  writeFileSync(join(repo, "src/auth/index.ts"), body + "export const added = 1;\n");
  writeFileSync(join(repo, "docs/notes.md"), Array.from({ length: 40 }, (_, i) => `x${i} = ${i}`).join("\n") + "\nx40 = 40\n");
  writeFileSync(join(repo, "src/copy.ts"), body);
  const moved = [7, 1, 5, 3, 0, 6, 2, 4].flatMap((i) => BLOCKS[i]!);
  moved[9] = "edited";
  write("src/alg.txt", moved.join("\n") + "\n");
  git("update-index", "--cacheinfo", "160000,2222222222222222222222222222222222222222,sub");
  write("docs/café.md", "accent\n");
  write("docs/a\tb.md", "tab\n");
  git("add", "-A");
  git("commit", "-q", "-m", "rename");
});

describe("changed paths from real git output (flyingrobots/footprint#66)", () => {
  test("every path parsed from git diff --numstat -z is a real path git names", () => {
    const parsed = parseNumstat(git("diff", "--numstat", "-z", "base..HEAD")).map((c) => c.path).sort();
    const oracle = git("diff", "--name-only", "-z", "base..HEAD").split("\0").filter((p) => p !== "").sort();
    expect(parsed).toEqual(oracle);
  });

  test("the fixture's renames are rename records, not a delete and an add", () => {
    const status = git("diff", "--name-status", "-z", "-M", "base..HEAD").split("\0");
    expect(status.filter((f) => /^R\d+$/.test(f))).toHaveLength(2);
  });

  test("a copy record from real git is parsed under the copy's path", () => {
    const status = git("diff", "--name-status", "-z", "-C", "--find-copies-harder", "base..HEAD").split("\0");
    expect(status.some((f) => /^C\d+$/.test(f))).toBe(true); // the fixture did produce a copy
    const parsed = parseNumstat(git("diff", "--numstat", "-z", "-C", "--find-copies-harder", "base..HEAD")).map((c) => c.path);
    expect(parsed).toContain("src/copy.ts");
    expect(parsed.some((p) => p.includes("\0") || p === "")).toBe(false);
  });

  test("the CLI reports a renamed file under its new path", async () => {
    // PATH holds git only: no gh, and no node, so graft states its limitation quickly.
    const bin = mkdtempSync(join(tmpdir(), "footprint-bin-"));
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "base..HEAD", "--human"], {
      cwd: repo,
      env: { ...process.env, ...HERMETIC, PATH: bin, FOOTPRINT_GRAFT: join(bin, "no-graft"), XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(status).toBe(0);
    expect(out).toContain("`src/auth/index.ts`");
    expect(out).toContain("`docs/café.md`");
    expect(out).not.toContain("=>");
  }, 60_000);

  test("a user's diff.algorithm, diff.relative, diff.renameLimit and attributes file do not change the composition", async () => {
    // The oracle is the hermetic run from the repository root; the other run has a user config
    // that changes both settings, and starts in a subdirectory, where diff.relative would narrow it.
    expect(git("-c", "diff.algorithm=histogram", "diff", "--numstat", "base..HEAD", "--", "src/alg.txt")).not.toBe(git("diff", "--numstat", "base..HEAD", "--", "src/alg.txt"));
    const config = join(mkdtempSync(join(tmpdir(), "footprint-gitconfig-")), "config");
    // Also diff.renameLimit, which would turn the fixture's inexact renames into deletions and
    // additions, a user attributes file marking source -diff and a tiny core.bigFileThreshold, each
    // of which turns counts into "-".
    const attributes = join(config, "..", "attributes");
    writeFileSync(attributes, "*.ts -diff\n*.txt -diff\n");
    writeFileSync(config, `[diff]\n\talgorithm = histogram\n\trelative = true\n\trenameLimit = 1\n[core]\n\tattributesFile = ${attributes}\n\tbigFileThreshold = 10\n`);
    // Command-level config (GIT_CONFIG_COUNT), which no GIT_CONFIG_GLOBAL setting drops: it stands
    // in for a repository's own .git/config, so the explicit -l1000 and bigFileThreshold pins are
    // what keep the figures against it.
    const command = {
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "diff.renameLimit", GIT_CONFIG_VALUE_0: "1",
      GIT_CONFIG_KEY_1: "core.bigFileThreshold", GIT_CONFIG_VALUE_1: "10",
      GIT_CONFIG_KEY_2: "diff.ignoreSubmodules", GIT_CONFIG_VALUE_2: "all",
    };
    // git's default user attributes file, $XDG_CONFIG_HOME/git/attributes, which applies whenever
    // core.attributesFile is unset: only footprint's own core.attributesFile pin keeps it out.
    const xdg = mkdtempSync(join(tmpdir(), "footprint-xdg-"));
    mkdirSync(join(xdg, "git"));
    writeFileSync(join(xdg, "git", "attributes"), "*.ts -diff\n*.txt -diff\n");
    const bin = mkdtempSync(join(tmpdir(), "footprint-bin-"));
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    const composition = async (cwd: string, extra: Record<string, string>) => {
      const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "base..HEAD"], {
        cwd,
        env: { ...process.env, ...HERMETIC, ...extra, PATH: bin, FOOTPRINT_GRAFT: join(bin, "no-graft"), XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      expect(status).toBe(0);
      const line = out.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { _schema: { id: string }; composition?: unknown }).find((l) => l._schema.id === "footprint.composition");
      return line?.composition;
    };
    const hermetic = await composition(repo, {});
    expect(hermetic).toBeDefined();
    expect(await composition(join(repo, "src"), { GIT_CONFIG_GLOBAL: config })).toEqual(hermetic);
    expect(await composition(repo, command)).toEqual(hermetic);
    expect(await composition(repo, { XDG_CONFIG_HOME: xdg })).toEqual(hermetic);
  }, 120_000);

  test("a repository owned by another user, trusted through safe.directory, still gets its figures", async () => {
    // git reads safe.directory only from global, system or command-line config, so footprint must
    // not stop reading the user's global config (flyingrobots/footprint#66, review round 5). git's
    // own test hook makes it treat the repository as another user's, as a container checkout is.
    const config = join(mkdtempSync(join(tmpdir(), "footprint-gitconfig-")), "config");
    writeFileSync(config, "[safe]\n\tdirectory = *\n");
    const bin = mkdtempSync(join(tmpdir(), "footprint-bin-"));
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    const run = async (extra: Record<string, string>) => {
      const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "base..HEAD"], {
        cwd: repo,
        env: { ...process.env, ...HERMETIC, ...extra, PATH: bin, FOOTPRINT_GRAFT: join(bin, "no-graft"), XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      const line = out.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { _schema: { id: string }; composition?: unknown }).find((l) => l._schema.id === "footprint.composition");
      return { status, composition: line?.composition };
    };
    const owned = await run({});
    const foreign = await run({ GIT_TEST_ASSUME_DIFFERENT_OWNER: "1", GIT_CONFIG_GLOBAL: config });
    expect(foreign.status).toBe(0);
    expect(foreign.composition).toEqual(owned.composition);
  }, 120_000);
});
