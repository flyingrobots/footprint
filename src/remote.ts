// Read-only GitHub API fallback for the symbol level (flyingrobots/footprint#55).
//
// A pull request's head (or base) commit is often not in the local clone: a fork's head in CI, any
// pull request nobody fetched. The symbol level then reads that side over `gh api` instead of
// asking for a `git fetch`, which would write to `.git`; footprint declares no writes.
//
// Two calls, both GET, both naming only commit ids and the file's own path:
//
//   gh api repos/{owner}/{repo}/compare/<baseRefOid>...<headRefOid>
//   gh api -H 'Accept: application/vnd.github.raw' repos/{owner}/{repo}/contents/<path>?ref=<sha>
//
// `{owner}/{repo}` is gh's own placeholder, filled from the working directory's remote. The
// compare of two commit ids is exact: `merge_base_commit.sha` is the merge base, and each file's
// `patch` is the diff from that merge base to the head, the same comparison `git diff <merge-base>
// <head>` makes locally. (`gh pr diff` is not used: it diffs against the pull request's *current*
// merge base, which can differ from the one the commits pin, flyingrobots/footprint#55.) The
// contents are read at the merge base and at the head, by commit id, never a branch name.
//
// Whatever cannot be tied to exact commits is a failure with a code, never an empty answer: a
// compare without a commit-id merge base, a file with no patch (GitHub omits one for binary and
// very large diffs) or renamed, a file the compare did not list (its file list is capped), a
// rate limit, a timeout, a call past the budget, contents over 1 MiB.

import type { Failure } from "./symbols.ts";
import { classifyFailure } from "./pulls.ts";

/** At most this many `gh api` calls per run: a compare per pull request and a contents read per end of each shared file. */
export const REMOTE_BUDGET = 32;
/** Each call is stopped after this long. */
export const REMOTE_TIMEOUT_MS = 20_000;
/** Contents larger than this are not read; the file is undetermined. */
export const MAX_CONTENT_BYTES = 1024 * 1024;

/** A compare, read as the merge base it pins and each file's patch (or why it has none). */
export interface RemoteCompare {
  readonly mergeBase: string;
  readonly patches: ReadonlyMap<string, string | Failure>;
}

export interface Remote {
  compare(base: string, head: string): Promise<RemoteCompare | Failure>;
  content(sha: string, path: string): Promise<string | Failure>;
  stats(): { readonly calls: number; readonly budget: number; readonly timeoutMs: number };
}

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** `gh api repos/.../compare/...` as the merge base it pins and the patches of its files. Pure. */
export function parseCompare(text: string): RemoteCompare | Failure {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { code: "gh.compare_unpinned", reason: "the GitHub compare answered output that is not JSON, so there is no exact merge base" };
  }
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as { merge_base_commit?: { sha?: unknown }; files?: unknown }) : null;
  const sha = o?.merge_base_commit?.sha;
  if (typeof sha !== "string" || !COMMIT.test(sha)) {
    return { code: "gh.compare_unpinned", reason: "the GitHub compare did not state its merge base as a commit id (merge_base_commit.sha), so the comparison is not pinned to exact commits" };
  }
  if (!Array.isArray(o?.files)) return { code: "gh.compare_unpinned", reason: "the GitHub compare carried no file list" };
  const patches = new Map<string, string | Failure>();
  for (const f of o.files as unknown[]) {
    const e = typeof f === "object" && f !== null ? (f as { filename?: unknown; status?: unknown; patch?: unknown }) : null;
    if (e === null || typeof e.filename !== "string") continue;
    if (e.status === "renamed" || e.status === "copied") {
      patches.set(e.filename, { code: "gh.patch_unavailable", reason: `GitHub reports ${e.filename} as ${String(e.status)}, and its patch is against another path; footprint reads renames as unknown rather than guess` });
    } else if (typeof e.patch !== "string") {
      patches.set(e.filename, { code: "gh.patch_unavailable", reason: `GitHub gave no patch for ${e.filename} (it omits one for binary files and very large diffs)` });
    } else {
      patches.set(e.filename, e.patch);
    }
  }
  return { mergeBase: sha, patches };
}

/** The path of a contents read: each segment percent-encoded, so `#`, `?` and `%` in a file name stay in the path. */
export function contentsPath(sha: string, path: string): string {
  return `repos/{owner}/{repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`;
}

interface Ran { readonly code: number; readonly out: string; readonly err: string }

