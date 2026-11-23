// Symbol-level overlap between open pull requests (flyingrobots/footprint#33).
//
// For a file two pull requests both change, the question is whether they change the same
// *symbols*. graft's `struct diff` cannot answer it: it lists signature-level changes only, and a
// body edit inside a function reads as "unchanged" (checked on this repository at
// 65d6a405..3fa62c37, where `src/cli.ts` had body edits inside `footprint` and graft reported
// `=5 unchanged`). Its lists are a subset of what changed, so two of them being disjoint proves
// nothing.
//
// So the attribution is footprint's own, over facts graft and git each state:
//
// - each side's changed lines, from `git diff -U0 <merge-base> <head> -- <file>`;
// - the spans of the file's **top-level** symbols, from `graft read outline --json`'s jump table,
//   at the merge base for removed lines and at the head for added ones.
//
// A changed line belongs to every symbol whose span holds it. Reading both ends is what keeps a
// rename honest: graft's diff reads `alpha` -> `gamma` as a removal plus an addition, and here the
// removed line names `alpha` at the base and the added line names `gamma` at the head, so the side
// touches both names and overlaps anything that touches either.
//
// Whenever a fact is missing the answer is `undetermined`, with a code and a reason, never
// `symbol-disjoint`: an absent signal must not read as a clean one.
//
// One-shot graft subcommands only, each under a timeout, and only as many as the outline budget
// allows; `graft read outline` reads a working-tree path, so each revision's content is written to
// a private temporary directory, outlined there, and the directory removed at the end.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { $ } from "bun";
import { extensionOf, parsableByGraft } from "./languages.ts";
import type { ConflictEdge, PullRequest, SharedWith } from "./overlap.ts";

export type Level = "symbol-disjoint" | "symbol-overlapping" | "undetermined";

/** What one side changed in one file: the symbols its changed lines fall in, and how many fell in none. */
export interface Touched {
  readonly symbols: readonly string[];
  /**
   * Changed lines outside every top-level symbol (comments, imports, top-level code), counted as
   * `git diff --numstat` counts: a modified line is one removed and one added. Whitespace-only
   * lines are not counted.
   */
  readonly outside: number;
}

export interface Failure {
  readonly code: string;
  readonly reason: string;
}

export type SideResult = ({ readonly ok: true; readonly touched: Touched }) | ({ readonly ok: false } & Failure);

/** One shared file at the symbol level. `a` and `b` are the edge's two sides, in its order. */
export interface FileSymbols {
  readonly path: string;
  readonly level: Level;
  readonly a?: Touched;
  readonly b?: Touched;
  /** The symbols both sides change; present when `symbol-overlapping`. */
  readonly shared?: readonly string[];
  readonly code?: string;
  readonly reason?: string;
}

/** An edge at the symbol level: overlapping if any shared file is, disjoint only if every one is. */
export interface SymbolLevel {
  readonly level: Level;
  readonly files: readonly FileSymbols[];
}

export interface SymbolAnalysis {
  /** graft outline processes actually started this run; cache hits are free. */
  readonly outlinesRun: number;
  readonly outlineBudget: number;
  readonly outlineTimeoutMs: number;
}

export interface Symbols {
  /** Keyed `"<a>-<b>"`, the edge's own numbers, lower first. */
  readonly edges: ReadonlyMap<string, SymbolLevel>;
  /** Keyed by the other pull request's number; side `a` is this change. */
  readonly overlapping: ReadonlyMap<number, SymbolLevel>;
  readonly analysis: SymbolAnalysis;
}

export interface Span {
  readonly symbol: string;
  readonly start: number;
  readonly end: number;
}

/** Turn graft content into spans, or say why not. */
export type Outliner = (content: string, path: string) => Promise<readonly Span[] | Failure>;

/** At most this many graft outline calls per run. Each is a process; graft is slow on big files. */
export const OUTLINE_BUDGET = 24;
/** Each outline call is killed after this long and its file degrades to undetermined. */
export const OUTLINE_TIMEOUT_MS = 20_000;

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function isFailure(x: unknown): x is Failure {
  return typeof x === "object" && x !== null && typeof (x as Failure).code === "string" && !Array.isArray(x);
}

