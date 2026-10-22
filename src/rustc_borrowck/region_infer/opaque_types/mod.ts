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
import { ToUniverseInfo_never } from "../../diagnostics/bound_region_errors.ts";
import { fully_perform_op_raw } from "../../type_check/canonical.ts";
import type { UniversalRegionRelations } from "../../type_check/free_region_relations.gen.ts";
import type { Locations, MirTypeckRegionConstraints } from "../../type_check/mod.gen.ts";
import type { UniversalRegions } from "../../universal_regions.gen.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { KeyedMap } from "../../../rust_ts/keyed.ts";
import { InferCtxt } from "../../../rustc_infer/decls.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import type { OpaqueTypeStorageEntries } from "../../../rustc_infer/infer/opaque_types/mod.ts";
import type { RegionBoundPairs } from "../../../rustc_infer/infer/outlives/env.ts";
import { type Body, ConstraintCategory } from "../../../rustc_middle/mir/mod.ts";
import { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clauses, Const } from "../../../rustc_middle/ty/decls.ts";
import { fold_GenericArg, GenericArg, type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import * as middle_ty from "../../../rustc_middle/ty/mod.ts";
import { DefinitionSiteHiddenType, ProvisionalHiddenType, Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { DenseLocationMap } from "../../../rustc_mir_dataflow/points.ts";
import { NO_SOLUTION } from "../../../rustc_next_trait_solver/solve/mod.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { fold_unit } from "../../../rustc_trait_selection/solve/inspect/analyse.ts";
import { NonDefiningUseReason, opaque_type_has_defining_use_args } from "../../../rustc_trait_selection/opaque_types.ts";
import { CustomTypeOp, TypeOp_CustomTypeOp } from "../../../rustc_trait_selection/traits/query/type_op/custom.ts";
import { type Binder, EarlyBinder, type PlaceholderRegion } from "../../../rustc_type_ir/binder.ts";
import type { PolyTypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  fold_regions,
  fold_tuple2,
  type PredicateProxy,
  type TypeFoldable,
} from "../../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import { OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.ts";
import { fold_with_OpaqueTypeKey, try_fold_with_OpaqueTypeKey, visit_with_OpaqueTypeKey } from "../../../rustc_type_ir/opaque_ty.gen.ts";
import { debug_RegionVid, type RegionVid } from "../../../rustc_type_ir/region_kind.ts";
import { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { AliasTy, IsRigid } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { panic, unreachable, unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../../std/result.ts";
import { Representative } from "../mod.ts";
import { RegionInferenceContext } from "../region_context.gen.ts";
import { ReverseSccGraph } from "../reverse_sccs.ts";
import { apply_member_constraints } from "./member_constraints.ts";
import { type DefiningUse, type DeferredOpaqueTypeError, ToArgRegionsFolder, UnexpectedHiddenRegion } from "./mod.gen.ts";
import { RegionCtxt } from "./region_ctxt.ts";

export * from "./mod.gen.ts";

/// We eagerly map all regions to NLL vars here, as we need to make sure we've
/// introduced nll vars for all used placeholders.
///
/// We need to resolve inference vars as even though we're in MIR typeck, we may still
/// encounter inference variables, e.g. when checking user types.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:66 clone_and_resolve_opaque_types
export function clone_and_resolve_opaque_types(
  infcx: BorrowckInferCtxt,
  universal_region_relations: UniversalRegionRelations,
  constraints: MirTypeckRegionConstraints,
): [OpaqueTypeStorageEntries, [OpaqueTypeKey, ProvisionalHiddenType][]] {
  const opaque_types = infcx.clone_opaque_types();
  const opaque_types_storage_num_entries = infcx.inner.opaque_types().deref().num_entries();
  const d = fold_OpaqueTypeKey_ProvisionalHiddenType();
  const opaque_types_ = opaque_types.map((entry) =>
    fold_regions(
      infcx.tcx,
      infcx.deeply_resolve_ignoring_regions(entry, d),
      (r, _) => {
        const k = r.kind();
        const vid =
          k.$ === "RePlaceholder"
            ? constraints.placeholder_region(infcx.infcx, k._0).as_var()
            : universal_region_relations.universal_regions.to_region_vid(r);
        return Region.new_var(infcx.tcx, vid);
      },
      d,
    ),
  );
  return [opaque_types_storage_num_entries, opaque_types_];
}

/// Maps an NLL var to a deterministically chosen equal universal region.
///
/// See the corresponding [rustc-dev-guide chapter] for more details. This
/// ignores changes to the region values due to member constraints. Applying
/// member constraints does not impact the result of this function.
///
/// [rustc-dev-guide chapter]: https://rustc-dev-guide.rust-lang.org/borrow_check/opaque-types-region-inference-restrictions.html
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:96 nll_var_to_universal_region
function nll_var_to_universal_region(rcx: RegionCtxt, r: RegionVid): Region | undefined {
  // Use the SCC representative instead of directly using `region`.
  // See [rustc-dev-guide chapter] § "Strict lifetime equality".
  const vid = Representative.rvid(rcx.representative(r));
  const origin = index_vec(rcx.definitions, vid).origin;
  switch (origin.$) {
    // Iterate over all universal regions in a consistent order and find the
    // *first* equal region. This makes sure that equal lifetimes will have
    // the same name and simplifies subsequent handling.
    // See [rustc-dev-guide chapter] § "Semantic lifetime equality".
    case "FreeRegion": {
      for (const ur of rcx.universal_regions().universal_regions_iter()) {
        // See [rustc-dev-guide chapter] § "Closure restrictions".
        if (rcx.universal_regions().region_classification(ur) === "External") continue;
        if (rcx.universal_region_relations.equal(vid, ur)) {
          return unwrap(index_vec(rcx.definitions, ur).external_name);
        }
      }
      return undefined;
    }
    case "Placeholder": {
      const placeholder = origin._0;
      return Region.new_placeholder(rcx.infcx.tcx, placeholder);
    }
    // If `r` were equal to any universal region, its SCC representative
    // would have been set to a free region.
    case "Existential":
      return undefined;
  }
}

declare module "./mod.gen.ts" {
  interface UnexpectedHiddenRegion {
    // mod.rs:141
    to_error(): [LocalDefId, DeferredOpaqueTypeError];
  }
  interface ToArgRegionsFolder {
    // mod.rs:431
    fold_non_member_arg(arg: GenericArg): GenericArg;
    // mod.rs:439
    fold_closure_args(def_id: DefId, args: GenericArgsRef): Result<GenericArgsRef, RegionVid>;
    // mod.rs:456: `impl FallibleTypeFolder<TyCtxt> for ToArgRegionsFolder`
    cx(): TyCtxt;
    // mod.rs:460
    try_fold_region(r: Region): Result<Region, RegionVid>;
    // mod.rs:483
    try_fold_ty(ty: Ty): Result<Ty, RegionVid>;
    // (provided) the `FallibleTypeFolder` methods `ToArgRegionsFolder` does not override.
    try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, RegionVid>;
    try_fold_const(c: Const): Result<Const, RegionVid>;
    try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, RegionVid>;
    try_fold_clauses(c: Clauses): Result<Clauses, RegionVid>;
  }
  namespace ToArgRegionsFolder {
    // mod.rs:424
    function new_(rcx: RegionCtxt, arg_regions: readonly RegionVid[]): ToArgRegionsFolder;
    export { new_ as new };
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:141 to_error
UnexpectedHiddenRegion.prototype.to_error = function (this: UnexpectedHiddenRegion): [LocalDefId, DeferredOpaqueTypeError] {
  const { def_id, opaque_type_key, hidden_type, member_region } = this;
  return [
    def_id,
    {
      $: "UnexpectedHiddenRegion",
      opaque_type_key,
      hidden_type,
      member_region,
    },
  ];
};

/// Collect all defining uses of opaque types inside of this typeck root. This
/// expects the hidden type to be mapped to the definition parameters of the opaque
/// and errors if we end up with distinct hidden types.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:157 add_hidden_type
function add_hidden_type(
  tcx: TyCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  def_id: LocalDefId,
  hidden_ty: DefinitionSiteHiddenType,
): void {
  // Sometimes two opaque types are the same only after we remap the generic parameters
  // back to the opaque type definition. E.g. we may have `OpaqueType<X, Y>` mapped to
  // `(X, Y)` and `OpaqueType<Y, X>` mapped to `(Y, X)`, and those are the same, but we
  // only know that once we convert the generic parameters to those of the opaque type.
  const prev = hidden_types.get(def_id);
  if (prev !== undefined) {
    if (EarlyBinder.skip_binder(prev.ty) === EarlyBinder.skip_binder(hidden_ty.ty)) {
      // Pick a better span if there is one.
      // FIXME(oli-obk): collect multiple spans for better diagnostics down the road.
      // PORT: `prev.span = ..` through the `&mut` into the map: the fields are readonly, so the slot gets a new value.
      hidden_types.set(def_id, new DefinitionSiteHiddenType(Span.substitute_dummy(prev.span, hidden_ty.span), prev.ty));
    } else {
      const r = prev.build_mismatch_error(hidden_ty, tcx);
      const guar = r.$ === "Ok" ? r._0.emit_err() : r._0;
      hidden_types.set(def_id, DefinitionSiteHiddenType.new_error(tcx, guar));
    }
  } else {
    hidden_types.set(def_id, hidden_ty);
  }
}

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
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:203 compute_definition_site_hidden_types
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
  const errors: DeferredOpaqueTypeError[] = [];
  // When computing the hidden type we need to track member constraints.
  // We don't mutate the region graph used by `fn compute_regions` but instead
  // manually track region information via a `RegionCtxt`. We discard this
  // information at the end of this function.
  const rcx = RegionCtxt.new(infcx, universal_region_relations, location_map, constraints);

  // We start by checking each use of an opaque type during type check and
  // check whether the generic arguments of the opaque type are fully
  // universal, if so, it's a defining use.
  const defining_uses = collect_defining_uses(rcx, hidden_types, opaque_types, errors);

  // We now compute and apply member constraints for all regions in the hidden
  // types of each defining use. This mutates the region values of the `rcx` which
  // is used when mapping the defining uses to the definition site.
  apply_member_constraints(rcx, defining_uses);

  // After applying member constraints, we now check whether all member regions ended
  // up equal to one of their choice regions and compute the actual hidden type of
  // the opaque type definition. This is stored in the `root_cx`.
  compute_definition_site_hidden_types_from_defining_uses(
    def_id,
    rcx,
    hidden_types,
    unconstrained_hidden_type_errors,
    defining_uses,
    errors,
  );
  return errors;
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:245 collect_defining_uses
function collect_defining_uses(
  rcx: RegionCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  opaque_types: readonly [OpaqueTypeKey, ProvisionalHiddenType][],
  errors: DeferredOpaqueTypeError[],
): DefiningUse[] {
  const infcx = rcx.infcx;
  const defining_uses: DefiningUse[] = [];
  for (const [opaque_type_key, hidden_type] of opaque_types) {
    const non_nll_opaque_type_key = OpaqueTypeKey.fold_captured_lifetime_args(opaque_type_key, infcx.tcx, (r) => {
      return nll_var_to_universal_region(rcx, r.as_var()) ?? r;
    });
    const res = opaque_type_has_defining_use_args(infcx.infcx, non_nll_opaque_type_key, hidden_type.span, "MirBorrowck");
    if (res.$ === "Err") {
      const err = res._0;
      // A non-defining use. This is a hard error on stable and gets ignored
      // with `TypingMode::PostTypeckUntilBorrowck`.
      if (infcx.tcx.use_typing_mode_post_typeck_until_borrowck()) {
        switch (err.$) {
          case "Tainted": {
            const guar = err._0;
            add_hidden_type(infcx.tcx, hidden_types, opaque_type_key.def_id, DefinitionSiteHiddenType.new_error(infcx.tcx, guar));
            break;
          }
          default:
            // debug!(?non_nll_opaque_type_key, ?err, "ignoring non-defining use")
            break;
        }
      } else {
        errors.push({ $: "InvalidOpaqueTypeArgs", _0: err });
        // debug!(
        //     "collect_defining_uses: InvalidOpaqueTypeArgs for {:?} := {:?}",
        //     non_nll_opaque_type_key, hidden_type
        // );
      }
      continue;
    }

    // We use the original `opaque_type_key` to compute the `arg_regions`.
    const arg_regions: RegionVid[] = [rcx.universal_regions().fr_static];
    for (const [_, arg] of OpaqueTypeKey.iter_captured_args(opaque_type_key, infcx.tcx)) {
      const r = GenericArg.as_region(arg);
      if (r !== undefined) arg_regions.push(r.as_var());
    }
    defining_uses.push({
      opaque_type_key: non_nll_opaque_type_key,
      arg_regions,
      hidden_type,
    });
  }

  return defining_uses;
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:305 compute_definition_site_hidden_types_from_defining_uses
function compute_definition_site_hidden_types_from_defining_uses(
  def_id: LocalDefId,
  rcx: RegionCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  unconstrained_hidden_type_errors: UnexpectedHiddenRegion[],
  defining_uses: readonly DefiningUse[],
  errors: DeferredOpaqueTypeError[],
): void {
  const infcx = rcx.infcx;
  const tcx = infcx.tcx;
  const decls_modulo_regions = new KeyedMap<OpaqueTypeKey, [OpaqueTypeKey, Span]>(intern_key);
  for (const { opaque_type_key, arg_regions, hidden_type: hidden_type0 } of defining_uses) {
    // debug!(?opaque_type_key, ?arg_regions, ?hidden_type);
    // After applying member constraints, we now map all regions in the hidden type
    // to the `arg_regions` of this defining use. In case a region in the hidden type
    // ended up not being equal to any such region, we error.
    let hidden_type_: ProvisionalHiddenType;
    const folded = fold_ProvisionalHiddenType.try_fold_with(hidden_type0, ToArgRegionsFolder.new(rcx, arg_regions));
    if (folded.$ === "Ok") {
      hidden_type_ = folded._0;
    } else {
      const r = folded._0;
      const hidden_type = hidden_type0;
      // debug!("UnexpectedHiddenRegion: {:?}", r);
      // If we're using the next solver, the unconstrained region may be resolved by a
      // fully defining use from another body.
      // So we don't generate error eagerly here.
      if (rcx.infcx.tcx.use_typing_mode_post_typeck_until_borrowck()) {
        unconstrained_hidden_type_errors.push(
          new UnexpectedHiddenRegion(def_id, opaque_type_key, hidden_type, Region.new_var(tcx, r)),
        );
        continue;
      } else {
        errors.push({
          $: "UnexpectedHiddenRegion",
          hidden_type,
          opaque_type_key,
          member_region: Region.new_var(tcx, r),
        });
        const guar = tcx.dcx().span_delayed_bug(hidden_type.span, "opaque type with non-universal region args");
        hidden_type_ = ProvisionalHiddenType.new_error(tcx, guar);
      }
    }

    // Now that we mapped the member regions to their final value,
    // map the arguments of the opaque type key back to the parameters
    // of the opaque type definition.
    const inferred = infcx.infcx.infer_opaque_definition_from_instantiation(opaque_type_key, hidden_type_);
    let hidden_type: DefinitionSiteHiddenType;
    if (inferred.$ === "Ok") {
      hidden_type = inferred._0;
    } else {
      const guar = tcx.dcx().span_delayed_bug(hidden_type_.span, "deferred invalid opaque type args");
      hidden_type = DefinitionSiteHiddenType.new_error(tcx, guar);
    }

    if (!rcx.infcx.tcx.use_typing_mode_post_typeck_until_borrowck()) {
      // Sometimes, when the hidden type is an inference variable, it can happen that
      // the hidden type becomes the opaque type itself. In this case, this was an opaque
      // usage of the opaque type and we can ignore it. This check is mirrored in typeck's
      // writeback.
      const k = EarlyBinder.skip_binder(hidden_type.ty).kind();
      if (
        k.$ === "Alias" &&
        k._1.kind.$ === "Opaque" &&
        DefId_eq(k._1.kind.def_id, LocalDefId.to_def_id(opaque_type_key.def_id)) &&
        k._1.args === opaque_type_key.args
      ) {
        continue;
      }

      // Check that all opaque types have the same region parameters if they have the same
      // non-region parameters. This is necessary because within the new solver we perform
      // various query operations modulo regions, and thus could unsoundly select some impls
      // that don't hold.
      const erased_key = rcx.infcx.tcx.erase_and_anonymize_regions(opaque_type_key, fold_OpaqueTypeKey);
      // `IndexMap::insert` keeps the slot of an existing key and returns the previous value.
      const prev = decls_modulo_regions.get(erased_key);
      decls_modulo_regions.set(erased_key, [opaque_type_key, hidden_type.span]);
      if (prev !== undefined) {
        const [prev_decl_key, prev_span] = prev;
        const args1 = [...OpaqueTypeKey.iter_captured_args(prev_decl_key, infcx.tcx)].map(([_, arg]) => arg);
        const args2 = [...OpaqueTypeKey.iter_captured_args(opaque_type_key, infcx.tcx)].map(([_, arg]) => arg);
        const n = Math.min(args1.length, args2.length);
        for (let i = 0; i < n; i++) {
          const arg1 = args1[i]!;
          const arg2 = args2[i]!;
          if (arg1 !== arg2) {
            errors.push({
              $: "LifetimeMismatchOpaqueParam",
              _0: {
                arg: arg1,
                prev: arg2,
                span: prev_span,
                prev_span: hidden_type.span,
              },
            });
            break;
          }
        }
      }
    }

    add_hidden_type(tcx, hidden_types, opaque_type_key.def_id, hidden_type);
  }
}

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:424 new
(ToArgRegionsFolder as unknown as { new: typeof ToArgRegionsFolder.new }).new = function (
  rcx: RegionCtxt,
  arg_regions: readonly RegionVid[],
): ToArgRegionsFolder {
  return new ToArgRegionsFolder(rcx, false, arg_regions);
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:431 fold_non_member_arg
ToArgRegionsFolder.prototype.fold_non_member_arg = function (this: ToArgRegionsFolder, arg: GenericArg): GenericArg {
  const prev = this.erase_unknown_regions;
  this.erase_unknown_regions = true;
  const res = unwrap_result(fold_GenericArg.try_fold_with(arg, this), debug_RegionVid);
  this.erase_unknown_regions = prev;
  return res;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:439 fold_closure_args
ToArgRegionsFolder.prototype.fold_closure_args = function (
  this: ToArgRegionsFolder,
  def_id: DefId,
  args: GenericArgsRef,
): Result<GenericArgsRef, RegionVid> {
  const generics = this.cx().generics_of(def_id) as Generics;
  // PORT: `mk_args_from_iter` over `Result`s collects until the first `Err` (`CollectAndApply for Result`).
  const out: GenericArg[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (index < generics.parent_count) {
      out.push(this.fold_non_member_arg(arg));
    } else {
      const r = fold_GenericArg.try_fold_with(arg, this);
      if (r.$ === "Err") return r;
      out.push(r._0);
    }
  }
  return Ok(this.cx().mk_args(out));
};

// impl<'tcx> FallibleTypeFolder<TyCtxt<'tcx>> for ToArgRegionsFolder<'_, 'tcx> (type Error = RegionVid)
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:456 cx
ToArgRegionsFolder.prototype.cx = function (this: ToArgRegionsFolder): TyCtxt {
  return this.rcx.infcx.tcx;
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:460 try_fold_region
ToArgRegionsFolder.prototype.try_fold_region = function (this: ToArgRegionsFolder, r: Region): Result<Region, RegionVid> {
  switch (r.kind().$) {
    // ignore bound regions, keep visiting
    case "ReBound":
      return Ok(r);
    default: {
      const r_ = r.as_var();
      let arg_region: Region | undefined;
      for (const arg_vid of this.arg_regions) {
        if (this.rcx.eval_equal(r_, arg_vid)) {
          arg_region = nll_var_to_universal_region(this.rcx, arg_vid);
          break;
        }
      }
      if (arg_region !== undefined) {
        return Ok(arg_region);
      } else if (this.erase_unknown_regions) {
        return Ok(this.cx().lifetimes.re_erased);
      } else {
        return Err(r_);
      }
    }
  }
};

// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:483 try_fold_ty
ToArgRegionsFolder.prototype.try_fold_ty = function (this: ToArgRegionsFolder, ty: Ty): Result<Ty, RegionVid> {
  if (!TypeFlags.intersects(ty.flags(), TypeFlags.HAS_FREE_REGIONS)) {
    return Ok(ty);
  }

  const tcx = this.cx();
  const k = ty.kind();
  switch (k.$) {
    case "Closure": {
      const r = this.fold_closure_args(k._0, k._1);
      if (r.$ === "Err") return r;
      return Ok(Ty.new_closure(tcx, k._0, r._0));
    }

    case "CoroutineClosure": {
      const r = this.fold_closure_args(k._0, k._1);
      if (r.$ === "Err") return r;
      return Ok(Ty.new_coroutine_closure(tcx, k._0, r._0));
    }

    case "Coroutine": {
      const r = this.fold_closure_args(k._0, k._1);
      if (r.$ === "Err") return r;
      return Ok(Ty.new_coroutine(tcx, k._0, r._0));
    }

    case "Alias": {
      const { kind, args } = k._1;
      const variances = tcx.opt_alias_variances(AliasTermKind.from_AliasTyKind(kind));
      if (variances !== undefined) {
        // PORT: `mk_args_from_iter(zip(variances, args).map(..))` over `Result`s: collected until the first `Err`.
        const out: GenericArg[] = [];
        const n = Math.min(variances.length, args.length);
        for (let i = 0; i < n; i++) {
          const v = variances[i]!;
          const s = args[i]!;
          if (v === "Bivariant") {
            out.push(this.fold_non_member_arg(s));
          } else {
            const r = fold_GenericArg.try_fold_with(s, this);
            if (r.$ === "Err") return r;
            out.push(r._0);
          }
        }
        const args_ = tcx.mk_args(out);
        return Ok(AliasTy.to_ty(AliasTy.new_from_args(tcx, kind, args_), tcx, IsRigid.No));
      }
      break;
    }
  }
  return fold_Ty.try_super_fold_with(ty, this);
};

/// This function is what actually applies member constraints to the borrowck
/// state. It is also responsible to check all uses of the opaques in their
/// defining scope.
///
/// It does this by equating the hidden type of each use with the instantiated final
/// hidden type of the opaque.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:528 apply_definition_site_hidden_types
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
  const tcx = infcx.tcx;
  const errors: DeferredOpaqueTypeError[] = [];
  for (const [key, hidden_type] of opaque_types) {
    const expected = hidden_types.get(key.def_id);
    if (expected === undefined) {
      if (!tcx.use_typing_mode_post_typeck_until_borrowck()) {
        const k = hidden_type.ty.kind();
        if (
          k.$ === "Alias" &&
          k._1.kind.$ === "Opaque" &&
          DefId_eq(k._1.kind.def_id, LocalDefId.to_def_id(key.def_id)) &&
          k._1.args === key.args
        ) {
          continue;
        } else {
          unreachable("non-defining use in defining scope");
        }
      }
      errors.push({
        $: "NonDefiningUseInDefiningScope",
        span: hidden_type.span,
        opaque_type_key: key,
      });
      const guar = tcx.dcx().span_delayed_bug(hidden_type.span, "non-defining use in the defining scope with no defining uses");
      add_hidden_type(tcx, hidden_types, key.def_id, DefinitionSiteHiddenType.new_error(tcx, guar));
      continue;
    }

    // We erase all non-member region of the opaque and need to treat these as existentials.
    const expected_ty = fold_regions(
      tcx,
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate(expected.ty, tcx, key.args, fold_Ty)),
      (re, _dbi) => {
        switch (re.kind().$) {
          case "ReErased":
            return infcx.next_nll_region_var({ $: "Existential", name: undefined }, () => ({ $: "Existential", _0: undefined }));
          default:
            return re;
        }
      },
      fold_Ty,
    );

    // We now simply equate the expected with the actual hidden type.
    const locations: Locations = { $: "All", _0: hidden_type.span };
    const r = fully_perform_op_raw(
      infcx,
      body,
      universal_regions,
      region_bound_pairs,
      known_type_outlives_obligations,
      constraints,
      locations,
      ConstraintCategory.OpaqueType,
      CustomTypeOp.new<null>((ocx) => {
        const cause = ObligationCause.misc(hidden_type.span, body.source.def_id().expect_local());
        // We need to normalize both types in the old solver before equatingt them.
        const actual_ty = ocx.normalize(cause, infcx.param_env, Unnormalized.new_wip(hidden_type.ty), fold_Ty);
        const expected_ty_ = ocx.normalize(cause, infcx.param_env, Unnormalized.new_wip(expected_ty), fold_Ty);
        const e = ocx.eq(cause, infcx.param_env, actual_ty, expected_ty_, ToTrace_Ty);
        if (e.$ === "Err") return Err(NO_SOLUTION);
        return Ok(null);
      }, "equating opaque types"),
      TypeOp_CustomTypeOp(fold_unit),
      ToUniverseInfo_never,
    );
    if (r.$ === "Err") {
      const guar = r._0;
      add_hidden_type(tcx, hidden_types, key.def_id, DefinitionSiteHiddenType.new_error(tcx, guar));
    }
  }
  return errors;
}

/// We handle `UnexpectedHiddenRegion` error lazily in the next solver as
/// there may be a fully defining use in another body.
///
/// In case such a defining use does not exist, we register an error here.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:628 handle_unconstrained_hidden_type_errors
export function handle_unconstrained_hidden_type_errors(
  tcx: TyCtxt,
  hidden_types: Map<LocalDefId, DefinitionSiteHiddenType>,
  unconstrained_hidden_type_errors: UnexpectedHiddenRegion[],
  collect_region_constraints_results: Map<LocalDefId, CollectRegionConstraintsResult>,
): void {
  // `std::mem::take`
  let unconstrained_hidden_type_errors_ = unconstrained_hidden_type_errors.splice(0);
  unconstrained_hidden_type_errors_ = unconstrained_hidden_type_errors_.filter(
    (unconstrained) => !hidden_types.has(unconstrained.opaque_type_key.def_id),
  );

  for (const t of unconstrained_hidden_type_errors_) {
    tcx.dcx().span_delayed_bug(t.hidden_type.span, "opaque type with non-universal region args");
  }

  // `UnexpectedHiddenRegion` error contains region var which only makes sense in the
  // corresponding `infcx`.
  // So we need to insert the error to the body where it originates from.
  for (const error_ of unconstrained_hidden_type_errors_) {
    const [def_id, error] = error_.to_error();
    const result = collect_region_constraints_results.get(def_id);
    if (result === undefined) {
      unreachable("the body should depend on opaques type if it has opaque use");
    }
    result.deferred_opaque_type_errors.push(error);
  }
}

/// In theory `apply_definition_site_hidden_types` could introduce new uses of opaque types.
/// We do not check these new uses so this could be unsound.
///
/// We detect any new uses and simply delay a bug if they occur. If this results in
/// an ICE we can properly handle this, but we haven't encountered any such test yet.
///
/// See the related comment in `FnCtxt::detect_opaque_types_added_during_writeback`.
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:665 detect_opaque_types_added_while_handling_opaque_types
export function detect_opaque_types_added_while_handling_opaque_types(
  infcx: InferCtxt,
  opaque_types_storage_num_entries: OpaqueTypeStorageEntries,
): void {
  for (const [key, hidden_type] of infcx.inner.opaque_types().deref().opaque_types_added_since(opaque_types_storage_num_entries)) {
    const opaque_type_string = infcx.tcx.def_path_str(LocalDefId.to_def_id(key.def_id));
    const msg = `unexpected cyclic definition of \`${opaque_type_string}\``;
    infcx.dcx().span_delayed_bug(hidden_type.span, msg);
  }

  void infcx.take_opaque_types();
}

declare module "../region_context.gen.ts" {
  interface RegionInferenceContext {
    // opaque_types/mod.rs:696
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
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:696 name_regions_for_member_constraint
RegionInferenceContext.prototype.name_regions_for_member_constraint = function <T>(
  this: RegionInferenceContext,
  tcx: TyCtxt,
  ty: T,
  d_T: TypeFoldable<T>,
): T {
  return fold_regions(
    tcx,
    ty,
    (region, _) => {
      const k = region.kind();
      switch (k.$) {
        case "ReVar": {
          const vid = k._0;
          const scc = this.constraint_sccs.scc(vid);

          // Special handling of higher-ranked regions.
          if (!UniverseIndex.is_root(this.max_nameable_universe(scc))) {
            let last: [number, PlaceholderRegion] | undefined;
            let i = 0;
            for (const placeholder of this.scc_values.placeholders_contained_in(scc)) {
              last = [i, placeholder];
              i++;
            }
            // If the region contains a single placeholder then they're equal.
            if (last !== undefined && last[0] === 0) {
              const placeholder = last[1];
              return Region.new_placeholder(tcx, placeholder);
            }

            // Fallback: this will produce a cryptic error message.
            return region;
          }

          // Find something that we can name
          const upper_bound = this.approx_universal_upper_bound(vid);
          const universal_region = index_vec(this.definitions, upper_bound).external_name;
          if (universal_region !== undefined) {
            return universal_region;
          }

          // Nothing exact found, so we pick a named upper bound, if there's only one.
          // If there's >1 universal region, then we probably are dealing w/ an intersection
          // region which cannot be mapped back to a universal.
          // FIXME: We could probably compute the LUB if there is one.
          const scc_ = this.constraint_sccs.scc(vid);
          const rev_scc_graph = ReverseSccGraph.compute(this.constraint_sccs, this.universal_regions());
          const upper_bounds: Region[] = [];
          for (const vid_ of rev_scc_graph.upper_bounds(scc_)) {
            const r = index_vec(this.definitions, vid_).external_name;
            if (r !== undefined && !r.is_static()) upper_bounds.push(r);
          }
          if (upper_bounds.length === 1) {
            return upper_bounds[0]!;
          }
          return region;
        }
        default:
          return region;
      }
    },
    d_T,
  );
};

declare module "../../../rustc_infer/decls.ts" {
  interface InferCtxt {
    // ---- rustc_borrowck region_infer/opaque_types/mod.rs: `#[extension(pub trait InferCtxtExt)] impl InferCtxt` ----
    // opaque_types/mod.rs:764
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
// rustc: compiler/rustc_borrowck/src/region_infer/opaque_types/mod.rs:764 infer_opaque_definition_from_instantiation
InferCtxt.prototype.infer_opaque_definition_from_instantiation = function (
  this: InferCtxt,
  opaque_type_key: OpaqueTypeKey,
  instantiated_ty: ProvisionalHiddenType,
): Result<DefinitionSiteHiddenType, NonDefiningUseReason> {
  const r = opaque_type_has_defining_use_args(this, opaque_type_key, instantiated_ty.span, "MirBorrowck");
  if (r.$ === "Err") return r;

  const definition_ty = instantiated_ty.remap_generic_params_to_declaration_params(opaque_type_key, this.tcx, "MirBorrowck");
  const e = TypeVisitableExt.error_reported(EarlyBinder.skip_binder(definition_ty.ty), fold_Ty);
  // PORT: `?` converts the `ErrorGuaranteed` with `impl From<ErrorGuaranteed> for NonDefiningUseReason`.
  if (e.$ === "Err") return Err(NonDefiningUseReason.from(e._0));
  return Ok(definition_ty);
};

// The provided methods of `impl FallibleTypeFolder<TyCtxt<'tcx>> for ToArgRegionsFolder`.
ToArgRegionsFolder.prototype.try_fold_binder = function <T>(this: ToArgRegionsFolder, t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, RegionVid> {
  return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
};
ToArgRegionsFolder.prototype.try_fold_const = function (this: ToArgRegionsFolder, c: Const): Result<Const, RegionVid> {
  return FallibleTypeFolder_provided.try_fold_const(this, c);
};
ToArgRegionsFolder.prototype.try_fold_predicate = function <P>(this: ToArgRegionsFolder, p: P, d: PredicateProxy<P>): Result<P, RegionVid> {
  return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
};
ToArgRegionsFolder.prototype.try_fold_clauses = function (this: ToArgRegionsFolder, c: Clauses): Result<Clauses, RegionVid> {
  return FallibleTypeFolder_provided.try_fold_clauses(this, c);
};

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** `vec[i]` (panics out of bounds, like `Index for IndexVec`). */
function index_vec<T>(v: readonly T[], i: number): T {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

/** The derived `TypeFoldable` of `OpaqueTypeKey<'tcx>` (rustc_hir_typeck opaque_types.ts precedent). */
const fold_OpaqueTypeKey: TypeFoldable<OpaqueTypeKey> = {
  visit_with: visit_with_OpaqueTypeKey,
  try_fold_with: try_fold_with_OpaqueTypeKey,
  fold_with: fold_with_OpaqueTypeKey,
};
/** The derived `TypeFoldable` of `ty::ProvisionalHiddenType` (rustc_middle ty/mod.rs, generated; read on use: init order). */
const fold_ProvisionalHiddenType: TypeFoldable<ProvisionalHiddenType> = {
  visit_with: (self, visitor) => middle_ty.visit_with_ProvisionalHiddenType(self, visitor),
  try_fold_with: <E>(self: ProvisionalHiddenType, folder: FallibleTypeFolder<E>) => middle_ty.try_fold_with_ProvisionalHiddenType(self, folder),
  fold_with: (self, folder) => middle_ty.fold_with_ProvisionalHiddenType(self, folder),
};
/** `(OpaqueTypeKey<'tcx>, ProvisionalHiddenType<'tcx>)` */
function fold_OpaqueTypeKey_ProvisionalHiddenType(): TypeFoldable<[OpaqueTypeKey, ProvisionalHiddenType]> {
  return fold_tuple2(fold_OpaqueTypeKey, fold_ProvisionalHiddenType);
}
