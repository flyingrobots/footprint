// Symbol-level overlap between open pull requests (flyingrobots/footprint#33, OUT-22).
//
// The pure half (changed lines, attribution, classification, waves, rendering) is tested over
// fixed inputs. The impure half runs against throwaway git repositories under $TMPDIR and the
// installed graft, so the golden case is a real `graft read outline` answer rather than a mock:
// a fixture standing in for graft would pass while graft's jump table drifted underneath it.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { computeOverlap, type PullRequest } from "../src/overlap.ts";
import { analyseSymbols, attribute, changedLines, classifyFile, graftOutliner, parseOutline, type Outliner, type SideResult } from "../src/symbols.ts";
import { resolveGraft } from "../src/graft.ts";
import { renderOverlap } from "../src/render.ts";
import { OVERLAP_BUDGET } from "../src/bound.ts";

const ROOT = resolve(import.meta.dir, "..");
/** Each outline is a graft process; several of them on a loaded machine take longer than 5s. */
const GRAFT_TIMEOUT = 120_000;

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
async function fixture(branches: Record<string, { lib?: Edit; readme?: boolean }>): Promise<{ dir: string; heads: Record<string, string> }> {
  const dir = mkdtempSync(join(tmpdir(), "footprint-sym-repo-"));
  await git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "lib.ts"), LIB);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "base");
  const heads: Record<string, string> = {};
  for (const [name, edit] of Object.entries(branches)) {
    await git(dir, "checkout", "-q", "-b", name, "main");
    if (edit.lib !== undefined) writeFileSync(join(dir, "lib.ts"), edit.lib(LIB));
    if (edit.readme === true) writeFileSync(join(dir, "README.md"), `# fixture\n\n${name}\n`);
    await git(dir, "commit", "-q", "-am", name);
    heads[name] = await git(dir, "rev-parse", "HEAD");
  }
  await git(dir, "checkout", "-q", "main");
  return { dir, heads };
}

function pull(number: number, head: string, files: readonly string[]): PullRequest {
  return { number, title: `pull request ${number}`, isDraft: false, files, headCommit: head, baseBranch: "main" };
}

/** File-level overlap, then the symbol analysis over its edges, then the overlap again with the levels. */
async function analysed(dir: string, prs: PullRequest[], opts: { graft?: string | null; outliner?: Outliner; budget?: number } = {}) {
  const fileLevel = computeOverlap([], prs);
  const graft = opts.graft === undefined ? await resolveGraft() : opts.graft;
  const symbols = await analyseSymbols({
    repo: dir,
    prs,
    conflicts: fileLevel.conflicts,
    overlapping: [],
    range: null,
    outliner: opts.outliner ?? (graft === null ? null : graftOutliner(graft)),
    ...(opts.budget === undefined ? {} : { outlineBudget: opts.budget }),
  });
  return computeOverlap([], prs, { symbols });
}

const alphaBody: Edit = (s) => s.replace("return 1;", "return 10;");
const alphaBodyAgain: Edit = (s) => s.replace("return 1;", "return 11;");
const betaBody: Edit = (s) => s.replace("return 2;", "return 20;");
const renameAlpha: Edit = (s) => s.replace("export function alpha()", "export function gamma()");

