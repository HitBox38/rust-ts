// Port of compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: the crate trait `TypeOpInfo` is used as `Rc<dyn TypeOpInfo<'tcx> + 'tcx>` (`UniverseInfo::TypeOp`): `TypeOpInfo`
// is the trait-object interface (self-less methods), `TypeOpInfo_impl<T>` the impl-table shape (methods take `self`
// first), `TypeOpInfo_<Type>` the impl tables of the four implementors (generated data interfaces, no prototype) and
// `TypeOpInfo_of(self, impl)` builds the trait object (`Rc::new(x)` coerced to `Rc<dyn TypeOpInfo>`); the provided
// method lives in `TypeOpInfo_provided` (PORTING §8). `ToUniverseInfo` likewise: `ToUniverseInfo<T>` impl tables
// `ToUniverseInfo_<Type>`; the impl for `!` is `ToUniverseInfo_never`.
// PORT: `T: Copy + fmt::Display + TypeFoldable<TyCtxt>` of the `NormalizeQuery<T>` / `CanonicalTypeOpNormalizeGoal<T>`
// impls become the parameters `display_T` / `d_T` of the impl-table constructors (errctxt-contract signature rule 5).
import { fold_ParamEnvAnd } from "../../rust_ts/fold_param_env_and.ts";
import { intern_key_eq } from "../../rust_ts/intern_key.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { RegionResolutionError } from "../../rustc_infer/infer/lexical_region_resolve/mod.ts";
import { clone_SubregionOrigin, type RegionVariableOrigin, type SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import { clone_RegionConstraintData, type Constraint, type RegionConstraintData } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import {
  type CanonicalTypeOpAscribeUserTypeGoal,
  type CanonicalTypeOpNormalizeGoal,
  type CanonicalTypeOpProvePredicateGoal,
  type_op as middle_type_op,
} from "../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { ParamEnv, Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Predicate } from "../../rustc_middle/ty/print/pretty.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { NiceRegionError } from "../../rustc_trait_selection/error_reporting/infer/nice_region_error/mod.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { type_op_ascribe_user_type_with_span } from "../../rustc_trait_selection/traits/query/type_op/ascribe_user_type.ts";
import { type_op_prove_predicate_with_cause } from "../../rustc_trait_selection/traits/query/type_op/prove_predicate.ts";
import { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import type { MirBorrowckCtxt } from "../lib.gen.ts";
import { HigherRankedLifetimeError_diagnostic, HigherRankedSubtypeError_diagnostic } from "../session_diagnostics.gen.ts";
import type { InstantiateOpaqueType } from "../type_check/mod.gen.ts";
import * as gen from "./bound_region_errors.gen.ts";
import type { AscribeUserTypeQuery, NormalizeQuery, PredicateQuery } from "./bound_region_errors.gen.ts";

export * from "./bound_region_errors.gen.ts";

// PORT: the `TypeFoldable` impls of the type-op keys handed to `build_with_canonical` (derived upstream; D4
// descriptors as in rustc_traits type_op.ts).
const d_ParamEnvAnd_ProvePredicate = fold_ParamEnvAnd<middle_type_op.ProvePredicate>({
  visit_with: middle_type_op.visit_with_ProvePredicate,
  try_fold_with: middle_type_op.try_fold_with_ProvePredicate,
  fold_with: middle_type_op.fold_with_ProvePredicate,
});
const d_ParamEnvAnd_AscribeUserType = fold_ParamEnvAnd<middle_type_op.AscribeUserType>({
  visit_with: middle_type_op.visit_with_AscribeUserType,
  try_fold_with: middle_type_op.try_fold_with_AscribeUserType,
  fold_with: middle_type_op.fold_with_AscribeUserType,
});
/** `Normalize<T>: TypeFoldable` (derived, generic over `T`). */
function d_Normalize<T>(d_T: TypeFoldable<T>): TypeFoldable<middle_type_op.Normalize<T>> {
  return {
    visit_with: (self, v) => middle_type_op.visit_with_Normalize(self, v, d_T.visit_with),
    try_fold_with: (self, f) => middle_type_op.try_fold_with_Normalize(self, f, d_T.try_fold_with),
    fold_with: (self, f) => middle_type_op.fold_with_Normalize(self, f, d_T.fold_with),
  };
}

/** PORT: `u32::checked_sub`. */
function checked_sub_u32(a: number, b: number): number | undefined {
  return a >= b ? a - b : undefined;
}

// impl<'tcx> UniverseInfo<'tcx>
export interface UniverseInfo_methods {
  // bound_region_errors.rs:44
  other(): UniverseInfo;
  // bound_region_errors.rs:48
  relate(expected: Ty, found: Ty): UniverseInfo;
  // bound_region_errors.rs:53
  report_erroneous_element(
    self: UniverseInfo,
    mbcx: MirBorrowckCtxt,
    placeholder: PlaceholderRegion,
    error_element: PlaceholderRegion | undefined,
    cause: ObligationCause,
  ): void;
}
export type UniverseInfo = gen.UniverseInfo;
export const UniverseInfo = gen.UniverseInfo as typeof gen.UniverseInfo & UniverseInfo_methods;

// rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:44 other
UniverseInfo.other = function (): UniverseInfo {
  return UniverseInfo.Other;
};

// rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:48 relate
UniverseInfo.relate = function (expected: Ty, found: Ty): UniverseInfo {
  return { $: "RelateTys", expected, found };
};

/// Report an error where an element erroneously made its way into `placeholder`.
// rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:53 report_erroneous_element
UniverseInfo.report_erroneous_element = function (
  self: UniverseInfo,
  mbcx: MirBorrowckCtxt,
  placeholder: PlaceholderRegion,
  error_element: PlaceholderRegion | undefined,
  cause: ObligationCause,
): void {
  switch (self.$) {
    case "RelateTys": {
      const { expected, found } = self;
      const err = mbcx.infcx.err_ctxt().report_mismatched_types(cause, mbcx.infcx.param_env, expected, found, {
        $: "RegionsPlaceholderMismatch",
      });
      mbcx.buffer_error(err);
      break;
    }
    case "TypeOp": {
      const type_op_info = self._0;
      type_op_info.report_erroneous_element(mbcx, placeholder, error_element, cause);
      break;
    }
    case "Other": {
      // FIXME: This error message isn't great, but it doesn't show
      // up in the existing UI tests. Consider investigating this
      // some more.
      mbcx.buffer_error(mbcx.dcx().create_err(HigherRankedSubtypeError_diagnostic({ span: cause.span })));
      break;
    }
  }
};

/** `pub(crate) trait ToUniverseInfo<'tcx>`: the impl table of a type `T`. */
export interface ToUniverseInfo<T> {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:87 to_universe_info
  to_universe_info(self: T, base_universe: UniverseIndex): UniverseInfo;
}

// impl<'tcx> ToUniverseInfo<'tcx> for crate::type_check::InstantiateOpaqueType<'tcx>
export const ToUniverseInfo_InstantiateOpaqueType: ToUniverseInfo<InstantiateOpaqueType> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:91 to_universe_info
  to_universe_info(self: InstantiateOpaqueType, base_universe: UniverseIndex): UniverseInfo {
    return {
      $: "TypeOp",
      _0: TypeOpInfo_of<InstantiateOpaqueType>({ ...self, base_universe: base_universe }, TypeOpInfo_InstantiateOpaqueType),
    };
  },
};

// impl<'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpProvePredicateGoal<'tcx>
export const ToUniverseInfo_CanonicalTypeOpProvePredicateGoal: ToUniverseInfo<CanonicalTypeOpProvePredicateGoal> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:100 to_universe_info
  to_universe_info(self: CanonicalTypeOpProvePredicateGoal, base_universe: UniverseIndex): UniverseInfo {
    return { $: "TypeOp", _0: TypeOpInfo_of<PredicateQuery>({ canonical_query: self, base_universe }, TypeOpInfo_PredicateQuery) };
  },
};

