// A bare @handle in a GitHub comment notifies that user or team, and footprint edits its one
// comment on every run (flyingrobots/footprint#78). Text footprint did not write goes through
// noMentions, which puts a zero width space straight after every spelling of `@`.
import { describe, expect, test } from "bun:test";
import { cellText, noMentions } from "../src/cell.ts";
import { buildComment, rowLine } from "../src/comment.ts";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { landingPlan } from "../src/landing.ts";
import { computeOverlap, unavailableOverlap, type PullRequest } from "../src/overlap.ts";
import { renderLanding, renderOverlap } from "../src/render.ts";

const ZWSP = "​";

/**
 * The oracle, sharing no pattern with src/cell.ts. It decodes the text as a renderer does first
 * (numeric and named references, with or without the `;`, and a backslash before `@`), then
 * applies GitHub's mention rule, checked with gh api markdown: `@` not after a letter or digit,
 * then a letter or digit. It applies the rule everywhere, code and links included, so it is
 * stricter than GitHub, never looser.
 */
function mentions(markdown: string): string[] {
  const decoded = markdown
    .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);?/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&commat;/g, "@")
    .replace(/\\@/g, "@");
  return [...decoded.matchAll(/(?<![A-Za-z0-9])@[A-Za-z0-9]/g)].map((m) => m[0]);
}

/**
 * Every input that carried a mention past an earlier version of this code, through three review
 * rounds, each confirmed by rendering through GitHub. On 2026-11-28 GitHub rendered 14 mentions
 * from the first 18 as given and none once escaped.
 */
const CORPUS = [
  "@octocat", "\\@octocat", "a\\@octocat", "@octo\\@cat", "\\&#64;octocat", "https://a_.@octocat", "https://a_/.@octocat",
  "xhttps://e.com/.@octocat", "@&#111;ctocat", "&#64;&#111;ctocat", "https://@octocat", "http://.@octocat", "_@octocat_",
  "b\\`.@&#x6f;ctocat`x", "&commat;octocat", "&#x40;octocat", "[@octocat](https://e.com)", "ping @octocat.",
  "&#64@octocat", "&#x40@octocat", "ping @org/team", "@b@x", "`@1``..`", "\\\\`@a`",
  "\\\\@octocat", "\\\\&#64;octocat", "https://a_b/.@octocat",
  // Review round 4: repository text a backtick lets out of its code span.
  "`` x`@octocat`y ``", "`s = `hi @octocat``", "`a` @octocat `b`",
];

describe("no @ can start a mention in text footprint did not write (flyingrobots/footprint#78)", () => {
  test("the oracle sees the mentions the corpus carries as given", () => {
    const carried = CORPUS.filter((c) => mentions(c).length > 0);
    expect(carried.length).toBeGreaterThanOrEqual(20); // witnesses: the oracle is not vacuous
  });

  test("no input of the corpus carries a mention once escaped", () => {
    for (const c of CORPUS) expect([c, mentions(noMentions(c))]).toEqual([c, []]);
  });

  test("every spelling of @ gets a zero width space after it, and nothing else changes", () => {
    expect(noMentions("ping @octocat and &#64;x and &#x40;y and &commat;z")).toBe(`ping @${ZWSP}octocat and &#64;${ZWSP}x and &#x40;${ZWSP}y and &commat;${ZWSP}z`);
    expect(noMentions("&#64x &#x40y")).toBe(`&#64${ZWSP}x &#x40${ZWSP}y`);
    expect(noMentions("no at sign `here` or https://e.com/a")).toBe("no at sign `here` or https://e.com/a");
  });

  test("it is idempotent: text escaped twice is escaped once", () => {
    for (const c of CORPUS) expect(noMentions(noMentions(c))).toBe(noMentions(c));
  });

  test("a reference that only starts like one for @ is not split", () => {
    expect(noMentions("&#640; &#x400;")).toBe("&#640; &#x400;");
  });

  test("cellText still escapes pipes and newlines, after noMentions", () => {
    expect(cellText(" @a | b\nc ")).toBe(`@${ZWSP}a \\| b<br>c`);
  });

  test("property: no cell of random text carries a mention", () => {
    // Seeded, so a failure reproduces: a linear congruential generator over the tokens that matter.
    let seed = 0x5eed;
    const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff); // imul: a plain product passes 2^53 and loses bits
    const alphabet = ["@", "@", "@", "`", " ", "a", "o", "1", "-", "/", ".", "_", "\n", "|", "\\", "&#64;", "&#64", "&#x40;", "&commat;", "&#111;", "https://e.com/", "<code>", "</code>", ";"];
    let witnesses = 0;
    for (let n = 0; n < 3000; n++) {
      const text = Array.from({ length: 1 + (next() % 24) }, () => alphabet[next() % alphabet.length]).join("");
      if (mentions(text).length > 0) witnesses++;
      expect([text, mentions(cellText(text))]).toEqual([text, []]);
    }
    expect(witnesses).toBeGreaterThan(300); // the generator does produce mentions to escape
  });
});

