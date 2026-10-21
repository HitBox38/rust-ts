// Oracle checks of the late passes of types.rs, types/literal.rs and types/improper_ctypes.rs (lane lint-late-b:
// `TypeLimits`, `VariantSizeDifferences`, `InvalidAtomicOrdering`, `ImproperCTypesLint`) against the pinned nightly rustc.
// The subject is src/rustc_lint/late_oracle/run.ts (lane lint-late-a; see its header): the ported driver,
// `run_required_analyses_prefix` (typeck of every body), `analysis`'s abort on non-lint errors, the listed late passes
// on every module through `late_lint_mod` (`--late-pass`), `check_expectations(None)`. The oracle compiles the same
// file as a lib with std (`--emit=metadata`); each case only has diagnostics the listed passes produce, so stderr and
// the exit code must be identical.
// PENDING cases pin where the subject stops today (exit 70, `rust-ts: unported: ..`) on code that is not this lane's:
// `Ty: StableHash` (`type_id_hash`, the `ImproperCTypesLint`
// cache key of every `extern "C"` signature), and `ImproperCTypes::into_diag` (diagnostics.ts). When one of them is ported, the pin fails: turn the case into a normal one.
// Not covered: `uses_power_alignment` (AIX only; the `powerpc64-ibm-aix` target spec is not ported).
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

const WORK = join(DATA, "tmp", "late-types-oracle", process.env.RUST_TS_AGENT ?? "default");
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
  /** PENDING: the subject's exact stderr today (it stops with exit 70 there). */
  pending?: string;
}

const TL = "types.ts:TypeLimits";
const VSD = "types.ts:VariantSizeDifferences";
const IAO = "types.ts:InvalidAtomicOrdering";
const ICT = "types/improper_ctypes.ts:ImproperCTypesLint";

