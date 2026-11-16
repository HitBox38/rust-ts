// The pure parts of the ripgrep behaviour suites (plan-m7 §6, D19; lane harness-m7d; split from lib/rg-build.ts by lane harness-m8a-build,
// whose build parts are lib/cargo-project-build.ts): `rg-behaviour` and `rg-behaviour-rgtest` (scripts/rg-behaviour.ts). No imports beyond
// node:, so tests load it without scripts/lib/common.ts.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The ignore files rg would read above `dir`: it reads `.ignore` and `.rgignore` in every parent directory up to the root, whatever
 * the repository (the `ignore` crate's `add_parents`), so one there would change what the corpus's queries see (review harness-m7d N4).
 */
export function ancestorIgnoreFiles(dir: string): string[] {
  const found: string[] = [];
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const f of [".ignore", ".rgignore"]) if (existsSync(join(d, f))) found.push(join(d, f));
    if (dirname(d) === d) break;
  }
  return found;
}

/** A file of the checked-in corpus: text, or bytes in base64 (a binary file, a Latin-1 file). */
export type CorpusFile = string | { base64: string };

/** One scripted query: rg's argv, and what its stdin holds (empty unless given). */
export interface RgQuery {
  id: string;
  args: string[];
  stdin?: string;
}

/** The corpus's bytes for one file. */
export const corpusBytes = (f: CorpusFile): Buffer => (typeof f === "string" ? Buffer.from(f, "utf8") : Buffer.from(f.base64, "base64"));

/**
 * What rg prints that changes from run to run, masked on both sides: `--json`'s `elapsed` and `elapsed_total` objects, whose three fields
 * come in either order (`{"secs":0,"nanos":51000,"human":"0.000051s"}` in an `end` message, `{"human":...,"nanos":...,"secs":0}` in the
 * `summary`), each as `"<time>"`, and `--stats`'s `<n> seconds` lines. Nothing else is masked.
 */
export function maskRgTimes(text: string): string {
  return text
    .replace(/"(elapsed(?:_total)?)":\{(?:"(?:secs|nanos|human)":(?:\d+|"[0-9.]+s"),?){3}\}/g, '"$1":"<time>"')
    .replace(/^\d+\.\d+ seconds/gm, "<time> seconds");
}

/** libtest's result line for one test, `test <name> ... ok|FAILED|ignored`, or undefined. */
export function libtestResult(line: string): { name: string; result: string } | undefined {
  const m = /^test (\S+) \.\.\. (ok|FAILED|ignored(?:, .*)?)$/.exec(line);
  return m ? { name: m[1]!, result: m[2]! } : undefined;
}

/** The sections of rg-behaviour-rgtest's report, one per test, sorted by name (the tests run on several threads). */
export function rgtestSections(stdout: string): string[] {
  const rs = stdout.split("\n").map(libtestResult).filter((r): r is { name: string; result: string } => r !== undefined);
  rs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rs.flatMap((r) => [`== ${r.name}`, `  ${r.result}`]);
}
