// Fill lane: `miri-eval` (plan-m6 wave 36): ported by this lane.
// Port of src/tools/miri/src/helpers.rs (crate `miri`, plan-m6 D2; lane miri-eval, wave 36).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2);
//   `let this = self.eval_context_ref()` is `const this_ = this.eval_context_ref()`.
// - `&[&str]` paths are `readonly string[]`; `{path:?}` is `debug_path` (`["a", "b"]`).
// - Interpreter methods defined in rustc_const_eval's class body (`eval_global`, `size_and_align_of_val`, `frame`, ...)
//   are typed with the CTFE provenance; their Miri values are the same objects (`as unknown as` at those calls, as
//   operator.ts's `MiriImmTy`).
// - `throw_machine_stop!(TerminationInfo::..)` boxes through miri-driver's `TerminationInfo_into_machine_stop`
//   (diagnostics.ts: `impl MachineStopType for TerminationInfo`, diagnostics.rs:113).
// - `getrandom::fill` (isolation off) is `unported` in M6 (plan-m6 D5).
// - `static DEDUP: Mutex<FxHashSet<String>>` (reject_in_isolation) is a module-level `Set` (process-global, as upstream).
import { type ImmTy, type MPlaceTy, type Pointer, type Scalar } from "./lib.ts";
import { type FrameExtra, type MiriInterpCx, MiriMachine, type Provenance, type RejectOpWith } from "./machine.ts";
import { type TerminationInfo, TerminationInfo_into_machine_stop } from "./diagnostics.ts";
import { imm_to_scalar } from "./operator.ts";
import { type ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Align, BackendRepr, debug_AlignFromBytesError, debug_Size, FieldIdx, Size } from "../rustc_abi/lib.ts";
import { InterpCx } from "../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../rustc_const_eval/interpret/machine.ts";
import { MPlaceTy as interp_MPlaceTy, PlaceTy_from_MPlaceTy, type Writeable } from "../rustc_const_eval/interpret/place.ts";
import { type Projectable } from "../rustc_const_eval/interpret/projection.ts";
import { type Frame, type ReturnContinuation } from "../rustc_const_eval/interpret/stack.gen.ts";
import { ValueVisitor_provided } from "../rustc_const_eval/interpret/visitor.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { DefKind, type Namespace, Res } from "../rustc_hir/def.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { type ModChild } from "../rustc_middle/middle/resolve.ts";
import { type ExportedSymbol, type SymbolExportInfo } from "../rustc_middle/middle/exported_symbols.ts";
import { alloc_range, type AllocRange } from "../rustc_middle/mir/interpret/allocation.ts";
import {
  debug_InterpErrorInfo,
  type InterpErrorKind,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as interp_Scalar,
} from "../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { debug_InterpErrorKind } from "../rustc_middle/mir/interpret/error.gen.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { mangle_internal_symbol as rustc_symbol_mangling_mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import { FnSigKind, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Immediate, OpTy_from_ImmTy } from "../rustc_const_eval/interpret/operand.ts";
import { type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_INDEX, type CrateNum, DefId, DefId_eq, debug_DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { debug_target_spec_other, spec } from "../rustc_target/lib.ts";
import { type Os } from "../rustc_target/spec/mod.ts";
import { debug_str, PLAIN } from "../std/fmt.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { Err, unwrap_result } from "../std/result.ts";

/** `Res<!>`'s `Id` is uninhabited (`ModChild::res`): its Debug is never called. */
const debug_never = (): string => panic("unreachable: `!` has no values");

/** `{path:?}` of a `&[&str]`. */
function debug_path(path: readonly string[]): string {
  return `[${path.map(debug_str).join(", ")}]`;
}

/** `Os`'s derived `PartialEq`. */
function Os_eq(a: Os, b: Os): boolean {
  return a.$ === b.$ && (a as { _0?: string })._0 === (b as { _0?: string })._0;
}

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/**
 * `throw_machine_stop!(info)` (`InterpErrorKind::MachineStop(Box::new(info))`).
 */
export function throw_machine_stop<T>(info: TerminationInfo): InterpResult<T> {
  const kind: InterpErrorKind = TerminationInfo_into_machine_stop(info);
  return Err(InterpErrorInfo_from_InterpErrorKind(kind));
}

/** PORT: an `InterpCx` class-body method's CTFE-typed `MPlaceTy` is Miri's (module header). */
function miri_mplace(p: unknown): MPlaceTy {
  return p as MPlaceTy;
}

/// Gets an instance for a path.
///
/// A `None` namespace indicates we are looking for a module.
// rustc: src/tools/miri/src/helpers.rs:25 try_resolve_did
function try_resolve_did(tcx: TyCtxt, path: readonly string[], namespace: Namespace | undefined): DefId | undefined {
  // let _trace = enter_trace_span!("try_resolve_did", ?path);

  /// Yield all children of the given item, that have the given name.
  // rustc: src/tools/miri/src/helpers.rs:29 find_children
  function* find_children(tcx: TyCtxt, item: DefId, name_: string): Generator<DefId> {
    const name = Symbol.intern(name_);
    for (const child of tcx.module_children(item) as readonly ModChild[]) {
      if (child.ident.name === name) {
        yield Res.def_id(child.res, debug_never);
      }
    }
  }

  // Take apart the path: leading crate, a sequence of modules, and potentially a final item.
  if (path.length === 0) panic("paths must have at least one segment");
  const crate_name = path[0]!;
  const rest = path.slice(1);
  let modules: readonly string[];
  let item: [string, Namespace] | undefined;
  if (namespace !== undefined) {
    if (rest.length === 0) panic("non-module paths must have at least 2 segments");
    const item_name = rest[rest.length - 1]!;
    modules = rest.slice(0, rest.length - 1);
    item = [item_name, namespace];
  } else {
    modules = rest;
    item = undefined;
  }

  // There may be more than one crate with this name. We try them all.
  // (This is particularly relevant when running `std` tests as then there are two `std` crates:
  // the one in the sysroot and the one locally built by `cargo test`.)
  // FIXME: can we prefer the one from the sysroot?
  crates: for (const krate of (tcx.crates(null) as readonly CrateNum[]).filter((krate) => Symbol.as_str(tcx.crate_name(krate)) === crate_name)) {
    let cur_item = new DefId(CRATE_DEF_INDEX, krate);
    // Go over the modules.
    for (const segment of modules) {
      let next_item: DefId | undefined;
      for (const item of find_children(tcx, cur_item, segment)) {
        if (tcx.def_kind(item).$ === "Mod") {
          next_item = item;
          break;
        }
      }
      if (next_item === undefined) {
        continue crates;
      }
      cur_item = next_item;
    }
    // Finally, look up the desired item in this module, if any.
    if (item !== undefined) {
      const [item_name, namespace] = item;
      let found: DefId | undefined;
      for (const item of find_children(tcx, cur_item, item_name)) {
        if (DefKind.ns(tcx.def_kind(item)) === namespace) {
          found = item;
          break;
        }
      }
      if (found === undefined) {
        continue crates;
      }
      return found;
    } else {
      // Just return the module.
      return cur_item;
    }
  }
  // Item not found in any of the crates with the right name.
  return undefined;
}


/// Gets an instance for a path; fails gracefully if the path does not exist.
// rustc: src/tools/miri/src/helpers.rs:89 try_resolve_path
export function try_resolve_path(tcx: TyCtxt, path: readonly string[], namespace: Namespace): Instance | undefined {
  const did = try_resolve_did(tcx, path, namespace);
  if (did === undefined) return undefined;
  return Instance.mono(tcx, did);
}

/// Gets an instance for a path.
// #[track_caller]
// rustc: src/tools/miri/src/helpers.rs:100 resolve_path
export function resolve_path(tcx: TyCtxt, path: readonly string[], namespace: Namespace): Instance {
  const r = try_resolve_path(tcx, path, namespace);
  if (r === undefined) panic(`failed to find required Rust item: ${debug_path(path)}`);
  return r;
}

/// Gets the layout of a type at a path.
// #[track_caller]
// PORT: `cx: &impl LayoutOf<'tcx>` is an `InterpCx` (every Miri caller passes one: helpers.rs, shims/sig.rs) or any
// object with `tcx_()` / `typing_env_()` / `layout_of`.
// rustc: src/tools/miri/src/helpers.rs:111 path_ty_layout
export function path_ty_layout(cx: { tcx_(): TyCtxt; typing_env_(): ReturnType<InterpCx["typing_env_"]>; layout_of(ty: Ty): ReturnType<InterpCx["layout_of"]> }, path: readonly string[]): TyAndLayout {
  // use rustc_middle::ty::layout::MaybeResult;

  const ty = Instance.ty(resolve_path(cx.tcx_(), path, "TypeNS"), cx.tcx_(), cx.typing_env_());
  const r = cx.layout_of(ty);
  if (r.$ === "Err") panic("called `Option::unwrap()` on a `None` value");
  return r._0;
}

/// Call `f` for each exported symbol.
// rustc: src/tools/miri/src/helpers.rs:119 iter_exported_symbols
export function iter_exported_symbols(tcx: TyCtxt, f: (cnum: CrateNum, def_id: DefId, used: boolean) => InterpResult): InterpResult {
  // First, the symbols in the local crate. We can't use `exported_symbols` here as that skips
  // `#[used]` statics (since `reachable_set` does not specifically include them in binary crates,
  // only in library crates). So we walk all HIR items ourselves instead.
  const crate_items = tcx.hir_crate_items(null) as { definitions(): Iterable<LocalDefId> };
  for (const def_id of crate_items.definitions()) {
    if (!DefKind.has_codegen_attrs(tcx.def_kind(def_id)) || tcx.is_foreign_item(def_id)) {
      continue;
    }
    const codegen_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
    const used =
      CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_COMPILER) ||
      CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_LINKER);
    if (!(used || CodegenFnAttrs.contains_extern_indicator(codegen_attrs))) {
      continue;
    }
    const r = f(LOCAL_CRATE, LocalDefId.to_def_id(def_id), used);
    if (r.$ === "Err") return r;
  }

  // Next, all our dependencies.
  // `dependency_formats` includes all the transitive information needed to link a crate, which is
  // what we need to dig out `exported_symbols` from all transitive dependencies.
  const dependency_formats = tcx.dependency_formats(null);
  // Find the dependencies of the executable we are running.
  const dependency_format = dependency_formats.get("Executable");
  if (dependency_format === undefined) panic("interpreting a non-executable crate");
  for (let num = 0; num < dependency_format.length; num++) {
    const linkage = dependency_format[num]!;
    if (linkage === "NotLinked") continue;
    const cnum = num as CrateNum;
    if (cnum === LOCAL_CRATE) {
      continue; // Already handled above
    }

    for (const [symbol, export_info] of tcx.exported_non_generic_symbols(cnum) as readonly [ExportedSymbol, SymbolExportInfo][]) {
      if (
        symbol.$ === "NonGeneric" &&
        // Sometimes Rust has to re-export FFI imports; skip those.
        !tcx.is_foreign_item(symbol._0)
      ) {
        const r = f(cnum, symbol._0, export_info.used);
        if (r.$ === "Err") return r;
      }
    }
  }
  return interp_ok(undefined);
}

