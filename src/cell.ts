// One Markdown table cell, for the text footprint did not write: the Changelog's Change, Reason
// and Remarks, and the agent's Impact and Data flow (flyingrobots/footprint#59).

/** What a cell says when it was given nothing: a dash, never a blank cell. */
const EMPTY_CELL = "—";

/**
 * Text footprint did not write -- a changed file's path, above all -- as one Markdown code span
 * (flyingrobots/footprint#66). Paths come from `git diff -z` verbatim, so one can hold a newline or
 * a backtick: a control character is written as a visible escape (`\n`, `\t`, `\x1b`), and a
 * backtick lengthens the fence, so the text can never leave its span or its line.
 */
export function codeSpan(text: string): string {
  const named: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  const visible = text.replace(/[\u0000-\u001f\u007f]/g, (c) => named[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  const longest = Math.max(0, ...(visible.match(/`+/g) ?? []).map((run) => run.length));
  // CommonMark strips one space from each end of a span whose content starts and ends with one and
  // is not all spaces, so such a path gets one more space on each side to show it exactly.
  const padded = /^ .* $/s.test(visible) && visible.trim() !== "" ? ` ${visible} ` : visible;
  if (longest === 0) return `\`${padded}\``;
  const fence = "`".repeat(longest + 1);
  return `${fence} ${visible} ${fence}`;
}

/**
 * What is left exactly as written: a complete code span (a run of backticks, content, the same run
 * closing it), or a URL, in which GitHub makes no mention and which a wrap would cut.
 */
const OPAQUE = /(`+)[^`]*?[^`]\1(?!`)|https?:\/\/[^\s<>|`]+/g;

/**
 * A GitHub mention, as its renderer reads one (checked with gh api markdown): `@` (or `\@`,
 * `&#64;`, `&#x40;`, `&commat;`), not after a letter or digit, then a user or `org/team` name, and
 * any `@` that follows straight on (`@b@x`). `_@x_` is a mention, because the underscores become
 * emphasis, so an underscore before the `@` does not protect it; wrapping `a_@x`, which is not a
 * mention, costs only formatting. The trailing `@x` is wrapped with `@b`, because once `@b` is
 * code the `@x` after it would follow a tag and become a mention of its own.
 */
const AT = String.raw`(?:@|&#0*64;|&#[xX]0*40;|&commat;)`;
const MENTION = new RegExp(String.raw`(?<![A-Za-z0-9])\\?${AT}([A-Za-z0-9][-A-Za-z0-9]*(?:\/[A-Za-z0-9][-A-Za-z0-9_.]*)?(?:${AT}[-\w./]*)*)`, "g");

/**
 * Text with every `@handle` outside a code span written as code, so it notifies no one
 * (flyingrobots/footprint#78). A Footprint comment is edited on every run, and a bare handle in it
 * pings that user or team. The handle is wrapped in `<code>`, not backticks: a backtick fence next
 * to an existing code span merges with it into one run and changes what both say, and `<code>`
 * cannot. Outside a span or a URL a stray backtick is escaped first, so it cannot shield a handle. An
 * email address (`a@b.dev`) is not a mention and is left as it is.
 */
export function noMentions(text: string): string {
  const plain = (s: string) => s.replace(/`/g, "\\`").replace(MENTION, "<code>@$1</code>");
  let out = "";
  let at = 0;
  for (const m of text.matchAll(OPAQUE)) {
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
