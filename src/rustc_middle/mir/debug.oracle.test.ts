// Oracle checks of lane mir-body-b (not a port): the `Debug` / `Display` text of MIR statements, terminators, rvalues,
// operands and places (mir/pretty.rs:874..1437, with statement.rs / terminator.rs / consts.rs underneath), i.e. the
// lines `-Zdump-mir` / `-Zunpretty=mir` print inside basic blocks. Both sides compile FIXTURE with `--edition 2024`.
//
// MIR building is not ported yet (wave 22), so each case builds its node by hand, in a `TyCtxt` of FIXTURE (a no_core
// lib), and compares the port's `{:?}` with the expected line. Every expected line is a line of the oracle's
// `-Zdump-mir=built` output for FIXTURE (checked here when the pinned rustc is available: skipped otherwise, a failure
// under RUST_TS_REQUIRE_PROBES=1). `Const::Val` operands print through mir/pretty.rs `pretty_print_const_value` (lane
// mir-pretty, merged): scalar ones are cases; aggregate values (`const ()`) need rustc_const_eval's
// `try_destructure_mir_constant_for_user_output` hook (not ported) and are checked to stop there.
//
// Also unit checks of the CFG helpers (`successors`, `edges`, `SwitchTargets`, `StmtDebugInfos`), each against upstream
// behavior on hand-built terminators.
import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { FieldIdx, VariantIdx } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import "../../rustc_hir_typeck/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Const as ty_Const } from "../../rustc_type_ir/sty/consts.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import "../lib.ts";
import type { TyCtxt } from "../ty/context.ts";
import { RawList } from "../ty/list.ts";
import { UserTypeAnnotationIndex } from "../ty/typeck_results.ts";
import { Ty } from "../ty/mod.ts";
import {
  BasicBlock,
  type Const,
  ConstOperand,
  ConstValue,
  debug_Operand,
  debug_Place,
  debug_Rvalue,
  debug_Statement,
  debug_Terminator,
  Local,
  type Operand,
  Place,
  type PlaceElem,
  type Rvalue,
  SourceInfo,
  SourceScope,
  Statement,
  type StatementKind,
  StmtDebugInfos,
  SwitchTargets,
  Terminator,
  type TerminatorKind,
  TerminatorKind as TK,
  UnevaluatedConst,
  UnwindAction,
} from "./mod.ts";
import { display_Const } from "./consts.ts";
import { Scalar } from "./interpret/mod.ts";

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
if (!HAVE && !REQUIRE) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "mir-body-b-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });

const FIXTURE = `#![feature(no_core, lang_items, thread_local)]
#![no_core]
#![crate_type = "lib"]
#![allow(unused, internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for i32 {}
impl Copy for bool {}
impl Copy for usize {}
impl<T: ?Sized> Copy for &T {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}
#[lang = "not"]
pub trait Not {
    type Output;
    fn not(self) -> Self::Output;
}
impl Not for bool {
    type Output = bool;
    fn not(self) -> bool {
        !self
    }
}
#[lang = "add"]
pub trait Add<Rhs = Self> {
    type Output;
    fn add(self, rhs: Rhs) -> Self::Output;
}
impl Add for i32 {
    type Output = i32;
    fn add(self, rhs: i32) -> i32 {
        self + rhs
    }
}
#[lang = "index"]
pub trait Index<Idx> {
    type Output: ?Sized;
    fn index(&self, index: Idx) -> &Self::Output;
}
impl<T> Index<usize> for [T] {
    type Output = T;
    fn index(&self, index: usize) -> &T {
        &self[index]
    }
}

pub struct Foo {
    pub x: i32,
    pub y: bool,
}
pub struct Pair(pub i32, pub i32);
pub enum E {
    A(i32),
    B { v: i32 },
    C,
}
pub trait Tr {
    const C: i32;
}
pub struct D;
impl Drop for D {
    fn drop(&mut self) {}
}
#[thread_local]
static mut TLS: i32 = 0;

pub fn places(p: &Pair, a: [i32; 3], s: &[i32], e: E, i: usize) -> i32 {
    let x = p.0;
    let [f, ..] = a;
    let [.., l] = a;
    let w = match s {
        [_, m @ .., _] => 1,
        [.., z] => *z,
        [] => 2,
    };
    let y = s[i];
    if let E::A(q) = e { q } else { x }
}

pub fn rvalues(r: &mut i32, b: bool, f: Foo, i: i32, j: i32) -> Foo {
    let a = &*r;
    let m = &mut *r;
    let raw = &raw const *r;
    let t = (b, b);
    let u = (b,);
    let k = Pair(i, j);
    let st = Foo { x: i, y: !b };
    let d = E::C;
    let v = E::B { v: i };
    let w = E::A(j);
    let arr = [b, b];
    let rep = [b; 3];
    let c = || f.x;
    let s = i + j;
    let n = i as usize;
    let tl = unsafe { TLS };
    Foo { x: f.x, y: b }
}

pub fn generic<const N: usize, T: Tr>() -> (usize, i32) {
    (N, T::C)
}

pub fn calls(b: bool, g: fn(i32) -> i32, x: i32, d: D) -> i32 {
    let ann: i32 = x;
    if b { g(x) } else { loop {} }
}
`;
const FIXTURE_FILE = join(WORK, "fx.rs");
writeFileSync(FIXTURE_FILE, FIXTURE);

/** The fixture's items, by name (looked up in the port's `TyCtxt`). */
interface Cx {
  tcx: TyCtxt;
  items: Map<string, DefId>;
}

// ---- builders ----
const L = (n: number): Local => Local.from_u32(n);
const bb = (n: number): BasicBlock => BasicBlock.from_u32(n);
const deref: PlaceElem = { $: "Deref" };
const field = (i: number, ty: Ty): PlaceElem => ({ $: "Field", _0: FieldIdx.from_u32(i), _1: ty });
function place(cx: Cx, local: number, elems: PlaceElem[] = []): Place {
  return new Place(L(local), cx.tcx.mk_place_elems(elems));
}
const copy = (p: Place): Operand => ({ $: "Copy", _0: p });
const move = (p: Place): Operand => ({ $: "Move", _0: p });
const SI = new SourceInfo(DUMMY_SP, SourceScope.from_u32(0));
function stmt(kind: StatementKind): string {
  return debug_Statement(Statement.new(SI, kind), PLAIN);
}
function assign(cx: Cx, local: number, rv: Rvalue): string {
  return stmt({ $: "Assign", _0: [place(cx, local), rv] });
}
const use_ = (op: Operand): Rvalue => ({ $: "Use", _0: op, _1: "Yes" });
function term(kind: TerminatorKind): string {
  return debug_Terminator(new Terminator(SI, kind), PLAIN);
}
const cleanup = (n: number): UnwindAction => ({ $: "Cleanup", _0: bb(n) });
const val = (cv: ConstValue, ty: Ty): Operand => ({ $: "Constant", _0: new ConstOperand(DUMMY_SP, undefined, { $: "Val", _0: cv, _1: ty }) });

