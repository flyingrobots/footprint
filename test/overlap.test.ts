// Cross-pull-request overlap, computed. The input is a list of `{number, title, isDraft, files}`
// records, so nothing here touches the network or needs this repository to have open pull
// requests.
import { describe, expect, test } from "bun:test";
import { computeOverlap, mergeWaves, sharedFiles, unavailableOverlap, type PullRequest } from "../src/overlap.ts";
import { classifyFailure } from "../src/pulls.ts";

/** What an overlap or an edge carries when no symbol analysis was passed in (footprint.overlap 2.x). */
function notAnalysed(files: string[]) {
  return { level: "undetermined", files: files.map((path) => ({ path, level: "undetermined", code: "symbols.not_analysed", reason: "symbol-level analysis was not run" })) };
}

function pr(number: number, files: readonly string[] | null, extra: Partial<PullRequest> = {}): PullRequest {
  return { number, title: `pull request ${number}`, isDraft: false, files, ...extra };
}

describe("overlap with this change", () => {
  test("a pull request sharing a file is reported with its number and title", () => {
    const o = computeOverlap(["src/audit.ts", "README.md"], [pr(7, ["src/audit.ts", "src/other.ts"])]);
    expect(o.available).toBe(true);
    expect(o.openPullRequests).toBe(1);
    expect(o.overlapping).toEqual([
      { number: 7, title: "pull request 7", isDraft: false, sharedFiles: ["src/audit.ts"], symbolLevel: notAnalysed(["src/audit.ts"]) },
    ]);
    expect(o.summary).toBe("1 of 1 open pull request touches a file this change touches.");
  });

  test("a disjoint pull request is not reported as overlapping", () => {
    const o = computeOverlap(["src/audit.ts"], [pr(7, ["docs/README.md"])]);
    expect(o.overlapping).toEqual([]);
    expect(o.summary).toBe("None of the 1 open pull request touches a file this change touches.");
  });

  test("no open pull requests is a plain statement, not an empty section", () => {
    const o = computeOverlap(["src/audit.ts"], []);
    expect(o.openPullRequests).toBe(0);
    expect(o.overlapping).toEqual([]);
    expect(o.conflicts).toEqual([]);
    expect(o.waves).toEqual([]);
    expect(o.summary).toBe("No pull request is open, so nothing can overlap this change.");
  });

  test("this change's own pull request is excluded from the overlap, and kept in the plan", () => {
    const o = computeOverlap(["src/audit.ts"], [pr(7, ["src/audit.ts"]), pr(9, ["src/audit.ts"])], { self: 7 });
    expect(o.self).toBe(7);
    expect(o.overlapping.map((x) => x.number)).toEqual([9]);
    expect(o.waves.flatMap((w) => w.pullRequests)).toEqual([7, 9]);
  });

  test("a draft pull request is reported as a draft rather than hidden", () => {
    const o = computeOverlap(["src/audit.ts"], [pr(7, ["src/audit.ts"], { isDraft: true })]);
    expect(o.overlapping[0]).toMatchObject({ number: 7, isDraft: true });
  });

  test("a pull request whose files could not be read is undetermined, never assumed disjoint", () => {
    const o = computeOverlap(["src/audit.ts"], [pr(7, null), pr(9, ["src/audit.ts"])]);
    expect(o.undetermined).toEqual([{ number: 7, title: "pull request 7", reason: "gh did not report the changed files of #7" }]);
    expect(o.overlapping.map((x) => x.number)).toEqual([9]);
    expect(o.waves.flatMap((w) => w.pullRequests)).not.toContain(7);
    expect(o.summary).toContain("1 pull request's files could not be read");
  });

  test("a list at the limit says it is truncated", () => {
    const prs = Array.from({ length: 3 }, (_, i) => pr(i + 1, [`src/${i}.ts`]));
    const o = computeOverlap(["src/0.ts"], prs, { limit: 3 });
    expect(o.limit).toBe(3);
    expect(o.truncated).toBe(true);
    expect(computeOverlap(["src/0.ts"], prs, { limit: 4 }).truncated).toBe(false);
  });
});

