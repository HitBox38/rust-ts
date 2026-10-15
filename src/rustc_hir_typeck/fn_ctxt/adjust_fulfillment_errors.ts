// Port of compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs (lane typeck-demand-adjust, wave 19).
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/adjust_fulfillment_errors.rs:<line>` (methods of
// `FnCtxt`, assigned onto its prototype here in upstream order; the two free fns are `Fns_fn_ctxt_adjust_fulfillment_errors`).
// - `error: &mut traits::FulfillmentError` is the (mutable) `FulfillmentError` object: `error.obligation.cause.span = ..`
//   and `error.obligation.cause.map_code(..)` edit it in place, as upstream.
// - `impl ParamTerm { fn index }` is the companion `ParamTerm.index` (PORTING §8); `ClauseFlavor` / `ParamTerm` are
//   generated (adjust_fulfillment_errors.gen.ts).
// - `FindAmbiguousParameter` (a `TypeVisitor` local to `find_ambiguous_parameter_in`) is a module-level class.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./adjust_fulfillment_errors.gen.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import type { BinOpKind } from "../../rustc_ast/lib.ts";
import type * as ast from "../../rustc_ast/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { HirId_eq } from "../../rustc_hir_id/lib.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { ObligationCauseCode, ObligationCauseCodeHandle, type ImplDerivedCause } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { ConstConditions, GenericClauses, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Predicate, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import { DefId_eq } from "../../rustc_span/def_id.ts";
import { Span, type ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { kw } from "../../rustc_span/symbol.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { as_interner, HostEffectClause, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitRef } from "../../rustc_type_ir/unnormalized.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { FnCtxt } from "../decls.ts";
import type { ClauseFlavor, ParamTerm as ParamTermT } from "./adjust_fulfillment_errors.gen.ts";

export type ParamTerm = ParamTermT;
export const ParamTerm = {
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:30 index
  index(self: ParamTerm): number {
    switch (self.$) {
      case "Ty": {
        const ty = self._0;
        return ty.index;
      }
      case "Const": {
        const ct = self._0;
        return ct.index;
      }
    }
  },
};

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:39 adjust_fulfillment_error_for_expr_obligation
FnCtxt.prototype.adjust_fulfillment_error_for_expr_obligation = function (this: FnCtxt, error: FulfillmentError): boolean {
  if (this.adjust_binop_index_operand(error)) {
    return true;
  }

  let def_id: DefId;
  let hir_id: HirId;
  let idx: number;
  let flavor: ClauseFlavor;
  const code = ObligationCauseCode.peel_derives(error.obligation.cause.code_());
  switch (code.$) {
    case "WhereClauseInExpr":
      [def_id, hir_id, idx, flavor] = [code._0, code._2, code._3, "Where"];
      break;
    case "HostEffectInExpr":
      [def_id, hir_id, idx, flavor] = [code._0, code._2, code._3, "Const"];
      break;
    default:
      return false;
  }

  let uninstantiated_clause: Unnormalized<import("../../rustc_middle/ty/predicate.ts").Clause>;
  let clause: Unnormalized<import("../../rustc_middle/ty/predicate.ts").Clause> | undefined;
  let pred: [Unnormalized<import("../../rustc_type_ir/decls.ts").PolyTraitRef>, Span] | undefined;
  if (
    flavor === "Where" &&
    (clause = GenericClauses.instantiate_identity(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx).clauses[idx]) !== undefined
  ) {
    uninstantiated_clause = clause;
  } else if (
    flavor === "Const" &&
    (pred = ConstConditions.instantiate_identity(this.tcx.const_conditions(def_id) as ConstConditions, this.tcx)[idx]) !== undefined
  ) {
    uninstantiated_clause = UnnormalizedPolyTraitRef.to_host_effect_clause(pred[0], this.tcx, "Maybe");
  } else {
    return false;
  }

  const generics = this.tcx.generics_of(def_id) as Generics;
  let predicate_args: GenericArg[];
  let predicate_self_type_to_point_at: GenericArg | undefined;
  const ck = Unnormalized.skip_binder(UnnormalizedClause.kind(uninstantiated_clause));
  switch (ck.$) {
    case "Trait": {
      const pred = ck._0;
      [predicate_args, predicate_self_type_to_point_at] = [[...pred.trait_ref.args], TraitClause.self_ty(pred)];
      break;
    }
    case "HostEffect": {
      const clause = ck._0;
      [predicate_args, predicate_self_type_to_point_at] = [[...clause.trait_ref.args], HostEffectClause.self_ty(clause)];
      break;
    }
    case "Projection": {
      const pred = ck._0;
      [predicate_args, predicate_self_type_to_point_at] = [[...pred.projection_term.args], undefined];
      break;
    }
    case "ConstArgHasType": {
      const [arg, ty] = [ck._0, ck._1];
      [predicate_args, predicate_self_type_to_point_at] = [[ty, arg], undefined];
      break;
    }
    case "ConstEvaluatable": {
      const e = ck._0;
      [predicate_args, predicate_self_type_to_point_at] = [[e], undefined];
      break;
    }
    default:
      return false;
  }

  const find_param_matching = (matches: (_: ParamTerm) => boolean): GenericArg | undefined => {
    for (const arg0 of predicate_args) {
      for (const arg of GenericArg.walk(arg0)) {
        const k = GenericArg.kind(arg);
        let found: boolean;
        let tk;
        let ck;
        if (k.$ === "Type" && (tk = k._0.kind()).$ === "Param") {
          const param_ty = tk._0;
          found = matches({ $: "Ty", _0: param_ty });
        } else if (k.$ === "Const" && (ck = k._0.kind()).$ === "Param") {
          const param_ct = ck._0;
          found = matches({ $: "Const", _0: param_ct });
        } else {
          found = false;
        }
        if (found) return arg;
      }
    }
    return undefined;
  };

  // Prefer generics that are local to the fn item, since these are likely
  // to be the cause of the unsatisfied predicate.
  let param_to_point_at = find_param_matching((param_term) =>
    DefId_eq(this.tcx.parent(generics.param_at(ParamTerm.index(param_term), this.tcx).def_id), def_id),
  );
  // Fall back to generic that isn't local to the fn item. This will come
  // from a trait or impl, for example.
  let fallback_param_to_point_at = find_param_matching(
    (param_term) =>
      !DefId_eq(this.tcx.parent(generics.param_at(ParamTerm.index(param_term), this.tcx).def_id), def_id) &&
      !(param_term.$ === "Ty" && param_term._0.name === kw.SelfUpper),
  );
  // Finally, the `Self` parameter is possibly the reason that the predicate
  // is unsatisfied. This is less likely to be true for methods, because
  // method probe means that we already kinda check that the predicates due
  // to the `Self` type are true.
  let self_param_to_point_at = find_param_matching((param_term) => param_term.$ === "Ty" && param_term._0.name === kw.SelfUpper);

  // Finally, for ambiguity-related errors, we actually want to look
  // for a parameter that is the source of the inference type left
  // over in this predicate.
  if (error.code.$ === "Ambiguity") {
    fallback_param_to_point_at = undefined;
    self_param_to_point_at = undefined;
    param_to_point_at = this.find_ambiguous_parameter_in(def_id, error.root_obligation.predicate, fold_Predicate);
  }

  const node = this.tcx.hir_node(hir_id);
  if (node.$ === "Expr") {
    const expr = node._0;
    return this.point_at_expr_if_possible(
      error,
      def_id,
      expr,
      predicate_self_type_to_point_at,
      param_to_point_at,
      fallback_param_to_point_at,
      self_param_to_point_at,
    );
  } else if (node.$ === "Ty" && node._0.kind.$ === "Path") {
    const qpath = node._0.kind._0;
    for (const param of flatten([predicate_self_type_to_point_at, param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.point_at_path_if_possible(error, def_id, param, qpath)) {
        return true;
      }
    }

    return false;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:175 adjust_binop_index_operand
FnCtxt.prototype.adjust_binop_index_operand = function (this: FnCtxt, error: FulfillmentError): boolean {
  const code = ObligationCauseCode.peel_derives(error.obligation.cause.code_());
  if (code.$ !== "BinOp") {
    return false;
  }
  const { lhs_hir_id, rhs_hir_id } = code;
  if (!(error.code.$ === "Ambiguity") || !TypeVisitableExt.has_infer(error.obligation.predicate, fold_Predicate)) {
    return false;
  }

  const lhs_node = this.tcx.hir_node(lhs_hir_id);
  if (lhs_node.$ !== "Expr") {
    return false;
  }
  const lhs_expr = lhs_node._0;
  const rhs_node = this.tcx.hir_node(rhs_hir_id);
  if (rhs_node.$ !== "Expr") {
    return false;
  }
  const rhs_expr = rhs_node._0;
  const binop = this.binop_for_operands(lhs_hir_id, rhs_hir_id);
  if (binop === undefined) {
    return false;
  }
  if (rhs_expr.kind.$ !== "Index") {
    return false;
  }
  const [indexed_expr, idx] = [rhs_expr.kind._0, rhs_expr.kind._1];
  if (!this.deeply_resolve_ignoring_regions(this.node_ty(idx.hir_id), fold_Ty).is_ty_var()) {
    return false;
  }
  const lhs_ty = this.deeply_resolve_ignoring_regions(this.node_ty(lhs_expr.hir_id), fold_Ty);
  const indexed_ty = this.deeply_resolve_ignoring_regions(this.node_ty(indexed_expr.hir_id), fold_Ty);
  let rhs_ty: Ty;
  const ik = indexed_ty.kind();
  switch (ik.$) {
    case "Array":
    case "Slice":
      rhs_ty = ik._0;
      break;
    case "Ref": {
      const pointee_ty = ik._1;
      const pk = pointee_ty.kind();
      switch (pk.$) {
        case "Array":
        case "Slice":
          rhs_ty = pk._0;
          break;
        default:
          rhs_ty = this.deeply_resolve_ignoring_regions(this.node_ty(rhs_expr.hir_id), fold_Ty);
      }
      break;
    }
    default:
      rhs_ty = this.deeply_resolve_ignoring_regions(this.node_ty(rhs_expr.hir_id), fold_Ty);
  }
  if (!this.binop_accepts_types(binop.node, lhs_ty, rhs_ty)) {
    return false;
  }

  error.obligation.cause.span = idx.kind.$ === "MethodCall" ? idx.kind._0.ident.span : idx.span;
  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:223 binop_for_operands
FnCtxt.prototype.binop_for_operands = function (this: FnCtxt, lhs_hir_id: HirId, rhs_hir_id: HirId): ast.BinOp | undefined {
  const parent = this.tcx.parent_hir_node(rhs_hir_id);
  if (parent.$ !== "Expr") {
    return undefined;
  }
  const parent_expr = parent._0;
  if (parent_expr.kind.$ !== "Binary") {
    return undefined;
  }
  const [binop, lhs_expr, rhs_expr] = [parent_expr.kind._0, parent_expr.kind._1, parent_expr.kind._2];
  return HirId_eq(lhs_expr.hir_id, lhs_hir_id) && HirId_eq(rhs_expr.hir_id, rhs_hir_id) ? binop : undefined;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:237 binop_accepts_types
FnCtxt.prototype.binop_accepts_types = function (this: FnCtxt, binop: BinOpKind, lhs_ty0: Ty, rhs_ty0: Ty): boolean {
  const lhs_ty = this.deref_ty_if_possible(lhs_ty0);
  const rhs_ty = this.deref_ty_if_possible(rhs_ty0);
  if (TypeVisitableExt.references_error(lhs_ty, fold_Ty) || TypeVisitableExt.references_error(rhs_ty, fold_Ty)) {
    return true;
  }

  switch (binop) {
    case "Shl":
    case "Shr":
      return lhs_ty.is_integral() && rhs_ty.is_integral();
    case "Add":
    case "Sub":
    case "Mul":
    case "Div":
    case "Rem":
      return (
        this.can_eq(this.param_env, lhs_ty, rhs_ty, ToTrace_Ty) &&
        (lhs_ty.is_integral() || lhs_ty.is_floating_point()) &&
        (rhs_ty.is_integral() || rhs_ty.is_floating_point())
      );
    case "BitXor":
    case "BitAnd":
    case "BitOr":
      return (
        this.can_eq(this.param_env, lhs_ty, rhs_ty, ToTrace_Ty) &&
        ((lhs_ty.is_integral() && rhs_ty.is_integral()) || (lhs_ty.is_bool() && rhs_ty.is_bool()))
      );
    case "Eq":
    case "Ne":
    case "Lt":
    case "Le":
    case "Ge":
    case "Gt":
      return this.can_eq(this.param_env, lhs_ty, rhs_ty, ToTrace_Ty) && lhs_ty.is_scalar() && rhs_ty.is_scalar();
    case "And":
    case "Or":
      return lhs_ty.is_bool() && rhs_ty.is_bool();
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:281 deref_ty_if_possible
FnCtxt.prototype.deref_ty_if_possible = function (this: FnCtxt, ty: Ty): Ty {
  const k = ty.kind();
  if (k.$ === "Ref" && k._2 === "Not") {
    return k._1;
  }
  return ty;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:288 point_at_expr_if_possible
FnCtxt.prototype.point_at_expr_if_possible = function (
  this: FnCtxt,
  error: FulfillmentError,
  callee_def_id: DefId,
  expr: hir.Expr,
  predicate_self_type_to_point_at: GenericArg | undefined,
  param_to_point_at: GenericArg | undefined,
  fallback_param_to_point_at: GenericArg | undefined,
  self_param_to_point_at: GenericArg | undefined,
): boolean {
  if (this.closure_span_overlaps_error(error, expr.span)) {
    return false;
  }

  const kind = expr.kind;
  if (kind.$ === "Call" && kind._0.kind.$ === "Path") {
    const qpath = kind._0.kind._0;
    const callee_span = kind._0.span;
    const args = kind._1;
    if (predicate_self_type_to_point_at !== undefined && this.point_at_path_if_possible(error, callee_def_id, predicate_self_type_to_point_at, qpath)) {
      return true;
    }

    for (const param of flatten([predicate_self_type_to_point_at, param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.blame_specific_arg_if_possible(error, callee_def_id, param, expr.hir_id, callee_span, undefined, args)) {
        return true;
      }
    }

    for (const param of flatten([param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.point_at_path_if_possible(error, callee_def_id, param, qpath)) {
        return true;
      }
    }
  } else if (kind.$ === "Path") {
    const qpath = kind._0;
    // If the parent is an call, then process this as a call.
    //
    // This is because the `WhereClauseInExpr` obligations come from
    // the well-formedness of the *path* expression, but we care to
    // point at the call expression (namely, its args).
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "Call" && HirId_eq(parent._0.kind._0.hir_id, expr.hir_id)) {
      const call_expr = parent._0;
      return this.point_at_expr_if_possible(
        error,
        callee_def_id,
        call_expr,
        predicate_self_type_to_point_at,
        param_to_point_at,
        fallback_param_to_point_at,
        self_param_to_point_at,
      );
    }

    // Otherwise, just try to point at path components.

    if (predicate_self_type_to_point_at !== undefined && this.point_at_path_if_possible(error, callee_def_id, predicate_self_type_to_point_at, qpath)) {
      return true;
    }

    for (const param of flatten([param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.point_at_path_if_possible(error, callee_def_id, param, qpath)) {
        return true;
      }
    }
  } else if (kind.$ === "MethodCall") {
    const [segment, receiver, args] = [kind._0, kind._1, kind._2];
    if (predicate_self_type_to_point_at !== undefined && this.point_at_generic_if_possible(error, callee_def_id, predicate_self_type_to_point_at, segment)) {
      // HACK: This is not correct, since `predicate_self_type_to_point_at` might
      // not actually correspond to the receiver of the method call. But we
      // re-adjust the cause code here in order to prefer pointing at one of
      // the method's turbofish segments but still use `FunctionArgumentObligation`
      // elsewhere. Hopefully this doesn't break something.
      error.obligation.cause.map_code((parent_code) => ({
        $: "FunctionArg",
        arg_hir_id: receiver.hir_id,
        call_hir_id: expr.hir_id,
        parent_code,
      }));
      return true;
    }

    for (const param of flatten([param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.blame_specific_arg_if_possible(error, callee_def_id, param, expr.hir_id, segment.ident.span, receiver, args)) {
        return true;
      }
    }
    if (param_to_point_at !== undefined && this.point_at_generic_if_possible(error, callee_def_id, param_to_point_at, segment)) {
      return true;
    }
    // Handle `Self` param specifically, since it's separated in
    // the method call representation
    if (self_param_to_point_at !== undefined) {
      error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(receiver.span, error.obligation.cause.span) ?? receiver.span;
      return true;
    }
  } else if (kind.$ === "Struct") {
    const [qpath, fields] = [kind._0, kind._1];
    const res = this.typeck_results.qpath_res(qpath, expr.hir_id);
    if (res.$ === "Def" && (res._0.$ === "Struct" || res._0.$ === "Variant")) {
      const variant_def_id = res._1;
      for (const param of flatten([param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
        const refined_expr = this.point_at_field_if_possible(callee_def_id, param, variant_def_id, fields);

        if (refined_expr === undefined) {
          // None => {}
        } else {
          const [refined_expr_] = refined_expr;
          error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(refined_expr_.span, error.obligation.cause.span) ?? refined_expr_.span;
          return true;
        }
      }
    }

    for (const param of flatten([predicate_self_type_to_point_at, param_to_point_at, fallback_param_to_point_at, self_param_to_point_at])) {
      if (this.point_at_path_if_possible(error, callee_def_id, param, qpath)) {
        return true;
      }
    }
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:487 point_at_path_if_possible
FnCtxt.prototype.point_at_path_if_possible = function (this: FnCtxt, error: FulfillmentError, def_id: DefId, arg: GenericArg, qpath: hir.QPath): boolean {
  switch (qpath.$) {
    case "Resolved": {
      const [self_ty, path] = [qpath._0, qpath._1];
      for (let i = path.segments.length - 1; i >= 0; i--) {
        const segment = path.segments[i]!;
        const res = segment.res;
        if (res.$ === "Def" && !(res._0.$ === "Mod" || res._0.$ === "ForeignMod") && this.point_at_generic_if_possible(error, res._1, arg, segment)) {
          return true;
        }
      }
      // Handle `Self` param specifically, since it's separated in
      // the path representation
      const ak = GenericArg.kind(arg);
      if (self_ty !== undefined && ak.$ === "Type" && ak._0 === this.tcx.types.self_param) {
        error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(self_ty.span, error.obligation.cause.span) ?? self_ty.span;
        return true;
      }
      break;
    }
    case "TypeRelative": {
      const [self_ty, segment] = [qpath._0, qpath._1];
      if (this.point_at_generic_if_possible(error, def_id, arg, segment)) {
        return true;
      }
      // Handle `Self` param specifically, since it's separated in
      // the path representation
      const ak = GenericArg.kind(arg);
      if (ak.$ === "Type" && ak._0 === this.tcx.types.self_param) {
        error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(self_ty.span, error.obligation.cause.span) ?? self_ty.span;
        return true;
      }
      break;
    }
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:538 point_at_generic_if_possible
FnCtxt.prototype.point_at_generic_if_possible = function (
  this: FnCtxt,
  error: FulfillmentError,
  def_id: DefId,
  param_to_point_at: GenericArg,
  segment: hir.PathSegment,
): boolean {
  const own_args = (this.tcx.generics_of(def_id) as Generics).own_args(RawList.identity_for_item(this.tcx, def_id));
  let index = own_args.findIndex((arg) => arg === param_to_point_at);
  if (index === -1) {
    return false;
  }
  // SUBTLE: We may or may not turbofish lifetime arguments, which will
  // otherwise be elided. if our "own args" starts with a lifetime, but
  // the args list does not, then we should chop off all of the lifetimes,
  // since they're all elided.
  const segment_args = segment.args_().args;
  let offset: number;
  if (
    GenericArg.kind(own_args[0]!).$ === "Lifetime" &&
    segment_args.length > 0 &&
    hir.GenericArg.is_ty_or_const(segment_args[0]!) &&
    (offset = own_args.findIndex((arg) => {
      const k = GenericArg.kind(arg);
      return k.$ === "Type" || k.$ === "Const";
    })) !== -1 &&
    index - offset >= 0
  ) {
    const new_index = index - offset;
    index = new_index;
  }
  const arg = segment_args[index];
  if (arg === undefined) {
    return false;
  }
  error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(hir.GenericArg.span(arg), error.obligation.cause.span) ?? hir.GenericArg.span(arg);
  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:576 find_ambiguous_parameter_in
FnCtxt.prototype.find_ambiguous_parameter_in = function <T>(this: FnCtxt, item_def_id: DefId, t: T, d_T: TypeVisitable<T>): GenericArg | undefined {
  const r = d_T.visit_with(t, new FindAmbiguousParameter(this, item_def_id));
  return r.$ === "Break" ? r._0 : undefined;
};

// rustc-type: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:581 FindAmbiguousParameter
class FindAmbiguousParameter implements TypeVisitor<ControlFlow<GenericArg>> {
  /** `impl TypeVisitor`: `type Result = ControlFlow<ty::GenericArg<'tcx>>`. */
  readonly Result: VisitorResult<ControlFlow<GenericArg>, GenericArg> = VisitorResultC.ControlFlow<GenericArg>();

  constructor(
    public _0: FnCtxt,
    public _1: DefId,
  ) {}

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:584 visit_ty
  visit_ty(ty: Ty): ControlFlow<GenericArg> {
    const k = ty.kind();
    let def_id: DefId | undefined;
    let generics: Generics;
    let index: number | undefined;
    let arg: GenericArg | undefined;
    if (
      k.$ === "Infer" &&
      k._0.$ === "TyVar" &&
      (def_id = this._0.type_var_origin(k._0._0).param_def_id) !== undefined &&
      ((generics = this._0.tcx.generics_of(this._1) as Generics), true) &&
      (index = generics.param_def_id_to_index_(this._0.tcx, def_id)) !== undefined &&
      (arg = RawList.identity_for_item(this._0.tcx, this._1)[index]) !== undefined
    ) {
      return ControlFlow.Break(arg);
    } else {
      return fold_Ty.super_visit_with(ty, this);
    }
  }

  /** (provided) `TypeVisitor::visit_region` */
  visit_region(r: Region): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  /** (provided) `TypeVisitor::visit_const` */
  visit_const(c: Const): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): ControlFlow<GenericArg> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:601 closure_span_overlaps_error
