// Port of compiler/rustc_hir_analysis/src/collect/clauses_of.rs (lane collect-b).
//
// Contract: docs/handoff/hirtylowerer-contract.md. The free fns have their decls.ts `Fns_collect_clauses_of` signatures;
// `ItemCtxt::probe_ty_param_bounds_in_generics` is assigned onto `ItemCtxt.prototype` below.
// Init order: top-level code here touches only ../decls.ts (the classes) and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
//
// PORT notes (file-wide):
// - `tcx.arena.alloc_from_iter(..)` / `alloc_slice(..)` are plain arrays.
// - The query values of `explicit_clauses_of`, `trait_explicit_clauses_and_bounds`, `generics_of`, `type_of`, `fn_sig`,
//   `impl_trait_ref`, `explicit_super_clauses_of`, ... are `unknown` in queries.gen.ts: each read is cast to the
//   upstream value type (`GenericClauses`, `Generics`, `EarlyBinder<..>`), as rustc_middle's generics.ts does.
// - `FxIndexSet<(ty::Clause<'tcx>, Span)>` is a `KeyedSet` keyed by `key_ClauseSpan` (the interned clause and the span
//   interner index are equal exactly when the Rust tuples are `==`).
// - `debug!` / `trace!` / `#[instrument]` are tracing only and stay as comments.
import { ItemCtxt } from "../decls.ts";
import { VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { DefKind, DefKind_eq, debug_DefKind } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { ConstConditions, GenericClauses, type GenericParamDef, type Generics } from "../../rustc_middle/ty/generics.ts";
import { Ty, visit_with_Ty } from "../../rustc_middle/ty/mod.ts";
import {
  type Clause,
  Clause_upcast_from_Binder_ClauseKind,
  Clause_upcast_from_ClauseKind,
  Clause_upcast_from_PolyTraitRef,
  Clause_upcast_from_TraitRef,
  visit_with_Clause,
} from "../../rustc_middle/ty/predicate.ts";
import { debug_Clause, debug_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, type DefId, LocalDefId, debug_LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { type ClauseKind, debug_ClauseKind } from "../../rustc_type_ir/predicate_kind.ts";
import { as_interner, type BoundConstness, debug_BoundConstness, PolyTraitRef, type TraitClause, TraitClause as TraitClauseC, TraitRef, HostEffectClause, ProjectionClause } from "../../rustc_type_ir/predicate.ts";
import { visit_with_TraitRef } from "../../rustc_type_ir/predicate.gen.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { Region as RegionC } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { fold_Binder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import type { PolyFnSig, PolyTraitRef as PolyTraitRefT, TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_eq, assert_matches, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { explicit_item_bounds_with_filter } from "./item_bounds.ts";
import { HirTyLowerer_ItemCtxt } from "../collect.ts";
import { ImpliedBoundsContext, OverlappingAsssocItemConstraints, PredicateFilter, RegionInferReason, debug_PredicateFilter } from "../hir_ty_lowering/mod.gen.ts";

/** `FxIndexSet<(ty::Clause<'tcx>, Span)>`'s key (file header). */
function key_ClauseSpan(v: readonly [Clause, Span]): string {
  return `${v[0].id}:${v[1]}`;
}

/** PORT: D4 descriptor of `TraitRef` for `Binder::dummy` (as rustc_middle predicate.ts's private `d_TraitRef`). */
const d_TraitRef: TypeVisitable<TraitRefT> = { visit_with: visit_with_TraitRef };

/// Returns a list of all type clauses (explicit and implicit) for the definition with
/// ID `def_id`. This includes all clauses returned by `explicit_clauses_of`, plus
/// inferred constraints concerning which regions outlive other regions.
// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:28 clauses_of
export function clauses_of(tcx: TyCtxt, def_id: DefId): GenericClauses {
  let result = tcx.explicit_clauses_of(def_id) as GenericClauses;
  // debug!("clauses_of: explicit_clauses_of({:?}) = {:?}", def_id, result);

  const inferred_outlives = tcx.inferred_outlives_of(def_id) as readonly (readonly [Clause, Span])[];
  if (!(inferred_outlives.length === 0)) {
    // debug!("clauses_of: inferred_outlives_of({:?}) = {:?}", def_id, inferred_outlives,);
    // PORT: `(*clause).upcast(tcx)` is `UpcastFrom<T> for T` (the identity).
    const inferred_outlives_iter = inferred_outlives.map(([clause, span]): readonly [Clause, Span] => [clause, span]);
    if (result.clauses.length === 0) {
      result = { parent: result.parent, clauses: inferred_outlives_iter };
    } else {
      result = { parent: result.parent, clauses: [...result.clauses, ...inferred_outlives_iter] };
    }
  }

  if (tcx.is_trait(def_id)) {
    // For traits, add `Self: Trait` clause. This is
    // not part of the clauses that a user writes, but it
    // is something that one must prove in order to invoke a
    // method or project an associated type.
    //
    // In the chalk setup, this clause is not part of the
    // "clauses" for a trait item. But it is useful in
    // rustc because if you directly (e.g.) invoke a trait
    // method like `Trait::method(...)`, you must naturally
    // prove that the trait applies to the types that were
    // used, and adding the clause into this list ensures
    // that this is done.
    //
    // We use a DUMMY_SP here as a way to signal trait bounds that come
    // from the trait itself that *shouldn't* be shown as the source of
    // an obligation and instead be skipped. Otherwise we'd use
    // `tcx.def_span(def_id);`
    const span = DUMMY_SP;

    result = {
      parent: result.parent,
      clauses: [...result.clauses, [Clause_upcast_from_TraitRef(TraitRef.identity(tcx, def_id), tcx), span]],
    };
  }

  // debug!("clauses_of({:?}) = {:?}", def_id, result);
  return result;
}

/// Returns a list of user-specified type clauses for the definition with ID `def_id`.
/// N.B., this does not include any implied/inferred constraints.
// #[instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:82 gather_explicit_clauses_of
export function gather_explicit_clauses_of(tcx: TyCtxt, def_id: LocalDefId): GenericClauses {
  // use rustc_hir::*;

  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (rpitit !== undefined && rpitit.$ === "Trait") {
    const fn_def_id = rpitit.fn_def_id;
    const clauses: [Clause, Span][] = [];

    // RPITITs should inherit the clauses of their parent. This is
    // both to ensure that the RPITITs are only instantiated when the
    // parent clauses would hold, and also so that the param-env
    // inherits these clauses as assumptions.
    const identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
    for (const [c, s] of GenericClauses.instantiate_own(tcx.explicit_clauses_of(fn_def_id) as GenericClauses, tcx, identity_args)) {
      clauses.push([Unnormalized.skip_norm_wip(c), s]);
    }

    // We also install bidirectional outlives clauses for the RPITIT
    // to keep the duplicates lifetimes from opaque lowering in sync.
    // We only need to compute bidirectional outlives for the duplicated
    // opaque lifetimes, which explains the slicing below.
    compute_bidirectional_outlives_clauses(
      tcx,
      (tcx.generics_of(LocalDefId.to_def_id(def_id)) as Generics).own_params.slice((tcx.generics_of(fn_def_id) as Generics).own_params.length),
      clauses,
    );

    return {
      parent: LocalDefId.to_def_id(tcx.local_parent(def_id)),
      clauses,
    };
  } else if (rpitit !== undefined && rpitit.$ === "Impl") {
    const fn_def_id = rpitit.fn_def_id;
    const trait_item_def_id = unwrap(tcx.trait_item_of(def_id));
    const trait_assoc_clauses = tcx.explicit_clauses_of(trait_item_def_id) as GenericClauses;

    const impl_assoc_identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
    const impl_def_id = tcx.parent(fn_def_id);
    const impl_trait_ref_args = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id) as EarlyBinder<TraitRefT>)).args;

    const impl_assoc_args = impl_assoc_identity_args.rebase_onto(tcx, impl_def_id, impl_trait_ref_args);

    const impl_clauses = [...GenericClauses.instantiate_own(trait_assoc_clauses, tcx, impl_assoc_args)].map(([c, s]): readonly [Clause, Span] => [Unnormalized.skip_norm_wip(c), s]);

    return {
      parent: impl_def_id,
      clauses: impl_clauses,
    };
  }

  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const node = tcx.hir_node(hir_id);

  const sig = hir.Node.fn_sig(node);
  if (sig !== undefined) {
    const sig_id = sig.decl.opt_delegation_sig_id();
    if (sig_id !== undefined) {
      // PORT: rustc_hir_analysis delegation.rs is not ported (no lane yet).
      return unported("rustc_hir_analysis::delegation::inherit_clauses_for_delegation_item");
    }
  }

  let is_trait: [hir.GenericBounds, Span] | undefined = undefined;
  let is_default_impl_trait: PolyTraitRefT | undefined = undefined;

  const icx = ItemCtxt.new(tcx, def_id);

  const NO_GENERICS: hir.Generics = hir.Generics.empty();

  // We use an `IndexSet` to preserve order of insertion.
  // Preserving the order of insertion is important here so as not to break UI tests.
  const clauses_set = new KeyedSet<[Clause, Span]>(key_ClauseSpan);

  const hir_generics = hir.Node.generics(node) ?? NO_GENERICS;
  if (node.$ === "Item") {
    const item = node._0;
    const kind = item.kind;
    switch (kind.$) {
      case "Impl": {
        const impl_ = kind._0;
        const of_trait = impl_.of_trait;
        if (of_trait !== undefined && hir.Defaultness.is_default(of_trait.defaultness)) {
          is_default_impl_trait = Binder.dummy(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(def_id) as EarlyBinder<TraitRefT>)), d_TraitRef);
        }
        break;
      }
      case "Trait":
        is_trait = [kind.bounds, item.span];
        break;
      case "TraitAlias":
        is_trait = [kind._3, item.span];
        break;
      default:
        break;
    }
  }

  const generics = tcx.generics_of(def_id) as Generics;

  // Below we'll consider the bounds on the type parameters (including `Self`)
  // and the explicit where-clauses, but to get the full set of clauses
  // on a trait we must also consider the bounds that follow the trait's name,
  // like `trait Foo: A + B + C`.
  if (is_trait !== undefined) {
    const [self_bounds, span] = is_trait;
    const bounds: [Clause, Span][] = [];
    icx.lowerer().lower_bounds(tcx.types.self_param, self_bounds, bounds, RawList.empty(), PredicateFilter.All, OverlappingAsssocItemConstraints.Allowed);
    icx.lowerer().add_implicit_sizedness_bounds(bounds, tcx.types.self_param, self_bounds, { $: "TraitDef", _0: def_id }, span);
    icx.lowerer().add_default_traits(bounds, tcx.types.self_param, self_bounds, { $: "TraitDef", _0: def_id }, span);
    for (const b of bounds) clauses_set.add(b);
  }

  // In default impls, we can assume that the self type implements
  // the trait. So in:
  //
  //     default impl Foo for Bar { .. }
  //
  // we add a default where clause `Bar: Foo`. We do a similar thing for traits
  // (see below). Recall that a default impl is not itself an impl, but rather a
  // set of defaults that can be incorporated into another impl.
  if (is_default_impl_trait !== undefined) {
    const trait_ref = is_default_impl_trait;
    clauses_set.add([Clause_upcast_from_PolyTraitRef(trait_ref, tcx), tcx.def_span(def_id)]);
  }

  // Add implicit clauses that should be treated as if the user has written them,
  // including the implicit `T: Sized` for all generic parameters, and `ConstArgHasType`
  // for const params.
  for (const param of hir_generics.params) {
    switch (param.kind.$) {
      case "Lifetime":
        break;
      case "Type": {
        const param_ty = icx.lowerer().lower_ty_param(param.hir_id);
        const bounds: [Clause, Span][] = [];
        // Implicit bounds are added to type params unless a `?Trait` bound is found
        icx.lowerer().add_implicit_sizedness_bounds(bounds, param_ty, [], { $: "TyParam", _0: param.def_id, _1: hir_generics.predicates }, param.span);
        icx.lowerer().add_default_traits(bounds, param_ty, [], { $: "TyParam", _0: param.def_id, _1: hir_generics.predicates }, param.span);
        // trace!(?bounds);
        for (const b of bounds) clauses_set.add(b);
        // trace!(?clauses);
        break;
      }
      case "Const": {
        const param_def_id = LocalDefId.to_def_id(param.def_id);
        const ct_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(param_def_id) as EarlyBinder<Ty>));
        const ct = icx.lowerer().lower_const_param(param_def_id, param.hir_id);
        clauses_set.add([Clause_upcast_from_ClauseKind({ $: "ConstArgHasType", _0: ct, _1: ct_ty }, tcx), param.span]);
        break;
      }
    }
  }

  // trace!(?clauses);
  // Add inline `<T: Foo>` bounds and bounds in the where clause.
  for (const predicate of hir_generics.predicates) {
    where_predicate_clauses(icx, predicate, clauses_set);
  }

  if (tcx.features().generic_const_exprs()) {
    for (const c of const_evaluatable_clauses_of(tcx, def_id, clauses_set)) clauses_set.add(c);
  }

  const attrs = tcx.hir_attrs(tcx.local_def_id_to_hir_id(def_id));
  // FIXME(staged_api): We might want to look at the normal stability attributes too but
  // first we would need a way to let std/core use APIs with unstable feature bounds from
  // within stable APIs.
  const allow_unstable_feature_attr = find_attr(attrs, (k) => (k.$ === "UnstableFeatureBound" ? k._0 : undefined)) ?? [];

  for (const [feat_name, span] of allow_unstable_feature_attr) {
    clauses_set.add([Clause_upcast_from_ClauseKind({ $: "UnstableFeature", _0: feat_name }, tcx), span]);
  }

  const clauses: [Clause, Span][] = [...clauses_set];

  // Subtle: before we store the clauses into the tcx, we
  // sort them so that clauses like `T: Foo<Item=U>` come
  // before uses of `U`. This avoids false ambiguity errors
  // in trait checking. See `setup_constraining_clauses`
  // for details.
  if (node.$ === "Item" && node._0.kind.$ === "Impl") {
    const impl_ = node._0.kind._0;
    const self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));
    const trait_ref = impl_.of_trait !== undefined ? Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(def_id) as EarlyBinder<TraitRefT>)) : undefined;
    // PORT: rustc_hir_analysis constrained_generic_params.rs is not ported (no lane yet). Upstream evaluates the
    // argument `&mut cgp::parameters_for_impl(tcx, self_ty, trait_ref)` before calling `setup_constraining_clauses`.
    void self_ty;
    void trait_ref;
    return unported("rustc_hir_analysis::constrained_generic_params::parameters_for_impl");
  }

  // Opaque types duplicate some of their generic parameters.
  // We create bi-directional Outlives clauses between the original
  // and the duplicated parameter, to ensure that they do not get out of sync.
  if (node.$ === "OpaqueTy") {
    compute_bidirectional_outlives_clauses(tcx, generics.own_params, clauses);
    // debug!(?clauses);
  }

  return { parent: generics.parent, clauses };
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:318 where_predicate_clauses
export function where_predicate_clauses(icx: ItemCtxt, predicate: hir.WherePredicate, clauses: KeyedSet<[Clause, Span]>): void {
  const tcx = icx.tcx;
  const kind = predicate.kind;
  switch (kind.$) {
    case "BoundPredicate": {
      const bound_pred = kind._0;
      const ty = icx.lowerer().lower_ty_maybe_return_type_notation(bound_pred.bounded_ty);
      const bound_vars = tcx.late_bound_vars(predicate.hir_id);

      // This is a `where Ty:` (sic!).
      if (bound_pred.bounds.length === 0) {
        if (ty.kind().$ === "Param") {
          // We can skip the predicate because type parameters are trivially WF.
        } else {
          // Keep the type around in a dummy predicate. That way, it's not a complete
          // noop (see #53696) and `Ty` is still checked for WF.

          const span = bound_pred.bounded_ty.span;
          // PORT: `ty.into()` packs the `Ty` into a `Term` (the identity, ty-contract D3).
          const clause = Binder.bind_with_vars<ClauseKind>({ $: "WellFormed", _0: ty }, bound_vars);
          clauses.add([Clause_upcast_from_Binder_ClauseKind(clause, tcx), span]);
        }
      }

      const bounds: [Clause, Span][] = [];
      icx.lowerer().lower_bounds(ty, bound_pred.bounds, bounds, bound_vars, PredicateFilter.All, OverlappingAsssocItemConstraints.Allowed);
      for (const b of bounds) clauses.add(b);
      break;
    }

    case "RegionPredicate": {
      const region_pred = kind._0;
      const r1 = icx.lowerer().lower_lifetime(region_pred.lifetime, RegionInferReason.RegionPredicate);
      for (const bound of region_pred.bounds) {
        let r2: Region;
        let span: Span;
        if (bound.$ === "Outlives") {
          const lt = bound._0;
          r2 = icx.lowerer().lower_lifetime(lt, RegionInferReason.RegionPredicate);
          span = lt.ident.span;
        } else {
          span_bug(hir.GenericBound.span(bound), `lifetime param bounds must be outlives, but found ${hir.debug_GenericBound(bound, PLAIN)}`);
        }
        const clause = Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: r1, _1: r2 } }, tcx);
        clauses.add([clause, span]);
      }
      break;
    }
  }
}

