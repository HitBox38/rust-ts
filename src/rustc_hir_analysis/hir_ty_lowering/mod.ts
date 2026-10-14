// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs (STUB, lanes hir-ty-lowering-a (lines 1..2185) and
// hir-ty-lowering-b (lines 2186..3915): see docs/handoff/hirtylowerer-contract.md "How to fill a stub").
//
//! HIR ty lowering: Lowers type-system entities[^1] from the [HIR][hir] to
//! the [`rustc_middle::ty`] representation.
//!
//! Not to be confused with *AST lowering* which lowers AST constructs to HIR ones
//! or with *THIR* / *MIR* *lowering* / *building* which lowers HIR *bodies*
//! (i.e., “executable code”) to THIR / MIR.
//!
//! Most lowering routines are defined on [`dyn HirTyLowerer`](HirTyLowerer) directly,
//! like the main routine of this module, `lower_ty`.
//!
//! This module used to be called `astconv`.
//!
//! [^1]: This includes types, lifetimes / regions, constants in type positions,
//! trait references and bounds.
//
// mod.rs is ported by two lanes: hir-ty-lowering-a owns lines 1..2185 (the types, the trait, `impl dyn HirTyLowerer` up to
// `probe_generic_path_segments`), hir-ty-lowering-b owns lines 2186..3915 (`lower_resolved_ty_path` to the end). Each lane
// edits only its region and its own import block; contract.test.ts checks that the two `unported_methods` lists split the
// `impl dyn HirTyLowerer` methods at line 2186.
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment. Methods of the classes in decls.ts are assigned onto their prototypes here, in
// upstream order; until then the `unported_methods(..)` call installs an `unported(..)` placeholder for each.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
// ---- lane hir-ty-lowering-a imports ----
import { BoundConstness as hir_BoundConstness } from "../../rustc_ast/lib.ts";
import type { Diagnostic, DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { FatalError } from "../../rustc_errors/lib.ts";
import { debug_DefKind, DefKind, type Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type HirId, HirId_make_owner } from "../../rustc_hir_id/lib.ts";
import { AMBIGUOUS_ASSOCIATED_ITEMS } from "../../rustc_lint_defs/builtin.gen.ts";
import type { DynCompatibilityViolation } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems, type AssocTag } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { LateParamRegionKind } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_GenericParamDefKind, GenericParamDef, type Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type ImplTraitHeader, Ty, Visibility } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_Binder_ClauseKind } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { DefId_eq, DefIdMap, DefIdSet, debug_DefId, type DefId, LocalDefId, type LocalModId, type ModId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type Ident, kw, Symbol as Sym, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { BoundRegion, ClauseKind, EarlyBinder as EarlyBinderT, PolyTraitRef as PolyTraitRefT, TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { supertrait_def_ids, supertraits } from "../../rustc_type_ir/elaborate.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { BoundVar } from "../../rustc_type_ir/lib.ts";
import { as_interner, PolyTraitRef, TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm, type AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import type { AliasTerm as AliasTermT } from "../../rustc_type_ir/ty/alias.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import { AliasTy, debug_AliasTyKind } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { AnonConstKind, DebruijnIndex } from "../../rustc_type_ir/decls.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { GenericArgsLowerer, InferCtxt, ResolvedArg } from "../decls.ts";
import { AssocItemIsPrivate_diagnostic, ConstBoundForNonConstTrait_diagnostic } from "../diagnostics.ts";
import { type AmbiguityBetweenVariantAndAssocItem, GenericsArgsErrExtend, prohibit_assoc_item_constraint } from "./errors.ts";
import { check_generic_arg_count, lower_generic_args } from "./generics.ts";
import * as gen from "./mod.gen.ts";
import {
  type ForbidParamContext,
  type GenericArgCountMismatch,
  type GenericArgCountResult,
  GenericArgPosition,
  type GenericPathSegment,
  type InherentAssocCandidate,
  clone_InherentAssocCandidate,
  type OverlappingAsssocItemConstraints,
  type PermitVariants,
  type PredicateFilter,
  type RegionInferReason,
  type TypeRelativePath,
} from "./mod.gen.ts";
// ---- lane hir-ty-lowering-b imports ----
// (none yet)
// ---- shared ----
import { HirTyLowerer, type HirTyLowererImpl } from "../decls.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";

export * from "./mod.gen.ts";

// mod bounds;
import "./bounds.ts";
// mod cmse;
import "./cmse.ts";
// mod dyn_trait;
import "./dyn_trait.ts";
// pub mod errors;
export * as errors from "./errors.ts";
// pub mod generics;
export * as generics from "./generics.ts";

export { HirTyLowerer } from "../decls.ts";
export type { GenericArgsLowerer, HirTyLowererImpl } from "../decls.ts";

// ==== lane hir-ty-lowering-a: mod.rs:1..2185 ====

// PORT: `#[instrument(..)]` and `debug!(..)` (tracing) are not ported: rustc's tracing output is not part of the oracle.

// rustc-trait: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:138 HirTyLowerer
// PORT(decls): pending root. The trait is declared in ../decls.ts as `HirTyLowererImpl<S>` (root-owned, without markers). Its
// required methods are restated here with their markers; the signatures are identical to decls.ts's, so the merged
// interface is unchanged. Root may move the markers into decls.ts and drop this block.
declare module "../decls.ts" {
  interface HirTyLowererImpl<S> {
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:139 tcx
    tcx(this: S): TyCtxt;

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:141 dcx
    dcx(this: S): DiagCtxtHandle;

    /// Returns the [`LocalDefId`] of the overarching item whose constituents get lowered.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:144 item_def_id
    item_def_id(this: S): LocalDefId;

    /// Returns the containing module.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:147 mod_id
    mod_id(this: S): LocalModId;

    /// Returns the region to use when a lifetime is omitted (and not elided).
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:150 re_infer
    re_infer(this: S, span: Span, reason: RegionInferReason): Region;

    /// Returns the type to use when a type is omitted.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:153 ty_infer
    ty_infer(this: S, param: GenericParamDef | undefined, span: Span): Ty;

    /// Returns the const to use when a const is omitted.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:156 ct_infer
    ct_infer(this: S, param: GenericParamDef | undefined, span: Span): Const;

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:158 register_trait_ascription_bounds
    register_trait_ascription_bounds(this: S, bounds: [Clause, Span][], hir_id: HirId, span: Span): void;

    /// Probe bounds in scope where the bounded type coincides with the given type parameter.
    ///
    /// Rephrased, this returns bounds of the form `T: Trait`, where `T` is a type parameter
    /// with the given `def_id`. This is a subset of the full set of bounds.
    ///
    /// This method may use the given `assoc_name` to disregard bounds whose trait reference
    /// doesn't define an associated item with the provided name.
    ///
    /// This is used for one specific purpose: Resolving “short-hand” associated type references
    /// like `T::Item` where `T` is a type parameter. In principle, we would do that by first
    /// getting the full set of predicates in scope and then filtering down to find those that
    /// apply to `T`, but this can lead to cycle errors. The problem is that we have to do this
    /// resolution *in order to create the predicates in the first place*.
    /// Hence, we have this “special pass”.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:179 probe_ty_param_bounds
    probe_ty_param_bounds(this: S, span: Span, def_id: LocalDefId, assoc_ident: Ident): EarlyBinderT<readonly [Clause, Span][]>;

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:186 select_inherent_assoc_candidates
    select_inherent_assoc_candidates(this: S, span: Span, self_ty: Ty, candidates: InherentAssocCandidate[]): [InherentAssocCandidate[], import("../decls.ts").FulfillmentError[]];

    /// Lower a path to an associated item (of a trait) to a projection.
    ///
    /// This method has to be defined by the concrete lowering context because
    /// dealing with higher-ranked trait references depends on its capabilities:
    ///
    /// If the context can make use of type inference, it can simply instantiate
    /// any late-bound vars bound by the trait reference with inference variables.
    /// If it doesn't support type inference, there is nothing reasonable it can
    /// do except reject the associated type.
    ///
    /// The canonical example of this is associated type `T::P` where `T` is a type
    /// param constrained by `T: for<'a> Trait<'a>` and where `Trait` defines `P`.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:205 lower_assoc_item_path
    lower_assoc_item_path(this: S, span: Span, item_def_id: DefId, item_segment: hir.PathSegment, poly_trait_ref: PolyTraitRefT): Result<[DefId, GenericArgs], ErrorGuaranteed>;

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:213 lower_fn_sig
    lower_fn_sig(this: S, decl: hir.FnDecl, generics: hir.Generics | undefined, hir_id: HirId, hir_ty: hir.Ty | undefined): [Ty[], Ty];

    /// Returns `AdtDef` if `ty` is an ADT.
    ///
    /// Note that `ty` might be a alias type that needs normalization.
    /// This used to get the enum variants in scope of the type.
    /// For example, `Self::A` could refer to an associated type
    /// or to an enum variant depending on the result of this function.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:227 probe_adt
    probe_adt(this: S, span: Span, ty: Ty): AdtDef | undefined;

    /// Record the lowered type of a HIR node in this context.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:230 record_ty
    record_ty(this: S, hir_id: HirId, ty: Ty, span: Span): void;

    /// The inference context of the lowering context if applicable.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:233 infcx
    infcx(this: S): InferCtxt | undefined;

    // (provided) mod.rs:239 lowerer -> HirTyLowerer_provided.lowerer (below)

    /// Performs minimalistic dyn compat checks outside of bodies, but full within bodies.
    /// Outside of bodies we could end up in cycles, so we delay most checks to later phases.
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:248 dyn_compatibility_violations
    dyn_compatibility_violations(this: S, trait_def_id: DefId): DynCompatibilityViolation[];
  }

  // rustc-trait: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:375 GenericArgsLowerer
  // PORT(decls): pending root, as `HirTyLowererImpl` above (decls.ts `GenericArgsLowerer`, restated with markers).
  interface GenericArgsLowerer {
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:376 args_for_def_id
    args_for_def_id(def_id: DefId): [hir.GenericArgs | undefined, boolean];

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:378 provided_kind
    provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg;

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:385 inferred_kind
    inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg;
  }
}

/**
 * The provided methods of `trait HirTyLowerer` (mod.rs:138; PORTING §8). `lowerer` takes the implementor's vtable as well:
 * it builds the trait object (upstream's unsizing coercion `self` -> `&dyn HirTyLowerer`).
 */
export const HirTyLowerer_provided = {
  /// Convenience method for coercing the lowering context into a trait object type.
  ///
  /// Most lowering routines are defined on the trait object type directly
  /// necessitating a coercion step from the concrete lowering context.
  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:239 lowerer
  lowerer<S>(self_: S, impl_: HirTyLowererImpl<S>): HirTyLowerer {
    return new HirTyLowerer(self_, impl_ as HirTyLowererImpl<unknown>);
  },
};

/// The "qualified self" of an associated item path.
///
/// For diagnostic purposes only.
export type AssocItemQSelf = gen.AssocItemQSelf;
export const AssocItemQSelf = {
  ...gen.AssocItemQSelf,

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:261 to_string
  to_string(self: AssocItemQSelf, tcx: TyCtxt): string {
    switch (self.$) {
      case "Trait":
        return tcx.def_path_str(self._0);
      case "TyParam":
        return Sym.as_str(tcx.hir_ty_param_name(self._0));
      case "SelfTyAlias":
        return Sym.as_str(kw.SelfUpper);
    }
  },
};

export type LowerTypeRelativePathMode = gen.LowerTypeRelativePathMode;
export const LowerTypeRelativePathMode = {
  ...gen.LowerTypeRelativePathMode,

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:277 assoc_tag
  assoc_tag(self: LowerTypeRelativePathMode): AssocTag {
    switch (self.$) {
      case "Type":
        return "Type";
      case "Const":
        return "Const";
    }
  },

  ///NOTE: use `assoc_tag` for any important logic
  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:285 def_kind_for_diagnostics
  def_kind_for_diagnostics(self: LowerTypeRelativePathMode): DefKind {
    switch (self.$) {
      case "Type":
        return DefKind.AssocTy;
      case "Const":
        return DefKind.AssocConst;
    }
  },

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:292 permit_variants
  permit_variants(self: LowerTypeRelativePathMode): PermitVariants {
    switch (self.$) {
      case "Type":
        return self._0;
      // FIXME(mgca): Support paths like `Option::<T>::None` or `Option::<T>::Some` which
      // resolve to const ctors/fn items respectively.
      case "Const":
        return "No";
    }
  },
};

// rustc-type: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:401 ForbidParamUsesFolder
// PORT: hand-written (types.sets.json `hand`); the `impl TypeFolder` methods (:461..:479) are on the class.
export class ForbidParamUsesFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public anon_const_def_id: LocalDefId,
    public span: Span,
    public is_self_alias: boolean,
    public context: ForbidParamContext,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:410 error
  error(): ErrorGuaranteed {
    let msg: string;
    if (this.context === "EnumDiscriminant" && this.is_self_alias) {
      msg = "generic `Self` types are not permitted in enum discriminant values";
    } else if (this.context === "EnumDiscriminant") {
      msg = "generic parameters may not be used in enum discriminant values";
    } else if (this.context === "ConstArgument" && this.is_self_alias) {
      msg = "generic `Self` types are currently not permitted in anonymous constants";
    } else {
      if (this.tcx.features().gca_const_items()) {
        msg = "generic parameters in const blocks are not allowed; use a named `const` item instead";
      } else {
        msg = "generic parameters may not be used in const operations";
      }
    }
    const diag = this.tcx.dcx().struct_span_err(this.span, msg);
    if (this.is_self_alias && this.context === "ConstArgument") {
      const anon_const_hir_id: HirId = HirId_make_owner(this.anon_const_def_id);
      let parent_impl: hir.Impl | undefined = undefined;
      for (const [_, node] of this.tcx.hir_parent_owner_iter(anon_const_hir_id)) {
        if (node.$ === "Item" && node._0.kind.$ === "Impl") {
          parent_impl = node._0.kind._0;
          break;
        }
      }
      if (parent_impl !== undefined) {
        const impl_ = parent_impl;
        diag.span_note(impl_.self_ty.span, "not a concrete type");
      }
    }
    if (this.context === "ConstArgument") {
      if (this.tcx.features().gca_const_items()) {
        diag.help("consider factoring the expression into a `type const` item and use it as the const argument instead");
      } else if (this.tcx.features().gca_min_const_items()) {
        diag.help("add `#![feature(gca_const_items)]` and extract the expression into a `type const` item");
      } else if (this.tcx.sess.is_nightly_build()) {
        diag.help("add `#![feature(generic_const_exprs)]` to allow generic const expressions");
        diag.help("alternatively, you can use `#![feature(gca_const_items)]` and extract the expression into a `type const` item");
      }
    }
    return diag.emit_err();
  }

  // impl<'tcx> ty::TypeFolder<TyCtxt<'tcx>> for ForbidParamUsesFolder<'tcx>
  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:461 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:465 fold_ty
  fold_ty(t: Ty): Ty {
    if (t.kind().$ === "Param") {
      return Ty.new_error(this.tcx, this.error());
    }
    return fold_Ty.super_fold_with(t, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:472 fold_const
  fold_const(c: Const): Const {
    if (c.kind().$ === "Param") {
      return Const.new_error(this.tcx, this.error());
    }
    return fold_Const.super_fold_with(c, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:479 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReEarlyParam" || k.$ === "ReLateParam") {
      return Region.new_error(this.tcx, this.error());
    }
    return r;
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/**
 * PORT(decls): pending root. `rbv::ResolvedArg` (rustc_middle middle/resolve_bound_vars.rs:13) is still `Pending` in
 * ../decls.ts (and a `PendingEnum` in rustc_middle ty/context.ts); this is its PORTING §5 shape (the generated type will
 * have it), used to match on it in `lower_resolved_lifetime`.
 */
type ResolvedArgShape =
  | { readonly $: "StaticLifetime" }
  | { readonly $: "EarlyBound"; _0: LocalDefId }
  | { readonly $: "LateBound"; _0: DebruijnIndex; _1: number; _2: LocalDefId }
  | { readonly $: "Free"; _0: LocalDefId; _1: LocalDefId }
  | { readonly $: "Error"; _0: ErrorGuaranteed };

// impl<'tcx> dyn HirTyLowerer<'tcx> + '_

/// See `check_param_uses_if_mcg`.
///
/// FIXME(mgca): this is pub only for instantiate_value_path and would be nice to avoid altogether
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:491 check_param_res_if_mcg_for_instantiate_value_path
HirTyLowerer.prototype.check_param_res_if_mcg_for_instantiate_value_path = function (
  this: HirTyLowerer,
  res: Res,
  span: Span,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();
  const parent_def_id = this.item_def_id();
  // In this path, `Some(context)` should be `ConstArgument`: enum
  // discriminants are handled earlier by resolve. We still use the helper so
  // nested inline consts are checked in the outer const-argument context.
  if (res.$ === "Def" && res._0.$ === "ConstParam") {
    const context = this.anon_const_forbids_generic_params();
    if (context !== undefined) {
      const folder = new ForbidParamUsesFolder(tcx, parent_def_id, span, false, context);
      return Err(folder.error());
    }
  }
  return Ok(undefined);
};

/// Returns the `ForbidParamContext` for the current anon const if it is a context that
/// forbids uses of generic parameters. `None` if the current item is not such a context.
///
/// Name resolution handles most invalid generic parameter uses in these contexts, but it
/// cannot reject `Self` that aliases a generic type, nor generic parameters introduced by
/// type-dependent name resolution (e.g. `<Self as Trait>::Assoc` resolving to a type that
/// contains params). Those cases are handled by `check_param_uses_if_mcg`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:523 anon_const_forbids_generic_params
HirTyLowerer.prototype.anon_const_forbids_generic_params = function (this: HirTyLowerer): ForbidParamContext | undefined {
  const tcx = this.tcx();
  const item_def_id = this.item_def_id();

  // Inline consts and closures can be nested inside anon consts that forbid generic
  // params (e.g. an enum discriminant). Walk up the def parent chain to find the
  // nearest enclosing AnonConst and use that to determine the context.
  const anon_const_def_id = tcx.typeck_root_def_id_local(item_def_id);

  if (tcx.def_kind(anon_const_def_id).$ !== "AnonConst") {
    return undefined;
  }

  switch (tcx.anon_const_kind(anon_const_def_id) as AnonConstKind) {
    case "MCG":
      return "ConstArgument";
    case "NonTypeSystemAnon":
      // NonTypeSystem anon consts only have accessible generic parameters in specific
      // positions (ty patterns and field defaults — see `generics_of`). In all other
      // positions (e.g. enum discriminants) generic parameters are not in scope.
      if ((tcx.generics_of(anon_const_def_id) as Generics).count() === 0) {
        return "EnumDiscriminant";
      } else {
        return undefined;
      }
    case "NonTypeSystemInline":
    case "GCE":
    case "RepeatExprCount":
      return undefined;
  }
};

/// Check for uses of generic parameters that are not in scope due to this being
/// in a non-generic anon const context (e.g. MCG or an enum discriminant).
///
/// Name resolution rejects most invalid uses, but cannot handle `Self` aliasing a
/// generic type or generic parameters introduced by type-dependent name resolution.
// #[must_use = "need to use transformed output"]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:560 check_param_uses_if_mcg
HirTyLowerer.prototype.check_param_uses_if_mcg = function <T>(
  this: HirTyLowerer,
  term: T,
  span: Span,
  is_self_alias: boolean,
  d_T: TypeFoldable<T>,
): T {
  const tcx = this.tcx();
  const context = this.anon_const_forbids_generic_params();
  if (
    context !== undefined &&
    // Fast path if contains no params/escaping bound vars.
    (TypeVisitableExt.has_param(term, d_T) || TypeVisitableExt.has_escaping_bound_vars(term, d_T))
  ) {
    const anon_const_def_id = this.item_def_id();
    const folder = new ForbidParamUsesFolder(tcx, anon_const_def_id, span, is_self_alias, context);
    return d_T.fold_with(term, folder);
  } else {
    return term;
  }
};

/// Lower a lifetime from the HIR to our internal notion of a lifetime called a *region*.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:580 lower_lifetime
HirTyLowerer.prototype.lower_lifetime = function (this: HirTyLowerer, lifetime: hir.Lifetime, reason: RegionInferReason): Region {
  const resolved = this.tcx().named_bound_var(lifetime.hir_id);
  if (resolved !== undefined) {
    // PORT: rustc_middle's `PendingEnum` `ResolvedArg` and decls.ts's `Pending` one are the same upstream type.
    const region = this.lower_resolved_lifetime(resolved as unknown as ResolvedArg);
    return this.check_param_uses_if_mcg(region, lifetime.ident.span, false, fold_Region);
  } else {
    return this.re_infer(lifetime.ident.span, reason);
  }
};

/// Lower a lifetime from the HIR to our internal notion of a lifetime called a *region*.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:595 lower_resolved_lifetime
HirTyLowerer.prototype.lower_resolved_lifetime = function (this: HirTyLowerer, resolved_: ResolvedArg): Region {
  const tcx = this.tcx();

  // PORT: see `ResolvedArgShape`.
  const resolved = resolved_ as unknown as ResolvedArgShape;
  switch (resolved.$) {
    case "StaticLifetime":
      return tcx.lifetimes.re_static;

    case "LateBound": {
      const debruijn = resolved._0;
      const index = resolved._1;
      const def_id = resolved._2;
      const br: BoundRegion = {
        var: BoundVar.from_u32(index),
        kind: { $: "Named", _0: LocalDefId.to_def_id(def_id) },
      };
      return Region.new_bound(tcx, debruijn, br);
    }

    case "EarlyBound": {
      const def_id = resolved._0;
      const name = tcx.hir_ty_param_name(def_id);
      const item_def_id = tcx.hir_ty_param_owner(def_id);
      const generics = tcx.generics_of(item_def_id) as Generics;
      // PORT: `HashMap`'s `Index` panics with "key not found".
      const index = unwrap(generics.param_def_id_to_index.get(LocalDefId.to_def_id(def_id)), "key not found");
      return Region.new_early_param(tcx, { index, name });
    }

    case "Free": {
      const scope = resolved._0;
      const id = resolved._1;
      // PORT: `LateParamRegionKind` is still pending in rustc_middle ty/decls.ts (as in context.ts).
      return Region.new_late_param(tcx, LocalDefId.to_def_id(scope), { $: "Named", _0: LocalDefId.to_def_id(id) } as unknown as LateParamRegionKind);

      // (*) -- not late-bound, won't change
    }

    case "Error":
      return Region.new_error(tcx, resolved._0);
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:631 lower_generic_args_of_path_segment
HirTyLowerer.prototype.lower_generic_args_of_path_segment = function (
  this: HirTyLowerer,
  span: Span,
  def_id: DefId,
  item_segment: hir.PathSegment,
): GenericArgs {
  const [args, _] = this.lower_generic_args_of_path(span, def_id, [], item_segment, undefined);
  const c = item_segment.args_().constraints[0];
  if (c !== undefined) {
    prohibit_assoc_item_constraint(this, c, [def_id, item_segment, span]);
  }
  return args;
};

/// Lower the generic arguments provided to some path.
///
/// If this is a trait reference, you also need to pass the self type `self_ty`.
/// The lowering process may involve applying defaulted type parameters.
///
/// Associated item constraints are not handled here! They are either lowered via
/// `lower_assoc_item_constraint` or rejected via `prohibit_assoc_item_constraint`.
///
/// ### Example
///
/// ```ignore (illustrative)
///    T: std::ops::Index<usize, Output = u32>
/// // ^1 ^^^^^^^^^^^^^^2 ^^^^3  ^^^^^^^^^^^4
/// ```
///
/// 1. The `self_ty` here would refer to the type `T`.
/// 2. The path in question is the path to the trait `std::ops::Index`,
///    which will have been resolved to a `def_id`
/// 3. The `generic_args` contains info on the `<...>` contents. The `usize` type
///    parameters are returned in the `GenericArgsRef`
/// 4. Associated item constraints like `Output = u32` are contained in `generic_args.constraints`.
///
/// Note that the type listing given here is *exactly* what the user provided.
///
/// For (generic) associated types
///
/// ```ignore (illustrative)
/// <Vec<u8> as Iterable<u8>>::Iter::<'a>
/// ```
///
/// We have the parent args are the args for the parent trait:
/// `[Vec<u8>, u8]` and `generic_args` are the arguments for the associated
/// type itself: `['a]`. The returned `GenericArgsRef` concatenates these two
/// lists: `[Vec<u8>, u8, 'a]`.
// #[instrument(level = "debug", skip(self, span), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:679 lower_generic_args_of_path
HirTyLowerer.prototype.lower_generic_args_of_path = function (
  this: HirTyLowerer,
  span: Span,
  def_id: DefId,
  parent_args: readonly GenericArg[],
  segment: hir.PathSegment,
  self_ty: Ty | undefined,
): [GenericArgs, GenericArgCountResult] {
  // If the type is parameterized by this region, then replace this
  // region with the current anon region binding (in other words,
  // whatever & would get replaced with).

  const tcx = this.tcx();
  const generics = tcx.generics_of(def_id) as Generics;
  // debug!(?generics);

  if (generics.has_self) {
    if (generics.parent !== undefined) {
      // The parent is a trait so it should have at least one
      // generic parameter for the `Self` type.
      assert(!(parent_args.length === 0), "assertion failed: !parent_args.is_empty()");
    } else {
      // This item (presumably a trait) needs a self-type.
      assert(self_ty !== undefined, "assertion failed: self_ty.is_some()");
    }
  } else {
    assert(self_ty === undefined, "assertion failed: self_ty.is_none()");
  }

  const arg_count = check_generic_arg_count(this, def_id, segment, generics, GenericArgPosition.Type, self_ty !== undefined);

  // Skip processing if type has no generic parameters.
  // Traits always have `Self` as a generic parameter, which means they will not return early
  // here and so associated item constraints will be handled regardless of whether there are
  // any non-`Self` generic parameters.
  if (generics.is_own_empty()) {
    return [tcx.mk_args(parent_args), arg_count];
  }

  // rustc-type: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:725 GenericArgsCtxt
  class GenericArgsCtxt implements GenericArgsLowerer {
    constructor(
      public lowerer: HirTyLowerer,
      public def_id: DefId,
      public generic_args: hir.GenericArgs,
      public span: Span,
      public infer_args: boolean,
      public create_synth_args: boolean,
      public incorrect_args: Result<null, GenericArgCountMismatch>,
    ) {}

    // impl<'a, 'tcx> GenericArgsLowerer<'a, 'tcx> for GenericArgsCtxt<'a, 'tcx>
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:736 args_for_def_id
    args_for_def_id(did: DefId): [hir.GenericArgs | undefined, boolean] {
      if (DefId_eq(did, this.def_id)) {
        return [this.generic_args, this.infer_args];
      } else {
        // The last component of this tuple is unimportant.
        return [undefined, false];
      }
    }

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:745 provided_kind
    provided_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, arg: hir.GenericArg): GenericArg {
      const tcx = this.lowerer.tcx();

      if (this.incorrect_args.$ === "Err") {
        const incorrect = this.incorrect_args._0;
        if (incorrect.invalid_args.includes(param.index)) {
          return GenericParamDef.to_error(param, tcx);
        }
      }

      const handle_ty_args = (has_default: boolean, ty: hir.Ty): GenericArg => {
        if (has_default) {
          tcx.check_optional_stability(param.def_id, hir.GenericArg.hir_id(arg), hir.GenericArg.span(arg), undefined, "No", (_1, _2) => {
            // Default generic parameters may not be marked
            // with stability attributes, i.e. when the
            // default parameter was defined at the same time
            // as the rest of the type. As such, we ignore missing
            // stability attributes.
          });
        }
        return GenericArg.from_Ty(this.lowerer.lower_ty(ty));
      };

      const kind = param.kind;
      if (kind.$ === "Lifetime" && arg.$ === "Lifetime") {
        return GenericArg.from_Region(this.lowerer.lower_lifetime(arg._0, { $: "Param", _0: param }));
      } else if (kind.$ === "Type" && arg.$ === "Type") {
        // We handle the other parts of `Ty` in the match arm below
        return handle_ty_args(kind.has_default, arg._0.as_unambig_ty());
      } else if (kind.$ === "Type" && arg.$ === "Infer") {
        return handle_ty_args(kind.has_default, arg._0.to_ty());
      } else if (kind.$ === "Const" && arg.$ === "Const") {
        return GenericArg.from_Const(
          this.lowerer
            // Ambig portions of `ConstArg` are handled in the match arm below
            .lower_const_arg(
              arg._0.as_unambig_ct(),
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(param.def_id) as EarlyBinderT<Ty>, tcx, preceding_args, fold_Ty)),
            ),
        );
      } else if (kind.$ === "Const" && arg.$ === "Infer") {
        return GenericArg.from_Const(this.lowerer.ct_infer(param, arg._0.span));
      } else {
        return span_bug(
          this.span,
          `mismatched path argument for kind ${debug_GenericParamDefKind(kind, PLAIN)}: found arg ${hir.debug_GenericArg(arg, PLAIN)}`,
        );
      }
    }

    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:810 inferred_kind
    inferred_kind(preceding_args: readonly GenericArg[], param: GenericParamDef, infer_args: boolean): GenericArg {
      const tcx = this.lowerer.tcx();

      if (this.incorrect_args.$ === "Err") {
        const incorrect = this.incorrect_args._0;
        if (incorrect.invalid_args.includes(param.index)) {
          return GenericParamDef.to_error(param, tcx);
        }
      }
      const kind = param.kind;
      switch (kind.$) {
        case "Lifetime":
          return GenericArg.from_Region(this.lowerer.re_infer(this.span, { $: "Param", _0: param }));
        case "Type": {
          const has_default = kind.has_default;
          const synthetic = kind.synthetic;
          if (!infer_args && has_default) {
            // No type parameter provided, but a default exists.
            let prev: ErrorGuaranteed | undefined = undefined;
            for (const arg of preceding_args) {
              const k = GenericArg.kind(arg);
              const found = k.$ === "Type" ? TypeVisitableExt.error_reported(k._0, fold_Ty) : undefined;
              if (found !== undefined && found.$ === "Err") {
                prev = found._0;
                break;
              }
            }
            if (prev !== undefined) {
              // Avoid ICE #86756 when type error recovery goes awry.
              return GenericArg.from_Ty(Ty.new_error(tcx, prev));
            }
            return GenericArg.from_Ty(
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.at(this.span).type_of(param.def_id) as EarlyBinderT<Ty>, tcx, preceding_args, fold_Ty)),
            );
          } else if (this.create_synth_args && synthetic) {
            return GenericArg.from_Ty(Ty.new_param(tcx, param.index, param.name));
          } else if (infer_args) {
            return GenericArg.from_Ty(this.lowerer.ty_infer(param, this.span));
          } else {
            // We've already errored above about the mismatch.
            return GenericArg.from_Ty(Ty.new_misc_error(tcx));
          }
        }
        case "Const": {
          const has_default = kind.has_default;
          const ty = Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(tcx.at(this.span).type_of(param.def_id) as EarlyBinderT<Ty>, tcx, preceding_args, fold_Ty),
          );
          const reported = TypeVisitableExt.error_reported(ty, fold_Ty);
          if (reported.$ === "Err") {
            return GenericArg.from_Const(Const.new_error(tcx, reported._0));
          }
          if (!infer_args && has_default) {
            return GenericArg.from_Const(
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.const_param_default(param.def_id) as EarlyBinderT<Const>, tcx, preceding_args, fold_Const)),
            );
          } else if (infer_args) {
            return GenericArg.from_Const(this.lowerer.ct_infer(param, this.span));
          } else {
            // We've already errored above about the mismatch.
            return GenericArg.from_Const(Const.new_misc_error(tcx));
          }
        }
      }
    }
  }

  const args_ctx = new GenericArgsCtxt(
    this,
    def_id,
    segment.args_(),
    span,
    segment.infer_args,
    segment.delegation_child_segment,
    arg_count.correct,
  );

  const args = lower_generic_args(this, def_id, parent_args, self_ty !== undefined, self_ty, arg_count, args_ctx);

  return [args, arg_count];
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:902 lower_generic_args_of_assoc_item
HirTyLowerer.prototype.lower_generic_args_of_assoc_item = function (
  this: HirTyLowerer,
  span: Span,
  item_def_id: DefId,
  item_segment: hir.PathSegment,
  parent_args: GenericArgs,
): GenericArgs {
  const [args, _] = this.lower_generic_args_of_path(span, item_def_id, parent_args, item_segment, undefined);
  const c = item_segment.args_().constraints[0];
  if (c !== undefined) {
    prohibit_assoc_item_constraint(this, c, [item_def_id, item_segment, span]);
  }
  return args;
};

/// Lower a trait reference as found in an impl header as the implementee.
///
/// The self type `self_ty` is the implementer of the trait.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:920 lower_impl_trait_ref
HirTyLowerer.prototype.lower_impl_trait_ref = function (this: HirTyLowerer, trait_ref: hir.TraitRef, self_ty: Ty): TraitRefT {
  const segments = trait_ref.path.segments;
  if (segments.length === 0) {
    return bug();
  }
  const leading_segments = segments.slice(0, segments.length - 1);
  const segment = segments[segments.length - 1]!;

  void this.prohibit_generic_args(leading_segments, GenericsArgsErrExtend.None);

  const trait_def_id = trait_ref.trait_def_id();
  return this.lower_mono_trait_ref(
    trait_ref.path.span,
    trait_def_id !== undefined ? trait_def_id : new FatalError().raise(),
    self_ty,
    segment,
    true,
  );
};

/// Lower a polymorphic trait reference given a self type into `bounds`.
///
/// *Polymorphic* in the sense that it may bind late-bound vars.
///
/// This may generate auxiliary bounds iff the trait reference contains associated item constraints.
///
/// ### Example
///
/// Given the trait ref `Iterator<Item = u32>` and the self type `Ty`, this will add the
///
/// 1. *trait predicate* `<Ty as Iterator>` (known as `Ty: Iterator` in the surface syntax) and the
/// 2. *projection predicate* `<Ty as Iterator>::Item = u32`
///
/// to `bounds`.
///
/// ### A Note on Binders
///
/// Against our usual convention, there is an implied binder around the `self_ty` and the
/// `trait_ref` here. So they may reference late-bound vars.
///
/// If for example you had `for<'a> Foo<'a>: Bar<'a>`, then the `self_ty` would be `Foo<'a>`
/// where `'a` is a bound region at depth 0. Similarly, the `trait_ref` would be `Bar<'a>`.
/// The lowered poly-trait-ref will track this binder explicitly, however.
// #[instrument(level = "debug", skip(self, bounds))]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:962 lower_poly_trait_ref
HirTyLowerer.prototype.lower_poly_trait_ref = function (
  this: HirTyLowerer,
  _0: hir.PolyTraitRef,
  self_ty: Ty,
  bounds: [Clause, Span][],
  predicate_filter: PredicateFilter,
  overlapping_assoc_item_constraints: OverlappingAsssocItemConstraints,
): GenericArgCountResult {
  // PORT: the destructuring parameter `&hir::PolyTraitRef { bound_generic_params, modifiers: { constness, polarity },
  // trait_ref, span }`. `polarity` is shadowed below by the `ty::ClausePolarity`; the HIR one is `hir_polarity`.
  const bound_generic_params = _0.bound_generic_params;
  const constness = _0.modifiers.constness;
  const hir_polarity = _0.modifiers.polarity;
  const trait_ref = _0.trait_ref;
  const span = _0.span;

  const tcx = this.tcx();

  // We use the *resolved* bound vars later instead of the HIR ones since the former
  // also include the bound vars of the overarching predicate if applicable.
  void bound_generic_params;

  const trait_def_id_opt = trait_ref.trait_def_id();
  const trait_def_id = trait_def_id_opt !== undefined ? trait_def_id_opt : new FatalError().raise();

  // Relaxed bounds `?Trait` and `PointeeSized` bounds aren't represented in the middle::ty IR
  // as they denote the *absence* of a default bound. However, we can't bail out early here since
  // we still need to perform several validation steps (see below). Instead, simply "pour" all
  // resulting bounds "down the drain", i.e., into a new `Vec` that just gets dropped at the end.
  let transient: boolean;
  switch (hir_polarity.$) {
    case "Positive":
      // To elaborate on the comment directly above, regarding `PointeeSized` specifically,
      // we don't "reify" such bounds to avoid trait system limitations -- namely,
      // non-global where-clauses being preferred over item bounds (where `PointeeSized`
      // bounds would be proven) -- which can result in errors when a `PointeeSized`
      // supertrait / bound / predicate is added to some items.
      transient = tcx.is_lang_item(trait_def_id, "PointeeSized");
      break;
    case "Negative":
      transient = false;
      break;
    case "Maybe":
      this.require_bound_to_relax_default_trait(trait_ref, span);
      transient = true;
      break;
  }
  bounds = transient ? [] : bounds;

  let polarity: "Positive" | "Negative";
  switch (hir_polarity.$) {
    case "Positive":
    case "Maybe":
      polarity = "Positive";
      break;
    case "Negative":
      polarity = "Negative";
      break;
  }

  const segments = trait_ref.path.segments;
  if (segments.length === 0) {
    return bug();
  }
  const leading_segments = segments.slice(0, segments.length - 1);
  const segment = segments[segments.length - 1]!;

  void this.prohibit_generic_args(leading_segments, GenericsArgsErrExtend.None);
  this.report_internal_fn_trait(span, trait_def_id, segment, false);

  const [generic_args, arg_count] = this.lower_generic_args_of_path(trait_ref.path.span, trait_def_id, [], segment, self_ty);

  const constraints = segment.args_().constraints;

  if (transient && (!(generic_args.slice(1).length === 0) || !(constraints.length === 0))) {
    // Since the bound won't be present in the middle::ty IR as established above, any
    // arguments or constraints won't be checked for well-formedness in later passes.
    //
    // This is only an issue if the trait ref is otherwise valid which can only happen if
    // the corresponding default trait has generic parameters or associated items. Such a
    // trait would be degenerate. We delay a bug to detect and guard us against these.
    //
    // E.g: Given `/*default*/ trait Bound<'a: 'static, T, const N: usize> {}`,
    // `?Bound<Vec<str>, { panic!() }>` won't be wfchecked.
    this.dcx().span_delayed_bug(span, "transient bound should not have args or constraints");
  }

  const bound_vars = tcx.late_bound_vars(trait_ref.hir_ref_id);
  // debug!(?bound_vars);

  const poly_trait_ref: PolyTraitRefT = Binder.bind_with_vars(TraitRef.new_from_args(as_interner(tcx), trait_def_id, generic_args), bound_vars);

  // debug!(?poly_trait_ref);

  // We deal with const conditions later.
  switch (predicate_filter.$) {
    case "All":
    case "SelfOnly":
    case "SelfTraitThatDefines":
    case "SelfAndAssociatedTypeBounds": {
      const bound_ = Binder.map_bound(poly_trait_ref, (trait_ref): ClauseKind => ({ $: "Trait", _0: { trait_ref, polarity } }));
      const bound: [Clause, Span] = [Clause_upcast_from_Binder_ClauseKind(bound_, tcx), span];
      // FIXME(-Znext-solver): We can likely remove this hack once the
      // new trait solver lands. This fixed an overflow in the old solver.
      // This may have performance implications, so please check perf when
      // removing it.
      // This was added in <https://github.com/rust-lang/rust/pull/123302>.
      if (tcx.is_lang_item(trait_def_id, "Sized")) {
        bounds.splice(0, 0, bound);
      } else {
        bounds.push(bound);
      }
      break;
    }
    case "ConstIfConst":
    case "SelfConstIfConst":
      break;
  }

  if ((constness.$ === "Always" || constness.$ === "Maybe") && !tcx.is_const_trait(trait_def_id)) {
    // PORT: this `span` is the binding of the `if let` pattern (it shadows the bound's `span`).
    const span = constness._0;
    let def_span: Span | undefined;
    let suggestion: Span | undefined;
    let suggestion_pre: string;
    const trait_def_id_local = trait_def_id.as_local();
    const is_nightly_build = tcx.sess.is_nightly_build();
    if (trait_def_id_local !== undefined && is_nightly_build === true) {
      let span = tcx.hir_expect_item(trait_def_id_local).vis_span;
      span = tcx.sess.source_map().span_extend_while_whitespace(span);

      def_span = undefined;
      suggestion = Span.shrink_to_hi(span);
      suggestion_pre = this.tcx().features().const_trait_impl() ? "" : "enable `#![feature(const_trait_impl)]` in your crate and ";
    } else {
      def_span = tcx.def_span(trait_def_id);
      suggestion = undefined;
      suggestion_pre = "";
    }
    this.dcx().emit_err(
      ConstBoundForNonConstTrait_diagnostic({
        span,
        modifier: hir_BoundConstness.as_str(constness),
        def_span,
        trait_name: tcx.def_path_str(trait_def_id),
        suggestion,
        suggestion_pre,
      }),
    );
  } else {
    switch (predicate_filter.$) {
      // This is only concerned with trait predicates.
      case "SelfTraitThatDefines":
        break;
      case "All":
      case "SelfOnly":
      case "SelfAndAssociatedTypeBounds": {
        switch (constness.$) {
          case "Always":
            if (polarity === "Positive") {
              bounds.push([PolyTraitRef.to_host_effect_clause(poly_trait_ref, tcx, "Const"), span]);
            }
            break;
          case "Maybe":
            // We don't emit a const bound here, since that would mean that we
            // unconditionally need to prove a `HostEffect` predicate, even when
            // the predicates are being instantiated in a non-const context. This
            // is instead handled in the `const_conditions` query.
            break;
          case "Never":
            break;
        }
        break;
      }
      // On the flip side, when filtering `ConstIfConst` bounds, we only need to convert
      // `[const]` bounds. All other predicates are handled in their respective queries.
      //
      // Note that like `PredicateFilter::SelfOnly`, we don't need to do any filtering
      // here because we only call this on self bounds, and deal with the recursive case
      // in `lower_assoc_item_constraint`.
      case "ConstIfConst":
      case "SelfConstIfConst": {
        switch (constness.$) {
          case "Maybe":
            if (polarity === "Positive") {
              bounds.push([PolyTraitRef.to_host_effect_clause(poly_trait_ref, tcx, "Maybe"), span]);
            }
            break;
          case "Always":
          case "Never":
            break;
        }
        break;
      }
    }
  }

  const dup_constraints: DefIdMap<Span> | undefined =
    overlapping_assoc_item_constraints === "Forbidden" ? new DefIdMap<Span>() : undefined;

  for (const constraint of constraints) {
    // Don't register any associated item constraints for negative bounds,
    // since we should have emitted an error for them earlier, and they
    // would not be well-formed!
    if (polarity === "Negative") {
      this.dcx().span_delayed_bug(constraint.span, "negative trait bounds should not have assoc item constraints");
      break;
    }

    // Specify type to assert that error was already reported in `Err` case.
    const _r: Result<undefined, ErrorGuaranteed> = this.lower_assoc_item_constraint(
      trait_ref.hir_ref_id,
      poly_trait_ref,
      constraint,
      bounds,
      dup_constraints,
      constraint.span,
      predicate_filter,
    );
    // Okay to ignore `Err` because of `ErrorGuaranteed` (see above).
  }

  return arg_count;
};

/// Lower a monomorphic trait reference given a self type while prohibiting associated item bindings.
///
/// *Monomorphic* in the sense that it doesn't bind any late-bound vars.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1187 lower_mono_trait_ref
HirTyLowerer.prototype.lower_mono_trait_ref = function (
  this: HirTyLowerer,
  span: Span,
  trait_def_id: DefId,
  self_ty: Ty,
  trait_segment: hir.PathSegment,
  is_impl: boolean,
): TraitRefT {
  this.report_internal_fn_trait(span, trait_def_id, trait_segment, is_impl);

  const [generic_args, _] = this.lower_generic_args_of_path(span, trait_def_id, [], trait_segment, self_ty);
  const c = trait_segment.args_().constraints[0];
  if (c !== undefined) {
    prohibit_assoc_item_constraint(this, c, [trait_def_id, trait_segment, span]);
  }
  return TraitRef.new_from_args(as_interner(this.tcx()), trait_def_id, generic_args);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1205 probe_trait_that_defines_assoc_item
HirTyLowerer.prototype.probe_trait_that_defines_assoc_item = function (
  this: HirTyLowerer,
  trait_def_id: DefId,
  assoc_tag: AssocTag,
  assoc_ident: Ident,
): boolean {
  return (
    AssocItems.find_by_ident_and_kind(this.tcx().associated_items(trait_def_id) as AssocItems, this.tcx(), assoc_ident, assoc_tag, trait_def_id) !==
    undefined
  );
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1217 lower_path_segment
HirTyLowerer.prototype.lower_path_segment = function (this: HirTyLowerer, span: Span, def_id: DefId, item_segment: hir.PathSegment): Ty {
  const tcx = this.tcx();
  const args = this.lower_generic_args_of_path_segment(span, def_id, item_segment);

  if (tcx.def_kind(def_id).$ === "TyAlias" && tcx.type_alias_is_checked(def_id)) {
    // Type aliases defined in crates that have the
    // feature `checked_type_alias` enabled get encoded as a type alias that normalization will
    // then actually instantiate the where bounds of.
    const alias_ty = AliasTy.new_from_args(tcx, { $: "Free", def_id }, args);
    return Ty.new_alias(tcx, "No", alias_ty);
  } else {
    return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.at(span).type_of(def_id) as EarlyBinderT<Ty>, tcx, args, fold_Ty));
  }
};

/// Search for a trait bound on a type parameter whose trait defines the associated item
/// given by `assoc_ident` and `kind`.
///
/// This fails if there is no such bound in the list of candidates or if there are multiple
/// candidates in which case it reports ambiguity.
///
/// `ty_param_def_id` is the `LocalDefId` of the type parameter.
// #[instrument(level = "debug", skip_all, ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1247 probe_single_ty_param_bound_for_assoc_item
HirTyLowerer.prototype.probe_single_ty_param_bound_for_assoc_item = function (
  this: HirTyLowerer,
  ty_param_def_id: LocalDefId,
  ty_param_span: Span,
  assoc_tag: AssocTag,
  assoc_ident: Ident,
  span: Span,
): Result<PolyTraitRefT, ErrorGuaranteed> {
  // debug!(?ty_param_def_id, ?assoc_ident, ?span);
  const tcx = this.tcx();

  const predicates = this.probe_ty_param_bounds(span, ty_param_def_id, assoc_ident);
  // debug!("predicates={:#?}", predicates);

  return this.probe_single_bound_for_assoc_item(
    () => {
      const trait_refs = (function* (): Generator<PolyTraitRefT> {
        for (const u of EarlyBinder.iter_identity_copied(predicates)) {
          const [p, _] = Unnormalized.skip_norm_wip(u);
          const trait_clause = p.as_trait_clause();
          if (trait_clause === undefined) continue;
          yield Binder.map_bound(trait_clause, (t) => t.trait_ref);
        }
      })();
      void trait_refs;
      void tcx;
      // traits::transitive_bounds_that_define_assoc_item(tcx, trait_refs, assoc_ident)
      return unported("rustc_infer::traits::util::transitive_bounds_that_define_assoc_item");
    },
    { $: "TyParam", _0: ty_param_def_id, _1: ty_param_span },
    assoc_tag,
    assoc_ident,
    span,
    undefined,
  );
};

/// When there are multiple traits which contain an identically named
/// associated item, this function eliminates any traits which are a
/// supertrait of another candidate trait.
///
/// This is the type-level analogue of
/// `rustc_hir_typeck::method::probe::ProbeContext::collapse_candidates_to_subtrait_pick`;
/// keep both implementations in sync.
///
/// This implements RFC #3624.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1286 collapse_candidates_to_subtrait_pick
HirTyLowerer.prototype.collapse_candidates_to_subtrait_pick = function (
  this: HirTyLowerer,
  matching_candidates: readonly PolyTraitRefT[],
): PolyTraitRefT | undefined {
  if (!this.tcx().features().supertrait_item_shadowing()) {
    return undefined;
  }

  let child_trait = matching_candidates[0]!;
  let supertraits_ = new DefIdSet(supertrait_def_ids(this.tcx(), PolyTraitRef.def_id(child_trait)));

  let remaining_candidates: PolyTraitRefT[] = matching_candidates.slice(1);
  while (!(remaining_candidates.length === 0)) {
    let made_progress = false;
    const next_round: PolyTraitRefT[] = [];

    for (const remaining_trait of remaining_candidates) {
      if (supertraits_.has(PolyTraitRef.def_id(remaining_trait))) {
        made_progress = true;
        continue;
      }

      // This candidate is not a supertrait of the `child_trait`.
      // Check if it's a subtrait of the `child_trait`, instead.
      // If it is, then it must have been a subtrait of every
      // other pick we've eliminated at this point. It will
      // take over at this point.
      const remaining_trait_supertraits = new DefIdSet(supertrait_def_ids(this.tcx(), PolyTraitRef.def_id(remaining_trait)));
      if (remaining_trait_supertraits.has(PolyTraitRef.def_id(child_trait))) {
        child_trait = remaining_trait;
        supertraits_ = remaining_trait_supertraits;
        made_progress = true;
        continue;
      }

      // Neither `child_trait` or the current candidate are
      // supertraits of each other.
      // Don't bail here, since we may be comparing two supertraits
      // of a common subtrait. These two supertraits won't be related
      // at all, but we will pick them up next round when we find their
      // child as we continue iterating in this round.
      next_round.push(remaining_trait);
    }

    if (made_progress) {
      // If we've made progress, iterate again.
      remaining_candidates = next_round;
    } else {
      // Otherwise, we must have at least two candidates which
      // are not related to each other at all.
      return undefined;
    }
  }

  return child_trait;
};

/// Search for a single trait bound whose trait defines the associated item given by
/// `assoc_ident`.
///
/// This fails if there is no such bound in the list of candidates or if there are multiple
/// candidates in which case it reports ambiguity.
// #[instrument(level = "debug", skip(self, all_candidates, qself, constraint), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1351 probe_single_bound_for_assoc_item
HirTyLowerer.prototype.probe_single_bound_for_assoc_item = function (
  this: HirTyLowerer,
  all_candidates: () => Iterable<PolyTraitRefT>,
  qself: AssocItemQSelf,
  assoc_tag: AssocTag,
  assoc_ident: Ident,
  span: Span,
  constraint: hir.AssocItemConstraint | undefined,
): Result<PolyTraitRefT, ErrorGuaranteed> {
  const self_ = this;
  // PORT: the lazy `Iterator::filter` adapter.
  const matching_candidates = (function* (): Generator<PolyTraitRefT> {
    for (const r of all_candidates()) {
      if (self_.probe_trait_that_defines_assoc_item(PolyTraitRef.def_id(r), assoc_tag, assoc_ident)) {
        yield r;
      }
    }
  })();

  const next1 = matching_candidates.next();
  if (next1.done === true) {
    return Err(this.report_unresolved_assoc_item(all_candidates, qself, assoc_tag, assoc_ident, span, constraint));
  }
  const bound1 = next1.value;

  const next2 = matching_candidates.next();
  if (next2.done !== true) {
    const bound2 = next2.value;
    const all_matching_candidates: PolyTraitRefT[] = [bound1, bound2, ...matching_candidates];
    const bound = this.collapse_candidates_to_subtrait_pick(all_matching_candidates);
    if (bound !== undefined) {
      return Ok(bound);
    }

    return Err(this.report_ambiguous_assoc_item(all_matching_candidates, qself, assoc_tag, assoc_ident, span, constraint));
  }

  return Ok(bound1);
};

/// Lower a [type-relative](hir::QPath::TypeRelative) path in type position to a type.
///
/// If the path refers to an enum variant and `permit_variants` holds,
/// the returned type is simply the provided self type `qself_ty`.
///
/// A path like `A::B::C::D` is understood as `<A::B::C>::D`. I.e.,
/// `qself_ty` / `qself` is `A::B::C` and `assoc_segment` is `D`.
/// We return the lowered type and the `DefId` for the whole path.
///
/// We only support associated type paths whose self type is a type parameter or a `Self`
/// type alias (in a trait impl) like `T::Ty` (where `T` is a ty param) or `Self::Ty`.
/// We **don't** support paths whose self type is an arbitrary type like `Struct::Ty` where
/// struct `Struct` impls an in-scope trait that defines an associated type called `Ty`.
/// For the latter case, we report ambiguity.
/// While desirable to support, the implementation would be non-trivial. Tracked in [#22519].
///
/// At the time of writing, *inherent associated types* are also resolved here. This however
/// is [problematic][iat]. A proper implementation would be as non-trivial as the one
/// described in the previous paragraph and their modeling of projections would likely be
/// very similar in nature.
///
/// [#22519]: https://github.com/rust-lang/rust/issues/22519
/// [iat]: https://github.com/rust-lang/rust/issues/8995#issuecomment-1569208403
//
// NOTE: When this function starts resolving `Trait::AssocTy` successfully
// it should also start reporting the `BARE_TRAIT_OBJECTS` lint.
// #[instrument(level = "debug", skip_all, ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1426 lower_type_relative_ty_path
HirTyLowerer.prototype.lower_type_relative_ty_path = function (
  this: HirTyLowerer,
  self_ty: Ty,
  hir_self_ty: hir.Ty,
  segment: hir.PathSegment,
  qpath_hir_id: HirId,
  span: Span,
  permit_variants: PermitVariants,
): Result<[Ty, DefKind, DefId], ErrorGuaranteed> {
  const tcx = this.tcx();
  const path = this.lower_type_relative_path(self_ty, hir_self_ty, segment, qpath_hir_id, span, { $: "Type", _0: permit_variants });
  if (path.$ === "Err") return path;
  const p = path._0;
  switch (p.$) {
    case "AssocItem": {
      const alias_term = p._0;
      const alias_ty = AliasTerm.expect_ty(alias_term);
      let def_id: DefId;
      const kind = alias_ty.kind;
      if (kind.$ === "Projection") {
        def_id = kind.def_id;
      } else if (kind.$ === "Inherent") {
        def_id = kind.def_id;
      } else {
        return bug(`expected projection or inherent alias, got ${debug_AliasTyKind(kind, PLAIN)}`);
      }
      let ty = AliasTy.to_ty(alias_ty, tcx, "No");
      ty = this.check_param_uses_if_mcg(ty, span, false, fold_Ty);
      return Ok([ty, tcx.def_kind(def_id), def_id]);
    }
    case "Variant": {
      const adt = this.check_param_uses_if_mcg(p.adt, span, false, fold_Ty);
      return Ok([adt, DefKind.Variant, p.variant_did]);
    }
    case "Ctor": {
      const e = tcx.dcx().span_err(span, "expected type, found tuple constructor");
      return Err(e);
    }
  }
};

/// Lower a [type-relative][hir::QPath::TypeRelative] path to a (type-level) constant.
// #[instrument(level = "debug", skip_all, ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1468 lower_type_relative_const_path
HirTyLowerer.prototype.lower_type_relative_const_path = function (
  this: HirTyLowerer,
  self_ty: Ty,
  hir_self_ty: hir.Ty,
  segment: hir.PathSegment,
  qpath_hir_id: HirId,
  span: Span,
): Result<Const, ErrorGuaranteed> {
  const tcx = this.tcx();
  const path = this.lower_type_relative_path(self_ty, hir_self_ty, segment, qpath_hir_id, span, LowerTypeRelativePathMode.Const);
  if (path.$ === "Err") return path;
  const p = path._0;
  switch (p.$) {
    case "AssocItem": {
      const alias_term = p._0;
      const alias_ct = AliasTerm.expect_ct(alias_term);
      const checked = this.check_const_item_in_type_system(alias_ct.kind, span);
      if (checked.$ === "Err") return checked;
      let ct = Const.new_alias(tcx, "No", alias_ct);
      ct = this.check_param_uses_if_mcg(ct, span, false, fold_Const);
      return Ok(ct);
    }
    case "Ctor": {
      const ctor_def_id = p.ctor_def_id;
      const args = p.args;
      const def_kind = tcx.def_kind(ctor_def_id);
      if (def_kind.$ === "Ctor" && def_kind._1 === "Fn") {
        return Ok(Const.zero_sized(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(ctor_def_id) as EarlyBinderT<Ty>, tcx, args, fold_Ty))));
      } else if (def_kind.$ === "Ctor" && def_kind._1 === "Const") {
        const ctor_of = def_kind._0;
        return Ok(this.construct_const_ctor_value(ctor_def_id, ctor_of, args));
      } else {
        return unreachable();
      }
    }
    // FIXME(mgca): implement support for this once ready to support all adt ctor expressions,
    // not just const ctors
    case "Variant":
      return span_bug(span, "unexpected variant res for type associated const path");
  }
};

