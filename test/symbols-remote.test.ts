// Symbol-level overlap for pull requests whose commits are not in the local clone
// (flyingrobots/footprint#55, OUT-23). The fallback reads each side over read-only `gh api` calls
// pinned to exact commit ids; these cases run it against a stand-in `gh` that serves the compare
// and contents answers a real repository would, built from real git objects in a fixture
// repository whose pull-request heads are then made absent, as a fork's are in CI. The outliner is
// the stand-in one (each `export function NAME` through the next `}`), so they hold without graft.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { computeOverlap, type PullRequest } from "../src/overlap.ts";
import { analyseSymbols, type Outliner, type Span } from "../src/symbols.ts";
import { ghRemote, parseCompare } from "../src/remote.ts";

const ROOT = resolve(import.meta.dir, "..");
const SCRATCH = mkdtempSync(join(tmpdir(), "footprint-remote-"));
function scratch(prefix: string): string {
  return mkdtempSync(join(SCRATCH, prefix));
}
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

const LIB = ["// header", "export function alpha(): number {", "  return 1;", "}", "", "export function beta(): number {", "  return 2;", "}", ""].join("\n");
const alphaBody = (s: string) => s.replace("return 1;", "return 10;");
const alphaBodyAgain = (s: string) => s.replace("return 1;", "return 11;");
const betaBody = (s: string) => s.replace("return 2;", "return 20;");

function spansOf(content: string): Span[] {
  const lines = content.split("\n");
  const spans: Span[] = [];
  lines.forEach((l, i) => {
    const m = /^export function (\w+)/.exec(l);
    if (m === null) return;
    let end = i;
    while (end < lines.length - 1 && !lines[end]!.startsWith("}")) end += 1;
    spans.push({ symbol: m[1]!, start: i + 1, end: end + 1 });
  });
  return spans;
}
const standIn: Outliner = async (content) => spansOf(content);

type Answers = Record<string, { out?: string; err?: string; code?: number; sleep?: number }>;

/**
 * A stand-in `gh` (a Node script): `api` answers from the table keyed by its path argument, and
 * every call's arguments are appended to calls.log. With `lists`, it also serves `pr list` and
 * `pr diff --name-only`. A path with no answer is a 404, as a commit GitHub does not have is.
 */
function fakeGh(answers: Answers, lists?: { rows: object[]; files: Record<number, string[]> }): { gh: string; calls: () => string[][] } {
  const dir = scratch("gh-");
  writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
  writeFileSync(join(dir, "lists.json"), JSON.stringify(lists ?? null));
  const gh = join(dir, "gh");
  writeFileSync(gh, [
    `#!${process.execPath}`,
    'import { appendFileSync, readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    `const D = ${JSON.stringify(dir)};`,
    "const a = process.argv.slice(2);",
    'appendFileSync(join(D, "calls.log"), JSON.stringify(a) + "\\n");',
    'const lists = JSON.parse(readFileSync(join(D, "lists.json"), "utf8"));',
    'if (a[0] === "pr" && a[1] === "list" && lists) { console.log(JSON.stringify(lists.rows)); process.exit(0); }',
    'if (a[0] === "pr" && a[1] === "diff" && lists) { console.log((lists.files[a[2]] ?? []).join("\\n")); process.exit(0); }',
    'if (a[0] === "api") {',
    "  const hit = JSON.parse(readFileSync(join(D, \"answers.json\"), \"utf8\"))[a[a.length - 1]];",
    '  if (!hit) { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }',
    "  if (hit.sleep) await new Promise((r) => setTimeout(r, hit.sleep));",
    "  if (hit.err) process.stderr.write(hit.err + \"\\n\");",
    "  if (hit.out !== undefined) await new Promise((r) => process.stdout.write(hit.out, r));",
    "  process.exit(hit.code ?? 0);",
    "}",
    'process.stderr.write("unexpected gh " + a.join(" ") + "\\n");',
    "process.exit(1);",
  ].join("\n"));
  chmodSync(gh, 0o755);
  return { gh, calls: () => { try { return readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as string[]); } catch { return []; } } };
}

const RAW = ["-H", "Accept: application/vnd.github.raw"];
const comparePath = (base: string, head: string) => `repos/{owner}/{repo}/compare/${base}...${head}`;
const contentsPath = (sha: string, path: string) => `repos/{owner}/{repo}/contents/${path}?ref=${sha}`;

