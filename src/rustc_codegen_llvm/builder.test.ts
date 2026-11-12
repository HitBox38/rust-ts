// Tests of lane cg-builder's port of builder.rs and allocator.rs: Builder methods driven through the IR model
// (src/rust_ts/llvm), with the printed instructions compared against the oracle's IR for small functions.
//
// The oracle text is `rustc +nightly-2026-10-11 --emit=llvm-ir -Cno-prepopulate-passes -Coverflow-checks=on` on
// aarch64-apple-darwin (`-Copt-level=0` unless stated), of this crate (scratch file, `#![crate_type = "lib"]`):
//   #[no_mangle] pub fn add_i32(a: i32, b: i32) -> i32 { a + b }
//   #[no_mangle] pub fn add_u8(a: u8, b: u8) -> u8 { a + b }
//   #[no_mangle] pub fn mul_u64(a: u64, b: u64) -> u64 { a * b }
//   #[no_mangle] pub fn pick(x: u32) -> u32 { match x { 0 => 10, 3 => 7, 9 => 1, _ => 2 } }
//   pub struct D(u32); impl Drop for D { fn drop(&mut self) { unsafe { side(self.0) } } }
//   extern "Rust" { fn side(x: u32); fn may_panic(); }
//   #[no_mangle] pub fn with_cleanup(x: u32) { let _d = D(x); unsafe { may_panic() } }
//   #[no_mangle] pub fn atom(a: &AtomicU32, v: u32) -> u32 { /* fetch_add, compare_exchange, store, fence, load */ }
//   #[no_mangle] pub fn copy16(dst: &mut [u32; 4], src: &[u32; 4]) { unsafe { std::ptr::copy_nonoverlapping(src, dst, 1) } }
// Each expectation below is that output's body, with the comment lines and `; preds` tails (which the M7 normal form drops,
// plan-m7 §1b) removed. Where a line carries call-site attributes that abi.rs / attributes.rs add (cg-abi-consts,
// cg-types-attrs: `ptr align 8` on an argument, `#12`), the expectation drops them and says so; value names that
// rustc_codegen_ssa sets (`%_3.0`, `%_0`) are set here with `set_value_name`, as ssa's codegen does.
//
// The cx: `CodegenCx::new` and the methods builder.rs calls on it belong to lanes cg-context and cg-types-attrs (stubs in
// this branch). The fixture gives a `CodegenCx` own properties standing in for them, each one the upstream body over the same
// C API (cited), so that only builder.rs's code is under test.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import { llvmBinDir } from "../../scripts/lib/llvm-tools.ts";
import { Align, Size } from "../rustc_abi/lib.ts";
import { IntPredicate, SynchronizationScope } from "../rustc_codegen_ssa/common.ts";
import { MemFlags } from "../rustc_codegen_ssa/lib.ts";
import { OverflowOp, ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { printModule } from "../rust_ts/llvm/printer.ts";
import { Unported } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";
import "./lib.ts";
import { codegen as allocator_codegen } from "./allocator.ts";
import { Builder, GenericBuilder, SBuilder } from "./builder.ts";
import { CodegenCx, FullCx, SCx, SimpleCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import type { BasicBlock, Metadata, Type, Value } from "./llvm/mod.ts";

const A = (bytes: number): Align => unwrap_result(Align.from_bytes(bytes), () => "AlignFromBytesError");

interface Fixture {
  C: llvm.Context;
  M: llvm.Module;
  cx: CodegenCx;
  i1: Type;
  i8: Type;
  i32: Type;
  i64: Type;
  ptr: Type;
  vd: Type;
}

/** A `CodegenCx` over a fresh context and module, with the cross-lane methods builder.rs calls (see the header). */
function fixture(opts: { optimize?: "No" | "Default"; max_reliable_alignment?: Align; intrinsics?: Record<string, Type> } = {}): Fixture {
  const C = llvm.LLVMContextCreate();
  const M = llvm.LLVMModuleCreateWithNameInContext("m", C);
  const i1 = llvm.LLVMInt1TypeInContext(C);
  const i8 = llvm.LLVMInt8TypeInContext(C);
  const i32 = llvm.LLVMInt32TypeInContext(C);
  const i64 = llvm.LLVMInt64TypeInContext(C);
  const ptr = llvm.LLVMPointerTypeInContext(C, 0);
  const vd = llvm.LLVMVoidTypeInContext(C);
  const sess = {
    opts: { optimize: opts.optimize ?? "No", unstable_opts: {} },
    target: { max_reliable_alignment: () => opts.max_reliable_alignment ?? Align.MAX, arch: { $: "AArch64" }, is_like_wasm: false },
    is_sanitizer_cfi_enabled: () => false,
    is_sanitizer_kcfi_enabled: () => false,
    pointer_authentication_functions: () => undefined,
    emit_lifetime_markers: () => true,
  };
  const tcx = { sess };
  // `FullCx` with marker values in the fields builder.rs does not read (as skeleton.test.ts's `full_cx`).
  const scx = new SimpleCx(new SCx(M, C, i64));
  const args: unknown[] = Array.from({ length: 31 }, (_, i) => `field${i}`);
  args[0] = tcx;
  args[2] = scx;
  const cx = new CodegenCx(new (FullCx as unknown as new (...a: unknown[]) => FullCx)(...args));
  const intrinsics = new Map<string, Value>();
  Object.assign(cx, {
    sess: () => sess,
    // type_.rs:168 / :188ff (BaseTypeCodegenMethods for GenericCx): `LLVMInt{1,8,32}TypeInContext(self.llcx())` etc.
    type_i1: () => i1,
    type_i8: () => i8,
    type_i32: () => i32,
    type_i64: () => i64,
    type_isize: () => i64, // type_.rs: `self.isize_ty` (the SCx field)
    type_ix: (n: number) => llvm.LLVMIntTypeInContext(C, n),
    type_ptr: () => ptr,
    type_void: () => vd,
    type_array: (ty: Type, len: bigint) => llvm.LLVMArrayType2(ty, len),
    type_struct: (els: readonly Type[], packed: boolean) => llvm.LLVMStructTypeInContext(C, els, els.length, llvm.to_llvm_bool(packed)),
    type_func: (args_: readonly Type[], ret: Type) => llvm.LLVMFunctionType(ret, args_, args_.length, llvm.FALSE),
    type_kind: (ty: Type) => llvm.ToGeneric_for_TypeKind.to_generic(llvm.LLVMGetTypeKind(ty).to_rust()),
    val_ty: (v: Value) => llvm.LLVMTypeOf(v),
    // type_.rs:84 func_params_types
    func_params_types: (ty: Type) => {
      const out: Type[] = [];
      llvm.LLVMGetParamTypes(ty, out);
      return out.slice(0, llvm.LLVMCountParamTypes(ty));
    },
    // common.rs (ConstCodegenMethods): `LLVMConstInt` / `LLVMGetPoison` / `LLVMConstArray2` / `LLVMConstNull`.
    const_u32: (i: number) => llvm.LLVMConstInt(i32, BigInt(i), llvm.FALSE),
    const_i32: (i: number) => llvm.LLVMConstInt(i32, BigInt(i), llvm.TRUE),
    const_u64: (i: bigint) => llvm.LLVMConstInt(i64, i, llvm.FALSE),
    const_usize: (i: bigint) => llvm.LLVMConstInt(i64, i, llvm.FALSE),
    const_uint_big: (t: Type, u: bigint) => llvm.LLVMConstInt(t, u, llvm.FALSE),
    const_poison: (t: Type) => llvm.LLVMGetPoison(t),
    const_array: (ty: Type, elts: readonly Value[]) => llvm.LLVMConstArray2(ty, elts, BigInt(elts.length)),
    const_null_inherent: (t: Type) => llvm.LLVMConstNull(t),
    // context.rs:889 get_metadata_value, :913 get_md_kind_id, :917 create_metadata, :1182 md_node_in_context,
    // :1187 set_metadata, :1201 set_metadata_node.
    get_metadata_value: (md: Metadata) => llvm.LLVMMetadataAsValue(C, md),
    get_md_kind_id: (name: string) => llvm.LLVMGetMDKindIDInContext(C, name, name.length),
    create_metadata: (name: Uint8Array) => llvm.LLVMMDStringInContext2(C, name, name.length),
    md_node_in_context: (md_list: readonly Metadata[]) => llvm.LLVMMDNodeInContext2(C, md_list, md_list.length),
    set_metadata: (val: Value, kind_id: llvm.MetadataKindId, md: Metadata) => llvm.LLVMSetMetadata(val, kind_id, llvm.LLVMMetadataAsValue(C, md)),
    set_metadata_node: (instruction: Value, kind_id: llvm.MetadataKindId, md_list: readonly Metadata[]) => {
      const md = llvm.LLVMMDNodeInContext2(C, md_list, md_list.length);
      llvm.LLVMSetMetadata(instruction, kind_id, llvm.LLVMMetadataAsValue(C, md));
      return md;
    },
    // context.rs:1087 get_intrinsic: the declaration the oracle's module carries (its `declare` line), by name.
    get_intrinsic: (base_name: string, _type_params: readonly Type[]): [Type, Value] => {
      const fty = opts.intrinsics?.[base_name];
      if (fty === undefined) throw new Error(`fixture: no intrinsic ${base_name}`);
      let f = intrinsics.get(base_name);
      if (f === undefined) intrinsics.set(base_name, (f = llvm.LLVMAddFunction(M, base_name, fty)));
      return [fty, f];
    },
  });
  return { C, M, cx, i1, i8, i32, i64, ptr, vd };
}

/** Adds `define <ret> @name(<params>)`, names its parameters and appends the blocks, in order. */
function define(fx: Fixture, name: string, ret: Type, params: [string, Type][], blocks: string[]) {
  const fty = llvm.LLVMFunctionType(ret, params.map((p) => p[1]), params.length, llvm.FALSE);
  const f = llvm.LLVMAddFunction(fx.M, name, fty);
  const ps = params.map(([n], i) => {
    const p = llvm.LLVMGetParam(f, i);
    llvm.set_value_name(p, utf8(n));
    return p;
  });
  const bbs = blocks.map((b) => Builder.append_block(fx.cx, f, b));
  return { f, ps, bbs };
}

const named = (v: Value, name: string): Value => {
  llvm.set_value_name(v, utf8(name));
  return v;
};

/** The body of `@name` in printed IR: from the first label to the closing brace, without comment lines and `; preds` tails
 *  (plan-m7 §1b's normal form drops both). */
function body(ir: string, name: string): string {
  const lines = ir.split("\n");
  const start = lines.findIndex((l) => l.startsWith("define ") && l.includes(`@${name}(`));
  if (start < 0) throw new Error(`no define of @${name}`);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== "}"; i++) {
    const l = lines[i]!;
    if (l.trimStart().startsWith(";")) continue;
    out.push(l.replace(/\s+; preds = .*$/, ""));
  }
  return out.join("\n");
}

describe("arithmetic with overflow checks (checked_binop)", () => {
  /** `ty.int_size_and_signed(tcx)` of a Rust integer type. */
  const int_ty = (bits: number, signed: boolean) => ({ int_size_and_signed: () => [Size.from_bits(bits), signed] }) as unknown as Ty;

  test("signed: llvm.sadd.with.overflow and two extractvalues (add_i32)", () => {
    const fx = fixture({ intrinsics: {} });
    const oty = llvm.LLVMStructTypeInContext(fx.C, [fx.i32, fx.i1], 2, llvm.FALSE);
    (fx.cx as unknown as { get_intrinsic: unknown }).get_intrinsic = (n: string): [Type, Value] => {
      expect(n).toBe("llvm.sadd.with.overflow");
      const fty = llvm.LLVMFunctionType(oty, [fx.i32, fx.i32], 2, llvm.FALSE);
      return [fty, llvm.LLVMAddFunction(fx.M, "llvm.sadd.with.overflow.i32", fty)];
    };
    const panic_fn = llvm.LLVMAddFunction(fx.M, "panic_const_add_overflow", llvm.LLVMFunctionType(fx.vd, [fx.ptr], 1, llvm.FALSE));
    const alloc = llvm.LLVMAddGlobal(fx.M, fx.i8, "alloc_23c76b1ac4d14fcdb077d2ddba2f5e2f");
    const { ps, bbs } = define(fx, "add_i32", fx.i32, [["a", fx.i32], ["b", fx.i32]], ["start", "bb1", "panic"]);
    const [start, bb1, panic] = bbs as [BasicBlock, BasicBlock, BasicBlock];
    const bx = Builder.build(fx.cx, start);
    const [v, o] = bx.checked_binop(OverflowOp.Add, int_ty(32, true), ps[0]!, ps[1]!);
    named(v, "_3.0");
    named(o, "_3.1");
    bx.cond_br(o, panic, bb1);
    bx.switch_to_block(bb1);
    bx.ret(v);
    bx.switch_to_block(panic);
    bx.call(llvm.LLVMGlobalGetValueType(panic_fn), undefined, undefined, panic_fn, ReturnSlot.Direct, [alloc], undefined, undefined);
    bx.unreachable();
    expect(body(printModule(fx.M), "add_i32")).toBe(
      [
        "start:",
        "  %0 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %a, i32 %b)",
        "  %_3.0 = extractvalue { i32, i1 } %0, 0",
        "  %_3.1 = extractvalue { i32, i1 } %0, 1",
        "  br i1 %_3.1, label %panic, label %bb1",
        "",
        "bb1:",
        "  ret i32 %_3.0",
        "",
        "panic:",
        // Oracle: `call void @_RNv..panic_const_add_overflow(ptr align 8 @alloc_23c7..) #12`: `align 8` and `#12` are
        // abi.rs's call-site attributes (`fn_abi.apply_attrs_callsite`), not passed here; the callee is renamed.
        "  call void @panic_const_add_overflow(ptr @alloc_23c76b1ac4d14fcdb077d2ddba2f5e2f)",
        "  unreachable",
      ].join("\n"),
    );
  });

  test("unsigned add: add and icmp ult instead of the intrinsic (add_u8)", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "add_u8", fx.i8, [["a", fx.i8], ["b", fx.i8]], ["start", "bb1", "panic"]);
    const [start, bb1, panic] = bbs as [BasicBlock, BasicBlock, BasicBlock];
    const bx = Builder.build(fx.cx, start);
    const [v, o] = bx.checked_binop(OverflowOp.Add, int_ty(8, false), ps[0]!, ps[1]!);
    named(v, "_3.0");
    named(o, "_3.1");
    bx.cond_br(o, panic, bb1);
    bx.switch_to_block(bb1);
    bx.ret(v);
    bx.switch_to_block(panic);
    bx.unreachable();
    expect(body(printModule(fx.M), "add_u8")).toBe(
      [
        "start:",
        "  %_3.0 = add i8 %a, %b",
        "  %_3.1 = icmp ult i8 %_3.0, %a",
        "  br i1 %_3.1, label %panic, label %bb1",
        "",
        "bb1:",
        "  ret i8 %_3.0",
        "",
        "panic:",
        // (the oracle's panic call is left out here; see the signed test)
        "  unreachable",
      ].join("\n"),
    );
  });

  test("unsigned mul: llvm.umul.with.overflow (mul_u64); the intrinsic name and type parameter", () => {
    const fx = fixture();
    const seen: [string, readonly Type[]][] = [];
    const oty = llvm.LLVMStructTypeInContext(fx.C, [fx.i64, fx.i1], 2, llvm.FALSE);
    (fx.cx as unknown as { get_intrinsic: unknown }).get_intrinsic = (n: string, tps: readonly Type[]): [Type, Value] => {
      seen.push([n, tps]);
      const fty = llvm.LLVMFunctionType(oty, [fx.i64, fx.i64], 2, llvm.FALSE);
      return [fty, llvm.LLVMAddFunction(fx.M, "llvm.umul.with.overflow.i64", fty)];
    };
    const { ps, bbs } = define(fx, "mul_u64", fx.i64, [["a", fx.i64], ["b", fx.i64]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const [v, o] = bx.checked_binop(OverflowOp.Mul, int_ty(64, false), ps[0]!, ps[1]!);
    named(v, "_3.0");
    named(o, "_3.1");
    bx.ret(v);
    expect(seen).toEqual([["llvm.umul.with.overflow", [fx.i64]]]);
    expect(body(printModule(fx.M), "mul_u64").split("\n").slice(0, 4)).toEqual([
      "start:",
      "  %0 = call { i64, i1 } @llvm.umul.with.overflow.i64(i64 %a, i64 %b)",
      "  %_3.0 = extractvalue { i64, i1 } %0, 0",
      "  %_3.1 = extractvalue { i64, i1 } %0, 1",
    ]);
  });
});

describe("a match: alloca, switch, store, load (pick)", () => {
  function build(fx: Fixture, o2: boolean): string {
    const { ps, bbs } = define(fx, "pick", fx.i32, [["x", fx.i32]], ["start", "bb1", "bb4", "bb3", "bb2", "bb5"]);
    const [start, bb1, bb4, bb3, bb2, bb5] = bbs as BasicBlock[];
    const bx = Builder.build(fx.cx, start!);
    const slot = named(bx.alloca(Size.from_bytes(4), A(4)), "_0");
    bx.switch(ps[0]!, bb1!, [
      [0n, bb4!],
      [3n, bb3!],
      [9n, bb2!],
    ]);
    for (const [bb, k] of [
      [bb1, 2],
      [bb4, 10],
      [bb3, 7],
      [bb2, 1],
    ] as const) {
      bx.switch_to_block(bb!);
      bx.store(llvm.LLVMConstInt(fx.i32, BigInt(k), llvm.FALSE), slot, A(4));
      bx.br(bb5!);
    }
    bx.switch_to_block(bb5!);
    const v = bx.load(fx.i32, slot, A(4));
    if (o2) bx.noundef_metadata(v);
    bx.ret(v);
    return body(printModule(fx.M), "pick");
  }
  const expected = (load: string) =>
    [
      "start:",
      "  %_0 = alloca [4 x i8], align 4",
      "  switch i32 %x, label %bb1 [",
      "    i32 0, label %bb4",
      "    i32 3, label %bb3",
      "    i32 9, label %bb2",
      "  ]",
      "",
      "bb1:",
      "  store i32 2, ptr %_0, align 4",
      "  br label %bb5",
      "",
      "bb4:",
      "  store i32 10, ptr %_0, align 4",
      "  br label %bb5",
      "",
      "bb3:",
      "  store i32 7, ptr %_0, align 4",
      "  br label %bb5",
      "",
      "bb2:",
      "  store i32 1, ptr %_0, align 4",
      "  br label %bb5",
      "",
      "bb5:",
      load,
      "  ret i32 %0",
    ].join("\n");

  test("-Copt-level=0", () => {
    expect(build(fixture(), false)).toBe(expected("  %0 = load i32, ptr %_0, align 4"));
  });

  test("-Copt-level=2: the load carries !noundef (noundef_metadata)", () => {
    const out = build(fixture({ optimize: "Default" }), true);
    // Oracle (-Copt-level=2): `%0 = load i32, ptr %_0, align 4, !noundef !26`; the metadata number is the printer's.
    expect(out.replace(/!noundef !\d+/, "!noundef !N")).toBe(expected("  %0 = load i32, ptr %_0, align 4, !noundef !N"));
  });
});

describe("invoke with a cleanup landing pad, a filter pad and resume (with_cleanup)", () => {
  test("the body matches the oracle's", () => {
    const fx = fixture();
    const pers = llvm.LLVMAddFunction(fx.M, "rust_eh_personality", llvm.LLVMFunctionType(fx.i32, [fx.i32, fx.i32, fx.i64, fx.ptr, fx.ptr], 5, llvm.FALSE));
    const may_panic = llvm.LLVMAddFunction(fx.M, "may_panic", llvm.LLVMFunctionType(fx.vd, [], 0, llvm.FALSE));
    const drop_glue = llvm.LLVMAddFunction(fx.M, "drop_glue_D", llvm.LLVMFunctionType(fx.vd, [fx.ptr], 1, llvm.FALSE));
    const in_cleanup = llvm.LLVMAddFunction(fx.M, "panic_in_cleanup", llvm.LLVMFunctionType(fx.vd, [], 0, llvm.FALSE));
    const { f, ps, bbs } = define(fx, "with_cleanup", fx.vd, [["x", fx.i32]], ["start", "bb3", "cleanup", "bb1", "terminate", "bb4"]);
    const [start, bb3, cleanup, bb1, terminate, bb4] = bbs as BasicBlock[];
    const bx = Builder.build(fx.cx, start!);
    const d = named(bx.alloca(Size.from_bytes(4), A(4)), "_d");
    bx.store(ps[0]!, d, A(4));
    const vty = llvm.LLVMGlobalGetValueType(may_panic);
    const dty = llvm.LLVMGlobalGetValueType(drop_glue);
    bx.invoke(vty, undefined, undefined, may_panic, ReturnSlot.Direct, [], bb1!, cleanup!, undefined, undefined);

    bx.switch_to_block(bb3!);
    bx.invoke(dty, undefined, undefined, drop_glue, ReturnSlot.Direct, [d], bb4!, terminate!, undefined, undefined);

    bx.switch_to_block(cleanup!);
    const [exn0, exn1] = bx.cleanup_landing_pad(pers);
    // The personality slot: an alloca created now, placed at the start of the entry block (position_at_start).
    const slot = bx.alloca(Size.from_bytes(16), A(8));
    bx.store(exn0, slot, A(8));
    const slot1 = bx.inbounds_ptradd(slot, bx.const_usize(8n));
    bx.store(exn1, slot1, A(8));
    bx.br(bb3!);

    bx.switch_to_block(bb1!);
    bx.call(dty, undefined, undefined, drop_glue, ReturnSlot.Direct, [d], undefined, undefined);
    bx.ret_void();

    bx.switch_to_block(terminate!);
    bx.filter_landing_pad(pers);
    bx.call(llvm.LLVMGlobalGetValueType(in_cleanup), undefined, undefined, in_cleanup, ReturnSlot.Direct, [], undefined, undefined);
    bx.unreachable();

    bx.switch_to_block(bb4!);
    const e0 = bx.load(fx.ptr, slot, A(8));
    const e1 = bx.load(fx.i32, bx.inbounds_ptradd(slot, bx.const_usize(8n)), A(8));
    bx.resume(e0, e1);

    const ir = printModule(fx.M);
    expect(ir).toContain("define void @with_cleanup(i32 %x) personality ptr @rust_eh_personality {");
    expect(llvm.LLVMGetBasicBlockParent(start!)).toBe(f);
    expect(body(ir, "with_cleanup")).toBe(
      [
        "start:",
        "  %0 = alloca [16 x i8], align 8",
        "  %_d = alloca [4 x i8], align 4",
        "  store i32 %x, ptr %_d, align 4",
        "  invoke void @may_panic()",
        "          to label %bb1 unwind label %cleanup",
        "",
        "bb3:",
        // Oracle: `invoke void @_RIN..drop_glue..(ptr align 4 %_d) #15`: `align 4` and `#15` are abi.rs's / attributes.rs's.
        "  invoke void @drop_glue_D(ptr %_d)",
        "          to label %bb4 unwind label %terminate",
        "",
        "cleanup:",
        "  %1 = landingpad { ptr, i32 }",
        "          cleanup",
        "  %2 = extractvalue { ptr, i32 } %1, 0",
        "  %3 = extractvalue { ptr, i32 } %1, 1",
        "  store ptr %2, ptr %0, align 8",
        "  %4 = getelementptr inbounds i8, ptr %0, i64 8",
        "  store i32 %3, ptr %4, align 8",
        "  br label %bb3",
        "",
        "bb1:",
        // Oracle: `call void @_RIN..drop_glue..(ptr align 4 %_d)` (`align 4`: abi.rs).
        "  call void @drop_glue_D(ptr %_d)",
        "  ret void",
        "",
        "terminate:",
        "  %5 = landingpad { ptr, i32 }",
        "          filter [0 x ptr] zeroinitializer",
        // Oracle: `call void @_RNv..panic_in_cleanup() #13` (`#13`: attributes.rs).
        "  call void @panic_in_cleanup()",
        "  unreachable",
        "",
        "bb4:",
        "  %6 = load ptr, ptr %0, align 8",
        "  %7 = getelementptr inbounds i8, ptr %0, i64 8",
        "  %8 = load i32, ptr %7, align 8",
        "  %9 = insertvalue { ptr, i32 } poison, ptr %6, 0",
        "  %10 = insertvalue { ptr, i32 } %9, i32 %8, 1",
        "  resume { ptr, i32 } %10",
      ].join("\n"),
    );
  });
});

describe("atomics (the bodies of core's atomic helpers in the oracle's module)", () => {
  test("atomicrmw, cmpxchg, load atomic, store atomic, fence", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "atom", fx.vd, [["dst", fx.ptr], ["val", fx.i32], ["old", fx.i32], ["new", fx.i32]], ["start"]);
    const [dst, val, old, new_] = ps as Value[];
    const bx = Builder.build(fx.cx, bbs[0]!);
    bx.atomic_rmw("AtomicAdd", dst!, val!, "Relaxed", false);
    bx.atomic_cmpxchg(dst!, old!, new_!, "Relaxed", "Relaxed", false);
    bx.atomic_cmpxchg(dst!, old!, new_!, "AcqRel", "Acquire", true);
    bx.atomic_load(fx.i32, dst!, "Acquire", false, Size.from_bytes(4));
    bx.atomic_store(val!, dst!, "Release", false, Size.from_bytes(4));
    bx.atomic_fence("Release", SynchronizationScope.CrossThread);
    bx.atomic_fence("SeqCst", SynchronizationScope.CrossThread);
    bx.ret_void();
    expect(body(printModule(fx.M), "atom")).toBe(
      [
        "start:",
        // Oracle :470 (`<Atomic<u32>>::fetch_add`'s `atomic_add`): `%0 = atomicrmw add ptr %self, i32 %val monotonic, align 4`.
        // builder.rs sets no alignment on atomicrmw / cmpxchg: the oracle's `, align 4` is LLVM's default (IRBuilder takes the
        // type's store size from the DataLayout), which the IR model does not print. The M7 normal form (`opt` round trip)
        // restores it; the `opt -passes=verify` test below checks that on an atomicrmw.
        "  %0 = atomicrmw add ptr %dst, i32 %val monotonic",
        // Oracle :212-214 (`atomic_compare_exchange`): the cmpxchg (`, align 4`: as above) and its two extractvalues.
        "  %1 = cmpxchg ptr %dst, i32 %old, i32 %new monotonic monotonic",
        "  %2 = extractvalue { i32, i1 } %1, 0",
        "  %3 = extractvalue { i32, i1 } %1, 1",
        // Oracle :309 (`acq_rel acquire`); `weak` is `compare_exchange_weak`'s form.
        "  %4 = cmpxchg weak ptr %dst, i32 %old, i32 %new acq_rel acquire",
        "  %5 = extractvalue { i32, i1 } %4, 0",
        "  %6 = extractvalue { i32, i1 } %4, 1",
        // Oracle :87, :127, :528, :540.
        "  %7 = load atomic i32, ptr %dst acquire, align 4",
        "  store atomic i32 %val, ptr %dst release, align 4",
        "  fence release",
        "  fence seq_cst",
        "  ret void",
      ].join("\n"),
    );
  });
});

