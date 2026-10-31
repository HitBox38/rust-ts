// Port of src/tools/miri/src/helpers.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-eval` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ImmTy, type MPlaceTy, type Pointer, type Scalar } from "./lib.ts";
import { type FrameExtra, type MiriInterpCx, MiriMachine, type Provenance, type RejectOpWith } from "./machine.ts";
import { stub_methods } from "../rust_ts/miri_stub.ts";
import { type ExternAbi } from "../rustc_abi/extern_abi.ts";
import { type Align, type Size } from "../rustc_abi/lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { type Writeable } from "../rustc_const_eval/interpret/place.ts";
import { type Projectable } from "../rustc_const_eval/interpret/projection.ts";
import { type Frame, type ReturnContinuation } from "../rustc_const_eval/interpret/stack.gen.ts";
import { type Namespace } from "../rustc_hir/def.ts";
import { type AllocRange } from "../rustc_middle/mir/interpret/allocation.ts";
import { type InterpResult } from "../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Instance } from "../rustc_middle/ty/instance.ts";
import { type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { type Ty } from "../rustc_middle/ty/mod.ts";
import { type CrateNum, type DefId } from "../rustc_span/def_id.ts";
import { type Span } from "../rustc_span/lib.ts";
import { type Symbol } from "../rustc_span/symbol.ts";
import { type Os } from "../rustc_target/spec/mod.ts";
import { type Pending } from "../rustc_type_ir/decls.ts";
import { unported } from "../std/panic.ts";

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- helpers.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // helpers.rs:171
    have_module(this: MiriInterpCx, path: readonly string[]): boolean;
    // helpers.rs:176
    eval_path(this: MiriInterpCx, path: readonly string[]): MPlaceTy;
    // helpers.rs:184
    eval_path_scalar(this: MiriInterpCx, path: readonly string[]): Scalar;
    // helpers.rs:192
    eval_libc(this: MiriInterpCx, name: string): Scalar;
    // helpers.rs:202
    eval_libc_i16(this: MiriInterpCx, name: string): number;
    // helpers.rs:210
    eval_libc_u16(this: MiriInterpCx, name: string): number;
    // helpers.rs:218
    eval_libc_i32(this: MiriInterpCx, name: string): number;
    // helpers.rs:226
    eval_libc_u32(this: MiriInterpCx, name: string): number;
    // helpers.rs:234
    eval_libc_u64(this: MiriInterpCx, name: string): bigint;
    // helpers.rs:242
    eval_windows(this: MiriInterpCx, module: string, name: string): Scalar;
    // helpers.rs:247
    eval_windows_u32(this: MiriInterpCx, module: string, name: string): number;
    // helpers.rs:255
    eval_windows_u64(this: MiriInterpCx, module: string, name: string): bigint;
    // helpers.rs:263
    libc_ty_layout(this: MiriInterpCx, name: string): TyAndLayout;
    // helpers.rs:274
    windows_ty_layout(this: MiriInterpCx, name: string): TyAndLayout;
    // helpers.rs:280
    libc_array_ty_layout(this: MiriInterpCx, name: string, size: bigint): TyAndLayout;
    // helpers.rs:288
    try_project_field_named<P>(this: MiriInterpCx, base: P, name: string): InterpResult<P | undefined>;
    // helpers.rs:304
    project_field_named<P>(this: MiriInterpCx, base: P, name: string): InterpResult<P>;
    // helpers.rs:318
    write_int(this: MiriInterpCx, i: bigint, dest: Writeable): InterpResult;
    // helpers.rs:338
    write_int_fields(this: MiriInterpCx, values: readonly bigint[], dest: Writeable): InterpResult;
    // helpers.rs:353
    write_int_fields_named(this: MiriInterpCx, values: ([string, bigint])[], dest: Writeable): InterpResult;
    // helpers.rs:367
    write_null(this: MiriInterpCx, dest: Writeable): InterpResult;
    // helpers.rs:372
    ptr_is_null(this: MiriInterpCx, ptr: Pointer): InterpResult<boolean>;
    // helpers.rs:377
    gen_random(this: MiriInterpCx, ptr: Pointer, len: bigint): InterpResult;
    // helpers.rs:407
    call_function(this: MiriInterpCx, f: Instance, caller_abi: ExternAbi, args: readonly ImmTy[], dest: MPlaceTy | undefined, cont: ReturnContinuation): InterpResult;
    // helpers.rs:447
    call_thread_root_function(this: MiriInterpCx, f: Instance, caller_abi: ExternAbi, args: readonly ImmTy[], dest: MPlaceTy | undefined, span: Span): InterpResult;
    // helpers.rs:465
    visit_freeze_sensitive(this: MiriInterpCx, place: MPlaceTy, size: Size, action: ((_0: AllocRange, _1: boolean) => InterpResult)): InterpResult;
    // helpers.rs:614
    check_no_isolation(this: MiriInterpCx, name: string): InterpResult;
    // helpers.rs:623
    reject_in_isolation(this: MiriInterpCx, op_name: string, reject_with: RejectOpWith): InterpResult;
    // helpers.rs:653
    assert_target_os(this: MiriInterpCx, target_os: Os, name: string): void;
    // helpers.rs:664
    check_target_os(this: MiriInterpCx, target_oses: readonly Os[], name: Symbol): InterpResult;
    // helpers.rs:675
    assert_target_os_is_unix(this: MiriInterpCx, name: string): void;
    // helpers.rs:679
    target_os_is_unix(this: MiriInterpCx): boolean;
    // helpers.rs:684
    deref_pointer_as(this: MiriInterpCx, op: Projectable, layout: TyAndLayout): InterpResult<MPlaceTy>;
    // helpers.rs:695
    deref_pointer_and_offset(this: MiriInterpCx, op: Projectable, offset: bigint, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult<MPlaceTy>;
    // helpers.rs:712
    deref_pointer_and_read(this: MiriInterpCx, op: Projectable, offset: bigint, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult<Scalar>;
    // helpers.rs:724
    deref_pointer_and_write(this: MiriInterpCx, op: Projectable, offset: bigint, value: Scalar, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult;
    // helpers.rs:738
    read_byte_slice(this: MiriInterpCx, slice: ImmTy): InterpResult<Uint8Array>;
    // helpers.rs:751
    read_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<Uint8Array>;
    // helpers.rs:781
    write_c_str(this: MiriInterpCx, c_str: Uint8Array, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // helpers.rs:801
    read_c_str_with_char_size<T>(this: MiriInterpCx, ptr: Pointer, size: Size, align: Align): InterpResult<T[]>;
    // helpers.rs:835
    read_wide_str(this: MiriInterpCx, ptr: Pointer): InterpResult<number[]>;
    // helpers.rs:845
    write_wide_str(this: MiriInterpCx, wide_str: readonly number[], ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // helpers.rs:873
    read_wchar_t_str(this: MiriInterpCx, ptr: Pointer): InterpResult<number[]>;
    // helpers.rs:884
    frame_in_std(this: MiriInterpCx): boolean;
    // helpers.rs:907
    mark_immutable(this: MiriInterpCx, mplace: MPlaceTy): void;
    // helpers.rs:915
    get_twice_wide_int_ty(this: MiriInterpCx, ty: Ty): Ty;
    // helpers.rs:936
    expect_target_feature_for_intrinsic(this: MiriInterpCx, intrinsic: Symbol, target_feature: string): InterpResult;
    // helpers.rs:952
    lookup_link_section(this: MiriInterpCx, include_name: ((_0: string) => boolean)): InterpResult<([ImmTy, Span])[]>;
    // helpers.rs:1001
    mangle_internal_symbol(this: MiriInterpCx, name: string): string;
  }
}

declare module "./machine.gen.ts" {
  interface MiriMachine {
    // helpers.rs:1019
    current_user_relevant_span(): Span;
    // helpers.rs:1028
    caller_span(): Span;
    // helpers.rs:1036
    stack(): readonly Frame<FrameExtra>[];
    // helpers.rs:1040
    top_user_relevant_frame(): number | undefined;
    // helpers.rs:1045
    user_relevance(frame: Frame<Provenance>): number;
  }
}

// helpers.rs:89 (pub)
export function try_resolve_path(tcx: TyCtxt, path: readonly string[], namespace: Namespace): Instance | undefined {
  return unported("miri::helpers::try_resolve_path (src/tools/miri/src/helpers.rs:89; lane miri-eval)");
}
// helpers.rs:100 (pub)
export function resolve_path(tcx: TyCtxt, path: readonly string[], namespace: Namespace): Instance {
  return unported("miri::helpers::resolve_path (src/tools/miri/src/helpers.rs:100; lane miri-eval)");
}
// helpers.rs:111 (pub)
export function path_ty_layout(cx: Pending<"impl LayoutOf<'tcx>">, path: readonly string[]): TyAndLayout {
  return unported("miri::helpers::path_ty_layout (src/tools/miri/src/helpers.rs:111; lane miri-eval)");
}
// helpers.rs:119 (pub)
export function iter_exported_symbols(tcx: TyCtxt, f: ((_0: CrateNum, _1: DefId, _2: boolean) => InterpResult)): InterpResult {
  return unported("miri::helpers::iter_exported_symbols (src/tools/miri/src/helpers.rs:119; lane miri-eval)");
}
// helpers.rs:1059 (pub)
export function isolation_abort_error(name: string): InterpResult {
  return unported("miri::helpers::isolation_abort_error (src/tools/miri/src/helpers.rs:1059; lane miri-eval)");
}
// helpers.rs:1065 (pub(crate))
export function bool_to_simd_element(b: boolean, size: Size): Scalar {
  return unported("miri::helpers::bool_to_simd_element (src/tools/miri/src/helpers.rs:1065; lane miri-eval)");
}
// helpers.rs:1076 (pub(crate))
export function windows_check_buffer_size(_0: [boolean, bigint]): number {
  return unported("miri::helpers::windows_check_buffer_size (src/tools/miri/src/helpers.rs:1076; lane miri-eval)");
}
// helpers.rs:1089 (pub)
export function is_no_core(tcx: TyCtxt): boolean {
  return unported("miri::helpers::is_no_core (src/tools/miri/src/helpers.rs:1089; lane miri-eval)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// trait ToUsize (helpers.rs:1094): to_usize (:1095)
// impl ToUsize for u32 (helpers.rs:1098): to_usize (:1099)
// trait ToU64 (helpers.rs:1106): to_u64 (:1107)
// impl ToU64 for usize (helpers.rs:1110): to_u64 (:1111)
// macro_rules! enter_trace_span (helpers.rs:1122)
// fn try_resolve_did (helpers.rs:25)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::helpers::EvalContextExt", "src/tools/miri/src/helpers.rs", "miri-eval", () => InterpCx.prototype, ["have_module", "eval_path", "eval_path_scalar", "eval_libc", "eval_libc_i16", "eval_libc_u16", "eval_libc_i32", "eval_libc_u32", "eval_libc_u64", "eval_windows", "eval_windows_u32", "eval_windows_u64", "libc_ty_layout", "windows_ty_layout", "libc_array_ty_layout", "try_project_field_named", "project_field_named", "write_int", "write_int_fields", "write_int_fields_named", "write_null", "ptr_is_null", "gen_random", "call_function", "call_thread_root_function", "visit_freeze_sensitive", "check_no_isolation", "reject_in_isolation", "assert_target_os", "check_target_os", "assert_target_os_is_unix", "target_os_is_unix", "deref_pointer_as", "deref_pointer_and_offset", "deref_pointer_and_read", "deref_pointer_and_write", "read_byte_slice", "read_c_str", "write_c_str", "read_c_str_with_char_size", "read_wide_str", "write_wide_str", "read_wchar_t_str", "frame_in_std", "mark_immutable", "get_twice_wide_int_ty", "expect_target_feature_for_intrinsic", "lookup_link_section", "mangle_internal_symbol"]);
stub_methods("miri::helpers::MiriMachine", "src/tools/miri/src/helpers.rs", "miri-eval", () => MiriMachine.prototype, ["current_user_relevant_span", "caller_span", "stack", "top_user_relevant_frame", "user_relevance"]);
