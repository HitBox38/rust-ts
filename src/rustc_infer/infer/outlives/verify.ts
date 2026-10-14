// Port of compiler/rustc_infer/src/infer/outlives/verify.rs (lane infer-canonical-outlives).
//
// PORT: `VerifyBoundCx` is the generated class (verify.gen.ts); its methods are assigned onto the prototype and the
// associated fn `new` onto the class (`function new_ ..; export { new_ as new }`, precedent rustc_errors). The lazy
// iterator chains are evaluated in upstream order (see `alias_bound`). Other rustc_infer modules are read inside
// function bodies only (infcx-contract "How to fill a stub" 6).
import { intern_key } from "../../../rust_ts/intern_key.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { ParamTy } from "../../../rustc_middle/ty/sty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { PolyTypeOutlivesClause, TypeOutlivesClause } from "../../../rustc_type_ir/decls.ts";
import { type Component, compute_alias_components_recursive, declared_bounds_from_definition } from "../../../rustc_type_ir/outlives.ts";
import { type OutlivesClause, visit_with_OutlivesClause } from "../../../rustc_type_ir/predicate.ts";
import { fold_Region, type Region } from "../../../rustc_type_ir/sty/mod.ts";
import type { AliasTy } from "../../../rustc_type_ir/ty/alias.ts";
import { AliasTy as AliasTyC, debug_InferTy, debug_TyKind, IsRigid } from "../../../rustc_type_ir/ty_kind.ts";
import { as_interner } from "../../../rustc_type_ir/predicate.ts";
import type { TypeVisitable, TypeVisitor } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert_matches, unwrap } from "../../../std/panic.ts";
import type { GenericKind, VerifyBound, VerifyIfEq } from "../region_constraints/mod.ts";
import * as region_constraints from "../region_constraints/mod.ts";
import type { RegionBoundPairs } from "./env.ts";
import * as test_type_match from "./test_type_match.ts";
import { VerifyBoundCx } from "./verify.gen.ts";

export * from "./verify.gen.ts";

declare module "./verify.gen.ts" {
  interface VerifyBoundCx {
    param_or_placeholder_bound(ty: Ty): VerifyBound;
    approx_declared_bounds_from_env(alias_ty: AliasTy): PolyTypeOutlivesClause[];
    alias_bound(alias_ty: AliasTy): VerifyBound;
    bound_from_components(components: readonly Component[]): VerifyBound;
    bound_from_single_component(component: Component): VerifyBound;
    declared_generic_bounds_from_env(generic_ty: Ty): PolyTypeOutlivesClause[];
    declared_generic_bounds_from_env_for_erased_ty(erased_ty: Ty): PolyTypeOutlivesClause[];
  }
  namespace VerifyBoundCx {
    function new_(tcx: TyCtxt, region_bound_pairs: RegionBoundPairs, implicit_region_bound: Region | undefined, caller_bounds: readonly PolyTypeOutlivesClause[]): VerifyBoundCx;
    export { new_ as new };
  }
}

// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:31 new
(VerifyBoundCx as unknown as { new: typeof VerifyBoundCx.new }).new = function (
  tcx: TyCtxt,
  region_bound_pairs: RegionBoundPairs,
  implicit_region_bound: Region | undefined,
  caller_bounds: readonly PolyTypeOutlivesClause[],
): VerifyBoundCx {
  return new VerifyBoundCx(tcx, region_bound_pairs, implicit_region_bound, caller_bounds);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:41 param_or_placeholder_bound
VerifyBoundCx.prototype.param_or_placeholder_bound = function (this: VerifyBoundCx, ty: Ty): VerifyBound {
  // Start with anything like `T: 'a` we can scrape from the
  // environment. If the environment contains something like
  // `for<'a> T: 'a`, then we know that `T` outlives everything.
  const declared_bounds_from_env = this.declared_generic_bounds_from_env(ty);
  // debug!(?declared_bounds_from_env);
  const param_bounds: VerifyBound[] = [];
  for (const declared_bound of declared_bounds_from_env) {
    const bound_region = Binder.map_bound(declared_bound, (outlives) => outlives._1);
    const region = Binder.no_bound_vars(bound_region, fold_Region);
    if (region !== undefined) {
      // This is `T: 'a` for some free region `'a`.
      param_bounds.push({ $: "OutlivedBy", _0: region });
    } else {
      // This is `for<'a> T: 'a`. This means that `T` outlives everything! All done here.
      // debug!("found that {ty:?} outlives any lifetime, returning empty vector");
      return { $: "AllBounds", _0: [] };
    }
  }

  // Add in the default bound of fn body that applies to all in
  // scope type parameters:
  const r = this.implicit_region_bound;
  if (r !== undefined) {
    // debug!("adding implicit region bound of {r:?}");
    param_bounds.push({ $: "OutlivedBy", _0: r });
  }

  if (param_bounds.length === 0) {
    // We know that all types `T` outlive `'empty`, so if we
    // can find no other bound, then check that the region
    // being tested is `'empty`.
    return region_constraints.VerifyBound.IsEmpty;
  } else if (param_bounds.length === 1) {
    // Micro-opt: no need to store the vector if it's just len 1
    return unwrap(param_bounds.pop());
  } else {
    // If we can find any other bound `R` such that `T: R`, then
    // we don't need to check for `'empty`, because `R: 'empty`.
    return { $: "AnyBound", _0: param_bounds };
  }
};

/// Given a projection like `T::Item`, searches the environment
/// for where-clauses like `T::Item: 'a`. Returns the set of
/// regions `'a` that it finds.
///
/// This is an "approximate" check -- it may not find all
/// applicable bounds, and not all the bounds it returns can be
/// relied upon. In particular, this check ignores region
/// identity. So, for example, if we have `<T as
/// Trait<'0>>::Item` where `'0` is a region variable, and the
/// user has `<T as Trait<'a>>::Item: 'b` in the environment, then
/// the clause from the environment only applies if `'0 = 'a`,
/// which we don't know yet. But we would still include `'b` in
/// this list.
// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:95 approx_declared_bounds_from_env
VerifyBoundCx.prototype.approx_declared_bounds_from_env = function (this: VerifyBoundCx, alias_ty: AliasTy): PolyTypeOutlivesClause[] {
  const erased_alias_ty = this.tcx.erase_and_anonymize_regions(AliasTy_to_ty(alias_ty, this.tcx, IsRigid.yes_if_next_solver(as_interner(this.tcx))), fold_Ty);
  return this.declared_generic_bounds_from_env_for_erased_ty(erased_alias_ty);
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:106 alias_bound
VerifyBoundCx.prototype.alias_bound = function (this: VerifyBoundCx, alias_ty: AliasTy): VerifyBound {
  // Search the env for where clauses like `P: 'a`.
  const env_binders = this.approx_declared_bounds_from_env(alias_ty);
  const env_bound = (binder: PolyTypeOutlivesClause): VerifyBound => {
    // FIXME(#155345): We probably want to assert the alias is rigid here.
    const oc = Binder.no_bound_vars(binder, visit_TypeOutlivesClause);
    if (oc !== undefined) {
      const { _0: ty, _1: r } = oc;
      const tk = ty.kind();
      if (tk.$ === "Alias" && intern_key(tk._1) === intern_key(alias_ty)) {
        // Micro-optimize if this is an exact match (this
        // occurs often when there are no region variables
        // involved).
        return { $: "OutlivedBy", _0: r };
      }
    }
    const verify_if_eq_b = Binder.map_bound(binder, ({ _0: ty, _1: bound }): VerifyIfEq => ({ ty, bound }));
    return { $: "IfEq", _0: verify_if_eq_b };
  };

  // Extend with bounds that we can find from the definition.
  const definition_bounds = declared_bounds_from_definition(this.tcx, alias_ty);

  // see the extensive comment in projection_must_outlive
  const recursive_bound = (() => {
    const components: Component[] = [];
    compute_alias_components_recursive(this.tcx, alias_ty, components);
    return this.bound_from_components(components);
  })();

  // PORT: the two lazy `map`s are consumed by this `collect`, after `recursive_bound` (upstream order).
  const any: VerifyBound[] = [];
  for (const binder of env_binders) {
    any.push(env_bound(binder));
  }
  for (const r of definition_bounds) {
    any.push({ $: "OutlivedBy", _0: r });
  }
  return region_constraints.VerifyBound.or({ $: "AnyBound", _0: any }, recursive_bound);
};

// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:140 bound_from_components
VerifyBoundCx.prototype.bound_from_components = function (this: VerifyBoundCx, components: readonly Component[]): VerifyBound {
  // PORT: the lazy `map(..).filter(..)` is consumed in order by `next()`, `next()` and the rest of the chain; collecting
  // it first computes the same bounds in the same order.
  const bounds: VerifyBound[] = [];
  for (const component of components) {
    const bound = this.bound_from_single_component(component);
    // Remove bounds that must hold, since they are not interesting.
    if (!region_constraints.VerifyBound.must_hold(bound)) {
      bounds.push(bound);
    }
  }

  if (bounds.length === 1) {
    // (Some(first), None) => first,
    return bounds[0]!;
  } else {
    // (first, second) => VerifyBound::AllBounds(first.into_iter().chain(second).chain(bounds).collect()),
    return { $: "AllBounds", _0: bounds };
  }
};

// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:155 bound_from_single_component
VerifyBoundCx.prototype.bound_from_single_component = function (this: VerifyBoundCx, component: Component): VerifyBound {
  switch (component.$) {
    case "Region":
      return { $: "OutlivedBy", _0: component._0 };
    case "Param":
      return this.param_or_placeholder_bound(ParamTy.to_ty(component._0, this.tcx));
    case "Placeholder":
      return this.param_or_placeholder_bound(Ty.new_placeholder(this.tcx, component._0));
    // `type_must_outlive` already asserted that it's rigid in the next solver.
    case "Alias":
      return this.alias_bound(component._1);
    case "EscapingAlias":
      return this.bound_from_components(component._0);
    case "UnresolvedInferenceVariable": {
      const v = component._0;
      // Ignore this, we presume it will yield an error later, since
      // if a type variable is not resolved by this point it never
      // will be.
      this.tcx.dcx().delayed_bug(`unresolved inference variable in outlives: ${debug_InferTy(v, PLAIN)}`);
      // Add a bound that never holds.
      return { $: "AnyBound", _0: [] };
    }
  }
};

/// Searches the environment for where-clauses like `G: 'a` where
/// `G` is either some type parameter `T` or a projection like
/// `T::Item`. Returns a vector of the `'a` bounds it can find.
///
/// This is a conservative check -- it may not find all applicable
/// bounds, but all the bounds it returns can be relied upon.
// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:187 declared_generic_bounds_from_env
VerifyBoundCx.prototype.declared_generic_bounds_from_env = function (this: VerifyBoundCx, generic_ty: Ty): PolyTypeOutlivesClause[] {
  const k = generic_ty.kind();
  assert_matches(k, k.$ === "Param" || k.$ === "Placeholder", "ty::Param(_) | ty::Placeholder(_)", (v) => debug_TyKind(v, PLAIN));
  return this.declared_generic_bounds_from_env_for_erased_ty(generic_ty);
};

/// Searches the environment to find all bounds that apply to `erased_ty`.
/// Obviously these must be approximate -- they are in fact both *over* and
/// and *under* approximated:
///
/// * Over-approximated because we don't consider equality of regions.
/// * Under-approximated because we look for syntactic equality and so for complex types
///   like `<T as Foo<fn(&u32, &u32)>>::Item` or whatever we may fail to figure out
///   all the subtleties.
///
/// In some cases, such as when `erased_ty` represents a `ty::Param`, however,
/// the result is precise.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_infer/src/infer/outlives/verify.rs:207 declared_generic_bounds_from_env_for_erased_ty
VerifyBoundCx.prototype.declared_generic_bounds_from_env_for_erased_ty = function (this: VerifyBoundCx, erased_ty: Ty): PolyTypeOutlivesClause[] {
  const tcx = this.tcx;
  const bounds: PolyTypeOutlivesClause[] = [];

  // To start, collect bounds from user environment. Note that
  // parameter environments are already elaborated, so we don't
  // have to worry about that.
  for (const outlives_clause of this.caller_bounds) {
    if (test_type_match.can_match_erased_ty(tcx, outlives_clause, erased_ty)) {
      bounds.push(outlives_clause);
    }
  }

  // Next, collect regions we scraped from the well-formedness
  // constraints in the fn signature. To do that, we walk the list
  // of known relations from the fn ctxt.
  //
  // This is crucial because otherwise code like this fails:
  //
  //     fn foo<'a, A>(x: &'a A) { x.bar() }
  //
  // The problem is that the type of `x` is `&'a A`. To be
  // well-formed, then, A must outlive `'a`, but we don't know that
  // this holds from first principles.
  for (const { _0: p, _1: r } of this.region_bound_pairs) {
    // debug!("declared_generic_bounds_from_env_for_erased_ty: region_bound_pair = {:?}", (r, p));
    // Fast path for the common case.
    const ek = erased_ty.kind();
    // In outlive routines, all types are expected to be fully normalized.
    // And therefore we can safely use structural equality for alias types.
    if (p.$ === "Param" && ek.$ === "Param" && ParamTy_eq(p._0, ek._0)) {
      // ok
    } else if (p.$ === "Placeholder" && ek.$ === "Placeholder" && intern_key(p._0) === intern_key(ek._0)) {
      // ok
    } else if (p.$ === "Alias" && ek.$ === "Alias" && intern_key(p._0.kind) === intern_key(ek._1.kind)) {
      // debug_assert_eq!(*is_rigid, ty::IsRigid::yes_if_next_solver(self.tcx));
    } else {
      continue;
    }

    const p_ty = region_constraints.GenericKind.to_ty(p as GenericKind, tcx);
    const erased_p_ty = this.tcx.erase_and_anonymize_regions(p_ty, fold_Ty);
    if (erased_p_ty === erased_ty) {
      bounds.push(Binder.dummy<TypeOutlivesClause>({ _0: p_ty, _1: r }, visit_TypeOutlivesClause));
    }
  }

  return bounds;
};

/** `#[derive(PartialEq)]` of `ParamTy` (`index`, `name`). */
function ParamTy_eq(a: ParamTy, b: ParamTy): boolean {
  return a.index === b.index && a.name === b.name;
}

/** `AliasTy::to_ty` (rustc_type_ir ty_kind.rs). */
function AliasTy_to_ty(alias_ty: AliasTy, tcx: TyCtxt, is_rigid: IsRigid): Ty {
  return AliasTyC.to_ty(alias_ty, tcx, is_rigid);
}

/** PORT: `TypeVisitable` of `ty::TypeOutlivesClause` (`OutlivesClause<Ty>`, generated impl). */
const visit_TypeOutlivesClause: TypeVisitable<OutlivesClause<Ty>> = {
  visit_with: <R>(s: OutlivesClause<Ty>, v: TypeVisitor<R>): R => visit_with_OutlivesClause(s, v, fold_Ty.visit_with),
};
