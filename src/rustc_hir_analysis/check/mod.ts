// Port of compiler/rustc_hir_analysis/src/check/mod.rs (lane check-check, wave 17).
/*!

# typeck: check phase

Within the check phase of type check, we check each item one at a time
(bodies of function expressions are checked as part of the containing
function). Inference is used to supply types wherever they are unknown.

By far the most complex case is checking the body of a function. This
can be broken down into several distinct phases:

- gather: creates type variables to represent the type of each local
  variable and pattern binding.

- main: the main pass does the lion's share of the work: it
  determines the types of all expressions, resolves
  methods, checks for most invalid conditions, and so forth. In
  some cases, where a type is unknown, it may create a type or region
  variable and use that as the type of an expression.

  In the process of checking, various constraints will be placed on
  these type variables through the subtyping relationships requested
  through the `demand` module. The `infer` module is in charge
  of resolving those constraints.

- regionck: after main is complete, the regionck pass goes over all
  types looking for regions and making sure that they did not escape
  into places where they are not in scope. This may also influence the
  final assignments of the various region variables if there is some
  flexibility.

- writeback: writes the final types within a function body, replacing
  type variables with their final inferred types. These final types
  are written into the `tcx.node_types` table, which should *never* contain
  any reference to a type variable.

## Intermediate types

While type checking a function, the intermediate types for the
expressions, blocks, and so forth contained within the function are
stored in `fcx.node_types` and `fcx.node_args`. These types
may contain unresolved type variables. After type checking is
complete, the functions in the writeback module are used to take the
types from this table, resolve them, and then write them into their
permanent home in the type context `tcx`.

This means that during inferencing you should use `fcx.write_ty()`
and `fcx.expr_ty()` / `fcx.node_ty()` to write/obtain the types of
nodes within the function.

The types of top-level items, which never contain unbound type
variables, are stored directly into the `tcx` typeck_results.

N.B., a type variable is not the same thing as a type parameter. A
type variable is an instance of a type parameter. That is,
given a generic function `fn foo<T>(t: T)`, while checking the
function `foo`, the type `ty_param(0)` refers to the type `T`, which
is treated in abstract. However, when `foo()` is called, `T` will be
instantiated with a fresh type variable `N`. This variable will
eventually be resolved to some concrete type (which might itself be
a type parameter).

*/
//
// Init order: top-level code here touches only other crates; ./check.ts and the other rustc_hir_analysis modules are
// read inside function bodies only.
//
// PORT: as check.ts, code that needs a wave-17 lane outside this lane's base stops with `unported(..)` at its first use;
// the stand-ins are at the end of this file ("Stand-ins"):
// - check/always_applicable.rs, check/region.rs (lane check-region-intrinsic): `check_drop_impl`, `region_scope_tree`;
// - check/compare_impl_item.rs (lane check-compare): `compare_impl_item`, `collect_return_position_impl_trait_in_trait_tys`;
// - check/wfcheck.rs (lanes check-wf-a/-b): `check_type_wf`, `check_well_formed`;
// - rustc_trait_selection (lanes trait-sel-*, error reporting wave 19): `ObligationCtxt`, `ReturnsVisitor`,
//   `TypeErrCtxt::ty_kind_suggestion`.
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { type GateIssue } from "../../rustc_feature/lib.ts";
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import { pluralize } from "../../rustc_lint_defs/lib.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems, AssocTag } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Const, GenericArg, Region } from "../../rustc_middle/ty/decls.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { GenericClauses, type Generics, GenericParamDefKind } from "../../rustc_middle/ty/generics.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/decls.ts";
import type { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { type ToTrace, ToTrace_PolyFnSig } from "../../rustc_infer/infer/at.ts";
import type { ValuePairs } from "../../rustc_infer/infer/mod.gen.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import type { Diag, Diagnostic } from "../../rustc_errors/lib.ts";
import { Asyncness, type AsyncDestructor, type Destructor, ParamEnv, type ParamEnvAnd, Ty } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import { display_Term, display_Ty, with_types_for_signature } from "../../rustc_middle/ty/print/pretty.ts";
import { display_Const, display_Region } from "../../rustc_type_ir/ir_print.ts";
import { Const as ConstC } from "../../rustc_type_ir/sty/mod.ts";
import { as_interner, type ProjectionClause, TraitClause, TraitRef } from "../../rustc_type_ir/predicate.ts";
import { AliasTerm } from "../../rustc_type_ir/term_kind.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { Safety } from "../../rustc_hir/hir.ts";
import { debug_OwnerNode } from "../../rustc_hir/hir.gen.ts";
import { PLAIN } from "../../std/fmt.ts";
import { add_feature_diagnostics_for_issue } from "../../rustc_session/diagnostics.ts";
import { CRATE_DEF_ID, type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import type { BytePos } from "../../rustc_span/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { display_Ident, type Ident, kw, Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../../rustc_type_ir/decls.ts";
import { fold_Binder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { panic, unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { InferCtxt } from "../decls.ts";
import * as diagnostics from "../diagnostics.ts";
import type { MissingTraitItemLabel, MissingTraitItemSuggestion, MissingTraitItemSuggestionNone, MissingTraitItemSuggestionUnstable } from "../diagnostics.ts";
import * as check from "./check.ts";

// pub mod always_applicable;   (wave 17: check-region-intrinsic)
// mod check;
// mod compare_eii;             (wave 17: check-compare)
// mod compare_impl_item;       (wave 17: check-compare)
// mod entry;                   (wave 17)
// pub mod intrinsic;           (wave 17: check-region-intrinsic)
// mod region;                  (wave 17: check-region-intrinsic)
// pub mod wfcheck;             (wave 17: check-wf-a/-b)

// pub use check::check_abi;
export { check_abi } from "./check.ts";

/// Adds query implementations to the [Providers] vtable, see [`rustc_middle::query`]
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:112 provide
export function provide(providers: Providers): void {
  // `*providers = Providers { .., ..*providers }`
  providers.adt_destructor = adt_destructor;
  providers.adt_async_destructor = adt_async_destructor;
  // PORT: the providers below are fns of other wave-17 lanes' files (not in this lane's base); each lane's merge
  // uncomments its line(s).
  // providers.region_scope_tree = region::region_scope_tree;                (check/region.rs, lane check-region-intrinsic)
  // providers.collect_return_position_impl_trait_in_trait_tys =
  //   compare_impl_item::collect_return_position_impl_trait_in_trait_tys;   (check/compare_impl_item.rs, lane check-compare)
  // providers.compare_impl_item = compare_impl_item::compare_impl_item;     (lane check-compare)
  providers.check_coroutine_obligations = check.check_coroutine_obligations;
  providers.check_potentially_region_dependent_goals = check.check_potentially_region_dependent_goals;
  // providers.check_type_wf = wfcheck::check_type_wf;                       (check/wfcheck.rs, lanes check-wf-a/-b)
  // providers.check_well_formed = wfcheck::check_well_formed;               (lanes check-wf-a/-b)
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:127 adt_destructor
function adt_destructor(tcx: TyCtxt, def_id: LocalDefId): Destructor | undefined {
  const dtor = tcx.calculate_dtor(def_id, always_applicable_check_drop_impl);
  if (dtor === undefined && tcx.features().async_drop()) {
    const async_dtor = adt_async_destructor(tcx, def_id);
    if (async_dtor !== undefined) {
      // When type has AsyncDrop impl, but doesn't have Drop impl, generate error
      const span = tcx.def_span(async_dtor.impl_did);
      tcx.dcx().emit_err(diagnostics.AsyncDropWithoutSyncDrop_diagnostic({ span }));
    }
  }
  return dtor;
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:139 adt_async_destructor
function adt_async_destructor(tcx: TyCtxt, def_id: LocalDefId): AsyncDestructor | undefined {
  const result = tcx.calculate_async_dtor(def_id, always_applicable_check_drop_impl);
  // Async drop in libstd/libcore would become insta-stable — catch that mistake.
  if (result !== undefined && tcx.features().staged_api()) {
    return span_bug(tcx.def_span(def_id), "don't use async drop in libstd, it becomes insta-stable");
  }
  return result;
}

/// Given a `DefId` for an opaque type in return position, find its parent item's return
/// expressions.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:150 get_owner_return_paths
export function get_owner_return_paths(tcx: TyCtxt, def_id: LocalDefId): [LocalDefId, ReturnsVisitor] | undefined {
  const hir_id = tcx.local_def_id_to_hir_id(def_id);
  const parent_id = tcx.hir_get_parent_item(hir_id).def_id;
  const body_id = hir.Node.body_id(tcx.hir_node_by_def_id(parent_id));
  if (body_id === undefined) return undefined;
  const body = tcx.hir_body(body_id);
  const visitor = ReturnsVisitor_default();
  visitor.visit_body(body);
  return [parent_id, visitor];
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:164 maybe_check_static_with_link_section
export function maybe_check_static_with_link_section(tcx: TyCtxt, id: LocalDefId): void {
  // Only restricted on wasm target for now
  if (!tcx.sess.target.is_like_wasm) {
    return;
  }

  // If `#[link_section]` is missing, then nothing to verify
  const link_section = (tcx.codegen_fn_attrs(id) as CodegenFnAttrs).link_section;
  if (link_section === undefined) {
    return;
  }

  // For the wasm32 target statics with `#[link_section]` other than `.init_array`
  // are placed into custom sections of the final output file, but this isn't like
  // custom sections of other executable formats. Namely we can only embed a list
  // of bytes, nothing with provenance (pointers to anything else). If any
  // provenance show up, reject it here.
  // `#[link_section]` may contain arbitrary, or even undefined bytes, but it is
  // the consumer's responsibility to ensure all bytes that have been read
  // have defined values.
  //
  // The `.init_array` section is left to go through the normal custom section code path.
  // When dealing with `.init_array` wasm-ld currently has several limitations. This manifests
  // in workarounds in user-code.
  //
  //   * The linker fails to merge multiple items in a crate into the .init_array section.
  //     To work around this, a single array can be used placing multiple items in the array.
  //     #[link_section = ".init_array"]
  //     static FOO: [unsafe extern "C" fn(); 2] = [ctor, ctor];
  //   * Even symbols marked used get gc'd from dependant crates unless at least one symbol
  //     in the crate is marked with an `#[export_name]`
  //
  //  Once `.init_array` support in wasm-ld is complete, the user code workarounds should
  //  continue to work, but would no longer be necessary.

  const alloc = tcx.eval_static_initializer(LocalDefId.to_def_id(id));
  void alloc;
  // if let Ok(alloc) = tcx.eval_static_initializer(id.to_def_id())
  //     && !alloc.inner().provenance().ptrs().is_empty()
  //     && !link_section.as_str().starts_with(".init_array")
  // {
  //     let msg = "statics with a custom `#[link_section]` must be a \
  //                     simple list of bytes on the wasm target with no \
  //                     extra levels of indirection such as references";
  //     tcx.dcx().span_err(tcx.def_span(id), msg);
  // }
  // PORT: `ConstAllocation` (rustc_middle mir/interpret, M4) is the value of `eval_static_initializer`.
  return unported("rustc_middle::mir::interpret::ConstAllocation (the value of `eval_static_initializer`, M4)");
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:209 impl_suggestion_span
function impl_suggestion_span(tcx: TyCtxt, impl_def_id: LocalDefId): Span {
  const full_impl_span = tcx.hir_span_with_body(tcx.local_def_id_to_hir_id(impl_def_id));
  const snippet = tcx.sess.source_map().span_to_snippet(full_impl_span);
  if (snippet.$ === "Ok" && snippet._0.toString().endsWith("}")) {
    // `Span` before impl block closing brace.
    const hi = (Span.hi(full_impl_span) - 1) as BytePos;
    // Point at the place right before the closing brace of the relevant `impl` to suggest
    // adding the associated item at the end of its body.
    return Span.with_hi(Span.with_lo(full_impl_span, hi), hi);
  } else {
    return Span.shrink_to_hi(full_impl_span);
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:224 missing_items_suggestions
function missing_items_suggestions(
  tcx: TyCtxt,
  impl_def_id: LocalDefId,
  missing_items_: readonly AssocItem[],
): [string, MissingTraitItemSuggestion[], MissingTraitItemSuggestionNone[], MissingTraitItemSuggestionUnstable[], MissingTraitItemLabel[]] {
  const missing_items = missing_items_.filter((trait_item) => !AssocItem.is_impl_trait_in_trait(trait_item));

  const missing_items_msg = missing_items.map((trait_item) => Symbol.as_str(AssocItem.name(trait_item))).join("`, `");

  const sugg_sp = impl_suggestion_span(tcx, impl_def_id);

  // Obtain the level of indentation ending in `sugg_sp`.
  const padding = tcx.sess.source_map().indentation_before(sugg_sp) ?? "";
  const [missing_trait_item, missing_trait_item_none, missing_trait_item_unstable, missing_trait_item_label]: [
    MissingTraitItemSuggestion[],
    MissingTraitItemSuggestionNone[],
    MissingTraitItemSuggestionUnstable[],
    MissingTraitItemLabel[],
  ] = [[], [], [], []];

  for (const trait_item of missing_items) {
    const snippet = with_types_for_signature(() =>
      suggestion_signature(tcx, trait_item, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(impl_def_id) as EarlyBinder<TraitRef>))),
    );
    const code = `${padding}${snippet}\n${padding}`;
    const span = tcx.hir_span_if_local(trait_item.def_id);
    if (span !== undefined) {
      missing_trait_item_label.push({ span, item: AssocItem.name(trait_item) });
      missing_trait_item.push({ span: sugg_sp, code, snippet });
    } else {
      const r = tcx.eval_stability(trait_item.def_id, undefined, sugg_sp, undefined);
      if (r.$ === "Deny") {
        const feature = r.feature;
        missing_trait_item_unstable.push({ span: sugg_sp, code, snippet, feature });
      } else {
        missing_trait_item_none.push({ span: sugg_sp, code, snippet });
      }
    }
  }

  return [missing_items_msg, missing_trait_item, missing_trait_item_none, missing_trait_item_unstable, missing_trait_item_label];
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:299 missing_items_err
export function missing_items_err(tcx: TyCtxt, impl_def_id: LocalDefId, missing_items: readonly AssocItem[]): void {
  const [missing_items_msg, missing_trait_item, missing_trait_item_none, missing_trait_item_unstable, missing_trait_item_label] = missing_items_suggestions(
    tcx,
    impl_def_id,
    missing_items,
  );

  const span_ = tcx.span_of_impl(LocalDefId.to_def_id(impl_def_id));
  if (span_.$ !== "Ok") return panic("called `Result::unwrap()` on an `Err` value");
  tcx.dcx().emit_err(
    diagnostics.MissingTraitItem_diagnostic({
      span: span_._0,
      missing_items_msg,
      missing_trait_item_label,
      missing_trait_item,
      missing_trait_item_none,
      missing_trait_item_unstable,
    }),
  );
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:318 missing_items_must_implement_one_of_err
export function missing_items_must_implement_one_of_err(
  tcx: TyCtxt,
  impl_def_id: LocalDefId,
  missing_items_: Iterable<Symbol>,
  annotation_span: Span | undefined,
): ErrorGuaranteed {
  // Look up the associated items so we can use them to emit better errors.
  const trait_def_id = tcx.impl_trait_id(impl_def_id);
  const assoc_items = tcx.associated_items(trait_def_id) as AssocItems;
  const missing_items: AssocItem[] = [];
  for (const s of missing_items_) {
    for (const i of AssocItems.filter_by_name_unhygienic_and_kind(assoc_items, s, AssocTag.Fn)) {
      missing_items.push(i);
    }
  }

  const [missing_items_msg, missing_trait_item, missing_trait_item_none, missing_trait_item_unstable, missing_trait_item_label] = missing_items_suggestions(
    tcx,
    impl_def_id,
    missing_items,
  );

  return tcx.dcx().emit_err(
    diagnostics.MissingOneOfTraitItem_diagnostic({
      span: tcx.def_span(impl_def_id),
      note: annotation_span,
      missing_items_msg,
      missing_trait_item_label,
      missing_trait_item,
      missing_trait_item_unstable,
      missing_trait_item_none,
    }),
  );
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:351 default_body_is_unstable
export function default_body_is_unstable(
  tcx: TyCtxt,
  impl_span: Span,
  item_did: DefId,
  feature: Symbol,
  reason: Symbol | undefined,
  issue: number | undefined,
): void {
  const missing_item_name = tcx.item_ident(item_did);
  let [some_note, none_note, reason_str] = [false, false, ""];
  if (reason !== undefined) {
    const r = reason;
    some_note = true;
    reason_str = Symbol.as_str(r);
  } else {
    none_note = true;
  }

  const err = tcx.dcx().create_err(
    diagnostics.MissingTraitItemUnstable_diagnostic({
      span: impl_span,
      some_note,
      none_note,
      missing_item_name,
      feature,
      reason: reason_str,
    }),
  );

  const inject_span = item_did.is_local() ? tcx.crate_level_attribute_injection_span() : undefined;
  const gate_issue: GateIssue = { $: "Library", _0: issue };
  add_feature_diagnostics_for_issue(err, tcx.sess, feature, gate_issue, false, inject_span);

  err.emit();
}

/// Re-sugar `ty::GenericClauses` in a way suitable to be used in structured suggestions.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:392 bounds_from_generic_clauses
function bounds_from_generic_clauses(tcx: TyCtxt, clauses: Iterable<[Clause, Span]>, assoc: AssocItem): [string, string] {
  const types = new Map<Ty, DefId[]>();
  const regions = new Map<Region, Region[]>();
  const projections: Binder<ProjectionClause>[] = [];
  for (const [clause] of clauses) {
    // debug!("clause {:?}", clause);
    const bound_clause = clause.kind();
    const k = Binder.skip_binder(bound_clause);
    switch (k.$) {
      case "Trait": {
        const trait_predicate = k._0;
        const self_ty = TraitClause.self_ty(trait_predicate);
        let entry = types.get(self_ty);
        if (entry === undefined) {
          entry = [];
          types.set(self_ty, entry);
        }
        const def_id = TraitClause.def_id(trait_predicate);
        if (!tcx.is_default_trait(def_id) && !tcx.is_lang_item(def_id, LangItem.Sized)) {
          // Do not add that restriction to the list if it is a positive requirement.
          entry.push(TraitClause.def_id(trait_predicate));
        }
        break;
      }
      case "Projection": {
        const projection_pred = k._0;
        projections.push(Binder.rebind(bound_clause, projection_pred));
        break;
      }
      case "RegionOutlives": {
        const [a, b] = [k._0._0, k._0._1];
        let entry = regions.get(a);
        if (entry === undefined) {
          entry = [];
          regions.set(a, entry);
        }
        entry.push(b);
        break;
      }
      default:
        break;
    }
  }

  const where_clauses: string[] = [];
  const generics = tcx.generics_of(assoc.def_id) as Generics;
  const params = generics.own_params
    .filter((p) => !GenericParamDefKind.is_synthetic(p.kind))
    .map((p): string => {
      const arg: GenericArg = tcx.mk_param_from_def(p);
      if (arg instanceof Ty) {
        const ty = arg;
        const bounds = types.get(ty) ?? [];
        const bounds_str: string[] = [];
        for (const bound of bounds) {
          const projections_str: string[] = [];
          for (const projection of projections) {
            const p = Binder.skip_binder(projection);
            if (DefId_eq(bound, AliasTerm.trait_def_id(p.projection_term, as_interner(tcx))) && AliasTerm.self_ty(p.projection_term) === ty) {
              const name = tcx.item_name(AliasTerm.expect_projection_def_id(p.projection_term));
              projections_str.push(`${Symbol.as_str(name)} = ${display_Term(p.term)}`);
            }
          }
          const bound_def_path = tcx.is_lang_item(bound, LangItem.MetaSized) ? "?Sized" : tcx.def_path_str(bound);
          if (projections_str.length === 0) {
            where_clauses.push(`${display_Ty(ty)}: ${bound_def_path}`);
          } else {
            bounds_str.push(`${bound_def_path}<${projections_str.join(", ")}>`);
          }
        }
        if (bounds_str.length === 0) {
          return display_Ty(ty);
        } else {
          return `${display_Ty(ty)}: ${bounds_str.join(" + ")}`;
        }
      } else if (arg instanceof ConstC) {
        const ct: Const = arg;
        return `const ${display_Const(ct)}: ${display_Ty(EarlyBinder.skip_binder(tcx.type_of(p.def_id) as EarlyBinder<Ty>))}`;
      } else {
        const region = arg as Region;
        const v = regions.get(region);
        if (v !== undefined && v.length !== 0) {
          return `${display_Region(region)}: ${v.map(display_Region).join(" + ")}`;
        } else {
          return display_Region(region);
        }
      }
    });
  for (const [ty, bounds] of types) {
    if (ty.kind().$ !== "Param") {
      // Avoid suggesting the following:
      // fn foo<T, <T as Trait>::Bar>(_: T) where T: Trait, <T as Trait>::Bar: Other {}
      for (const bound of bounds) {
        where_clauses.push(`${display_Ty(ty)}: ${tcx.def_path_str(bound)}`);
      }
    }
  }

  const generics_ = params.length === 0 ? "" : `<${params.join(", ")}>`;

  const where_clauses_ = where_clauses.length === 0 ? "" : ` where ${where_clauses.join(", ")}`;

  return [generics_, where_clauses_];
}

/// Return placeholder code for the given function.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:505 fn_sig_suggestion
function fn_sig_suggestion(tcx: TyCtxt, sig: FnSig, ident: Ident, clauses: Iterable<[Clause, Span]>, assoc: AssocItem): string {
  const splatted_arg_index = FnSig.splatted(sig);
  const args_: string[] = [...FnSig.inputs(sig)].map((ty: Ty, i: number) => {
    const splat = splatted_arg_index === i ? "#[rustc_splat] " : "";
    let arg_ty: string;
    const k = ty.kind();
    if (k.$ === "Param" && AssocItem.is_method(assoc) && i === 0) {
      arg_ty = "self";
    } else if (k.$ === "Ref" && i === 0) {
      const [reg_, ref_ty, mutability] = [k._0, k._1, k._2];
      const reg__ = `${display_Region(reg_)} `;
      const reg = reg__ === "'_ " || reg__ === " " ? "" : reg__;
      if (AssocItem.is_method(assoc)) {
        const rk = ref_ty.kind();
        if (rk.$ === "Param" && rk._0.name === kw.SelfUpper) {
          arg_ty = `&${reg}${Mutability.prefix_str(mutability)}self`;
        } else {
          arg_ty = `self: ${display_Ty(ty)}`;
        }
      } else {
        arg_ty = `_: ${display_Ty(ty)}`;
      }
    } else {
      if (AssocItem.is_method(assoc) && i === 0) {
        arg_ty = `self: ${display_Ty(ty)}`;
      } else {
        arg_ty = `_: ${display_Ty(ty)}`;
      }
    }
    return `${splat}${arg_ty}`;
  });
  if (FnSig.c_variadic(sig)) args_.push("...");
  const args = args_.join(", ");
  let output = FnSig.output(sig);

  let asyncness: string;
  if (Asyncness.is_async(tcx.asyncness(assoc.def_id) as Asyncness)) {
    const o = tcx.get_impl_future_output_ty(output);
    if (o === undefined) {
      return span_bug(ident.span, `expected async fn to have \`impl Future\` output, but it returns ${display_Ty(output)}`);
    }
    output = o;
    asyncness = "async ";
  } else {
    asyncness = "";
  }

  const output_ = !output.is_unit() ? ` -> ${display_Ty(output)}` : "";

  const safety = Safety.prefix_str(FnSig.safety(sig));
  const [generics, where_clauses] = bounds_from_generic_clauses(tcx, clauses, assoc);

  // FIXME: this is not entirely correct, as the lifetimes from borrowed params will
  // not be present in the `fn` definition, nor will we account for renamed
  // lifetimes between the `impl` and the `trait`, but this should be good enough to
  // fill in a significant portion of the missing code, and other subsequent
  // suggestions can help the user fix the code.
  // ignore-tidy-todo
  return `${safety}${asyncness}fn ${display_Ident(ident)}${generics}(${args})${output_}${where_clauses} { todo!() }`;
}

/// Return placeholder code for the given associated item.
/// Similar to `ty::AssocItem::suggestion`, but appropriate for use as the code snippet of a
/// structured suggestion.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:583 suggestion_signature
function suggestion_signature(tcx: TyCtxt, assoc: AssocItem, impl_trait_ref: TraitRef): string {
  const args = RawList.identity_for_item(tcx, assoc.def_id).rebase_onto(
    tcx,
    AssocItem.container_id(assoc, tcx),
    TraitRef.with_replaced_self_ty(impl_trait_ref, as_interner(tcx), tcx.types.self_param).args,
  );

  // `tcx.clauses_of(assoc.def_id).instantiate_own(tcx, args).map(|(c, s)| (c.skip_norm_wip(), s))`: built when the call's
  // arguments are evaluated, consumed lazily.
  const instantiate_own = (): Iterable<[Clause, Span]> => {
    const it = GenericClauses.instantiate_own(tcx.clauses_of(assoc.def_id) as GenericClauses, tcx, args);
    return (function* (): Generator<[Clause, Span]> {
      for (const [c, s] of it) yield [Unnormalized.skip_norm_wip(c), s];
    })();
  };

  switch (assoc.kind.$) {
    case "Fn":
      return fn_sig_suggestion(
        tcx,
        tcx.liberate_late_bound_regions(assoc.def_id, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(assoc.def_id) as EarlyBinder<PolyFnSig>, tcx, args, fold_Binder(fold_FnSig))), fold_FnSig),
        AssocItem.ident(assoc, tcx),
        instantiate_own(),
        assoc,
      );
    case "Type": {
      const [generics, where_clauses] = bounds_from_generic_clauses(tcx, instantiate_own(), assoc);
      return `type ${Symbol.as_str(AssocItem.name(assoc))}${generics} = /* Type */${where_clauses};`;
    }
    case "Const": {
      const name = assoc.kind.name;
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(assoc.def_id) as EarlyBinder<Ty>));
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const val = TypeErrCtxt_ty_kind_suggestion(infcx.err_ctxt(), tcx.param_env(assoc.def_id) as ParamEnv, ty) ?? "value";
      return `const ${Symbol.as_str(name)}: ${display_Ty(ty)} = ${val};`;
    }
  }
}

/// Emit an error when encountering two or more variants in a transparent enum.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:631 bad_variant_count
export function bad_variant_count(tcx: TyCtxt, adt: AdtDef, sp: Span, did: DefId): void {
  const variant_spans: Span[] = adt.variants().map((variant) => tcx.hir_span_if_local(variant.def_id)!);
  let [spans, many]: [Span[], Span | undefined] = [[], undefined];
  if (variant_spans.length >= 1) {
    const start = variant_spans.slice(0, -1);
    const end = variant_spans[variant_spans.length - 1]!;
    spans = [...start];
    many = end;
  }
  tcx.dcx().emit_err(
    diagnostics.TransparentEnumVariant_diagnostic({
      span: sp,
      spans,
      many,
      number: adt.variants().length,
      path: tcx.def_path_str(did),
    }),
  );
}

// FIXME: Consider moving this method to a more fitting place.
// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:652 potentially_plural_count
export function potentially_plural_count(count: number, word: string): string {
  return `${count} ${word}${pluralize(count)}`;
}

// rustc: compiler/rustc_hir_analysis/src/check/mod.rs:656 check_function_signature
export function check_function_signature(tcx: TyCtxt, cause: ObligationCause, fn_id: DefId, expected_sig: PolyFnSig): Result<null, ErrorGuaranteed> {
  // rustc: compiler/rustc_hir_analysis/src/check/mod.rs:662 extract_span_for_error_reporting
  function extract_span_for_error_reporting(tcx: TyCtxt, err: TypeError, cause: ObligationCause, fn_id: LocalDefId): Span {
    const node = tcx.expect_hir_owner_node(fn_id);
    const decl = hir.OwnerNode.fn_decl(node);
    if (decl === undefined) return bug(`expected fn decl, found ${debug_OwnerNode(node, PLAIN)}`);
    const args = [...decl.inputs.map((t) => t.span), hir.FnRetTy.span(decl.output)];

    switch (err.$) {
      case "ArgumentMutability":
      case "ArgumentSorts": {
        const i = err.$ === "ArgumentMutability" ? err._0 : err._1;
        const a = args[i];
        if (a === undefined) return panic("called `Option::unwrap()` on a `None` value");
        return a;
      }
      default:
        return cause.span;
    }
  }

  const local_id = fn_id.as_local() ?? CRATE_DEF_ID;

  const param_env = ParamEnv.empty();

  const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
  const ocx = ObligationCtxt_new_with_diagnostics(infcx);

  const actual_sig_ = EarlyBinder.instantiate_identity(tcx.fn_sig(fn_id) as EarlyBinder<PolyFnSig>);

  const norm_cause = ObligationCause.misc(cause.span, local_id);
  const actual_sig = ocx.normalize(norm_cause, param_env, actual_sig_, fold_Binder(fold_FnSig));

  const eq = ocx.eq(cause, param_env, expected_sig, actual_sig, ToTrace_PolyFnSig);
  if (eq.$ === "Ok") {
    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (errors.$ === "HasErrors") {
      return Err(TypeErrCtxt_(infcx).report_fulfillment_errors(errors._0));
    }
  } else {
    const err = eq._0;
    const err_ctxt = TypeErrCtxt_(infcx);
    if (fn_id.is_local()) {
      cause.span = extract_span_for_error_reporting(tcx, err, cause, local_id);
    }
    const failure_code = ObligationCause_as_failure_code_diag(cause, err, cause.span, []);
    const diag = tcx.dcx().create_err(failure_code);
    const values: ValuePairs = { $: "PolySigs", _0: { expected: expected_sig, found: actual_sig } };
    err_ctxt.note_type_err(diag, cause, undefined, param_env.and(values), err, false, undefined);
    return Err(diag.emit_err());
  }

  const r = ocx.resolve_regions_and_report_errors(local_id, param_env, []);
  if (r.$ === "Err") {
    const e = r._0;
    return Err(e);
  }

  return Ok(null);
}

// ==== Stand-ins (PORT: other wave-17 lanes; see the file header) ====

/** `always_applicable::check_drop_impl` (check/always_applicable.rs, lane check-region-intrinsic). */
function always_applicable_check_drop_impl(_tcx: TyCtxt, _drop_impl_did: LocalDefId): Result<null, ErrorGuaranteed> {
  return unported("rustc_hir_analysis::check::always_applicable::check_drop_impl (lane check-region-intrinsic)");
}
/** `rustc_trait_selection::error_reporting::traits::suggestions::ReturnsVisitor` (an `intravisit::Visitor`). */
interface ReturnsVisitor {
  returns: hir.Expr[];
  visit_body(body: hir.Body): void;
}
/** `ReturnsVisitor::default()`. */
function ReturnsVisitor_default(): ReturnsVisitor {
  return unported("rustc_trait_selection::error_reporting::traits::suggestions::ReturnsVisitor");
}
/** `middle::codegen_fn_attrs::CodegenFnAttrs` (rustc_middle middle/codegen_fn_attrs.rs, not ported): the fields this file reads. */
interface CodegenFnAttrs {
  link_section: Symbol | undefined;
}
/** `TypeErrCtxt::ty_kind_suggestion` (rustc_trait_selection error_reporting, wave 19). */
function TypeErrCtxt_ty_kind_suggestion(_err_ctxt: unknown, _param_env: ParamEnv, _ty: Ty): string | undefined {
  return unported("rustc_trait_selection::error_reporting::TypeErrCtxt::ty_kind_suggestion");
}
/** `traits::ObligationCtxt<'_, 'tcx, FulfillmentError<'tcx>>` (rustc_trait_selection traits/engine.rs, lanes trait-sel-*):
 * the methods this file uses. */
interface ObligationCtxt_ {
  normalize<T>(cause: ObligationCause, param_env: ParamEnv, value: Unnormalized<T>, d_T: TypeFoldable<T>): T;
  eq<T>(cause: ObligationCause, param_env: ParamEnv, expected: T, actual: T, d_T: ToTrace<T>): Result<null, TypeError>;
  evaluate_obligations_error_on_ambiguity(): TraitErrors<FulfillmentError>;
  resolve_regions_and_report_errors(generic_param_scope: LocalDefId, param_env: ParamEnv, assumed_wf_tys: Iterable<Ty>): Result<null, ErrorGuaranteed>;
}
/** `ObligationCtxt::new_with_diagnostics` (rustc_trait_selection traits/engine.rs, lanes trait-sel-*). */
function ObligationCtxt_new_with_diagnostics(_infcx: InferCtxt): ObligationCtxt_ {
  return unported("rustc_trait_selection::traits::ObligationCtxt::new_with_diagnostics");
}
/** `TypeErrCtxt` (rustc_trait_selection error_reporting, wave 19): the methods this file uses. */
interface TypeErrCtxt_ {
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
  note_type_err(
    diag: Diag,
    cause: ObligationCause,
    secondary_span: unknown,
    values: ParamEnvAnd<ValuePairs> | undefined,
    terr: TypeError,
    prefer_label: boolean,
    override_span: Span | undefined,
  ): void;
}
/** `infcx.err_ctxt()` (`InferCtxtErrorExt`, rustc_trait_selection error_reporting/mod.rs). */
function TypeErrCtxt_(infcx: InferCtxt): TypeErrCtxt_ {
  return infcx.err_ctxt() as unknown as TypeErrCtxt_;
}
/** `ObligationCauseExt::as_failure_code_diag` (rustc_trait_selection error_reporting/infer/mod.rs, wave 19). */
function ObligationCause_as_failure_code_diag(_cause: ObligationCause, _terr: TypeError, _span: Span, _subdiags: unknown[]): Diagnostic {
  return unported("rustc_trait_selection::error_reporting::infer::ObligationCauseExt::as_failure_code_diag");
}
