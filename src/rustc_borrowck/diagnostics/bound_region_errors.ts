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
import type { Diag } from "../../rustc_errors/lib.ts";
import type { InferCtxt } from "../../rustc_infer/decls.ts";
import type { RegionVariableOrigin } from "../../rustc_infer/infer/mod.ts";
import type { RegionConstraintData } from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type {
  CanonicalTypeOpAscribeUserTypeGoal,
  CanonicalTypeOpNormalizeGoal,
  CanonicalTypeOpProvePredicateGoal,
} from "../../rustc_middle/traits/query.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import type { PlaceholderRegion } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../std/panic.ts";
import type { MirBorrowckCtxt } from "../lib.gen.ts";
import type { InstantiateOpaqueType } from "../type_check/mod.gen.ts";
import * as gen from "./bound_region_errors.gen.ts";
import type { AscribeUserTypeQuery, NormalizeQuery, PredicateQuery } from "./bound_region_errors.gen.ts";

export * from "./bound_region_errors.gen.ts";

// impl<'tcx> UniverseInfo<'tcx>
export interface UniverseInfo_methods {
  // bound_region_errors.rs:44 (lane bck-diag-f)
  other(): UniverseInfo;
  // bound_region_errors.rs:48 (lane bck-diag-f)
  relate(expected: Ty, found: Ty): UniverseInfo;
  // bound_region_errors.rs:53 (lane bck-diag-f)
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

// stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:44 other (lane bck-diag-f)
UniverseInfo.other = function (): UniverseInfo {
  return unported("rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::other");
};

// stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:48 relate (lane bck-diag-f)
UniverseInfo.relate = function (expected: Ty, found: Ty): UniverseInfo {
  return unported("rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::relate");
};

/// Report an error where an element erroneously made its way into `placeholder`.
// stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:53 report_erroneous_element (lane bck-diag-f)
UniverseInfo.report_erroneous_element = function (
  self: UniverseInfo,
  mbcx: MirBorrowckCtxt,
  placeholder: PlaceholderRegion,
  error_element: PlaceholderRegion | undefined,
  cause: ObligationCause,
): void {
  return unported("rustc_borrowck::diagnostics::bound_region_errors::UniverseInfo::report_erroneous_element");
};

/** `pub(crate) trait ToUniverseInfo<'tcx>`: the impl table of a type `T`. */
export interface ToUniverseInfo<T> {
  // rustc: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:87 to_universe_info
  to_universe_info(self: T, base_universe: UniverseIndex): UniverseInfo;
}

// impl<'tcx> ToUniverseInfo<'tcx> for crate::type_check::InstantiateOpaqueType<'tcx>
export const ToUniverseInfo_InstantiateOpaqueType: ToUniverseInfo<InstantiateOpaqueType> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:91 to_universe_info (lane bck-diag-f)
  to_universe_info(self: InstantiateOpaqueType, base_universe: UniverseIndex): UniverseInfo {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::InstantiateOpaqueType::to_universe_info");
  },
};

// impl<'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpProvePredicateGoal<'tcx>
export const ToUniverseInfo_CanonicalTypeOpProvePredicateGoal: ToUniverseInfo<CanonicalTypeOpProvePredicateGoal> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:100 to_universe_info (lane bck-diag-f)
  to_universe_info(self: CanonicalTypeOpProvePredicateGoal, base_universe: UniverseIndex): UniverseInfo {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::CanonicalTypeOpProvePredicateGoal::to_universe_info");
  },
};

// impl<'tcx, T: Copy + fmt::Display + TypeFoldable<TyCtxt<'tcx>> + 'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpNormalizeGoal<'tcx, T>
export function ToUniverseInfo_CanonicalTypeOpNormalizeGoal<T>(
  display_T: (v: T) => string,
  d_T: TypeFoldable<T>,
): ToUniverseInfo<CanonicalTypeOpNormalizeGoal<T>> {
  return {
    // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:108 to_universe_info (lane bck-diag-f)
    to_universe_info(self: CanonicalTypeOpNormalizeGoal<T>, base_universe: UniverseIndex): UniverseInfo {
      return unported("rustc_borrowck::diagnostics::bound_region_errors::CanonicalTypeOpNormalizeGoal::to_universe_info");
    },
  };
}

// impl<'tcx> ToUniverseInfo<'tcx> for CanonicalTypeOpAscribeUserTypeGoal<'tcx>
export const ToUniverseInfo_CanonicalTypeOpAscribeUserTypeGoal: ToUniverseInfo<CanonicalTypeOpAscribeUserTypeGoal> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:114 to_universe_info (lane bck-diag-f)
  to_universe_info(self: CanonicalTypeOpAscribeUserTypeGoal, base_universe: UniverseIndex): UniverseInfo {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::CanonicalTypeOpAscribeUserTypeGoal::to_universe_info");
  },
};

