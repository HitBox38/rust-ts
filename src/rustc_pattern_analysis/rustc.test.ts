// Tests of lane pat-c: rustc_pattern_analysis rustc.rs (`RustcPatCtxt`) and rustc/print.rs on real THIR.
//
// rustc_test_driver.ts compiles `#![no_core]` libraries with the ported driver up to type checking and calls
// `RustcPatCtxt` on the patterns of their bodies (the exhaustiveness check itself needs usefulness, lane pat-a):
// - `lower`: `lower_pat` / `ctors_for_ty` / `ctor_sub_tys` / `ctor_arity` on every arm, and the arm printed back with
//   `print_witness_pat`. Expected values from upstream semantics (rustc.rs, constructor.rs's `Debug` impls).
// - `witness`: `print_witness_pat` of hand-built witnesses. For `w1`..`w14` they are the witnesses the oracle reports
//   (E0004) for those fns, and the strings are the oracle's (checked live below when the oracle toolchain is
//   installed); the others exercise the remaining arms (wildcard-like constructors, deref patterns, the array `..`
//   merge, `Missing`), plus `would_print_as_wildcard`, `is_range_beyond_boundaries` and the other helpers.
// - `hooks` / `complexity`: the lint hooks (`lint_overlapping_range_endpoints`, `lint_non_contiguous_range_endpoints`)
//   and `complexity_exceeded` called as usefulness calls them: stderr must equal the oracle's for the same source.
//
// Known gap: printing a range starting at `usize::MAX + 1` needs `Ty::numeric_max_val`, whose `mir::Const::from_bits`
// is unported (rustc_middle ty/util.ts); the `usize_max_plus_one` case pins that `unported`.
import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { oracleRustcCmd } from "../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("pat-c-rustc");
const DRIVER = join(REPO, "src/rustc_pattern_analysis/rustc_test_driver.ts");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[]): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}
/** The driver on `src` (written to `<name>.rs` in the scratch dir; diagnostics name it so). */
function driver(scenario: string, name: string, src: string): Promise<Out> {
  writeFileSync(join(WORK, `${name}.rs`), src);
  return run(["bun", DRIVER, scenario, `${name}.rs`]);
}
/** The oracle on `<name>.rs` (as the driver: edition 2021, `--emit=metadata`); `undefined` if it is not installed. */
async function oracle(name: string): Promise<Out | undefined> {
  try {
    const o = await run([...oracleRustcCmd(["--edition", "2021", "--emit=metadata", "-o", `${name}.rmeta`, `${name}.rs`])]);
    // rustup's proxy reports a missing toolchain itself
    if (o.code !== 0 && /toolchain '.*' is not installed|error: toolchain/.test(o.stderr)) return undefined;
    return o;
  } catch {
    return undefined;
  }
}

const PRELUDE = `#![feature(lang_items, no_core, rustc_attrs)]
#![no_core]
#![crate_type = "lib"]
#![allow(unused, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "neg"] pub trait Neg { type Output; fn neg(self) -> Self::Output; }
impl Neg for i8 { type Output = i8; fn neg(self) -> i8 { loop {} } }
impl Neg for isize { type Output = isize; fn neg(self) -> isize { loop {} } }
impl Neg for i128 { type Output = i128; fn neg(self) -> i128 { loop {} } }
impl Neg for f64 { type Output = f64; fn neg(self) -> f64 { loop {} } }
impl Copy for u8 {}
impl Copy for i8 {}
#[rustc_diagnostic_item = "Option"] pub enum Option<T> { None, Some(T) }
pub enum E { A, B(bool), C { x: u8, y: (bool, char) } }
pub enum Void {}
pub enum WithVoid { V(Void), W, #[doc(hidden)] H }
pub struct S { pub a: bool, pub b: u8 }
pub struct T(pub bool, pub bool);
pub struct U;
pub union Un { pub a: u8, pub b: i8 }
pub mod m { pub struct P { pub x: u8, v: super::Void } pub struct Q { pub x: u8, pub v: super::Void } }
`;