/** `[expected oracle line (without the trailing `;`), the port's text]`. */
const CASES: [string, (cx: Cx) => string][] = [
  // ---- statements ----
  ["StorageLive(_6)", () => stmt({ $: "StorageLive", _0: L(6) })],
  ["StorageDead(_9)", () => stmt({ $: "StorageDead", _0: L(9) })],
  ["FakeRead(ForLet(None), _6)", (cx) => stmt({ $: "FakeRead", _0: [{ $: "ForLet", _0: undefined }, place(cx, 6)] })],
  ["FakeRead(ForMatchedPlace(None), _3)", (cx) => stmt({ $: "FakeRead", _0: [{ $: "ForMatchedPlace", _0: undefined }, place(cx, 3)] })],
  [
    "AscribeUserType(_5, o, UserTypeProjection { base: UserType(1), projs: [] })",
    (cx) => stmt({ $: "AscribeUserType", _0: [place(cx, 5), { base: UserTypeAnnotationIndex.from_u32(1), projs: [] }], _1: "Invariant" }),
  ],
  ["PlaceMention(_4)", (cx) => stmt({ $: "PlaceMention", _0: place(cx, 4) })],
  // ---- places (`post_fmt_projection` / `pre_fmt_projection`) ----
  ["_6 = copy ((*_1).0: i32)", (cx) => assign(cx, 6, use_(copy(place(cx, 1, [deref, field(0, cx.tcx.types.i32)]))))],
  ["_7 = copy _2[0 of 3]", (cx) => assign(cx, 7, use_(copy(place(cx, 2, [{ $: "ConstantIndex", offset: 0, min_length: 3, from_end: false }]))))],
  ["_8 = copy _2[2 of 3]", (cx) => assign(cx, 8, use_(copy(place(cx, 2, [{ $: "ConstantIndex", offset: 2, min_length: 3, from_end: false }]))))],
  ["_23 = &(*_3)[-1 of 1]", (cx) => assign(cx, 23, { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(cx, 3, [deref, { $: "ConstantIndex", offset: 1, min_length: 1, from_end: true }]) })],
  ["_22 = &(*_3)[1:-1]", (cx) => assign(cx, 22, { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(cx, 3, [deref, { $: "Subslice", from: 1, to: 1, from_end: true }]) })],
  ["_24 = copy (*_3)[_25]", (cx) => assign(cx, 24, use_(copy(place(cx, 3, [deref, { $: "Index", _0: L(25) }]))))],
  ["_9 = copy (*_23)", (cx) => assign(cx, 9, use_(copy(place(cx, 23, [deref]))))],
  ["_29 = copy ((_4 as A).0: i32)", (cx) => assign(cx, 29, use_(copy(place(cx, 4, [{ $: "Downcast", _0: Symbol.intern("A"), _1: VariantIdx.from_u32(0) }, field(0, cx.tcx.types.i32)]))))],
  ["_41 = copy (_3.0: i32)", (cx) => assign(cx, 41, use_(copy(place(cx, 3, [field(0, cx.tcx.types.i32)]))))],
  ["_0 = copy (*((*_1).0: &i32))", (cx) => assign(cx, 0, use_(copy(place(cx, 1, [deref, field(0, Ty.new_imm_ref(cx.tcx, cx.tcx.lifetimes.re_erased, cx.tcx.types.i32)), deref]))))],
  ["_0 = copy _29", (cx) => assign(cx, 0, use_(copy(place(cx, 29))))],
  ["_10 = move _11", (cx) => assign(cx, 10, use_(move(place(cx, 11))))],
  // ---- rvalues ----
  ["_11 = PtrMetadata(copy _3)", (cx) => assign(cx, 11, { $: "UnaryOp", _0: "PtrMetadata", _1: copy(place(cx, 3)) })],
  ["_19 = Not(move _20)", (cx) => assign(cx, 19, { $: "UnaryOp", _0: "Not", _1: move(place(cx, 20)) })],
  ["_13 = Ge(move _10, move _12)", (cx) => assign(cx, 13, { $: "BinaryOp", _0: "Ge", _1: [move(place(cx, 10)), move(place(cx, 12))] })],
  ["_27 = Lt(copy _25, copy _26)", (cx) => assign(cx, 27, { $: "BinaryOp", _0: "Lt", _1: [copy(place(cx, 25)), copy(place(cx, 26))] })],
  ["_36 = AddWithOverflow(copy _34, copy _35)", (cx) => assign(cx, 36, { $: "BinaryOp", _0: "AddWithOverflow", _1: [copy(place(cx, 34)), copy(place(cx, 35))] })],
  ["_33 = move (_36.0: i32)", (cx) => assign(cx, 33, use_(move(place(cx, 36, [field(0, cx.tcx.types.i32)]))))],
  ["_28 = discriminant(_4)", (cx) => assign(cx, 28, { $: "Discriminant", _0: place(cx, 4) })],
  ["_6 = &(*_1)", (cx) => assign(cx, 6, { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(cx, 1, [deref]) })],
  ["_7 = &mut (*_1)", (cx) => assign(cx, 7, { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Mut", kind: "Default" }, _2: place(cx, 1, [deref]) })],
  ["_32 = &(_3.0: i32)", (cx) => assign(cx, 32, { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(cx, 3, [field(0, cx.tcx.types.i32)]) })],
  ["_8 = &raw const (*_1)", (cx) => assign(cx, 8, { $: "RawPtr", _0: "Const", _1: place(cx, 1, [deref]) })],
  ["_37 = move _38 as usize (IntToInt)", (cx) => assign(cx, 37, { $: "Cast", _0: { $: "IntToInt" }, _1: move(place(cx, 38)), _2: cx.tcx.types.usize })],
  ["_40 = &/*tls*/ mut TLS", (cx) => assign(cx, 40, { $: "ThreadLocalRef", _0: cx.items.get("TLS")! })],
  ["_29 = [move _30; 3]", (cx) => assign(cx, 29, { $: "Repeat", _0: move(place(cx, 30)), _1: ty_Const.from_target_usize(cx.tcx, 3) })],
  ["_9 = (move _10, move _11)", (cx) => assign(cx, 9, { $: "Aggregate", _0: { $: "Tuple" }, _1: [move(place(cx, 10)), move(place(cx, 11))] })],
  ["_12 = (move _13,)", (cx) => assign(cx, 12, { $: "Aggregate", _0: { $: "Tuple" }, _1: [move(place(cx, 13))] })],
  ["_26 = [move _27, move _28]", (cx) => assign(cx, 26, { $: "Aggregate", _0: { $: "Array", _0: cx.tcx.types.bool }, _1: [move(place(cx, 27)), move(place(cx, 28))] })],
  ["_14 = Pair(move _15, move _16)", (cx) => assign(cx, 14, adt(cx, "Pair", 0, [move(place(cx, 15)), move(place(cx, 16))]))],
  ["_0 = Foo { x: move _41, y: move _42 }", (cx) => assign(cx, 0, adt(cx, "Foo", 0, [move(place(cx, 41)), move(place(cx, 42))]))],
  ["_21 = E::C", (cx) => assign(cx, 21, adt(cx, "E", 2, []))],
  ["_22 = E::B { v: move _23 }", (cx) => assign(cx, 22, adt(cx, "E", 1, [move(place(cx, 23))]))],
  ["_24 = E::A(move _25)", (cx) => assign(cx, 24, adt(cx, "E", 0, [move(place(cx, 25))]))],
  [
    "_31 = {closure@fx.rs:106:13: 106:15} { f__x: move _32 }",
    (cx) => {
      const closure = cx.tcx.hir_body_owners().map(LocalDefId.to_def_id).find((d) => cx.tcx.def_kind(d).$ === "Closure")!;
      const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(closure) as EarlyBinder<Ty>)).kind();
      if (k.$ !== "Closure") throw new Error("ERROR: not a closure type");
      return assign(cx, 31, { $: "Aggregate", _0: { $: "Closure", _0: closure, _1: k._1 }, _1: [move(place(cx, 32))] });
    },
  ],
  [
    "_0 = (const N, const <T as Tr>::C)",
    (cx) => {
      const generic = cx.items.get("generic")!;
      const [n, t] = RawList.identity_for_item(cx.tcx, generic);
      const c = cx.tcx.associated_item_def_ids(cx.items.get("Tr")!)[0]!;
      const n_: Const = { $: "Ty", _0: cx.tcx.types.usize, _1: n as ty_Const };
      const t_: Const = { $: "Unevaluated", _0: UnevaluatedConst.new(c, cx.tcx.mk_args([t!])), _1: cx.tcx.types.i32 };
      return assign(cx, 0, {
        $: "Aggregate",
        _0: { $: "Tuple" },
        _1: [
          { $: "Constant", _0: new ConstOperand(DUMMY_SP, undefined, n_) },
          { $: "Constant", _0: new ConstOperand(DUMMY_SP, undefined, t_) },
        ],
      });
    },
  ],
  // `Const::Val` scalars (`pretty_print_const_value`)
  ["_9 = const 1_i32", (cx) => assign(cx, 9, use_(val({ $: "Scalar", _0: Scalar.from_i32(1) }, cx.tcx.types.i32)))],
  ["_0 = const 0_i32", (cx) => assign(cx, 0, use_(val({ $: "Scalar", _0: Scalar.from_i32(0) }, cx.tcx.types.i32)))],
  ["_12 = const 2_usize", (cx) => assign(cx, 12, use_(val(ConstValue.from_target_usize(2, cx.tcx), cx.tcx.types.usize)))],
  // ---- terminators ----
  ["return", () => term(TK.Return)],
  ["resume", () => term(TK.UnwindResume)],
  ["unreachable", () => term(TK.Unreachable)],
  ["goto -> bb3", () => term(TK.goto(bb(3)))],
  ["switchInt(move _13) -> [0: bb3, otherwise: bb4]", (cx) => term(TK.if_(move(place(cx, 13)), bb(4), bb(3)))],
  ["falseEdge -> [real: bb14, imaginary: bb3]", () => term({ $: "FalseEdge", real_target: bb(14), imaginary_target: bb(3) })],
  ["falseUnwind -> [real: bb6, unwind: bb11]", () => term({ $: "FalseUnwind", real_target: bb(6), unwind: cleanup(11) })],
  ["drop(_4) -> [return: bb10, unwind: bb12]", (cx) => term({ $: "Drop", place: place(cx, 4), target: bb(10), unwind: cleanup(12), replace: false, drop: undefined })],
  [
    "drop(_4) -> [return: bb12, unwind terminate(cleanup)]",
    (cx) => term({ $: "Drop", place: place(cx, 4), target: bb(12), unwind: { $: "Terminate", _0: "InCleanup" }, replace: false, drop: undefined }),
  ],
  [
    "_0 = move _7(move _8) -> [return: bb3, unwind: bb11]",
    (cx) =>
      term({
        $: "Call",
        func: move(place(cx, 7)),
        args: [{ node: move(place(cx, 8)), span: DUMMY_SP }],
        destination: place(cx, 0),
        target: bb(3),
        unwind: cleanup(11),
        call_source: "Normal",
        fn_span: DUMMY_SP,
      }),
  ],
  [
    'assert(move _27, "index out of bounds: the length is {} but the index is {}", move _26, copy _25) -> [success: bb16, unwind: bb23]',
    (cx) =>
      term({
        $: "Assert",
        cond: move(place(cx, 27)),
        expected: true,
        msg: { $: "BoundsCheck", len: move(place(cx, 26)), index: copy(place(cx, 25)) },
        target: bb(16),
        unwind: cleanup(23),
      }),
  ],
  [
    'assert(!move (_36.1: bool), "attempt to compute `{} + {}`, which would overflow", move _34, move _35) -> [success: bb1, unwind: bb2]',
    (cx) =>
      term({
        $: "Assert",
        cond: move(place(cx, 36, [field(1, cx.tcx.types.bool)])),
        expected: false,
        msg: { $: "Overflow", _0: "Add", _1: move(place(cx, 34)), _2: move(place(cx, 35)) },
        target: bb(1),
        unwind: cleanup(2),
      }),
  ],
];

function adt(cx: Cx, name: string, variant: number, ops: Operand[]): Rvalue {
  return { $: "Aggregate", _0: { $: "Adt", _0: cx.items.get(name)!, _1: VariantIdx.from_u32(variant), _2: cx.tcx.mk_args([]), _3: undefined, _4: undefined }, _1: ops };
}
class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** Runs `f` in a `TyCtxt` of FIXTURE (the cwd-relative `fx.rs`, as for the oracle). */
function with_fixture(f: (cx: Cx) => void): void {
  const cwd = process.cwd();
  process.chdir(WORK);
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", "fx.rs"]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        const items = new Map<string, DefId>();
        for (const id of tcx.hir_free_items()) {
          const item = tcx.hir_item(id);
          const k = item.kind;
          const name = k.$ === "Fn" || k.$ === "Trait" ? k.ident.name : k.$ === "Struct" || k.$ === "Enum" ? k._0.name : k.$ === "Static" ? k._1.name : undefined;
          if (name !== undefined) items.set(Symbol.as_str(name), LocalDefId.to_def_id(item.owner_id.def_id));
        }
        const cx: Cx = { tcx, items };
        f(cx);
      });
    });
  } finally {
    process.chdir(cwd);
  }
}

