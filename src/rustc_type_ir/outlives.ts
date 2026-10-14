//! The outlives relation `T: 'a` or `'a: 'b`. This code frequently
//! refers to rules defined in RFC 1214 (`OutlivesFooBar`), so see that
//! RFC for reference.
//
// Port of compiler/rustc_type_ir/src/outlives.rs (lane tyir-relate). `Component` with its derived Debug is generated
// into outlives.gen.ts (set rustc_ty of tools/codegen/types.ts).
// PORT (D3/D4): `I` is erased (`cx: TyCtxt`). `SmallVec<[Component; 4]>` is `Component[]`. `OutlivesCollector` is a
// `TypeVisitor<undefined>` class (`type Result = ()`), exported for the unit tests; the provided visitor methods it
// keeps delegate to `TypeVisitor_provided`. `SsoHashSet<I::Ty>` is a `Set<Ty>` (interned `Ty` objects are their own
// keys; the set is only probed, never iterated). `impl Iterator` returns are generators: what upstream computes when
// building the iterator is computed eagerly, the adaptors stay lazy.
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Clause } from "../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs, visit_with_GenericArg, visit_with_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { type Ty, visit_with_Ty } from "../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { unwrap } from "../std/panic.ts";
import { Binder, EarlyBinder } from "./binder.ts";
import type { PredicateProxy } from "./fold.ts";
import { visit_with_OutlivesClause } from "./predicate.ts";
import { interner } from "./relate.ts";
import type { Const } from "./sty/consts.ts";
import type { Region } from "./sty/mod.ts";
import { AliasTermKind } from "./term_kind.ts";
import type { AliasTy } from "./ty/alias.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "./ty_kind/closure.ts";
import type { Unnormalized } from "./unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "./visit.ts";
import { standin_fold_Ty, type TypeFoldable } from "./fold.ts";
import { visit_with_Alias } from "./ty/alias.ts";
import { visit_with_AliasTyKind } from "./ty_kind.ts";
import { fold_with_Clause, try_fold_with_Clause, visit_with_Clause } from "../rustc_middle/ty/predicate.ts";
import type { Component } from "./outlives.gen.ts";

export * from "./outlives.gen.ts";

// ---- PORT stand-ins for fns of other files that are not ported yet -------------------------------------------------
// Not markers. One-liners keep their upstream body; the rest call `unported`. Root repoints them at the real ports.

/** PORT: stand-in for `Unnormalized::skip_norm_wip` (unnormalized.rs:71): the field read. */
function Unnormalized_skip_norm_wip<T>(self: Unnormalized<T>): T {
  return self.value;
}

/** PORT: the `TypeFoldable` impl fns of `Clause` (rustc_middle ty/predicate.rs) as a D4 descriptor. */
const d_Clause: TypeFoldable<Clause> = { visit_with: visit_with_Clause, try_fold_with: try_fold_with_Clause, fold_with: fold_with_Clause };

// ---- outlives.rs --------------------------------------------------------------------------------------------------

/// Push onto `out` all the things that must outlive `'a` for the condition
/// `ty0: 'a` to hold. Note that `ty0` must be a **fully resolved type**.
// rustc: compiler/rustc_type_ir/src/outlives.rs:59 push_outlives_components
export function push_outlives_components(cx: TyCtxt, ty: Ty, out: Component[]): void {
  visit_with_Ty(ty, new OutlivesCollector(cx, out, new Set()));
}

