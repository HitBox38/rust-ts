// Port of compiler/rustc_hir_analysis/src/constrained_generic_params.rs (lane hira-misc).
//
// PORT notes (file-wide):
// - `struct Parameter(pub u32)` (derives Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord) is a branded number, like
//   the `newtype_index!` handles (PORTING §5 "Interned handles"): `Parameter(i)` is `i as Parameter`, `.0` is the number
//   itself, and the derived `Eq`/`Hash`/`Ord` are the number's, so `FxHashSet<Parameter>` is a `Set<Parameter>`.
//   `debug_Parameter` is the derived Debug (`Parameter(3)`).
// - The `From` impls are the companion's `from_ParamTy` / `from_EarlyParamRegion` / `from_ParamConst` (PORTING §8).
// - `value: impl TypeFoldable<TyCtxt>` takes the D4 descriptor `d_T` last (plan-m3 D4); the descriptors of the types
//   upstream passes here (`TraitRef`, `Ty`, `AliasTerm`, `Term`) are exported below.
// - `ParameterCollector` implements `TypeVisitor<undefined>` (`Self::Result = ()`) and forwards the methods it does not
//   override to `TypeVisitor_provided` (tyir-binder convention).
// - `debug!` is tracing only and stays as a comment.
// Init order: top-level code here touches only other crates.
import { type VisitorResult, VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { EarlyParamRegion, ParamConst, ParamTy } from "../rustc_middle/ty/decls.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { fold_Term, type Term, type Ty } from "../rustc_middle/ty/mod.ts";
import type { GenericClauses } from "../rustc_middle/ty/generics.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { PredicateProxy, TypeFoldable } from "../rustc_type_ir/fold.ts";
import { fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef, type TraitRef } from "../rustc_type_ir/predicate.gen.ts";
import { as_interner } from "../rustc_type_ir/predicate.ts";
import { type Const, fold_Const, type Region } from "../rustc_type_ir/sty/mod.ts";
import { AliasTerm, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../rustc_type_ir/term_kind.ts";
import { type AliasTerm as AliasTermT, fold_with_Alias, try_fold_with_Alias, visit_with_Alias } from "../rustc_type_ir/ty/alias.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { type Debug, debug_int, debug_tuple } from "../std/fmt.ts";

// #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
// rustc-type: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:7 Parameter
export type Parameter = number & { readonly __brand: "Parameter" };
export const Parameter = {
  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:10 from
  from_ParamTy(param: ParamTy): Parameter {
    return param.index as Parameter;
  },

  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:16 from
  from_EarlyParamRegion(param: EarlyParamRegion): Parameter {
    return param.index as Parameter;
  },

  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:22 from
  from_ParamConst(param: ParamConst): Parameter {
    return param.index as Parameter;
  },
};

/** `#[derive(Debug)]` */
export const debug_Parameter: Debug<Parameter> = (v, f) => debug_tuple(f, "Parameter", [debug_int(v, f)]);

/** PORT: D4 descriptors of the values upstream passes to `parameters_for` (generated `TraitRef` / `Alias` impls). */
export const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
export const d_AliasTerm: TypeFoldable<AliasTermT> = {
  visit_with: (self, visitor) => visit_with_Alias(self, visitor, visit_with_AliasTermKind),
  try_fold_with: (self, folder) => try_fold_with_Alias(self, folder, try_fold_with_AliasTermKind),
  fold_with: (self, folder) => fold_with_Alias(self, folder, fold_with_AliasTermKind),
};
export const d_Ty: TypeFoldable<Ty> = fold_Ty;
export const d_Term: TypeFoldable<Term> = fold_Term;

/// Returns the set of parameters constrained by the impl header.
// rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:28 parameters_for_impl
export function parameters_for_impl(tcx: TyCtxt, impl_self_ty: Ty, impl_trait_ref: TraitRef | undefined): Set<Parameter> {
  let vec: Parameter[];
  if (impl_trait_ref !== undefined) {
    const tr = impl_trait_ref;
    vec = parameters_for(tcx, tr, false, d_TraitRef);
  } else {
    vec = parameters_for(tcx, impl_self_ty, false, d_Ty);
  }
  return new Set(vec);
}

/// If `include_nonconstraining` is false, returns the list of parameters that are
/// constrained by `value` - i.e., the value of each parameter in the list is
/// uniquely determined by `value` (see RFC 447). If it is true, return the list
/// of parameters whose values are needed in order to constrain `value` - these
/// differ, with the latter being a superset, in the presence of projections.
// rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:45 parameters_for
export function parameters_for<T>(tcx: TyCtxt, value_: T, include_nonconstraining: boolean, d_T: TypeFoldable<T>): Parameter[] {
  const collector = new ParameterCollector([], include_nonconstraining);
  const value = !include_nonconstraining ? tcx.expand_free_alias_tys(value_, d_T) : value_;
  d_T.visit_with(value, collector);
  return collector.parameters;
}

// rustc-type: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:56 ParameterCollector
class ParameterCollector implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    public parameters: Parameter[],
    public include_nonconstraining: boolean,
  ) {}

  /** (provided) `TypeVisitor::visit_binder` */
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:62 visit_ty
  visit_ty(t: Ty): undefined {
    const k = t.kind();
    switch (k.$) {
      // Projections are not injective in general.
      case "Alias": {
        const kind = k._1.kind;
        if ((kind.$ === "Projection" || kind.$ === "Inherent" || kind.$ === "Opaque") && !this.include_nonconstraining) {
          return undefined;
        }
        // All free alias types should've been expanded beforehand.
        if (kind.$ === "Free" && !this.include_nonconstraining) {
          return bug("unexpected free alias type");
        }
        break;
      }
      case "Param": {
        const param = k._0;
        this.parameters.push(Parameter.from_ParamTy(param));
        break;
      }
      default:
        break;
    }

    return fold_Ty.super_visit_with(t, this);
  }

  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:87 visit_region
  visit_region(r: Region): undefined {
    const k = r.kind();
    if (k.$ === "ReEarlyParam") {
      const data = k._0;
      this.parameters.push(Parameter.from_EarlyParamRegion(data));
    }
    return undefined;
  }

  // rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:93 visit_const
  visit_const(c: Const): undefined {
    const k = c.kind();
    switch (k.$) {
      case "Alias":
        if (!this.include_nonconstraining) {
          // Constant expressions are not injective in general.
          return undefined;
        }
        break;
      case "Param": {
        const data = k._0;
        this.parameters.push(Parameter.from_ParamConst(data));
        break;
      }
      default:
        break;
    }

    return fold_Const.super_visit_with(c, this);
  }

  /** (provided) `TypeVisitor::visit_predicate` */
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  /** (provided) `TypeVisitor::visit_clauses` */
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  /** (provided) `TypeVisitor::visit_error` */
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:109 identify_constrained_generic_params
export function identify_constrained_generic_params(tcx: TyCtxt, gen_clauses: GenericClauses, impl_trait_ref: TraitRef | undefined, input_parameters: Set<Parameter>): void {
  const clauses: [Clause, Span][] = gen_clauses.clauses.map(([c, sp]) => [c, sp]);
  setup_constraining_clauses(tcx, clauses, impl_trait_ref, input_parameters);
}

/// Order the clauses in `clauses` such that each parameter is
/// constrained before it is used, if that is possible, and add the
/// parameters so constrained to `input_parameters`. For example,
/// imagine the following impl:
/// ```ignore (illustrative)
/// impl<T: Debug, U: Iterator<Item = T>> Trait for U
/// ```
/// The impl's clauses are collected from left to right. Ignoring
/// the implicit `Sized` bounds, these are
///   * `T: Debug`
///   * `U: Iterator`
///   * `<U as Iterator>::Item = T` -- a desugared ProjectionPredicate
///
/// When we, for example, try to go over the trait-reference
/// `IntoIter<u32> as Trait`, we instantiate the impl parameters with fresh
/// variables and match them with the impl trait-ref, so we know that
/// `$U = IntoIter<u32>`.
///
/// However, in order to process the `$T: Debug` clause, we must first
/// know the value of `$T` - which is only given by processing the
/// projection. As we occasionally want to process clauses in a single
/// pass, we want the projection to come first. In fact, as projections
/// can (acyclically) depend on one another - see RFC447 for details - we
/// need to topologically sort them.
///
/// We *do* have to be somewhat careful when projection targets contain
/// projections themselves, for example in
///
/// ```ignore (illustrative)
///     impl<S,U,V,W> Trait for U where
/// /* 0 */   S: Iterator<Item = U>,
/// /* - */   U: Iterator,
/// /* 1 */   <U as Iterator>::Item: ToOwned<Owned=(W,<V as Iterator>::Item)>
/// /* 2 */   W: Iterator<Item = V>
/// /* 3 */   V: Debug
/// ```
///
/// we have to evaluate the projections in the order I wrote them:
/// `V: Debug` requires `V` to be evaluated. The only projection that
/// *determines* `V` is 2 (1 contains it, but *does not determine it*,
/// as it is only contained within a projection), but that requires `W`
/// which is determined by 1, which requires `U`, that is determined
/// by 0. I should probably pick a less tangled example, but I can't
/// think of any.
// rustc: compiler/rustc_hir_analysis/src/constrained_generic_params.rs:163 setup_constraining_clauses
export function setup_constraining_clauses(tcx: TyCtxt, clauses: [Clause, Span][], impl_trait_ref: TraitRef | undefined, input_parameters: Set<Parameter>): void {
  // The canonical way of doing the needed topological sort
  // would be a DFS, but getting the graph and its ownership
  // right is annoying, so I am using an in-place fixed-point iteration,
  // which is `O(nt)` where `t` is the depth of type-parameter constraints,
  // remembering that `t` should be less than 7 in practice.
  //
  // FIXME(hkBst): the big-O bound above would be accurate for the number
  // of calls to `parameters_for`, which itself is some O(complexity of type).
  // That would make this potentially cubic instead of merely quadratic...
  // ...unless we cache those `parameters_for` calls.
  //
  // Basically, I iterate over all projections and swap every
  // "ready" projection to the start of the list, such that
  // all of the projections before `i` are topologically sorted
  // and constrain all the parameters in `input_parameters`.
  //
  // In the first example, `input_parameters` starts by containing `U`,
  // which is constrained by the self type `U`. Then, on the first pass we
  // observe that `<U as Iterator>::Item = T` is a "ready" projection that
  // constrains `T` and swap it to the front. As it is the sole projection,
  // no more swaps can take place afterwards, with the result being
  //   * <U as Iterator>::Item = T
  //   * T: Debug
  //   * U: Iterator
  // debug!(
  //     "setup_constraining_clauses: clauses={:?} impl_trait_ref={:?} input_parameters={:?}",
  //     clauses, impl_trait_ref, input_parameters
  // );
  let i = 0;
  let changed = true;
  while (changed) {
    changed = false;

    // PORT: `for j in i..clauses.len()` evaluates its range once, before the loop body moves `i`.
    const end = clauses.length;
    for (let j = i; j < end; j++) {
      // Note that we don't have to care about binders here,
      // as the impl trait ref never contains any late-bound regions.
      const ck = Binder.skip_binder(clauses[j]![0].kind());
      if (
        ck.$ === "Projection" &&
        // Special case: watch out for some kind of sneaky attempt to
        // project out an associated type defined by this very trait.
        !(impl_trait_ref !== undefined && intern_key(impl_trait_ref) === intern_key(AliasTerm.trait_ref(ck._0.projection_term, as_interner(tcx)))) &&
        // A projection depends on its input types and determines its output
        // type. For example, if we have
        //     `<<T as Bar>::Baz as Iterator>::Output = <U as Iterator>::Output`
        // then the projection only applies if `T` is known, but it still
        // does not determine `U`.
        parameters_for(tcx, ck._0.projection_term, true, d_AliasTerm).every((p) => input_parameters.has(p))
      ) {
        const projection = ck._0;
        for (const p of parameters_for(tcx, projection.term, false, d_Term)) input_parameters.add(p);

        const tmp = clauses[i]!;
        clauses[i] = clauses[j]!;
        clauses[j] = tmp;
        i += 1;
        changed = true;
      }
    }
    // debug!(
    //     "setup_constraining_clauses: clauses={:?} \
    //         i={} impl_trait_ref={:?} input_parameters={:?}",
    //     clauses, i, impl_trait_ref, input_parameters
    // );
  }
}
