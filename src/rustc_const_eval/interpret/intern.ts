// Port of compiler/rustc_const_eval/src/interpret/intern.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// interp-validity-intern; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type Mutability } from "../../rustc_ast_ir/lib.ts";
import { CompileTimeMachine } from "../const_eval/machine.ts";
import { InterpCx } from "./eval_context.ts";
import { InternError, InternKind } from "./intern.gen.ts";
import { type CtfeMemoryKind, type Machine } from "./machine.ts";
import { MemoryKind } from "./memory.ts";
import { type PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { type AllocId, type Allocation, type ConstAllocation, type CtfeProvenance, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type LocalDefId } from "../../rustc_span/def_id.ts";
import { unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";
import { MPlaceTy, PlaceTy } from "./place.gen.ts";

export * from "./intern.gen.ts";

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // intern.rs:383 (lane interp-validity-intern)
    intern_with_temp_alloc(layout: TyAndLayout, f: (a0: InterpCx, a1: PlaceTy) => InterpResult<undefined>): InterpResult<AllocId>;
  }
}

/// A trait for machines that support static roots
// pub trait HasStaticRootDefId
export interface HasStaticRootDefId {
  // rustc: compiler/rustc_const_eval/src/interpret/intern.rs:49 static_def_id
  static_def_id(): LocalDefId | undefined;
}

// PORT: `impl HasStaticRootDefId for const_eval::CompileTimeMachine<'_>` (intern.rs:52) is in the class body of
// `CompileTimeMachine` (const_eval/machine.ts); `impl .. for DummyMachine` in const_eval/dummy_machine.ts.

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:58 prepare_alloc (lane interp-validity-intern)
export function prepare_alloc<Prov, Extra, Bytes>(tcx: TyCtxt, kind: MemoryKind<CtfeMemoryKind>, alloc: Allocation, mutability: Mutability): Result<undefined, InternError> {
  return unported("rustc_const_eval::interpret::intern::prepare_alloc");
}

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:104 intern_shallow (lane interp-validity-intern)
export function intern_shallow(ecx: InterpCx, alloc_id: AllocId, mutability: Mutability, disambiguator: PerParentDisambiguatorState | undefined): Result<IterableIterator<CtfeProvenance>, InternError> {
  return unported("rustc_const_eval::interpret::intern::intern_shallow");
}

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:142 intern_as_new_static (lane interp-validity-intern)
export function intern_as_new_static(tcx: TyCtxtAt, static_id: LocalDefId, alloc_id: AllocId, alloc: ConstAllocation, disambiguator: PerParentDisambiguatorState): void {
  return unported("rustc_const_eval::interpret::intern::intern_as_new_static");
}

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:204 intern_const_alloc_recursive (lane interp-validity-intern)
export function intern_const_alloc_recursive(ecx: InterpCx, intern_kind: InternKind, ret: MPlaceTy): Result<undefined, InternError> {
  return unported("rustc_const_eval::interpret::intern::intern_const_alloc_recursive");
}

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:361 intern_const_alloc_for_constprop (lane interp-validity-intern)
export function intern_const_alloc_for_constprop(ecx: InterpCx, alloc_id: AllocId): InterpResult<undefined> {
  return unported("rustc_const_eval::interpret::intern::intern_const_alloc_for_constprop");
}

// stub: compiler/rustc_const_eval/src/interpret/intern.rs:383 intern_with_temp_alloc (lane interp-validity-intern)
InterpCx.prototype.intern_with_temp_alloc = function (this: InterpCx, layout: TyAndLayout, f: (a0: InterpCx, a1: PlaceTy) => InterpResult<undefined>): InterpResult<AllocId> {
  return unported("rustc_const_eval::interpret::intern::InterpCx::intern_with_temp_alloc");
};
