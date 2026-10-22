// Port of compiler/rustc_mir_build/src/check_tail_calls.rs (lane builder-contract, plan-m4 wave 22). The provider and the
// `Visitor` impl are ported (`build_mir_inner_impl` runs `check_tail_calls` on every body; `check_tail_call` is reached
// only for `become` expressions); every other fn is a stub (`// stub: <path>:<line> <name> (lane <lane>)` over its final
// signature, body `unported(..)`) for the lane mb-custom-tail; docs/handoff/builder-contract.md has the split table and
// "How to fill a stub" (builder/mod.ts's header has the representation notes).
//
// PORT: `TailCallCkVisitor` (a thir `Visitor` impl) is a hand class extending rustc_middle thir/visit.ts's `Visitor`; its
// field `thir` is `thir_` (the `Visitor::thir()` method has the same name; precedent check_match.ts's `MatchVisitor`).
// The methods of `impl TailCallCkVisitor` are in the class body, in upstream order, before the `Visitor` impl's.
import { type ExternAbi } from "../rustc_abi/extern_abi.ts";
import { type Expr, type ExprId, type Thir } from "../rustc_middle/thir.ts";
import { Visitor, walk_expr } from "../rustc_middle/thir/visit.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { type FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Ok, type Result } from "../std/result.ts";
import { unported } from "../std/panic.ts";
export * from "./check_tail_calls.gen.ts";

// rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:13 check_tail_calls
export function check_tail_calls(tcx: TyCtxt, def: LocalDefId): Result<null, ErrorGuaranteed> {
  // PORT: queries.gen.ts types `thir_body`'s value loosely (`[Steal<unknown>, unknown]`); it is `(&Steal<Thir>, ExprId)`.
  const r = tcx.thir_body(def) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
  if (r.$ === "Err") return r;
  const [thir_, expr] = r._0;
  const thir = thir_.borrow();

  // If `thir` is empty, a type error occurred, skip this body.
  if (thir.exprs.length === 0) {
    return Ok(null);
  }

  const is_closure = tcx.def_kind(LocalDefId.to_def_id(def)).$ === "Closure";

  const visitor = new TailCallCkVisitor(
    tcx,
    thir,
    TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, def),
    is_closure,
    Ok(null),
    def,
  );

  visitor.visit_expr(thir.index_ExprId(expr));

  return visitor.found_errors;
}

// rustc-type: compiler/rustc_mir_build/src/check_tail_calls.rs:38 TailCallCkVisitor
export class TailCallCkVisitor extends Visitor {
  constructor(
    public tcx: TyCtxt,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
    public typing_env: TypingEnv,
    /// Whatever the currently checked body is one of a closure
    public is_closure: boolean,
    /// The result of the checks, `Err(_)` if there was a problem with some
    /// tail call, `Ok(())` if all of them were fine.
    public found_errors: Result<null, ErrorGuaranteed>,
    /// `LocalDefId` of the caller function.
    public caller_def_id: LocalDefId,
  ) {
    super();
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:52 check_tail_call (lane mb-custom-tail)
  check_tail_call(call: Expr, expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::check_tail_call");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:202 caller_needs_location (lane mb-custom-tail)
  caller_needs_location(): boolean {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::caller_needs_location");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:207 report_in_closure (lane mb-custom-tail)
  report_in_closure(expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_in_closure");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:212 report_builtin_op (lane mb-custom-tail)
  report_builtin_op(value: Expr, expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_builtin_op");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:228 report_op (lane mb-custom-tail)
  report_op(fun_ty: Ty, args: readonly ExprId[], fn_span: Span, expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_op");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:271 report_non_call (lane mb-custom-tail)
  report_non_call(value: Expr, expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_non_call");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:287 report_calling_closure (lane mb-custom-tail)
  report_calling_closure(fun: Expr, tupled_args: Ty, expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_calling_closure");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:310 report_calling_intrinsic (lane mb-custom-tail)
  report_calling_intrinsic(expr: Expr): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_calling_intrinsic");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:320 report_nonfn_callee (lane mb-custom-tail)
  report_nonfn_callee(call_sp: Span, fun_sp: Span, ty: Ty): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_nonfn_callee");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:354 report_abi_mismatch (lane mb-custom-tail)
  report_abi_mismatch(sp: Span, caller_abi: ExternAbi, callee_abi: ExternAbi): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_abi_mismatch");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:365 report_unsupported_abi (lane mb-custom-tail)
  report_unsupported_abi(sp: Span, callee_abi: ExternAbi): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_unsupported_abi");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:375 report_signature_mismatch (lane mb-custom-tail)
  report_signature_mismatch(sp: Span, caller_sig: FnSig, callee_sig: FnSig): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_signature_mismatch");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:392 report_track_caller_caller (lane mb-custom-tail)
  report_track_caller_caller(sp: Span): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_track_caller_caller");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:405 report_c_variadic_caller (lane mb-custom-tail)
  report_c_variadic_caller(sp: Span): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_c_variadic_caller");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:416 report_c_variadic_callee (lane mb-custom-tail)
  report_c_variadic_callee(sp: Span): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_c_variadic_callee");
  }

  // stub: compiler/rustc_mir_build/src/check_tail_calls.rs:427 report_unsized_argument (lane mb-custom-tail)
  report_unsized_argument(sp: Span, arg_ty: Ty): void {
    return unported("rustc_mir_build::check_tail_calls::TailCallCkVisitor::report_unsized_argument");
  }

  // impl<'a, 'tcx> Visitor<'a, 'tcx> for TailCallCkVisitor<'a, 'tcx>
  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:440 thir
  thir(): Thir {
    return this.thir_;
  }

  // rustc: compiler/rustc_mir_build/src/check_tail_calls.rs:444 visit_expr
  override visit_expr(expr: Expr): void {
    if (expr.kind.$ === "Become") {
      const value = expr.kind.value;
      const call = this.thir_.index_ExprId(value);
      this.check_tail_call(call, expr);
    }

    walk_expr(this, expr);
  }
}

// stub: compiler/rustc_mir_build/src/check_tail_calls.rs:454 op_trait_as_method_name (lane mb-custom-tail)
export function op_trait_as_method_name(tcx: TyCtxt, trait_did: DefId): string | undefined {
  return unported("rustc_mir_build::check_tail_calls::op_trait_as_method_name");
}
