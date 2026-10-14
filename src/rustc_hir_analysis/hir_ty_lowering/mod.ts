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
// (none yet)
// ---- lane hir-ty-lowering-b imports ----
import type { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { LitKind } from "../../rustc_ast/lib.ts";
import { type Diag, E0559, E0560, E0581, E0609, E0616, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { type CtorOf, type DefKind, Res, debug_Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { debug_OpaqueTyOrigin } from "../../rustc_hir/hir.gen.ts";
import { type HirId, debug_HirId } from "../../rustc_hir_id/lib.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import type { LitToConstInput } from "../../rustc_middle/ty/consts/lit.ts";
import { const_lit_matches_ty } from "../../rustc_middle/ty/consts/lit.ts";
import { ValTree, type Value } from "../../rustc_middle/ty/consts/valtree.ts";
import type { FieldIdx, VariantIdx } from "../../rustc_middle/ty/decls.ts";
import { type GenericArgs, fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { type List, RawList } from "../../rustc_middle/ty/list.ts";
import { type FieldDef, Ty, type VariantDef, Visibility } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { ParamConst } from "../../rustc_middle/ty/sty.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId, type LocalModId, debug_DefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { span_bug, bug } from "../../rustc_span/macros.ts";
import { type Ident, debug_Symbol, display_Ident, display_Symbol, kw, sym } from "../../rustc_span/symbol.ts";
import { AliasConst, AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import { Binder, BoundConst, BoundRegionKind, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { BoundTy, DebruijnIndex, PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { fold_Vec } from "../../rustc_type_ir/fold.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { CollectAndApply_Result } from "../../rustc_type_ir/interner.ts";
import { BoundVar } from "../../rustc_type_ir/lib.gen.ts";
import { PatternKind } from "../../rustc_type_ir/pattern.ts";
import { Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { FnSig, FnSigKind, PolyFnSig as PolyFnSig_, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { debug_SplattedArgIndexError } from "../../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { KeyedSet } from "../../rust_ts/keyed.ts";
import { debug_option, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { check_c_variadic_abi } from "../lib.ts";
import type { ResolvedArg } from "../decls.ts";
import {
  BadReturnTypeNotation_diagnostic,
  ComplexConstArg_diagnostic,
  NoFieldOnType_diagnostic,
  NoVariantNamed_diagnostic,
  OnlyStructsCanBeViewedAdt_diagnostic,
  OnlyStructsCanBeViewedNonAdt_diagnostic,
  ViewedFieldIsAlreadyPartOfTheView_diagnostic,
} from "../diagnostics.gen.ts";
import { validate_cmse_abi } from "./cmse.ts";
import { GenericsArgsErrExtend, eq_ctxt_suggestion_span } from "./errors.ts";
import {
  ImpliedBoundsContext,
  type PermitVariants,
  PredicateFilter,
  RegionInferReason,
  type ResolvedStructPath,
} from "./mod.gen.ts";
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

// mod.rs:401 `struct ForbidParamUsesFolder` (+ `error`, :410, and `impl TypeFolder`, :461..:479): hand class (types.sets.json
// `hand`). PORT: `unknown` until lane hir-ty-lowering-a writes it.
export type ForbidParamUsesFolder = unknown;

// mod.rs:261 `AssocItemQSelf::to_string`, :277 / :285 / :292 `LowerTypeRelativePathMode::{assoc_tag, def_kind_for_diagnostics,
// permit_variants}`: enum methods on the generated companion consts (PORTING §8), lane hir-ty-lowering-a.

/**
 * The provided methods of `trait HirTyLowerer` (mod.rs:138; PORTING §8). `lowerer` takes the implementor's vtable as well:
 * it builds the trait object (upstream's unsizing coercion `self` -> `&dyn HirTyLowerer`).
 */
export const HirTyLowerer_provided = {
  // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:239 lowerer
  lowerer<S>(self_: S, impl_: HirTyLowererImpl<S>): HirTyLowerer {
    return new HirTyLowerer(self_, impl_ as HirTyLowererImpl<unknown>);
  },
};

unported_methods(HirTyLowerer.prototype, "rustc_hir_analysis::hir_ty_lowering::HirTyLowerer", [
  "check_param_res_if_mcg_for_instantiate_value_path", "anon_const_forbids_generic_params",
  "check_param_uses_if_mcg", "lower_lifetime", "lower_resolved_lifetime", "lower_generic_args_of_path_segment",
  "lower_generic_args_of_path", "lower_generic_args_of_assoc_item", "lower_impl_trait_ref", "lower_poly_trait_ref",
  "lower_mono_trait_ref", "probe_trait_that_defines_assoc_item", "lower_path_segment",
  "probe_single_ty_param_bound_for_assoc_item", "collapse_candidates_to_subtrait_pick",
  "probe_single_bound_for_assoc_item", "lower_type_relative_ty_path", "lower_type_relative_const_path",
  "lower_type_relative_path", "resolve_type_relative_path", "probe_inherent_assoc_item", "probe_assoc_item",
  "probe_assoc_item_unchecked", "check_assoc_item", "probe_traits_that_match_assoc_ty",
  "lower_resolved_assoc_ty_path", "lower_resolved_assoc_const_path", "lower_resolved_assoc_item_path",
  "prohibit_generic_args", "probe_generic_path_segments",
]);

// ==== lane hir-ty-lowering-b: mod.rs:2186..3915 ====

// PORT(decls): pending root. `rbv::ResolvedArg` (rustc_middle middle/resolve_bound_vars.rs) is `Pending` in ../decls.ts and
// `PendingEnum` in rustc_middle ty/context.ts (`named_bound_var`). This is its upstream shape, used to match on it here:
// `enum ResolvedArg { StaticLifetime, EarlyBound(LocalDefId), LateBound(DebruijnIndex, u32, LocalDefId),
// Free(LocalDefId, LocalDefId), Error(ErrorGuaranteed) }`.
type RbvResolvedArg =
  | { readonly $: "StaticLifetime" }
  | { readonly $: "EarlyBound"; _0: LocalDefId }
  | { readonly $: "LateBound"; _0: DebruijnIndex; _1: number; _2: LocalDefId }
  | { readonly $: "Free"; _0: LocalDefId; _1: LocalDefId }
  | { readonly $: "Error"; _0: ErrorGuaranteed };

// rustc_abi `FIRST_VARIANT` (`VariantIdx::ZERO`); PORT: rustc_abi's layout module is not ported (rustc_middle ty/adt.ts
// keeps the same local constant).
const FIRST_VARIANT = 0 as VariantIdx;

/** `slice[index]`: panics with core's text when out of bounds. */
function index_slice<T>(xs: readonly T[], index: number): T {
  if (index >= xs.length) panic(`index out of bounds: the len is ${xs.length} but the index is ${index}`);
  return xs[index]!;
}

/** `assert_eq!(left, right, "{msg}")`: core's `assert_failed_inner` text with a message. */
function assert_eq_msg<T>(left: T, right: T, debug: (v: T) => string, msg: string, eq: (a: T, b: T) => boolean = (a, b) => a === b): void {
  if (!eq(left, right)) {
    panic(`assertion \`left == right\` failed: ${msg}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/** `assert_eq!(opt_self_ty, None)` */
function assert_no_self_ty(opt_self_ty: Ty | undefined): void {
  assert_eq(opt_self_ty, undefined, (v) => debug_option(v, PLAIN, debug_Ty));
}

/** The `Debug` of `Option<ResolvedArg>` in a `bug!` text. PORT: `Debug for ResolvedArg` is pending (see above). */
function debug_opt_resolved_arg(_arg: RbvResolvedArg | undefined): string {
  return unported("Debug for rustc_middle::middle::resolve_bound_vars::ResolvedArg");
}

/// Lower a [resolved][hir::QPath::Resolved] path to a type.
// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2189 lower_resolved_ty_path
HirTyLowerer.prototype.lower_resolved_ty_path = function (
  this: HirTyLowerer,
  opt_self_ty: Ty | undefined,
  path: hir.Path,
  hir_id: HirId,
  permit_variants: PermitVariants,
): Ty {
  // debug!(?path.res, ?opt_self_ty, ?path.segments);
  const tcx = this.tcx();

  const span = path.span;
  const res = path.res;
  if (res.$ === "Def" && res._0.$ === "OpaqueTy") {
    const did = res._1;
    // Check for desugared `impl Trait`.
    const origin = tcx.opaque_ty_origin(did) as hir.OpaqueTyOrigin<DefId>;
    assert_matches(origin, origin.$ === "TyAlias", "hir::OpaqueTyOrigin::TyAlias { .. }", (v) => debug_OpaqueTyOrigin(v, PLAIN, debug_DefId));
    if (path.segments.length === 0) bug();
    const leading_segments = path.segments.slice(0, -1);
    const segment = path.segments[path.segments.length - 1]!;
    void this.prohibit_generic_args(leading_segments, GenericsArgsErrExtend.OpaqueTy);
    const args = this.lower_generic_args_of_path_segment(span, did, segment);
    return Ty.new_opaque(tcx, "No", did, args);
  } else if (
    res.$ === "Def" &&
    (res._0.$ === "Enum" || res._0.$ === "TyAlias" || res._0.$ === "Struct" || res._0.$ === "Union" || res._0.$ === "ForeignTy")
  ) {
    const did = res._1;
    assert_no_self_ty(opt_self_ty);
    if (path.segments.length === 0) bug();
    const leading_segments = path.segments.slice(0, -1);
    const segment = path.segments[path.segments.length - 1]!;
    void this.prohibit_generic_args(leading_segments, GenericsArgsErrExtend.None);
    return this.lower_path_segment(span, did, segment);
  } else if (res.$ === "Def" && res._0.$ === "Variant" && permit_variants === "Yes") {
    const kind = res._0;
    const def_id = res._1;
    // Lower "variant type" as if it were a real type.
    // The resulting `Ty` is type of the variant's enum for now.
    assert_no_self_ty(opt_self_ty);

    const generic_segments = this.probe_generic_path_segments(path.segments, undefined, kind, def_id, span);
    const indices = new Set<number>(generic_segments.map(({ _1: index }) => index));
    void this.prohibit_generic_args(
      filter_map_enumerate(path.segments, (index, seg) => (!indices.has(index) ? seg : undefined)),
      { $: "DefVariant", _0: path.segments },
    );

    const { _0: def_id_, _1: index } = unwrap(generic_segments[generic_segments.length - 1]);
    return this.lower_path_segment(span, def_id_, index_slice(path.segments, index));
  } else if (res.$ === "Def" && res._0.$ === "TyParam") {
    const def_id = res._1;
    assert_no_self_ty(opt_self_ty);
    void this.prohibit_generic_args(path.segments, { $: "Param", _0: def_id });
    return this.lower_ty_param(hir_id);
  } else if (res.$ === "SelfTyParam") {
    // `Self` in trait or type alias.
    assert_no_self_ty(opt_self_ty);
    let err_extend: GenericsArgsErrExtend;
    if (path.segments.length === 1 && path.segments[0]!.args !== undefined) {
      const { args, ident } = path.segments[0]!;
      err_extend = { $: "SelfTyParam", _0: Span.to(Span.shrink_to_hi(ident.span), args!.span_ext) };
    } else {
      err_extend = GenericsArgsErrExtend.None;
    }
    void this.prohibit_generic_args(path.segments, err_extend);
    return this.check_param_uses_if_mcg(tcx.types.self_param, span, false, fold_Ty);
  } else if (res.$ === "SelfTyAlias") {
    const def_id = res.alias_to;
    // `Self` in impl (we know the concrete type).
    assert_no_self_ty(opt_self_ty);
    // Try to evaluate any array length constants.
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.at(span).type_of(def_id) as EarlyBinder<Ty>));
    void this.prohibit_generic_args(path.segments, { $: "SelfTyAlias", def_id, span });
    return this.check_param_uses_if_mcg(ty, span, true, fold_Ty);
  } else if (res.$ === "Def" && res._0.$ === "AssocTy") {
    const def_id = res._1;
    let trait_segment: hir.PathSegment | undefined;
    if (path.segments.length >= 2) {
      const modules = path.segments.slice(0, -2);
      const trait_ = path.segments[path.segments.length - 2]!;
      void this.prohibit_generic_args(modules, GenericsArgsErrExtend.None);
      trait_segment = trait_;
    } else {
      trait_segment = undefined;
    }
    return this.lower_resolved_assoc_ty_path(span, opt_self_ty, def_id, trait_segment, unwrap(path.segments[path.segments.length - 1]));
  } else if (res.$ === "PrimTy") {
    const prim_ty = res._0;
    assert_no_self_ty(opt_self_ty);
    void this.prohibit_generic_args(path.segments, { $: "PrimTy", _0: prim_ty });
    switch (prim_ty.$) {
      case "Bool":
        return tcx.types.bool;
      case "Char":
        return tcx.types.char;
      case "Int":
        return Ty.new_int(tcx, prim_ty._0);
      case "Uint":
        return Ty.new_uint(tcx, prim_ty._0);
      case "Float":
        return Ty.new_float(tcx, prim_ty._0);
      case "Str":
        return tcx.types.str_;
    }
  } else if (res.$ === "Err") {
    const e = this.tcx().dcx().span_delayed_bug(path.span, "path with `Res::Err` but no error emitted");
    return Ty.new_error(tcx, e);
  } else if (res.$ === "Def") {
    assert_eq_msg(
      path.segments[0]?.ident.name,
      kw.SelfUpper,
      (v) => debug_option(v, PLAIN, debug_Symbol),
      "only expected incorrect resolution for `Self`",
    );
    return Ty.new_error(this.tcx(), this.dcx().span_delayed_bug(span, "incorrect resolution for `Self`"));
  } else {
    return span_bug(span, `unexpected resolution: ${debug_Res(path.res, PLAIN, debug_HirId)}`);
  }
};

/// Lower a type parameter from the HIR to our internal notion of a type.
///
/// Early-bound type parameters get lowered to [`ty::Param`]
/// and late-bound ones to [`ty::Bound`].
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2337 lower_ty_param
HirTyLowerer.prototype.lower_ty_param = function (this: HirTyLowerer, hir_id: HirId): Ty {
  const tcx = this.tcx();

  let ty: Ty;
  const arg = tcx.named_bound_var(hir_id) as RbvResolvedArg | undefined;
  if (arg !== undefined && arg.$ === "LateBound") {
    const [debruijn, index, def_id] = [arg._0, arg._1, arg._2];
    const br: BoundTy = {
      var: BoundVar.from_u32(index),
      kind: { $: "Param", _0: LocalDefId.to_def_id(def_id) },
    };
    ty = Ty.new_bound(tcx, debruijn, br);
  } else if (arg !== undefined && arg.$ === "EarlyBound") {
    const def_id = arg._0;
    const item_def_id = tcx.hir_ty_param_owner(def_id);
    const generics = tcx.generics_of(item_def_id) as Generics;
    const index = map_index(generics.param_def_id_to_index, LocalDefId.to_def_id(def_id));
    ty = Ty.new_param(tcx, index, tcx.hir_ty_param_name(def_id));
  } else if (arg !== undefined && arg.$ === "Error") {
    ty = Ty.new_error(tcx, arg._0);
  } else {
    return bug(`unexpected bound var resolution for ${debug_HirId(hir_id, PLAIN)}: ${debug_opt_resolved_arg(arg)}`);
  }
  return this.check_param_uses_if_mcg(ty, tcx.hir_span(hir_id), false, fold_Ty);
};

/** `if let DefKind::Ctor(<ctor_of>, _) = def_kind` */
function is_ctor_of(def_kind: DefKind, ctor_of: CtorOf): boolean {
  return def_kind.$ === "Ctor" && def_kind._0 === ctor_of;
}

/** `map[&key]` (`Index for HashMap`): panics with std's text when the key is missing. */
function map_index<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined) panic("key not found in map");
  return v;
}

/// Lower a const parameter from the HIR to our internal notion of a constant.
///
/// Early-bound const parameters get lowered to [`ty::ConstKind::Param`]
/// and late-bound ones to [`ty::ConstKind::Bound`].
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2364 lower_const_param
HirTyLowerer.prototype.lower_const_param = function (this: HirTyLowerer, param_def_id: DefId, path_hir_id: HirId): Const {
  const tcx = this.tcx();

  let ct: Const;
  const arg = tcx.named_bound_var(path_hir_id) as RbvResolvedArg | undefined;
  if (arg !== undefined && arg.$ === "EarlyBound") {
    // Find the name and index of the const parameter by indexing the generics of
    // the parent item and construct a `ParamConst`.
    const item_def_id = tcx.parent(param_def_id);
    const generics = tcx.generics_of(item_def_id) as Generics;
    const index = map_index(generics.param_def_id_to_index, param_def_id);
    const name = tcx.item_name(param_def_id);
    ct = Const.new_param(tcx, ParamConst.new(index, name));
  } else if (arg !== undefined && arg.$ === "LateBound") {
    const [debruijn, index] = [arg._0, arg._1];
    ct = Const.new_bound(tcx, debruijn, BoundConst.new(BoundVar.from_u32(index)));
  } else if (arg !== undefined && arg.$ === "Error") {
    ct = Const.new_error(tcx, arg._0);
  } else {
    return bug(`unexpected bound var resolution for ${debug_HirId(path_hir_id, PLAIN)}: ${debug_opt_resolved_arg(arg)}`);
  }
  return this.check_param_uses_if_mcg(ct, tcx.hir_span(path_hir_id), false, fold_Const);
};

/// Lower a [`hir::ConstArg`] to a (type-level) [`ty::Const`].
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2390 lower_const_arg
HirTyLowerer.prototype.lower_const_arg = function (this: HirTyLowerer, const_arg: hir.ConstArg, ty: Ty): Const {
  const tcx = this.tcx();

  if (const_arg.kind.$ === "Anon") {
    const anon = const_arg.kind._0;
    // FIXME(generic_const_parameter_types): Ideally we remove these errors below when
    // we have the ability to intermix typeck of anon const const args with the parent
    // bodies typeck.

    // We also error if the type contains any regions as effectively any region will wind
    // up as a region variable in mir borrowck. It would also be somewhat concerning if
    // hir typeck was using equality but mir borrowck wound up using subtyping as that could
    // result in a non-infer in hir typeck but a region variable in borrowck.
    if (
      tcx.features().generic_const_parameter_types() &&
      (TypeVisitableExt.has_free_regions(ty, fold_Ty) || TypeVisitableExt.has_erased_regions(ty, fold_Ty))
    ) {
      const e = this.dcx().span_err(const_arg.span, "anonymous constants with lifetimes in their type are not yet supported");
      tcx.feed_anon_const_type(anon.def_id, EarlyBinder.bind(tcx, Ty.new_error(tcx, e), fold_Ty));
      return Const.new_error(tcx, e);
    }
    // We must error if the instantiated type has any inference variables as we will
    // use this type to feed the `type_of` and query results must not contain inference
    // variables otherwise we will ICE.
    if (TypeVisitableExt.has_non_region_infer(ty, fold_Ty)) {
      const e = this.dcx().span_err(const_arg.span, "anonymous constants with inferred types are not yet supported");
      tcx.feed_anon_const_type(anon.def_id, EarlyBinder.bind(tcx, Ty.new_error(tcx, e), fold_Ty));
      return Const.new_error(tcx, e);
    }
    // We error when the type contains unsubstituted generics since we do not currently
    // give the anon const any of the generics from the parent.
    if (TypeVisitableExt.has_non_region_param(ty, fold_Ty)) {
      const e = this.dcx().span_err(const_arg.span, "anonymous constants referencing generics are not yet supported");
      tcx.feed_anon_const_type(anon.def_id, EarlyBinder.bind(tcx, Ty.new_error(tcx, e), fold_Ty));
      return Const.new_error(tcx, e);
    }

    tcx.feed_anon_const_type(anon.def_id, EarlyBinder.bind(tcx, ty, fold_Ty));
  }

  const hir_id = const_arg.hir_id;
  const kind = const_arg.kind;
  switch (kind.$) {
    case "Tup":
      return this.lower_const_arg_tup(kind._0, ty, const_arg.span);
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "Resolved") {
        const [maybe_qself, path] = [qpath._0, qpath._1];
        // debug!(?maybe_qself, ?path);
        const opt_self_ty = maybe_qself !== undefined ? this.lower_ty(maybe_qself) : undefined;
        return this.lower_resolved_const_path(opt_self_ty, path, hir_id);
      } else {
        const [hir_self_ty, segment] = [qpath._0, qpath._1];
        // debug!(?hir_self_ty, ?segment);
        const self_ty = this.lower_ty(hir_self_ty);
        const r = this.lower_type_relative_const_path(self_ty, hir_self_ty, segment, hir_id, const_arg.span);
        return r.$ === "Ok" ? r._0 : Const.new_error(tcx, r._0);
      }
    }
    case "Struct":
      return this.lower_const_arg_struct(hir_id, kind._0, kind._1, const_arg.span);
    case "TupleCall":
      return this.lower_const_arg_tuple_call(hir_id, kind._0, kind._1, const_arg.span);
    case "Array":
      return this.lower_const_arg_array(kind._0, ty);
    case "Anon":
      return this.lower_const_arg_anon(kind._0);
    case "Infer":
      return this.ct_infer(undefined, const_arg.span);
    case "Error":
      return Const.new_error(tcx, kind._0);
    case "Literal":
      return this.lower_const_arg_literal(kind.lit, kind.negated, ty, const_arg.span);
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2482 lower_const_arg_array
HirTyLowerer.prototype.lower_const_arg_array = function (this: HirTyLowerer, array_expr: hir.ConstArgArrayExpr, ty: Ty): Const {
  const tcx = this.tcx();

  let elem_ty: Ty;
  const k = ty.kind();
  if (k.$ === "Array") {
    elem_ty = k._0;
  } else if (k.$ === "Error") {
    return Const.new_error(tcx, k._0);
  } else {
    const e = tcx.dcx().span_err(array_expr.span, `expected \`${display_Ty(ty)}\`, found const array`);
    return Const.new_error(tcx, e);
  }

  const elems = array_expr.elems.map((elem) => this.lower_const_arg(elem, elem_ty));

  // The array len passed in the type might be an infer var, or a const param, or it could
  // just be an incorrect constant. So, construct the resulting valtree's type based on the
  // provided syntax rather than the expected type. The surrounding typeck will catch any
  // mismatches.
  const valtree_ty = Ty.new_array(tcx, elem_ty, elems.length);
  const valtree = ValTree.from_branches(tcx, elems);
  return Const.new_value(tcx, valtree, valtree_ty);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2515 try_recover_misrepresented_function_call
HirTyLowerer.prototype.try_recover_misrepresented_function_call = function (
  this: HirTyLowerer,
  hir_self_ty: hir.Ty,
  span: Span,
): ErrorGuaranteed | undefined {
  // Only an enum can host a tuple-variant constructor (`<Option<u32>>::Some(..)`).
  // For any other self type, a type-relative call is an associated function, not a
  // constructor, and must be wrapped in `const { ... }`. We catch that here, before
  // lowering the self type, so a generic struct/union written without its args
  // (`FieldName::len()`, from `tracing`'s macros) reports this clear error instead
  // of a spurious E0107 "missing generics" (#157152), and a primitive or foreign
  // type reports it instead of an opaque downstream resolution error. Enums,
  // aliases, `Self` and type parameters are let through: each may resolve to an
  // enum, so they must reach constructor lowering.
  const self_ty_res: Res =
    hir_self_ty.kind.$ === "Path" && hir_self_ty.kind._0.$ === "Resolved" ? hir_self_ty.kind._0._1.res : { $: "Err" };
  return (self_ty_res.$ === "Def" &&
    (self_ty_res._0.$ === "Struct" || self_ty_res._0.$ === "Union" || self_ty_res._0.$ === "ForeignTy")) ||
    self_ty_res.$ === "PrimTy"
    ? this.dcx().emit_err(ComplexConstArg_diagnostic({ span }))
    : undefined;
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2540 lower_const_arg_tuple_call
HirTyLowerer.prototype.lower_const_arg_tuple_call = function (
  this: HirTyLowerer,
  hir_id: HirId,
  qpath: hir.QPath,
  args: readonly hir.ConstArg[],
  span: Span,
): Const {
  const tcx = this.tcx();

  const non_adt_or_variant_res = (): Const => {
    const e = tcx.dcx().span_err(span, "tuple constructor with invalid base path");
    return Const.new_error(tcx, e);
  };

  let ctor_const: Const;
  if (qpath.$ === "Resolved") {
    const [maybe_qself, path] = [qpath._0, qpath._1];
    const opt_self_ty = maybe_qself !== undefined ? this.lower_ty(maybe_qself) : undefined;
    ctor_const = this.lower_resolved_const_path(opt_self_ty, path, hir_id);
  } else {
    const [hir_self_ty, segment] = [qpath._0, qpath._1];
    const e = this.try_recover_misrepresented_function_call(hir_self_ty, span);
    if (e !== undefined) {
      return Const.new_error(tcx, e);
    }

    const self_ty = this.lower_ty(hir_self_ty);
    const r = this.lower_type_relative_const_path(self_ty, hir_self_ty, segment, hir_id, span);
    if (r.$ === "Ok") {
      ctor_const = r._0;
    } else {
      return non_adt_or_variant_res();
    }
  }

  const value = ctor_const.try_to_value();
  if (value === undefined) {
    return non_adt_or_variant_res();
  }

  let adt_def: AdtDef;
  let adt_args: Binder<GenericArgs>;
  let variant_did: DefId;
  const k = value.ty.kind();
  if (k.$ === "FnDef" && is_ctor_of(tcx.def_kind(k._0), "Variant")) {
    const parent_did = tcx.parent(k._0);
    const enum_did = tcx.parent(parent_did);
    [adt_def, adt_args, variant_did] = [tcx.adt_def(enum_did) as AdtDef, k._1, parent_did];
  } else if (k.$ === "FnDef" && is_ctor_of(tcx.def_kind(k._0), "Struct")) {
    const parent_did = tcx.parent(k._0);
    [adt_def, adt_args, variant_did] = [tcx.adt_def(parent_did) as AdtDef, k._1, parent_did];
  } else {
    const e = this.dcx().emit_err(ComplexConstArg_diagnostic({ span }));
    return Const.new_error(tcx, e);
  }

  const variant_def = adt_def.variant_with_id(variant_did);
  const variant_idx = adt_def.variant_index_with_id(variant_did);

  if (args.length !== variant_def.fields.length) {
    const e = tcx.dcx().span_err(span, `tuple constructor has ${variant_def.fields.length} arguments but ${args.length} were provided`);
    return Const.new_error(tcx, e);
  }

  const fields: Const[] = [];
  for (let i = 0; i < Math.min(variant_def.fields.length, args.length); i++) {
    const [field_def, arg] = [variant_def.fields[i]!, args[i]!];
    fields.push(
      this.lower_const_arg(
        arg,
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(tcx.type_of(field_def.did) as EarlyBinder<Ty>, tcx, unwrap(Binder.no_bound_vars(adt_args, fold_GenericArgs)), fold_Ty),
        ),
      ),
    );
  }

  let opt_discr_const: Const | undefined;
  if (adt_def.is_enum()) {
    const valtree = ValTree.from_scalar_int(tcx, ScalarInt.from_u32(variant_idx));
    opt_discr_const = Const.new_value(tcx, valtree, tcx.types.u32);
  } else {
    opt_discr_const = undefined;
  }

  const valtree = ValTree.from_branches(tcx, [...(opt_discr_const !== undefined ? [opt_discr_const] : []), ...fields]);
  const adt_ty = Ty.new_adt(tcx, adt_def, unwrap(Binder.no_bound_vars(adt_args, fold_GenericArgs)));
  return Const.new_value(tcx, valtree, adt_ty);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2643 lower_const_arg_tup
HirTyLowerer.prototype.lower_const_arg_tup = function (this: HirTyLowerer, exprs: readonly hir.ConstArg[], ty: Ty, span: Span): Const {
  const tcx = this.tcx();

  const found_tuple = (): string => {
    const r = tcx.sess.source_map().span_to_snippet(span);
    return r.$ === "Ok" ? `\`${r._0.toString()}\`` : "const tuple";
  };

  let tys: List<Ty>;
  const k = ty.kind();
  if (k.$ === "Tuple") {
    tys = k._0;
  } else if (k.$ === "Error") {
    return Const.new_error(tcx, k._0);
  } else {
    const e = tcx.dcx().span_err(span, `expected \`${display_Ty(ty)}\`, found ${found_tuple()}`);
    return Const.new_error(tcx, e);
  }

  if (exprs.length !== tys.length) {
    const e = tcx.dcx().span_err(span, `expected \`${display_Ty(ty)}\`, found ${found_tuple()}`);
    return Const.new_error(tcx, e);
  }

  const lowered: Const[] = [];
  for (let i = 0; i < Math.min(exprs.length, tys.length); i++) {
    lowered.push(this.lower_const_arg(exprs[i]!, tys[i]!));
  }

  const valtree = ValTree.from_branches(tcx, lowered);
  return Const.new_value(tcx, valtree, ty);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2684 lower_const_arg_struct
HirTyLowerer.prototype.lower_const_arg_struct = function (
  this: HirTyLowerer,
  hir_id: HirId,
  qpath: hir.QPath,
  inits: readonly hir.ConstArgExprField[],
  span: Span,
): Const {
  // FIXME(mgca): try to deduplicate this function with
  // the equivalent HIR typeck logic.
  const tcx = this.tcx();

  const non_adt_or_variant_res = (): Const => {
    const e = tcx.dcx().span_err(span, "struct expression with invalid base path");
    return Const.new_error(tcx, e);
  };

  const { res: opt_res, ty } = this.lower_path_for_struct_expr(qpath, span, hir_id);

  let variant_did: DefId;
  if (qpath.$ === "Resolved") {
    const path = qpath._1;
    // debug!(?maybe_qself, ?path);
    const res = path.res;
    if (res.$ === "Def" && (res._0.$ === "Variant" || res._0.$ === "Struct")) {
      variant_did = res._1;
    } else {
      return non_adt_or_variant_res();
    }
  } else {
    // debug!(?hir_self_ty, ?segment);

    let res_def_id: DefId;
    if (opt_res.$ === "Ok") {
      const r = opt_res._0;
      const def_kind = tcx.def_kind(Res.def_id(r, debug_HirId));
      if (def_kind.$ === "Variant" || def_kind.$ === "Struct") {
        res_def_id = Res.def_id(r, debug_HirId);
      } else {
        return non_adt_or_variant_res();
      }
    } else {
      return Const.new_error(tcx, opt_res._0);
    }

    variant_did = res_def_id;
  }

  const k = ty.kind();
  if (k.$ !== "Adt") return unreachable();
  const [adt_def, adt_args] = [k._0, k._1];

  const variant_def = adt_def.variant_with_id(variant_did);
  const variant_idx = adt_def.variant_index_with_id(variant_did);

  for (const init of inits) {
    if (!variant_def.fields.some((field_def) => field_def.name === init.field.name)) {
      let err: Diag;
      if (adt_def.is_enum()) {
        err = struct_span_code_err(
          tcx.dcx(),
          init.field.span,
          E0559,
          `variant \`${display_Ty(ty)}::${display_Symbol(variant_def.name)}\` has no field named \`${display_Ident(init.field)}\``,
        );
      } else {
        err = struct_span_code_err(
          tcx.dcx(),
          init.field.span,
          E0560,
          `struct \`${display_Symbol(variant_def.name)}\` has no field named \`${display_Ident(init.field)}\``,
        );
      }
      if (adt_def.is_enum()) {
        err.span_label(init.field.span, `\`${display_Ty(ty)}::${display_Symbol(variant_def.name)}\` does not have this field`);
      } else {
        err.span_label(init.field.span, `\`${display_Symbol(variant_def.name)}\` does not have this field`);
      }
      return Const.new_error(tcx, err.emit_err());
    }
  }

  const fields = variant_def.fields.map((field_def): Const => {
    // FIXME(mgca): we aren't really handling privacy, stability,
    // or macro hygeniene but we should.
    const init_expr = inits.filter((init_expr) => init_expr.field.name === field_def.name);

    const first = init_expr[0];
    if (first !== undefined) {
      const expr = first;
      const second = init_expr[1];
      if (second !== undefined) {
        const e = tcx.dcx().span_err(second.span, `struct expression with multiple initialisers for \`${display_Symbol(field_def.name)}\``);
        return Const.new_error(tcx, e);
      }

      return this.lower_const_arg(
        expr.expr,
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(field_def.did) as EarlyBinder<Ty>, tcx, adt_args, fold_Ty)),
      );
    } else {
      const e = tcx.dcx().span_err(span, `struct expression with missing field initialiser for \`${display_Symbol(field_def.name)}\``);
      return Const.new_error(tcx, e);
    }
  });

  let opt_discr_const: Const | undefined;
  if (adt_def.is_enum()) {
    const valtree = ValTree.from_scalar_int(tcx, ScalarInt.from_u32(variant_idx));
    opt_discr_const = Const.new_value(tcx, valtree, tcx.types.u32);
  } else {
    opt_discr_const = undefined;
  }

  const valtree = ValTree.from_branches(tcx, [...(opt_discr_const !== undefined ? [opt_discr_const] : []), ...fields]);
  return Const.new_value(tcx, valtree, ty);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2827 lower_path_for_struct_expr
HirTyLowerer.prototype.lower_path_for_struct_expr = function (
  this: HirTyLowerer,
  qpath: hir.QPath,
  path_span: Span,
  hir_id: HirId,
): ResolvedStructPath {
  if (qpath.$ === "Resolved") {
    const [maybe_qself, path] = [qpath._0, qpath._1];
    const self_ty = maybe_qself !== undefined ? this.lower_ty(maybe_qself) : undefined;
    const ty = this.lower_resolved_ty_path(self_ty, path, hir_id, "Yes");
    return { res: Ok(path.res), ty };
  } else {
    const [hir_self_ty, segment] = [qpath._0, qpath._1];
    const self_ty = this.lower_ty(hir_self_ty);

    const result = this.lower_type_relative_ty_path(self_ty, hir_self_ty, segment, hir_id, path_span, "Yes");
    const ty = result.$ === "Ok" ? result._0[0] : Ty.new_error(this.tcx(), result._0);

    return {
      res: result.$ === "Ok" ? Ok<Res>({ $: "Def", _0: result._0[1], _1: result._0[2] }) : result,
      ty,
    };
  }
};

/// Lower a [resolved][hir::QPath::Resolved] path to a (type-level) constant.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:2863 lower_resolved_const_path
HirTyLowerer.prototype.lower_resolved_const_path = function (
  this: HirTyLowerer,
  opt_self_ty: Ty | undefined,
  path: hir.Path,
  hir_id: HirId,
): Const {
  const tcx = this.tcx();
  const span = path.span;
  let ct: Const;
  const res = path.res;
  if (res.$ === "Def" && res._0.$ === "ConstParam") {
    const def_id = res._1;
    assert_no_self_ty(opt_self_ty);
    void this.prohibit_generic_args(path.segments, { $: "Param", _0: def_id });
    ct = this.lower_const_param(def_id, hir_id);
  } else if (res.$ === "Def" && res._0.$ === "Const") {
    const did = res._1;
    const kind: AliasConstKind = { $: "Free", def_id: did };
    const r = this.check_const_item_in_type_system(kind, span);
    if (r.$ === "Err") {
      return Const.new_error(this.tcx(), r._0);
    }

    assert_no_self_ty(opt_self_ty);
    if (path.segments.length === 0) bug();
    const leading_segments = path.segments.slice(0, -1);
    const segment = path.segments[path.segments.length - 1]!;
    void this.prohibit_generic_args(leading_segments, GenericsArgsErrExtend.None);
    const args = this.lower_generic_args_of_path_segment(span, did, segment);
    const alias = AliasConst.new(tcx, kind, args);
    ct = Const.new_alias(tcx, "No", alias);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Const") {
    const kind = res._0;
    const ctor_of = res._0._0;
    const did = res._1;
    assert_no_self_ty(opt_self_ty);
    const generic_segments = this.probe_generic_path_segments(path.segments, opt_self_ty, kind, did, span);
    const indices = new Set<number>(generic_segments.map(({ _1: index }) => index));
    void this.prohibit_generic_args(
      filter_map_enumerate(path.segments, (index, seg) => (!indices.has(index) ? seg : undefined)),
      { $: "DefVariant", _0: path.segments },
    );

    const parent_did = tcx.parent(did);
    let generics_did: DefId;
    switch (ctor_of) {
      case "Variant":
        generics_did = tcx.parent(parent_did);
        break;
      case "Struct":
        generics_did = parent_did;
        break;
    }
    const args = this.lower_generic_args_of_path_segment(span, generics_did, index_slice(path.segments, index_slice(generic_segments, 0)._1));
    ct = this.construct_const_ctor_value(did, ctor_of, args);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn") {
    const ctor_of = res._0._0;
    const did = res._1;
    assert_no_self_ty(opt_self_ty);
    const generic_segments = this.probe_generic_path_segments(path.segments, opt_self_ty, { $: "Ctor", _0: ctor_of, _1: "Const" }, did, span);
    const indices = new Set<number>(generic_segments.map(({ _1: index }) => index));
    void this.prohibit_generic_args(
      filter_map_enumerate(path.segments, (index, seg) => (!indices.has(index) ? seg : undefined)),
      { $: "DefVariant", _0: path.segments },
    );

    const parent_did = tcx.parent(did);
    const generics_did = is_ctor_of(tcx.def_kind(did), "Variant") ? tcx.parent(parent_did) : parent_did;
    const args = this.lower_generic_args_of_path_segment(span, generics_did, index_slice(path.segments, index_slice(generic_segments, 0)._1));

    ct = Const.zero_sized(tcx, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(did) as EarlyBinder<Ty>, tcx, args, fold_Ty)));
  } else if (res.$ === "Def" && res._0.$ === "AssocConst") {
    const did = res._1;
    let trait_segment: hir.PathSegment | undefined;
    if (path.segments.length >= 2) {
      const modules = path.segments.slice(0, -2);
      const trait_ = path.segments[path.segments.length - 2]!;
      void this.prohibit_generic_args(modules, GenericsArgsErrExtend.None);
      trait_segment = trait_;
    } else {
      trait_segment = undefined;
    }
    const r = this.lower_resolved_assoc_const_path(span, opt_self_ty, did, trait_segment, unwrap(path.segments[path.segments.length - 1]));
    ct = r.$ === "Ok" ? r._0 : Const.new_error(tcx, r._0);
  } else if (res.$ === "Def" && res._0.$ === "Static") {
    const guar = this.dcx().span_err(path.span, "static items cannot be used as const arguments");
    return Const.new_error(tcx, guar);
  } else if (res.$ === "Def" && (res._0.$ === "Fn" || res._0.$ === "AssocFn")) {
    // FIXME(const_generics): create real consts to allow fn items as const paths.
    // Lowering these to recovered `FnDef` consts currently interacts poorly with WF
    // checking: WF of a `FnDef` walks the function signature, so a signature that mentions
    // the same function item as a const arg can recurse until it overflows/segfaults.
    const guar = this.dcx().struct_span_err(span, "function items cannot be used as const args").emit_err();
    ct = Const.new_error(tcx, guar);
  } else {
    // Exhaustive match to be clear about what exactly we're considering to be
    // an invalid Res for a const path.
    // PORT: the arm `res @ (Res::Def(DefKind::Mod | Enum | Variant | Struct | OpaqueTy | TyAlias | TraitAlias | AssocTy |
    // Union | Trait | ForeignTy | TyParam | Macro(_) | LifetimeParam | Use | ForeignMod | AnonConst | Field | Impl { .. } |
    // Closure | ExternCrate | GlobalAsm | SyntheticCoroutineBody | TestBinderConstraints, _) | Res::PrimTy(_) |
    // Res::SelfTyParam { .. } | Res::SelfTyAlias { .. } | Res::SelfCtor(_) | Res::Local(_) | Res::ToolMod |
    // Res::OpenMod(..) | Res::NonMacroAttr(_) | Res::Err)`: every resolution the arms above do not take (upstream's match
    // is exhaustive).
    ct = Const.new_error_with_message(tcx, span, `invalid Res ${debug_Res(res, PLAIN, debug_HirId)} for const path`);
  }
  return this.check_param_uses_if_mcg(ct, span, false, fold_Const);
};

/// Literals are eagerly converted to a constant, everything else becomes `ConstKind::Alias`.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3032 lower_const_arg_anon
HirTyLowerer.prototype.lower_const_arg_anon = function (this: HirTyLowerer, anon: hir.AnonConst): Const {
  const tcx = this.tcx();

  const expr = tcx.hir_body(anon.body).value;
  // debug!(?expr);

  // FIXME(generic_const_parameter_types): We should use the proper generic args
  // here. It's only used as a hint for literals so doesn't matter too much to use the right
  // generic arguments, just weaker type inference.
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(anon.def_id) as EarlyBinder<Ty>));

  const v = this.try_lower_anon_const_lit(ty, expr);
  if (v !== undefined) {
    return v;
  } else {
    return Const.new_alias(
      tcx,
      "No",
      AliasConst.new(
        tcx,
        { $: "Anon", def_id: LocalDefId.to_def_id(anon.def_id) },
        RawList.identity_for_item(tcx, LocalDefId.to_def_id(anon.def_id)),
      ),
    );
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3058 lower_const_arg_literal
HirTyLowerer.prototype.lower_const_arg_literal = function (this: HirTyLowerer, kind: LitKind, neg: boolean, ty_: Ty, span: Span): Const {
  const tcx = this.tcx();

  const ty = !TypeVisitableExt.has_infer(ty_, fold_Ty) ? ty_ : undefined;

  if (kind.$ === "Err") {
    return Const.new_error(tcx, kind._0);
  }
  const input: LitToConstInput = { lit: kind, ty, neg };
  const value = tcx.at(span).lit_to_const(input) as Value | undefined;
  if (value !== undefined) {
    return Const.new_value(tcx, value.valtree, value.ty);
  } else {
    const e = tcx.dcx().span_err(span, "type annotations needed for the literal");
    return Const.new_error(tcx, e);
  }
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3083 try_lower_anon_const_lit
HirTyLowerer.prototype.try_lower_anon_const_lit = function (this: HirTyLowerer, ty: Ty, expr_: hir.Expr): Const | undefined {
  const tcx = this.tcx();

  // Unwrap a block, so that e.g. `{ 1 }` is recognised as a literal. This makes the
  // performance optimisation of directly lowering anon consts occur more often.
  let expr: hir.Expr;
  if (expr_.kind.$ === "Block" && expr_.kind._0.stmts.length === 0 && expr_.kind._0.expr !== undefined) {
    expr = unwrap(expr_.kind._0.expr);
  } else {
    expr = expr_;
  }

  let lit_input: LitToConstInput | undefined;
  const k = expr.kind;
  if (k.$ === "Lit") {
    lit_input = { lit: k._0.node, ty, neg: false };
  } else if (k.$ === "Unary" && k._0 === "Neg") {
    const inner = k._1;
    if (inner.kind.$ === "Lit") {
      lit_input = { lit: inner.kind._0.node, ty, neg: true };
    } else {
      lit_input = undefined;
    }
  } else {
    lit_input = undefined;
  }

  if (lit_input === undefined) return undefined;
  const l = lit_input;
  if (const_lit_matches_ty(tcx, l.lit, ty, l.neg)) {
    const value = tcx.at(expr.span).lit_to_const(l) as Value | undefined;
    return value !== undefined ? Const.new_value(tcx, value.valtree, value.ty) : undefined;
  } else {
    return undefined;
  }
};

/// `alias_const` is a const item used in the type system. Checks if that's OK.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3124 check_const_item_in_type_system
HirTyLowerer.prototype.check_const_item_in_type_system = function (
  this: HirTyLowerer,
  alias_const: AliasConstKind,
  span: Span,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();
  if (tcx.features().gca_const_items() || AliasConstKind.is_direct_const(alias_const, as_interner(tcx))) {
    return Ok(undefined);
  } else {
    const err = this.dcx().struct_span_err(span, "use of `const` in the type system not marked as direct");
    let hir_node: hir.Node | undefined;
    switch (alias_const.$) {
      case "Projection":
      case "InherentSelf":
      case "InherentImpl":
      case "Free":
      case "Anon": {
        const id = alias_const.def_id.as_local();
        hir_node = id !== undefined ? tcx.hir_node_by_def_id(id) : undefined;
        break;
      }
    }
    if (hir_node !== undefined) {
      const body_id = hir.Node.body_id(hir_node);
      if (body_id !== undefined) {
        const body_span = tcx.hir_body(body_id).value.span;

        err.multipart_suggestion(
          "add gca!() to the right-hand side of the constant",
          [
            [Span.shrink_to_lo(body_span), "core::gca!("],
            [Span.shrink_to_hi(body_span), ")"],
          ],
          "MaybeIncorrect",
        );
      } else if (alias_const.$ === "Projection") {
        const node = hir.Node.expect_trait_item(hir_node);
        const sp = Span.shrink_to_lo(node.span);
        err.span_suggestion_verbose(sp, "add `#[rustc_always_gca]` to the constant", "#[rustc_always_gca] ", "MaybeIncorrect");
      }
    } else {
      err.note("only consts with a `gca!` right-hand side may be used in types");
    }
    return Err(err.emit_err());
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3174 lower_delegation_ty
HirTyLowerer.prototype.lower_delegation_ty = function (this: HirTyLowerer, infer: hir.InferDelegation): Ty {
  switch (infer.$) {
    case "DefId": {
      const def_id = infer._0;
      return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx().type_of(def_id) as EarlyBinder<Ty>));
    }
    case "Sig": {
      const idx = infer._1;
      const delegation_sig = this.tcx().inherit_sig_for_delegation_item(this.item_def_id()) as readonly Ty[];

      switch (idx.$) {
        case "Input":
          return index_slice(delegation_sig, idx._0);
        case "Output":
          return unwrap(delegation_sig[delegation_sig.length - 1]);
      }
    }
  }
};

/// Lower a type from the HIR to our internal notion of a type.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3192 lower_ty
HirTyLowerer.prototype.lower_ty = function (this: HirTyLowerer, hir_ty: hir.Ty): Ty {
  const tcx = this.tcx();

  let result_ty: Ty;
  const kind = hir_ty.kind;
  switch (kind.$) {
    case "InferDelegation":
      result_ty = this.lower_delegation_ty(kind._0);
      break;
    case "Slice":
      result_ty = Ty.new_slice(tcx, this.lower_ty(kind._0));
      break;
    case "Ptr":
      result_ty = Ty.new_ptr(tcx, this.lower_ty(kind._0), kind._1);
      break;
    case "Ref": {
      const r = this.lower_lifetime(kind._0, RegionInferReason.Reference);
      // debug!(?r);
      const t = this.lower_ty(kind._1);
      result_ty = Ty.new_ref(tcx, r, t, kind._2);
      break;
    }
    case "Never":
      result_ty = tcx.types.never;
      break;
    case "Tup": {
      const fields = kind._0;
      const this_ = this;
      result_ty = Ty.new_tup_from_iter(
        tcx,
        (function* () {
          for (const t of fields) yield this_.lower_ty(t);
        })(),
      ) as Ty;
      break;
    }
    case "FnPtr": {
      const bf = kind._0;
      check_c_variadic_abi(tcx, bf.decl, bf.abi, hir_ty.span);

      result_ty = Ty.new_fn_ptr(tcx, this.lower_fn_ty(hir_ty.hir_id, bf.safety, bf.abi, bf.decl, undefined, hir_ty));
      break;
    }
    case "UnsafeBinder": {
      const binder = kind._0;
      result_ty = Ty.new_unsafe_binder(tcx, Binder.bind_with_vars(this.lower_ty(binder.inner_ty), tcx.late_bound_vars(hir_ty.hir_id)));
      break;
    }
    case "TraitObject": {
      const [bounds, tagged_ptr] = [kind._0, kind._1];
      const lifetime = tagged_ptr.pointer();
      const syntax = tagged_ptr.tag();
      result_ty = this.lower_trait_object_ty(hir_ty.span, hir_ty.hir_id, bounds, lifetime, syntax);
      break;
    }
    case "Path": {
      const qpath = kind._0;
      if (qpath.$ === "Resolved") {
        const [maybe_qself, path] = [qpath._0, qpath._1];
        const last_args = path.segments[path.segments.length - 1]?.args;
        if (last_args !== undefined && last_args.parenthesized === "ReturnTypeNotation") {
          // If we encounter a fully qualified path with RTN generics, then it must have
          // *not* gone through `lower_ty_maybe_return_type_notation`, and therefore
          // it's certainly in an illegal position.
          const guar = this.dcx().emit_err(BadReturnTypeNotation_diagnostic({ span: hir_ty.span, suggestion: undefined }));
          result_ty = Ty.new_error(tcx, guar);
        } else {
          // debug!(?maybe_qself, ?path);
          const opt_self_ty = maybe_qself !== undefined ? this.lower_ty(maybe_qself) : undefined;
          result_ty = this.lower_resolved_ty_path(opt_self_ty, path, hir_ty.hir_id, "No");
        }
      } else {
        const [hir_self_ty, segment] = [qpath._0, qpath._1];
        if (segment.args !== undefined && segment.args.parenthesized === "ReturnTypeNotation") {
          // If we encounter a type relative path with RTN generics, then it must have
          // *not* gone through `lower_ty_maybe_return_type_notation`, and therefore
          // it's certainly in an illegal position.
          result_ty = Ty.new_error(tcx, lower_ty_rtn_type_relative(this, tcx, hir_ty, hir_self_ty, segment));
        } else {
          // debug!(?hir_self_ty, ?segment);
          const self_ty = this.lower_ty(hir_self_ty);
          const r = this.lower_type_relative_ty_path(self_ty, hir_self_ty, segment, hir_ty.hir_id, hir_ty.span, "No");
          result_ty = r.$ === "Ok" ? r._0[0] : Ty.new_error(tcx, r._0);
        }
      }
      break;
    }
    case "OpaqueDef": {
      const opaque_ty = kind._0;
      // If this is an RPITIT and we are using the new RPITIT lowering scheme, we
      // generate the def_id of an associated type for the trait and return as
      // type a projection.
      let in_trait: LocalDefId | undefined;
      const origin = opaque_ty.origin;
      switch (origin.$) {
        case "FnReturn":
        case "AsyncFn":
          in_trait = origin.in_trait_or_impl === "Trait" ? origin.parent : undefined;
          break;
        case "TyAlias":
          in_trait = undefined;
          break;
      }

      result_ty = this.lower_opaque_ty(opaque_ty.def_id, in_trait);
      break;
    }
    case "TraitAscription": {
      const hir_bounds = kind._0;
      // Impl trait in bindings lower as an infer var with additional
      // set of type bounds.
      const self_ty = this.ty_infer(undefined, hir_ty.span);
      const bounds: [Clause, Span][] = [];
      this.lower_bounds(self_ty, hir_bounds, bounds, RawList.empty(), PredicateFilter.All, "Allowed");
      this.add_implicit_sizedness_bounds(bounds, self_ty, hir_bounds, ImpliedBoundsContext.AssociatedTypeOrImplTrait, hir_ty.span);
      this.register_trait_ascription_bounds(bounds, hir_ty.hir_id, hir_ty.span);
      result_ty = self_ty;
      break;
    }
    case "Array": {
      const [ty, length_] = [kind._0, kind._1];
      const length = this.lower_const_arg(length_, tcx.types.usize);
      result_ty = Ty.new_array_with_const_len(tcx, this.lower_ty(ty), length);
      break;
    }
    case "Infer":
      // Infer also appears as the type of arguments or return
      // values in an ExprKind::Closure, or as
      // the type of local variables. Both of these cases are
      // handled specially and will not descend into this routine.
      result_ty = this.ty_infer(undefined, hir_ty.span);
      break;
    case "Pat": {
      const [ty_, pat] = [kind._0, kind._1];
      const ty_span = ty_.span;
      const ty = this.lower_ty(ty_);
      const r = this.lower_pat_ty_pat(ty, ty_span, pat);
      const pat_ty = r.$ === "Ok" ? Ty.new_pat(tcx, ty, tcx.mk_pat(r._0)) : Ty.new_error(tcx, r._0);
      this.record_ty(pat.hir_id, ty, pat.span);
      result_ty = pat_ty;
      break;
    }
    case "FieldOf": {
      const [ty, { variant, field }] = [kind._0, kind._1];
      result_ty = this.lower_field_of(this.lower_ty(ty), this.mod_id(), ty.span, hir_ty.hir_id, variant, field);
      break;
    }
    case "View": {
      const [ty, fields] = [kind._0, kind._1];
      result_ty = this.lower_view(this.lower_ty(ty), fields, hir_ty.span);
      break;
    }

    case "Err":
      result_ty = Ty.new_error(tcx, kind._0);
      break;
  }

  this.record_ty(hir_ty.hir_id, result_ty, hir_ty.span);
  return result_ty;
};

/**
 * The `let guar = ...` of `lower_ty`'s arm `hir::TyKind::Path(hir::QPath::TypeRelative(hir_self_ty, segment)) if segment.args
 * is ReturnTypeNotation` (mod.rs:3290..3384). PORT: split out of `lower_ty` only to keep its `if let` chains readable; the
 * conditions are evaluated in upstream's order.
 */
function lower_ty_rtn_type_relative(
  self_: HirTyLowerer,
  tcx: TyCtxt,
  hir_ty: hir.Ty,
  hir_self_ty: hir.Ty,
  segment: hir.PathSegment,
): ErrorGuaranteed {
  // if let hir::Node::LetStmt(stmt) = tcx.parent_hir_node(hir_ty.hir_id)
  //     && let None = stmt.init
  //     && let hir::TyKind::Path(hir::QPath::Resolved(_, self_ty_path)) = hir_self_ty.kind
  //     && let Res::Def(DefKind::Enum | DefKind::Struct | DefKind::Union, def_id) = self_ty_path.res
  //     && let Some(_) = tcx.inherent_impls(def_id).iter().flat_map(..).filter(..).next()
  const stmt1 = ((): hir.LetStmt | undefined => {
    const node = tcx.parent_hir_node(hir_ty.hir_id);
    if (node.$ !== "LetStmt") return undefined;
    const stmt = node._0;
    if (stmt.init !== undefined) return undefined;
    if (!(hir_self_ty.kind.$ === "Path" && hir_self_ty.kind._0.$ === "Resolved")) return undefined;
    const self_ty_path = hir_self_ty.kind._0._1;
    const res = self_ty_path.res;
    if (!(res.$ === "Def" && (res._0.$ === "Enum" || res._0.$ === "Struct" || res._0.$ === "Union"))) return undefined;
    const def_id = res._1;
    for (const imp of tcx.inherent_impls(def_id)) {
      for (const assoc of AssocItems.filter_by_name_unhygienic(tcx.associated_items(imp) as AssocItems, segment.ident.name)) {
        if (assoc.kind.$ === "Fn" && assoc.kind.has_self === false) {
          return stmt;
        }
      }
    }
    return undefined;
  })();
  if (stmt1 !== undefined) {
    const stmt = stmt1;
    // `let x: S::new(valid_in_ty_ctxt);` -> `let x = S::new(valid_in_ty_ctxt);`
    const err = tcx.dcx().struct_span_err(hir_ty.span, "expected type, found associated function call");
    const between = eq_ctxt_suggestion_span(stmt.pat.span, hir_ty.span);
    if (between !== undefined) {
      err.span_suggestion_verbose(between, "use `=` if you meant to assign", " = ", "MaybeIncorrect");
    }
    return self_.dcx().try_steal_replace_and_emit_err(hir_ty.span, "ReturnTypeNotation", err);
  }
  // else if let hir::Node::LetStmt(stmt) = tcx.parent_hir_node(hir_ty.hir_id)
  //     && let None = stmt.init
  //     && let hir::TyKind::Path(hir::QPath::Resolved(_, self_ty_path)) = hir_self_ty.kind
  //     && let Res::PrimTy(_) = self_ty_path.res
  //     && self.dcx().has_stashed_diagnostic(hir_ty.span, StashKey::ReturnTypeNotation)
  const stmt2 = ((): hir.LetStmt | undefined => {
    const node = tcx.parent_hir_node(hir_ty.hir_id);
    if (node.$ !== "LetStmt") return undefined;
    const stmt = node._0;
    if (stmt.init !== undefined) return undefined;
    if (!(hir_self_ty.kind.$ === "Path" && hir_self_ty.kind._0.$ === "Resolved")) return undefined;
    const self_ty_path = hir_self_ty.kind._0._1;
    if (self_ty_path.res.$ !== "PrimTy") return undefined;
    if (!self_.dcx().has_stashed_diagnostic(hir_ty.span, "ReturnTypeNotation")) return undefined;
    return stmt;
  })();
  if (stmt2 !== undefined) {
    const stmt = stmt2;
    // `let x: i32::something(valid_in_ty_ctxt);` -> `let x = i32::something(valid_in_ty_ctxt);`
    // FIXME: Check that `something` is a valid function in `i32`.
    const err = tcx.dcx().struct_span_err(hir_ty.span, "expected type, found associated function call");
    const between = eq_ctxt_suggestion_span(stmt.pat.span, hir_ty.span);
    if (between !== undefined) {
      err.span_suggestion_verbose(between, "use `=` if you meant to assign", " = ", "MaybeIncorrect");
    }
    return self_.dcx().try_steal_replace_and_emit_err(hir_ty.span, "ReturnTypeNotation", err);
  } else {
    let suggestion: Span | undefined;
    if (self_.dcx().has_stashed_diagnostic(hir_ty.span, "ReturnTypeNotation")) {
      // We already created a diagnostic complaining that `foo(bar)` is wrong and
      // should have been `foo(..)`. Instead, emit only the current error and
      // include that prior suggestion. Changes are that the problems go further,
      // but keep the suggestion just in case. Either way, we want a single error
      // instead of two.
      suggestion = Span.with_hi(Span.shrink_to_hi(segment.ident.span), Span.hi(hir_ty.span));
    } else {
      suggestion = undefined;
    }
    const err = self_.dcx().create_err(BadReturnTypeNotation_diagnostic({ span: hir_ty.span, suggestion }));
    return self_.dcx().try_steal_replace_and_emit_err(hir_ty.span, "ReturnTypeNotation", err);
  }
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3446 lower_pat_ty_pat
HirTyLowerer.prototype.lower_pat_ty_pat = function (this: HirTyLowerer, ty: Ty, ty_span: Span, pat: hir.TyPat): Result<PatternKind, ErrorGuaranteed> {
  const tcx = this.tcx();
  const kind = pat.kind;
  switch (kind.$) {
    case "Range": {
      const [start_, end_] = [kind._0, kind._1];
      const k = ty.kind();
      // Keep this list of types in sync with the list of types that
      // the `RangePattern` trait is implemented for.
      if (k.$ === "Int" || k.$ === "Uint" || k.$ === "Char") {
        const start = this.lower_const_arg(start_, ty);
        const end = this.lower_const_arg(end_, ty);
        return Ok<PatternKind>({ $: "Range", start, end });
      } else {
        return Err(this.dcx().span_delayed_bug(ty_span, "invalid base type for range pattern"));
      }
    }
    case "NotNull":
      return Ok(PatternKind.NotNull);
    case "Or": {
      const patterns = kind._0;
      const this_ = this;
      const r = this.tcx().mk_patterns_from_iter(
        (function* () {
          for (const pat of patterns) {
            const p = this_.lower_pat_ty_pat(ty, ty_span, pat);
            yield p.$ === "Ok" ? Ok(tcx.mk_pat(p._0)) : p;
          }
        })(),
        CollectAndApply_Result,
      );
      return r.$ === "Ok" ? Ok<PatternKind>({ $: "Or", _0: r._0 }) : r;
    }
    case "Err":
      return Err(kind._0);
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3480 lower_field_of
HirTyLowerer.prototype.lower_field_of = function (
  this: HirTyLowerer,
  ty: Ty,
  mod_id: LocalModId,
  ty_span: Span,
  hir_id: HirId,
  variant_: Ident | undefined,
  field: Ident,
): Ty {
  const dcx = this.dcx();
  const tcx = this.tcx();
  const k = ty.kind();
  switch (k.$) {
    case "Adt": {
      const def = k._0;
      const base_did = def.did();
      const kind_name = tcx.def_descr(base_did);
      let variant_idx: VariantIdx;
      let variant: VariantDef;
      if (def.is_enum()) {
        if (variant_ === undefined) {
          const err = dcx
            .create_err(NoVariantNamed_diagnostic({ span: field.span, ident: field, ty }))
            .with_span_help(Span.shrink_to_lo(field.span), "you might be missing a variant here: `Variant.`")
            .emit_err();
          return Ty.new_error(tcx, err);
        }
        const variant_ident = variant_;

        const variants = def.variants();
        const found = variants.findIndex((f) => f.ident(tcx).normalize_to_macros_2_0().eq(variant_ident));
        if (found !== -1) {
          [variant_idx, variant] = [found as VariantIdx, variants[found]!];
        } else {
          const err = dcx.emit_err(NoVariantNamed_diagnostic({ span: variant_ident.span, ident: variant_ident, ty }));
          return Ty.new_error(tcx, err);
        }
      } else {
        if (variant_ !== undefined) {
          const adt_path = tcx.def_path_str(base_did);
          struct_span_code_err(dcx, variant_.span, E0609, `${kind_name} \`${adt_path}\` does not have any variants`)
            .with_span_label(variant_.span, "variant unknown")
            .emit();
        }
        [variant_idx, variant] = [FIRST_VARIANT, def.non_enum_variant()];
      }
      const [ident, def_scope] = tcx.adjust_ident_and_get_scope(field, def.did(), mod_id);
      const field_idx = variant.fields.findIndex((f) => f.ident(tcx).normalize_to_macros_2_0().eq(ident));
      if (field_idx !== -1) {
        const field_ = variant.fields[field_idx]!;
        if (Visibility.is_accessible_from(field_.vis, def_scope, tcx)) {
          tcx.check_stability(field_.did, hir_id, ident.span, undefined);
        } else {
          const adt_path = tcx.def_path_str(base_did);
          struct_span_code_err(dcx, ident.span, E0616, `field \`${display_Ident(ident)}\` of ${kind_name} \`${adt_path}\` is private`)
            .with_span_label(ident.span, "private field")
            .emit();
        }
        return Ty.new_field_representing_type(tcx, ty, variant_idx, field_idx as FieldIdx);
      } else {
        const err = dcx.emit_err(NoFieldOnType_diagnostic({ span: ident.span, field: ident, ty }));
        return Ty.new_error(tcx, err);
      }
    }
    case "Tuple": {
      const tys = k._0;
      const parsed = parse_usize(field.as_str());
      if (parsed === undefined) {
        const err = dcx.emit_err(NoFieldOnType_diagnostic({ span: field.span, field, ty }));
        return Ty.new_error(tcx, err);
      }
      const index = parsed;
      if (field.name !== sym.integer(index)) {
        bug("we parsed above, but now not equal?");
      }
      if (index < BigInt(tys.length)) {
        return Ty.new_field_representing_type(tcx, ty, FIRST_VARIANT, FieldIdx_from_usize(Number(index)));
      } else {
        const err = dcx.emit_err(NoFieldOnType_diagnostic({ span: field.span, field, ty }));
        return Ty.new_error(tcx, err);
      }
    }
    // FIXME(FRTs): support type aliases
    /*
    ty::Alias(AliasTyKind::Free, ty) => {
        return self.lower_field_of(
            ty,
            item_def_id,
            ty_span,
            hir_id,
            variant,
            field,
        );
    }*/
    case "Alias":
      return Ty.new_error(tcx, dcx.span_err(ty_span, `could not resolve fields of \`${display_Ty(ty)}\``));
    case "Error":
      return Ty.new_error(tcx, k._0);
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Foreign":
    case "Str":
    case "RawPtr":
    case "Ref":
    case "FnDef":
    case "FnPtr":
    case "UnsafeBinder":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Slice":
      return Ty.new_error(tcx, dcx.span_err(ty_span, `type \`${display_Ty(ty)}\` doesn't have fields`));
    case "Infer":
      return Ty.new_error(tcx, dcx.span_err(ty_span, `cannot use \`${display_Ty(ty)}\` in this position`));
    // FIXME(FRTs): support these types?
    case "Array":
    case "Pat":
      return Ty.new_error(tcx, dcx.span_err(ty_span, `type \`${display_Ty(ty)}\` is not yet supported in \`field_of!\``));
  }
};

/**
 * `s.parse::<usize>()` (core `from_str_radix`, radix 10): an optional leading `+`, then at least one ASCII digit, no
 * overflow past `usize::MAX` (64-bit host). PORT: a `bigint`, as the value may exceed 2^53.
 */
function parse_usize(s: string): bigint | undefined {
  const digits = s.startsWith("+") ? s.slice(1) : s;
  if (digits.length === 0 || !/^[0-9]+$/.test(digits)) return undefined;
  const v = BigInt(digits);
  return v > 0xffff_ffff_ffff_ffffn ? undefined : v;
}

/** `FieldIdx::from(usize)` (`newtype_index!`, `MAX` 0xFFFF_FF00): asserts the value is in range. */
function FieldIdx_from_usize(value: number): FieldIdx {
  assert(value <= 0xffff_ff00, "assertion failed: value <= (0xFFFF_FF00 as usize)");
  return value as FieldIdx;
}

/// Lower an opaque type (i.e., an existential impl-Trait type) from the HIR.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3631 lower_opaque_ty
HirTyLowerer.prototype.lower_opaque_ty = function (this: HirTyLowerer, def_id_: LocalDefId, in_trait: LocalDefId | undefined): Ty {
  const tcx = this.tcx();

  const lifetimes = tcx.opaque_captured_lifetimes(def_id_) as readonly [ResolvedArg, LocalDefId][];
  // debug!(?lifetimes);

  // If this is an RPITIT and we are using the new RPITIT lowering scheme,
  // do a linear search to map this to the synthetic associated type that
  // it will be lowered to.
  let def_id: DefId;
  if (in_trait !== undefined) {
    const parent_def_id = in_trait;
    def_id = unwrap(
      tcx.associated_types_for_impl_traits_in_associated_fn(LocalDefId.to_def_id(parent_def_id)).find((rpitit) => {
        const info = tcx.opt_rpitit_info(rpitit);
        if (info !== undefined && info.$ === "Trait") {
          return info.opaque_def_id.expect_local() === def_id_;
        } else {
          return unreachable();
        }
      }),
    );
  } else {
    def_id = LocalDefId.to_def_id(def_id_);
  }

  const generics = tcx.generics_of(def_id) as Generics;
  // debug!(?generics);

  // We use `generics.count() - lifetimes.len()` here instead of `generics.parent_count`
  // since return-position impl trait in trait squashes all of the generics from its source fn
  // into its own generics, so the opaque's "own" params isn't always just lifetimes.
  // PORT: `usize` subtraction; rustc is built without overflow checks, so a wrapped `offset` makes every `checked_sub`
  // below `None`, as a negative `offset` does here.
  const offset = generics.count() - lifetimes.length;

  const args = RawList.for_item(tcx, def_id, (param, _) => {
    if (offset >= 0 && param.index >= offset) {
      const i = param.index - offset;
      const [lifetime, _1] = index_slice(lifetimes, i);
      // FIXME(mgca): should we be calling self.check_params_use_if_mcg here too?
      return this.lower_resolved_lifetime(lifetime);
    } else {
      return tcx.mk_param_from_def(param);
    }
  });
  // debug!(?args);

  if (in_trait !== undefined) {
    return Ty.new_projection_from_args(tcx, "No", def_id, args);
  } else {
    return Ty.new_opaque(tcx, "No", def_id, args);
  }
};

/// Lower a function type from the HIR to our internal notion of a function signature.
// #[instrument(level = "debug", skip(self, hir_id, safety, abi, decl, generics, hir_ty), ret)]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3682 lower_fn_ty
HirTyLowerer.prototype.lower_fn_ty = function (
  this: HirTyLowerer,
  hir_id: HirId,
  safety: hir.Safety,
  abi: ExternAbi,
  decl: hir.FnDecl,
  generics: hir.Generics | undefined,
  hir_ty: hir.Ty | undefined,
): PolyFnSig {
  const tcx = this.tcx();
  const bound_vars = tcx.late_bound_vars(hir_id);
  // debug!(?bound_vars);

  const [input_tys, output_ty] = this.lower_fn_sig(decl, generics, hir_id, hir_ty);

  // debug!(?output_ty);

  // debug!(?abi, ?safety, ?decl.fn_decl_kind, input_tys_len = ?input_tys.len());
  const fn_sig_kind = unwrap_result(
    FnSigKind.set_splatted(
      FnSigKind.set_c_variadic(FnSigKind.set_safety(FnSigKind.set_abi(FnSigKind.default_(), abi), safety), decl.fn_decl_kind.c_variadic()),
      decl.splatted(),
      input_tys.length,
    ),
    debug_SplattedArgIndexError,
  );
  const fn_ty = tcx.mk_fn_sig(input_tys, output_ty, fn_sig_kind);
  const fn_ptr_ty = Binder.bind_with_vars(fn_ty, bound_vars);

  if (hir_ty !== undefined && hir_ty.kind.$ === "FnPtr") {
    const [fn_ptr_ty_, span] = [hir_ty.kind._0, hir_ty.span];
    check_abi(tcx, hir_id, span, fn_ptr_ty_.abi);
  }

  // reject function types that violate cmse ABI requirements
  validate_cmse_abi(this.tcx(), this.dcx(), hir_id, abi, fn_ptr_ty);

  if (!TypeVisitableExt.references_error(fn_ptr_ty, fold_Binder(fold_FnSig))) {
    // Find any late-bound regions declared in return type that do
    // not appear in the arguments. These are not well-formed.
    //
    // Example:
    //     for<'a> fn() -> &'a str <-- 'a is bad
    //     for<'a> fn(&'a String) -> &'a str <-- 'a is ok
    const inputs = PolyFnSig_.inputs(fn_ptr_ty);
    // PORT: `collect_*_late_bound_regions` build an `FxIndexSet` (rustc_middle ty/visit.ts: a `KeyedSet`, typed `Set`).
    const late_bound_in_args = tcx.collect_constrained_late_bound_regions(
      Binder.map_bound(inputs, (i): readonly Ty[] => [...i]),
      fold_Vec(fold_Ty),
    ) as KeyedSet<BoundRegionKind>;
    const output = PolyFnSig_.output(fn_ptr_ty);
    const late_bound_in_ret = tcx.collect_referenced_late_bound_regions(output, fold_Ty) as KeyedSet<BoundRegionKind>;

    this.validate_late_bound_regions(late_bound_in_args, late_bound_in_ret, (br_name) =>
      struct_span_code_err(
        this.dcx(),
        hir.FnRetTy.span(decl.output),
        E0581,
        `return type references ${br_name}, which is not constrained by the fn input types`,
      ),
    );
  }

  return fn_ptr_ty;
};

/** `crate::check::check_abi` (check/check.rs). PORT: check/check.rs is wave 17 (not ported, no TS module yet). */
function check_abi(_tcx: TyCtxt, _hir_id: HirId, _span: Span, _abi: ExternAbi): void {
  return unported("rustc_hir_analysis::check::check::check_abi");
}

/// Given a fn_hir_id for a impl function, suggest the type that is found on the
/// corresponding function in the trait that the impl implements, if it exists.
/// If arg_idx is Some, then it corresponds to an input type index, otherwise it
/// corresponds to the return type.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3747 suggest_trait_fn_ty_for_impl_fn_infer
HirTyLowerer.prototype.suggest_trait_fn_ty_for_impl_fn_infer = function (
  this: HirTyLowerer,
  fn_hir_id: HirId,
  arg_idx: number | undefined,
): Ty | undefined {
  const tcx = this.tcx();
  const node = tcx.hir_node(fn_hir_id);
  if (!(node.$ === "ImplItem" && node._0.kind.$ === "Fn")) {
    return undefined;
  }
  const ident = node._0.ident;
  const i = hir.Node.expect_item(tcx.parent_hir_node(fn_hir_id)).expect_impl();

  if (i.of_trait === undefined) return undefined;
  const trait_ref = this.lower_impl_trait_ref(i.of_trait.trait_ref, this.lower_ty(i.self_ty));

  const assoc = AssocItems.find_by_ident_and_kind(tcx.associated_items(trait_ref.def_id) as AssocItems, tcx, ident, "Fn", trait_ref.def_id);
  if (assoc === undefined) return undefined;

  const fn_sig_binder = tcx.fn_sig(assoc.def_id) as EarlyBinder<PolyFnSig>;
  const fn_sig_ = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(
      fn_sig_binder,
      tcx,
      trait_ref.args.extend_to(tcx, assoc.def_id, (param, _) => tcx.mk_param_from_def(param)),
      fold_Binder(fold_FnSig),
    ),
  );
  const fn_sig = tcx.liberate_late_bound_regions(fn_hir_id.expect_owner().to_def_id(), fn_sig_, fold_FnSig);

  if (arg_idx !== undefined) {
    const t = FnSig.inputs(fn_sig)[arg_idx];
    if (t === undefined) return undefined;
    return t;
  } else {
    return FnSig.output(fn_sig);
  }
};

// #[instrument(level = "trace", skip(self, generate_err))]
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3788 validate_late_bound_regions
HirTyLowerer.prototype.validate_late_bound_regions = function (
  this: HirTyLowerer,
  constrained_regions: KeyedSet<BoundRegionKind>,
  referenced_regions: KeyedSet<BoundRegionKind>,
  generate_err: (_1: string) => Diag,
): void {
  for (const br of referenced_regions) {
    // `referenced_regions.difference(&constrained_regions)`
    if (constrained_regions.has(br)) continue;
    const name = BoundRegionKind.get_name(br, this.tcx());
    const br_name = name !== undefined ? `lifetime \`${display_Symbol(name)}\`` : "an anonymous lifetime";

    const err = generate_err(br_name);

    if (!BoundRegionKind.is_named(br, this.tcx())) {
      // The only way for an anonymous lifetime to wind up
      // in the return type but **also** be unconstrained is
      // if it only appears in "associated types" in the
      // input. See #47511 and #62200 for examples. In this case,
      // though we can easily give a hint that ought to be
      // relevant.
      err.note("lifetimes appearing in an associated or opaque type are not considered constrained");
      err.note("consider introducing a named lifetime parameter");
    }

    err.emit();
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3820 construct_const_ctor_value
HirTyLowerer.prototype.construct_const_ctor_value = function (this: HirTyLowerer, ctor_def_id: DefId, ctor_of: CtorOf, args: GenericArgs): Const {
  const tcx = this.tcx();
  const parent_did = tcx.parent(ctor_def_id);

  let adt_did: DefId;
  switch (ctor_of) {
    case "Variant":
      adt_did = tcx.parent(parent_did);
      break;
    case "Struct":
      adt_did = parent_did;
      break;
  }
  const adt_def = tcx.adt_def(adt_did) as AdtDef;

  const variant_idx = adt_def.variant_index_with_id(parent_did);

  let valtree: ValTree;
  if (adt_def.is_enum()) {
    const discr = ValTree.from_scalar_int(tcx, ScalarInt.from_u32(variant_idx));
    valtree = ValTree.from_branches(tcx, [Const.new_value(tcx, discr, tcx.types.u32)]);
  } else {
    valtree = ValTree.zst(tcx);
  }

  const adt_ty = Ty.new_adt(tcx, adt_def, args);
  return Const.new_value(tcx, valtree, adt_ty);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/mod.rs:3847 lower_view
HirTyLowerer.prototype.lower_view = function (this: HirTyLowerer, inner_ty: Ty, fields: readonly Ident[], ty_span: Span): Ty {
  // Step 1: check that every field is unique, and keep a list of field that we know are
  // unique.
  const viewed_fields: Ident[] = [];

  for (const f_ of fields) {
    const f = f_.normalize_to_macros_2_0();
    // PERF: this is quadratic, but ~fine since the amount of fields is very low.
    const previous = viewed_fields.find((f_) => f_.eq(f));
    if (previous !== undefined) {
      const previous_field_span = previous.span;
      this.dcx().emit_err(ViewedFieldIsAlreadyPartOfTheView_diagnostic({ name: f.name, span: f.span, previous_field_span }));
      continue;
    }
    viewed_fields.push(f);
  }

  // Step 2: check that the viewed type is a struct.
  let variant: VariantDef;
  const k = inner_ty.kind();
  if (k.$ === "Adt" && k._0.is_struct()) {
    variant = k._0.non_enum_variant();
  } else if (k.$ === "Adt") {
    const def = k._0;
    const guar = this.dcx().emit_err(
      OnlyStructsCanBeViewedAdt_diagnostic({ ty: inner_ty, span: ty_span, article: def.article(), kind: def.descr() }),
    );
    return Ty.new_error(this.tcx(), guar);
  } else {
    const guar = this.dcx().emit_err(OnlyStructsCanBeViewedNonAdt_diagnostic({ ty: inner_ty, span: ty_span }));
    return Ty.new_error(this.tcx(), guar);
  }

  // Step 3: check that every viewed field exists.
  const viewed_indices: FieldDef[] = [];
  let error: ErrorGuaranteed | undefined = undefined;
  for (const field of viewed_fields) {
    const found = variant.fields.find((f) => f.ident(this.tcx()).normalize_to_macros_2_0().eq(field));
    if (found === undefined) {
      const err = this.dcx().emit_err(NoFieldOnType_diagnostic({ span: field.span, field, ty: inner_ty }));
      error = err;
      continue;
    }

    viewed_indices.push(found);
  }
  if (error !== undefined) {
    return Ty.new_error(this.tcx(), error);
  }

  // FIXME(scrabsha): actually lower view types.
  return inner_ty;
};

/** `slice.iter().enumerate().filter_map(f)` as a lazy iterator. */
function* filter_map_enumerate<T, U>(xs: readonly T[], f: (index: number, x: T) => U | undefined): Generator<U> {
  for (let index = 0; index < xs.length; index++) {
    const u = f(index, xs[index]!);
    if (u !== undefined) yield u;
  }
}