/// Opaques have duplicated lifetimes and we need to compute bidirectional outlives clauses to
/// enforce that these lifetimes stay in sync.
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:384 compute_bidirectional_outlives_clauses
export function compute_bidirectional_outlives_clauses(tcx: TyCtxt, opaque_own_params: readonly GenericParamDef[], clauses: [Clause, Span][]): void {
  for (const param of opaque_own_params) {
    const orig_lifetime = tcx.map_opaque_lifetime_to_parent_lifetime(param.def_id.expect_local());
    if (orig_lifetime.kind().$ === "ReEarlyParam") {
      const dup_lifetime = RegionC.new_early_param(tcx, { index: param.index, name: param.name });
      const span = tcx.def_span(param.def_id);
      clauses.push([Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: orig_lifetime, _1: dup_lifetime } }, tcx), span]);
      clauses.push([Clause_upcast_from_ClauseKind({ $: "RegionOutlives", _0: { _0: dup_lifetime, _1: orig_lifetime } }, tcx), span]);
    }
  }
}

// #[instrument(level = "debug", skip(tcx, clauses), ret)]
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:412 const_evaluatable_clauses_of
export function const_evaluatable_clauses_of(tcx: TyCtxt, def_id: LocalDefId, clauses: KeyedSet<[Clause, Span]>): KeyedSet<[Clause, Span]> {
  // rustc-type: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:417 ConstCollector
  class ConstCollector implements TypeVisitor<undefined> {
    readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

    constructor(
      public tcx: TyCtxt,
      public clauses: KeyedSet<[Clause, Span]>,
    ) {}

    // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for ConstCollector<'tcx> ----

    // rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:439 visit_const
    visit_const(c: Const): undefined {
      const k = c.kind();
      if (k.$ === "Alias") {
        const alias_const = k._1;
        if (is_const_param_default(this.tcx, alias_const.kind)) {
          // Do not look into const param defaults,
          // these get checked when they are actually instantiated.
          //
          // We do not want the following to error:
          //
          //     struct Foo<const N: usize, const M: usize = { N + 1 }>;
          //     struct Bar<const N: usize>(Foo<N, 3>);
          return;
        }

        // Skip type consts as mGCA doesn't support evaluatable clauses.
        if (AliasConstKind.is_direct_const(alias_const.kind, as_interner(this.tcx))) {
          return;
        }

        const span = AliasConstKind.def_span(alias_const.kind, as_interner(this.tcx));
        this.clauses.add([Clause_upcast_from_ClauseKind({ $: "ConstEvaluatable", _0: c }, this.tcx), span]);
      }
    }

    // PORT: the provided `TypeVisitor` methods (PORTING §8).
    visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
      return TypeVisitor_provided.visit_binder(this, t, d);
    }

    visit_ty(t: Ty): undefined {
      return TypeVisitor_provided.visit_ty(this, t);
    }

    visit_region(r: Region): undefined {
      return TypeVisitor_provided.visit_region(this, r);
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

  // rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:422 is_const_param_default
  function is_const_param_default(tcx: TyCtxt, kind: AliasConstKind): boolean {
    if (kind.$ !== "Anon") return false;
    const def_id = kind.def_id;
    const local = def_id.as_local();
    if (local === undefined) return false;

    const hir_id = tcx.local_def_id_to_hir_id(local);
    let parent: [hir.HirId, hir.Node] | undefined = undefined;
    for (const p of tcx.hir_parent_iter(hir_id)) {
      if (p[1].$ === "ConstArg") continue;
      parent = p;
      break;
    }
    const [, parent_node] = unwrap(parent);
    return parent_node.$ === "GenericParam" && parent_node._0.kind.$ === "Const";
  }

  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const node = tcx.hir_node(hir_id);

  const collector = new ConstCollector(tcx, new KeyedSet<[Clause, Span]>(key_ClauseSpan));

  for (const [clause, _sp] of clauses) {
    visit_with_Clause(clause, collector);
  }

  if (node.$ === "Item" && node._0.kind.$ === "Impl") {
    const impl_ = node._0.kind._0;
    if (impl_.of_trait !== undefined) {
      // debug!("visit impl trait_ref");
      const trait_ref = tcx.impl_trait_ref(def_id) as EarlyBinder<TraitRefT>;
      visit_with_TraitRef(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(trait_ref)), collector);
    }

    // debug!("visit self_ty");
    const self_ty = tcx.type_of(def_id) as EarlyBinder<Ty>;
    visit_with_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(self_ty)), collector);
  }

  if (tcx.hir_fn_sig_by_hir_id(hir_id) !== undefined) {
    // debug!("visit fn sig");
    const fn_sig_ = tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>;
    const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(fn_sig_));
    // debug!(?fn_sig);
    fold_Binder(fold_FnSig).visit_with(fn_sig, collector);
  }

  return collector.clauses;
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:497 trait_explicit_clauses_and_bounds
export function trait_explicit_clauses_and_bounds(tcx: TyCtxt, def_id: LocalDefId): GenericClauses {
  assert_eq(tcx.def_kind(def_id), DefKind.Trait, (v) => debug_DefKind(v, PLAIN), DefKind_eq);
  return gather_explicit_clauses_of(tcx, def_id);
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:505 explicit_clauses_of
export function explicit_clauses_of(tcx: TyCtxt, def_id: LocalDefId): GenericClauses {
  const def_kind = tcx.def_kind(def_id);
  if (def_kind.$ === "Trait") {
    // Remove bounds on associated types from the clauses, they will be
    // returned by `explicit_item_bounds`.
    const clauses_and_bounds = tcx.trait_explicit_clauses_and_bounds(def_id) as GenericClauses;
    const trait_identity_args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));

    const is_assoc_item_ty = (ty: Ty): boolean => {
      // For a predicate from a where clause to become a bound on an
      // associated type:
      // * It must use the identity args of the item.
      //   * We're in the scope of the trait, so we can't name any
      //     parameters of the GAT. That means that all we need to
      //     check are that the args of the projection are the
      //     identity args of the trait.
      // * It must be an associated type for this trait (*not* a
      //   supertrait).
      const k = ty.kind();
      if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
        const projection_def_id = k._1.kind.def_id;
        const args = k._1.args;
        return (
          args === trait_identity_args &&
          // FIXME(return_type_notation): This check should be more robust
          !tcx.is_impl_trait_in_trait(projection_def_id) &&
          DefId_eq(tcx.parent(projection_def_id), LocalDefId.to_def_id(def_id))
        );
      } else {
        return false;
      }
    };

    const clauses = clauses_and_bounds.clauses.filter(([clause, _]) => {
      const k = Binder.skip_binder(clause.kind());
      switch (k.$) {
        case "Trait":
          return !is_assoc_item_ty(TraitClauseC.self_ty(k._0));
        case "Projection":
          return !is_assoc_item_ty(AliasTerm.self_ty(k._0.projection_term));
        case "TypeOutlives":
          return !is_assoc_item_ty(k._0._0);
        default:
          return true;
      }
    });
    if (clauses.length === clauses_and_bounds.clauses.length) {
      return clauses_and_bounds;
    } else {
      return {
        parent: clauses_and_bounds.parent,
        clauses,
      };
    }
  } else {
    if (def_kind.$ === "AnonConst" && tcx.features().generic_const_exprs()) {
      const defaulted_param_def_id = tcx.hir_opt_const_param_default_param_def_id(tcx.local_def_id_to_hir_id(def_id));
      if (defaulted_param_def_id !== undefined) {
        // In `generics_of` we set the generics' parent to be our parent's parent which means that
        // we lose out on the clauses of our actual parent if we dont return those clauses here.
        // (See comment in `generics_of` for more information on why the parent shenanigans is necessary)
        //
        // struct Foo<T, const N: usize = { <T as Trait>::ASSOC }>(T) where T: Trait;
        //        ^^^                     ^^^^^^^^^^^^^^^^^^^^^^^ the def id we are calling
        //        ^^^                                             explicit_clauses_of on
        //        parent item we dont have set as the
        //        parent of generics returned by `generics_of`
        //
        // In the above code we want the anon const to have clauses in its param env for `T: Trait`
        // and we would be calling `explicit_clauses_of(Foo)` here
        const parent_def_id = tcx.local_parent(def_id);
        const parent_clauses = tcx.explicit_clauses_of(parent_def_id) as GenericClauses;

        // If we dont filter out `ConstArgHasType` clauses then every single defaulted const parameter
        // will ICE because of #106994. FIXME(generic_const_exprs): remove this when a more general solution
        // to #106994 is implemented.
        const filtered_clauses = parent_clauses.clauses.filter(([clause, _]) => {
          const k = Binder.skip_binder(clause.kind());
          if (k.$ === "ConstArgHasType") {
            const ct = k._0;
            const ck = ct.kind();
            switch (ck.$) {
              case "Param": {
                const param_const = ck._0;
                // PORT: `HashMap`'s `Index` is `self.get(key).expect("no entry found for key")` (std map.rs).
                const defaulted_param_idx = unwrap((tcx.generics_of(parent_def_id) as Generics).param_def_id_to_index.get(LocalDefId.to_def_id(defaulted_param_def_id)), "no entry found for key");
                return param_const.index < defaulted_param_idx;
              }
              default:
                return bug("`ConstArgHasType` in `clauses_of` that isn't a `Param` const");
            }
          } else {
            return true;
          }
        });
        return {
          parent: parent_clauses.parent,
          clauses: filtered_clauses,
        };
      }
    }
    return gather_explicit_clauses_of(tcx, def_id);
  }
}

