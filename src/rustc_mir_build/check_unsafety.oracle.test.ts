// Oracle checks of the THIR unsafety checker (lane mb-unsafety: check_unsafety.ts) against the pinned nightly rustc.
//
// MIR building, borrowck and the late lints are not complete yet, so each case runs this lane's test driver
// src/rustc_mir_build/check_unsafety_oracle/run.ts (see its header): the ported driver through type checking (the
// tydump probe's analysis prefix), then `check_unsafety` for every body owner as the `MIR_borrow_checking` loop does,
// with `mir_built` reduced to its `thir_body` read. The oracle compiles the same file (a bin crate, `--emit=metadata`,
// target x86_64-unknown-linux-gnu, the oracle sysroot so core/std load). The cases avoid everything else rustc would
// report (dead code, unused variables, check_match, borrowck, ...), so the complete stderr of both sides must be equal.
// The `tests/ui` cases are UI tests whose whole oracle stderr is unsafety diagnostics plus what the prefix reports; their
// `//@ edition` / `//@ compile-flags` directives are applied.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO, UPSTREAM } from "../../scripts/lib/common.ts";

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

const WORK = join(DATA, "tmp", "check-unsafety-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const RUNNER = join(REPO, "src/rustc_mir_build/check_unsafety_oracle/run.ts");

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
const args = (edition: string): string[] => ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot(), `--edition=${edition}`, "--emit=metadata"];

function compare(file: string, a: string[], expected: (string | RegExp)[]): void {
  const oracle = run([...RUSTC, ...a, file]);
  const ours = run([process.execPath, RUNNER, ...a, file]);
  expect(ours.stderr).not.toContain("rust-ts: ");
  if (ours.stderr !== oracle.stderr) {
    // Show the first differing line.
    const ol = oracle.stderr.split("\n");
    const pl = ours.stderr.split("\n");
    let k = 0;
    while (k < pl.length && ol[k] === pl[k]) k++;
    expect(`line ${k + 1}: ${pl[k]}`).toBe(`line ${k + 1}: ${ol[k]}`);
  }
  expect(ours.code).toBe(oracle.code);
  for (const e of expected) {
    if (typeof e === "string") expect(oracle.stderr).toContain(e);
    else expect(oracle.stderr).toMatch(e);
  }
}

