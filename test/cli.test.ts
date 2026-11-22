// The CLI against this repository itself: every stream of a real run validates line by line.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMAS } from "@flyingrobots/parley-emit";

const ROOT = resolve(import.meta.dir, "..");
/**
 * Every test here spawns the CLI, and one run costs seconds: Bun's default five-second timeout is
 * shorter than three of them on a loaded machine. This raises the clock, never an assertion.
 */
const CLI_TIMEOUT = 60_000;
const COMPOSITION = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.composition.schema.json"), "utf8")) as Record<string, unknown>;
const LANDING = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.landing.schema.json"), "utf8")) as Record<string, unknown>;
const BLAST_RADIUS = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.blast_radius.schema.json"), "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const byPair = new Map<string, ReturnType<typeof ajv.compile>>();
for (const s of SCHEMAS) byPair.set(`${s.id}@${s.version}`, ajv.compile(s.schema));
byPair.set("footprint.composition@1.0.0", ajv.compile(COMPOSITION));
byPair.set("footprint.landing@1.0.0", ajv.compile(LANDING));
byPair.set("footprint.blast_radius@1.0.0", ajv.compile(BLAST_RADIUS));

type Line = Record<string, unknown> & { _schema: { id: string; version: string } };

function validateAll(text: string, stream: string): Line[] {
  const lines = text.split("\n").filter((l) => l !== "");
  expect(text === "" || text.endsWith("\n")).toBe(true);
  return lines.map((raw, i) => {
    const obj = JSON.parse(raw) as Line;
    const key = `${obj._schema.id}@${obj._schema.version}`;
    const v = byPair.get(key);
    if (!v) throw new Error(`${stream}:${i + 1} no schema for ${key}`);
    if (!v(obj)) throw new Error(`${stream}:${i + 1} ${key}: ${ajv.errorsText(v.errors)}`);
    return obj;
  });
}

async function cli(args: string[]) {
  const env = { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) };
  const proc = Bun.spawn(["bun", join(ROOT, "src/cli.ts"), ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, status };
}

