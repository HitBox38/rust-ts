// Port of compiler/rustc_const_eval/src/interpret/util.rs (declared by lane interp-contract, filled by lane interp-ops).
import { debug_Size } from "../../rustc_abi/lib.ts";
import { type CompileTimeInterpCx, type FxIndexMap_AllocMap } from "../const_eval/machine.ts";
import type { CtfeMemoryKind } from "./machine.ts";
import type { MemoryKind } from "./memory.gen.ts";
import { InterpCx } from "./eval_context.ts";
import {
  type AllocId,
  AllocInit,
  Allocation,
  type ConstAllocation,
  CtfeProvenance,
  debug_AllocId,
  GlobalAlloc,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Pointer_from_AllocId,
  Pointer_Option_from_Pointer,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate, Predicate_upcast_from_Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause } from "../../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { CRATE_DEF_ID, debug_LocalDefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { fold_regions } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { PolyExistentialPredicate as PolyExistentialPredicateC } from "../../rustc_type_ir/predicate.ts";
import { TypeVisitableExt, type TypeVisitable } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import type { InterpretationResult } from "../const_eval/eval_queries.ts";
import { MPlaceTy } from "./place.gen.ts";

/** Lazy `crate::const_eval::machine` (read at call time; init order, eval_context.ts header). */
function const_eval_machine(): typeof import("../const_eval/machine.ts") {
  return require("../const_eval/machine.ts") as typeof import("../const_eval/machine.ts");
}
/** Lazy `super::MemoryKind` (memory.ts). */
function memory(): typeof import("./memory.ts") {
  return require("./memory.ts") as typeof import("./memory.ts");
}

/// A marker trait returned by [crate::interpret::Machine::enter_trace_span], identifying either a
/// real [tracing::span::EnteredSpan] in case tracing is enabled, or the dummy type `()` when
/// tracing is disabled. Also see [crate::enter_trace_span!] below.
// pub trait EnteredTraceSpan
// PORT: tracing is not ported, so the only value is `()` (`undefined`, the impl for tracing being disabled); the trait
// is an impl table over the value (`EnteredTraceSpan_unit`), `EnteredTraceSpan` itself the value type.
export type EnteredTraceSpan = undefined;
export interface EnteredTraceSpan_impl<S> {
  /// Allows executing an alternative function when tracing is disabled. Useful for example if you
  /// want to open a trace span when tracing is enabled, and alternatively just log a line when
  /// tracing is disabled.
  // rustc: compiler/rustc_const_eval/src/interpret/util.rs:106 or_if_tracing_disabled
  or_if_tracing_disabled(self: S, f: () => void): S;
}

/// Checks if a type implements predicates.
/// Calls `ensure_monomorphic_enough` on `ty` and `trait_ty` for you.
// rustc: compiler/rustc_const_eval/src/interpret/util.rs:18 type_implements_dyn_trait
export function type_implements_dyn_trait(ecx: InterpCx, ty: Ty, trait_ty: Ty): InterpResult<[boolean, List<PolyExistentialPredicate>]> {
  const r1 = ensure_monomorphic_enough(ty, fold_Ty_());
  if (r1.$ === "Err") return r1;
  const r2 = ensure_monomorphic_enough(trait_ty, fold_Ty_());
  if (r2.$ === "Err") return r2;

  const kind = trait_ty.kind();
  if (kind.$ !== "Dynamic") {
    return span_bug(
      ecx.find_closest_untracked_caller_location(),
      `Invalid type provided to type_implements_predicates. U must be dyn Trait, got ${display_Ty(trait_ty)}.`,
    );
  }
  const preds = kind._0;

  const [infcx, param_env] = ecx.tcx.deref().infer_ctxt().build_with_typing_env(TypingEnv.new(ecx.typing_env.param_env, TypingMode.Reflection));

  const ocx = ObligationCtxt.new(infcx);
  ocx.register_obligations(
    preds.map((pred: PolyExistentialPredicate) => {
      let pred_ = PolyExistentialPredicateC.with_self_ty(pred, ecx.tcx.tcx, ty);
      // Lifetimes can only be 'static because of the bound on T
      pred_ = fold_regions(
        ecx.tcx.tcx,
        pred_,
        (r, _) => (r === ecx.tcx.tcx.lifetimes.re_erased ? ecx.tcx.tcx.lifetimes.re_static : r),
        fold_Clause,
      );
      return Obligation.new(ecx.tcx.tcx, ObligationCause.dummy(), param_env, pred_, (from, _cx) => Predicate_upcast_from_Clause(from, ecx.tcx.tcx));
    }),
  );
  const type_impls_trait = TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
  // Since `assumed_wf_tys=[]` the choice of LocalDefId is irrelevant, so using the "default"
  const regions_are_valid = ocx.resolve_regions(CRATE_DEF_ID, param_env, []).length === 0;

  return interp_ok<[boolean, List<PolyExistentialPredicate>]>([regions_are_valid && type_impls_trait, preds]);
}

