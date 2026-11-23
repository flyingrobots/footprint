// footprint's own landing steps (flyingrobots/footprint#30): this repository declares how a change
// lands in its own RELEASE.md, in the form src/landing.ts reads, and the manifest version always
// has a dated changelog heading for the release workflow to take its notes from.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { landingPlan, readLandingDocs } from "../src/landing.ts";

const ROOT = resolve(import.meta.dir, "..");

describe("footprint's own landing steps", () => {
  test("this repository's RELEASE.md declares after-merge steps that footprint reads", () => {
    const l = landingPlan(["src/cli.ts"], readLandingDocs(ROOT));
    expect(l.after_merge.read.find((r) => r.file === "RELEASE.md")).toMatchObject({ present: true });
    expect(l.after_merge.declared).toBe(true);
    expect(l.after_merge.nothing_to_do).toBe(false);
    expect(l.after_merge.steps.length).toBeGreaterThan(0);
    for (const s of l.after_merge.steps) {
      expect(s.file).toBe("RELEASE.md");
      expect(s.heading).toBe("After merge");
      expect(s.step).not.toMatch(/^#/);
      expect(s.step).not.toMatch(/^```/);
    }
  });

  test("the manifest version has a dated changelog heading", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const escaped = version.replace(/\./g, "\\.");
    const headings = changelog.split("\n").filter((l) => new RegExp(`^## \\[${escaped}\\] — \\d{4}-\\d{2}-\\d{2}$`).test(l));
    expect(headings).toHaveLength(1);
  });
});
