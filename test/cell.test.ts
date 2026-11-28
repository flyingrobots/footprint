// A bare @handle in a GitHub comment notifies that user or team, and footprint edits its one
// comment on every run (flyingrobots/footprint#78). Every cell of text footprint did not write goes
// through cellText, so that is where a handle is wrapped as code.
import { describe, expect, test } from "bun:test";
import { cellText } from "../src/cell.ts";
import { landingPlan } from "../src/landing.ts";
import { computeOverlap, type PullRequest } from "../src/overlap.ts";
import { renderLanding, renderOverlap } from "../src/render.ts";

/**
 * A bare mention as GitHub's renderer reads one (checked with gh api markdown, review round 1):
 * `@`, `\@`, `&#64;`, `&#x40;` or `&commat;`, not after a letter or digit, then a name. `_@x_`
 * is one, because the underscores become emphasis; `a_@x` is not, but footprint wraps it anyway.
 */
const BARE = /(?<![A-Za-z0-9])(?:\\?@|&#0*64;|&#[xX]0*40;|&commat;)[A-Za-z0-9]/;

/**
 * The text outside code spans, which is where a mention can notify anyone. An escaped backtick
 * (\`) is literal and opens no span; an unmatched backtick is literal too, so it stays outside.
 */
function outsideCode(text: string): string {
  const spans = text.replace(/https?:\/\/[^\s<>|`]+/g, " ").replace(/\\`/g, " ").replace(/<code>[^<]*<\/code>/g, " ");
  return spans.split(/(`+)([^`]*?[^`])\1(?!`)/).filter((_, i) => i % 3 === 0).join(" ");
}

describe("no bare @handle reaches a comment (flyingrobots/footprint#78)", () => {
  test("a user and a team handle are wrapped in <code>", () => {
    expect(cellText("ping @octocat and @org/team")).toBe("ping <code>@octocat</code> and <code>@org/team</code>");
  });

  test("a handle at either end of a cell is wrapped", () => {
    expect(cellText("@a-b did it")).toBe("<code>@a-b</code> did it");
    expect(cellText("done by @a")).toBe("done by <code>@a</code>");
  });

  test("a handle already in a code span is left alone, and never double-wrapped", () => {
    expect(cellText("see `@octocat` and ``x @y``")).toBe("see `@octocat` and ``x @y``");
  });

  test("a stray backtick before a handle cannot shield it, and is escaped", () => {
    expect(cellText("`@octocat")).toBe("\\`<code>@octocat</code>");
  });

  test("a handle right before an existing code span leaves the span as it was", () => {
    expect(cellText("@1`..`")).toBe("<code>@1</code>`..`");
  });

  test("every other spelling GitHub reads as a mention is wrapped too", () => {
    expect(cellText("_@octocat_")).toBe("_<code>@octocat</code>_");
    expect(cellText("\\@octocat")).toBe("<code>@octocat</code>");
    expect(cellText("&#64;octocat &#x40;octocat &commat;octocat")).toBe("<code>@octocat</code> <code>@octocat</code> <code>@octocat</code>");
  });

  test("a URL is left as it is: GitHub makes no mention inside a link", () => {
    expect(cellText("see https://www.npmjs.com/package/@flyingrobots/footprint")).toBe("see https://www.npmjs.com/package/@flyingrobots/footprint");
  });

  test("an email address and a lone @ are not mentions and are left as they are", () => {
    expect(cellText("mail a@b.dev")).toBe("mail a@b.dev");
    expect(cellText("x @ y")).toBe("x @ y");
  });

  test("property: no cell of random text carries a bare mention outside a code span", () => {
    // Seeded, so a failure reproduces: a linear congruential generator over an alphabet rich in the
    // characters that matter here.
    let seed = 0x5eed;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const alphabet = ["@", "@", "@", "`", "`", " ", "a", "b", "-", "/", ".", "_", "\n", "|", "x", "1", "é", "\\", "&#64;", "&#x40;", "&commat;", "https://e.com/"];
    let witnesses = 0;
    for (let n = 0; n < 2000; n++) {
      const text = Array.from({ length: 1 + (next() % 24) }, () => alphabet[next() % alphabet.length]).join("");
      if (BARE.test(outsideCode(text))) witnesses++;
      expect([text, BARE.test(outsideCode(cellText(text)))]).toEqual([text, false]);
    }
    expect(witnesses).toBeGreaterThan(100); // the generator does produce bare mentions to escape
  });
});

describe("text quoted from other pull requests and the repository names no one either (flyingrobots/footprint#78, review)", () => {
  const BARE_IN = (md: string) => md.split("\n").filter((l) => /(?<![A-Za-z0-9`>])@[A-Za-z0-9]/.test(l.replace(/<code>[^<]*<\/code>/g, "")));

  test("an open pull request's title is written with its handles as code", () => {
    const pr = { number: 7, title: "Ping @octocat about it", isDraft: false, files: ["a.ts"], headCommit: "c", baseBranch: "main" } as PullRequest;
    const md = renderOverlap(computeOverlap(["a.ts"], [pr]));
    expect(md).toContain("Ping <code>@octocat</code> about it");
    expect(BARE_IN(md)).toEqual([]);
  });

  test("an after-merge step quoted from RELEASE.md is written with its handles as code", () => {
    const release = "# Release\n\n## After merge\n\n- Tell @org/release-team the tag is out.\n";
    const md = renderLanding(landingPlan(["src/a.ts"], [{ file: "RELEASE.md", text: release }, { file: "AGENTS.md", text: null }]));
    expect(md).toContain("Tell <code>@org/release-team</code> the tag is out.");
    expect(BARE_IN(md)).toEqual([]);
  });
});
