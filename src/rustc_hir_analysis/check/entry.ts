// Port of compiler/rustc_hir_analysis/src/check/entry.rs (lane small-gaps-17).
//
// Init order: top-level code here touches only other crates; this crate's modules are read inside function bodies only.
//
// PORT notes (file-wide):
// - Query values that are `unknown` in queries.gen.ts (`fn_sig`, `type_of`, `asyncness`, `codegen_fn_attrs`,
//   `generics_of`, `clauses_of`, `entry_fn`'s `EntryFnType`) are cast to the upstream value types.
// - `?` on a `Result<_, ErrorGuaranteed>` is `if (r.$ === "Err") return r;`.
// - `TypeErrCtxt`'s `report_fulfillment_errors` / `report_region_errors` (wave 19) are a view over `infcx.err_ctxt()`
//   (its stub stops as UNPORTED); `CodegenFnAttrs` is a view of the field read (codegen_fn_attrs is not ported).
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { check_function_signature } from "./mod.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import { FnRetTy } from "../../rustc_hir/hir.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { TraitErrors } from "../../rustc_infer/traits/mod.ts";
import type { EntryFnType } from "../../rustc_passes/entry.ts";
import { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericClauses, Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type Asyncness, Asyncness as AsyncnessC, HasAttrs_DefId, ParamEnv, type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { CRATE_DEF_ID, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { fold_FnSig, PolyFnSig as PolyFnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";

// rustc: compiler/rustc_hir_analysis/src/check/entry.rs:19 check_for_entry_fn
export function check_for_entry_fn(tcx: TyCtxt): Result<null, ErrorGuaranteed> {
  const entry = tcx.entry_fn(null) as [DefId, EntryFnType] | undefined;
  if (entry !== undefined && entry[1].$ === "Main") {
    const def_id = entry[0];
    return check_main_fn_ty(tcx, def_id);
  } else {
    return Ok(null);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/entry.rs:26 check_main_fn_ty
function check_main_fn_ty(tcx: TyCtxt, main_def_id: DefId): Result<null, ErrorGuaranteed> {
  const main_fnsig: PolyFnSig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(main_def_id) as EarlyBinder<PolyFnSig>));
  const main_span = tcx.def_span(main_def_id);

  // rustc: compiler/rustc_hir_analysis/src/check/entry.rs:30 main_fn_diagnostics_def_id
  function main_fn_diagnostics_def_id(tcx: TyCtxt, def_id: DefId, sp: Span): LocalDefId {
    const local_def_id = def_id.as_local();
    if (local_def_id !== undefined) {
      const hir_type = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(local_def_id) as EarlyBinder<Ty>));
      if (!(hir_type.kind().$ === "FnDef")) {
        span_bug(sp, `main has a non-function type: found \`${display_Ty(hir_type)}\``);
      }
      return local_def_id;
    } else {
      return CRATE_DEF_ID;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/entry.rs:42 main_fn_generics_params_span
  function main_fn_generics_params_span(tcx: TyCtxt, def_id: DefId): Span | undefined {
    if (!def_id.is_local()) {
      return undefined;
    }
    const node = tcx.hir_node_by_def_id(def_id.expect_local());
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const generics = node._0.kind.generics;
      return !(generics.params.length === 0) ? generics.span : undefined;
    } else {
      return span_bug(tcx.def_span(def_id), "main has a non-function type");
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/entry.rs:56 main_fn_where_clauses_span
  function main_fn_where_clauses_span(tcx: TyCtxt, def_id: DefId): Span | undefined {
    if (!def_id.is_local()) {
      return undefined;
    }
    const node = tcx.hir_node_by_def_id(def_id.expect_local());
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const generics = node._0.kind.generics;
      return generics.where_clause_span;
    } else {
      return span_bug(tcx.def_span(def_id), "main has a non-function type");
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/check/entry.rs:70 main_fn_asyncness_span
  function main_fn_asyncness_span(tcx: TyCtxt, def_id: DefId): Span | undefined {
    if (!def_id.is_local()) {
      return undefined;
    }
    return tcx.def_span(def_id);
  }

  // rustc: compiler/rustc_hir_analysis/src/check/entry.rs:77 main_fn_return_type_span
  function main_fn_return_type_span(tcx: TyCtxt, def_id: DefId): Span | undefined {
    if (!def_id.is_local()) {
      return undefined;
    }
    const node = tcx.hir_node_by_def_id(def_id.expect_local());
    if (node.$ === "Item" && node._0.kind.$ === "Fn") {
      const fn_sig = node._0.kind.sig;
      return FnRetTy.span(fn_sig.decl.output);
    } else {
      return span_bug(tcx.def_span(def_id), "main has a non-function type");
    }
  }

  const main_diagnostics_def_id = main_fn_diagnostics_def_id(tcx, main_def_id, main_span);

  const main_asyncness = tcx.asyncness(main_def_id) as Asyncness;
  if (AsyncnessC.is_async(main_asyncness)) {
    const asyncness_span = main_fn_asyncness_span(tcx, main_def_id);
    return Err(tcx.dcx().emit_err(diagnostics.MainFunctionAsync_diagnostic({ span: main_span, asyncness: asyncness_span })));
  }

  const attr_span = find_attr(HasAttrs_DefId.get_attrs(main_def_id, tcx), (k) => (k.$ === "TrackCaller" ? k._0 : undefined));
  if (attr_span !== undefined) {
    return Err(tcx.dcx().emit_err(diagnostics.TrackCallerOnMain_diagnostic({ span: attr_span, annotated: main_span })));
  }

  if (
    !((tcx.codegen_fn_attrs(main_def_id) as CodegenFnAttrsView).target_features.length === 0) &&
    // Calling functions with `#[target_feature]` is not unsafe on WASM, see #84988
    !tcx.sess.target.is_like_wasm &&
    !tcx.sess.opts.actually_rustdoc
  ) {
    return Err(tcx.dcx().emit_err(diagnostics.TargetFeatureOnMain_diagnostic({ main: main_span })));
  }

  // Main should have no WC, so empty param env is OK here.
  const param_env = ParamEnv.empty();
  let expected_return_type: Ty;
  const term_did = tcx.lang_items().termination();
  if (term_did !== undefined) {
    const return_ty_ = PolyFnSigC.output(main_fnsig);
    const return_ty_span = main_fn_return_type_span(tcx, main_def_id) ?? main_span;
    const return_ty = Binder.no_bound_vars(return_ty_, fold_Ty);
    if (return_ty === undefined) {
      return Err(tcx.dcx().emit_err(diagnostics.MainFunctionReturnTypeGeneric_diagnostic({ span: return_ty_span })));
    }
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const cause = ObligationCause.new(return_ty_span, main_diagnostics_def_id, ObligationCauseCode.MainFunctionType);
    const ocx = ObligationCtxt.new_with_diagnostics(infcx);
    const norm_return_ty = ocx.normalize(cause, param_env, Unnormalized.new_wip(return_ty), fold_Ty);
    ocx.register_bound(cause, param_env, norm_return_ty, term_did);
    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (errors.$ === "HasErrors") {
      return Err(infcx.err_ctxt().report_fulfillment_errors(errors._0));
    }

    const region_errors = infcx.resolve_regions(main_diagnostics_def_id, param_env, RawList.empty<Ty>());

    if (!(region_errors.length === 0)) {
      return Err(infcx.err_ctxt().report_region_errors(main_diagnostics_def_id, region_errors));
    }
    // now we can take the return type of the given main function
    expected_return_type = norm_return_ty;
  } else {
    // standard () main return type
    expected_return_type = tcx.types.unit;
  }

  const expected_sig: PolyFnSig = Binder.dummy(tcx.mk_fn_sig_safe_rust_abi([], expected_return_type), fold_FnSig);

  const r = check_function_signature(
    tcx,
    ObligationCause.new(main_span, main_diagnostics_def_id, ObligationCauseCode.MainFunctionType),
    main_def_id,
    expected_sig,
  );
  if (r.$ === "Err") return r;

  const main_fn_generics = tcx.generics_of(main_def_id) as Generics;
  const main_fn_clauses = tcx.clauses_of(main_def_id) as GenericClauses;
  if (main_fn_generics.count() !== 0 || !(Binder.bound_vars(main_fnsig).length === 0)) {
    const generics_param_span = main_fn_generics_params_span(tcx, main_def_id);
    return Err(
      tcx.dcx().emit_err(
        diagnostics.MainFunctionGenericParameters_diagnostic({
          span: generics_param_span ?? main_span,
          label_span: generics_param_span,
        }),
      ),
    );
  } else if (!(main_fn_clauses.clauses.length === 0)) {
    // Generics may bring in implicit clauses, so we skip this check if generics are present.
    const generics_where_clauses_span = main_fn_where_clauses_span(tcx, main_def_id);
    return Err(
      tcx.dcx().emit_err(
        diagnostics.WhereClauseOnMain_diagnostic({
          span: generics_where_clauses_span ?? main_span,
          generics_span: generics_where_clauses_span,
        }),
      ),
    );
  }

  return Ok(null);
}

// ==== Stand-ins (PORT: other lanes; see the file header) ===============================================================

/** `CodegenFnAttrs` (rustc_middle middle/codegen_fn_attrs.rs, not ported): the field this file reads. */
interface CodegenFnAttrsView {
  target_features: readonly unknown[];
}