const CASES: Case[] = [
  {
    name: "TypeLimits: unused_comparisons, overflowing int / uint literals (decimal, negated, hex / binary with and without suffix)",
    passes: [TL],
    src: [
      "pub fn f(x: u8) -> bool { x >= 0 }",
      "pub fn g() -> i8 { 200 }",
      "pub fn h() -> u8 { 256 }",
      "pub fn k() -> i8 { -129 }",
      "pub fn m() -> i8 { 0xFFi8 }",
      "pub fn a() -> u8 { 0x1FFu8 }",
      "pub fn b() -> i8 { 0x80 }",
      "pub fn c() -> i16 { 0xFFFF }",
      "pub fn d() -> i32 { -0x8000_0001 }",
      "pub fn i() -> isize { 9223372036854775808 }",
      "pub fn j() -> i64 { -9223372036854775808 }",
      "pub fn k2(x: i8) -> bool { x > 127 }",
      "pub fn l(x: u32) -> bool { 0 <= x }",
      "pub fn m2(x: i16) -> bool { -32768 == x }",
      "pub fn n(x: u8) -> bool { x < 256 }",
      "pub fn s() -> [u8; 1] { [b'a'] }",
    ],
    expect: ["comparison is useless due to type limits", "literal out of range for `i8`", "the literal `0xFFi8` (decimal `255`) does not fit into the type `i8`"],
  },
  {
    name: "TypeLimits: casts to char, exclusive range endpoints (`..256u8`, `0u8..256`, through a cast), match ranges",
    passes: [TL],
    src: [
      "pub fn f() -> char { 300 as char }",
      "pub fn g() -> char { 0xD800 as char }",
      "pub fn h() -> char { 0x110000 as char }",
      "pub fn o() { for _ in 0..256u8 {} }",
      "pub fn p() { for _ in 0u8..256 {} }",
      "pub fn q() { let _r = 1..(256 as u8); }",
      "pub fn r(x: u8) { match x { 0..=255 => {} } }",
      "pub fn e() -> u64 { 0b1_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_0000_u128 as u64 }",
    ],
    expect: ["only `u8` can be cast into `char`", "surrogate values are not valid for `char`", "value exceeds maximum `char` value", "range endpoint is out of range for `u8`"],
  },
  {
    name: "TypeLimits: invalid_nan_comparisons (`==` / `!=` either side, through a block, `<`)",
    passes: [TL],
    src: [
      "pub fn a(x: f32) -> bool { x == f32::NAN }",
      "pub fn b(x: f64) -> bool { f64::NAN != x }",
      "pub fn c(x: f32) -> bool { x < f32::NAN }",
      "pub fn d(x: &f64) -> bool { *x == { f64::NAN } }",
    ],
    expect: ["incorrect NaN comparison, NaN cannot be directly compared to itself", "incorrect NaN comparison, NaN is not orderable"],
  },
  {
    name: "TypeLimits: unpredictable_function_pointer_comparisons without a suggestion (`Option<fn()>`, `<`, `PartialOrd::lt`)",
    passes: [TL],
    src: [
      "pub fn a(f: Option<fn()>, g: Option<fn()>) -> bool { f == g }",
      "pub fn b(f: fn(), g: fn()) -> bool { f < g }",
      "pub fn c(f: &fn() -> u8, g: fn() -> u8) -> bool { f.lt(&g) }",
    ],
    expect: ["function pointer comparisons do not produce meaningful results since their addresses are not guaranteed to be unique"],
  },
  {
    name: "TypeLimits: fn pointer `==` suggestion (`std::ptr::fn_addr_eq`)",
    passes: [TL],
    src: ["pub fn a(f: fn(), g: fn()) -> bool { f == g }"],
    expect: ["use `std::ptr::fn_addr_eq` to suppress the lint"],
  },
  {
    name: "TypeLimits: ambiguous_wide_pointer_comparisons (`std::ptr::addr_eq` / `std::ptr::eq` suggestions)",
    passes: [TL],
    src: ["pub fn a(p: *const [u8], q: *const [u8]) -> bool { p == q }"],
    expect: ["ambiguous wide pointer comparison, the comparison includes metadata which may not be expected"],
  },
  {
    // (vendor-apfloat-b) `float_is_infinite` parses with the vendored rustc_apfloat: literals that round to infinity
    // (including just above the largest finite value), not those that round to `MAX` or underflow to zero.
    name: "TypeLimits: overflowing float literals (f32 / f64, negated, suffixed, round to MAX vs infinity, underflow)",
    passes: [TL],
    src: [
      "pub fn a() -> f32 { 1e40 }",
      "pub fn b() -> f64 { -1e400 }",
      "pub fn c() -> f32 { 3.4028235e38 }",
      "pub fn d() -> f32 { 3.4028236e38 }",
      "pub fn e() -> f32 { 3.4028236e38_f32 }",
      "pub fn g() -> f32 { 3.40282357e38 }",
      "pub fn h() -> f64 { 1.7976931348623157e308 }",
      "pub fn i() -> f64 { 1.7976931348623159e308 }",
      "pub fn j() -> f32 { 1e-50 }",
      "pub fn k(x: f64) -> bool { x == 1e309 }",
      "pub fn l() -> f32 { 100_000_000_000_000_000_000_000_000_000_000_000_000_000.0 }",
      "pub fn m() -> f64 { 0.0 }",
    ],
    expect: ["literal out of range for `f32`", "literal out of range for `f64`"],
  },
  {
    name: "TypeLimits: overflowing f16 / f128 literals",
    passes: [TL],
    src: [
      "#![feature(f16, f128)]",
      "pub fn a() -> f16 { 65504.0 }",
      "pub fn b() -> f16 { 65520.0 }",
      "pub fn c() -> f16 { -1e5 }",
      "pub fn d() -> f128 { 1.18973149535723176508575932662800702e4932 }",
      "pub fn e() -> f128 { 1.2e4932 }",
      "pub fn f() -> f128 { 1e-5000 }",
    ],
    expect: ["literal out of range for `f16`", "literal out of range for `f128`"],
  },
  {
    name: "VariantSizeDifferences: largest vs second largest variant, repr(u8), generic, #[allow], non-null niche",
    passes: [VSD],
    src: [
      "#![warn(variant_size_differences)]",
      "pub enum A { X(u8), Y([u8; 100]), Z(u32) }",
      "pub enum B { X(u8), Y(u16) }",
      "#[repr(u8)]",
      "pub enum C { X(u8), Y([u64; 4]) }",
      "pub enum D<T> { X(T), Y([u8; 64]) }",
      "#[allow(variant_size_differences)]",
      "pub enum E { X(u8), Y([u8; 100]) }",
      "pub enum F { X(&'static u8), Y([u8; 100]) }",
    ],
    expect: ["enum variant is more than three times larger (100 bytes) than the next largest", "(39 bytes)"],
  },
  {
    name: "InvalidAtomicOrdering: load / store / fence / compiler_fence / compare_exchange(_weak) / try_update",
    passes: [IAO],
    src: [
      "use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering, fence, compiler_fence};",
      "pub fn a(x: &AtomicU8) -> u8 { x.load(Ordering::Release) }",
      "pub fn b(x: &AtomicU8) { x.store(1, Ordering::Acquire) }",
      "pub fn c(x: &AtomicU8) { x.store(1, Ordering::AcqRel) }",
      "pub fn d() { fence(Ordering::Relaxed); compiler_fence(Ordering::Relaxed); }",
      "pub fn e(x: &AtomicUsize) -> Result<usize, usize> { x.compare_exchange(0, 1, Ordering::SeqCst, Ordering::Release) }",
      "pub fn f(x: &AtomicUsize) -> Result<usize, usize> { x.compare_exchange_weak(0, 1, Ordering::SeqCst, Ordering::AcqRel) }",
      "pub fn g(x: &AtomicUsize) -> Result<usize, usize> { x.try_update(Ordering::SeqCst, Ordering::Release, |v| Some(v)) }",
      "pub fn h(x: &AtomicU8) -> u8 { x.load(Ordering::SeqCst) }",
    ],
    expect: ["atomic loads cannot have `Release` or `AcqRel` ordering", "memory fences cannot have `Relaxed` ordering", "`try_update`'s failure ordering may not be"],
  },
  {
    name: "ImproperCTypesLint: FFI-safe extern fn pointers in fields, aliases, statics, consts, Rust fns, trait methods, an extern \"Rust\" block",
    passes: [ICT],
    src: [
      '#[repr(C)] pub struct S { pub a: u32, pub b: *const u8, pub f: Option<extern "C" fn(i32) -> i32> }',
      "#[repr(C)] pub enum E { A, B }",
      'pub struct U { pub g: extern "C" fn(u16, *mut S), pub h: Option<extern "C" fn(&u8) -> E> }',
      'pub type A = extern "C" fn(i32, Option<&u8>) -> u8;',
      'pub static P: Option<extern "C" fn(u64)> = None;',
      'pub const Q: Option<extern "C" fn(std::ptr::NonNull<u32>, Box<u8>) -> bool> = None;',
      'pub fn r(_f: extern "C" fn(*const u8)) -> Option<extern "C" fn(Option<extern "C" fn()>)> { None }',
      'pub trait Tr { fn m(&self, _f: extern "C" fn(i8)) {} }',
      'unsafe extern "Rust" { pub fn ext(f: extern "C" fn(u8) -> u16, s: &str); }',
    ],
    expect: [],
  },
  {
    name: "PENDING ImproperCTypesLint: an FFI-unsafe fn pointer stops at ImproperCTypes::into_diag",
    passes: [ICT],
    src: ['pub type A = extern "C" fn(&str);'],
    expect: ["`extern` fn uses type `str`, which is not FFI-safe"],
    pending: "rust-ts: unported: rustc_lint::diagnostics::ImproperCTypes::into_diag (IntoDiagArg for Ty, M3)\n",
  },
  {
    name: "PENDING ImproperCTypesLint: an extern \"C\" signature stops at the cache key (Ty: StableHash)",
    passes: [ICT],
    src: ['unsafe extern "C" { pub fn f(x: i32) -> i32; }'],
    expect: [],
    pending: "rust-ts: unported: rustc_middle::ty::Ty: StableHash (ty/impls_ty.rs) under StableHashState::while_hashing_spans\n",
  },
  {
    name: "all four passes combined (lib.rs order): diagnostic order across passes",
    passes: [ICT, IAO, TL, VSD],
    src: [
      "#![warn(variant_size_differences)]",
      "use std::sync::atomic::{AtomicU8, Ordering};",
      "pub enum A { X(u8), Y([u8; 100]) }",
      "pub fn a(x: &AtomicU8) -> bool { x.load(Ordering::AcqRel) > 255 }",
      'pub struct U { pub g: extern "C" fn(u16) }',
      "pub fn b() -> u8 { 1000 }",
    ],
    expect: ["comparison is useless due to type limits", "atomic loads cannot have", "literal out of range for `u8`", "enum variant is more than three times larger"],
  },
];

for (const [i, c] of CASES.entries()) {
  test.skipIf(SKIP)(`late types lints: ${c.name}`, () => {
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
    if (c.pending !== undefined) {
      expect(ours.stderr).toBe(c.pending);
      expect(ours.code).toBe(70);
    } else {
      expect(ours.stderr).toBe(oracle.stderr);
      expect(ours.code).toBe(oracle.code);
    }
  });
}
