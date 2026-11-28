// GitHub renders `> [!NOTE]`, `> [!WARNING]` and the other alerts as alert boxes only outside HTML
// blocks: inside `<details>` they are plain quotes, and nothing says so (flyingrobots/footprint#82).
// These cases render whole --human reports and hold every alert line outside every collapsed block.
import { describe, expect, test } from "bun:test";
import { compose, type FileChange } from "../src/footprint.ts";
import { landingPlan } from "../src/landing.ts";
import { unavailableOverlap } from "../src/overlap.ts";
import { blastRadius, render, renderLanding, renderOverlap } from "../src/render.ts";

/** A whole --human report, in the order the CLI writes its four sections. */
function report(changes: readonly FileChange[]): string {
  return [
    render(compose(changes), changes, "a...b", null),
    renderLanding(landingPlan(changes.map((c) => c.path), [])),
    blastRadius({ available: false, reason: { code: "graft.not_resolved", detail: "no graft" } }, []),
    renderOverlap(unavailableOverlap("gh.not_found", "gh is not installed")),
  ].join("\n");
}

/** Every alert line, with whether it sits inside an open `<details>`. */
function alertsAndDepth(markdown: string): { line: string; insideDetails: boolean }[] {
  let depth = 0;
  const out: { line: string; insideDetails: boolean }[] = [];
  for (const line of markdown.split("\n")) {
    depth += (line.match(/<details[\s>]/g) ?? []).length;
    if (/^\s*>\s*\[![A-Z]+\]/.test(line)) out.push({ line, insideDetails: depth > 0 });
    depth -= (line.match(/<\/details>/g) ?? []).length;
  }
  return out;
}

const UNGUARDED: FileChange[] = [{ path: "src/app.ts", added: 3, removed: 1, binary: false }];
const WITH_MIGRATION: FileChange[] = [...UNGUARDED, { path: "migrations/001_init.sql", added: 10, removed: 0, binary: false }];

describe("no alert is rendered inside <details> (flyingrobots/footprint#82)", () => {
  test("every alert in a report is outside every collapsed block, and there is at least one", () => {
    const alerts = [UNGUARDED, WITH_MIGRATION].flatMap((c) => alertsAndDepth(report(c)));
    expect(alerts.length).toBeGreaterThanOrEqual(1); // witnesses: a report with no alert proves nothing
    expect(alerts.filter((a) => a.insideDetails)).toEqual([]);
  });

  test("the detector sees an alert inside <details>, nested or as the last line", () => {
    expect(alertsAndDepth("<details>\n<summary>x</summary>\n\n> [!WARNING]\n> y\n\n</details>")).toEqual([{ line: "> [!WARNING]", insideDetails: true }]);
    expect(alertsAndDepth("<details>\n<details>\n</details>\n> [!NOTE]\n</details>")).toEqual([{ line: "> [!NOTE]", insideDetails: true }]);
    expect(alertsAndDepth("<details>\n</details>\n\n> [!IMPORTANT]")).toEqual([{ line: "> [!IMPORTANT]", insideDetails: false }]);
  });
});
