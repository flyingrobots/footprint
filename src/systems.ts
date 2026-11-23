// The system a call site lives in, and the mitigation its row carries
// (flyingrobots/footprint#11).
//
// footprint#2 §3 asks for one blast-radius table per system, a row per call site, each with a
// containment mitigation, allowing "None needed" so a row is never padded. Two things have to be
// defined precisely for that to be a report rather than an opinion, and both are here.
//
// 1. WHAT A SYSTEM IS. The first path segment of a call site's repository-relative path -- the
//    directory immediately under the repository root. A path with no directory component, a file
//    at the repository root, belongs to no system and is grouped under `(unassigned)`: present and
//    named, never dropped.
//
//    This is the simplest rule that groups anything, and it needs no configuration and no list to
//    keep. `src/` descending one more level was considered and rejected: `src/` in this repository
//    is flat, so the branch would have no effect on the run that proves the feature, and a rule
//    whose extra clause never fires is a rule nobody can check. A configurable list was rejected
//    for the same reason -- it would make the grouping depend on a setting rather than on the
//    tree, and a reviewer could not tell from the output which systems were even considered.
//
// 2. WHAT A MITIGATION IS. `AGENTS.md`: report, never judge. So a mitigation here is not advice.
//    It is one of three sentences, chosen by two facts about the call site and nothing else:
//    whether the call site is in the very file the symbol is exported from, and what
//    `classify()` calls that file. Four bases, three forms, nothing derived from a judgement
//    about importance, risk or quality:
//
//      declaring_file  the call site is in the file the symbol is exported from   -> None needed
//      test_file       `classify()` calls the call site's file a test             -> None needed
//      other_system    anything else, inside a system                            -> the system, named
//      unassigned      anything else, outside every system                       -> said as such
//
//    Both "None needed" bases are facts a reviewer can check in one line, not an assessment: the
//    declaring file is the file whose export surface moved, so a call site in it is the change
//    itself rather than something the change reaches; and a test file is what `classify()` says it
//    is, by the documented ordered rules in `src/classify.ts`.
//
//    What this deliberately does NOT say: whether a call site matters, whether it will break,
//    whether it is covered, or what anyone should do about it. The moment a mitigation says
//    "consider adding a test" it is a verdict, and footprint stops being a report. OUT-14e holds
//    the output to the three forms with an allowlist the test declares for itself.
//
// Everything here is pure, so the whole of OUT-14 except the end-to-end case runs without git.

import { classify } from "./classify.ts";
import type { CallSite } from "./callsites.ts";

/** What the grouping calls itself on the wire, so a reader knows which rule produced it. */
export const SYSTEM_RULE = "path_prefix" as const;

/** The system of a call site that is in no system. A name, not a null: a group, not a gap. */
export const UNASSIGNED_SYSTEM = "(unassigned)" as const;

/** The one mitigation that is not a statement about a path. Spelled exactly as the issue asks. */
export const NONE_NEEDED = "None needed" as const;

/** The grouping rule, once, quoted onto every record so the output explains itself. */
export const SYSTEM_RULE_DETAIL =
  "A system is the first path segment of a call site's repository-relative path: the directory immediately under the repository root, however deep the file sits inside it. A file at the repository root has no such segment and is grouped under (unassigned), which is listed last and never dropped. Systems are ordered by name so the grouping follows the tree rather than the order the scan found the sites in.";

/** The mitigation derivation, once, quoted onto every record for the same reason. */
export const MITIGATION_RULE =
  "Every row's mitigation is derived from two reported facts about that call site and nothing else: whether it is in the very file the symbol is exported from, and what classify() calls that file. A call site in the symbol's own declaring file, or in a test file, is \"None needed\"; any other call site states the system it is in, or that it is outside every known system. No mitigation is a judgement about importance, risk or coverage, and none is advice: footprint reports and does not judge (AGENTS.md).";

/** Which of the two facts chose a row's mitigation, on the wire, so the derivation is checkable. */
export type MitigationBasis = "declaring_file" | "test_file" | "other_system" | "unassigned";

