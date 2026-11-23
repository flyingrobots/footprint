// One Markdown table cell, for the text footprint did not write: the Changelog's Change, Reason
// and Remarks, and the agent's Impact and Data flow (flyingrobots/footprint#59).

/** What a cell says when it was given nothing: a dash, never a blank cell. */
const EMPTY_CELL = "—";

/** `|` escaped, every newline a `<br>`, never empty. */
export function cellText(text: string): string {
  const t = text.trim().replace(/\r\n|\r|\n/g, "<br>").replace(/\|/g, "\\|");
  return t === "" ? EMPTY_CELL : t;
}
