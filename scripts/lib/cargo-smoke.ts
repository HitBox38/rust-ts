// The pure parts of scripts/cargo-smoke.ts (plan-m8 §4b, `cargo-smoke`; lane harness-m8a-build). Only `cargo-smoke`'s oracle key hashes
// this file (harness/suites.ts `ORACLE_KEY_FILES`), so it is kept apart from lib/cargo-project-build.ts, which every project-build suite keys
// (review harness-m8a-build N1). No imports beyond node: and lib/unstable.ts / lib/cargo-project-build.ts (which have none of their own).
import { CARGO_TIME, nameRoots } from "./cargo-project-build.ts";
import { maskProgramOutput } from "./unstable.ts";

/** cargo's line for a unit it starts, whose order varies with `-j4` (scripts/cargo-smoke.ts). */
const STARTED = /^\s*(?:Compiling|Checking) \S+ v\S+/;

/**
 * A stream of a cargo-smoke step's cargo (scripts/cargo-smoke.ts) as compared: `roots` named, `\r\n` as `\n`, the thread id and libtest's time masked, the `Finished` line's
 * time masked, and the `Compiling`/`Checking` lines sorted in place of the first of them (the rest keep their order).
 */
export function normaliseSmokeStream(text: string, roots: readonly [string, string][]): string[] {
  const lines = maskProgramOutput(text.replaceAll("\r\n", "\n"))
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => nameRoots(l, roots))
    .map((l) => (/^\s*Finished /.test(l) ? l.replace(CARGO_TIME, " in <time>") : l));
  if (lines.length === 1 && lines[0] === "") return [];
  const started = lines.filter((l) => STARTED.test(l)).sort();
  const first = lines.findIndex((l) => STARTED.test(l));
  const rest = lines.filter((l) => !STARTED.test(l));
  if (first >= 0) rest.splice(first, 0, ...started);
  return rest;
}