// impl<'tcx, T: Copy + fmt::Display + TypeFoldable<TyCtxt<'tcx>> + 'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpNormalizeGoal<'tcx, T>
export function ToUniverseInfo_CanonicalTypeOpNormalizeGoal<T>(
  display_T: (v: T) => string,
  d_T: TypeFoldable<T>,
): ToUniverseInfo<CanonicalTypeOpNormalizeGoal<T>> {
  return {
    // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:108 to_universe_info
    to_universe_info(self: CanonicalTypeOpNormalizeGoal<T>, base_universe: UniverseIndex): UniverseInfo {
      return {
        $: "TypeOp",
        _0: TypeOpInfo_of<NormalizeQuery<T>>({ canonical_query: self, base_universe }, TypeOpInfo_NormalizeQuery(display_T, d_T)),
      };
    },
  };
}

// impl<'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpAscribeUserTypeGoal<'tcx>
export const ToUniverseInfo_CanonicalTypeOpAscribeUserTypeGoal: ToUniverseInfo<CanonicalTypeOpAscribeUserTypeGoal> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:114 to_universe_info
  to_universe_info(self: CanonicalTypeOpAscribeUserTypeGoal, base_universe: UniverseIndex): UniverseInfo {
    return {
      $: "TypeOp",
      _0: TypeOpInfo_of<AscribeUserTypeQuery>({ canonical_query: self, base_universe }, TypeOpInfo_AscribeUserTypeQuery),
    };
  },
};