const LOWER_SRC =
  PRELUDE +
  `pub fn f_e(e: E) { match e { E::A => {}, E::B(true) => {}, E::C { x: 3..=5, .. } => {}, E::C { y: (_, 'z'), x } => {}, _ => {} } }
pub fn f_i8(x: i8) { match x { -128..=-1 => {}, 0 => {}, 1.. => {} } }
pub fn f_isize(x: isize) { match x { ..-1 => {}, -1..=5 => {}, _ => {} } }
pub fn f_usize(x: usize) { match x { 0 | 1 => {}, 2.. => {} } }
pub fn f_char(c: char) { match c { 'a'..='z' => {}, _ => {} } }
pub fn f_u128(x: u128, y: i128) { match (x, y) { (0, -1) => {}, _ => {} } }
pub fn f_bool(b: bool) { match b { true => {}, false => {} } }
pub fn f_slice(x: &[bool]) { match x { [] => {}, [true, ..] => {}, [_, .., false] => {}, [_] | [_, _, _] => {}, _ => {} } }
pub fn f_array(x: [u8; 3]) { match x { [1, _, 2] => {}, [a, rest @ ..] => {} } }
pub fn f_str(s: &str) { match s { "foo" => {}, _ => {} } }
pub fn f_float(x: f64) { match x { 1.0 => {}, 2.0..=3.5 => {}, ..-0.5 => {}, _ => {} } }
pub fn f_ref(x: &mut Option<u8>) { match x { Option::Some(n @ 1) => {}, &mut Option::None => {}, _ => {} } }
pub fn f_s(s: S, t: T, u: U) { match (s, t, u) { (S { a: true, .. }, T(_, false), U) => {}, _ => {} } }
pub fn f_union(u: Un) { unsafe { match u { Un { a: 1 } => {}, Un { b } => {} } } }
pub fn f_void(x: WithVoid) { match x { WithVoid::W => {}, _ => {} } }
pub fn f_priv(p: m::P, q: m::Q) { match (p, q) { _ => {} } }
pub fn f_never(x: !) { match x { } }
pub fn f_voidm(x: Void) { match x {} }
pub fn f_tuple1(x: (bool,)) { match x { (true,) => {}, _ => {} } }
pub fn f_misc(p: *const u8, f: fn()) { match (p, f) { _ => {} } }
pub fn f_pq(p: m::P, q: m::Q) { match p { m::P { x: 1, .. } => {} _ => {} } match q { m::Q { x, .. } => {} } }
`;