describe("symbol-level overlap through graft", () => {
  test("golden: two pull requests changing different functions of one file are symbol-disjoint, with the symbols named", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])]);
    expect(o.conflicts).toHaveLength(1);
    const level = o.conflicts[0]!.symbolLevel;
    expect(level.level).toBe("symbol-disjoint");
    expect(level.files).toEqual([{ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 0 }, b: { symbols: ["beta"], outside: 0 } }]);
    expect(o.conflicts[0]!.reason).toContain("different symbols");
  }, GRAFT_TIMEOUT);

  test("two pull requests changing the same function are symbol-overlapping, naming it", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody }, b: { lib: alphaBodyAgain } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file.level).toBe("symbol-overlapping");
    expect(file.shared).toEqual(["alpha"]);
    expect(o.conflicts[0]!.symbolLevel.level).toBe("symbol-overlapping");
  }, GRAFT_TIMEOUT);

  test("a rename read as a removal plus an addition is never reported disjoint from an edit to the old name", async () => {
    const { dir, heads } = await fixture({ a: { lib: renameAlpha }, b: { lib: alphaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file.level).not.toBe("symbol-disjoint");
    expect(file.level).toBe("symbol-overlapping");
    expect(file.a!.symbols).toEqual(["alpha", "gamma"]);
    expect(file.shared).toEqual(["alpha"]);
  }, GRAFT_TIMEOUT);

  test("graft absent leaves every shared file undetermined, and the edge separates waves as file-level does", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])], { graft: null });
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file).toMatchObject({ path: "lib.ts", level: "undetermined", code: "graft.not_resolved" });
    expect(file.reason).toContain("graft");
    expect(o.waves).toEqual([{ wave: 1, pullRequests: [1] }, { wave: 2, pullRequests: [2] }]);
  }, GRAFT_TIMEOUT);

  test("a non-code shared file is undetermined without spending a graft call", async () => {
    const { dir, heads } = await fixture({ a: { readme: true }, b: { readme: true } });
    let calls = 0;
    const counting: Outliner = async () => { calls += 1; return { code: "never", reason: "never" }; };
    const o = await analysed(dir, [pull(1, heads.a!, ["README.md"]), pull(2, heads.b!, ["README.md"])], { outliner: counting });
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ path: "README.md", level: "undetermined", code: "language.unsupported" });
    expect(calls).toBe(0);
  }, GRAFT_TIMEOUT);

  test("both sides changing lines outside every symbol is undetermined; one side alone still decides by the symbols", async () => {
    const header: Edit = (s) => s.replace("// header comment", "// header comment, edited");
    const between: Edit = (s) => s.replace("// a comment between", "// a comment between, edited");
    const both = await fixture({ a: { lib: header }, b: { lib: between } });
    const o = await analysed(both.dir, [pull(1, both.heads.a!, ["lib.ts"]), pull(2, both.heads.b!, ["lib.ts"])]);
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "symbols.outside" });

    const one = await fixture({ a: { lib: (s) => alphaBody(header(s)) }, b: { lib: betaBody } });
    const p = await analysed(one.dir, [pull(1, one.heads.a!, ["lib.ts"]), pull(2, one.heads.b!, ["lib.ts"])]);
    expect(p.conflicts[0]!.symbolLevel.files[0]).toEqual({ path: "lib.ts", level: "symbol-disjoint", a: { symbols: ["alpha"], outside: 2 }, b: { symbols: ["beta"], outside: 0 } });
  }, GRAFT_TIMEOUT);

  test("past the outline budget a file is undetermined, and so is a graft call that timed out", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const graft = await resolveGraft();
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])], { outliner: graftOutliner(graft!), budget: 1 });
    expect(o.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "budget.spent" });
    expect(o.symbolAnalysis.outlinesRun).toBe(1);

    // A graft that never answers: the call is killed at the timeout and the file degrades.
    const bin = mkdtempSync(join(tmpdir(), "footprint-sym-slow-"));
    const slow = join(bin, "graft");
    writeFileSync(slow, "#!/bin/sh\nsleep 30\n");
    chmodSync(slow, 0o755);
    const started = Date.now();
    const t = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, heads.b!, ["lib.ts"])], { outliner: graftOutliner(slow, { timeoutMs: 300 }) });
    expect(t.conflicts[0]!.symbolLevel.files[0]).toMatchObject({ level: "undetermined", code: "graft.outline_timeout" });
    expect(Date.now() - started).toBeLessThan(20_000);
  }, GRAFT_TIMEOUT);

  test("a pull request whose head commit is not in the local repository is undetermined, naming git fetch", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody } });
    const o = await analysed(dir, [pull(1, heads.a!, ["lib.ts"]), pull(2, "0123456789abcdef0123456789abcdef01234567", ["lib.ts"])]);
    const file = o.conflicts[0]!.symbolLevel.files[0]!;
    expect(file).toMatchObject({ level: "undetermined", code: "git.head_missing" });
    expect(file.reason).toContain("git fetch");
  }, GRAFT_TIMEOUT);
});