describe("memcpy (copy16 → core::ptr::copy_nonoverlapping)", () => {
  test("the size multiply and the memcpy call", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "copy_nonoverlapping", fx.vd, [["src", fx.ptr], ["dst", fx.ptr], ["count", fx.i64]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const size = bx.unchecked_sumul(ps[2]!, bx.const_usize(16n));
    bx.memcpy(ps[1]!, A(4), ps[0]!, A(4), size, MemFlags.empty(), undefined);
    bx.ret_void();
    expect(body(printModule(fx.M), "copy_nonoverlapping")).toBe(
      [
        "start:",
        // Oracle :45-46.
        "  %0 = mul nuw nsw i64 %count, 16",
        "  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %dst, ptr align 4 %src, i64 %0, i1 false)",
        "  ret void",
      ].join("\n"),
    );
  });

  test("a non-temporal memcpy, memmove or memset panics as upstream asserts", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "f", fx.vd, [["p", fx.ptr]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const n = bx.const_usize(1n);
    expect(() => bx.memcpy(ps[0]!, A(1), ps[0]!, A(1), n, MemFlags.NONTEMPORAL, undefined)).toThrow("non-temporal memcpy not supported");
    expect(() => bx.memmove(ps[0]!, A(1), ps[0]!, A(1), n, MemFlags.NONTEMPORAL)).toThrow("non-temporal memmove not supported");
    expect(() => bx.memset(ps[0]!, llvm.LLVMConstInt(fx.i8, 0n, llvm.FALSE), n, A(1), MemFlags.NONTEMPORAL)).toThrow("non-temporal memset not supported");
  });
});

