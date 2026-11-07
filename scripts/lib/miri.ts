// The Miri oracle (plan-m6 D1, D6, D14; lane harness-m6a): the pinned nightly's own Miri, installed into an isolated
// rustup home, never into the oracle toolchain (decision 2026-10-31: the oracle is immutable; its `rust-src` changed
// rustc's diagnostics once). Layout, all under $RUST_TS_DATA:
// - `rustup-miri/`: RUSTUP_HOME of the toolchain `<nightlyName>-<host>` with the components UPSTREAM.json
//   `rust.miri.components` pins (`--profile minimal --component miri,rust-src`: cargo, miri-preview, rust-src,
//   rust-std, rustc). Its rustc is the oracle's build (same commit, bit-identical `librustc_driver`, checked).
// - `cargo-miri/`: its CARGO_HOME (the crates.io sources the sysroot build downloads).
// - `miri-sysroot/`: the Miri sysroot for `rust.miri.target` (x86_64-unknown-linux-gnu), built by `cargo miri setup`
//   from that toolchain's `rust-src` (plan-m6 D4: M6 interprets this oracle-built sysroot).
// `bun scripts/miri.ts setup` creates all three (idempotent); `verifyMiriOracle` checks them before any Miri oracle
// output is produced or cached (difftest, for suites with `Suite.miri`). Every Miri process is run by absolute path
// (`miriBinary`) with `RUSTUP_HOME`/`CARGO_HOME` set to the isolated homes (`MIRI_CASE_ENV`).
//
// Cache key (`miriOracleKey`, a suite's `Suite.oracleKey`): the toolchain identity (miri binary, the isolated
// `librustc_driver`, the components file), the sysroot (every file under `miri-sysroot/`: path and content) and the
// target. difftest's own key adds the case's argv (the flags), env, file and dependencies (scripts/lib/deps.ts) and the
// miri binary again (`oracleVersion`: the command's first word).
//
// Absolute paths (plan-m6 A11): the Miri oracle's output names the sysroot's sources by their absolute local path
// (`<RUSTUP_HOME>/toolchains/.../lib/rustlib/src/rust/library/...` in backtraces and notes into std), and the argv
// holds `--sysroot <abs path>`, so the oracle cache of a Miri suite is bound to this machine's $RUST_TS_DATA: another
// host (or another data dir) re-runs every case. Both sides of a case use the same paths, so this never causes a DIFF.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DATA, PIN, die, hash } from "./common.ts";
import { oracleHost, rustcDriverHash } from "./oracle.ts";
import { miriToolchainError } from "./toolchain.ts";
import type { MiriPin } from "./common.ts";

/** UPSTREAM.json `rust.miri` (dies on first use if it is missing). */
export function miriPin(): MiriPin {
  const m = PIN.miri;
  if (!m || typeof m.target !== "string" || !Array.isArray(m.components)) die("UPSTREAM.json has no rust.miri { target, components } (the isolated Miri toolchain's pin)");
  return m;
}

/** RUSTUP_HOME of the isolated Miri toolchain. */
export const MIRI_RUSTUP_HOME = join(DATA, "rustup-miri");
/** CARGO_HOME of the isolated Miri toolchain. */
export const MIRI_CARGO_HOME = join(DATA, "cargo-miri");
/** The Miri sysroot (`cargo miri setup` with `MIRI_SYSROOT`). */
export const MIRI_SYSROOT = join(DATA, "miri-sysroot");

/**
 * `MIRI_DEFAULT_ARGS` (src/tools/miri/src/lib.rs:187): the rustc arguments Miri's driver inserts after the program
 * name (bin/miri.rs:465), at the pin; scripts/lib/miri.test.ts compares this list with the upstream source. The
 * fallback subject (harness/suites.ts `miriSubject`) passes them to the port's rustc driver as Miri would.
 */
export const MIRI_DEFAULT_ARGS: readonly string[] = [
  "--cfg=miri",
  "-Zalways-encode-mir",
  "-Zextra-const-ub-checks",
  "-Zmir-preserve-ub",
  "-Zmir-opt-level=0",
  "-Zmir-enable-passes=-CheckAlignment,-CheckNull,-CheckEnums",
  "-Zmir-enable-passes=-ReferencePropagation,-GVN",
  "-Zdeduplicate-diagnostics=no",
];