declare module "../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
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
    try_project_field_named<P extends Projectable<P, Provenance>>(this: MiriInterpCx, base: P, name: string): InterpResult<P | undefined>;
    // helpers.rs:304
    project_field_named<P extends Projectable<P, Provenance>>(this: MiriInterpCx, base: P, name: string): InterpResult<P>;
    // helpers.rs:318 (PORT: `impl Into<i128>` is a bigint)
    write_int(this: MiriInterpCx, i: bigint, dest: Writeable<unknown, Provenance>): InterpResult;
    // helpers.rs:338
    write_int_fields(this: MiriInterpCx, values: readonly bigint[], dest: Writeable<unknown, Provenance>): InterpResult;
    // helpers.rs:353
    write_int_fields_named(this: MiriInterpCx, values: readonly [string, bigint][], dest: Writeable<unknown, Provenance>): InterpResult;
    // helpers.rs:367
    write_null(this: MiriInterpCx, dest: Writeable<unknown, Provenance>): InterpResult;
    // helpers.rs:372
    ptr_is_null(this: MiriInterpCx, ptr: Pointer): InterpResult<boolean>;
    // helpers.rs:377
    gen_random(this: MiriInterpCx, ptr: Pointer, len: bigint): InterpResult;
    // helpers.rs:407
    call_function(this: MiriInterpCx, f: Instance, caller_abi: ExternAbi, args: readonly ImmTy[], dest: MPlaceTy | undefined, cont: ReturnContinuation): InterpResult;
    // helpers.rs:447
    call_thread_root_function(this: MiriInterpCx, f: Instance, caller_abi: ExternAbi, args: readonly ImmTy[], dest: MPlaceTy | undefined, span: Span): InterpResult;
    // helpers.rs:465
    visit_freeze_sensitive(this: MiriInterpCx, place: MPlaceTy, size: Size, action: (range: AllocRange, frozen: boolean) => InterpResult): InterpResult;
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
    deref_pointer_as(this: MiriInterpCx, op: Projectable<unknown, Provenance>, layout: TyAndLayout): InterpResult<MPlaceTy>;
    // helpers.rs:695
    deref_pointer_and_offset(this: MiriInterpCx, op: Projectable<unknown, Provenance>, offset: bigint, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult<MPlaceTy>;
    // helpers.rs:712
    deref_pointer_and_read(this: MiriInterpCx, op: Projectable<unknown, Provenance>, offset: bigint, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult<Scalar>;
    // helpers.rs:724
    deref_pointer_and_write(this: MiriInterpCx, op: Projectable<unknown, Provenance>, offset: bigint, value: Scalar, base_layout: TyAndLayout, value_layout: TyAndLayout): InterpResult;
    // helpers.rs:738
    read_byte_slice(this: MiriInterpCx, slice: ImmTy): InterpResult<Uint8Array>;
    // helpers.rs:751
    read_c_str(this: MiriInterpCx, ptr: Pointer): InterpResult<Uint8Array>;
    // helpers.rs:781
    write_c_str(this: MiriInterpCx, c_str: Uint8Array, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]>;
    // helpers.rs:801 (PORT: `T: TryFrom<u128>` is the bigint itself; callers convert)
    read_c_str_with_char_size(this: MiriInterpCx, ptr: Pointer, size: Size, align: Align): InterpResult<bigint[]>;
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
    lookup_link_section(this: MiriInterpCx, include_name: (name: string) => boolean): InterpResult<[ImmTy, Span][]>;
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
    // helpers.rs:1036 (`Machine::stack` is `stack_` in the port, contract item 4, so no clash)
    stack(): readonly Frame<Provenance, FrameExtra>[];
    // helpers.rs:1040
    top_user_relevant_frame(): number | undefined;
    // helpers.rs:1045
    user_relevance(frame: Frame<Provenance>): number;
  }
}

/// Checks if the given crate/module exists.
// rustc: src/tools/miri/src/helpers.rs:171 have_module
InterpCx.prototype.have_module = function (this: MiriInterpCx, path: readonly string[]): boolean {
  return try_resolve_did(this.eval_context_ref().tcx.deref(), path, undefined) !== undefined;
};

/// Evaluates the scalar at the specified path.
// rustc: src/tools/miri/src/helpers.rs:176 eval_path
InterpCx.prototype.eval_path = function (this: MiriInterpCx, path: readonly string[]): MPlaceTy {
  const this_ = this.eval_context_ref();
  const instance = resolve_path(this_.tcx.deref(), path, "ValueNS");
  // We don't give a span -- this isn't actually used directly by the program anyway.
  const r = this_.eval_global(instance);
  if (r.$ === "Err") {
    return panic(`failed to evaluate required Rust item: ${debug_path(path)}\n${debug_InterpErrorInfo(r._0, PLAIN)}`);
  }
  return miri_mplace(r._0);
};

// rustc: src/tools/miri/src/helpers.rs:184 eval_path_scalar
InterpCx.prototype.eval_path_scalar = function (this: MiriInterpCx, path: readonly string[]): Scalar {
  const this_ = this.eval_context_ref();
  const val = this_.eval_path(path);
  const r = this_.read_scalar(val);
  if (r.$ === "Err") {
    return panic(`failed to read required Rust item: ${debug_path(path)}\n${debug_InterpErrorInfo(r._0, PLAIN)}`);
  }
  return r._0;
};

