// Cross-pull-request overlap: which open pull requests touch a file this change touches, which of
// them touch each other's files, and an order they could land in.
//
// Everything here is a pure function over `{number, title, isDraft, files}` records. The `gh`
// invocation that produces those records lives in `src/pulls.ts`, so the computation is testable
// without the network and without this repository having open pull requests.
//
// The wave grouping is a **reimplementation** of graft's `findParallelGroups`
// (`src/operations/footprint-parallelism.ts`): greedy first-fit over a conflict graph, where a
// group holds records whose footprints do not overlap and group N+1 comes after group N. It is
// reimplemented rather than imported because footprint depends on graft's CLI contract and never
// on its source — graft's barrel does not export the function, and reaching into its `dist` is
// exactly the coupling that AGENTS.md forbids. The algorithm is twenty lines; the coupling would
// outlive it.
//
// The symbol level of a shared-file edge (flyingrobots/footprint#33) is computed in
// `src/symbols.ts` and passed in as data, so this file stays pure. A symbol-disjoint edge is
// reported and does not separate waves; an overlapping or undetermined one separates them as a
// file-level edge always did.

import { codeSpan } from "./cell.ts";
import { edgeKey, undeterminedLevel, type SymbolAnalysis, type SymbolLevel, type Symbols } from "./symbols.ts";

/** A pull request as the overlap computation needs it. `files` is null when gh did not report them. */
export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly files: readonly string[] | null;
  /** The pull request's head commit id, from `gh pr list --json headRefOid`. */
  readonly headCommit?: string;
  /** Its head branch name, from `headRefName`. */
  readonly headBranch?: string;
  /** True when the head branch lives in a fork, from `isCrossRepository`. */
  readonly crossRepository?: boolean;
  /** The branch it merges into, from `baseRefName`; named in reasons only. */
  readonly baseBranch?: string;
  /** The base branch's commit as `gh` reported it, from `baseRefOid`; the merge base is taken against this. */
  readonly baseCommit?: string;
  /**
   * True when `gh pr list`, asked again after the files were listed, reported a different head
   * commit or none: the files and `headCommit` are then not one snapshot.
   */
  readonly headMoved?: boolean;
}

/** What identifies the range's head: its commit id, and its branch name when it has one. */
export interface RangeHead {
  readonly commit: string | null;
  readonly branch: string | null;
}

/**
 * The pull request under review: the one whose head is the range's head. The commit id decides
 * first; the head branch name decides only when no pull request's head commit matches, and only
 * for a same-repository pull request, because a fork's branch of the same name is a different
 * change. When several share the deciding fact the lowest number is the one named, so the answer
 * does not follow the order `gh` listed them. Null when none matches.
 */
export function underReview(prs: readonly PullRequest[], head: RangeHead): number | null {
  const ordered = [...prs].sort((a, b) => a.number - b.number);
  if (head.commit !== null) {
    const byCommit = ordered.find((p) => p.headCommit !== undefined && p.headCommit === head.commit);
    if (byCommit !== undefined) return byCommit.number;
  }
  if (head.branch !== null) {
    const byBranch = ordered.find((p) => p.crossRepository === false && p.headBranch === head.branch);
    if (byBranch !== undefined) return byBranch.number;
  }
  return null;
}

/** An open pull request that touches a file this change touches. */
export interface SharedWith {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly sharedFiles: readonly string[];
  /** The shared files at the symbol level; side `a` is this change, side `b` this pull request. */
  readonly symbolLevel: SymbolLevel;
}

/** One edge of the conflict graph: two open pull requests that change the same files. */
export interface ConflictEdge {
  readonly a: number;
  readonly b: number;
  readonly sharedFiles: readonly string[];
  readonly reason: string;
  /** The shared files at the symbol level; sides `a` and `b` are the edge's own. */
  readonly symbolLevel: SymbolLevel;
}

/**
 * One wave of the proposed merge order. Within a wave no two pull requests share a file, unless
 * the edge between them is symbol-disjoint.
 */