describe("unit behaviour of builder.rs's own logic", () => {
  test("load / store clamp the alignment to max_reliable_alignment; the inherent ones (and volatile_load) do not (review F1)", () => {
    const fx = fixture({ max_reliable_alignment: A(4) });
    const { ps, bbs } = define(fx, "f", fx.vd, [["p", fx.ptr]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const p = ps[0]!;
    const one = llvm.LLVMConstInt(fx.i32, 1n, llvm.FALSE);
    bx.load(fx.i32, p, A(16));
    bx.load_inherent(fx.i32, p, A(16));
    bx.volatile_load(fx.i32, p, A(16));
    bx.store(one, p, A(16));
    bx.store_inherent(one, p, A(16));
    bx.store_with_flags(one, p, A(16), MemFlags.VOLATILE);
    bx.ret_void();
    expect(body(printModule(fx.M), "f")).toBe(
      [
        "start:",
        "  %0 = load i32, ptr %p, align 4",
        "  %1 = load i32, ptr %p, align 16",
        "  %2 = load volatile i32, ptr %p, align 16",
        "  store i32 1, ptr %p, align 4",
        "  store i32 1, ptr %p, align 16",
        "  store volatile i32 1, ptr %p, align 4",
        "  ret void",
      ].join("\n"),
    );
  });

  test("store asserts a pointer operand (assert_eq! text)", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "f", fx.vd, [["x", fx.i32]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    expect(() => bx.store(ps[0]!, ps[0]!, A(4))).toThrow("assertion `left == right` failed\n  left: Integer\n right: Pointer");
  });

  test("flags: unchecked_* and or_disjoint set nuw/nsw/disjoint only on instructions, not on folded constants", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "f", fx.i8, [["a", fx.i32], ["b", fx.i32]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const [a, b] = ps as [Value, Value];
    bx.unchecked_suadd(a, b);
    bx.unchecked_susub(a, b);
    bx.unchecked_sadd(a, b);
    bx.unchecked_umul(a, b);
    bx.or_disjoint(a, b);
    bx.exactsdiv(a, b);
    const c2 = llvm.LLVMConstInt(fx.i32, 2n, llvm.FALSE);
    const c3 = llvm.LLVMConstInt(fx.i32, 3n, llvm.FALSE);
    expect(bx.or_disjoint(c2, c3)).toBe(llvm.LLVMConstInt(fx.i32, 3n, llvm.FALSE));
    expect(bx.unchecked_suadd(c2, c3)).toBe(llvm.LLVMConstInt(fx.i32, 5n, llvm.FALSE));
    const t1 = bx.unchecked_utrunc(a, fx.i8);
    bx.unchecked_strunc(a, fx.i8);
    bx.icmp(IntPredicate.IntSLE, a, b);
    bx.ret(t1);
    expect(body(printModule(fx.M), "f")).toBe(
      [
        "start:",
        "  %0 = add nuw nsw i32 %a, %b",
        "  %1 = sub nuw nsw i32 %a, %b",
        "  %2 = add nsw i32 %a, %b",
        "  %3 = mul nuw i32 %a, %b",
        "  %4 = or disjoint i32 %a, %b",
        "  %5 = sdiv exact i32 %a, %b",
        "  %6 = trunc nuw i32 %a to i8",
        "  %7 = trunc nsw i32 %a to i8",
        "  %8 = icmp sle i32 %a, %b",
        "  ret i8 %6",
      ].join("\n"),
    );
  });

  test("check_call bitcasts mismatched arguments and asserts a function type", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "f", fx.vd, [["x", fx.i32]], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const fty = llvm.LLVMFunctionType(fx.vd, [fx.i32], 1, llvm.FALSE);
    const args = [ps[0]!];
    // All match: the same array (`Cow::Borrowed`).
    expect(bx.check_call("call", fty, ps[0]!, args)).toBe(args);
    // type_.rs's `Debug for Type` (cg-types-attrs) prints the type with LLVM's printer.
    Object.defineProperty(fx.cx, "debug_Type", { value: () => "i32" });
    expect(() => bx.check_call("call", fx.i32, ps[0]!, args)).toThrow("builder::call not passed a function, but i32");
  });

  test("switch_with_weights: at -O0 a plain switch; otherwise !prof branch_weights (1 cold, 2000 hot)", () => {
    for (const optimize of ["No", "Default"] as const) {
      const fx = fixture({ optimize });
      const { ps, bbs } = define(fx, "f", fx.vd, [["x", fx.i32]], ["start", "a", "b", "c"]);
      const [start, a, b, c] = bbs as BasicBlock[];
      const bx = Builder.build(fx.cx, start!);
      bx.switch_with_weights(ps[0]!, a!, true, [
        [1n, b!, false],
        [2n, c!, true],
      ]);
      for (const bb of [a, b, c]) {
        bx.switch_to_block(bb!);
        bx.ret_void();
      }
      const ir = printModule(fx.M);
      const sw = body(ir, "f").split("\n")[1]!;
      if (optimize === "No") {
        expect(sw).toBe("  switch i32 %x, label %a [");
        expect(ir).not.toContain("branch_weights");
      } else {
        expect(body(ir, "f")).toContain("  ], !prof !");
        expect(ir).toMatch(/^!\d+ = !\{!"branch_weights", i32 1, i32 2000, i32 1\}$/m);
      }
    }
  });

  test("switch_to_block replaces the builder (Self::build): the span is reset to DUMMY_SP", () => {
    const fx = fixture();
    const { bbs } = define(fx, "f", fx.vd, [], ["start", "next"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    bx.set_span(7 as never);
    const before = bx.llbuilder;
    bx.switch_to_block(bbs[1]!);
    expect(bx.llbb()).toBe(bbs[1]!);
    expect(bx.llbuilder).not.toBe(before);
    expect(bx.span).toBe(Builder.build(fx.cx, bbs[1]!).span);
  });

  test("Builder::build / build_inherent / with_cx return the subclass; SBuilder::call", () => {
    const fx = fixture();
    const { bbs } = define(fx, "f", fx.vd, [], ["start"]);
    expect(Builder.build(fx.cx, bbs[0]!)).toBeInstanceOf(Builder);
    expect(Builder.build_inherent(fx.cx, bbs[0]!)).toBeInstanceOf(Builder);
    const scx = fx.cx.scx;
    const sbx = SBuilder.build_inherent(scx, bbs[0]!);
    expect(sbx).toBeInstanceOf(SBuilder);
    expect(sbx).toBeInstanceOf(GenericBuilder);
    Object.assign(scx, {
      type_kind: (ty: Type) => llvm.ToGeneric_for_TypeKind.to_generic(llvm.LLVMGetTypeKind(ty).to_rust()),
      func_params_types: () => [],
    });
    const callee = llvm.LLVMAddFunction(fx.M, "g", llvm.LLVMFunctionType(fx.vd, [], 0, llvm.FALSE));
    sbx.call(llvm.LLVMGlobalGetValueType(callee), callee, [], undefined);
    sbx.ret_void_inherent();
    expect(body(printModule(fx.M), "f")).toBe(["start:", "  call void @g()", "  ret void"].join("\n"));
  });

  test("model stops and cross-lane stops are reached, not guessed", () => {
    const fx = fixture();
    const { bbs } = define(fx, "f", fx.vd, [], ["start"]);
    const bx = Builder.build(fx.cx, bbs[0]!);
    const stop = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        if (e instanceof Unported) return e.what;
        throw e;
      }
      throw new Error("did not stop");
    };
    // `LLVMRustBuildVScale` is not in the IR model.
    expect(stop(() => bx.vscale(fx.i64))).toMatch(/LLVMRustBuildVScale/);
    // `llvm.loop` metadata needs `LLVMReplaceMDNodeOperandWith` (model stop) after the self-reference.
    expect(stop(() => bx.br_with_attrs(bbs[0]!, [{ $: "Full" }]))).toMatch(/LLVMReplaceMDNodeOperandWith/);
    // `cleanup_pad` reaches cg-context's `Funclet::new` stub (common.rs:115) once LLVM builds the pad.
    expect(stop(() => bx.cleanup_pad(undefined, []))).toBe("cg-context: compiler/rustc_codegen_llvm/src/common.rs new");
    // load_operand of a ZST reaches lane ssa-operand-place's `OperandRef::zero_sized` (local stub).
    const zst = { is_unsized: () => false, is_zst: () => true };
    expect(stop(() => bx.load_operand({ layout: zst, val: { llextra: undefined } } as never))).toBe(
      "ssa-operand-place: compiler/rustc_codegen_ssa/src/mir/operand.rs zero_sized",
    );
  });

  test("allocator::codegen stops in cg-types-attrs' stubs (no type of its own)", () => {
    const fx = fixture();
    const tcx = { sess: { target: { pointer_width: 64 } } };
    expect(() => allocator_codegen(tcx as never, fx.cx.scx, "m", [])).toThrow(Unported);
    try {
      allocator_codegen(tcx as never, fx.cx.scx, "m", []);
    } catch (e) {
      expect((e as Unported).what).toBe("cg-types-attrs: compiler/rustc_codegen_llvm/src/type_.rs type_i64");
    }
  });
});

describe("the pinned opt parses and verifies a module the builder wrote", () => {
  const SYSROOT = (() => {
    try {
      const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
      return r.exitCode === 0 ? r.stdout.toString().trim() : "";
    } catch {
      return "";
    }
  })();
  const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64";
  test.skipIf(!HAVE && process.env.RUST_TS_REQUIRE_PROBES !== "1")("opt -passes=verify", () => {
    const fx = fixture();
    const { ps, bbs } = define(fx, "f", fx.i32, [["dst", fx.ptr], ["v", fx.i32]], ["start", "a", "b"]);
    const [start, a, b] = bbs as BasicBlock[];
    const bx = Builder.build(fx.cx, start!);
    const slot = bx.alloca(Size.from_bytes(4), A(4));
    bx.store(ps[1]!, slot, A(4));
    const old = bx.atomic_rmw("AtomicAdd", ps[0]!, ps[1]!, "SeqCst", false);
    const c = bx.icmp(IntPredicate.IntEQ, old, ps[1]!);
    bx.cond_br(c, a!, b!);
    bx.switch_to_block(a!);
    bx.ret(bx.load(fx.i32, slot, A(4)));
    bx.switch_to_block(b!);
    bx.ret(bx.unchecked_suadd(old, ps[1]!));
    const dir = mkdtempSync(join(tmpdir(), "cg-builder-"));
    try {
      const opt = join(llvmBinDir(SYSROOT, "aarch64-apple-darwin"), "opt");
      const p = Bun.spawnSync([opt, "-passes=verify", "-S", "-o", join(dir, "out.ll")], { stdin: Buffer.from(printModule(fx.M), "latin1"), stderr: "pipe" });
      expect(p.stderr.toString().split("\n")[0]).toBe("");
      expect(p.exitCode).toBe(0);
      expect(existsSync(join(dir, "out.ll")) && readFileSync(join(dir, "out.ll"), "utf8")).toContain("atomicrmw add ptr %dst, i32 %v seq_cst, align 4");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
