// Cross-pull-request overlap, computed. The input is a list of `{number, title, isDraft, files}`
// records, so nothing here touches the network or needs this repository to have open pull
// requests.
import { describe, expect, test } from "bun:test";
import { computeOverlap, mergeWaves, sharedFiles, unavailableOverlap, type PullRequest } from "../src/overlap.ts";
import { classifyFailure } from "../src/pulls.ts";

function pr(number: number, files: readonly string[] | null, extra: Partial<PullRequest> = {}): PullRequest {
  return { number, title: `pull request ${number}`, isDraft: false, files, ...extra };
}

describe("overlap with this change", () => {
  test("a pull request sharing a file is reported with its number and title", () => {
    const o = computeOverlap(["src/audit.ts", "README.md"], [pr(7, ["src/audit.ts", "src/other.ts"])]);
    expect(o.available).toBe(true);
    expect(o.openPullRequests).toBe(1);
    expect(o.overlapping).toEqual([
      { number: 7, title: "pull request 7", isDraft: false, sharedFiles: ["src/audit.ts"] },
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
      { a: 7, b: 9, sharedFiles: ["a.ts", "b.ts"], reason: "#7 and #9 both change a.ts and b.ts" },
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
