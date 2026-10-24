// The MIR `Validator` (validate.rs) end to end against the oracle: the mirdump probe (tools/probes/mirdump) and the
// ported driver (src/rust_ts/mirdump.ts) on the same files and argv.
// - validate_oracle/ctors.rs: constructors (`mir_for_ctfe` = `shim::build_adt_ctor`, always validated at the phase
//   change to runtime-optimized) and small bodies, with and without `-Zvalidate-mir` (which validates every body after
//   every pass of `mir_built` / `mir_promoted`): stdout, stderr and exit code are identical.
// - validate_oracle/invalid/*.rs and five tests/ui/mir/validate tests: custom MIR that the validator rejects under
//   `-Zvalidate-mir`. Both sides ICE (exit 101) with the same `broken MIR in .. (after pass ..) at ..:\n<failure>`
//   message. The oracle's ICE report adds the panic location and indents the message's continuation lines; the port's
//   prints `rust-ts: internal compiler error: <message>` (rustc_span macros.ts: no `#[track_caller]` location).
// Skips (visibly) if the probe is missing; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const WORK = join(DATA, "tmp", "mt-validate-test", process.env.RUST_TS_AGENT ?? "default");
const FIXTURES = join(import.meta.dir, "validate_oracle");

function probe(): string | undefined {
  try {
    const { probeBinary } = require("../../scripts/probes.ts") as typeof import("../../scripts/probes.ts");
    const p = probeBinary("mirdump");
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}
const PROBE = probe();
if (PROBE === undefined && !REQUIRE) console.log("SKIP: mirdump probe missing (bun scripts/probes.ts build mirdump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"]).stdout.toString().trim());

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[], cwd: string): Out {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
function both(file: string, cwd: string, extra: string[]): [Out, Out] {
  mkdirSync(WORK, { recursive: true });
  const args = [file, "--sysroot", sysroot(), "--target=x86_64-unknown-linux-gnu", "--edition=2021", "--emit", "metadata", "--out-dir", WORK, ...extra];
  return [run([PROBE!, ...args], cwd), run([process.execPath, join(REPO, "src/rust_ts/mirdump.ts"), ...args], cwd)];
}
function check_probe(): boolean {
  if (PROBE === undefined) {
    if (REQUIRE) throw new Error("ERROR: mirdump probe missing (bun scripts/probes.ts build mirdump)");
    return false;
  }
  return true;
}

const ICE = "error: internal compiler error: ";
/** The oracle's ICE message: after the panic location, continuation lines de-indented, up to the span. */
function oracle_message(stderr: string): string | undefined {
  const i = stderr.indexOf(ICE);
  if (i === -1) return undefined;
  const lines = stderr
    .slice(i + ICE.length)
    .replace(/^\S*compiler\/rustc_mir_transform\/src\/validate\.rs:\d+:\d+: /, "")
    .split("\n");
  const msg = [lines[0]!];
  for (let k = 1; k < lines.length && lines[k]!.startsWith(" ".repeat(ICE.length)); k++) msg.push(lines[k]!.slice(ICE.length));
  return msg.join("\n");
}
const PORT_ICE = "rust-ts: internal compiler error: ";
/** The port's ICE message: up to the JS stack (`Panic: ...` / `ExplicitBug...`). */
function port_message(stderr: string): string | undefined {
  const i = stderr.indexOf(PORT_ICE);
  if (i === -1) return undefined;
  const rest = stderr.slice(i + PORT_ICE.length);
  const end = rest.search(/\n(Panic|ExplicitBug|Error)\b/);
  return end === -1 ? rest.trimEnd() : rest.slice(0, end);
}

for (const extra of [[], ["-Zvalidate-mir"]]) {
  test(`constructors and small bodies${extra.length > 0 ? " under -Zvalidate-mir" : ""}: mirdump output equals the probe's`, () => {
    if (!check_probe()) return;
    const [o, p] = both(join(FIXTURES, "ctors.rs"), FIXTURES, extra);
    expect(o.code).toBe(0);
    expect(p.stderr).toBe(o.stderr);
    expect(p.stdout).toBe(o.stdout);
    expect(p.code).toBe(o.code);
    // Every constructor body (`fn Pair(..)`, `fn E::B(..)`, ...) is printed after validation.
    for (const ctor of ["fn Pair(", "fn Gen(", "fn Wrap(", "fn E::A(", "fn E::B("]) expect(o.stdout).toContain(ctor);
  }, 120_000);
}

const INVALID: [string, string][] = [
  ...readdirSync(join(FIXTURES, "invalid"))
    .filter((f) => f.endsWith(".rs"))
    .sort()
    .map((f): [string, string] => [join(FIXTURES, "invalid", f), FIXTURES]),
  ...["call-move-arg", "noncleanup-cleanup", "noncleanup-resume", "noncleanup-terminate", "project-into-simd"].map(
    (t): [string, string] => [`tests/ui/mir/validate/${t}.rs`, UPSTREAM],
  ),
];
for (const [file, cwd] of INVALID) {
  test(`invalid MIR ${file.slice(file.lastIndexOf("/") + 1)}: the validator's ICE message equals the oracle's`, () => {
    if (!check_probe()) return;
    const [o, p] = both(file, cwd, ["--crate-type=lib", "-Zvalidate-mir"]);
    expect(o.code).toBe(101);
    expect(p.code).toBe(101);
    const om = oracle_message(o.stderr);
    expect(om).toContain("broken MIR in ");
    expect(port_message(p.stderr)).toBe(om!);
  }, 120_000);
}
