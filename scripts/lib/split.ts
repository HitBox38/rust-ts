// Split mode (plan-m5 D6, §4.1; lane harness-m5a): one oracle and one subject process per *run* (e.g. all of core),
// whose stdout is cut into many cases by a suite-provided splitter. Each section is MATCH/DIFF on its own and enters the
// protected set on its own; scripts/difftest.ts does the running, this file only the pure parts (no imports beyond Bun's
// hasher: unit-testable without loading scripts/lib/common.ts).
//
// - A splitter returns the sections in output order, each with an id, plus the *skeleton*: every line outside the
//   sections, with each section replaced by one line `<<id>>`. difftest compares the skeleton (with stderr and the exit
//   code) as the run's own case, so "run case MATCH and every section MATCH" means the whole output is identical: the
//   skeleton holds the preamble, the separators between sections, and the sequence of ids (a missing, extra or
//   reordered section changes it).
// - Ids must not shift when a section is missing or extra (plan-m5 §4.1): id = the section's key + an occurrence index
//   among equal keys (`uniqueIds`), never a position.
// - Core-scale outputs are never stored raw (plan-m5 §6): `splitHashes` is what the oracle cache keeps.

/** One case of a split run. */
export interface Section {
  id: string;
  text: string;
}

export interface SplitOutput {
  /** In output order; ids are unique. */
  sections: Section[];
  /** Every line outside the sections, with each section replaced by one line `<<id>>` (see the header). */
  skeleton: string;
}

export type Splitter = (stdout: string) => SplitOutput;

/** What the oracle cache keeps of a split output: one hash per section, in output order, and the skeleton's hash. */
export interface SplitHashes {
  sections: [id: string, hash: string][];
  skeleton: string;
}

const sha1 = (s: string): string => new Bun.CryptoHasher("sha1").update(s).digest("hex");

export function splitHashes(out: SplitOutput): SplitHashes {
  return { sections: out.sections.map((s) => [s.id, sha1(s.text)]), skeleton: sha1(out.skeleton) };
}

/**
 * Ids from keys, in order: the first occurrence of a key is the key itself, the k-th (k >= 2) is `<key> @k`. So a
 * missing or extra section with another key shifts nothing, unless that key itself has the form `<key> @k`: should
 * `<key> @k` be another section's key in the same output, the occurrence index skips ahead until the id is unused. So
 * an id depends on the earlier sections with the same key and on whether the same side's output has a section keyed
 * `<key> @k` (e.g. a subject with an extra section keyed literally `X @2` numbers its own second `X` `X @3`, and its `X
 * @2` is compared with the oracle's second `X`). No MIR header ends in ` @<n>`, so for `splitMirPretty` it is the former.
 */
export function uniqueIds(keys: readonly string[]): string[] {
  const keySet = new Set(keys);
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return keys.map((key) => {
    let n = seen.get(key) ?? 0;
    let id: string;
    do {
      n++;
      id = n === 1 ? key : `${key} @${n}`;
    } while (used.has(id) || (n > 1 && keySet.has(id)));
    seen.set(key, n);
    used.add(id);
    return id;
  });
}

/**
 * The key of a `-Zunpretty=mir` body: its header line (rustc_middle mir/pretty.rs `write_mir_sig`: `[fn |const |static
 * |static mut ]<def_path_str>[::promoted[N]]` and the signature, `(<args>) -> <ret>` or `: <ty>`; anonymous and inline
 * consts have no keyword) without the trailing ` {` / ` = {`, or for a trivial const's one line (`const <path>: <ty> =
 * const <val>;`) without its value, so a wrong value is a differing section, not a missing one. The whole header and not just the def path: core prints
 * many bodies whose def paths are equal (impls from one macro call site print as the same `<impl at <span>>`), and the
 * signature tells most of them apart (measured on core: 17,704 repeated def paths; 1,107 bodies repeat an earlier header, among 135 distinct headers), so fewer
 * ids depend on an occurrence index.
 */