/// Helper function to get a `libc` constant as a `Scalar`.
// rustc: src/tools/miri/src/helpers.rs:192 eval_libc
InterpCx.prototype.eval_libc = function (this: MiriInterpCx, name: string): Scalar {
  if (this.eval_context_ref().tcx.deref().sess.target.os.$ === "Windows") {
    panic("`libc` crate is not reliably available on Windows targets; Miri should not use it there");
  }
  return this.eval_path_scalar(["libc", name]);
};

/** `.unwrap_or_else(|_err| panic!(..))` of a scalar read. */
function scalar_or_panic<T>(r: InterpResult<T>, msg: () => string): T {
  if (r.$ === "Err") return panic(msg());
  return r._0;
}

/// Helper function to get a `libc` constant as an `i16`.
// rustc: src/tools/miri/src/helpers.rs:202 eval_libc_i16
InterpCx.prototype.eval_libc_i16 = function (this: MiriInterpCx, name: string): number {
  // TODO: Cache the result.
  return scalar_or_panic(interp_Scalar.to_i16(this.eval_libc(name)), () => `required libc item has unexpected type (not \`i16\`): ${name}`);
};

/// Helper function to get a `libc` constant as an `u16`.
// rustc: src/tools/miri/src/helpers.rs:210 eval_libc_u16
InterpCx.prototype.eval_libc_u16 = function (this: MiriInterpCx, name: string): number {
  // TODO: Cache the result.
  return scalar_or_panic(interp_Scalar.to_u16(this.eval_libc(name)), () => `required libc item has unexpected type (not \`u16\`): ${name}`);
};

/// Helper function to get a `libc` constant as an `i32`.
// rustc: src/tools/miri/src/helpers.rs:218 eval_libc_i32
InterpCx.prototype.eval_libc_i32 = function (this: MiriInterpCx, name: string): number {
  // TODO: Cache the result.
  return scalar_or_panic(interp_Scalar.to_i32(this.eval_libc(name)), () => `required libc item has unexpected type (not \`i32\`): ${name}`);
};

/// Helper function to get a `libc` constant as an `u32`.
// rustc: src/tools/miri/src/helpers.rs:226 eval_libc_u32
InterpCx.prototype.eval_libc_u32 = function (this: MiriInterpCx, name: string): number {
  // TODO: Cache the result.
  return scalar_or_panic(interp_Scalar.to_u32(this.eval_libc(name)), () => `required libc item has unexpected type (not \`u32\`): ${name}`);
};

/// Helper function to get a `libc` constant as an `u64`.
// rustc: src/tools/miri/src/helpers.rs:234 eval_libc_u64
InterpCx.prototype.eval_libc_u64 = function (this: MiriInterpCx, name: string): bigint {
  // TODO: Cache the result.
  return scalar_or_panic(interp_Scalar.to_u64(this.eval_libc(name)), () => `required libc item has unexpected type (not \`u64\`): ${name}`);
};

/// Helper function to get a `windows` constant as a `Scalar`.
// rustc: src/tools/miri/src/helpers.rs:242 eval_windows
InterpCx.prototype.eval_windows = function (this: MiriInterpCx, module: string, name: string): Scalar {
  return this.eval_context_ref().eval_path_scalar(["std", "sys", "pal", "windows", module, name]);
};

/// Helper function to get a `windows` constant as a `u32`.
// rustc: src/tools/miri/src/helpers.rs:247 eval_windows_u32
InterpCx.prototype.eval_windows_u32 = function (this: MiriInterpCx, module: string, name: string): number {
  // TODO: Cache the result.
  return scalar_or_panic(
    interp_Scalar.to_u32(this.eval_windows(module, name)),
    () => `required Windows item has unexpected type (not \`u32\`): ${module}::${name}`,
  );
};

/// Helper function to get a `windows` constant as a `u64`.
// rustc: src/tools/miri/src/helpers.rs:255 eval_windows_u64
InterpCx.prototype.eval_windows_u64 = function (this: MiriInterpCx, module: string, name: string): bigint {
  // TODO: Cache the result.
  return scalar_or_panic(
    interp_Scalar.to_u64(this.eval_windows(module, name)),
    () => `required Windows item has unexpected type (not \`u64\`): ${module}::${name}`,
  );
};

/// Helper function to get the `TyAndLayout` of a `libc` type
// rustc: src/tools/miri/src/helpers.rs:263 libc_ty_layout
InterpCx.prototype.libc_ty_layout = function (this: MiriInterpCx, name: string): TyAndLayout {
  const this_ = this.eval_context_ref();
  if (this_.tcx.deref().sess.target.os.$ === "Windows") {
    panic("`libc` crate is not reliably available on Windows targets; Miri should not use it there");
  }
  return path_ty_layout(this_, ["libc", name]);
};

/// Helper function to get the `TyAndLayout` of a `windows` type
// rustc: src/tools/miri/src/helpers.rs:274 windows_ty_layout
InterpCx.prototype.windows_ty_layout = function (this: MiriInterpCx, name: string): TyAndLayout {
  const this_ = this.eval_context_ref();
  return path_ty_layout(this_, ["std", "sys", "pal", "windows", "c", name]);
};

/// Helper function to get `TyAndLayout` of an array that consists of `libc` type.
// rustc: src/tools/miri/src/helpers.rs:280 libc_array_ty_layout
InterpCx.prototype.libc_array_ty_layout = function (this: MiriInterpCx, name: string, size: bigint): TyAndLayout {
  const this_ = this.eval_context_ref();
  const elem_ty_layout = this_.libc_ty_layout(name);
  const array_ty = Ty.new_array(this_.tcx.deref(), elem_ty_layout.ty, Number(size));
  return unwrap_result(this_.layout_of(array_ty), debug_InterpErrorKind);
};

/// Project to the given *named* field (which must be a struct or union type).
// rustc: src/tools/miri/src/helpers.rs:288 try_project_field_named
InterpCx.prototype.try_project_field_named = function <P extends Projectable<P, Provenance>>(
  this: MiriInterpCx,
  base: P,
  name: string,
): InterpResult<P | undefined> {
  const this_ = this.eval_context_ref();
  const adt = base.layout_().ty.ty_adt_def();
  if (adt === undefined) panic("called `Option::unwrap()` on a `None` value");
  const fields = adt.non_enum_variant().fields;
  for (let idx = 0; idx < fields.length; idx++) {
    const field = fields[idx]!;
    if (Symbol.as_str(field.name) === name) {
      const r = this_.project_field(base, FieldIdx.from_usize(idx));
      if (r.$ === "Err") return r;
      return interp_ok(r._0);
    }
  }
  return interp_ok(undefined);
};

/// Project to the given *named* field (which must be a struct or union type).
// rustc: src/tools/miri/src/helpers.rs:304 project_field_named
InterpCx.prototype.project_field_named = function <P extends Projectable<P, Provenance>>(this: MiriInterpCx, base: P, name: string): InterpResult<P> {
  const r = this.try_project_field_named(base, name);
  if (r.$ === "Err") return r;
  const p = r._0;
  if (p === undefined) return bug(`no field named ${name} in type ${display_Ty(base.layout_().ty)}`);
  return interp_ok(p);
};

/// Write an int of the appropriate size to `dest`. The target type may be signed or unsigned,
/// we try to do the right thing anyway. `i128` can fit all integer types except for `u128` so
/// this method is fine for almost all integer types.
// rustc: src/tools/miri/src/helpers.rs:318 write_int
InterpCx.prototype.write_int = function (this: MiriInterpCx, i: bigint, dest: Writeable<unknown, Provenance>): InterpResult {
  assert(BackendRepr.is_scalar(dest.layout_().backend_repr), () => `write_int on non-scalar type ${display_Ty(dest.layout_().ty)}`);
  let val: Scalar;
  if (BackendRepr.is_signed(dest.layout_().backend_repr)) {
    val = interp_Scalar.from_int(i, dest.layout_().size);
  } else {
    // `unwrap` can only fail here if `i` is negative
    if (i < 0n) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
    val = interp_Scalar.from_uint(i, dest.layout_().size);
  }
  return this.eval_context_mut().write_scalar(val, dest);
};