// Each line: arm `Debug` | constructor/arity [ctor_sub_tys, `!` = PrivateUninhabitedField(true)] | printed back.
const LOWER_EXPECTED = `f_e:
  E: Variants { variants: [Visible, Visible, Visible], non_exhaustive: false }
    A() | Variant/0 [] | E::A
    B(true) | Variant/1 [bool] | E::B(true)
    C(3..6, _) | Variant/2 [u8, (bool, char)] | E::C { x: 3_u8..=5_u8, .. }
    C(_, (_, 122)) | Variant/2 [u8, (bool, char)] | E::C { y: (_, 'z'), .. }
    _ | Wildcard/0 [] | _
f_i8:
  i8: Integers { range_1: 0..256, range_2: None }
    0..128 | IntRange/0 [] | i8::MIN..=-1_i8
    128 | IntRange/0 [] | 0_i8
    129.. | IntRange/0 [] | 1_i8..
f_isize:
  isize: Integers { range_1: .., range_2: None }
    ..9223372036854775807 | IntRange/0 [] | ..=-2_isize
    9223372036854775807..9223372036854775814 | IntRange/0 [] | -1_isize..=5_isize
    _ | Wildcard/0 [] | _
f_usize:
  usize: Integers { range_1: 0.., range_2: None }
    0 | 1 | Or/2 [-] | 0_usize | 1_usize
    2.. | IntRange/0 [] | 2_usize..
f_char:
  char: Integers { range_1: 0..55296, range_2: Some(57344..1114112) }
    97..123 | IntRange/0 [] | 'a'..='z'
    _ | Wildcard/0 [] | _
f_u128:
  (u128, i128): Struct { empty: false }
    (0, 170141183460469231731687303715884105727) | Struct/2 [u128, i128] | (0_u128, -1_i128)
    _ | Wildcard/0 [] | _
f_bool:
  bool: Bool
    true | Bool/0 [] | true
    false | Bool/0 [] | false
f_slice:
  &[bool]: Ref
    &[] | Ref/1 [[bool]] | &[]
    &[true, ..] | Ref/1 [[bool]] | &[true, ..]
    &[_, .., false] | Ref/1 [[bool]] | &[_, .., false]
    &[_] | &[_, _, _] | Or/2 [-] | &[_] | &[_, _, _]
    _ | Wildcard/0 [] | _
f_array:
  [u8; 3]: Slice { array_len: Some(3), subtype_is_empty: false }
    [1, _, 2] | Slice/3 [u8, u8, u8] | [1_u8, _, 2_u8]
    [_, ..] | Slice/1 [u8] | [..]
f_str:
  &str: Ref
    &Value { ty: str, valtree: Branch([102_u8, 111_u8, 111_u8]) } | Ref/1 [str] | &Branch([102_u8, 111_u8, 111_u8]): str
    _ | Wildcard/0 [] | _
f_float:
  f64: Unlistable
    1..=1 | F64Range/0 [] | <panic: can't convert to pattern: 1..=1>
    2..=3.5 | F64Range/0 [] | <panic: can't convert to pattern: 2..=3.5>
    -Inf..-0.5 | F64Range/0 [] | <panic: can't convert to pattern: -Inf..-0.5>
    _ | Wildcard/0 [] | _
f_ref:
  &mut Option<u8>: Ref
    &Some(1) | Ref/1 [Option<u8>] | &mut Some(1_u8)
    &None() | Ref/1 [Option<u8>] | &mut None
    _ | Wildcard/0 [] | _
f_s:
  (S, T, U): Struct { empty: false }
    (S(true, _), T(_, false), U()) | Struct/3 [S, T, U] | (S { a: true, .. }, T(_, false), U)
    _ | Wildcard/0 [] | _
f_union:
  Un: Union
    Un(1, _) | UnionField/2 [u8, i8] | Un { a: 1_u8 }
    Un(_, _) | UnionField/2 [u8, i8] | Un { .. }
f_void:
  WithVoid: Variants { variants: [Empty, Visible, Visible], non_exhaustive: false }
    W() | Variant/0 [] | WithVoid::W
    _ | Wildcard/0 [] | _
f_priv:
  (m::P, m::Q): Struct { empty: true }
    _ | Wildcard/0 [] | _
f_never:
  !: NoConstructors
f_voidm:
  Void: NoConstructors
f_tuple1:
  (bool,): Struct { empty: false }
    (true) | Struct/1 [bool] | (true,)
    _ | Wildcard/0 [] | _
f_misc:
  (*const u8, fn()): Struct { empty: false }
    _ | Wildcard/0 [] | _
f_pq:
  m::P: Struct { empty: false }
    P(1, _) | Struct/2 [u8, Void!] | m::P { x: 1_u8, .. }
    _ | Wildcard/0 [] | _
  m::Q: Struct { empty: true }
    Q(_, _) | Struct/2 [u8, Void] | m::Q { .. }
`;

test("lower_pat / ctors_for_ty / ctor_sub_tys / print_witness_pat on real THIR", async () => {
  const o = await driver("lower", "lower", LOWER_SRC);
  expect(o.stderr).toBe("");
  expect(o.stdout).toBe(LOWER_EXPECTED);
  expect(o.code).toBe(0);
}, 120000);

/** The `wN` fns: the oracle's E0004 reports the witnesses the driver builds by hand. */
const WITNESS_FNS = `pub fn w1(e: E) { match e { E::B(true) => {} E::C { x: 3..=5, .. } => {} } }
pub fn w2(x: (bool, bool)) { match x { (true, true) => {} } }
pub fn w3(x: (bool,)) { match x { (true,) => {} } }
pub fn w4(x: &mut Option<u8>) { match x { Option::Some(1) => {} } }
pub fn w5(x: &[bool]) { match x { [] => {} [true, ..] => {} } }
pub fn w6(x: [bool; 4]) { match x { [true, .., true] => {} } }
pub fn w7(x: S) { match x { S { a: true, .. } => {} } }
pub fn w8(x: i8) { match x { 0..=10 => {} } }
pub fn w9(x: usize) { match x { 0..=10 => {} } }
pub fn w10(x: char) { match x { 'a'..='z' => {} } }
pub fn w12(x: isize) { match x { 0.. => {} } }
pub fn w13(x: T, u: U) { match (x, u) { (T(true, _), U) => {} } }
pub fn w14(x: &[bool]) { match x { [_, _, ..] => {} [] => {} } }
`;
const WITNESS_SRC =
  PRELUDE +
  WITNESS_FNS +
  `pub fn v(x: Void) { match x {} }
pub fn s(x: &str) { match x { "foo" => {} _ => {} } }
pub fn w15(x: [bool; 6]) { match x { [true, ..] => {} } }
`;

