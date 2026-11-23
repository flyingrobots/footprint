// Symbol-level overlap between open pull requests (flyingrobots/footprint#33, OUT-22).
//
// The pure half (changed lines, attribution, classification, waves, rendering) is tested over
// fixed inputs. The impure half runs against throwaway git repositories under $TMPDIR and the
// installed graft, so the golden case is a real `graft read outline` answer rather than a mock:
// a fixture standing in for graft would pass while graft's jump table drifted underneath it.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { $ } from "bun";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { computeOverlap, type PullRequest } from "../src/overlap.ts";
import { analyseSymbols, attribute, changedLines, classifyFile, graftOutliner, parseOutline, type Outliner, type SideResult, type Span } from "../src/symbols.ts";
import { isFailure, listOpenPullRequests } from "../src/pulls.ts";
import { resolveGraft } from "../src/graft.ts";
import { renderOverlap } from "../src/render.ts";
import { OVERLAP_BUDGET } from "../src/bound.ts";

const ROOT = resolve(import.meta.dir, "..");
/** Each outline is a graft process; several of them on a loaded machine take longer than 5s. */
const GRAFT_TIMEOUT = 120_000;
/**
 * graft is an optional dependency, so the cases that need a real `graft read outline` answer run
 * only when graft resolves, or when `FOOTPRINT_REQUIRE_GRAFT=1` asks for them regardless, as CI
 * does: there a missing graft fails them loudly, as test/require-graft.test.ts does, rather than
 * skipping (flyingrobots/footprint#56). A graft-free local run skips them by name and still runs
 * every case below that uses the stand-in outliner.
 */
const GRAFT = await resolveGraft();
const withGraft = GRAFT !== null || process.env.FOOTPRINT_REQUIRE_GRAFT === "1" ? test : test.skip;

/**
 * Every directory this file makes is under one root that the suite removes when it ends, so
 * repeated runs leave no fixture repositories, stand-in executables or CLI state behind
 * (flyingrobots/footprint#56). Outliners are disposed where they are made.
 */
const SCRATCH = mkdtempSync(join(tmpdir(), "footprint-sym-"));
function scratch(prefix: string): string {
  return mkdtempSync(join(SCRATCH, prefix));
}
afterAll(() => {
  // A case may leave a directory read-only on purpose; make it writable again first.
  Bun.spawnSync(["chmod", "-R", "u+rwx", SCRATCH]);
  rmSync(SCRATCH, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

const LIB = [
  "// header comment",
  "export function alpha(): number {",
  "  return 1;",
  "}",
  "",
  "export function beta(): number {",
  "  return 2;",
  "}",
  "",
  "// a comment between",
  "export function delta(): number {",
  "  return 4;",
  "}",
  "",
].join("\n");

type Edit = (lib: string) => string;

/** `main` holds lib.ts and README.md; each branch applies its edit to lib.ts (and README.md when asked). */
async function fixture(branches: Record<string, { lib?: Edit; readme?: boolean }>): Promise<{ dir: string; heads: Record<string, string>; main: string }> {
  const dir = scratch("repo-");
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "lib.ts"), LIB);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "base");
  const main = await git(dir, "rev-parse", "HEAD");
  const heads: Record<string, string> = {};
  for (const [name, edit] of Object.entries(branches)) {
    await git(dir, "checkout", "-q", "-b", name, "main");
    if (edit.lib !== undefined) writeFileSync(join(dir, "lib.ts"), edit.lib(LIB));
    if (edit.readme === true) writeFileSync(join(dir, "README.md"), `# fixture\n\n${name}\n`);
    await git(dir, "commit", "-q", "-am", name);
    heads[name] = await git(dir, "rev-parse", "HEAD");
  }
  await git(dir, "checkout", "-q", "main");
  return { dir, heads, main };
}

/** Every fixture's pull requests merge into `main` at its first commit, as `gh` reports in `baseRefOid`. */
function pull(number: number, head: string, files: readonly string[], base: string): PullRequest {
  return { number, title: `pull request ${number}`, isDraft: false, files, headCommit: head, baseBranch: "main", baseCommit: base };
}

/** File-level overlap, then the symbol analysis over its edges, then the overlap again with the levels. */
async function analysed(dir: string, prs: PullRequest[], opts: { graft?: string | null; outliner?: Outliner; budget?: number } = {}) {
  const fileLevel = computeOverlap([], prs);
  const graft = opts.graft === undefined ? GRAFT : opts.graft;
  const owned = opts.outliner === undefined && graft !== null ? graftOutliner(graft) : null;
  try {
    const symbols = await analyseSymbols({
      repo: dir,
      prs,
      conflicts: fileLevel.conflicts,
      overlapping: [],
      range: null,
      outliner: opts.outliner ?? owned,
      ...(opts.budget === undefined ? {} : { outlineBudget: opts.budget }),
    });
    return computeOverlap([], prs, { symbols });
  } finally {
    owned?.dispose();
  }
}