interface World { dir: string; main: string; heads: Record<string, string>; answers: Answers }

/**
 * `main` holds lib.ts; each branch edits it. The answers GitHub would give for every branch are
 * built from the real objects, then the branches and their objects are removed so the heads are
 * not in the clone. `main` stays.
 */
async function world(edits: Record<string, (s: string) => string>, opts: { baseSha?: (main: string) => string } = {}): Promise<World> {
  const dir = scratch("repo-");
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "lib.ts"), LIB);
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "base");
  const main = await git(dir, "rev-parse", "HEAD");
  const heads: Record<string, string> = {};
  const answers: Answers = {};
  for (const [name, edit] of Object.entries(edits)) {
    await git(dir, "checkout", "-q", "-b", name, "main");
    writeFileSync(join(dir, "lib.ts"), edit(LIB));
    await git(dir, "commit", "-q", "-am", name);
    heads[name] = await git(dir, "rev-parse", "HEAD");
    const diff = await git(dir, "diff", "--no-color", "--no-renames", main, heads[name]!, "--", "lib.ts");
    const patch = diff.slice(diff.indexOf("@@"));
    const base = opts.baseSha?.(main) ?? main;
    answers[comparePath(base, heads[name]!)] = { out: JSON.stringify({ status: "ahead", merge_base_commit: { sha: main }, files: [{ filename: "lib.ts", status: "modified", patch }] }) };
    answers[contentsPath(heads[name]!, "lib.ts")] = { out: edit(LIB) };
  }
  answers[contentsPath(main, "lib.ts")] = { out: LIB };
  await git(dir, "checkout", "-q", "main");
  for (const name of Object.keys(edits)) await git(dir, "branch", "-q", "-D", name);
  await git(dir, "reflog", "expire", "--expire=now", "--all");
  await git(dir, "gc", "-q", "--prune=now");
  return { dir, main, heads, answers };
}

function pr(number: number, head: string, base: string | undefined, extra: Partial<PullRequest> = {}): PullRequest {
  return { number, title: `pull request ${number}`, isDraft: false, files: ["lib.ts"], headCommit: head, baseBranch: "main", ...(base === undefined ? {} : { baseCommit: base }), ...extra } as PullRequest;
}

async function run(w: World, prs: PullRequest[], ghPath: string, opts: { budget?: number; timeoutMs?: number; remote?: boolean } = {}) {
  const fileLevel = computeOverlap([], prs);
  const remote = opts.remote === false ? null : ghRemote(ghPath, w.dir, { ...(opts.budget === undefined ? {} : { budget: opts.budget }), ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) });
  const symbols = await analyseSymbols({ repo: w.dir, prs, conflicts: fileLevel.conflicts, overlapping: [], range: null, outliner: standIn, remote });
  return { overlap: computeOverlap([], prs, { symbols }), symbols };
}

const file0 = (r: Awaited<ReturnType<typeof run>>) => r.overlap.conflicts[0]!.symbolLevel.files[0]!;

/**
 * The clock for a test that runs the analysis more than once (flyingrobots/footprint#90): one
 * RUN_TIMEOUT per run. Each run builds a git world and spawns a fake gh, about a second idle and
 * several under load; Bun's fixed 5 s default timed out a four-run test at load average 6. This
 * raises the clock, never an assertion, as test/cli.test.ts does.
 */
const RUN_TIMEOUT = 15_000;
const runs = (n: number) => n * RUN_TIMEOUT;

