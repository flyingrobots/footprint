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

/** A pull request as the overlap computation needs it. `files` is null when gh did not report them. */
export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly files: readonly string[] | null;
}

/** An open pull request that touches a file this change touches. */
export interface SharedWith {
  readonly number: number;
  readonly title: string;
  readonly isDraft: boolean;
  readonly sharedFiles: readonly string[];
}

/** One edge of the conflict graph: two open pull requests that change the same files. */
export interface ConflictEdge {
  readonly a: number;
  readonly b: number;
  readonly sharedFiles: readonly string[];
  readonly reason: string;
}

/** One wave of the proposed merge order. Within a wave no two pull requests share a file. */
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
  /** This change's own pull request, excluded from `overlapping`; null when it is not known. */
  readonly self: number | null;
  readonly openPullRequests: number;
  /** The `gh pr list --limit` used, and whether the list came back at it. */
  readonly limit: number;
  readonly truncated: boolean;
  readonly overlapping: readonly SharedWith[];
  readonly conflicts: readonly ConflictEdge[];
  readonly waves: readonly Wave[];
  readonly undetermined: readonly Undetermined[];
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
export function conflictGraph(prs: readonly PullRequest[]): ConflictEdge[] {
  const known = placeable(prs);
  const edges: ConflictEdge[] = [];
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const a = known[i]!, b = known[j]!;
      const shared = sharedFiles(a.files, b.files);
      if (shared.length === 0) continue;
      edges.push({ a: a.number, b: b.number, sharedFiles: shared, reason: `#${a.number} and #${b.number} both change ${list(shared)}` });
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
export function mergeWaves(prs: readonly PullRequest[]): Wave[] {
  const groups: Array<Array<PullRequest & { files: readonly string[] }>> = [];
  for (const pr of placeable(prs)) {
    const fits = groups.find((g) => g.every((other) => sharedFiles(other.files, pr.files).length === 0));
    if (fits === undefined) groups.push([pr]);
    else fits.push(pr);
  }
  return groups.map((g, i) => ({ wave: i + 1, pullRequests: g.map((p) => p.number) }));
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
  opts: { readonly self?: number | null; readonly limit?: number } = {},
): OverlapAvailable {
  const self = opts.self ?? null;
  const limit = opts.limit ?? LIST_LIMIT;
  const mine = new Set(changed);

  const overlapping = placeable(prs).flatMap((p) => {
    if (p.number === self) return [];
    const shared = [...new Set(p.files.filter((f) => mine.has(f)))].sort();
    return shared.length === 0 ? [] : [{ number: p.number, title: p.title, isDraft: p.isDraft, sharedFiles: shared }];
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
    conflicts: conflictGraph(prs),
    waves: mergeWaves(prs),
    undetermined,
    summary: summarize(prs.length, overlapping.length, undetermined.length),
  };
}

function summarize(open: number, overlapping: number, undetermined: number): string {
  const tail = undetermined === 0
    ? ""
    : ` ${undetermined} ${plural(undetermined, "pull request's", "pull requests'")} files could not be read.`;
  if (open === 0) return `No pull request is open, so nothing can overlap this change.${tail}`;
  const requests = `${open} open ${plural(open, "pull request", "pull requests")}`;
  if (overlapping === 0) return `None of the ${requests} ${plural(open, "touches", "touch")} a file this change touches.${tail}`;
  return `${overlapping} of ${requests} ${plural(overlapping, "touches", "touch")} a file this change touches.${tail}`;
}

/** The stated limitation: gh could not answer, so the section says so rather than vanishing. */
export function unavailableOverlap(code: string, reason: string): OverlapUnavailable {
  return { available: false, code, reason, summary: `Cross-pull-request overlap unavailable: ${reason}.` };
}
