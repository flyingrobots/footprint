// One Footprint comment per pull request (flyingrobots/footprint#59, CM-1 to CM-4 in
// docs/topics/comment/test-plan.md). The CLI cases run `footprint comment` against the stand-in
// `gh` in test/fixtures/fake-gh, which keeps the pull request's comments in a JSON file and logs
// every call; the Changelog's shape and its escaping are pure and tested without it.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SCHEMAS } from "@flyingrobots/parley-emit";
import { CHANGELOG_HEADER, CHANGELOG_OPEN, MARKER, buildComment, cellText, parseChangelog, rowLine } from "../src/comment.ts";
import { COMMENT_REPORT_LIMIT, REPORT_LIMIT } from "../src/bound.ts";

const ROOT = resolve(import.meta.dir, "..");
const FAKE_GH = join(import.meta.dir, "fixtures", "fake-gh");
const CLI_TIMEOUT = 60_000;
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const NEXT_HEAD = "fedcba9876543210fedcba9876543210fedcba98";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const byPair = new Map<string, ReturnType<typeof ajv.compile>>();
for (const s of SCHEMAS) byPair.set(`${s.id}@${s.version}`, ajv.compile(s.schema));
byPair.set("footprint.comment@1.0.0", ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas/footprint.comment.schema.json"), "utf8"))));

type Line = Record<string, unknown> & { _schema: { id: string; version: string } };
function validateAll(text: string, stream: string): Line[] {
  expect(text === "" || text.endsWith("\n")).toBe(true);
  return text.split("\n").filter((l) => l !== "").map((raw, i) => {
    const obj = JSON.parse(raw) as Line;
    const key = `${obj._schema.id}@${obj._schema.version}`;
    const v = byPair.get(key);
    if (!v) throw new Error(`${stream}:${i + 1} no schema for ${key}`);
    if (!v(obj)) throw new Error(`${stream}:${i + 1} ${key}: ${ajv.errorsText(v.errors)}`);
    return obj;
  });
}

interface Comment { id: number; login: string; body: string; created_at: string }
interface State { login: string; head: string; pr: number; comments: Comment[]; calls: { args: string[]; stdin?: string }[] }

function world(comments: Comment[] = [], login = "me") {
  const dir = mkdtempSync(join(tmpdir(), "footprint-comment-"));
  const statePath = join(dir, "gh-state.json");
  writeFileSync(statePath, JSON.stringify({ login, head: HEAD, pr: 7, comments, calls: [] } satisfies State));
  const report = join(dir, "report.md");
  writeFileSync(report, "## Footprint\n\n**1 file, +1/-0** · `origin/main...origin/x`\n");
  const state = () => JSON.parse(readFileSync(statePath, "utf8")) as State;
  const setHead = (h: string) => writeFileSync(statePath, JSON.stringify({ ...state(), head: h }));
  return { dir, statePath, report, state, setHead };
}

/** A PATH holding the stand-in gh and bun, and nothing else; or bun alone when `gh` is false. */
function pathFor(gh: boolean): string {
  const bin = mkdtempSync(join(tmpdir(), "footprint-comment-bin-"));
  symlinkSync(process.execPath, join(bin, "bun"));
  return gh ? `${FAKE_GH}:${bin}` : bin;
}

async function comment(w: ReturnType<typeof world>, args: string[], opts: { gh?: boolean } = {}) {
  const env = { ...process.env, PATH: pathFor(opts.gh ?? true), FAKE_GH_STATE: w.statePath, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "footprint-state-")) };
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "comment", ...args], { cwd: w.dir, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, status };
}

const writes = (s: State) => s.calls.filter((c) => c.args.includes("--method"));
const changelogRows = (body: string) => {
  const at = body.lastIndexOf(CHANGELOG_OPEN);
  return body.slice(at).split("\n").filter((l) => l.startsWith("| ") && !CHANGELOG_HEADER.includes(l));
};
const run1 = ["7", "--change", "First report", "--reason", "Pull request opened", "--remarks", "none"];

