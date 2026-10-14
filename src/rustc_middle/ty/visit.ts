// Port of compiler/rustc_middle/src/ty/visit.rs (lane ty-results, sub-lane ty-results-b; contract stub by lane
// ty-contract).
//
// The `TyCtxt` methods are declared in ty/decls.ts (`// ty/visit.rs:<line>`) and assigned to `TyCtxt.prototype` here.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes; its
// top-level code touches only `TyCtxt.prototype`.
// PORT (D4): the generic methods take the descriptor `d_T` of `T` last (decls.ts signatures).
// PORT: `FxIndexSet<ty::BoundRegionKind>` (keyed by an enum value) is a `KeyedSet` over `intern_key`: a `Set` in
// insertion order that compares the kinds by value.
// PORT: the visitors implement `TypeVisitor<R>` and forward the methods they do not override to
// `TypeVisitor_provided` (tyir-binder convention); `Self::Result = ()` is `VisitorResult.unit`.
// PORT: ./context.ts is imported first so that this module also loads as an entry point (init order).
import { TyCtxt } from "./context.ts";
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { Binder, type BoundRegionKind, visit_Binder } from "../../rustc_type_ir/binder.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import type { PredicateProxy, TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { type Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { bug } from "../../rustc_span/macros.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { Clauses } from "./list.ts";
import type { Ty } from "./mod.ts";
import { fold_Ty } from "./structural_impls.ts";

///////////////////////////////////////////////////////////////////////////
// Region folder

/// Invoke `callback` on every region appearing free in `value`.
// rustc: compiler/rustc_middle/src/ty/visit.rs:16 for_each_free_region
TyCtxt.prototype.for_each_free_region = function <T>(this: TyCtxt, value: T, callback: (r: Region) => void, d_T: TypeVisitable<T>): void {
  this.any_free_region_meets(
    value,
    (r) => {
      callback(r);
      return false;
    },
    d_T,
  );
};

/// Returns `true` if `callback` returns true for every region appearing free in `value`.
// rustc: compiler/rustc_middle/src/ty/visit.rs:28 all_free_regions_meet
TyCtxt.prototype.all_free_regions_meet = function <T>(this: TyCtxt, value: T, callback: (r: Region) => boolean, d_T: TypeVisitable<T>): boolean {
  return !this.any_free_region_meets(value, (r) => !callback(r), d_T);
};

