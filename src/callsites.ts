// Call sites for a symbol: where in the tree its name occurs, with file and line
// (flyingrobots/footprint#10).
//
// Why footprint computes this itself. graft 0.14.0 has reference analysis, but no CLI contract of
// its own answers with a call site's *line*: `symbol blame --json` carries a `referenceCount` and
// no per-reference list, and `struct review --json`, `symbol difficulty --json` and
// `struct test-coverage --json` carry referencing *file paths* only. All four read the WARP index
// rather than the tree. So this is footprint's own scan, and it is deliberately the most
// conservative one that can be checked by an independent oracle:
//
//   a call site is a whole-word occurrence of the symbol's name in a tracked, non-binary file.
//
// "Whole-word" is `grep -w`'s own rule -- the match may not be preceded or followed by a word
// constituent character, `[A-Za-z0-9_]` -- which is what lets the test compare footprint's answer
// with real `grep -I -n -w` over `git ls-files` line for line, instead of with a hand-written
// expectation. The limits are stated everywhere the result is: it counts the declaration itself, a
// mention in a comment, a string or prose, and it cannot see a call through dynamic dispatch or a
// re-export under another name. It is evidence a reviewer can check, not a call graph.
//
// Matching is pure (`matchLines`), so most of the suite needs neither git nor a filesystem.

import { $ } from "bun";
import { join } from "node:path";

export interface CallSite {
  readonly file: string;
  readonly line: number;
}

/** What the scan calls itself on the wire, so a reader knows what kind of evidence this is. */
export const SCAN_METHOD = "identifier_scan";

/** The word boundary, named once: `grep -w`'s rule, and the schema and the docs quote this. */
export const WORD_CHARACTER = "[A-Za-z0-9_]";

/** How much of a file is read to decide it is binary. GNU grep decides on its first buffer too. */
const BINARY_SNIFF_BYTES = 8192;

export type ScanUnavailableCode = "scan.not_run" | "scan.ls_files_failed";

export interface SkippedFiles {
  /** Files holding a NUL byte: skipped, exactly as `grep -I` skips them. */
  readonly binary: number;
  /** Tracked files that could not be read, a file deleted from the working tree among them. */
  readonly unreadable: number;
}

export type CallSiteScan =
  | {
      readonly available: true;
      /** One entry per symbol asked for, including the ones nothing references. */
      readonly sites: ReadonlyMap<string, readonly CallSite[]>;
      readonly filesScanned: number;
      readonly skipped: SkippedFiles;
    }
  | {
      readonly available: false;
      readonly reason: { readonly code: ScanUnavailableCode; readonly detail: string };
    };

export function unavailableScan(code: ScanUnavailableCode, detail: string): CallSiteScan {
  return { available: false, reason: { code, detail } };
}

/**
 * No scan was run. A distinct state from a scan that found nothing: an empty list means "looked,
 * found none", and this means "did not look". Collapsing the two would report a figure that was
 * never computed.
 */
export function notRunScan(): CallSiteScan {
  return unavailableScan(
    "scan.not_run",
    "the export surface was parsed without a call-site scan, so no tree was read; this is not an empty call-site list",
  );
}

/** The sites for one symbol, or null when the scan did not run -- never a misleading `[]`. */
export function sitesFor(scan: CallSiteScan, symbol: string): readonly CallSite[] | null {
  if (!scan.available) return null;
  return scan.sites.get(symbol) ?? null;
}

/** A NUL byte in the first buffer. The same heuristic `grep -I` uses, so the oracle agrees. */
export function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return true;
  return false;
}

function wordPattern(symbol: string): RegExp {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!${WORD_CHARACTER})${escaped}(?!${WORD_CHARACTER})`, "g");
}

/**
 * The line numbers, 1-based and ascending, where each symbol occurs as a whole word.
 *
 * One entry per line however many times the symbol occurs on it, because that is what `grep -n`
 * reports and the oracle has to be comparable. Every symbol asked for gets a key, so a symbol
 * nothing references is an empty list rather than a missing one.
 */
export function matchLines(text: string, symbols: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const symbol of symbols) out.set(symbol, []);

  let starts: number[] | null = null;
  for (const symbol of symbols) {
    if (symbol === "" || !text.includes(symbol)) continue; // the cheap filter before the regex
    if (starts === null) starts = lineStarts(text);
    const lines = out.get(symbol)!;
    let last = -1;
    for (const m of text.matchAll(wordPattern(symbol))) {
      const line = lineOf(starts, m.index);
      if (line !== last) {
        lines.push(line);
        last = line;
      }
    }
  }
  return out;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** Binary search: the 1-based line holding `offset`. */
function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The tracked files, from git and nothing else, or null when git could not list them. */
export async function trackedFiles(repo: string): Promise<readonly string[] | null> {
  const ls = await $`git -C ${repo} ls-files -z`.quiet().nothrow();
  if (ls.exitCode !== 0) return null;
  return ls.text().split("\0").filter((f) => f !== "");
}

/**
 * Scan the tracked files of the working tree at `repo` for every symbol named.
 *
 * The working tree, not a ref: a run reports the call sites a reviewer would find in the checkout
 * in front of them. With no symbol to look up, nothing is read at all -- an empty surface costs no
 * git call and the scan honestly reports zero files scanned.
 */
export async function scanCallSites(repo: string, symbols: readonly string[]): Promise<CallSiteScan> {
  const wanted = [...new Set(symbols)].filter((s) => s !== "");
  if (wanted.length === 0) {
    return { available: true, sites: new Map(), filesScanned: 0, skipped: { binary: 0, unreadable: 0 } };
  }

  const files = await trackedFiles(repo);
  if (files === null) {
    return unavailableScan(
      "scan.ls_files_failed",
      `git ls-files -z exited non-zero in ${repo}, so footprint has no file list to scan and will not guess at one`,
    );
  }

  const found = new Map<string, CallSite[]>();
  for (const s of wanted) found.set(s, []);
  let filesScanned = 0;
  let binary = 0;
  let unreadable = 0;

  for (const file of files) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await Bun.file(join(repo, file)).arrayBuffer());
    } catch {
      unreadable += 1; // tracked but not on disk: deleted in the working tree, or unreadable
      continue;
    }
    if (isBinary(bytes)) {
      binary += 1;
      continue;
    }
    filesScanned += 1;
    const text = new TextDecoder().decode(bytes);
    for (const [symbol, lines] of matchLines(text, wanted)) {
      const sites = found.get(symbol)!;
      for (const line of lines) sites.push({ file, line });
    }
  }

  // By file then line, so the digest follows the tree rather than the order git listed it in.
  for (const sites of found.values()) sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { available: true, sites: found, filesScanned, skipped: { binary, unreadable } };
}
