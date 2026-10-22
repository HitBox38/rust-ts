// Port of compiler/rustc_const_eval/src/interpret/util.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-ops; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type CompileTimeInterpCx } from "../const_eval/machine.ts";
import { InterpCx } from "./eval_context.ts";
import { type ConstAllocation, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type LocalDefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";
import type { InterpretationResult } from "../const_eval/eval_queries.ts";
import { MPlaceTy } from "./place.gen.ts";

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

// stub: compiler/rustc_const_eval/src/interpret/util.rs:18 type_implements_dyn_trait (lane interp-ops)
export function type_implements_dyn_trait(ecx: InterpCx, ty: Ty, trait_ty: Ty): InterpResult<[boolean, List<PolyExistentialPredicate>]> {
  return unported("rustc_const_eval::interpret::util::type_implements_dyn_trait");
}

// stub: compiler/rustc_const_eval/src/interpret/util.rs:57 ensure_monomorphic_enough (lane interp-ops)
export function ensure_monomorphic_enough<T>(ty: T): InterpResult {
  return unported("rustc_const_eval::interpret::util::ensure_monomorphic_enough");
}

// impl<'tcx> InterpretationResult<'tcx> for mir::interpret::ConstAllocation<'tcx>
export const InterpretationResult_ConstAllocation: InterpretationResult<ConstAllocation> = {
  // stub: compiler/rustc_const_eval/src/interpret/util.rs:69 make_result (lane interp-ops)
  make_result(mplace: MPlaceTy, ecx: CompileTimeInterpCx): ConstAllocation {
    return unported("rustc_const_eval::interpret::util::ConstAllocation::make_result");
  },
};

// stub: compiler/rustc_const_eval/src/interpret/util.rs:79 create_static_alloc (lane interp-ops)
export function create_static_alloc(ecx: CompileTimeInterpCx, static_def_id: LocalDefId, layout: TyAndLayout): InterpResult<MPlaceTy> {
  return unported("rustc_const_eval::interpret::util::create_static_alloc");
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
// PORT: `tracing::span::EnteredSpan` is not ported (no tracing); the impl is declared for the fill lane.
export const EnteredTraceSpan_EnteredSpan: EnteredTraceSpan_impl<unknown> = {
  // stub: compiler/rustc_const_eval/src/interpret/util.rs:115 or_if_tracing_disabled (lane interp-ops)
  or_if_tracing_disabled(self: unknown, _f: () => void): unknown {
    return unported("rustc_const_eval::interpret::util::EnteredSpan::or_if_tracing_disabled");
  },
};
