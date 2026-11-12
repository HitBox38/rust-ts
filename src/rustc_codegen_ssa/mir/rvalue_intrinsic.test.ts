// Unit tests of mir/rvalue.ts, mir/intrinsic.ts and mir/naked_asm.ts (lane ssa-rvalue-intrinsic), over a logging mock
// backend and the real layouts and MIR the port computes for small no_core crates. Upstream has no unit tests for these
// files.
//
// Where the expected values come from:
// 1. The source. Every expected call sequence is read off rvalue.rs / intrinsic.rs / naked_asm.rs at the pin (and the
//    operand.rs / place.rs / traits fns they call), cited per case.
// 2. The oracle. The pinned nightly's `-Copt-level=0 -Cno-prepopulate-passes --emit=llvm-ir` IR for
//    x86_64-unknown-linux-gnu of the same operations (a `#![no_std]` crate; facts quoted in `ORACLE_*` comments). The mock
//    sees the trait calls cg_ssa makes; the IR shows what the LLVM backend made of them, so each oracle fact pins the
//    *order and choice* of trait calls (e.g. `checked_binop(Add, i32)` → `@llvm.sadd.with.overflow.i32`).
//    naked_asm.rs is checked byte-for-byte: `codegen_naked_asm`'s template is compared with the oracle's `module asm`
//    lines for ELF (x86_64-unknown-linux-gnu) and Mach-O (the host).
//
// The mock: backend values and types are strings; a method the mock does not define logs `name(args)` and returns a
// fresh `%N`. Values named `%x:T` have backend type `T` (`val_ty`).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { Align, type Scalar as abi_Scalar, Size, type VariantIdx } from "../../rustc_abi/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import { type Body, type Local, type Operand, Place_from_Local, type Rvalue, SourceInfo } from "../../rustc_middle/mir/mod.ts";
import type { MonoItemData } from "../../rustc_middle/mono.ts";
import "../../rustc_middle/ty/consts.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { Const } from "../../rustc_type_ir/sty/consts.ts";
import { Panic, unwrap } from "../../std/panic.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { BackendTypes } from "../traits/backend.ts";
import { type BuilderMethods, BuilderMethods_provided } from "../traits/builder.ts";
import { DerivedTypeCodegenMethods_provided } from "../traits/type_.ts";
import { install_FunctionCx_intrinsic } from "./intrinsic.ts";
import { Locals } from "./locals.ts";
import { FunctionCx, type LocalRef } from "./mod.ts";
import { codegen_naked_asm } from "./naked_asm.ts";
import { OperandRef, type OperandValue } from "./operand.ts";
import { PlaceRef, PlaceValue } from "./place.ts";
import { install_FunctionCx_rvalue, transmute_scalar } from "./rvalue.ts";

// The installers are root's to call from mod.ts (handoff); calling them here again is idempotent.
install_FunctionCx_rvalue(FunctionCx);
install_FunctionCx_intrinsic(FunctionCx);

interface MockTypes extends BackendTypes {
  Value: string;
  Type: string;
  Function: string;
  BasicBlock: string;
  FunctionSignature: string;
}
type V = string;

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

const PRELUDE = [
  "#![feature(no_core, lang_items, intrinsics, rustc_attrs, decl_macro, fn_align)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
];

const SRC = [
  ...PRELUDE,
  "pub struct S { pub a: u8, pub b: u32, pub c: u16 }",
  '#[lang = "neg"] pub trait Neg { type Output; fn neg(self) -> Self::Output; }',
  "impl Neg for i8 { type Output = i8; fn neg(self) -> i8 { loop {} } }",
  '#[lang = "Ordering"] #[repr(i8)] pub enum Ordering { Less = -1, Equal = 0, Greater = 1 }',
  "#[rustc_intrinsic] pub unsafe fn copy<T>(src: *const T, dst: *mut T, count: usize);",
  "#[rustc_intrinsic] pub unsafe fn copy_nonoverlapping<T>(src: *const T, dst: *mut T, count: usize);",
  "#[rustc_intrinsic] pub const fn ctpop<T: Copy>(x: T) -> u32;",
  "#[rustc_intrinsic] pub const unsafe fn unreachable() -> !;",
  "#[rustc_intrinsic] pub const fn size_of<T>() -> usize;",
  "#[rustc_intrinsic] pub unsafe fn exact_div<T: Copy>(x: T, y: T) -> T;",
  "#[rustc_intrinsic] pub unsafe fn ptr_offset_from<T>(ptr: *const T, base: *const T) -> isize { 0 }",
  "#[rustc_intrinsic] pub unsafe fn typed_swap_nonoverlapping<T>(x: *mut T, y: *mut T);",
  // locals _1.._15
  "pub fn f(_a: i32, _b: i32, _c: u8, _d: f32, _e: f64, _p: *const u8, _w: *const [u8], _w2: *const [u8], _u: u32, _ch: char, _s: S, _q: u64, _r: &[u8; 4], _x: i8, _t: (u8, u32), _h: u16) {}",
  "pub fn g() { let _a = copy::<u32>; let _b = copy_nonoverlapping::<u32>; let _c = ctpop::<u32>; let _d = unreachable; let _e = size_of::<u32>; let _f = exact_div::<f32>; let _g = ptr_offset_from::<u32>; let _h = typed_swap_nonoverlapping::<u32>; }",
].join("\n");

