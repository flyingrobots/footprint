// The footprint agent skill's commands, run as written under real bash and real zsh
// (flyingrobots/footprint#37). zsh does not word-split an unquoted parameter, so the 0.3.0 snippet
// `FP="bun …/src/cli.ts"; $FP …` ran the whole string as one command name and exited 127.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/** A scratch directory laid out the way step 1's clone form expects, and a stub gh. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "footprint-skill-"));
  symlinkSync(ROOT, join(dir, "footprint"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", bin]);
  const log = join(dir, "gh.log");
  // Records a `gh pr comment` and fails everything else, as an unauthenticated gh would; footprint
  // then states the overlap section unavailable, which is what it does without gh.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nif [ "$1 $2" = "pr comment" ]; then echo "$*" >> "${log}"; exit 0; fi\nexit 1\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { dir, bin, log };
}

function run(sh: "bash" | "zsh", script: string, s: ReturnType<typeof scratch>) {
  const env = { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, SCRATCH: s.dir };
  const r = Bun.spawnSync([shell(sh), "-c", script], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
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
  const step3 = () => {
    const blocks = BLOCKS.filter((b) => b.includes('fp "$RANGE" --human'));
    expect(blocks).toHaveLength(1);
    return blocks[0]!;
  };

  for (const sh of ["bash", "zsh"] as const) {
    test(`step 3 runs verbatim and posts the report under ${sh}`, () => {
      const s = scratch();
      const script = `set -e\nPR=4242\nRANGE=HEAD..HEAD\n${cloneDefinition()}\n${step3()}`;
      const r = run(sh, script, s);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      const out = join(s.dir, "footprint-4242.md");
      expect(readFileSync(out, "utf8")).toStartWith("## Footprint");
      expect(existsSync(s.log)).toBe(true);
      expect(readFileSync(s.log, "utf8").trim()).toBe(`pr comment 4242 --body-file ${out}`);
    }, 60_000);
  }

  test("the 0.3.0 form fails under zsh and not bash, so the harness can tell", () => {
    const s = scratch();
    const old = 'FP="bun $SCRATCH/footprint/src/cli.ts"\n$FP --help >/dev/null';
    expect(run("bash", old, s).code).toBe(0);
    expect(run("zsh", old, s).code).toBe(127);
  }, 30_000);
});