export function mirBodyKey(header: string): string {
  const v = header.endsWith(";") ? header.indexOf(" = const ") : -1;
  return v >= 0 ? header.slice(0, v) : header.replace(/(?: =)? \{$/, "");
}

/** The comment `write_mir_pretty` prints before a const fn's `mir_for_ctfe` body. */
const MIR_FOR_CTFE = "// MIR FOR CTFE";
/** A line of `write_allocations` that starts an allocation (`alloc12 (size: 4, align: 4) {`, `alloc3 (fn: ..)`, ...). */
const ALLOC_LINE = /^alloc\d+ \(/;

/**
 * Splits `-Zunpretty=mir` output (rustc_middle mir/pretty.rs `write_mir_pretty`) into one section per MIR body.
 *
 * The output is a 3-line `//` preamble, then every `mir_keys` item separated by an empty line: a body (its header line,
 * indented lines, `}`, then its allocations, each `allocN (..)` at column 0 with indented bytes and a closing `}`), its
 * promoteds (each after an empty line), and for a const fn an empty line, `// MIR FOR CTFE` and the `mir_for_ctfe`
 * body; a trivial const is one line `const <path>: <ty> = const <val>;`.
 * - A section starts at every column-0 line that is not empty, `}`, an allocation line or a `//` comment, and at every
 *   `// MIR FOR CTFE` line (whose next line, the body header, belongs to the same section). It runs up to the next
 *   start, without the empty lines before it (those are the skeleton's).
 * - Key: `mirBodyKey` of the header, with ` [ctfe]` for a `mir_for_ctfe` body; a promoted's def path ends in
 *   `::promoted[N]`. Ids: `uniqueIds`.
 * Lines before the first section (the preamble) and the empty lines between sections are the skeleton.
 */
export function splitMirPretty(stdout: string): SplitOutput {
  const lines = stdout.split("\n");
  /** [first line, end line (exclusive, trailing empty lines dropped), key] of every section. */
  const spans: [number, number, string][] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    const starts = l === MIR_FOR_CTFE || (l !== "" && l[0] !== " " && l[0] !== "\t" && l !== "}" && !l.startsWith("//") && !ALLOC_LINE.test(l));
    if (!starts) {
      i++;
      continue;
    }
    const ctfe = l === MIR_FOR_CTFE;
    const header = ctfe ? (lines[i + 1] ?? "") : l;
    const key = ctfe ? `${mirBodyKey(header)} [ctfe]` : mirBodyKey(header);
    let j = ctfe ? i + 2 : i + 1;
    while (j < lines.length) {
      const m = lines[j]!;
      if (m === MIR_FOR_CTFE || (m !== "" && m[0] !== " " && m[0] !== "\t" && m !== "}" && !m.startsWith("//") && !ALLOC_LINE.test(m))) break;
      j++;
    }
    let end = j;
    while (end > i + 1 && lines[end - 1] === "") end--;
    spans.push([i, end, key]);
    i = end;
  }
  const ids = uniqueIds(spans.map((s) => s[2]));
  const sections: Section[] = [];
  const skel: string[] = [];
  let at = 0;
  spans.forEach(([start, end], k) => {
    for (; at < start; at++) skel.push(lines[at]!);
    skel.push(`<<${ids[k]}>>`);
    sections.push({ id: ids[k]!, text: lines.slice(start, end).join("\n") });
    at = end;
  });
  for (; at < lines.length; at++) skel.push(lines[at]!);
  return { sections, skeleton: skel.join("\n") };
}

/** Splitters by name (`Suite.split`); the name is part of a split suite's oracle cache key, with this file's source. */
export const SPLITTERS: Record<string, Splitter> = { "mir-pretty": splitMirPretty };

/** A section's outcome against the oracle's: same hash, a different one, or absent from the subject's output. */
export type SectionOutcome = "match" | "differs" | "missing";

/**
 * Every oracle section's outcome against the subject's sections (by id, so order does not matter here: the skeleton
 * catches it), plus the ids only the subject has, in its order. A section missing from the subject is never a match.
 */
export function compareSections(oracle: SplitHashes, subject: SplitHashes): { outcomes: [id: string, SectionOutcome][]; extra: string[] } {
  const sub = new Map(subject.sections);
  const outcomes = oracle.sections.map(([id, h]): [string, SectionOutcome] => {
    const sh = sub.get(id);
    return [id, sh === undefined ? "missing" : sh === h ? "match" : "differs"];
  });
  const ours = new Set(oracle.sections.map(([id]) => id));
  return { outcomes, extra: subject.sections.map(([id]) => id).filter((id) => !ours.has(id)) };
}