/// Ensures that the super-clauses of the trait with a `DefId`
/// of `trait_def_id` are lowered and stored. This also ensures that
/// the transitive super-clauses are lowered.
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:618 explicit_super_clauses_of
export function explicit_super_clauses_of(tcx: TyCtxt, trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return implied_clauses_with_filter(tcx, LocalDefId.to_def_id(trait_def_id), PredicateFilter.SelfOnly);
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:625 explicit_supertraits_containing_assoc_item
export function explicit_supertraits_containing_assoc_item(tcx: TyCtxt, _0: [DefId, Ident]): EarlyBinder<readonly [Clause, Span][]> {
  const [trait_def_id, assoc_ident] = _0;
  return implied_clauses_with_filter(tcx, trait_def_id, { $: "SelfTraitThatDefines", _0: assoc_ident });
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:636 explicit_implied_clauses_of
export function explicit_implied_clauses_of(tcx: TyCtxt, trait_def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return implied_clauses_with_filter(
    tcx,
    LocalDefId.to_def_id(trait_def_id),
    tcx.is_trait_alias(LocalDefId.to_def_id(trait_def_id)) ? PredicateFilter.All : PredicateFilter.SelfAndAssociatedTypeBounds,
  );
}

/// Ensures that the super-clauses of the trait with a `DefId`
/// of `trait_def_id` are lowered and stored. This also ensures that
/// the transitive super-clauses are lowered.
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:654 implied_clauses_with_filter
export function implied_clauses_with_filter(tcx: TyCtxt, trait_def_id_: DefId, filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]> {
  const trait_def_id = trait_def_id_.as_local();
  if (trait_def_id === undefined) {
    // if `assoc_ident` is None, then the query should've been redirected to an
    // external provider
    assert_matches(filter, filter.$ === "SelfTraitThatDefines", "PredicateFilter::SelfTraitThatDefines(_)", (v) => debug_PredicateFilter(v, PLAIN));
    return tcx.explicit_super_clauses_of(trait_def_id_) as EarlyBinder<readonly [Clause, Span][]>;
  }

  const node = tcx.hir_node_by_def_id(trait_def_id);
  if (node.$ !== "Item") {
    return bug(`trait_def_id ${debug_LocalDefId(trait_def_id, PLAIN)} is not an item`);
  }
  const item = node._0;

  let generics: hir.Generics;
  let superbounds: hir.GenericBounds;
  const kind = item.kind;
  switch (kind.$) {
    case "Trait":
      [generics, superbounds] = [kind.generics, kind.bounds];
      break;
    case "TraitAlias":
      [generics, superbounds] = [kind._2, kind._3];
      break;
    default:
      return span_bug(item.span, "super_clauses invoked on non-trait");
  }

  const icx = ItemCtxt.new(tcx, trait_def_id);

  const self_param_ty = tcx.types.self_param;
  const bounds: [Clause, Span][] = [];
  icx.lowerer().lower_bounds(self_param_ty, superbounds, bounds, RawList.empty(), filter, OverlappingAsssocItemConstraints.Allowed);
  switch (filter.$) {
    case "All":
    case "SelfOnly":
    case "SelfTraitThatDefines":
    case "SelfAndAssociatedTypeBounds":
      icx.lowerer().add_implicit_sizedness_bounds(bounds, self_param_ty, superbounds, { $: "TraitDef", _0: trait_def_id }, item.span);
      icx.lowerer().add_default_traits(bounds, self_param_ty, superbounds, { $: "TraitDef", _0: trait_def_id }, item.span);
      break;
    //`ConstIfConst` is only interested in `[const]` bounds.
    case "ConstIfConst":
    case "SelfConstIfConst":
      break;
  }

  const where_bounds_that_match = icx.probe_ty_param_bounds_in_generics(generics, item.owner_id.def_id, filter);

  // Combine the two lists to form the complete set of superbounds:
  const implied_bounds: readonly [Clause, Span][] = [...bounds, ...where_bounds_that_match];
  // debug!(?implied_bounds);

  // Now require that immediate supertraits are lowered, which will, in
  // turn, reach indirect supertraits, so we detect cycles now instead of
  // overflowing during elaboration. Same for implied predicates, which
  // make sure we walk into associated type bounds.
  switch (filter.$) {
    case "SelfOnly":
      for (const [clause, span] of implied_bounds) {
        // debug!("superbound: {:?}", clause);
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "Trait" && k._0.polarity === "Positive") {
          const bound = k._0;
          tcx.at(span).explicit_super_clauses_of(TraitClauseC.def_id(bound));
        }
      }
      break;
    case "All":
    case "SelfAndAssociatedTypeBounds":
      for (const [clause, span] of implied_bounds) {
        // debug!("superbound: {:?}", clause);
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "Trait" && k._0.polarity === "Positive") {
          const bound = k._0;
          tcx.at(span).explicit_implied_clauses_of(TraitClauseC.def_id(bound));
        }
      }
      break;
    default:
      break;
  }

  assert_only_contains_clauses_from(filter, implied_bounds, tcx.types.self_param);

  return EarlyBinder.bind_iter(implied_bounds);
}