describe("symbol-level overlap, computed", () => {
  test("changed lines skip whitespace-only lines and read both sides of a hunk", () => {
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
    expect(changedLines(diff)).toEqual({ binary: false, old: [3], new: [3, 11] });
  });

  test("attribution names every symbol whose span holds a line, and counts the rest", () => {
    const spans = [{ symbol: "alpha", start: 2, end: 4 }, { symbol: "beta", start: 6, end: 8 }];
    expect(attribute([3, 7, 10], spans)).toEqual({ symbols: ["alpha", "beta"], outside: 1 });
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
    const o = computeOverlap([], prs, { symbols: { edges: levels, overlapping: new Map(), analysis: { outlinesRun: 0, outlineBudget: 0, outlineTimeoutMs: 0 } } });
    expect(o.waves).toEqual([{ wave: 1, pullRequests: [1, 2, 3] }, { wave: 2, pullRequests: [4] }]);
    expect(o.conflicts).toHaveLength(2);
  });

  test("without a symbol analysis every edge is undetermined, so the waves are file-level", () => {
    const o = computeOverlap([], [{ number: 1, title: "1", isDraft: false, files: ["x.ts"] }, { number: 2, title: "2", isDraft: false, files: ["x.ts"] }]);
    expect(o.conflicts[0]!.symbolLevel).toEqual({ level: "undetermined", files: [{ path: "x.ts", level: "undetermined", code: "symbols.not_analysed", reason: "symbol-level analysis was not run" }] });
    expect(o.waves).toHaveLength(2);
  });
});

describe("the overlap schema 2.0.0", () => {
  const schema = JSON.parse(readFileSync(join(ROOT, "schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const record = (overlap: unknown) => ({ event: "result", t: 1, seq: 2, run: "r", range: "a...b", overlap, digest: "0".repeat(64), _schema: { id: "footprint.overlap", version: "2.0.0" } });
  const prs = [{ number: 1, title: "1", isDraft: false, files: ["x.ts"] }, { number: 2, title: "2", isDraft: false, files: ["x.ts"] }];

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
    const o = computeOverlap(["x.ts", "README.md"], prs, { self: 1, symbols: { edges: new Map([["1-2", { level: "undetermined" as const, files: [...disjoint.files, ...undetermined.files] }]]), overlapping: new Map([[2, { level: "undetermined" as const, files: [...disjoint.files, ...undetermined.files] }]]), analysis: { outlinesRun: 4, outlineBudget: 24, outlineTimeoutMs: 20000 } } });
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
    const o = computeOverlap(["x.ts"], prs, { self: 1, symbols: { edges, overlapping, analysis: { outlinesRun: 24, outlineBudget: 24, outlineTimeoutMs: 20000 } } });
    const md = renderOverlap(o, OVERLAP_BUDGET);
    expect(md.length).toBeLessThanOrEqual(OVERLAP_BUDGET);
    expect(md).toMatch(/\d+ more pull requests? omitted/);
  });
});

describe("symbol-level overlap through the CLI", () => {
  // A stand-in `gh` that answers the two read-only calls footprint makes, so the end-to-end run
  // needs no network; `git` and `node` are the real ones, and graft is the installed one.
  async function fakeGh(dir: string, prs: Array<{ number: number; head: string; branch: string; files: string[] }>): Promise<string> {
    const bin = mkdtempSync(join(tmpdir(), "footprint-sym-bin-"));
    for (const exe of ["git", "node"]) {
      const found = Bun.which(exe);
      if (found !== null) writeFileSync(join(bin, exe), `#!/bin/sh\nexec ${found} "$@"\n`), chmodSync(join(bin, exe), 0o755);
    }
    const list = JSON.stringify(prs.map((p) => ({ number: p.number, title: `pull request ${p.number}`, isDraft: false, headRefOid: p.head, headRefName: p.branch, isCrossRepository: false, baseRefName: "main" })));
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

  test("golden end to end: the overlap result names the other pull request's symbols and validates as 2.0.0", async () => {
    const { dir, heads } = await fixture({ a: { lib: alphaBody }, b: { lib: betaBody } });
    const bin = await fakeGh(dir, [{ number: 1, head: heads.a!, branch: "a", files: ["lib.ts"] }, { number: 2, head: heads.b!, branch: "b", files: ["lib.ts"] }]);
    const env = { ...process.env, PATH: bin, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-sym-state-")) };
    const run = async (args: string[]) => {
      const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, , status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(status).toBe(0);
      return stdout;
    };
    const lines = (await run(["main...a"])).split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown> & { _schema: { id: string; version: string } });
    const result = lines.find((l) => l.event === "result" && l._schema.id === "footprint.overlap") as Record<string, unknown> & { overlap: ReturnType<typeof computeOverlap> };
    expect(result._schema.version).toBe("2.0.0");
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