/** Formats a mock call argument. */
function fmt_arg(a: unknown): string {
  if (a instanceof Align) return `align${a.bytes()}`;
  if (a instanceof Size) return `size${a.bytes()}`;
  if (a instanceof PlaceValue) return `place(${fmt_arg(a.llval)}, ${fmt_arg(a.llextra)}, ${fmt_arg(a.align)})`;
  if (a instanceof OperandRef) return `opref(${fmt_arg(a.val)}: ${display_Ty(a.layout.ty)})`;
  if (Array.isArray(a)) return `[${a.map(fmt_arg).join(", ")}]`;
  if (typeof a === "string" || typeof a === "number" || typeof a === "bigint" || typeof a === "boolean") return String(a);
  if (a === undefined) return "None";
  if (typeof a === "object" && a !== null && "$" in a) {
    const o = a as { $: string; _0?: unknown; _1?: unknown };
    if (o.$ === "Immediate") return `Imm(${fmt_arg(o._0)})`;
    if (o.$ === "Pair") return `Pair(${fmt_arg(o._0)}, ${fmt_arg(o._1)})`;
    return o.$;
  }
  if (typeof a === "object" && a !== null && "ty" in a && "layout" in a) return `layout:${display_Ty((a as TyAndLayout).ty)}`;
  if (typeof a === "object" && a !== null && "start" in a && "end" in a) return `range(${String((a as { start: bigint }).start)}..=${String((a as { end: bigint }).end)})`;
  return "<obj>";
}

/** A backend type name for a Rust type (readability only; the port passes these through). */
function llty(ty: Ty, memory: boolean): string {
  const s = display_Ty(ty);
  if (s === "bool") return memory ? "i8" : "i1";
  if (s === "u8" || s === "i8") return "i8";
  if (s === "u16" || s === "i16") return "i16";
  if (s === "u32" || s === "i32" || s === "char") return "i32";
  if (s === "u64" || s === "i64" || s === "usize" || s === "isize") return "i64";
  if (s === "f32") return "float";
  if (s === "f64") return "double";
  if (s.startsWith("*") || s.startsWith("&")) return "ptr";
  return `ty:${s}`;
}

function prim_ty(s: abi_Scalar): string {
  const p = s.value;
  if (p.$ === "Pointer") return "ptr";
  if (p.$ === "Float") return p._0 === "F32" ? "float" : p._0 === "F64" ? "double" : p._0;
  return { I8: "i8", I16: "i16", I32: "i32", I64: "i64", I128: "i128" }[p._0];
}

/** The logging mock builder (and its own `cx`). */
function mock_bx(tcx: TyCtxt): { bx: BuilderMethods<MockTypes>; log: string[] } {
  const log: string[] = [];
  let n = 0;
  const layout_of = (ty: Ty): TyAndLayout => {
    const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
    if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
    return r._0;
  };
  const own: Record<string, unknown> = {
    debug_Value: (v: V) => v,
    debug_Type: (v: V) => v,
    debug_Function: (v: V) => v,
    debug_FunctionSignature: (v: V) => v,
    tcx_: () => tcx,
    typing_env_: () => TypingEnv.fully_monomorphized(),
    layout_of,
    data_layout: () => tcx.data_layout(),
    sess: () => tcx.sess,
    const_usize: (i: bigint) => `usize ${i}`,
    const_uint_big: (t: string, i: bigint) => `${t} ${i}`,
    const_u8: (i: number) => `i8 ${i}`,
    const_to_opt_u128: (v: V) => (v.startsWith("i8 ") || v.startsWith("i32 ") ? BigInt(v.split(" ")[1]!) : undefined),
    immediate_backend_type: (l: TyAndLayout) => llty(l.ty, false),
    backend_type: (l: TyAndLayout) => llty(l.ty, true),
    type_i8: () => "i8",
    type_i16: () => "i16",
    type_i32: () => "i32",
    type_i64: () => "i64",
    type_i128: () => "i128",
    type_isize: () => "i64",
    type_from_scalar: (s: abi_Scalar) => prim_ty(s),
    val_ty: (v: V) => (v.includes(":") ? v.slice(v.lastIndexOf(":") + 1) : v.startsWith("i8 ") ? "i8" : "?"),
    type_kind: (t: string) => (t === "float" ? "Float" : t === "double" ? "Double" : t === "ptr" ? "Pointer" : t.startsWith("i") ? "Integer" : "Vector"),
    float_width: (t: string) => (t === "float" ? 32 : t === "double" ? 64 : 0),
    int_width: (t: string) => Number(t.slice(1)),
    // The provided method (traits/type_.rs:84), reached by base.rs `unsize_ptr`.
    type_is_sized: (ty: Ty) => DerivedTypeCodegenMethods_provided.type_is_sized(proxy as never, ty),
    const_poison: (t: string) => `poison:${t}`,
    const_undef: (t: string) => `undef:${t}`,
    from_immediate: (v: V) => v,
    to_immediate_scalar: (v: V) => v,
    load_operand: (place: PlaceRef<V>) => {
      log.push(`load_operand(${place.val.llval}, ${display_Ty(place.layout.ty)})`);
      return new OperandRef<V>({ $: "Immediate", _0: `load(${place.val.llval})` }, place.layout, undefined);
    },
    // The provided method, so the test shows the saturating choice (`fptosi_sat`/`fptoui_sat`).
    cast_float_to_int: (signed: boolean, x: V, dest_ty: V) => BuilderMethods_provided.cast_float_to_int(proxy, signed, x, dest_ty),
    // The backend's `IntrinsicCallBuilderMethods::codegen_intrinsic_call` (cg-intrinsic-a): records the forward.
    codegen_intrinsic_call: (instance: Instance, args: readonly OperandRef<V>[], result_layout: TyAndLayout, result_place: unknown, _span: unknown) => {
      log.push(`backend.codegen_intrinsic_call(${tcx.def_path_str(Instance.def_id(instance))}, [${args.map(fmt_arg).join(", ")}], ${display_Ty(result_layout.ty)}, ${fmt_arg(result_place)})`);
      return { $: "Operand", _0: { $: "Immediate", _0: "%bk" } };
    },
  };
  const proxy: BuilderMethods<MockTypes> = new Proxy(own, {
    get(target, prop) {
      if (prop === "cx") return () => proxy;
      if (typeof prop === "string" && prop in target) return target[prop];
      if (typeof prop !== "string" || prop === "then" || prop === "__backend_types") return undefined;
      return (...args: unknown[]) => {
        const r = `%${n++}`;
        log.push(`${r} = ${prop}(${args.map(fmt_arg).join(", ")})`);
        return r;
      };
    },
  }) as unknown as BuilderMethods<MockTypes>;
  return { bx: proxy, log };
}

