// Port of compiler/rustc_codegen_ssa/src/base.rs (metadata-only driver path earlier; the comparison predicates by lane
// ssa-contract; the rest by lane ssa-base, plan-m7 wave 41).
//
// Conventions (ssa-contract, docs/handoff/ssa-contract.md):
// - Generic `Bx: BuilderMethods` code takes `bx: BuilderMethods<B>`; `Bx::build` / `Bx::append_block` (no `self`) go
//   through `Bx_: BuilderMethodsStatic<B, Cx, Bx>` (ssa-contract PORT 4), which `codegen_instance` and
//   `maybe_create_entry_wrapper` take first, as `codegen_mir` does (ssa-mir-core).
// - `HasTyCtxt::tcx()` / `HasTypingEnv::typing_env()` are `tcx_()` / `typing_env_()`.
// PORT (ssa-base):
// - `debug!` is compiled out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stays a comment; `info!` is live.
// - The back/write.rs fns `codegen_crate` calls (lane ssa-write, a later wave) are typed stubs in the `ssa_write` table at
//   the end of this file; `OngoingCodegen` and `Coordinator` are opaque placeholders until ssa-write ports them.
// - meth.rs (`load_vtable`, `get_vtable`) has no lane yet: typed stubs at the end of this file.
// - No dep graph (plan-m2 D3, plan-m3 D12): `codegen_crate`'s `ensure_ok().codegen_unit(..)` loop and
//   `determine_cgu_reuse` past its first check are never reached (`is_fully_enabled()` is always false).
//   `-C incremental` is out of scope (plan-m7 D11).
// - `-Z time-passes`' `get_resident_set_size` / `print_time_passes_entry` are not ported (rustc_driver_impl stops on
//   them too): typed stubs.
// - `BTreeSet<DebuggerVisualizerFile>` is a sorted, deduplicated array (`collect_debugger_visualizers_transitive`).
// - Modules this file needs only on the codegen path (mir/, rustc_trait_selection, rustc_infer) are required lazily
//   (`lazy_*`), so loading lib.ts at startup does not change any suite's module load order (plan-m7 D14).
import type { EiiDecl, EiiImpl } from "../rustc_attr_ir/data_structures.gen.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { CrateDepKind, CrateSource, NativeLib as cstore_NativeLib } from "../rustc_crate_store/cstore.gen.ts";
import { CrateDepKind as CrateDepKindC } from "../rustc_crate_store/cstore.ts";
import { required as lang_items_required } from "../rustc_middle/middle/lang_items.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { OptLevel } from "../rustc_session/config.ts";
import { type CrateNum, type DefId, DefId_eq, DefIdMap, LOCAL_CRATE, LocalDefId, lower_hex_StableCrateId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import { mangle_internal_symbol } from "../rustc_symbol_mangling/v0.ts";
import { format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { assert, assert_eq, panic, unported, unwrap } from "../std/panic.ts";
import { str_cmp } from "../rustc_session/options.ts";
import type { Dependencies } from "../rustc_middle/middle/dependency_format.ts";
import { metadata_symbol_name, type SymbolExportKind } from "../rustc_middle/middle/exported_symbols.ts";
import { type BinOp, debug_BinOp } from "../rustc_middle/mir/syntax.ts";
import { asm_const_ptr_clean, IntPredicate, RealPredicate, shift_mask_val } from "./common.ts";
import { FieldsShape, Size_eq, debug_Size, type HasDataLayout } from "../rustc_abi/lib.ts";
import { FIRST_VARIANT } from "../rustc_abi/layout.ts";
import type { DebuggerVisualizerType } from "../rustc_attr_ir/data_structures.gen.ts";
import type { ItemId } from "../rustc_hir/hir.ts";
import type { DebuggerVisualizerFile } from "../rustc_middle/middle/debugger_visualizer.ts";
import { ExportedSymbol, type SymbolExportInfo } from "../rustc_middle/middle/exported_symbols.ts";
import { debug_ConstValue } from "../rustc_middle/mir/consts.gen.ts";
import { CTFE_ALLOC_SALT } from "../rustc_middle/mir/interpret/mod.ts";
import { Pointer_from_AllocId } from "../rustc_middle/mir/interpret/pointer.ts";
import { Scalar } from "../rustc_middle/mir/interpret/value.ts";
import { type CodegenUnit, CodegenUnitNameBuilder, type MonoItemPartitions } from "../rustc_middle/mono.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { PolyExistentialPredicate } from "../rustc_middle/ty/predicate.gen.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { display_Instance, Instance } from "../rustc_middle/ty/instance.ts";
import type { HasTyCtxt, HasTypingEnv, LayoutOf, TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { debug_AdtDef, debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { EntryFnType } from "../rustc_passes/entry.ts";
import type { Session } from "../rustc_session/session.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { ExistentialTraitRef } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { fold_with_ExistentialTraitRef, try_fold_with_ExistentialTraitRef, visit_with_ExistentialTraitRef } from "../rustc_type_ir/predicate.ts";
import { fold_FnSig, PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../rustc_middle/ty/sty.gen.ts";
import type { BodyId as MiddleBodyId } from "../rustc_middle/ty/decls.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { par_map } from "../rustc_data_structures/sync/parallel.ts";
import * as tracing from "../rust_ts/tracing.ts";
import { Duration, Instant } from "../std/time.ts";
import { assert_module_sources, type CguReuse } from "./assert_module_sources.ts";
import type { ModuleConfig } from "./back/write.ts";
import { CpuRequired_diagnostic, CpuUnsupported_diagnostic, MultipleMainFunctions_diagnostic } from "./diagnostics.ts";
import type { PlaceRef } from "./mir/place.ts";
import type { AsmCodegenMethods, GlobalAsmOperandRef } from "./traits/asm.ts";
import type { BackendTypes, ExtraBackendMethods } from "./traits/backend.ts";
import type { BuilderMethods, BuilderMethodsStatic } from "./traits/builder.ts";
import type { CodegenMethods } from "./traits/mod.ts";
import type { WriteBackendMethods, WriteBackendTypes } from "./traits/write.ts";
import type { AllocatorKind, AllocatorMethod } from "../rustc_ast/expand/allocator.gen.ts";
import { ALLOC_ERROR_HANDLER, ALLOCATOR_METHODS } from "../rustc_ast/expand/allocator.ts";
import type { Target as TargetSpec } from "../rustc_target/spec/mod.ts";
import { are_upstream_rust_objects_already_included, each_linked_rlib, ignored_for_lto } from "./back/link.ts";
import { exported_symbols as linker_exported_symbols, linked_symbols as linker_linked_symbols } from "./back/linker.ts";
import { exported_symbols_for_lto as lto_exported_symbols_for_lto } from "./back/lto.ts";
import {
  type CachedModuleCodegen,
  CodegenLintLevelSpecs,
  type CrateInfo,
  ModuleCodegen,
  type ModuleKind,
  type EiiLinkageImplInfo,
  type EiiLinkageInfo,
  NativeLib_from,
} from "./lib.ts";

// rustc: compiler/rustc_codegen_ssa/src/base.rs:58 bin_op_to_icmp_predicate
export function bin_op_to_icmp_predicate(op: BinOp, signed: boolean): IntPredicate {
  if (op === "Eq") return IntPredicate.IntEQ;
  if (op === "Ne") return IntPredicate.IntNE;
  if (op === "Lt" && signed) return IntPredicate.IntSLT;
  if (op === "Lt" && !signed) return IntPredicate.IntULT;
  if (op === "Le" && signed) return IntPredicate.IntSLE;
  if (op === "Le" && !signed) return IntPredicate.IntULE;
  if (op === "Gt" && signed) return IntPredicate.IntSGT;
  if (op === "Gt" && !signed) return IntPredicate.IntUGT;
  if (op === "Ge" && signed) return IntPredicate.IntSGE;
  if (op === "Ge" && !signed) return IntPredicate.IntUGE;
  return bug(`bin_op_to_icmp_predicate: expected comparison operator, found ${debug_BinOp(op, PLAIN)}`);
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:74 bin_op_to_fcmp_predicate
export function bin_op_to_fcmp_predicate(op: BinOp): RealPredicate {
  switch (op) {
    case "Eq":
      return RealPredicate.RealOEQ;
    case "Ne":
      return RealPredicate.RealUNE;
    case "Lt":
      return RealPredicate.RealOLT;
    case "Le":
      return RealPredicate.RealOLE;
    case "Gt":
      return RealPredicate.RealOGT;
    case "Ge":
      return RealPredicate.RealOGE;
    default:
      return bug(`bin_op_to_fcmp_predicate: expected comparison operator, found ${debug_BinOp(op, PLAIN)}`);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:86 compare_simd_types
export function compare_simd_types<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  lhs: B["Value"],
  rhs: B["Value"],
  t: Ty,
  ret_ty: B["Type"],
  op: BinOp,
): B["Value"] {
  let signed: boolean;
  const k = t.kind();
  switch (k.$) {
    case "Float": {
      const cmp_ = bin_op_to_fcmp_predicate(op);
      const cmp = bx.fcmp(cmp_, lhs, rhs);
      return bx.sext(cmp, ret_ty);
    }
    case "Uint":
      signed = false;
      break;
    case "Int":
      signed = true;
      break;
    default:
      return bug("compare_simd_types: invalid SIMD type");
  }

  const cmp_ = bin_op_to_icmp_predicate(op, signed);
  const cmp = bx.icmp(cmp_, lhs, rhs);
  // LLVM outputs an `< size x i1 >`, so we need to perform a sign extension
  // to get the correctly sized type. This will compile to a single instruction
  // once the IR is converted to assembly if the SIMD instruction is supported
  // by the target architecture.
  return bx.sext(cmp, ret_ty);
}

/// Codegen takes advantage of the additional assumption, where if the
/// principal trait def id of what's being casted doesn't change,
/// then we don't need to adjust the vtable at all. This
/// corresponds to the fact that `dyn Tr<A>: Unsize<dyn Tr<B>>`
/// requires that `A = B`; we don't allow *upcasting* objects
/// between the same trait with different args. If we, for
/// some reason, were to relax the `Unsize` trait, it could become
/// unsound, so let's validate here that the trait refs are subtypes.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:122 validate_trivial_unsize
export function validate_trivial_unsize(
  tcx: TyCtxt,
  source_data: List<PolyExistentialPredicate>,
  target_data: List<PolyExistentialPredicate>,
): boolean {
  const hr_source_principal = source_data.principal();
  const hr_target_principal = target_data.principal();
  if (hr_source_principal !== undefined && hr_target_principal !== undefined) {
    const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(TypingEnv.fully_monomorphized());
    const universe = infcx.universe();
    const ocx = lazy_trait_selection_engine().ObligationCtxt.new(infcx);
    return infcx.enter_forall(
      hr_target_principal,
      (target_principal) => {
        const source_principal = infcx.instantiate_binder_with_fresh_vars(
          DUMMY_SP,
          { $: "HigherRankedType" },
          hr_source_principal,
          d_ExistentialTraitRef,
        );
        const r = ocx.eq(ObligationCause.dummy(), param_env, target_principal, source_principal, lazy_infer_at().ToTrace_ExistentialTraitRef);
        if (r.$ !== "Ok") {
          return false;
        }
        if (!lazy_infer_traits_engine().TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
          return false;
        }
        return infcx.leak_check(universe, undefined).$ === "Ok";
      },
      d_ExistentialTraitRef,
    );
  } else if (hr_target_principal === undefined) {
    return true;
  } else {
    return false;
  }
}

/// Retrieves the information we are losing (making dynamic) in an unsizing
/// adjustment.
///
/// The `old_info` argument is a bit odd. It is intended for use in an upcast,
/// where the new vtable for an object will be derived from the old one.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:163 unsized_info
function unsized_info<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  source_: Ty,
  target_: Ty,
  old_info_: B["Value"] | undefined,
): B["Value"] {
  const cx = bx.cx();
  const [source, target] = cx.tcx_().struct_lockstep_tails_for_codegen(source_, target_, bx.typing_env_());
  const sk = source.kind();
  const tk = target.kind();
  if (sk.$ === "Array" && tk.$ === "Slice") {
    const len = sk._1;
    return cx.const_usize(unwrap(len.try_to_target_usize(cx.tcx_()), "expected monomorphic const in codegen"));
  } else if (sk.$ === "Dynamic" && tk.$ === "Dynamic") {
    const data_a = sk._0;
    const data_b = tk._0;
    const old_info = unwrap(old_info_, "unsized_info: missing old info for trait upcasting coercion");
    const b_principal_def_id = data_b.principal_def_id();
    const a_principal_def_id = data_a.principal_def_id();
    if (
      (a_principal_def_id === undefined
        ? b_principal_def_id === undefined
        : b_principal_def_id !== undefined && DefId_eq(a_principal_def_id, b_principal_def_id)) ||
      b_principal_def_id === undefined
    ) {
      // Codegen takes advantage of the additional assumption, where if the
      // principal trait def id of what's being casted doesn't change,
      // then we don't need to adjust the vtable at all. This
      // corresponds to the fact that `dyn Tr<A>: Unsize<dyn Tr<B>>`
      // requires that `A = B`; we don't allow *upcasting* objects
      // between the same trait with different args. If we, for
      // some reason, were to relax the `Unsize` trait, it could become
      // unsound, so let's assert here that the trait refs are *equal*.
      // debug_assert!(
      //     validate_trivial_unsize(cx.tcx(), data_a, data_b),
      //     "NOP unsize vtable changed principal trait ref: {data_a} -> {data_b}"
      // );

      // A NOP cast that doesn't actually change anything, let's avoid any
      // unnecessary work. This relies on the assumption that if the principal
      // traits are equal, then the associated type bounds (`dyn Trait<Assoc=T>`)
      // are also equal, which is ensured by the fact that normalization is
      // a function and we do not allow overlapping impls.
      return old_info;
    }

    // trait upcasting coercion

    const vptr_entry_idx = cx.tcx_().supertrait_vtable_slot([source, target]) as number | undefined;

    if (vptr_entry_idx !== undefined) {
      const entry_idx = vptr_entry_idx;
      const ptr_size = bx.data_layout().pointer_size();
      // PORT (root at integ-w54): `u64` as a `number`, as meth.ts's `load_vtable` and `VirtualIndex` take it (a vtable
      // offset is far below 2^53).
      const vtable_byte_offset = entry_idx * ptr_size.bytes();
      return lazy_meth().load_vtable(bx, old_info, bx.type_ptr(), vtable_byte_offset, source, true);
    } else {
      return old_info;
    }
  } else if (tk.$ === "Dynamic") {
    const data = tk._0;
    const principal = data.principal();
    return lazy_meth().get_vtable(
      cx,
      source,
      principal === undefined ? undefined : bx.tcx_().instantiate_bound_regions_with_erased(principal, d_ExistentialTraitRef),
    );
  } else {
    return bug(`unsized_info: invalid unsizing ${debug_Ty(source, PLAIN)} -> ${debug_Ty(target, PLAIN)}`);
  }
}

/// Coerces `src` to `dst_ty`. `src_ty` must be a pointer.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:225 unsize_ptr
export function unsize_ptr<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  src: B["Value"],
  src_ty: Ty,
  dst_ty: Ty,
  old_info: B["Value"] | undefined,
): [B["Value"], B["Value"]] {
  // debug!("unsize_ptr: {:?} => {:?}", src_ty, dst_ty);
  const sk = src_ty.kind();
  const dk = dst_ty.kind();
  if (sk.$ === "Pat" && dk.$ === "Pat") {
    return unsize_ptr(bx, src, sk._0, dk._0, old_info);
  } else if ((sk.$ === "Ref" && (dk.$ === "Ref" || dk.$ === "RawPtr")) || (sk.$ === "RawPtr" && dk.$ === "RawPtr")) {
    const a = sk.$ === "Ref" ? sk._1 : sk._0;
    const b = dk.$ === "Ref" ? dk._1 : dk._0;
    assert_eq(bx.cx().type_is_sized(a), old_info === undefined, String);
    return [src, unsized_info(bx, a, b, old_info)];
  } else if (sk.$ === "Adt" && dk.$ === "Adt") {
    const def_a = sk._0;
    const def_b = dk._0;
    assert_eq(def_a, def_b, (d) => debug_AdtDef(d, PLAIN)); // implies same number of fields
    const src_layout = bx.cx().layout_of(src_ty);
    const dst_layout = bx.cx().layout_of(dst_ty);
    if (src_ty === dst_ty) {
      return [src, unwrap(old_info)];
    }
    let result: [B["Value"], B["Value"]] | undefined = undefined;
    for (let i = 0; i < FieldsShape.count(src_layout.fields); i++) {
      const src_f = src_layout.field(bx.cx(), i);
      if (src_f.is_1zst()) {
        // We are looking for the one non-1-ZST field; this is not it.
        continue;
      }

      assert_eq(FieldsShape.offset(src_layout.fields, i).bytes(), 0, String);
      assert_eq(FieldsShape.offset(dst_layout.fields, i).bytes(), 0, String);
      assert_eq(src_layout.size, src_f.size, (s) => debug_Size(s, PLAIN), Size_eq);

      const dst_f = dst_layout.field(bx.cx(), i);
      assert(src_f.ty !== dst_f.ty, () => `assertion \`left != right\` failed\n  left: ${debug_Ty(src_f.ty, PLAIN)}\n right: ${debug_Ty(dst_f.ty, PLAIN)}`);
      if (result !== undefined) {
        const [r0, r1] = result;
        assert(false, () => `assertion \`left == right\` failed\n  left: Some((${bx.debug_Value(r0, PLAIN)}, ${bx.debug_Value(r1, PLAIN)}))\n right: None`);
      }
      result = unsize_ptr(bx, src, src_f.ty, dst_f.ty, old_info);
    }
    return unwrap(result);
  } else {
    return bug("unsize_ptr: called on bad types");
  }
}

/// Coerces `src`, which is a reference to a value of type `src_ty`,
/// to a value of type `dst_ty`, and stores the result in `dst`.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:272 coerce_unsized_into
export function coerce_unsized_into<B extends BackendTypes>(bx: BuilderMethods<B>, src: PlaceRef<B["Value"]>, dst: PlaceRef<B["Value"]>): void {
  const src_ty = src.layout.ty;
  const dst_ty = dst.layout.ty;
  const sk = src_ty.kind();
  const dk = dst_ty.kind();
  if (sk.$ === "Pat" && dk.$ === "Pat" && sk._1.kind().$ === "NotNull" && dk._1.kind().$ === "NotNull") {
    const src_ = src.project_type(bx, sk._0);
    const dst_ = dst.project_type(bx, dk._0);
    coerce_unsized_into(bx, src_, dst_);
  } else if ((sk.$ === "Ref" && (dk.$ === "Ref" || dk.$ === "RawPtr")) || (sk.$ === "RawPtr" && dk.$ === "RawPtr")) {
    const val = bx.load_operand(src).val;
    let base: B["Value"];
    let info: B["Value"];
    switch (val.$) {
      case "Pair":
        [base, info] = unsize_ptr(bx, val._0, src_ty, dst_ty, val._1);
        break;
      case "Immediate":
        [base, info] = unsize_ptr(bx, val._0, src_ty, dst_ty, undefined);
        break;
      case "Ref":
      case "ZeroSized":
        return bug("impossible case reached");
    }
    lazy_mir_operand().OperandValue.store({ $: "Pair", _0: base, _1: info }, bx, dst);
  } else if (sk.$ === "Adt" && dk.$ === "Adt") {
    const def_a = sk._0;
    const def_b = dk._0;
    assert_eq(def_a, def_b, (d) => debug_AdtDef(d, PLAIN)); // implies same number of fields

    const n = def_a.variant(FIRST_VARIANT).fields.length;
    for (let i = 0; i < n; i++) {
      const src_f = src.project_field(bx, i);
      const dst_f = dst.project_field(bx, i);

      if (dst_f.layout.is_zst()) {
        // No data here, nothing to copy/coerce.
        continue;
      }

      if (src_f.layout.ty === dst_f.layout.ty) {
        bx.typed_place_copy(dst_f.val, src_f.val, src_f.layout);
      } else {
        coerce_unsized_into(bx, src_f, dst_f);
      }
    }
  } else {
    bug(`coerce_unsized_into: invalid coercion ${debug_Ty(src_ty, PLAIN)} -> ${debug_Ty(dst_ty, PLAIN)}`);
  }
}

/// Returns `rhs` sufficiently masked, truncated, and/or extended so that it can be used to shift
/// `lhs`: it has the same size as `lhs`, and the value, when interpreted unsigned (no matter its
/// type), will not exceed the size of `lhs`.
///
/// Shifts in MIR are all allowed to have mismatched LHS & RHS types, and signed RHS.
/// The shift methods in `BuilderMethods`, however, are fully homogeneous
/// (both parameters and the return type are all the same size) and assume an unsigned RHS.
///
/// If `is_unchecked` is false, this masks the RHS to ensure it stays in-bounds,
/// as the `BuilderMethods` shifts are UB for out-of-bounds shift amounts.
/// For 32- and 64-bit types, this matches the semantics
/// of Java. (See related discussion on #1877 and #10183.)
///
/// If `is_unchecked` is true, this does no masking, and adds sufficient `assume`
/// calls or operation flags to preserve as much freedom to optimize as possible.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:334 build_shift_expr_rhs
export function build_shift_expr_rhs<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  lhs: B["Value"],
  rhs_: B["Value"],
  is_unchecked: boolean,
): B["Value"] {
  let rhs = rhs_;
  // Shifts may have any size int on the rhs
  let rhs_llty = bx.cx().val_ty(rhs);
  let lhs_llty = bx.cx().val_ty(lhs);

  const mask = shift_mask_val(bx, lhs_llty, rhs_llty, false);
  if (!is_unchecked) {
    rhs = bx.and(rhs, mask);
  }

  if (bx.cx().type_kind(rhs_llty) === "Vector") {
    rhs_llty = bx.cx().element_type(rhs_llty);
  }
  if (bx.cx().type_kind(lhs_llty) === "Vector") {
    lhs_llty = bx.cx().element_type(lhs_llty);
  }
  const rhs_sz = bx.cx().int_width(rhs_llty);
  const lhs_sz = bx.cx().int_width(lhs_llty);
  if (lhs_sz < rhs_sz) {
    if (is_unchecked) {
      return bx.unchecked_utrunc(rhs, lhs_llty);
    } else {
      return bx.trunc(rhs, lhs_llty);
    }
  } else if (lhs_sz > rhs_sz) {
    // We zero-extend even if the RHS is signed. So e.g. `(x: i32) << -1i8` will zero-extend the
    // RHS to `255i32`. But then we mask the shift amount to be within the size of the LHS
    // anyway so the result is `31` as it should be. All the extra bits introduced by zext
    // are masked off so their value does not matter.
    // FIXME: if we ever support 512bit integers, this will be wrong! For such large integers,
    // the extra bits introduced by zext are *not* all masked away any more.
    assert(lhs_sz <= 256, "assertion failed: lhs_sz <= 256");
    return bx.zext(rhs, lhs_llty);
  } else {
    return rhs;
  }
}

// Returns `true` if this session's target will use native wasm
// exceptions. This means that the VM does the unwinding for
// us
// rustc: compiler/rustc_codegen_ssa/src/base.rs:376 wants_wasm_eh
export function wants_wasm_eh(target: TargetSpec): boolean {
  return target.is_like_wasm;
}

/// Returns `true` if this session's target will use SEH-based unwinding.
///
/// This is only true for MSVC targets, and even then the 64-bit MSVC target
/// currently uses SEH-ish unwinding with DWARF info tables to the side (same as
/// 64-bit MinGW) instead of "full SEH".
// rustc: compiler/rustc_codegen_ssa/src/base.rs:385 wants_msvc_seh
export function wants_msvc_seh(target: TargetSpec): boolean {
  return target.is_like_msvc;
}

/// Returns `true` if this session's target requires the new exception
/// handling LLVM IR instructions (catchpad / cleanuppad / ... instead
/// of landingpad)
// rustc: compiler/rustc_codegen_ssa/src/base.rs:392 wants_new_eh_instructions
export function wants_new_eh_instructions(target: TargetSpec): boolean {
  return wants_wasm_eh(target) || wants_msvc_seh(target);
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:396 codegen_instance
export function codegen_instance<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  Bx_: BuilderMethodsStatic<B, Cx, Bx>,
  cx: Cx,
  instance: Instance,
): void {
  // this is an info! to allow collecting monomorphization statistics
  // and to allow finding the last function before LLVM aborts from
  // release builds.
  tracing.info("rustc_codegen_ssa::base", () => `codegen_instance(${display_Instance(instance)})`);

  lazy_mir().codegen_mir(Bx_, cx, instance);
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:408 codegen_global_asm
export function codegen_global_asm(cx: LayoutOf<TyAndLayout, never> & AsmCodegenMethods & HasTyCtxt & HasTypingEnv & HasDataLayout, item_id: ItemId): void {
  const item = cx.tcx_().hir_item(item_id);
  if (item.kind.$ === "GlobalAsm") {
    const asm = item.kind.asm;
    const operands: GlobalAsmOperandRef[] = asm.operands.map(([op, op_sp]): GlobalAsmOperandRef => {
      switch (op.$) {
        case "Const": {
          const anon_const = op.anon_const;
          const r = cx.tcx_().const_eval_poly(LocalDefId.to_def_id(anon_const.def_id));
          if (r.$ === "Ok") {
            const const_value = r._0;
            const ty = cx.tcx_().typeck_body(anon_const.body as unknown as MiddleBodyId).node_type(anon_const.hir_id);
            if (const_value.$ !== "Scalar") {
              return span_bug(op_sp, `expected Scalar for promoted asm const, but got ${format_debug(const_value, debug_ConstValue, PRETTY)}`);
            }
            const scalar = const_value._0;
            return {
              $: "Const",
              value: asm_const_ptr_clean(cx.tcx_(), scalar),
              ty,
            };
          } else if (r._0.$ === "Reported") {
            // An error has already been reported and
            // compilation is guaranteed to fail if execution
            // hits this path. So anything will suffice.
            return {
              $: "Const",
              value: Scalar.from_u32(0),
              ty: Ty.new_uint(cx.tcx_(), "U32"),
            };
          } else {
            return span_bug(op_sp, "asm const cannot be resolved; too generic");
          }
        }
        case "SymFn": {
          const expr = op.expr;
          const ty = (cx.tcx_().typeck(item_id.owner_id) as TypeckResults).expr_ty(expr);
          const k = ty.kind();
          let instance: Instance;
          if (k.$ === "FnDef") {
            instance = Instance.expect_resolve(cx.tcx_(), cx.typing_env_(), k._0, unwrap(Binder.no_bound_vars(k._1, fold_GenericArgs)), expr.span);
          } else {
            return span_bug(op_sp, "asm sym is not a function");
          }

          return {
            $: "Const",
            value: Scalar.from_pointer(Pointer_from_AllocId(cx.tcx_().reserve_and_set_fn_alloc(instance, CTFE_ALLOC_SALT)), cx),
            ty: Ty.new_fn_ptr(cx.tcx_(), ty.fn_sig(cx.tcx_())),
          };
        }
        case "SymStatic": {
          const def_id = op.def_id;
          if (cx.tcx_().is_thread_local_static(def_id)) {
            return { $: "SymThreadLocalStatic", def_id };
          } else {
            return {
              $: "Const",
              value: Scalar.from_pointer(Pointer_from_AllocId(cx.tcx_().reserve_and_set_static_alloc(def_id)), cx),
              ty: cx.tcx_().static_ptr_ty(def_id, cx.typing_env_()),
            };
          }
        }
        case "In":
        case "Out":
        case "InOut":
        case "SplitInOut":
        case "Label":
          return span_bug(op_sp, "invalid operand type for global_asm!");
      }
    });

    cx.codegen_global_asm(asm.template, operands, asm.options, asm.line_spans, []);
  } else {
    span_bug(item.span, "Mismatch between hir::Item type and MonoItem type");
  }
}

/// Creates the `main` function which will initialize the rust runtime and call
/// users main function.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:501 maybe_create_entry_wrapper
export function maybe_create_entry_wrapper<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  Bx_: BuilderMethodsStatic<B, Cx, Bx>,
  cx: Cx,
  cgu: CodegenUnit,
): B["Function"] | undefined {
  const entry = cx.tcx_().entry_fn(null) as [DefId, EntryFnType] | undefined;
  if (entry === undefined) return undefined;
  const [main_def_id, entry_type] = entry;
  const main_is_local = main_def_id.is_local();
  const instance = Instance.mono(cx.tcx_(), main_def_id);

  if (main_is_local) {
    // We want to create the wrapper in the same codegen unit as Rust's main
    // function.
    if (!cgu.contains_item({ $: "Fn", _0: instance })) {
      return undefined;
    }
  } else if (!cgu.is_primary()) {
    // We want to create the wrapper only when the codegen unit is the primary one
    return undefined;
  }

  const main_llfn = cx.get_fn_addr(instance, cx.sess().pointer_authentication_functions());

  const entry_fn = create_entry_fn(Bx_, cx, main_llfn, main_def_id, entry_type);
  return entry_fn;

  // rustc: compiler/rustc_codegen_ssa/src/base.rs:525 create_entry_fn
  function create_entry_fn(
    Bx_: BuilderMethodsStatic<B, Cx, Bx>,
    cx: Cx,
    rust_main: B["Value"],
    rust_main_def_id: DefId,
    entry_type: EntryFnType,
  ): B["Function"] {
    // The entry function is either `int main(void)` or `int main(int argc, char **argv)`, or
    // `usize efi_main(void *handle, void *system_table)` depending on the target.
    let llfty: B["FunctionSignature"];
    if (cx.sess().target.os.$ === "Uefi") {
      llfty = cx.type_func([cx.type_ptr(), cx.type_ptr()], cx.type_isize());
    } else if (cx.sess().target.main_needs_argc_argv) {
      llfty = cx.type_func([cx.type_int(), cx.type_ptr()], cx.type_int());
    } else {
      llfty = cx.type_func([], cx.type_int());
    }

    const main_ret_ty_ = PolyFnSigC.output(unwrap(EarlyBinder.no_bound_vars(cx.tcx_().fn_sig(rust_main_def_id) as EarlyBinder<PolyFnSig>, fold_PolyFnSig)));
    // Given that `main()` has no arguments,
    // then its return type cannot have
    // late-bound regions, since late-bound
    // regions must appear in the argument
    // listing.
    const main_ret_ty = cx.tcx_().normalize_erasing_regions(cx.typing_env_(), Unnormalized.new_wip(unwrap(Binder.no_bound_vars(main_ret_ty_, fold_Ty))), fold_Ty);

    const llfn = cx.declare_c_main(llfty);
    if (llfn === undefined) {
      // FIXME: We should be smart and show a better diagnostic here.
      const span = cx.tcx_().def_span(rust_main_def_id);
      return cx.tcx_().dcx().emit_fatal(MultipleMainFunctions_diagnostic({ span }));
    }

    // `main` should respect same config for frame pointer elimination as rest of code
    cx.set_frame_pointer_type(llfn);
    cx.apply_target_cpu_attr(llfn);

    const llbb = Bx_.append_block(cx, llfn, "top");
    const bx = Bx_.build(cx, llbb);

    bx.insert_reference_to_gdb_debug_scripts_section_global();

    const isize_ty = cx.type_isize();
    const ptr_ty = cx.type_ptr();
    const [arg_argc, arg_argv] = get_argc_argv(bx);

    const { sigpipe } = entry_type satisfies { $: "Main" };
    let start_fn: B["Value"];
    let start_ty: B["FunctionSignature"];
    let args: B["Value"][];
    let instance: Instance | undefined;
    {
      const start_def_id = cx.tcx_().require_lang_item("Start", DUMMY_SP);
      const start_instance = Instance.expect_resolve(cx.tcx_(), cx.typing_env_(), start_def_id, cx.tcx_().mk_args([main_ret_ty]), DUMMY_SP);
      const start_fn_ = cx.get_fn_addr(start_instance, cx.sess().pointer_authentication_functions());

      const i8_ty = cx.type_i8();
      const arg_sigpipe = bx.const_u8(sigpipe);

      const start_ty_ = cx.type_func([cx.val_ty(rust_main), isize_ty, ptr_ty, i8_ty], isize_ty);
      [start_fn, start_ty, args, instance] = [start_fn_, start_ty_, [rust_main, arg_argc, arg_argv, arg_sigpipe], start_instance];
    }

    const result = bx.call(start_ty, undefined, undefined, start_fn, { $: "Direct" }, args, undefined, instance);
    if (cx.sess().target.os.$ === "Uefi") {
      bx.ret(result);
    } else {
      const cast = bx.intcast(result, cx.type_int(), true);
      bx.ret(cast);
    }

    return llfn;
  }
}

/// Obtain the `argc` and `argv` values to pass to the rust start function
/// (i.e., the "start" lang item).
// rustc: compiler/rustc_codegen_ssa/src/base.rs:611 get_argc_argv
function get_argc_argv<B extends BackendTypes>(bx: BuilderMethods<B>): [B["Value"], B["Value"]] {
  if (bx.cx().sess().target.os.$ === "Uefi") {
    // Params for UEFI
    const param_handle = bx.get_param(0);
    const param_system_table = bx.get_param(1);
    const ptr_size = bx.tcx_().data_layout().pointer_size();
    const ptr_align = bx.tcx_().data_layout().pointer_align().abi;
    const arg_argc = bx.const_int(bx.cx().type_isize(), 2n);
    const arg_argv = bx.alloca(ptr_size.mul(2n), ptr_align);
    bx.store(param_handle, arg_argv, ptr_align);
    const arg_argv_el1 = bx.inbounds_ptradd(arg_argv, bx.const_usize(ptr_size.bytes_u64()));
    bx.store(param_system_table, arg_argv_el1, ptr_align);
    return [arg_argc, arg_argv];
  } else if (bx.cx().sess().target.main_needs_argc_argv) {
    // Params from native `main()` used as args for rust start function
    const param_argc = bx.get_param(0);
    const param_argv = bx.get_param(1);
    const arg_argc = bx.intcast(param_argc, bx.cx().type_isize(), true);
    const arg_argv = param_argv;
    return [arg_argc, arg_argv];
  } else {
    // The Rust start function doesn't need `argc` and `argv`, so just pass zeros.
    const arg_argc = bx.const_int(bx.cx().type_int(), 0n);
    const arg_argv = bx.const_null(bx.cx().type_ptr());
    return [arg_argc, arg_argv];
  }
}

/// This function returns all of the debugger visualizers specified for the
/// current crate as well as all upstream crates transitively that match the
/// `visualizer_type` specified.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:642 collect_debugger_visualizers_transitive
export function collect_debugger_visualizers_transitive(tcx: TyCtxt, visualizer_type: DebuggerVisualizerType): DebuggerVisualizerFile[] {
  const all = [
    ...(tcx.debugger_visualizers(LOCAL_CRATE) as DebuggerVisualizerFile[]),
    ...tcx
      .crates(null)
      .filter((cnum) => {
        const used_crate_source = tcx.used_crate_source(cnum) as CrateSource;
        return used_crate_source.rlib !== undefined || used_crate_source.rmeta !== undefined;
      })
      .flatMap((cnum) => tcx.debugger_visualizers(cnum) as DebuggerVisualizerFile[]),
  ].filter((visualizer) => visualizer.visualizer_type === visualizer_type);
  // `.cloned().collect::<BTreeSet<_>>()`: sorted by the derived `Ord`, duplicates dropped.
  all.sort(cmp_DebuggerVisualizerFile);
  return all.filter((v, i) => i === 0 || cmp_DebuggerVisualizerFile(all[i - 1]!, v) !== 0);
}

/// Decide allocator kind to codegen. If `Some(_)` this will be the same as
/// `tcx.allocator_kind`, but it may be `None` in more cases (e.g. if using
/// allocator definitions from a dylib dependency).
// rustc: compiler/rustc_codegen_ssa/src/base.rs:665 allocator_kind_for_codegen
export function allocator_kind_for_codegen(tcx: TyCtxt): AllocatorKind | undefined {
  // If the crate doesn't have an `allocator_kind` set then there's definitely
  // no shim to generate. Otherwise we also check our dependency graph for all
  // our output crate types. If anything there looks like its a `Dynamic`
  // linkage for all crate types we may link as, then it's already got an
  // allocator shim and we'll be using that one instead. If nothing exists
  // then it's our job to generate the allocator! If crate types disagree
  // about whether an allocator shim is necessary or not, we generate one
  // and let needs_allocator_shim_for_linking decide at link time whether or
  // not to use it for any particular linker invocation.
  const all_crate_types_any_dynamic_crate = [...(tcx.dependency_formats(null) as Dependencies)].every(([, list]) => {
    // use rustc_middle::middle::dependency_format::Linkage;
    return list.some((linkage) => linkage === "Dynamic");
  });
  if (all_crate_types_any_dynamic_crate) {
    return undefined;
  } else {
    return tcx.allocator_kind(null) as AllocatorKind | undefined;
  }
}

/// Decide if this particular crate type needs an allocator shim linked in.
/// This may return true even when allocator_kind_for_codegen returns false. In
/// this case no allocator shim shall be linked.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:685 needs_allocator_shim_for_linking
export function needs_allocator_shim_for_linking(dependency_formats: Dependencies, crate_type: CrateType): boolean {
  // use rustc_middle::middle::dependency_format::Linkage;
  const list = dependency_formats.get(crate_type);
  if (list === undefined) return panic("IndexMap: key not found");
  const any_dynamic_crate = list.some((linkage) => linkage === "Dynamic");
  return !any_dynamic_crate;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:695 allocator_shim_contents
export function allocator_shim_contents(tcx: TyCtxt, kind: AllocatorKind): AllocatorMethod[] {
  const methods: AllocatorMethod[] = [];

  if (kind === "Default") {
    methods.push(...ALLOCATOR_METHODS);
  }

  // If the return value of allocator_kind_for_codegen is Some then
  // alloc_error_handler_kind must also be Some.
  if (unwrap(tcx.alloc_error_handler_kind(null) as AllocatorKind | undefined) === "Default") {
    methods.push({
      name: ALLOC_ERROR_HANDLER,
      special: undefined,
      inputs: [{ name: "layout", ty: "Layout" }],
      output: "Never",
    });
  }

  return methods;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:716 codegen_crate
export function codegen_crate<M, W extends WriteBackendTypes & { Module: M }>(
  backend: ExtraBackendMethods<M> & WriteBackendMethods<W>,
  tcx: TyCtxt,
): OngoingCodegen {
  if (tcx.sess.target.need_explicit_cpu && tcx.sess.opts.cg.target_cpu === undefined) {
    // The target has no default cpu, but none is set explicitly
    tcx.dcx().emit_fatal(CpuRequired_diagnostic({}));
  }

  const target_cpu = tcx.sess.opts.cg.target_cpu;
  if (target_cpu !== undefined && tcx.sess.target.unsupported_cpus.includes(target_cpu)) {
    // The target cpu is explicitly listed as an unsupported cpu
    tcx.dcx().emit_fatal(CpuUnsupported_diagnostic({ target_cpu: target_cpu }));
  }

  const cgu_name_builder = CodegenUnitNameBuilder.new(tcx);

  // Run the monomorphization collector and partition the collected items into
  // codegen units.
  const { codegen_units: codegen_units_ } = tcx.collect_and_partition_mono_items(null) as MonoItemPartitions;

  // Force all codegen_unit queries so they are already either red or green
  // when compile_codegen_unit accesses them. We are not able to re-execute
  // the codegen_unit query from just the DepNode, so an unknown color would
  // lead to having to re-execute compile_codegen_unit, possibly
  // unnecessarily.
  if (tcx.dep_graph.is_fully_enabled()) {
    for (const cgu of codegen_units_) {
      tcx.ensure_ok().codegen_unit(cgu.name());
    }
  }

  // Codegen an allocator shim, if necessary.
  let allocator_module: ModuleCodegen<M> | undefined;
  const kind = allocator_kind_for_codegen(tcx);
  if (kind !== undefined) {
    const llmod_id = Symbol.as_str(cgu_name_builder.build_cgu_name(LOCAL_CRATE, ["crate"], "allocator"));

    allocator_module = tcx.sess.time("write_allocator_module", () => {
      const module = backend.codegen_allocator(tcx, llmod_id, allocator_shim_contents(tcx, kind));
      return ModuleCodegen.new_allocator(llmod_id, module);
    });
  } else {
    allocator_module = undefined;
  }

  const no_builtins = find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "NoBuiltins" ? null : undefined)) !== undefined;
  const regular_module_config = ssa_write.ModuleConfig_new("Regular", tcx, no_builtins);
  const bitcode_needed = ssa_write.ModuleConfig_bitcode_needed(regular_module_config);
  const allocator_module_config = ssa_write.ModuleConfig_new("Allocator", tcx, no_builtins);

  // PORT: `backend.clone()`: the backends are stateless unit structs (`LlvmCodegenBackend(())`), so the clone is the same
  // value. `Arc::new(..)` is the value itself.
  const ongoing_codegen = ssa_write.start_async_codegen(backend, tcx, regular_module_config, allocator_module_config, allocator_module);

  // For better throughput during parallel processing by LLVM, we used to sort
  // CGUs largest to smallest. This would lead to better thread utilization
  // by, for example, preventing a large CGU from being processed last and
  // having only one LLVM thread working while the rest remained idle.
  //
  // However, this strategy would lead to high memory usage, as it meant the
  // LLVM-IR for all of the largest CGUs would be resident in memory at once.
  //
  // Instead, we can compromise by ordering CGUs such that the largest and
  // smallest are first, second largest and smallest are next, etc. If there
  // are large size variations, this can reduce memory usage significantly.
  let codegen_units: CodegenUnit[];
  {
    const sorted_cgus = [...codegen_units_];
    // `sort_by_key(|cgu| cmp::Reverse(cgu.size_estimate()))`: a stable sort, largest first.
    sorted_cgus.sort((a, b) => b.size_estimate() - a.size_estimate());

    const mid = Math.floor(sorted_cgus.length / 2);
    const [first_half, second_half] = [sorted_cgus.slice(0, mid), sorted_cgus.slice(mid)];
    codegen_units = interleave(first_half, second_half.reverse());
  }

  // Calculate the CGU reuse
  const cgu_reuse = tcx.sess.time("find_cgu_reuse", () => codegen_units.map((cgu) => determine_cgu_reuse(tcx, cgu)));

  assert_module_sources(tcx, (cgu_reuse_tracker) => {
    for (let i = 0; i < codegen_units.length; i++) {
      const cgu = codegen_units[i]!;
      const cgu_reuse_ = cgu_reuse[i]!;
      cgu_reuse_tracker.set_actual_reuse(Symbol.as_str(cgu.name()), cgu_reuse_);
    }
  });

  let total_codegen_time = Duration.new(0n, 0);
  const start_rss = tcx.sess.opts.unstable_opts.time_passes ? get_resident_set_size() : undefined;

  // The non-parallel compiler can only translate codegen units to LLVM IR
  // on a single thread, leading to a staircase effect where the N LLVM
  // threads have to wait on the single codegen threads to generate work
  // for them. The parallel compiler does not have this restriction, so
  // we can pre-load the LLVM queue in parallel before handing off
  // coordination to the OnGoingCodegen scheduler.
  //
  // This likely is a temporary measure. Once we don't have to support the
  // non-parallel compiler anymore, we can compile CGUs end-to-end in
  // parallel and get rid of the complicated scheduling logic.
  let pre_compiled_cgus: Map<number, [ModuleCodegen<M>, number]>;
  const threads = tcx.sess.opts.jobs.frontend;
  if (threads !== undefined) {
    pre_compiled_cgus = tcx.sess.time("compile_first_CGU_batch", () => {
      // Try to find one CGU to compile per thread.
      const cgus: [number, CguReuse][] = cgu_reuse
        .map((reuse, i): [number, CguReuse] => [i, reuse])
        .filter(([_, reuse]) => reuse === "No")
        .slice(0, threads);

      // Compile the found CGUs in parallel.
      const start_time = Instant.now();

      const pre_compiled_cgus = new Map(
        par_map(cgus, ([i, _]) => {
          const module = backend.compile_codegen_unit(tcx, codegen_units[i]!.name(), bitcode_needed);
          return [i, module] as const;
        }),
      );

      total_codegen_time = Duration_add(total_codegen_time, Instant.now().duration_since(start_time));

      return pre_compiled_cgus;
    });
  } else {
    pre_compiled_cgus = new Map();
  }

  for (let i = 0; i < codegen_units.length; i++) {
    const cgu = codegen_units[i]!;
    ssa_write.OngoingCodegen_wait_for_signal_to_codegen_item(ongoing_codegen);
    ssa_write.OngoingCodegen_check_for_errors(ongoing_codegen, tcx.sess);

    const cgu_reuse_ = cgu_reuse[i]!;

    switch (cgu_reuse_) {
      case "No": {
        let module: ModuleCodegen<M>;
        let cost: number;
        const pre = pre_compiled_cgus.get(i);
        if (pre !== undefined) {
          pre_compiled_cgus.delete(i);
          [module, cost] = pre;
        } else {
          const start_time = Instant.now();
          const r = backend.compile_codegen_unit(tcx, cgu.name(), bitcode_needed);
          total_codegen_time = Duration_add(total_codegen_time, Instant.now().duration_since(start_time));
          [module, cost] = r;
        }
        // This will unwind if there are errors, which triggers our `AbortCodegenOnDrop`
        // guard. Unfortunately, just skipping the `submit_codegened_module_to_llvm` makes
        // compilation hang on post-monomorphization errors.
        tcx.dcx().abort_if_errors();

        ssa_write.submit_codegened_module_to_llvm(ongoing_codegen.coordinator, module, cost);
        break;
      }
      case "PreLto": {
        ssa_write.submit_pre_lto_module_to_llvm(tcx, ongoing_codegen.coordinator, {
          name: Symbol.as_str(cgu.name()),
          source: cgu.previous_work_product(tcx),
        });
        // This will unwind if there are errors, which triggers our `AbortCodegenOnDrop`
        // guard. Unfortunately, just skipping the `submit_pre_lto_module_to_llvm` makes
        // compilation hang on post-monomorphization errors.
        tcx.dcx().abort_if_errors();
        break;
      }
      case "PostLto": {
        ssa_write.submit_post_lto_module_to_llvm(ongoing_codegen.coordinator, {
          name: Symbol.as_str(cgu.name()),
          source: cgu.previous_work_product(tcx),
        });
        break;
      }
    }
  }

  ssa_write.OngoingCodegen_codegen_finished(ongoing_codegen, tcx);

  // Since the main thread is sometimes blocked during codegen, we keep track
  // -Ztime-passes output manually.
  if (tcx.sess.opts.unstable_opts.time_passes) {
    const end_rss = get_resident_set_size();

    print_time_passes_entry("codegen_to_LLVM_IR", total_codegen_time, unwrap(start_rss), end_rss, tcx.sess.opts.unstable_opts.time_passes_format);
  }

  ssa_write.OngoingCodegen_check_for_errors(ongoing_codegen, tcx.sess);
  return ongoing_codegen;
}

/// Returns whether a call from the current crate to the [`Instance`] would produce a call
/// from `compiler_builtins` to a symbol the linker must resolve.
///
/// Such calls from `compiler_builtins` are effectively impossible for the linker to handle. Some
/// linkers will optimize such that dead calls to unresolved symbols are not an error, but this is
/// not guaranteed. So we use this function in codegen backends to ensure we do not generate any
/// unlinkable calls.
///
/// Note that calls to LLVM intrinsics are uniquely okay because they won't make it to the linker.
/// Note also that calls to foreign items that are actually exported by the local crate are also
/// okay. This situation arises because compiler-builtins calls functions in core that are
/// `#[inline]` wrappers for `extern "C"` declarations in core, which resolve to a symbol exported
/// by compiler-builtins.
// rustc: compiler/rustc_codegen_ssa/src/base.rs:932 is_call_from_compiler_builtins_to_upstream_monomorphization
export function is_call_from_compiler_builtins_to_upstream_monomorphization(tcx: TyCtxt, instance: Instance): boolean {
  if (instance.def.$ === "LlvmIntrinsic") {
    return false;
  }

  // rustc: compiler/rustc_codegen_ssa/src/base.rs:940 is_extern_call_to_local_crate
  function is_extern_call_to_local_crate(tcx: TyCtxt, instance: Instance): boolean {
    return (
      tcx.is_foreign_item(Instance.def_id(instance)) &&
      (tcx.exported_non_generic_symbols(LOCAL_CRATE) as readonly [ExportedSymbol, SymbolExportInfo][]).some(
        ([sym, _info]) => ExportedSymbol.symbol_name_for_local_instance(sym, tcx).name === tcx.symbol_name(instance).name,
      )
    );
  }

  const def_id = Instance.def_id(instance);
  return (
    !def_id.is_local() &&
    tcx.is_compiler_builtins(LOCAL_CRATE) &&
    !tcx.should_codegen_locally(instance) &&
    !is_extern_call_to_local_crate(tcx, instance)
  );
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:954 collect_eii_linkage
function collect_eii_linkage(tcx: TyCtxt): EiiLinkageInfo[] {
  // #[derive(Debug)]
  interface FoundImpl {
    imp: EiiImpl;
    impl_crate: CrateNum;
  }

  // #[derive(Debug)]
  interface FoundEii {
    decl: EiiDecl;
    impls: DefIdMap<FoundImpl>;
  }

  const eiis = new DefIdMap<FoundEii>();

  for (const cnum of [...tcx.crates(null), LOCAL_CRATE]) {
    for (const [did, [decl, impls]] of tcx.externally_implementable_items(cnum) as Map<DefId, [EiiDecl, Map<DefId, EiiImpl>]>) {
      let entry = eiis.get(did);
      if (entry === undefined) {
        entry = { decl, impls: new DefIdMap() };
        eiis.set(did, entry);
      }
      for (const [did, imp] of impls) {
        entry.impls.set(did, { imp, impl_crate: cnum });
      }
    }
  }

  const out: EiiLinkageInfo[] = [];
  for (const [, { decl, impls }] of eiis) {
    const explicit_impls: EiiLinkageImplInfo[] = [];
    let default_impl: EiiLinkageImplInfo | undefined = undefined;

    for (const [impl_did, { imp, impl_crate }] of impls) {
      const impl_info: EiiLinkageImplInfo = { span: tcx.def_span(impl_did), impl_crate };
      if (imp.is_default) {
        default_impl = impl_info;
      } else {
        explicit_impls.push(impl_info);
      }
    }

    // Link time check is only needed when there may be a default impl in a dylib.
    // Other cases emit an error in `rustc_passes` already.
    if (default_impl !== undefined) {
      out.push({
        name: decl.name.name,
        impls: explicit_impls,
        default_impl: default_impl,
      });
    }
  }
  return out;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:1011 eii_linkage_needed
function eii_linkage_needed(dependency_formats: Dependencies): boolean {
  return [...dependency_formats.values()].some((formats) => formats.some((linkage) => linkage === "Dynamic" || linkage === "IncludedFromDylib"));
}

// PORT: `impl CrateInfo { pub fn new }` as a free fn (see `CrateInfo` in lib.ts).
// rustc: compiler/rustc_codegen_ssa/src/base.rs:1020 new
export function CrateInfo_new(tcx: TyCtxt, target_cpu: string): CrateInfo {
  const crate_types = [...tcx.crate_types()];
  const exported_symbols = new Map(crate_types.map((c) => [c, linker_exported_symbols(tcx, c)] as const));
  const linked_symbols = new Map(crate_types.map((c) => [c, linker_linked_symbols(tcx, c)] as const));
  const local_crate_name = tcx.crate_name(LOCAL_CRATE);
  const windows_subsystem = find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "WindowsSubsystem" ? k._0 : undefined));
  const dependency_formats = tcx.dependency_formats(null) as Dependencies;
  const eii_linkage = eii_linkage_needed(dependency_formats) ? collect_eii_linkage(tcx) : [];

  // This list is used when generating the command line to pass through to
  // system linker. The linker expects undefined symbols on the left of the
  // command line to be defined in libraries on the right, not the other way
  // around. For more info, see some comments in the add_used_library function
  // below.
  //
  // In order to get this left-to-right dependency ordering, we use the reverse
  // postorder of all crates putting the leaves at the rightmost positions.
  let compiler_builtins: CrateNum | undefined = undefined;
  const used_crates: CrateNum[] = [...tcx.postorder_cnums(null)].reverse().filter((cnum) => {
    const link = !CrateDepKindC.macros_only(tcx.crate_dep_kind(cnum) as CrateDepKind);
    if (link && tcx.is_compiler_builtins(cnum)) {
      compiler_builtins = cnum;
      return false;
    }
    return link;
  });
  // `compiler_builtins` are always placed last to ensure that they're linked correctly.
  if (compiler_builtins !== undefined) used_crates.push(compiler_builtins);

  const crates = tcx.crates(null);
  // let n_crates = crates.len();
  const info: CrateInfo = {
    target_cpu,
    target_features: [...tcx.sess.global_backend_features],
    crate_types,
    exported_symbols,
    linked_symbols,
    local_crate_name,
    compiler_builtins,
    profiler_runtime: undefined,
    is_no_builtins: new Set(),
    native_libraries: new Map(),
    used_libraries: (tcx.native_libraries(LOCAL_CRATE) as cstore_NativeLib[]).map(NativeLib_from),
    crate_name: new Map(),
    used_crates,
    used_crate_source: new Map(),
    dependency_formats,
    eii_linkage,
    windows_subsystem,
    natvis_debugger_visualizers: [],
    lint_level_specs: CodegenLintLevelSpecs.from_tcx(tcx),
    metadata_symbol: metadata_symbol_name(tcx),
    symbol_rename_suffix: `.rs${lower_hex_StableCrateId(tcx.stable_crate_id(LOCAL_CRATE), PLAIN)}`,
    each_linked_rlib_file_for_lto: [],
    exported_symbols_for_lto: [],
  };

  // info.native_libraries.reserve(n_crates);

  for (const cnum of crates) {
    info.native_libraries.set(cnum, (tcx.native_libraries(cnum) as cstore_NativeLib[]).map(NativeLib_from));
    info.crate_name.set(cnum, tcx.crate_name(cnum));

    const used_crate_source = tcx.used_crate_source(cnum) as CrateSource;
    info.used_crate_source.set(cnum, used_crate_source);
    if (tcx.is_profiler_runtime(cnum)) {
      info.profiler_runtime = cnum;
    }
    if (tcx.is_no_builtins(cnum)) {
      info.is_no_builtins.add(cnum);
    }
  }

  // Handle circular dependencies in the standard library.
  // See comment before `add_linked_symbol_object` function for the details.
  // If global LTO is enabled then almost everything (*) is glued into a single object file,
  // so this logic is not necessary and can cause issues on some targets (due to weak lang
  // item symbols being "privatized" to that object file), so we disable it.
  // (*) Native libs, and `#[compiler_builtins]` and `#[no_builtins]` crates are not glued,
  // and we assume that they cannot define weak lang items. This is not currently enforced
  // by the compiler, but that's ok because all this stuff is unstable anyway.
  const target = tcx.sess.target;
  if (!are_upstream_rust_objects_already_included(tcx.sess)) {
    const add_prefix: (name: string, export_kind: SymbolExportKind) => string =
      target.is_like_windows && target.arch.$ === "X86"
        ? (name, _) => `_${name}`
        : target.is_like_windows && target.arch.$ === "Arm64EC"
          ? // Only functions are decorated for arm64ec.
            (name, export_kind) => (export_kind === "Text" ? `#${name}` : name)
          : (name, _) => name;
    // PORT: `FxIndexSet<(Symbol, SymbolExportKind)>`, keyed by the pair.
    const missing_weak_lang_items = new Map<string, [Symbol, SymbolExportKind]>();
    for (const cnum of info.used_crates) {
      for (const l of tcx.missing_lang_items(cnum)) {
        if (!LangItem.is_weak(l)) continue;
        const name = LangItem.link_name(l);
        if (name === undefined) continue;
        const t = LangItem.target(l);
        let export_kind: SymbolExportKind;
        if (t.$ === "ForeignFn" || t.$ === "Fn") {
          export_kind = "Text";
        } else if (t.$ === "Static") {
          export_kind = "Data";
        } else {
          return bug(`Don't know what the export kind is for lang item of kind ${t.$}`);
        }
        if (lang_items_required(tcx, l)) {
          const key = `${name}:${export_kind}`;
          if (!missing_weak_lang_items.has(key)) missing_weak_lang_items.set(key, [name, export_kind]);
        }
      }
    }

    // This loop only adds new items to values of the hash map, so the order in which we
    // iterate over the values is not important.
    // #[allow(rustc::potential_query_instability)]
    for (const [crate_type, linked_symbols] of info.linked_symbols) {
      if (crate_type === "Rlib" || crate_type === "StaticLib") continue;
      const symbols = [...missing_weak_lang_items.values()].map(
        ([item, export_kind]): [string, SymbolExportKind] => [add_prefix(mangle_internal_symbol(tcx, Symbol.as_str(item)), export_kind), export_kind],
      );
      symbols.sort((a, b) => str_cmp(a[0], b[0]));
      linked_symbols.push(...symbols);
    }
  }

  const each_linked_rlib_for_lto: CrateNum[] = [];
  const each_linked_rlib_file_for_lto: string[] = [];
  if (tcx.sess.lto() !== "No" && tcx.sess.lto() !== "ThinLocal") {
    // drop(..): a `LinkRlibError` here is dropped; linking reports it through its own call.
    void each_linked_rlib(info, undefined, (cnum, path) => {
      if (ignored_for_lto(tcx.sess, info, cnum)) {
        return;
      }

      each_linked_rlib_for_lto.push(cnum);
      each_linked_rlib_file_for_lto.push(path);
    });
  }
  info.each_linked_rlib_file_for_lto = each_linked_rlib_file_for_lto;

  // FIXME move to -Zlink-only half such that each_linked_rlib_file_for_lto can be moved there too
  // Compute the set of symbols we need to retain when doing LTO (if we need to)
  info.exported_symbols_for_lto = lto_exported_symbols_for_lto(tcx, each_linked_rlib_for_lto);

  const embed_visualizers = tcx.crate_types().some((crate_type) => {
    switch (crate_type) {
      case "Executable":
      case "Dylib":
      case "Cdylib":
      case "Sdylib":
        // These are crate types for which we invoke the linker and can embed
        // NatVis visualizers.
        return true;
      case "ProcMacro":
        // We could embed NatVis for proc macro crates too (to improve the debugging
        // experience for them) but it does not seem like a good default, since
        // this is a rare use case and we don't want to slow down the common case.
        return false;
      case "StaticLib":
      case "Rlib":
        // We don't invoke the linker for these, so we don't need to collect the NatVis for
        // them.
        return false;
    }
  });

  if (target.is_like_msvc && embed_visualizers) {
    info.natvis_debugger_visualizers = collect_debugger_visualizers_transitive(tcx, "Natvis");
  }

  return info;
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:1221 provide
export function provide(providers: Providers): void {
  providers.backend_optimization_level = (tcx, cratenum) => {
    let for_speed: OptLevel;
    switch (tcx.sess.opts.optimize) {
      // If globally no optimisation is done, #[optimize] has no effect.
      //
      // This is done because if we ended up "upgrading" to `-O2` here, we’d populate the
      // pass manager and it is likely that some module-wide passes (such as inliner or
      // cross-function constant propagation) would ignore the `optnone` annotation we put
      // on the functions, thus necessarily involving these functions into optimisations.
      case "No":
        return "No";
      // If globally optimise-speed is already specified, just use that level.
      case "Less":
        return "Less";
      case "More":
        return "More";
      case "Aggressive":
        return "Aggressive";
      // If globally optimize-for-size has been requested, use -O2 instead (if optimize(size)
      // are present).
      case "Size":
        for_speed = "More";
        break;
      case "SizeMin":
        for_speed = "More";
        break;
    }

    // PORT: `MonoItemPartitions` (rustc_middle mono.rs) is not ported; its `all_mono_items` is a set of `DefId`s.
    const defids = (tcx.collect_and_partition_mono_items(cratenum) as { all_mono_items: Iterable<DefId> }).all_mono_items;

    const any_for_speed = [...defids].some((id) => {
      const { optimize } = tcx.codegen_fn_attrs(id) as CodegenFnAttrs;
      return optimize === "Speed";
    });

    if (any_for_speed) {
      return for_speed;
    }

    return tcx.sess.opts.optimize;
  };
}

// rustc: compiler/rustc_codegen_ssa/src/base.rs:1256 determine_cgu_reuse
export function determine_cgu_reuse(tcx: TyCtxt, cgu: CodegenUnit): CguReuse {
  if (!tcx.dep_graph.is_fully_enabled() || tcx.sess.opts.unstable_opts.disable_incr_comp_backend_caching) {
    return "No";
  }

  const work_product_id = cgu.work_product_id();
  // PORT: no dep graph (plan-m2 D3, plan-m3 D12): the graph is never fully enabled, so the early return above is always
  // taken, and `work_product_id` stops (`WorkProductId` is not ported, incremental). The rest of upstream's body needs
  // `DepGraph::{previous_work_product, assert_dep_node_not_yet_allocated_in_current_session, try_mark_green}`, which the
  // disabled graph does not have; it stays as upstream's text:
  //
  // if tcx.dep_graph.previous_work_product(work_product_id).is_none() {
  //     // We don't have anything cached for this CGU. This can happen
  //     // if the CGU did not exist in the previous session.
  //     return CguReuse::No;
  // }
  //
  // // Try to mark the CGU as green. If it we can do so, it means that nothing
  // // affecting the LLVM module has changed and we can re-use a cached version.
  // // If we compile with any kind of LTO, this means we can re-use the bitcode
  // // of the Pre-LTO stage (possibly also the Post-LTO version but we'll only
  // // know that later). If we are not doing LTO, there is only one optimized
  // // version of each module, so we re-use that.
  // let dep_node = cgu.codegen_dep_node(tcx);
  // tcx.dep_graph.assert_dep_node_not_yet_allocated_in_current_session(tcx.sess, &dep_node, || {
  //     format!(
  //         "CompileCodegenUnit dep-node for CGU `{}` already exists before marking.",
  //         cgu.name()
  //     )
  // });
  //
  // if tcx.dep_graph.try_mark_green(tcx, &dep_node).is_some() {
  //     // We can re-use either the pre- or the post-thinlto state. If no LTO is
  //     // being performed then we can use post-LTO artifacts, otherwise we must
  //     // reuse pre-LTO artifacts
  //     match compute_per_cgu_lto_type(
  //         &tcx.sess.lto(),
  //         tcx.sess.opts.cg.linker_plugin_lto.enabled(),
  //         tcx.crate_types(),
  //     ) {
  //         ComputedLtoType::No => CguReuse::PostLto,
  //         _ => CguReuse::PreLto,
  //     }
  // } else {
  //     CguReuse::No
  // }
  return work_product_id;
}

// ---- Helpers (not upstream) ------------------------------------------------------------------------------------------

/** `impl TypeFoldable for ExistentialTraitRef` (derived) as a D4 table. */
const d_ExistentialTraitRef: TypeFoldable<ExistentialTraitRef> = {
  visit_with: visit_with_ExistentialTraitRef,
  try_fold_with: try_fold_with_ExistentialTraitRef,
  fold_with: fold_with_ExistentialTraitRef,
};

/** `impl TypeFoldable for PolyFnSig` (`Binder<FnSig>`) as a D4 table. */
const fold_PolyFnSig = fold_Binder(fold_FnSig);

/** `Itertools::interleave`: alternate `a` and `b`; once one is exhausted, the rest of the other. */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]!);
    if (i < b.length) out.push(b[i]!);
  }
  return out;
}

/** `impl AddAssign for Duration` (core time.rs): `checked_add(..).expect("overflow when adding durations")`. */
function Duration_add(a: Duration, b: Duration): Duration {
  return unwrap(a.checked_add(b), "overflow when adding durations");
}

/** `#[derive(Ord)]` of `DebuggerVisualizerFile` (`src: Arc<[u8]>`, `visualizer_type`, `path: Option<PathBuf>`), for the
 *  `BTreeSet` in `collect_debugger_visualizers_transitive`. */
function cmp_DebuggerVisualizerFile(a: DebuggerVisualizerFile, b: DebuggerVisualizerFile): number {
  const n = Math.min(a.src.length, b.src.length);
  for (let i = 0; i < n; i++) {
    if (a.src[i] !== b.src[i]) return a.src[i]! < b.src[i]! ? -1 : 1;
  }
  if (a.src.length !== b.src.length) return a.src.length < b.src.length ? -1 : 1;
  const ta = a.visualizer_type === "Natvis" ? 0 : 1;
  const tb = b.visualizer_type === "Natvis" ? 0 : 1;
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.path === undefined || b.path === undefined) {
    if (a.path === undefined && b.path === undefined) return 0;
    return a.path === undefined ? -1 : 1;
  }
  // PORT: `PathBuf`'s `Ord` compares components (std path.rs `compare_components`), which src/std/path.ts does not port.
  return unported("std::path::PathBuf: Ord (compare_components), for the BTreeSet<DebuggerVisualizerFile> of natvis files");
}