/**
 * The changed lines of a unified diff, old side and new side, by line number. A line whose content
 * is whitespace only is skipped: it is in no symbol, and attributing it would make every added
 * function (and the blank line before it) undetermined. Pure.
 */
export function changedLines(diff: string): { binary: boolean; old: number[]; new: number[] } {
  const old: number[] = [], neu: number[] = [];
  let binary = false;
  let o = 0, n = 0, inHunk = false;
  for (const line of diff.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h !== null) {
      o = Number(h[1]); n = Number(h[2]); inHunk = true;
      continue;
    }
    if (/^Binary files .* differ$/.test(line) || line.startsWith("GIT binary patch")) binary = true;
    if (line.startsWith("diff --git")) { inHunk = false; continue; }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue;
    const body = line.slice(1);
    if (line.startsWith("-")) { if (body.trim() !== "") old.push(o); o += 1; }
    else if (line.startsWith("+")) { if (body.trim() !== "") neu.push(n); n += 1; }
    else if (line.startsWith(" ")) { o += 1; n += 1; }
  }
  return { binary, old, new: neu };
}

/** Which symbols' spans hold these lines, sorted, and how many lines no span holds. Pure. */
export function attribute(lines: readonly number[], spans: readonly Span[]): Touched {
  const names = new Set<string>();
  let outside = 0;
  for (const line of lines) {
    const holding = spans.filter((s) => s.start <= line && line <= s.end);
    if (holding.length === 0) outside += 1;
    for (const s of holding) names.add(s.symbol);
  }
  return { symbols: [...names].sort(), outside };
}

/** `graft read outline --json` (`graft.cli.read_outline` 3.x) as spans, or why not. Pure. */
export function parseOutline(text: string): readonly Span[] | Failure {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { code: "graft.outline_unreadable", reason: "graft read outline --json returned output that is not JSON" };
  }
  const o = v as { _schema?: { id?: unknown; version?: unknown }; jumpTable?: unknown; partial?: unknown; projection?: unknown; reason?: unknown; error?: unknown };
  const version = typeof o._schema?.version === "string" ? o._schema.version : "";
  if (o._schema?.id !== "graft.cli.read_outline" || !version.startsWith("3.")) {
    return { code: "graft.outline_unreadable", reason: `graft read outline answered ${String(o._schema?.id)}@${version || "?"}, not graft.cli.read_outline 3.x` };
  }
  if (o.projection === "refused") return { code: "graft.outline_refused", reason: `graft refused to outline the file: ${String(o.reason ?? "no reason given")}` };
  if (o.partial === true) return { code: "graft.outline_partial", reason: `graft's outline of the file is partial${typeof o.reason === "string" ? ` (${o.reason})` : ""}, so a line outside it may still be in a symbol` };
  if (typeof o.error === "string") return { code: "graft.outline_failed", reason: `graft read outline: ${o.error}` };
  if (!Array.isArray(o.jumpTable)) return { code: "graft.outline_unreadable", reason: "graft read outline carried no jump table" };
  const spans: Span[] = [];
  for (const e of o.jumpTable as Array<{ symbol?: unknown; start?: unknown; end?: unknown }>) {
    if (typeof e.symbol !== "string" || typeof e.start !== "number" || typeof e.end !== "number") {
      return { code: "graft.outline_unreadable", reason: "graft read outline carried a jump-table entry without a symbol and a line span" };
    }
    spans.push({ symbol: e.symbol, start: e.start, end: e.end });
  }
  return spans;
}

