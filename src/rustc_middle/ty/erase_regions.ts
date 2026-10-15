// Port of compiler/rustc_middle/src/ty/erase_regions.rs (lane small-gaps-18; contract stub by lane ty-contract).
//
// PORT: `T: TypeFoldable` arguments take the D4 descriptor last (`tcx.erase_and_anonymize_regions(value, d_T)`).
// `RegionEraserAndAnonymizerVisitor` is a class implementing `TypeFolder` (fold.ts's `BottomUpFolder` precedent).
// `debug!` is tracing only and stays as a comment.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code touches only the classes it imports. ty/mod.ts's `provide` reaches `provide` through `require`.
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { fold_Binder } from "../../rustc_type_ir/binder.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder } from "../../rustc_type_ir/fold.ts";
import { type Const, fold_Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { Providers } from "../queries.gen.ts";
import { TyCtxt } from "./context.ts";
import type { Clauses } from "./decls.ts";
import type { Ty } from "./mod.ts";
import { fold_Clauses, fold_Ty } from "./structural_impls.ts";

/** `TypeFlags::HAS_BINDER_VARS | TypeFlags::HAS_FREE_REGIONS` */
function has_binder_vars_or_free_regions(): TypeFlags {
  return TypeFlags.union(TypeFlags.HAS_BINDER_VARS, TypeFlags.HAS_FREE_REGIONS);
}

// rustc: compiler/rustc_middle/src/ty/erase_regions.rs:9 provide
export function provide(providers: Providers): void {
  providers.erase_and_anonymize_regions_ty = erase_and_anonymize_regions_ty;
}

// rustc: compiler/rustc_middle/src/ty/erase_regions.rs:13 erase_and_anonymize_regions_ty
function erase_and_anonymize_regions_ty(tcx: TyCtxt, ty: Ty): Ty {
  // N.B., use `super_fold_with` here. If we used `fold_with`, it
  // could invoke the `erase_and_anonymize_regions_ty` query recursively.
  return fold_Ty.super_fold_with(ty, new RegionEraserAndAnonymizerVisitor(tcx));
}

/// Returns an equivalent value with all free regions removed and
/// bound regions anonymized. (note that bound regions are important
/// for subtyping and generally type equality so *cannot* be removed)
// rustc: compiler/rustc_middle/src/ty/erase_regions.rs:23 erase_and_anonymize_regions
TyCtxt.prototype.erase_and_anonymize_regions = function <T>(this: TyCtxt, value: T, d_T: TypeFoldable<T>): T {
  // If there's nothing to erase or anonymize, avoid performing the query at all
  if (!TypeVisitableExt.has_type_flags(value, has_binder_vars_or_free_regions(), d_T)) {
    return value;
  }
  // debug!("erase_and_anonymize_regions({:?})", value);
  const value1 = d_T.fold_with(value, new RegionEraserAndAnonymizerVisitor(this));
  // debug!("erase_and_anonymize_regions = {:?}", value1);
  return value1;
};

// rustc-type: compiler/rustc_middle/src/ty/erase_regions.rs:38 RegionEraserAndAnonymizerVisitor
class RegionEraserAndAnonymizerVisitor implements TypeFolder {
  constructor(public tcx: TyCtxt) {}

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:43 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:47 fold_ty
  fold_ty(ty: Ty): Ty {
    if (!TypeVisitableExt.has_type_flags(ty, has_binder_vars_or_free_regions(), fold_Ty)) {
      return ty;
    } else if (TypeVisitableExt.has_infer(ty, fold_Ty)) {
      return fold_Ty.super_fold_with(ty, this);
    } else {
      return this.tcx.erase_and_anonymize_regions_ty(ty);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:57 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    const u = this.tcx.anonymize_bound_vars(t, d);
    return fold_Binder(d).super_fold_with(u, this);
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:65 fold_region
  fold_region(r: Region): Region {
    // We must not erase bound regions. `for<'a> fn(&'a ())` and
    // `fn(&'free ())` are different types: they may implement different
    // traits and have a different `TypeId`.
    switch (r.kind().$) {
      case "ReBound":
        return r;
      default:
        return this.tcx.lifetimes.re_erased;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:75 fold_const
  fold_const(ct: Const): Const {
    if (TypeVisitableExt.has_type_flags(ct, has_binder_vars_or_free_regions(), fold_Const)) {
      return fold_Const.super_fold_with(ct, this);
    } else {
      return ct;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:83 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_type_flags(p, has_binder_vars_or_free_regions(), d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_middle/src/ty/erase_regions.rs:91 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (TypeVisitableExt.has_type_flags(c, has_binder_vars_or_free_regions(), fold_Clauses)) {
      return fold_Clauses.super_fold_with(c, this);
    } else {
      return c;
    }
  }
}