const alphaBody: Edit = (s) => s.replace("return 1;", "return 10;");
const alphaBodyAgain: Edit = (s) => s.replace("return 1;", "return 11;");
const betaBody: Edit = (s) => s.replace("return 2;", "return 20;");
const renameAlpha: Edit = (s) => s.replace("export function alpha()", "export function gamma()");

describe("symbol-level overlap through graft", () => {
  withGraft("golden: two pull requests changing different functions of one file are symbol-disjoint, with the symbols named", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)]);
    expect(o.conflicts).toHaveLength(1);
    const level = o.conflicts[0]!.symbolLevel;
    expect(level.level).toBe("symbol-disjoint");
    expect(level.files).toEqual([{ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 } }]);
    expect(o.conflicts[0]!.reason).toContain("different symbols");
  }, GRAFT_TIMEOUT);

  withGraft("two pull requests changing the same function are symbol-overlapping, naming it", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody }, b: { lib: alphaBodyAgain } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file.level).toBe("symbol-overlapping");
    expect(file.shared).toEqual(["alpha"]);
    expect(o.conflicts[0]!.symbolLevel.level).toBe("symbol-overlapping");
  }, GRAFT_TIMEOUT);

  withGraft("a rename read as a removal plus an addition is never reported disjoint from an edit to the old name", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: renameAlpha }, b: { lib: alphaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file.level).not.toBe("symbol-disjoint");
    expect(file.level).toBe("symbol-overlapping");
    expect(file.a!.symbols).toEqual(["alpha", "gamma"]);
    expect(file.shared).toEqual(["alpha"]);
  }, GRAFT_TIMEOUT);

  test("graft absent leaves every shared file undetermined, and the edge separates waves as file-level does", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)], { graft: null });
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file).toMatchObject({ path: "lib.ts", level: "undetermined", code: "graft.not_resolved" });
    expect(file.reason).toContain("graft");
    expect(o.waves).toEqual([{ wave: 1, pullRequests: [1] }, { wave: 2, pullRequests: [2] }]);
  }, GRAFT_TIMEOUT);

  test("a non-code shared file is undetermined without spending a graft call", async () => {
    const { dir, heads, main } = await fixture({ a: { readme: true }, b: { readme: true } });
    let calls = 0;
    const counting: Outliner = async () => { calls += 1; return { code: "never", reason: "never" }; };
    const o = await analysed(dir, [pull(1, heads.a!, ["README.md"], main), pull(2, heads.b!, ["README.md"], main)], { outliner: counting });
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ path: "README.md", level: "undetermined", code: "language.unsupported" });
    expect(calls).toBe(0);
  }, GRAFT_TIMEOUT);

  withGraft("both sides changing lines outside every symbol is undetermined; one side alone still decides by the symbols", async () => {
    const header: Edit = (s) => s.replace("// header comment", "// header comment, edited");
    const between: Edit = (s) => s.replace("// a comment between", "// a comment between, edited");
    const both = await fixture({ a: { lib: header }, b: { lib: between } });
    const o = await analysed(both.dir, [pull(1, both.heads.a!, ["lib.ts"], both.main), pull(2, both.heads.b!, ["lib.ts"], both.main)]);
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "symbols.outside" });

    const one = await fixture({ a: { lib: (s) => alphaBody(header(s)) }, b: { lib: betaBody } });
    const p = await analysed(one.dir, [pull(1, one.heads.a!, ["lib.ts"], one.main), pull(2, one.heads.b!, ["lib.ts"], one.main)]);
    expect(p.conflicts[0]!.symbolLevel.files[0]).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 2 }, b: { symbols: ["beta"], outside: 0 } });
  }, GRAFT_TIMEOUT);

  withGraft("past the outline budget a file is undetermined, and so is a graft call that timed out", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const real = graftOutliner(GRAFT!);
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)], { outliner: real, budget: 1 }).finally(() => real.dispose());
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "budget.spent" });
    expect(o.symbolAnalysis.outlinesRun).toBe(1);

    // A graft that never answers: the call is killed at the timeout and the file degrades.
    const bin = scratch("slow-");
    const slow = join(bin, "graft");
    writeFileSync(slow, "#!/bin/sh\nsleep 30\n");
    chmodSync(slow, 0o755);
    const started = Date.now();
    const slowOutliner = graftOutliner(slow, { timeoutMs: 300 });
    const t = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, heads.b!, ["lib.ts"], main)], { outliner: slowOutliner }).finally(() => slowOutliner.dispose());
    expect(t.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "graft.outline_timeout" });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, GRAFT_TIMEOUT);

  withGraft("a pull request whose head commit is not in the local repository is undetermined, naming git fetch", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"], main), pull(2, "0123456789abcdef0123456789abcdef01234567", ["lib.ts"], main)]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file).toMatchObject({ level: "undetermined", code: "git.head_missing" });
    expect(file.reason).toContain("git fetch");
  }, GRAFT_TIMEOUT);
});

