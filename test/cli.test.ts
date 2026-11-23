// The CLI against this repository itself: every stream of a real run validates line by line.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMAS } from "@flyingrobots/parley-emit";

const ROOT = resolve(import.meta.dir, "..");
/**
 * Every test here spawns the CLI, and one run costs seconds: Bun's default five-second timeout is
 * shorter than three of them on a loaded machine. This raises the clock, never an assertion.
 */
const CLI_TIMEOUT = 60_000;
/**
 * The clock for a test that spawns the CLI more than once: one CLI_TIMEOUT per run. A single run
 * with graft answering is ~10s on an idle machine and several times that under load, so a fixed
 * 60s for three runs timed out at load average 17 while passing in 27s alone.
 */
const runs = (n: number) => n * CLI_TIMEOUT;
const COMPOSITION = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.composition.schema.json"), "utf8")) as Record<string, unknown>;
const LANDING = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.landing.schema.json"), "utf8")) as Record<string, unknown>;
const BLAST_RADIUS = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.blast_radius.schema.json"), "utf8")) as Record<string, unknown>;
const OVERLAP = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const byPair = new Map<string, ReturnType<typeof ajv.compile>>();
for (const s of SCHEMAS) byPair.set(`${s.id}@${s.version}`, ajv.compile(s.schema));
byPair.set("footprint.composition@1.0.0", ajv.compile(COMPOSITION));
byPair.set("footprint.landing@1.0.0", ajv.compile(LANDING));
byPair.set("footprint.blast_radius@1.1.0", ajv.compile(BLAST_RADIUS));
byPair.set("footprint.overlap@2.0.0", ajv.compile(OVERLAP));

// No test here depends on the network or on this repository having open pull requests: every run
// below gets a PATH holding nothing but the `git` the CLI needs, so `gh` is absent and the overlap
// result states its limitation. The computation itself is covered in `test/overlap.test.ts`.
//
// `node` is on that PATH as well as `git`, and deliberately: graft's own bin is a
// `#!/usr/bin/env node` script, so without it every graft subcommand fails to execute and the
// blast-radius assertions quietly take their "graft unavailable" branch -- a suite that passes
// while testing nothing. `gh` is the only thing kept out.
const BIN = mkdtempSync(join(tmpdir(), "footprint-bin-"));
for (const exe of ["git", "node"]) {
  const found = Bun.which(exe);
  if (found !== null) symlinkSync(found, join(BIN, exe));
}

type Line = Record<string, unknown> & { _schema: { id: string; version: string } };

// A real run spawns graft twice (struct review and struct exports), each of which parses the
// repository; the default 5s is not enough for that on a cold cache.

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
  const env = { ...process.env, PATH: BIN, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) };
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, status };
}