FnCtxt.prototype.closure_span_overlaps_error = function (this: FnCtxt, error: FulfillmentError, span: Span): boolean {
  let sk;
  if (
    error.code.$ === "Select" &&
    error.code._0.$ === "SignatureMismatch" &&
    ((sk = TraitRef.self_ty(error.code._0._0.expected_trait_ref).kind()).$ === "Closure" || sk.$ === "Coroutine") &&
    Span.overlaps(span, this.tcx.def_span(sk._0))
  ) {
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:619 point_at_field_if_possible
FnCtxt.prototype.point_at_field_if_possible = function (
  this: FnCtxt,
  def_id: DefId,
  param_to_point_at: GenericArg,
  variant_def_id: DefId,
  expr_fields: readonly hir.ExprField[],
): [hir.Expr, Ty] | undefined {
  const def = this.tcx.adt_def(def_id) as AdtDef;

  const identity_args = RawList.identity_for_item(this.tcx, def_id);
  const fields_referencing_param = def.variant_with_id(variant_def_id).fields.filter((field) => {
    const field_ty = Unnormalized.skip_norm_wip(field.ty(this.tcx, identity_args));
    return find_param_in_ty(field_ty, param_to_point_at);
  });

  if (fields_referencing_param.length === 1) {
    const field = fields_referencing_param[0]!;
    for (const expr_field of expr_fields) {
      // Look for the ExprField that matches the field, using the
      // same rules that check_expr_struct uses for macro hygiene.
      if (this.tcx.adjust_ident(expr_field.ident, variant_def_id).eq(field.ident(this.tcx))) {
        return [expr_field.expr, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(field.did) as EarlyBinder<Ty>))];
      }
    }
  }

  return undefined;
};

