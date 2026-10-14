// Port of compiler/rustc_infer/src/infer/at.rs (lane infer-core).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.

import { unported_methods } from "../../rust_ts/stubs.ts";
import { At, InferCtxt } from "../decls.ts";

export * from "./at.gen.ts";

import type { Relate } from "../../rustc_type_ir/relate.ts";
import {
  relate_AliasTerm,
  relate_AliasTy,
  relate_Binder,
  relate_Const,
  relate_ExistentialProjection,
  relate_ExistentialTraitRef,
  relate_FnSig,
  relate_GenericArg,
  relate_Region,
  relate_Term,
  relate_TraitRef,
  relate_Ty,
} from "../../rustc_type_ir/relate.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { TypeTrace } from "./mod.gen.ts";
import { unported } from "../../std/panic.ts";

// rustc-type: compiler/rustc_infer/src/infer/at.rs:50 At (class in ../decls.ts)
export { At } from "../decls.ts";

/** `#[derive(Clone, Copy)]` of `At` (a hand type: codegen does not derive its Clone). */
export function clone_At(v: At): At {
  return new At(v.infcx, v.cause, v.param_env);
}

// PORT (D4): `trait ToTrace: Relate<TyCtxt> + Copy` is a descriptor extending `Relate<T>`; one object per impl,
// `ToTrace_<T>` (the `Relate` part spreads rustc_type_ir relate.ts's `relate_<T>`). Generic `T: ToTrace` code takes
// `d_T: ToTrace<T>` last (decls.ts `At`).
// rustc-trait: compiler/rustc_infer/src/infer/at.rs:129 ToTrace
export interface ToTrace<T> extends Relate<T> {
  // rustc: compiler/rustc_infer/src/infer/at.rs:130 to_trace
  to_trace(cause: ObligationCause, a: T, b: T): TypeTrace;
}

/** Stub `to_trace` of one `impl ToTrace for <T>` (lane infer-core replaces each with the port). */
function to_trace_stub<T>(ty: string): (cause: ObligationCause, a: T, b: T) => TypeTrace {
  return () => unported(`rustc_infer::infer::at::ToTrace for ${ty}::to_trace`);
}

// The `impl ToTrace for <T>` descriptors (at.rs:319..438), in upstream order. Stubs until lane infer-core ports them.
export const ToTrace_Ty: ToTrace<import("../../rustc_middle/ty/mod.ts").Ty> = { ...relate_Ty, to_trace: to_trace_stub("Ty") };
export const ToTrace_Region: ToTrace<import("../../rustc_type_ir/sty/mod.ts").Region> = { ...relate_Region, to_trace: to_trace_stub("ty::Region") };
export const ToTrace_Const: ToTrace<import("../../rustc_type_ir/sty/consts.ts").Const> = { ...relate_Const, to_trace: to_trace_stub("Const") };
export const ToTrace_GenericArg: ToTrace<import("../../rustc_middle/ty/generic_args.ts").GenericArg> = { ...relate_GenericArg, to_trace: to_trace_stub("ty::GenericArg") };
export const ToTrace_Term: ToTrace<import("../../rustc_middle/ty/mod.ts").Term> = { ...relate_Term, to_trace: to_trace_stub("ty::Term") };
export const ToTrace_TraitRef: ToTrace<import("../../rustc_type_ir/decls.ts").TraitRef> = { ...relate_TraitRef, to_trace: to_trace_stub("ty::TraitRef") };
export const ToTrace_AliasTy = { ...relate_AliasTy, to_trace: to_trace_stub("ty::AliasTy") };
export const ToTrace_AliasTerm = { ...relate_AliasTerm, to_trace: to_trace_stub("ty::AliasTerm") };
export const ToTrace_FnSig = { ...relate_FnSig, to_trace: to_trace_stub("ty::FnSig") };
export const ToTrace_PolyFnSig = { ...relate_Binder(relate_FnSig), to_trace: to_trace_stub("ty::PolyFnSig") };
export const ToTrace_PolyExistentialTraitRef = { ...relate_Binder(relate_ExistentialTraitRef), to_trace: to_trace_stub("ty::PolyExistentialTraitRef") };
export const ToTrace_ExistentialTraitRef = { ...relate_ExistentialTraitRef, to_trace: to_trace_stub("ty::ExistentialTraitRef") };
export const ToTrace_PolyExistentialProjection = { ...relate_Binder(relate_ExistentialProjection), to_trace: to_trace_stub("ty::PolyExistentialProjection") };
export const ToTrace_ExistentialProjection = { ...relate_ExistentialProjection, to_trace: to_trace_stub("ty::ExistentialProjection") };

unported_methods(InferCtxt.prototype, "rustc_infer::infer::at::InferCtxt", ["at", "fork", "fork_with_typing_mode"]);
unported_methods(At.prototype, "rustc_infer::infer::at::At", ["sup", "sub", "eq", "eq_trace", "relate", "lub", "goals_to_obligations"]);