export interface Wave {
  readonly wave: number;
  readonly pullRequests: readonly number[];
}

/** A pull request whose file list could not be read, and therefore cannot be placed. */
export interface Undetermined {
  readonly number: number;
  readonly title: string;
  readonly reason: string;
}

export interface OverlapAvailable {
  readonly available: true;
  /** The pull request under review (its head is the range's head), excluded from `overlapping`; null when none matches. */
  readonly self: number | null;
  readonly openPullRequests: number;
  /** The `gh pr list --limit` used, and whether the list came back at it. */
  readonly limit: number;
  readonly truncated: boolean;
  readonly overlapping: readonly SharedWith[];
  readonly conflicts: readonly ConflictEdge[];
  readonly waves: readonly Wave[];
  readonly undetermined: readonly Undetermined[];
  /** How the symbol level was bounded this run. */
  readonly symbolAnalysis: SymbolAnalysis;
  readonly summary: string;
}

export interface OverlapUnavailable {
  readonly available: false;
  readonly code: string;
  readonly reason: string;
  readonly summary: string;
}

export type Overlap = OverlapAvailable | OverlapUnavailable;

/** How many pull requests `gh pr list` is asked for. The result says when the list came back at it. */
export const LIST_LIMIT = 100;

/** The sorted intersection of two path lists. Two pull requests conflict when it is not empty. */
export function sharedFiles(a: readonly string[], b: readonly string[]): string[] {
  const inB = new Set(b);
  return [...new Set(a.filter((p) => inB.has(p)))].sort();
}

/** Ascending by number, so a plan does not depend on the order gh happened to list them. */
function byNumber(prs: readonly PullRequest[]): PullRequest[] {
  return [...prs].sort((x, y) => x.number - y.number);
}

/** The pull requests whose files are known; the rest cannot be placed without guessing. */
function placeable(prs: readonly PullRequest[]): Array<PullRequest & { files: readonly string[] }> {
  return byNumber(prs).flatMap((p) => (p.files === null ? [] : [{ ...p, files: p.files }]));
}

/**
 * Every unordered pair of open pull requests that change the same file, with the files named.
 * These are the edges the merge order has to respect.
 */
export function conflictGraph(prs: readonly PullRequest[], symbols?: Symbols): ConflictEdge[] {
  const known = placeable(prs);
  const edges: ConflictEdge[] = [];
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const a = known[i]!, b = known[j]!;
      const shared = sharedFiles(a.files, b.files);
      if (shared.length === 0) continue;
      const symbolLevel = symbols?.edges.get(edgeKey(a.number, b.number)) ?? notAnalysed(shared);
      edges.push({ a: a.number, b: b.number, sharedFiles: shared, reason: edgeReason(a.number, b.number, shared, symbolLevel), symbolLevel });
    }
  }
  return edges;
}

/**
 * Partition the open pull requests into waves: greedy first-fit, so a pull request goes into the
 * first wave none of whose members it conflicts with. Wave N+1 lands after wave N. This is a
 * proposal, not an optimum — greedy colouring can use more waves than the graph needs — and it is
 * deterministic because the input is sorted by number first.
 */
export function mergeWaves(prs: readonly PullRequest[], symbols?: Symbols): Wave[] {
  const groups: Array<Array<PullRequest & { files: readonly string[] }>> = [];
  // Two pull requests are kept apart when they share a file, unless that edge is symbol-disjoint.
  const apart = (x: PullRequest & { files: readonly string[] }, y: PullRequest & { files: readonly string[] }): boolean =>
    sharedFiles(x.files, y.files).length > 0 && symbols?.edges.get(edgeKey(x.number, y.number))?.level !== "symbol-disjoint";
  for (const pr of placeable(prs)) {
    const fits = groups.find((g) => g.every((other) => !apart(other, pr)));
    if (fits === undefined) groups.push([pr]);
    else fits.push(pr);
  }
  return groups.map((g, i) => ({ wave: i + 1, pullRequests: g.map((p) => p.number) }));
}

