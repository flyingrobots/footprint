// The result record: what a run answers with, on stdout and in the receipt. Semantic content only
// goes into the digest (spec §7.1), so two runs over the same range and tree compare equal.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha256 } from "@flyingrobots/parley-emit";
import type { Composition } from "./footprint.ts";
import { structuralSummary, type StructuralReview } from "./graft.ts";
import type { Landing } from "./landing.ts";
import type { Overlap } from "./overlap.ts";
import type { GutCheck } from "./render.ts";

export const COMPOSITION_SCHEMA = JSON.parse(readFileSync(join(import.meta.dir, "../schemas/footprint.composition.schema.json"), "utf8")) as Record<string, unknown>;
export const COMPOSITION_TYPE = { id: "footprint.composition", version: "1.0.0" } as const;
export const LANDING_SCHEMA = JSON.parse(readFileSync(join(import.meta.dir, "../schemas/footprint.landing.schema.json"), "utf8")) as Record<string, unknown>;
export const LANDING_TYPE = { id: "footprint.landing", version: "1.0.0" } as const;
export const OVERLAP_SCHEMA = JSON.parse(readFileSync(join(import.meta.dir, "../schemas/footprint.overlap.schema.json"), "utf8")) as Record<string, unknown>;
export const OVERLAP_TYPE = { id: "footprint.overlap", version: "2.3.0" } as const;

export interface Structural {
  readonly available: boolean;
  readonly structural?: number;
  readonly formatting?: number;
  readonly symbolsAdded?: number;
  readonly symbolsRemoved?: number;
  readonly symbolsChanged?: number;
  readonly breakingChanges?: readonly string[];
}

export function structuralOf(review: StructuralReview | null): Structural {
  if (review === null) return { available: false };
  return { available: true, ...structuralSummary(review), breakingChanges: review.breakingChanges };
}

export function compositionRecord(range: string, composition: Composition, gut: GutCheck, review: StructuralReview | null) {
  const semantic = { range, composition, gut_check: gut, structural: structuralOf(review) };
  return { event: "result", ...semantic, digest: sha256(canonical(semantic)) };
}

/** The landing plan's own result, emitted in the same run after the composition (spec §7.1). */
export function landingRecord(range: string, landing: Landing) {
  const semantic = { range, before_merge: landing.before_merge, after_merge: landing.after_merge };
  return { event: "result", ...semantic, digest: sha256(canonical(semantic)) };
}

/**
 * The overlap result, the last of the run's four, after the blast radius. Its digest covers the
 * live state of the open pull requests, so — unlike the composition's — it moves when they move,
 * under the same `inv`.
 */
export function overlapRecord(range: string, overlap: Overlap) {
  const semantic = { range, overlap };
  return { event: "result", ...semantic, digest: sha256(canonical(semantic)) };
}
