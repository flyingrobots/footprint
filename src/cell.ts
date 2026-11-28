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
 * Every spelling a renderer may decode to `@`: the character, and the references `&#64;`, `&#x40;`
 * and `&commat;`, with or without the closing `;`. GitHub leaves an unterminated `&#64` as text
 * (checked with gh api markdown), but HTML decodes it, so it is covered at no cost. There is no
 * lookbehind for the letter or digit that stops a mention (`a@b.dev`): treating every `@` the
 * same is simpler to trust, and costs an email address only an invisible character.
 */
const AT = /@|&#0*64(?![0-9]);?|&#[xX]0*40(?![0-9a-fA-F]);?|&commat;/g;

/** U+200B ZERO WIDTH SPACE: invisible, and not a letter or digit. */
const ZWSP = "\u200b";

/**
 * Text in which no `@` can start a GitHub mention (flyingrobots/footprint#78). A Footprint comment
 * is edited on every run, and a bare handle in it pings that user or team. GitHub links a mention
 * only when a letter or digit follows the `@` directly, after it has decoded the text, so a zero
 * width space is put straight after every spelling of `@`, everywhere: in code, in links, in a
 * name spelled with character references (`@&#111;ctocat`). Nothing is parsed, so there is no
 * code-span or URL rule to get wrong, which three review rounds of a wrapping approach did. The
 * cost: the space is invisible but copies with the text, and an email address or a URL holding
 * an `@` carries it too.
 */
export function noMentions(text: string): string {
  return text.replace(AT, (at) => at + ZWSP);
}

/** No bare `@handle`, `|` escaped, every newline a `<br>`, never empty. */
export function cellText(text: string): string {
  const t = noMentions(text.trim()).replace(/\r\n|\r|\n/g, "<br>").replace(/\|/g, "\\|");
  return t === "" ? EMPTY_CELL : t;
}