describe("the Footprint comment (flyingrobots/footprint#59)", () => {
  // CM-1a
  test("creates one marked comment with a one-row Changelog when the pull request has none", async () => {
    const w = world();
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const s = w.state();
    expect(s.comments).toHaveLength(1);
    const body = s.comments[0]!.body;
    expect(body.split("\n")[0]).toBe(MARKER);
    expect(body).toContain("**1 file, +1/-0**");
    expect(changelogRows(body)).toHaveLength(1);
    expect(writes(s).map((c) => c.args[c.args.indexOf("--method") + 1])).toEqual(["POST"]);
    const result = validateAll(r.stdout, "stdout").find((l) => l.event === "result")!;
    expect(result).toMatchObject({ pull_request: 7, action: "created", adopted: false, dry_run: false, head_sha: HEAD.slice(0, 7), comment: { id: s.comments[0]!.id } });
  }, CLI_TIMEOUT);

  // CM-2c
  test("the row is a UTC timestamp to the second and the head's 7-character SHA", async () => {
    const w = world();
    expect((await comment(w, [...run1, "--report", w.report])).status).toBe(0);
    const [row] = changelogRows(w.state().comments[0]!.body);
    const cells = row!.slice(2, -2).split(" | ");
    expect(cells[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Math.abs(Date.parse(cells[0]!) - Date.now())).toBeLessThan(5 * 60_000);
    expect(cells.slice(1)).toEqual([HEAD.slice(0, 7), "First report", "Pull request opened", "none"]);
  }, CLI_TIMEOUT);

  // CM-1b, CM-4a
  test("a second run updates that comment in place: one comment, rows preserved in order, the new row last", async () => {
    const w = world([{ id: 1, login: "someone", body: "LGTM", created_at: "2026-11-20T00:00:00Z" }]);
    const first = await comment(w, [...run1, "--report", w.report]);
    expect(first.status).toBe(0);
    const before = w.state().comments.find((c) => c.body.startsWith(MARKER))!;
    const firstRows = changelogRows(before.body);
    w.setHead(NEXT_HEAD);
    writeFileSync(w.report, "## Footprint\n\n**2 files, +3/-1** · `origin/main...origin/x`\n");
    const second = await comment(w, ["7", "--report", w.report, "--change", "One more file", "--reason", "New commits pushed", "--remarks", "Review fix"]);
    expect(second.status).toBe(0);
    const s = w.state();
    const marked = s.comments.filter((c) => c.body.startsWith(MARKER));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.id).toBe(before.id);
    expect(s.comments.find((c) => c.id === 1)!.body).toBe("LGTM");
    expect(marked[0]!.body).toContain("**2 files, +3/-1**");
    expect(marked[0]!.body).not.toContain("**1 file, +1/-0**");
    const rows = changelogRows(marked[0]!.body);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(firstRows[0]!);
    expect(rows[1]).toContain(`| ${NEXT_HEAD.slice(0, 7)} | One more file | New commits pushed | Review fix |`);
    expect(writes(s).map((c) => c.args[c.args.indexOf("--method") + 1])).toEqual(["POST", "PATCH"]);
    for (const r of [first, second]) { validateAll(r.stdout, "stdout"); validateAll(r.stderr, "stderr"); }
    const result = validateAll(second.stdout, "stdout").find((l) => l.event === "result")!;
    expect(result).toMatchObject({ action: "updated", adopted: false, changelog: { rows: 2, carried: 1, dropped: 0 } });

    const help = await comment(w, ["--help"]);
    expect(help.status).toBe(0);
    const h = validateAll(help.stdout, "stdout");
    expect(h.filter((o) => o.event === "command").map((o) => o.name)).toEqual(["comment"]);
    expect(h.filter((o) => o.event === "schema").map((o) => `${o.id}@${o.version}`)).toContain("footprint.comment@1.0.0");
  }, 3 * CLI_TIMEOUT);

  // CM-1c
  test("adopts the most recent unmarked Footprint comment by the current user, and says so in Remarks", async () => {
    const w = world([
      { id: 10, login: "me", body: "## Footprint\n\nold", created_at: "2026-11-20T00:00:00Z" },
      { id: 11, login: "me", body: "## Footprint\n\nnewer", created_at: "2026-11-21T00:00:00Z" },
      { id: 12, login: "me", body: "an ordinary comment", created_at: "2026-11-22T00:00:00Z" },
    ]);
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.status).toBe(0);
    const s = w.state();
    expect(s.comments.find((c) => c.id === 10)!.body).toBe("## Footprint\n\nold");
    expect(s.comments.find((c) => c.id === 12)!.body).toBe("an ordinary comment");
    const adopted = s.comments.find((c) => c.id === 11)!;
    expect(adopted.body.split("\n")[0]).toBe(MARKER);
    const rows = changelogRows(adopted.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/\| none Adopted an earlier Footprint comment[^|]*\|$/);
    expect(writes(s)).toHaveLength(1);
    expect(writes(s)[0]!.args).toContain("repos/{owner}/{repo}/issues/comments/11");
    expect(validateAll(r.stdout, "stdout").find((l) => l.event === "result")).toMatchObject({ action: "updated", adopted: true });
  }, CLI_TIMEOUT);

  // CM-1d
  test("never edits another user's comment: a marked comment by someone else is refused and nothing is written", async () => {
    const w = world([{ id: 20, login: "someone", body: `${MARKER}\n## Footprint\n\ntheirs`, created_at: "2026-11-20T00:00:00Z" }]);
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.status).toBe(2);
    const err = validateAll(r.stderr, "stderr").find((l) => l.event === "error")!;
    expect(err.code).toBe("comment.other_author");
    expect(String(err.problem)).toContain("someone");
    const s = w.state();
    expect(writes(s)).toEqual([]);
    expect(s.comments).toHaveLength(1);
    expect(s.comments[0]!.body).toBe(`${MARKER}\n## Footprint\n\ntheirs`);
  }, CLI_TIMEOUT);

  // CM-1e
  test("an unmarked Footprint comment by another user is left alone and a new one is created", async () => {
    const w = world([{ id: 30, login: "someone", body: "## Footprint\n\ntheirs", created_at: "2026-11-20T00:00:00Z" }]);
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.status).toBe(0);
    const s = w.state();
    expect(s.comments).toHaveLength(2);
    expect(s.comments[0]!.body).toBe("## Footprint\n\ntheirs");
    expect(s.comments[1]!.body.split("\n")[0]).toBe(MARKER);
    expect(writes(s).map((c) => c.args[c.args.indexOf("--method") + 1])).toEqual(["POST"]);
  }, CLI_TIMEOUT);

  // CM-3c
  test("a report at the 57344 bound with a long Changelog posts at or under 65536", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => rowLine({ timestamp: "2026-11-01T00:00:00Z", sha: "abcdef0", change: `change ${i} ${"c".repeat(80)}`, reason: "New commits pushed", remarks: "r".repeat(60) }));
    const old = buildComment("## Footprint\n\nold", { rows: [], dropped: 0 }, rows[0]!).body.replace(rowLine({ timestamp: "2026-11-01T00:00:00Z", sha: "abcdef0", change: `change 0 ${"c".repeat(80)}`, reason: "New commits pushed", remarks: "r".repeat(60) }), rows.join("\n"));
    const w = world([{ id: 40, login: "me", body: old, created_at: "2026-11-20T00:00:00Z" }]);
    writeFileSync(w.report, `## Footprint\n\n${"x".repeat(COMMENT_REPORT_LIMIT - 20)}`);
    expect(readFileSync(w.report, "utf8").length).toBeLessThanOrEqual(COMMENT_REPORT_LIMIT);
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.status).toBe(0);
    const body = w.state().comments[0]!.body;
    expect(body.length).toBeLessThanOrEqual(REPORT_LIMIT);
    expect(body).toMatch(/\d+ older Changelog rows? dropped/);
    expect(changelogRows(body).at(-1)).toContain("| First report | Pull request opened | none |");
  }, CLI_TIMEOUT);

  // CM-3d
  test("a report too long to leave room for one row is an error and nothing is written", async () => {
    const w = world();
    writeFileSync(w.report, "y".repeat(65500));
    const r = await comment(w, [...run1, "--report", w.report]);
    expect(r.status).toBe(2);
    expect(validateAll(r.stderr, "stderr").find((l) => l.event === "error")!.code).toBe("comment.too_long");
    expect(writes(w.state())).toEqual([]);
  }, CLI_TIMEOUT);

  // CM-4b
  test("gh absent is an error line, and --dry-run writes nothing", async () => {
    const w = world();
    const absent = await comment(w, [...run1, "--report", w.report], { gh: false });
    expect(absent.status).toBe(2);
    expect(validateAll(absent.stderr, "stderr").find((l) => l.event === "error")!.code).toBe("gh.not_found");

    const dry = await comment(w, [...run1, "--report", w.report, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(validateAll(dry.stdout, "stdout").find((l) => l.event === "result")).toMatchObject({ action: "created", dry_run: true, comment: { id: null, url: null } });
    expect(writes(w.state())).toEqual([]);
    expect(w.state().comments).toEqual([]);
  }, 2 * CLI_TIMEOUT);

  // CM-4c
  test("bad arguments are error lines and nothing is written", async () => {
    const w = world();
    const cases: [string[], string][] = [
      [["7", "--change", "c", "--reason", "r"], "args.invalid"],
      [["7", "--report", w.report, "--change", "c"], "args.invalid"],
      [["seven", "--report", w.report, "--change", "c", "--reason", "r"], "args.invalid"],
      [["7", "--report", join(w.dir, "missing.md"), "--change", "c", "--reason", "r"], "report.unreadable"],
    ];
    for (const [args, code] of cases) {
      const r = await comment(w, args);
      expect(r.status).toBe(2);
      expect(validateAll(r.stderr, "stderr").find((l) => l.event === "error")!.code).toBe(code);
    }
    expect(writes(w.state())).toEqual([]);
  }, 4 * CLI_TIMEOUT);
});