function receiptOf(stdoutLines: Line[]): Line[] {
  const boot = stdoutLines[0] as { paths?: { receipt?: string } };
  const path = boot.paths?.receipt;
  expect(path).toMatch(/^\//);
  expect(existsSync(path!)).toBe(true);
  return validateAll(readFileSync(path!, "utf8"), "receipt");
}

describe("the CLI speaks the Parley output protocol", () => {
  test("a real range validates line by line and closes with end", async () => {
    const r = await cli(["HEAD~1..HEAD"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    validateAll(r.stderr, "stderr");
    expect(out[0]).toMatchObject({ event: "run", seq: 0, tool: "footprint" });
    expect(out.at(-1)).toMatchObject({ event: "end", status: 0 });
    const result = out.find((o) => o.event === "result") as Line & { composition: { files: number; byCategory: { added: number; removed: number }[]; added: number; removed: number }; structural: { available: boolean }; digest: string };
    expect(result._schema).toEqual({ id: "footprint.composition", version: "1.0.0" });
    expect(result.composition.byCategory.reduce((n, c) => n + c.added + c.removed, 0)).toBe(result.composition.added + result.composition.removed);
    expect(typeof result.structural.available).toBe("boolean");
    const receipt = receiptOf(out);
    expect(receipt[0]!.event).toBe("receipt.head");
    expect(receipt.at(-1)).toMatchObject({ event: "end", status: 0 });
    expect(receipt.some((o) => o.event === "receipt.step" && /compare/.test(String(o.decision)))).toBe(true);
    expect(receipt.some((o) => o.event === "result" && Array.isArray(o.files))).toBe(true);
  }, CLI_TIMEOUT);

  test("the blast-radius result follows the composition result in the same run", async () => {
    const r = await cli(["HEAD~1..HEAD"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    validateAll(r.stderr, "stderr");
    const results = out.filter((o) => o.event === "result");
    expect(results.map((o) => o._schema.id)).toEqual(["footprint.composition", "footprint.blast_radius"]);
    const blast = results[1] as Line & { range: string; digest: string; exports: Record<string, unknown> };
    expect(blast._schema).toEqual({ id: "footprint.blast_radius", version: "1.0.0" });
    expect(blast.range).toBe("HEAD~1..HEAD");
    expect(blast.digest).toMatch(/^[0-9a-f]{64}$/);
    const ex = blast.exports as { available: boolean; reason?: { code: string; detail: string }; added?: unknown[]; removed?: unknown[]; signature_changed?: unknown[]; counts?: Record<string, number>; contract?: unknown };
    if (ex.available) {
      expect(ex.contract).toEqual({ id: "graft.cli.struct_exports", version: "1.0.0" });
      expect(ex.counts).toEqual({ added: ex.added!.length, removed: ex.removed!.length, signature_changed: ex.signature_changed!.length });
    } else {
      // graft is optional: an unavailable section is stated, never omitted.
      expect(typeof ex.reason!.code).toBe("string");
      expect(ex.reason!.detail.length).toBeGreaterThan(0);
    }
    const receipt = receiptOf(out);
    expect(receipt.filter((o) => o.event === "result").map((o) => o._schema.id)).toEqual(["footprint.composition", "footprint.blast_radius"]);
    const human = await cli(["HEAD~1..HEAD", "--human"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("## Blast radius");
    expect(human.stdout).toContain("## Footprint");
  });

  test("the head carries the resolved range with both commit ids, and inv moves with them", async () => {
    const a = await cli(["HEAD~1..HEAD"]);
    const b = await cli(["HEAD~2..HEAD~1"]);
    const headOf = (r: { stdout: string }) => receiptOf(validateAll(r.stdout, "stdout"))[0] as Line & { resolved: Record<string, unknown>; inv?: string };
    const ha = headOf(a), hb = headOf(b);
    expect(ha.resolved.range).toBe("HEAD~1..HEAD");
    expect(ha.resolved.base_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(ha.resolved.head_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(ha.resolved.base_commit).not.toBe(ha.resolved.head_commit);
    expect(ha.inv).toMatch(/^[0-9a-f]{64}$/);
    expect(ha.inv).not.toBe(hb.inv);
    const again = headOf(await cli(["HEAD~1..HEAD"]));
    expect(again.inv).toBe(ha.inv);
  }, CLI_TIMEOUT);

  test("a range with no changes is a result with zero files, not prose", async () => {
    const r = await cli(["HEAD..HEAD"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    const result = out.find((o) => o.event === "result") as Line & { composition: { files: number }; gut_check: { flags: string[] } };
    expect(result.composition.files).toBe(0);
    expect(result.gut_check.flags).toEqual([]);
  }, CLI_TIMEOUT);

  test("a base that does not exist is a structured error and exit 2", async () => {
    const r = await cli(["no-such-ref-9f8e7d..HEAD"]);
    expect(r.status).toBe(2);
    const err = validateAll(r.stderr, "stderr").find((o) => o.event === "error") as Line & { code: string };
    expect(err.code).toBe("git.diff_failed");
    const out = validateAll(r.stdout, "stdout");
    expect(out.at(-1)).toMatchObject({ event: "end", status: 2 });
    expect(out.some((o) => o.event === "result")).toBe(false);
  }, CLI_TIMEOUT);

  test("--human prints the Markdown comment", async () => {
    const r = await cli(["HEAD~1..HEAD", "--human"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## Footprint");
    expect(r.stdout).toContain("Figures computed from `git diff --numstat`");
  }, CLI_TIMEOUT);


  test("the landing result follows the composition result in the same run", async () => {
    const r = await cli(["HEAD~1..HEAD"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    const results = out.filter((o) => o.event === "result");
    expect(results.map((o) => `${o._schema.id}@${o._schema.version}`)).toEqual(["footprint.composition@1.0.0", "footprint.landing@1.0.0"]);
    const landing = results[1] as Line & {
      before_merge: { unguarded: boolean; guards: unknown[]; unguarded_because: string; items: unknown[] };
      after_merge: { read: { file: string; present: boolean }[]; steps: unknown[]; declared: boolean; nothing_to_do: boolean; statement: string };
      digest: string;
    };
    expect(typeof landing.before_merge.unguarded).toBe("boolean");
    expect(landing.before_merge.unguarded_because.length).toBeGreaterThan(0);
    expect(landing.after_merge.read.map((d) => d.file)).toEqual(["RELEASE.md", "AGENTS.md"]);
    expect(landing.after_merge.statement.length).toBeGreaterThan(0);
    expect(landing.digest).toMatch(/^[0-9a-f]{64}$/);
    const receipt = receiptOf(out);
    expect(receipt.filter((o) => o.event === "result").length).toBe(2);
  }, CLI_TIMEOUT);

  test("--human prints Before merge and After merge after the composition comment", async () => {
    const r = await cli(["HEAD~1..HEAD", "--human"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## Footprint");
    expect(r.stdout).toContain("## Before merge");
    expect(r.stdout).toContain("## After merge");
    expect(r.stdout.indexOf("## Footprint")).toBeLessThan(r.stdout.indexOf("## Before merge"));
    expect(r.stdout.indexOf("## Before merge")).toBeLessThan(r.stdout.indexOf("## After merge"));
  }, CLI_TIMEOUT);

  test("--help and --schema are runs that describe the tool", async () => {
    const help = await cli(["--help"]);
    expect(help.status).toBe(0);
    const h = validateAll(help.stdout, "stdout");
    expect(h[0]!.event).toBe("run"); expect(h.at(-1)!.event).toBe("end");
    expect(h.filter((o) => o.event === "command").map((o) => o.name)).toEqual(["footprint"]);
    expect(h.filter((o) => o.event === "schema").map((o) => `${o.id}@${o.version}`)).toEqual(["footprint.composition@1.0.0", "footprint.landing@1.0.0", "footprint.blast_radius@1.0.0", "parley.error@2.0.0"]);
    const schema = await cli(["--schema"]);
    const s = validateAll(schema.stdout, "stdout");
    expect(s.filter((o) => o.event === "schema").length).toBeGreaterThan(2);
    receiptOf(s);
  }, CLI_TIMEOUT);
});