/**
 * PORT: pending lane hir-ty-lowering-d. errors.rs:2031 is a manual `impl Diagnostic for AmbiguityBetweenVariantAndAssocItem`
 * (`AmbiguityBetweenVariantAndAssocItem_diagnostic` in errors.ts, not written yet). Root: at merge, replace the call of this
 * helper with `errors.AmbiguityBetweenVariantAndAssocItem_diagnostic(..)` and delete it.
 */
function AmbiguityBetweenVariantAndAssocItem_diagnostic_pending(_v: AmbiguityBetweenVariantAndAssocItem): Diagnostic {
  return unported("rustc_hir_analysis::hir_ty_lowering::errors::AmbiguityBetweenVariantAndAssocItem as Diagnostic (into_diag)");
}

/// Lower a [type-relative][hir::QPath::TypeRelative] (and type-level) path.
// #[instrument(level = "debug", skip_all, ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1512 lower_type_relative_path
HirTyLowerer.prototype.lower_type_relative_path = function (
  this: HirTyLowerer,
  self_ty: Ty,
  hir_self_ty: hir.Ty,
  segment: hir.PathSegment,
  qpath_hir_id: HirId,
  span: Span,
  mode: LowerTypeRelativePathMode,
): Result<TypeRelativePath, ErrorGuaranteed> {
  // debug!(%self_ty, ?segment.ident);
  const tcx = this.tcx();

  // Check if we have an enum variant or an inherent associated type.
  let variant_def_id: DefId | undefined = undefined;
  const adt_def = this.probe_adt(span, self_ty);
  if (adt_def !== undefined) {
    if (adt_def.is_enum()) {
      const variant_def = adt_def.variants().find((vd) => tcx.hygienic_eq(segment.ident, vd.ident(tcx), adt_def.did()));
      if (variant_def !== undefined) {
        // FIXME(mgca): do we want constructor resolutions to take priority over
        // other possible resolutions?
        if (mode.$ === "Const" && variant_def.ctor !== undefined) {
          const ctor_def_id = variant_def.ctor[1];
          tcx.check_stability(variant_def.def_id, qpath_hir_id, span, undefined);
          void this.prohibit_generic_args([segment], {
            $: "EnumVariant",
            qself: hir_self_ty,
            assoc_segment: segment,
            adt_def,
          });
          const self_kind = self_ty.kind();
          if (self_kind.$ !== "Adt") {
            return unreachable();
          }
          const enum_args = self_kind._1;
          return Ok({ $: "Ctor", ctor_def_id, args: enum_args });
        }
        if (LowerTypeRelativePathMode.permit_variants(mode) === "Yes") {
          tcx.check_stability(variant_def.def_id, qpath_hir_id, span, undefined);
          void this.prohibit_generic_args([segment], {
            $: "EnumVariant",
            qself: hir_self_ty,
            assoc_segment: segment,
            adt_def,
          });
          return Ok({
            $: "Variant",
            adt: self_ty,
            variant_did: variant_def.def_id,
          });
        } else {
          variant_def_id = variant_def.def_id;
        }
      }
    }

    // FIXME(inherent_associated_types, #106719): Support self types other than ADTs.
    const inherent = this.probe_inherent_assoc_item(segment, adt_def.did(), self_ty, qpath_hir_id, span, LowerTypeRelativePathMode.assoc_tag(mode));
    if (inherent.$ === "Err") return inherent;
    const alias_term = inherent._0;
    if (alias_term !== undefined) {
      return Ok({ $: "AssocItem", _0: alias_term });
    }
  }

  const resolved = this.resolve_type_relative_path(
    self_ty,
    hir_self_ty,
    LowerTypeRelativePathMode.assoc_tag(mode),
    segment,
    qpath_hir_id,
    span,
    variant_def_id,
  );
  if (resolved.$ === "Err") return resolved;
  let item_def_id: DefId = resolved._0[0];
  const bound = resolved._0[1];

  const lowered = this.lower_assoc_item_path(span, item_def_id, segment, bound);
  if (lowered.$ === "Err") return lowered;
  item_def_id = lowered._0[0];
  const args = lowered._0[1];

  if (variant_def_id !== undefined) {
    tcx.emit_node_span_lint(
      AMBIGUOUS_ASSOCIATED_ITEMS,
      qpath_hir_id,
      span,
      AmbiguityBetweenVariantAndAssocItem_diagnostic_pending({
        variant_def_id,
        item_def_id,
        span,
        segment_ident: segment.ident,
        bound_def_id: PolyTraitRef.def_id(bound),
        self_ty,
        tcx,
        mode,
      }),
    );
  }

  let kind: AliasTermKind;
  switch (mode.$) {
    case "Type":
      kind = { $: "ProjectionTy", def_id: item_def_id };
      break;
    case "Const":
      kind = { $: "ProjectionConst", def_id: item_def_id };
      break;
  }

  return Ok({ $: "AssocItem", _0: AliasTerm.new_from_args(tcx, kind, args) });
};