/** Two sides of one shared file, classified. Overlap is decided first: it is certain whatever else is unknown. Pure. */
export function classifyFile(path: string, a: SideResult, b: SideResult): FileSymbols {
  if (!a.ok) return { path, level: "undetermined", code: a.code, reason: a.reason };
  if (!b.ok) return { path, level: "undetermined", code: b.code, reason: b.reason };
  const inB = new Set(b.touched.symbols);
  const shared = a.touched.symbols.filter((s) => inB.has(s));
  if (shared.length > 0) return { path, level: "symbol-overlapping", a: a.touched, b: b.touched, shared };
  if (a.touched.outside > 0 && b.touched.outside > 0) {
    return {
      path,
      level: "undetermined",
      a: a.touched,
      b: b.touched,
      code: "symbols.outside",
      reason: `both sides change lines outside every top-level symbol graft found (${a.touched.outside} and ${b.touched.outside}: comments, imports or top-level code), which no symbol can tell apart`,
    };
  }
  return { path, level: "symbol-disjoint", a: a.touched, b: b.touched };
}

/** The edge's level from its files': any overlap overlaps; disjoint only when every file is. Pure. */
export function edgeLevel(files: readonly FileSymbols[]): SymbolLevel {
  const level: Level = files.some((f) => f.level === "symbol-overlapping")
    ? "symbol-overlapping"
    : files.length > 0 && files.every((f) => f.level === "symbol-disjoint") ? "symbol-disjoint" : "undetermined";
  return { level, files };
}

/** Every shared file undetermined for one reason: what an edge carries when no analysis ran. */
export function undeterminedLevel(files: readonly string[], code: string, reason: string): SymbolLevel {
  return { level: "undetermined", files: files.map((path) => ({ path, level: "undetermined", code, reason })) };
}

/**
 * The real outliner: write the content under a private temporary directory with the file's own
 * basename (graft picks the grammar by extension) and run `graft read outline` there, killed after
 * `timeoutMs`. `dispose` removes the directory; the caller calls it once at the end of a run.
 */
