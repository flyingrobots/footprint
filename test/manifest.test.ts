// The published manifest is the manifest in the repository (flyingrobots/footprint#35). npm
// normalizes package.json at publish time and silently drops what it considers invalid: at v0.3.0
// it removed `bin.footprint` ("./src/cli.ts"), so `bunx @flyingrobots/footprint` would have found
// no command. These cases hold the manifest to npm's own normalization, and hold the release
// workflow's sanity check to failing on any correction npm reports.
import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

  // The script end to end, as the sanity job runs it, on two throwaway packages that differ only in
  // the bin path's form. Not run on this repository itself: once a version is on npm, a publish dry
  // run of that same version fails by design ("cannot publish over the previously published
  // versions"), which would turn every later CI run red. The dry run asks the registry about a
  // package name nobody has published, so these cases need the network.
  const check = (bin: string) => {
    const dir = mkdtempSync(join(tmpdir(), "footprint-manifest-check-case-"));
    writeFileSync(join(dir, "a.ts"), "console.log(1);\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "footprint-manifest-check-fixture-unpublished", version: "0.0.0", bin: { x: bin }, files: ["a.ts"] }));
    const r = Bun.spawnSync([process.execPath, join(ROOT, "scripts/manifest-check.ts"), "--cwd", dir], { stdout: "pipe", stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    const lines = r.stdout.toString().split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { kind: string; ok?: boolean; field?: string });
    for (const l of lines) expect(typeof l.kind).toBe("string");
    return { code: r.exitCode, lines };
  };

  test("the sanity check fails on a manifest npm would correct, naming each correction", () => {
    const { code, lines } = check("./a.ts");
    expect(code).toBe(1);
    expect(lines.filter((l) => l.kind === "manifest_rewrite").map((l) => l.field)).toEqual(["bin"]);
    expect(lines.filter((l) => l.kind === "publish_correction")).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ kind: "manifest_check", ok: false });
  }, 60_000);

  test("the sanity check passes on a manifest npm leaves alone", () => {
    const { code, lines } = check("a.ts");
    expect(lines).toEqual([expect.objectContaining({ kind: "manifest_check", ok: true })]);
    expect(code).toBe(0);
  }, 60_000);
});

// flyingrobots/footprint#74: `footprint` collides with macOS's /usr/bin/footprint, so the package
// also ships `git-footprint`, which git runs as `git footprint`. Both names stay: existing
// `bunx @flyingrobots/footprint` calls resolve the one named after the package.
describe("the git-footprint binary (flyingrobots/footprint#74)", () => {
  test("package.json declares git-footprint beside footprint, both the CLI", () => {
    const bin = readJson(join(ROOT, "package.json")).bin as Record<string, string>;
    expect(bin["git-footprint"]).toBe(bin.footprint);
    expect(bin.footprint).toBe("src/cli.ts");
  });

  test("git runs it as `git footprint`", () => {
    // A PATH holding git, bun and a git-footprint link to the CLI, as an install leaves it; git
    // finds a `git-<name>` executable on PATH for `git <name>`.
    const dir = mkdtempSync(join(tmpdir(), "footprint-gitbin-"));
    for (const exe of ["git", "bun"]) symlinkSync(Bun.which(exe)!, join(dir, exe));
    const bin = readJson(join(ROOT, "package.json")).bin as Record<string, string>;
    // With no git-footprint entry the link points at nothing, and git reports no such command.
    symlinkSync(join(ROOT, bin["git-footprint"] ?? "no-git-footprint-in-package-json"), join(dir, "git-footprint"));
    const r = Bun.spawnSync(["git", "footprint", "--help"], { cwd: ROOT, env: { ...process.env, PATH: dir, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) }, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const first = JSON.parse(r.stdout.toString().split("\n")[0]!) as { _schema: { id: string } };
    expect(first._schema.id).toMatch(/^parley\./);
  });
});
