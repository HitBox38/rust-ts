// `-Zdump-mir` directories for scripts/phase-diff.ts's MIR stage (plan-m4 D11, lane harness-w21; review-w21 L1/L3 fixed
// by lane harness-w23). Both sides run with `-Zdump-mir=all -Zdump-mir-dir=<dir>`, so each writes one file per (body,
// pass, before/after) named `<crate>.<item>[-promoted[N]].<num>.<pass>.<disambiguator>.<ext>` (rustc_middle
// mir/pretty.rs `MirDumper::dump_path`): `<num>` is `<dialect>-<phase>-<pass count, 3 digits>` for the pass manager's
// dumps (pass_manager.rs `set_show_pass_num`) and `-------` for the others (`built.after.mir`, `renumber.0.mir`,
// `nll.0.mir`, the NLL/polonius `.dot`/`.html` files, ...).
// - Names keep the pass number (no `-Zdump-mir-exclude-pass-number`): without it a pass that runs twice on a body at
//   the same phase (`AddCallGuards`, `RemoveNoopLandingPads`, `AbortUnwindingCalls`) overwrites its first dump.
// - Matching key: the name without its `.<num>` component (so a pass the subject runs in addition or misses does not
//   rename every later dump of the body), plus `#<k>` for the k-th (k >= 1) earlier file with the same stripped name
//   in pass order.
// - Pass order is the order in which the files were written: rustc creates, writes and closes each dump file before the
//   next pass runs, so it is the files' modification-time order (nanoseconds). Ties (a coarse filesystem clock, e.g.
//   NTFS) fall back to the pass number for two dumps of the same body (`before` ahead of `after`), else to the name.
// (No imports beyond node: unit-testable without loading scripts/lib/common.ts.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The `.<num>.` component of a dump file name (see the header). */
const PASS_NUM = /\.(\d+)-(\d+)-(\d{3,})\.|\.-------\./;

interface DumpName {
  /** The name without the `.<num>` component. */
  stripped: string;
  /** `<crate>.<item>[-promoted[N]]` (everything before `.<num>`); the name itself if it has no `<num>`. */
  body: string;
  /** `[dialect, phase, pass count]` of a pass-manager dump. */
  num?: [number, number, number];
  /** 0 for `before`, 1 for `after`, 2 otherwise (the component after the pass name). */
  rank: number;
}

/** Splits a dump file name (see the header). */
export function parseDumpName(name: string): DumpName {
  const m = PASS_NUM.exec(name);
  if (!m) return { stripped: name, body: name, rank: 2 };
  const rest = name.slice(m.index + m[0].length);
  const disambiguator = rest.split(".")[1];
  return {
    stripped: name.slice(0, m.index) + "." + rest,
    body: name.slice(0, m.index),
    num: m[1] !== undefined ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined,
    rank: disambiguator === "before" ? 0 : disambiguator === "after" ? 1 : 2,
  };
}

/** Order of two files written at the same mtime (see the header). */
function tieOrder(a: string, b: string): number {
  const pa = parseDumpName(a);
  const pb = parseDumpName(b);
  if (pa.body === pb.body && pa.num && pb.num) {
    for (let i = 0; i < 3; i++) if (pa.num[i] !== pb.num[i]) return pa.num[i]! - pb.num[i]!;
    if (pa.rank !== pb.rank) return pa.rank - pb.rank;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

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
    return d < 0n ? -1 : d > 0n ? 1 : tieOrder(a, b);
  });
}

/** The matching key of each file of `files` (in pass order; see the header). */
export function matchKeys(files: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const s = parseDumpName(f).stripped;
    const k = seen.get(s) ?? 0;
    seen.set(s, k + 1);
    return k === 0 ? s : `${s}#${k}`;
  });
}

export interface DumpDifference {
  /** The file (the oracle's name; for `extra`, the subject's). */
  file: string;
  /** For `differs`: the subject's name of the file, when it is not `file` (another pass number). */
  subjectFile?: string;
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
 * wrote the same files (by matching key) with the same text. The oracle's files are walked in the oracle's order: the
 * first one the subject did not write (`missing`) or wrote differently (`differs`) is the candidate. A file only the
 * subject wrote (`extra`; the first one in the subject's order) is reported instead when the subject wrote it before
 * the candidate (for a `missing` candidate: before the subject's copy of an oracle file that precedes the candidate),
 * or when there is no candidate.
 */
export function firstDumpDifference(oracleDir: string, subjectDir: string): DumpDifference | undefined {
  const o = dumpFilesInOrder(oracleDir);
  const s = dumpFilesInOrder(subjectDir);
  const oKeys = matchKeys(o);
  const sKeys = matchKeys(s);
  const inO = new Set(oKeys);
  const sPos = new Map(sKeys.map((k, i) => [k, i]));
  const extraAt = sKeys.findIndex((k) => !inO.has(k));
  const extra = (matched: number): DumpDifference => ({ file: s[extraAt]!, kind: "extra", matched });
  // The subject's position of the last oracle file visited that the subject also wrote.
  let lastP = -1;
  for (let i = 0; i < o.length; i++) {
    const f = o[i]!;
    const p = sPos.get(oKeys[i]!);
    if (p === undefined) {
      if (extraAt >= 0 && extraAt < lastP) return extra(i);
      return { file: f, kind: "missing", matched: i };
    }
    lastP = Math.max(lastP, p);
    const sf = s[p]!;
    const ot = readFileSync(join(oracleDir, f), "utf8");
    const st = readFileSync(join(subjectDir, sf), "utf8");
    if (ot === st) continue;
    if (extraAt >= 0 && extraAt < p) return extra(i);
    const ol = ot.split("\n");
    const sl = st.split("\n");
    let k = 0;
    while (ol[k] === sl[k]) k++;
    return { file: f, ...(sf !== f ? { subjectFile: sf } : {}), kind: "differs", line: k + 1, oracle: ol[k], subject: sl[k], matched: i };
  }
  return extraAt >= 0 ? extra(o.length) : undefined;
}