const WITNESS_EXPECTED = `w1: E::A (wildcard: false)
w2: (false, _) (wildcard: false)
w3: (false,) (wildcard: false)
w4: &mut None (wildcard: false)
w5: &[false, ..] (wildcard: false)
w6: [false, ..] (wildcard: false)
w7: S { a: false, .. } (wildcard: false)
w8: i8::MIN..=-1_i8 (wildcard: false)
w8: 11_i8..=i8::MAX (wildcard: false)
w9: 11_usize.. (wildcard: false)
w10: '\\0'..='\`' (wildcard: false)
w10: '{'..='\\u{d7ff}' (wildcard: false)
w10: '\\u{e000}'..='\\u{10ffff}' (wildcard: false)
w12: ..=-1_isize (wildcard: false)
w13: (T(false, _), _) (wildcard: false)
w14: &[_] (wildcard: false)
e_c: E::C { x: 3_u8..=5_u8, y: (true, _) } (wildcard: false)
e_c_wild: E::C { .. } (wildcard: false)
e_b: E::B(true) (wildcard: false)
full_range: _ (wildcard: true)
usize_max_plus_one: <unported: rustc_middle::mir::Const::from_bits (mir/consts.rs, M4)>
never: _ (wildcard: true)
non_exhaustive: _ (wildcard: true)
hidden: _ (wildcard: true)
private_uninhabited: _ (wildcard: true)
deref: deref!(_) (wildcard: false)
slice_merge: [true, .., false] (wildcard: false)
slice_fixed: [true, _, _, false] (wildcard: false)
slice_no_merge: &[true, _, .., _, false] (wildcard: false)
str: Branch([102_u8, 111_u8, 111_u8]): str (wildcard: false)
missing: <panic: trying to convert a \`Missing\` constructor into a \`Pat\`; this is probably a bug,>
debug e_c: C(3..6, (true, _))
is_range_beyond_boundaries: isize ..MIN true, isize ..=-1 false, isize 0.. false, usize MAX+1.. true, usize 11.. false, i8 ..=-1 false
is_exhaustive_patterns_feature_on: false, match_may_contain_deref_pats: false, is_foreign_non_exhaustive_enum(E): false, is_uninhabited(Void): true, is_uninhabited(E): false
variant_index_for_adt: Variant(2) 2, Struct 0
write_variant_name: B S ""
`;

/** check_match.rs `joined_uncovered_patterns` (up to 3 witnesses). */
function joined(ws: string[]): string {
  const q = ws.map((w) => `\`${w}\``);
  return q.length === 1 ? q[0]! : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
}

test("print_witness_pat on hand-built witnesses (the oracle's E0004 witnesses for w1..w14)", async () => {
  const o = await driver("witness", "wit", WITNESS_SRC);
  expect(o.stderr).toBe("");
  expect(o.stdout).toBe(WITNESS_EXPECTED);
  expect(o.code).toBe(0);
  // Live check of the `wN` lines against the oracle: E0004 on the same fns (here alone, so the lines match `wN`).
  writeFileSync(join(WORK, "wit_oracle.rs"), PRELUDE + WITNESS_FNS);
  const or = await oracle("wit_oracle");
  if (or === undefined) {
    console.log("SKIP: oracle toolchain not installed; the wN witnesses are checked against the recorded strings only");
    return;
  }
  const by_fn = new Map<string, string[]>();
  for (const line of o.stdout.split("\n")) {
    const m = /^(w\d+): (.*) \(wildcard: false\)$/.exec(line);
    if (m) by_fn.set(m[1]!, [...(by_fn.get(m[1]!) ?? []), m[2]!]);
  }
  const lines = (PRELUDE + WITNESS_FNS).split("\n");
  const blocks = or.stderr.split("\n\n").filter((b) => b.startsWith("error[E0004]"));
  expect(blocks.length).toBe(by_fn.size);
  for (const b of blocks) {
    const at = /--> wit_oracle\.rs:(\d+):/.exec(b)!;
    const fn = /^pub fn (w\d+)/.exec(lines[Number(at[1]) - 1]!)![1]!;
    expect(`${fn}: ${b.split("\n")[0]}`).toBe(`${fn}: error[E0004]: non-exhaustive patterns: ${joined(by_fn.get(fn)!)} not covered`);
  }
}, 120000);

