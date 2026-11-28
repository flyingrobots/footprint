// One Markdown table cell, for the text footprint did not write: the Changelog's Change, Reason
// and Remarks, and the agent's Impact and Data flow (flyingrobots/footprint#59).

/** What a cell says when it was given nothing: a dash, never a blank cell. */
const EMPTY_CELL = "—";

/** A complete code span: a run of backticks, content, and the same run closing it. */
const CODE_SPAN = /(`+)[^`]*?[^`]\1(?!`)/g;

/**
 * A GitHub mention: `@` not after a word character, then a user or `org/team` name, and any `@`
 * that follows straight on (`@b@x`). That trailing part is wrapped too, because once `@b` is code
 * the `@x` after it would follow a backtick and become a mention of its own.
 */
const MENTION = /(?<!\w)@([A-Za-z0-9][-A-Za-z0-9]*(?:\/[A-Za-z0-9][-A-Za-z0-9_.]*)?(?:@[-\w./]*)*)/g;

/**
 * Text with every `@handle` outside a code span written as code, so it notifies no one
 * (flyingrobots/footprint#78). A Footprint comment is edited on every run, and a bare handle in it
 * pings that user or team. The handle is wrapped in `<code>`, not backticks: a backtick fence next
 * to an existing code span merges with it into one run and changes what both say, and `<code>`
 * cannot. Outside a span a stray backtick is escaped first, so it cannot shield a handle. An email
 * address (`a@b.dev`) is not a mention and is left as it is.
 */
export function noMentions(text: string): string {
  const plain = (s: string) => s.replace(/`/g, "\\`").replace(MENTION, "<code>@$1</code>");
  let out = "";
  let at = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    out += plain(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + plain(text.slice(at));
}

/** No bare `@handle`, `|` escaped, every newline a `<br>`, never empty. */
export function cellText(text: string): string {
  const t = noMentions(text.trim()).replace(/\r\n|\r|\n/g, "<br>").replace(/\|/g, "\\|");
  return t === "" ? EMPTY_CELL : t;
}
