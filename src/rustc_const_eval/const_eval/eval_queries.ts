// Port of compiler/rustc_const_eval/src/const_eval/eval_queries.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { CanAccessMutGlobal, type CompileTimeInterpCx, CompileTimeMachine, CheckAlignment } from "./machine.ts";
import { InternKind } from "../interpret/intern.ts";
import { type AllocId, type ErrorHandled, type EvalStaticInitializerRawResult, type EvalToAllocationRawResult, type EvalToConstValueResult, GlobalId, type InterpErrorInfo, InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Body, type ConstAlloc, type ConstValue } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type PseudoCanonicalInput, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { assert, unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import { OpTy } from "../interpret/operand.gen.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";
import { InterpCx } from "../interpret/eval_context.ts";

// pub trait InterpretationResult<'tcx>
// PORT: an impl table; a generic `R: InterpretationResult` is the table `R_` passed first (precedent mt-promote's
// `Q_: Qualif`): `InterpretationResult_ConstAlloc` (here) and `InterpretationResult_ConstAllocation` (interpret/util.ts).
export interface InterpretationResult<R> {
  /// This function takes the place where the result of the evaluation is stored
  /// and prepares it for returning it in the appropriate format needed by the specific
  /// evaluation query.
  // rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:393 make_result
  make_result(mplace: MPlaceTy, ecx: CompileTimeInterpCx): R;
}

/** Lazy `crate::assert_typing_mode` (lib.ts imports this module). */
function crate(): typeof import("../lib.ts") {
  return require("../lib.ts") as typeof import("../lib.ts");
}

// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:26 retry_codegen_mode_with_postanalysis
export function retry_codegen_mode_with_postanalysis<K, V>(
  key: PseudoCanonicalInput<K>,
  f: (a0: PseudoCanonicalInput<K>) => Result<V, ErrorHandled>,
): Result<V, ErrorHandled> | undefined {
  const { typing_env, value } = key;
  const mode = TypingMode.assert_not_erased(typing_env.typing_mode());
  switch (mode.$) {
    // We are in codegen. It's very likely this constant has been evaluated in PostAnalysis
    // before. Try to reuse this evaluation, and only re-run if we hit a `TooGeneric` error.
    case "Codegen": {
      const with_postanalysis_env = TypingEnv.new(typing_env.param_env, TypingMode.PostAnalysis);
      const with_postanalysis = f(with_postanalysis_env.as_query_input(value));
      if (with_postanalysis.$ === "Ok" || with_postanalysis._0.$ === "Reported") {
        return with_postanalysis;
      }
      // Err(ErrorHandled::TooGeneric(_)) => {}
      break;
    }
    case "Coherence":
    case "Typeck":
    case "PostTypeckUntilBorrowck":
    case "PostBorrowck":
    case "Reflection":
    case "PostAnalysis":
      break;
  }

  return undefined;
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:54 setup_for_eval (lane ctfe-a)
export function setup_for_eval(ecx: CompileTimeInterpCx, cid: GlobalId, layout: TyAndLayout): InterpResult<[InternKind, MPlaceTy]> {
  return unported("rustc_const_eval::const_eval::eval_queries::setup_for_eval");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:94 eval_body_using_ecx (lane ctfe-a)
export function eval_body_using_ecx<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, body: Body): InterpResult<R> {
  return unported("rustc_const_eval::const_eval::eval_queries::eval_body_using_ecx");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:133 eval_trivial_const_using_ecx (lane ctfe-a)
export function eval_trivial_const_using_ecx<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, val: ConstValue, ty: Ty): InterpResult<R> {
  return unported("rustc_const_eval::const_eval::eval_queries::eval_trivial_const_using_ecx");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:148 intern_and_validate (lane ctfe-a)
export function intern_and_validate<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, intern_kind: InternKind, ret: MPlaceTy): InterpResult<R> {
  return unported("rustc_const_eval::const_eval::eval_queries::intern_and_validate");
}

/// The `InterpCx` is only meant to be used to do field and index projections into constants for
/// `simd_shuffle` and const patterns in match arms.
///
/// This should *not* be used to do any actual interpretation. In particular, alignment checks are
/// turned off!
///
/// The function containing the `match` that is currently being analyzed may have generic bounds
/// that inform us about the generic bounds of the constant. E.g., using an associated constant
/// of a function's generic parameter will require knowledge about the bounds on the generic
/// parameter. These bounds are passed to `mk_eval_cx` via the `ParamEnv` argument.
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:209 mk_eval_cx_to_read_const_val
export function mk_eval_cx_to_read_const_val(tcx: TyCtxt, root_span: Span, typing_env: TypingEnv, can_access_mut_global: CanAccessMutGlobal): CompileTimeInterpCx {
  // debug!("mk_eval_cx: {:?}", typing_env);
  return InterpCx.new(tcx, root_span, typing_env, CompileTimeMachine.new(can_access_mut_global, CheckAlignment.No));
}

/// Create an interpreter context to inspect the given `ConstValue`.
/// Returns both the context and an `OpTy` that represents the constant.
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:226 mk_eval_cx_for_const_val
export function mk_eval_cx_for_const_val(tcx: TyCtxtAt, typing_env: TypingEnv, val: ConstValue, ty: Ty): [CompileTimeInterpCx, OpTy] | undefined {
  const ecx = mk_eval_cx_to_read_const_val(tcx.tcx, tcx.span, typing_env, CanAccessMutGlobal.No);
  // FIXME: is it a problem to discard the error here?
  const op = InterpResult.discard_err(ecx.const_val_to_op(val, ty, undefined));
  if (op === undefined) return undefined;
  return [ecx, op];
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:245 op_to_const (lane ctfe-a)
export function op_to_const(ecx: CompileTimeInterpCx, op: OpTy, for_diagnostics: boolean): ConstValue {
  return unported("rustc_const_eval::const_eval::eval_queries::op_to_const");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:328 turn_into_const_value (lane ctfe-a)
export function turn_into_const_value(tcx: TyCtxt, constant: ConstAlloc, key: PseudoCanonicalInput<GlobalId>): ConstValue {
  return unported("rustc_const_eval::const_eval::eval_queries::turn_into_const_value");
}

// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:358 eval_to_const_value_raw_provider
export function eval_to_const_value_raw_provider(tcx: TyCtxt, key: PseudoCanonicalInput<GlobalId>): EvalToConstValueResult {
  crate().assert_typing_mode(key.typing_env.typing_mode());

  const trivial = tcx.trivial_const(Instance.def_id(key.value.instance));
  if (trivial !== undefined) {
    const [value, _ty] = trivial;
    return Ok(value);
  }

  const retry = retry_codegen_mode_with_postanalysis(key, (key) => tcx.eval_to_const_value_raw(key));
  if (retry !== undefined) {
    return retry;
  }

  const r = tcx.eval_to_allocation_raw(key);
  return r.$ === "Ok" ? Ok(turn_into_const_value(tcx, r._0, key)) : r;
}

// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:378 eval_static_initializer_provider
export function eval_static_initializer_provider(tcx: TyCtxt, def_id: LocalDefId): EvalStaticInitializerRawResult {
  assert(tcx.is_static(LocalDefId.to_def_id(def_id)), "assertion failed: tcx.is_static(def_id.to_def_id())");

  const instance = Instance.mono(tcx, LocalDefId.to_def_id(def_id));
  const cid = new GlobalId(instance, undefined);
  return eval_in_interpreter(interpret_util().InterpretationResult_ConstAllocation, tcx, cid, TypingEnv.fully_monomorphized());
}

/** Lazy interpret/util.ts (`impl InterpretationResult for ConstAllocation`). */
function interpret_util(): typeof import("../interpret/util.ts") {
  return require("../interpret/util.ts") as typeof import("../interpret/util.ts");
}

// impl<'tcx> InterpretationResult<'tcx> for ConstAlloc<'tcx>
export const InterpretationResult_ConstAlloc: InterpretationResult<ConstAlloc> = {
  // stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:400 make_result (lane ctfe-a)
  make_result(mplace: MPlaceTy, _ecx: CompileTimeInterpCx): ConstAlloc {
    return unported("rustc_const_eval::const_eval::eval_queries::ConstAlloc::make_result");
  },
};

// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:409 eval_to_allocation_raw_provider
export function eval_to_allocation_raw_provider(tcx: TyCtxt, key: PseudoCanonicalInput<GlobalId>): EvalToAllocationRawResult {
  crate().assert_typing_mode(key.typing_env.typing_mode());
  const retry = retry_codegen_mode_with_postanalysis(key, (key) => tcx.eval_to_allocation_raw(key));
  if (retry !== undefined) {
    return retry;
  }

  // This shouldn't be used for statics, since statics are conceptually places,
  // not values -- so what we do here could break pointer identity.
  assert(
    key.value.promoted !== undefined || !tcx.is_static(Instance.def_id(key.value.instance)),
    "assertion failed: key.value.promoted.is_some() || !tcx.is_static(key.value.instance.def_id())",
  );

  // PORT: `if cfg!(debug_assertions) { .. }` (formats the instance for a `trace!`) is skipped: rustc ships without debug
  // assertions.

  return eval_in_interpreter(InterpretationResult_ConstAlloc, tcx, key.value, key.typing_env);
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:437 eval_in_interpreter (lane ctfe-a)
export function eval_in_interpreter<R>(R_: InterpretationResult<R>, tcx: TyCtxt, cid: GlobalId, typing_env: TypingEnv): Result<R, ErrorHandled> {
  return unported("rustc_const_eval::const_eval::eval_queries::eval_in_interpreter");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:473 const_validate_mplace (lane ctfe-a)
export function const_validate_mplace(ecx: CompileTimeInterpCx, mplace: MPlaceTy, cid: GlobalId): Result<undefined, ErrorHandled> {
  return unported("rustc_const_eval::const_eval::eval_queries::const_validate_mplace");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:504 report_eval_error (lane ctfe-a)
export function report_eval_error(ecx: CompileTimeInterpCx, cid: GlobalId, error: InterpErrorInfo): ErrorHandled {
  return unported("rustc_const_eval::const_eval::eval_queries::report_eval_error");
}

// stub: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:532 report_validation_error (lane ctfe-a)
export function report_validation_error(ecx: CompileTimeInterpCx, cid: GlobalId, error: InterpErrorInfo, alloc_id: AllocId): ErrorHandled {
  return unported("rustc_const_eval::const_eval::eval_queries::report_validation_error");
}
