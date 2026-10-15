// Port of compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs (lane fnctxt-contract).
//
// `FnCtxt` itself (the struct, fn_ctxt/mod.rs:46) is declared in ../decls.ts (the contract): the class with all fields,
// every method's declaration and the `Deref<Target = TypeckRootCtxt>` forwarders (`register_deref` below). `LoweredTy`
// is generated (mod.gen.ts).
// - `impl HirTyLowerer for FnCtxt` is the vtable object `HirTyLowerer_FnCtxt` (rustc_hir_analysis decls.ts
//   `HirTyLowererImpl`); `FnCtxt.prototype.lowerer()` builds the trait object over it (hirtylowerer-contract
//   representation, as `ItemCtxt`).
// - `impl rustc_hir_pretty::PpAnn for FnCtxt` is the class `FnCtxtPpAnn`; `FnCtxt_as_PpAnn(fcx)` is the coercion
//   `fcx as &dyn PpAnn`.
// - The sub-modules (`mod _impl; mod adjust_fulfillment_errors; ...`) are loaded by ../lib.ts (this module must not
//   import them: they extend `FnCtxt.prototype`).
// Init order: top-level code here touches only ../decls.ts, this file's .gen.ts and other crates.
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { HirTyLowerer_provided } from "../../rustc_hir_analysis/hir_ty_lowering/mod.ts";
import type { HirTyLowerer, HirTyLowererImpl } from "../../rustc_hir_analysis/lib.ts";
import type { InherentAssocCandidate, RegionInferReason } from "../../rustc_hir_analysis/hir_ty_lowering/mod.gen.ts";
import { HirTyCtxt_as_PpAnn, PpAnn, type Nested, type State } from "../../rustc_hir_pretty/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { HirIdMap } from "../../rustc_hir_id/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { RegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import { TyCtxt_as_HirTyCtxt } from "../../rustc_middle/hir/map.ts";
import { type DynCompatibilityViolation, ObligationCause, type ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, Region } from "../../rustc_middle/ty/decls.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDef, Generics } from "../../rustc_middle/ty/generics.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Predicate_upcast_from_Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { LocalDefId, LocalModId, DefId } from "../../rustc_span/def_id.ts";
import { LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { TypeErrCtxt } from "../../rustc_trait_selection/decls.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyTraitRef, TraitRef } from "../../rustc_type_ir/decls.ts";
import { fold_with_TraitRef, TraitClause, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { set_aliases_to_non_rigid } from "../../rustc_type_ir/fold.ts";
import { TypingMode, type CantBeErased } from "../../rustc_type_ir/infer_ctxt.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { Ok, type Result } from "../../std/result.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { FnCtxt, register_deref, TypeckRootCtxt } from "../decls.ts";
import { EnclosingBreakables } from "../lib.gen.ts";
import { Diverges } from "../diverges.gen.ts";
import { LoweredTy } from "./mod.gen.ts";

export * from "./mod.gen.ts";
export { FnCtxt } from "../decls.ts";

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:136 new
FnCtxt.new = function (root_ctxt: TypeckRootCtxt, param_env: ParamEnv, body_def_id: LocalDefId): FnCtxt {
  return new FnCtxt(
    body_def_id,
    param_env,
    /* ret_coercion */ undefined,
    /* ret_coercion_span */ undefined,
    /* coroutine_types */ undefined,
    /* diverges */ Diverges.Maybe,
    /* function_diverges_because_of_empty_arguments */ Diverges.Maybe,
    /* is_whole_body */ false,
    /* enclosing_breakables */ new EnclosingBreakables([], new HirIdMap()),
    root_ctxt,
    /* diverging_fallback_has_occurred */ false,
    /* trait_ascriptions */ new Map(),
    /* has_rustc_attrs */ root_ctxt.tcx.features().rustc_attrs(),
  );
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:161 typing_mode
FnCtxt.prototype.typing_mode = function (this: FnCtxt): TypingMode<CantBeErased> {
  // `FnCtxt` is never constructed in the trait solver, so we can safely use
  // `assert_not_erased`.
  return TypingMode.assert_not_erased(this.infcx.typing_mode_raw());
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:167 dcx
FnCtxt.prototype.dcx = function (this: FnCtxt): DiagCtxtHandle {
  return this.root_ctxt.infcx.dcx();
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:171 cause
FnCtxt.prototype.cause = function (this: FnCtxt, span: Span, code: ObligationCauseCode): ObligationCause {
  return ObligationCause.new(span, this.body_def_id, code);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:179 misc
FnCtxt.prototype.misc = function (this: FnCtxt, span: Span): ObligationCause {
  return this.cause(span, { $: "Misc" });
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:183 sess
FnCtxt.prototype.sess = function (this: FnCtxt): Session {
  return this.tcx.sess;
};

/// Creates an `TypeErrCtxt` with a reference to the in-progress
/// `TypeckResults` which is used for diagnostics.
/// Use [`InferCtxtErrorExt::err_ctxt`] to start one without a `TypeckResults`.
///
/// [`InferCtxtErrorExt::err_ctxt`]: rustc_trait_selection::error_reporting::InferCtxtErrorExt::err_ctxt
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:192 err_ctxt
FnCtxt.prototype.err_ctxt = function (this: FnCtxt): TypeErrCtxt {
  // PORT: `TypeErrCtxt` (rustc_trait_selection error_reporting) is pending (wave 19, errctxt-contract). Upstream builds
  // `TypeErrCtxt { infcx: &self.infcx, param_env: Some(self.param_env), typeck_results: Some(self.typeck_results.borrow()),
  // diverging_fallback_has_occurred, autoderef_steps: <closure over self.autoderef(DUMMY_SP, ty).silence_errors()>,
  // infer_closure_kind: <closure over self.infer_closure_kind_for_diagnostic(closure_def_id)> }`.
  return unported("rustc_trait_selection::error_reporting::TypeErrCtxt (FnCtxt::err_ctxt; errctxt-contract, wave 19)");
};

// impl<'a, 'tcx> Deref for FnCtxt<'a, 'tcx> { type Target = TypeckRootCtxt<'tcx>; }
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:215 deref
FnCtxt.prototype.deref = function (this: FnCtxt): TypeckRootCtxt {
  return this.root_ctxt;
};
// The forwarders of `Deref` (`self.root_ctxt`) are installed by ../lib.ts (decls.ts `register_deref`).
register_deref(FnCtxt, "root_ctxt", TypeckRootCtxt);

// impl<'tcx> rustc_hir_pretty::PpAnn for FnCtxt<'_, 'tcx>
// PORT: the impl is the class `FnCtxtPpAnn`; `FnCtxt_as_PpAnn(fcx)` is `fcx as &dyn PpAnn` (as rustc_hir_pretty's
// `HirTyCtxt_as_PpAnn`).
export class FnCtxtPpAnn extends PpAnn {
  constructor(public fcx: FnCtxt) {
    super();
  }

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:221 nested
  override nested(state: State, nested: Nested): void {
    HirTyCtxt_as_PpAnn(TyCtxt_as_HirTyCtxt(this.fcx.tcx)).nested(state, nested);
  }
}

/** `fcx as &dyn rustc_hir_pretty::PpAnn`. */
export function FnCtxt_as_PpAnn(fcx: FnCtxt): PpAnn {
  return new FnCtxtPpAnn(fcx);
}

// The provided method `HirTyLowerer::lowerer` (rustc_hir_analysis hir_ty_lowering/mod.rs:239) for `FnCtxt`: the trait
// object over this impl. Not a port of its own (the marker sits on `HirTyLowerer_provided.lowerer`).
FnCtxt.prototype.lowerer = function (this: FnCtxt): HirTyLowerer {
  return HirTyLowerer_provided.lowerer(this, HirTyLowerer_FnCtxt);
};

/** fn_ctxt/mod.rs:230 `impl<'tcx> HirTyLowerer<'tcx> for FnCtxt<'_, 'tcx>`: the vtable of `FnCtxt`'s trait objects. */
export const HirTyLowerer_FnCtxt: HirTyLowererImpl<FnCtxt> = {
  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:231 tcx
  tcx(this: FnCtxt): TyCtxt {
    return this.tcx;
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:235 dcx
  dcx(this: FnCtxt): DiagCtxtHandle {
    return this.root_ctxt.dcx();
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:239 item_def_id
  item_def_id(this: FnCtxt): LocalDefId {
    return this.body_def_id;
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:243 mod_id
  mod_id(this: FnCtxt): LocalModId {
    return this.mod_id;
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:247 re_infer
  re_infer(this: FnCtxt, span: Span, reason: RegionInferReason): Region {
    let v: RegionVariableOrigin;
    if (reason.$ === "Param") {
      const def = reason._0;
      v = { $: "RegionParameterDefinition", _0: span, _1: def.name };
    } else {
      v = { $: "Misc", _0: span };
    }
    return this.next_region_var(v);
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:257 ty_infer
  ty_infer(this: FnCtxt, param: GenericParamDef | undefined, span: Span): Ty {
    if (param !== undefined) {
      return unwrap(GenericArg.as_type(this.var_for_def(span, param)));
    } else {
      return this.next_ty_var(span);
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:264 ct_infer
  ct_infer(this: FnCtxt, param: GenericParamDef | undefined, span: Span): Const {
    // FIXME ideally this shouldn't use unwrap
    if (param !== undefined) {
      return unwrap(GenericArg.as_const(this.var_for_def(span, param)));
    } else {
      return this.next_const_var(span);
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:272 register_trait_ascription_bounds
  register_trait_ascription_bounds(this: FnCtxt, bounds: [Clause, Span][], hir_id: HirId, _span: Span): void {
    for (const [clause_, span] of bounds) {
      if (TypeVisitableExt.has_escaping_bound_vars(clause_, fold_Clause)) {
        this.dcx().span_delayed_bug(span, "clause should have no escaping bound vars");
        continue;
      }

      let ascriptions = this.trait_ascriptions.get(hir_id.local_id);
      if (ascriptions === undefined) {
        ascriptions = [];
        this.trait_ascriptions.set(hir_id.local_id, ascriptions);
      }
      ascriptions.push(clause_);

      const clause = this.normalize(span, Unnormalized.new_wip(clause_), fold_Clause);
      this.register_predicate(Obligation.new(this.tcx, this.misc(span), this.param_env, clause, (from: Clause, interner) => Predicate_upcast_from_Clause(from, interner as unknown as TyCtxt)));
    }
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:296 probe_ty_param_bounds
  probe_ty_param_bounds(this: FnCtxt, _: Span, def_id: LocalDefId, _2: Ident): EarlyBinder<readonly [Clause, Span][]> {
    const tcx = this.tcx;
    const item_def_id = tcx.hir_ty_param_owner(def_id);
    const generics = tcx.generics_of(item_def_id) as Generics;
    const index = unwrap(generics.param_def_id_to_index.get(LocalDefIdC.to_def_id(def_id)), "key not found");
    // HACK(eddyb) should get the original `Span`.
    const span = tcx.def_span(def_id);

    const out: [Clause, Span][] = [];
    for (const clause of this.param_env.caller_bounds()) {
      const kind = Binder.skip_binder(clause.kind());
      if (kind.$ === "Trait" && TraitClause.self_ty(kind._0).is_param(index)) {
        out.push([Unnormalized.skip_norm_wip(set_aliases_to_non_rigid(tcx, clause, fold_Clause)), span]);
      }
    }
    return EarlyBinder.bind_iter(out);
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:319 select_inherent_assoc_candidates
  select_inherent_assoc_candidates(this: FnCtxt, _span: Span, _self_ty: Ty, _candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], FulfillmentError[]] {
    // PORT: needs `traits::with_replaced_escaping_bound_vars` with a `TypeFoldable` descriptor of
    // `Vec<InherentAssocCandidate>` and `traits::predicates_for_generics` (neither available yet); reached only by
    // `#![feature(inherent_associated_types)]` code.
    return unported("rustc_hir_typeck::fn_ctxt::<FnCtxt as HirTyLowerer>::select_inherent_assoc_candidates (inherent assoc types)");
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:384 lower_assoc_item_path
  lower_assoc_item_path(this: FnCtxt, span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRef): Result<[DefId, GenericArgs], ErrorGuaranteed> {
    const trait_ref = this.instantiate_binder_with_fresh_vars(
      span,
      // FIXME(mgca): `item_def_id` can be an AssocConst; rename this variant.
      { $: "AssocTypeProjection", _0: item_def_id },
      poly_trait_ref,
      d_TraitRef_foldable,
    );

    const item_args = this.lowerer().lower_generic_args_of_assoc_item(span, item_def_id, item_segment, trait_ref.args);

    return Ok([item_def_id, item_args]);
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:408 probe_adt
  probe_adt(this: FnCtxt, span: Span, ty: Ty): AdtDef | undefined {
    const k = ty.kind();
    if (k.$ === "Adt") {
      return k._0;
    }
    // FIXME(#104767): Should we handle bound regions here?
    if (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Inherent" || k._1.kind.$ === "Free") && !TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
      return this.normalize(span, Unnormalized.new_wip(ty), fold_Ty).ty_adt_def();
    }
    return undefined;
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:425 record_ty
  record_ty(this: FnCtxt, hir_id: HirId, ty_: Ty, span: Span): void {
    // FIXME: normalization and escaping regions
    let ty: Ty;
    if (!TypeVisitableExt.has_escaping_bound_vars(ty_, fold_Ty)) {
      // NOTE: These obligations are 100% redundant and are implied by
      // WF obligations that are registered elsewhere, but they have a
      // better cause code assigned to them in `add_required_obligations_for_hir`.
      // This means that they should shadow obligations with worse spans.
      const k = ty_.kind();
      if (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Free")) {
        this.add_required_obligations_for_hir(span, k._1.kind.def_id, k._1.args, hir_id);
      }

      ty = this.normalize(span, Unnormalized.new_wip(ty_), fold_Ty);
    } else {
      ty = ty_;
    }
    this.write_ty(hir_id, ty);
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:447 infcx
  infcx(this: FnCtxt): InferCtxt | undefined {
    return this.infcx;
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:451 lower_fn_sig
  lower_fn_sig(this: FnCtxt, decl: hir.FnDecl, _generics: hir.Generics | undefined, _hir_id: HirId, _hir_ty: hir.Ty | undefined): [Ty[], Ty] {
    const input_tys = decl.inputs.map((a) => this.lowerer().lower_ty(a));

    let output_ty: Ty;
    switch (decl.output.$) {
      case "Return":
        output_ty = this.lowerer().lower_ty(decl.output._0);
        break;
      case "DefaultReturn":
        output_ty = HirTyLowerer_FnCtxt.tcx.call(this).types.unit;
        break;
    }
    return [input_tys, output_ty];
  },

  // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:467 dyn_compatibility_violations
  dyn_compatibility_violations(this: FnCtxt, trait_def_id: DefId): DynCompatibilityViolation[] {
    return [...this.tcx.dyn_compatibility_violations(trait_def_id)];
  },
};

/** PORT: the generated `TypeFoldable` impl fns of `TraitRef` as a D4 descriptor (as collect.ts). */
const d_TraitRef_foldable: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// impl<'tcx> LoweredTy<'tcx> {
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/mod.rs:487 from_raw
(LoweredTy as unknown as { from_raw: typeof LoweredTy.from_raw }).from_raw = function (fcx: FnCtxt, span: Span, raw: Ty): LoweredTy {
  const normalized = fcx.normalize(span, Unnormalized.new_wip(raw), fold_Ty);
  return new LoweredTy(raw, normalized);
};