describe("symbol level through the GitHub API (flyingrobots/footprint#55)", () => {
  test("golden: two heads absent from the clone are classified disjoint, reading compare and contents by exact commit id", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const g = fakeGh(w.answers);
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(r)).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 }, github: ["a", "b"] });
    expect(r.overlap.conflicts[0]!.symbolLevel.level).toBe("symbol-disjoint");
    expect(r.symbols.analysis).toMatchObject({ remoteCalls: 5, remoteBudget: 32 });
    // Read-only, and nothing but the repository's own identifiers: every call is a GET of a
    // compare or contents path made of full commit ids and the file's own path.
    const calls = g.calls();
    expect(calls.length).toBe(5);
    for (const c of calls) {
      expect(c[0]).toBe("api");
      const path = c[c.length - 1]!;
      expect(path).toMatch(/^repos\/\{owner\}\/\{repo\}\/(compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}|contents\/lib\.ts\?ref=[0-9a-f]{40})$/);
      expect(c.slice(1, -1)).toEqual(path.includes("/contents/") ? RAW : []);
    }
  });

  test("the same function changed by both is symbol-overlapping, and a local side is read locally", async () => {
    const w = await world({ a: alphaBody, b: alphaBodyAgain });
    const g = fakeGh(w.answers);
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(r)).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"], github: ["a", "b"] });
  });

  test("the merge base is the compare's, not baseRefOid: the base content is read at it", async () => {
    const moved = "1111111111111111111111111111111111111111";
    const w = await world({ a: alphaBody, b: betaBody }, { baseSha: () => moved });
    const g = fakeGh(w.answers);
    const r = await run(w, [pr(1, w.heads.a!, moved), pr(2, w.heads.b!, moved)], g.gh);
    expect(file0(r)).toMatchObject({ level: "symbol-disjoint" });
    // lib.ts at the merge base is read once and cached across both pull requests.
    expect(g.calls().filter((c) => c[c.length - 1] === contentsPath(w.main, "lib.ts"))).toHaveLength(1);
    expect(g.calls().some((c) => c[c.length - 1]!.includes(`ref=${moved}`))).toBe(false);
  });

  test("a base commit missing locally is read over the API too, while the head is local", async () => {
    const w = await world({ a: alphaBody });
    // Rebuild the head locally: it is the same commit id only if the objects are restored, so use a fresh branch instead.
    await git(w.dir, "checkout", "-q", "-b", "local", "main");
    writeFileSync(join(w.dir, "lib.ts"), betaBody(LIB));
    await git(w.dir, "commit", "-q", "-am", "local");
    const head = await git(w.dir, "rev-parse", "HEAD");
    const patch = (await git(w.dir, "diff", "--no-color", "main", head, "--", "lib.ts")).split("\n").slice(4).join("\n");
    const absent = "2222222222222222222222222222222222222222";
    const answers: Answers = { ...w.answers, [comparePath(absent, head)]: { out: JSON.stringify({ merge_base_commit: { sha: w.main }, files: [{ filename: "lib.ts", status: "modified", patch }] }) }, [contentsPath(head, "lib.ts")]: { out: betaBody(LIB) } };
    const g = fakeGh(answers);
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, head, absent)], g.gh);
    expect(file0(r)).toMatchObject({ level: "symbol-disjoint", a: { symbols: ["alpha"] }, b: { symbols: ["beta"] }, github: ["a", "b"] });
  });

  test("without a remote, or when the API cannot read it, the file stays undetermined with the reason", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const none = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], "unused", { remote: false });
    expect(file0(none)).toMatchObject({ level: "undetermined", code: "git.head_missing" });
    const g = fakeGh({});
    const failed = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(failed)).toMatchObject({ level: "undetermined", code: "gh.remote_failed" });
    expect(file0(failed).reason).toContain("404");
    expect(file0(failed).reason).toContain("git fetch origin pull/1/head");
  }, runs(2));

  test("a rate limit is gh.rate_limited, and once hit no further call is made", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const limited: Answers = {};
    for (const k of Object.keys(w.answers)) limited[k] = { err: "gh: API rate limit exceeded for user ID 1. (HTTP 403)", code: 1 };
    const g = fakeGh(limited);
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(r)).toMatchObject({ level: "undetermined", code: "gh.rate_limited" });
    expect(g.calls().length).toBe(1);
  });

  test("a call that does not answer in time is gh.timeout, and is stopped", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const slow: Answers = {};
    for (const [k, v] of Object.entries(w.answers)) slow[k] = { ...v, sleep: 10_000 };
    const g = fakeGh(slow);
    const started = Date.now();
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh, { timeoutMs: 400 });
    expect(file0(r)).toMatchObject({ level: "undetermined", code: "gh.timeout" });
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test("past the remote call budget a file is undetermined, gh.budget_spent", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const g = fakeGh(w.answers);
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh, { budget: 1 });
    expect(file0(r)).toMatchObject({ level: "undetermined", code: "gh.budget_spent" });
    expect(g.calls().length).toBe(1);
    expect(r.symbols.analysis).toMatchObject({ remoteCalls: 1, remoteBudget: 1 });
  });

  test("a head that moved, or whose base is unknown, spends no API call", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const g = fakeGh(w.answers);
    const moved = await run(w, [pr(1, w.heads.a!, w.main, { headMoved: true }), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(moved)).toMatchObject({ level: "undetermined", code: "gh.head_moved" });
    const unknownBase = await run(w, [pr(1, w.heads.a!, undefined), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(unknownBase)).toMatchObject({ level: "undetermined", code: "git.head_missing" });
    expect(g.calls().length).toBe(0);
  }, runs(2));

  test("a merge base the compare does not state exactly leaves the file undetermined", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const key = comparePath(w.main, w.heads.a!);
    for (const bad of [{ files: [] }, { merge_base_commit: { sha: "main" }, files: [] }, { merge_base_commit: { sha: w.main.toUpperCase() }, files: [] }]) {
      const g = fakeGh({ ...w.answers, [key]: { out: JSON.stringify(bad) } });
      const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
      expect(file0(r)).toMatchObject({ level: "undetermined", code: "gh.compare_unpinned" });
    }
    const garbled = fakeGh({ ...w.answers, [key]: { out: "not json" } });
    expect(file0(await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], garbled.gh))).toMatchObject({ code: "gh.compare_unpinned" });
  }, runs(4));

  test("a file the compare lists without a patch, renamed, or not at all is undetermined, never an empty side", () => {
    const sha = "a".repeat(40);
    const body = (files: unknown[]) => JSON.stringify({ merge_base_commit: { sha }, files });
    const noPatch = parseCompare(body([{ filename: "x.ts", status: "modified" }]));
    const renamed = parseCompare(body([{ filename: "y.ts", previous_filename: "x.ts", status: "renamed", patch: "@@ -1 +1 @@\n-a\n+b" }]));
    const ok = parseCompare(body([{ filename: "z.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }]));
    if ("code" in noPatch || "code" in renamed || "code" in ok) throw new Error("compare should parse");
    expect(ok.mergeBase).toBe(sha);
    expect(noPatch.patches.get("x.ts")).toMatchObject({ code: "gh.patch_unavailable" });
    expect(renamed.patches.get("y.ts")).toMatchObject({ code: "gh.patch_unavailable" });
    expect(ok.patches.get("z.ts")).toBe("@@ -1 +1 @@\n-a\n+b");
    expect(ok.patches.has("x.ts")).toBe(false);
  });

  test("a shared file the compare did not list is gh.compare_incomplete", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    const key = comparePath(w.main, w.heads.a!);
    const g = fakeGh({ ...w.answers, [key]: { out: JSON.stringify({ merge_base_commit: { sha: w.main }, files: [{ filename: "other.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }] }) } });
    const r = await run(w, [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)], g.gh);
    expect(file0(r)).toMatchObject({ level: "undetermined", code: "gh.compare_incomplete" });
  });

  test("contents over 1 MiB are gh.content_too_large and are never outlined", async () => {
    const w = await world({ a: alphaBody, b: betaBody });
    let outlinedBig = 0;
    const counting: Outliner = async (c) => { if (c.length > 1024 * 1024) outlinedBig += 1; return spansOf(c); };
    const big = fakeGh({ ...w.answers, [contentsPath(w.heads.a!, "lib.ts")]: { out: `${alphaBody(LIB)}// ${"x".repeat(1024 * 1024)}\n` } });
    const prs = [pr(1, w.heads.a!, w.main), pr(2, w.heads.b!, w.main)];
    const fileLevel = computeOverlap([], prs);
    const symbols = await analyseSymbols({ repo: w.dir, prs, conflicts: fileLevel.conflicts, overlapping: [], range: null, outliner: counting, remote: ghRemote(big.gh, w.dir) });
    expect(computeOverlap([], prs, { symbols }).conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "gh.content_too_large" });
    expect(outlinedBig).toBe(0);
  });

  test("a path with URL-significant characters is encoded segment by segment", async () => {
    const w = await world({ a: alphaBody });
    const g = fakeGh({ [contentsPath("c".repeat(40), "src/a%20b/c#d?.ts")]: { out: "x" } });
    const remote = ghRemote(g.gh, w.dir);
    expect(await remote.content("c".repeat(40), "src/a b/c#d?.ts")).toMatchObject({ code: "gh.remote_failed" });
    expect(g.calls()[0]![g.calls()[0]!.length - 1]).toBe(`repos/{owner}/{repo}/contents/src/a%20b/c%23d%3F.ts?ref=${"c".repeat(40)}`);
  });
});

describe("symbol level through the GitHub API, end to end", () => {
  function fakeGraft(bin: string): string {
    const path = join(bin, "fake-graft");
    writeFileSync(path, [
      `#!${process.execPath}`,
      'import { readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const a = process.argv.slice(2);",
      'const cwd = a[a.indexOf("--cwd") + 1];',
      'const name = a[a.indexOf("outline") + 1];',
      'const lines = readFileSync(join(cwd, name), "utf8").split("\\n");',
      "const jumpTable = [];",
      "lines.forEach((l, i) => { const m = /^export function (\\w+)/.exec(l); if (!m) return; let e = i; while (e < lines.length - 1 && !lines[e].startsWith(\"}\")) e += 1; jumpTable.push({ symbol: m[1], kind: \"function\", start: i + 1, end: e + 1 }); });",
      'console.log(JSON.stringify({ _schema: { id: "graft.cli.read_outline", version: "3.0.0" }, path: name, outline: [], jumpTable }));',
    ].join("\n"));
    chmodSync(path, 0o755);
    return path;
  }

  test("a pull request whose head is not local gets a decided symbol level through the CLI, and the record validates", async () => {
    const w = await world({ b: betaBody });
    // `a` is the range's own head and is local.
    await git(w.dir, "checkout", "-q", "-b", "a", "main");
    writeFileSync(join(w.dir, "lib.ts"), alphaBody(LIB));
    await git(w.dir, "commit", "-q", "-am", "a");
    const headA = await git(w.dir, "rev-parse", "HEAD");
    const row = (n: number, head: string, branch: string) => ({ number: n, title: `${n}`, isDraft: false, headRefOid: head, headRefName: branch, isCrossRepository: n === 2, baseRefName: "main", baseRefOid: w.main });
    const g = fakeGh(w.answers, { rows: [row(1, headA, "a"), row(2, w.heads.b!, "b")], files: { 1: ["lib.ts"], 2: ["lib.ts"] } });
    const bin = scratch("bin-");
    for (const exe of ["git", "node"]) { const found = Bun.which(exe); if (found !== null) symlinkSync(found, join(bin, exe)); }
    symlinkSync(g.gh, join(bin, "gh"));
    const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "main...a"], { cwd: w.dir, env: { ...process.env, PATH: bin, FOOTPRINT_GRAFT: fakeGraft(bin), XDG_STATE_HOME: scratch("state-") }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(status).toBe(0);
    const lines = `${stdout}${stderr}`.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown> & { _schema: { id: string; version: string } });
    const result = lines.find((l) => l.event === "result" && l._schema.id === "footprint.overlap") as Record<string, unknown> & { _schema: { version: string }; overlap: ReturnType<typeof computeOverlap> };
    expect(result._schema.version).toBe("2.2.0");
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    expect(validate(result)).toBe(true);
    expect(result.overlap.overlapping[0]!.symbolLevel.files[0]).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 }, github: ["b"] });
    expect(result.overlap.symbolAnalysis.remoteCalls).toBe(3);
  }, 60_000);

  test("the schema accepts github and every code the remote reader can produce, and 2.2.0 is declared", () => {
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as { $defs: { fileLevel: { properties: { code: { enum: string[] }; github: unknown } } }; properties: { _schema: { properties: { version: { const: string } } } } };
    expect(schema.properties._schema.properties.version.const).toBe("2.2.0");
    expect(schema.$defs.fileLevel.properties.github).toBeDefined();
    const source = readFileSync(join(ROOT, "src/remote.ts"), "utf8");
    const produced = [...new Set([...source.matchAll(/"(gh\.[a-z_]+)"/g)].map((m) => m[1]!))].sort();
    expect(produced.length).toBeGreaterThanOrEqual(7);
    for (const code of produced) expect(schema.$defs.fileLevel.properties.code.enum).toContain(code);
  });
});