/** Compiles `src` to `analysis` and calls `f` with each fn body named in `names`. */
function with_tcx(name: string, src: string, extra: string[], names: string[], f: (tcx: TyCtxt, bodies: Map<string, [LocalDefId, Body]>) => void): void {
  const file = join(DATA, "tmp", "ssa-rvalue-intrinsic", `${name}.rs`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, src);
  let ran = false;
  // The deliberate `bug!`/error checks leave errors in the session's DiagCtxt, so the compiler aborts once the closure
  // is done; that abort is expected only after every check has run.
  try {
    run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", ...extra, file]), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        const bodies = new Map<string, [LocalDefId, Body]>();
        for (const def of tcx.mir_keys(null)) {
          const p = tcx.def_path_str(LocalDefId.to_def_id(def));
          if (names.includes(p)) bodies.set(p, [def, tcx.mir_built(def).borrow()]);
        }
        f(tcx, bodies);
        ran = true;
      });
    });
  } catch (e) {
    if (!ran) throw e;
  }
  expect(ran).toBe(true);
}

/** Runs `f` and returns its panic / ICE / unported message (or `undefined` if it returned). */
function stops(f: () => void): string | undefined {
  try {
    f();
    return undefined;
  } catch (e) {
    if (e instanceof Panic || e instanceof Error) return e.message;
    return String(e);
  }
}

const copy_ = (local: number): Operand => ({ $: "Copy", _0: Place_from_Local(local as Local) });

