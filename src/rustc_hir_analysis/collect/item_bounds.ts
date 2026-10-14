// Port of compiler/rustc_hir_analysis/src/collect/item_bounds.rs (lane collect-b).
//
// Contract: docs/handoff/hirtylowerer-contract.md. The free fns have their decls.ts `Fns_collect_item_bounds`
// signatures; `MapAndCompressBoundVars` and `AssocTyToOpaque` (types.sets.json `hand`) are the TypeFolder classes below.
// Init order: top-level code here touches only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_analysis export is read inside function bodies only.
//
// PORT notes (file-wide):
// - `tcx.arena.alloc_from_iter(..)` / `alloc_slice(..)` are plain arrays.
// - Query values that are `unknown` in queries.gen.ts (`generics_of`, `type_of`, `trait_explicit_clauses_and_bounds`,
//   `explicit_item_bounds`, `item_bounds`, `impl_trait_header`, ...) are cast to the upstream value type.
// - `debug!` / `#[instrument]` are tracing only and stay as comments.
import { ItemCtxt } from "../decls.ts";
import * as hir from "../../rustc_hir/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericClauses, Generics } from "../../rustc_middle/ty/generics.ts";
import { type Clauses, RawList } from "../../rustc_middle/ty/list.ts";
import { type ImplTraitHeader, Ty } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_Binder_ClauseKind, Clause_upcast_from_TraitRef, fold_with_Clause } from "../../rustc_middle/ty/predicate.ts";
import { fold_Clauses, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, type DefId, LocalDefId, debug_LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Binder, BoundConst, type BoundVariableKind, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { TraitRef as TraitRefT } from "../../rustc_type_ir/decls.ts";
import { Elaboratable_Clause, elaborate } from "../../rustc_type_ir/elaborate.ts";
import { type PredicateProxy, shift_vars, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { BoundVar, DebruijnIndex, INNERMOST } from "../../rustc_type_ir/lib.ts";
import { as_interner, HostEffectClause, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_with_ClauseKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import { Const as ConstC, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { fold_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { AliasTy, IsRigid } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { with_reduced_queries } from "../../rustc_middle/ty/print/pretty.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unreachable } from "../../std/panic.ts";
import { ImpliedBoundsContext, OverlappingAsssocItemConstraints, PredicateFilter } from "../hir_ty_lowering/mod.gen.ts";
import { assert_only_contains_clauses_from } from "./clauses_of.ts";

export * from "./item_bounds.gen.ts";

/// For associated types we include both bounds written on the type
/// (`type X: Trait`) and predicates from the trait: `where Self::X: Trait`.
///
/// Note that this filtering is done with the items identity args to
/// simplify checking that these bounds are met in impls. This means that
/// a bound such as `for<'b> <Self as X<'b>>::U: Clone` can't be used, as in
/// `hr-associated-type-bound-1.rs`.
// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:25 associated_type_bounds
export function associated_type_bounds(tcx: TyCtxt, assoc_item_def_id: LocalDefId, hir_bounds: readonly hir.GenericBound[], span: Span, filter: PredicateFilter): readonly [Clause, Span][] {
  return with_reduced_queries(() => {
    const item_ty = Ty.new_projection_from_args(tcx, IsRigid.No, LocalDefId.to_def_id(assoc_item_def_id), RawList.identity_for_item(tcx, LocalDefId.to_def_id(assoc_item_def_id)));

    const icx = ItemCtxt.new(tcx, assoc_item_def_id);
    const bounds: [Clause, Span][] = [];
    icx.lowerer().lower_bounds(item_ty, hir_bounds, bounds, RawList.empty(), filter, OverlappingAsssocItemConstraints.Allowed);

    switch (filter.$) {
      case "All":
      case "SelfOnly":
      case "SelfTraitThatDefines":
      case "SelfAndAssociatedTypeBounds": {
        // Implicit bounds are added to associated types unless a `?Trait` bound is found.
        icx.lowerer().add_implicit_sizedness_bounds(bounds, item_ty, hir_bounds, ImpliedBoundsContext.AssociatedTypeOrImplTrait, span);
        icx.lowerer().add_default_traits(bounds, item_ty, hir_bounds, ImpliedBoundsContext.AssociatedTypeOrImplTrait, span);

        // Also collect `where Self::Assoc: Trait` from the parent trait's where clauses.
        const trait_def_id = tcx.local_parent(assoc_item_def_id);
        const trait_clauses = tcx.trait_explicit_clauses_and_bounds(trait_def_id) as GenericClauses;

        const item_trait_ref = TraitRef.identity(tcx, tcx.parent(LocalDefId.to_def_id(assoc_item_def_id)));
        for (const [clause, clause_span] of trait_clauses.clauses) {
          const r = remap_gat_vars_and_recurse_into_nested_projections(tcx, filter, item_trait_ref, assoc_item_def_id, clause_span, clause);
          if (r !== undefined) bounds.push(r);
        }
        break;
      }
      // `ConstIfConst` is only interested in `[const]` bounds.
      case "ConstIfConst":
      case "SelfConstIfConst":
        // FIXME(const_trait_impl): We *could* uplift the
        // `where Self::Assoc: [const] Trait` bounds from the parent trait
        // here too, but we'd need to split `const_conditions` into two
        // queries (like we do for `trait_explicit_clauses_and_bounds`)
        // since we need to also filter the clauses *out* of the const
        // conditions or they lead to cycles in the trait solver when
        // utilizing these bounds. For now, let's do nothing.
        break;
    }

    // debug!(
    //     "associated_type_bounds({}) = {:?}",
    //     tcx.def_path_str(assoc_item_def_id.to_def_id()),
    //     bounds
    // );

    assert_only_contains_clauses_from(filter, bounds, item_ty);

    return bounds;
  });
}

/// The code below is quite involved, so let me explain.
///
/// We loop here, because we also want to collect vars for nested associated items as
/// well. For example, given a clause like `Self::A::B`, we want to add that to the
/// item bounds for `A`, so that we may use that bound in the case that `Self::A::B` is
/// rigid.
///
/// Secondly, regarding bound vars, when we see a where clause that mentions a GAT
/// like `for<'a, ...> Self::Assoc<'a, ...>: Bound<'b, ...>`, we want to turn that into
/// an item bound on the GAT, where all of the GAT args are substituted with the GAT's
/// param regions, and then keep all of the other late-bound vars in the bound around.
/// We need to "compress" the binder so that it doesn't mention any of those vars that
/// were mapped to params.
// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:129 remap_gat_vars_and_recurse_into_nested_projections
export function remap_gat_vars_and_recurse_into_nested_projections(tcx: TyCtxt, filter: PredicateFilter, item_trait_ref: TraitRefT, assoc_item_def_id: LocalDefId, span: Span, clause: Clause): [Clause, Span] | undefined {
  let clause_ty: Ty;
  const ck = Binder.skip_binder(clause.kind());
  switch (ck.$) {
    case "Trait":
      clause_ty = TraitClause.self_ty(ck._0);
      break;
    case "Projection":
      clause_ty = AliasTerm.self_ty(ck._0.projection_term);
      break;
    case "TypeOutlives":
      clause_ty = ck._0._0;
      break;
    case "HostEffect":
      clause_ty = HostEffectClause.self_ty(ck._0);
      break;
    default:
      return undefined;
  }

  let gat_vars: readonly GenericArg[];
  for (;;) {
    const k = clause_ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const alias_ty = k._1;
      const alias_ty_def_id = k._1.kind.def_id;
      const alias_trait_ref = AliasTy.trait_ref(alias_ty, as_interner(tcx));
      // PORT: derived `PartialEq` of `TraitRef` (`def_id`, interned `args`; the marker field is `()`).
      if (DefId_eq(alias_trait_ref.def_id, item_trait_ref.def_id) && alias_trait_ref.args === item_trait_ref.args && DefId_eq(alias_ty_def_id, LocalDefId.to_def_id(assoc_item_def_id))) {
        // We have found the GAT in question...
        // Return the vars, since we may need to remap them.
        gat_vars = alias_ty.args.slice(item_trait_ref.args.length);
        break;
      } else {
        // Only collect *self* type bounds if the filter is for self.
        switch (filter.$) {
          case "All":
            break;
          case "SelfOnly":
            return undefined;
          case "SelfTraitThatDefines":
          case "SelfConstIfConst":
          case "SelfAndAssociatedTypeBounds":
          case "ConstIfConst":
            unreachable("internal error: entered unreachable code: invalid predicate filter for `remap_gat_vars_and_recurse_into_nested_projections`");
        }

        clause_ty = AliasTy.self_ty(alias_ty);
        continue;
      }
    }

    return undefined;
  }

  // Special-case: No GAT vars, no mapping needed.
  if (gat_vars.length === 0) {
    return [clause, span];
  }

  // First, check that all of the GAT args are substituted with a unique late-bound arg.
  // If we find a duplicate, then it can't be mapped to the definition's params.
  const mapping = new Map<BoundVar, GenericArg>();
  const generics = tcx.generics_of(assoc_item_def_id) as Generics;
  const n = Math.min(generics.own_params.length, gat_vars.length);
  for (let i = 0; i < n; i++) {
    const param = generics.own_params[i]!;
    const var_ = gat_vars[i]!;
    let existing: GenericArg | undefined;
    const vk = GenericArg.kind(var_);
    switch (vk.$) {
      case "Lifetime": {
        const re = vk._0;
        const rk = re.kind();
        if (!(rk.$ === "ReBound" && rk._0.$ === "Bound" && rk._0._0 === INNERMOST)) {
          return undefined;
        }
        const bv = rk._1;
        existing = map_insert(mapping, bv.var, tcx.mk_param_from_def(param));
        break;
      }
      case "Type": {
        const ty = vk._0;
        const tk = ty.kind();
        if (!(tk.$ === "Bound" && tk._0.$ === "Bound" && tk._0._0 === INNERMOST)) {
          return undefined;
        }
        const bv = tk._1;
        existing = map_insert(mapping, bv.var, tcx.mk_param_from_def(param));
        break;
      }
      case "Const": {
        const ct = vk._0;
        const ctk = ct.kind();
        if (!(ctk.$ === "Bound" && ctk._0.$ === "Bound" && ctk._0._0 === INNERMOST)) {
          return undefined;
        }
        const bv = ctk._1;
        existing = map_insert(mapping, bv.var, tcx.mk_param_from_def(param));
        break;
      }
    }

    if (existing !== undefined) {
      return undefined;
    }
  }

  // Finally, map all of the args in the GAT to the params we expect, and compress
  // the remaining late-bound vars so that they count up from var 0.
  const folder = new MapAndCompressBoundVars(tcx, INNERMOST, [], mapping);
  const pred = fold_with_ClauseKind(Binder.skip_binder(clause.kind()), folder);

  return [Clause_upcast_from_Binder_ClauseKind(Binder.bind_with_vars(pred, tcx.mk_bound_variable_kinds(folder.still_bound_vars)), tcx), span];
}

/** `IndexMap::insert`: sets the value (an existing key keeps its position) and returns the old value. */
function map_insert<K, V>(map: Map<K, V>, k: K, v: V): V | undefined {
  const old = map.get(k);
  map.set(k, v);
  return old;
}

/// Given some where clause like `for<'b, 'c> <Self as Trait<'a_identity>>::Gat<'b>: Bound<'c>`,
/// the mapping will map `'b` back to the GAT's `'b_identity`. Then we need to compress the
/// remaining bound var `'c` to index 0.
///
/// This folder gives us: `for<'c> <Self as Trait<'a_identity>>::Gat<'b_identity>: Bound<'c>`,
/// which is sufficient for an item bound for `Gat`, since all of the GAT's args are identity.
// rustc-type: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:242 MapAndCompressBoundVars
export class MapAndCompressBoundVars implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    /// How deep are we? Makes sure we don't touch the vars of nested binders.
    public binder: DebruijnIndex,
    /// List of bound vars that remain unsubstituted because they were not
    /// mentioned in the GAT's args.
    public still_bound_vars: BoundVariableKind[],
    /// Subtle invariant: If the `GenericArg` is bound, then it should be
    /// stored with the debruijn index of `INNERMOST` so it can be shifted
    /// correctly during substitution.
    public mapping: Map<BoundVar, GenericArg>,
  ) {}

  // ---- impl<'tcx> TypeFolder<TyCtxt<'tcx>> for MapAndCompressBoundVars<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:256 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:260 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.binder = DebruijnIndex.shifted_in(this.binder, 1);
    const out = fold_Binder(d).super_fold_with(t, this);
    this.binder = DebruijnIndex.shifted_out(this.binder, 1);
    return out;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:270 fold_ty
  fold_ty(ty: Ty): Ty {
    if (!TypeVisitableExt.has_bound_vars(ty, fold_Ty)) {
      return ty;
    }

    const k = ty.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && this.binder === k._0._0) {
      const old_bound = k._1;
      const m = this.mapping.get(old_bound.var);
      let mapped: Ty;
      if (m !== undefined) {
        mapped = GenericArg.expect_ty(m);
      } else {
        // If we didn't find a mapped generic, then make a new one.
        // Allocate a new var idx, and insert a new bound ty.
        const var_ = BoundVar.from_usize(this.still_bound_vars.length);
        this.still_bound_vars.push({ $: "Ty", _0: old_bound.kind });
        mapped = Ty.new_bound(this.tcx, INNERMOST, { var: var_, kind: old_bound.kind });
        this.mapping.set(old_bound.var, mapped);
      }

      return shift_vars(this.tcx, mapped, DebruijnIndex.as_u32(this.binder), fold_Ty);
    } else {
      return fold_Ty.super_fold_with(ty, this);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:300 fold_region
  fold_region(re: Region): Region {
    const k = re.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && this.binder === k._0._0) {
      const old_bound = k._1;
      const m = this.mapping.get(old_bound.var);
      let mapped: Region;
      if (m !== undefined) {
        mapped = GenericArg.expect_region(m);
      } else {
        const var_ = BoundVar.from_usize(this.still_bound_vars.length);
        this.still_bound_vars.push({ $: "Region", _0: old_bound.kind });
        mapped = Region.new_bound(this.tcx, INNERMOST, { var: var_, kind: old_bound.kind });
        this.mapping.set(old_bound.var, mapped);
      }

      return shift_vars(this.tcx, mapped, DebruijnIndex.as_u32(this.binder), fold_Region);
    } else {
      return re;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:324 fold_const
  fold_const(ct: Const): Const {
    if (!TypeVisitableExt.has_bound_vars(ct, fold_Const)) {
      return ct;
    }

    const k = ct.kind();
    if (k.$ === "Bound" && k._0.$ === "Bound" && this.binder === k._0._0) {
      const old_bound = k._1;
      const m = this.mapping.get(old_bound.var);
      let mapped: Const;
      if (m !== undefined) {
        mapped = GenericArg.expect_const(m);
      } else {
        const var_ = BoundVar.from_usize(this.still_bound_vars.length);
        this.still_bound_vars.push({ $: "Const" });
        mapped = ConstC.new_bound(this.tcx, INNERMOST, BoundConst.new(var_));
        this.mapping.set(old_bound.var, mapped);
      }

      return shift_vars(this.tcx, mapped, DebruijnIndex.as_u32(this.binder), fold_Const);
    } else {
      return fold_Const.super_fold_with(ct, this);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:349 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    if (!TypeVisitableExt.has_bound_vars(p, d)) {
      return p;
    } else {
      return d.super_fold_with(p, this);
    }
  }

  // PORT: the provided `fold_clauses` (PORTING §8).
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

/// Opaque types don't inherit bounds from their parent: for return position
/// impl trait it isn't possible to write a suitable predicate on the
/// containing function and for type-alias impl trait we don't have a backwards
/// compatibility issue.
// #[instrument(level = "trace", skip(tcx, item_ty))]
// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:359 opaque_type_bounds
export function opaque_type_bounds(tcx: TyCtxt, opaque_def_id: LocalDefId, hir_bounds: readonly hir.GenericBound[], item_ty: Ty, span: Span, filter: PredicateFilter): readonly [Clause, Span][] {
  return with_reduced_queries(() => {
    const icx = ItemCtxt.new(tcx, opaque_def_id);
    const bounds: [Clause, Span][] = [];
    icx.lowerer().lower_bounds(item_ty, hir_bounds, bounds, RawList.empty(), filter, OverlappingAsssocItemConstraints.Allowed);
    // Implicit bounds are added to opaque types unless a `?Trait` bound is found
    switch (filter.$) {
      case "All":
      case "SelfOnly":
      case "SelfTraitThatDefines":
      case "SelfAndAssociatedTypeBounds":
        icx.lowerer().add_implicit_sizedness_bounds(bounds, item_ty, hir_bounds, ImpliedBoundsContext.AssociatedTypeOrImplTrait, span);
        icx.lowerer().add_default_traits(bounds, item_ty, hir_bounds, ImpliedBoundsContext.AssociatedTypeOrImplTrait, span);
        break;
      //`ConstIfConst` is only interested in `[const]` bounds.
      case "ConstIfConst":
      case "SelfConstIfConst":
        break;
    }
    // debug!(?bounds);

    return bounds;
  });
}

// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:408 explicit_item_bounds
export function explicit_item_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return explicit_item_bounds_with_filter(tcx, def_id, PredicateFilter.All);
}

// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:415 explicit_item_self_bounds
export function explicit_item_self_bounds(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<readonly [Clause, Span][]> {
  return explicit_item_bounds_with_filter(tcx, def_id, PredicateFilter.SelfOnly);
}

// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:422 explicit_item_bounds_with_filter
export function explicit_item_bounds_with_filter(tcx: TyCtxt, def_id: LocalDefId, filter: PredicateFilter): EarlyBinder<readonly [Clause, Span][]> {
  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id));
  if (rpitit !== undefined) {
    switch (rpitit.$) {
      // RPITIT's bounds are the same as opaque type bounds, but with
      // a projection self type.
      case "Trait": {
        const opaque_ty = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(rpitit.opaque_def_id.expect_local()));
        const bounds = associated_type_bounds(tcx, def_id, opaque_ty.bounds, opaque_ty.span, filter);
        return EarlyBinder.bind_iter(bounds);
      }
      case "Impl":
        return span_bug(tcx.def_span(def_id), "RPITIT in impl should not have item bounds");
    }
  }

  let bounds: readonly [Clause, Span][];
  const node = tcx.hir_node_by_def_id(def_id);
  if (node.$ === "TraitItem" && node._0.kind.$ === "Type") {
    const bounds_ = node._0.kind._0;
    const span = node._0.span;
    bounds = associated_type_bounds(tcx, def_id, bounds_, span, filter);
  } else if (node.$ === "OpaqueTy") {
    const { bounds: bounds_, origin, span } = node._0;
    if ((origin.$ === "FnReturn" || origin.$ === "AsyncFn") && origin.in_trait_or_impl === "Trait") {
      // Since RPITITs are lowered as projections in `<dyn HirTyLowerer>::lower_ty`,
      // when we're asking for the item bounds of the *opaques* in a trait's default
      // method signature, we need to map these projections back to opaques.
      const parent = origin.parent;
      const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
      const item_ty = Ty.new_opaque(tcx, IsRigid.No, LocalDefId.to_def_id(def_id), args);
      const folder = new AssocTyToOpaque(tcx, LocalDefId.to_def_id(parent));
      // PORT: `Vec<(Clause, Span)>::fold_with` folds each tuple in order (the `Span` fold is the identity).
      const bounds_folded: readonly [Clause, Span][] = [...opaque_type_bounds(tcx, def_id, bounds_, item_ty, span, filter)].map(([c, s]): [Clause, Span] => [fold_with_Clause(c, folder), s]);
      assert_only_contains_clauses_from(filter, bounds_folded, item_ty);
      bounds = bounds_folded;
    } else {
      // FnReturn / AsyncFn with `in_trait_or_impl: None | Some(RpitContext::TraitImpl)`, TyAlias
      const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
      const item_ty = Ty.new_opaque(tcx, IsRigid.No, LocalDefId.to_def_id(def_id), args);
      const bounds_ = opaque_type_bounds(tcx, def_id, node._0.bounds, item_ty, span, filter);
      assert_only_contains_clauses_from(filter, bounds_, item_ty);
      bounds = bounds_;
    }
  } else if (node.$ === "Item" && node._0.kind.$ === "TyAlias") {
    bounds = [];
  } else {
    return bug(`item_bounds called on ${debug_LocalDefId(def_id, PLAIN)} => ${hir.debug_Node(node, PLAIN)}`);
  }

  return EarlyBinder.bind_iter(bounds);
}

// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:493 item_bounds
export function item_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses> {
  return EarlyBinder.map_bound(tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>, (bounds) =>
    tcx.mk_clauses_from_iter(elaborate(tcx, bounds.map(([bound, _span]) => bound), Elaboratable_Clause)),
  );
}

// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:499 item_self_bounds
export function item_self_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses> {
  return EarlyBinder.map_bound(tcx.explicit_item_self_bounds(def_id) as EarlyBinder<readonly [Clause, Span][]>, (bounds) =>
    tcx.mk_clauses_from_iter(elaborate(tcx, bounds.map(([bound, _span]) => bound), Elaboratable_Clause).filter_only_self()),
  );
}

/// This exists as an optimization to compute only the item bounds of the item
/// that are not `Self` bounds.
// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:512 item_non_self_bounds
export function item_non_self_bounds(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses> {
  const all_bounds = new Set<Clause>(EarlyBinder.skip_binder(tcx.item_bounds(def_id) as EarlyBinder<Clauses>));
  const own_bounds = new Set<Clause>(EarlyBinder.skip_binder(tcx.item_self_bounds(def_id) as EarlyBinder<Clauses>));
  if (all_bounds.size === own_bounds.size) {
    return EarlyBinder.bind(tcx, RawList.empty_with_type_info<Clause>(), fold_Clauses);
  } else {
    return EarlyBinder.bind(tcx, tcx.mk_clauses_from_iter([...all_bounds].filter((c) => !own_bounds.has(c))), fold_Clauses);
  }
}

/// This exists as an optimization to compute only the supertraits of this impl's
/// trait that are outlives bounds.
// rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:530 impl_super_outlives
export function impl_super_outlives(tcx: TyCtxt, def_id: DefId): EarlyBinder<Clauses> {
  return EarlyBinder.map_bound((tcx.impl_trait_header(def_id) as ImplTraitHeader).trait_ref, (trait_ref) => {
    const clause: Clause = Clause_upcast_from_TraitRef(trait_ref, tcx);
    return tcx.mk_clauses_from_iter(
      [...elaborate(tcx, [clause], Elaboratable_Clause)].filter((clause) => {
        const k = Binder.skip_binder(clause.kind());
        return k.$ === "TypeOutlives" || k.$ === "RegionOutlives";
      }),
    );
  });
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:545 AssocTyToOpaque
export class AssocTyToOpaque implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public fn_def_id: DefId,
  ) {}

  // ---- impl<'tcx> TypeFolder<TyCtxt<'tcx>> for AssocTyToOpaque<'tcx> ----

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:551 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/item_bounds.rs:555 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const projection_ty_def_id = k._1.kind.def_id;
      const args = k._1.args;
      const info = this.tcx.opt_rpitit_info(projection_ty_def_id);
      if (info !== undefined && info.$ === "Trait" && DefId_eq(info.fn_def_id, this.fn_def_id)) {
        return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(projection_ty_def_id) as EarlyBinder<Ty>, this.tcx, args, fold_Ty));
      }
    }
    return fold_Ty.super_fold_with(ty, this);
  }

  // PORT: the provided `TypeFolder` methods (PORTING §8).
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}
