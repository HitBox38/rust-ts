// Port of compiler/rustc_middle/src/mir/interpret/queries.rs (lanes mir-contract, mir-interp-b; plan-m4 D8): the
// `impl TyCtxt` const-eval entry points, installed by `install_TyCtxt_methods` (init order, see mir/consts.ts). They wrap
// the `eval_to_*` queries, whose providers (rustc_const_eval, wave 23b) stop `unported` until CTFE lands.
// PORT (init order R4): ty/mod.ts, ty/instance.ts, ty/list.ts, ty/generic_args.ts, rustc_middle diagnostics.gen.ts and
// rustc_lint_defs are read lazily.
import "../mod.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../../rustc_span/lib.ts";
import { DiagDecorator } from "../../../rustc_errors/diagnostic.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { Err, Ok } from "../../../std/result.ts";
import { TyCtxt } from "../../ty/context.ts";
import type { AliasConst } from "../../ty/consts.ts";
import type { ConstToValTreeResult } from "../../ty/consts/valtree.ts";
import type { Instance, PseudoCanonicalInput, TypingEnv } from "../../ty/decls.ts";
import type { UnevaluatedConst } from "../consts.ts";
import {
  ErrorHandled,
  ErrorHandled_from_ReportedErrorInfo,
  type EvalToAllocationRawResult,
  type EvalToConstValueResult,
  type EvalToValTreeResult,
  ReportedErrorInfo,
  ValTreeCreationError,
} from "./error.ts";
import { fold_with_GlobalId, GlobalId, try_fold_with_GlobalId, visit_with_GlobalId } from "./mod.gen.ts";

/** ty/mod.ts, read lazily (module header). */
function ty_mod(): typeof import("../../ty/mod.ts") {
  return (ty_mod__m ??= require("../../ty/mod.ts") as typeof import("../../ty/mod.ts"));
}
var ty_mod__m: typeof import("../../ty/mod.ts") | undefined;
/** ty/instance.ts, read lazily (module header). */
function ty_instance(): typeof import("../../ty/instance.ts") {
  return (ty_instance__m ??= require("../../ty/instance.ts") as typeof import("../../ty/instance.ts"));
}
var ty_instance__m: typeof import("../../ty/instance.ts") | undefined;
/** ty/list.ts, read lazily (module header). */
function ty_list(): typeof import("../../ty/list.ts") {
  return (ty_list__m ??= require("../../ty/list.ts") as typeof import("../../ty/list.ts"));
}
var ty_list__m: typeof import("../../ty/list.ts") | undefined;
/** ty/generic_args.ts, read lazily (module header). */
function ty_generic_args(): typeof import("../../ty/generic_args.ts") {
  return (ty_generic_args__m ??= require("../../ty/generic_args.ts") as typeof import("../../ty/generic_args.ts"));
}
var ty_generic_args__m: typeof import("../../ty/generic_args.ts") | undefined;
/** rustc_middle diagnostics.gen.ts (`crate::diagnostics`), read lazily (module header). */
function diagnostics(): typeof import("../../diagnostics.gen.ts") {
  return (diagnostics__m ??= require("../../diagnostics.gen.ts") as typeof import("../../diagnostics.gen.ts"));
}
var diagnostics__m: typeof import("../../diagnostics.gen.ts") | undefined;
/** rustc_lint_defs builtin.gen.ts, read lazily (module header). */
function lint_builtin(): typeof import("../../../rustc_lint_defs/builtin.gen.ts") {
  return (lint_builtin__m ??= require("../../../rustc_lint_defs/builtin.gen.ts") as typeof import("../../../rustc_lint_defs/builtin.gen.ts"));
}
var lint_builtin__m: typeof import("../../../rustc_lint_defs/builtin.gen.ts") | undefined;

/** `TypeFoldable` of `GlobalId` (the generated derive). */
const fold_GlobalId: TypeFoldable<GlobalId> = {
  visit_with: visit_with_GlobalId,
  try_fold_with: try_fold_with_GlobalId,
  fold_with: fold_with_GlobalId,
};
/** `TypeFoldable` of `PseudoCanonicalInput<GlobalId>` (the derive of ty/mod.rs:1246); built on first use (init order). */
let d_query_input_: TypeFoldable<PseudoCanonicalInput<GlobalId>> | undefined;
function d_query_input(): TypeFoldable<PseudoCanonicalInput<GlobalId>> {
  return (d_query_input_ ??= ty_mod().fold_PseudoCanonicalInput(fold_GlobalId));
}