/// Resolve a [type-relative](hir::QPath::TypeRelative) (and type-level) path.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1626 resolve_type_relative_path
HirTyLowerer.prototype.resolve_type_relative_path = function (
  this: HirTyLowerer,
  self_ty: Ty,
  hir_self_ty: hir.Ty,
  assoc_tag: AssocTag,
  segment: hir.PathSegment,
  qpath_hir_id: HirId,
  span: Span,
  variant_def_id: DefId | undefined,
): Result<[DefId, PolyTraitRefT], ErrorGuaranteed> {
  const tcx = this.tcx();

  const hir_kind = hir_self_ty.kind;
  const self_ty_res: Res = hir_kind.$ === "Path" && hir_kind._0.$ === "Resolved" ? hir_kind._0._1.res : { $: "Err" };

  // Find the type of the assoc item, and the trait where the associated item is declared.
  let bound: PolyTraitRefT;
  const self_ty_kind = self_ty.kind();
  if (self_ty_res.$ === "SelfTyAlias" && self_ty_res.is_trait_impl === true) {
    const impl_def_id = self_ty_res.alias_to;
    // `Self` in an impl of a trait -- we have a concrete self type and a
    // trait reference.
    const trait_ref = tcx.impl_trait_ref(impl_def_id);

    const probed = this.probe_single_bound_for_assoc_item(
      () => {
        // PORT: D4 descriptor of `TraitRef` for `Binder::dummy`.
        const d_TraitRef: TypeVisitable<TraitRefT> = { visit_with: visit_with_TraitRef };
        const trait_ref_ = Binder.dummy(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(trait_ref)), d_TraitRef);
        return supertraits(tcx, trait_ref_);
      },
      AssocItemQSelf.SelfTyAlias,
      assoc_tag,
      segment.ident,
      span,
      undefined,
    );
    if (probed.$ === "Err") return probed;
    bound = probed._0;
  } else if (
    self_ty_kind.$ === "Param" &&
    (self_ty_res.$ === "SelfTyParam" || (self_ty_res.$ === "Def" && self_ty_res._0.$ === "TyParam"))
  ) {
    const param_did = self_ty_res.$ === "SelfTyParam" ? self_ty_res.trait_ : self_ty_res._1;
    const probed = this.probe_single_ty_param_bound_for_assoc_item(param_did.expect_local(), hir_self_ty.span, assoc_tag, segment.ident, span);
    if (probed.$ === "Err") return probed;
    bound = probed._0;
  } else {
    return Err(this.report_unresolved_type_relative_path(self_ty, hir_self_ty, assoc_tag, segment.ident, qpath_hir_id, span, variant_def_id));
  }

  const assoc_item = unwrap(
    this.probe_assoc_item(segment.ident, assoc_tag, qpath_hir_id, span, PolyTraitRef.def_id(bound)),
    "failed to find associated item",
  );

  return Ok([assoc_item.def_id, bound]);
};

