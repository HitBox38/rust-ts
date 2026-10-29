// Port of compiler/rustc_const_eval/src/const_eval/eval_queries.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-a; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { CanAccessMutGlobal, CanAccessMutGlobal_from_bool, type CompileTimeInterpCx, CompileTimeMachine, CheckAlignment } from "./machine.ts";
import { report } from "./error.ts";
import { InternKind, intern_const_alloc_recursive } from "../interpret/intern.ts";
import {
  type AllocId,
  CtfeProvenance,
  debug_InterpErrorInfo,
  type ErrorHandled,
  type EvalStaticInitializerRawResult,
  type EvalToAllocationRawResult,
  type EvalToConstValueResult,
  GlobalId,
  type InterpErrorInfo,
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  InterpResult,
  interp_ok,
  ReportedErrorInfo,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type Body, type ConstAlloc, ConstValue, type Either } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxtAt } from "../../rustc_middle/query/calls.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type PseudoCanonicalInput, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { display_Ty, with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { display_Instance, Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { debug_Size, Size } from "../../rustc_abi/lib.ts";
import { type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { Err, expect_result, Ok, type Result, unwrap_result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { FrameNote_add_to_diag, type FrameNote } from "../diagnostics.ts";
import { ImmTy, OpTy } from "../interpret/operand.gen.ts";
import { OpTy_from_MPlaceTy } from "../interpret/operand.ts";
import { MPlaceTy, clone_MPlaceTy } from "../interpret/place.gen.ts";
import { key_MPlaceTy, PlaceTy_from_MPlaceTy } from "../interpret/place.ts";
import { MemoryKind } from "../interpret/memory.ts";
import { CtfeValidationMode, RefTracking } from "../interpret/validity.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import type { Subdiagnostic } from "../../rustc_errors/lib.ts";

/** Lazy util/mod.ts (`crate::util::context_spans`). */
function crate_util(): typeof import("../util/mod.ts") {
  return (crate_util_cache ??= require("../util/mod.ts") as typeof import("../util/mod.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var crate_util_cache: typeof import("../util/mod.ts") | undefined;

/** `impl Subdiagnostic for FrameNote` (diagnostics.rs) as a trait object. */
function FrameNote_subdiagnostic(self: FrameNote): Subdiagnostic {
  return { add_to_diag: (diag) => FrameNote_add_to_diag(self, diag) };
}

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
  return (crate_cache ??= require("../lib.ts") as typeof import("../lib.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var crate_cache: typeof import("../lib.ts") | undefined;

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

// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:54 setup_for_eval
export function setup_for_eval(ecx: CompileTimeInterpCx, cid: GlobalId, layout: TyAndLayout): InterpResult<[InternKind, MPlaceTy]> {
  const tcx = ecx.tcx.tcx;
  const k = ecx.tcx.def_kind(Instance.def_id(cid.instance));
  if (
    !(
      cid.promoted !== undefined ||
      k.$ === "Const" ||
      k.$ === "Static" ||
      k.$ === "ConstParam" ||
      k.$ === "AnonConst" ||
      k.$ === "AssocConst"
    )
  ) {
    panic(`Unexpected DefKind: ${debug_DefKind(ecx.tcx.def_kind(Instance.def_id(cid.instance)), PLAIN)}`);
  }
  assert(layout.is_sized(), "assertion failed: layout.is_sized()");

  let intern_kind: InternKind;
  if (cid.promoted !== undefined) {
    intern_kind = InternKind.Promoted;
  } else {
    const m = tcx.static_mutability(Instance.def_id(cid.instance));
    if (m !== undefined) {
      intern_kind = { $: "Static", _0: m };
    } else {
      intern_kind = InternKind.Constant;
    }
  }

  let return_place: InterpResult<MPlaceTy>;
  if (intern_kind.$ === "Static") {
    return_place = interpret_util().create_static_alloc(ecx, Instance.def_id(cid.instance).expect_local(), layout);
  } else {
    return_place = ecx.allocate(layout, MemoryKind.Stack);
  }

  return InterpResult.map(return_place, (ret): [InternKind, MPlaceTy] => [intern_kind, ret]);
}

// #[instrument(level = "trace", skip(ecx, body))]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:94 eval_body_using_ecx
export function eval_body_using_ecx<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, body: Body): InterpResult<R> {
  const tcx = ecx.tcx.tcx;
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(body.bound_return_ty(tcx), tcx, cid.instance.args, fold_Ty));
  const r0 = interpret_util().ensure_monomorphic_enough(ty, fold_Ty);
  if (r0.$ === "Err") return r0;

  const layout_r = ecx.layout_of(ty);
  if (layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout_r._0));
  const layout = layout_r._0;
  const setup = setup_for_eval(ecx, cid, layout);
  if (setup.$ === "Err") return setup;
  const [intern_kind, ret] = setup._0;

  // trace!(
  //     "eval_body_using_ecx: pushing stack frame for global: {}{}",
  //     with_no_trimmed_paths!(ecx.tcx.def_path_str(cid.instance.def_id())),
  //     cid.promoted.map_or_else(String::new, |p| format!("::{p:?}"))
  // );

  // This can't use `init_stack_frame` since `body` is not a function,
  // so computing its ABI would fail. It's also not worth it since there are no arguments to pass.
  const r1 = ecx.push_stack_frame_raw(cid.instance, body, PlaceTy_from_MPlaceTy(clone_MPlaceTy(ret)), { $: "Stop", cleanup: false });
  if (r1.$ === "Err") return r1;
  const r2 = ecx.push_stack_frame_done();
  if (r2.$ === "Err") return r2;

  // The main interpreter loop.
  for (;;) {
    const s = ecx.step();
    if (s.$ === "Err") return s;
    if (!s._0) break;
    if (crate().CTRL_C_RECEIVED.value) {
      // throw_exhaust!(Interrupted)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "ResourceExhaustion", _0: "Interrupted" }));
    }
  }

  return intern_and_validate(R_, ecx, cid, intern_kind, ret);
}

// #[instrument(level = "trace", skip(ecx))]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:133 eval_trivial_const_using_ecx
export function eval_trivial_const_using_ecx<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, val: ConstValue, ty: Ty): InterpResult<R> {
  const layout_r = ecx.layout_of(ty);
  if (layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(layout_r._0));
  const layout = layout_r._0;
  const setup = setup_for_eval(ecx, cid, layout);
  if (setup.$ === "Err") return setup;
  const [intern_kind, return_place] = setup._0;

  const opty = ecx.const_val_to_op(val, ty, layout);
  if (opty.$ === "Err") return opty;
  const r = ecx.copy_op(opty._0, return_place);
  if (r.$ === "Err") return r;

  return intern_and_validate(R_, ecx, cid, intern_kind, return_place);
}

// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:148 intern_and_validate
export function intern_and_validate<R>(R_: InterpretationResult<R>, ecx: CompileTimeInterpCx, cid: GlobalId, intern_kind: InternKind, ret: MPlaceTy): InterpResult<R> {
  // Intern the result
  const intern_result = intern_const_alloc_recursive(ecx, intern_kind, ret);

  // Since evaluation had no errors, validate the resulting constant.
  const v = const_validate_mplace(ecx, ret, cid);
  // `?` on `Result<(), ErrorHandled>` (`From<ErrorHandled> for InterpErrorInfo`)
  if (v.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(v._0));

  // Only report this after validation, as validation produces much better diagnostics.
  // FIXME: ensure validation always reports this and stop making interning care about it.

  if (intern_result.$ === "Err") {
    let guar: ErrorGuaranteed;
    switch (intern_result._0) {
      case "DanglingPointer":
        guar = ecx.tcx.tcx.dcx().emit_err(
          diagnostics.DanglingPtrInFinal_diagnostic({
            span: ecx.tcx.span,
            kind: intern_kind,
          }),
        );
        break;
      case "BadMutablePointer":
        guar = ecx.tcx.tcx.dcx().emit_err(
          diagnostics.MutablePtrInFinal_diagnostic({
            span: ecx.tcx.span,
            kind: intern_kind,
          }),
        );
        break;
      case "ConstAllocNotGlobal":
        guar = ecx.tcx.tcx.dcx().emit_err(diagnostics.ConstHeapPtrInFinal_diagnostic({ span: ecx.tcx.span }));
        break;
      case "PartialPointer":
        guar = ecx.tcx.tcx.dcx().emit_err(
          diagnostics.PartialPtrInFinal_diagnostic({
            span: ecx.tcx.span,
            kind: intern_kind,
          }),
        );
        break;
    }
    // throw_inval!(AlreadyReported(ReportedErrorInfo::non_const_eval_error(..)))
    return Err(
      InterpErrorInfo_from_InterpErrorKind({
        $: "InvalidProgram",
        _0: { $: "AlreadyReported", _0: ReportedErrorInfo.non_const_eval_error(guar) },
      }),
    );
  }

  return interp_ok(R_.make_result(ret, ecx));
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

/// This function converts an interpreter value into a MIR constant.
///
/// The `for_diagnostics` flag turns the usual rules for returning `ConstValue::Scalar` into a
/// best-effort attempt. This is not okay for use in const-eval sine it breaks invariants rustc
/// relies on, but it is okay for diagnostics which will just give up gracefully when they
/// encounter an `Indirect` they cannot handle.
// #[instrument(skip(ecx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:245 op_to_const
export function op_to_const(ecx: CompileTimeInterpCx, op: OpTy, for_diagnostics: boolean): ConstValue {
  // Handle ZST consistently and early.
  if (op.layout.is_zst()) {
    return ConstValue.ZeroSized;
  }

  // All scalar types should be stored as `ConstValue::Scalar`. This is needed to make
  // `ConstValue::try_to_scalar` efficient; we want that to work for *all* constants of scalar
  // type (it's used throughout the compiler and having it work just on literals is not enough)
  // and we want it to be fast (i.e., don't go to an `Allocation` and reconstruct the `Scalar`
  // from its byte-serialized form).
  const br = op.layout.backend_repr;
  const force_as_immediate =
    br.$ === "Scalar" && br._0.$ === "Initialized"
      ? true
      : // We don't *force* `ConstValue::Slice` for `ScalarPair`. This has the advantage that if the
        // input `op` is a place, then turning it into a `ConstValue` and back into a `OpTy` will
        // not have to generate any duplicate allocations (we preserve the original `AllocId` in
        // `ConstValue::Indirect`). It means accessing the contents of a slice can be slow (since
        // they can be stored as `ConstValue::Indirect`), but that's not relevant since we barely
        // ever have to do this. (`try_get_slice_bytes_for_diagnostics` exists to provide this
        // functionality.)
        false;
  let immediate: Either<MPlaceTy, ImmTy>;
  if (force_as_immediate) {
    const r = InterpResult.report_err(ecx.read_immediate(op));
    if (r.$ === "Ok") {
      immediate = { $: "Right", _0: r._0 };
    } else {
      const err = r._0;
      if (for_diagnostics) {
        // This discard the error, but for diagnostics that's okay.
        immediate = op.as_mplace_or_imm();
      } else {
        return panic(`normalization works on validated constants: ${debug_InterpErrorInfo(err, PLAIN)}`);
      }
    }
  } else {
    immediate = op.as_mplace_or_imm();
  }

  // debug!(?immediate);

  switch (immediate.$) {
    case "Left": {
      const mplace = immediate._0;
      const [prov, offset] = unwrap_result(mplace.ptr().into_pointer_or_addr<CtfeProvenance>(), debug_Size).prov_and_relative_offset();
      const alloc_id = CtfeProvenance.alloc_id(prov);
      return { $: "Indirect", alloc_id, offset };
    }
    // see comment on `let force_as_immediate` above
    case "Right": {
      const imm = immediate._0;
      const v = imm.imm;
      switch (v.$) {
        case "Scalar":
          return { $: "Scalar", _0: v._0 };
        case "ScalarPair": {
          const a = v._0;
          const b = v._1;
          // debug!("ScalarPair(a: {:?}, b: {:?})", a, b);
          // This codepath solely exists for `valtree_to_const_value` to not need to generate
          // a `ConstValue::Indirect` for wide references, so it is tightly restricted to just
          // that case.
          const _pointee_ty = unwrap(imm.layout.ty.builtin_deref(false)); // `false` = no raw ptrs
          // debug_assert!(
          //     matches!(
          //         ecx.tcx.struct_tail_for_codegen(pointee_ty, ecx.typing_env()).kind(),
          //         ty::Str | ty::Slice(..),
          //     ),
          //     "`ConstValue::Slice` is for slice-tailed types only, but got {}",
          //     imm.layout.ty,
          // );
          const msg = "`op_to_const` on an immediate scalar pair must only be used on slice references to the beginning of an actual allocation";
          const ptr = Scalar.to_pointer(a, ecx);
          const [prov, offset] = expect_result(ptr.into_pointer_or_addr<CtfeProvenance>(), msg, debug_Size).prov_and_relative_offset();
          const alloc_id = CtfeProvenance.alloc_id(prov);
          assert(offset.bytes() === Size.ZERO.bytes(), msg);
          const meta = InterpResult.expect(Scalar.to_target_usize(b, ecx), msg);
          // PORT: `ConstValue::Slice.meta` (u64) is a number (generated); a slice length stays below 2^53.
          return { $: "Slice", alloc_id, meta: Number(meta) };
        }
        case "Uninit":
          return bug(`\`Uninit\` is not a valid value for ${display_Ty(op.layout.ty)}`);
      }
    }
  }
}

// #[instrument(skip(tcx), level = "debug", ret)]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:328 turn_into_const_value
export function turn_into_const_value(tcx: TyCtxt, constant: ConstAlloc, key: PseudoCanonicalInput<GlobalId>): ConstValue {
  const cid = key.value;
  const def_id = InstanceKind.def_id(cid.instance.def);
  const is_static = tcx.is_static(def_id);
  // This is just accessing an already computed constant, so no need to check alignment here.
  const ecx = mk_eval_cx_to_read_const_val(
    tcx,
    tcx.def_span(Instance.def_id(key.value.instance)),
    key.typing_env,
    CanAccessMutGlobal_from_bool(is_static),
  );

  const mplace = InterpResult.expect(
    ecx.raw_const_to_mplace(constant),
    "can only fail if layout computation failed, " + "which should have given a good error before ever invoking this function",
  );
  assert(
    !is_static || cid.promoted !== undefined,
    "the `eval_to_const_value_raw` query should not be used for statics, use `eval_to_allocation` instead",
  );

  // Turn this into a proper constant.
  return op_to_const(ecx, OpTy_from_MPlaceTy(mplace), /* for diagnostics */ false);
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

/** Lazy interpret/util.ts (`impl InterpretationResult for ConstAllocation`, `create_static_alloc`,
 *  `ensure_monomorphic_enough`). */
function interpret_util(): typeof import("../interpret/util.ts") {
  return (interpret_util_cache ??= require("../interpret/util.ts") as typeof import("../interpret/util.ts"));
}
// PORT: cached (`require` per call was ~30% of CTFE time); `var` is hoisted, as cycles may call this early.
var interpret_util_cache: typeof import("../interpret/util.ts") | undefined;

// impl<'tcx> InterpretationResult<'tcx> for ConstAlloc<'tcx>
export const InterpretationResult_ConstAlloc: InterpretationResult<ConstAlloc> = {
  // rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:400 make_result
  make_result(mplace: MPlaceTy, _ecx: CompileTimeInterpCx): ConstAlloc {
    return { alloc_id: CtfeProvenance.alloc_id(unwrap(mplace.ptr().provenance)), ty: mplace.layout.ty };
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

// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:437 eval_in_interpreter
export function eval_in_interpreter<R>(R_: InterpretationResult<R>, tcx: TyCtxt, cid: GlobalId, typing_env: TypingEnv): Result<R, ErrorHandled> {
  const def = InstanceKind.def_id(cid.instance.def);
  // directly represented consts don't have bodies
  // PORT: `if cfg!(debug_assertions) && matches!(tcx.def_kind(def), DefKind::Const | DefKind::AssocConst) {
  // debug_assert!(tcx.const_of_item(def).is_none(), ..) }` is skipped: rustc ships without debug assertions.

  const is_static = tcx.is_static(def);
  const ecx: CompileTimeInterpCx = InterpCx.new(
    tcx,
    tcx.def_span(def),
    typing_env,
    // Statics (and promoteds inside statics) may access mutable global memory, because unlike consts
    // they do not have to behave "as if" they were evaluated at runtime.
    // For consts however we want to ensure they behave "as if" they were evaluated at runtime,
    // so we have to reject reading mutable global memory.
    CompileTimeMachine.new(CanAccessMutGlobal_from_bool(is_static), CheckAlignment.Error),
  );

  let result: InterpResult<R>;
  const trivial = tcx.trivial_const(def);
  if (trivial !== undefined) {
    const [value, ty] = trivial;
    result = eval_trivial_const_using_ecx(R_, ecx, cid, value, ty);
  } else {
    result = InterpResult.and_then(ecx.load_mir(cid.instance.def, cid.promoted), (body) => eval_body_using_ecx(R_, ecx, cid, body));
  }
  const r = InterpResult.report_err(result);
  return r.$ === "Ok" ? r : Err(report_eval_error(ecx, cid, r._0));
}

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:473 const_validate_mplace
export function const_validate_mplace(ecx: CompileTimeInterpCx, mplace: MPlaceTy, cid: GlobalId): Result<undefined, ErrorHandled> {
  const alloc_id = CtfeProvenance.alloc_id(unwrap(mplace.ptr().provenance));
  const ref_tracking = RefTracking.new(clone_MPlaceTy(mplace), mplace.layout.ty, key_MPlaceTy);
  let inner = false;
  for (;;) {
    const next = ref_tracking.next();
    if (next === undefined) break;
    const [mplace, path] = next;
    let mode: CtfeValidationMode;
    const mutbl = ecx.tcx.tcx.static_mutability(Instance.def_id(cid.instance));
    if (cid.promoted !== undefined) {
      mode = CtfeValidationMode.Promoted;
    } else if (mutbl !== undefined) {
      mode = { $: "Static", mutbl }; // a `static`
    } else {
      // This is a normal `const` (not promoted).
      // The outermost allocation is always only copied, so having `UnsafeCell` in there
      // is okay despite them being in immutable memory.
      mode = { $: "Const", allow_immutable_unsafe_cell: !inner };
    }
    const r = InterpResult.report_err(ecx.const_validate_place(PlaceTy_from_MPlaceTy(mplace), path, ref_tracking, mode));
    // Instead of just reporting the `InterpError` via the usual machinery, we give a more targeted
    // error about the validation failure.
    if (r.$ === "Err") return Err(report_validation_error(ecx, cid, r._0, alloc_id));
    inner = true;
  }

  return Ok(undefined);
}

// #[inline(never)]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:504 report_eval_error
export function report_eval_error(ecx: CompileTimeInterpCx, cid: GlobalId, error: InterpErrorInfo): ErrorHandled {
  const [error_, backtrace] = error.into_parts();
  backtrace.print_backtrace();

  return report(ecx, error_, (diag, span, frames) => {
    const num_frames = frames.length;
    diag.span_label(
      span,
      `evaluation of \`${with_no_trimmed_paths(() => display_Instance(cid.instance))}\` failed ${num_frames === 0 ? "here" : "inside this call"}`,
    );
    for (const span_ of crate_util().context_spans(ecx.tcx.tcx, span, Instance.def_id(cid.instance))) {
      diag.span_context(span_);
    }
    for (const frame of frames) {
      diag.subdiagnostic(FrameNote_subdiagnostic(frame));
    }
  });
}

// #[inline(never)]
// rustc: compiler/rustc_const_eval/src/const_eval/eval_queries.rs:532 report_validation_error
export function report_validation_error(ecx: CompileTimeInterpCx, cid: GlobalId, error: InterpErrorInfo, alloc_id: AllocId): ErrorHandled {
  if (!(error.kind().$ === "UndefinedBehavior")) {
    // Some other error happened during validation, e.g. an unsupported operation.
    return report_eval_error(ecx, cid, error);
  }

  const [error_, backtrace] = error.into_parts();
  backtrace.print_backtrace();

  const bytes = ecx.print_alloc_bytes_for_diagnostics(alloc_id);
  const info = ecx.get_alloc_info(alloc_id);
  const raw_bytes: diagnostics.RawBytesNote = { size: info.size.bytes(), align: info.align.bytes(), bytes };

  return report(ecx, error_, (diag, span, frames) => {
    diag.span_label(span, "it is undefined behavior to use this value");
    diag.note(
      "the rules on what exactly is undefined behavior aren't clear, so this check might be overzealous. Please open an issue on the rustc repository if you believe it should not be considered undefined behavior.",
    );
    assert(frames.length === 0, "assertion failed: frames.is_empty()"); // we just report validation errors for the final const here
    diag.subdiagnostic(diagnostics.RawBytesNote_subdiagnostic(raw_bytes));
  });
}