/** `assert_eq!(left, right, "{args}")`: core's text (`assert_failed_inner`, `AssertKind::Eq`, with args). */
function assert_eq_args<T>(left: T, right: T, debug: (v: T) => string, args: string): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed: ${args}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}

/** PORT: `cfg!(debug_assertions)`: rustc (the oracle) ships without debug assertions. */
const DEBUG_ASSERTIONS: boolean = false;

// Make sure when elaborating supertraits, probing for associated types, etc.,
// we really truly are elaborating clauses that have `ty` as their self type.
// This is very important since downstream code relies on this being correct.
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:756 assert_only_contains_clauses_from
export function assert_only_contains_clauses_from(filter: PredicateFilter, bounds: readonly [Clause, Span][], ty: Ty): void {
  if (!DEBUG_ASSERTIONS) {
    return;
  }

  const dbg_ty = (v: Ty): string => debug_Ty(v, PLAIN);
  const f = debug_PredicateFilter(filter, PLAIN);
  switch (filter.$) {
    case "SelfOnly":
      for (const [clause, _] of bounds) {
        const c = debug_Clause(clause, PLAIN);
        const k = Binder.skip_binder(clause.kind());
        switch (k.$) {
          case "Trait":
            assert_eq_args(TraitClauseC.self_ty(k._0), ty, dbg_ty, `expected \`Self\` predicate when computing \`${f}\` implied bounds: ${c}`);
            break;
          case "Projection":
            assert_eq_args(ProjectionClause.self_ty(k._0), ty, dbg_ty, `expected \`Self\` predicate when computing \`${f}\` implied bounds: ${c}`);
            break;
          case "TypeOutlives":
            assert_eq_args(k._0._0, ty, dbg_ty, `expected \`Self\` clause when computing \`${f}\` implied bounds: ${c}`);
            break;
          case "HostEffect":
            assert_eq_args(HostEffectClause.self_ty(k._0), ty, dbg_ty, `expected \`Self\` clause when computing \`${f}\` implied bounds: ${c}`);
            break;

          case "RegionOutlives":
          case "ConstArgHasType":
          case "WellFormed":
          case "UnstableFeature":
          case "ConstEvaluatable":
            bug(`unexpected non-\`Self\` predicate when computing \`${f}\` implied bounds: ${c}`);
        }
      }
      break;
    case "SelfTraitThatDefines":
      for (const [clause, _] of bounds) {
        const c = debug_Clause(clause, PLAIN);
        const k = Binder.skip_binder(clause.kind());
        switch (k.$) {
          case "Trait":
            assert_eq_args(TraitClauseC.self_ty(k._0), ty, dbg_ty, `expected \`Self\` predicate when computing \`${f}\` implied bounds: ${c}`);
            break;

          case "Projection":
          case "TypeOutlives":
          case "RegionOutlives":
          case "ConstArgHasType":
          case "WellFormed":
          case "ConstEvaluatable":
          case "UnstableFeature":
          case "HostEffect":
            bug(`unexpected non-\`Self\` predicate when computing \`${f}\` implied bounds: ${c}`);
        }
      }
      break;
    case "ConstIfConst":
      for (const [clause, _] of bounds) {
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "HostEffect" && k._0.constness === "Maybe") {
          // ok
        } else {
          bug(`unexpected non-\`HostEffect\` clause when computing \`${f}\` implied bounds: ${debug_Clause(clause, PLAIN)}`);
        }
      }
      break;
    case "SelfConstIfConst":
      for (const [clause, _] of bounds) {
        const c = debug_Clause(clause, PLAIN);
        const k = Binder.skip_binder(clause.kind());
        if (k.$ === "HostEffect") {
          const host_clause = k._0;
          assert_eq_args<BoundConstness>(host_clause.constness, "Maybe", (v) => debug_BoundConstness(v, PLAIN), `expected \`[const]\` clause when computing \`${f}\` implied bounds: ${c}`);
          assert_eq_args(TraitRef.self_ty(host_clause.trait_ref), ty, dbg_ty, `expected \`Self\` clause when computing \`${f}\` implied bounds: ${c}`);
        } else {
          bug(`unexpected non-\`HostEffect\` clause when computing \`${f}\` implied bounds: ${c}`);
        }
      }
      break;
    case "All":
    case "SelfAndAssociatedTypeBounds":
      break;
  }
}

