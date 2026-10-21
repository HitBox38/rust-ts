// `-Zdump-mir` directories for scripts/phase-diff.ts's MIR stage (plan-m4 D11, lane harness-w21). Both sides run with
// `-Zdump-mir=all -Zdump-mir-dir=<dir> -Zdump-mir-exclude-pass-number`, so each writes one file per (body, pass,
// before/after) named `<crate>.<item>[-promoted[N]].<pass>.<before|after>.mir` (plus `<crate>.<item>.built.after.mir`,
// `renumber.0.mir`, `nll.0.mir`, the NLL/polonius `.dot`/`.html` files, ...), with no pass number in the name, so the
// two sides' names can be matched. Pass order is the order in which the files were written: rustc creates, writes and
// closes each dump file before the next pass runs, so it is the files' modification-time order (nanoseconds;
// ties, which this host's clocks do not produce in practice, by name).
// (No imports beyond node: unit-testable without loading scripts/lib/common.ts.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The files of a dump directory, in pass order (see the header). Empty if the directory does not exist. */
export function dumpFilesInOrder(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const t = new Map(names.map((n) => [n, statSync(join(dir, n), { bigint: true }).mtimeNs]));
  return names.sort((a, b) => {
    const d = t.get(a)! - t.get(b)!;
    return d < 0n ? -1 : d > 0n ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
}

export interface DumpDifference {
  /** The file (name in the dump directories). */
  file: string;
  /** `differs`: both wrote it, with different text; `missing`: only the oracle wrote it; `extra`: only the subject. */
  kind: "differs" | "missing" | "extra";
  /** For `differs`: the first differing line (1-based) and both sides' text of it (undefined past the end). */
  line?: number;
  oracle?: string;
  subject?: string;
  /** How many files of the oracle's, in its order, matched before this one. */
  matched: number;
}

/**
 * The first difference between the oracle's and the subject's dump directories, in pass order, or undefined if both
 * wrote the same files with the same text. The oracle's files are walked in the oracle's order: the first one the
 * subject did not write (`missing`) or wrote differently (`differs`) is the candidate. A file only the subject wrote
 * (`extra`; the first one in the subject's order) is reported instead when the subject wrote it before the candidate
 * (for a `missing` candidate: before the subject's copy of an oracle file that precedes the candidate), or when there
 * is no candidate.
 */
export function firstDumpDifference(oracleDir: string, subjectDir: string): DumpDifference | undefined {
  const o = dumpFilesInOrder(oracleDir);
  const s = dumpFilesInOrder(subjectDir);
  const inO = new Set(o);
  const sPos = new Map(s.map((n, i) => [n, i]));
  const extraAt = s.findIndex((n) => !inO.has(n));
  const extra = (matched: number): DumpDifference => ({ file: s[extraAt]!, kind: "extra", matched });
  // The subject's position of the last oracle file visited that the subject also wrote.
  let lastP = -1;
  for (let i = 0; i < o.length; i++) {
    const f = o[i]!;
    const p = sPos.get(f);
    if (p === undefined) {
      if (extraAt >= 0 && extraAt < lastP) return extra(i);
      return { file: f, kind: "missing", matched: i };
    }
    lastP = Math.max(lastP, p);
    const ot = readFileSync(join(oracleDir, f), "utf8");
    const st = readFileSync(join(subjectDir, f), "utf8");
    if (ot === st) continue;
    if (extraAt >= 0 && extraAt < p) return extra(i);
    const ol = ot.split("\n");
    const sl = st.split("\n");
    let k = 0;
    while (ol[k] === sl[k]) k++;
    return { file: f, kind: "differs", line: k + 1, oracle: ol[k], subject: sl[k], matched: i };
  }
  return extraAt >= 0 ? extra(o.length) : undefined;
}