/**
 * Environment of every Miri case, both sides (over difftest's scrubbed environment, scripts/lib/env.ts):
 * - the isolated homes, so nothing a Miri process might start can reach the oracle's rustup home (plan-m6 §4.1);
 * - every variable the Miri driver reads at the pin, removed: `MIRI_LOG` / `MIRI_TRACING` / `MIRI_BACKTRACE`
 *   (bin/log/setup.rs: logging, `RUSTC_CTFE_BACKTRACE`), `MIRI_CWD` (bin/miri.rs:168, the interpreted program's
 *   cwd), `MIRI_LOCAL_CRATES` (machine.rs:904, which frames count as local in diagnostics), `MIRI_BE_RUSTC`
 *   (bin/miri.rs:419, be a plain rustc), and cargo-miri's `MIRI_SYSROOT`. `RUSTC_LOG` is scrubbed already.
 * With isolation on (Miri's default) the interpreted program sees no host variable (shims/env.rs:37): only
 * `-Zmiri-env-set`, so the rest of the environment cannot reach a program's output.
 */
export const MIRI_CASE_ENV: Readonly<Record<string, string | null>> = {
  RUSTUP_HOME: MIRI_RUSTUP_HOME,
  CARGO_HOME: MIRI_CARGO_HOME,
  MIRI_LOG: null,
  MIRI_TRACING: null,
  MIRI_BACKTRACE: null,
  MIRI_CWD: null,
  MIRI_LOCAL_CRATES: null,
  MIRI_BE_RUSTC: null,
  MIRI_SYSROOT: null,
};

/** Whether two paths name one directory (through symlinks, where they exist). */
function sameDir(a: string, b: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

/**
 * Why the oracle cannot be asked for the host here, or undefined: under the isolated `RUSTUP_HOME`, `rustc +nightly` would make
 * rustup install an unpinned nightly there (review fixers-43 F1). A shim run by hand, with no `RUST_TS_HOST_TUPLE` and no
 * `.env.local`, reached it (review root-w41-check N4).
 */
export function hostLookupRefusal(rustupHome: string | undefined, tuple: string | undefined): string | undefined {
  if (tuple !== undefined || rustupHome === undefined || !sameDir(rustupHome, MIRI_RUSTUP_HOME)) return undefined;
  return `RUST_TS_HOST_TUPLE is not set, and RUSTUP_HOME is the isolated Miri home (${MIRI_RUSTUP_HOME}), where asking \`rustc +${PIN.toolchain} -vV\` for the host would make rustup install an unpinned toolchain: set RUST_TS_HOST_TUPLE (it is in .env.local)`;
}

let hostMemo: string | undefined;
/**
 * The host tuple (the oracle's; the isolated toolchain is installed for the same host). `RUST_TS_HOST_TUPLE` first, which the gate
 * checks is the oracle's. Without it, the oracle is asked, never under the isolated home (`hostLookupRefusal`).
 */
const host = (): string => {
  if (hostMemo !== undefined) return hostMemo;
  const tuple = process.env.RUST_TS_HOST_TUPLE;
  const refusal = hostLookupRefusal(process.env.RUSTUP_HOME, tuple);
  if (refusal !== undefined) die(refusal);
  return (hostMemo = tuple ?? oracleHost());
};

/** The isolated toolchain's rustup name: `<nightlyName>-<host>`. */
export const miriToolchainName = (): string => `${PIN.nightlyName}-${host()}`;
/** The isolated toolchain's directory (its sysroot). */
export const miriToolchainDir = (): string => join(MIRI_RUSTUP_HOME, "toolchains", miriToolchainName());
const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
/** The Miri binary, by absolute path (never through a rustup proxy). */
export const miriBinary = (): string => join(miriToolchainDir(), "bin", exe("miri"));
/** The isolated toolchain's rustc. */
export const miriRustc = (): string => join(miriToolchainDir(), "bin", exe("rustc"));
/** The Miri sysroot's target library directory. */
export const miriTargetLibDir = (): string => join(MIRI_SYSROOT, "lib", "rustlib", miriPin().target, "lib");

/** The `librustc_driver` of the toolchain at `dir` (`lib/` or, on Windows, `bin/`), or undefined. */
export function driverLib(dir: string): string | undefined {
  for (const d of [join(dir, "bin"), join(dir, "lib")]) {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    const lib = names.find((n) => /^(lib)?rustc_driver-[0-9a-f]+\.(dll|so|dylib)$/.test(n));
    if (lib) return join(d, lib);
  }
  return undefined;
}

/** `commit-hash` of `<bin> -vV`, or an error message. */
function commitOf(bin: string): { commit: string } | { error: string } {
  const r = Bun.spawnSync([bin, "-vV"], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } });
  const m = /^commit-hash: (\w+)$/m.exec(r.stdout.toString());
  return r.exitCode === 0 && m ? { commit: m[1]! } : { error: `\`${bin} -vV\` failed (exit ${r.exitCode}): ${r.stderr.toString().trim().slice(0, 200)}` };
}

