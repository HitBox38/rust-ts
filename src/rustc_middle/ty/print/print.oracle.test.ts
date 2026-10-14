// Oracle test of lane ty-print-a: ty/print/mod.rs + pretty.rs:1..1704 against the pinned rustc.
//
// print_oracle/probe.rs is a rustc-dev program that runs the pinned rustc on print_oracle/paths.rs and, after
// expansion, prints `format!("{}", ty)` for interned types (primitives, tuples, refs, raw pointers, slices, fn
// pointers, inference variables, the error type) and three columns of def paths for every local `DefIndex` and a few
// std lang items: `def_path_str` (visible re-export paths of std), `with_crate_prefix!` and
// `with_forced_trimmed_paths!`. The fixture `paths.lib.stdout` is its output (`REGEN=1` rebuilds the probe and
// rewrites it). print_oracle/run.ts prints the same with the ported printer on the ported driver; both must agree.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "print_oracle");
const FIXTURE = join(DIR, "paths.lib.stdout");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

const args = (sysroot: string): string[] => ["--edition=2021", "--crate-type", "lib", "--sysroot", sysroot, "paths.rs"];

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined) throw new Error("ERROR: REGEN needs the pinned toolchain");
  const out = join(tmpdir(), "rust-ts-ty-print-probe");
  mkdirSync(out, { recursive: true });
  const exe = join(out, "probe");
  const b = run(["rustc", `+${PIN.toolchain}`, "--edition", "2024", join(DIR, "probe.rs"), "-o", exe, "-C", `link-arg=-Wl,-rpath,${s}/lib`]);
  if (b.exit !== 0) throw new Error(`ERROR: probe build failed: ${b.stderr.split("\n")[0]}`);
  const r = run([exe, ...args(s)]);
  if (r.exit !== 0) throw new Error(`ERROR: probe exit ${r.exit}`);
  writeFileSync(FIXTURE, r.stdout);
}

test("the fixture covers every section", () => {
  const f = readFileSync(FIXTURE, "utf8");
  expect(f).toContain("fn_unsafe_c_variadic: unsafe extern \"C\" fn(u8, ...) -> !\n");
  expect(f).toContain("ref_static: &'static str\n");
  expect(f).toContain("| m::n::Tr::f | crate::m::n::Tr::f | Tr::f\n");
  expect(f).toContain("OwnedBox Struct | std::boxed::Box | std::boxed::Box | Box\n");
});

test("print_oracle/paths.rs: types and def paths print as the oracle", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const r = run(["bun", join(DIR, "run.ts"), ...args(s)]);
  expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: readFileSync(FIXTURE, "utf8") });
}, 300_000);
