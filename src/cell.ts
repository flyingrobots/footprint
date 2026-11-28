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

/** `|` escaped, every newline a `<br>`, never empty. */
export function cellText(text: string): string {
  const t = text.trim().replace(/\r\n|\r|\n/g, "<br>").replace(/\|/g, "\\|");
  return t === "" ? EMPTY_CELL : t;
}
