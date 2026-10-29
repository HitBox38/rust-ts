// Oracle tests for the function ABI (lane fn-abi): rustc_ty_utils abi.rs (`fn_abi_of_fn_ptr` /
// `fn_abi_of_instance_*`), rustc_target callconv/mod.rs + x86_64.rs, through rustc_passes abi_test.rs
// (`#[rustc_abi(debug)]` prints the whole `FnAbi` with `{:#?}`; `#[rustc_abi(assert_eq)]` compares two).
//
// The oracle is the pinned rustc (`--emit=metadata --target x86_64-unknown-linux-gnu`, the suites' target, whatever the
// host); the subject is src/rustc_passes/oracle/dead_run.ts (the ported driver, then `run_required_analyses`' prefix,
// `test_layout`, `test_abi` and the ported parts of `analysis`; see its header). stderr and the exit code must be
// identical. The UI tests of tests/ui/abi that use `#[rustc_abi]` run on their x86_64-linux revision; the
// `add-minicore` ones get tests/auxiliary/minicore.rs's metadata built by the oracle. `pending` cases stop at a pinned
// UNPORTED point instead (exit 70).
//
// The oracle rustc (`scripts/lib/oracle.ts`) and the upstream checkout are required, as for the difftest suites.
import { beforeAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { oracleRustcCmd, oracleSysroot } from "../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("fn-abi-oracle");
const RUNNER = join(REPO, "src/rustc_passes/oracle/dead_run.ts");
const TARGET = ["--target", "x86_64-unknown-linux-gnu"];
const UI = join(UPSTREAM, "tests/ui");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  return { stderr, code };
}

interface Case {
  name: string;
  /** An upstream UI test (path under tests/ui) or inline source lines. */
  file?: string;
  src?: string[];
  args: string[];
  /** Text the oracle's stderr must contain (the ABIs under test were really printed / compared). */
  expect: string[];
  /** The subject stops at this UNPORTED point instead of matching (exit 70). */
  pending?: string;
}

const MINICORE = ["--extern", "minicore=libminicore.rmeta", "-L", "."];