/// - `blame_specific_*` means that the function will recursively traverse the expression,
///   looking for the most-specific-possible span to blame.
///
/// - `point_at_*` means that the function will only go "one level", pointing at the specific
///   expression mentioned.
///
/// `blame_specific_arg_if_possible` will find the most-specific expression anywhere inside
/// the provided function call expression, and mark it as responsible for the fulfillment
/// error.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:665 blame_specific_arg_if_possible
FnCtxt.prototype.blame_specific_arg_if_possible = function (
  this: FnCtxt,
  error: FulfillmentError,
  def_id: DefId,
  param_to_point_at: GenericArg,
  call_hir_id: HirId,
  callee_span: Span,
  receiver: hir.Expr | undefined,
  args: readonly hir.Expr[],
): boolean {
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(def_id) as EarlyBinder<Ty>));
  if (!ty.is_fn()) {
    return false;
  }
  const sig = Binder.skip_binder(ty.fn_sig(this.tcx));
  const args_referencing_param: [number, Ty][] = FnSig.inputs(sig)
    .map((ty, i): [number, Ty] => [i, ty])
    .filter(([_, ty]) => find_param_in_ty(ty, param_to_point_at));
  // If there's one field that references the given generic, great!
  let arg: hir.Expr | undefined;
  if (
    args_referencing_param.length === 1 &&
    (arg = ((idx: number): hir.Expr | undefined => {
      if (receiver === undefined) return args[idx];
      const rcvr = receiver;
      return idx === 0 ? rcvr : args[idx - 1];
    })(args_referencing_param[0]![0])) !== undefined
  ) {
    const arg_ = arg;
    error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(arg_.span, error.obligation.cause.span) ?? arg_.span;

    const node = this.tcx.hir_node(arg_.hir_id);
    if (node.$ === "Expr") {
      const arg_expr = node._0;
      // This is more specific than pointing at the entire argument.
      this.blame_specific_expr_if_possible(error, arg_expr);
    }

    error.obligation.cause.map_code((parent_code) => ({
      $: "FunctionArg",
      arg_hir_id: arg_.hir_id,
      call_hir_id,
      parent_code,
    }));
    return true;
  } else if (args_referencing_param.length > 0) {
    // If more than one argument applies, then point to the callee span at least...
    // We have chance to fix this up further in `point_at_generics_if_possible`
    error.obligation.cause.span = callee_span;
  }

  return false;
};

