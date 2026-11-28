// A bare @handle in a GitHub comment notifies that user or team, and footprint edits its one
// comment on every run (flyingrobots/footprint#78). Every cell of text footprint did not write goes
// through cellText, so that is where a handle is wrapped as code.
import { describe, expect, test } from "bun:test";
import { cellText } from "../src/cell.ts";
import { landingPlan } from "../src/landing.ts";
import { computeOverlap, type PullRequest } from "../src/overlap.ts";
import { renderLanding, renderOverlap } from "../src/render.ts";

/**
 * An oracle that shares no pattern with src/cell.ts. It does what a renderer does first: it drops
 * <code> elements and complete code spans (CommonMark's rule: a backtick run, then content, then a
 * run of the same length), drops real links (a scheme, then a host starting with a letter or
 * digit), and decodes character references. Then it applies GitHub's mention rule, checked with
 * gh api markdown: `@` not after a letter or digit, then a letter or digit.
 */
function bareMentions(markdown: string): string[] {
  const t = markdown.replace(/<code>[\s\S]*?<\/code>/g, " ");
  let out = "";
  for (let i = 0; i < t.length; ) {
    // Outside a span, a backslash escapes the next character (an escaped backtick opens no span);
    // inside one it is literal, which the span skip below already gives.
    if (t[i] === "\\" && t[i + 1] === "`") { out += " "; i += 2; continue; }
    const run = /^`+/.exec(t.slice(i))?.[0];
    if (run !== undefined && t[i - 1] !== "`") {
      const close = t.slice(i + run.length).search(new RegExp(`(?<!\`)${run}(?!\`)`));
      if (close > 0) { out += " "; i += run.length + close + run.length; continue; }
      out += run; i += run.length; continue;
    }
    out += t[i]; i++;
  }
  out = out.replace(/https?:\/\/[A-Za-z0-9][^\s<>]*/g, " ");
  out = out.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  out = out.replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  out = out.replace(/&commat;/g, "@").replace(/\\@/g, "@");
  return [...out.matchAll(/(?<![A-Za-z0-9])@[A-Za-z0-9][-A-Za-z0-9]*/g)].map((m) => m[0]);
}

const BARE = { test: (text: string) => bareMentions(text).length > 0 };
const outsideCode = (text: string) => text;

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
    expect(cellText("_@octocat_")).toBe("_<code>@octocat_</code>"); // the whole run is wrapped
    expect(cellText("\\@octocat")).toBe("<code>@octocat</code>");
    expect(cellText("&#64;octocat &#x40;octocat &commat;octocat")).toBe("<code>@octocat</code> <code>@octocat</code> <code>@octocat</code>");
  });

  test("a character reference inside the name, or a URL with no host, cannot carry a mention (review round 2)", () => {
    for (const t of ["@&#111;ctocat", "&#64;&#111;ctocat", "https://@octocat", "http://.@octocat"]) {
      expect([t, bareMentions(cellText(t))]).toEqual([t, []]);
    }
  });

  test("a code span holding a backtick is left exactly as written", () => {
    expect(cellText("see `` a`b `` here")).toBe("see `` a`b `` here");
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
    const alphabet = ["@", "@", "@", "`", "`", " ", "a", "b", "o", "-", "/", ".", "_", "\n", "|", "x", "1", "é", "\\", "&#64;", "&#x40;", "&commat;", "&#111;", "&#x6f;", "https://e.com/", "https://", "http://."];
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
    expect(bareMentions(md)).toEqual([]);
  });

  test("a landing heading quoted when its section lists no steps names no one", () => {
    const release = "# Release\n\n## Release (owner @octocat)\n\nSee the wiki.\n";
    const md = renderLanding(landingPlan(["src/a.ts"], [{ file: "RELEASE.md", text: release }, { file: "AGENTS.md", text: null }]));
    expect(md).toContain("owner");
    expect(bareMentions(md)).toEqual([]);
  });

  test("a symbol-level reason that quotes a file name names no one", () => {
    const pr7 = { number: 7, title: "a", isDraft: false, files: ["@octocat notes.md"], headCommit: "c", baseBranch: "main" } as PullRequest;
    const pr8 = { ...pr7, number: 8 };
    const md = renderOverlap(computeOverlap(["@octocat notes.md"], [pr7, pr8]));
    expect(bareMentions(md)).toEqual([]);
  });

  test("an after-merge step quoted from RELEASE.md is written with its handles as code", () => {
    const release = "# Release\n\n## After merge\n\n- Tell @org/release-team the tag is out.\n";
    const md = renderLanding(landingPlan(["src/a.ts"], [{ file: "RELEASE.md", text: release }, { file: "AGENTS.md", text: null }]));
    expect(md).toContain("Tell <code>@org/release-team</code> the tag is out.");
    expect(bareMentions(md)).toEqual([]);
  });
});
