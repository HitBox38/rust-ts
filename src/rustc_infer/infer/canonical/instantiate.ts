// Port of compiler/rustc_infer/src/infer/canonical/instantiate.rs (lane infer-canonical-outlives).
//
//! This module contains code to instantiate new values into a
//! `Canonical<'tcx, T>`.
//!
//! For an overview of what canonicalization is and how it fits into
//! rustc, check out the [chapter in the rustc dev guide][c].
//!
//! [c]: https://rust-lang.github.io/chalk/book/canonical_queries/canonicalization.html
//
// PORT: the extension trait `CanonicalExt` on `Canonical` is the pair of free fns `Canonical_instantiate` /
// `Canonical_instantiate_projected` (infcx-contract "Representation" 5). `V: Clone` values are immutable here, so
// `value.clone()` is the value. The folder `CanonicalInstantiator` and the visitor `HighestVarInClauses` are classes
// implementing `TypeFolder` / `TypeVisitor` (the generated `CanonicalInstantiator` interface holds the same fields).
// PORT: `GlobalCaches::clauses_cache` is keyed by `(Clauses, &[GenericArg])`: its `Map<string, _>` key is the
// `intern_key` of the pair (rust_ts/intern_key.ts; the slice compares element-wise by identity, as upstream).
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { VisitorResult, type VisitorResult as VisitorResultT } from "../../../rustc_ast_ir/visit.ts";
import type { CanonicalVarValues } from "../../../rustc_middle/infer/canonical.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clauses } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { fold_Clauses, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import type { Binder } from "../../../rustc_type_ir/binder.ts";
import type { Canonical } from "../../../rustc_type_ir/canonical.ts";
import { DelayedMap } from "../../../rustc_type_ir/data_structures/mod.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { BoundVar } from "../../../rustc_type_ir/lib.ts";
import { type Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../../rustc_type_ir/visit.ts";
import { assert, assert_eq, panic } from "../../../std/panic.ts";

export * from "./instantiate.gen.ts";

/// FIXME(-Znext-solver): This or public because it is shared with the
/// new trait solver implementation. We should deduplicate canonicalization.
// (`#[extension(pub trait CanonicalExt<'tcx, V>)] impl<'tcx, V> Canonical<'tcx, V>`)

/// Instantiate the wrapped value, replacing each canonical value
/// with the value given in `var_values`.
// rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:24 instantiate
export function Canonical_instantiate<V>(self: Canonical<V>, tcx: TyCtxt, var_values: CanonicalVarValues, d_V: TypeFoldable<V>): V {
  return Canonical_instantiate_projected(self, tcx, var_values, (value) => value, d_V);
}

/// Allows one to apply a instantiation to some subset of
/// `self.value`. Invoke `projection_fn` with `self.value` to get
/// a value V that is expressed in terms of the same canonical
/// variables bound in `self` (usually this extracts from subset
/// of `self`). Apply the instantiation `var_values` to this value
/// V, replacing each of the canonical variables.
// rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:37 instantiate_projected
export function Canonical_instantiate_projected<V, T>(
  self: Canonical<V>,
  tcx: TyCtxt,
  var_values: CanonicalVarValues,
  projection_fn: (_1: V) => T,
  d_T: TypeFoldable<T>,
): T {
  assert_eq(self.var_kinds.length, var_values.var_values.length, String);
  const value = projection_fn(self.value);
  return instantiate_value(tcx, var_values, value, d_T);
}

/// Instantiate the values from `var_values` into `value`. `var_values`
/// must be values for the set of canonical variables that appear in
/// `value`.
// rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:55 instantiate_value
export function instantiate_value<T>(tcx: TyCtxt, var_values: CanonicalVarValues, value: T, d_T: TypeFoldable<T>): T {
  if (var_values.var_values.length === 0) {
    return value;
  }

  return d_T.fold_with(value, new CanonicalInstantiator(tcx, var_values.var_values, DelayedMap.default_<Ty, Ty>()));
}

/** `self.var_values[i]` (slice indexing: core's bounds-check panic). */
function index(var_values: GenericArgs, i: number): GenericArg {
  if (i >= var_values.length) {
    return panic(`index out of bounds: the len is ${var_values.length} but the index is ${i}`);
  }
  return var_values[i]!;
}

/// Replaces the bound vars in a canonical binder with var values.
// rustc-type: compiler/rustc_infer/src/infer/canonical/instantiate.rs:75 CanonicalInstantiator
class CanonicalInstantiator implements TypeFolder {
  constructor(
    public tcx: TyCtxt,

    // The values that the bound vars are are being instantiated with.
    public var_values: GenericArgs,

    // Because we use `ty::BoundVarIndexKind::Canonical`, we can cache
    // based only on the entire ty, not worrying about a `DebruijnIndex`
    public cache: DelayedMap<Ty, Ty>,
  ) {}

  // ---- impl TypeFolder<TyCtxt> for CanonicalInstantiator ----

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:87 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:91 fold_ty
  fold_ty(t: Ty): Ty {
    const tk = t.kind();
    if (tk.$ === "Bound" && tk._0.$ === "Canonical") {
      const bound_ty = tk._1;
      return GenericArg.expect_ty(index(this.var_values, BoundVar.as_usize(bound_ty.var)));
    } else {
      if (!TypeVisitableExt.has_type_flags(t, TypeFlags.HAS_CANONICAL_BOUND, fold_Ty)) {
        return t;
      } else {
        const cached = this.cache.get(t);
        if (cached !== undefined) {
          return cached;
        } else {
          const res = fold_Ty.super_fold_with(t, this);
          assert(this.cache.insert(t, res), "assertion failed: self.cache.insert(t, res)");
          return res;
        }
      }
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:110 fold_region
  fold_region(r: Region): Region {
    const rk = r.kind();
    if (rk.$ === "ReBound" && rk._0.$ === "Canonical") {
      const br = rk._1;
      return GenericArg.expect_region(index(this.var_values, BoundVar.as_usize(br.var)));
    } else {
      return r;
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:119 fold_const
  fold_const(ct: Const): Const {
    const ck = ct.kind();
    if (ck.$ === "Bound" && ck._0.$ === "Canonical") {
      const bound_const = ck._1;
      return GenericArg.expect_const(index(this.var_values, BoundVar.as_usize(bound_const.var)));
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:128 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (TypeVisitableExt.has_type_flags(p, TypeFlags.HAS_CANONICAL_BOUND, d)) {
      return d.super_fold_with(p, this);
    } else {
      return p;
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:132 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    if (!TypeVisitableExt.has_type_flags(c, TypeFlags.HAS_CANONICAL_BOUND, fold_Clauses)) {
      return c;
    }

    // Our cache key is `(clauses, var_values)`, but we also don't care about
    // var values that aren't named in the clauses, since they can change without
    // affecting the output. Since `ParamEnv`s are cached first, we compute the
    // last var value that is mentioned in the clauses, and cut off the list so
    // that we have more hits in the cache.

    // We also cache the computation of "highest var named by clauses" since that
    // is both expensive (depending on the size of the clauses) and a pure function.
    const highest = this.tcx.caches.highest_var_in_clauses_cache;
    let index_ = highest.get(c);
    if (index_ === undefined) {
      index_ = highest_var_in_clauses(c);
      highest.set(c, index_);
    }
    // `&self.var_values[..=index]`
    if (index_ >= this.var_values.length) {
      panic(`range end index ${index_ + 1} out of range for slice of length ${this.var_values.length}`);
    }
    const c_args = this.var_values.slice(0, index_ + 1);

    const key = intern_key([c, c_args]);
    const cached = this.tcx.caches.clauses_cache.get(key);
    if (cached !== undefined) {
      return cached;
    } else {
      const folded = fold_Clauses.super_fold_with(c, this);
      this.tcx.caches.clauses_cache.set(key, folded);
      return folded;
    }
  }

  // (provided) `TypeFolder::fold_binder` is not overridden upstream.
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
}

// rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:164 highest_var_in_clauses
function highest_var_in_clauses(c: Clauses): number {
  const visitor = new HighestVarInClauses(0);
  fold_Clauses.visit_with(c, visitor);
  return visitor.max_var;
}

// PORT: the fn-local `struct HighestVarInClauses` of `highest_var_in_clauses`, at module level.
class HighestVarInClauses implements TypeVisitor<undefined> {
  /** `type Result = ();` */
  readonly Result: VisitorResultT<undefined, unknown> = VisitorResult.unit;

  constructor(public max_var: number) {}

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:169 visit_ty
  visit_ty(t: Ty): undefined {
    const tk = t.kind();
    if (tk.$ === "Bound" && tk._0.$ === "Canonical") {
      const bound_ty = tk._1;
      this.max_var = Math.max(this.max_var, BoundVar.as_usize(bound_ty.var));
    } else if (TypeVisitableExt.has_type_flags(t, TypeFlags.HAS_CANONICAL_BOUND, fold_Ty)) {
      fold_Ty.super_visit_with(t, this);
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:176 visit_region
  visit_region(r: Region): undefined {
    const rk = r.kind();
    if (rk.$ === "ReBound" && rk._0.$ === "Canonical") {
      const bound_region = rk._1;
      this.max_var = Math.max(this.max_var, BoundVar.as_usize(bound_region.var));
    }
  }

  // rustc: compiler/rustc_infer/src/infer/canonical/instantiate.rs:181 visit_const
  visit_const(ct: Const): undefined {
    const ck = ct.kind();
    if (ck.$ === "Bound" && ck._0.$ === "Canonical") {
      const bound_const = ck._1;
      this.max_var = Math.max(this.max_var, BoundVar.as_usize(bound_const.var));
    } else if (TypeVisitableExt.has_type_flags(ct, TypeFlags.HAS_CANONICAL_BOUND, fold_Const)) {
      fold_Const.super_visit_with(ct, this);
    }
  }

  // (provided) the methods `HighestVarInClauses` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
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
