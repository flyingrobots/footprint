// The footprint agent skill's commands, run as written under real bash and real zsh
// (flyingrobots/footprint#37). zsh does not word-split an unquoted parameter, so the 0.3.0 snippet
// `FP="bun …/src/cli.ts"; $FP …` ran the whole string as one command name and exited 127.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MARKER } from "../src/comment.ts";
import { COMMENT_REPORT_LIMIT } from "../src/bound.ts";

const ROOT = resolve(import.meta.dir, "..");
const SKILL = readFileSync(join(ROOT, "skills/footprint/SKILL.md"), "utf8");

/** Every fenced ```bash block, de-indented by its fence's own indentation. */
function bashBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /^([ \t]*)```bash\n([\s\S]*?)^\1```$/gm;
  for (const m of md.matchAll(re)) {
    const indent = m[1]!;
    blocks.push(m[2]!.split("\n").map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join("\n"));
  }
  return blocks;
}

const BLOCKS = bashBlocks(SKILL);

function shell(name: "bash" | "zsh"): string {
  const found = Bun.which(name);
  if (found === null) throw new Error(`${name} is not on PATH; the skill's commands must be checked under both shells`);
  return found;
}

/**
 * A scratch directory laid out the way step 1's clone form expects, and the stand-in gh of
 * test/fixtures/fake-gh, holding pull request 4242 with no comment yet. Every other gh call fails,
 * as an unauthenticated gh would; footprint then states the overlap section unavailable, which is
 * what it does without gh.
 */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "footprint-skill-"));
  symlinkSync(ROOT, join(dir, "footprint"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", bin]);
  symlinkSync(join(ROOT, "test", "fixtures", "fake-gh", "gh"), join(bin, "gh"));
  const state = join(dir, "gh-state.json");
  writeFileSync(state, JSON.stringify({ login: "me", head: "0123456789abcdef0123456789abcdef01234567", pr: 4242, comments: [], calls: [] }));
  const ghState = () => JSON.parse(readFileSync(state, "utf8")) as { comments: { body: string }[]; calls: { args: string[] }[] };
  return { dir, bin, state, ghState };
}

function run(sh: "bash" | "zsh", script: string, s: ReturnType<typeof scratch>) {
  const env = { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, SCRATCH: s.dir, FAKE_GH_STATE: s.state };
  // zsh -f skips the user's startup files (a ~/.zshenv that puts the real gh back in front of the
  // stub); it changes no option, so zsh still does not word-split, which is the behaviour under test.
  const args = sh === "zsh" ? ["-f", "-c", script] : ["-c", script];
  const r = Bun.spawnSync([shell(sh), ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("the skill's commands", () => {
  test("no command is an unquoted parameter expansion", () => {
    expect(BLOCKS.length).toBeGreaterThan(0);
    const offending = BLOCKS.flatMap((b) => b.split("\n")).filter((l) => /^\s*\$\{?[A-Za-z_]/.test(l));
    expect(offending).toEqual([]);
  });

  const cloneDefinition = () => {
    const lines = BLOCKS.flatMap((b) => b.split("\n")).filter((l) => /^fp\(\) \{ bun "\$SCRATCH\/footprint\/src\/cli\.ts" "\$@"; \}$/.test(l));
    expect(lines).toHaveLength(1);
    return lines[0]!;
  };
  const post = () => {
    const blocks = BLOCKS.filter((b) => b.includes('fp comment "$PR"'));
    expect(blocks).toHaveLength(1);
    return blocks[0]!;
  };

  // MC-1c
  test("the report is bounded to leave the Changelog its room", () => {
    const report = post().split("\n").filter((l) => /^fp "\$RANGE" --human/.test(l));
    expect(report).toHaveLength(1);
    expect(report[0]).toContain(`--max-chars ${COMMENT_REPORT_LIMIT}`);
    expect(report[0]).toContain('--impact "$IMPACT"');
  });

  for (const sh of ["bash", "zsh"] as const) {
    test(`the posting step runs verbatim and creates the one Footprint comment under ${sh}`, () => {
      const s = scratch();
      writeFileSync(join(s.dir, "impact.jsonl"), "");
      const script = `set -e\nPR=4242\nRANGE=HEAD..HEAD\nIMPACT="$SCRATCH/impact.jsonl"\nCHANGE="First report"\nREASON="Pull request opened"\nREMARKS="none"\n${cloneDefinition()}\n${post()}`;
      const r = run(sh, script, s);
      // stderr carries footprint's own JSON Lines (the stand-in gh cannot list pull requests);
      // what must never appear is the shell failing to find the command.
      expect(r.stderr).not.toMatch(/command not found|no such file or directory/i);
      expect(r.code).toBe(0);
      const out = join(s.dir, "footprint-4242.md");
      // An empty range keeps the run short; its report opens by naming the range it read.
      const report = readFileSync(out, "utf8");
      expect(report).toStartWith("No changes in `HEAD..HEAD`.");
      expect(report).toContain("## After merge");
      const gh = s.ghState();
      expect(gh.comments).toHaveLength(1);
      expect(gh.comments[0]!.body.split("\n")[0]).toBe(MARKER);
      expect(gh.comments[0]!.body).toContain(report.trimEnd());
      expect(gh.comments[0]!.body).toContain("| First report | Pull request opened | none |");
      expect(gh.calls.filter((c) => c.args.includes("--method")).map((c) => c.args[c.args.indexOf("--method") + 1])).toEqual(["POST"]);
    }, 120_000);
  }

  test("the 0.3.0 form fails under zsh and not bash, so the harness can tell", () => {
    const s = scratch();
    const old = 'FP="bun $SCRATCH/footprint/src/cli.ts"\n$FP --help >/dev/null';
    expect(run("bash", old, s).code).toBe(0);
    expect(run("zsh", old, s).code).toBe(127);
  }, 30_000);
});