/** `rustc_middle::ty::structural_impls::fold_Ty` (the `TypeVisitable` of `Ty`), read lazily. */
function fold_Ty_(): TypeVisitable<Ty> {
  return (require("../../rustc_middle/ty/structural_impls.ts") as typeof import("../../rustc_middle/ty/structural_impls.ts")).fold_Ty;
}

/// Checks whether a type contains generic parameters which must be instantiated.
///
/// In case it does, returns a `TooGeneric` const eval error.
// PORT: `T: TypeVisitable` takes its descriptor `d_T` (eval_context.ts header, generic parameters); this changes the
// contract's declared signature (handoff).
// rustc: compiler/rustc_const_eval/src/interpret/util.rs:57 ensure_monomorphic_enough
export function ensure_monomorphic_enough<T>(ty: T, d_T: TypeVisitable<T>): InterpResult {
  // debug!("ensure_monomorphic_enough: ty={:?}", ty);
  if (TypeVisitableExt.has_param(ty, d_T)) {
    // throw_inval!(TooGeneric)
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "InvalidProgram", _0: { $: "TooGeneric" } }));
  }
  return interp_ok(undefined);
}

// impl<'tcx> InterpretationResult<'tcx> for mir::interpret::ConstAllocation<'tcx>
export const InterpretationResult_ConstAllocation: InterpretationResult<ConstAllocation> = {
  // rustc: compiler/rustc_const_eval/src/interpret/util.rs:69 make_result
  make_result(mplace: MPlaceTy, ecx: CompileTimeInterpCx): ConstAllocation {
    const alloc_id = CtfeProvenance.alloc_id(unwrap(mplace.ptr().provenance));
    // `ecx.memory.alloc_map.swap_remove(&alloc_id).unwrap().1`
    // PORT: `FxIndexMap::swap_remove` on the CTFE machine's `MemoryMap` (`FxIndexMap_AllocMap`, const_eval/machine.ts).
    const alloc_map = ecx.memory.alloc_map as FxIndexMap_AllocMap<AllocId, [MemoryKind<CtfeMemoryKind>, Allocation]>;
    const alloc = unwrap(const_eval_machine().swap_remove(alloc_map.map, alloc_id))[1];
    return ecx.tcx.deref().mk_const_alloc(alloc);
  },
};

// rustc: compiler/rustc_const_eval/src/interpret/util.rs:79 create_static_alloc
export function create_static_alloc(ecx: CompileTimeInterpCx, static_def_id: LocalDefId, layout: TyAndLayout): InterpResult<MPlaceTy> {
  // Inherit size and align from the `GlobalAlloc::Static` so we can avoid duplicating
  // the alignment attribute logic.
  const [size, align] = GlobalAlloc.size_and_align({ $: "Static", _0: LocalDefId.to_def_id(static_def_id) }, ecx.tcx.deref(), ecx.typing_env);
  assert_eq(size, layout.size, (v) => debug_Size(v, PLAIN), (a, b) => a.bytes() === b.bytes());
  assert(align.pow2 >= layout.align.abi.pow2, "assertion failed: align >= layout.align.abi");

  const alloc = Allocation.try_new(size, align, AllocInit.Uninit, null);
  if (alloc.$ === "Err") return alloc;
  const alloc_id = ecx.tcx.deref().reserve_and_set_static_alloc(LocalDefId.to_def_id(static_def_id));
  assert_eq(ecx.machine.static_root_ids, undefined, (v) =>
    v === undefined ? "None" : `Some((${debug_AllocId(v[0], PLAIN)}, ${debug_LocalDefId(v[1], PLAIN)}))`,
  );
  ecx.machine.static_root_ids = [alloc_id, static_def_id];
  assert(ecx.memory.alloc_map.insert(alloc_id, [memory().MemoryKind.Stack, alloc._0]) === undefined, "assertion failed: ecx.memory.alloc_map.insert(alloc_id, (MemoryKind::Stack, alloc)).is_none()");
  return interp_ok(ecx.ptr_to_mplace(Pointer_Option_from_Pointer(Pointer_from_AllocId(alloc_id)), layout));
}

// impl EnteredTraceSpan for ()
export const EnteredTraceSpan_unit: EnteredTraceSpan_impl<undefined> = {
  // rustc: compiler/rustc_const_eval/src/interpret/util.rs:109 or_if_tracing_disabled
  or_if_tracing_disabled(self: undefined, f: () => void): undefined {
    f(); // tracing is disabled, execute the function
    return self;
  },
};

// impl EnteredTraceSpan for tracing::span::EnteredSpan
// PORT: `tracing::span::EnteredSpan` is not ported (no tracing; nothing produces one); the impl is kept for completeness.
export const EnteredTraceSpan_EnteredSpan: EnteredTraceSpan_impl<unknown> = {
  // rustc: compiler/rustc_const_eval/src/interpret/util.rs:115 or_if_tracing_disabled
  or_if_tracing_disabled(self: unknown, _f: () => void): unknown {
    return self; // tracing is enabled, don't execute anything
  },
};