test("rvalue.rs / intrinsic.rs over a mock backend", () => {
  with_tcx("ops", SRC, [], ["f", "g"], (tcx, bodies) => {
    const [f_def, f_body] = bodies.get("f")!;
    const [, g_body] = bodies.get("g")!;
    const layout = (ty: Ty) => {
      const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty));
      if (r.$ !== "Ok") throw new Error("ERROR: layout_of failed");
      return r._0;
    };
    const decl_ty = (i: number) => f_body.local_decls[i]!.ty;

    // A `FunctionCx` over `f`'s MIR whose argument locals are operands (`%name:llty`), `_s` (Memory) a place.
    const names = ["", "a", "b", "c", "d", "e", "p", "w", "w2", "u", "ch", "s", "q", "r", "x", "t", "h"];
    const new_fx = (bx: BuilderMethods<MockTypes>): FunctionCx<MockTypes> => {
      const values: LocalRef<V>[] = f_body.local_decls.map((d, i) => {
        const l = layout(d.ty);
        if (i === 0) return { $: "Operand", _0: OperandRef.zero_sized<V>(l) };
        const nm = names[i]!;
        const repr = l.backend_repr;
        if (repr.$ === "Scalar") return { $: "Operand", _0: new OperandRef<V>({ $: "Immediate", _0: `%${nm}:${llty(d.ty, false)}` }, l, undefined) };
        if (repr.$ === "ScalarPair") {
          return { $: "Operand", _0: new OperandRef<V>({ $: "Pair", _0: `%${nm}.0:${prim_ty(repr.a)}`, _1: `%${nm}.1:${prim_ty(repr.b)}` }, l, undefined) };
        }
        return { $: "Place", _0: PlaceRef.new_sized<V>(`%${nm}`, l) };
      });
      const fx = Object.create(FunctionCx.prototype) as FunctionCx<MockTypes>;
      Object.assign(fx, { instance: Instance.mono(tcx, LocalDefId.to_def_id(f_def)), mir: f_body, cx: bx, locals: new Locals<V>(values) });
      return fx;
    };
    const run = (rv: Rvalue): { op: OperandRef<V>; log: string[] } => {
      const { bx, log } = mock_bx(tcx);
      const op = new_fx(bx).codegen_rvalue_operand(bx, rv);
      return { op, log };
    };
    const val = (v: OperandValue<V>) => fmt_arg(v);
    const with_opt = <T>(f: () => T): T => {
      const saved = tcx.sess.opts.optimize;
      tcx.sess.opts.optimize = "More";
      try {
        return f();
      } finally {
        tcx.sess.opts.optimize = saved;
      }
    };

    const types = tcx.types;
    const ptr_u32 = Ty.new_ptr(tcx, types.u32, "Not");
    const ptr_u8 = Ty.new_ptr(tcx, types.u8, "Not");

    // ---- checked binops: rvalue.rs:665 (`BinaryOp` with `overflowing_to_wrapping`) → codegen_scalar_checked_binop
    // (rvalue.rs:1056): `checked_binop(oop, input_ty, lhs, rhs)`, result `Pair(val, of)` with layout `(T, bool)`.
    {
      const { op, log } = run({ $: "BinaryOp", _0: "AddWithOverflow", _1: [copy_(1), copy_(2)] });
      // ORACLE_add_ov: `call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %a, i32 %b)` (signed from the input type).
      expect(log).toEqual(["%0 = checked_binop(Add, <obj>, %a:i32, %b:i32)"]);
      // `checked_binop` returns `(val, of)`; the mock's one fresh value stands for the pair, so both slots are `%0`.
      expect([op.val.$, display_Ty(op.layout.ty)]).toEqual(["Pair", "(i32, bool)"]);
    }
    {
      const { op, log } = run({ $: "BinaryOp", _0: "MulWithOverflow", _1: [copy_(3), copy_(3)] });
      // ORACLE_mul_ov: `call { i8, i1 } @llvm.umul.with.overflow.i8(i8 %a, i8 %b)`.
      expect(log).toEqual(["%0 = checked_binop(Mul, <obj>, %c:i8, %c:i8)"]);
      expect(display_Ty(op.layout.ty)).toBe("(u8, bool)");
    }
    {
      const { bx } = mock_bx(tcx);
      // codegen_scalar_checked_binop's `bug!` for a non-checkable operator (rvalue.rs:1077).
      expect(stops(() => new_fx(bx).codegen_scalar_checked_binop(bx, "Div", "%a", "%b", types.i32))).toContain("Operator `Div` is not a checkable operator");
      // codegen_scalar_binop's `bug!` for the overflowing ops (rvalue.rs:1006).
      expect(stops(() => new_fx(bx).codegen_scalar_binop(bx, "AddWithOverflow", "%a", "%b", types.i32, types.i32))).toContain(
        "AddWithOverflow needs to return a pair, so call codegen_scalar_checked_binop instead",
      );
    }

    // ---- plain binops: rvalue.rs:688 → codegen_scalar_binop (rvalue.rs:889), per (op, float, signed).
    {
      const cases: [Rvalue, string, string][] = [
        [{ $: "BinaryOp", _0: "Add", _1: [copy_(1), copy_(2)] }, "add(%a:i32, %b:i32)", "i32"],
        [{ $: "BinaryOp", _0: "Add", _1: [copy_(4), copy_(4)] }, "fadd(%d:float, %d:float)", "f32"],
        [{ $: "BinaryOp", _0: "Div", _1: [copy_(1), copy_(2)] }, "sdiv(%a:i32, %b:i32)", "i32"],
        [{ $: "BinaryOp", _0: "Div", _1: [copy_(9), copy_(9)] }, "udiv(%u:i32, %u:i32)", "u32"],
        [{ $: "BinaryOp", _0: "Rem", _1: [copy_(5), copy_(5)] }, "frem(%e:double, %e:double)", "f64"],
        [{ $: "BinaryOp", _0: "SubUnchecked", _1: [copy_(1), copy_(2)] }, "unchecked_ssub(%a:i32, %b:i32)", "i32"],
        [{ $: "BinaryOp", _0: "MulUnchecked", _1: [copy_(9), copy_(9)] }, "unchecked_umul(%u:i32, %u:i32)", "u32"],
        [{ $: "BinaryOp", _0: "BitXor", _1: [copy_(3), copy_(3)] }, "xor(%c:i8, %c:i8)", "u8"],
        [{ $: "BinaryOp", _0: "Lt", _1: [copy_(1), copy_(2)] }, "icmp(IntSLT, %a:i32, %b:i32)", "bool"],
        [{ $: "BinaryOp", _0: "Lt", _1: [copy_(9), copy_(9)] }, "icmp(IntULT, %u:i32, %u:i32)", "bool"],
        [{ $: "BinaryOp", _0: "Ge", _1: [copy_(4), copy_(4)] }, "fcmp(RealOGE, %d:float, %d:float)", "bool"],
        [{ $: "BinaryOp", _0: "Cmp", _1: [copy_(1), copy_(2)] }, "three_way_compare(<obj>, %a:i32, %b:i32)", "Ordering"],
      ];
      for (const [rv, call, ty] of cases) {
        const { op, log } = run(rv);
        expect(log).toEqual([`%0 = ${call}`]);
        expect(op.val).toEqual({ $: "Immediate", _0: "%0" });
        if (ty !== "Ordering") expect(display_Ty(op.layout.ty)).toBe(ty);
      }
      // `Offset` (rvalue.rs:963): `inbounds_nuw_gep(backend_type(pointee), lhs, [rhs])` for an unsigned offset.
      const { bx, log } = mock_bx(tcx);
      expect(new_fx(bx).codegen_scalar_binop(bx, "Offset", "%p:ptr", "%n:i64", ptr_u32, types.usize)).toBe("%0");
      expect(new_fx(bx).codegen_scalar_binop(bx, "Offset", "%p:ptr", "%n:i64", ptr_u32, types.isize)).toBe("%1");
      expect(log).toEqual(["%0 = inbounds_nuw_gep(i32, %p:ptr, [%n:i64])", "%1 = inbounds_gep(i32, %p:ptr, [%n:i64])"]);
      // A shift goes through `base::build_shift_expr_rhs` (ssa-base, ported; root at integ-w54).
      // base.rs:334: `shift_mask_val` (an Integer: `const_uint(i32, 32 - 1)`), `and` (not unchecked), equal widths: no
      // cast; then rvalue.rs's `shl`.
      log.length = 0;
      expect(new_fx(bx).codegen_scalar_binop(bx, "Shl", "%a:i32", "%b:i32", types.i32, types.i32)).toBe("%4");
      expect(log).toEqual(["%2 = const_uint(i32, 31)", "%3 = and(%b:i32, %2)", "%4 = shl(%a:i32, %3)"]);
    }

    // ---- wide-pointer binop (rvalue.rs:1014): `Lt` = `icmp ULT addr | (icmp EQ addr & icmp ULT extra)`.
    {
      const { op, log } = run({ $: "BinaryOp", _0: "Lt", _1: [copy_(7), copy_(8)] });
      // ORACLE_wide_lt: `icmp ult ptr %a.0, %b.0` / `icmp eq ptr %a.0, %b.0` / `icmp ult i64 %a.1, %b.1` / `and` / `or`.
      expect(log).toEqual([
        "%0 = icmp(IntULT, %w.0:ptr, %w2.0:ptr)",
        "%1 = icmp(IntEQ, %w.0:ptr, %w2.0:ptr)",
        "%2 = icmp(IntULT, %w.1:i64, %w2.1:i64)",
        "%3 = and(%1, %2)",
        "%4 = or(%0, %3)",
      ]);
      expect(op.val).toEqual({ $: "Immediate", _0: "%4" });
      const eq = run({ $: "BinaryOp", _0: "Eq", _1: [copy_(7), copy_(8)] });
      expect(eq.log).toEqual(["%0 = icmp(IntEQ, %w.0:ptr, %w2.0:ptr)", "%1 = icmp(IntEQ, %w.1:i64, %w2.1:i64)", "%2 = and(%0, %1)"]);
    }

    // ---- unary ops (rvalue.rs:722).
    {
      // ORACLE_not_i: `xor i32 %a, -1` (cg_llvm's `not`); ORACLE_neg_f: `fneg float %a`.
      expect(run({ $: "UnaryOp", _0: "Not", _1: copy_(9) }).log).toEqual(["%0 = not(%u:i32)"]);
      expect(run({ $: "UnaryOp", _0: "Neg", _1: copy_(4) }).log).toEqual(["%0 = fneg(%d:float)"]);
      expect(run({ $: "UnaryOp", _0: "Neg", _1: copy_(1) }).log).toEqual(["%0 = neg(%a:i32)"]);
      // PtrMetadata of a wide pointer: the pair's second value, typed as field 1 (usize); no builder call.
      // ORACLE_meta: `ret i64 %ptr.1`.
      const m = run({ $: "UnaryOp", _0: "PtrMetadata", _1: copy_(7) });
      expect([m.log, val(m.op.val), display_Ty(m.op.layout.ty)]).toEqual([[], "Imm(%w.1:i64)", "usize"]);
      // Of a thin pointer: ZeroSized `()`.
      const t = run({ $: "UnaryOp", _0: "PtrMetadata", _1: copy_(6) });
      expect([t.log, val(t.op.val), display_Ty(t.op.layout.ty)]).toEqual([[], "ZeroSized", "()"]);
    }

    // ---- casts: rvalue.rs:501 → cast_immediate (rvalue.rs:449). At -O0 `assume_scalar_range` returns at once.
    {
      const cast = (kind: string, local: number, ty: Ty) => run({ $: "Cast", _0: { $: kind } as never, _1: copy_(local), _2: ty });
      // ORACLE_trunc `trunc i32 %a to i8`, ORACLE_sext `sext i8 %a to i64`: both cg_llvm's `intcast(.., is_signed)`.
      expect(cast("IntToInt", 1, types.u8).log).toEqual(["%0 = intcast(%a:i32, i8, true)"]);
      expect(cast("IntToInt", 14, types.i64).log).toEqual(["%0 = intcast(%x:i8, i64, true)"]);
      expect(cast("IntToInt", 3, types.i64).log).toEqual(["%0 = intcast(%c:i8, i64, false)"]);
      // ORACLE_i2f `sitofp i32 %a to double`, ORACLE_u2f `uitofp i32 %a to float`.
      expect(cast("IntToFloat", 1, types.f64).log).toEqual(["%0 = sitofp(%a:i32, double)"]);
      expect(cast("IntToFloat", 9, types.f32).log).toEqual(["%0 = uitofp(%u:i32, float)"]);
      // Float → int saturates: `cast_float_to_int` (provided, builder.rs) → `fptosi_sat`/`fptoui_sat`.
      // ORACLE_f2i `call i32 @llvm.fptosi.sat.i32.f32(float %a)`, ORACLE_f2u `call i8 @llvm.fptoui.sat.i8.f64(double %a)`.
      expect(cast("FloatToInt", 4, types.i32).log).toEqual(["%0 = fptosi_sat(%d:float, i32)"]);
      expect(cast("FloatToInt", 5, types.u8).log).toEqual(["%0 = fptoui_sat(%e:double, i8)"]);
      // ORACLE_fext `fpext float %a to double`, ORACLE_ftrunc `fptrunc double %a to float`; same width: no call.
      expect(cast("FloatToFloat", 4, types.f64).log).toEqual(["%0 = fpext(%d:float, double)"]);
      expect(cast("FloatToFloat", 5, types.f32).log).toEqual(["%0 = fptrunc(%e:double, float)"]);
      const same = cast("FloatToFloat", 4, types.f32);
      expect([same.log, val(same.op.val)]).toEqual([[], "Imm(%d:float)"]);
      // Pointer casts. Thin → thin: `pointercast` (ORACLE_p2p: no instruction; opaque pointers make it a no-op).
      expect(cast("PtrToPtr", 6, ptr_u32).log).toEqual(["%0 = pointercast(%p:ptr, ptr)"]);
      // Wide → thin keeps the data pointer; wide → wide keeps the pair (ORACLE_thin: `ret ptr %a.0`).
      const thin = cast("PtrToPtr", 7, ptr_u8);
      expect([thin.log, val(thin.op.val)]).toEqual([[], "Imm(%w.0:ptr)"]);
      const wide = cast("PtrToPtr", 7, decl_ty(8));
      expect([wide.log, val(wide.op.val)]).toEqual([[], "Pair(%w.0:ptr, %w.1:i64)"]);
      // ORACLE_expose `ptrtoint ptr %a to i64`; ORACLE_from_addr `zext i16 %a to i64` + `inttoptr`.
      expect(cast("PointerExposeProvenance", 6, types.usize).log).toEqual(["%0 = ptrtoint(%p:ptr, i64)"]);
      expect(cast("PointerWithExposedProvenance", 3, ptr_u8).log).toEqual(["%0 = intcast(%c:i8, i64, false)", "%1 = inttoptr(%0, ptr)"]);
      // Unsizing `&[u8; 4]` → `&[u8]` in operand form: base.rs:225 `unsize_ptr` (ssa-base, ported; root at integ-w54), the
      // `Ref`/`Ref` arm: `(src, unsized_info(..))`, and base.rs `unsized_info`'s `Array`/`Slice` arm is `const_usize(4)`.
      // No backend instruction.
      const unsize = () => {
        const { bx, log } = mock_bx(tcx);
        const op = new_fx(bx).codegen_rvalue_operand(bx, {
          $: "Cast",
          _0: { $: "PointerCoercion", _0: { $: "Unsize" }, _1: "Implicit" } as never,
          _1: copy_(13),
          _2: Ty.new_ref(tcx, tcx.lifetimes.re_erased, Ty.new_slice(tcx, types.u8), "Not"),
        });
        return { op, log };
      };
      {
        const u = unsize();
        expect([val(u.op.val), display_Ty(u.op.layout.ty), u.log]).toEqual(["Pair(%r:ptr, usize 4)", "&[u8]", []]);
      }
      // `MutToConstPointer` is borrowck-only (rvalue.rs:573).
      const m2c = (): void => {
        const { bx } = mock_bx(tcx);
        new_fx(bx).codegen_rvalue_operand(bx, { $: "Cast", _0: { $: "PointerCoercion", _0: { $: "MutToConstPointer" }, _1: "Implicit" } as never, _1: copy_(6), _2: ptr_u8 });
      };
      expect(stops(m2c)).toContain("is for borrowck, and should never appear in codegen");
    }

    // ---- -O: `assume_scalar_range` (rvalue.rs:1164) assumes the *input* range in `cast_immediate`, unless always valid.
    with_opt(() => {
      const c = run({ $: "Cast", _0: { $: "IntToInt" }, _1: copy_(10), _2: types.u32 });
      // char's valid range 0..=0x10FFFF is not always valid → assume it, then the cast.
      expect(c.log).toEqual(["%0 = assume_integer_range(%ch:i32, i32, range(0..=1114111))", "%1 = intcast(%ch:i32, i32, false)"]);
      const u = run({ $: "Cast", _0: { $: "IntToInt" }, _1: copy_(9), _2: types.u8 });
      expect(u.log).toEqual(["%0 = intcast(%u:i32, i8, false)"]);
    });

    // ---- transmutes: rvalue.rs:588 `Transmute` → codegen_transmute_operand (rvalue.rs:335).
    {
      // u32 → f32, Scalar → Scalar of one size: `transmute_scalar` (rvalue.rs:1089). At -O0: no assumes; Int → Float is
      // `bitcast`. ORACLE_tm: `bitcast i32 %a to float`.
      const t = run({ $: "Cast", _0: { $: "Transmute" }, _1: copy_(9), _2: types.f32 });
      expect([t.log, val(t.op.val)]).toEqual([["%0 = bitcast(%u:i32, float)"], "Imm(%0)"]);
      // Same layout (`Layout` interned): the value unchanged, no call.
      const same = run({ $: "Cast", _0: { $: "Transmute" }, _1: copy_(9), _2: types.u32 });
      expect([same.log, val(same.op.val)]).toEqual([[], "Imm(%u:i32)"]);
      // Different sizes are UB: `unreachable_nonterminator`, then `OperandValue::poison` (operand.rs:980).
      const ub = run({ $: "Cast", _0: { $: "Transmute" }, _1: copy_(9), _2: types.u64 });
      expect([ub.log, val(ub.op.val)]).toEqual([["%0 = unreachable_nonterminator()"], "Imm(poison:i64)"]);
      // u64 → (u32, u32): Scalar → ScalarPair takes the temporary: `PlaceValue::alloca` (place.rs) then lifetime
      // markers around a store of the operand and a `load_operand` of the cast type.
      const pair_ty = Ty.new_tup(tcx, [types.u32, types.u32]);
      const tp = run({ $: "Cast", _0: { $: "Transmute" }, _1: copy_(12), _2: pair_ty });
      expect(tp.log).toEqual([
        "%0 = alloca(size8, align8)",
        "%1 = lifetime_start(%0, size8)",
        "%2 = store_with_flags(%q:i64, %0, align8, 0)",
        "load_operand(%0, (u32, u32))",
        "%3 = lifetime_end(%0, size8)",
      ]);
      expect(val(tp.op.val)).toBe("Imm(load(%0))");
      // At -O, transmute_scalar assumes ranges: u32 → char assumes char's range on the *output* only (the input range,
      // all of u32, contains char's, so the first assume is skipped; rvalue.rs:1176).
      with_opt(() => {
        const { bx, log } = mock_bx(tcx);
        const [u, ch] = [layout(types.u32).backend_repr, layout(types.char).backend_repr];
        if (u.$ !== "Scalar" || ch.$ !== "Scalar") throw new Error("ERROR: scalar");
        expect(transmute_scalar(bx, "%u:i32", u._0, ch._0)).toBe("%0");
        expect(log).toEqual(["%0 = bitcast(%u:i32, i32)", "%1 = assume_integer_range(%0, i32, range(0..=1114111))"]);
        // The same scalar on both sides returns `imm` untouched.
        expect(transmute_scalar(bx, "%u:i32", u._0, u._0)).toBe("%u:i32");
      });
    }

    // ---- aggregates.
    {
      // Operand form (rvalue.rs:811): `(u8, u32)` from two operands → OperandRefBuilder → `Pair`. No builder call.
      // ORACLE_pair: the two `insertvalue`s come from returning the pair (block.rs), not from building it.
      // `insert_field` calls rvalue.rs `transmute_scalar` (operand.ts imports this lane's export; root at integ-w54):
      // the pair is built with no call.
      const t = run({ $: "Aggregate", _0: { $: "Tuple" }, _1: [copy_(3), copy_(9)] });
      expect([t.log, val(t.op.val), display_Ty(t.op.layout.ty)]).toEqual([[], "Pair(%c:i8, %u:i32)", "(u8, u32)"]);

      // Place form (rvalue.rs:255) of `S { a, b, c }` (Memory, size 8; port layout: b@0, c@4, a@6):
      // try_codegen_const_aggregate_as_immediate gives up at the first non-constant field; then per field
      // `project_field` (`inbounds_ptradd` only at a nonzero offset) + `store_with_flags`; `codegen_set_discr` on a
      // single-variant struct emits nothing. The operands match the field types: `a: u8` ← `_c`, `b: u32` ← `_u`,
      // `c: u16` ← `_h` (review ssa-rvalue-intrinsic N3).
      const s_ty = decl_ty(11);
      const k = s_ty.kind();
      if (k.$ !== "Adt") throw new Error("ERROR: S is not an ADT");
      const { bx, log } = mock_bx(tcx);
      const dest = PlaceRef.new_sized<V>("%dst", layout(s_ty));
      new_fx(bx).codegen_rvalue(bx, dest, {
        $: "Aggregate",
        _0: { $: "Adt", _0: k._0.did(), _1: 0 as VariantIdx, _2: RawList.empty(), _3: undefined, _4: undefined },
        _1: [copy_(3), copy_(9), copy_(16)],
      });
      expect(log).toEqual([
        "%0 = inbounds_ptradd(%dst, usize 6)",
        "%1 = store_with_flags(%c:i8, %0, align2, 0)",
        "%2 = store_with_flags(%u:i32, %dst, align4, 0)",
        "%3 = inbounds_ptradd(%dst, usize 4)",
        "%4 = store_with_flags(%h:i16, %3, align4, 0)",
      ]);
    }

    // ---- Repeat (rvalue.rs:183) into `[u8; 4]` / `[u32; 4]` places.
    {
      const four = Const.from_target_usize(tcx, 4);
      const arr_u8 = layout(Ty.new_array_with_const_len(tcx, types.u8, four));
      const arr_u32 = layout(Ty.new_array_with_const_len(tcx, types.u32, four));
      // A non-constant `u8`: `from_immediate`, `val_ty == i8` → one `memset` of the whole array.
      let m = mock_bx(tcx);
      new_fx(m.bx).codegen_rvalue(m.bx, PlaceRef.new_sized<V>("%arr", arr_u8), { $: "Repeat", _0: copy_(3), _1: four });
      expect(m.log).toEqual(["%0 = memset(%arr, %c:i8, usize 4, align1, 0)"]);
      // A non-constant `u32`: no memset; `write_operand_repeatedly(elem, 4, dest)`.
      m = mock_bx(tcx);
      new_fx(m.bx).codegen_rvalue(m.bx, PlaceRef.new_sized<V>("%arr", arr_u32), { $: "Repeat", _0: copy_(9), _1: four });
      expect(m.log).toEqual(["%0 = write_operand_repeatedly(opref(Imm(%u:i32): u32), 4, <obj>)"]);
    }

    // ---- Use (rvalue.rs:107) of a scalar: `store_with_annotation_and_flags` with empty flags.
    {
      const { bx, log } = mock_bx(tcx);
      new_fx(bx).codegen_rvalue(bx, PlaceRef.new_sized<V>("%d", layout(types.i32)), { $: "Use", _0: copy_(1), _1: "No" });
      expect(log).toEqual(["%0 = store_with_flags(%a:i32, %d, align4, 0)"]);
      // A constant operand reaches constant.rs `eval_mir_constant` (ssa-mir-rest, ported; root at integ-w54): this check
      // asserted the old stub's stop and is gone; constant.rs is covered by mir_rest.test.ts.
    }

    // ---- intrinsics: intrinsic.rs:57 codegen_intrinsic_call. The instances are `g`'s fn-item locals.
    {
      const inst = new Map<string, Instance>();
      for (const d of g_body.local_decls) {
        const k = d.ty.kind();
        if (k.$ === "FnDef") inst.set(tcx.def_path_str(k._0), Instance.new_raw(k._0, unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs))));
      }
      const si = SourceInfo.outermost(DUMMY_SP);
      const call = (name: string, args: OperandRef<V>[], ret: Ty) => {
        const { bx, log } = mock_bx(tcx);
        const r = new_fx(bx).codegen_intrinsic_call(bx, inst.get(name)!, args, layout(ret), undefined, si);
        return { r, log };
      };
      const imm = (v: string, ty: Ty) => new OperandRef<V>({ $: "Immediate", _0: v }, layout(ty), undefined);
      const [s, d, n] = [imm("%s:ptr", ptr_u32), imm("%d:ptr", Ty.new_ptr(tcx, types.u32, "Mut")), imm("%n:i64", types.usize)];

      // `copy::<u32>(src, dst, count)` → copy_intrinsic(allow_overlap = true, volatile = false, ty, dst = args[1],
      // src = args[0], count = args[2]): `unchecked_sumul(const_usize(4), count)`, `memmove(dst, 4, src, 4, size, 0)`.
      // ORACLE_cp: `%0 = mul nuw nsw i64 4, %n` / `@llvm.memmove.p0.p0.i64(ptr align 4 %d, ptr align 4 %s, i64 %0, i1 false)`.
      let c = call("copy", [s, d, n], types.unit);
      expect(c.log).toEqual(["%0 = unchecked_sumul(usize 4, %n:i64)", "%1 = memmove(%d:ptr, align4, %s:ptr, align4, %0, 0)"]);
      expect(c.r).toEqual({ $: "Operand", _0: { $: "ZeroSized" } });

      // `copy_nonoverlapping` is lowered to `StatementKind::Intrinsic` by MIR building; when it reaches
      // codegen_intrinsic_call it is not in the match, so it goes to the backend's `codegen_intrinsic_call`, as `ctpop`
      // (ORACLE_ctp: `call i32 @llvm.ctpop.i32(i32 %x)`, made by cg_llvm) and the nullary `unreachable` do.
      c = call("copy_nonoverlapping", [s, d, n], types.unit);
      expect(c.log).toEqual(["backend.codegen_intrinsic_call(copy_nonoverlapping, [opref(Imm(%s:ptr): *const u32), opref(Imm(%d:ptr): *mut u32), opref(Imm(%n:i64): usize)], (), None)"]);
      c = call("ctpop", [imm("%x:i32", types.u32)], types.u32);
      expect(c.log).toEqual(["backend.codegen_intrinsic_call(ctpop, [opref(Imm(%x:i32): u32)], u32, None)"]);
      expect(c.r).toEqual({ $: "Operand", _0: { $: "Immediate", _0: "%bk" } });
      c = call("unreachable", [], types.never);
      expect(c.log).toEqual(["backend.codegen_intrinsic_call(unreachable, [], !, None)"]);

      // `size_of` takes no arguments and is not in the nullary allowlist: the `span_bug!` (intrinsic.rs:131).
      expect(stops(() => call("size_of", [], types.usize))).toContain("Nullary intrinsic size_of must be called in a const block.");

      // `ptr_offset_from::<u32>`: ptrtoint both, `sub`, `exactsdiv(d, const_usize(4))`.
      // ORACLE_off: `ptrtoint` ×2 / `sub i64 %0, %1` / `sdiv exact i64 %2, 4`.
      c = call("ptr_offset_from", [imm("%a:ptr", ptr_u32), imm("%b:ptr", ptr_u32)], types.isize);
      expect(c.log).toEqual(["%0 = ptrtoint(%a:ptr, i64)", "%1 = ptrtoint(%b:ptr, i64)", "%2 = sub(%0, %1)", "%3 = exactsdiv(%2, usize 4)"]);
      expect(c.r).toEqual({ $: "Operand", _0: { $: "Immediate", _0: "%3" } });

      // `-Zforce-intrinsic-fallback`: `ptr_offset_from` has a fallback body (`must_be_overridden` false) → `Fallback`.
      tcx.sess.opts.unstable_opts.force_intrinsic_fallback = true;
      try {
        c = call("ptr_offset_from", [imm("%a:ptr", ptr_u32), imm("%b:ptr", ptr_u32)], types.isize);
        expect(c.log).toEqual([]);
        expect(c.r.$).toBe("Fallback");
        // `ctpop` has no body (`must_be_overridden`): not a fallback.
        c = call("ctpop", [imm("%x:i32", types.u32)], types.u32);
        expect(c.r.$).toBe("Operand");
      } finally {
        tcx.sess.opts.unstable_opts.force_intrinsic_fallback = false;
      }

      // `typed_swap_nonoverlapping::<u32>` at -O0: `typed_place_swap` of the two derefs (align 4).
      c = call("typed_swap_nonoverlapping", [imm("%x:ptr", Ty.new_ptr(tcx, types.u32, "Mut")), imm("%y:ptr", Ty.new_ptr(tcx, types.u32, "Mut"))], types.unit);
      expect(c.log).toEqual(["%0 = typed_place_swap(place(%x:ptr, None, align4), place(%y:ptr, None, align4), layout:u32)"]);

      // `exact_div::<f32>`: not an integer → emits `InvalidMonomorphization::BasicIntegerType`, returns `Err`.
      c = call("exact_div", [imm("%d:float", types.f32), imm("%d:float", types.f32)], types.f32);
      expect([c.log, c.r.$]).toEqual([[], "Err"]);
    }
  });
});

