// A graft call that never answers is stopped at a deadline, and the section says why
// (flyingrobots/footprint#100). The stand-in graft is a shell script: one sleeps, one exits at once
// while a background grandchild keeps its stdout open, which is what defeats a wait on exit alone.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { structuralReview } from "../src/graft.ts";
import { exportSurface } from "../src/exports.ts";

const repo = join(import.meta.dir, "..");
function standIn(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "footprint-graft-stall-"));
  const path = join(dir, "graft");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}
const STALLS = { sleeps: standIn("sleep 30"), "leaves a grandchild holding the pipe": standIn("(sleep 30) &\nexit 0") };

describe("graft calls run under a deadline (flyingrobots/footprint#100)", () => {
  for (const [how, graft] of Object.entries(STALLS)) {
    test(`struct review: a graft that ${how} is stopped, and the reason says so`, async () => {
      const started = Date.now();
      const r = await structuralReview(graft, repo, "HEAD~1", "HEAD", { timeoutMs: 300 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(r).toMatchObject({ failed: expect.stringContaining("did not answer within 300 ms") });
    });

    test(`struct exports: a graft that ${how} is stopped, and the section is unavailable with the reason`, async () => {
      const started = Date.now();
      const e = await exportSurface(graft, repo, "HEAD~1...HEAD", { timeoutMs: 300 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(e).toMatchObject({ available: false, reason: { code: "graft.exports_failed", detail: expect.stringContaining("did not answer within 300 ms") } });
    });
  }
});