// PORT (init order): these modules are required at call time. A static import would evaluate them when lib.ts loads this
// file at startup, which changes the module load order of every suite (plan-m7 D14: codegen loads lazily).
function lazy_mir(): typeof import("./mir/mod.ts") {
  return (lazy_mir__m ??= require("./mir/mod.ts") as typeof import("./mir/mod.ts"));
}
var lazy_mir__m: typeof import("./mir/mod.ts") | undefined;
function lazy_mir_operand(): typeof import("./mir/operand.ts") {
  return (lazy_mir_operand__m ??= require("./mir/operand.ts") as typeof import("./mir/operand.ts"));
}
var lazy_mir_operand__m: typeof import("./mir/operand.ts") | undefined;
function lazy_trait_selection_engine(): typeof import("../rustc_trait_selection/traits/engine.ts") {
  return (lazy_trait_selection_engine__m ??= require("../rustc_trait_selection/traits/engine.ts") as typeof import("../rustc_trait_selection/traits/engine.ts"));
}
var lazy_trait_selection_engine__m: typeof import("../rustc_trait_selection/traits/engine.ts") | undefined;
function lazy_infer_at(): typeof import("../rustc_infer/infer/at.ts") {
  return (lazy_infer_at__m ??= require("../rustc_infer/infer/at.ts") as typeof import("../rustc_infer/infer/at.ts"));
}
var lazy_infer_at__m: typeof import("../rustc_infer/infer/at.ts") | undefined;
function lazy_infer_traits_engine(): typeof import("../rustc_infer/traits/engine.ts") {
  return (lazy_infer_traits_engine__m ??= require("../rustc_infer/traits/engine.ts") as typeof import("../rustc_infer/traits/engine.ts"));
}
var lazy_infer_traits_engine__m: typeof import("../rustc_infer/traits/engine.ts") | undefined;
function lazy_meth(): typeof import("./meth.ts") {
  return (lazy_meth__m ??= require("./meth.ts") as typeof import("./meth.ts"));
}
var lazy_meth__m: typeof import("./meth.ts") | undefined;