describe("the conflict graph", () => {
  test("an edge names the files the two pull requests share", () => {
    const o = computeOverlap([], [pr(7, ["a.ts", "b.ts"]), pr(9, ["b.ts", "a.ts"]), pr(11, ["c.ts"])]);
    expect(o.conflicts).toEqual([
      {
        a: 7,
        b: 9,
        sharedFiles: ["a.ts", "b.ts"],
        reason: "#7 and #9 both change `a.ts` and `b.ts`; the symbol level is undetermined, so the edge separates waves as a file-level one does",
        symbolLevel: notAnalysed(["a.ts", "b.ts"]),
      },
    ]);
  });

  test("a pull request with no files conflicts with nothing", () => {
    const o = computeOverlap([], [pr(7, []), pr(9, ["a.ts"])]);
    expect(o.conflicts).toEqual([]);
    expect(o.waves).toEqual([{ wave: 1, pullRequests: [7, 9] }]);
  });

  test("shared files are the sorted intersection", () => {
    expect(sharedFiles(["b", "a", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(sharedFiles(["a"], ["b"])).toEqual([]);
  });
});

describe("merge waves", () => {
  test("overlapping pull requests land in different waves and disjoint ones share a wave", () => {
    const waves = mergeWaves([pr(7, ["a.ts"]), pr(9, ["a.ts"]), pr(11, ["b.ts"])]);
    expect(waves).toEqual([
      { wave: 1, pullRequests: [7, 11] },
      { wave: 2, pullRequests: [9] },
    ]);
  });

  test("one pull request is one wave", () => {
    expect(mergeWaves([pr(7, ["a.ts"])])).toEqual([{ wave: 1, pullRequests: [7] }]);
  });

  test("no pull requests is no waves", () => {
    expect(mergeWaves([])).toEqual([]);
  });

  test("the plan does not depend on the order the pull requests were listed", () => {
    const a = mergeWaves([pr(11, ["b.ts"]), pr(9, ["a.ts"]), pr(7, ["a.ts"])]);
    const b = mergeWaves([pr(7, ["a.ts"]), pr(9, ["a.ts"]), pr(11, ["b.ts"])]);
    expect(a).toEqual(b);
  });
});

describe("the stated limitation", () => {
  test("an unavailable overlap carries a code and a reason, and is still a result", () => {
    const o = unavailableOverlap("gh.not_found", "gh is not installed or not on PATH");
    expect(o).toEqual({
      available: false,
      code: "gh.not_found",
      reason: "gh is not installed or not on PATH",
      summary: "Cross-pull-request overlap unavailable: gh is not installed or not on PATH.",
    });
  });
});

// classifyFailure is pure over the text gh wrote: no gh is run here either.
describe("why gh could not answer", () => {
  const cases: Array<[string, string]> = [
    ["gh auth login", "gh.unauthenticated"],
    ["You are not logged in to any GitHub hosts", "gh.unauthenticated"],
    ["HTTP 401: Bad credentials", "gh.unauthenticated"],
    ["API rate limit exceeded for user ID 1", "gh.rate_limited"],
    ["none of the git remotes configured for this repository point to a known GitHub host", "gh.no_remote"],
    ["something else entirely", "gh.list_failed"],
  ];
  for (const [said, code] of cases) {
    test(`${JSON.stringify(said)} is ${code}`, () => {
      const f = classifyFailure(said, 1);
      expect(f.code).toBe(code);
      expect(f.reason).toBe(said);
      expect(unavailableOverlap(f.code, f.reason).summary).toBe(`Cross-pull-request overlap unavailable: ${said}.`);
    });
  }

  test("a silent failure still carries a reason, with the exit code", () => {
    expect(classifyFailure("   \n", 4).reason).toBe("(no message, exit 4)");
  });

  test("a multi-line message is kept whole", () => {
    expect(classifyFailure("first line\nsecond line\n", 1).reason).toBe("first line; second line");
  });
});

// ---- the pull request under review (flyingrobots/footprint#29) -----------------------------------

import { underReview } from "../src/overlap.ts";
import { OVERLAP_SCHEMA } from "../src/report.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

describe("overlap with this change > the pull request under review", () => {
  test("the pull request whose head commit is the range head is excluded and named", () => {
    const prs = [pr(7, ["src/a.ts"], { headCommit: SHA_A, headBranch: "feat" }), pr(9, ["src/a.ts"], { headCommit: SHA_B, headBranch: "other" })];
    const self = underReview(prs, { commit: SHA_A, branch: "feat" });
    expect(self).toBe(7);
    const o = computeOverlap(["src/a.ts"], prs, { self });
    expect(o.self).toBe(7);
    expect(o.overlapping.map((x) => x.number)).toEqual([9]);
    expect(o.waves.flatMap((w) => w.pullRequests)).toEqual([7, 9]);
  });

  test("with no pull request under review, self is null and present", () => {
    expect(underReview([], { commit: SHA_A, branch: "feat" })).toBeNull();
    expect(underReview([pr(9, ["x"], { headCommit: SHA_B, headBranch: "other" })], { commit: SHA_A, branch: "feat" })).toBeNull();
    const o = computeOverlap(["src/a.ts"], [], { self: null });
    expect("self" in o).toBe(true);
    expect(o.self).toBeNull();
  });

  test("the head matches by commit when the branch names differ", () => {
    const prs = [pr(7, ["src/a.ts"], { headCommit: SHA_A, headBranch: "renamed-on-github" })];
    expect(underReview(prs, { commit: SHA_A, branch: "local-name" })).toBe(7);
    expect(underReview(prs, { commit: SHA_A, branch: null })).toBe(7);
  });

  test("a fork's pull request that shares the branch name is not excluded", () => {
    const prs = [pr(7, ["src/a.ts"], { headCommit: SHA_B, headBranch: "feat", crossRepository: true })];
    expect(underReview(prs, { commit: SHA_A, branch: "feat" })).toBeNull();
  });

  test("a same-repository head branch is the fallback when no commit matches", () => {
    const prs = [pr(7, ["src/a.ts"], { headCommit: SHA_B, headBranch: "feat", crossRepository: false })];
    expect(underReview(prs, { commit: SHA_A, branch: "feat" })).toBe(7);
    expect(underReview(prs, { commit: SHA_A, branch: null })).toBeNull();
  });

  test("a commit match outranks a branch-name match", () => {
    const prs = [
      pr(5, ["x"], { headCommit: SHA_B, headBranch: "feat", crossRepository: false }),
      pr(8, ["x"], { headCommit: SHA_A, headBranch: "elsewhere", crossRepository: false }),
    ];
    expect(underReview(prs, { commit: SHA_A, branch: "feat" })).toBe(8);
  });

  test("a commit match on a fork's pull request still counts: it is the same commit", () => {
    const prs = [pr(7, ["x"], { headCommit: SHA_C, headBranch: "feat", crossRepository: true })];
    expect(underReview(prs, { commit: SHA_C, branch: null })).toBe(7);
  });

  test("the summary counts the other open pull requests", () => {
    const prs = [pr(7, ["src/a.ts"]), pr(9, ["src/a.ts"]), pr(11, ["docs/x.md"])];
    const o = computeOverlap(["src/a.ts"], prs, { self: 7 });
    expect(o.summary).toBe("1 of 2 other open pull requests touches a file this change touches.");
    const alone = computeOverlap(["src/a.ts"], [pr(7, ["src/a.ts"])], { self: 7 });
    expect(alone.summary).toBe("No other pull request is open, so nothing can overlap this change.");
    expect(alone.overlapping).toEqual([]);
  });

  test("self is required by the overlap schema", () => {
    const available = (OVERLAP_SCHEMA as { properties: { overlap: { oneOf: Array<{ required: string[] }> } } }).properties.overlap.oneOf[0]!;
    expect(available.required).toContain("self");
  });
});

describe("an edge reason names its shared paths as code (flyingrobots/footprint#66, review round 3)", () => {
  test("a shared path with Markdown characters is a code span in the reason, never bare", () => {
    const o = computeOverlap(["src/**bold**.ts"], [pr(7, ["src/**bold**.ts"]), pr(8, ["src/**bold**.ts"])]);
    const reasons = [...o.conflicts.map((c) => c.reason)];
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) expect(r).toContain("`src/**bold**.ts`");
  });
});