/** A call site with the system that contains it and the mitigation its row carries. */
export interface AssignedCallSite extends CallSite {
  readonly system: string;
  readonly mitigation: string;
  readonly mitigationBasis: MitigationBasis;
}

/**
 * The system containing `path`: its first path segment, or `(unassigned)` when it has none.
 *
 * A leading slash is treated as no segment too. `git ls-files` never prints one, so this is a
 * guard rather than a case: a path footprint cannot place is grouped, not dropped.
 */
export function systemOf(path: string): string {
  const slash = path.indexOf("/");
  return slash <= 0 ? UNASSIGNED_SYSTEM : path.slice(0, slash);
}

/**
 * Which fact decides this row's mitigation. Ordered, and the order is load-bearing: the declaring
 * file wins over everything, because a symbol declared in a test file is still its own
 * declaration, and `classify()` wins over the system, because a test fixture at the repository
 * root is a test file before it is a file in no system.
 */
export function mitigationBasis(symbolFile: string, siteFile: string): MitigationBasis {
  if (siteFile === symbolFile) return "declaring_file";
  if (classify(siteFile) === "test") return "test_file";
  return systemOf(siteFile) === UNASSIGNED_SYSTEM ? "unassigned" : "other_system";
}

/** The sentence for a basis. Three forms, and no fourth: see OUT-14e. */
export function mitigationFor(basis: MitigationBasis, system: string): string {
  switch (basis) {
    case "declaring_file":
    case "test_file":
      return NONE_NEEDED;
    case "other_system":
      return `Call site in ${system}, outside the changed file.`;
    case "unassigned":
      return "Call site outside every known system, outside the changed file.";
  }
}

/** A call site, placed in its system and given its row's mitigation. */
export function assignCallSite(symbolFile: string, site: CallSite): AssignedCallSite {
  const system = systemOf(site.file);
  const basis = mitigationBasis(symbolFile, site.file);
  return { file: site.file, line: site.line, system, mitigation: mitigationFor(basis, system), mitigationBasis: basis };
}

/** One row of one table: which symbol's reach this call site is. */
export interface SystemRow {
  readonly symbol: string;
  readonly site: AssignedCallSite;
}

/** One table: a system and the rows in it. */
export interface SystemGroup {
  readonly system: string;
  readonly rows: readonly SystemRow[];
}

/** A system and how many call sites are in it, which is what the result carries. */
export interface SystemCount {
  readonly system: string;
  readonly callSites: number;
}

/**
 * Systems before `(unassigned)`, and otherwise by name. Comparing by name and nothing else keeps
 * the grouping a function of the tree: two runs over the same sites group identically whatever
 * order the scan found them in, which is what lets the grouping sit inside the digest.
 */
function bySystem(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNASSIGNED_SYSTEM) return 1;
  if (b === UNASSIGNED_SYSTEM) return -1;
  return a.localeCompare(b);
}

/**
 * Group rows into one group per system. Rows inside a group are ordered by symbol, then file, then
 * line, so a symbol's call sites in one system are contiguous -- which is what lets `--human` cap
 * a long symbol and name the remainder once, rather than interleaving.
 */
export function groupBySystem(rows: Iterable<SystemRow>): readonly SystemGroup[] {
  const groups = new Map<string, SystemRow[]>();
  for (const row of rows) {
    const list = groups.get(row.site.system);
    if (list === undefined) groups.set(row.site.system, [row]);
    else list.push(row);
  }
  return [...groups.keys()].sort(bySystem).map((system) => ({
    system,
    rows: groups.get(system)!.sort(
      (a, b) => a.symbol.localeCompare(b.symbol) || a.site.file.localeCompare(b.site.file) || a.site.line - b.site.line,
    ),
  }));
}

/**
 * How many call sites each system holds, in the same order. These sum to `counts.call_sites` by
 * construction -- every call site is in exactly one system, `(unassigned)` included -- and a test
 * asserts the sum rather than trusting the construction.
 */
export function systemCounts(sites: Iterable<AssignedCallSite>): readonly SystemCount[] {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site.system, (counts.get(site.system) ?? 0) + 1);
  return [...counts.keys()].sort(bySystem).map((system) => ({ system, callSites: counts.get(system)! }));
}
