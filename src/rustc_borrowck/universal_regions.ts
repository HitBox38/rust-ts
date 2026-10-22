// Port of compiler/rustc_borrowck/src/universal_regions.rs (lane borrowck-contract: declarations; fill lane bck-nll, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//! Code to extract the universally quantified regions declared on a
//! function. For example:
//!
//! ```
//! fn foo<'a, 'b, 'c: 'b>() { }
//! ```
//!
//! here we would return a map assigning each of `{'a, 'b, 'c}`
//! to an index.
//!
//! The code in this file doesn't *do anything* with those results; it
//! just returns them for other code to use.
// PORT: `DefiningTy` (an enum with methods) has no generated companion: `DefiningTy` is `{} as DefiningTy_methods`;
// its `new` is `new_` (dataflow-contract `SplitPointIndex::new_` precedent: `new` would be a construct signature).
// PORT: the `#[extension(trait InferCtxtExt)] impl BorrowckInferCtxt` methods augment lib.gen.ts's `BorrowckInferCtxt`.
// PORT: `T: TypeFoldable` adds the descriptor `d_T` (errctxt-contract signature rule); `impl FnMut(Region)` is an
// arrow; `impl Iterator<Item = T>` is `Iterable<T>`; `IndexVec<RegionVid, Region>` is `Region[]`.
import type { Diag } from "../rustc_errors/lib.ts";
import type { NllRegionVariableOrigin } from "../rustc_infer/infer/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Region, Ty } from "../rustc_middle/ty/decls.ts";
import type { GenericArgsRef } from "../rustc_middle/ty/generic_args.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { Binder, BoundVariableKind } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { unported } from "../std/panic.ts";
import { BorrowckInferCtxt } from "./lib.gen.ts";
import * as gen from "./universal_regions.gen.ts";
import { type RegionClassification, UniversalRegionIndices, UniversalRegions, UniversalRegionsBuilder } from "./universal_regions.gen.ts";

export * from "./universal_regions.gen.ts";

