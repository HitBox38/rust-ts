// Test helper of src/rustc_codegen_llvm/type_of.test.ts and attributes.test.ts (lane cg-types-attrs). Not ported code.
// Runs the oracle (`--emit=llvm-ir`, its IR text) and the port (run.ts, its printed facts) on a fixture of this directory, for
// x86_64-unknown-linux-gnu, in the codegen_attrs.test.ts form. `undefined` when the oracle sysroot is missing and probes are
// not required.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const DIR = import.meta.dir;
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
export const X86 = "x86_64-unknown-linux-gnu";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

export function both(mode: "types" | "attrs", file: string, flags: readonly string[]): { oracle_ir: string; ours: string } | undefined {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return undefined;
  }
  const out = mkdtempSync(join(tmpdir(), "rust-ts-cg-types-attrs-"));
  try {
    const args = ["--sysroot", s, "--target", X86, "--edition=2021", "--emit=llvm-ir", ...flags, "-o", join(out, "out.ll"), file];
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args]);
    if (oracle.exit !== 0) throw new Error(`ERROR: oracle failed on ${file}: ${oracle.stderr}`);
    const oracle_ir = readFileSync(join(out, "out.ll"), "utf8");
    const ours = run(["bun", join(DIR, "run.ts"), mode, ...args]);
    if (ours.exit !== 0) throw new Error(`ERROR: port failed on ${file} (exit ${ours.exit}): ${ours.stderr.split("\n").slice(-12).join("\n")}`);
    return { oracle_ir, ours: ours.stdout };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