declare module "../../ty/context.ts" {
  interface TyCtxt {
    // interpret/queries.rs:19
    const_eval_poly(def_id: DefId): EvalToConstValueResult;
    // interpret/queries.rs:35
    const_eval_poly_to_alloc(def_id: DefId): EvalToAllocationRawResult;
    // interpret/queries.rs:58
    const_eval_resolve(typing_env: TypingEnv, ct: UnevaluatedConst, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:90
    const_eval_resolve_for_typeck(typing_env: TypingEnv, ct: AliasConst, span: Span): ConstToValTreeResult;
    // interpret/queries.rs:167
    const_eval_instance(typing_env: TypingEnv, instance: Instance, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:178
    const_eval_global_id(typing_env: TypingEnv, cid: GlobalId, span: Span): EvalToConstValueResult;
    // interpret/queries.rs:199
    const_eval_global_id_for_typeck(typing_env: TypingEnv, cid: GlobalId, span: Span): ConstToValTreeResult;
  }
}

/** PORT (init order, see mir/consts.ts): puts this file's `impl TyCtxt` methods on `TyCtxt.prototype` (rustc_middle/lib.ts). */
export function install_TyCtxt_methods(): void {
  /// Evaluates a constant without providing any generic parameters. This is useful to evaluate consts
  /// that can't take any generic arguments like const items or enum discriminants. If a
  /// generic parameter is used within the constant `ErrorHandled::TooGeneric` will be returned.
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:19 const_eval_poly
  TyCtxt.prototype.const_eval_poly = function (this: TyCtxt, def_id: DefId): EvalToConstValueResult {
    // In some situations def_id will have generic parameters within scope, but they aren't allowed
    // to be used. So we can't use `Instance::mono`, instead we feed unresolved generic parameters
    // into `const_eval` which will return `ErrorHandled::TooGeneric` if any of them are
    // encountered.
    const args = ty_list().RawList.identity_for_item(this, def_id);
    const instance = ty_instance().Instance.new_raw(def_id, args);
    const cid = new GlobalId(instance, undefined);
    const typing_env = ty_mod().TypingEnv.post_analysis(this, def_id);
    return this.const_eval_global_id(typing_env, cid, DUMMY_SP);
  };


  /// Evaluates a constant without providing any generic parameters. This is useful to evaluate consts
  /// that can't take any generic arguments like const items or enum discriminants. If a
  /// generic parameter is used within the constant `ErrorHandled::TooGeneric` will be returned.
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:35 const_eval_poly_to_alloc
  TyCtxt.prototype.const_eval_poly_to_alloc = function (this: TyCtxt, def_id: DefId): EvalToAllocationRawResult {
    // In some situations def_id will have generic parameters within scope, but they aren't allowed
    // to be used. So we can't use `Instance::mono`, instead we feed unresolved generic parameters
    // into `const_eval` which will return `ErrorHandled::TooGeneric` if any of them are
    // encountered.
    const args = ty_list().RawList.identity_for_item(this, def_id);
    const instance = ty_instance().Instance.new_raw(def_id, args);
    const cid = new GlobalId(instance, undefined);
    const typing_env = ty_mod().TypingEnv.post_analysis(this, def_id);
    const inputs = this.erase_and_anonymize_regions(typing_env.as_query_input(cid), d_query_input());
    return this.eval_to_allocation_raw(inputs);
  };


  /// Resolves and evaluates a constant.
  ///
  /// The constant can be located on a trait like `<A as B>::C`, in which case the given
  /// generic parameters and environment are used to resolve the constant. Alternatively if the
  /// constant has generic parameters in scope the generic parameters are used to evaluate the value of
  /// the constant. For example in `fn foo<T>() { let _ = [0; bar::<T>()]; }` the repeat count
  /// constant `bar::<T>()` requires a instantiation for `T`, if the instantiation for `T` is still
  /// too generic for the constant to be evaluated then `Err(ErrorHandled::TooGeneric)` is
  /// returned.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:58 const_eval_resolve
  TyCtxt.prototype.const_eval_resolve = function (this: TyCtxt, typing_env: TypingEnv, ct: UnevaluatedConst, span: Span): EvalToConstValueResult {
    // Cannot resolve `Unevaluated` constants that contain inference
    // variables. We reject those here since `resolve`
    // would fail otherwise.
    //
    // When trying to evaluate constants containing inference variables,
    // use `Infcx::const_eval_resolve` instead.
    if (TypeVisitableExt.has_non_region_infer(ct.args, ty_generic_args().fold_GenericArgs)) {
      return bug("did not expect inference variables here");
    }

    // FIXME: maybe have a separate version for resolving mir::UnevaluatedConst?
    const r = ty_instance().Instance.try_resolve(this, typing_env, ct.def, ct.args);
    if (r.$ === "Ok") {
      const instance = r._0;
      if (instance !== undefined) {
        const cid = new GlobalId(instance, ct.promoted);
        return this.const_eval_global_id(typing_env, cid, span);
      }
      // For errors during resolution, we deliberately do not point at the usage site of the constant,
      // since for these errors the place the constant is used shouldn't matter.
      return Err({ $: "TooGeneric", _0: DUMMY_SP });
    } else {
      const err = r._0;
      return Err({ $: "Reported", _0: ReportedErrorInfo.non_const_eval_error(err), _1: DUMMY_SP });
    }
  };


  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:90 const_eval_resolve_for_typeck
  TyCtxt.prototype.const_eval_resolve_for_typeck = function (this: TyCtxt, typing_env: TypingEnv, ct: AliasConst, span: Span): ConstToValTreeResult {
    // Cannot resolve `Unevaluated` constants that contain inference
    // variables. We reject those here since `resolve`
    // would fail otherwise.
    //
    // When trying to evaluate constants containing inference variables,
    // use `Infcx::const_eval_resolve` instead.
    if (TypeVisitableExt.has_non_region_infer(ct.args, ty_generic_args().fold_GenericArgs)) {
      return bug("did not expect inference variables here");
    }

    let def_id: DefId;
    switch (ct.kind.$) {
      case "InherentSelf":
        return bug("got AliasConstKind::InherentSelf in const_eval_resolve_for_typeck");
      case "Projection":
      case "InherentImpl":
      case "Free":
      case "Anon":
        def_id = ct.kind.def_id;
        break;
    }

    let cid: GlobalId;
    const r = ty_instance().Instance.try_resolve(this, typing_env, def_id, ct.args);
    if (r.$ === "Ok") {
      const instance = r._0;
      if (instance !== undefined) {
        cid = new GlobalId(instance, undefined);
      } else {
        // For errors during resolution, we deliberately do not point at the usage site of the constant,
        // since for these errors the place the constant is used shouldn't matter.
        return Err({ $: "TooGeneric", _0: DUMMY_SP });
      }
    } else {
      const err = r._0;
      return Err({ $: "Reported", _0: ReportedErrorInfo.non_const_eval_error(err), _1: DUMMY_SP });
    }

    const res = this.const_eval_global_id_for_typeck(typing_env, cid, span);
    // `.inspect(|_| { .. })`
    if (res.$ === "Ok") {
      // We are emitting the lint here instead of in `is_const_evaluatable`
      // as we normalize obligations before checking them, and normalization
      // uses this function to evaluate this constant.
      //
      // @lcnr believes that successfully evaluating even though there are
      // used generic parameters is a bug of evaluation, so checking for it
      // here does feel somewhat sensible.
      const def_id = ty_instance().Instance.def_id(cid.instance);
      let local_def_id: LocalDefId | undefined;
      if (
        !this.features().generic_const_exprs() &&
        TypeVisitableExt.has_non_region_param(ct.args, ty_generic_args().fold_GenericArgs) &&
        // We only FCW for anon consts as repeat expr counts with anon consts are the only place
        // that we have a back compat hack for. We don't need to check this is a const argument
        // as only anon consts as const args should get evaluated "for the type system".
        //
        // If we don't *only* FCW anon consts we can wind up incorrectly FCW'ing uses of assoc
        // consts in pattern positions. #140447
        this.def_kind(def_id).$ === "AnonConst" &&
        !this.is_trivial_const(def_id) &&
        (local_def_id = def_id.as_local()) !== undefined
      ) {
        const mir_body = this.mir_for_ctfe(def_id);
        if (mir_body.is_polymorphic) {
          this.emit_node_span_lint(
            lint_builtin().CONST_EVALUATABLE_UNCHECKED,
            this.local_def_id_to_hir_id(local_def_id),
            this.def_span(def_id),
            DiagDecorator((lint) => {
              lint.primary_message("cannot use constants which depend on generic parameters in types");
            }),
          );
        }
      }
    }
    return res;
  };


  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:167 const_eval_instance
  TyCtxt.prototype.const_eval_instance = function (this: TyCtxt, typing_env: TypingEnv, instance: Instance, span: Span): EvalToConstValueResult {
    return this.const_eval_global_id(typing_env, new GlobalId(instance, undefined), span);
  };


  /// Evaluate a constant to a `ConstValue`.
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:178 const_eval_global_id
  TyCtxt.prototype.const_eval_global_id = function (this: TyCtxt, typing_env: TypingEnv, cid: GlobalId, span: Span): EvalToConstValueResult {
    // Const-eval shouldn't depend on lifetimes at all, so we can erase them, which should
    // improve caching of queries.
    const inputs = this.erase_and_anonymize_regions(
      typing_env.with_post_analysis_normalized(this).as_query_input(cid),
      d_query_input(),
    );
    if (!Span.is_dummy(span)) {
      // The query doesn't know where it is being invoked, so we need to fix the span.
      const r = this.at(span).eval_to_const_value_raw(inputs);
      return r.$ === "Ok" ? r : Err(ErrorHandled.with_span(r._0, span));
    } else {
      return this.eval_to_const_value_raw(inputs);
    }
  };


  /// Evaluate a constant to a type-level constant.
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/mir/interpret/queries.rs:199 const_eval_global_id_for_typeck
  TyCtxt.prototype.const_eval_global_id_for_typeck = function (this: TyCtxt, typing_env: TypingEnv, cid: GlobalId, span: Span): ConstToValTreeResult {
    // Const-eval shouldn't depend on lifetimes at all, so we can erase them, which should
    // improve caching of queries.
    const inputs = this.erase_and_anonymize_regions(
      typing_env.with_post_analysis_normalized(this).as_query_input(cid),
      d_query_input(),
    );
    // debug!(?inputs);
    let res: EvalToValTreeResult;
    if (!Span.is_dummy(span)) {
      // The query doesn't know where it is being invoked, so we need to fix the span.
      const r = this.at(span).eval_to_valtree(inputs);
      res = r.$ === "Ok" ? r : Err(ValTreeCreationError.with_span(r._0, span));
    } else {
      res = this.eval_to_valtree(inputs);
    }
    if (res.$ === "Ok") {
      const valtree = res._0;
      return Ok(Ok(valtree));
    } else {
      const err = res._0;
      switch (err.$) {
        // Let the caller decide how to handle this.
        case "NonSupportedType":
          return Ok(Err(err._0));
        // Report the others.
        case "NodesOverflow": {
          const handled = this.dcx().emit_err(
            diagnostics().MaxNumNodesInValtree_diagnostic({
              span,
              global_const_id: cid.display(this),
            }),
          );
          return Err(ErrorHandled_from_ReportedErrorInfo(ReportedErrorInfo.allowed_in_infallible(handled)));
        }
        case "InvalidConst": {
          const handled = this.dcx().emit_err(
            diagnostics().InvalidConstInValtree_diagnostic({
              span,
              global_const_id: cid.display(this),
            }),
          );
          return Err(ErrorHandled_from_ReportedErrorInfo(ReportedErrorInfo.allowed_in_infallible(handled)));
        }
        case "CyclicConst": {
          const handled = this.dcx().emit_err(
            diagnostics().CyclicConstInValtree_diagnostic({
              span,
              global_const_id: cid.display(this),
            }),
          );
          return Err(ErrorHandled_from_ReportedErrorInfo(ReportedErrorInfo.allowed_in_infallible(handled)));
        }
        case "ErrorHandled": {
          const handled = err._0;
          return Err(handled);
        }
      }
    }
  };
}