// rustc-type: compiler/rustc_middle/src/ty/visit.rs:42 RegionVisitor
// PORT: the fn-local `struct RegionVisitor<F>` (and its `TypeVisitor` impl) of `any_free_region_meets`, at module level.
class RegionVisitor implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

  constructor(
    /// The index of a binder *just outside* the things we have
    /// traversed. If we encounter a bound region bound by this
    /// binder or one outer to it, it appears free. Example:
    ///
    /// ```ignore (illustrative)
    ///       for<'a> fn(for<'b> fn(), T)
    /// // ^          ^          ^     ^
    /// // |          |          |     | here, would be shifted in 1
    /// // |          |          | here, would be shifted in 2
    /// // |          | here, would be `INNERMOST` shifted in by 1
    /// // | here, initially, binder would be `INNERMOST`
    /// ```
    ///
    /// You see that, initially, *any* bound value is free,
    /// because we've not traversed any binders. As we pass
    /// through a binder, we shift the `outer_index` by 1 to
    /// account for the new binder that encloses us.
    public outer_index: DebruijnIndex,
    public callback: (r: Region) => boolean,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/visit.rs:70 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    this.outer_index = DebruijnIndex.shifted_in(this.outer_index, 1);
    const result = visit_Binder(d).super_visit_with(t, this);
    this.outer_index = DebruijnIndex.shifted_out(this.outer_index, 1);
    return result;
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:80 visit_region
  visit_region(r: Region): ControlFlow<null> {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && k._0._0 < this.outer_index) {
      return ControlFlow.CONTINUE;
    } else {
      if (this.callback(r)) {
        return ControlFlow.Break(null);
      } else {
        return ControlFlow.CONTINUE;
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:97 visit_ty
  visit_ty(ty: Ty): ControlFlow<null> {
    // We're only interested in types involving regions
    if (TypeFlags.intersects(ty.flags(), TypeFlags.HAS_FREE_REGIONS)) {
      return fold_Ty.super_visit_with(ty, this);
    } else {
      return ControlFlow.CONTINUE;
    }
  }

  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/// Returns `true` if `callback` returns true for some region appearing free in `value`.
// rustc: compiler/rustc_middle/src/ty/visit.rs:37 any_free_region_meets
TyCtxt.prototype.any_free_region_meets = function <T>(this: TyCtxt, value: T, callback: (r: Region) => boolean, d_T: TypeVisitable<T>): boolean {
  return d_T.visit_with(value, new RegionVisitor(INNERMOST, callback)).$ === "Break";
};

/// Returns a set of all late-bound regions that are constrained
/// by `value`, meaning that if we instantiate those LBR with
/// variables and equate `value` with something else, those
/// variables will also be equated.
// rustc: compiler/rustc_middle/src/ty/visit.rs:114 collect_constrained_late_bound_regions
TyCtxt.prototype.collect_constrained_late_bound_regions = function <T>(this: TyCtxt, value: Binder<T>, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind> {
  return this.collect_late_bound_regions(value, true, d_T);
};

/// Returns a set of all late-bound regions that appear in `value` anywhere.
// rustc: compiler/rustc_middle/src/ty/visit.rs:125 collect_referenced_late_bound_regions
TyCtxt.prototype.collect_referenced_late_bound_regions = function <T>(this: TyCtxt, value: Binder<T>, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind> {
  return this.collect_late_bound_regions(value, false, d_T);
};

// rustc: compiler/rustc_middle/src/ty/visit.rs:135 collect_late_bound_regions
TyCtxt.prototype.collect_late_bound_regions = function <T>(this: TyCtxt, value_: Binder<T>, just_constrained: boolean, d_T: TypeFoldable<T>): KeyedSet<BoundRegionKind> {
  const collector = LateBoundRegionsCollector.new(just_constrained);
  let value = Binder.skip_binder(value_);
  value = just_constrained ? this.expand_free_alias_tys(value, d_T) : value;
  d_T.visit_with(value, collector);
  return collector.regions;
};

/// Collects all the late-bound regions at the innermost binding level
/// into a hash set.
// rustc-type: compiler/rustc_middle/src/ty/visit.rs:153 LateBoundRegionsCollector
class LateBoundRegionsCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public current_index: DebruijnIndex,
    public regions: KeyedSet<BoundRegionKind>,

    /// `true` if we only want regions that are known to be
    /// "constrained" when you equate this type with another type. In
    /// particular, if you have e.g., `&'a u32` and `&'b u32`, equating
    /// them constraints `'a == 'b`. But if you have `<&'a u32 as
    /// Trait>::Foo` and `<&'b u32 as Trait>::Foo`, normalizing those
    /// types may mean that `'a` and `'b` don't appear in the results,
    /// so they are not considered *constrained*.
    public just_constrained: boolean,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/visit.rs:168 new
  static new(just_constrained: boolean): LateBoundRegionsCollector {
    return new LateBoundRegionsCollector(INNERMOST, new KeyedSet<BoundRegionKind>(intern_key), just_constrained);
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:174 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    this.current_index = DebruijnIndex.shifted_in(this.current_index, 1);
    visit_Binder(d).super_visit_with(t, this);
    this.current_index = DebruijnIndex.shifted_out(this.current_index, 1);
    return undefined;
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:180 visit_ty
  visit_ty(t: Ty): undefined {
    if (this.just_constrained) {
      const k = t.kind();
      switch (k.$) {
        // If we are only looking for "constrained" regions, we have to ignore the
        // inputs to a projection as they may not appear in the normalized form.
        case "Alias": {
          const alias_ty = k._1;
          switch (alias_ty.kind.$) {
            case "Projection":
            case "Inherent":
            case "Opaque":
              return undefined;

            // All free alias types should've been expanded beforehand.
            case "Free":
              return bug("unexpected free alias type");
          }
          break;
        }
        default:
          break;
      }
    }

    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:202 visit_const
  visit_const(c: Const): undefined {
    // if we are only looking for "constrained" region, we have to
    // ignore the inputs of an alias const, as they may not appear
    // in the normalized form
    if (this.just_constrained) {
      if (c.kind().$ === "Alias") {
        return undefined;
      }
    }

    return fold_Const.super_visit_with(c, this);
  }

  // rustc: compiler/rustc_middle/src/ty/visit.rs:215 visit_region
  visit_region(r: Region): undefined {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound") {
      const debruijn = k._0._0;
      const br = k._1;
      if (debruijn === this.current_index) {
        this.regions.add(br.kind);
      }
    }
    return undefined;
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}
