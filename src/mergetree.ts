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

/** Defaults: generous for a real repository (the spike's keep had 46 pairs), bounded for a large one. */
export const MERGE_BUDGET = 300;
export const MERGE_TIMEOUT_MS = 10_000;
export const FETCH_BUDGET = 100;
export const FETCH_TIMEOUT_MS = 30_000;

/** Merge settings pinned to git's defaults, so a user's config cannot change which paths conflict. */
const PINNED = ["-c", "merge.renames=true", "-c", "merge.directoryRenames=conflict", "-c", "core.attributesFile=/dev/null"];

interface Ran {
  readonly code: number | "timeout";
  readonly out: string;
  readonly err: string;
}

async function spawn(cmd: readonly string[], cwd: string, timeoutMs: number): Promise<Ran> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, timeoutMs);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  return { code: timedOut ? "timeout" : code, out, err };
}

const unavailable = (code: MergeUnavailableCode, reason: string): MergeResult => ({ result: "unavailable", code, reason });
const short = (commit: string) => commit.slice(0, 12);

export function mergeRunner(opts: MergeOptions): MergeRunner {
  const git = opts.git ?? "git";
  const mergeBudget = opts.mergeBudget ?? MERGE_BUDGET;
  const mergeTimeoutMs = opts.mergeTimeoutMs ?? MERGE_TIMEOUT_MS;
  const fetchBudget = opts.fetchBudget ?? FETCH_BUDGET;
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  let mergesRun = 0;
  let fetched = 0;
  let unsupported: MergeResult | null = null;
  const merges = new Map<string, Promise<MergeResult>>();
  const ensured = new Map<string, Promise<MergeResult | null>>();

  const present = async (commit: string) =>
    (await spawn([git, "cat-file", "-e", `${commit}^{commit}`], opts.repo, fetchTimeoutMs)).code === 0;

  const ensureOnce = async (side: Side): Promise<MergeResult | null> => {
    if (await present(side.commit)) return null;
    if (side.pr === undefined) return unavailable("git.head_missing", `the commit ${short(side.commit)} is not in the local repository`);
    const fetchCmd = `git fetch origin pull/${side.pr}/head`;
    if (!opts.fetch) return unavailable("git.head_missing", `the head commit ${short(side.commit)} of #${side.pr} is not in the local repository, and --no-fetch was given; ${fetchCmd} makes it available`);
    if (fetched >= fetchBudget) return unavailable("git.head_missing", `the head commit ${short(side.commit)} of #${side.pr} is not in the local repository, and this run's ${fetchBudget} fetches are spent; ${fetchCmd} makes it available`);
    fetched += 1;
    const ref = `refs/footprint/pull/${side.pr}`;
    const r = await spawn([git, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "origin", `+refs/pull/${side.pr}/head:${ref}`], opts.repo, fetchTimeoutMs);
    if (r.code === "timeout") return unavailable("git.timeout", `${fetchCmd} did not answer within ${fetchTimeoutMs} ms and was stopped`);
    if (r.code !== 0) return unavailable("git.fetch_failed", `${fetchCmd} failed: ${r.err.trim().split("\n")[0] || "(no message)"}`);
    if (await present(side.commit)) return null;
    const now = (await spawn([git, "rev-parse", "--verify", "--quiet", ref], opts.repo, fetchTimeoutMs)).out.trim();
    return unavailable("git.head_moved", `#${side.pr}'s head is now ${short(now) || "unknown"}, not the ${short(side.commit)} gh listed; it is not merged at a head the rest of this run did not see`);
  };

  const ensure = (side: Side): Promise<MergeResult | null> => {
    const key = `${side.commit}\0${side.pr ?? ""}`;
    let p = ensured.get(key);
    if (p === undefined) ensured.set(key, (p = ensureOnce(side)));
    return p;
  };

  const mergeOnce = async (a: Side, b: Side): Promise<MergeResult> => {
    for (const side of [a, b]) {
      const missing = await ensure(side);
      if (missing !== null) return missing;
    }
    if (unsupported !== null) return unsupported;
    if (mergesRun >= mergeBudget) return unavailable("merge.budget_spent", `this run's ${mergeBudget} merges are spent`);
    mergesRun += 1;
    const r = await spawn([git, ...PINNED, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", a.commit, b.commit], opts.repo, mergeTimeoutMs);
    if (r.code === "timeout") return unavailable("git.timeout", `git merge-tree ${short(a.commit)} ${short(b.commit)} did not answer within ${mergeTimeoutMs} ms and was stopped`);
    if (r.code === 0) return { result: "clean" };
    if (r.code === 1) {
      // -z: the merged tree's id, then each conflicted path once per conflicted stage.
      const paths = [...new Set(r.out.split("\0").slice(1).filter((p) => p !== ""))].sort();
      return { result: "conflicted", paths };
    }
    const message = r.err.trim().split("\n")[0] || "(no message)";
    if (/unknown option|usage: git merge-tree/i.test(r.err)) {
      unsupported = unavailable("git.merge_tree_unsupported", `this git has no merge-tree --write-tree (git 2.38 or later): ${message}`);
      return unsupported;
    }
    return unavailable("git.merge_tree_failed", `git merge-tree ${short(a.commit)} ${short(b.commit)} exited ${r.code}: ${message}`);
  };

  return {
    ensure,
    merge(a, b) {
      const key = [a.commit, b.commit].sort().join("\0");
      let p = merges.get(key);
      if (p === undefined) merges.set(key, (p = mergeOnce(a, b)));
      return p;
    },
    analysis: () => ({ fetch: opts.fetch, mergesRun, mergeBudget, mergeTimeoutMs, fetched, fetchBudget, fetchTimeoutMs }),
  };
}