/// Returns the clauses defined on `item_def_id` of the form
/// `X: Foo` where `X` is the type parameter `def_id`.
// #[instrument(level = "trace", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:891 type_param_clauses
export function type_param_clauses(tcx: TyCtxt, _0: [LocalDefId, LocalDefId, Ident]): EarlyBinder<readonly [Clause, Span][]> {
  const [item_def_id, def_id, assoc_ident] = _0;
  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(item_def_id));
  if (rpitit !== undefined) {
    switch (rpitit.$) {
      case "Trait":
        return tcx.type_param_clauses([rpitit.opaque_def_id.expect_local(), def_id, assoc_ident]) as EarlyBinder<readonly [Clause, Span][]>;
      case "Impl":
        return unreachable("internal error: entered unreachable code: should not be lowering bounds on RPITIT in impl");
    }
  }

  // In the HIR, bounds can derive from two places. Either
  // written inline like `<T: Foo>` or in a where-clause like
  // `where T: Foo`.

  const param_id = tcx.local_def_id_to_hir_id(def_id);
  const param_owner = tcx.hir_ty_param_owner(def_id);

  // Don't look for bounds where the type parameter isn't in scope.
  const parent_ = item_def_id === param_owner
    ? // FIXME: Shouldn't this be unreachable?
      undefined
    : (tcx.generics_of(item_def_id) as Generics).parent?.expect_local();

  let result: EarlyBinder<readonly [Clause, Span][]>;
  if (parent_ !== undefined) {
    const icx = ItemCtxt.new(tcx, parent_);
    result = HirTyLowerer_ItemCtxt.probe_ty_param_bounds.call(icx, DUMMY_SP, def_id, assoc_ident);
  } else {
    result = EarlyBinder.bind_iter<readonly [Clause, Span][]>([]);
  }
  let extend: [Clause, Span] | undefined = undefined;

  const item_hir_id = tcx.local_def_id_to_hir_id(item_def_id);

  const hir_node = tcx.hir_node(item_hir_id);
  const hir_generics = hir.Node.generics(hir_node);
  if (hir_generics === undefined) {
    return result;
  }

  if (
    hir_node.$ === "Item" &&
    hir_node._0.kind.$ === "Trait" &&
    // Implied `Self: Trait` and supertrait bounds.
    hir.HirId_eq(param_id, item_hir_id)
  ) {
    const item = hir_node._0;
    const identity_trait_ref = TraitRef.identity(tcx, LocalDefId.to_def_id(item_def_id));
    extend = [Clause_upcast_from_TraitRef(identity_trait_ref, tcx), item.span];
  }

  const icx = ItemCtxt.new(tcx, item_def_id);
  const extra_clauses: [Clause, Span][] = [
    ...(extend !== undefined ? [extend] : []),
    ...icx.probe_ty_param_bounds_in_generics(hir_generics, def_id, { $: "SelfTraitThatDefines", _0: assoc_ident }),
  ];

  const bounds: readonly [Clause, Span][] = [...EarlyBinder.skip_binder(result), ...extra_clauses];

  // Double check that the bounds *only* contain `SelfTy: Trait` clauses.
  const dk = tcx.def_kind(def_id);
  let self_ty: Ty;
  switch (dk.$) {
    case "TyParam":
      self_ty = Ty.new_param(
        tcx,
        unwrap((tcx.generics_of(item_def_id) as Generics).param_def_id_to_index_(tcx, LocalDefId.to_def_id(def_id)), "expected generic param to be owned by item"),
        tcx.item_name(LocalDefId.to_def_id(def_id)),
      );
      break;
    case "Trait":
    case "TraitAlias":
      self_ty = tcx.types.self_param;
      break;
    default:
      return unreachable();
  }
  assert_only_contains_clauses_from({ $: "SelfTraitThatDefines", _0: assoc_ident }, bounds, self_ty);

  return EarlyBinder.bind_iter(bounds);
}