// rustc-type: compiler/rustc_type_ir/src/outlives.rs:67 OutlivesCollector
export class OutlivesCollector implements TypeVisitor<undefined> {
  // #[cfg(not(feature = "nightly"))] type Result = ();
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public cx: TyCtxt,
    public out: Component[],
    public visited: Set<Ty>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/outlives.rs:77 visit_ty
  visit_ty(ty: Ty): undefined {
    if (this.visited.has(ty)) {
      return;
    }
    this.visited.add(ty);
    // Descend through the types, looking for the various "base"
    // components and collecting them into `out`. This is not written
    // with `collect()` because of the need to sometimes skip subtrees
    // in the `subtys` iterator (e.g., when encountering a
    // projection).
    const k = ty.kind();
    switch (k.$) {
      case "FnDef": {
        const args = unwrap(Binder.no_bound_vars(k._1, { visit_with: visit_with_GenericArgs }));
        // HACK(eddyb) ignore lifetimes found shallowly in `args`.
        // This is inconsistent with `ty::Adt` (including all args)
        // and with `ty::Closure` (ignoring all args other than
        // upvars, of which a `ty::FnDef` doesn't have any), but
        // consistent with previous (accidental) behavior.
        // See https://github.com/rust-lang/rust/issues/70917
        // for further background and discussion.
        for (const child of args) {
          switch (GenericArg.kind(child).$) {
            case "Lifetime":
              break;
            case "Type":
            case "Const":
              visit_with_GenericArg(child, this);
              break;
          }
        }
        break;
      }

      case "Closure":
        visit_with_Ty(ClosureArgs.tupled_upvars_ty(k._1.as_closure()), this);
        break;

      case "CoroutineClosure":
        visit_with_Ty(CoroutineClosureArgs.tupled_upvars_ty(k._1.as_coroutine_closure()), this);
        break;

      case "Coroutine":
        visit_with_Ty(CoroutineArgs.tupled_upvars_ty(k._1.as_coroutine()), this);

        // Coroutines may not outlive a region unless the resume
        // ty outlives a region. This is because the resume ty may
        // store data that lives shorter than this outlives region
        // across yield points, which may subsequently be accessed
        // after the coroutine is resumed again.
        //
        // Conceptually, you may think of the resume arg as an upvar
        // of `&mut Option<ResumeArgTy>`, since it is kinda like
        // storage shared between the callee of the coroutine and the
        // coroutine body.
        visit_with_Ty(CoroutineArgs.resume_ty(k._1.as_coroutine()), this);

        // We ignore regions in the coroutine interior as we don't
        // want these to affect region inference
        break;

      // All regions are bound inside a witness, and we don't emit
      // higher-ranked outlives components currently.
      case "CoroutineWitness":
        break;

      // OutlivesTypeParameterEnv -- the actual checking that `X:'a`
      // is implied by the environment is done in regionck.
      case "Param":
        this.out.push({ $: "Param", _0: k._0 });
        break;

      case "Placeholder":
        this.out.push({ $: "Placeholder", _0: k._0 });
        break;

      // For projections, we prefer to generate an obligation like
      // `<P0 as Trait<P1...Pn>>::Foo: 'a`, because this gives the
      // regionck more ways to prove that it holds. However,
      // regionck is not (at least currently) prepared to deal with
      // higher-ranked regions that may appear in the
      // trait-ref. Therefore, if we see any higher-ranked regions,
      // we simply fallback to the most restrictive rule, which
      // requires that `Pi: 'a` for all `i`.
      case "Alias": {
        const [is_rigid, alias_ty] = [k._0, k._1];
        if (!TypeVisitableExt.has_escaping_bound_vars(alias_ty, { visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTyKind) })) {
          // best case: no escaping regions, so push the
          // projection and skip the subtree (thus generating no
          // constraints for Pi). This defers the choice between
          // the rules OutlivesProjectionEnv,
          // OutlivesProjectionTraitDef, and
          // OutlivesProjectionComponents to regionck.
          this.out.push({ $: "Alias", _0: is_rigid, _1: alias_ty });
        } else {
          // fallback case: hard code
          // OutlivesProjectionComponents. Continue walking
          // through and constrain Pi.
          const subcomponents: Component[] = [];
          compute_alias_components_recursive(this.cx, alias_ty, subcomponents);
          this.out.push({ $: "EscapingAlias", _0: [...subcomponents] });
        }
        break;
      }

      // We assume that inference variables are fully resolved.
      // So, if we encounter an inference variable, just record
      // the unresolved variable as a component.
      case "Infer":
        this.out.push({ $: "UnresolvedInferenceVariable", _0: k._0 });
        break;

      // Most types do not introduce any region binders, nor
      // involve any other subtle cases, and so the WF relation
      // simply constraints any regions referenced directly by
      // the type and then visits the types that are lexically
      // contained within.
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Never":
      case "Error":
        // Trivial
        break;

      case "Bound":
        // FIXME: Bound vars matter here!
        break;

      case "Adt":
      case "Foreign":
      case "Array":
      case "Pat":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "FnPtr":
      case "UnsafeBinder":
      case "Dynamic":
      case "Tuple":
        standin_fold_Ty.super_visit_with(ty, this);
        break;
    }
    return undefined;
  }

  // rustc: compiler/rustc_type_ir/src/outlives.rs:217 visit_region
  visit_region(lt: Region): undefined {
    if (!lt.is_bound()) {
      this.out.push({ $: "Region", _0: lt });
    }
    return undefined;
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
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

/// Collect [Component]s for *all* the args of `alias_ty`.
///
/// This should not be used to get the components of `alias_ty` itself.
/// Use [push_outlives_components] instead.
// rustc: compiler/rustc_type_ir/src/outlives.rs:228 compute_alias_components_recursive
export function compute_alias_components_recursive(cx: TyCtxt, alias_ty: AliasTy, out: Component[]): void {
  const opt_variances = cx.opt_alias_variances(AliasTermKind.from_AliasTyKind(alias_ty.kind));

  const visitor = new OutlivesCollector(cx, out, new Set());

  for (let index = 0; index < alias_ty.args.length; index++) {
    const child = alias_ty.args[index];
    if (opt_variances !== undefined && opt_variances[index] === "Bivariant") {
      continue;
    }
    visit_with_GenericArg(child, visitor);
  }
}

/// Given a projection like `<T as Foo<'x>>::Bar`, returns any bounds
/// declared in the trait definition. For example, if the trait were
///
/// ```rust
/// trait Foo<'a> {
///     type Bar: 'a;
/// }
/// ```
///
/// If we were given `<T as Foo<'b>>::Bar`, we would return
/// `'b`. This doesn't work for higher-ranked bounds such as:
///
/// ```ignore (this does compile today, previously was marked as compile_fail,E0311)
/// trait Foo<'a, 'b>
/// where for<'x> <Self as Foo<'x, 'b>>::Bar: 'x
/// {
///     type Bar;
/// }
/// ```
///
/// This is for simplicity, and because we are not really smart
/// enough to cope with such bounds anywhere.
// rustc: compiler/rustc_type_ir/src/outlives.rs:267 declared_bounds_from_definition
export function declared_bounds_from_definition(cx: TyCtxt, alias_ty: AliasTy): Iterable<Region> {
  let def_id;
  switch (alias_ty.kind.$) {
    case "Projection":
      def_id = alias_ty.kind.def_id;
      break;
    case "Inherent":
      def_id = alias_ty.kind.def_id;
      break;
    case "Opaque":
      def_id = alias_ty.kind.def_id;
      break;
    case "Free":
      def_id = alias_ty.kind.def_id;
      break;
  }

  const bounds = interner(cx).item_self_bounds(def_id);
  // PORT(merge-w15a): `Interner::item_self_bounds` is declared `impl IntoIterator`; `TyCtxt`'s is the `Clauses` list
  // (a `readonly Clause[]`), which `iter_instantiated`'s double-ended iterator needs.
  const it = EarlyBinder.iter_instantiated<Clause>(bounds as EarlyBinder<readonly Clause[]>, cx, alias_ty.args, d_Clause);
  return (function* () {
    for (const u of it) {
      const c = Unnormalized_skip_norm_wip(u);
      const o = c.as_type_outlives_clause();
      if (o === undefined) continue;
      const nb = Binder.no_bound_vars(o, { visit_with: (self, visitor) => visit_with_OutlivesClause(self, visitor, visit_with_Ty) });
      if (nb === undefined) continue;
      yield nb._1;
    }
  })();
}