describe("symbol-level overlap, computed", () => {
  test("changed lines keep whitespace-only lines, listed apart, and read both sides of a hunk", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -3 +3,2 @@",
      "-  return 1;",
      "+  return 10;",
      "+",
      "@@ -9,0 +11,1 @@",
      "+export const z = 1;",
    ].join("\n");
    expect(changedLines(diff)).toEqual({ binary: false, hunks: 2, old: [3], new: [3, 4, 11], blank: { old: [], new: [4] } });
  });

  test("attribution names every symbol whose span holds a line, and counts the rest", () => {
    const spans = [{ symbol: "alpha", start: 2, end: 4 }, { symbol: "beta", start: 6, end: 8 }];
    expect(attribute([3, 7, 10], spans)).toEqual({ symbols: ["alpha", "beta"], outside: 1 });
    // A whitespace-only line counts for a span that holds it, and toward nothing outside every span.
    expect(attribute([3, 10], spans, [3, 10])).toEqual({ symbols: ["alpha"], outside: 0 });
  });

  test("an outline that is partial, refused, or of another contract is a failure, not an empty jump table", () => {
    expect(parseOutline('{"_schema":{"id":"graft.cli.read_outline","version":"3.0.0"},"jumpTable":[{"symbol":"a","kind":"function","start":1,"end":2}],"outline":[],"path":"x.ts"}')).toEqual([{ symbol: "a", start: 1, end: 2 }]);
    expect(parseOutline('{"_schema":{"id":"graft.cli.read_outline","version":"3.0.0"},"jumpTable":[],"outline":[],"path":"x.ts","partial":true}')).toMatchObject({ code: "graft.outline_partial" });
    expect(parseOutline('{"_schema":{"id":"graft.cli.read_outline","version":"3.0.0"},"path":"x.ts","projection":"refused","reason":"too big"}')).toMatchObject({ code: "graft.outline_refused" });
    expect(parseOutline('{"_schema":{"id":"graft.cli.read_outline","version":"4.0.0"},"jumpTable":[]}')).toMatchObject({ code: "graft.outline_unreadable" });
    expect(parseOutline("not json")).toMatchObject({ code: "graft.outline_unreadable" });
  });

  test("classification: disjoint, overlapping, and undetermined carrying the first side's reason", () => {
    const side = (symbols: string[], outside = 0): SideResult => ({ ok: true, touched: { symbols, outside } });
    expect(classifyFile("x.ts", side(["a"]), side(["b"]))).toEqual({ path: "x.ts", level: "symbol-disjoint", a: { symbols: ["a"], outside: 0 }, b: { symbols: ["b"], outside: 0 } });
    expect(classifyFile("x.ts", side(["a", "c"]), side(["c", "b"]))).toMatchObject({ level: "symbol-overlapping", shared: ["c"] });
    expect(classifyFile("x.ts", side(["a"], 1), side(["b"], 2))).toMatchObject({ level: "undetermined", code: "symbols.outside" });
    expect(classifyFile("x.ts", { ok: false, code: "git.head_missing", reason: "gone" }, side(["b"]))).toEqual({ path: "x.ts", level: "undetermined", code: "git.head_missing", reason: "gone" });
  });

  test("waves: a symbol-disjoint edge shares a wave; overlapping and undetermined edges separate", () => {
    const prs = [1, 2, 3, 4].map((n) => ({ number: n, title: `${n}`, isDraft: false, files: n <= 2 ? ["x.ts"] : ["y.ts"] }));
    const levels = new Map([
      ["1-2", { level: "symbol-disjoint" as const, files: [{ path: "x.ts", level: "symbol-disjoint" as const, a: { symbols: ["a"], outside: 0 }, b: { symbols: ["b"], outside: 0 } }] }],
      ["3-4", { level: "undetermined" as const, files: [{ path: "y.ts", level: "undetermined" as const, code: "graft.not_resolved", reason: "no graft" }] }],
    ]);
    const o = computeOverlap([], prs, { symbols: { edges: levels, overlapping: new Map(), analysis: { outlinesRun: 0, outlineBudget: 0, outlineTimeoutMs: 0, remoteCalls: 0, remoteBudget: 0, remoteTimeoutMs: 0 } } });
    expect(o.waves).toEqual([{ wave: 1, pullRequests: [1, 2, 3] }, { wave: 2, pullRequests: [4] }]);
    expect(o.conflicts).toHaveLength(2);
  });

  test("without a symbol analysis every edge is undetermined, so the waves are file-level", () => {
    const o = computeOverlap([], [{ number: 1, title: "1", isDraft: false, files: ["x.ts"] }, { number: 2, title: "2", isDraft: false, files: ["x.ts"] }]);
    expect(o.conflicts[0]!.symbolLevel).toEqual({ level: "undetermined", files: [{ path: "x.ts", level: "undetermined", code: "symbols.not_analysed", reason: "symbol-level analysis was not run" }] });
    expect(o.waves).toHaveLength(2);
  });
});