function receiptPathOf(stdoutLines: Line[]): string {
  const boot = stdoutLines[0] as { paths?: { receipt?: string } };
  const path = boot.paths?.receipt;
  expect(path).toMatch(/^\//);
  expect(existsSync(path!)).toBe(true);
  return path!;
}

function receiptOf(stdoutLines: Line[]): Line[] {
  return validateAll(readFileSync(receiptPathOf(stdoutLines), "utf8"), "receipt");
}

/**
 * The results the receipt *bundle* carries, inline or in a sidecar. parley-emit writes a receipt
 * record over 64 KiB beside the receipt as its own file, leaving a `parley.sidecar` line naming it
 * with its sha256 — and the blast radius crosses that whenever the compared range moves many
 * symbols, because the call-site lists are complete by design (the Markdown is what abridges).
 * Resolving them here keeps "every result reaches the receipt" an assertion about the bundle
 * rather than about one file, and checks the sidecar's own digest on the way past.
 */
function resultsInBundle(receipt: Line[], receiptPath: string): Line[] {
  const dir = dirname(receiptPath);
  const out: Line[] = [];
  for (const line of receipt) {
    if (line.event === "result") { out.push(line); continue; }
    if (line.event !== "sidecar") continue;
    const sidecar = join(dir, String((line as unknown as { path: string }).path));
    expect(existsSync(sidecar)).toBe(true);
    const text = readFileSync(sidecar, "utf8");
    expect(createHash("sha256").update(text).digest("hex")).toBe((line as unknown as { sha256: string }).sha256);
    const [record] = validateAll(text.endsWith("\n") ? text : `${text}\n`, "sidecar");
    if (record!.event === "result") out.push(record!);
  }
  return out;
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
    expect(results.map((o) => o._schema.id)).toEqual(["footprint.composition", "footprint.landing", "footprint.blast_radius", "footprint.overlap"]);
    const blast = results[2] as Line & { range: string; digest: string; exports: Record<string, unknown>; unanalysed_languages: Array<{ extension: string; count: number }> };
    expect(blast._schema).toEqual({ id: "footprint.blast_radius", version: "1.1.0" });
    expect(blast.range).toBe("HEAD~1..HEAD");
    expect(blast.digest).toMatch(/^[0-9a-f]{64}$/);
    const ex = blast.exports as { available: boolean; reason?: { code: string; detail: string }; added?: unknown[]; removed?: unknown[]; signature_changed?: unknown[]; counts?: Record<string, number>; contract?: unknown };
    if (ex.available) {
      expect(ex.contract).toEqual({ id: "graft.cli.struct_exports", version: "1.0.0" });
      expect(ex.counts).toMatchObject({ added: ex.added!.length, removed: ex.removed!.length, signature_changed: ex.signature_changed!.length });
    } else {
      // graft is optional: an unavailable section is stated, never omitted.
      expect(typeof ex.reason!.code).toBe("string");
      expect(ex.reason!.detail.length).toBeGreaterThan(0);
    }
    // footprint's own changed files, over this range, are TypeScript: a supported language.
    expect(blast.unanalysed_languages).toEqual([]);
    const receipt = receiptOf(out);
    expect(resultsInBundle(receipt, receiptPathOf(out)).map((o) => o._schema.id)).toEqual(["footprint.composition", "footprint.landing", "footprint.blast_radius", "footprint.overlap"]);
    const human = await cli(["HEAD~1..HEAD", "--human"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("## Blast radius");
    expect(human.stdout).toContain("## Footprint");
  }, CLI_TIMEOUT);

  /**
   * 543477a is the commit where this repository's exported `render` gained an optional parameter:
   * a range whose export surface is genuinely non-empty, so the live run exercises the scan rather
   * than the zero-symbol short circuit. The call sites are of the working tree as checked out.
   */
  test("the blast-radius result carries the call sites of every symbol it lists", async () => {
    const r = await cli(["543477a~1..543477a"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    const blast = out.filter((o) => o.event === "result")[2] as Line & { exports: Record<string, unknown> };
    const ex = blast.exports as {
      available: boolean;
      added?: Array<Record<string, unknown>>;
      removed?: Array<Record<string, unknown>>;
      signature_changed?: Array<Record<string, unknown>>;
      counts?: Record<string, number>;
      call_site_scan?: { available: boolean; method: string; files_scanned?: number; files_skipped?: Record<string, number>; reason?: { code: string; detail: string } };
    };
    if (!ex.available) {
      // graft is optional; with no surface there is nothing to look up and no scan is claimed.
      expect(ex.call_site_scan).toBeUndefined();
      return;
    }
    const scan = ex.call_site_scan!;
    expect(scan.method).toBe("identifier_scan");
    expect(scan.available).toBe(true);
    const symbols = [...ex.added!, ...ex.removed!, ...ex.signature_changed!];
    // No symbol moved means nothing to look up, and the scan says it read no file rather than
    // claiming it scanned the tree for nobody.
    expect(scan.files_scanned).toBeGreaterThan(symbols.length === 0 ? -1 : 10);
    if (symbols.length === 0) expect(scan.files_scanned).toBe(0);
    let total = 0;
    for (const s of symbols) {
      const sites = s.call_sites as Array<{ file: string; line: number }> | undefined;
      expect(Array.isArray(sites)).toBe(true);
      for (const site of sites!) {
        expect(typeof site.file).toBe("string");
        expect(Number.isInteger(site.line) && site.line > 0).toBe(true);
      }
      total += sites!.length;
    }
    expect(ex.counts!.call_sites).toBe(total);
    const receipt = receiptOf(out);
    expect(receipt.some((o) => o.event === "receipt.step" && /call site/i.test(String(o.decision)))).toBe(true);
  }, CLI_TIMEOUT);

  /**
   * The Definition of Done of flyingrobots/footprint#11: the same range, grouped. The grouping is
   * a pure function of the surface and the scan, so what this adds over the cases in
   * `test/systems.test.ts` is that a real run emits it and a real `--human` renders it.
   */
  test("the blast-radius result groups the call sites by system, one --human table each", async () => {
    const r = await cli(["543477a~1..543477a"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    const blast = out.filter((o) => o.event === "result")[2] as Line & { exports: Record<string, unknown> };
    const ex = blast.exports as {
      available: boolean;
      added?: Array<Record<string, unknown>>;
      removed?: Array<Record<string, unknown>>;
      signature_changed?: Array<Record<string, unknown>>;
      counts?: Record<string, number>;
      call_site_systems?: { rule: string; rule_detail: string; mitigation_rule: string; unassigned: string; systems: Array<{ system: string; call_sites: number }> };
    };
    if (!ex.available) {
      // graft is optional; with no surface there is nothing to group and no grouping is claimed.
      expect(ex.call_site_systems).toBeUndefined();
      return;
    }
    const grouping = ex.call_site_systems!;
    expect(grouping.rule).toBe("path_prefix");
    expect(grouping.unassigned).toBe("(unassigned)");
    expect(grouping.systems.length).toBeGreaterThan(1);
    // The per-system counts account for every call site: none grouped twice, none lost.
    expect(grouping.systems.reduce((n, g) => n + g.call_sites, 0)).toBe(ex.counts!.call_sites);
    for (const s of [...ex.added!, ...ex.removed!, ...ex.signature_changed!]) {
      for (const site of s.call_sites as Array<Record<string, unknown>>) {
        expect(grouping.systems.some((g) => g.system === site.system)).toBe(true);
        expect(String(site.mitigation).length).toBeGreaterThan(0);
      }
    }

    const human = await cli(["543477a~1..543477a", "--human"]);
    expect(human.status).toBe(0);
    for (const g of grouping.systems) expect(human.stdout).toContain(`**\`${g.system}\`**`);
    expect(human.stdout).toContain("| Symbol | Call site | Mitigation |");
  }, runs(2));

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
  }, runs(3));

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
    expect(results.map((o) => `${o._schema.id}@${o._schema.version}`)).toEqual(["footprint.composition@1.0.0", "footprint.landing@1.0.0", "footprint.blast_radius@1.1.0", "footprint.overlap@2.0.0"]);
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
    expect(resultsInBundle(receipt, receiptPathOf(out)).length).toBe(4);
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
    expect(h.filter((o) => o.event === "schema").map((o) => `${o.id}@${o.version}`)).toEqual(["footprint.composition@1.0.0", "footprint.landing@1.0.0", "footprint.blast_radius@1.1.0", "footprint.overlap@2.0.0", "parley.error@2.0.0"]);
    const schema = await cli(["--schema"]);
    const s = validateAll(schema.stdout, "stdout");
    expect(s.filter((o) => o.event === "schema").length).toBeGreaterThan(2);
    receiptOf(s);
  }, CLI_TIMEOUT);

  test("overlap is the fourth result, after the blast radius, and states its limitation when gh is unavailable", async () => {
    const r = await cli(["HEAD~1..HEAD"]);
    expect(r.status).toBe(0);
    const out = validateAll(r.stdout, "stdout");
    expect(out.filter((o) => o.event === "result").map((o) => o._schema.id)).toEqual(["footprint.composition", "footprint.landing", "footprint.blast_radius", "footprint.overlap"]);
    const overlap = out.filter((o) => o.event === "result")[3] as Line & { overlap: { available: boolean; code: string; reason: string; summary: string }; digest: string };
    expect(overlap._schema).toEqual({ id: "footprint.overlap", version: "2.0.0" });
    expect(overlap.overlap.available).toBe(false);
    expect(overlap.overlap.code).toBe("gh.not_found");
    expect(overlap.overlap.reason).toContain("gh");
    expect(overlap.overlap.summary).toContain("unavailable");
    expect(overlap.digest).toMatch(/^[0-9a-f]{64}$/);
    const receipt = receiptOf(out);
    expect(receipt.some((o) => o.event === "result" && o._schema.id === "footprint.overlap")).toBe(true);
    expect(receipt.some((o) => o.event === "receipt.step" && /overlap/.test(String(o.decision)))).toBe(true);
  }, CLI_TIMEOUT);

  test("--human carries the overlap section, including the stated limitation", async () => {
    const r = await cli(["HEAD~1..HEAD", "--human"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("### Open pull requests");
    expect(r.stdout).toContain("Cross-pull-request overlap unavailable");
  }, CLI_TIMEOUT);
});