// impl<'tcx> ToUniverseInfo<'tcx> for !
export const ToUniverseInfo_never: ToUniverseInfo<never> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:120 to_universe_info
  to_universe_info(self: never, _base_universe: UniverseIndex): UniverseInfo {
    return self;
  },
};

/** `dyn TypeOpInfo<'tcx>` (`Rc<dyn TypeOpInfo<'tcx> + 'tcx>`): the trait object, built by `TypeOpInfo_of`. */
export interface TypeOpInfo {
  /// Returns an error to be reported if rerunning the type op fails to
  /// recover the error's cause.
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:129 fallback_error
  fallback_error(tcx: TyCtxt, span: Span): Diag;
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:131 base_universe
  base_universe(): UniverseIndex;
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:133 nice_error
  nice_error(mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined;
  // (provided) bound_region_errors.rs:145 report_erroneous_element -> TypeOpInfo_provided.report_erroneous_element
  report_erroneous_element(mbcx: MirBorrowckCtxt, placeholder: PlaceholderRegion, error_element: PlaceholderRegion | undefined, cause: ObligationCause): void;
}

/** `impl TypeOpInfo for T`: the impl table of an implementor (the required methods, `self` first). */
export interface TypeOpInfo_impl<T> {
  fallback_error(self: T, tcx: TyCtxt, span: Span): Diag;
  base_universe(self: T): UniverseIndex;
  nice_error(self: T, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined;
}

/** PORT: the provided methods of `TypeOpInfo` (PORTING §8). */
export const TypeOpInfo_provided = {
  /// Constraints require that `error_element` appear in the
  /// values of `placeholder`, but this cannot be proven to
  /// hold. Report an error.
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:145 report_erroneous_element
  report_erroneous_element(
    self: TypeOpInfo,
    mbcx: MirBorrowckCtxt,
    placeholder: PlaceholderRegion,
    error_element: PlaceholderRegion | undefined,
    cause: ObligationCause,
  ): void {
    const tcx = mbcx.infcx.tcx;
    const base_universe = self.base_universe();
    // debug!(?base_universe);

    const adjusted_universe = checked_sub_u32(UniverseIndex.as_u32(placeholder.universe), UniverseIndex.as_u32(base_universe));
    if (adjusted_universe === undefined) {
      mbcx.buffer_error(self.fallback_error(tcx, cause.span));
      return;
    }

    const placeholder_region = Region.new_placeholder(tcx, PlaceholderRegion.new(UniverseIndex.from_u32(adjusted_universe), placeholder.bound));

    // FIXME: one day this should just be error_element,
    // and this method shouldn't do anything.
    let error_region: Region | undefined;
    if (error_element !== undefined) {
      const e = error_element;
      const adjusted_universe = checked_sub_u32(UniverseIndex.as_u32(e.universe), UniverseIndex.as_u32(base_universe));
      error_region =
        adjusted_universe === undefined
          ? undefined
          : Region.new_placeholder(tcx, PlaceholderRegion.new(UniverseIndex.from_u32(adjusted_universe), e.bound));
    }

    // debug!(?placeholder_region);

    const span = cause.span;
    const nice_error = self.nice_error(mbcx, cause, placeholder_region, error_region);

    // debug!(?nice_error);
    mbcx.buffer_error(nice_error !== undefined ? nice_error : self.fallback_error(tcx, span));
  },
};

/** PORT: `Rc::new(x) as Rc<dyn TypeOpInfo>`: the trait object of `self` with its impl table (not an upstream fn). */
export function TypeOpInfo_of<T>(self: T, impl: TypeOpInfo_impl<T>): TypeOpInfo {
  const obj: TypeOpInfo = {
    fallback_error: (tcx, span) => impl.fallback_error(self, tcx, span),
    base_universe: () => impl.base_universe(self),
    nice_error: (mbcx, cause, placeholder_region, error_region) => impl.nice_error(self, mbcx, cause, placeholder_region, error_region),
    report_erroneous_element: (mbcx, placeholder, error_element, cause) =>
      TypeOpInfo_provided.report_erroneous_element(obj, mbcx, placeholder, error_element, cause),
  };
  return obj;
}

// impl<'tcx> TypeOpInfo<'tcx> for PredicateQuery<'tcx>
export const TypeOpInfo_PredicateQuery: TypeOpInfo_impl<PredicateQuery> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:196 fallback_error
  fallback_error(self: PredicateQuery, tcx: TyCtxt, span: Span): Diag {
    return tcx.dcx().create_err(
      HigherRankedLifetimeError_diagnostic({
        cause: {
          $: "CouldNotProve",
          predicate: display_Predicate(self.canonical_query.canonical.value.value.predicate),
        },
        span,
      }),
    );
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:205 base_universe
  base_universe(self: PredicateQuery): UniverseIndex {
    return self.base_universe;
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:209 nice_error
  nice_error(self: PredicateQuery, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    const [infcx, key, _] = mbcx.infcx.tcx.infer_ctxt().build_with_canonical(cause.span, self.canonical_query, d_ParamEnvAnd_ProvePredicate);
    const ocx = ObligationCtxt.new(infcx);
    type_op_prove_predicate_with_cause(ocx, key, cause);
    const diag_ = try_extract_error_from_fulfill_cx(ocx, mbcx.mir_def_id(), placeholder_region, error_region);
    if (diag_ === undefined) return undefined;
    const diag = diag_.with_dcx(mbcx.dcx());
    return diag;
  },
};

// impl<'tcx, T> TypeOpInfo<'tcx> for NormalizeQuery<'tcx, T> where T: Copy + fmt::Display + TypeFoldable<TyCtxt<'tcx>> + 'tcx
export function TypeOpInfo_NormalizeQuery<T>(display_T: (v: T) => string, d_T: TypeFoldable<T>): TypeOpInfo_impl<NormalizeQuery<T>> {
  return {
    // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:240 fallback_error
    fallback_error(self: NormalizeQuery<T>, tcx: TyCtxt, span: Span): Diag {
      return tcx.dcx().create_err(
        HigherRankedLifetimeError_diagnostic({
          cause: {
            $: "CouldNotNormalize",
            value: display_T(Unnormalized.skip_normalization(self.canonical_query.canonical.value.value.value)),
          },
          span,
        }),
      );
    },

    // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:256 base_universe
    base_universe(self: NormalizeQuery<T>): UniverseIndex {
      return self.base_universe;
    },

    // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:260 nice_error
    nice_error(self: NormalizeQuery<T>, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
      const [infcx, key, _] = mbcx.infcx.tcx
        .infer_ctxt()
        .build_with_canonical(cause.span, self.canonical_query, fold_ParamEnvAnd(d_Normalize(d_T)));
      const ocx = ObligationCtxt.new(infcx);

      // FIXME(lqd): Unify and de-duplicate the following with the actual
      // `rustc_traits::type_op::type_op_normalize` query to allow the span we need in the
      // `ObligationCause`. The normalization results are currently different between
      // `QueryNormalizeExt::query_normalize` used in the query and `normalize` called below:
      // the former fails to normalize the `nll/relate_tys/impl-fn-ignore-binder-via-bottom.rs`
      // test. Check after #85499 lands to see if its fixes have erased this difference.
      const { param_env, value } = key;
      void ocx.normalize(cause, param_env, value.value, d_T);

      const diag_ = try_extract_error_from_fulfill_cx(ocx, mbcx.mir_def_id(), placeholder_region, error_region);
      if (diag_ === undefined) return undefined;
      const diag = diag_.with_dcx(mbcx.dcx());
      return diag;
    },
  };
}

// impl<'tcx> TypeOpInfo<'tcx> for AscribeUserTypeQuery<'tcx>
export const TypeOpInfo_AscribeUserTypeQuery: TypeOpInfo_impl<AscribeUserTypeQuery> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:297 fallback_error
  fallback_error(self: AscribeUserTypeQuery, tcx: TyCtxt, span: Span): Diag {
    // FIXME: This error message isn't great, but it doesn't show up in the existing UI tests,
    // and is only the fallback when the nice error fails. Consider improving this some more.
    return tcx.dcx().create_err(HigherRankedLifetimeError_diagnostic({ cause: undefined, span }));
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:303 base_universe
  base_universe(self: AscribeUserTypeQuery): UniverseIndex {
    return self.base_universe;
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:307 nice_error
  nice_error(self: AscribeUserTypeQuery, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    const [infcx, key, _] = mbcx.infcx.tcx.infer_ctxt().build_with_canonical(cause.span, self.canonical_query, d_ParamEnvAnd_AscribeUserType);
    const ocx = ObligationCtxt.new(infcx);
    if (type_op_ascribe_user_type_with_span(ocx, key, cause.span).$ === "Err") return undefined;
    const diag_ = try_extract_error_from_fulfill_cx(ocx, mbcx.mir_def_id(), placeholder_region, error_region);
    if (diag_ === undefined) return undefined;
    const diag = diag_.with_dcx(mbcx.dcx());
    return diag;
  },
};

// impl<'tcx> TypeOpInfo<'tcx> for crate::type_check::InstantiateOpaqueType<'tcx>
export const TypeOpInfo_InstantiateOpaqueType: TypeOpInfo_impl<InstantiateOpaqueType> = {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:330 fallback_error
  fallback_error(self: InstantiateOpaqueType, tcx: TyCtxt, span: Span): Diag {
    // FIXME: This error message isn't great, but it doesn't show up in the existing UI tests,
    // and is only the fallback when the nice error fails. Consider improving this some more.
    return tcx.dcx().create_err(HigherRankedLifetimeError_diagnostic({ cause: undefined, span }));
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:336 base_universe
  base_universe(self: InstantiateOpaqueType): UniverseIndex {
    return unwrap(self.base_universe);
  },

  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:340 nice_error
  nice_error(self: InstantiateOpaqueType, mbcx: MirBorrowckCtxt, _cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    // PORT: `mbcx.infcx` (`&BorrowckInferCtxt`) deref-coerces to `&InferCtxt`: its field `infcx`.
    const d = try_extract_error_from_region_constraints(
      mbcx.infcx.infcx,
      mbcx.mir_def_id(),
      placeholder_region,
      error_region,
      unwrap(self.region_constraints),
      // We're using the original `InferCtxt` that we
      // started MIR borrowchecking with, so the region
      // constraints have already been taken. Use the data from
      // our `mbcx` instead.
      (vid) => ({ $: "Nll", _0: mbcx.regioncx.definitions[vid]!.origin }),
      (vid) => mbcx.regioncx.definitions[vid]!.universe,
    );
    return d === undefined ? undefined : d.with_dcx(mbcx.dcx());
  },
};

// rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:365 try_extract_error_from_fulfill_cx
export function try_extract_error_from_fulfill_cx(
  ocx: ObligationCtxt,
  generic_param_scope: LocalDefId,
  placeholder_region: Region,
  error_region: Region | undefined,
): Diag | undefined {
  // We generally shouldn't have errors here because the query was
  // already run, but there's no point using `span_delayed_bug`
  // when we're going to emit an error here anyway.
  const _errors = ocx.evaluate_obligations_error_on_ambiguity();
  const region_constraints = ocx.infcx.with_region_constraints((r) => clone_RegionConstraintData(r));
  return try_extract_error_from_region_constraints(
    ocx.infcx,
    generic_param_scope,
    placeholder_region,
    error_region,
    region_constraints,
    (vid) => ocx.infcx.region_var_origin(vid),
    (vid) => ocx.infcx.universe_of_region(Region.new_var(ocx.infcx.tcx, vid)),
  );
}

// rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:388 try_extract_error_from_region_constraints
export function try_extract_error_from_region_constraints(
  infcx: InferCtxt,
  generic_param_scope: LocalDefId,
  placeholder_region: Region,
  error_region: Region | undefined,
  region_constraints: RegionConstraintData,
  region_var_origin: (vid: RegionVid) => RegionVariableOrigin,
  universe_of_region: (vid: RegionVid) => UniverseIndex,
): Diag | undefined {
  const pk = placeholder_region.kind();
  const placeholder_universe = pk.$ === "RePlaceholder" ? pk._0.universe : pk.$ === "ReVar" ? universe_of_region(pk._0) : UniverseIndex.ROOT;
  // Are the two regions the same?
  const regions_the_same = (a_region: Region, b_region: Region): boolean => {
    const a = a_region.kind();
    const b = b_region.kind();
    if (a.$ === "RePlaceholder" && b.$ === "RePlaceholder") return intern_key_eq(a._0.bound, b._0.bound);
    return a_region === b_region;
  };
  const check = (c: Constraint, cause: SubregionOrigin, exact: boolean): [Region, SubregionOrigin] | undefined => {
    switch (c.kind) {
      case "RegSubReg":
        if (((exact && c.sup === placeholder_region) || (!exact && regions_the_same(c.sup, placeholder_region))) && c.sup !== c.sub) {
          return [c.sub, clone_SubregionOrigin(cause)];
        }
        return undefined;
      case "VarSubReg":
        if (
          (exact && c.sup === placeholder_region && !UniverseIndex.can_name(universe_of_region(c.sub.as_var()), placeholder_universe)) ||
          (!exact && regions_the_same(c.sup, placeholder_region))
        ) {
          return [c.sub, clone_SubregionOrigin(cause)];
        }
        return undefined;
      case "VarSubVar":
      case "RegSubVar":
        return undefined;

      case "VarEqVar":
      case "VarEqReg":
      case "RegEqReg":
        return unreachable();
    }
  };

  const find_culprit = (exact_match: boolean): [Region, SubregionOrigin] | undefined => {
    for (const [constraint_, cause] of region_constraints.constraints) {
      for (const constraint of constraint_.iter_outlives()) {
        const r = check(constraint, cause, exact_match);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };

  const culprit = find_culprit(true) ?? find_culprit(false);
  if (culprit === undefined) return undefined;
  const [sub_region, cause] = culprit;

  // debug!(?sub_region, "cause = {:#?}", cause);
  const sk = sub_region.kind();
  let error: RegionResolutionError;
  if (error_region !== undefined && sk.$ === "ReVar") {
    const vid = sk._0;
    error = {
      $: "SubSupConflict",
      _0: vid,
      _1: region_var_origin(vid),
      _2: clone_SubregionOrigin(cause),
      _3: error_region,
      _4: clone_SubregionOrigin(cause),
      _5: placeholder_region,
      _6: [],
    };
  } else if (error_region !== undefined) {
    error = { $: "ConcreteFailure", _0: clone_SubregionOrigin(cause), _1: error_region, _2: placeholder_region };
  } else if (sk.$ === "ReVar") {
    // Note universe here is wrong...
    const vid = sk._0;
    error = {
      $: "UpperBoundUniverseConflict",
      _0: vid,
      _1: region_var_origin(vid),
      _2: universe_of_region(vid),
      _3: clone_SubregionOrigin(cause),
      _4: placeholder_region,
    };
  } else {
    error = { $: "ConcreteFailure", _0: clone_SubregionOrigin(cause), _1: sub_region, _2: placeholder_region };
  }
  const nice = NiceRegionError.new(infcx.err_ctxt(), generic_param_scope, error).try_report_from_nll();
  if (nice !== undefined) return nice;
  if (cause.$ === "Subtype") {
    const trace = cause._0;
    return infcx.err_ctxt().report_and_explain_type_error(trace, infcx.tcx.param_env(generic_param_scope) as ParamEnv, {
      $: "RegionsPlaceholderMismatch",
    });
  } else {
    return undefined;
  }
}