/**
 * Recursively searches for the most-specific blameable expression.
 * For example, if you have a chain of constraints like:
 * - want `Vec<i32>: Copy`
 * - because `Option<Vec<i32>>: Copy` needs `Vec<i32>: Copy` because `impl <T: Copy> Copy for Option<T>`
 * - because `(Option<Vec<i32>, bool)` needs `Option<Vec<i32>>: Copy` because `impl <A: Copy, B: Copy> Copy for (A, B)`
 *
 * then if you pass in `(Some(vec![1, 2, 3]), false)`, this helper `point_at_specific_expr_if_possible`
 * will find the expression `vec![1, 2, 3]` as the "most blameable" reason for this missing constraint.
 *
 * This function only updates the error span.
 */
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:729 blame_specific_expr_if_possible
FnCtxt.prototype.blame_specific_expr_if_possible = function (this: FnCtxt, error: FulfillmentError, expr0: hir.Expr): void {
  // Whether it succeeded or failed, it likely made some amount of progress.
  // In the very worst case, it's just the same `expr` we originally passed in.
  const r = this.blame_specific_expr_if_possible_for_obligation_cause_code(error.obligation.cause.code_(), expr0);
  const expr = r.$ === "Ok" ? r._0 : r._0;

  // Either way, use this expression to update the error span.
  // If it doesn't overlap the existing span at all, use the original span.
  // FIXME: It would possibly be better to do this more continuously, at each level...
  error.obligation.cause.span = Span.find_ancestor_in_same_ctxt(expr.span, error.obligation.cause.span) ?? error.obligation.cause.span;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:753 blame_specific_expr_if_possible_for_obligation_cause_code
FnCtxt.prototype.blame_specific_expr_if_possible_for_obligation_cause_code = function (
  this: FnCtxt,
  obligation_cause_code: ObligationCauseCode,
  expr: hir.Expr,
): Result<hir.Expr, hir.Expr> {
  switch (obligation_cause_code.$) {
    case "WhereClauseInExpr":
    case "HostEffectInExpr":
      // This is the "root"; we assume that the `expr` is already pointing here.
      // Therefore, we return `Ok` so that this `expr` can be refined further.
      return Ok(expr);
    case "ImplDerived": {
      const impl_derived = obligation_cause_code._0;
      return this.blame_specific_expr_if_possible_for_derived_predicate_obligation(impl_derived, expr);
    }
    default:
      // We don't recognize this kind of constraint, so we cannot refine the expression
      // any further.
      return Err(expr);
  }
};

/// We want to achieve the error span in the following example:
///
/// ```ignore (just for demonstration)
/// struct Burrito<Filling> {
///   filling: Filling,
/// }
/// impl <Filling: Delicious> Delicious for Burrito<Filling> {}
/// fn eat_delicious_food<Food: Delicious>(_food: Food) {}
///
/// fn will_type_error() {
///   eat_delicious_food(Burrito { filling: Kale });
/// } //                                    ^--- The trait bound `Kale: Delicious`
///   //                                         is not satisfied
/// ```
///
/// Without calling this function, the error span will cover the entire argument expression.
///
/// Before we do any of this logic, we recursively call `point_at_specific_expr_if_possible` on the parent
/// obligation. Hence we refine the `expr` "outwards-in" and bail at the first kind of expression/impl we don't recognize.
///
/// This function returns a `Result<&Expr, &Expr>` - either way, it returns the `Expr` whose span should be
/// reported as an error. If it is `Ok`, then it means it refined successful. If it is `Err`, then it may be
/// only a partial success - but it cannot be refined even further.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:801 blame_specific_expr_if_possible_for_derived_predicate_obligation
FnCtxt.prototype.blame_specific_expr_if_possible_for_derived_predicate_obligation = function (
  this: FnCtxt,
  obligation: ImplDerivedCause,
  expr0: hir.Expr,
): Result<hir.Expr, hir.Expr> {
  // First, we attempt to refine the `expr` for our span using the parent obligation.
  // If this cannot be done, then we are already stuck, so we stop early (hence the use
  // of the `?` try operator here).
  const r = this.blame_specific_expr_if_possible_for_obligation_cause_code(ObligationCauseCodeHandle.deref(obligation.derived.parent_code), expr0);
  if (r.$ === "Err") return r;
  const expr = r._0;

  // This is the "trait" (meaning, the predicate "proved" by this `impl`) which provides the `Self` type we care about.
  // For the purposes of this function, we hope that it is a `struct` type, and that our current `expr` is a literal of
  // that struct type.
  let impl_trait_self_ref;
  if (this.tcx.is_trait_alias(obligation.impl_or_alias_def_id)) {
    impl_trait_self_ref = TraitRef.new_from_args(
      as_interner(this.tcx),
      obligation.impl_or_alias_def_id,
      RawList.identity_for_item(this.tcx, obligation.impl_or_alias_def_id),
    );
  } else {
    const impl_def = this.tcx.impl_opt_trait_ref(obligation.impl_or_alias_def_id);
    // It is possible that this is absent. In this case, we make no progress.
    if (impl_def === undefined) return Err(expr);
    impl_trait_self_ref = EarlyBinder.skip_binder(impl_def);
  }

  // We only really care about the `Self` type itself, which we extract from the ref.
  const impl_self_ty: Ty = TraitRef.self_ty(impl_trait_self_ref);

  const impl_clauses: GenericClauses = this.tcx.clauses_of(obligation.impl_or_alias_def_id) as GenericClauses;
  const impl_clause_index = obligation.impl_def_clause_index;
  if (impl_clause_index === undefined) {
    // We don't have the index, so we can only guess.
    return Err(expr);
  }

  if (impl_clause_index >= impl_clauses.clauses.length) {
    // This shouldn't happen, but since this is only a diagnostic improvement, avoid
    // breaking things.
    return Err(expr);
  }

  const ck = Binder.skip_binder(impl_clauses.clauses[impl_clause_index]![0].kind());
  switch (ck.$) {
    case "Trait": {
      const broken_trait = ck._0;
      // ...
      return this.blame_specific_part_of_expr_corresponding_to_generic_param(TraitRef.self_ty(broken_trait.trait_ref), expr, impl_self_ty);
    }
    default:
      return Err(expr);
  }
};

/// Drills into `expr` to arrive at the equivalent location of `find_generic_param` in `in_ty`.
/// For example, given
/// - expr: `(Some(vec![1, 2, 3]), false)`
/// - param: `T`
/// - in_ty: `(Option<Vec<T>, bool)`
///
/// we would drill until we arrive at `vec![1, 2, 3]`.
///
/// If successful, we return `Ok(refined_expr)`. If unsuccessful, we return `Err(partially_refined_expr`),
/// which will go as far as possible. For example, given `(foo(), false)` instead, we would drill to
/// `foo()` and then return `Err("foo()")`.
///
/// This means that you can (and should) use the `?` try operator to chain multiple calls to this
/// function with different types, since you can only continue drilling the second time if you
/// succeeded the first time.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:875 blame_specific_part_of_expr_corresponding_to_generic_param
FnCtxt.prototype.blame_specific_part_of_expr_corresponding_to_generic_param = function (
  this: FnCtxt,
  param: GenericArg,
  expr: hir.Expr,
  in_ty0: GenericArg,
): Result<hir.Expr, hir.Expr> {
  if (param === in_ty0) {
    // The types match exactly, so we have drilled as far as we can.
    return Ok(expr);
  }

  const ik = GenericArg.kind(in_ty0);
  if (ik.$ !== "Type") {
    return Err(expr);
  }
  const in_ty = ik._0;
  const in_kind = in_ty.kind();
  const ekind = expr.kind;

  if (ekind.$ === "AddrOf" && in_kind.$ === "Ref") {
    const borrowed_expr = ekind._2;
    const ty_ref_type = in_kind._1;
    // We can "drill into" the borrowed expression.
    return this.blame_specific_part_of_expr_corresponding_to_generic_param(param, borrowed_expr, ty_ref_type);
  }

  if (ekind.$ === "Tup" && in_kind.$ === "Tuple") {
    const expr_elements = ekind._0;
    const in_ty_elements = in_kind._0;
    if (in_ty_elements.length !== expr_elements.length) {
      return Err(expr);
    }
    // Find out which of `in_ty_elements` refer to `param`.
    // FIXME: It may be better to take the first if there are multiple,
    // just so that the error points to a smaller expression.
    const singleton = is_iterator_singleton(
      filter(zip(expr_elements, in_ty_elements), ([_expr_elem, in_ty_elem]) => find_param_in_ty(in_ty_elem, param)),
    );
    if (singleton === undefined) {
      // The param is not mentioned, or it is mentioned in multiple indexes.
      return Err(expr);
    }
    const [drill_expr, drill_ty] = singleton;

    return this.blame_specific_part_of_expr_corresponding_to_generic_param(param, drill_expr, drill_ty);
  }

  if (ekind.$ === "Struct" && in_kind.$ === "Adt") {
    const [expr_struct_path, expr_struct_fields] = [ekind._0, ekind._1];
    const [in_ty_adt, in_ty_adt_generic_args] = [in_kind._0, in_kind._1];
    // First, confirm that this struct is the same one as in the types, and if so,
    // find the right variant.
    const res = this.typeck_results.qpath_res(expr_struct_path, expr.hir_id);
    if (res.$ !== "Def") {
      return Err(expr);
    }
    const [expr_struct_def_kind, expr_struct_def_id] = [res._0, res._1];

    let variant_def_id: DefId;
    switch (expr_struct_def_kind.$) {
      case "Struct":
        if (!DefId_eq(in_ty_adt.did(), expr_struct_def_id)) {
          // FIXME: Deal with type aliases?
          return Err(expr);
        }
        variant_def_id = expr_struct_def_id;
        break;
      case "Variant":
        // If this is a variant, its parent is the type definition.
        if (!DefId_eq(in_ty_adt.did(), this.tcx.parent(expr_struct_def_id))) {
          // FIXME: Deal with type aliases?
          return Err(expr);
        }
        variant_def_id = expr_struct_def_id;
        break;
      default:
        return Err(expr);
    }

    // We need to know which of the generic parameters mentions our target param.
    // We expect that at least one of them does, since it is expected to be mentioned.
    const singleton = is_iterator_singleton(filter(enumerate(in_ty_adt_generic_args), ([_index, in_ty_generic]) => find_param_in_ty(in_ty_generic, param)));
    if (singleton === undefined) {
      return Err(expr);
    }
    const [drill_generic_index, generic_argument_type] = singleton;

    const struct_generic_parameters: Generics = this.tcx.generics_of(in_ty_adt.did()) as Generics;
    if (drill_generic_index >= struct_generic_parameters.own_params.length) {
      return Err(expr);
    }

    const param_to_point_at_in_struct = this.tcx.mk_param_from_def(struct_generic_parameters.param_at(drill_generic_index, this.tcx));

    // We make 3 steps:
    // Suppose we have a type like
    // ```ignore (just for demonstration)
    // struct ExampleStruct<T> {
    //   enabled: bool,
    //   item: Option<(usize, T, bool)>,
    // }
    //
    // f(ExampleStruct {
    //   enabled: false,
    //   item: Some((0, Box::new(String::new()), 1) }, true)),
    // });
    // ```
    // Here, `f` is passed a `ExampleStruct<Box<String>>`, but it wants
    // for `String: Copy`, which isn't true here.
    //
    // (1) First, we drill into `.item` and highlight that expression
    // (2) Then we use the template type `Option<(usize, T, bool)>` to
    //     drill into the `T`, arriving at a `Box<String>` expression.
    // (3) Then we keep going, drilling into this expression using our
    //     outer contextual information.

    // (1) Find the (unique) field which mentions the type in our constraint:
    const field = this.point_at_field_if_possible(in_ty_adt.did(), param_to_point_at_in_struct, variant_def_id, expr_struct_fields);
    if (field === undefined) return Err(expr);
    const [field_expr, field_type] = field;

    // (2) Continue drilling into the struct, ignoring the struct's
    // generic argument types.
    const r = this.blame_specific_part_of_expr_corresponding_to_generic_param(param_to_point_at_in_struct, field_expr, field_type);
    if (r.$ === "Err") return r;
    const expr_ = r._0;

    // (3) Continue drilling into the expression, having "passed
    // through" the struct entirely.
    return this.blame_specific_part_of_expr_corresponding_to_generic_param(param, expr_, generic_argument_type);
  }

  if (ekind.$ === "Call" && in_kind.$ === "Adt") {
    const [expr_callee, expr_args] = [ekind._0, ekind._1];
    const [in_ty_adt, in_ty_adt_generic_args] = [in_kind._0, in_kind._1];
    if (expr_callee.kind.$ !== "Path") {
      // FIXME: This case overlaps with another one worth handling,
      // which should happen above since it applies to non-ADTs:
      // we can drill down into regular generic functions.
      return Err(expr);
    }
    const expr_callee_path = expr_callee.kind._0;
    // This is (possibly) a constructor call, like `Some(...)` or `MyStruct(a, b, c)`.

    const res = this.typeck_results.qpath_res(expr_callee_path, expr_callee.hir_id);
    if (res.$ !== "Def") {
      return Err(expr);
    }
    const [expr_struct_def_kind, expr_ctor_def_id] = [res._0, res._1];

    let variant_def_id: DefId;
    if (expr_struct_def_kind.$ === "Ctor" && expr_struct_def_kind._0 === "Struct" && expr_struct_def_kind._1 === "Fn") {
      if (!DefId_eq(in_ty_adt.did(), this.tcx.parent(expr_ctor_def_id))) {
        // FIXME: Deal with type aliases?
        return Err(expr);
      }
      variant_def_id = this.tcx.parent(expr_ctor_def_id);
    } else if (expr_struct_def_kind.$ === "Ctor" && expr_struct_def_kind._0 === "Variant" && expr_struct_def_kind._1 === "Fn") {
      // For a typical enum like
      // `enum Blah<T> { Variant(T) }`
      // we get the following resolutions:
      // - expr_ctor_def_id :::                                   DefId(0:29 ~ source_file[b442]::Blah::Variant::{constructor#0})
      // - self.tcx.parent(expr_ctor_def_id) :::                  DefId(0:28 ~ source_file[b442]::Blah::Variant)
      // - self.tcx.parent(self.tcx.parent(expr_ctor_def_id)) ::: DefId(0:26 ~ source_file[b442]::Blah)

      // Therefore, we need to go up once to obtain the variant and up twice to obtain the type.
      // Note that this pattern still holds even when we `use` a variant or `use` an enum type to rename it, or chain `use` expressions
      // together; this resolution is handled automatically by `qpath_res`.

      // FIXME: Deal with type aliases?
      if (DefId_eq(in_ty_adt.did(), this.tcx.parent(this.tcx.parent(expr_ctor_def_id)))) {
        // The constructor definition refers to the "constructor" of the variant:
        // For example, `Some(5)` triggers this case.
        variant_def_id = this.tcx.parent(expr_ctor_def_id);
      } else {
        // FIXME: Deal with type aliases?
        return Err(expr);
      }
    } else {
      return Err(expr);
    }

    // We need to know which of the generic parameters mentions our target param.
    // We expect that at least one of them does, since it is expected to be mentioned.
    const singleton = is_iterator_singleton(filter(enumerate(in_ty_adt_generic_args), ([_index, in_ty_generic]) => find_param_in_ty(in_ty_generic, param)));
    if (singleton === undefined) {
      return Err(expr);
    }
    const [drill_generic_index, generic_argument_type] = singleton;

    const struct_generic_parameters: Generics = this.tcx.generics_of(in_ty_adt.did()) as Generics;
    if (drill_generic_index >= struct_generic_parameters.own_params.length) {
      return Err(expr);
    }

    const param_to_point_at_in_struct = this.tcx.mk_param_from_def(struct_generic_parameters.param_at(drill_generic_index, this.tcx));

    // We make 3 steps:
    // Suppose we have a type like
    // ```ignore (just for demonstration)
    // struct ExampleStruct<T> {
    //   enabled: bool,
    //   item: Option<(usize, T, bool)>,
    // }
    //
    // f(ExampleStruct {
    //   enabled: false,
    //   item: Some((0, Box::new(String::new()), 1) }, true)),
    // });
    // ```
    // Here, `f` is passed a `ExampleStruct<Box<String>>`, but it wants
    // for `String: Copy`, which isn't true here.
    //
    // (1) First, we drill into `.item` and highlight that expression
    // (2) Then we use the template type `Option<(usize, T, bool)>` to
    //     drill into the `T`, arriving at a `Box<String>` expression.
    // (3) Then we keep going, drilling into this expression using our
    //     outer contextual information.

    // (1) Find the (unique) field index which mentions the type in our constraint:
    const field_singleton = is_iterator_singleton(
      filter(
        enumerate(map(in_ty_adt.variant_with_id(variant_def_id).fields, (field) => Unnormalized.skip_norm_wip(field.ty(this.tcx, in_ty_adt_generic_args)))),
        ([_index, field_type]) => find_param_in_ty(field_type, param),
      ),
    );
    if (field_singleton === undefined) {
      return Err(expr);
    }
    const [field_index, field_type] = field_singleton;

    if (field_index >= expr_args.length) {
      return Err(expr);
    }

    // (2) Continue drilling into the struct, ignoring the struct's
    // generic argument types.
    const r = this.blame_specific_part_of_expr_corresponding_to_generic_param(param_to_point_at_in_struct, expr_args[field_index]!, field_type);
    if (r.$ === "Err") return r;
    const expr_ = r._0;

    // (3) Continue drilling into the expression, having "passed
    // through" the struct entirely.
    return this.blame_specific_part_of_expr_corresponding_to_generic_param(param, expr_, generic_argument_type);
  }

  // At this point, none of the basic patterns matched.
  // One major possibility which remains is that we have a function call.
  // In this case, it's often possible to dive deeper into the call to find something to blame,
  // but this is not always possible.

  return Err(expr);
};

// }

/// Traverses the given ty (either a `ty::Ty` or a `ty::GenericArg`) and searches for references
/// to the given `param_to_point_at`. Returns `true` if it finds any use of the param.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:1172 find_param_in_ty
export function find_param_in_ty(ty: GenericArg, param_to_point_at: GenericArg): boolean {
  const walk = GenericArg.walk(ty);
  let arg: GenericArg | undefined;
  while ((arg = walk.next()) !== undefined) {
    if (arg === param_to_point_at) {
      return true;
    }
    const k = GenericArg.kind(arg);
    let tk;
    if (k.$ === "Type" && (tk = k._0.kind()).$ === "Alias" && (tk._1.kind.$ === "Projection" || tk._1.kind.$ === "Inherent")) {
      // This logic may seem a bit strange, but typically when
      // we have a projection type in a function signature, the
      // argument that's being passed into that signature is
      // not actually constraining that projection's args in
      // a meaningful way. So we skip it, and see improvements
      // in some UI tests.
      walk.skip_current_subtree();
    }
  }
  return false;
}

/// Returns `Some(iterator.next())` if it has exactly one item, and `None` otherwise.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/adjust_fulfillment_errors.rs:1200 is_iterator_singleton
export function is_iterator_singleton<T>(iterator: Iterable<T>): T | undefined {
  const it = iterator[Symbol.iterator]();
  const first = it.next();
  const second = it.next();
  if (!second.done) {
    return undefined;
  } else {
    return first.done ? undefined : first.value;
  }
}

// ---- lazy iterator adaptors (`Iterator::{zip, filter, enumerate, map}`), so that `is_iterator_singleton` pulls at most
// two items, as upstream ---------------------------------------------------------------------------------------------

function* flatten<T>(xs: readonly (T | undefined)[]): Generator<T> {
  for (const x of xs) if (x !== undefined) yield x;
}

function* zip<A, B>(a: readonly A[], b: readonly B[]): Generator<[A, B]> {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) yield [a[i]!, b[i]!];
}

function* enumerate<T>(xs: Iterable<T>): Generator<[number, T]> {
  let i = 0;
  for (const x of xs) yield [i++, x];
}

function* map<T, U>(xs: Iterable<T>, f: (x: T) => U): Generator<U> {
  for (const x of xs) yield f(x);
}

function* filter<T>(xs: Iterable<T>, p: (x: T) => boolean): Generator<T> {
  for (const x of xs) if (p(x)) yield x;
}