// ---- Not ported (stops) -----------------------------------------------------------------------------------------------

/** `-Z time-passes` (rustc_data_structures profiling.rs): not ported (rustc_driver_impl stops on it too). */
function get_resident_set_size(): number | undefined {
  return unported("rustc_data_structures::profiling::get_resident_set_size (-Z time-passes)");
}
function print_time_passes_entry(_what: string, _dur: Duration, _start_rss: number | undefined, _end_rss: number | undefined, _format: unknown): void {
  unported("rustc_data_structures::profiling::print_time_passes_entry (-Z time-passes)");
}

/** Placeholder (ssa-base): `pub struct OngoingCodegen<B>` (back/write.rs), lane ssa-write. Only its `coordinator` field is
 *  read here. */
export interface OngoingCodegen {
  readonly coordinator: Coordinator;
}
/** Placeholder (ssa-base): `pub struct Coordinator<B: WriteBackendMethods>` (back/write.rs:2054), lane ssa-write. */
export interface Coordinator {
  readonly __Coordinator: never;
}
/** The back/write.rs fns `codegen_crate` calls (lane ssa-write, a later wave: "its functions stay stubs"). Each stops with
 *  `unported("ssa-write: ...")`. Not prototype methods or statics, so nothing collides when ssa-write lands: root repoints
 *  each entry (or its call sites). Tests replace entries to drive `codegen_crate` over a mock backend. Methods take the
 *  receiver first. */
