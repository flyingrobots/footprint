// The published manifest is the manifest in the repository (flyingrobots/footprint#35). npm
// normalizes package.json at publish time and silently drops what it considers invalid: at v0.3.0
// it removed `bin.footprint` ("./src/cli.ts"), so `bunx @flyingrobots/footprint` would have found
// no command. These cases hold the manifest to npm's own normalization, and hold the release
// workflow's sanity check to failing on any correction npm reports.
import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { manifestChanges, publishCorrections } from "../scripts/manifest-check.ts";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURES = join(import.meta.dir, "fixtures", "npm-publish");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

describe("the published manifest", () => {
  test("npm's own normalization changes nothing in package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "footprint-pkg-fix-"));
    copyFileSync(join(ROOT, "package.json"), join(dir, "package.json"));
    const r = Bun.spawnSync(["npm", "pkg", "fix"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const original = readJson(join(ROOT, "package.json"));
    expect(readJson(join(dir, "package.json"))).toEqual(original);
    const bin = original.bin as Record<string, string>;
    expect(typeof bin.footprint).toBe("string");
    expect(existsSync(join(ROOT, bin.footprint))).toBe(true);
  });

  test("a dry run that corrected the manifest yields each correction", () => {
    const out = readFileSync(join(FIXTURES, "v0.3.0-npm-11.20.0.txt"), "utf8");
    expect(publishCorrections(out)).toEqual([
      '"bin[footprint]" script name src/cli.ts was invalid and removed',
    ]);
  });

  test("a clean dry run yields no corrections", () => {
    const out = readFileSync(join(FIXTURES, "bin-fixed-npm-11.20.0.txt"), "utf8");
    expect(publishCorrections(out)).toEqual([]);
  });

  test("manifestChanges names every field npm changed, removed or added", () => {
    const before = { name: "x", bin: { x: "./a.ts" }, files: ["src"], gone: 1 };
    const after = { name: "x", bin: { x: "a.ts" }, files: ["src"], added: true };
    expect(manifestChanges(before, after)).toEqual(["added", "bin", "gone"]);
    expect(manifestChanges(before, structuredClone(before))).toEqual([]);
  });

  test("the sanity check passes on this repository and speaks JSON Lines", () => {
    const r = Bun.spawnSync([process.execPath, join(ROOT, "scripts/manifest-check.ts")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const lines = [r.stdout.toString(), r.stderr.toString()].join("\n").split("\n").filter((l) => l.trim());
    const parsed = lines.map((l) => JSON.parse(l) as { kind?: string; ok?: boolean });
    for (const p of parsed) expect(typeof p.kind).toBe("string");
    expect(parsed.at(-1)).toMatchObject({ kind: "manifest_check", ok: true });
    expect(r.exitCode).toBe(0);
  }, 60_000);
});
