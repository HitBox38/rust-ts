// Port of compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs (lane hir-ty-lowering-d).
//
// The `impl dyn HirTyLowerer` methods of errors.rs are assigned onto `HirTyLowerer.prototype` (decls.ts declares them); the
// free fns keep the signatures of decls.ts `Fns_hir_ty_lowering_errors`.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
// PORT: query values that queries.gen.ts still types `unknown` (`associated_items`, `associated_item`, `trait_def`,
// `impl_trait_header`, `type_of`, `fn_sig`, `generics_of`) are cast at the call to the type the query returns upstream.
// PORT: `Vec<String>::sort()` is a stable sort with `str_cmp` (byte order); `Vec<Symbol>::sort()` compares the interned
// index (`Symbol`'s derived `Ord`), i.e. numerically.
import { type FulfillmentError, HirTyLowerer } from "../decls.ts";
import {
  Applicability,
  Diag,
  type DiagCtxtHandle,
  type Diagnostic,
  E0034,
  E0109,
  E0191,
  E0220,
  E0221,
  E0222,
  E0223,
  E0225,
  type Level,
  listify,
  msg,
  MultiSpan,
  pluralize,
  struct_span_code_err,
} from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { AssocItemConstraintKind, display_Lifetime, GenericArg as HirGenericArg, Node as HirNode, PathSegment, PrimTy } from "../../rustc_hir/lib.ts";
import { DefKind, Res } from "../../rustc_hir/def.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import { SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems, AssocTag } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Predicate } from "../../rustc_middle/ty/decls.ts";
import { suggest_constraining_type_param } from "../../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { GenericParamDefKind, Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { fold_Term, type ImplTraitHeader, type Term, Ty, Visibility } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, type Print } from "../../rustc_middle/ty/print/mod.ts";
import {
  display_GenericArg,
  display_Term,
  display_TraitRefPrintOnlyTraitPath,
  display_Ty,
  PolyTraitRef_print_only_trait_path,
  PolyTraitRef_print_trait_sugared,
  print_Binder,
  print_TraitRefPrintOnlyTraitPath,
  print_TraitRefPrintSugared,
  TraitRef_print_only_trait_path,
  type TraitRefPrintOnlyTraitPath,
  type TraitRefPrintSugared,
} from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { type BytePos, DUMMY_SP, type ErrorGuaranteed, OrdSpan, Span } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, type Ident, kw, Symbol, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PolyTraitClause, PolyTraitRef } from "../../rustc_type_ir/decls.ts";
import { TreatParams, simplify_type } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { display_AliasTerm, display_Binder, type IrPrint } from "../../rustc_type_ir/ir_print.ts";
import { PolyTraitClause as PolyTraitClause_, PolyTraitRef as PolyTraitRef_, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { AliasConst } from "../../rustc_type_ir/const_kind.ts";
import { PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { TyVid } from "../../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import type { KeyedSet } from "../../rust_ts/keyed.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import { panic, unported } from "../../std/panic.ts";
import { utf8_len } from "../../std/str.ts";
import {
  AmbiguousAssocItem_diagnostic,
  AssocItemConstraintsNotAllowedHere_diagnostic,
  type AssocItemNotFound,
  AssocItemNotFound_diagnostic,
  AssocKindMismatch_diagnostic,
  type AssocKindMismatchWrapInBracesSugg,
  ManualImplementation_diagnostic,
  MissingGenericParams_diagnostic,
  NoVariantNamed_diagnostic,
  type ParenthesizedFnTraitExpansion,
  TraitObjectDeclaredWithNoTraits_diagnostic,
} from "../diagnostics.ts";
import * as bounds from "./bounds.ts";
import type { AmbiguityBetweenVariantAndAssocItem } from "./errors.gen.ts";
import type { InherentAssocCandidate } from "./mod.gen.ts";
import { AssocItemQSelf, LowerTypeRelativePathMode } from "./mod.ts";

export * from "./errors.gen.ts";

// impl<'tcx> dyn HirTyLowerer<'tcx> + '_

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:37 report_missing_generic_params
HirTyLowerer.prototype.report_missing_generic_params = function (
  this: HirTyLowerer,
  missing_generic_params: [Symbol, GenericParamDefKind][],
  def_id: DefId,
  span: Span,
  empty_generic_args: boolean,
): void {
  if (missing_generic_params.length === 0) {
    return;
  }

  const snippet = this.tcx().sess.source_map().span_to_snippet(span);
  this.dcx().emit_err(
    MissingGenericParams_diagnostic({
      span,
      def_span: this.tcx().def_span(def_id),
      span_snippet: snippet.$ === "Ok" ? snippet._0.toString() : undefined,
      missing_generic_params,
      empty_generic_args,
    }),
  );
};

/// When the code is using the `Fn` traits directly, instead of the `Fn(A) -> B` syntax, emit
/// an error and attempt to build a reasonable structured suggestion.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:59 report_internal_fn_trait
HirTyLowerer.prototype.report_internal_fn_trait = function (
  this: HirTyLowerer,
  span: Span,
  trait_def_id: DefId,
  trait_segment: hir.PathSegment,
  is_impl: boolean,
): void {
  if (this.tcx().features().unboxed_closures()) {
    return;
  }

  const trait_def = this.tcx().trait_def(trait_def_id) as TraitDef;
  if (!trait_def.paren_sugar) {
    if (trait_segment.args_().parenthesized === "ParenSugar") {
      // For now, require that parenthetical notation be used only with `Fn()` etc.
      feature_err(
        this.tcx().sess,
        sym.unboxed_closures,
        span,
        "parenthetical notation is only stable when used with `Fn`-family traits",
      ).emit();
    }

    return;
  }

  const sess = this.tcx().sess;

  if (trait_segment.args_().parenthesized !== "ParenSugar") {
    // For now, require that parenthetical notation be used only with `Fn()` etc.
    const err = feature_err(
      sess,
      sym.unboxed_closures,
      span,
      "the precise format of `Fn`-family traits' type parameters is subject to change",
    );
    // Do not suggest the other syntax if we are in trait impl:
    // the desugaring would contain an associated type constraint.
    if (!is_impl) {
      err.span_suggestion_verbose(
        span,
        "use parenthetical notation instead",
        fn_trait_to_string(this.tcx(), trait_segment, true),
        "MaybeIncorrect",
      );
    }
    err.emit();
  }

  if (is_impl) {
    const trait_name = this.tcx().def_path_str(trait_def_id);
    this.dcx().emit_err(ManualImplementation_diagnostic({ span, trait_name }));
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:115 report_unresolved_assoc_item
HirTyLowerer.prototype.report_unresolved_assoc_item = function (
  this: HirTyLowerer,
  all_candidates: () => Iterable<PolyTraitRef>,
  qself: AssocItemQSelf,
  assoc_tag: AssocTag,
  assoc_ident: Ident,
  span: Span,
  constraint: hir.AssocItemConstraint | undefined,
): ErrorGuaranteed {
  const tcx = this.tcx();

  // First and foremost, provide a more user-friendly & “intuitive” error on kind mismatches.
  let assoc_item: AssocItem | undefined;
  // PORT: `all_candidates().find_map(|r| ..filter_by_name_unhygienic(..).find(..))`.
  for (const r of all_candidates()) {
    const r_def_id = PolyTraitRef_.def_id(r);
    for (const item of AssocItems.filter_by_name_unhygienic(associated_items(tcx, r_def_id), assoc_ident.name)) {
      if (tcx.hygienic_eq(assoc_ident, AssocItem.ident(item, tcx), r_def_id)) {
        assoc_item = item;
        break;
      }
    }
    if (assoc_item !== undefined) break;
  }
  if (assoc_item !== undefined) {
    return this.report_assoc_kind_mismatch(assoc_item, assoc_tag, assoc_ident, span, constraint);
  }

  const assoc_kind = assoc_tag_str(assoc_tag);
  const qself_str = AssocItemQSelf.to_string(qself, tcx);

  // The fallback span is needed because `assoc_name` might be an `Fn()`'s `Output` without a
  // valid span, so we point at the whole path segment instead.
  const is_dummy = assoc_ident.span === DUMMY_SP;

  const err: AssocItemNotFound = {
    span: is_dummy ? span : assoc_ident.span,
    assoc_ident,
    assoc_kind,
    qself: qself_str,
    label: undefined,
    sugg: undefined,
    // Try to get the span of the identifier within the path's syntax context
    // (if that's different).
    within_macro_span: Span.within_macro(assoc_ident.span, span, tcx.sess.source_map()),
  };

  if (is_dummy) {
    err.label = { $: "NotFound", span, assoc_ident, assoc_kind };
    return this.dcx().emit_err(AssocItemNotFound_diagnostic(err));
  }

  const all_candidate_names: Symbol[] = [];
  for (const r of all_candidates()) {
    for (const item of AssocItems.in_definition_order(associated_items(tcx, PolyTraitRef_.def_id(r)))) {
      if (!AssocItem.is_impl_trait_in_trait(item) && AssocItem.tag(item) === assoc_tag) {
        const name = AssocItem.opt_name(item);
        if (name !== undefined) all_candidate_names.push(name);
      }
    }
  }

  {
    const suggested_name = find_best_match_for_name(all_candidate_names, assoc_ident.name, undefined);
    if (suggested_name !== undefined) {
      err.sugg = { $: "Similar", span: assoc_ident.span, assoc_kind, suggested_name };
      return this.dcx().emit_err(AssocItemNotFound_diagnostic(err));
    }
  }

  // If we didn't find a good item in the supertraits (or couldn't get
  // the supertraits), like in ItemCtxt, then look more generally from
  // all visible traits. If there's one clear winner, just suggest that.

  const visible_traits: DefId[] = [];
  for (const trait_def_id of tcx.visible_traits()) {
    const viz = tcx.visibility(trait_def_id);
    if (Visibility.is_accessible_from(viz, this.mod_id(), tcx)) visible_traits.push(trait_def_id);
  }

  const wider_candidate_names: Symbol[] = [];
  for (const trait_def_id of visible_traits) {
    for (const item of AssocItems.in_definition_order(associated_items(tcx, trait_def_id))) {
      if (!AssocItem.is_impl_trait_in_trait(item) && AssocItem.tag(item) === assoc_tag) {
        wider_candidate_names.push(AssocItem.name(item));
      }
    }
  }

  const suggested_name = find_best_match_for_name(wider_candidate_names, assoc_ident.name, undefined);
  if (suggested_name !== undefined) {
    const best_traits = visible_traits.filter((trait_def_id) => {
      for (const item of AssocItems.filter_by_name_unhygienic(associated_items(tcx, trait_def_id), suggested_name)) {
        if (AssocItem.tag(item) === assoc_tag) return true;
      }
      return false;
    });
    if (best_traits.length === 1) {
      const best_trait = best_traits[0]!;
      const trait_name = tcx.def_path_str(best_trait);
      err.label = {
        $: "FoundInOtherTrait",
        span: assoc_ident.span,
        assoc_kind,
        trait_name,
        suggested_name,
        identically_named: suggested_name === assoc_ident.name,
      };
      // PORT: the let-chain is nested `if`s.
      if (qself.$ === "TyParam") {
        const ty_param_def_id = qself._0;
        const ty_param_span = qself._1;
        // Not using `self.item_def_id()` here as that would yield the opaque type itself if we're
        // inside an opaque type while we're interested in the overarching type alias (TAIT).
        // FIXME: However, for trait aliases, this incorrectly returns the enclosing module...
        const item_def_id = tcx.hir_get_parent_item(tcx.local_def_id_to_hir_id(ty_param_def_id));
        // FIXME: ...which obviously won't have any generics.
        const generics = tcx.hir_get_generics(item_def_id.def_id);
        if (generics !== undefined) {
          // FIXME: Suggest adding supertrait bounds if we have a `Self` type param.
          // FIXME(trait_alias): Suggest adding `Self: Trait` to
          // `trait Alias = where Self::Proj:;` with `trait Trait { type Proj; }`.
          if (
            generics.bounds_for_param(ty_param_def_id).some((pred) =>
              pred.bounds.some((b) => {
                switch (b.$) {
                  case "Trait": {
                    const id = b._0.trait_ref.trait_def_id();
                    return id !== undefined && DefId_eq(id, best_trait);
                  }
                  default:
                    return false;
                }
              }),
            )
          ) {
            // The type param already has a bound for `trait_name`, we just need to
            // change the associated item.
            err.sugg = { $: "SimilarInOtherTrait", span: assoc_ident.span, trait_name, assoc_kind, suggested_name };
            return this.dcx().emit_err(AssocItemNotFound_diagnostic(err));
          }

          const trait_args = RawList.identity_for_item(tcx, best_trait).slice(1);
          let trait_ref = trait_name;
          let applicability: Applicability;
          if (trait_args.length >= 1) {
            const [arg, ...args] = trait_args;
            trait_ref += `</* ${display_GenericArg(arg!)}`;
            for (const arg of args) trait_ref += `, ${display_GenericArg(arg)}`;
            trait_ref += " */>";
            applicability = "HasPlaceholders";
          } else {
            applicability = "MaybeIncorrect";
          }

          const identically_named = suggested_name === assoc_ident.name;

          if (tcx.def_kind(item_def_id).$ === "TyAlias" && !tcx.type_alias_is_checked(item_def_id)) {
            err.sugg = {
              $: "SimilarInOtherTraitQPath",
              lo: Span.shrink_to_lo(ty_param_span),
              mi: Span.shrink_to_hi(ty_param_span),
              hi: !identically_named ? assoc_ident.span : undefined,
              trait_ref,
              identically_named,
              suggested_name,
              assoc_kind,
              applicability,
            };
          } else {
            const err_ = this.dcx().create_err(AssocItemNotFound_diagnostic(err));
            if (suggest_constraining_type_param(tcx, generics, err_, qself_str, trait_ref, best_trait, undefined) && !identically_named) {
              // We suggested constraining a type parameter, but the associated item on it
              // was also not an exact match, so we also suggest changing it.
              err_.span_suggestion_verbose(
                assoc_ident.span,
                msg("...and changing the associated {$assoc_kind} name"),
                display_Symbol(suggested_name),
                "MaybeIncorrect",
              );
            }
            return err_.emit_err();
          }
        }
      }
      return this.dcx().emit_err(AssocItemNotFound_diagnostic(err));
    }
  }

  // If we still couldn't find any associated item, and only one associated item exists,
  // suggest using it.
  if (all_candidate_names.length === 1) {
    const candidate_name = all_candidate_names[0]!;
    err.sugg = { $: "Other", span: assoc_ident.span, qself: qself_str, assoc_kind, suggested_name: candidate_name };
  } else {
    err.label = { $: "NotFound", span: assoc_ident.span, assoc_ident, assoc_kind };
  }

  return this.dcx().emit_err(AssocItemNotFound_diagnostic(err));
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:344 report_assoc_kind_mismatch
HirTyLowerer.prototype.report_assoc_kind_mismatch = function (
  this: HirTyLowerer,
  assoc_item: AssocItem,
  assoc_tag: AssocTag,
  ident: Ident,
  span: Span,
  constraint: hir.AssocItemConstraint | undefined,
): ErrorGuaranteed {
  const tcx = this.tcx();

  let bound_on_assoc_const_label: Span | undefined;
  if (assoc_item.kind.$ === "Const" && constraint !== undefined && constraint.kind.$ === "Bound") {
    const lo = Span.is_dummy(constraint.gen_args.span_ext) ? ident.span : constraint.gen_args.span_ext;
    bound_on_assoc_const_label = Span.between(lo, Span.shrink_to_hi(span));
  } else {
    bound_on_assoc_const_label = undefined;
  }

  // FIXME(mgca): This has quite a few false positives and negatives.
  let wrap_in_braces_sugg: AssocKindMismatchWrapInBracesSugg | undefined = undefined;
  if (constraint !== undefined) {
    const hir_ty = constraint.ty();
    if (hir_ty !== undefined) {
      const ty = this.lower_ty(hir_ty);
      if ((ty.is_enum() || TypeVisitableExt.references_error(ty, fold_Ty)) && tcx.features().gca()) {
        wrap_in_braces_sugg = { lo: Span.shrink_to_lo(hir_ty.span), hi: Span.shrink_to_hi(hir_ty.span) };
      }
    }
  }

  // For equality constraints, we want to blame the term (RHS) instead of the item (LHS) since
  // one can argue that that's more “intuitive” to the user.
  let span_: Span;
  let expected_because_label: Span | undefined;
  let expected: AssocTag;
  let got: AssocTag;
  if (constraint !== undefined && constraint.kind.$ === "Equality") {
    const term = constraint.kind.term;
    let span2: Span;
    switch (term.$) {
      case "Ty":
        span2 = term._0.span;
        break;
      case "Const":
        span2 = term._0.span;
        break;
    }
    [span_, expected_because_label, expected, got] = [span2, ident.span, AssocItem.tag(assoc_item), assoc_tag];
  } else {
    [span_, expected_because_label, expected, got] = [ident.span, undefined, assoc_tag, AssocItem.tag(assoc_item)];
  }

  const def_kind = tcx.def_kind(this.item_def_id());
  const item_span0 = Span.shrink_to_lo(tcx.def_span(this.item_def_id()));
  let item_span: Span;
  let enclosing_span: Span | undefined;
  switch (def_kind.$) {
    case "AssocConst":
    case "AssocFn":
    case "AssocTy":
      [item_span, enclosing_span] = [
        item_span0,
        Span.shrink_to_lo(tcx.def_span(tcx.parent(LocalDefId.to_def_id(this.item_def_id())))),
      ];
      break;
    case "OpaqueTy": {
      const item_span1 = Span.shrink_to_lo(tcx.def_span(tcx.parent(LocalDefId.to_def_id(this.item_def_id()))));
      const parent_kind = tcx.def_kind(tcx.parent(LocalDefId.to_def_id(this.item_def_id())));
      const enclosing_span1 =
        parent_kind.$ === "AssocConst" || parent_kind.$ === "AssocFn" || parent_kind.$ === "AssocTy"
          ? Span.shrink_to_lo(tcx.def_span(tcx.parent(LocalDefId.to_def_id(this.item_def_id()))))
          : undefined;
      [item_span, enclosing_span] = [item_span1, enclosing_span1];
      break;
    }
    default:
      [item_span, enclosing_span] = [item_span0, undefined];
  }
  return this.dcx().emit_err(
    AssocKindMismatch_diagnostic({
      span: span_,
      item_span,
      enclosing_span,
      expected: assoc_tag_str(expected),
      got: assoc_tag_str(got),
      expected_because_label,
      assoc_kind: assoc_tag_str(AssocItem.tag(assoc_item)),
      def_span: tcx.def_span(assoc_item.def_id),
      bound_on_assoc_const_label,
      wrap_in_braces_sugg,
    }),
  );
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:432 report_ambiguous_assoc_item
HirTyLowerer.prototype.report_ambiguous_assoc_item = function (
  this: HirTyLowerer,
  matching_candidates: readonly PolyTraitRef[],
  qself: AssocItemQSelf,
  assoc_tag: AssocTag,
  assoc_ident: Ident,
  span: Span,
  constraint: hir.AssocItemConstraint | undefined,
): ErrorGuaranteed {
  const tcx = this.tcx();

  const assoc_kind_str = assoc_tag_str(assoc_tag);
  const qself_str = AssocItemQSelf.to_string(qself, tcx);
  const err = this.dcx().create_err(
    AmbiguousAssocItem_diagnostic({ span, assoc_kind: assoc_kind_str, assoc_ident, qself: qself_str }),
  );
  // Provide a more specific error code index entry for equality bindings.
  err.code(constraint !== undefined && constraint.kind.$ === "Equality" ? E0222 : E0221);

  // FIXME(#97583): Print associated item bindings properly (i.e., not as equality
  // predicates!).
  // FIXME: Turn this into a structured, translatable & more actionable suggestion.
  const where_bounds: string[] = [];
  for (const bound of matching_candidates) {
    const bound_id = PolyTraitRef_.def_id(bound);
    const assoc_item = AssocItems.find_by_ident_and_kind(associated_items(tcx, bound_id), tcx, assoc_ident, assoc_tag, bound_id);
    const bound_span = assoc_item === undefined ? undefined : tcx.hir_span_if_local(assoc_item.def_id);

    if (bound_span !== undefined) {
      err.span_label(
        bound_span,
        `ambiguous \`${display_Ident(assoc_ident)}\` from \`${display_PolyTraitRefPrintSugared(PolyTraitRef_print_trait_sugared(bound))}\``,
      );
      if (constraint !== undefined) {
        const kind = constraint.kind;
        switch (kind.$) {
          case "Equality": {
            const hterm = kind.term;
            let term: Term;
            switch (hterm.$) {
              case "Ty":
                term = this.lower_ty(hterm._0);
                break;
              case "Const": {
                const ct = hterm._0;
                if (assoc_item === undefined) panic("assoc_item should be present");
                const assoc_item_ = assoc_item;
                const projection_term = Binder.map_bound(bound, (trait_ref) => {
                  const item_segment = new PathSegment(
                    constraint.ident,
                    constraint.hir_id,
                    Res.Err,
                    constraint.gen_args,
                    false,
                    false,
                  );

                  const alias_args = this.lower_generic_args_of_assoc_item(
                    constraint.ident.span,
                    assoc_item_.def_id,
                    item_segment,
                    trait_ref.args,
                  );
                  const kind = { $: "ProjectionConst" as const, def_id: assoc_item_.def_id };
                  return AliasTerm.new_from_args(tcx, kind, alias_args);
                });

                // FIXME(mgca): code duplication with other places we lower
                // the rhs' of associated const bindings
                const ty = Binder.map_bound(projection_term, (alias) =>
                  Unnormalized.skip_norm_wip(AliasConst.type_of(AliasTerm.expect_ct(alias), tcx)),
                );
                const ty_ = bounds.check_assoc_const_binding_type(this, constraint.ident, ty, constraint.hir_id);

                term = this.lower_const_arg(ct, ty_);
                break;
              }
            }
            if (TypeVisitableExt.references_error(term, fold_Term)) {
              continue;
            }
            // FIXME(#97583): This isn't syntactically well-formed!
            where_bounds.push(
              `        T: ${display_PolyTraitRefPrintOnlyTraitPath(PolyTraitRef_print_only_trait_path(bound))}::${display_Ident(assoc_ident)} = ${display_Term(term)}`,
            );
            break;
          }
          // FIXME: Provide a suggestion.
          case "Bound":
            break;
        }
      } else {
        err.span_suggestion_verbose(
          Span.with_hi(span, Span.lo(assoc_ident.span)),
          "use fully-qualified syntax to disambiguate",
          `<${qself_str} as ${display_PolyTraitRefPrintOnlyTraitPath(PolyTraitRef_print_only_trait_path(bound))}>::`,
          "MaybeIncorrect",
        );
      }
    } else {
      const trait_ = tcx.short_string(PolyTraitRef_print_only_trait_path(bound), err.long_ty_path(), as_decls_print(print_PolyTraitRefPrintOnlyTraitPath));
      err.note(`associated ${assoc_kind_str} \`${display_Ident(assoc_ident)}\` could derive from \`${trait_}\``);
    }
  }
  if (where_bounds.length !== 0) {
    err.help(
      `consider introducing a new type parameter \`T\` and adding \`where\` constraints:\n    where\n        T: ${qself_str},\n${where_bounds.join(",\n")}`,
    );
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:563 report_missing_self_ty_for_resolved_path
HirTyLowerer.prototype.report_missing_self_ty_for_resolved_path = function (
  this: HirTyLowerer,
  trait_def_id: DefId,
  span: Span,
  item_segment: hir.PathSegment,
  assoc_tag: AssocTag,
): ErrorGuaranteed {
  const tcx = this.tcx();
  const path_str = tcx.def_path_str(trait_def_id);

  const def_id = this.item_def_id();
  // debug!(item_def_id = ?def_id);

  // FIXME: document why/how this is different from `tcx.local_parent(def_id)`
  const parent_def_id = tcx.hir_get_parent_item(tcx.local_def_id_to_hir_id(def_id)).to_def_id();
  // debug!(?parent_def_id);

  // If the trait in segment is the same as the trait defining the item,
  // use the `<Self as ..>` syntax in the error.
  const is_part_of_self_trait_constraints = DefId_eq(LocalDefId.to_def_id(def_id), trait_def_id);
  const is_part_of_fn_in_self_trait = DefId_eq(parent_def_id, trait_def_id);

  let type_names: string[];
  if (is_part_of_self_trait_constraints || is_part_of_fn_in_self_trait) {
    type_names = ["Self"];
  } else {
    // Find all the types that have an `impl` for the trait.
    type_names = [];
    for (const impl_def_id of tcx.all_impls(trait_def_id)) {
      const header = tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
      // Consider only accessible traits
      if (!(Visibility.is_accessible_from(tcx.visibility(trait_def_id), this.mod_id(), tcx) && header.polarity !== "Negative")) {
        continue;
      }
      const self_ty = TraitRef.self_ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref)));
      // We don't care about blanket impls.
      if (TypeVisitableExt.has_non_region_param(self_ty, fold_Ty)) continue;
      type_names.push(display_Ty(tcx.erase_and_anonymize_regions(self_ty, fold_Ty)));
    }
  }
  // FIXME: also look at `tcx.generics_of(self.item_def_id()).params` any that
  // references the trait. Relevant for the first case in
  // `src/test/ui/associated-types/associated-types-in-ambiguous-context.rs`
  return this.report_ambiguous_assoc_item_path(span, type_names, [path_str], item_segment.ident, assoc_tag);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:614 report_unresolved_type_relative_path
HirTyLowerer.prototype.report_unresolved_type_relative_path = function (
  this: HirTyLowerer,
  self_ty: Ty,
  hir_self_ty: hir.Ty,
  assoc_tag: AssocTag,
  ident: Ident,
  qpath_hir_id: HirId,
  span: Span,
  variant_def_id: DefId | undefined,
): ErrorGuaranteed {
  const tcx = this.tcx();
  const kind_str = assoc_tag_str(assoc_tag);
  if (variant_def_id !== undefined) {
    // Variant in type position
    const msg_ = `expected ${kind_str}, found variant \`${display_Ident(ident)}\``;
    return this.dcx().span_err(span, msg_);
  } else if (self_ty.is_enum()) {
    const err = this.dcx().create_err(NoVariantNamed_diagnostic({ span: ident.span, ident, ty: self_ty }));

    const adt_def = self_ty.ty_adt_def();
    if (adt_def === undefined) panic("enum is not an ADT");
    const variant_name = find_best_match_for_name(
      adt_def.variants().map((variant) => variant.name),
      ident.name,
      undefined,
    );
    const variant = variant_name === undefined ? undefined : adt_def.variants().find((s) => s.name === variant_name);
    if (variant_name !== undefined && variant !== undefined) {
      let suggestion: [Span, string][] = [[ident.span, display_Symbol(variant_name)]];
      const parent = tcx.parent_hir_node(qpath_hir_id);
      const expr = parent.$ === "Stmt" && parent._0.kind.$ === "Semi" ? parent._0.kind._0 : parent.$ === "Expr" ? parent._0 : undefined;
      if (expr !== undefined && expr.kind.$ === "Struct") {
        const ctor = variant.ctor;
        if (ctor === undefined) {
          // struct
          suggestion = [
            [
              Span.with_hi(ident.span, Span.hi(expr.span)),
              variant.fields.length === 0
                ? `${display_Symbol(variant_name)} {}`
                : `${display_Symbol(variant_name)} { ${variant.fields.map((f) => `${display_Symbol(f.name)}: /* value */`).join(", ")} }`,
            ],
          ];
        } else if (ctor[0] === "Fn") {
          const def_id = ctor[1];
          // tuple
          const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<import("../../rustc_type_ir/decls.ts").PolyFnSig>));
          const inputs = Binder.skip_binder(PolyFnSig.inputs(fn_sig));
          suggestion = [
            [
              Span.with_hi(ident.span, Span.hi(expr.span)),
              `${display_Symbol(variant_name)}(${inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")})`,
            ],
          ];
        } else {
          // unit
          suggestion = [[Span.with_hi(ident.span, Span.hi(expr.span)), display_Symbol(variant_name)]];
        }
      }
      err.multipart_suggestion("there is a variant with a similar name", suggestion, "HasPlaceholders");
    } else {
      err.span_label(ident.span, `variant not found in \`${display_Ty(self_ty)}\``);
    }

    const sp = tcx.hir_span_if_local(adt_def.did());
    if (sp !== undefined) {
      err.span_label(sp, `variant \`${display_Ident(ident)}\` not found here`);
    }

    return err.emit_err();
  } else {
    const reported = TypeVisitableExt.error_reported(self_ty, fold_Ty);
    if (reported.$ === "Err") {
      return reported._0;
    } else {
      const r = this.maybe_report_similar_assoc_fn(span, self_ty, hir_self_ty);
      switch (r.$) {
        case "Ok":
          break;
        case "Err":
          return r._0;
      }

      const traits: string[] = this.probe_traits_that_match_assoc_ty(self_ty, ident);

      return this.report_ambiguous_assoc_item_path(span, [display_Ty(self_ty)], traits, ident, assoc_tag);
    }
  }
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:728 report_ambiguous_assoc_item_path
HirTyLowerer.prototype.report_ambiguous_assoc_item_path = function (
  this: HirTyLowerer,
  span: Span,
  types_: readonly string[],
  traits_: readonly string[],
  ident: Ident,
  assoc_tag: AssocTag,
): ErrorGuaranteed {
  const kind_str = assoc_tag_str(assoc_tag);
  const err = struct_span_code_err(this.dcx(), span, E0223, `ambiguous associated ${kind_str}`);
  if ([...this.tcx().resolutions(null).confused_type_with_std_module.keys()].some((full_span) => Span.contains(full_span, span))) {
    err.span_suggestion_verbose(
      Span.shrink_to_lo(span),
      "you are looking for the module in `std`, not the primitive type",
      "std::",
      "MachineApplicable",
    );
  } else {
    const sugg_sp = Span.until(span, ident.span);

    const types = [...types_];
    types.sort(str_cmp);
    const traits = [...traits_];
    traits.sort(str_cmp);
    // PORT: the tuple match is an if-chain in arm order.
    if (types.length === 0 && traits.length === 0) {
      err.span_suggestion_verbose(
        sugg_sp,
        `if there were a type named \`Type\` that implements a trait named \`Trait\` with associated ${kind_str} \`${display_Ident(ident)}\`, you could use the fully-qualified path`,
        "<Type as Trait>::",
        "HasPlaceholders",
      );
    } else if (types.length === 0 && traits.length === 1) {
      const trait_str = traits[0]!;
      err.span_suggestion_verbose(
        sugg_sp,
        `if there were a type named \`Example\` that implemented \`${trait_str}\`, you could use the fully-qualified path`,
        `<Example as ${trait_str}>::`,
        "HasPlaceholders",
      );
    } else if (types.length === 0) {
      err.span_suggestions_with_style(
        sugg_sp,
        `if there were a type named \`Example\` that implemented one of the traits with associated ${kind_str} \`${display_Ident(ident)}\`, you could use the fully-qualified path`,
        traits.map((trait_str) => `<Example as ${trait_str}>::`),
        "HasPlaceholders",
        "ShowAlways",
      );
    } else if (types.length === 1 && traits.length === 0) {
      const type_str = types[0]!;
      err.span_suggestion_verbose(
        sugg_sp,
        `if there were a trait named \`Example\` with associated ${kind_str} \`${display_Ident(ident)}\` implemented for \`${type_str}\`, you could use the fully-qualified path`,
        `<${type_str} as Example>::`,
        "HasPlaceholders",
      );
    } else if (traits.length === 0) {
      err.span_suggestions_with_style(
        sugg_sp,
        `if there were a trait named \`Example\` with associated ${kind_str} \`${display_Ident(ident)}\` implemented for one of the types, you could use the fully-qualified path`,
        types.map((type_str) => `<${type_str} as Example>::`),
        "HasPlaceholders",
        "ShowAlways",
      );
    } else {
      const suggestions: string[] = [];
      for (const type_str of types) {
        for (const trait_str of traits) {
          suggestions.push(`<${type_str} as ${trait_str}>::`);
        }
      }
      err.span_suggestions_with_style(sugg_sp, "use fully-qualified syntax", suggestions, "MachineApplicable", "ShowAlways");
    }
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:842 report_ambiguous_inherent_assoc_item
HirTyLowerer.prototype.report_ambiguous_inherent_assoc_item = function (
  this: HirTyLowerer,
  name: Ident,
  candidates: DefId[],
  span: Span,
): ErrorGuaranteed {
  const err = struct_span_code_err(this.dcx(), name.span, E0034, "multiple applicable items in scope");
  err.span_label(name.span, `multiple \`${display_Ident(name)}\` found`);
  this.note_ambiguous_inherent_assoc_item(err, candidates, span);
  return err.emit_err();
};

// FIXME(fmease): Heavily adapted from `rustc_hir_typeck::method::suggest`. Deduplicate.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:860 note_ambiguous_inherent_assoc_item
HirTyLowerer.prototype.note_ambiguous_inherent_assoc_item = function (
  this: HirTyLowerer,
  err: Diag,
  candidates: DefId[],
  span: Span,
): void {
  const tcx = this.tcx();

  // Dynamic limit to avoid hiding just one candidate, which is silly.
  const limit = candidates.length === 5 ? 5 : 4;

  for (const [index, item] of candidates.slice(0, limit).entries()) {
    const impl_ = tcx.parent(item);

    const note_span = item.is_local() ? tcx.def_span(item) : impl_.is_local() ? tcx.def_span(impl_) : undefined;

    const title = candidates.length > 1 ? `candidate #${index + 1}` : "the candidate";

    const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.at(span).type_of(impl_) as EarlyBinder<Ty>));
    const note = `${title} is defined in an impl for the type \`${display_Ty(impl_ty)}\``;

    if (note_span !== undefined) {
      err.span_note(note_span, note);
    } else {
      err.note(note);
    }
  }
  if (candidates.length > limit) {
    err.note(`and ${candidates.length - limit} others`);
  }
};

// FIXME(inherent_associated_types): Find similarly named associated types and suggest them.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:903 report_unresolved_inherent_assoc_item
HirTyLowerer.prototype.report_unresolved_inherent_assoc_item = function (
  this: HirTyLowerer,
  name: Ident,
  self_ty: Ty,
  candidates: InherentAssocCandidate[],
  fulfillment_errors: FulfillmentError[],
  span: Span,
  assoc_tag: AssocTag,
): ErrorGuaranteed {
  // FIXME(fmease): This was copied in parts from an old version of `rustc_hir_typeck::method::suggest`.
  // Either
  // * update this code by applying changes similar to #106702 or by taking a
  //   Vec<(DefId, (DefId, DefId), Option<Vec<FulfillmentError<'tcx>>>)> or
  // * deduplicate this code across the two crates.

  const tcx = this.tcx();

  const assoc_tag_str_ = assoc_tag_str(assoc_tag);
  const adt_def0 = self_ty.ty_adt_def();
  const adt_did = adt_def0 === undefined ? undefined : adt_def0.did();
  const add_def_label = (err: Diag): void => {
    if (adt_did !== undefined) {
      const did = adt_did;
      err.span_label(
        tcx.def_span(did),
        `associated ${assoc_tag_str_} \`${display_Ident(name)}\` not found for this ${tcx.def_descr(did)}`,
      );
    }
  };

  if (fulfillment_errors.length === 0) {
    // FIXME(fmease): Copied from `rustc_hir_typeck::method::probe`. Deduplicate.

    const limit = candidates.length === 5 ? 5 : 4;
    const type_candidates = candidates
      .slice(0, limit)
      .map(
        (cand) =>
          `- \`${display_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.at(span).type_of(cand.impl_) as EarlyBinder<Ty>)))}\``,
      )
      .join("\n");
    const additional_types = candidates.length > limit ? `\nand ${candidates.length - limit} more types` : "";

    const err = struct_span_code_err(
      this.dcx(),
      name.span,
      E0220,
      `associated ${assoc_tag_str_} \`${display_Ident(name)}\` not found for \`${display_Ty(self_ty)}\` in the current scope`,
    );
    err.span_label(name.span, `associated item not found in \`${display_Ty(self_ty)}\``);
    err.note(`the associated ${assoc_tag_str_} was found for\n${type_candidates}${additional_types}`);
    add_def_label(err);
    return err.emit_err();
  }

  // PORT: `SortedMap<OrdSpan, Vec<String>>`; `get_mut_or_insert_default` is `get` + `insert` of a fresh array (the
  // array is shared, so pushing to it edits the entry).
  const bound_spans = SortedMap.default<OrdSpan, string[]>((a, b) => a.cmp(b));
  const get_mut_or_insert_default = (key: OrdSpan): string[] => {
    let v = bound_spans.get(key);
    if (v === undefined) {
      v = [];
      bound_spans.insert(key, v);
    }
    return v;
  };

  const bound_span_label = (self_ty: Ty, obligation: string, quiet: string): void => {
    const msg_ = `\`${utf8_len(obligation) > 50 ? quiet : obligation}\``;
    const kind = self_ty.kind();
    switch (kind.$) {
      // Point at the type that couldn't satisfy the bound.
      case "Adt":
        get_mut_or_insert_default(new OrdSpan(tcx.def_span(kind._0.did()))).push(msg_);
        break;
      // Point at the trait object that couldn't satisfy the bound.
      case "Dynamic": {
        for (const pred of kind._0) {
          const p = Binder.skip_binder(pred);
          switch (p.$) {
            case "Trait":
              get_mut_or_insert_default(new OrdSpan(tcx.def_span(p._0.def_id))).push(msg_);
              break;
            case "Projection":
            case "AutoTrait":
              break;
          }
        }
        break;
      }
      // Point at the closure that couldn't satisfy the bound.
      case "Closure":
        get_mut_or_insert_default(new OrdSpan(tcx.def_span(kind._0))).push(`\`${quiet}\``);
        break;
      default:
        break;
    }
  };

  const format_pred = (pred: Predicate): string | undefined => {
    const bound_predicate = pred.kind();
    const k = Binder.skip_binder(bound_predicate);
    if (k.$ === "Clause" && k._0.$ === "Projection") {
      const pred_ = k._0._0;
      // `<Foo as Iterator>::Item = String`.
      const projection_term = pred_.projection_term;
      const term = pred_.term;
      const arg0 = projection_term.args[0];
      const self_ty = arg0 === undefined ? undefined : GenericArg.as_type(arg0);
      if (self_ty === undefined) return undefined;

      const obligation = `${display_AliasTerm(projection_term)} = ${display_Term(term)}`;
      const quiet_projection_term = AliasTerm.with_replaced_self_ty(projection_term, tcx, Ty.new_var(tcx, TyVid.ZERO));
      const quiet = `${display_AliasTerm(quiet_projection_term)} = ${display_Term(term)}`;

      bound_span_label(self_ty, obligation, quiet);

      return obligation;
    } else if (k.$ === "Clause" && k._0.$ === "Trait") {
      const poly_trait_ref = k._0._0;
      const p = poly_trait_ref.trait_ref;
      const self_ty = TraitRef.self_ty(p);
      const path = TraitRef_print_only_trait_path(p);
      const obligation = `${display_Ty(self_ty)}: ${display_TraitRefPrintOnlyTraitPath(path)}`;
      const quiet = `_: ${display_TraitRefPrintOnlyTraitPath(path)}`;
      bound_span_label(self_ty, obligation, quiet);
      return obligation;
    } else {
      return undefined;
    }
  };

  // FIXME(fmease): `rustc_hir_typeck::method::suggest` uses a `skip_list` to filter out some bounds.
  // I would do the same here if it didn't mean more code duplication.
  let bounds_: string[] = [];
  for (const error of fulfillment_errors) {
    const p = format_pred(FulfillmentError_root_obligation_predicate(error));
    if (p !== undefined) bounds_.push(`\`${p}\``);
  }
  bounds_.sort(str_cmp);
  bounds_ = dedup(bounds_);

  const err = this.dcx().struct_span_err(
    name.span,
    `the associated ${assoc_tag_str_} \`${display_Ident(name)}\` exists for \`${display_Ty(self_ty)}\`, but its trait bounds were not satisfied`,
  );
  if (bounds_.length !== 0) {
    err.note(`the following trait bounds were not satisfied:\n${bounds_.join("\n")}`);
  }
  err.span_label(
    name.span,
    `associated ${assoc_tag_str_} cannot be referenced on \`${display_Ty(self_ty)}\` due to unsatisfied trait bounds`,
  );

  for (const [span_, bounds0] of bound_spans.iter()) {
    if (!tcx.sess.source_map().is_span_accessible(span_._0)) {
      continue;
    }
    bounds0.sort(str_cmp);
    const bounds1 = dedup(bounds0);
    let msg_: string;
    if (bounds1.length === 1) {
      msg_ = `doesn't satisfy ${bounds1[0]!}`;
    } else if (bounds1.length > 4) {
      msg_ = `doesn't satisfy ${bounds1.length} bounds`;
    } else if (bounds1.length >= 1) {
      const last = bounds1[bounds1.length - 1]!;
      msg_ = `doesn't satisfy ${bounds1.slice(0, -1).join(", ")} or ${last}`;
    } else {
      msg_ = unreachable_();
    }
    err.span_label(span_._0, msg_);
  }
  add_def_label(err);
  return err.emit_err();
};

/// If there are any missing associated items, emit an error instructing the user to provide
/// them unless that's impossible due to shadowing. Moreover, if any corresponding trait refs
/// are dyn incompatible due to associated items we emit an dyn incompatibility error instead.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1080 check_for_required_assoc_items
HirTyLowerer.prototype.check_for_required_assoc_items = function (
  this: HirTyLowerer,
  spans: Span[],
  missing_assoc_items_: KeyedSet<[DefId, PolyTraitRef]>,
  potential_assoc_items: number[],
  trait_bounds: readonly hir.PolyTraitRef[],
): Result<undefined, ErrorGuaranteed> {
  if (missing_assoc_items_.size === 0) {
    return Ok(undefined);
  }

  const tcx = this.tcx();
  const principal_span0 = spans[0];
  if (principal_span0 === undefined) panic("called `Option::unwrap()` on a `None` value");
  const principal_span = principal_span0;

  // FIXME: This logic needs some more care w.r.t handling of conflicts
  const missing_assoc_items: [AssocItem, PolyTraitRef][] = [...missing_assoc_items_].map(([def_id, trait_ref]) => [
    tcx.associated_item(def_id) as AssocItem,
    trait_ref,
  ]);
  // PORT: `FxIndexMap<PolyTraitRef, Vec<Symbol>>` keyed structurally (`intern_key`), insertion-ordered.
  const names = new KeyedMap<PolyTraitRef, Symbol[]>(intern_key);
  let names_len = 0;
  let descr: Descr | undefined = undefined;

  type Descr = { $: "Item" } | { $: "Tag"; _0: AssocTag };

  for (const [assoc_item, trait_ref] of missing_assoc_items) {
    // We don't want to suggest specifying associated items if there's something wrong with
    // any of them that renders the trait dyn incompatible; providing them certainly won't
    // fix the issue and we could also risk suggesting invalid code.
    //
    // Note that this check is only truly necessary in item ctxts where we merely perform
    // *minimal* dyn compatibility checks. In fn ctxts we would've already bailed out with
    // an error by this point if the trait was dyn incompatible.
    const violations = dyn_compatibility_violations_for_assoc_item(tcx, PolyTraitRef_.def_id(trait_ref), assoc_item);
    if (violations.length !== 0) {
      return Err(report_dyn_incompatibility(tcx, principal_span, undefined, PolyTraitRef_.def_id(trait_ref), violations).emit_err());
    }

    let entry = names.get(trait_ref);
    if (entry === undefined) {
      entry = [];
      names.set(trait_ref, entry);
    }
    entry.push(AssocItem.name(assoc_item));
    names_len += 1;

    if (descr === undefined) {
      descr = { $: "Tag", _0: AssocItem.tag(assoc_item) };
    } else if (descr.$ === "Tag" && descr._0 !== AssocItem.tag(assoc_item)) {
      descr = { $: "Item" };
    } else {
      continue;
    }
  }

  // related to issue #91997, turbofishes added only when in an expr or pat
  let in_expr_or_pat = false;
  if (potential_assoc_items.length === 0 && trait_bounds.length === 1) {
    const bound = trait_bounds[0]!;
    const grandparent = tcx.parent_hir_node(tcx.parent_hir_id(bound.trait_ref.hir_ref_id));
    switch (grandparent.$) {
      case "Expr":
      case "Pat":
        in_expr_or_pat = true;
        break;
      default:
        in_expr_or_pat = false;
    }
  }

  // We get all the associated items that *are* set, so that we can check if any of
  // their names match one of the ones we are missing.
  // This would mean that they are shadowing the associated item we are missing, and
  // we can then use their span to indicate this to the user.
  //
  // FIXME: This does not account for trait aliases. I think we should just make
  //        `lower_trait_object_ty` compute the list of all specified items or give us the
  //        necessary ingredients if it's too expensive to compute in the happy path.
  // PORT: `UnordMap<(Symbol, AssocTag), DefId>` (lookups only) keyed `"<symbol>:<tag>"`.
  const bound_names = new KeyedMap<[Symbol, AssocTag], DefId>(name_tag_key);
  for (const poly_trait_ref of trait_bounds) {
    const segments = poly_trait_ref.trait_ref.path.segments;
    const path = segments[segments.length - 1];
    if (path === undefined) continue;
    const args = path.args;
    if (args === undefined) continue;
    const res = path.res;
    if (!(res.$ === "Def" && res._0.$ === "Trait")) continue;
    const trait_def_id = res._1;

    for (const constraint of args.constraints) {
      if (constraint.kind.$ !== "Equality") {
        continue;
      }
      const term = constraint.kind.term;
      let tag: AssocTag;
      switch (term.$) {
        case "Ty":
          tag = "Type";
          break;
        case "Const":
          tag = "Const";
          break;
      }
      const assoc_item = AssocItems.find_by_ident_and_kind(associated_items(tcx, trait_def_id), tcx, constraint.ident, tag, trait_def_id);
      if (assoc_item === undefined) continue;
      bound_names.set([constraint.ident.name, tag], assoc_item.def_id);
    }
  }

  const names_strs: string[] = [];
  for (const [trait_, assocs] of names) {
    assocs.sort((a, b) => a - b);
    const trait_s = display_PolyTraitRefPrintSugared(PolyTraitRef_print_trait_sugared(trait_));
    names_strs.push(`${listify(assocs, (a) => `\`${display_Symbol(a)}\``) ?? ""} in \`${trait_s}\``);
  }
  names_strs.sort(str_cmp);
  const names_joined = names_strs.join(", ");

  if (descr === undefined) panic("called `Option::unwrap()` on a `None` value");
  const descr_ = descr.$ === "Item" ? "associated item" : AssocTag.descr(descr._0);
  const err = struct_span_code_err(
    this.dcx(),
    principal_span,
    E0191,
    `the value of the ${descr_}${pluralize(names_len)} ${names_joined} must be specified`,
  );
  const suggestions: [Span, string][] = [];
  let items_count = 0;
  const where_constraints: Span[] = [];
  let already_has_generics_args_suggestion = false;

  // PORT: `UnordMap<(Symbol, AssocTag), usize>` keyed `"<symbol>:<tag>"`.
  const names2 = new KeyedMap<[Symbol, AssocTag], number>(name_tag_key);
  for (const [item] of missing_assoc_items) {
    items_count += 1;
    const key: [Symbol, AssocTag] = [AssocItem.name(item), AssocItem.tag(item)];
    names2.set(key, (names2.get(key) ?? 0) + 1);
  }
  let dupes = false;
  let shadows = false;
  for (const [item, trait_ref] of missing_assoc_items) {
    const name = AssocItem.name(item);
    const key: [Symbol, AssocTag] = [name, AssocItem.tag(item)];

    if (names2.get(key)! > 1) {
      dupes = true;
    } else {
      const d = bound_names.get(key);
      if (d !== undefined && !DefId_eq(d, item.def_id)) {
        shadows = true;
      }
    }

    const prefix = dupes || shadows ? `${tcx.def_path_str(PolyTraitRef_.def_id(trait_ref))}::` : "";
    let is_shadowed = false;

    const def_id = bound_names.get(key);
    if (def_id !== undefined && !DefId_eq(def_id, item.def_id)) {
      is_shadowed = true;

      const rename_message = def_id.is_local() ? ", consider renaming it" : "";
      err.span_label(tcx.def_span(def_id), `\`${prefix}${display_Symbol(name)}\` shadowed here${rename_message}`);
    }

    const rename_message = is_shadowed ? ", consider renaming it" : "";

    const sp = tcx.hir_span_if_local(item.def_id);
    if (sp !== undefined) {
      err.span_label(sp, `\`${prefix}${display_Symbol(name)}\` defined here${rename_message}`);
    }
  }
  // PORT: `else if let (Ok(snippet), false, false) = (..)` evaluates the snippet only when the first branch is not taken.
  let snippet_r: ReturnType<ReturnType<TyCtxt["sess"]["source_map"]>["span_to_snippet"]> | undefined;
  if (potential_assoc_items.length === missing_assoc_items.length) {
    // When the amount of missing associated types equals the number of
    // extra type arguments present. A suggesting to replace the generic args with
    // associated types is already emitted.
    already_has_generics_args_suggestion = true;
  } else if ((snippet_r = tcx.sess.source_map().span_to_snippet(principal_span)).$ === "Ok" && !dupes && !shadows) {
    const snippet = snippet_r._0.toString();
    const bindings: string[] = missing_assoc_items.map(([item]) => {
      let k: string;
      switch (item.kind.$) {
        case "Const":
          k = "CONST";
          break;
        case "Type":
          k = "Type";
          break;
        case "Fn":
          k = unreachable_();
          break;
      }
      return `${display_Symbol(AssocItem.name(item))} = /* ${k} */`;
    });
    let code: string;
    if (snippet.endsWith("<>")) {
      // Empty generics
      code = `${snippet.slice(0, -2)}<${bindings.join(", ")}>`;
    } else if (snippet.endsWith(">")) {
      // Non-empty generics
      code = `${snippet.slice(0, -1)}, ${bindings.join(", ")}>`;
    } else if (in_expr_or_pat) {
      // The user wrote `Trait`, so we don't have a term we can suggest, but at least we
      // can clue them to the correct syntax `Trait::<Item = /* ... */>`.
      code = `${snippet}::<${bindings.join(", ")}>`;
    } else {
      // The user wrote `Trait`, so we don't have a term we can suggest, but at least we
      // can clue them to the correct syntax `Trait<Item = /* ... */>`.
      code = `${snippet}<${bindings.join(", ")}>`;
    }
    suggestions.push([principal_span, code]);
  } else if (dupes) {
    where_constraints.push(principal_span);
  }

  // FIXME: This note doesn't make sense, get rid of this outright.
  //        I don't see how adding a type param (to the trait?) would help.
  //        If the user can modify the trait, they should just rename one of the assoc tys.
  //        What does it mean with the rest of the message?
  //        Does it suggest adding equality predicates (unimplemented) to the trait object
  //        type? (pseudo) "dyn B + <Self as B>::X = T + <Self as A>::X = U"?
  //        Instead, maybe mention shadowing if applicable (yes, even when no "relevant"
  //        bindings were provided).
  const where_msg =
    "consider introducing a new type parameter, adding `where` constraints using the fully-qualified path to the associated types";
  if (where_constraints.length !== 0 && suggestions.length === 0) {
    // If there are duplicates associated type names and a single trait bound do not
    // use structured suggestion, it means that there are multiple supertraits with
    // the same associated type name.
    err.help(where_msg);
  }
  if (suggestions.length !== 1 || already_has_generics_args_suggestion) {
    // We don't need this label if there's an inline suggestion, show otherwise.
    const names3 = new Map<Symbol, number>();
    for (const [item] of missing_assoc_items) {
      items_count += 1;
      const n = AssocItem.name(item);
      names3.set(n, (names3.get(n) ?? 0) + 1);
    }
    const label: string[] = [];
    for (const [item, trait_ref] of missing_assoc_items) {
      const name = AssocItem.name(item);
      const postfix =
        names3.get(name)! > 1 ? ` (from trait \`${display_PolyTraitRefPrintSugared(PolyTraitRef_print_trait_sugared(trait_ref))}\`)` : "";
      label.push(`\`${display_Symbol(name)}\`${postfix}`);
    }
    if (label.length !== 0) {
      err.span_label(principal_span, `${descr_}${pluralize(label.length)} ${label.join(", ")} must be specified`);
    }
  }
  // PORT: `sort_by_key(|&(span, _)| span.lo_hi())` is a stable sort on `(lo, hi)`.
  suggestions.sort(([a], [b]) => {
    const [alo, ahi] = Span.lo_hi(a);
    const [blo, bhi] = Span.lo_hi(b);
    return alo !== blo ? alo - blo : ahi - bhi;
  });
  // There are cases where one bound points to a span within another bound's span, like when
  // you have code like the following (#115019), so we skip providing a suggestion in those
  // cases to avoid having a malformed suggestion.
  //
  // pub struct Flatten<I> {
  //     inner: <IntoIterator<Item: IntoIterator<Item: >>::IntoIterator as Item>::core,
  //             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //             |                  ^^^^^^^^^^^^^^^^^^^^^
  //             |                  |
  //             |                  associated types `Item`, `IntoIter` must be specified
  //             associated types `Item`, `IntoIter` must be specified
  // }
  let overlaps = false;
  for (let i = 0; i + 1 < suggestions.length; i++) {
    if (Span.overlaps(suggestions[i]![0], suggestions[i + 1]![0])) {
      overlaps = true;
      break;
    }
  }
  if (suggestions.length !== 0 && !overlaps) {
    err.multipart_suggestion(`specify the ${descr_}${pluralize(items_count)}`, suggestions, "HasPlaceholders");
    if (where_constraints.length !== 0) {
      err.span_help(where_constraints, where_msg);
    }
  }

  return Err(err.emit_err());
};

/// On ambiguous associated type, look for an associated function whose name matches the
/// extended path and, if found, emit an E0223 error with a structured suggestion.
/// e.g. for `String::from::utf8`, suggest `String::from_utf8` (#109195)
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1372 maybe_report_similar_assoc_fn
HirTyLowerer.prototype.maybe_report_similar_assoc_fn = function (
  this: HirTyLowerer,
  span: Span,
  qself_ty: Ty,
  qself: hir.Ty,
): Result<undefined, ErrorGuaranteed> {
  const tcx = this.tcx();
  // PORT: the let-chain is nested `if`s; each failing link falls through to `Ok(())`.
  let first = true;
  let parent: [HirId, hir.Node] | undefined;
  for (const p of tcx.hir_parent_iter(qself.hir_id)) {
    if (first) {
      first = false;
      continue;
    }
    parent = p;
    break;
  }
  if (parent !== undefined) {
    const node = parent[1];
    if (
      node.$ === "Expr" &&
      node._0.kind.$ === "Path" &&
      node._0.kind._0.$ === "TypeRelative" &&
      node._0.kind._0._0.kind.$ === "Path" &&
      node._0.kind._0._0.kind._0.$ === "TypeRelative"
    ) {
      const ident2 = node._0.kind._0._0.kind._0._1.ident;
      const ident3 = node._0.kind._0._1.ident;
      const adt_def = qself_ty.ty_adt_def();
      let inherent_impls: readonly DefId[] | undefined;
      if (adt_def !== undefined) {
        inherent_impls = tcx.inherent_impls(adt_def.did());
      } else {
        // PORT: `TyCtxt` as the `Interner` (`impl Interner for TyCtxt`; its declaration is not complete yet, ty-print-a 13).
        const simple_ty = simplify_type(tcx as unknown as Interner, qself_ty, TreatParams.InstantiateWithInfer);
        inherent_impls = simple_ty === undefined ? undefined : tcx.incoherent_impls(simple_ty);
      }
      if (inherent_impls !== undefined) {
        const name = Symbol.intern(`${display_Ident(ident2)}_${display_Ident(ident3)}`);
        let item: AssocItem | undefined;
        outer: for (const inherent_impl of inherent_impls) {
          for (const it of AssocItems.filter_by_name_unhygienic(associated_items(tcx, inherent_impl), name)) {
            item = it;
            break outer;
          }
        }
        if (item !== undefined && AssocItem.is_fn(item)) {
          return Err(
            struct_span_code_err(this.dcx(), span, E0223, "ambiguous associated type")
              .with_span_suggestion_verbose(
                Span.to(ident2.span, ident3.span),
                `there is an associated function with a similar name: \`${display_Symbol(name)}\``,
                display_Symbol(name),
                "MaybeIncorrect",
              )
              .emit_err(),
          );
        }
      }
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1424 report_prohibited_generic_args
HirTyLowerer.prototype.report_prohibited_generic_args = function (
  this: HirTyLowerer,
  segments_: Iterable<hir.PathSegment>,
  args_visitors: Iterable<hir.GenericArg>,
  err_extend: GenericsArgsErrExtend,
): ErrorGuaranteed {
  // #[derive(PartialEq, Eq, Hash)] enum ProhibitGenericsArg { Lifetime, Type, Const, Infer }
  type ProhibitGenericsArg = "Lifetime" | "Type" | "Const" | "Infer";

  // PORT: `FxIndexSet<ProhibitGenericsArg>` is an insertion-ordered `Set`.
  const prohibit_args = new Set<ProhibitGenericsArg>();
  for (const arg of args_visitors) {
    switch (arg.$) {
      case "Lifetime":
        prohibit_args.add("Lifetime");
        break;
      case "Type":
        prohibit_args.add("Type");
        break;
      case "Const":
        prohibit_args.add("Const");
        break;
      case "Infer":
        prohibit_args.add("Infer");
        break;
    }
  }

  const segments: hir.PathSegment[] = [...segments_];
  const types_and_spans: [string, Span][] = [];
  for (const segment of segments) {
    if (segment.args_().args.length === 0) {
      continue;
    }
    const res = segment.res;
    let what: string;
    // PORT: the match guard `if let Some(name) = self.tcx().opt_item_name(def_id)` is evaluated once.
    const name = res.$ === "Def" ? this.tcx().opt_item_name(res._1) : undefined;
    if (res.$ === "PrimTy") {
      what = `${Res.descr(res)} \`${display_Symbol(PrimTy.name(res._0))}\``;
    } else if (res.$ === "Def" && name !== undefined) {
      what = `${Res.descr(res)} \`${display_Symbol(name)}\``;
    } else if (res.$ === "Err") {
      what = "this type";
    } else {
      what = Res.descr(res);
    }
    types_and_spans.push([what, segment.ident.span]);
  }
  const this_type = listify(types_and_spans, ([t]) => t);
  if (this_type === undefined) panic("expected one segment to deny");

  const arg_spans: Span[] = [];
  for (const segment of segments) {
    for (const arg of segment.args_().args) arg_spans.push(HirGenericArg.span(arg));
  }

  const kinds: string[] = [];
  for (const arg of prohibit_args) {
    switch (arg) {
      case "Lifetime":
        kinds.push("lifetime");
        break;
      case "Type":
        kinds.push("type");
        break;
      case "Const":
        kinds.push("const");
        break;
      case "Infer":
        kinds.push("generic");
        break;
    }
  }

  const s = pluralize(kinds.length);
  const kind = listify(kinds, (k) => k);
  if (kind === undefined) panic("expected at least one generic to prohibit");
  const last_span = arg_spans[arg_spans.length - 1];
  if (last_span === undefined) panic("called `Option::unwrap()` on a `None` value");
  const span: MultiSpan = MultiSpan.from_spans(arg_spans);
  const err = struct_span_code_err(this.dcx(), span, E0109, `${kind} arguments are not allowed on ${this_type}`);
  err.span_label(last_span, `${kind} argument${s} not allowed`);
  for (const [what, span] of types_and_spans) {
    err.span_label(span, `not allowed on ${what}`);
  }
  generics_args_err_extend(this.tcx(), segments, err, err_extend);
  return err.emit_err();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1506 report_trait_object_addition_traits
HirTyLowerer.prototype.report_trait_object_addition_traits = function (
  this: HirTyLowerer,
  regular_traits: readonly [PolyTraitClause, Span[]][],
): ErrorGuaranteed {
  // we use the last span to point at the traits themselves,
  // and all other preceding spans are trait alias expansions.
  const [first_span, first_alias_spans] = split_last(regular_traits[0]![1]);
  const [second_span, second_alias_spans] = split_last(regular_traits[1]![1]);
  const first = regular_traits[1]![1][0];
  if (first === undefined) panic("called `Option::unwrap()` on a `None` value");
  const err = struct_span_code_err(this.dcx(), first, E0225, "only auto traits can be used as additional traits in a trait object");
  err.span_label(first_span, "first non-auto trait");
  for (const alias_span of first_alias_spans) {
    err.span_label(alias_span, "first non-auto trait comes from this alias");
  }
  err.span_label(second_span, "additional non-auto trait");
  for (const alias_span of second_alias_spans) {
    err.span_label(alias_span, "second non-auto trait comes from this alias");
  }
  err.help(
    `consider creating a new trait with all of these as supertraits and using that trait here instead: \`trait NewTrait: ${regular_traits
      // FIXME: This should `print_sugared`, but also needs to integrate projection bounds...
      .map(([pred]) => display_PolyTraitRefPrintOnlyTraitPath(PolyTraitRef_print_only_trait_path(Binder.map_bound(pred, (pred) => pred.trait_ref))))
      .join(" + ")} {}\``,
  );
  err.note(
    "auto-traits like `Send` and `Sync` are traits that have special properties; for more information on them, visit <https://doc.rust-lang.org/reference/special-types-and-traits.html#auto-traits>",
  );
  return err.emit_err();
};

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1549 report_trait_object_with_no_traits
HirTyLowerer.prototype.report_trait_object_with_no_traits = function (
  this: HirTyLowerer,
  span: Span,
  user_written_clauses: Iterable<[Clause, Span]>,
): ErrorGuaranteed {
  const tcx = this.tcx();
  let trait_alias_span: Span | undefined = undefined;
  for (const [clause] of user_written_clauses) {
    const trait_ref = clause.as_trait_clause();
    if (trait_ref === undefined) continue;
    if (tcx.is_trait_alias(PolyTraitClause_.def_id(trait_ref))) {
      trait_alias_span = tcx.def_span(PolyTraitClause_.def_id(trait_ref));
      break;
    }
  }

  return this.dcx().emit_err(TraitObjectDeclaredWithNoTraits_diagnostic({ span, trait_alias_span }));
};

/// Emit an error for the given associated item constraint.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1566 prohibit_assoc_item_constraint
export function prohibit_assoc_item_constraint(
  cx: HirTyLowerer,
  constraint: hir.AssocItemConstraint,
  segment: [DefId, hir.PathSegment, Span] | undefined,
): ErrorGuaranteed {
  const tcx = cx.tcx();
  let fn_trait_expansion: ParenthesizedFnTraitExpansion | undefined;
  if (segment !== undefined && segment[1].args_().parenthesized === "ParenSugar") {
    const [, segment_, span] = segment;
    fn_trait_expansion = { span, expanded_type: fn_trait_to_string(tcx, segment_, false) };
  } else {
    fn_trait_expansion = undefined;
  }
  const err = cx.dcx().create_err(AssocItemConstraintsNotAllowedHere_diagnostic({ span: constraint.span, fn_trait_expansion }));

  if (
    constraint.kind.$ === "Bound" &&
    constraint.kind.bounds.length === 1 &&
    constraint.kind.bounds[0]!.$ === "Trait" &&
    constraint.kind.bounds[0]!._0.trait_ref.path.res.$ === "Err"
  ) {
    // This was likely a `Vec<foo::Bar>` to `Vec<foo:Bar>` typo. A prior error will have been
    // emitted during resolve, with better context.
    err.downgrade_to_delayed_bug();
  }

  // Emit a suggestion to turn the assoc item binding into a generic arg
  // if the relevant item has a generic param whose name matches the binding name;
  // otherwise suggest the removal of the binding.
  if (segment !== undefined && segment[1].args_().parenthesized === "No") {
    const [def_id, segment_] = segment;
    // Suggests removal of the offending binding
    const suggest_removal = (e: Diag): void => {
      const constraints = segment_.args_().constraints;
      const args = segment_.args_().args;

      // Compute the span to remove based on the position
      // of the binding. We do that as follows:
      //  1. Find the index of the binding in the list of bindings
      //  2. Locate the spans preceding and following the binding.
      //     If it's the first binding the preceding span would be
      //     that of the last arg
      //  3. Using this information work out whether the span
      //     to remove will start from the end of the preceding span,
      //     the start of the next span or will simply be the
      //     span encomassing everything within the generics brackets

      const index = constraints.findIndex((b) => HirId_eq(b.hir_id, constraint.hir_id));
      if (index < 0) {
        panic("a type binding exists but its HIR ID not found in generics");
      }

      const last_arg = args[args.length - 1];
      const preceding_span =
        index > 0 ? constraints[index - 1]!.span : last_arg === undefined ? undefined : HirGenericArg.span(last_arg);

      const next = constraints[index + 1];
      const next_span = next === undefined ? undefined : next.span;

      let removal_span: Span;
      if (preceding_span !== undefined) {
        removal_span = Span.with_lo(constraint.span, Span.hi(preceding_span));
      } else if (next_span !== undefined) {
        removal_span = Span.with_hi(constraint.span, Span.lo(next_span));
      } else {
        const generics_span = segment_.args_().span_ext_();
        if (generics_span === undefined) {
          panic("a type binding exists but generic span is empty");
        }

        removal_span = generics_span;
      }

      // Now emit the suggestion
      e.span_suggestion_verbose(
        removal_span,
        `consider removing this associated item ${AssocItemConstraintKind.descr(constraint.kind)}`,
        "",
        "MaybeIncorrect",
      );
    };

    // Suggest replacing the associated item binding with a generic argument.
    // i.e., replacing `<..., T = A, ...>` with `<..., A, ...>`.
    const suggest_direct_use = (e: Diag, sp: Span): void => {
      const snippet = tcx.sess.source_map().span_to_snippet(sp);
      if (snippet.$ === "Ok") {
        const s = snippet._0.toString();
        e.span_suggestion_verbose(constraint.span, `to use \`${s}\` as a generic argument specify it directly`, s, "MaybeIncorrect");
      }
    };

    // Check if the type has a generic param with the same name
    // as the assoc type name in the associated item binding.
    const generics = tcx.generics_of(def_id) as Generics;
    const matching_param = generics.own_params.find((p) => p.name === constraint.ident.name);

    // Now emit the appropriate suggestion
    if (matching_param !== undefined) {
      const ckind = constraint.kind;
      if (ckind.$ === "Equality" && ckind.term.$ === "Ty" && matching_param.kind.$ === "Type") {
        suggest_direct_use(err, ckind.term._0.span);
      } else if (ckind.$ === "Equality" && ckind.term.$ === "Const" && matching_param.kind.$ === "Const") {
        suggest_direct_use(err, ckind.term._0.span);
      } else if (ckind.$ === "Bound") {
        const bounds_ = ckind.bounds;
        // Suggest `impl<T: Bound> Trait<T> for Foo` when finding
        // `impl Trait<T: Bound> for Foo`

        // Get the parent impl block based on the binding we have
        // and the trait DefId
        let impl_block: hir.Impl | undefined;
        for (const [, node] of tcx.hir_parent_iter(constraint.hir_id)) {
          impl_block = HirNode.impl_block_of_trait(node, def_id);
          if (impl_block !== undefined) break;
        }

        const type_with_constraints = tcx.sess.source_map().span_to_snippet(constraint.span);

        if (impl_block !== undefined && type_with_constraints.$ === "Ok") {
          const type_with_constraints_ = type_with_constraints._0.toString();
          // Filter out the lifetime parameters because
          // they should be declared before the type parameter
          let lifetimes = "";
          for (const bound of bounds_) {
            if (bound.$ === "Outlives") {
              lifetimes += `${display_Lifetime(bound._0)}, `;
            }
          }
          // Figure out a span and suggestion string based on
          // whether there are any existing parameters
          const param_span = impl_block.generics.span_for_param_suggestion();
          const param_decl: [Span, string] =
            param_span !== undefined
              ? [param_span, `, ${lifetimes}${type_with_constraints_}`]
              : [Span.shrink_to_lo(impl_block.generics.span), `<${lifetimes}${type_with_constraints_}>`];
          const suggestions: [Span, string][] = [param_decl, [Span.with_lo(constraint.span, Span.hi(constraint.ident.span)), ""]];

          err.multipart_suggestion("declare the type parameter right after the `impl` keyword", suggestions, "MaybeIncorrect");
        }
      } else {
        suggest_removal(err);
      }
    } else {
      suggest_removal(err);
    }
  }

  return err.emit_err();
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1744 fn_trait_to_string
export function fn_trait_to_string(tcx: TyCtxt, trait_segment: hir.PathSegment, parenthesized: boolean): string {
  let args: string | undefined = undefined;
  const first = trait_segment.args === undefined ? undefined : trait_segment.args.args[0];
  if (first !== undefined && first.$ === "Type") {
    const ty = first._0;
    let r: Result<string, unknown>;
    if (ty.kind.$ === "Tup") {
      // PORT: `.collect::<Result<Vec<_>, _>>()` stops at the first `Err`.
      const parts: string[] = [];
      r = Ok("");
      for (const e of ty.kind._0) {
        const s = tcx.sess.source_map().span_to_snippet(e.span);
        if (s.$ === "Err") {
          r = s;
          break;
        }
        parts.push(s._0.toString());
      }
      if (r.$ === "Ok") r = Ok(parts.join(", "));
    } else {
      const s = tcx.sess.source_map().span_to_snippet(ty.span);
      r = s.$ === "Ok" ? Ok(s._0.toString()) : s;
    }
    if (r.$ === "Ok") {
      const s = r._0;
      // `is_empty()` checks to see if the type is the unit tuple, if so we don't want a comma
      args = parenthesized || s.length === 0 ? `(${s})` : `(${s},)`;
    }
  }
  if (args === undefined) args = "()";

  let ret: string | undefined = undefined;
  for (const c of trait_segment.args_().constraints) {
    let found: string | undefined;
    const ty = c.ident.name === sym.Output ? c.ty() : undefined;
    if (ty !== undefined && ty.span !== tcx.hir_span(trait_segment.hir_id)) {
      const s = tcx.sess.source_map().span_to_snippet(ty.span);
      found = s.$ === "Ok" ? s._0.toString() : undefined;
    } else {
      found = undefined;
    }
    if (found !== undefined) {
      ret = found;
      break;
    }
  }
  if (ret === undefined) ret = "()";

  if (parenthesized) {
    return `${display_Ident(trait_segment.ident)}${args} -> ${ret}`;
  } else {
    return `${display_Ident(trait_segment.ident)}<${args}, Output=${ret}>`;
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1794 GenericsArgsErrExtend
// PORT: hand-written (types.sets.json `hand`): its variants name both `hir::Ty` and `ty::Ty`, which the generator would import
// under the same TS name. No derives.
/// Used for generics args error extend.
export type GenericsArgsErrExtend =
  | { readonly $: "EnumVariant"; qself: hir.Ty; assoc_segment: hir.PathSegment; adt_def: AdtDef }
  | { readonly $: "OpaqueTy" }
  | { readonly $: "PrimTy"; _0: hir.PrimTy }
  | { readonly $: "SelfTyAlias"; def_id: DefId; span: Span }
  | { readonly $: "SelfTyParam"; _0: Span }
  | { readonly $: "Param"; _0: DefId }
  | { readonly $: "DefVariant"; _0: readonly hir.PathSegment[] }
  | { readonly $: "None" };
/** Unit variants of `GenericsArgsErrExtend`, shared frozen singletons. */
export const GenericsArgsErrExtend = {
  OpaqueTy: Object.freeze({ $: "OpaqueTy" as const }),
  None: Object.freeze({ $: "None" as const }),
};

// PORT: `segments: impl Iterator<Item = &PathSegment> + Clone` is iterated once here: an `Iterable`.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:1812 generics_args_err_extend
export function generics_args_err_extend(tcx: TyCtxt, segments: Iterable<hir.PathSegment>, err: Diag, err_extend: GenericsArgsErrExtend): void {
  switch (err_extend.$) {
    case "EnumVariant": {
      const { qself, assoc_segment, adt_def } = err_extend;
      err.note("enum variants can't have type parameters");
      const type_name = tcx.item_name(adt_def.did());
      const msg_ = `you might have meant to specify type parameters on enum \`${display_Symbol(type_name)}\``;
      const args = assoc_segment.args;
      if (args === undefined) {
        return;
      }
      // Get the span of the generics args *including* the leading `::`.
      // We do so by stretching args.span_ext to the left by 2. Earlier
      // it was done based on the end of assoc segment but that sometimes
      // led to impossible spans and caused issues like #116473
      const args_span = Span.with_lo(args.span_ext, (Span.lo(args.span_ext) - 2) as BytePos);
      if ((tcx.generics_of(adt_def.did()) as Generics).is_empty()) {
        // FIXME(estebank): we could also verify that the arguments being
        // work for the `enum`, instead of just looking if it takes *any*.
        err.span_suggestion_verbose(args_span, `${display_Symbol(type_name)} doesn't have generic parameters`, "", "MachineApplicable");
        return;
      }
      const snippet_r = tcx.sess.source_map().span_to_snippet(args_span);
      if (snippet_r.$ !== "Ok") {
        err.note(msg_);
        return;
      }
      const snippet = snippet_r._0.toString();
      let qself_sugg_span: Span;
      let is_self: boolean;
      if (qself.kind.$ === "Path" && qself.kind._0.$ === "Resolved") {
        const path = qself.kind._0._1;
        // If the path segment already has type params, we want to overwrite
        // them.
        const segs = path.segments;
        const prev = segs.length >= 2 ? segs[segs.length - 2]! : undefined;
        if (prev !== undefined && prev.res.$ === "Def" && prev.res._0.$ === "Enum") {
          // `segment` is the previous to last element on the path,
          // which would normally be the `enum` itself, while the last
          // `_` `PathSegment` corresponds to the variant.
          const { ident, args } = prev;
          [qself_sugg_span, is_self] = [
            // We need to include the `::` in `Type::Variant::<Args>`
            // to point the span to `::<Args>`, not just `<Args>`.
            Span.to(Span.shrink_to_hi(ident.span), args === undefined ? Span.shrink_to_hi(ident.span) : args.span_ext),
            false,
          ];
        } else if (segs.length === 1) {
          const segment = segs[0]!;
          [qself_sugg_span, is_self] = [
            // We need to include the `::` in `Type::Variant::<Args>`
            // to point the span to `::<Args>`, not just `<Args>`.
            Span.to(
              Span.shrink_to_hi(segment.ident.span),
              segment.args === undefined ? Span.shrink_to_hi(segment.ident.span) : segment.args.span_ext,
            ),
            kw.SelfUpper === segment.ident.name,
          ];
        } else {
          err.note(msg_);
          return;
        }
      } else {
        err.note(msg_);
        return;
      }
      const suggestion: [Span, string][] = [
        is_self
          ? // Account for people writing `Self::Variant::<Args>`, where
            // `Self` is the enum, and suggest replacing `Self` with the
            // appropriate type: `Type::<Args>::Variant`.
            [qself.span, `${display_Symbol(type_name)}${snippet}`]
          : [qself_sugg_span, snippet],
        [args_span, ""],
      ];
      err.multipart_suggestion(msg_, suggestion, "MaybeIncorrect");
      break;
    }
    case "DefVariant": {
      const segments_ = err_extend._0;
      const args: Span[] = [];
      for (const segment of segments_) {
        const res = segment.res;
        if (
          res.$ === "Def" &&
          ((res._0.$ === "Ctor" && res._0._0 === "Variant") || res._0.$ === "Variant" || res._0.$ === "Enum")
        ) {
          const s = segment.args_().span_ext_();
          if (s !== undefined) args.push(Span.with_lo(s, Span.hi(segment.ident.span)));
        }
      }
      if (args.length > 1) {
        const span = args[args.length - 1];
        if (span !== undefined) {
          err.note(
            "generic arguments are not allowed on both an enum and its variant's path segments simultaneously; they are only valid in one place or the other",
          );
          err.span_suggestion_verbose(span, "remove the generics arguments from one of the path segments", "", "MaybeIncorrect");
        }
      }
      break;
    }
    case "PrimTy": {
      const prim_ty = err_extend._0;
      const name = PrimTy.name_str(prim_ty);
      for (const segment of segments) {
        const args = segment.args;
        if (args !== undefined) {
          err.span_suggestion_verbose(
            Span.to(Span.shrink_to_hi(segment.ident.span), args.span_ext),
            `primitive type \`${name}\` doesn't have generic parameters`,
            "",
            "MaybeIncorrect",
          );
        }
      }
      break;
    }
    case "OpaqueTy":
      err.note("`impl Trait` types can't have type parameters");
      break;
    case "Param": {
      const def_id = err_extend._0;
      const span = tcx.def_ident_span(def_id);
      if (span === undefined) panic("called `Option::unwrap()` on a `None` value");
      const kind = tcx.def_descr(def_id);
      const name = tcx.item_name(def_id);
      err.span_note(span, `${kind} \`${display_Symbol(name)}\` defined here`);
      break;
    }
    case "SelfTyParam": {
      const span = err_extend._0;
      err.span_suggestion_verbose(span, "the `Self` type doesn't accept type parameters", "", "MaybeIncorrect");
      break;
    }
    case "SelfTyAlias": {
      const { span } = err_extend;
      let def_id = err_extend.def_id;
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.at(span).type_of(def_id) as EarlyBinder<Ty>));
      const span_of_impl = tcx.span_of_impl(def_id);
      const kind_ = ty.kind();
      if (kind_.$ !== "Adt") return;
      const self_def: AdtDef = kind_._0;
      def_id = self_def.did();

      const type_name = tcx.item_name(def_id);
      const span_of_ty = tcx.def_ident_span(def_id);
      const generics = (tcx.generics_of(def_id) as Generics).count();

      const msg_ = `\`Self\` is of type \`${display_Ty(ty)}\``;
      if (span_of_impl.$ === "Ok" && span_of_ty !== undefined) {
        const i_sp = span_of_impl._0;
        const t_sp = span_of_ty;
        const span: MultiSpan = MultiSpan.from_spans([t_sp]);
        span.push_span_label(i_sp, `\`Self\` is on type \`${display_Symbol(type_name)}\` in this \`impl\``);
        let postfix = "";
        if (generics === 0) {
          postfix = ", which doesn't have generic parameters";
        }
        span.push_span_label(t_sp, `\`Self\` corresponds to this type${postfix}`);
        err.span_note(span, msg_);
      } else {
        err.note(msg_);
      }
      for (const segment of segments) {
        const args = segment.args;
        if (args !== undefined && segment.ident.name === kw.SelfUpper) {
          if (generics === 0) {
            // FIXME(estebank): we could also verify that the arguments being
            // work for the `enum`, instead of just looking if it takes *any*.
            err.span_suggestion_verbose(
              Span.to(Span.shrink_to_hi(segment.ident.span), args.span_ext),
              "the `Self` type doesn't accept type parameters",
              "",
              "MachineApplicable",
            );
            return;
          } else {
            err.span_suggestion_verbose(
              segment.ident.span,
              `the \`Self\` type doesn't accept type parameters, use the concrete type's name \`${display_Symbol(type_name)}\` instead if you want to specify its type parameters`,
              display_Symbol(type_name),
              "MaybeIncorrect",
            );
          }
        }
      }
      break;
    }
    default:
      break;
  }
}

// errors.rs:2019 `struct AmbiguityBetweenVariantAndAssocItem`: generated (errors.gen.ts).

// impl<'a, 'tcx> rustc_errors::Diagnostic<'a> for AmbiguityBetweenVariantAndAssocItem<'tcx>
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:2031 into_diag
export function AmbiguityBetweenVariantAndAssocItem_into_diag(
  self: AmbiguityBetweenVariantAndAssocItem,
  dcx: DiagCtxtHandle,
  level: Level,
): Diag {
  const { variant_def_id, item_def_id, span, segment_ident, bound_def_id, self_ty, tcx, mode } = self;
  const lint = Diag.new(dcx, level, "ambiguous associated item");

  const could_refer_to = (kind: DefKind, def_id: DefId, also: string): void => {
    const note_msg = `\`${display_Ident(segment_ident)}\` could${also} refer to the ${tcx.def_kind_descr(kind, def_id)} defined here`;
    lint.span_note(tcx.def_span(def_id), note_msg);
  };

  could_refer_to(DefKind.Variant, variant_def_id, "");
  could_refer_to(LowerTypeRelativePathMode.def_kind_for_diagnostics(mode), item_def_id, " also");

  lint.span_suggestion_verbose(
    span,
    "use fully-qualified syntax",
    `<${display_Ty(self_ty)} as ${display_Symbol(tcx.item_name(bound_def_id))}>::${display_Ident(segment_ident)}`,
    "MachineApplicable",
  );
  return lint;
}
/** `AmbiguityBetweenVariantAndAssocItem` as a `Diagnostic` trait object. */
export function AmbiguityBetweenVariantAndAssocItem_diagnostic(self: AmbiguityBetweenVariantAndAssocItem): Diagnostic {
  return { into_diag: (dcx, level) => AmbiguityBetweenVariantAndAssocItem_into_diag(self, dcx, level) };
}

// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:2071 assoc_tag_str
export function assoc_tag_str(assoc_tag: AssocTag): string {
  switch (assoc_tag) {
    case "Fn":
      return "function";
    case "Const":
      return "constant";
    case "Type":
      return "type";
  }
}

/// Computes the `pat.between(ty)` span for the "use `=`" suggestion on `let pat: ty`.
/// Returns `None` if `pat` and `ty` are in incompatible macro contexts (e.g. `pat` is a
/// metavariable from the call site while `ty` lives in the macro body), in which case no
/// suggestion is emitted.
// rustc: compiler/rustc_hir_analysis/src/hir_ty_lowering/errors.rs:2083 eq_ctxt_suggestion_span
export function eq_ctxt_suggestion_span(pat: Span, ty: Span): Span | undefined {
  const ty2 = Span.find_ancestor_in_same_ctxt(ty, pat);
  if (ty2 !== undefined && Span.hi(pat) <= Span.lo(ty2)) {
    return Span.between(pat, ty2);
  }
  const pat2 = Span.find_ancestor_in_same_ctxt(pat, ty);
  if (pat2 !== undefined && Span.hi(pat2) <= Span.lo(ty)) {
    return Span.between(pat2, ty);
  }
  return undefined;
}

// ---- local helpers (not ports) ----

/** `tcx.associated_items(def_id)` with the query value typed (PORT: queries.gen.ts types it `unknown`). */
function associated_items(tcx: TyCtxt, def_id: DefId): AssocItems {
  return tcx.associated_items(def_id) as AssocItems;
}

/** `Vec::dedup` on strings: drops consecutive duplicates. */
function dedup(v: string[]): string[] {
  const out: string[] = [];
  for (const s of v) if (out.length === 0 || out[out.length - 1] !== s) out.push(s);
  return out;
}

/** `slice::split_last().unwrap()`. */
function split_last<T>(v: readonly T[]): [T, readonly T[]] {
  if (v.length === 0) panic("called `Option::unwrap()` on a `None` value");
  return [v[v.length - 1]!, v.slice(0, -1)];
}

/** Key of a `(Symbol, AssocTag)` tuple in a `KeyedMap`. */
function name_tag_key([name, tag]: [Symbol, AssocTag]): string {
  return `${name}:${tag}`;
}

function unreachable_(): never {
  return panic("internal error: entered unreachable code");
}

/** `Display for ty::Binder<'tcx, TraitRefPrintOnlyTraitPath>` (rustc_type_ir ir_print.rs through `IrPrint` for `TyCtxt`). */
function display_PolyTraitRefPrintOnlyTraitPath(self: Binder<TraitRefPrintOnlyTraitPath>): string {
  return display_Binder(self, ir_print_Binder(print_TraitRefPrintOnlyTraitPath, fold_TraitRefPrintOnlyTraitPath_));
}

/** `Display for ty::Binder<'tcx, TraitRefPrintSugared>`. */
function display_PolyTraitRefPrintSugared(self: Binder<TraitRefPrintSugared>): string {
  return display_Binder(self, ir_print_Binder(print_TraitRefPrintSugared, fold_TraitRefPrintSugared_));
}

/** `Print for ty::Binder<'tcx, TraitRefPrintOnlyTraitPath>` (pretty.rs:2960). */
function print_PolyTraitRefPrintOnlyTraitPath(self: Binder<TraitRefPrintOnlyTraitPath>, p: import("../../rustc_middle/ty/print/pretty.ts").PrettyPrinter) {
  return print_Binder(self, p, print_TraitRefPrintOnlyTraitPath, fold_TraitRefPrintOnlyTraitPath_);
}

/** `impl<T: Lift + Print> IrPrint<Binder<T>> for TyCtxt` (ty/print/mod.rs:423) for one `T`. */
function ir_print_Binder<T>(
  print_T: (self: T, p: import("../../rustc_middle/ty/print/pretty.ts").PrettyPrinter) => ReturnType<Print<T>>,
  d_T: TypeFoldable<T>,
): IrPrint<Binder<T>> {
  const print_B = (v: Binder<T>, p: import("../../rustc_middle/ty/print/pretty.ts").PrettyPrinter) => print_Binder(v, p, print_T, d_T);
  return {
    print: (t, fmt) => IrPrint_print(t, fmt, print_B),
    print_debug: (t, fmt) => IrPrint_print(t, fmt, print_B),
  };
}

/** PORT: ty/decls.ts's `Print<T>` is still a pending alias of print/mod.ts's (pretty.ts `as_decls_print`). */
function as_decls_print<T>(d: Print<T>): import("../../rustc_middle/ty/decls.ts").Print<T> {
  return d as unknown as import("../../rustc_middle/ty/decls.ts").Print<T>;
}

// ==== stand-ins (PORT: pending other lanes). Root deletes each when its owner lands and points the uses at the real port. ====

/** `FulfillmentError::root_obligation.predicate` (rustc_trait_selection, wave 17; `FulfillmentError` is pending). */
function FulfillmentError_root_obligation_predicate(_e: FulfillmentError): Predicate {
  return unported("rustc_trait_selection::traits::FulfillmentError::root_obligation");
}

/** rustc_trait_selection traits/dyn_compatibility.rs `dyn_compatibility_violations_for_assoc_item` (crate not ported). */
function dyn_compatibility_violations_for_assoc_item(_tcx: TyCtxt, _trait_def_id: DefId, _item: AssocItem): unknown[] {
  return unported("rustc_trait_selection::traits::dyn_compatibility_violations_for_assoc_item");
}

/** rustc_trait_selection error_reporting/traits/mod.rs `report_dyn_incompatibility` (crate not ported). */
function report_dyn_incompatibility(_tcx: TyCtxt, _span: Span, _hir_id: HirId | undefined, _trait_def_id: DefId, _violations: unknown[]): Diag {
  return unported("rustc_trait_selection::error_reporting::traits::report_dyn_incompatibility");
}

/** pretty.rs:2981 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitRefPrintOnlyTraitPath` (codegen pending, ty-print-b "For root"). */
const fold_TraitRefPrintOnlyTraitPath_: TypeFoldable<TraitRefPrintOnlyTraitPath> = {
  visit_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintOnlyTraitPath: TypeVisitable (derive, codegen pending)"),
  try_fold_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintOnlyTraitPath: TypeFoldable (derive, codegen pending)"),
  fold_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintOnlyTraitPath: TypeFoldable (derive, codegen pending)"),
};

/** pretty.rs:3001 `#[derive(TypeFoldable, TypeVisitable)]` of `TraitRefPrintSugared` (codegen pending). */
const fold_TraitRefPrintSugared_: TypeFoldable<TraitRefPrintSugared> = {
  visit_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintSugared: TypeVisitable (derive, codegen pending)"),
  try_fold_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintSugared: TypeFoldable (derive, codegen pending)"),
  fold_with: () => unported("rustc_middle::ty::print::pretty::TraitRefPrintSugared: TypeFoldable (derive, codegen pending)"),
};
