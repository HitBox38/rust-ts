// The port as Miri's sysroot compiler (plan-m6 §5 suite row, D4; lane harness-m6d): each crate of the Miri sysroot, built with
// the argv and environment cargo-miri used (`harness/corpus/miri-sysroot/crates.json`, from `cargo miri setup -v`).
//
// - Both sides run with `MIRI_BE_RUSTC=target`: the oracle is the isolated `miri` binary, the subject src/miri/bin/miri.ts.
// - `--sysroot <toolchain>` is added on both sides: it is the isolated Miri's default sysroot (its own install), where the
//   port's default would be its own checkout. Replaying a crate with the isolated Miri gives the sysroot's bytes, so the
//   replay's argv is faithful (scripts/miri-sysroot-run.ts prints that on the oracle side too).
// - The cwd is the crate's manifest directory, as cargo runs a crate outside its workspace.
// - Every dependency is the sysroot's own rmeta/rlib (`$LIB`), not one the port built: each crate's result depends on the
//   port's handling of that crate only, as in the M5 suites (plan-m5 D2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIRI_CARGO_HOME, miriTargetLibDir, miriToolchainDir } from "../scripts/lib/miri.ts";

export const MIRI_SYSROOT_CORPUS = join(dirname(import.meta.path), "corpus", "miri-sysroot", "crates.json");
/** The crates of the report suites `miri-sysroot-<crate>`: this lane's goal. The corpus has 26 of the sysroot's 27: see harness/corpus/gen-miri-sysroot.ts. */
export const MIRI_SYSROOT_SUITE_CRATES = ["core", "alloc", "std"] as const;

export interface MiriSysrootTemplate {
  cwd: string;
  args: string[];
  env: Record<string, string>;
}

let memo: Record<string, MiriSysrootTemplate> | undefined;
/** The corpus: crate name to templated cwd, argv and env (`$TC`, `$CARGO_HOME`, `$LIB`, `$OUT`). */
export function miriSysrootCorpus(): Record<string, MiriSysrootTemplate> {
  return (memo ??= JSON.parse(readFileSync(MIRI_SYSROOT_CORPUS, "utf8")) as Record<string, MiriSysrootTemplate>);
}

/** Substitutes the corpus's placeholders; split out for the test. */
export const expandMiriSysroot = (s: string, v: { tc: string; cargoHome: string; lib: string; out: string }): string =>
  s.replaceAll("$TC", v.tc).replaceAll("$CARGO_HOME", v.cargoHome).replaceAll("$LIB", v.lib).replaceAll("$OUT", v.out);

/** One crate's real command line: `args` for the compiler, with `--out-dir out`; `env` over the caller's; run in `cwd`. */
export function miriSysrootInvocation(crate: string, out: string): MiriSysrootTemplate {
  const t = miriSysrootCorpus()[crate];
  if (!t) throw new Error(`ERROR: no sysroot crate '${crate}' in ${MIRI_SYSROOT_CORPUS}`);
  const v = { tc: miriToolchainDir(), cargoHome: MIRI_CARGO_HOME, lib: miriTargetLibDir(), out };
  const x = (s: string) => expandMiriSysroot(s, v);
  return {
    cwd: x(t.cwd),
    args: [...t.args.map(x), "--sysroot", v.tc],
    env: { ...Object.fromEntries(Object.entries(t.env).map(([k, val]) => [k, x(val)])), MIRI_BE_RUSTC: "target" },
  };
}
