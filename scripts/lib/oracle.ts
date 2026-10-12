// The oracle is the pinned nightly rustc (plus small probe binaries built from the
// pinned upstream sources, see tools/probes). Oracle results are deterministic, so
// difftest caches them, keyed by the probe binary or the rustc build (see rustcDriverHash).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, die, hash, run } from "./common.ts";

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
