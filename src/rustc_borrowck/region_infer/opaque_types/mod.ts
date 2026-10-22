// Port of compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs (lane borrowck-contract: declarations; fill lane bck-regions-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `mod member_constraints; mod region_ctxt;` are loaded by the crate root (lib.ts); this module imports their
// items where it uses them.
// PORT: `#[extension(pub trait InferCtxtExt<'tcx>)] impl InferCtxt` augments rustc_infer's `InferCtxt` class
// (rustc_infer/decls.ts; errctxt-contract `ObligationCauseExt` / rustc_trait_selection infer.rs precedent) and assigns its
// prototype; `impl RegionInferenceContext` augments ../region_context.gen.ts.
// PORT: `FxIndexMap<LocalDefId, DefinitionSiteHiddenType>` is a plain `Map` (`LocalDefId` is a branded number);
// `&mut Vec<T>` that the callee `mem::take`s or pushes to is the shared array; `&[(OpaqueTypeKey, ProvisionalHiddenType)]`
// is a readonly array of tuples; `Rc<DenseLocationMap>` is the shared map; `T: TypeFoldable` adds `d_T` last.
// PORT: `ToArgRegionsFolder` (generated class) implements rustc_type_ir's `FallibleTypeFolder<RegionVid>` (`type Error =
// RegionVid`) by prototype methods; its provided methods (`FallibleTypeFolder_provided`) are the fill lane's.
import type { CollectRegionConstraintsResult, BorrowckInferCtxt } from "../../lib.gen.ts";
import type { UniversalRegionRelations } from "../../type_check/free_region_relations.gen.ts";
import type { MirTypeckRegionConstraints } from "../../type_check/mod.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { OpaqueTypeStorageEntries } from "../../../rustc_infer/infer/opaque_types/mod.ts";
import type { RegionBoundPairs } from "../../../rustc_infer/infer/outlives/env.ts";
import type { Body } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { GenericArg, GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import type { DefinitionSiteHiddenType, ProvisionalHiddenType, Ty } from "../../../rustc_middle/ty/mod.ts";
import type { DenseLocationMap } from "../../../rustc_mir_dataflow/points.ts";
import type { DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { NonDefiningUseReason } from "../../../rustc_trait_selection/opaque_types.ts";
import type { PolyTypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import type { RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import { RegionInferenceContext } from "../region_context.gen.ts";
import { type DefiningUse, type DeferredOpaqueTypeError, ToArgRegionsFolder, UnexpectedHiddenRegion } from "./mod.gen.ts";
import type { RegionCtxt } from "./region_ctxt.gen.ts";

export * from "./mod.gen.ts";

/// We eagerly map all regions to NLL vars here, as we need to make sure we've
/// introduced nll vars for all used placeholders.
///
/// We need to resolve inference vars as even though we're in MIR typeck, we may still
/// encounter inference variables, e.g. when checking user types.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:66 clone_and_resolve_opaque_types (lane bck-regions-b)
export function clone_and_resolve_opaque_types(
  infcx: BorrowckInferCtxt,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
): [OpaqueTypeStorageEntries, [OpaqueTypeKey, ProvisionalHiddenType][]] {
  return unported("rustc_borrowck::region_infer::opaque_types::clone_and_resolve_opaque_types");
}

/// Maps an NLL var to a deterministically chosen equal universal region.
///
/// See the corresponding [rustc-dev-guide chapter] for more details. This
/// ignores changes to the region values due to member constraints. Applying
/// member constraints does not impact the result of this function.
///
/// [rustc-dev-guide chapter]: https://rustc-dev-guide.rust-lang.org/borrow_check/opaque-types-region-inference-restrictions.html
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:96 nll_var_to_universal_region (lane bck-regions-b)
function nll_var_to_universal_region(rcx: RegionCtxt, r: RegionVid): Region | undefined {
  return unported("rustc_borrowck::region_infer::opaque_types::nll_var_to_universal_region");
}
void nll_var_to_universal_region;

declare module "./mod.gen.ts" {
  interface UnexpectedHiddenRegion {
    // mod.rs:141 (lane bck-regions-b)
    to_error(): [LocalDefId, DeferredOpaqueTypeError];
  }
  interface ToArgRegionsFolder {
    // mod.rs:431 (lane bck-regions-b)
    fold_non_member_arg(arg: GenericArg): GenericArg;
    // mod.rs:439 (lane bck-regions-b)
    fold_closure_args(def_id: DefId, args: GenericArgsRef): Result<GenericArgsRef, RegionVid>;
    // mod.rs:456 (lane bck-regions-b): `impl FallibleTypeFolder<TyCtxt> for ToArgRegionsFolder`
    cx(): TyCtxt;
    // mod.rs:460 (lane bck-regions-b)
    try_fold_region(r: Region): Result<Region, RegionVid>;
    // mod.rs:483 (lane bck-regions-b)
    try_fold_ty(ty: Ty): Result<Ty, RegionVid>;
  }
  namespace ToArgRegionsFolder {
    // mod.rs:424 (lane bck-regions-b)
    function new_(rcx: RegionCtxt, arg_regions: readonly RegionVid[]): ToArgRegionsFolder;
    export { new_ as new };
  }
}

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:141 to_error (lane bck-regions-b)
UnexpectedHiddenRegion.prototype.to_error = function (this: UnexpectedHiddenRegion): [LocalDefId, DeferredOpaqueTypeError] {
  return unported("rustc_borrowck::region_infer::opaque_types::UnexpectedHiddenRegion::to_error");
};

/// Collect all defining uses of opaque types inside of this typeck root. This
/// expects the hidden type to be mapped to the definition parameters of the opaque
/// and errors if we end up with distinct hidden types.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:157 add_hidden_type (lane bck-regions-b)
function add_hidden_type(
  tcx: TyCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  def_id: LocalDefId,
  hidden_ty: DefinitionSiteHiddenType,
): void {
  return unported("rustc_borrowck::region_infer::opaque_types::add_hidden_type");
}
void add_hidden_type;

/// This computes the actual hidden types of the opaque types and maps them to their
/// definition sites. Outside of registering the computed hidden types this function
/// does not mutate the current borrowck state.
///
/// While it may fail to infer the hidden type and return errors, we always apply
/// the computed hidden type to all opaque type uses to check whether they
/// are correct. This is necessary to support non-defining uses of opaques in their
/// defining scope.
///
/// It also means that this whole function is not really soundness critical as we
/// recheck all uses of the opaques regardless.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:203 compute_definition_site_hidden_types (lane bck-regions-b)
export function compute_definition_site_hidden_types(
  def_id: LocalDefId,
  infcx: BorrowckInferCtxt,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
  location_map: DenseLocationMap,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  unconstrained_hidden_type_errors: UnexpectedHiddenRegion[],
  opaque_types: readonly [OpaqueTypeKey, ProvisionalHiddenType][],
): DeferredOpaqueTypeError[] {
  return unported("rustc_borrowck::region_infer::opaque_types::compute_definition_site_hidden_types");
}

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:245 collect_defining_uses (lane bck-regions-b)
function collect_defining_uses(
  rcx: RegionCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  opaque_types: readonly [OpaqueTypeKey, ProvisionalHiddenType][],
  errors: DeferredOpaqueTypeError[],
): DefiningUse[] {
  return unported("rustc_borrowck::region_infer::opaque_types::collect_defining_uses");
}
void collect_defining_uses;

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:305 compute_definition_site_hidden_types_from_defining_uses (lane bck-regions-b)
function compute_definition_site_hidden_types_from_defining_uses(
  def_id: LocalDefId,
  rcx: RegionCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  unconstrained_hidden_type_errors: UnexpectedHiddenRegion[],
  defining_uses: readonly DefiningUse[],
  errors: DeferredOpaqueTypeError[],
): void {
  return unported("rustc_borrowck::region_infer::opaque_types::compute_definition_site_hidden_types_from_defining_uses");
}
void compute_definition_site_hidden_types_from_defining_uses;

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:424 new (lane bck-regions-b)
(ToArgRegionsFolder as unknown as { new: typeof ToArgRegionsFolder.new }).new = function (
  rcx: RegionCtxt,
  arg_regions: readonly RegionVid[],
): ToArgRegionsFolder {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::new");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:431 fold_non_member_arg (lane bck-regions-b)
ToArgRegionsFolder.prototype.fold_non_member_arg = function (this: ToArgRegionsFolder, arg: GenericArg): GenericArg {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::fold_non_member_arg");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:439 fold_closure_args (lane bck-regions-b)
ToArgRegionsFolder.prototype.fold_closure_args = function (
  this: ToArgRegionsFolder,
  def_id: DefId,
  args: GenericArgsRef,
): Result<GenericArgsRef, RegionVid> {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::fold_closure_args");
};

// impl<'tcx> FallibleTypeFolder<TyCtxt<'tcx>> for ToArgRegionsFolder<'_, 'tcx> (type Error = RegionVid)
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:456 cx (lane bck-regions-b)
ToArgRegionsFolder.prototype.cx = function (this: ToArgRegionsFolder): TyCtxt {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::cx");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:460 try_fold_region (lane bck-regions-b)
ToArgRegionsFolder.prototype.try_fold_region = function (this: ToArgRegionsFolder, r: Region): Result<Region, RegionVid> {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::try_fold_region");
};

// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:483 try_fold_ty (lane bck-regions-b)
ToArgRegionsFolder.prototype.try_fold_ty = function (this: ToArgRegionsFolder, ty: Ty): Result<Ty, RegionVid> {
  return unported("rustc_borrowck::region_infer::opaque_types::ToArgRegionsFolder::try_fold_ty");
};

/// This function is what actually applies member constraints to the borrowck
/// state. It is also responsible to check all uses of the opaques in their
/// defining scope.
///
/// It does this by equating the hidden type of each use with the instantiated final
/// hidden type of the opaque.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:528 apply_definition_site_hidden_types (lane bck-regions-b)
export function apply_definition_site_hidden_types(
  infcx: BorrowckInferCtxt,
  body: Body,
  universal_regions: UniversalRegions,
  region_bound_pairs: RegionBoundPairs,
  known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
  constraints: MirTypeckRegionConstraints,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  opaque_types: readonly [OpaqueTypeKey, ProvisionalHiddenType][],
): DeferredOpaqueTypeError[] {
  return unported("rustc_borrowck::region_infer::opaque_types::apply_definition_site_hidden_types");
}

/// We handle `UnexpectedHiddenRegion` error lazily in the next solver as
/// there may be a fully defining use in another body.
///
/// In case such a defining use does not exist, we register an error here.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:628 handle_unconstrained_hidden_type_errors (lane bck-regions-b)
export function handle_unconstrained_hidden_type_errors(
  tcx: TyCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  unconstrained_hidden_type_errors: UnexpectedHiddenRegion[],
  collect_region_constraints_results: Map<LocalDefId, CollectRegionConstraintsResult>,
): void {
  return unported("rustc_borrowck::region_infer::opaque_types::handle_unconstrained_hidden_type_errors");
}

/// In theory `apply_definition_site_hidden_types` could introduce new uses of opaque types.
/// We do not check these new uses so this could be unsound.
///
/// We detect any new uses and simply delay a bug if they occur. If this results in
/// an ICE we can properly handle this, but we haven't encountered any such test yet.
///
/// See the related comment in `FnCtxt::detect_opaque_types_added_during_writeback`.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:665 detect_opaque_types_added_while_handling_opaque_types (lane bck-regions-b)
export function detect_opaque_types_added_while_handling_opaque_types(
  infcx: InferCtxt,
  opaque_types_storage_num_entries: OpaqueTypeStorageEntries,
): void {
  return unported("rustc_borrowck::region_infer::opaque_types::detect_opaque_types_added_while_handling_opaque_types");
}

declare module "../region_context.gen.ts" {
  interface RegionInferenceContext {
    // opaque_types/mod.rs:696 (lane bck-regions-b)
    name_regions_for_member_constraint<T>(tcx: TyCtxt, ty: T, d_T: TypeFoldable<T>): T;
  }
}

/// Map the regions in the type to named regions. This is similar to what
/// `infer_opaque_types` does, but can infer any universal region, not only
/// ones from the args for the opaque type. It also doesn't double check
/// that the regions produced are in fact equal to the named region they are
/// replaced with. This is fine because this function is only to improve the
/// region names in error messages.
///
/// This differs from `MirBorrowckCtxt::name_regions` since it is particularly
/// lax with mapping region vids that are *shorter* than a universal region to
/// that universal region. This is useful for member region constraints since
/// we want to suggest a universal region name to capture even if it's technically
/// not equal to the error region.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:696 name_regions_for_member_constraint (lane bck-regions-b)
RegionInferenceContext.prototype.name_regions_for_member_constraint = function <T>(
  this: RegionInferenceContext,
  tcx: TyCtxt,
  ty: T,
  d_T: TypeFoldable<T>,
): T {
  return unported("rustc_borrowck::region_infer::opaque_types::RegionInferenceContext::name_regions_for_member_constraint");
};

declare module "../../../rustc_infer/decls.ts" {
  interface InferCtxt {
    // ---- rustc_borrowck region_infer/opaque_types/mod.rs: `#[extension(pub trait InferCtxtExt)] impl InferCtxt` ----
    // opaque_types/mod.rs:764 (lane bck-regions-b)
    infer_opaque_definition_from_instantiation(
      opaque_type_key: OpaqueTypeKey,
      instantiated_ty: ProvisionalHiddenType,
    ): Result<DefinitionSiteHiddenType, NonDefiningUseReason>;
  }
}

/// Given the fully resolved, instantiated type for an opaque
/// type, i.e., the value of an inference variable like C1 or C2
/// (*), computes the "definition type" for an opaque type
/// definition -- that is, the inferred value of `Foo1<'x>` or
/// `Foo2<'x>` that we would conceptually use in its definition:
/// ```ignore (illustrative)
/// type Foo1<'x> = impl Bar<'x> = AAA;  // <-- this type AAA
/// type Foo2<'x> = impl Bar<'x> = BBB;  // <-- or this type BBB
/// fn foo<'a, 'b>(..) -> (Foo1<'a>, Foo2<'b>) { .. }
/// ```
/// Note that these values are defined in terms of a distinct set of
/// generic parameters (`'x` instead of `'a`) from C1 or C2. The main
/// purpose of this function is to do that translation.
///
/// (*) C1 and C2 were introduced in the comments on
/// `register_member_constraints`. Read that comment for more context.
// stub: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:764 infer_opaque_definition_from_instantiation (lane bck-regions-b)
InferCtxt.prototype.infer_opaque_definition_from_instantiation = function (
  this: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  instantiated_ty: ProvisionalHiddenType,
): Result<DefinitionSiteHiddenType, NonDefiningUseReason> {
  return unported("rustc_borrowck::region_infer::opaque_types::InferCtxt::infer_opaque_definition_from_instantiation");
};