export const ssa_write = {
  /** `ModuleConfig::new(kind, tcx, no_builtins)` (back/write.rs). */
  ModuleConfig_new(_kind: ModuleKind, _tcx: TyCtxt, _no_builtins: boolean): ModuleConfig {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs ModuleConfig::new");
  },
  /** `ModuleConfig::bitcode_needed(&self)` (back/write.rs). */
  ModuleConfig_bitcode_needed(_self: ModuleConfig): boolean {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs ModuleConfig::bitcode_needed");
  },
  /** `start_async_codegen(backend, tcx, regular_config, allocator_config, allocator_module)` (back/write.rs). */
  start_async_codegen<M, W extends WriteBackendTypes>(
    _backend: ExtraBackendMethods<M> & WriteBackendMethods<W>,
    _tcx: TyCtxt,
    _regular_config: ModuleConfig,
    _allocator_config: ModuleConfig,
    _allocator_module: ModuleCodegen<M> | undefined,
  ): OngoingCodegen {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs start_async_codegen");
  },
  /** `OngoingCodegen::wait_for_signal_to_codegen_item(&self)` (back/write.rs). */
  OngoingCodegen_wait_for_signal_to_codegen_item(_self: OngoingCodegen): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs OngoingCodegen::wait_for_signal_to_codegen_item");
  },
  /** `OngoingCodegen::check_for_errors(&self, sess)` (back/write.rs). */
  OngoingCodegen_check_for_errors(_self: OngoingCodegen, _sess: Session): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs OngoingCodegen::check_for_errors");
  },
  /** `OngoingCodegen::codegen_finished(&self, tcx)` (back/write.rs). */
  OngoingCodegen_codegen_finished(_self: OngoingCodegen, _tcx: TyCtxt): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs OngoingCodegen::codegen_finished");
  },
  /** `submit_codegened_module_to_llvm(coordinator, module, cost)` (back/write.rs). */
  submit_codegened_module_to_llvm<M>(_coordinator: Coordinator, _module: ModuleCodegen<M>, _cost: number): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs submit_codegened_module_to_llvm");
  },
  /** `submit_pre_lto_module_to_llvm(tcx, coordinator, module)` (back/write.rs). */
  submit_pre_lto_module_to_llvm(_tcx: TyCtxt, _coordinator: Coordinator, _module: CachedModuleCodegen): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs submit_pre_lto_module_to_llvm");
  },
  /** `submit_post_lto_module_to_llvm(coordinator, module)` (back/write.rs). */
  submit_post_lto_module_to_llvm(_coordinator: Coordinator, _module: CachedModuleCodegen): void {
    return unported("ssa-write: compiler/rustc_codegen_ssa/src/back/write.rs submit_post_lto_module_to_llvm");
  },
};
