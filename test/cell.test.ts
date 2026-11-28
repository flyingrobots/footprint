// A bare @handle in a GitHub comment notifies that user or team, and footprint edits its one
// comment on every run (flyingrobots/footprint#78). Every cell of text footprint did not write goes
// through cellText, so that is where a handle is wrapped in backticks.
import { describe, expect, test } from "bun:test";
import { cellText } from "../src/cell.ts";

/** A bare mention as GitHub reads one: `@` not after a word character, then a name. */
const BARE = /(?<!\w)@[A-Za-z0-9]/;

/**
 * The text outside code spans, which is where a mention can notify anyone. An escaped backtick
 * (\`) is literal and opens no span; an unmatched backtick is literal too, so it stays outside.
 */
function outsideCode(text: string): string {
  return text.replace(/\\`/g, " ").split(/(`+)([^`]*?[^`])\1(?!`)/).filter((_, i) => i % 3 === 0).join(" ");
}

describe("no bare @handle reaches a comment (flyingrobots/footprint#78)", () => {
  test("a user and a team handle are wrapped in backticks", () => {
    expect(cellText("ping @octocat and @org/team")).toBe("ping `@octocat` and `@org/team`");
  });

  test("a handle at either end of a cell is wrapped", () => {
    expect(cellText("@a-b did it")).toBe("`@a-b` did it");
    expect(cellText("done by @a")).toBe("done by `@a`");
  });

  test("a handle already in a code span is left alone, and never double-wrapped", () => {
    expect(cellText("see `@octocat` and ``x @y``")).toBe("see `@octocat` and ``x @y``");
  });

  test("a stray backtick before a handle cannot shield it, and is escaped", () => {
    expect(cellText("`@octocat")).toBe("\\``@octocat`");
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
    const alphabet = "@@@`` ab-/._\n|x1é";
    let witnesses = 0;
    for (let n = 0; n < 2000; n++) {
      const text = Array.from({ length: 1 + (next() % 24) }, () => alphabet[next() % alphabet.length]).join("");
      if (BARE.test(outsideCode(text))) witnesses++;
      expect([text, BARE.test(outsideCode(cellText(text)))]).toEqual([text, false]);
    }
    expect(witnesses).toBeGreaterThan(100); // the generator does produce bare mentions to escape
  });
});