interface Case {
  name: string;
  src: string;
  editions: string[];
  /** Text the oracle's stderr must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const CASES: Case[] = [
  {
    name: "safe context: every op kind (named/nameless unsafe calls, raw-ptr deref, mutable/extern/safe-extern statics, extern fn, union read/write/raw borrow/pattern, nested field, closure, inline const)",
    src: [
      "#![allow(dead_code, unused_variables)]",
      "unsafe fn named() -> i32 { 1 }",
      "static mut COUNTER: i32 = 0;",
      "extern \"C\" {",
      "    static EXT: i32;",
      "    safe static SAFE_EXT: i32;",
      "    fn ext_fn();",
      "}",
      "union U { a: u32, b: f32 }",
      "struct S { x: U }",
      "fn ptr_fn(f: unsafe fn() -> i32) -> i32 {",
      "    f()",
      "}",
      "fn main() {",
      "    let p = &0i32 as *const i32;",
      "    let a = named();",
      "    let b = *p;",
      "    let c = COUNTER;",
      "    let d = EXT;",
      "    let e = SAFE_EXT;",
      "    ext_fn();",
      "    let mut u = U { a: 1 };",
      "    let f = u.a;",
      "    u.b = 2.0;",
      "    let g = &raw const u.a;",
      "    let h = &raw const *p;",
      "    let U { a: i } = u;",
      "    let s = S { x: U { a: 3 } };",
      "    let j = s.x.b;",
      "    let k = |q: *const i32| *q;",
      "    let l = const { *(&1 as *const i32) };",
      "}",
      "",
    ].join("\n"),
    editions: ["2021", "2024"],
    expect: ["E0133"],
  },
  {
    name: "unsafe fn with #![deny(unsafe_op_in_unsafe_fn)]: every lint arm, the not-inherited note once, used blocks",
    src: [
      "#![deny(unsafe_op_in_unsafe_fn)]",
      "#![allow(dead_code, unused_variables)]",
      "unsafe fn named() -> i32 { 1 }",
      "static mut COUNTER: i32 = 0;",
      "extern \"C\" {",
      "    static EXT: i32;",
      "}",
      "union U { a: u32, b: f32 }",
      "unsafe fn inner(p: *const i32, f: unsafe fn() -> i32, u: U) {",
      "    let a = named();",
      "    let b = *p;",
      "    let c = COUNTER;",
      "    let d = EXT;",
      "    let e = f();",
      "    let g = u.a;",
      "    let U { b: h } = u;",
      "    unsafe {",
      "        let i = named();",
      "    }",
      "}",
      "unsafe fn ok() {",
      "    unsafe { named(); }",
      "}",
      "fn main() {}",
      "",
    ].join("\n"),
    editions: ["2021", "2024"],
    expect: ["unsafe_op_in_unsafe_fn"],
  },
  {
    name: "unused_unsafe: nested blocks, closures, nested fns, lint levels on blocks, sorting, not-inherited notes",
    src: [
      "#![allow(dead_code, unused_variables)]",
      "unsafe fn named() -> i32 { 1 }",
      "fn main() {",
      "    unsafe {",
      "        unsafe { named(); }",
      "        unsafe { 1 };",
      "        let c = || unsafe { named() };",
      "        let d = || named();",
      "        fn nested() { named(); }",
      "    }",
      "    unsafe { };",
      "    let x = unsafe { unsafe { named() } };",
      "    #[allow(unused_unsafe)]",
      "    let y = unsafe { 3 };",
      "    unsafe {",
      "        #[deny(unused_unsafe)]",
      "        let z = unsafe { named() };",
      "    }",
      "}",
      "unsafe fn outer() {",
      "    unsafe {",
      "        let a = || named();",
      "    }",
      "}",
      "",
    ].join("\n"),
    editions: ["2021"],
    expect: ["unnecessary `unsafe` block"],
  },
  {
    name: "asm!, unsafe fields (init, read, pattern, enum variant), #[target_feature] calls (missing list), union param patterns",
    src: [
      "#![feature(unsafe_fields)]",
      "#![allow(dead_code, unused_variables, incomplete_features)]",
      "use std::arch::asm;",
      "struct WithUnsafe { unsafe len: usize, cap: usize }",
      "enum E { V { unsafe f: u8 }, W(u8) }",
      "#[target_feature(enable = \"avx2\")]",
      "fn avx2() {}",
      "#[target_feature(enable = \"avx2,bmi1\")]",
      "fn avx2_bmi() {}",
      "#[target_feature(enable = \"avx2\")]",
      "unsafe fn avx2_unsafe() {}",
      "#[target_feature(enable = \"avx2\")]",
      "fn caller_avx2() { avx2(); avx2_bmi(); }",
      "union U { a: u32, b: f32 }",
      "fn param_union(U { a }: U) {}",
      "fn main() {",
      "    unsafe { asm!(\"nop\"); }",
      "    asm!(\"nop\");",
      "    let w = WithUnsafe { len: 0, cap: 0 };",
      "    let l = w.len;",
      "    let c = w.cap;",
      "    let WithUnsafe { len, .. } = w;",
      "    let e = E::V { f: 1 };",
      "    if let E::V { f } = e {}",
      "    avx2();",
      "    avx2_bmi();",
      "    avx2_unsafe();",
      "}",
      "unsafe fn in_unsafe() {",
      "    asm!(\"nop\");",
      "    avx2();",
      "}",
      "",
    ].join("\n"),
    editions: ["2021", "2024"],
    expect: ["E0133"],
  },
  {
    name: "deprecated_safe_2024 (env::set_var / remove_var) before 2024, plain E0133 in 2024",
    src: [
      "#![warn(deprecated_safe_2024)]",
      "#![allow(dead_code, unused_variables)]",
      "fn main() {",
      "    std::env::set_var(\"A\", \"B\");",
      "    std::env::remove_var(\"A\");",
      "    unsafe { std::env::set_var(\"A\", \"B\"); }",
      "}",
      "unsafe fn f() {",
      "    std::env::set_var(\"A\", \"B\");",
      "}",
      "",
    ].join("\n"),
    editions: ["2021", "2024"],
    expect: ["set_var"],
  },
];

/** A diagnostic of check_unsafety.rs (E0133, `unused_unsafe`, `unsafe_op_in_unsafe_fn`, `deprecated_safe_2024`). */
const UNSAFETY_DIAG = /E0133|unnecessary `unsafe` block|unsafe_op_in_unsafe_fn|call to deprecated safe function/;

/** UI tests (relative to the upstream checkout) whose stderr is unsafety diagnostics plus what the prefix reports. */
const UI: string[] = [
  "tests/ui/unsafe/foreign-unsafe-fn-called.rs",
  "tests/ui/unsafe/issue-3080.rs",
  "tests/ui/unsafe/issue-47412.rs",
  "tests/ui/unsafe/unsafe-around-compiler-generated-unsafe.rs",
  "tests/ui/unsafe/unsafe-const-fn.rs",
  "tests/ui/unsafe/unsafe-fn-assign-deref-ptr.rs",
  "tests/ui/unsafe/unsafe-fn-called-from-safe.rs",
  "tests/ui/unsafe/unsafe-fn-deref-ptr.rs",
  "tests/ui/unsafe/unsafe-fn-used-as-value.rs",
  "tests/ui/unsafe/unsafe-not-inherited.rs",
  "tests/ui/unsafe/unsafe-unstable-const-fn.rs",
  "tests/ui/unsafe/unused-unsafe-in-nested-fn-lint.rs",
  "tests/ui/unsafe/unsafe_op_in_unsafe_fn/rfc-2585-unsafe_op_in_unsafe_fn.rs",
  "tests/ui/rust-2024/unsafe-env-suggestion.rs",
  "tests/ui/union/union-pat-in-param.rs",
];

for (const [i, c] of CASES.entries()) {
  for (const edition of c.editions) {
    test.skipIf(SKIP)(
      `check_unsafety (edition ${edition}): ${c.name}`,
      () => {
        const file = `case${i}.rs`;
        writeFileSync(join(WORK, file), c.src);
        compare(file, [...args(edition), "-o", `case${i}_${edition}.rmeta`], c.expect);
      },
      120_000,
    );
  }
}

for (const [i, f] of UI.entries()) {
  test.skipIf(SKIP)(
    `check_unsafety: ${f}`,
    () => {
      const path = join(UPSTREAM, f);
      const text = readFileSync(path, "utf8");
      const edition = /^\/\/@ *edition: *(\d+)/m.exec(text)?.[1] ?? "2015";
      const flags = (/^\/\/@ *compile-flags:(.*)$/m.exec(text)?.[1] ?? "").split(/\s+/).filter((s) => s !== "");
      compare(path, [...args(edition), "-o", `ui${i}.rmeta`, ...flags], [UNSAFETY_DIAG]);
    },
    120_000,
  );
}

// The real `mir_built` (`--real-mir-built`): MIR building runs (the builder and rustc_pattern_analysis are ported),
// then `mir_built`'s pass list stops at its first pass, `LintAndRemoveUninhabited` (lane mt-built-lints). When it
// lands, drop the driver's stand-in (run.ts header) and this pin.
test.skipIf(SKIP)(
  "check_unsafety with the real mir_built: stops at the first unported pass",
  () => {
    const file = "real_mir_built.rs";
    writeFileSync(join(WORK, file), "unsafe fn f() {}\nfn main() { unsafe { f() } }\n");
    const ours = run([process.execPath, RUNNER, "--real-mir-built", ...args("2021"), "-o", "real_mir_built.rmeta", file]);
    expect(ours).toEqual({ stderr: "rust-ts: unported: rustc_mir_transform::lint_and_remove_uninhabited::LintAndRemoveUninhabited (pass not ported)\n", code: 70 });
  },
  120_000,
);