/// Search for inherent associated items for use at the type level.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1694 probe_inherent_assoc_item
HirTyLowerer.prototype.probe_inherent_assoc_item = function (
  this: HirTyLowerer,
  segment: hir.PathSegment,
  adt_did: DefId,
  self_ty: Ty,
  block: HirId,
  span: Span,
  assoc_tag: AssocTag,
): Result<AliasTermT | undefined, ErrorGuaranteed> {
  const tcx = this.tcx();

  if (!tcx.features().inherent_associated_types()) {
    switch (assoc_tag) {
      // Don't attempt to look up inherent associated types when the feature is not
      // enabled. Theoretically it'd be fine to do so since we feature-gate their
      // definition site. However, the current implementation of inherent associated
      // items is somewhat brittle, so let's not run it by default.
      case "Type":
        return Ok(undefined);
      case "Const": {
        // We also gate the mgca codepath for type-level uses of inherent consts
        // with the inherent_associated_types feature gate since it relies on the
        // same machinery and has similar rough edges.
        return Err(feature_err(tcx.sess, sym.inherent_associated_types, span, "inherent associated types are unstable").emit_err());
      }
      case "Fn":
        return unreachable();
    }
  }

  const name = segment.ident;
  const candidates: InherentAssocCandidate[] = [];
  for (const impl_ of tcx.inherent_impls(adt_did)) {
    const probed = this.probe_assoc_item_unchecked(name, assoc_tag, impl_);
    if (probed === undefined) continue;
    const [item, scope] = probed;
    candidates.push({ impl_, assoc_item: item.def_id, scope });
  }

  // At the moment, we actually bail out with a hard error if the selection of an inherent
  // associated item fails (see below). This means we never consider trait associated items
  // as potential fallback candidates (#142006). To temporarily mask that issue, let's not
  // select at all if there are no early inherent candidates.
  if (candidates.length === 0) {
    return Ok(undefined);
  }

  const [applicable_candidates, fulfillment_errors] = this.select_inherent_assoc_candidates(span, self_ty, candidates.map(clone_InherentAssocCandidate));

  // FIXME(#142006): Don't eagerly error here, there might be applicable trait candidates.
  let selected: Result<InherentAssocCandidate, ErrorGuaranteed>;
  if (applicable_candidates.length === 0) {
    selected = Err(this.report_unresolved_inherent_assoc_item(name, self_ty, candidates, fulfillment_errors, span, assoc_tag));
  } else if (applicable_candidates.length === 1) {
    selected = Ok(applicable_candidates[0]!);
  } else {
    selected = Err(
      this.report_ambiguous_inherent_assoc_item(
        name,
        candidates.map((cand) => cand.assoc_item),
        span,
      ),
    );
  }
  if (selected.$ === "Err") return selected;
  const { impl_, assoc_item, scope: def_scope } = selected._0;

  // FIXME(#142006): Don't eagerly validate here, there might be trait candidates that are
  // accessible (visible and stable) contrary to the inherent candidate.
  this.check_assoc_item(assoc_item, name, def_scope, block, span);

  // FIXME(fmease): Currently creating throwaway `parent_args` to please
  // `lower_generic_args_of_assoc_item`. Modify the latter instead (or sth. similar) to
  // not require the parent args logic.
  const parent_args = RawList.identity_for_item(tcx, impl_);
  let args = this.lower_generic_args_of_assoc_item(span, assoc_item, segment, parent_args);
  args = tcx.mk_args_from_iter([GenericArg.from_Ty(self_ty), ...args.slice(parent_args.length)]);

  let kind: AliasTermKind;
  switch (assoc_tag) {
    case "Type":
      kind = { $: "InherentTy", def_id: assoc_item };
      break;
    case "Const":
      kind = { $: "InherentConstSelf", def_id: assoc_item };
      break;
    case "Fn":
      return unreachable();
  }

  return Ok(AliasTerm.new_from_args(tcx, kind, args));
};

