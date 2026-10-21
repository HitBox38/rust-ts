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
  {
    name: "non_local_def: impls in fn bodies and named consts, #[macro_export] in bodies, local and anon-const exceptions",
    passes: ["NonLocalDefinitions"],
    src: [
      "pub trait T {}",
      "pub struct S<X>(pub X);",
      "pub fn f() {",
      "    impl T for S<u8> {}",
      "    #[macro_export]",
      "    macro_rules! m { () => {} }",
      "    struct L;",
      "    let _ = L;",
      "    impl T for L {}",
      "    fn inner() { impl T for S<u16> {} }",
      "    inner();",
      "}",
      "pub const C: () = { impl T for S<u32> {} };",
      "pub static D: () = { impl S<i8> { pub fn g() {} } };",
      "const _: () = { impl T for S<i16> {} };",
      "const _: () = { const _: () = { impl T for S<i32> {} }; };",
      "pub fn h() { const _: () = { impl T for S<i64> {} }; }",
      "",
    ].join("\n"),
    expect: ["non-local `impl` definition, `impl` blocks should be written at the same level as their item", "non-local `macro_rules!` definition"],
  },
  {
    // PORT: the cases that lint go through `utils::peel_casts`, still `unported` in utils.ts (not this lane's file);
    // this case only covers the paths that bail out before it (no diagnostics on either side).
    name: "reference_casting: borrows, assignments and ptr::write through references (no raw-pointer casts)",
    passes: ["InvalidReferenceCasting"],
    src: [
      "pub fn f(r: &mut i32, a: &mut [u8; 4]) {",
      "    *r = 1;",
      "    *r += 1;",
      "    let x = &mut *r;",
      "    *x = 3;",
      "    let _y = &*a;",
      "    unsafe { std::ptr::write(r, 2) };",
      "}",
      "",
    ].join("\n"),
    expect: [],
  },
  {
    name: "internal: default_hash_types (uses, not imports)",
    passes: ["DefaultHashTypes"],
    src: [
      "use std::collections::{HashMap, HashSet};",
      "pub fn f() -> usize { let m: HashMap<u8, u8> = HashMap::new(); let s: HashSet<u8> = HashSet::new(); m.len() + s.len() }",
      "",
    ].join("\n"),
    flags: ["-Zunstable-options", "-W", "rustc::default_hash_types"],
    expect: ["prefer `FxHashMap` over `HashMap`"],
  },
  {
    name: "internal: usage_of_ty_tykind, usage_of_qualified_ty, span_use_eq_ctxt, symbol_intern_string_literal, bad_opt_access",
    passes: ["TyTyKind", "SpanUseEqCtxt", "SymbolInternStringLiteral", "BadOptAccess"],
    src: [
      "#![feature(rustc_attrs)]",
      "#![allow(internal_features)]",
      "pub mod ty {",
      "    #[rustc_diagnostic_item = \"TyKind\"]",
      "    pub enum TyKind { Bool, Char }",
      "    #[rustc_diagnostic_item = \"Ty\"]",
      "    pub struct Ty<'a>(pub &'a u8);",
      "}",
      "pub fn f(k: ty::TyKind) -> u8 { match k { ty::TyKind::Bool => 0, ty::TyKind::Char => 1 } }",
      "pub fn g(t: &ty::Ty<'_>) -> u8 { *t.0 }",
      "pub struct Span(u32);",
      "impl Span { #[rustc_diagnostic_item = \"SpanCtxt\"] pub fn ctxt(&self) -> u32 { self.0 } }",
      "pub fn eq(a: &Span, b: &Span) -> bool { a.ctxt() == b.ctxt() }",
      "pub struct Symbol(pub u32);",
      "impl Symbol { #[rustc_diagnostic_item = \"SymbolIntern\"] pub fn intern(_s: &str) -> Symbol { Symbol(0) } }",
      "pub fn s() -> Symbol { Symbol::intern(\"x\") }",
      "#[rustc_lint_opt_ty]",
      "pub struct Opts { #[rustc_lint_opt_deny_field_access(\"use `Opts::x()` instead\")] pub x: u8 }",
      "pub fn h(o: &Opts) -> u8 { o.x }",
      "",
    ].join("\n"),
    flags: ["-Zunstable-options", "-W", "rustc::usage_of_ty_tykind", "-W", "rustc::usage_of_qualified_ty", "-W", "rustc::span_use_eq_ctxt", "-W", "rustc::symbol_intern_string_literal"],
    expect: ["usage of `ty::TyKind::<kind>`", "use `.eq_ctxt()` instead of `.ctxt() == .ctxt()`", "using `Symbol::intern` on a string literal", "usage of qualified `ty::Ty<'_>`"],
  },
  {
    name: "internal: rustc_must_match_exhaustively (match wildcard/binding, if let, let else)",
    passes: ["RustcMustMatchExhaustively"],
    src: [
      "#![feature(rustc_attrs)]",
      "#![allow(internal_features)]",
      "#[rustc_must_match_exhaustively]",
      "pub enum E { A, B }",
      "pub fn m(e: E) -> u8 { match e { E::A => 0, _ => 1 } }",
      "pub fn m2(e: &E) -> u8 { match e { E::B => 0, x => { let _ = x; 1 } } }",
      "pub fn n(e: &E) -> bool { if let E::A = e { true } else { false } }",
      "pub fn o(e: E) -> u8 { let E::A = e else { return 1 }; 0 }",
      "",
    ].join("\n"),
    flags: ["-Zunstable-options", "-W", "rustc::rustc_must_match_exhaustively"],
    expect: ["because of this wildcard pattern"],
  },
  {
    name: "internal: usage_of_type_ir_traits, missing_generic_type_visitable_derive, potential_query_instability",
    passes: ["TypeIr", "MissingGenericTypeVisitableDerive", "QueryStability"],
    src: [
      "#![feature(rustc_attrs)]",
      "#![allow(internal_features)]",
      "#[rustc_diagnostic_item = \"type_ir_interner\"]",
      "pub trait Interner { fn foo(&self) -> u8; }",
      "impl Interner for u8 { fn foo(&self) -> u8 { *self } }",
      "pub fn i(x: u8) -> u8 { x.foo() + Interner::foo(&x) }",
      "#[rustc_diagnostic_item = \"TypeVisitable\"]",
      "pub trait TypeVisitable<I> {}",
      "#[rustc_diagnostic_item = \"GenericTypeVisitable\"]",
      "pub trait GenericTypeVisitable<V> {}",
      "pub struct S;",
      "impl TypeVisitable<u8> for S {}",
      "pub struct T;",
      "impl TypeVisitable<u8> for T {}",
      "impl GenericTypeVisitable<u8> for T {}",
      "#[rustc_lint_query_instability]",
      "pub fn unstable() -> u8 { 0 }",
      "pub fn q() -> u8 { unstable() }",
      "",
    ].join("\n"),
    flags: ["-Zunstable-options", "-W", "rustc::usage_of_type_ir_traits", "-W", "rustc::missing_generic_type_visitable_derive", "-W", "rustc::potential_query_instability"],
    expect: ["do not use `rustc_type_ir::Interner`", "missing `#[derive(GenericTypeVisitable)]`", "using `unstable` can result in unstable query results"],
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
