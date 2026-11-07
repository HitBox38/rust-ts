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
// - `custom_local_sysroot`, the empty crate rustc-build-sysroot writes, runs where it was built (`$BUILD`): the temp directory
//   the sysroot's own `custom_local_sysroot-*.d` names, as that path is in its metadata. Its `lib.rs` is empty (rustc-build-sysroot
//   0.5.14 src/lib.rs:480-485) and the corpus says so (`sources`); scripts/miri-sysroot-run.ts writes it there (review
//   miri-sysroot F1, lane fixers-46).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MIRI_CARGO_HOME, miriTargetLibDir, miriToolchainDir } from "../scripts/lib/miri.ts";

export const MIRI_SYSROOT_CORPUS = join(dirname(import.meta.path), "corpus", "miri-sysroot", "crates.json");
/** The crates of the report suites `miri-sysroot-<crate>`: this lane's goal. The corpus has all 27 of the sysroot's crates: see harness/corpus/gen-miri-sysroot.ts. */
export const MIRI_SYSROOT_SUITE_CRATES = ["core", "alloc", "std"] as const;

export interface MiriSysrootTemplate {
  cwd: string;
  args: string[];
  env: Record<string, string>;
  /** Files the crate's build wrote into `cwd` and that are gone: relative path to contents (`custom_local_sysroot`'s `lib.rs`). */
  sources?: Record<string, string>;
}

let memo: Record<string, MiriSysrootTemplate> | undefined;
/** The corpus: crate name to templated cwd, argv and env (`$TC`, `$CARGO_HOME`, `$LIB`, `$OUT`, `$BUILD`). */
export function miriSysrootCorpus(): Record<string, MiriSysrootTemplate> {
  return (memo ??= JSON.parse(readFileSync(MIRI_SYSROOT_CORPUS, "utf8")) as Record<string, MiriSysrootTemplate>);
}

/** Substitutes the corpus's placeholders; split out for the test. */
export const expandMiriSysroot = (s: string, v: { tc: string; cargoHome: string; lib: string; out: string; build: () => string }): string =>
  (s.includes("$BUILD") ? s.replaceAll("$BUILD", v.build()) : s).replaceAll("$TC", v.tc).replaceAll("$CARGO_HOME", v.cargoHome).replaceAll("$LIB", v.lib).replaceAll("$OUT", v.out);

/**
 * `$BUILD`: rustc-build-sysroot's temp directory of the run that built the sysroot in `lib`, from the first target of its
 * `custom_local_sysroot-*.d` (`<build>/target/<target>/custom_sysroot/build/...`). Read only for a template that uses it.
 */
export function miriSysrootBuildDir(lib: string): string {
  const d = readdirSync(lib).filter((f) => /^custom_local_sysroot-[0-9a-f]+\.d$/.test(f));
  if (d.length !== 1) throw new Error(`ERROR: ${d.length} custom_local_sysroot dep-info files in ${lib}, want 1`);
  const m = /^(\/.*?\/rustc-build-sysroot-[A-Za-z0-9]+)\/target\//.exec(readFileSync(join(lib, d[0]!), "utf8"));
  if (m === null) throw new Error(`ERROR: no rustc-build-sysroot directory in ${join(lib, d[0]!)}`);
  return m[1]!;
}

/** One crate's real command line: `args` for the compiler, with `--out-dir out`; `env` over the caller's; run in `cwd`, after writing `sources` there. */
export function miriSysrootInvocation(crate: string, out: string): MiriSysrootTemplate {
  const t = miriSysrootCorpus()[crate];
  if (!t) throw new Error(`ERROR: no sysroot crate '${crate}' in ${MIRI_SYSROOT_CORPUS}`);
  const lib = miriTargetLibDir();
  const v = { tc: miriToolchainDir(), cargoHome: MIRI_CARGO_HOME, lib, out, build: () => miriSysrootBuildDir(lib) };
  const x = (s: string) => expandMiriSysroot(s, v);
  return {
    cwd: x(t.cwd),
    args: [...t.args.map(x), "--sysroot", v.tc],
    env: { ...Object.fromEntries(Object.entries(t.env).map(([k, val]) => [k, x(val)])), MIRI_BE_RUSTC: "target" },
    ...(t.sources ? { sources: t.sources } : {}),
  };
}
