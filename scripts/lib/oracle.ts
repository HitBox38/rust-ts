// The oracle is the pinned nightly rustc (plus small probe binaries built from the
// pinned upstream sources, see tools/probes). Oracle results are deterministic, so
// difftest caches them, keyed by the probe binary or the rustc build (see rustcDriverHash).
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PIN, UPSTREAM, die, hash, run } from "./common.ts";
import { pinnedPathEnv } from "./env.ts";

/**
 * An oracle process that times out is run once more with this many times its timeout (difftest's oracle
 * runs, and the oracle builds of compiletest aux crates, harness/compiletest.ts).
 */
export const ORACLE_RETRY_FACTOR = 4;

let verified = false;

export async function verifyOraclePin(): Promise<void> {
  if (verified) return;
  const r = await run(["rustc", `+${PIN.toolchain}`, "-vV"]);
  const m = /commit-hash: (\w+)/.exec(r.stdout);
  if (r.code !== 0 || !m) die(`cannot run oracle rustc +${PIN.toolchain}: ${r.stderr.trim()}`);
  if (m[1] !== PIN.commit) {
    die(`oracle toolchain '${PIN.toolchain}' is ${m[1]}, pin is ${PIN.commit}; run: rustup toolchain install ${PIN.nightlyName}`);
  }
  verified = true;
}

export function oracleRustcCmd(args: string[]): string[] {
  return ["rustc", `+${PIN.toolchain}`, ...args];
}

let pathEnv: string | undefined;

/**
 * The fixed `PATH` of oracle processes whose environment must not depend on the caller's: the cases whose
 * sources read session variables such as `PATH` (harness/suites.ts `pinSessionEnv`, both sides get it) and
 * the oracle builds of compiletest aux crates (harness/compiletest.ts). It is rustup's proxy directory,
 * `$CARGO_HOME/bin` (`home::cargo_home()`: `$CARGO_HOME`, relative to the upstream checkout, the oracle's
 * cwd, if relative; else `~/.cargo`), and nothing else:
 * - the oracle command `rustc +<toolchain>` is looked up there (Bun looks commands up in the PATH it passes);
 * - rustup prepends exactly that directory to the PATH of the rustc it runs when the PATH lacks it, so with
 *   any other value the oracle rustc would see a PATH the subject does not.
 * Dies if there is no `rustc` there.
 */
export function oraclePathEnv(): string {
  if (pathEnv) return pathEnv;
  const ch = process.env.CARGO_HOME;
  const dir = join(ch ? (isAbsolute(ch) ? ch : resolve(UPSTREAM, ch)) : join(homedir(), ".cargo"), "bin");
  if (!Bun.which("rustc", { PATH: dir })) die(`no rustc (rustup proxy) in ${dir}, the fixed PATH of pinned oracle processes`);
  return (pathEnv = dir);
}

/**
 * `oraclePathEnv()` as the variables to pin (scripts/lib/env.ts `pinnedPathEnv`): `{ PATH }`, plus
 * `RUSTUP_WINDOWS_PATH_ADD_BIN=0` on Windows, where rustup would otherwise add the toolchain's `bin` directory.
 */
export function oraclePinnedPathEnv(): Record<string, string> {
  return pinnedPathEnv(oraclePathEnv());
}

let sysrootPath: string | undefined;

/** `rustc +<toolchain> --print sysroot` of the oracle toolchain. */
export function oracleSysroot(): string {
  if (sysrootPath) return sysrootPath;
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"]);
  if (r.exitCode !== 0) die(`cannot run oracle rustc +${PIN.toolchain} --print sysroot`);
  return (sysrootPath = r.stdout.toString().trim());
}

/** Host triple of the oracle toolchain (`rustc -vV`). */
export function oracleHost(): string {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"]);
  const m = /^host: (\S+)$/m.exec(r.stdout.toString());
  if (r.exitCode !== 0 || !m) die(`cannot run oracle rustc +${PIN.toolchain} -vV`);
  return m[1]!;
}

let driverHash: string | undefined;

/**
 * Identity of the oracle rustc build: hash of the toolchain's rustc_driver library. The commit
 * pin alone does not distinguish two builds of the same commit (e.g. a reinstalled toolchain),
 * so rustc-based suites key their cache on this too.
 */
export function rustcDriverHash(): string {
  if (driverHash) return driverHash;
  const sysroot = oracleSysroot();
  for (const dir of [join(sysroot, "bin"), join(sysroot, "lib")]) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const lib = names.find((n) => /^(lib)?rustc_driver-[0-9a-f]+\.(dll|so|dylib)$/.test(n));
    if (lib) return (driverHash = hash(readFileSync(join(dir, lib))));
  }
  die(`no rustc_driver library under ${sysroot}`);
}
