// Oracle checks of the late lint driver (late.rs) and the late passes of builtin.rs against the pinned nightly rustc.
// The subject is src/rustc_lint/late_oracle/run.ts (see its header): the ported driver, `run_required_analyses_prefix`
// (typeck of every body), `analysis`'s abort on non-lint errors, the listed late passes on every module through
// `late_lint_mod` (`--late-pass`), `check_expectations(None)`. The oracle compiles the same file as a lib with std
// (`--emit=metadata`); each case only has diagnostics the listed passes produce, so stderr and the exit code must be
// identical.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
//
// Other late lint lanes: copy this file (harness part), change WORK's directory name and the CASES.
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

const WORK = join(DATA, "tmp", "late-builtin-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}
interface Out {
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());

interface Case {
  name: string;
  /** `<file relative to src/rustc_lint>:<pass export>`, in lib.rs order. */
  passes: string[];
  src: string[];
  edition?: string;
  flags?: string[];
  /** Text the oracle's output must contain (the diagnostics under test were really emitted). */
  expect: string[];
}

const B = (pass: string): string => `builtin.ts:${pass}`;

const CASES: Case[] = [
  {
    name: "NonShorthandFieldPatterns: `x: x`, `y: ref y`, shorthand and macro-expanded fields are skipped",
    passes: [B("NonShorthandFieldPatterns")],
    src: [
      "pub struct Point { pub x: i32, pub y: i32 }",
      "macro_rules! pat { ($p:ident) => { Point { x: $p, y: _ } } }",
      "pub fn f(p: Point) -> i32 {",
      "    match p {",
      "        Point { x: x, y: ref y } => x + *y,",
      "    }",
      "}",
      "pub fn g(p: Point) -> i32 { let Point { x, y: z } = p; x + z }",
      "pub fn h(p: Point) -> i32 { let pat!(x) = p; x }",
    ],
    expect: ["the `x:` in this pattern is redundant", "the `y:` in this pattern is redundant"],
  },
  {
    name: "MissingDoc: crate, items, fields, variants, trait/impl/foreign items; documented, private, hidden and trait-impl items are skipped",
    passes: [B("MissingDoc")],
    src: [
      "#![warn(missing_docs)]",
      "#![allow(dead_code)]",
      "pub fn undocumented() {}",
      "/// Documented.",
      "pub fn documented() {}",
      "fn private() {}",
      "pub struct S { pub a: u8, b: u8 }",
      "pub struct T(pub u8);",
      "pub enum E { A, /** doc */ B }",
      "pub trait Tr { fn m(&self); }",
      "impl S { pub fn new() -> S { S { a: 0, b: 0 } } }",
      "impl Tr for S { fn m(&self) {} }",
      "#[doc(hidden)]",
      "pub struct Hidden;",
      "impl Hidden { pub fn h() {} }",
      'extern "C" { pub fn ext(); }',
      "pub mod m { pub const C: u8 = 0; }",
      "pub use m::C as D;",
      "pub fn uses() { private(); }",
    ],
    expect: ["missing documentation for the crate", "missing documentation for a struct field", "missing documentation for a variant"],
  },
  {
    name: "late.rs lint levels: `#[allow]` / `#[expect]` / `#[deny]` on items, fields, modules and statements reach the passes (with_lint_attrs)",
    passes: [B("NonShorthandFieldPatterns"), B("MissingDoc")],
    src: [
      "#![warn(missing_docs)]",
      "//! Crate docs.",
      "#[allow(missing_docs)]",
      "pub fn allowed() {}",
      "#[expect(missing_docs)]",
      "pub fn expected() {}",
      "#[expect(missing_docs)]",
      "/// Documented.",
      "pub fn unfulfilled() {}",
      "/// S.",
      "pub struct S {",
      "    #[deny(missing_docs)]",
      "    pub a: u8,",
      "}",
      "#[allow(missing_docs)]",
      "pub mod m { pub fn inner() {} }",
      "/// P.",
      "pub struct P { /** x */ pub x: u8 }",
      "/// f.",
      "pub fn f(p: P) -> u8 {",
      "    #[allow(non_shorthand_field_patterns)]",
      "    let P { x: x } = p;",
      "    match x { y => { let P { x: x } = P { x: y }; x } }",
      "}",
    ],
    expect: ["this lint expectation is unfulfilled", "missing documentation for a struct field"],
  },
  {
    name: "MissingCopyImplementations: plain struct/enum/union lint; generic, Drop, raw-pointer, non_exhaustive, Copy and private types do not",
    passes: [B("MissingCopyImplementations")],
    src: [
      "#![warn(missing_copy_implementations)]",
      "pub struct A { pub x: i32 }",
      "pub enum B { X, Y(u8) }",
      "pub union U { pub a: u32, pub b: f32 }",
      "pub struct G<T> { pub t: T }",
      "pub struct D { pub x: i32 }",
      "impl Drop for D { fn drop(&mut self) {} }",
      "pub struct P { pub p: *const u8 }",
      "#[non_exhaustive] pub struct N { pub x: i32 }",
      "#[derive(Clone, Copy)] pub struct C { pub x: i32 }",
      // (A `String` field stops at `layout_of` → const eval, M4.)
      "pub struct NotCopyable { pub b: Box<u8> }",
    ],
    expect: ["type could implement `Copy`; consider adding `impl Copy`"],
  },
  {
    name: "MissingDebugImplementations: non-generic and generic types; derived and manual Debug impls, private types skipped",
    passes: [B("MissingDebugImplementations")],
    src: [
      "#![warn(missing_debug_implementations)]",
      "pub struct A;",
      "pub enum B { X }",
      "pub struct G<T>(pub T);",
      "#[derive(Debug)] pub struct D;",
      "pub struct M;",
      "impl std::fmt::Debug for M { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(\"M\") } }",
      "#[derive(Debug)] pub struct DG<T>(pub T);",
      "struct Private;",
      "pub fn use_private() { let _ = Private; }",
    ],
    expect: ["type does not implement `Debug`"],
  },
  {
    name: "InvalidNoMangleItems: `#[no_mangle]` const (deny lint, suggestion) and generic fns / impl fns (hard error)",
    passes: [B("InvalidNoMangleItems")],
    src: [
      "#[no_mangle]",
      "pub const X: i32 = 1;",
      "#[no_mangle]",
      "const Y: i32 = 2;",
      "#[no_mangle]",
      "pub fn g<T>(_t: T) {}",
      "#[export_name = \"exp\"]",
      "pub fn h<T>(_t: T) {}",
      "#[no_mangle]",
      "pub fn ok(_x: u8) {}",
      "pub struct S;",
      "impl S { #[no_mangle] pub fn m<T>(_t: T) {} }",
      "pub fn use_y() -> i32 { Y }",
    ],
    expect: ["const items should never be `#[no_mangle]`", "functions generic over types or consts must be mangled"],
  },
  {
    name: "MutableTransmutes: `&T` to `&mut T` (deny); `&mut` to `&` and same mutability do not lint",
    passes: [B("MutableTransmutes")],
    src: [
      "pub fn f(x: &i32) -> &mut i32 { unsafe { std::mem::transmute::<&i32, &mut i32>(x) } }",
      "pub fn g(x: &mut i32) -> &i32 { unsafe { std::mem::transmute::<&mut i32, &i32>(x) } }",
      "pub fn h(x: &i32) -> &u32 { unsafe { std::mem::transmute(x) } }",
    ],
    expect: ["transmuting &T to &mut T is undefined behavior"],
  },
  {
    name: "UnstableFeatures: every feature of `#![feature(..)]`",
    passes: [B("UnstableFeatures")],
    src: ["#![warn(unstable_features)]", "#![feature(never_type, rustc_attrs)]", "pub fn f() {}"],
    expect: ["use of an unstable feature"],
  },
  {
    // An async fn body needs `mir_borrowck` (coroutine witness types; M4), so only the non-async path is checked.
    name: "UngatedAsyncFnTrackCaller: `#[track_caller]` on non-async fns and closures does not lint",
    passes: [B("UngatedAsyncFnTrackCaller")],
    src: ["#[track_caller]", "pub fn h() {}", "pub fn k() -> u8 { let c = |x: u8| x; c(1) }"],
    expect: [],
  },
  {
    name: "UnreachablePub: pub items in private modules (pub(crate) / pub(super) suggestions); reachable items skipped",
    passes: [B("UnreachablePub")],
    src: [
      "#![warn(unreachable_pub)]",
      "#![allow(dead_code)]",
      "mod private {",
      "    pub fn f() {}",
      "    pub struct S { pub x: u8 }",
      "    impl S { pub fn m(&self) {} }",
      "    pub mod inner { pub fn g() {} }",
      "}",
      "pub mod public { pub fn ok() {} }",
      "pub use private::S as Reexported;",
    ],
    expect: ["unreachable `pub` item"],
  },
  {
    name: "TypeAliasBounds: inline bounds and where clauses; shorthand assoc ty and object lifetime default suggestions",
    passes: [B("TypeAliasBounds")],
    src: [
      "pub type A<T: Clone> = Vec<T>;",
      "pub type B<T> where T: Clone = Vec<T>;",
      "pub type C<T: Iterator> = Option<T::Item>;",
      "pub type D<'a, T: 'a> = &'a T;",
      "pub type E<T: Clone + Copy, U: Default> = (T, U);",
      "pub type F<T> = Vec<T>;",
    ],
    expect: ["bounds on generic parameters in type aliases are not enforced", "where clauses on type aliases are not enforced"],
  },
  {
    name: "TrivialConstraints: no lint without `#![feature(trivial_bounds)]`",
    passes: [B("TrivialConstraints")],
    src: ["pub fn f<T: Copy>(t: T) -> T { t }", "pub struct S<T: Clone>(pub T);"],
    expect: [],
  },
  {
    name: "ExplicitOutlivesRequirements: inferable `T: 'a` / `'b: 'a` bounds, inline and in where clauses",
    passes: [B("ExplicitOutlivesRequirements")],
    src: [
      "#![warn(explicit_outlives_requirements)]",
      "pub struct A<'a, T: 'a> { pub x: &'a T }",
      "pub struct B<'a, T> where T: 'a { pub x: &'a T }",
      "pub struct C<'a, 'b: 'a> { pub x: &'a &'b u8 }",
      "pub struct D<'a, T: 'a + Clone> { pub x: &'a T }",
      "pub struct E<'a, T: Clone + 'a> { pub x: &'a T }",
      "pub enum F<'a, T: 'a> { V(&'a T) }",
      "pub struct G<'a, T: ?Sized + 'a> { pub x: &'a T }",
      "pub struct H<'a, T>(pub &'a T) where T: 'a;",
      "pub struct I<'a, T: 'a, U> where U: 'a { pub x: &'a T, pub y: &'a U }",
    ],
    expect: ["outlives requirements can be inferred"],
  },
  {
    name: "InvalidValue: zeroed/uninit types that permit it do not lint",
    passes: [B("InvalidValue")],
    src: [
      "pub struct S { pub a: u32, pub b: [u8; 4] }",
      "pub fn f() -> (u32, i64, [u8; 2], S, *const u8) {",
      "    unsafe { (std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed()) }",
      "}",
      "pub fn g() -> std::mem::MaybeUninit<u8> { std::mem::MaybeUninit::uninit() }",
      "pub fn h() -> u8 { unsafe { std::mem::MaybeUninit::<u8>::zeroed().assume_init() } }",
    ],
    expect: [],
  },
  {
    name: "DerefNullPtr: `*ptr::null()`, `*(0 as *const T)`, `*ptr::null_mut()` (deny); `&raw const *null` and ZST pointees do not lint",
    passes: [B("DerefNullPtr")],
    src: [
      "pub fn f() -> i32 { unsafe { *std::ptr::null::<i32>() } }",
      "pub fn g() -> u8 { unsafe { *(0 as *const u8) } }",
      "pub fn h() { unsafe { *std::ptr::null_mut::<i32>() = 1; } }",
      "pub fn ok() -> *const i32 { &raw const *std::ptr::null::<i32>() }",
      "pub fn zst() { unsafe { let () = *std::ptr::null::<()>(); } }",
    ],
    expect: ["dereferencing a null pointer"],
  },
  {
    name: "AsmLabels: named, format-arg and binary labels (x86_64); local labels and `options(raw)` braces",
    passes: [B("AsmLabels")],
    src: [
      "use std::arch::asm;",
      "pub fn f() {",
      "    unsafe {",
      '        asm!("foo: nop");',
      '        asm!("nop; bar: nop");',
      '        asm!("{}: nop", const 5);',
      '        asm!("0: jmp 0b");',
      '        asm!("1: jmp 1b", options(att_syntax));',
      '        asm!("2: nop");',
      '        asm!("{{x}}: nop", options(raw));',
      '        asm!("mov eax, 1 // comment: here");',
      "    }",
      "}",
    ],
    expect: ["avoid using named labels in inline assembly", "avoid using labels containing only the digits"],
  },
  {
    name: "InternalEqTraitMethodImpls: manual `Eq::assert_receiver_is_total_eq`",
    passes: [B("InternalEqTraitMethodImpls")],
    src: [
      "#[derive(PartialEq)]",
      "pub struct Foo;",
      "impl Eq for Foo {",
      "    fn assert_receiver_is_total_eq(&self) {}",
      "}",
      "#[derive(PartialEq, Eq)]",
      "pub struct Bar;",
    ],
    expect: ["`Eq::assert_receiver_is_total_eq` should never be implemented by hand"],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late lints: ${c.name}`, () => {
    const file = `case${i}.rs`;
    writeFileSync(join(WORK, file), c.src.join("\n") + "\n");
    const args = [
      "--target",
      "x86_64-unknown-linux-gnu",
      "--sysroot",
      sysroot(),
      `--edition=${c.edition ?? "2021"}`,
      "--crate-type=lib",
      "--emit=metadata",
      "-o",
      `case${i}.rmeta`,
      ...(c.flags ?? []),
      file,
    ];
    const oracle = run([...RUSTC, ...args]);
    const ours = run([process.execPath, join(REPO, "src/rustc_lint/late_oracle/run.ts"), ...c.passes.map((p) => `--late-pass=${p}`), ...args]);
    for (const e of c.expect) expect(oracle.stderr).toContain(e);
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.code).toBe(oracle.code);
  });
}