describe("text quoted from other pull requests and the repository names no one either (flyingrobots/footprint#78)", () => {
  test("an open pull request's title", () => {
    const pr = { number: 7, title: "Ping @octocat about it", isDraft: false, files: ["a.ts"], headCommit: "c", baseBranch: "main" } as PullRequest;
    const md = renderOverlap(computeOverlap(["a.ts"], [pr]));
    expect(md).toContain(`Ping @${ZWSP}octocat about it`);
    expect(mentions(md)).toEqual([]);
  });

  test("an after-merge step quoted from RELEASE.md", () => {
    const release = "# Release\n\n## After merge\n\n- Tell @org/release-team the tag is out.\n";
    const md = renderLanding(landingPlan(["src/a.ts"], [{ file: "RELEASE.md", text: release }, { file: "AGENTS.md", text: null }]));
    expect(md).toContain(`Tell @${ZWSP}org/release-team the tag is out.`);
    expect(mentions(md)).toEqual([]);
  });

  test("a landing heading quoted when its section lists no steps", () => {
    const release = "# Release\n\n## Release (owner @octocat)\n\nSee the wiki.\n";
    const md = renderLanding(landingPlan(["src/a.ts"], [{ file: "RELEASE.md", text: release }, { file: "AGENTS.md", text: null }]));
    expect(md).toContain("owner");
    expect(mentions(md)).toEqual([]);
  });

  test("gh's own message when the overlap is unavailable", () => {
    const md = renderOverlap(unavailableOverlap("gh.failed", "HTTP 403: ask @octocat for access"));
    expect(md).toContain("ask");
    expect(mentions(md)).toEqual([]);
  });
});

// Review round 4: render paths that never reach noMentions (symbol names, signatures, the range
// built from a branch name) let a backtick free a handle. So the whole output is escaped once, as
// the CLI emits --human and as footprint comment posts the body.
describe("the whole report and the whole comment are escaped (flyingrobots/footprint#78, review round 4)", () => {
  test("a posted comment carries no mention, whatever the report holds", () => {
    const report = "## Footprint\n\n| `` x`@octocat`y `` | `s = `hi @octocat`` | `a` @octocat `b` |\n";
    const row = rowLine({ timestamp: "t", sha: "abc1234", change: "c", reason: "r", remarks: "@octocat" });
    const built = buildComment(report, { rows: [], dropped: 0 }, row);
    expect(mentions(built.body)).toEqual([]);
  });

  test("the --human report on a branch named x`@octocat`y carries no mention", async () => {
    const repo = mkdtempSync(join(tmpdir(), "footprint-mention-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
    const git = (...a: string[]) => { const r = Bun.spawnSync(["git", ...a], { cwd: repo, env, stdout: "pipe", stderr: "pipe" }); if (r.exitCode !== 0) throw new Error(r.stderr.toString()); };
    git("init", "-q", "-b", "main");
    git("-c", "user.name=f", "-c", "user.email=f@example.invalid", "commit", "-q", "--allow-empty", "-m", "base");
    git("checkout", "-q", "-b", "x`@octocat`y");
    await Bun.write(join(repo, "a.md"), "hello\n");
    git("add", "-A");
    git("-c", "user.name=f", "-c", "user.email=f@example.invalid", "commit", "-q", "-m", "change");
    const bin = mkdtempSync(join(tmpdir(), "footprint-bin-"));
    symlinkSync(Bun.which("git")!, join(bin, "git"));
    const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "main...x`@octocat`y", "--human"], {
      cwd: repo,
      env: { ...env, PATH: bin, FOOTPRINT_GRAFT: join(bin, "no-graft"), XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, status] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(status).toBe(0);
    expect(out).toContain("octocat"); // the branch name is in the report
    expect(mentions(out)).toEqual([]);
  }, 60_000);
});
