// Whether two commits merge cleanly, from `git merge-tree --write-tree` (flyingrobots/footprint#80).
//
// The symbol level says which top-level symbols two pull requests touch in a shared file; it cannot
// say whether git would conflict, and on two real repositories it left 173 of 175 shared-file
// edges undetermined (flyingrobots/footprint#79). merge-tree performs the three-way merge without a
// checkout or the index and names the conflicted paths, in about 8 ms a pair. Its answer is textual
// evidence: a clean merge is not proof that the two changes work together.
//
// A commit the clone lacks is fetched read-only, `git fetch origin pull/<n>/head` into
// `refs/footprint/pull/<n>`, the maintainer's decision; `--no-fetch` turns that off and the edge is
// `unavailable` with the command to run. Every call is bounded: a budget of merges and of fetches
// per run, and a timeout on each.

/** What one merge says. `unavailable` always carries why, so an absent answer never reads as clean. */
export type MergeResult =
  | { readonly result: "clean" }
  | { readonly result: "conflicted"; readonly paths: readonly string[] }
  | { readonly result: "unavailable"; readonly code: MergeUnavailableCode; readonly reason: string };

export type MergeUnavailableCode =
  | "merge.not_run"
  | "merge.budget_spent"
  | "git.merge_tree_unsupported"
  | "git.merge_tree_failed"
  | "git.timeout"
  | "git.head_missing"
  | "git.fetch_failed"
  | "git.head_moved";

/** One side of a merge: the commit, and the pull request whose head it is, when it is one. */
export interface Side {
  readonly commit: string;
  readonly pr?: number;
}

/** How the merges were bounded this run, carried on the result so the bound is checkable. */
export interface MergeAnalysis {
  readonly fetch: boolean;
  readonly mergesRun: number;
  readonly mergeBudget: number;
  readonly mergeTimeoutMs: number;
  readonly fetched: number;
  readonly fetchBudget: number;
  readonly fetchTimeoutMs: number;
}

export interface MergeOptions {
  readonly repo: string;
  /** Fetch a missing pull request head read-only; false is `--no-fetch`. */
  readonly fetch: boolean;
  /** The git to run; tests pass a stand-in. */
  readonly git?: string;
  readonly mergeBudget?: number;
  readonly mergeTimeoutMs?: number;
  readonly fetchBudget?: number;
  readonly fetchTimeoutMs?: number;
}

export interface MergeRunner {
  /** Make a pull request's head commit local, fetching it if allowed; null when it is local. */
  ensure(side: Side): Promise<MergeResult | null>;
  merge(a: Side, b: Side): Promise<MergeResult>;
  analysis(): MergeAnalysis;
}

export function notRun(reason = "the merge was not attempted"): MergeResult {
  return { result: "unavailable", code: "merge.not_run", reason };
}

export function mergeRunner(opts: MergeOptions): MergeRunner {
  void opts;
  throw new Error("not implemented");
}