export function graftOutliner(graft: string, opts: { timeoutMs?: number } = {}): Outliner & { dispose(): void; timeoutMs: number } {
  const timeoutMs = opts.timeoutMs ?? OUTLINE_TIMEOUT_MS;
  let root: string | null = null;
  let n = 0;
  const outline = async (content: string, path: string): Promise<readonly Span[] | Failure> => {
    root ??= mkdtempSync(join(tmpdir(), "footprint-outline-"));
    n += 1;
    const dir = join(root, String(n));
    mkdirSync(dir);
    const name = basename(path);
    writeFileSync(join(dir, name), content);
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([graft, "--cwd", dir, "read", "outline", name, "--json"], { cwd: dir, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" });
    } catch (e) {
      return { code: "graft.outline_failed", reason: `graft read outline could not start: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Read both streams while waiting, so a large outline cannot fill the pipe and stall; but on a
    // timeout do not wait for them: a grandchild may still hold the pipe open.
    const out = new Response(proc.stdout as ReadableStream).text();
    const errText = new Response(proc.stderr as ReadableStream).text();
    const code = await proc.exited;
    if (proc.signalCode !== null && proc.signalCode !== undefined) {
      out.catch(() => {}); errText.catch(() => {});
      return { code: "graft.outline_timeout", reason: `graft read outline ${path} did not answer within ${timeoutMs} ms and was stopped` };
    }
    const err = await errText;
    if (code !== 0) return { code: "graft.outline_failed", reason: `graft read outline ${path} exited ${code}: ${err.trim().split("\n")[0] || "(no message)"}` };
    return parseOutline(await out);
  };
  return Object.assign(outline, {
    timeoutMs,
    dispose() {
      if (root !== null) rmSync(root, { recursive: true, force: true });
      root = null;
    },
  });
}

/** One side of a comparison: a revision range, or why it has none. */
type Side = { readonly ok: true; readonly base: string; readonly head: string; readonly label: string } | ({ readonly ok: false } & Failure);

export interface AnalyseInput {
  readonly repo: string;
  readonly prs: readonly PullRequest[];
  /** The file-level edges, from `computeOverlap` without symbols. */
  readonly conflicts: readonly ConflictEdge[];
  /** The file-level overlaps with this change. */
  readonly overlapping: readonly SharedWith[];
  /** This change's own range: its merge base and head, or why it has none. Null when there is no such comparison. */
  readonly range: { readonly base: string; readonly head: string } | Failure | null;
  /** Null when graft could not be resolved. */
  readonly outliner: Outliner | null;
  readonly outlineBudget?: number;
}

async function git(repo: string, ...args: string[]): Promise<{ ok: boolean; text: string; err: string }> {
  const r = await $`git -C ${repo} ${args}`.quiet().nothrow();
  return { ok: r.exitCode === 0, text: r.text(), err: r.stderr.toString().trim() };
}

/**
 * The symbol level of every file-level edge and every overlap with this change. Bounded: only the
 * shared files of pairs that share a file are analysed, outlines are cached by blob, and past the
 * outline budget a file is undetermined with code `budget.spent`. The overlaps with this change are
 * analysed first, since they are what the report is about, then the edges in number order.
 */
export async function analyseSymbols(input: AnalyseInput): Promise<Symbols> {
  const budget = input.outlineBudget ?? OUTLINE_BUDGET;
  const timeoutMs = (input.outliner as { timeoutMs?: number } | null)?.timeoutMs ?? OUTLINE_TIMEOUT_MS;
  let outlinesRun = 0;
  const outlines = new Map<string, Promise<readonly Span[] | Failure>>();
  const sides = new Map<string, Promise<Side>>();
  const touched = new Map<string, Promise<SideResult>>();
  const byNumber = new Map(input.prs.map((p) => [p.number, p]));

  const prSide = (n: number): Promise<Side> => {
    const key = `#${n}`;
    let s = sides.get(key);
    if (s === undefined) {
      s = resolvePullSide(input.repo, byNumber.get(n));
      sides.set(key, s);
    }
    return s;
  };
  const rangeSide: Side | null = input.range === null
    ? null
    : isFailure(input.range) ? { ok: false, ...input.range } : { ok: true, base: input.range.base, head: input.range.head, label: "this change" };

  const outlineAt = async (rev: string, path: string): Promise<readonly Span[] | Failure> => {
    const blob = await git(input.repo, "rev-parse", "--verify", "--quiet", `${rev}:${path}`);
    if (!blob.ok) return { code: "git.show_failed", reason: `${path} does not exist at ${rev.slice(0, 12)}` };
    const id = blob.text.trim();
    let p = outlines.get(id);
    if (p === undefined) {
      if (outlinesRun >= budget) return { code: "budget.spent", reason: `the run's budget of ${budget} graft outline call${budget === 1 ? "" : "s"} was spent before this file was reached` };
      outlinesRun += 1;
      p = (async () => {
        const shown = await git(input.repo, "cat-file", "blob", id);
        if (!shown.ok) return { code: "git.show_failed", reason: `git cat-file blob ${id} failed: ${shown.err}` };
        return input.outliner!(shown.text, path);
      })();
      outlines.set(id, p);
    }
    return p;
  };

  const sideTouched = (side: Side, path: string): Promise<SideResult> => {
    if (!side.ok) return Promise.resolve(side);
    const key = `${side.base}..${side.head}:${path}`;
    let t = touched.get(key);
    if (t === undefined) {
      t = touchedBy(side, path);
      touched.set(key, t);
    }
    return t;
  };

  const touchedBy = async (side: Side & { ok: true }, path: string): Promise<SideResult> => {
    const diff = await git(input.repo, "diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", side.base, side.head, "--", path);
    if (!diff.ok) return { ok: false, code: "git.diff_failed", reason: `git diff ${side.base.slice(0, 12)} ${side.head.slice(0, 12)} -- ${path} failed: ${diff.err.split("\n")[0] || "(no message)"}` };
    const lines = changedLines(diff.text);
    if (lines.binary) return { ok: false, code: "git.binary", reason: `${path} is binary in ${side.label}'s change, so it has no symbols` };
    // Old lines from the merge base's outline, new lines from the head's; a side with no lines on
    // one end does not need (or spend budget on) that end's outline.
    const ends: Array<[string, number[]]> = [[side.base, lines.old], [side.head, lines.new]];
    const names = new Set<string>();
    let outside = 0;
    for (const [rev, ls] of ends) {
      if (ls.length === 0) continue;
      const spans = await outlineAt(rev, path);
      if (isFailure(spans)) return { ok: false, ...spans };
      const t = attribute(ls, spans);
      t.symbols.forEach((s) => names.add(s));
      outside += t.outside;
    }
    return { ok: true, touched: { symbols: [...names].sort(), outside } };
  };

  const fileLevel = async (path: string, a: () => Promise<Side>, b: () => Promise<Side>): Promise<FileSymbols> => {
    if (!parsableByGraft(path)) {
      const ext = extensionOf(path);
      return { path, level: "undetermined", code: "language.unsupported", reason: `graft has no grammar for ${ext === "" ? "files without an extension" : `${ext} files`}, so the file has no symbols to compare` };
    }
    if (input.outliner === null) return { path, level: "undetermined", code: "graft.not_resolved", reason: "graft could not be resolved through the package dependency, PATH or FOOTPRINT_GRAFT, so the file is compared by name only" };
    const [sa, sb] = await Promise.all([a(), b()]);
    // Sequential per file, so the budget is spent in a deterministic order.
    const ta = await sideTouched(sa, path);
    const tb = await sideTouched(sb, path);
    return classifyFile(path, ta, tb);
  };

  const overlapping = new Map<number, SymbolLevel>();
  for (const o of input.overlapping) {
    if (rangeSide === null) {
      overlapping.set(o.number, undeterminedLevel(o.sharedFiles, "symbols.not_analysed", "symbol-level analysis was not run"));
      continue;
    }
    const files: FileSymbols[] = [];
    for (const path of o.sharedFiles) files.push(await fileLevel(path, async () => rangeSide, () => prSide(o.number)));
    overlapping.set(o.number, edgeLevel(files));
  }

  const edges = new Map<string, SymbolLevel>();
  for (const e of input.conflicts) {
    const files: FileSymbols[] = [];
    for (const path of e.sharedFiles) files.push(await fileLevel(path, () => prSide(e.a), () => prSide(e.b)));
    edges.set(edgeKey(e.a, e.b), edgeLevel(files));
  }

  return { edges, overlapping, analysis: { outlinesRun, outlineBudget: budget, outlineTimeoutMs: timeoutMs } };
}

/** A pull request as a revision range: its head commit, from the merge base with its base branch. */
async function resolvePullSide(repo: string, p: PullRequest | undefined): Promise<Side> {
  if (p === undefined || p.headCommit === undefined) {
    return { ok: false, code: "gh.head_unknown", reason: `gh did not report the head commit of ${p === undefined ? "the pull request" : `#${p.number}`}` };
  }
  const head = p.headCommit;
  if (!(await git(repo, "cat-file", "-e", `${head}^{commit}`)).ok) {
    return { ok: false, code: "git.head_missing", reason: `the head commit ${head.slice(0, 12)} of #${p.number} is not in the local repository; git fetch origin pull/${p.number}/head makes it available` };
  }
  const branch = p.baseBranch ?? null;
  const candidates = branch === null ? [] : [`origin/${branch}`, branch];
  for (const ref of candidates) {
    if (!(await git(repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)).ok) continue;
    const mb = await git(repo, "merge-base", ref, head);
    const sha = mb.text.trim();
    if (mb.ok && sha !== "") return { ok: true, base: sha, head, label: `#${p.number}` };
    return { ok: false, code: "git.merge_base", reason: `git merge-base ${ref} ${head.slice(0, 12)} found no common commit for #${p.number}` };
  }
  return { ok: false, code: "git.base_missing", reason: `the base branch of #${p.number}${branch === null ? " was not reported by gh" : ` (${branch}) is not in the local repository, as origin/${branch} or ${branch}`}` };
}