describe("the Changelog", () => {
  const row = (i: number, width = 300) => rowLine({ timestamp: "2026-11-01T00:00:00Z", sha: "abcdef0", change: `c${i} ${"x".repeat(width)}`, reason: "r", remarks: "m" });

  // CM-2a
  test("cell text has pipes escaped and newlines as <br>", () => {
    expect(cellText("a | b\r\nc\nd")).toBe("a \\| b<br>c<br>d");
    expect(cellText("  ")).toBe("—");
    const line = rowLine({ timestamp: "2026-11-23T00:00:00Z", sha: "abcdef0", change: "x|y", reason: "one\ntwo", remarks: "" });
    expect(line).toBe("| 2026-11-23T00:00:00Z | abcdef0 | x\\|y | one<br>two | — |");
    expect(line.split(/(?<!\\)\|/).length - 2).toBe(5);
  });

  // CM-2b
  test("the Changelog is the last thing in the comment, in the owner's shape", () => {
    const { body } = buildComment("## Footprint\n\nreport", { rows: [], dropped: 0 }, row(1, 5));
    const lines = body.split("\n");
    expect(lines[0]).toBe(MARKER);
    expect(lines.at(-1)).toBe("</details>");
    expect(CHANGELOG_OPEN).toBe("<details><summary>Changelog</summary>");
    expect(CHANGELOG_HEADER).toEqual(["| Timestamp | SHA | Change | Reason | Remarks |", "| --------- | --- | ------ | ------ | ------- |"]);
    const at = lines.indexOf(CHANGELOG_OPEN);
    expect(lines.slice(at)).toEqual([CHANGELOG_OPEN, "", ...CHANGELOG_HEADER, row(1, 5), "", "</details>"]);
    expect(parseChangelog(body)).toEqual({ rows: [row(1, 5)], dropped: 0 });
  });

  // CM-3a
  test("a Changelog too long to fit keeps the newest rows and states how many were dropped", () => {
    const earlier = Array.from({ length: 400 }, (_, i) => row(i));
    const report = "r".repeat(COMMENT_REPORT_LIMIT);
    const built = buildComment(report, { rows: earlier, dropped: 0 }, row(400));
    expect(built.body.length).toBeLessThanOrEqual(REPORT_LIMIT);
    const parsed = parseChangelog(built.body);
    expect(parsed.rows.at(-1)).toBe(row(400));
    expect(parsed.rows).toEqual([...earlier.slice(earlier.length - (parsed.rows.length - 1)), row(400)]);
    expect(parsed.dropped).toBe(401 - parsed.rows.length);
    expect(built.dropped).toBe(parsed.dropped);
    expect(built.body).toContain(`${parsed.dropped} older Changelog rows dropped`);
    // Nothing is dropped when it fits.
    expect(buildComment("short", { rows: earlier.slice(0, 3), dropped: 0 }, row(3)).dropped).toBe(0);
  });

  // CM-3b
  test("the dropped count accumulates across runs", () => {
    const earlier = Array.from({ length: 40 }, (_, i) => row(i));
    const first = buildComment("r".repeat(COMMENT_REPORT_LIMIT), { rows: earlier, dropped: 12 }, row(40));
    const kept = parseChangelog(first.body);
    expect(kept.dropped).toBe(12 + (41 - kept.rows.length));
    const reportLen = REPORT_LIMIT - first.body.length + COMMENT_REPORT_LIMIT;
    // Five more rows than fit: the count goes up by exactly the rows dropped this time.
    const again = buildComment("r".repeat(reportLen), kept, row(41));
    const after = parseChangelog(again.body);
    expect(after.dropped).toBe(kept.dropped + (kept.rows.length + 1 - after.rows.length));
    expect(buildComment("short", { rows: [row(1)], dropped: 12 }, row(2)).body).toContain("12 older Changelog rows dropped");
    expect(() => buildComment("y".repeat(65500), { rows: [], dropped: 0 }, row(1))).toThrow(/too long/);
  });
});