/// Given name and kind search for the assoc item in the provided scope and check if it's accessible[^1].
///
/// [^1]: I.e., accessible in the provided scope wrt. visibility and stability.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1796 probe_assoc_item
HirTyLowerer.prototype.probe_assoc_item = function (
  this: HirTyLowerer,
  ident: Ident,
  assoc_tag: AssocTag,
  block: HirId,
  span: Span,
  scope: DefId,
): AssocItem | undefined {
  const probed = this.probe_assoc_item_unchecked(ident, assoc_tag, scope);
  if (probed === undefined) return undefined;
  // PORT: the `ModId` `scope` shadows the `DefId` parameter of the same name.
  const [item, scope_] = probed;
  this.check_assoc_item(item.def_id, ident, scope_, block, span);
  return item;
};

/// Given name and kind search for the assoc item in the provided scope
/// *without* checking if it's accessible[^1].
///
/// [^1]: I.e., accessible in the provided scope wrt. visibility and stability.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1813 probe_assoc_item_unchecked
HirTyLowerer.prototype.probe_assoc_item_unchecked = function (
  this: HirTyLowerer,
  ident_: Ident,
  assoc_tag: AssocTag,
  scope: DefId,
): [AssocItem, /*scope*/ ModId] | undefined {
  const tcx = this.tcx();

  // PORT: the adjusted `ident` shadows the parameter (`ident_`).
  const [ident, def_scope] = tcx.adjust_ident_and_get_scope(ident_, scope, this.mod_id());
  // We have already adjusted the item name above, so compare with `.normalize_to_macros_2_0()`
  // instead of calling `filter_by_name_and_kind` which would needlessly normalize the
  // `ident` again and again.
  let item: AssocItem | undefined = undefined;
  for (const i of AssocItems.filter_by_name_unhygienic(tcx.associated_items(scope) as AssocItems, ident.name)) {
    if (AssocItem.tag(i) === assoc_tag && AssocItem.ident(i, tcx).normalize_to_macros_2_0().eq(ident)) {
      item = i;
      break;
    }
  }
  if (item === undefined) return undefined;

  return [item, def_scope];
};