declare module "./universal_regions.gen.ts" {
  interface UniversalRegions {
    // universal_regions.rs:551 (lane bck-nll)
    is_universal_region(r: RegionVid): boolean;
    // universal_regions.rs:557 (lane bck-nll)
    region_classification(r: RegionVid): RegionClassification | undefined;
    // universal_regions.rs:572 (lane bck-nll)
    universal_regions_iter(): Iterable<RegionVid>;
    // universal_regions.rs:577 (lane bck-nll)
    is_local_free_region(r: RegionVid): boolean;
    // universal_regions.rs:581 (lane bck-nll)
    is_external_free_region(r: RegionVid): boolean;
    // universal_regions.rs:586 (lane bck-nll)
    len(): number;
    // universal_regions.rs:595 (lane bck-nll)
    num_global_and_external_regions(): number;
    // universal_regions.rs:600 (lane bck-nll)
    named_universal_regions_iter(): Iterable<[Region, RegionVid]>;
    // universal_regions.rs:607 (lane bck-nll)
    to_region_vid(r: Region): RegionVid;
    // universal_regions.rs:617 (lane bck-nll)
    annotate(tcx: TyCtxt, err: Diag): void;
    // universal_regions.rs:683 (lane bck-nll)
    implicit_region_bound(): RegionVid;
    // universal_regions.rs:687 (lane bck-nll)
    encountered_re_error(): ErrorGuaranteed | undefined;
  }
  namespace UniversalRegions {
    // universal_regions.rs:512 (lane bck-nll)
    function new_(infcx: BorrowckInferCtxt, mir_def: LocalDefId): UniversalRegions;
    export { new_ as new };
    // universal_regions.rs:525 (lane bck-nll)
    export function closure_mapping(tcx: TyCtxt, closure_args: GenericArgsRef, expected_num_vars: number, closure_def_id: LocalDefId): Region[];
  }
  interface UniversalRegionsBuilder {
    // universal_regions.rs:698 (lane bck-nll)
    build(): UniversalRegions;
    // universal_regions.rs:829 (lane bck-nll)
    defining_ty(): DefiningTy;
    // universal_regions.rs:852 (lane bck-nll)
    compute_indices(fr_static: RegionVid, defining_ty: DefiningTy): UniversalRegionIndices;
    // universal_regions.rs:876 (lane bck-nll)
    compute_inputs_and_output(indices: UniversalRegionIndices, defining_ty: DefiningTy): Binder<List<Ty>>;
  }
  interface UniversalRegionIndices {
    // universal_regions.rs:940 (lane bck-nll)
    insert_late_bound_region(r: Region, vid: RegionVid): void;
    // universal_regions.rs:957 (lane bck-nll)
    to_region_vid(r: Region): RegionVid;
    // universal_regions.rs:976 (lane bck-nll)
    fold_to_region_vids<T>(tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T;
  }
}

declare module "./lib.gen.ts" {
  interface BorrowckInferCtxt {
    // universal_regions.rs:897 (lane bck-nll; `InferCtxtExt`)
    replace_free_regions_with_nll_infer_vars<T>(origin: NllRegionVariableOrigin, value: T, d_T: TypeFoldable<T>): T;
    // universal_regions.rs:914 (lane bck-nll; `InferCtxtExt`)
    replace_bound_regions_with_nll_infer_vars<T>(all_outlive_scope: LocalDefId, value: Binder<T>, indices: UniversalRegionIndices, d_T: TypeFoldable<T>): T;
  }
}

export interface DefiningTy_methods {
  // universal_regions.rs:137 (lane bck-nll)
  new_(tcx: TyCtxt, body_def_id: LocalDefId): DefiningTy;
  // universal_regions.rs:198 (lane bck-nll)
  bound_vars(self: DefiningTy, tcx: TyCtxt): List<BoundVariableKind>;
  // universal_regions.rs:235 (lane bck-nll)
  inputs_and_output(self: DefiningTy, tcx: TyCtxt): Binder<List<Ty>>;
  // universal_regions.rs:378 (lane bck-nll)
  upvar_tys(self: DefiningTy): List<Ty>;
  // universal_regions.rs:393 (lane bck-nll)
  implicit_inputs(self: DefiningTy): number;
  // universal_regions.rs:405 (lane bck-nll)
  is_fn_def(self: DefiningTy): boolean;
  // universal_regions.rs:409 (lane bck-nll)
  is_const(self: DefiningTy): boolean;
  // universal_regions.rs:413 (lane bck-nll)
  def_id(self: DefiningTy): DefId;
  // universal_regions.rs:427 (lane bck-nll)
  args(self: DefiningTy): GenericArgsRef;
}
export type DefiningTy = gen.DefiningTy;
export const DefiningTy = {} as DefiningTy_methods;

// stub: compiler/rustc_borrowck/src/universal_regions.rs:137 new (lane bck-nll)
DefiningTy.new_ = function (tcx: TyCtxt, body_def_id: LocalDefId): DefiningTy {
  return unported("rustc_borrowck::universal_regions::DefiningTy::new");
};

/// Returns a list of all the upvar types for this closure/coroutine. The
/// late-bound regions, in the case of a function definition, are
/// also returned in the binder.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:198 bound_vars (lane bck-nll)
DefiningTy.bound_vars = function (self: DefiningTy, tcx: TyCtxt): List<BoundVariableKind> {
  return unported("rustc_borrowck::universal_regions::DefiningTy::bound_vars");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:235 inputs_and_output (lane bck-nll)
DefiningTy.inputs_and_output = function (self: DefiningTy, tcx: TyCtxt): Binder<List<Ty>> {
  return unported("rustc_borrowck::universal_regions::DefiningTy::inputs_and_output");
};

/// Returns a list of all the upvar types for this closure/coroutine.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:378 upvar_tys (lane bck-nll)
DefiningTy.upvar_tys = function (self: DefiningTy): List<Ty> {
  return unported("rustc_borrowck::universal_regions::DefiningTy::upvar_tys");
};

/// Number of implicit inputs -- notably the "environment"
/// parameter for closures -- that appear in MIR but not in the
/// user's code.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:393 implicit_inputs (lane bck-nll)
DefiningTy.implicit_inputs = function (self: DefiningTy): number {
  return unported("rustc_borrowck::universal_regions::DefiningTy::implicit_inputs");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:405 is_fn_def (lane bck-nll)
DefiningTy.is_fn_def = function (self: DefiningTy): boolean {
  return unported("rustc_borrowck::universal_regions::DefiningTy::is_fn_def");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:409 is_const (lane bck-nll)
DefiningTy.is_const = function (self: DefiningTy): boolean {
  return unported("rustc_borrowck::universal_regions::DefiningTy::is_const");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:413 def_id (lane bck-nll)
DefiningTy.def_id = function (self: DefiningTy): DefId {
  return unported("rustc_borrowck::universal_regions::DefiningTy::def_id");
};

/// Returns the args of the `DefiningTy`. These are equivalent to the identity args
/// of the body.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:427 args (lane bck-nll)
DefiningTy.args = function (self: DefiningTy): GenericArgsRef {
  return unported("rustc_borrowck::universal_regions::DefiningTy::args");
};

/// Creates a new and fully initialized `UniversalRegions` that
/// contains indices for all the free regions found in the given
/// MIR -- that is, all the regions that appear in the function's
/// signature.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:512 new (lane bck-nll)
(UniversalRegions as unknown as { new: typeof UniversalRegions.new }).new = function (infcx: BorrowckInferCtxt, mir_def: LocalDefId): UniversalRegions {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::new");
};

/// Given a reference to a closure type, extracts all the values
/// from its free regions and returns a vector with them. This is
/// used when the closure's creator checks that the
/// `ClosureRegionRequirements` are met. The requirements from
/// `ClosureRegionRequirements` are expressed in terms of
/// `RegionVid` entries that map into the returned vector `V`: so
/// if the `ClosureRegionRequirements` contains something like
/// `'1: '2`, then the caller would impose the constraint that
/// `V[1]: V[2]`.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:525 closure_mapping (lane bck-nll)
(UniversalRegions as unknown as { closure_mapping: typeof UniversalRegions.closure_mapping }).closure_mapping = function (
  tcx: TyCtxt,
  closure_args: GenericArgsRef,
  expected_num_vars: number,
  closure_def_id: LocalDefId,
): Region[] {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::closure_mapping");
};

/// True if `r` is a member of this set of universal regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:551 is_universal_region (lane bck-nll)
UniversalRegions.prototype.is_universal_region = function (this: UniversalRegions, r: RegionVid): boolean {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::is_universal_region");
};

/// Classifies `r` as a universal region, returning `None` if this
/// is not a member of this set of universal regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:557 region_classification (lane bck-nll)
UniversalRegions.prototype.region_classification = function (this: UniversalRegions, r: RegionVid): RegionClassification | undefined {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::region_classification");
};

/// Returns an iterator over all the RegionVids corresponding to
/// universally quantified free regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:572 universal_regions_iter (lane bck-nll)
UniversalRegions.prototype.universal_regions_iter = function (this: UniversalRegions): Iterable<RegionVid> {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::universal_regions_iter");
};

/// Returns `true` if `r` is classified as a local region.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:577 is_local_free_region (lane bck-nll)
UniversalRegions.prototype.is_local_free_region = function (this: UniversalRegions, r: RegionVid): boolean {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::is_local_free_region");
};

/// Returns `true` if `r` is classified as an external region.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:581 is_external_free_region (lane bck-nll)
UniversalRegions.prototype.is_external_free_region = function (this: UniversalRegions, r: RegionVid): boolean {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::is_external_free_region");
};

/// Returns the number of universal regions created in any category.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:586 len (lane bck-nll)
UniversalRegions.prototype.len = function (this: UniversalRegions): number {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::len");
};

/// Returns the number of global plus external universal regions.
/// For closures, these correspond to the regions that the closure
/// may refer to from its environment.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:595 num_global_and_external_regions (lane bck-nll)
UniversalRegions.prototype.num_global_and_external_regions = function (this: UniversalRegions): number {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::num_global_and_external_regions");
};

/// Gets an iterator over all the early-bound regions that have names.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:600 named_universal_regions_iter (lane bck-nll)
UniversalRegions.prototype.named_universal_regions_iter = function (this: UniversalRegions): Iterable<[Region, RegionVid]> {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::named_universal_regions_iter");
};

/// See [UniversalRegionIndices::to_region_vid].
// stub: compiler/rustc_borrowck/src/universal_regions.rs:607 to_region_vid (lane bck-nll)
UniversalRegions.prototype.to_region_vid = function (this: UniversalRegions, r: Region): RegionVid {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::to_region_vid");
};

/// As part of the NLL unit tests, you can annotate a function with
/// `#[rustc_regions]`, and we will emit information about the region
/// inference context and -- in particular -- the external constraints
/// that this region imposes on others. The methods in this file
/// handle the part about dumping the inference context internal
/// state.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:617 annotate (lane bck-nll)
UniversalRegions.prototype.annotate = function (this: UniversalRegions, tcx: TyCtxt, err: Diag): void {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::annotate");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:683 implicit_region_bound (lane bck-nll)
UniversalRegions.prototype.implicit_region_bound = function (this: UniversalRegions): RegionVid {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::implicit_region_bound");
};

/// Use this to see if we encountered a `ReError` while
/// collecting free regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:687 encountered_re_error (lane bck-nll)
UniversalRegions.prototype.encountered_re_error = function (this: UniversalRegions): ErrorGuaranteed | undefined {
  return unported("rustc_borrowck::universal_regions::UniversalRegions::encountered_re_error");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:698 build (lane bck-nll)
UniversalRegionsBuilder.prototype.build = function (this: UniversalRegionsBuilder): UniversalRegions {
  return unported("rustc_borrowck::universal_regions::UniversalRegionsBuilder::build");
};

/// Returns the "defining type" of the current MIR;
/// see `DefiningTy` for details.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:829 defining_ty (lane bck-nll)
UniversalRegionsBuilder.prototype.defining_ty = function (this: UniversalRegionsBuilder): DefiningTy {
  return unported("rustc_borrowck::universal_regions::UniversalRegionsBuilder::defining_ty");
};

/// Builds a hashmap that maps from the universal regions that are
/// in scope (as a `ty::Region<'tcx>`) to their indices (as a
/// `RegionVid`). The map returned by this function contains only
/// the early-bound regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:852 compute_indices (lane bck-nll)
UniversalRegionsBuilder.prototype.compute_indices = function (this: UniversalRegionsBuilder, fr_static: RegionVid, defining_ty: DefiningTy): UniversalRegionIndices {
  return unported("rustc_borrowck::universal_regions::UniversalRegionsBuilder::compute_indices");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:876 compute_inputs_and_output (lane bck-nll)
UniversalRegionsBuilder.prototype.compute_inputs_and_output = function (
  this: UniversalRegionsBuilder,
  indices: UniversalRegionIndices,
  defining_ty: DefiningTy,
): Binder<List<Ty>> {
  return unported("rustc_borrowck::universal_regions::UniversalRegionsBuilder::compute_inputs_and_output");
};

// #[extension(trait InferCtxtExt<'tcx>)] impl<'tcx> BorrowckInferCtxt<'tcx>
// stub: compiler/rustc_borrowck/src/universal_regions.rs:897 replace_free_regions_with_nll_infer_vars (lane bck-nll)
BorrowckInferCtxt.prototype.replace_free_regions_with_nll_infer_vars = function <T>(
  this: BorrowckInferCtxt,
  origin: NllRegionVariableOrigin,
  value: T,
  d_T: TypeFoldable<T>,
): T {
  return unported("rustc_borrowck::universal_regions::BorrowckInferCtxt::replace_free_regions_with_nll_infer_vars");
};

// stub: compiler/rustc_borrowck/src/universal_regions.rs:914 replace_bound_regions_with_nll_infer_vars (lane bck-nll)
BorrowckInferCtxt.prototype.replace_bound_regions_with_nll_infer_vars = function <T>(
  this: BorrowckInferCtxt,
  all_outlive_scope: LocalDefId,
  value: Binder<T>,
  indices: UniversalRegionIndices,
  d_T: TypeFoldable<T>,
): T {
  return unported("rustc_borrowck::universal_regions::BorrowckInferCtxt::replace_bound_regions_with_nll_infer_vars");
};

/// Initially, the `UniversalRegionIndices` map contains only the
/// early-bound regions in scope. Once that is all setup, we come
/// in later and instantiate the late-bound regions, and then we
/// insert the `ReLateParam` version of those into the map as
/// well. These are used for error reporting.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:940 insert_late_bound_region (lane bck-nll)
UniversalRegionIndices.prototype.insert_late_bound_region = function (this: UniversalRegionIndices, r: Region, vid: RegionVid): void {
  return unported("rustc_borrowck::universal_regions::UniversalRegionIndices::insert_late_bound_region");
};

/// Converts `r` into a local inference variable: `r` can either
/// be a `ReVar` (i.e., already a reference to an inference
/// variable) or it can be `'static` or some early-bound
/// region. This is useful when taking the results from
/// type-checking and trait-matching, which use free regions, and
/// translating them into the NLL inference variables that
/// have been created for those regions.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:957 to_region_vid (lane bck-nll)
UniversalRegionIndices.prototype.to_region_vid = function (this: UniversalRegionIndices, r: Region): RegionVid {
  return unported("rustc_borrowck::universal_regions::UniversalRegionIndices::to_region_vid");
};

/// Replaces all free regions in `value` with region vids, as
/// returned by `to_region_vid`.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:976 fold_to_region_vids (lane bck-nll)
UniversalRegionIndices.prototype.fold_to_region_vids = function <T>(this: UniversalRegionIndices, tcx: TyCtxt, value: T, d_T: TypeFoldable<T>): T {
  return unported("rustc_borrowck::universal_regions::UniversalRegionIndices::fold_to_region_vids");
};

/// Iterates over the late-bound regions defined on `mir_def_id` and all of its
/// parents, up to the typeck root, and invokes `f` with the liberated form
/// of each one.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:987 for_each_late_bound_region_in_recursive_scope (lane bck-nll)
export function for_each_late_bound_region_in_recursive_scope(tcx: TyCtxt, mir_def_id: LocalDefId, f: (a0: Region) => void): void {
  return unported("rustc_borrowck::universal_regions::for_each_late_bound_region_in_recursive_scope");
}

/// Iterates over the late-bound regions defined on `mir_def_id` and all of its
/// parents, up to the typeck root, and invokes `f` with the liberated form
/// of each one.
// stub: compiler/rustc_borrowck/src/universal_regions.rs:1007 for_each_late_bound_region_in_item (lane bck-nll)
export function for_each_late_bound_region_in_item(tcx: TyCtxt, mir_def_id: LocalDefId, f: (a0: Region) => void): void {
  return unported("rustc_borrowck::universal_regions::for_each_late_bound_region_in_item");
}