// impl<'tcx> ItemCtxt<'tcx> {
/// Finds bounds from `hir::Generics`.
///
/// This requires scanning through the HIR.
/// We do this to avoid having to lower *all* the bounds, which would create artificial cycles.
/// Instead, we can only lower the bounds for a type parameter `X` if `X::Foo` is used.
// #[instrument(level = "trace", skip(self, hir_generics))]
// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:982 probe_ty_param_bounds_in_generics
ItemCtxt.prototype.probe_ty_param_bounds_in_generics = function (this: ItemCtxt, hir_generics: hir.Generics, param_def_id: LocalDefId, filter: PredicateFilter): [Clause, Span][] {
  const bounds: [Clause, Span][] = [];

  if (filter.$ === "All") {
    for (const param of hir_generics.params) {
      switch (param.kind.$) {
        case "Type": {
          const param_ty = this.lowerer().lower_ty_param(param.hir_id);
          this.lowerer().add_implicit_sizedness_bounds(bounds, param_ty, [], { $: "TyParam", _0: param.def_id, _1: hir_generics.predicates }, param.span);
          this.lowerer().add_default_traits(bounds, param_ty, [], { $: "TyParam", _0: param.def_id, _1: hir_generics.predicates }, param.span);
          break;
        }
        case "Lifetime":
        case "Const":
          break;
      }
    }
  }

  for (const predicate_ of hir_generics.predicates) {
    const hir_id = predicate_.hir_id;
    if (predicate_.kind.$ !== "BoundPredicate") {
      continue;
    }
    const predicate = predicate_.kind._0;

    if (predicate.is_param_bound(LocalDefId.to_def_id(param_def_id))) {
      // Ok
    } else {
      switch (filter.$) {
        case "All":
          // Ok
          break;
        case "SelfOnly":
        case "SelfTraitThatDefines":
        case "SelfConstIfConst":
        case "SelfAndAssociatedTypeBounds":
          continue;
        case "ConstIfConst":
          unreachable();
      }
    }

    const bound_ty = this.lowerer().lower_ty_maybe_return_type_notation(predicate.bounded_ty);

    const bound_vars = this.tcx.late_bound_vars(hir_id);
    this.lowerer().lower_bounds(bound_ty, predicate.bounds, bounds, bound_vars, filter, OverlappingAsssocItemConstraints.Allowed);
  }

  return bounds;
};
// }

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:1053 const_conditions
export function const_conditions(tcx: TyCtxt, def_id: LocalDefId): ConstConditions {
  if (!tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
    bug(`const_conditions invoked for item that is not conditionally const: ${debug_LocalDefId(def_id, PLAIN)}`);
  }

  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (rpitit !== undefined) {
    // RPITITs inherit const conditions of their parent fn
    const fn_def_id = rpitit.fn_def_id;
    return tcx.const_conditions(fn_def_id) as ConstConditions;
  }

  const wrong_item = (): never => bug(`const_conditions called on wrong item: ${debug_LocalDefId(def_id, PLAIN)}`);
  let generics: hir.Generics;
  let trait_def_id_and_supertraits: [LocalDefId | undefined, hir.GenericBounds] | undefined;
  let has_parent: boolean;
  const node = tcx.hir_node_by_def_id(def_id);
  switch (node.$) {
    case "Item": {
      const item = node._0;
      const kind = item.kind;
      switch (kind.$) {
        case "Impl":
          [generics, trait_def_id_and_supertraits, has_parent] = [kind._0.generics, undefined, false];
          break;
        case "Fn":
          [generics, trait_def_id_and_supertraits, has_parent] = [kind.generics, undefined, false];
          break;
        case "Trait":
          [generics, trait_def_id_and_supertraits, has_parent] = [kind.generics, [item.owner_id.def_id, kind.bounds], false];
          break;
        case "TraitAlias":
          [generics, trait_def_id_and_supertraits, has_parent] = [kind._2, [undefined, kind._3], false];
          break;
        default:
          return wrong_item();
      }
      break;
    }
    // While associated types are not really const, we do allow them to have `[const]`
    // bounds and where clauses. `const_conditions` is responsible for gathering
    // these up so we can check them in `compare_type_clause_entailment`, and
    // in `HostEffect` goal computation.
    case "TraitItem": {
      const item = node._0;
      switch (item.kind.$) {
        case "Fn":
        case "Type":
          [generics, trait_def_id_and_supertraits, has_parent] = [item.generics, undefined, true];
          break;
        default:
          return wrong_item();
      }
      break;
    }
    case "ImplItem": {
      const item = node._0;
      switch (item.kind.$) {
        case "Fn":
        case "Type":
          [generics, trait_def_id_and_supertraits, has_parent] = [item.generics, undefined, tcx.is_conditionally_const(LocalDefId.to_def_id(tcx.local_parent(def_id)))];
          break;
        default:
          return wrong_item();
      }
      break;
    }
    case "ForeignItem": {
      const item = node._0;
      if (item.kind.$ === "Fn") {
        [generics, trait_def_id_and_supertraits, has_parent] = [item.kind._2, undefined, false];
      } else {
        return wrong_item();
      }
      break;
    }
    case "OpaqueTy": {
      const opaque = node._0;
      switch (opaque.origin.$) {
        case "FnReturn":
          return tcx.const_conditions(opaque.origin.parent) as ConstConditions;
        case "AsyncFn":
        case "TyAlias":
          return unreachable();
      }
      break;
    }
    // N.B. Tuple ctors are unconditionally constant.
    case "Ctor":
      if (node._0.$ === "Tuple") {
        return ConstConditions.default_();
      }
      return wrong_item();
    case "Expr":
      if (node._0.kind.$ === "Closure") {
        [generics, trait_def_id_and_supertraits, has_parent] = [hir.Generics.empty(), undefined, tcx.is_conditionally_const(LocalDefId.to_def_id(tcx.local_parent(def_id)))];
        break;
      }
      return wrong_item();
    default:
      return wrong_item();
  }

  const icx = ItemCtxt.new(tcx, def_id);
  const bounds: [Clause, Span][] = [];

  for (const pred of generics.predicates) {
    const kind = pred.kind;
    switch (kind.$) {
      case "BoundPredicate": {
        const bound_pred = kind._0;
        const ty = icx.lowerer().lower_ty_maybe_return_type_notation(bound_pred.bounded_ty);
        const bound_vars = tcx.late_bound_vars(pred.hir_id);
        icx.lowerer().lower_bounds(ty, bound_pred.bounds, bounds, bound_vars, PredicateFilter.ConstIfConst, OverlappingAsssocItemConstraints.Allowed);
        break;
      }
      default:
        break;
    }
  }

  if (trait_def_id_and_supertraits !== undefined) {
    const [def_id_, supertraits] = trait_def_id_and_supertraits;
    if (def_id_ !== undefined) {
      // We've checked above that the trait is conditionally const.
      bounds.push([PolyTraitRef.to_host_effect_clause(Binder.dummy(TraitRef.identity(tcx, LocalDefId.to_def_id(def_id_)), d_TraitRef), tcx, "Maybe"), DUMMY_SP]);
    }

    icx.lowerer().lower_bounds(tcx.types.self_param, supertraits, bounds, RawList.empty(), PredicateFilter.ConstIfConst, OverlappingAsssocItemConstraints.Allowed);
  }

  return {
    parent: has_parent ? LocalDefId.to_def_id(tcx.local_parent(def_id)) : undefined,
    clauses: bounds.map(([clause, span]): readonly [PolyTraitRefT, Span] => [
      Binder.map_bound(clause.kind(), (clause: ClauseKind): TraitRefT => {
        if (clause.$ === "HostEffect" && clause._0.constness === "Maybe") {
          return clause._0.trait_ref;
        }
        return bug(`converted ${debug_ClauseKind(clause, PLAIN)}`);
      }),
      span,
    ]),
  };
}