// impl<'tcx> ToUniverseInfo<'tcx> for !
export const ToUniverseInfo_never: ToUniverseInfo<never> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:120 to_universe_info (lane bck-diag-f)
  to_universe_info(self: never, _base_universe: UniverseIndex): UniverseInfo {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::never::to_universe_info");
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
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:145 report_erroneous_element (lane bck-diag-f)
  report_erroneous_element(
    self: TypeOpInfo,
    mbcx: MirBorrowckCtxt,
    placeholder: PlaceholderRegion,
    error_element: PlaceholderRegion | undefined,
    cause: ObligationCause,
  ): void {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::TypeOpInfo::report_erroneous_element");
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
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:196 fallback_error (lane bck-diag-f)
  fallback_error(self: PredicateQuery, tcx: TyCtxt, span: Span): Diag {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::PredicateQuery::fallback_error");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:205 base_universe (lane bck-diag-f)
  base_universe(self: PredicateQuery): UniverseIndex {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::PredicateQuery::base_universe");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:209 nice_error (lane bck-diag-f)
  nice_error(self: PredicateQuery, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::PredicateQuery::nice_error");
  },
};

// impl<'tcx, T> TypeOpInfo<'tcx> for NormalizeQuery<'tcx, T> where T: Copy + fmt::Display + TypeFoldable<TyCtxt<'tcx>> + 'tcx
export function TypeOpInfo_NormalizeQuery<T>(display_T: (v: T) => string, d_T: TypeFoldable<T>): TypeOpInfo_impl<NormalizeQuery<T>> {
  return {
    // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:240 fallback_error (lane bck-diag-f)
    fallback_error(self: NormalizeQuery<T>, tcx: TyCtxt, span: Span): Diag {
      return unported("rustc_borrowck::diagnostics::bound_region_errors::NormalizeQuery::fallback_error");
    },

    // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:256 base_universe (lane bck-diag-f)
    base_universe(self: NormalizeQuery<T>): UniverseIndex {
      return unported("rustc_borrowck::diagnostics::bound_region_errors::NormalizeQuery::base_universe");
    },

    // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:260 nice_error (lane bck-diag-f)
    nice_error(self: NormalizeQuery<T>, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
      return unported("rustc_borrowck::diagnostics::bound_region_errors::NormalizeQuery::nice_error");
    },
  };
}

// impl<'tcx> TypeOpInfo<'tcx> for AscribeUserTypeQuery<'tcx>
export const TypeOpInfo_AscribeUserTypeQuery: TypeOpInfo_impl<AscribeUserTypeQuery> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:297 fallback_error (lane bck-diag-f)
  fallback_error(self: AscribeUserTypeQuery, tcx: TyCtxt, span: Span): Diag {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::AscribeUserTypeQuery::fallback_error");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:303 base_universe (lane bck-diag-f)
  base_universe(self: AscribeUserTypeQuery): UniverseIndex {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::AscribeUserTypeQuery::base_universe");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:307 nice_error (lane bck-diag-f)
  nice_error(self: AscribeUserTypeQuery, mbcx: MirBorrowckCtxt, cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::AscribeUserTypeQuery::nice_error");
  },
};

// impl<'tcx> TypeOpInfo<'tcx> for crate::type_check::InstantiateOpaqueType<'tcx>
export const TypeOpInfo_InstantiateOpaqueType: TypeOpInfo_impl<InstantiateOpaqueType> = {
  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:330 fallback_error (lane bck-diag-f)
  fallback_error(self: InstantiateOpaqueType, tcx: TyCtxt, span: Span): Diag {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::InstantiateOpaqueType::fallback_error");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:336 base_universe (lane bck-diag-f)
  base_universe(self: InstantiateOpaqueType): UniverseIndex {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::InstantiateOpaqueType::base_universe");
  },

  // stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:340 nice_error (lane bck-diag-f)
  nice_error(self: InstantiateOpaqueType, mbcx: MirBorrowckCtxt, _cause: ObligationCause, placeholder_region: Region, error_region: Region | undefined): Diag | undefined {
    return unported("rustc_borrowck::diagnostics::bound_region_errors::InstantiateOpaqueType::nice_error");
  },
};

// stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:365 try_extract_error_from_fulfill_cx (lane bck-diag-f)
export function try_extract_error_from_fulfill_cx(
  ocx: ObligationCtxt,
  generic_param_scope: LocalDefId,
  placeholder_region: Region,
  error_region: Region | undefined,
): Diag | undefined {
  return unported("rustc_borrowck::diagnostics::bound_region_errors::try_extract_error_from_fulfill_cx");
}

// stub: compiler/rustc_borrowck/src/diagnostics/bound_region_errors.rs:388 try_extract_error_from_region_constraints (lane bck-diag-f)
export function try_extract_error_from_region_constraints(
  infcx: InferCtxt,
  generic_param_scope: LocalDefId,
  placeholder_region: Region,
  error_region: Region | undefined,
  region_constraints: RegionConstraintData,
  region_var_origin: (vid: RegionVid) => RegionVariableOrigin,
  universe_of_region: (vid: RegionVid) => UniverseIndex,
): Diag | undefined {
  return unported("rustc_borrowck::diagnostics::bound_region_errors::try_extract_error_from_region_constraints");
}