// ---- naked_asm.rs: `codegen_naked_asm`'s template vs the oracle's `module asm` ------------------------------------
const NAKED_SRC = [
  ...PRELUDE,
  '#[rustc_builtin_macro] pub macro naked_asm("assembly template", $(operands,)* $(options($(option),*))?) { /* compiler built-in */ }',
  '#[unsafe(naked)] #[unsafe(no_mangle)] pub extern "C" fn nk() { naked_asm!("ret") }',
  '#[unsafe(naked)] #[unsafe(no_mangle)] #[rustc_align(16)] pub extern "C" fn nk_al() { naked_asm!("ret") }',
].join("\n");

/** The template pieces a backend joins into module asm lines (cg_llvm adds `.intel_syntax`/`.att_syntax` around). */
function naked_lines(tcx: TyCtxt, bodies: Map<string, [LocalDefId, Body]>, fn: string, mangled: string): string[] {
  let captured: string[] | undefined;
  const cx = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      switch (prop) {
        case "tcx_":
          return () => tcx;
        case "typing_env_":
          return () => TypingEnv.fully_monomorphized();
        case "mangled_name":
          return () => mangled;
        // Only the wasm arm reads the `FnAbi` (`wasm_functype`); these targets never do.
        case "fn_abi_of_instance":
          return () => undefined;
        case "codegen_global_asm":
          return (template: { $: string; _0?: string }[]) => {
            captured = template.map((p) => (p.$ === "String" ? p._0! : `{${p.$}}`));
          };
        default:
          return undefined;
      }
    },
  });
  const [def] = bodies.get(fn)!;
  const item_data: MonoItemData = { inlined: false, linkage: "External", visibility: "Default", size_estimate: 0 };
  codegen_naked_asm(cx as never, Instance.mono(tcx, LocalDefId.to_def_id(def)), item_data);
  if (captured === undefined) throw new Error("ERROR: codegen_global_asm not called");
  return captured.join("").split("\n");
}