// rustc: compiler/rustc_hir_analysis/src/collect/clauses_of.rs:1175 explicit_implied_const_bounds
export function explicit_implied_const_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [PolyTraitRefT, Span][]> {
  if (!tcx.is_conditionally_const(LocalDefId.to_def_id(def_id))) {
    bug(`explicit_implied_const_bounds invoked for item that is not conditionally const: ${debug_LocalDefId(def_id, PLAIN)}`);
  }

  let bounds: EarlyBinder<readonly [Clause, Span][]>;
  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (rpitit !== undefined && rpitit.$ === "Trait") {
    // RPITIT's bounds are the same as opaque type bounds, but with
    // a projection self type.
    bounds = explicit_item_bounds_with_filter(tcx, def_id, PredicateFilter.ConstIfConst);
  } else if (rpitit !== undefined && rpitit.$ === "Impl") {
    return span_bug(tcx.def_span(def_id), "RPITIT in impl should not have item bounds");
  } else {
    const node = tcx.hir_node_by_def_id(def_id);
    if (node.$ === "Item" && (node._0.kind.$ === "Trait" || node._0.kind.$ === "TraitAlias")) {
      bounds = implied_clauses_with_filter(tcx, LocalDefId.to_def_id(def_id), PredicateFilter.SelfConstIfConst);
    } else if ((node.$ === "TraitItem" && node._0.kind.$ === "Type") || node.$ === "OpaqueTy") {
      bounds = explicit_item_bounds_with_filter(tcx, def_id, PredicateFilter.ConstIfConst);
    } else {
      return bug(`explicit_implied_const_bounds called on wrong item: ${debug_LocalDefId(def_id, PLAIN)}`);
    }
  }

  return EarlyBinder.map_bound(bounds, (bounds) =>
    bounds.map(([clause, span]): [PolyTraitRefT, Span] => [
      Binder.map_bound(clause.kind(), (clause: ClauseKind): TraitRefT => {
        if (clause.$ === "HostEffect" && clause._0.constness === "Maybe") {
          return clause._0.trait_ref;
        }
        return bug(`converted ${debug_ClauseKind(clause, PLAIN)}`);
      }),
      span,
    ]),
  );
}
