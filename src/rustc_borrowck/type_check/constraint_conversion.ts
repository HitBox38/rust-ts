// Port of compiler/rustc_borrowck/src/type_check/constraint_conversion.rs (lane borrowck-contract: declarations; fill lane bck-tc-b, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
//
// PORT: `impl TypeOutlivesDelegate for &'a mut ConstraintConversion` is implemented by `ConstraintConversion`'s prototype
// (rustc_infer outlives/obligations.ts's `TypeOutlivesDelegate` interface; `&mut` is the object itself).
// PORT: `higher_ranked_assumptions: &FxHashSet<ty::ArgOutlivesClause>` is a `Set` (a `KeyedSet` at construction:
// `elaborate_outlives_assumptions`'s result, or an empty `KeyedSet(intern_key)` for `&Default::default()`);
// `T: TypeFoldable` adds `d_T`. `&BorrowckInferCtxt` passed where upstream auto-derefs to `&InferCtxt`
// (`placeholder_region`) is `infcx.infcx`. `#[instrument]` / `debug!` stay comments (tracing is off in the oracle).
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import type { QueryRegionConstraints } from "../../rustc_middle/infer/canonical.ts";
import type { RegionBoundPairs } from "../../rustc_infer/infer/outlives/env.ts";
import { TypeOutlives } from "../../rustc_infer/infer/outlives/obligations.ts";
import { SubregionOrigin } from "../../rustc_infer/infer/mod.ts";
import {
  fold_with_GenericKind,
  fold_with_VerifyBound,
  type GenericKind,
  try_fold_with_GenericKind,
  try_fold_with_VerifyBound,
  type VerifyBound,
  visit_with_GenericKind,
  visit_with_VerifyBound,
} from "../../rustc_infer/infer/region_constraints/mod.ts";
import type { ConstraintCategory } from "../../rustc_middle/mir/mod.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { ArgOutlivesClause, PolyTypeOutlivesClause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { elaborate_outlives_assumptions } from "../../rustc_type_ir/elaborate.ts";
import { fold_regions, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { RegionConstraint } from "../../rustc_type_ir/predicate.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { VarianceDiagInfo } from "../../rustc_type_ir/relate.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { unreachable } from "../../std/panic.ts";
import type { BorrowckInferCtxt, ClosureRegionRequirements } from "../lib.gen.ts";
import type { TypeTest } from "../region_infer/mod.gen.ts";
import { UniversalRegions } from "../universal_regions.gen.ts";
import { ConstraintConversion } from "./constraint_conversion.gen.ts";
import type { Locations, MirTypeckRegionConstraints } from "./mod.gen.ts";

export * from "./constraint_conversion.gen.ts";

/** PORT: `GenericKind`'s derived `TypeFoldable` / `TypeVisitable` (region_constraints/mod.gen.ts) as a descriptor. */
const fold_GenericKind: TypeFoldable<GenericKind> = {
  visit_with: (self, visitor) => visit_with_GenericKind(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_GenericKind(self, folder),
  fold_with: (self, folder) => fold_with_GenericKind(self, folder),
};

/** PORT: `VerifyBound`'s derived `TypeFoldable` / `TypeVisitable` (region_constraints/mod.gen.ts) as a descriptor. */
const fold_VerifyBound: TypeFoldable<VerifyBound> = {
  visit_with: (self, visitor) => visit_with_VerifyBound(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_VerifyBound(self, folder),
  fold_with: (self, folder) => fold_with_VerifyBound(self, folder),
};

declare module "./constraint_conversion.gen.ts" {
  interface ConstraintConversion {
    // constraint_conversion.rs:69
    convert_all(query_constraints: QueryRegionConstraints): void;
    // constraint_conversion.rs:85
    apply_closure_requirements(closure_requirements: ClosureRegionRequirements, closure_def_id: LocalDefId, closure_args: GenericArgs): void;
    // constraint_conversion.rs:125
    convert(clause: ArgOutlivesClause, constraint_category: ConstraintCategory, higher_ranked_assumptions: Set<ArgOutlivesClause>): void;
    // constraint_conversion.rs:187
    replace_placeholders_with_nll<T>(value: T, d_T: TypeFoldable<T>): T;
    // constraint_conversion.rs:200
    verify_to_type_test(generic_kind: GenericKind, region: Region, verify_bound: VerifyBound): TypeTest;
    // constraint_conversion.rs:210
    to_region_vid(r: Region): RegionVid;
    // constraint_conversion.rs:218
    add_outlives(sup: RegionVid, sub: RegionVid, category: ConstraintCategory, span: Span): void;
    // constraint_conversion.rs:240
    add_type_test(type_test: TypeTest): void;

    // `impl TypeOutlivesDelegate for &'a mut ConstraintConversion` (constraint_conversion.rs:246)
    // constraint_conversion.rs:247
    push_sub_region_constraint(origin: SubregionOrigin, a: Region, b: Region, constraint_category: ConstraintCategory): void;
    // constraint_conversion.rs:259
    push_verify(_origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void;
  }
  namespace ConstraintConversion {
    // constraint_conversion.rs:45
    function new_(
      infcx: BorrowckInferCtxt,
      universal_regions: UniversalRegions,
      region_bound_pairs: RegionBoundPairs,
      known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
      locations: Locations,
      span: Span,
      category: ConstraintCategory,
      constraints: MirTypeckRegionConstraints,
    ): ConstraintConversion;
    export { new_ as new };
  }
}

// ---- impl<'a, 'tcx> ConstraintConversion<'a, 'tcx> ----

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:45 new
(ConstraintConversion as unknown as { new: typeof ConstraintConversion.new }).new = function (
  infcx: BorrowckInferCtxt,
  universal_regions: UniversalRegions,
  region_bound_pairs: RegionBoundPairs,
  known_type_outlives_obligations: readonly PolyTypeOutlivesClause[],
  locations: Locations,
  span: Span,
  category: ConstraintCategory,
  constraints: MirTypeckRegionConstraints,
): ConstraintConversion {
  return new ConstraintConversion(
    infcx,
    universal_regions,
    region_bound_pairs,
    known_type_outlives_obligations,
    locations,
    span,
    category,
    /* from_closure */ false,
    constraints,
  );
};

// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:69 convert_all
ConstraintConversion.prototype.convert_all = function (this: ConstraintConversion, query_constraints: QueryRegionConstraints): void {
  const { constraints, assumptions } = query_constraints;
  const assumptions_ = elaborate_outlives_assumptions(this.infcx.tcx, assumptions);

  for (const { constraint, category } of constraints) {
    for (const predicate of RegionConstraint.iter_outlives(constraint)) {
      this.convert(predicate, category, assumptions_);
    }
  }
};

/// Given an instance of the closure type, this method instantiates the "extra" requirements
/// that we computed for the closure. This has the effect of adding new outlives obligations
/// to existing region variables in `closure_args`.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:85 apply_closure_requirements
ConstraintConversion.prototype.apply_closure_requirements = function (
  this: ConstraintConversion,
  closure_requirements: ClosureRegionRequirements,
  closure_def_id: LocalDefId,
  closure_args: GenericArgs,
): void {
  // Extract the values of the free regions in `closure_args`
  // into a vector. These are the regions that we will be
  // relating to one another.
  const closure_mapping = UniversalRegions.closure_mapping(this.infcx.tcx, closure_args, closure_requirements.num_external_vids, closure_def_id);
  // debug!(?closure_mapping);

  // Create the predicates.
  const backup: [ConstraintCategory, Span, boolean] = [this.category, this.span, this.from_closure];
  this.from_closure = true;
  for (const outlives_requirement of closure_requirements.outlives_requirements) {
    const outlived_region = closure_mapping[outlives_requirement.outlived_free_region]!;
    let subject: GenericArg;
    switch (outlives_requirement.subject.$) {
      case "Region": {
        const re = outlives_requirement.subject._0;
        subject = GenericArg.from_Region(closure_mapping[re]!);
        break;
      }
      case "Ty": {
        const subject_ty = outlives_requirement.subject._0;
        subject = GenericArg.from_Ty(subject_ty.instantiate(this.infcx.tcx, (vid) => closure_mapping[vid]!));
        break;
      }
    }

    this.category = outlives_requirement.category;
    this.span = outlives_requirement.blame_span;
    this.convert({ _0: subject, _1: outlived_region }, this.category, new KeyedSet<ArgOutlivesClause>(intern_key));
  }
  [this.category, this.span, this.from_closure] = backup;
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:125 convert
ConstraintConversion.prototype.convert = function (
  this: ConstraintConversion,
  clause: ArgOutlivesClause,
  constraint_category: ConstraintCategory,
  higher_ranked_assumptions: Set<ArgOutlivesClause>,
): void {
  const tcx = this.infcx.tcx;
  // debug!("generate: constraints at: {:#?}", self.locations);

  // Extract out various useful fields we'll need below.
  const { universal_regions, region_bound_pairs, known_type_outlives_obligations } = this;

  // Constraint is implied by a coroutine's well-formedness.
  if (this.infcx.tcx.sess.opts.unstable_opts.higher_ranked_assumptions && higher_ranked_assumptions.has(clause)) {
    return;
  }

  const { _0: k1, _1: r2 } = clause;
  const k = GenericArg.kind(k1);
  switch (k.$) {
    case "Lifetime": {
      const r1 = k._0;
      const r1_vid = this.to_region_vid(r1);
      const r2_vid = this.to_region_vid(r2);
      this.add_outlives(r1_vid, r2_vid, constraint_category, this.span);
      break;
    }

    case "Type": {
      let t1 = k._0;
      // Scraped constraints may have had inference vars.
      t1 = this.infcx.deeply_resolve_ignoring_regions(t1, fold_Ty);

      const implicit_region_bound = Region.new_var(tcx, universal_regions.implicit_region_bound());
      // we don't actually use this for anything, but
      // the `TypeOutlives` code needs an origin.
      const origin: SubregionOrigin = { $: "RelateParamBound", _0: this.span, _1: t1, _2: undefined };
      TypeOutlives.new(this, tcx, region_bound_pairs, implicit_region_bound, known_type_outlives_obligations).type_must_outlive(
        origin,
        t1,
        r2,
        constraint_category,
      );
      break;
    }

    case "Const":
      return unreachable("internal error: entered unreachable code");
  }
};

/// Placeholder regions need to be converted eagerly because it may
/// create new region variables, which we must not do when verifying
/// our region bounds.
///
/// FIXME: This should get removed once higher ranked region obligations
/// are dealt with during trait solving.
// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:187 replace_placeholders_with_nll
ConstraintConversion.prototype.replace_placeholders_with_nll = function <T>(this: ConstraintConversion, value: T, d_T: TypeFoldable<T>): T {
  if (TypeVisitableExt.has_placeholders(value, d_T)) {
    return fold_regions(
      this.infcx.tcx,
      value,
      (r, _) => {
        const rk = r.kind();
        switch (rk.$) {
          case "RePlaceholder": {
            const placeholder = rk._0;
            return this.constraints.placeholder_region(this.infcx.infcx, placeholder);
          }
          default:
            return r;
        }
      },
      d_T,
    );
  } else {
    return value;
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:200 verify_to_type_test
ConstraintConversion.prototype.verify_to_type_test = function (this: ConstraintConversion, generic_kind: GenericKind, region: Region, verify_bound: VerifyBound): TypeTest {
  const lower_bound = this.to_region_vid(region);
  return { generic_kind, lower_bound, span: this.span, verify_bound };
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:210 to_region_vid
ConstraintConversion.prototype.to_region_vid = function (this: ConstraintConversion, r: Region): RegionVid {
  const rk = r.kind();
  if (rk.$ === "RePlaceholder") {
    const placeholder = rk._0;
    return this.constraints.placeholder_region(this.infcx.infcx, placeholder).as_var();
  } else {
    return this.universal_regions.to_region_vid(r);
  }
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:218 add_outlives
ConstraintConversion.prototype.add_outlives = function (this: ConstraintConversion, sup: RegionVid, sub: RegionVid, category: ConstraintCategory, span: Span): void {
  let category_: ConstraintCategory;
  switch (this.category.$) {
    case "Boring":
    case "BoringNoLocation":
      category_ = category;
      break;
    default:
      category_ = this.category;
      break;
  }
  this.constraints.outlives_constraints.push({
    locations: this.locations,
    category: category_,
    span,
    sub,
    sup,
    variance_info: VarianceDiagInfo.None,
    from_closure: this.from_closure,
  });
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:240 add_type_test
ConstraintConversion.prototype.add_type_test = function (this: ConstraintConversion, type_test: TypeTest): void {
  // debug!("add_type_test(type_test={:?})", type_test);
  this.constraints.type_tests.push(type_test);
};

// ---- impl<'a, 'b, 'tcx> TypeOutlivesDelegate<'tcx> for &'a mut ConstraintConversion<'b, 'tcx> ----

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:247 push_sub_region_constraint
ConstraintConversion.prototype.push_sub_region_constraint = function (
  this: ConstraintConversion,
  origin: SubregionOrigin,
  a: Region,
  b: Region,
  constraint_category: ConstraintCategory,
): void {
  const b_ = this.to_region_vid(b);
  const a_ = this.to_region_vid(a);
  this.add_outlives(b_, a_, constraint_category, SubregionOrigin.span(origin));
};

// rustc: compiler/rustc_borrowck/src/type_check/constraint_conversion.rs:259 push_verify
ConstraintConversion.prototype.push_verify = function (this: ConstraintConversion, _origin: SubregionOrigin, kind: GenericKind, a: Region, bound: VerifyBound): void {
  const kind_ = this.replace_placeholders_with_nll(kind, fold_GenericKind);
  const bound_ = this.replace_placeholders_with_nll(bound, fold_VerifyBound);
  const type_test = this.verify_to_type_test(kind_, a, bound_);
  this.add_type_test(type_test);
};