test("naked_asm.rs: ELF prefix/suffix = oracle module asm (x86_64-unknown-linux-gnu)", () => {
  with_tcx("naked_elf", NAKED_SRC, ["--target", "x86_64-unknown-linux-gnu"], ["nk", "nk_al"], (tcx, bodies) => {
    // ORACLE (naked.rs, x86_64-unknown-linux-gnu, -Copt-level=0): the `module asm` lines between `.intel_syntax` and
    // `.att_syntax` for each function.
    expect(naked_lines(tcx, bodies, "nk", "nk")).toEqual([
      '.pushsection .text.nk,"ax", @progbits',
      ".balign 4",
      ".globl nk",
      ".type nk, @function",
      "nk:",
      "ret",
      ".Lfunc_end_nk:",
      ".size nk, . - nk",
      ".popsection",
      "",
    ]);
    expect(naked_lines(tcx, bodies, "nk_al", "nk_al")).toEqual([
      '.pushsection .text.nk_al,"ax", @progbits',
      ".balign 16",
      ".globl nk_al",
      ".type nk_al, @function",
      "nk_al:",
      "ret",
      ".Lfunc_end_nk_al:",
      ".size nk_al, . - nk_al",
      ".popsection",
      "",
    ]);
  });
});

test("naked_asm.rs: Mach-O prefix/suffix = oracle module asm (aarch64-apple-darwin)", () => {
  with_tcx("naked_macho", NAKED_SRC, ["--target", "aarch64-apple-darwin"], ["nk", "nk_al"], (tcx, bodies) => {
    // ORACLE (naked.rs, aarch64-apple-darwin, -Copt-level=0): `mangled_name` carries the `_` prefix.
    expect(naked_lines(tcx, bodies, "nk", "_nk")).toEqual([".section __TEXT,__text,regular,pure_instructions", ".balign 4", ".globl _nk", "_nk:", "ret", ".Lfunc_end__nk:", ""]);
    expect(naked_lines(tcx, bodies, "nk_al", "_nk_al")).toEqual([".section __TEXT,__text,regular,pure_instructions", ".balign 16", ".globl _nk_al", "_nk_al:", "ret", ".Lfunc_end__nk_al:", ""]);
  });
});