/** `gh` with its stdout capped; killed at the deadline, or when stdout passes the cap. */
async function runGh(gh: string, cwd: string, args: string[], timeoutMs: number, maxBytes: number): Promise<Ran | "timeout" | "too_large"> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([gh, ...args], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" });
  } catch (e) {
    return { code: 127, out: "", err: `gh could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
  const outReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const errReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  let tooLarge = false;
  const drain = async (reader: ReadableStreamDefaultReader<Uint8Array>, cap: number, isOut: boolean): Promise<string> => {
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.length;
      if (bytes > cap) {
        if (isOut) { tooLarge = true; proc.kill("SIGKILL"); }
        reader.cancel().catch(() => {});
        return text;
      }
      text += decoder.decode(value, { stream: true });
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  const done = Promise.all([proc.exited, drain(outReader, maxBytes, true), drain(errReader, 64 * 1024, false)]);
  const settled = await Promise.race([done, deadline]);
  clearTimeout(timer);
  if (settled === "timeout") {
    proc.kill("SIGKILL");
    outReader.cancel().catch(() => {}); errReader.cancel().catch(() => {});
    done.catch(() => {});
    return "timeout";
  }
  if (tooLarge) return "too_large";
  const [code, out, err] = settled;
  if (proc.signalCode !== null && proc.signalCode !== undefined) return "timeout";
  return { code, out, err };
}

/**
 * The real remote reader, over `gh`. Bounded like the outline calls: `budget` calls per run
 * (counted when started, cached by request), `timeoutMs` each. After a rate limit no further call
 * is made, since each would only fail the same way.
 */
export function ghRemote(gh: string, cwd: string, opts: { budget?: number; timeoutMs?: number } = {}): Remote {
  const budget = opts.budget ?? REMOTE_BUDGET;
  const timeoutMs = opts.timeoutMs ?? REMOTE_TIMEOUT_MS;
  let calls = 0;
  let limited: Failure | null = null;
  const cache = new Map<string, Promise<unknown>>();

  /** One bounded call, or why not. `args` are the whole `gh` argument list. */
  const call = async (args: string[], what: string, maxBytes: number): Promise<string | Failure> => {
    if (limited !== null) return limited;
    if (calls >= budget) return { code: "gh.budget_spent", reason: `the run's budget of ${budget} gh api call${budget === 1 ? "" : "s"} was spent before ${what} was read` };
    calls += 1;
    const r = await runGh(gh, cwd, args, timeoutMs, maxBytes);
    if (r === "timeout") return { code: "gh.timeout", reason: `gh api for ${what} did not answer within ${timeoutMs} ms and was stopped` };
    if (r === "too_large") return { code: "gh.content_too_large", reason: `${what} is larger than ${MAX_CONTENT_BYTES} bytes, which footprint does not read` };
    if (r.code !== 0) {
      const f = classifyFailure(r.err, r.code);
      const failure: Failure = f.code === "gh.rate_limited" ? f : { code: "gh.remote_failed", reason: `gh api for ${what} failed: ${f.reason}` };
      if (failure.code === "gh.rate_limited") limited = failure;
      return failure;
    }
    return r.out;
  };

  const once = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    let p = cache.get(key) as Promise<T> | undefined;
    if (p === undefined) { p = make(); cache.set(key, p); }
    return p;
  };

  return {
    compare: (base, head) => {
      if (!COMMIT.test(base) || !COMMIT.test(head)) return Promise.resolve({ code: "gh.compare_unpinned", reason: "the base or head is not a full commit id, so the compare is not pinned to exact commits" });
      return once(`compare\0${base}\0${head}`, async () => {
        const out = await call(["api", `repos/{owner}/{repo}/compare/${base}...${head}`], `the compare ${base.slice(0, 12)}...${head.slice(0, 12)}`, 64 * MAX_CONTENT_BYTES);
        return typeof out === "string" ? parseCompare(out) : out;
      });
    },
    content: (sha, path) => {
      if (!COMMIT.test(sha)) return Promise.resolve({ code: "gh.compare_unpinned", reason: "the revision is not a full commit id, so its content is not pinned" });
      return once(`content\0${sha}\0${path}`, () => call(["api", "-H", "Accept: application/vnd.github.raw", contentsPath(sha, path)], `${path} at ${sha.slice(0, 12)}`, MAX_CONTENT_BYTES));
    },
    stats: () => ({ calls, budget, timeoutMs }),
  };
}
