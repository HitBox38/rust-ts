// Oracle checks of the late lint passes of lane lint-late-d (internal.rs, transmute.rs, non_fmt_panic.rs, dangling.rs,
// non_local_def.rs, reference_casting.rs, drop_forget_useless.rs) against the pinned nightly rustc.
//
// The full driver does not reach the late lints yet, so each case runs late_d_test/run.ts: the ported driver through
// type checking (the tydump probe's analysis prefix), then the case's passes over every module (see run.ts). The oracle
// compiles the same file (`--crate-type lib --emit=metadata`, target x86_64-unknown-linux-gnu, the oracle sysroot so
// core/std load). The sources avoid everything else rustc would report (dead code, unused variables, ...), so the
// complete stderr of both sides must be equal and contain the diagnostics under test.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "late-d-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const RUNNER = join(REPO, "src/rustc_lint/late_d_test/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[], env: Record<string, string> = ENV): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
const args = (edition: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot(),
  `--edition=${edition}`,
  "--crate-type=lib",
  "--emit=metadata",
];

interface Case {
  name: string;
  /** Pass names (late_d_test/walker.ts `PASSES`). */
  passes: string[];
  src: string;
  edition?: string;
  flags?: string[];
  /** Text both outputs must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const CASES: Case[] = [
  {
    name: "drop_forget_useless: dropping_references, forgetting_references, dropping_copy_types, forgetting_copy_types",
    passes: ["DropForgetUseless"],
    src: [
      "pub fn f(s: &String, n: u32, v: Vec<u8>) {",
      "    std::mem::drop(s);",
      "    std::mem::forget(s);",
      "    drop(n);",
      "    core::mem::forget(n);",
      "    let _ = match n { 0 => drop(n), _ => () };",
      "    drop(v);",
      "}",
      "",
    ].join("\n"),
    expect: ["calls to `std::mem::drop` with a reference", "calls to `std::mem::forget` with a reference", "calls to `std::mem::drop` with a value that implements `Copy`", "calls to `std::mem::forget` with a value that implements `Copy`"],
  },
  {
    name: "transmute: unnecessary_transmutes (every arm), ptr_to_integer_transmute_in_consts",
    passes: ["CheckTransmutes"],
    src: [
      "use std::mem::transmute;",
      "pub fn f(x: u32, y: i32, b: [u8; 4], c: char, fl: f64, us: usize) -> u32 {",
      "    unsafe {",
      "        let _: u32 = transmute(b);",
      "        let _: [u8; 4] = transmute(x);",
      "        let _: u32 = transmute(c);",
      "        let _: i32 = std::mem::transmute(c);",
      "        let _: char = transmute(x);",
      "        let _: char = transmute(y);",
      "        let _: i32 = transmute(x);",
      "        let _: u32 = transmute(y);",
      "        let _: usize = transmute(fl);",
      "        let _: i64 = transmute(fl);",
      "        let _: u64 = transmute(fl);",
      "        let _: f64 = transmute(us);",
      "        let _: f32 = transmute(y);",
      "        let _: f32 = transmute(x);",
      "        let _: u8 = transmute(true);",
      "        let _: [u8; 2] = transmute(1u16);",
      "    }",
      "    x",
      "}",
      "pub const fn g(p: *const u8) -> usize { unsafe { transmute(p) } }",
      "pub const fn h(b: bool) -> i8 { unsafe { transmute(b) } }",
      "pub struct S;",
      "impl S { pub const C: usize = unsafe { transmute(&0u8 as *const u8) }; }",
      "",
    ].join("\n"),
    expect: ["unnecessary transmute", "pointers cannot be transmuted to integers during const eval"],
  },
  {
    name: "non_fmt_panic (2018): unused arguments, braces, non-literal messages, format!, unreachable!, assert!, core::panic!",
    passes: ["NonPanicFmt"],
    edition: "2018",
    src: [
      "#[derive(Debug)]",
      "pub struct D;",
      "pub fn f(s: &'static str, n: i32, st: String) {",
      "    if n == 0 { panic!(\"{}\"); }",
      "    if n == 1 { panic!(\"x {} {:?}\"); }",
      "    if n == 2 { panic!(\"{\"); }",
      "    if n == 3 { panic!(r#\"}{\"#); }",
      "    if n == 4 { panic!(s); }",
      "    if n == 5 { panic!(n); }",
      "    if n == 6 { panic!(D); }",
      "    if n == 7 { panic!(format!(\"x{}\", n)); }",
      "    if n == 8 { unreachable!(\"{}\"); }",
      "    if n == 9 { assert!(n > 0, \"{x}\"); }",
      "    if n == 10 { core::panic!(\"{} {}\"); }",
      "    if n == 11 { std::panic!{st} }",
      "    if n == 12 { assert!(n > 0, n); }",
      "}",
      "",
    ].join("\n"),
    expect: ["panic message contains an unused formatting placeholder", "panic message contains braces", "panic message is not a string literal"],
  },
  {
    name: "dangling: dangling_pointers_from_temporaries (CString, Vec, String, Box<[_]>, arrays; not inside call args)",
    passes: ["DanglingPointers"],
    src: [
      "use std::ffi::CString;",
      "pub fn g(_: *const u8) {}",
      "pub fn f(b: Box<[u8]>) -> usize {",
      "    let p = CString::new(\"hello\").unwrap().as_ptr();",
      "    let v = vec![1u8, 2].as_ptr();",
      "    let mut s = String::from(\"x\");",
      "    let m = String::from(\"x\").as_mut_ptr();",
      "    let q = s.as_mut_ptr();",
      "    g(Vec::<u8>::new().as_ptr());",
      "    let w = { let w = Vec::<u8>::new().as_ptr(); w };",
      "    let c = |x: u8| { let a = vec![x].as_ptr(); a as usize };",
      "    let bb = std::convert::identity(b).as_ptr();",
      "    (p as usize) + (v as usize) + (m as usize) + (q as usize) + (w as usize) + c(1) + (bb as usize)",
      "}",
      "",
    ].join("\n"),
    expect: ["this creates a dangling pointer because temporary `CString` is dropped at end of statement"],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(
    `late passes (lint-late-d): ${c.name}`,
    () => {
      const file = `case${i}.rs`;
      writeFileSync(join(WORK, file), c.src);
      const a = [...args(c.edition ?? "2021"), "-o", `case${i}.rmeta`, ...(c.flags ?? []), file];
      const oracle = run([...RUSTC, ...a]);
      const ours = run([process.execPath, RUNNER, ...a], { ...ENV, RUST_TS_LATE_D_PASSES: c.passes.join(",") });
      expect(ours.stderr).not.toContain("UNPORTED: ");
      if (ours.stderr !== oracle.stderr) {
        // Show the first differing line.
        const ol = oracle.stderr.split("\n");
        const pl = ours.stderr.split("\n");
        let k = 0;
        while (k < pl.length && ol[k] === pl[k]) k++;
        expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
      }
      expect(ours.code).toBe(oracle.code);
      for (const e of c.expect) expect(oracle.stderr).toContain(e);
    },
    120_000,
  );
}