const HOOKS_SRC =
  PRELUDE +
  `pub fn f(x: u8) { match x { 0..=10 => {} 10..=20 => {} _ => {} } }
pub fn g(x: u8) { match x { 0..10 => {} 11..=20 => {} _ => {} } }
pub fn h(x: u8) { match x { 0..255 => {} _ => {} } }
`;
// The oracle's stderr on HOOKS_SRC (rustc +nightly-2026-10-11 --edition 2021 --emit=metadata hooks.rs).
const HOOKS_STDERR = `warning: multiple patterns overlap on their endpoints
  --> hooks.rs:25:42
   |
25 | pub fn f(x: u8) { match x { 0..=10 => {} 10..=20 => {} _ => {} } }
   |                             ------       ^^^^^^^ ... with this range
   |                             |
   |                             this range overlaps on \`10_u8\`...
   |
   = note: you likely meant to write mutually exclusive ranges
   = note: \`#[warn(overlapping_range_endpoints)]\` on by default

warning: multiple ranges are one apart
  --> hooks.rs:26:29
   |
26 | pub fn g(x: u8) { match x { 0..10 => {} 11..=20 => {} _ => {} } }
   |                             ^^^^^       ------- this could appear to continue range \`0_u8..10_u8\`, but \`10_u8\` isn't matched by either of them
   |                             |
   |                             this range doesn't match \`10_u8\` because \`..\` is an exclusive range
   |                             help: use an inclusive range instead: \`0_u8..=10_u8\`
   |
   = note: \`#[warn(non_contiguous_range_endpoints)]\` on by default

warning: exclusive range missing \`u8::MAX\`
  --> hooks.rs:27:29
   |
27 | pub fn h(x: u8) { match x { 0..255 => {} _ => {} } }
   |                             ^^^^^^
   |                             |
   |                             this range doesn't match \`u8::MAX\` because \`..\` is an exclusive range
   |                             help: use an inclusive range instead: \`0_u8..=u8::MAX\`

warning: 3 warnings emitted

`;

test("lint hooks emit what the oracle emits (overlapping / non-contiguous range endpoints)", async () => {
  const o = await driver("hooks", "hooks", HOOKS_SRC);
  expect(o.stdout).toBe("hooks done\n");
  expect(o.stderr).toBe(HOOKS_STDERR);
  expect(o.code).toBe(0);
  const or = await oracle("hooks");
  if (or === undefined) return console.log("SKIP: oracle toolchain not installed; checked against the recorded stderr only");
  expect(or.stderr).toBe(HOOKS_STDERR);
  expect(or.code).toBe(0);
}, 120000);

const COMPLEXITY_SRC =
  PRELUDE.replace("#![allow(unused, internal_features)]\n", '#![allow(unused, internal_features)]\n#![pattern_complexity_limit = "1"]\n') +
  `pub fn k(x: (bool, bool)) { match x { (true, _) => {} (_, true) => {} _ => {} } }
`;
// The oracle's stderr on COMPLEXITY_SRC.
const COMPLEXITY_STDERR = `error: reached pattern complexity limit
  --> complexity.rs:26:29
   |
26 | pub fn k(x: (bool, bool)) { match x { (true, _) => {} (_, true) => {} _ => {} } }
   |                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

error: aborting due to 1 previous error

`;

test("complexity_exceeded emits what the oracle emits", async () => {
  const o = await driver("complexity", "complexity", COMPLEXITY_SRC);
  expect(o.stdout).toBe("complexity_exceeded: Err\n");
  expect(o.stderr).toBe(COMPLEXITY_STDERR);
  expect(o.code).toBe(1);
  const or = await oracle("complexity");
  if (or === undefined) return console.log("SKIP: oracle toolchain not installed; checked against the recorded stderr only");
  expect(or.stderr).toBe(COMPLEXITY_STDERR);
  expect(or.code).toBe(1);
}, 120000);
