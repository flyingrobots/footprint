// The release workflow's manifest check (flyingrobots/footprint#35). npm normalizes package.json at
// publish time and drops what it considers invalid with only a warning: at v0.3.0 it removed
// `bin.footprint`, so the package would have shipped with no command. This makes any such
// correction a failure instead of a warning, two ways:
//
//   1. `npm pkg fix` on a copy of package.json must change no field (`manifest_rewrite` per field).
//   2. `npm publish --dry-run --access public` must report no correction (`publish_correction`).
//
// Usage: bun scripts/manifest-check.ts [--cwd <package dir>] [--npm "<npm command>"]
//
// Repository tooling, not part of the package and not a footprint result: it writes JSON Lines to
// stdout, one object per line with a `kind`, ending in one `manifest_check` line, and exits 1 when
// that line's `ok` is false. Prose is not offered; the lines are short enough to read.
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PREFIX = "npm warn publish ";
// npm colours its output on a terminal; strip SGR sequences before matching.
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Every correction a `npm publish` (or `--dry-run`) run reports having made to the manifest.
 * npm lists them as `npm warn publish` lines after `errors corrected:`. If npm says it
 * auto-corrected the manifest but lists nothing, the banner itself is returned, so a change in
 * npm's wording can only ever make this stricter, never silently clean.
 */
export function publishCorrections(output: string): string[] {
  const lines = output.replace(ANSI, "").split(/\r?\n/);
  const corrections: string[] = [];
  let banner: string | null = null;
  let listing = false;
  for (const line of lines) {
    if (!line.startsWith(PREFIX)) {
      listing = false;
      continue;
    }
    const text = line.slice(PREFIX.length).trim();
    if (/auto-corrected/i.test(text)) {
      banner = text;
      continue;
    }
    if (/^errors corrected:?$/i.test(text)) {
      listing = true;
      continue;
    }
    if (listing && text) corrections.push(text);
  }
  if (banner && corrections.length === 0) corrections.push(banner);
  return corrections;
}

/** Top-level manifest fields that differ between two parsed manifests, sorted. */
export function manifestChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

type Line = Record<string, unknown> & { kind: string };
const emit = (line: Line) => process.stdout.write(`${JSON.stringify(line)}\n`);

function run(cmd: string[], cwd: string) {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, output: `${r.stdout.toString()}\n${r.stderr.toString()}` };
}

function main(argv: string[]): number {
  let cwd = process.cwd();
  let npm = ["npm"];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) cwd = resolve(argv[++i]!);
    else if (argv[i] === "--npm" && argv[i + 1]) npm = argv[++i]!.split(/\s+/).filter(Boolean);
    else {
      emit({ kind: "error", code: "usage", message: `unknown argument ${JSON.stringify(argv[i])}; usage: manifest-check.ts [--cwd <dir>] [--npm "<npm command>"]` });
      return 2;
    }
  }

  const manifest = join(cwd, "package.json");
  const original = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
  let errors = 0;

  // 1. npm pkg fix, on a copy, so the repository is never rewritten.
  const copy = mkdtempSync(join(tmpdir(), "footprint-manifest-check-"));
  copyFileSync(manifest, join(copy, "package.json"));
  const fix = run([...npm, "pkg", "fix"], copy);
  if (fix.code !== 0) {
    errors++;
    emit({ kind: "error", code: "npm_pkg_fix_failed", exit: fix.code, output: fix.output.trim() });
  }
  const fixed = JSON.parse(readFileSync(join(copy, "package.json"), "utf8")) as Record<string, unknown>;
  const rewrites = manifestChanges(original, fixed);
  for (const field of rewrites) emit({ kind: "manifest_rewrite", field, before: original[field] ?? null, after: fixed[field] ?? null });

  // 2. npm publish --dry-run, in the package itself, as the publish job will run it.
  const pub = run([...npm, "publish", "--dry-run", "--access", "public"], cwd);
  const corrections = publishCorrections(pub.output);
  for (const correction of corrections) emit({ kind: "publish_correction", correction });
  if (pub.code !== 0) {
    errors++;
    emit({ kind: "error", code: "npm_publish_dry_run_failed", exit: pub.code, output: pub.output.trim() });
  }

  const ok = errors === 0 && rewrites.length === 0 && corrections.length === 0;
  emit({ kind: "manifest_check", ok, package: `${original.name}@${original.version}`, npm: npm.join(" "), rewrites: rewrites.length, corrections: corrections.length, errors });
  return ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    emit({ kind: "error", code: "unexpected", message: e instanceof Error ? e.message : String(e) });
    emit({ kind: "manifest_check", ok: false, errors: 1 });
    process.exit(1);
  }
}