describe("the overlap schema 2.2.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const record = (overlap: unknown) => ({ event: "result", t: 1, seq: 2, run: "r", range: "a...b", overlap, digest: "0".repeat(64), _schema: { id: "footprint.overlap", version: "2.2.0" } });
  const prs = [{ number: 1, title: "1", isDraft: false, files: ["x.ts"] }, { number: 2, title: "2", isDraft: false, files: ["x.ts"] }];

  test("every undetermined code src/symbols.ts can produce is one the schema accepts", () => {
    const source = readFileSync(join(ROOT, "src/symbols.ts"), "utf8");
    const produced = [...new Set([...source.matchAll(/code: "([a-z]+\.[a-z_]+)"/g)].map((m) => m[1]!))].filter((c) => c !== "symbols.cleanup_failed").sort();
    const defs = (schema as { $defs: { fileLevel: { properties: { code: { enum: string[] } } } } }).$defs;
    expect(produced.length).toBeGreaterThan(10);
    for (const code of produced) expect(defs.fileLevel.properties.code.enum).toContain(code);
  });

  test("a result whose edges carry symbolLevel validates; an edge without it does not", () => {
    const o = computeOverlap(["x.ts"], prs);
    expect(validate(record(o))).toBe(true);
    const stripped = { ...o, conflicts: o.conflicts.map(({ symbolLevel: _, ...rest }) => rest) };
    expect(validate(record(stripped))).toBe(false);
    const noOverlapLevel = { ...o, overlapping: o.overlapping.map(({ symbolLevel: _, ...rest }) => rest) };
    expect(validate(record(noOverlapLevel))).toBe(false);
  });
});

describe("the overlap section with symbol levels", () => {
  const disjoint = { level: "symbol-disjoint" as const, files: [{ path: "x.ts", level: "symbol-disjoint" as const, a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 } }] };
  const undetermined = { level: "undetermined" as const, files: [{ path: "README.md", level: "undetermined" as const, code: "language.unsupported", reason: "graft has no grammar for .md files" }] };

  test("names the symbols of a disjoint file and the reason of an undetermined one", () => {
    const prs = [{ number: 1, title: "one", isDraft: false, files: ["x.ts"] }, { number: 2, title: "two", isDraft: false, files: ["x.ts", "README.md"] }];
    const o = computeOverlap(["x.ts", "README.md"], prs, { self: 1, symbols: { edges: new Map([["1-2", { level: "undetermined" as const, files: [...disjoint.files, ...undetermined.files] }]]), overlapping: new Map([[2, { level: "undetermined" as const, files: [...disjoint.files, ...undetermined.files] }]]), analysis: { outlinesRun: 4, outlineBudget: 24, outlineTimeoutMs: 20000, remoteCalls: 0, remoteBudget: 0, remoteTimeoutMs: 0 } } });
    const md = renderOverlap(o, OVERLAP_BUDGET);
    expect(md).toContain("`alpha`");
    expect(md).toContain("`beta`");
    expect(md).toContain("graft has no grammar for .md files");
  });

  test("100 edges with symbol levels fit the overlap budget and count what was omitted", () => {
    const prs = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, title: `pull request ${i + 1} ${"x".repeat(60)}`, isDraft: false, files: ["x.ts"] }));
    const edges = new Map<string, typeof disjoint>();
    for (let b = 2; b <= 101; b += 1) edges.set(`1-${b}`, disjoint);
    const overlapping = new Map<number, typeof disjoint>();
    for (let b = 2; b <= 101; b += 1) overlapping.set(b, disjoint);
    const o = computeOverlap(["x.ts"], prs, { self: 1, symbols: { edges, overlapping, analysis: { outlinesRun: 24, outlineBudget: 24, outlineTimeoutMs: 20000, remoteCalls: 0, remoteBudget: 0, remoteTimeoutMs: 0 } } });
    const md = renderOverlap(o, OVERLAP_BUDGET);
    expect(md.length).toBeLessThanOrEqual(OVERLAP_BUDGET);
    expect(md).toMatch(/\d+ more pull requests? omitted/);
  });
});