const CASES: Case[] = [
  {
    name: "debug",
    file: "abi/debug.rs",
    // The test's `-O` makes `fn_abi_of_instance` go through `fn_abi_of_instance_raw` (deduced parameter attributes);
    // without it, every `FnAbi` of the test is printed.
    args: ["--edition", "2015", ...MINICORE],
    expect: ["fn_abi_of(test) =", "fn_abi_of(test_unsized) =", "fn_abi_of(TestFnPtr) =", "ABIs are not compatible"],
  },
  {
    name: "debug_opt",
    file: "abi/debug.rs",
    args: ["--edition", "2015", "-O", ...MINICORE],
    expect: ["fn_abi_of(test) ="],
    // `deduced_param_attrs` (lane mt-opt2-b) runs `optimized_mir` at mir-opt-level 2; with every level-2 pass ported
    // (mt-opt2-a..d) the `-O` output is compared with the oracle's.
  },
  {
    name: "c_zst",
    file: "abi/c-zst.rs",
    args: ["--edition", "2015", "--cfg", "x86_64_linux", ...MINICORE],
    expect: ["fn_abi_of(pass_zst) ="],
  },
  {
    name: "pass_indirectly_attr",
    file: "abi/pass-indirectly-attr.rs",
    args: ["--edition", "2015", ...MINICORE],
    expect: ["fn_abi_of(extern_c) =", "fn_abi_of(extern_rust) ="],
  },
  {
    name: "sysv64_zst",
    file: "abi/sysv64-zst.rs",
    args: ["--edition", "2015"],
    expect: ["fn_abi_of(pass_zst) ="],
  },
  {
    name: "sysv64_arg_ext",
    file: "abi/numbers-arithmetic/x86-64-sysv64-arg-ext.rs",
    args: ["--edition", "2015", "--cfg", "other"],
    expect: ["fn_abi_of(i8) =", "fn_abi_of(u16) ="],
  },
  {
    name: "compatibility",
    file: "abi/compatibility.rs",
    // check-pass: every `#[rustc_abi(assert_eq)]` pair is ABI-compatible. The subject does not run the late lints, so
    // the `#![expect(.., improper_ctypes_definitions, ..)]` is allowed away on both sides.
    args: ["--edition", "2015", "--cfg", "x86_64", "-Cpanic=abort", "--crate-type", "lib", "-Aunfulfilled_lint_expectations", ...MINICORE],
    expect: [],
  },
  {
    name: "c_variadic_pass_by_value",
    file: "c-variadic/pass-by-value-abi.rs",
    args: ["--edition", "2015", "--cfg", "x86_64", "-O"],
    expect: ["fn_abi_of(take_va_list) ="],
  },
  {
    name: "synthetic",
    args: ["--edition", "2021", "--crate-type", "lib"],
    src: [
      "#![feature(rustc_attrs)]",
      "#![allow(internal_features, dead_code, improper_ctypes_definitions)]",
      "use std::rc::Rc;",
      "#[repr(C)] pub struct Pair { a: f32, b: f32 }",
      "#[repr(C)] pub struct Mixed { a: u64, b: f64 }",
      "#[repr(C)] pub struct Big { a: [u64; 5] }",
      "#[repr(C)] pub struct Three { a: u8, b: u16 }",
      "#[repr(C)] pub struct Vec4 { a: f32, b: f32, c: f32, d: f32 }",
      "pub enum E { A(u32), B(f32) }",
      "#[rustc_abi(debug)] pub extern \"C\" fn c1(_a: Pair, _b: Mixed, _c: Big, _d: Three) -> Vec4 { loop {} }",
      "#[rustc_abi(debug)] pub extern \"C\" fn c2(_a: i128, _b: u8, _c: i16, _d: bool, _e: char, _f: f64) -> Big { loop {} }",
      "#[rustc_abi(debug)] pub extern \"C\" fn c3(_a: u64, _b: u64, _c: u64, _d: u64, _e: u64, _f: Mixed, _g: Mixed) -> bool { loop {} }",
      "#[rustc_abi(debug)] pub extern \"sysv64\" fn c4(_a: E, _b: &mut u32, _c: Box<u8>) -> Three { loop {} }",
      "#[rustc_abi(debug)] pub fn r1(_a: Big, _b: Three, _c: (u32, u32), _d: &str, _e: Rc<u8>, _f: &mut [u8]) -> (u64, u64, u64) { loop {} }",
      "#[rustc_abi(debug)] pub fn r2(_a: &std::cell::Cell<u8>, _b: Option<&u8>, _c: *const u8, _d: [u8; 3]) -> [u16; 2] { loop {} }",
      "#[rustc_abi(debug)] pub fn r3(_a: &dyn Fn(), _b: u128) -> u128 { loop {} }",
      "#[rustc_abi(debug)] pub extern \"C\" fn v1(_a: u8, _args: ...) {}",
      "#[rustc_abi(debug)] type T1 = extern \"C-unwind\" fn(Pair) -> Mixed;",
      "#[rustc_abi(debug)] #[track_caller] pub fn tc(_a: u8) {}",
      "#[rustc_abi(assert_eq)] type AE1 = (fn(u32), fn(i32));",
      "#[rustc_abi(assert_eq)] type AE2 = (extern \"C\" fn(u8), extern \"C\" fn(i8));",
      "#[rustc_abi(assert_eq)] type AE3 = (fn(&u8), fn(*const u8));",
      "#[rustc_abi(assert_eq)] type AE4 = (extern \"C\" fn(bool) -> u8, extern \"C\" fn(u8) -> u8);",
      "pub trait Tr { #[rustc_abi(debug)] fn m(&self, _x: u32) {} }",
    ],
    expect: ["fn_abi_of(c1) =", "fn_abi_of(tc) =", "ABIs are not compatible", "has an unknown layout"],
  },
];

let sysroot = "";

beforeAll(async () => {
  sysroot = oracleSysroot();
  for (const c of CASES) if (c.src !== undefined) writeFileSync(join(WORK, `${c.name}.rs`), c.src.join("\n") + "\n");
  // tests/auxiliary/minicore.rs, as compiletest's `add-minicore` builds it (metadata is all the subject reads).
  const mc = await run(
    oracleRustcCmd([
      join(UPSTREAM, "tests/auxiliary/minicore.rs"),
      "--crate-type",
      "rlib",
      "--crate-name",
      "minicore",
      "--edition",
      "2021",
      ...TARGET,
      "--emit=metadata",
      "-o",
      "libminicore.rmeta",
    ]),
  );
  if (mc.code !== 0) throw new Error(`ERROR: building minicore failed:\n${mc.stderr}`);
});

for (const c of CASES) {
  test(`fn-abi: ${c.name}`, async () => {
    const file = c.file !== undefined ? join(UI, c.file) : `${c.name}.rs`;
    const common = [file, "--emit=metadata", ...TARGET, ...c.args];
    const [ora, ours] = await Promise.all([
      run(oracleRustcCmd([...common, "-o", `oracle_${c.name}.rmeta`])),
      run([process.execPath, RUNNER, ...common, "--sysroot", sysroot, "-o", `ours_${c.name}.rmeta`]),
    ]);
    for (const e of c.expect) expect(ora.stderr).toContain(e);
    if (c.pending !== undefined) {
      expect(ours.stderr).toContain(`rust-ts: unported: ${c.pending}`);
      expect(ours.code).toBe(70);
      return;
    }
    expect(ours.stderr).toBe(ora.stderr);
    expect(ours.code).toBe(ora.code);
  }, 300_000);
}
