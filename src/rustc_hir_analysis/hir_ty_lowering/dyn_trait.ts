// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs (lane hir-ty-lowering-c).
//
// The `impl dyn HirTyLowerer` methods of this file are assigned onto `HirTyLowerer.prototype` (decls.ts) in upstream order.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
//
// rustc_trait_selection's error-reporting items called here (`error_reporting::traits::report_dyn_incompatibility`,
// `diagnostics::AssocTypeWithSameName`, `NextTypeParamName::next_type_param_name`) are the ported ones (merge-w19).
import { expand_trait_aliases } from "../../rustc_trait_selection/traits/util.ts";
import { object_region_bounds } from "../../rustc_trait_selection/traits/wf.ts";
import { HirTyLowerer } from "../decls.ts";
// PORT: init order: rustc_middle is loaded through its crate root before the ty/print modules below are imported directly
// (importing ty/print/mod.ts first in a fresh process hits a TDZ inside rustc_middle).
import "../../rustc_middle/lib.ts";
import type { TraitObjectSyntax } from "../../rustc_ast/lib.ts";
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, E0582, E0782, type Level, struct_span_code_err } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { BARE_TRAIT_OBJECTS, UNUSED_ASSOCIATED_TYPE_BOUNDS } from "../../rustc_lint_defs/builtin.gen.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Region } from "../../rustc_middle/ty/decls.ts";
import { BottomUpFolder } from "../../rustc_middle/ty/fold.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { GenericParamDef, type Generics } from "../../rustc_middle/ty/generics.ts";
import type { List } from "../../rustc_middle/ty/list.ts";
import { debug_Ty, fold_Term, Term, Ty } from "../../rustc_middle/ty/mod.ts";
import { type Clause, Clause_upcast_from_TraitRef, ExistentialPredicate_stable_cmp } from "../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, IrPrint_print_debug } from "../../rustc_middle/ty/print/mod.ts";
import { print_Binder, print_Term } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Span } from "../../rustc_middle/ty/structural_impls.ts";
import { type DefId, DefId_eq, DefIdSet } from "../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { display_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import type {
  ExistentialPredicate,
  PolyExistentialPredicate,
  PolyProjectionClause,
  PolyTraitClause,
  ProjectionClause,
  TraitClause,
  TraitRef as TraitRefT,
} from "../../rustc_type_ir/decls.ts";
import { Binder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import {
  type ClausePolarity,
  debug_ClausePolarity,
  fold_with_ExistentialPredicate,
  fold_with_ProjectionClause,
  fold_with_TraitClause,
  fold_with_TraitRef,
  try_fold_with_ExistentialPredicate,
  try_fold_with_ProjectionClause,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_ExistentialPredicate,
  visit_with_ProjectionClause,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../../rustc_type_ir/predicate.gen.ts";
import { Edition } from "../../rustc_span/edition.ts";
import type { GenericParamDefKind as GenericParamDefKindT } from "../../rustc_middle/ty/generics.ts";
import { ClauseWithSupertraitSpan, elaborate, Elaboratable_ClauseWithSupertraitSpan } from "../../rustc_type_ir/elaborate.ts";
import { fold_tuple2, fold_Vec, type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { display_Binder } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, ExistentialProjection, ExistentialTraitRef, PolyProjectionClause as PolyProjectionClauseC, PolyTraitClause as PolyTraitClauseC, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { relate_AliasTerm } from "../../rustc_type_ir/relate.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedMap, KeyedSet } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_eq, unported, unwrap } from "../../std/panic.ts";
import {
  AmbiguousLifetimeBound_diagnostic,
  DynTraitAssocItemBindingMentionsSelf_diagnostic,
  UnusedAssociatedTypeBounds_diagnostic,
} from "../diagnostics.gen.ts";
import type { ImpliedBoundsContext, OverlappingAsssocItemConstraints, PredicateFilter, RegionInferReason } from "./mod.gen.ts";
import { report_dyn_incompatibility } from "../../rustc_trait_selection/error_reporting/traits/mod.ts";
import { next_type_param_name } from "../../rustc_trait_selection/error_reporting/traits/suggestions.ts";
import { AssocTypeWithSameName_subdiagnostic } from "../../rustc_trait_selection/diagnostics.gen.ts";

/** PORT: D4 descriptors of the generated `TypeFoldable` impls used below. */
const d_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
const d_ExistentialPredicate: TypeFoldable<ExistentialPredicate> = {
  visit_with: visit_with_ExistentialPredicate,
  try_fold_with: try_fold_with_ExistentialPredicate,
  fold_with: fold_with_ExistentialPredicate,
};

const d_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
const fold_Binder_TraitClause = (): TypeFoldable<Binder<TraitClause>> => fold_Binder(d_TraitClause);

/** `Iterator::any` over a `next()`-style iterator (`TypeWalker`). */
function iter_any<T>(it: { next(): T | undefined }, f: (x: T) => boolean): boolean {
  let x: T | undefined;
  while ((x = it.next()) !== undefined) {
    if (f(x)) return true;
  }
  return false;
}

/** `Ordering` as a comparator result for `Array.prototype.sort`. */
function ordering_to_number(o: "Less" | "Equal" | "Greater"): number {
  return o === "Less" ? -1 : o === "Greater" ? 1 : 0;
}

/** PORT: `impl fmt::Display for Binder<Term>` (`I: IrPrint<Binder<Term>>`, served by `TyCtxt`'s blanket `IrPrint` over
 *  the `Print` impl of `Binder<T>`). */
function display_Binder_Term(self: Binder<Term>): string {
  const print = (t: Binder<Term>, p: Parameters<typeof print_Term>[1]) => print_Binder(t, p, print_Term, fold_Term);
  return display_Binder(self, {
    print: (t, fmt) => IrPrint_print(t, fmt, print),
    print_debug: (t, fmt) => IrPrint_print_debug(t, fmt, print),
  });
}

// ---- impl<'tcx> dyn HirTyLowerer<'tcx> + '_ (dyn_trait.rs:31) ----

/// Lower a trait object type from the HIR to our internal notion of a type.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:34 lower_trait_object_ty
HirTyLowerer.prototype.lower_trait_object_ty = function (
  this: HirTyLowerer,
  span: Span,
  hir_id: hir.HirId,
  hir_bounds: readonly hir.PolyTraitRef[],
  lifetime: hir.Lifetime,
  syntax: TraitObjectSyntax,
): Ty {
  const tcx = this.tcx();
  const dummy_self = tcx.types.trait_object_dummy_self;

  switch (syntax) {
    case "Dyn":
      break;
    case "None": {
      const guar = this.prohibit_or_lint_bare_trait_object_ty(span, hir_id, hir_bounds);
      // Don't continue with type analysis if the `dyn` keyword is missing.
      // It generates confusing errors, especially if the user meant to use
      // another keyword like `impl`.
      if (guar !== undefined) return Ty.new_error(tcx, guar);
      break;
    }
  }

  const user_written_bounds: [Clause, Span][] = [];
  const potential_assoc_items: number[] = [];
  for (const poly_trait_ref of hir_bounds) {
    // FIXME(mgca): We actually leak `trait_object_dummy_self` if the type of any assoc
    //              const mentions `Self` (in "Self projections" which we intentionally
    //              allow). That's because we query feed the instantiated type to `type_of`.
    //              That's really bad, dummy self should never escape lowering! It leads us
    //              to accept less code we'd like to support and can lead to ICEs later.
    const result = this.lower_poly_trait_ref(
      poly_trait_ref,
      dummy_self,
      user_written_bounds,
      { $: "SelfOnly" } satisfies PredicateFilter,
      "Forbidden" satisfies OverlappingAsssocItemConstraints,
    );
    if (result.correct.$ === "Err") {
      potential_assoc_items.push(...result.correct._0.invalid_args);
    }
  }

  this.add_default_traits(
    user_written_bounds,
    dummy_self,
    hir_bounds.map((trait_ref): hir.GenericBound => ({ $: "Trait", _0: trait_ref })),
    { $: "AssociatedTypeOrImplTrait" } satisfies ImpliedBoundsContext,
    span,
  );

  const [elaborated_trait_bounds_, elaborated_projection_bounds]: [[PolyTraitClause, Span[]][], [PolyProjectionClause, Span][]] = expand_trait_aliases(
    tcx,
    user_written_bounds,
  );
  let elaborated_trait_bounds = elaborated_trait_bounds_;

  // FIXME(sized-hierarchy): https://github.com/rust-lang/rust/pull/142712#issuecomment-3013231794
  // debug!(?user_written_bounds, ?elaborated_trait_bounds);
  const meta_sized_did = tcx.require_lang_item("MetaSized", span);
  // Don't strip out `MetaSized` when the user wrote it explicitly, only when it was
  // elaborated
  if (
    user_written_bounds.every(([clause]) => {
      const p = clause.as_trait_clause();
      return !(p !== undefined && DefId_eq(PolyTraitClauseC.def_id(p), meta_sized_did));
    })
  ) {
    elaborated_trait_bounds = elaborated_trait_bounds.filter(([pred]) => !DefId_eq(PolyTraitClauseC.def_id(pred), meta_sized_did));
  }
  // debug!(?user_written_bounds, ?elaborated_trait_bounds);

  const regular_traits: [PolyTraitClause, Span[]][] = [];
  let auto_traits: [PolyTraitClause, Span[]][] = [];
  for (const b of elaborated_trait_bounds) {
    (!tcx.trait_is_auto(PolyTraitClauseC.def_id(b[0])) ? regular_traits : auto_traits).push(b);
  }

  // We don't support empty trait objects.
  if (regular_traits.length === 0 && auto_traits.length === 0) {
    const guar = this.report_trait_object_with_no_traits(span, user_written_bounds.slice());
    return Ty.new_error(tcx, guar);
  }
  // We don't support >1 principal
  if (regular_traits.length > 1) {
    const guar = this.report_trait_object_addition_traits(regular_traits);
    return Ty.new_error(tcx, guar);
  }
  // Don't create a dyn trait if we have errors in the principal.
  const reported = TypeVisitableExt.error_reported(regular_traits, fold_Vec(fold_tuple2(fold_Binder_TraitClause(), fold_Vec(fold_Span))));
  if (reported.$ === "Err") {
    return Ty.new_error(tcx, reported._0);
  }

  // Check that there are no gross dyn-compatibility violations;
  // most importantly, that the supertraits don't contain `Self`,
  // to avoid ICEs.
  for (const [clause, span] of user_written_bounds) {
    const trait_pred = clause.as_trait_clause();
    if (trait_pred !== undefined) {
      const violations = this.dyn_compatibility_violations(PolyTraitClauseC.def_id(trait_pred));
      if (violations.length !== 0) {
        const reported: ErrorGuaranteed = report_dyn_incompatibility(tcx, span, hir_id, PolyTraitClauseC.def_id(trait_pred), violations).emit_err();
        return Ty.new_error(tcx, reported);
      }
    }
  }

  // Map the projection bounds onto a key that makes it easy to remove redundant
  // bounds that are constrained by supertraits of the principal trait.
  //
  // Also make sure we detect conflicting bounds from expanding trait aliases.
  //
  // FIXME(#150936): Since the elaborated projection bounds also include the user-written ones
  //                 and we're separately rejecting duplicate+conflicting bindings for trait
  //                 object types when lowering assoc item bindings, there are basic cases
  //                 where we're emitting two distinct but very similar diagnostics.
  // PORT: `FxIndexMap<(DefId, PolyTraitRef), (PolyProjectionClause, Span)>` is a `KeyedMap` on the derived `Hash`+`Eq`
  // of the key (`intern_key`).
  const projection_bounds = new KeyedMap<[DefId, Binder<TraitRefT>], [PolyProjectionClause, Span]>(intern_key);
  for (const [proj_, proj_span] of elaborated_projection_bounds) {
    const item_def_id = PolyProjectionClauseC.item_def_id(proj_);

    const proj = Binder.map_bound(proj_, (proj__: ProjectionClause): ProjectionClause => {
      const proj = { ...proj__ };
      const references_self = iter_any(Term.walk(proj.term), (arg) => arg === GenericArg.from_Ty(dummy_self));
      if (references_self) {
        const guar = this.dcx().emit_err(
          DynTraitAssocItemBindingMentionsSelf_diagnostic({
            span,
            kind: tcx.def_descr(item_def_id),
            binding: proj_span,
          }),
        );
        proj.term = replace_dummy_self_with_error(tcx, proj.term, guar, fold_Term);
      }
      return proj;
    });

    const key: [DefId, Binder<TraitRefT>] = [
      item_def_id,
      tcx.anonymize_bound_vars(
        Binder.map_bound(proj, (proj) => AliasTerm.trait_ref(proj.projection_term, as_interner(tcx))),
        d_TraitRef,
      ),
    ];
    // `projection_bounds.insert(key, (proj, proj_span))`
    const old = projection_bounds.get(key);
    projection_bounds.set(key, [proj, proj_span]);
    if (old !== undefined && intern_key(tcx.anonymize_bound_vars(proj, d_ProjectionClause)) !== intern_key(tcx.anonymize_bound_vars(old[0], d_ProjectionClause))) {
      const [old_proj, old_proj_span] = old;
      const kind = tcx.def_descr(item_def_id);
      const name = tcx.item_name(item_def_id);
      this.dcx()
        .struct_span_err(span, `conflicting ${kind} bindings for \`${display_Symbol(name)}\``)
        .with_span_label(old_proj_span, `\`${display_Symbol(name)}\` is specified to be \`${display_Binder_Term(PolyProjectionClauseC.term(old_proj))}\` here`)
        .with_span_label(proj_span, `\`${display_Symbol(name)}\` is specified to be \`${display_Binder_Term(PolyProjectionClauseC.term(proj))}\` here`)
        .emit();
    }
  }

  const principal_trait: [PolyTraitClause, Span[]] | undefined = regular_traits[0];

  // A stable ordering of associated types & consts from the principal trait and all its
  // supertraits. We use this to ensure that different substitutions of a trait don't
  // result in `dyn Trait` types with different projections lists, which can be unsound:
  // <https://github.com/rust-lang/rust/pull/136458>.
  // We achieve a stable ordering by walking over the unsubstituted principal trait ref.
  const ordered_associated_items: [DefId, Binder<TraitRefT>][] = [];

  if (principal_trait !== undefined) {
    const spans = principal_trait[1];
    const principal_trait_ = Binder.map_bound(principal_trait[0], (trait_pred) => {
      assert_eq(trait_pred.polarity, "Positive" as ClausePolarity, (v) => debug_ClausePolarity(v, PLAIN));
      return trait_pred.trait_ref;
    });

    for (const { clause: clause_, supertrait_span } of elaborate(
      tcx,
      [ClauseWithSupertraitSpan.new(Clause_upcast_from_TraitRef(TraitRef.identity(tcx, Binder.skip_binder(principal_trait_).def_id), tcx), unwrap(spans[spans.length - 1]))],
      Elaboratable_ClauseWithSupertraitSpan,
    ).filter_only_self()) {
      const clause = clause_.instantiate_supertrait(tcx, principal_trait_);
      // debug!("observing object predicate `{clause:?}`");

      const bound_predicate = clause.kind();
      const sk = Binder.skip_binder(bound_predicate);
      if (sk.$ === "Trait") {
        const pred = sk._0;
        // FIXME(negative_bounds): Handle this correctly...
        const trait_ref = tcx.anonymize_bound_vars(Binder.rebind(bound_predicate, pred.trait_ref), d_TraitRef);
        for (const item of AssocItems.in_definition_order(tcx.associated_items(pred.trait_ref.def_id) as AssocItems)) {
          if (!AssocItem.can_have_equality_constraint(item, tcx)) continue;
          // Traits with RPITITs are simply not dyn compatible (for now).
          if (AssocItem.is_impl_trait_in_trait(item)) continue;
          ordered_associated_items.push([item.def_id, trait_ref]);
        }
      } else if (sk.$ === "Projection") {
        const pred = Binder.rebind(bound_predicate, sk._0);
        // A `Self` within the original bound will be instantiated with a
        // `trait_object_dummy_self`, so check for that.
        const references_self = iter_any(Term.walk(Binder.skip_binder(pred).term), (arg) => arg === GenericArg.from_Ty(dummy_self));

        // If the projection output contains `Self`, force the user to
        // elaborate it explicitly to avoid a lot of complexity.
        //
        // The "classically useful" case is the following:
        // ```
        //     trait MyTrait: FnMut() -> <Self as MyTrait>::MyOutput {
        //         type MyOutput;
        //     }
        // ```
        //
        // Here, the user could theoretically write `dyn MyTrait<MyOutput = X>`,
        // but actually supporting that would "expand" to an infinitely-long type
        // `fix $ τ → dyn MyTrait<MyOutput = X, Output = <τ as MyTrait>::MyOutput`.
        //
        // Instead, we force the user to write
        // `dyn MyTrait<MyOutput = X, Output = X>`, which is uglier but works. See
        // the discussion in #56288 for alternatives.
        if (!references_self) {
          const key: [DefId, Binder<TraitRefT>] = [
            PolyProjectionClauseC.item_def_id(pred),
            tcx.anonymize_bound_vars(
              Binder.map_bound(pred, (proj) => AliasTerm.trait_ref(proj.projection_term, as_interner(tcx))),
              d_TraitRef,
            ),
          ];
          if (!projection_bounds.has(key)) {
            projection_bounds.set(key, [pred, supertrait_span]);
          }
        }

        this.check_elaborated_projection_mentions_input_lifetimes(pred, unwrap(spans[0]), supertrait_span);
      } else {
        // _ => (),
      }
    }
  }

  // Flag assoc item bindings that didn't really need to be specified.
  for (const [projection_bound, span] of projection_bounds.values()) {
    const def_id = PolyProjectionClauseC.item_def_id(projection_bound);
    if (tcx.generics_require_sized_self(def_id) as boolean) {
      // FIXME(mgca): Ideally we would generalize the name of this lint to sth. like
      // `unused_associated_item_bindings` since this can now also trigger on *const*
      // projections / assoc *const* bindings.
      tcx.emit_node_span_lint(UNUSED_ASSOCIATED_TYPE_BOUNDS, hir_id, span, UnusedAssociatedTypeBounds_diagnostic({ span }));
    }
  }

  // The user has to constrain all associated types & consts via bindings unless the
  // corresponding associated item has a `where Self: Sized` clause. This can be done
  // in the `dyn Trait` directly, in the supertrait bounds or behind trait aliases.
  //
  // Collect all associated items that weren't specified and compute the list of
  // projection bounds which we'll later turn into existential ones.
  //
  // We intentionally keep around projections whose associated item has a `Self: Sized`
  // bound in order to be able to wfcheck the RHS, allow the RHS to constrain generic
  // parameters and to imply bounds.
  // See also <https://github.com/rust-lang/rust/pull/140684>.
  const missing_assoc_items = new KeyedSet<[DefId, Binder<TraitRefT>]>(intern_key);
  const projection_bounds_: [PolyProjectionClause, Span][] = [];
  for (const key of ordered_associated_items) {
    const def_id = key[0];
    const assoc = projection_bounds.get(key);
    if (assoc !== undefined) {
      projection_bounds_.push(assoc);
      continue;
    }
    if (!(tcx.generics_require_sized_self(def_id) as boolean)) {
      missing_assoc_items.add(key);
    }
  }

  // If there are any associated items whose value wasn't provided, bail out with an error.
  const r = this.check_for_required_assoc_items(
    principal_trait === undefined ? [] : principal_trait[1].slice(),
    missing_assoc_items,
    potential_assoc_items,
    hir_bounds,
  );
  if (r.$ === "Err") {
    return Ty.new_error(tcx, r._0);
  }

  // De-duplicate auto traits so that, e.g., `dyn Trait + Send + Send` is the same as
  // `dyn Trait + Send`.
  // We remove duplicates by inserting into a `FxHashSet` to avoid re-ordering
  // the bounds
  const duplicates = new DefIdSet();
  auto_traits = auto_traits.filter(([trait_pred]) => {
    const did = PolyTraitClauseC.def_id(trait_pred);
    if (duplicates.has(did)) return false;
    duplicates.add(did);
    return true;
  });

  // debug!(?principal_trait);
  // debug!(?auto_traits);

  // Erase the `dummy_self` (`trait_object_dummy_self`) used above.
  const principal_trait_ref: Binder<ExistentialPredicate> | undefined =
    principal_trait === undefined
      ? undefined
      : Binder.map_bound(principal_trait[0], (trait_pred): ExistentialPredicate => {
          const spans = principal_trait[1];
          const trait_ref = trait_pred.trait_ref;
          assert_eq(trait_pred.polarity, "Positive" as ClausePolarity, (v) => debug_ClausePolarity(v, PLAIN));
          assert_eq(TraitRef.self_ty(trait_ref), dummy_self, (v) => debug_Ty(v, PLAIN));

          const span = unwrap(spans[0]);

          // Verify that `dummy_self` did not leak inside generic parameter defaults. This
          // could not be done at path creation, since we need to see through trait aliases.
          const missing_generic_params: [Symbol, GenericParamDefKindT][] = [];
          const generics = tcx.generics_of(trait_ref.def_id) as Generics;
          const args: GenericArg[] = [];
          // Skip `Self`
          for (let index = 1; index < trait_ref.args.length; index++) {
            const arg = trait_ref.args[index]!;
            if (iter_any(GenericArg.walk(arg), (arg) => arg === GenericArg.from_Ty(dummy_self))) {
              const param = generics.own_params[index]!;
              missing_generic_params.push([param.name, { ...param.kind }]);
              args.push(GenericParamDef.to_error(param, tcx));
            } else {
              args.push(arg);
            }
          }

          const empty_generic_args = hir_bounds.some(
            (hir_bound) =>
              hir_bound.trait_ref.path.res.$ === "Def" &&
              hir_bound.trait_ref.path.res._0.$ === "Trait" &&
              DefId_eq(hir_bound.trait_ref.path.res._1, trait_ref.def_id) &&
              Span.contains(hir_bound.span, span),
          );
          this.report_missing_generic_params(missing_generic_params, trait_ref.def_id, span, empty_generic_args);

          return { $: "Trait", _0: ExistentialTraitRef.new(as_interner(tcx), trait_ref.def_id, args) };
        });

  const existential_projections: Binder<ExistentialPredicate>[] = projection_bounds_.map(([bound]) =>
    Binder.map_bound(bound, (b_: ProjectionClause): ExistentialPredicate => {
      const b = { ...b_ };
      assert_eq(AliasTerm.self_ty(b.projection_term), dummy_self, (v) => debug_Ty(v, PLAIN));

      // Like for trait refs, verify that `dummy_self` did not leak inside default type
      // parameters.
      const references_self = b.projection_term.args.slice(1).some((arg) => iter_any(GenericArg.walk(arg), (arg) => arg === GenericArg.from_Ty(dummy_self)));
      if (references_self) {
        const guar = tcx.dcx().span_delayed_bug(span, "trait object projection bounds reference `Self`");
        b.projection_term = replace_dummy_self_with_error(tcx, b.projection_term, guar, relate_AliasTerm);
      }

      return { $: "Projection", _0: ExistentialProjection.erase_self_ty(as_interner(tcx), b) };
    }),
  );

  const auto_trait_predicates: Binder<ExistentialPredicate>[] = auto_traits.map(([trait_pred]) => {
    assert_eq(PolyTraitClauseC.polarity(trait_pred), "Positive" as ClausePolarity, (v) => debug_ClausePolarity(v, PLAIN));
    assert_eq(Binder.skip_binder(PolyTraitClauseC.self_ty(trait_pred)), dummy_self, (v) => debug_Ty(v, PLAIN));

    return Binder.dummy<ExistentialPredicate>({ $: "AutoTrait", _0: PolyTraitClauseC.def_id(trait_pred) }, d_ExistentialPredicate);
  });
  // auto_trait_predicates.dedup();
  const auto_trait_predicates_ = auto_trait_predicates.filter((p, i) => i === 0 || intern_key(p) !== intern_key(auto_trait_predicates[i - 1]));

  // N.b. principal, projections, auto traits
  // FIXME: This is actually wrong with multiple principals in regards to symbol mangling
  const predicates_: Binder<ExistentialPredicate>[] = [
    ...(principal_trait_ref !== undefined ? [principal_trait_ref] : []),
    ...existential_projections,
    ...auto_trait_predicates_,
  ];
  // PORT: `sort_by` is a stable sort, as `Array.prototype.sort`.
  predicates_.sort((a, b) => ordering_to_number(ExistentialPredicate_stable_cmp(Binder.skip_binder(a), tcx, Binder.skip_binder(b))));
  const predicates = tcx.mk_poly_existential_predicates(predicates_);

  const region_bound = this.lower_trait_object_lifetime(lifetime, predicates, span);

  return Ty.new_dynamic(tcx, predicates, region_bound);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:447 lower_trait_object_lifetime
HirTyLowerer.prototype.lower_trait_object_lifetime = function (
  this: HirTyLowerer,
  lifetime: hir.Lifetime,
  predicates: List<PolyExistentialPredicate>,
  span: Span,
): Region {
  // Curiously, we also use the *object region bound* for `Infer` (`'_`)
  // while we obviously don't use the *object lifetime default* for it...
  if (lifetime.kind.$ === "ImplicitObjectLifetimeDefault" || lifetime.kind.$ === "Infer") {
    const region = this.compute_object_lifetime_bound(span, predicates);
    if (region !== undefined) {
      return region;
    }
  }

  const reason: RegionInferReason =
    lifetime.kind.$ === "ImplicitObjectLifetimeDefault" ? { $: "ObjectLifetimeDefault", _0: Span.shrink_to_hi(span) } : { $: "ExplicitObjectLifetime" };

  return this.lower_lifetime(lifetime, reason);
};

/// Check that elaborating the principal of a trait ref doesn't lead to projections
/// that are unconstrained. This can happen because an otherwise unconstrained
/// *type variable* can be substituted with a type that has late-bound regions. See
/// `elaborated-predicates-unconstrained-late-bound.rs` for a test.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:475 check_elaborated_projection_mentions_input_lifetimes
HirTyLowerer.prototype.check_elaborated_projection_mentions_input_lifetimes = function (
  this: HirTyLowerer,
  pred: PolyProjectionClause,
  span: Span,
  supertrait_span: Span,
): void {
  const tcx = this.tcx();

  // Find any late-bound regions declared in `ty` that are not
  // declared in the trait-ref or assoc_item. These are not well-formed.
  //
  // Example:
  //
  //     for<'a> <T as Iterator>::Item = &'a str // <-- 'a is bad
  //     for<'a> <T as FnMut<(&'a u32,)>>::Output = &'a str // <-- 'a is ok
  const late_bound_in_projection_term = tcx.collect_constrained_late_bound_regions(
    Binder.map_bound(pred, (pred) => pred.projection_term),
    relate_AliasTerm,
  );
  const late_bound_in_term = tcx.collect_referenced_late_bound_regions(
    Binder.map_bound(pred, (pred) => pred.term),
    fold_Term,
  );
  // debug!(?late_bound_in_projection_term);
  // debug!(?late_bound_in_term);

  // FIXME: point at the type params that don't have appropriate lifetimes:
  // struct S1<F: for<'a> Fn(&i32, &i32) -> &'a i32>(F);
  //                         ----  ----     ^^^^^^^
  // NOTE(mgca): This error should be impossible to trigger with assoc const bindings.
  this.validate_late_bound_regions(
    late_bound_in_projection_term,
    late_bound_in_term,
    (br_name: string): Diag => {
      const item_name = tcx.item_name(PolyProjectionClauseC.item_def_id(pred));
      return struct_span_code_err(
        this.dcx(),
        span,
        E0582,
        `binding for associated type \`${display_Symbol(item_name)}\` references ${br_name}, \
which does not appear in the trait input types`,
      ).with_span_label(supertrait_span, "due to this supertrait");
    },
  );
};

/// Given the bounds on an object, determines what single region bound (if any) we can
/// use to summarize this type.
///
/// The basic idea is that we will use the bound the user
/// provided, if they provided one, and otherwise search the supertypes of trait bounds
/// for region bounds. It may be that we can derive no bound at all, in which case
/// we return `None`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:528 compute_object_lifetime_bound
HirTyLowerer.prototype.compute_object_lifetime_bound = function (
  this: HirTyLowerer,
  span: Span,
  existential_predicates: List<PolyExistentialPredicate>,
): Region | undefined {
  const tcx = this.tcx();

  // No explicit region bound specified. Therefore, examine trait
  // bounds and see if we can derive region bounds from those.
  const derived_region_bounds: Region[] = object_region_bounds(tcx, existential_predicates);

  // If there are no derived region bounds, then report back that we
  // can find no region bound. The caller will use the default.
  if (derived_region_bounds.length === 0) {
    return undefined;
  }

  // If any of the derived region bounds are 'static, that is always
  // the best choice.
  if (derived_region_bounds.some((r) => r.is_static())) {
    return tcx.lifetimes.re_static;
  }

  // Determine whether there is exactly one unique region in the set
  // of derived region bounds. If so, use that. Otherwise, report an
  // error.
  const r = derived_region_bounds[0]!;
  if (derived_region_bounds.slice(1).some((r1) => r !== r1)) {
    this.dcx().emit_err(AmbiguousLifetimeBound_diagnostic({ span }));
  }
  return r;
};

/// Prohibit or lint against *bare* trait object types depending on the edition.
///
/// *Bare* trait object types are ones that aren't preceded by the keyword `dyn`.
/// In edition 2021 and onward we emit a hard error for them.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:566 prohibit_or_lint_bare_trait_object_ty
HirTyLowerer.prototype.prohibit_or_lint_bare_trait_object_ty = function (
  this: HirTyLowerer,
  span: Span,
  hir_id: hir.HirId,
  hir_bounds: readonly hir.PolyTraitRef[],
): ErrorGuaranteed | undefined {
  // struct TraitObjectWithoutDyn<'a, 'tcx> { span, hir_id, sugg, this }
  // impl<'a, 'b, 'tcx> Diagnostic<'a> for TraitObjectWithoutDyn<'b, 'tcx>
  const TraitObjectWithoutDyn = (self_: { span: Span; hir_id: hir.HirId; sugg: [Span, string][]; this: HirTyLowerer }): Diagnostic => ({
    // rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:580 into_diag
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const { span, hir_id, sugg, this: this_ } = self_;
      const lint = Diag.new(dcx, level, "trait objects without an explicit `dyn` are deprecated");
      if (Span.can_be_used_for_suggestions(span)) {
        lint.multipart_suggestion("if this is a dyn-compatible trait, use `dyn`", sugg, Applicability.MachineApplicable);
      }
      this_.maybe_suggest_blanket_trait_impl(span, hir_id, lint);
      return lint;
    },
  });

  const tcx = this.tcx();
  const poly_trait_ref = hir_bounds[0];
  if (poly_trait_ref === undefined) return undefined;

  const p = hir.Node.path(tcx.parent_hir_node(hir_id));
  const in_path = p !== undefined && p.$ === "TypeRelative" && hir.HirId_eq(p._0.hir_id, hir_id);
  let needs_bracket = false;
  if (in_path) {
    const s = tcx.sess.source_map().span_to_prev_source(span);
    needs_bracket = !(s.$ === "Ok" && s._0.toString().trimEnd().endsWith("<"));
  }

  const is_global = poly_trait_ref.trait_ref.path.is_global();

  const sugg: [Span, string][] = [[Span.shrink_to_lo(span), `${needs_bracket ? "<" : ""}dyn ${is_global ? "(" : ""}`]];

  if (is_global || needs_bracket) {
    sugg.push([Span.shrink_to_hi(span), `${is_global ? ")" : ""}${needs_bracket ? ">" : ""}`]);
  }

  if (Edition.at_least_rust_2021(Span.edition(span))) {
    const diag = struct_span_code_err(this.dcx(), span, E0782, "expected a type, found a trait");
    if (
      Span.can_be_used_for_suggestions(span) &&
      poly_trait_ref.trait_ref.trait_def_id() !== undefined &&
      !this.maybe_suggest_impl_trait(span, hir_id, hir_bounds, diag) &&
      !this.maybe_suggest_dyn_trait(hir_id, span, sugg, diag)
    ) {
      this.maybe_suggest_add_generic_impl_trait(span, hir_id, diag);
    }
    // Check if the impl trait that we are considering is an impl of a local trait.
    this.maybe_suggest_blanket_trait_impl(span, hir_id, diag);
    this.maybe_suggest_assoc_ty_bound(hir_id, diag);
    this.maybe_suggest_typoed_method(hir_id, poly_trait_ref.trait_ref.trait_def_id(), diag);
    // If there is an associated type with the same name, add the suggestion to this error.
    if (this.tcx().resolutions(null).paths_matching_assoc_types.has(Span.with_parent(span, undefined))) {
      diag.subdiagnostic(AssocTypeWithSameName_subdiagnostic({ span: Span.shrink_to_lo(span) }));
    }
    return diag.emit_err();
  } else {
    tcx.emit_node_span_lint(BARE_TRAIT_OBJECTS, hir_id, span, TraitObjectWithoutDyn({ span, hir_id, sugg, this: this }));
    return undefined;
  }
};

/// For a struct or enum with an invalid bare trait object field, suggest turning
/// it into a generic type bound.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:679 maybe_suggest_add_generic_impl_trait
HirTyLowerer.prototype.maybe_suggest_add_generic_impl_trait = function (this: HirTyLowerer, span: Span, hir_id: hir.HirId, diag: Diag): boolean {
  const tcx = this.tcx();

  const parent_hir_id = tcx.parent_hir_id(hir_id);
  const parent_item = tcx.hir_get_parent_item(hir_id).def_id;

  let generics: hir.Generics;
  const node = tcx.hir_node_by_def_id(parent_item);
  if (node.$ === "Item" && node._0.kind.$ === "Struct") {
    const variant = node._0.kind._2;
    if (!hir.VariantData.fields(variant).some((field) => hir.HirId_eq(field.hir_id, parent_hir_id))) {
      return false;
    }
    generics = node._0.kind._1;
  } else if (node.$ === "Item" && node._0.kind.$ === "Enum") {
    const def = node._0.kind._2;
    if (!def.variants.some((variant) => hir.VariantData.fields(variant.data).some((field) => hir.HirId_eq(field.hir_id, parent_hir_id)))) {
      return false;
    }
    generics = node._0.kind._1;
  } else {
    return false;
  }

  const rendered_ty_ = tcx.sess.source_map().span_to_snippet(span);
  if (rendered_ty_.$ !== "Ok") {
    return false;
  }
  const rendered_ty = rendered_ty_._0.toString();

  // `"TUV".chars().map(|c| c.to_string()).chain((0..).map(|i| format!("P{i}"))).find(..)`
  const is_free = (s: string): boolean => !generics.params.some((param) => Symbol.as_str(hir.ParamName.ident(param.name).name) === s);
  let param: string | undefined;
  for (const c of ["T", "U", "V"]) {
    if (is_free(c)) {
      param = c;
      break;
    }
  }
  for (let i = 0; param === undefined; i++) {
    if (is_free(`P${i}`)) param = `P${i}`;
  }
  const sugg: [Span, string][] = [[span, param]];
  const insertion_span = generics.span_for_param_suggestion();
  if (insertion_span !== undefined) {
    sugg.push([insertion_span, `, ${param}: ${rendered_ty}`]);
  } else {
    sugg.push([generics.where_clause_span, `<${param}: ${rendered_ty}>`]);
  }
  diag.multipart_suggestion("you might be missing a type parameter", sugg, Applicability.MachineApplicable);
  return true;
};

/// Make sure that we are in the condition to suggest the blanket implementation.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:739 maybe_suggest_blanket_trait_impl
HirTyLowerer.prototype.maybe_suggest_blanket_trait_impl = function (this: HirTyLowerer, span: Span, hir_id: hir.HirId, diag: Diag): void {
  const tcx = this.tcx();
  const parent_id = tcx.hir_get_parent_item(hir_id).def_id;
  const node = tcx.hir_node_by_def_id(parent_id);
  if (node.$ === "Item" && node._0.kind.$ === "Impl" && hir.HirId_eq(hir_id, node._0.kind._0.self_ty.hir_id)) {
    const { self_ty: impl_self_ty, of_trait, generics } = node._0.kind._0;
    if (of_trait === undefined) {
      diag.span_suggestion_verbose(
        Span.shrink_to_hi(impl_self_ty.span),
        "you might have intended to implement this trait for a given type",
        ` for /* Type */`,
        Applicability.HasPlaceholders,
      );
      return;
    }
    const of_trait_def_id = of_trait.trait_ref.trait_def_id();
    if (!(of_trait_def_id !== undefined && of_trait_def_id.is_local())) {
      return;
    }
    const of_trait_span = of_trait.trait_ref.path.span;
    // make sure that we are not calling unwrap to abort during the compilation
    const of_trait_name_ = tcx.sess.source_map().span_to_snippet(of_trait_span);
    if (of_trait_name_.$ !== "Ok") {
      return;
    }
    const of_trait_name = of_trait_name_._0.toString();

    const impl_trait_name_ = this.tcx().sess.source_map().span_to_snippet(span);
    if (impl_trait_name_.$ !== "Ok") {
      return;
    }
    const impl_trait_name = impl_trait_name_._0.toString();
    const sugg = this.add_generic_param_suggestion(generics, span, impl_trait_name);
    diag.multipart_suggestion(
      `alternatively use a blanket implementation to implement \`${of_trait_name}\` for \
all types that also implement \`${impl_trait_name}\``,
      sugg,
      Applicability.MaybeIncorrect,
    );
  }
};

/// Try our best to approximate when adding `dyn` would be helpful for a bare
/// trait object.
///
/// Right now, this is if the type is either directly nested in another ty,
/// or if it's in the tail field within a struct. This approximates what the
/// user would've gotten on edition 2015, except for the case where we have
/// an *obvious* knock-on `Sized` error.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:793 maybe_suggest_dyn_trait
HirTyLowerer.prototype.maybe_suggest_dyn_trait = function (this: HirTyLowerer, hir_id: hir.HirId, span: Span, sugg: [Span, string][], diag: Diag): boolean {
  const tcx = this.tcx();
  if (Span.in_derive_expansion(span)) {
    return false;
  }

  // Look at the direct HIR parent, since we care about the relationship between
  // the type and the thing that directly encloses it.
  const node = tcx.parent_hir_node(hir_id);
  switch (node.$) {
    // These are all generally ok. Namely, when a trait object is nested
    // into another expression or ty, it's either very certain that they
    // missed the ty (e.g. `&Trait`) or it's not really possible to tell
    // what their intention is, so let's not give confusing suggestions and
    // just mention `dyn`. The user can make up their mind what to do here.
    case "Ty":
    case "Expr":
    case "PatExpr":
    case "PathSegment":
    case "AssocItemConstraint":
    case "TraitRef":
    case "Item":
    case "WherePredicate":
      break;

    case "Field": {
      const field = node._0;
      // Enums can't have unsized fields, fields can only have an unsized tail field.
      const p = tcx.parent_hir_node(field.hir_id);
      let tail_field;
      if (
        p.$ === "Item" &&
        p._0.kind.$ === "Struct" &&
        (tail_field = hir.VariantData.fields(p._0.kind._2)[hir.VariantData.fields(p._0.kind._2).length - 1]) !== undefined &&
        hir.HirId_eq(tail_field.hir_id, field.hir_id)
      ) {
        // Ok
      } else {
        return false;
      }
      break;
    }
    default:
      return false;
  }

  // FIXME: Only emit this suggestion if the trait is dyn-compatible.
  diag.multipart_suggestion("you can add the `dyn` keyword if you want a trait object", sugg, Applicability.MachineApplicable);
  return true;
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:849 add_generic_param_suggestion
HirTyLowerer.prototype.add_generic_param_suggestion = function (
  this: HirTyLowerer,
  generics: hir.Generics,
  self_ty_span: Span,
  impl_trait_name: string,
): [Span, string][] {
  // check if the trait has generics, to make a correct suggestion
  const param_name = next_type_param_name(generics.params, undefined);

  let add_generic_sugg: [Span, string];
  const span = generics.span_for_param_suggestion();
  if (span !== undefined) {
    add_generic_sugg = [span, `, ${param_name}: ${impl_trait_name}`];
  } else {
    add_generic_sugg = [generics.span, `<${param_name}: ${impl_trait_name}>`];
  }
  return [[self_ty_span, param_name], add_generic_sugg];
};

/// Make sure that we are in the condition to suggest `impl Trait`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:867 maybe_suggest_impl_trait
HirTyLowerer.prototype.maybe_suggest_impl_trait = function (
  this: HirTyLowerer,
  span: Span,
  hir_id: hir.HirId,
  hir_bounds: readonly hir.PolyTraitRef[],
  diag: Diag,
): boolean {
  const tcx = this.tcx();
  const parent_id = tcx.hir_get_parent_item(hir_id).def_id;
  // FIXME: If `type_alias_impl_trait` is enabled, also look for `Trait0<Ty = Trait1>`
  //        and suggest `Trait0<Ty = impl Trait1>`.
  // Functions are found in three different contexts.
  // 1. Independent functions
  // 2. Functions inside trait blocks
  // 3. Functions inside impl blocks
  let sig: hir.FnSig;
  let generics: hir.Generics;
  const node = tcx.hir_node_by_def_id(parent_id);
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    sig = node._0.kind.sig;
    generics = node._0.kind.generics;
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
    generics = node._0.generics;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
    generics = node._0.generics;
  } else {
    return false;
  }
  const trait_name_ = tcx.sess.source_map().span_to_snippet(span);
  if (trait_name_.$ !== "Ok") {
    return false;
  }
  const trait_name = trait_name_._0.toString();
  const impl_sugg: [Span, string][] = [[Span.shrink_to_lo(span), "impl "]];
  // Check if trait object is safe for suggesting dynamic dispatch.
  const is_dyn_compatible = hir_bounds.every((bound) => {
    const res = bound.trait_ref.path.res;
    if (res.$ === "Def" && res._0.$ === "Trait") {
      return tcx.is_dyn_compatible(res._1) as boolean;
    }
    return false;
  });

  const pn = tcx.parent_hir_node(hir_id);
  const borrowed = pn.$ === "Ty" && pn._0.kind.$ === "Ref";

  // Suggestions for function return type.
  const output = sig.decl.output;
  if (output.$ === "Return" && hir.HirId_eq(output._0.peel_refs().hir_id, hir_id)) {
    const ty = output._0;
    const pre = !is_dyn_compatible ? `\`${trait_name}\` is dyn-incompatible, ` : "";
    const msg = `${pre}use \`impl ${trait_name}\` to return an opaque type, as long as you return a \
single underlying type`;

    diag.multipart_suggestion(msg, impl_sugg, Applicability.MachineApplicable);

    // Suggest `Box<dyn Trait>` for return type
    if (is_dyn_compatible) {
      // If the return type is `&Trait`, we don't want
      // the ampersand to be displayed in the `Box<dyn Trait>`
      // suggestion.
      const suggestion: [Span, string][] = borrowed
        ? [[ty.span, `Box<dyn ${trait_name}>`]]
        : [
            [Span.shrink_to_lo(ty.span), "Box<dyn "],
            [Span.shrink_to_hi(ty.span), ">"],
          ];

      diag.multipart_suggestion("alternatively, you can return an owned trait object", suggestion, Applicability.MachineApplicable);
    }
    return true;
  }

  // Suggestions for function parameters.
  for (const ty of sig.decl.inputs) {
    if (!hir.HirId_eq(ty.peel_refs().hir_id, hir_id)) {
      continue;
    }
    const sugg = this.add_generic_param_suggestion(generics, span, trait_name);
    diag.multipart_suggestion(`use a new generic type parameter, constrained by \`${trait_name}\``, sugg, Applicability.MachineApplicable);
    diag.multipart_suggestion(
      "you can also use an opaque type, but users won't be able to specify the type \
parameter when calling the `fn`, having to rely exclusively on type inference",
      impl_sugg,
      Applicability.MachineApplicable,
    );
    if (!is_dyn_compatible) {
      diag.note(`\`${trait_name}\` is dyn-incompatible, otherwise a trait object could be used`);
    } else {
      // No ampersand in suggestion if it's borrowed already
      const [dyn_str, paren_dyn_str] = borrowed ? ["dyn ", "(dyn "] : ["&dyn ", "&(dyn "];

      const sugg: [Span, string][] =
        hir_bounds.length >= 2
          ? // There is more than one trait bound, we need surrounding parentheses.
            [
              [Span.shrink_to_lo(span), paren_dyn_str],
              [Span.shrink_to_hi(span), ")"],
            ]
          : [[Span.shrink_to_lo(span), dyn_str]];
      diag.multipart_suggestion(
        `alternatively, use a trait object to accept any type that implements \
\`${trait_name}\`, accessing its methods at runtime using dynamic dispatch`,
        sugg,
        Applicability.MachineApplicable,
      );
    }
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:1001 maybe_suggest_assoc_ty_bound
HirTyLowerer.prototype.maybe_suggest_assoc_ty_bound = function (this: HirTyLowerer, hir_id: hir.HirId, diag: Diag): void {
  const parents = this.tcx().hir_parent_iter(hir_id)[globalThis.Symbol.iterator]();

  const first = parents.next();
  let obj_ty: hir.Ty | undefined;
  let second: IteratorResult<[hir.HirId, hir.Node]>;
  if (
    !first.done &&
    first.value[1].$ === "AssocItemConstraint" &&
    (obj_ty = first.value[1]._0.ty()) !== undefined &&
    !(second = parents.next()).done &&
    second.value[1].$ === "TraitRef"
  ) {
    const c_hir_id = first.value[0];
    const constraint = first.value[1]._0;
    const trait_ref = second.value[1]._0;
    const third = parents.next();
    if (!third.done && third.value[1].$ === "Ty" && third.value[1]._0.kind.$ === "TraitObject") {
      // Assoc ty bounds aren't permitted inside trait object types.
      return;
    }

    let found: hir.GenericArgs | undefined;
    for (const seg of trait_ref.path.segments) {
      const args = seg.args;
      if (args !== undefined && args.constraints.some((c) => hir.HirId_eq(c.hir_id, c_hir_id))) {
        found = args;
        break;
      }
    }
    if (found === undefined || found.parenthesized !== "No") {
      // Only consider angle-bracketed args (where we have a `=` to replace with `:`).
      return;
    }

    const lo = Span.is_dummy(constraint.gen_args.span_ext) ? constraint.ident.span : constraint.gen_args.span_ext;
    const hi = obj_ty.span;

    if (!Span.eq_ctxt(lo, hi)) {
      return;
    }

    diag.span_suggestion_verbose(Span.between(lo, hi), "you might have meant to write a bound here", ": ", Applicability.MaybeIncorrect);
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:1048 maybe_suggest_typoed_method
HirTyLowerer.prototype.maybe_suggest_typoed_method = function (this: HirTyLowerer, hir_id: hir.HirId, trait_def_id: DefId | undefined, diag: Diag): void {
  const tcx = this.tcx();
  if (trait_def_id === undefined) {
    return;
  }
  const node = tcx.parent_hir_node(hir_id);
  if (!(node.$ === "Expr" && node._0.kind.$ === "Path" && node._0.kind._0.$ === "TypeRelative")) {
    return;
  }
  const path_ty = node._0.kind._0._0;
  const segment = node._0.kind._0._1;
  if (!hir.HirId_eq(path_ty.hir_id, hir_id)) {
    return;
  }
  const names: Symbol[] = [...AssocItems.in_definition_order(tcx.associated_items(trait_def_id) as AssocItems)]
    .filter((assoc) => AssocItem.namespace(assoc) === "ValueNS")
    .map((cand) => AssocItem.name(cand));
  const typo = find_best_match_for_name(names, segment.ident.name, undefined);
  if (typo !== undefined) {
    diag.span_suggestion_verbose(
      segment.ident.span,
      `you may have misspelled this associated item, causing \`${display_Symbol(tcx.item_name(trait_def_id))}\` \
to be interpreted as a type rather than a trait`,
      display_Symbol(typo),
      Applicability.MaybeIncorrect,
    );
  } else {
    const trait_name = display_Symbol(tcx.item_name(trait_def_id));
    diag.span_label(
      segment.ident.span,
      `not an associated item of trait \`${trait_name}\`, so \`${trait_name}\` is \
interpreted as a type`,
    );
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/dyn_trait.rs:1098 replace_dummy_self_with_error
export function replace_dummy_self_with_error<T>(tcx: TyCtxt, t: T, guar: ErrorGuaranteed, d_T: TypeFoldable<T>): T {
  return d_T.fold_with(
    t,
    new BottomUpFolder(
      tcx,
      (ty) => {
        if (ty === tcx.types.trait_object_dummy_self) {
          return Ty.new_error(tcx, guar);
        } else {
          return ty;
        }
      },
      (lt) => lt,
      (ct) => ct,
    ),
  );
}