describe("symbol-level overlap through the CLI", () => {
  // A stand-in `gh` that answers the two read-only calls footprint makes, so the end-to-end run
  // needs no network; `git` and `node` are the real ones, and graft is the installed one.
  async function fakeGh(dir: string, base: string, prs: Array<{ number: number; head: string; branch: string; files: string[] }>): Promise<string> {
    const bin = scratch("bin-");
    for (const exe of ["git", "node"]) {
      const found = Bun.which(exe);
      // A symlink, not a shell wrapper: a wrapper would split a path holding a space (flyingrobots/footprint#56).
      if (found !== null) symlinkSync(found, join(bin, exe));
    }
    const list = JSON.stringify(prs.map((p) => ({ number: p.number, title: `pull request ${p.number}`, isDraft: false, headRefOid: p.head, headRefName: p.branch, isCrossRepository: false, baseRefName: "main", baseRefOid: base })));
    writeFileSync(join(dir, ".git", "fake-gh-list.json"), list);
    for (const p of prs) writeFileSync(join(dir, ".git", `fake-gh-diff-${p.number}.txt`), `${p.files.join("\n")}\n`);
    const gh = [
      "#!/bin/sh",
      `D=${JSON.stringify(join(dir, ".git"))}`,
      'if [ "$1 $2" = "pr list" ]; then /bin/cat "$D/fake-gh-list.json"; exit 0; fi',
      'if [ "$1 $2" = "pr diff" ]; then /bin/cat "$D/fake-gh-diff-$3.txt"; exit 0; fi',
      'echo "unexpected gh $*" >&2; exit 1',
    ].join("\n");
    writeFileSync(join(bin, "gh"), `${gh}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    return bin;
  }

  withGraft("golden end to end: the overlap result names the other pull request's symbols and validates as 2.2.0", async () => {
    const { dir, heads, main } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const bin = await fakeGh(dir, main, [{ number: 1, head: heads.a!, branch: "a", files: ["lib.ts"] }, { number: 2, head: heads.b!, branch: "b", files: ["lib.ts"] }]);
    const env = { ...process.env, PATH: bin, XDG_STATE_HOME: scratch("state-") };
    const run = async (args: string[]) => {
      const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, , status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(status).toBe(0);
      return stdout;
    };
    const lines = (await run(["main...a"])).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown> & { _schema: { id: string; version: string } });
    const result = lines.find((l) => l.event === "result" && l._schema.id === "footprint.overlap") as Record<string, unknown> & { overlap: ReturnType<typeof computeOverlap> };
    expect(result._schema.version).toBe("2.2.0");
    const schema = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
    expect(validate(result)).toBe(true);
    expect(result.overlap).toMatchObject({ available: true });
    expect(result.overlap.self).toBe(1);
    expect(result.overlap.overlapping[0]!.symbolLevel.files[0]).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 } });
    expect(result.overlap.conflicts[0]!.symbolLevel.level).toBe("symbol-disjoint");
    expect(result.overlap.waves).toEqual([{ wave: 1, pullRequests: [1, 2] }]);

    const human = await run(["main...a", "--human"]);
    expect(human).toContain("`alpha`");
    expect(human).toContain("`beta`");
  }, GRAFT_TIMEOUT);
});

// Review follow-ups on the symbol level (flyingrobots/footprint#56). Each case is a way the
// analysis could call two pull requests that change the same symbol `symbol-disjoint`, or lose
// what it found. They run on a stand-in outliner, not graft, so they hold with graft absent: the
// stand-in's spans are each `export function NAME` line through the next line that starts with `}`.
describe("symbol-level overlap, review follow-ups (flyingrobots/footprint#56)", () => {
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

  /** `main` holds `base`; each branch starts from `from` (default `main`) and writes its files. */
  async function repo(base: Record<string, string>, branches: Record<string, { from?: string; files: Record<string, string> }>) {
    const dir = scratch("repo-");
    await git(dir, "init", "-q", "-b", "main");
    for (const [p, c] of Object.entries(base)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "base");
    const main = await git(dir, "rev-parse", "HEAD");
    const heads: Record<string, string> = {};
    for (const [name, b] of Object.entries(branches)) {
      await git(dir, "checkout", "-q", "-b", name, b.from ?? "main");
      for (const [p, c] of Object.entries(b.files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
      await git(dir, "add", ".");
      await git(dir, "commit", "-q", "-m", name);
      heads[name] = await git(dir, "rev-parse", "HEAD");
    }
    await git(dir, "checkout", "-q", "main");
    return { dir, heads, main };
  }

  function pr(number: number, head: string, files: readonly string[], baseCommit: string | undefined, extra: Partial<PullRequest> = {}): PullRequest {
    return { number, title: `pull request ${number}`, isDraft: false, files, headCommit: head, baseBranch: "main", ...(baseCommit === undefined ? {} : { baseCommit }), ...extra } as PullRequest;
  }

  async function levels(repoDir: string, prs: PullRequest[], opts: { outliner?: Outliner; budget?: number } = {}) {
    const fileLevel = computeOverlap([], prs);
    const symbols = await analyseSymbols({ repo: repoDir, prs, conflicts: fileLevel.conflicts, overlapping: [], range: null, outliner: opts.outliner ?? standIn, ...(opts.budget === undefined ? {} : { outlineBudget: opts.budget }) });
    return { overlap: computeOverlap([], prs, { symbols }), symbols };
  }

  test("a whitespace-only line inside a symbol is attributed to it; one outside every symbol counts toward nothing", async () => {
    const r = await repo({ "lib.ts": LIB }, {
      a: { files: { "lib.ts": LIB.replace("  return 1;\n", "  return 1;\n    \n") } },
      b: { files: { "lib.ts": alphaBody(LIB) } },
      c: { files: { "lib.ts": LIB.replace("}\n\nexport function beta", "}\n\n\nexport function beta") } },
      d: { files: { "lib.ts": LIB.replace("// header comment", "// header comment, edited") } },
    });
    const inside = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], r.main), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(inside.overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"] });
    const outside = await levels(r.dir, [pr(3, r.heads.c!, ["lib.ts"], r.main), pr(4, r.heads.d!, ["lib.ts"], r.main)]);
    expect(outside.overlap.conflicts[0]!.symbolLevel.files[0]).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: [], outside: 0 }, b: { symbols: [], outside: 2 } });
  });

  test("an outline that is valid JSON of the wrong shape is unreadable, not a throw", () => {
    expect(parseOutline("null")).toMatchObject({ code: "graft.outline_unreadable" });
    expect(parseOutline("42")).toMatchObject({ code: "graft.outline_unreadable" });
    expect(parseOutline('{"_schema":{"id":"graft.cli.read_outline","version":"3.0.0"},"jumpTable":[null],"outline":[],"path":"x.ts"}')).toMatchObject({ code: "graft.outline_unreadable" });
  });

  test("the outline deadline covers reading the pipes, not only the process exit", async () => {
    const bin = scratch("pipe-");
    const held = join(bin, "graft");
    // Exits at once, but a background child keeps stdout and stderr open for 20 seconds.
    writeFileSync(held, "#!/bin/sh\n(sleep 20) &\necho '{}'\nexit 0\n");
    chmodSync(held, 0o755);
    const outliner = graftOutliner(held, { timeoutMs: 500 });
    const started = Date.now();
    try {
      const r = await outliner(LIB, "lib.ts");
      expect(r).toMatchObject({ code: "graft.outline_timeout" });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      outliner.dispose();
    }
  }, 30_000);

  test("one blob at two paths is outlined once per path, never answered with the other path's outline", async () => {
    const r = await repo({ "a.ts": LIB, "a.tsx": LIB }, {
      a: { files: { "a.ts": alphaBody(LIB), "a.tsx": alphaBody(LIB) } },
      b: { files: { "a.ts": betaBody(LIB), "a.tsx": betaBody(LIB) } },
    });
    const refusesTsx: Outliner = async (content, path) => (path.endsWith(".tsx") ? { code: "graft.outline_refused", reason: "stand-in refuses .tsx" } : spansOf(content));
    const { overlap } = await levels(r.dir, [pr(1, r.heads.a!, ["a.ts", "a.tsx"], r.main), pr(2, r.heads.b!, ["a.ts", "a.tsx"], r.main)], { outliner: refusesTsx });
    const files = overlap.conflicts[0]!.symbolLevel.files;
    expect(files.find((f) => f.path === "a.ts")).toMatchObject({ level: "symbol-disjoint" });
    expect(files.find((f) => f.path === "a.tsx")).toMatchObject({ level: "undetermined", code: "graft.outline_refused" });
  });

  test("a configured textconv driver does not shape the attribution diff", async () => {
    const r = await repo({ "lib.ts": LIB }, { a: { files: { "lib.ts": alphaBody(LIB) } }, b: { files: { "lib.ts": alphaBodyAgain(LIB) } } });
    // A driver that shows only signatures: body edits vanish from a textconv'd diff.
    writeFileSync(join(r.dir, ".git", "info", "attributes"), "*.ts diff=sig\n");
    await git(r.dir, "config", "diff.sig.textconv", "grep '^export function'");
    const { overlap } = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], r.main), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"] });
  });

  test("paths are read root-relative and literally: from a subdirectory, and with glob characters in the name", async () => {
    const r = await repo({ "src/lib.ts": LIB, "src/page[1].ts": LIB, "src/page1.ts": `${LIB}// another file\n` }, {
      a: { files: { "src/lib.ts": alphaBody(LIB), "src/page[1].ts": betaBody(LIB), "src/page1.ts": alphaBody(`${LIB}// another file\n`) } },
      b: { files: { "src/lib.ts": alphaBodyAgain(LIB), "src/page[1].ts": alphaBody(LIB) } },
    });
    const prs = [pr(1, r.heads.a!, ["src/lib.ts", "src/page[1].ts", "src/page1.ts"], r.main), pr(2, r.heads.b!, ["src/lib.ts", "src/page[1].ts"], r.main)];
    for (const from of [r.dir, join(r.dir, "src")]) {
      const { overlap } = await levels(from, prs);
      const files = overlap.conflicts[0]!.symbolLevel.files;
      expect(files.find((f) => f.path === "src/lib.ts")).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"] });
      expect(files.find((f) => f.path === "src/page[1].ts")).toEqual({ path: "src/page[1].ts", level: "symbol-disjoint", a: { symbols: ["beta"], outside: 0 }, b: { symbols: ["alpha"], outside: 0 } });
    }
  });

  test("no outline call is spent on a pair already known to be undetermined", async () => {
    const other = `${LIB}// other\n`;
    const r = await repo({ "lib.ts": LIB, "other.ts": other }, {
      a: { files: { "lib.ts": alphaBody(LIB) } },
      c: { files: { "other.ts": alphaBody(other) } },
      d: { files: { "other.ts": betaBody(other) } },
    });
    const missing = "0123456789abcdef0123456789abcdef01234567";
    const { overlap, symbols } = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], r.main), pr(2, missing, ["lib.ts"], r.main), pr(3, r.heads.c!, ["other.ts"], r.main), pr(4, r.heads.d!, ["other.ts"], r.main)], { budget: 3 });
    expect(overlap.conflicts.find((c) => c.a === 1)!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "git.head_missing" });
    expect(overlap.conflicts.find((c) => c.a === 3)!.symbolLevel.level).toBe("symbol-disjoint");
    expect(symbols.analysis.outlinesRun).toBe(3);
  });

  test("the merge base is taken against the pull request's own base commit, never a local branch tip", async () => {
    const r = await repo({ "lib.ts": LIB }, { a: { files: { "lib.ts": alphaBody(LIB) } }, b: { files: { "lib.ts": alphaBodyAgain(LIB) } } });
    // The local main has already taken a's head, as a fork's main can; GitHub's base has not.
    await git(r.dir, "merge", "-q", "--ff-only", "a");
    const taken = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], r.main), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(taken.overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"] });
    const unknown = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], undefined), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(unknown.overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "gh.base_unknown" });
    const absent = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts"], "fedcba9876543210fedcba9876543210fedcba98"), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(absent.overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "git.base_missing" });
  });

  test("a side listed as changing a file its own diff does not change is undetermined, not an empty side", async () => {
    const r = await repo({ "lib.ts": LIB, "README.md": "# r\n" }, { a: { files: { "README.md": "# r\n\na\n" } }, b: { files: { "lib.ts": alphaBody(LIB) } } });
    const { overlap } = await levels(r.dir, [pr(1, r.heads.a!, ["lib.ts", "README.md"], r.main), pr(2, r.heads.b!, ["lib.ts"], r.main)]);
    expect(overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ path: "lib.ts", level: "undetermined", code: "symbols.file_unchanged" });
  });

  test("a head that moved while the files were listed leaves that pull request's files undetermined", async () => {
    const r = await repo({ "lib.ts": LIB }, { a: { files: { "lib.ts": alphaBody(LIB) } }, b: { files: { "lib.ts": betaBody(LIB) } }, b2: { from: "b", files: { "lib.ts": alphaBodyAgain(betaBody(LIB)) } } });
    const bin = scratch("gh-");
    const row = (n: number, head: string) => ({ number: n, title: `${n}`, isDraft: false, headRefOid: head, headRefName: `h${n}`, isCrossRepository: false, baseRefName: "main", baseRefOid: r.main });
    writeFileSync(join(bin, "list1.json"), JSON.stringify([row(1, r.heads.a!), row(2, r.heads.b!)]));
    writeFileSync(join(bin, "list2.json"), JSON.stringify([row(1, r.heads.a!), row(2, r.heads.b2!)]));
    const gh = join(bin, "gh");
    writeFileSync(gh, [
      "#!/bin/sh",
      `D=${JSON.stringify(bin)}`,
      'if [ "$1 $2" = "pr list" ]; then if [ -f "$D/listed" ]; then /bin/cat "$D/list2.json"; else : > "$D/listed"; /bin/cat "$D/list1.json"; fi; exit 0; fi',
      'if [ "$1 $2" = "pr diff" ]; then echo lib.ts; exit 0; fi',
      "exit 1",
    ].join("\n"));
    chmodSync(gh, 0o755);
    const pulls = await listOpenPullRequests(gh, r.dir);
    if (isFailure(pulls)) throw new Error(pulls.reason);
    const { overlap } = await levels(r.dir, [...pulls.pullRequests]);
    expect(overlap.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "gh.head_moved" });
  });

  /** A stand-in graft for the CLI: answers `read outline` with the stand-in spans, fails everything else. */
  function fakeGraft(bin: string): string {
    const path = join(bin, "fake-graft");
    writeFileSync(path, [
      `#!${process.execPath}`,
      'import { chmodSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const a = process.argv.slice(2);",
      'const cwd = a[a.indexOf("--cwd") + 1];',
      'if (a.includes("read") && a.includes("outline")) {',
      '  const name = a[a.indexOf("outline") + 1];',
      '  const lines = readFileSync(join(cwd, name), "utf8").split("\\n");',
      "  const jumpTable = [];",
      "  lines.forEach((l, i) => { const m = /^export function (\\w+)/.exec(l); if (!m) return; let e = i; while (e < lines.length - 1 && !lines[e].startsWith(\"}\")) e += 1; jumpTable.push({ symbol: m[1], kind: \"function\", start: i + 1, end: e + 1 }); });",
      '  if (process.env.FAKE_GRAFT_LOCK === "1") chmodSync(cwd, 0o500);',
      '  console.log(JSON.stringify({ _schema: { id: "graft.cli.read_outline", version: "3.0.0" }, path: name, outline: [], jumpTable }));',
      "  process.exit(0);",
      "}",
      'process.stderr.write("fake graft answers read outline only\\n");',
      "process.exit(1);",
    ].join("\n"));
    chmodSync(path, 0o755);
    return path;
  }

  async function cliIn(dir: string, gh: string[], args: string[], env: Record<string, string> = {}) {
    const bin = scratch("bin-");
    for (const exe of ["git", "node"]) { const found = Bun.which(exe); if (found !== null) symlinkSync(found, join(bin, exe)); }
    writeFileSync(join(bin, "gh"), `${gh.join("\n")}\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], { cwd: dir, env: { ...process.env, PATH: bin, FOOTPRINT_GRAFT: fakeGraft(bin), XDG_STATE_HOME: scratch("state-"), ...env }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const lines = `${stdout}${stderr}`.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown> & { _schema: { id: string } });
    return { status, lines, overlap: (lines.find((l) => l.event === "result" && l._schema.id === "footprint.overlap") as { overlap: ReturnType<typeof computeOverlap> } | undefined)?.overlap };
  }

  function listingGh(dir: string, rows: object[], files: Record<number, string[]>, onFirstList = ""): string[] {
    writeFileSync(join(dir, ".git", "fake-gh-list.json"), JSON.stringify(rows));
    for (const [n, f] of Object.entries(files)) writeFileSync(join(dir, ".git", `fake-gh-diff-${n}.txt`), `${f.join("\n")}\n`);
    return [
      "#!/bin/sh",
      `D=${JSON.stringify(join(dir, ".git"))}`,
      `if [ "$1 $2" = "pr list" ]; then if [ ! -f "$D/fake-gh-listed" ]; then : > "$D/fake-gh-listed"; ${onFirstList || ":"}; fi; /bin/cat "$D/fake-gh-list.json"; exit 0; fi`,
      'if [ "$1 $2" = "pr diff" ]; then /bin/cat "$D/fake-gh-diff-$3.txt"; exit 0; fi',
      'echo "unexpected gh $*" >&2; exit 1',
    ];
  }

  test("the range's head is pinned before the pull requests are listed, so a branch that advances mid-run is not read twice", async () => {
    const r = await repo({ "lib.ts": LIB }, { a: { files: { "lib.ts": alphaBody(LIB) } }, a2: { files: { "lib.ts": betaBody(LIB) } }, b: { files: { "lib.ts": alphaBodyAgain(LIB) } } });
    const row = (n: number, head: string, branch: string) => ({ number: n, title: `${n}`, isDraft: false, headRefOid: head, headRefName: branch, isCrossRepository: false, baseRefName: "main", baseRefOid: r.main });
    const gh = listingGh(r.dir, [row(1, r.heads.a!, "a"), row(2, r.heads.b!, "b")], { 1: ["lib.ts"], 2: ["lib.ts"] }, `git -C ${JSON.stringify(r.dir)} update-ref refs/heads/a ${r.heads.a2}`);
    const run = await cliIn(r.dir, gh, ["main...a"]);
    expect(run.status).toBe(0);
    expect(run.overlap!.self).toBe(1);
    expect(run.overlap!.overlapping[0]!.symbolLevel.files[0]).toMatchObject({ level: "symbol-overlapping", shared: ["alpha"] });
  }, GRAFT_TIMEOUT);

  test("a failure to remove the outline directory is a warning; the symbol levels survive it", async () => {
    const r = await repo({ "lib.ts": LIB }, { a: { files: { "lib.ts": alphaBody(LIB) } }, b: { files: { "lib.ts": betaBody(LIB) } } });
    const row = (n: number, head: string, branch: string) => ({ number: n, title: `${n}`, isDraft: false, headRefOid: head, headRefName: branch, isCrossRepository: false, baseRefName: "main", baseRefOid: r.main });
    const gh = listingGh(r.dir, [row(1, r.heads.a!, "a"), row(2, r.heads.b!, "b")], { 1: ["lib.ts"], 2: ["lib.ts"] });
    const tmp = scratch("tmp-");
    try {
      const run = await cliIn(r.dir, gh, ["main...a"], { TMPDIR: tmp, FAKE_GRAFT_LOCK: "1" });
      expect(run.status).toBe(0);
      expect(run.overlap!.overlapping[0]!.symbolLevel.level).toBe("symbol-disjoint");
      expect(run.lines.some((l) => l.code === "symbols.cleanup_failed")).toBe(true);
    } finally {
      await $`chmod -R u+rwx ${tmp}`.quiet().nothrow();
    }
  }, GRAFT_TIMEOUT);
});