/** What an edge or an overlap carries when no symbol analysis was given. */
function notAnalysed(files: readonly string[]): SymbolLevel {
  return undeterminedLevel(files, "symbols.not_analysed", "symbol-level analysis was not run");
}

/** Why the edge exists, and what the symbol level says about it, in prose. */
function edgeReason(a: number, b: number, shared: readonly string[], level: SymbolLevel): string {
  const base = `#${a} and #${b} both change ${list(shared.map(codeSpan))}`;
  if (level.level === "symbol-disjoint") return `${base}, but different symbols in ${shared.length === 1 ? "it" : "each"}, so the edge does not separate waves`;
  if (level.level === "symbol-overlapping") {
    const same = level.files.filter((f) => f.level === "symbol-overlapping").map((f) => f.path);
    return `${base}, and the same symbols in ${list(same.map(codeSpan))}`;
  }
  return `${base}; the symbol level is undetermined, so the edge separates waves as a file-level one does`;
}

/** Prose for a path list: `a.ts`, `a.ts and b.ts`, `a.ts, b.ts and c.ts`. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The overlap result. `changed` is what this change touches, from `git diff --numstat`; `prs` are
 * the open pull requests. A pull request whose files are unknown is reported as undetermined
 * rather than assumed disjoint: an absent signal must not read as a clean one.
 */
export function computeOverlap(
  changed: readonly string[],
  prs: readonly PullRequest[],
  opts: { readonly self?: number | null; readonly limit?: number; readonly symbols?: Symbols } = {},
): OverlapAvailable {
  const self = opts.self ?? null;
  const limit = opts.limit ?? LIST_LIMIT;
  const mine = new Set(changed);

  const overlapping = placeable(prs).flatMap((p) => {
    if (p.number === self) return [];
    const shared = [...new Set(p.files.filter((f) => mine.has(f)))].sort();
    if (shared.length === 0) return [];
    const symbolLevel = opts.symbols?.overlapping.get(p.number) ?? notAnalysed(shared);
    return [{ number: p.number, title: p.title, isDraft: p.isDraft, sharedFiles: shared, symbolLevel }];
  });

  const undetermined = byNumber(prs).flatMap((p) =>
    p.files === null ? [{ number: p.number, title: p.title, reason: `gh did not report the changed files of #${p.number}` }] : [],
  );

  return {
    available: true,
    self,
    openPullRequests: prs.length,
    limit,
    truncated: prs.length >= limit,
    overlapping,
    conflicts: conflictGraph(prs, opts.symbols),
    waves: mergeWaves(prs, opts.symbols),
    undetermined,
    symbolAnalysis: opts.symbols?.analysis ?? { outlinesRun: 0, outlineBudget: 0, outlineTimeoutMs: 0, remoteCalls: 0, remoteBudget: 0, remoteTimeoutMs: 0 },
    summary: summarize(prs.length, overlapping.length, undetermined.length, self !== null && prs.some((p) => p.number === self)),
  };
}

function summarize(listed: number, overlapping: number, undetermined: number, hasSelf: boolean): string {
  // The pull request under review is not a candidate for overlap, so it is not in the count.
  const open = hasSelf ? listed - 1 : listed;
  const other = hasSelf ? "other " : "";
  const tail = undetermined === 0
    ? ""
    : ` ${undetermined} ${plural(undetermined, "pull request's", "pull requests'")} files could not be read.`;
  if (open === 0) return `No ${hasSelf ? "other " : ""}pull request is open, so nothing can overlap this change.${tail}`;
  const requests = `${open} ${other}open ${plural(open, "pull request", "pull requests")}`;
  if (overlapping === 0) return `None of the ${requests} ${plural(open, "touches", "touch")} a file this change touches.${tail}`;
  return `${overlapping} of ${requests} ${plural(overlapping, "touches", "touch")} a file this change touches.${tail}`;
}

/** The stated limitation: gh could not answer, so the section says so rather than vanishing. */
export function unavailableOverlap(code: string, reason: string): OverlapUnavailable {
  return { available: false, code, reason, summary: `Cross-pull-request overlap unavailable: ${reason}.` };
}