/// Write the first N fields of the given place.
// rustc: src/tools/miri/src/helpers.rs:338 write_int_fields
InterpCx.prototype.write_int_fields = function (this: MiriInterpCx, values: readonly bigint[], dest: Writeable<unknown, Provenance>): InterpResult {
  const this_ = this.eval_context_mut();
  for (let idx_ = 0; idx_ < values.length; idx_++) {
    const val = values[idx_]!;
    const idx = FieldIdx.from_usize(idx_);
    const field = this_.project_field(dest as never as AnyWriteable, idx);
    if (field.$ === "Err") return field;
    const r = this_.write_int(val, field._0 as Writeable<unknown, Provenance>);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/** PORT: an `&impl Writeable` passed on to a generic `P: Projectable` fn (rustc_const_eval intrinsics.ts precedent). */
type AnyWriteable = Projectable<AnyWriteable, Provenance>;

/// Write the given fields of the given place.
// rustc: src/tools/miri/src/helpers.rs:353 write_int_fields_named
InterpCx.prototype.write_int_fields_named = function (this: MiriInterpCx, values: readonly [string, bigint][], dest: Writeable<unknown, Provenance>): InterpResult {
  const this_ = this.eval_context_mut();
  for (const [name, val] of values) {
    const field = this_.project_field_named(dest as never as AnyWriteable, name);
    if (field.$ === "Err") return field;
    const r = this_.write_int(val, field._0 as never as Writeable<unknown, Provenance>);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// Write a 0 of the appropriate size to `dest`.
// rustc: src/tools/miri/src/helpers.rs:367 write_null
InterpCx.prototype.write_null = function (this: MiriInterpCx, dest: Writeable<unknown, Provenance>): InterpResult {
  return this.write_int(0n, dest);
};

/// Test if this pointer equals 0.
// rustc: src/tools/miri/src/helpers.rs:372 ptr_is_null
InterpCx.prototype.ptr_is_null = function (this: MiriInterpCx, ptr: Pointer): InterpResult<boolean> {
  return interp_ok(ptr.addr(this.machine.Provenance).bytes_u64() === 0n);
};

/// Generate some random bytes, and write them to `dest`.
// rustc: src/tools/miri/src/helpers.rs:377 gen_random
InterpCx.prototype.gen_random = function (this: MiriInterpCx, ptr: Pointer, len: bigint): InterpResult {
  // Some programs pass in a null pointer and a length of 0
  // to their platform's random-generation function (e.g. getrandom())
  // on Linux. For compatibility with these programs, we don't perform
  // any additional checks - it's okay if the pointer is invalid,
  // since we wouldn't actually be writing to it.
  if (len === 0n) {
    return interp_ok(undefined);
  }
  const this_ = this.eval_context_mut();

  const data = new Uint8Array(Number(len));

  if (this_.machine.communicate()) {
    // Fill the buffer using the host's rng.
    // getrandom::fill(&mut data)
    //     .map_err(|err| err_unsup_format!("host getrandom failed: {}", err))?;
    return unported("miri::helpers::gen_random: host getrandom (isolation off; plan-m6 D5)");
  } else {
    const rng = this_.machine.rng;
    rng.fill_bytes(data);
  }

  return this_.write_bytes_ptr(ptr, data.values());
};

/// Call a function: Push the stack frame and pass the arguments.
/// For now, arguments must be scalars (so that the caller does not have to know the layout).
///
/// If you do not provide a return place, a dangling zero-sized place will be created
/// for your convenience. This is only valid if the return type is `()`.
// rustc: src/tools/miri/src/helpers.rs:407 call_function
InterpCx.prototype.call_function = function (
  this: MiriInterpCx,
  f: Instance,
  caller_abi: ExternAbi,
  args: readonly ImmTy[],
  dest: MPlaceTy | undefined,
  cont: ReturnContinuation,
): InterpResult {
  const this_ = this.eval_context_mut();

  // Get MIR.
  const mir = this_.load_mir(f.def, undefined);
  if (mir.$ === "Err") return mir;
  let dest_: MPlaceTy;
  if (dest !== undefined) {
    dest_ = dest;
  } else {
    dest_ = miri_mplace(interp_MPlaceTy.fake_alloc_zst(this_.machine.layouts.unit));
  }

  // Construct a function pointer type representing the caller perspective.
  const sig = this_.tcx.deref().mk_fn_sig(
    args.map((a) => a.layout.ty),
    dest_.layout.ty,
    // FIXME(splat): Do we need to set splatted here?
    // (Currently this also ignores c_variadic)
    FnSigKind.set_safety(FnSigKind.set_abi(FnSigKind.default_(), caller_abi), "Safe"),
  );
  const caller_fn_abi = this_.fn_abi_of_fn_ptr(Binder.dummy(sig, fold_FnSig), RawList.empty());
  if (caller_fn_abi.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(caller_fn_abi._0));

  // This will also show proper errors if there is any ABI mismatch.
  return this_.init_stack_frame(
    f,
    mir._0,
    caller_fn_abi._0,
    args.map((a) => ({ $: "Copy" as const, _0: OpTy_from_ImmTy(a as never) as never })),
    /*with_caller_location*/ false,
    PlaceTy_from_MPlaceTy(dest_ as never) as never,
    cont,
  );
};

/// Call a function in an "empty" thread.
// rustc: src/tools/miri/src/helpers.rs:447 call_thread_root_function
InterpCx.prototype.call_thread_root_function = function (
  this: MiriInterpCx,
  f: Instance,
  caller_abi: ExternAbi,
  args: readonly ImmTy[],
  dest: MPlaceTy | undefined,
  span: Span,
): InterpResult {
  const this_ = this.eval_context_mut();
  assert(this_.active_thread_stack().length === 0, "assertion failed: this.active_thread_stack().is_empty()");
  assert(Span.is_dummy(this_.active_thread_ref().origin_span), "assertion failed: this.active_thread_ref().origin_span.is_dummy()");
  this_.active_thread_mut().origin_span = span;
  return this_.call_function(f, caller_abi, args, dest, { $: "Stop", cleanup: true });
};

/// Visits the memory covered by `place`, sensitive to freezing: the 2nd parameter
/// of `action` will be true if this is frozen, false if this is in an `UnsafeCell`.
/// The range is relative to `place`.
// rustc: src/tools/miri/src/helpers.rs:465 visit_freeze_sensitive
InterpCx.prototype.visit_freeze_sensitive = function (
  this: MiriInterpCx,
  place: MPlaceTy,
  size: Size,
  action: (range: AllocRange, frozen: boolean) => InterpResult,
): InterpResult {
  const this_ = this.eval_context_ref();
  // trace!("visit_frozen(place={:?}, size={:?})", *place, size);
  // debug_assert_eq!(
  //     size,
  //     this.size_and_align_of_val(place)?
  //         .map(|(size, _)| size)
  //         .unwrap_or_else(|| place.layout.size)
  // );
  // Store how far we proceeded into the place so far. Everything to the left of
  // this offset has already been handled, in the sense that the frozen parts
  // have had `action` called on them.
  const Prov = this_.machine.Provenance;
  const start_addr = place.ptr().addr(Prov);
  let cur_addr = start_addr;
  // Called when we detected an `UnsafeCell` at the given offset and size.
  // Calls `action` and advances `cur_ptr`.
  const unsafe_cell_action = (unsafe_cell_ptr: Pointer, unsafe_cell_size: Size): InterpResult => {
    // We assume that we are given the fields in increasing offset order,
    // and nothing else changes.
    const unsafe_cell_addr = unsafe_cell_ptr.addr(Prov);
    assert(unsafe_cell_addr.bytes_u64() >= cur_addr.bytes_u64(), "assertion failed: unsafe_cell_addr >= cur_addr");
    const frozen_size = unsafe_cell_addr.sub(cur_addr);
    // Everything between the cur_ptr and this `UnsafeCell` is frozen.
    if (frozen_size.bytes_u64() !== 0n) {
      const r = action(alloc_range(cur_addr.sub(start_addr), frozen_size), /*frozen*/ true);
      if (r.$ === "Err") return r;
    }
    cur_addr = cur_addr.add(frozen_size);
    // This `UnsafeCell` is NOT frozen.
    if (unsafe_cell_size.bytes_u64() !== 0n) {
      const r = action(alloc_range(cur_addr.sub(start_addr), unsafe_cell_size), /*frozen*/ false);
      if (r.$ === "Err") return r;
    }
    cur_addr = cur_addr.add(unsafe_cell_size);
    // Done
    return interp_ok(undefined);
  };
  // Run a visitor
  {
    const visitor = new UnsafeCellVisitor(this_, (place: MPlaceTy): InterpResult => {
      // trace!("unsafe_cell_action on {:?}", place.ptr());
      // We need a size to go on.
      const sa = this_.size_and_align_of_val(place as never);
      if (sa.$ === "Err") return sa;
      const unsafe_cell_size =
        sa._0 !== undefined
          ? sa._0[0]
          : // for extern types, just cover what we can
            place.layout.size;
      // Now handle this `UnsafeCell`, unless it is empty.
      if (unsafe_cell_size.bytes_u64() !== 0n) {
        return unsafe_cell_action(place.ptr(), unsafe_cell_size);
      } else {
        return interp_ok(undefined);
      }
    });
    const r = visitor.visit_value(place as never);
    if (r.$ === "Err") return r;
  }
  // The part between the end_ptr and the end of the place is also frozen.
  // So pretend there is a 0-sized `UnsafeCell` at the end.
  const r = unsafe_cell_action(place.ptr().wrapping_offset(size, this_), Size.ZERO);
  if (r.$ === "Err") return r;
  // Done!
  return interp_ok(undefined);
};

/// Visiting the memory covered by a `MemPlace`, being aware of
/// whether we are inside an `UnsafeCell` or not.
// PORT: the fn-local `struct UnsafeCellVisitor` of `visit_freeze_sensitive` (helpers.rs:538), a `ValueVisitor_provided`
// subclass (visitor.ts); `V = MPlaceTy`. `ValueVisitor_provided`'s `V` is bound with the CTFE provenance, so the
// visitor is typed over rustc_const_eval's `MPlaceTy` and casts at its two hooks (module header).
class UnsafeCellVisitor extends ValueVisitor_provided<interp_MPlaceTy> {
  constructor(
    public ecx: MiriInterpCx,
    public unsafe_cell_action: (place: MPlaceTy) => InterpResult,
  ) {
    super();
  }

  V_from_MPlaceTy(mplace: interp_MPlaceTy): interp_MPlaceTy {
    return mplace;
  }

  // #[inline(always)]
  // rustc: src/tools/miri/src/helpers.rs:553 ecx
  ecx_(): InterpCx {
    return this.ecx as unknown as InterpCx;
  }

  // Hook to detect `UnsafeCell`.
  // rustc: src/tools/miri/src/helpers.rs:558 visit_value
  override visit_value(v_: interp_MPlaceTy): InterpResult {
    const v = miri_mplace(v_);
    // trace!("UnsafeCellVisitor: {:?} {:?}", *v, v.layout.ty);
    const kind = v.layout.ty.kind();
    let is_unsafe_cell: boolean;
    switch (kind.$) {
      case "Adt":
        {
        const unsafe_cell = this.ecx.tcx.deref().lang_items().unsafe_cell_type();
        is_unsafe_cell = unsafe_cell !== undefined && DefId_eq(kind._0.did(), unsafe_cell);
      }
        break;
      default:
        is_unsafe_cell = false;
    }
    if (is_unsafe_cell) {
      // We do not have to recurse further, this is an `UnsafeCell`.
      return this.unsafe_cell_action(v);
    } else if (this.ecx.type_is_freeze(v.layout.ty)) {
      // This is `Freeze`, there cannot be an `UnsafeCell`
      return interp_ok(undefined);
    } else if (v.layout.fields.$ === "Union") {
      // A (non-frozen) union. We fall back to whatever the type says.
      return this.unsafe_cell_action(v);
    } else {
      // We want to not actually read from memory for this visit. So, before
      // walking this value, we have to make sure it is not a
      // `Variants::Multiple`.
      // FIXME: the current logic here is layout-dependent, so enums with
      // multiple variants where all but 1 are uninhabited will be recursed into.
      // Is that truly what we want?
      switch (v.layout.variants.$) {
        case "Multiple": {
          // A multi-variant enum, or coroutine, or so.
          // Treat this like a union: without reading from memory,
          // we cannot determine the variant we are in. Reading from
          // memory would be subject to Stacked Borrows rules, leading
          // to all sorts of "funny" recursion.
          // We only end up here if the type is *not* freeze, so we just call the
          // `UnsafeCell` action.
          return this.unsafe_cell_action(v);
        }
        case "Single":
        case "Empty": {
          // Proceed further, try to find where exactly that `UnsafeCell`
          // is hiding.
          return this.walk_value(v_);
        }
      }
    }
  }

  // rustc: src/tools/miri/src/helpers.rs:601 visit_union
  override visit_union(_v: interp_MPlaceTy, _fields: number): InterpResult {
    return bug("we should have already handled unions in `visit_value`");
  }
}

/// Helper function used inside the shims of foreign functions to check that isolation is
/// disabled. It returns an error using the `name` of the foreign function if this is not the
/// case.
// rustc: src/tools/miri/src/helpers.rs:614 check_no_isolation
InterpCx.prototype.check_no_isolation = function (this: MiriInterpCx, name: string): InterpResult {
  if (!this.eval_context_ref().machine.communicate()) {
    const r = this.reject_in_isolation(name, "Abort");
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

// Deduplicate these warnings *by shim* (not by span)
// static DEDUP: Mutex<FxHashSet<String>> = Mutex::new(FxHashSet::with_hasher(FxBuildHasher));
const DEDUP = new Set<string>();

/// Helper function used inside the shims of foreign functions which reject the op
/// when isolation is enabled. It is used to print a warning/backtrace about the rejection.
// rustc: src/tools/miri/src/helpers.rs:623 reject_in_isolation
InterpCx.prototype.reject_in_isolation = function (this: MiriInterpCx, op_name: string, reject_with: RejectOpWith): InterpResult {
  const this_ = this.eval_context_ref();
  switch (reject_with) {
    case "Abort":
      return isolation_abort_error(op_name);
    case "WarningWithoutBacktrace": {
      const emitted_warnings = DEDUP;
      if (!emitted_warnings.has(op_name)) {
        // First time we are seeing this.
        emitted_warnings.add(op_name);
        this_.tcx.deref().dcx().warn(`${op_name} was made to return an error due to isolation`);
      }

      return interp_ok(undefined);
    }
    case "Warning": {
      this_.emit_diagnostic({ $: "RejectedIsolatedOp", _0: op_name });
      return interp_ok(undefined);
    }
    case "NoWarning":
      return interp_ok(undefined); // no warning
  }
};

/// Helper function used inside the shims of foreign functions to assert that the target OS
/// is `target_os`. It panics showing a message with the `name` of the foreign function
/// if this is not the case.
// rustc: src/tools/miri/src/helpers.rs:653 assert_target_os
InterpCx.prototype.assert_target_os = function (this: MiriInterpCx, target_os: Os, name: string): void {
  const left = this.eval_context_ref().tcx.deref().sess.target.os;
  if (!Os_eq(left, target_os)) {
    panic(
      `assertion \`left == right\` failed: \`${name}\` is only available on the \`${spec.Os.display(target_os)}\` target OS\n  left: ${debug_target_spec_other(left)}\n right: ${debug_target_spec_other(target_os)}`,
    );
  }
};

/// Helper function used inside shims of foreign functions to check that the target OS
/// is one of `target_oses`. It returns an error containing the `name` of the foreign function
/// in a message if this is not the case.
// rustc: src/tools/miri/src/helpers.rs:664 check_target_os
InterpCx.prototype.check_target_os = function (this: MiriInterpCx, target_oses: readonly Os[], name: Symbol): InterpResult {
  const target_os = this.eval_context_ref().tcx.deref().sess.target.os;
  if (!target_oses.some((os) => Os_eq(os, target_os))) {
    return throw_unsup_format(`\`${Symbol.as_str(name)}\` is not supported on ${spec.Os.display(target_os)}`);
  }
  return interp_ok(undefined);
};

/// Helper function used inside the shims of foreign functions to assert that the target OS
/// is part of the UNIX family. It panics showing a message with the `name` of the foreign function
/// if this is not the case.
// rustc: src/tools/miri/src/helpers.rs:675 assert_target_os_is_unix
InterpCx.prototype.assert_target_os_is_unix = function (this: MiriInterpCx, name: string): void {
  assert(this.target_os_is_unix(), () => `\`${name}\` is only available for unix targets`);
};

// rustc: src/tools/miri/src/helpers.rs:679 target_os_is_unix
InterpCx.prototype.target_os_is_unix = function (this: MiriInterpCx): boolean {
  return this.eval_context_ref().tcx.deref().sess.target.families.some((f) => f === "unix");
};

/// Dereference a pointer operand to a place using `layout` instead of the pointer's declared type
// rustc: src/tools/miri/src/helpers.rs:684 deref_pointer_as
InterpCx.prototype.deref_pointer_as = function (this: MiriInterpCx, op: Projectable<unknown, Provenance>, layout: TyAndLayout): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_ref();
  const ptr = this_.read_pointer(op);
  if (ptr.$ === "Err") return ptr;
  return interp_ok(this_.ptr_to_mplace(ptr._0, layout));
};

/// Calculates the MPlaceTy given the offset and layout of an access on an operand
// rustc: src/tools/miri/src/helpers.rs:695 deref_pointer_and_offset
InterpCx.prototype.deref_pointer_and_offset = function (
  this: MiriInterpCx,
  op: Projectable<unknown, Provenance>,
  offset: bigint,
  base_layout: TyAndLayout,
  value_layout: TyAndLayout,
): InterpResult<MPlaceTy> {
  const this_ = this.eval_context_ref();
  const op_place = this_.deref_pointer_as(op, base_layout);
  if (op_place.$ === "Err") return op_place;
  const offset_ = Size.from_bytes(offset);

  // Ensure that the access is within bounds.
  assert(base_layout.size.bytes_u64() >= offset_.add(value_layout.size).bytes_u64(), "assertion failed: base_layout.size >= offset + value_layout.size");
  const value_place = op_place._0.offset(offset_, value_layout, this_ as never);
  if (value_place.$ === "Err") return value_place;
  return interp_ok(value_place._0);
};

// rustc: src/tools/miri/src/helpers.rs:712 deref_pointer_and_read
InterpCx.prototype.deref_pointer_and_read = function (
  this: MiriInterpCx,
  op: Projectable<unknown, Provenance>,
  offset: bigint,
  base_layout: TyAndLayout,
  value_layout: TyAndLayout,
): InterpResult<Scalar> {
  const this_ = this.eval_context_ref();
  const value_place = this_.deref_pointer_and_offset(op, offset, base_layout, value_layout);
  if (value_place.$ === "Err") return value_place;
  return this_.read_scalar(value_place._0);
};

// rustc: src/tools/miri/src/helpers.rs:724 deref_pointer_and_write
InterpCx.prototype.deref_pointer_and_write = function (
  this: MiriInterpCx,
  op: Projectable<unknown, Provenance>,
  offset: bigint,
  value: Scalar,
  base_layout: TyAndLayout,
  value_layout: TyAndLayout,
): InterpResult {
  const this_ = this.eval_context_mut();
  const value_place = this_.deref_pointer_and_offset(op, offset, base_layout, value_layout);
  if (value_place.$ === "Err") return value_place;
  return this_.write_scalar(value, value_place._0);
};

/// Read bytes from a byte slice.
// rustc: src/tools/miri/src/helpers.rs:738 read_byte_slice
InterpCx.prototype.read_byte_slice = function (this: MiriInterpCx, slice: ImmTy): InterpResult<Uint8Array> {
  const this_ = this.eval_context_ref();
  const [ptr_s, len_s] = (Immediate.to_scalar_pair as unknown as (imm: ImmTy["imm"]) => [Scalar, Scalar])(slice.imm);
  const ptr = interp_Scalar.to_pointer(ptr_s, this_);
  const len = interp_Scalar.to_target_usize(len_s, this_);
  if (len.$ === "Err") return len;
  const bytes = this_.read_bytes_ptr_strip_provenance(ptr, Size.from_bytes(len._0));
  if (bytes.$ === "Err") return bytes;
  return interp_ok(bytes._0);
};

/// Read a sequence of bytes until the first null terminator.
// rustc: src/tools/miri/src/helpers.rs:751 read_c_str
InterpCx.prototype.read_c_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<Uint8Array> {
  const this_ = this.eval_context_ref();
  const size1 = Size.from_bytes(1n);

  // Step 1: determine the length.
  let len = Size.ZERO;
  for (;;) {
    // FIXME: We are re-getting the allocation each time around the loop.
    // Would be nice if we could somehow "extend" an existing AllocRange.
    const alloc_r = this_.get_ptr_alloc(ptr.wrapping_offset(len, this_), size1);
    if (alloc_r.$ === "Err") return alloc_r;
    const alloc = alloc_r._0;
    if (alloc === undefined) panic("called `Option::unwrap()` on a `None` value"); // not a ZST, so we will get a result
    const int = alloc.read_integer(alloc_range(Size.ZERO, size1));
    if (int.$ === "Err") return int;
    const byte = interp_Scalar.to_u8(int._0);
    if (byte.$ === "Err") return byte;
    if (byte._0 === 0) {
      break;
    } else {
      len = len.add(size1);
    }
  }

  // Step 2: get the bytes.
  return this_.read_bytes_ptr_strip_provenance(ptr, len);
};

/// Helper function to write a sequence of bytes with an added null-terminator, which is what
/// the Unix APIs usually handle. This function returns `Ok((false, length))` without trying
/// to write if `size` is not large enough to fit the contents of `c_str` plus a null
/// terminator. It returns `Ok((true, length))` if the writing process was successful. The
/// string length returned does include the null terminator.
// rustc: src/tools/miri/src/helpers.rs:781 write_c_str
InterpCx.prototype.write_c_str = function (this: MiriInterpCx, c_str: Uint8Array, ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  // If `size` is smaller or equal than `bytes.len()`, writing `bytes` plus the required null
  // terminator to memory using the `ptr` pointer would cause an out-of-bounds access.
  let string_length = BigInt(c_str.length);
  string_length = string_length + 1n;
  if (size < string_length) {
    return interp_ok([false, string_length]);
  }
  const bytes = new Uint8Array(c_str.length + 1);
  bytes.set(c_str);
  const r = this.eval_context_mut().write_bytes_ptr(ptr, bytes.values());
  if (r.$ === "Err") return r;
  return interp_ok([true, string_length]);
};

/// Helper function to read a sequence of unsigned integers of the given size and alignment
/// until the first null terminator.
// rustc: src/tools/miri/src/helpers.rs:801 read_c_str_with_char_size
InterpCx.prototype.read_c_str_with_char_size = function (this: MiriInterpCx, ptr: Pointer, size: Size, align: Align): InterpResult<bigint[]> {
  assert(size.bytes_u64() !== 0n, "assertion `left != right` failed\n  left: Size(0 bytes)\n right: Size(0 bytes)");

  const this_ = this.eval_context_ref();

  const a = this_.check_ptr_align(ptr, align);
  if (a.$ === "Err") return a;

  const wchars: bigint[] = [];
  for (;;) {
    // FIXME: We are re-getting the allocation each time around the loop.
    // Would be nice if we could somehow "extend" an existing AllocRange.
    const alloc_r = this_.get_ptr_alloc(ptr, size);
    if (alloc_r.$ === "Err") return alloc_r;
    const alloc = alloc_r._0;
    if (alloc === undefined) panic("called `Option::unwrap()` on a `None` value"); // not a ZST, so we will get a result
    const int = alloc.read_integer(alloc_range(Size.ZERO, size));
    if (int.$ === "Err") return int;
    const wchar_int = interp_Scalar.to_bits(int._0, size);
    if (wchar_int.$ === "Err") return wchar_int;
    if (wchar_int._0 === 0n) {
      break;
    } else {
      wchars.push(wchar_int._0);
      ptr = ptr.wrapping_offset(size, this_);
    }
  }

  return interp_ok(wchars);
};

/// Read a sequence of u16 until the first null terminator.
// rustc: src/tools/miri/src/helpers.rs:835 read_wide_str
InterpCx.prototype.read_wide_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<number[]> {
  const r = this.read_c_str_with_char_size(ptr, Size.from_bytes(2n), unwrap_result(Align.from_bytes(2n), debug_AlignFromBytesError));
  if (r.$ === "Err") return r;
  return interp_ok(r._0.map(Number));
};

/// Helper function to write a sequence of u16 with an added 0x0000-terminator, which is what
/// the Windows APIs usually handle. This function returns `Ok((false, length))` without trying
/// to write if `size` is not large enough to fit the contents of `os_string` plus a null
/// terminator. It returns `Ok((true, length))` if the writing process was successful. The
/// string length returned does include the null terminator. Length is measured in units of
/// `u16.`
// rustc: src/tools/miri/src/helpers.rs:845 write_wide_str
InterpCx.prototype.write_wide_str = function (this: MiriInterpCx, wide_str: readonly number[], ptr: Pointer, size: bigint): InterpResult<[boolean, bigint]> {
  // If `size` is smaller or equal than `bytes.len()`, writing `bytes` plus the required
  // 0x0000 terminator to memory would cause an out-of-bounds access.
  let string_length = BigInt(wide_str.length);
  string_length = string_length + 1n;
  if (size < string_length) {
    return interp_ok([false, string_length]);
  }

  // Store the UTF-16 string.
  const size2 = Size.from_bytes(2n);
  const this_ = this.eval_context_mut();
  const a = this_.check_ptr_align(ptr, unwrap_result(Align.from_bytes(2n), debug_AlignFromBytesError));
  if (a.$ === "Err") return a;
  const alloc_r = this_.get_ptr_alloc_mut(ptr, size2.mul(string_length));
  if (alloc_r.$ === "Err") return alloc_r;
  const alloc = alloc_r._0;
  if (alloc === undefined) panic("called `Option::unwrap()` on a `None` value"); // not a ZST, so we will get a result
  const chars = [...wide_str, 0x0000];
  for (let offset = 0; offset < chars.length; offset++) {
    const wchar = chars[offset]!;
    const r = alloc.write_scalar(alloc_range(size2.mul(BigInt(offset)), size2), interp_Scalar.from_u16(wchar));
    if (r.$ === "Err") return r;
  }
  return interp_ok([true, string_length]);
};

/// Read a sequence of wchar_t until the first null terminator.
/// Always returns a `Vec<u32>` no matter the size of `wchar_t`.
// rustc: src/tools/miri/src/helpers.rs:873 read_wchar_t_str
InterpCx.prototype.read_wchar_t_str = function (this: MiriInterpCx, ptr: Pointer): InterpResult<number[]> {
  const this_ = this.eval_context_ref();
  let wchar_t: TyAndLayout;
  if (this_.tcx.deref().sess.target.os.$ === "Windows") {
    // We don't have libc on Windows so we have to hard-code the type ourselves.
    wchar_t = this_.machine.layouts.u16;
  } else {
    wchar_t = this_.libc_ty_layout("wchar_t");
  }
  const r = this.read_c_str_with_char_size(ptr, wchar_t.size, wchar_t.align.abi);
  if (r.$ === "Err") return r;
  return interp_ok(r._0.map(Number));
};

// rustc: src/tools/miri/src/helpers.rs:884 frame_in_std
InterpCx.prototype.frame_in_std = function (this: MiriInterpCx): boolean {
  const this_ = this.eval_context_ref();
  const frame = this_.frame();
  // Make an attempt to get at the instance of the function this is inlined from.
  const instance: Instance | undefined = (() => {
    const source_info = frame.current_source_info();
    if (source_info === undefined) return undefined;
    const scope = source_info.scope;
    const inlined_parent = frame.body_().source_scopes[scope]!.inlined_parent_scope;
    if (inlined_parent === undefined) return undefined;
    const source = frame.body_().source_scopes[inlined_parent]!;
    if (source.inlined === undefined) panic("inlined_parent_scope points to scope without inline info");
    return source.inlined[0];
  })();
  // Fall back to the instance of the function itself.
  const instance_ = instance ?? frame.instance_();
  // Now check the crate it is in. We could try to be clever here and e.g. check if this is
  // the same crate as `start_fn`, but that would not work for running std tests in Miri, so
  // we'd need some more hacks anyway. So we just check the name of the crate. If someone
  // calls their crate `std` then we'll just let them keep the pieces.
  const frame_crate = this_.tcx.deref().def_path(Instance.def_id(instance_)).krate;
  const crate_name = this_.tcx.deref().crate_name(frame_crate);
  const crate_name_ = Symbol.as_str(crate_name);
  return crate_name_ === "std";
};

/// Mark a machine allocation that was just created as immutable.
// rustc: src/tools/miri/src/helpers.rs:907 mark_immutable
InterpCx.prototype.mark_immutable = function (this: MiriInterpCx, mplace: MPlaceTy): void {
  const this_ = this.eval_context_mut();
  // This got just allocated, so there definitely is a pointer here.
  const provenance = unwrap_result(mplace.ptr().into_pointer_or_addr(), debug_Size).provenance;
  const alloc_id = this_.machine.Provenance.get_alloc_id(provenance);
  if (alloc_id === undefined) panic("called `Option::unwrap()` on a `None` value");
  const r = this_.alloc_mark_immutable(alloc_id);
  unwrap_result(r, debug_InterpErrorInfo);
};

/// Returns an integer type that is twice wide as `ty`
// rustc: src/tools/miri/src/helpers.rs:915 get_twice_wide_int_ty
InterpCx.prototype.get_twice_wide_int_ty = function (this: MiriInterpCx, ty: Ty): Ty {
  const this_ = this.eval_context_ref();
  const types = this_.tcx.deref().types;
  const kind = ty.kind();
  // Unsigned
  if (kind.$ === "Uint" && kind._0 === "U8") return types.u16;
  if (kind.$ === "Uint" && kind._0 === "U16") return types.u32;
  if (kind.$ === "Uint" && kind._0 === "U32") return types.u64;
  if (kind.$ === "Uint" && kind._0 === "U64") return types.u128;
  // Signed
  if (kind.$ === "Int" && kind._0 === "I8") return types.i16;
  if (kind.$ === "Int" && kind._0 === "I16") return types.i32;
  if (kind.$ === "Int" && kind._0 === "I32") return types.i64;
  if (kind.$ === "Int" && kind._0 === "I64") return types.i128;
  return span_bug(this_.cur_span(), `unexpected type: ${debug_Ty(ty, PLAIN)}`);
};

/// Checks that target feature `target_feature` is enabled.
///
/// If not enabled, emits an UB error that states that the feature is
/// required by `intrinsic`.
// rustc: src/tools/miri/src/helpers.rs:936 expect_target_feature_for_intrinsic
InterpCx.prototype.expect_target_feature_for_intrinsic = function (this: MiriInterpCx, intrinsic: Symbol, target_feature: string): InterpResult {
  const this_ = this.eval_context_ref();
  if (!this_.tcx.deref().sess.internal_target_features.has(Symbol.intern(target_feature))) {
    return throw_ub_format(`attempted to call intrinsic \`${Symbol.as_str(intrinsic)}\` that requires missing target feature ${target_feature}`);
  }
  return interp_ok(undefined);
};

/// Lookup an array of immediates from any linker sections matching the provided predicate,
/// with the spans of where they were found.
// rustc: src/tools/miri/src/helpers.rs:952 lookup_link_section
InterpCx.prototype.lookup_link_section = function (this: MiriInterpCx, include_name: (name: string) => boolean): InterpResult<[ImmTy, Span][]> {
  const this_ = this.eval_context_mut();
  const tcx = this_.tcx.tcx;

  const array: [ImmTy, Span][] = [];

  const r = iter_exported_symbols(tcx, (_cnum, def_id, used) => {
    const attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
    if (!used) {
      // We don't know if the symbol is actually going to be in the final binary,
      // so we conservatively skip it.
      return interp_ok(undefined);
    }
    const link_section = attrs.link_section;
    if (link_section === undefined) {
      return interp_ok(undefined);
    }
    if (include_name(Symbol.as_str(link_section))) {
      const instance = Instance.mono(tcx, def_id);
      const span = tcx.def_span(def_id);
      const cv = this_.eval_global(instance);
      if (cv.$ === "Err") {
        return panic(`failed to evaluate static in required link_section: ${debug_DefId(def_id, PLAIN)}\n${debug_InterpErrorInfo(cv._0, PLAIN)}`);
      }
      const const_val = miri_mplace(cv._0);
      const kind = const_val.layout.ty.kind();
      if (kind.$ === "FnPtr") {
        const imm = this_.read_immediate(const_val);
        if (imm.$ === "Err") return imm;
        array.push([imm._0, span]);
      } else if (kind.$ === "Array" && kind._0.kind().$ === "FnPtr") {
        const elems_r = this_.project_array_fields(const_val);
        if (elems_r.$ === "Err") return elems_r;
        const elems = elems_r._0;
        for (;;) {
          const n = elems.next(this_ as never);
          if (n.$ === "Err") return n;
          if (n._0 === undefined) break;
          const [_idx, elem] = n._0;
          const imm = this_.read_immediate(elem);
          if (imm.$ === "Err") return imm;
          array.push([imm._0, span]);
        }
      } else {
        return throw_unsup_format("only function pointers and arrays of function pointers are supported in well-known linker sections");
      }
    }
    return interp_ok(undefined);
  });
  if (r.$ === "Err") return r;

  return interp_ok(array);
};

// rustc: src/tools/miri/src/helpers.rs:1001 mangle_internal_symbol
InterpCx.prototype.mangle_internal_symbol = function (this: MiriInterpCx, name: string): string {
  const this_ = this.eval_context_mut();
  const tcx = this_.tcx.deref();
  const cache = this_.machine.mangle_internal_symbol_cache;
  let v = cache.get(name);
  if (v === undefined) {
    v = rustc_symbol_mangling_mangle_internal_symbol(tcx, name) as string;
    cache.set(name, v);
  }
  return v;
};

/// Get the current span in the topmost function which is workspace-local and not
/// `#[track_caller]`.
/// This function is backed by a cache, and can be assumed to be very fast.
/// It will work even when the stack is empty.
// rustc: src/tools/miri/src/helpers.rs:1019 current_user_relevant_span
MiriMachine.prototype.current_user_relevant_span = function (this: MiriMachine): Span {
  return this.threads.active_thread_ref().current_user_relevant_span();
};

/// Returns the span of the *caller* of the current operation, again
/// walking down the stack to find the closest frame in a local crate, if the caller of the
/// current operation is not in a local crate.
/// This is useful when we are processing something which occurs on function-entry and we want
/// to point at the call to the function, not the function definition generally.
// rustc: src/tools/miri/src/helpers.rs:1028 caller_span
MiriMachine.prototype.caller_span = function (this: MiriMachine): Span {
  // We need to go down at least to the caller (len - 2), or however
  // far we have to go to find a frame in a local crate which is also not #[track_caller].
  const frame_idx0 = this.top_user_relevant_frame();
  if (frame_idx0 === undefined) panic("called `Option::unwrap()` on a `None` value");
  const frame_idx = Math.min(frame_idx0, Math.max(this.stack().length - 2, 0));
  return this.stack()[frame_idx]!.current_span();
};

// rustc: src/tools/miri/src/helpers.rs:1036 stack
MiriMachine.prototype.stack = function (this: MiriMachine): readonly Frame<Provenance, FrameExtra>[] {
  return this.threads.active_thread_stack();
};

// rustc: src/tools/miri/src/helpers.rs:1040 top_user_relevant_frame
MiriMachine.prototype.top_user_relevant_frame = function (this: MiriMachine): number | undefined {
  return this.threads.active_thread_ref().top_user_relevant_frame_();
};

/// This is the source of truth for the `user_relevance` flag in our `FrameExtra`.
// rustc: src/tools/miri/src/helpers.rs:1045 user_relevance
MiriMachine.prototype.user_relevance = function (this: MiriMachine, frame: Frame<Provenance>): number {
  if (InstanceKind.requires_caller_location(frame.instance_().def, this.tcx)) {
    return 0;
  }
  if (this.is_local(frame.instance_())) {
    return 255; // u8::MAX
  } else {
    // A non-relevant frame, but at least it doesn't require a caller location, so
    // better than nothing.
    return 1;
  }
};

// rustc: src/tools/miri/src/helpers.rs:1059 isolation_abort_error
export function isolation_abort_error(name: string): InterpResult {
  return throw_machine_stop({ $: "UnsupportedInIsolation", _0: `${name} not available when isolation is enabled` });
}

// rustc: src/tools/miri/src/helpers.rs:1065 bool_to_simd_element
export function bool_to_simd_element(b: boolean, size: Size): Scalar {
  // SIMD uses all-1 as pattern for "true". In two's complement,
  // -1 has all its bits set to one and `from_int` will truncate or
  // sign-extend it to `size` as required.
  const val = b ? -1n : 0n;
  return interp_Scalar.from_int(val, size);
}

/// Check whether an operation that writes to a target buffer was successful.
/// Accordingly select return value.
/// Local helper function to be used in Windows shims.
// rustc: src/tools/miri/src/helpers.rs:1076 windows_check_buffer_size
export function windows_check_buffer_size([success, len]: [boolean, bigint]): number {
  if (success) {
    // If the function succeeds, the return value is the number of characters stored in the target buffer,
    // not including the terminating null character.
    if (len === 0n) panic("attempt to subtract with overflow");
    return u32_try_from_unwrap(len - 1n);
  } else {
    // If the target buffer was not large enough to hold the data, the return value is the buffer size, in characters,
    // required to hold the string and its terminating null character.
    return u32_try_from_unwrap(len);
  }
}

/** `u32::try_from(x).unwrap()` */
function u32_try_from_unwrap(x: bigint): number {
  if (x < 0n || x > 0xffff_ffffn) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return Number(x);
}

/// Check whether the local crate has the `#![no_core]` attribute.
// rustc: src/tools/miri/src/helpers.rs:1089 is_no_core
export function is_no_core(tcx: TyCtxt): boolean {
  return find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "NoCore" ? null : undefined)) !== undefined;
}

/// We don't support 16-bit systems, so let's have ergonomic conversion from `u32` to `usize`.
export interface ToUsize<Self> {
  // rustc: src/tools/miri/src/helpers.rs:1095 to_usize
  to_usize(self: Self): number;
}

export const ToUsize_u32: ToUsize<number> = {
  // rustc: src/tools/miri/src/helpers.rs:1099 to_usize
  to_usize(self: number): number {
    // `try_into().unwrap()` from `u32` to a 64-bit `usize` cannot fail.
    return self;
  },
};

/// Similarly, a maximum address size of `u64` is assumed widely here, so let's have ergonomic
/// conversion from `usize` to `u64`.
export interface ToU64<Self> {
  // rustc: src/tools/miri/src/helpers.rs:1107 to_u64
  to_u64(self: Self): bigint;
}

export const ToU64_usize: ToU64<number> = {
  // rustc: src/tools/miri/src/helpers.rs:1111 to_u64
  to_u64(self: number): bigint {
    // `try_into().unwrap()` from a 64-bit `usize` to `u64` cannot fail.
    return BigInt(self);
  },
};

/// Enters a [tracing::info_span] only if the "tracing" feature is enabled, otherwise does nothing.
/// This calls [rustc_const_eval::enter_trace_span] with [MiriMachine] as the first argument, which
/// will in turn call [MiriMachine::enter_trace_span], which takes care of determining at compile
/// time whether to trace or not (and supposedly the call is compiled out if tracing is disabled).
/// Look at [rustc_const_eval::enter_trace_span] for complete documentation, examples and tips.
// #[macro_export] macro_rules! enter_trace_span (PORT: tracing is not ported; call sites keep it as a comment)
