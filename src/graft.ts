// Optional structural enrichment via graft.
//
// Graft classifies a changed file by what happened to its symbols, which path-based
// classification cannot do: a source file with no symbol added, removed or changed is a
// formatting change, not a behavior change.
//
// One-shot subcommands only. Never `graft serve` or `graft daemon`: footprint must not hold a
// long-lived process, and the daemon has known memory growth.

import { $ } from "bun";
import { GRAFT_TIMEOUT_MS, runBounded } from "./bounded.ts";

export interface StructuralFile {
  readonly path: string;
  readonly category: "structural" | "formatting" | "test" | "docs" | "config";
  readonly added?: number;
  readonly removed?: number;
  readonly changed?: number;
}

export interface StructuralReview {
  readonly files: readonly StructuralFile[];
  readonly breakingChanges: readonly string[];
  readonly semverImpact?: string;
}

/**
 * Find a graft executable. Checked in order so a caller can always override, and a project
 * dependency beats whatever happens to be on PATH.
 */
export async function resolveGraft(explicit?: string): Promise<string | null> {
  if (explicit !== undefined && explicit !== "") return explicit;

  // graft's exports map publishes "./package.json", so this resolves without a deep import.
  try {
    const pkgUrl = import.meta.resolve("@flyingrobots/graft/package.json");
    const pkgPath = Bun.fileURLToPath(pkgUrl);
    const pkg = await Bun.file(pkgPath).json();
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.graft;
    if (typeof rel === "string") {
      const dir = pkgPath.slice(0, pkgPath.lastIndexOf("/"));
      const bin = `${dir}/${rel.replace(/^\.\//, "")}`;
      if (await Bun.file(bin).exists()) return bin;
    }
  } catch {
    // Not installed as a dependency; fall through.
  }

  const onPath = await $`command -v graft`.quiet().nothrow();
  if (onPath.exitCode === 0) {
    const found = onPath.text().trim();
    if (found !== "") return found;
  }
  return null;
}

/**
 * Run `graft struct review` under a deadline (flyingrobots/footprint#100). Returns `{ failed }`
 * with the reason rather than throwing when graft fails, stalls or answers with something
 * unreadable: enrichment is optional, and a missing enrichment must be reported as a limitation
 * rather than failing the report.
 */
export async function structuralReview(
  graft: string,
  repo: string,
  base: string,
  head: string,
  opts: { readonly timeoutMs?: number } = {},
): Promise<StructuralReview | { readonly failed: string }> {
  const label = `graft struct review --base ${base} --head ${head} --json`;
  const run = await runBounded([graft, "--cwd", repo, "struct", "review", "--base", base, "--head", head, "--json"], repo, opts.timeoutMs ?? GRAFT_TIMEOUT_MS, label);
  if (!run.ok) return { failed: run.reason };
  if (run.code !== 0) return { failed: `${label} exited ${run.code}: ${run.err.trim().split("\n")[0] || "(no message)"}` };
  return parseStructuralReview(run.out) ?? { failed: `${label} did not answer with JSON footprint could read` };
}

/** Parse `graft struct review --json` output; null when it is not JSON. Pure, so a captured answer can be tested. */
export function parseStructuralReview(text: string): StructuralReview | null {
  try {
    const parsed = JSON.parse(text) as {
      files?: Array<{ path: string; category: string; structuralChanges?: { added: number; removed: number; changed: number } }>;
      breakingChanges?: unknown[];
    };
    const files: StructuralFile[] = (parsed.files ?? []).flatMap((f) => {
      if (!isCategory(f.category)) return [];
      const sc = f.structuralChanges;
      return [{
        path: f.path,
        category: f.category,
        ...(sc === undefined ? {} : { added: sc.added, removed: sc.removed, changed: sc.changed }),
      }];
    });
    return {
      files,
      breakingChanges: (parsed.breakingChanges ?? []).map((b) => (typeof b === "string" ? b : JSON.stringify(b))),
    };
  } catch {
    return null;
  }
}

const CATEGORIES = new Set(["structural", "formatting", "test", "docs", "config"]);
function isCategory(v: string): v is StructuralFile["category"] {
  return CATEGORIES.has(v);
}

/** How many files changed shape versus merely changed text. */
export function structuralSummary(review: StructuralReview): {
  structural: number;
  formatting: number;
  symbolsAdded: number;
  symbolsRemoved: number;
  symbolsChanged: number;
} {
  let structural = 0, formatting = 0, symbolsAdded = 0, symbolsRemoved = 0, symbolsChanged = 0;
  for (const f of review.files) {
    if (f.category === "structural") structural += 1;
    if (f.category === "formatting") formatting += 1;
    symbolsAdded += f.added ?? 0;
    symbolsRemoved += f.removed ?? 0;
    symbolsChanged += f.changed ?? 0;
  }
  return { structural, formatting, symbolsAdded, symbolsRemoved, symbolsChanged };
}