/// Check if the given assoc item is accessible in the provided scope wrt. visibility and stability.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1834 check_assoc_item
HirTyLowerer.prototype.check_assoc_item = function (
  this: HirTyLowerer,
  item_def_id: DefId,
  ident: Ident,
  scope: ModId,
  block: HirId,
  span: Span,
): void {
  const tcx = this.tcx();

  if (!Visibility.is_accessible_from(tcx.visibility(item_def_id), scope, tcx)) {
    this.dcx().emit_err(
      AssocItemIsPrivate_diagnostic({
        span,
        kind: tcx.def_descr(item_def_id),
        name: ident,
        defined_here_label: tcx.def_span(item_def_id),
      }),
    );
  }

  tcx.check_stability(item_def_id, block, span, undefined);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1856 probe_traits_that_match_assoc_ty
HirTyLowerer.prototype.probe_traits_that_match_assoc_ty = function (this: HirTyLowerer, qself_ty: Ty, assoc_ident: Ident): string[] {
  const tcx = this.tcx();

  // In contexts that have no inference context, just make a new one.
  // We do need a local variable to store it, though.
  let infcx: InferCtxt;
  const infcx_opt = this.infcx();
  if (infcx_opt !== undefined) {
    infcx = infcx_opt;
  } else {
    assert(!TypeVisitableExt.has_infer(qself_ty, fold_Ty), "assertion failed: !qself_ty.has_infer()");
    // infcx_ = tcx.infer_ctxt().build(TypingMode::non_body_analysis());
    infcx = unported("rustc_infer::infer::TyCtxtInferExt::infer_ctxt (InferCtxtBuilder::build)");
  }

  const out: string[] = [];
  for (const trait_def_id of tcx.all_traits_including_private()) {
    // Consider only traits with the associated type
    let has_assoc_ty = false;
    for (const i of AssocItems.in_definition_order(tcx.associated_items(trait_def_id) as AssocItems)) {
      if (AssocItem.is_type(i) && !AssocItem.is_impl_trait_in_trait(i) && AssocItem.ident(i, tcx).normalize_to_macros_2_0().eq(assoc_ident)) {
        has_assoc_ty = true;
        break;
      }
    }
    const keep =
      has_assoc_ty &&
      // Consider only accessible traits
      Visibility.is_accessible_from(tcx.visibility(trait_def_id), this.mod_id(), tcx) &&
      ((): boolean => {
        for (const impl_def_id of tcx.all_impls(trait_def_id)) {
          const header = tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
          // PORT: `InferCtxt` is pending (lane infcx-contract). The rest of the closure is:
          //   let trait_ref = header.trait_ref.instantiate(tcx, infcx.fresh_args_for_item(DUMMY_SP, impl_def_id)).skip_norm_wip();
          //   let value = fold_regions(tcx, qself_ty, |_, _| tcx.lifetimes.re_erased);
          //   // FIXME: Don't bother dealing with non-lifetime binders here...
          //   if value.has_escaping_bound_vars() { return false; }
          //   infcx.can_eq(ty::ParamEnv::empty(), trait_ref.self_ty(), value) && header.polarity != ty::ImplPolarity::Negative
          void header;
          void infcx;
          return unported("rustc_infer::infer::InferCtxt::fresh_args_for_item");
        }
        return false;
      })();
    if (keep) {
      out.push(tcx.def_path_str(trait_def_id));
    }
  }
  return out;
};

/// Lower a [resolved][hir::QPath::Resolved] associated type path to a projection.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1911 lower_resolved_assoc_ty_path
HirTyLowerer.prototype.lower_resolved_assoc_ty_path = function (
  this: HirTyLowerer,
  span: Span,
  opt_self_ty: Ty | undefined,
  item_def_id: DefId,
  trait_segment: hir.PathSegment | undefined,
  item_segment: hir.PathSegment,
): Ty {
  const r = this.lower_resolved_assoc_item_path(span, opt_self_ty, item_def_id, trait_segment, item_segment, "Type");
  switch (r.$) {
    case "Ok": {
      const [item_def_id, item_args] = r._0;
      return Ty.new_projection_from_args(this.tcx(), "No", item_def_id, item_args);
    }
    case "Err":
      return Ty.new_error(this.tcx(), r._0);
  }
};

/// Lower a [resolved][hir::QPath::Resolved] associated const path to a (type-level) constant.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1936 lower_resolved_assoc_const_path
HirTyLowerer.prototype.lower_resolved_assoc_const_path = function (
  this: HirTyLowerer,
  span: Span,
  opt_self_ty: Ty | undefined,
  item_def_id_: DefId,
  trait_segment: hir.PathSegment | undefined,
  item_segment: hir.PathSegment,
): Result<Const, ErrorGuaranteed> {
  const tcx = this.tcx();
  const r = this.lower_resolved_assoc_item_path(span, opt_self_ty, item_def_id_, trait_segment, item_segment, "Const");
  if (r.$ === "Err") return r;
  // PORT: the returned `item_def_id` shadows the parameter (`item_def_id_`).
  const [item_def_id, item_args] = r._0;
  const kind = { $: "Projection" as const, def_id: item_def_id };
  const checked = this.check_const_item_in_type_system(kind, span);
  if (checked.$ === "Err") return checked;
  const alias = AliasConst.new(tcx, kind, item_args);
  return Ok(Const.new_alias(tcx, "No", alias));
};

/// Lower a [resolved][hir::QPath::Resolved] (type-level) associated item path.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1961 lower_resolved_assoc_item_path
HirTyLowerer.prototype.lower_resolved_assoc_item_path = function (
  this: HirTyLowerer,
  span: Span,
  opt_self_ty: Ty | undefined,
  item_def_id: DefId,
  trait_segment: hir.PathSegment | undefined,
  item_segment: hir.PathSegment,
  assoc_tag: AssocTag,
): Result<[DefId, GenericArgs], ErrorGuaranteed> {
  const tcx = this.tcx();

  const trait_def_id = tcx.parent(item_def_id);
  // debug!(?trait_def_id);

  const self_ty = opt_self_ty;
  if (self_ty === undefined) {
    return Err(this.report_missing_self_ty_for_resolved_path(trait_def_id, span, item_segment, assoc_tag));
  }
  // debug!(?self_ty);

  const trait_ref = this.lower_mono_trait_ref(span, trait_def_id, self_ty, unwrap(trait_segment), false);
  // debug!(?trait_ref);

  const item_args = this.lower_generic_args_of_assoc_item(span, item_def_id, item_segment, trait_ref.args);

  return Ok([item_def_id, item_args]);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:1995 prohibit_generic_args
HirTyLowerer.prototype.prohibit_generic_args = function (
  this: HirTyLowerer,
  segments_: Iterable<hir.PathSegment>,
  err_extend: GenericsArgsErrExtend,
): Result<undefined, ErrorGuaranteed> {
  // PORT: `segments: impl Iterator + Clone` is cloned and iterated several times; it is collected once here (the
  // iteration has no side effects).
  const segments = [...segments_];
  const args_visitors = segments.flatMap((segment) => segment.args_().args);
  let result: Result<undefined, ErrorGuaranteed> = Ok(undefined);
  if (args_visitors.length > 0) {
    result = Err(this.report_prohibited_generic_args(segments, args_visitors, err_extend));
  }

  for (const segment of segments) {
    // Only emit the first error to avoid overloading the user with error messages.
    const c = segment.args_().constraints[0];
    if (c !== undefined) {
      return Err(prohibit_assoc_item_constraint(this, c, undefined));
    }
  }

  return result;
};

/// Probe path segments that are semantically allowed to have generic arguments.
///
/// ### Example
///
/// ```ignore (illustrative)
///    Option::None::<()>
/// //         ^^^^ permitted to have generic args
///
/// // ==> [GenericPathSegment(Option_def_id, 1)]
///
///    Option::<()>::None
/// // ^^^^^^        ^^^^ *not* permitted to have generic args
/// // permitted to have generic args
///
/// // ==> [GenericPathSegment(Option_def_id, 0)]
/// ```
// FIXME(eddyb, varkor) handle type paths here too, not just value ones.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2037 probe_generic_path_segments
HirTyLowerer.prototype.probe_generic_path_segments = function (
  this: HirTyLowerer,
  segments: readonly hir.PathSegment[],
  self_ty: Ty | undefined,
  kind: DefKind,
  def_id: DefId,
  span: Span,
): GenericPathSegment[] {
  // We need to extract the generic arguments supplied by the user in
  // the path `path`. Due to the current setup, this is a bit of a
  // tricky process; the problem is that resolve only tells us the
  // end-point of the path resolution, and not the intermediate steps.
  // Luckily, we can (at least for now) deduce the intermediate steps
  // just from the end-point.
  //
  // There are basically five cases to consider:
  //
  // 1. Reference to a constructor of a struct:
  //
  //        struct Foo<T>(...)
  //
  //    In this case, the generic arguments are declared in the type space.
  //
  // 2. Reference to a constructor of an enum variant:
  //
  //        enum E<T> { Foo(...) }
  //
  //    In this case, the generic arguments are defined in the type space,
  //    but may be specified either on the type or the variant.
  //
  // 3. Reference to a free function or constant:
  //
  //        fn foo<T>() {}
  //
  //    In this case, the path will again always have the form
  //    `a::b::foo::<T>` where only the final segment should have generic
  //    arguments. However, in this case, those arguments are declared on
  //    a value, and hence are in the value space.
  //
  // 4. Reference to an associated function or constant:
  //
  //        impl<A> SomeStruct<A> {
  //            fn foo<B>(...) {}
  //        }
  //
  //    Here we can have a path like `a::b::SomeStruct::<A>::foo::<B>`,
  //    in which case generic arguments may appear in two places. The
  //    penultimate segment, `SomeStruct::<A>`, contains generic arguments
  //    in the type space, and the final segment, `foo::<B>` contains
  //    generic arguments in value space.
  //
  // The first step then is to categorize the segments appropriately.

  const tcx = this.tcx();

  assert(!(segments.length === 0), "assertion failed: !segments.is_empty()");
  const last = segments.length - 1;

  const generic_segments: GenericPathSegment[] = [];

  if (kind.$ === "Ctor" && kind._0 === "Struct") {
    // Case 1. Reference to a struct constructor.
    // Everything but the final segment should have no
    // parameters at all.
    const generics = tcx.generics_of(def_id) as Generics;
    // Variant and struct constructors use the
    // generics of their parent type definition.
    const generics_def_id = generics.parent !== undefined ? generics.parent : def_id;
    generic_segments.push({ _0: generics_def_id, _1: last });
  } else if ((kind.$ === "Ctor" && kind._0 === "Variant") || kind.$ === "Variant") {
    // Case 2. Reference to a variant constructor.
    let generics_def_id: DefId;
    let index: number;
    const second_to_last = segments.length >= 2 ? segments[segments.length - 2]! : undefined;
    if (self_ty !== undefined) {
      // We have something like `<module::Enum>::Variant`.

      const adt_def = unwrap(this.probe_adt(span, self_ty));
      // debug_assert!(adt_def.is_enum());

      // FIXME: Stating that the last segment (here: `Variant`) is allowed to have
      // generic args is a lie! We should set the index to `None` instead as it's
      // the *self type* that's allowed to have args.
      // HIR typeck's `instantiate_value_path` actually contains a special case to
      // reject args on `DefKind::Ctor` segments (see `is_alias_variant_ctor`).
      // Using `None` here for this should allow us to get rid of that workaround.
      //
      // (For additional context, `DefKind::Variant` segments never actually reach
      // this branch as they're interpreted as `TypeRelative` paths whose lowering
      // routines manually reject args on them).

      generics_def_id = adt_def.did();
      index = last;
    } else if (
      second_to_last !== undefined &&
      second_to_last.args !== undefined &&
      second_to_last.res.$ === "Def" &&
      second_to_last.res._0.$ === "Enum"
    ) {
      // We have something like `module::Enum::<…>::Variant`.
      // No segment other than the penultimate one is allowed to have generic args.

      // We had to check that the second to last segment actually referred to an enum
      // since at this stage it could very well refer to a module in which case we
      // certainly don't want to allow generic args on it!

      // `DefKind::Ctor` -> `DefKind::Variant`
      // PORT: this `def_id` shadows the parameter (`variant_def_id`).
      const variant_def_id = kind.$ === "Ctor" ? tcx.parent(def_id) : def_id;

      // `DefKind::Variant` -> `DefKind::Enum`
      const enum_def_id = tcx.parent(variant_def_id);

      generics_def_id = enum_def_id;
      index = last - 1;
    } else {
      // We have something like `module::Enum::Variant` or `module::Variant`.
      // No segment other than the final one is allowed to have generic args.

      // FIXME: lint here recommending `Enum::<...>::Variant` form
      // instead of `Enum::Variant::<...>` form.

      const generics = tcx.generics_of(def_id) as Generics;
      // Variant and struct constructors use the
      // generics of their parent type definition.
      generics_def_id = generics.parent !== undefined ? generics.parent : def_id;
      index = last;
    }
    generic_segments.push({ _0: generics_def_id, _1: index });
  } else if (kind.$ === "Fn" || kind.$ === "Const" || kind.$ === "ConstParam" || kind.$ === "Static") {
    // Case 3. Reference to a top-level value.
    generic_segments.push({ _0: def_id, _1: last });
  } else if (kind.$ === "AssocFn" || kind.$ === "AssocConst") {
    // Case 4. Reference to a method or associated const.
    if (segments.length >= 2) {
      const generics = tcx.generics_of(def_id) as Generics;
      generic_segments.push({ _0: unwrap(generics.parent), _1: last - 1 });
    }
    generic_segments.push({ _0: def_id, _1: last });
  } else {
    return bug(`unexpected definition kind ${debug_DefKind(kind, PLAIN)} for ${debug_DefId(def_id, PLAIN)}`);
  }

  // debug!(?generic_segments);

  return generic_segments;
};

// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer", [
  "lower_resolved_ty_path", "lower_ty_param", "lower_const_param", "lower_const_arg", "lower_const_arg_array",
  "try_recover_misrepresented_function_call", "lower_const_arg_tuple_call", "lower_const_arg_tup",
  "lower_const_arg_struct", "lower_path_for_struct_expr", "lower_resolved_const_path", "lower_const_arg_anon",
  "lower_const_arg_literal", "try_lower_anon_const_lit", "check_const_item_in_type_system", "lower_delegation_ty",
  "lower_ty", "lower_pat_ty_pat", "lower_field_of", "lower_opaque_ty", "lower_fn_ty",
  "suggest_trait_fn_ty_for_impl_fn_infer", "validate_late_bound_regions", "construct_const_ctor_value", "lower_view",
]);