test.skipIf(!HAVE && !REQUIRE)("every expected line is a line of the oracle's -Zdump-mir=built output", () => {
  const out = join(WORK, "mir");
  rmSync(out, { recursive: true, force: true });
  const r = Bun.spawnSync([...RUSTC, "fx.rs", "--edition", "2024", "--emit=metadata", "-Zdump-mir=built", `-Zdump-mir-dir=${out}`, "-Zmir-include-spans=false"], {
    cwd: WORK,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  const lines = new Set<string>();
  for (const f of readdirSync(out)) {
    for (const l of readFileSync(join(out, f), "utf8").split("\n")) lines.add(l.trim());
  }
  const missing = CASES.map(([e]) => e).filter((e) => !lines.has(`${e};`));
  expect(missing).toEqual([]);
});

test("the port's Debug text of each hand-built node is the oracle's line", () => {
  const results: string[] = [];
  with_fixture((cx) => {
    for (const [expected, build] of CASES) {
      let got: string;
      try {
        got = build(cx);
      } catch (e) {
        got = e instanceof Unported ? `UNPORTED(${e.what})` : `THROW(${e instanceof Error ? e.message.split("\n")[0] : String(e)})`;
      }
      results.push(got === expected ? "ok" : `${expected}\n  got: ${got}`);
    }
  });
  expect(results.filter((r) => r !== "ok")).toEqual([]);
}, 120000);

test("display_Const of a `Const::Val`: a scalar prints; `()` stops at rustc_const_eval's destructuring hook (not ported)", () => {
  with_fixture((cx) => {
    expect(display_Const({ $: "Val", _0: { $: "Scalar", _0: Scalar.from_i32(1) }, _1: cx.tcx.types.i32 })).toBe("1_i32");
    let err: unknown;
    try {
      display_Const({ $: "Val", _0: { $: "ZeroSized" }, _1: cx.tcx.types.unit });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Unported);
    expect((err as Unported).what).toBe("rustc_const_eval::const_eval::try_destructure_mir_constant_for_user_output");
  });
}, 120000);

// ---- CFG helpers (no TyCtxt needed beyond places) ----
test("successors / successor labels / edges follow terminator.rs and pretty.rs", () => {
  with_fixture((cx) => {
    const k_call: TerminatorKind = {
      $: "Call",
      func: move(place(cx, 1)),
      args: [],
      destination: place(cx, 0),
      target: undefined,
      unwind: cleanup(7),
      call_source: "Normal",
      fn_span: DUMMY_SP,
    };
    expect([...TK.successors(k_call)]).toEqual([bb(7)]);
    expect(TK.fmt_successor_labels(k_call)).toEqual(["unwind"]);
    // one successor and no unwind to show (`Cleanup` is a successor): `-> bb7` (pretty.rs:959)
    expect(term(k_call)).toBe("_0 = move _1() -> bb7");
    const k_drop: TerminatorKind = { $: "Drop", place: place(cx, 1), target: bb(1), unwind: cleanup(2), replace: false, drop: bb(3) };
    expect([...TK.successors(k_drop)]).toEqual([bb(1), bb(2), bb(3)]);
    expect(TK.fmt_successor_labels(k_drop)).toEqual(["return", "unwind", "drop"]);
    expect(TK.edges(k_drop)).toEqual({ $: "Double", _0: bb(1), _1: bb(2) });
    const k_ret_cont: TerminatorKind = { $: "Assert", cond: move(place(cx, 1)), expected: true, msg: { $: "NullPointerDereference" }, target: bb(4), unwind: UnwindAction.Continue };
    expect(term(k_ret_cont)).toBe('assert(move _1, "null pointer dereference occurred") -> [success: bb4, unwind continue]');
    // successors_mut writes back through the MutRef
    const sw: TerminatorKind = { $: "SwitchInt", discr: copy(place(cx, 1)), targets: SwitchTargets.new([[1n, bb(5)], [7n, bb(6)]], bb(8)) };
    TK.successors_mut(sw, (b) => (b.value = BasicBlock.from_u32(b.value + 10)));
    expect(term(sw)).toBe("switchInt(copy _1) -> [1: bb15, 7: bb16, otherwise: bb18]");
    const t = new Terminator(SI, sw);
    expect(t.identical_successor()).toBeUndefined();
    expect(new Terminator(SI, { $: "FalseEdge", real_target: bb(2), imaginary_target: bb(2) }).identical_successor()).toBe(bb(2));
    if (sw.$ !== "SwitchInt") throw new Error("unreachable");
    expect(sw.targets.target_for_value(7n)).toBe(bb(16));
    expect(sw.targets.target_for_value(9n)).toBe(bb(18));
    expect([...sw.targets.successors_for_value(1n)]).toEqual([bb(15)]);
    expect(sw.targets.as_static_if()).toBeUndefined();
    expect(SwitchTargets.static_if(0n, bb(1), bb(2)).as_static_if()).toEqual([0n, bb(1), bb(2)]);
    expect(sw.targets.is_distinct()).toBe(true);
  });
}, 120000);

test("StmtDebugInfos / make_nop / Place helpers", () => {
  with_fixture((cx) => {
    const s = Statement.new(SI, { $: "Assign", _0: [place(cx, 1), { $: "Ref", _0: cx.tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: place(cx, 2, [deref]) }] });
    s.make_nop(false);
    expect(debug_Statement(s, PLAIN)).toBe("nop");
    expect(s.debuginfos.as_slice().length).toBe(1);
    const a = new StmtDebugInfos(undefined);
    a.push({ $: "InvalidAssign", _0: L(3) });
    a.prepend(s.debuginfos);
    expect(a.as_slice().map((d) => d.$)).toEqual(["AssignRef", "InvalidAssign"]);
    expect(s.debuginfos.is_empty()).toBe(true);
    const p = place(cx, 2, [deref, field(1, cx.tcx.types.i32)]);
    expect(p.is_indirect()).toBe(true);
    expect(p.is_indirect_first_projection()).toBe(true);
    expect(p.local_or_deref_local()).toBeUndefined();
    expect(place(cx, 2, [deref]).local_or_deref_local()).toBe(L(2));
    expect(p.iter_projections().map(([base, e]) => `${debug_Place(base.to_place(cx.tcx), PLAIN)} ${e.$}`)).toEqual(["_2 Deref", "(*_2) Field"]);
    expect(place(cx, 2, [deref]).as_ref().is_prefix_of(p.as_ref())).toBe(true);
    expect(p.as_ref().is_prefix_of(place(cx, 2, [deref]).as_ref())).toBe(false);
    expect(debug_Operand(copy(p), PLAIN)).toBe("copy ((*_2).1: i32)");
    expect(debug_Rvalue({ $: "Use", _0: copy(p), _1: "No" }, PLAIN)).toBe("no_retag copy ((*_2).1: i32)");
  });
}, 120000);