/**
 * Why the Miri oracle cannot be used, as one line (no `ERROR:` prefix), or undefined. Checks, in order: the isolated
 * toolchain is installed; its components are exactly the pinned ones and `rust-src` is there
 * (scripts/lib/toolchain.ts `miriToolchainError`); its `miri` and `rustc` are the pinned commit; its `librustc_driver`
 * is byte-identical to the oracle's (`rustcDriverHash`); with `sysroot`, the Miri sysroot holds core and std for the
 * target.
 */
export function miriOracleProblem(opts: { sysroot: boolean }): string | undefined {
  const dir = miriToolchainDir();
  const setup = "run: bun scripts/miri.ts setup";
  if (!existsSync(dir)) return `the isolated Miri toolchain is not installed (${dir}); ${setup}`;
  const bad = miriToolchainError(dir, miriPin().components, host(), miriToolchainName(), MIRI_RUSTUP_HOME);
  if (bad !== undefined) return bad;
  for (const bin of [miriBinary(), miriRustc()]) {
    if (!existsSync(bin)) return `${bin} is missing; ${setup}`;
    const c = commitOf(bin);
    if ("error" in c) return c.error;
    if (c.commit !== PIN.commit) return `${bin} is commit ${c.commit}, the pin is ${PIN.commit}; remove ${MIRI_RUSTUP_HOME} and ${setup}`;
  }
  const lib = driverLib(dir);
  if (!lib) return `no rustc_driver library in the Miri toolchain ${dir}`;
  if (hash(readFileSync(lib)) !== rustcDriverHash()) return `the Miri toolchain's ${lib} differs from the oracle's rustc_driver (same commit, another build); remove ${MIRI_RUSTUP_HOME} and ${setup}`;
  if (opts.sysroot) {
    const libDir = miriTargetLibDir();
    let names: string[] = [];
    try {
      names = readdirSync(libDir);
    } catch {}
    for (const crate of ["core", "alloc", "std"]) {
      if (!names.some((n) => n.startsWith(`lib${crate}-`) && n.endsWith(".rmeta"))) return `the Miri sysroot has no lib${crate}-*.rmeta in ${libDir}; ${setup}`;
    }
  }
  return undefined;
}

let verified = false;
/**
 * Dies (one `ERROR:` line) unless the Miri oracle is usable (`miriOracleProblem` with the sysroot). difftest calls it
 * for suites with `Suite.miri`, after `verifyOraclePin` (the oracle toolchain's own check). Once per process.
 */
export function verifyMiriOracle(): void {
  if (verified) return;
  const bad = miriOracleProblem({ sysroot: true });
  if (bad !== undefined) die(bad);
  verified = true;
}

/** Every file under `root`, as sorted `/`-separated relative paths. */
function filesUnder(root: string, rel = "", out: string[] = []): string[] {
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) filesUnder(root, r, out);
    else out.push(r);
  }
  return out;
}

let sysrootMemo: { hash: string; files: number; bytes: number } | undefined;
/**
 * A hash of the Miri sysroot: every file under it (relative path and content hash), so any rebuild that changes an
 * rmeta or rlib changes it. ~112 MB; once per process.
 */
export function miriSysrootHash(): { hash: string; files: number; bytes: number } {
  if (sysrootMemo) return sysrootMemo;
  const files = filesUnder(MIRI_SYSROOT).sort();
  let bytes = 0;
  const lines = files.map((f) => {
    const p = join(MIRI_SYSROOT, f);
    bytes += statSync(p).size;
    return `${f}\0${hash(readFileSync(p))}`;
  });
  return (sysrootMemo = { hash: hash(lines.join("\n")), files: files.length, bytes });
}

let keyMemo: string | undefined;
/** The Miri suites' `Suite.oracleKey` (see the header). Call `verifyMiriOracle` first. */
export function miriOracleKey(): string {
  if (keyMemo) return keyMemo;
  const dir = miriToolchainDir();
  const lib = driverLib(dir);
  if (!lib) die(`no rustc_driver library in the Miri toolchain ${dir}`);
  const parts = [
    hash(readFileSync(miriBinary())),
    hash(readFileSync(lib)),
    readFileSync(join(dir, "lib", "rustlib", "components"), "utf8"),
    miriPin().target,
    miriSysrootHash().hash,
  ];
  return (keyMemo = hash(parts.join("\0")));
}
