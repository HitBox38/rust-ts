// Port of compiler/rustc_hir_typeck/src/method/suggest.rs (STUB, lane wave 19): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// method/suggest.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./suggest.gen.ts";
import { unported_methods } from "../../rust_ts/stubs.ts";
import { unported } from "../../std/panic.ts";
import { FnCtxt } from "../decls.ts";
import { debug_Expr, debug_Ty as debug_hir_Ty } from "../../rustc_hir/lib.ts";
import { type Debug, debug_tuple } from "../../std/fmt.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type * as hir from "../../rustc_hir/lib.ts";
import { AssocItem } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Span } from "../../rustc_span/lib.ts";
import { TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TraitInfo } from "./suggest.gen.ts";

// rustc-type: compiler/rustc_hir_typeck/src/method/suggest.rs:4950 SelfSource
// PORT: hand-written (types.sets.json `skip`): the generated Debug would import `hir::Ty`'s and `ty::Ty`'s `debug_Ty` under
// one name. `#[derive(Copy, Clone, Debug)]`: an immutable value, so Clone is the identity.
export type SelfSource =
  | { readonly $: "QPath"; _0: hir.Ty }
  | { readonly $: "MethodCall"; _0: hir.Expr /* rcvr */ };
export const debug_SelfSource: Debug<SelfSource> = (v, f) => {
  switch (v.$) {
    case "QPath":
      return debug_tuple(f, "QPath", [debug_hir_Ty(v._0, f, (_x, _f) => "()")]);
    case "MethodCall":
      return debug_tuple(f, "MethodCall", [debug_Expr(v._0, f)]);
  }
};

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::method::suggest::FnCtxt", ["is_slice_ty", "impl_into_iterator_should_be_iterator", "preferred_iterator_method", "report_method_error", "create_missing_writer_err", "create_no_assoc_err", "suggest_use_shadowed_binding_with_method", "suggest_method_call_annotation", "suggest_static_method_candidates", "suggest_unsatisfied_ty_or_trait", "suggest_surround_method_call", "find_possible_candidates_for_method", "suggest_confusable_or_similarly_named_method", "suggest_method_not_found_because_of_unsatisfied_bounds", "report_no_match_method_error", "set_not_found_span_label", "suggest_enum_variant_for_method_call", "handle_unsatisfied_predicates", "lookup_segments_chain_for_no_match_method", "find_likely_intended_associated_item", "confusable_method_name"]);

// ==== lane typeck-suggest-b: method/suggest.rs:2433..5035 (note_candidates_on_method_error .. print_disambiguation_help) ====
// The imports of this region are kept separate from typeck-suggest-a's (on merge: drop names both blocks import).
import { type ControlFlow, ControlFlow as ControlFlowC, VisitorResult as VisitorResultC, type VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { type Stability, StabilityLevel } from "../../rustc_attr_ir/stability.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import { type Applicability, E0689, pluralize, StashKey, struct_span_code_err } from "../../rustc_errors/lib.ts";
import { Res } from "../../rustc_hir/def.ts";
import { GenericBound, ImplicitSelfKind, is_range_literal, ParamName } from "../../rustc_hir/hir.ts";
import { Visitor, walk_stmt } from "../../rustc_hir/intravisit.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { Obligation } from "../../rustc_infer/traits/mod.gen.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import type { ModChild, ResolverGlobalCtxt } from "../../rustc_middle/middle/resolve.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { ParamTy } from "../../rustc_middle/ty/decls.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { SimplifiedType_key } from "../../rustc_middle/ty/fast_reject.ts";
import { fold_GenericArg, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { type FieldDef, type ImplTraitHeader, Ty, type VariantDef, Visibility } from "../../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { print_Ty } from "../../rustc_middle/ty/print/mod.ts";
import {
  display_GenericArg,
  display_ParamTy,
  display_TraitRefPrintOnlyTraitName,
  display_TraitRefPrintSugared,
  display_Ty,
  TraitRef_print_only_trait_name,
  TraitRef_print_trait_sugared,
  with_crate_prefix,
  with_no_visible_paths_if_doc_hidden,
} from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { str_cmp } from "../../rustc_session/options.ts";
import { type DefId, DefId_eq, type DefIdMap, DefIdSet } from "../../rustc_span/def_id.ts";
import { type BytePos, DUMMY_SP, type ErrorGuaranteed, OrdSpan, type PathBuf } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT } from "../../rustc_type_ir/decls.ts";
import { supertraits } from "../../rustc_type_ir/elaborate.ts";
import { DeepRejectCtxt, simplify_type } from "../../rustc_type_ir/fast_reject.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { display_TraitRef } from "../../rustc_type_ir/ir_print.ts";
import { as_interner, fold_with_TraitClause, fold_with_TraitRef, PolyExistentialTraitRef, PolyTraitRef, TraitClause, try_fold_with_TraitClause, try_fold_with_TraitRef, visit_with_TraitClause, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import { fold_FnSig, FnSig, PolyFnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { type PredicateKind, visit_with_PredicateKind } from "../../rustc_type_ir/predicate_kind.gen.ts";
import type { TypeVisitable } from "../../rustc_type_ir/visit.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { is_whitespace } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { type Str, utf8_width } from "../../std/str.ts";
import type { FulfillmentError } from "../../rustc_trait_selection/traits/mod.gen.ts";
import * as diagnostics from "../diagnostics.gen.ts";
import { Expectation } from "../expectation.ts";
import type { CandidateSource } from "./mod.gen.ts";
import { type Pick, ProbeScope, type UnsatisfiedPredicates } from "./probe.gen.ts";

/** PORT: `impl TypeFoldable for TraitRef` (the derived impls of predicate.gen.ts) as a descriptor. */
const fold_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
/** PORT: `impl TypeFoldable for TraitClause` (derived) as a descriptor. */
const fold_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };
/** PORT: `impl TypeVisitable for PredicateKind` (derived) as a descriptor. */
const d_PredicateKind: TypeVisitable<PredicateKind> = { visit_with: visit_with_PredicateKind };

/** PORT: `slice::sort_by_key` (stable) with the key computed once per element (the keys are pure). */
function sort_by_cached_key<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): void {
  const keyed = v.map((x) => [key(x), x] as const);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  for (let i = 0; i < keyed.length; i++) v[i] = keyed[i]![1];
}

/** PORT: `Vec::dedup` / `dedup_by_key` (removes consecutive elements equal by `eq`). */
function dedup_by<T>(v: T[], eq: (a: T, b: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !eq(v[w - 1]!, v[r]!)) v[w++] = v[r]!;
  }
  v.length = w;
}

/** PORT: `#[derive(PartialEq)] CandidateSource`. */
function CandidateSource_eq(a: CandidateSource, b: CandidateSource): boolean {
  return a.$ === b.$ && DefId_eq(a._0, b._0);
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2434 note_candidates_on_method_error
FnCtxt.prototype.note_candidates_on_method_error = function (
  this: FnCtxt,
  rcvr_ty: Ty,
  item_name: Ident,
  self_source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  span: Span,
  err: Diag,
  sources: CandidateSource[],
  sugg_span: Span | undefined,
): void {
  sort_by_cached_key(
    sources,
    (source): [number, string] => {
      switch (source.$) {
        case "Trait":
          return [0, this.tcx.def_path_str(source._0)];
        case "Impl":
          return [1, this.tcx.def_path_str(source._0)];
      }
    },
    (a, b) => (a[0] !== b[0] ? a[0] - b[0] : str_cmp(a[1], b[1])),
  );
  dedup_by(sources, CandidateSource_eq);
  // Dynamic limit to avoid hiding just one candidate, which is silly.
  const limit = sources.length === 5 ? 5 : 4;

  const suggs: string[] = [];
  for (const [idx, source] of sources.slice(0, limit).entries()) {
    switch (source.$) {
      case "Impl": {
        const impl_did = source._0;
        // Provide the best span we can. Use the item, if local to crate, else
        // the impl, if local to crate (item may be defaulted), else nothing.
        let item = this.associated_value(impl_did, item_name);
        if (item === undefined) {
          const impl_trait_id = this.tcx.impl_opt_trait_id(impl_did);
          item = impl_trait_id === undefined ? undefined : this.associated_value(impl_trait_id, item_name);
        }
        if (item === undefined) {
          continue;
        }

        const note_span = item.def_id.is_local() ? this.tcx.def_span(item.def_id) : impl_did.is_local() ? this.tcx.def_span(impl_did) : undefined;

        const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.at(span).type_of(impl_did) as EarlyBinder<Ty>));

        const opt_trait_ref = this.tcx.impl_opt_trait_ref(impl_did);
        const insertion = opt_trait_ref === undefined ? "" : ` of the trait \`${this.tcx.def_path_str(EarlyBinder.skip_binder(opt_trait_ref).def_id)}\``;

        let note_str: string;
        let idx_: number | undefined;
        if (sources.length > 1) {
          note_str = `candidate #${idx + 1} is defined in an impl${insertion} for the type \`${display_Ty(impl_ty)}\``;
          idx_ = idx + 1;
        } else {
          note_str = `the candidate is defined in an impl${insertion} for the type \`${display_Ty(impl_ty)}\``;
          idx_ = undefined;
        }
        if (note_span !== undefined) {
          // We have a span pointing to the method. Show note with snippet.
          err.span_note(note_span, note_str);
        } else {
          err.note(note_str);
        }
        if (sugg_span !== undefined) {
          const trait_ref = this.tcx.impl_opt_trait_ref(impl_did);
          if (trait_ref !== undefined) {
            const sugg = print_disambiguation_help(
              this.tcx,
              err,
              self_source,
              args,
              TraitRef.with_replaced_self_ty(
                Unnormalized.skip_norm_wip(EarlyBinder.instantiate(trait_ref, this.tcx, this.fresh_args_for_item(sugg_span, impl_did), fold_TraitRef)),
                as_interner(this.tcx),
                rcvr_ty,
              ),
              idx_,
              sugg_span,
              item,
            );
            if (sugg !== undefined) {
              suggs.push(sugg);
            }
          }
        }
        break;
      }
      case "Trait": {
        const trait_did = source._0;
        const item = this.associated_value(trait_did, item_name);
        if (item === undefined) continue;
        const item_span = this.tcx.def_span(item.def_id);
        let idx_: number | undefined;
        if (sources.length > 1) {
          const msg = `candidate #${idx + 1} is defined in the trait \`${this.tcx.def_path_str(trait_did)}\``;
          err.span_note(item_span, msg);
          idx_ = idx + 1;
        } else {
          const msg = `the candidate is defined in the trait \`${this.tcx.def_path_str(trait_did)}\``;
          err.span_note(item_span, msg);
          idx_ = undefined;
        }
        if (sugg_span !== undefined) {
          const sugg = print_disambiguation_help(
            this.tcx,
            err,
            self_source,
            args,
            TraitRef.with_replaced_self_ty(TraitRef.new_from_args(as_interner(this.tcx), trait_did, this.fresh_args_for_item(sugg_span, trait_did)), as_interner(this.tcx), rcvr_ty),
            idx_,
            sugg_span,
            item,
          );
          if (sugg !== undefined) {
            suggs.push(sugg);
          }
        }
        break;
      }
    }
  }
  if (suggs.length !== 0 && sugg_span !== undefined) {
    const span = sugg_span;
    suggs.sort(str_cmp);
    err.span_suggestions(Span.with_hi(span, Span.lo(item_name.span)), "use fully-qualified syntax to disambiguate", suggs, "MachineApplicable");
  }
  if (sources.length > limit) {
    err.note(`and ${sources.length - limit} others`);
  }
};

/// Look at all the associated functions without receivers in the type's inherent impls
/// to look for builders that return `Self`, `Option<Self>` or `Result<Self, _>`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2592 find_builder_fn
FnCtxt.prototype.find_builder_fn = function (this: FnCtxt, err: Diag, rcvr_ty: Ty, expr_id: HirId): void {
  const rk = rcvr_ty.kind();
  if (rk.$ !== "Adt") {
    return;
  }
  const adt_def = rk._0;
  const items: [DefId, Ty][] = [];
  for (const i of this.tcx.inherent_impls(adt_def.did()) as readonly DefId[]) {
    for (const item of AssocItems.in_definition_order(this.tcx.associated_items(i) as AssocItems)) {
      // Only assoc fn with no receivers and only if
      // they are resolvable
      if (
        !(
          item.kind.$ === "Fn" &&
          item.kind.has_self === false &&
          this.probe_for_name("Path", AssocItem.ident(item, this.tcx), undefined, { _0: true }, rcvr_ty, expr_id, ProbeScope.TraitsInScope).$ === "Ok"
        )
      ) {
        continue;
      }
      // Only assoc fns that return `Self`, `Option<Self>` or `Result<Self, _>`.
      const r = ((): [DefId, Ty] | undefined => {
        const ret_ty_ = PolyFnSig.output(
          Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(this.tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSigT>, this.tcx, this.fresh_args_for_item(DUMMY_SP, item.def_id), fold_Binder(fold_FnSig)),
          ),
        );
        const ret_ty = this.tcx.instantiate_bound_regions_with_erased(ret_ty_, fold_Ty);
        const k = ret_ty.kind();
        if (k.$ !== "Adt") {
          return undefined;
        }
        const def = k._0;
        const args = k._1;
        // Check for `-> Self`
        if (this.can_eq(this.param_env, ret_ty, rcvr_ty, ToTrace_Ty)) {
          return [item.def_id, ret_ty];
        }
        // Check for `-> Option<Self>` or `-> Result<Self, _>`
        const option_type = this.tcx.lang_items().option_type();
        const result_type = this.tcx.get_diagnostic_item(sym.Result);
        if (!((option_type !== undefined && DefId_eq(option_type, def.did())) || (result_type !== undefined && DefId_eq(result_type, def.did())))) {
          return undefined;
        }
        const arg0 = args[0];
        if (arg0 === undefined) return undefined;
        const arg = GenericArg.expect_ty(arg0);
        if (this.can_eq(this.param_env, rcvr_ty, arg, ToTrace_Ty)) {
          return [item.def_id, ret_ty];
        } else {
          return undefined;
        }
      })();
      if (r !== undefined) items.push(r);
    }
  }
  let post: string;
  if (items.length > 5) {
    const items_len = items.length;
    items.length = 4;
    post = `\nand ${items_len - 4} others`;
  } else {
    post = "";
  }
  if (items.length === 0) {
    // []
  } else if (items.length === 1) {
    const [def_id, ret_ty] = items[0]!;
    err.span_note(
      this.tcx.def_span(def_id),
      `if you're trying to build a new \`${display_Ty(rcvr_ty)}\`, consider using \`${this.tcx.def_path_str(def_id)}\` which returns \`${display_Ty(ret_ty)}\``,
    );
  } else {
    const span: MultiSpan = MultiSpan.from_Vec(items.map(([def_id]) => this.tcx.def_span(def_id)));
    err.span_note(
      span,
      `if you're trying to build a new \`${display_Ty(rcvr_ty)}\` consider using one of the following associated functions:\n${items.map(([def_id, _ret_ty]) => this.tcx.def_path_str(def_id)).join("\n")}${post}`,
    );
  }
};

/// Suggest calling `Ty::method` if `.method()` isn't found because the method
/// doesn't take a `self` receiver.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2690 suggest_associated_call_syntax
FnCtxt.prototype.suggest_associated_call_syntax = function (
  this: FnCtxt,
  err: Diag,
  static_candidates: readonly CandidateSource[],
  rcvr_ty: Ty,
  source: SelfSource,
  item_name: Ident,
  args: readonly hir.Expr[] | undefined,
  sugg_span: Span,
): void {
  let has_unsuggestable_args = false;
  let ty_str: string;
  const sc0 = static_candidates[0];
  if (sc0 !== undefined && sc0.$ === "Impl") {
    const impl_did = sc0._0;
    // When the "method" is resolved through dereferencing, we really want the
    // original type that has the associated function for accurate suggestions.
    // (#61411)
    const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_did) as EarlyBinder<Ty>));
    let found: Ty | undefined;
    for (const [rcvr_ty_] of this.autoderef(sugg_span, rcvr_ty).silence_errors()) {
      if (DeepRejectCtxt.relate_rigid_infer(as_interner(this.tcx)).types_may_unify(rcvr_ty_, impl_ty)) {
        found = rcvr_ty_;
        break;
      }
    }
    const target_ty = (found ?? impl_ty).peel_refs();
    const tk = target_ty.kind();
    if (tk.$ === "Adt") {
      const def = tk._0;
      const args_ = tk._1;
      // If there are any inferred arguments, (`{integer}`), we should replace
      // them with underscores to allow the compiler to infer them
      const infer_args = this.tcx.mk_args_from_iter(
        args_.map((arg): GenericArg => {
          if (!IsSuggestable.is_suggestable(arg, this.tcx, true, fold_GenericArg)) {
            has_unsuggestable_args = true;
            const ak = GenericArg.kind(arg);
            switch (ak.$) {
              case "Lifetime":
                return GenericArg.from_Region(this.next_region_var({ $: "Misc", _0: DUMMY_SP }));
              case "Type":
                return GenericArg.from_Ty(this.next_ty_var(DUMMY_SP));
              case "Const":
                return GenericArg.from_Const(this.next_const_var(DUMMY_SP));
            }
          } else {
            return arg;
          }
        }),
      );

      ty_str = this.tcx.value_path_str_with_args(def.did(), infer_args);
    } else {
      ty_str = this.ty_to_value_string(target_ty);
    }
  } else {
    ty_str = this.ty_to_value_string(rcvr_ty.peel_refs());
  }
  if (source.$ === "MethodCall") {
    const first_arg = ((): string | undefined => {
      const candidate_source = static_candidates[0];
      if (candidate_source === undefined) return undefined;
      let assoc_did: DefId;
      let self_ty: Ty;
      switch (candidate_source.$) {
        case "Impl":
          [assoc_did, self_ty] = [candidate_source._0, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(candidate_source._0) as EarlyBinder<Ty>))];
          break;
        case "Trait":
          [assoc_did, self_ty] = [candidate_source._0, rcvr_ty];
          break;
      }

      const assoc = this.associated_value(assoc_did, item_name);
      if (assoc === undefined) return undefined;
      if (!AssocItem.is_fn(assoc)) {
        return undefined;
      }

      // for CandidateSource::Impl, `Self` will be instantiated to a concrete type
      // but for CandidateSource::Trait, `Self` is still `Self`
      const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(assoc.def_id) as EarlyBinder<PolyFnSigT>));
      const first = Binder.skip_binder(PolyFnSig.inputs(sig))[0];
      if (first === undefined) return undefined;
      // if the type of first arg is the same as the current impl type, we should take the first arg into assoc function
      const first_ty = first.peel_refs();
      if (first_ty === self_ty || first_ty === this.tcx.types.self_param) {
        const mutbl = first.ref_mutability();
        return mutbl === undefined ? "" : Mutability.ref_prefix_str(mutbl);
      } else {
        return undefined;
      }
    })();

    let applicability: Applicability = "MachineApplicable";
    let args_str: string;
    if (source.$ === "MethodCall" && args !== undefined) {
      const receiver = source._0;
      // The first arg is the same kind as the receiver
      let explicit_args: hir.Expr[];
      if (first_arg !== undefined) {
        explicit_args = [receiver, ...args];
      } else {
        // There is no `Self` kind to infer the arguments from
        if (has_unsuggestable_args) {
          applicability = "HasPlaceholders";
        }
        explicit_args = [...args];
      }
      args_str = `(${first_arg ?? ""}${explicit_args
        .map((arg) => {
          const r = this.tcx.sess.source_map().span_to_snippet(arg.span);
          if (r.$ === "Ok") return r._0.toString();
          applicability = "HasPlaceholders";
          return "_";
        })
        .join(", ")})`;
    } else {
      applicability = "HasPlaceholders";
      args_str = "(...)";
    }
    err.span_suggestion_verbose(sugg_span, "use associated function syntax instead", `${ty_str}::${display_Ident(item_name)}${args_str}`, applicability);
  } else {
    err.help(`try with \`${ty_str}::${display_Ident(item_name)}\``);
  }
};

/// Suggest calling a field with a type that implements the `Fn*` traits instead of a method with
/// the same name as the field i.e. `(a.my_fn_ptr)(10)` instead of `a.my_fn_ptr(10)`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2816 suggest_calling_field_as_fn
FnCtxt.prototype.suggest_calling_field_as_fn = function (this: FnCtxt, span: Span, rcvr_ty: Ty, expr: hir.Expr, item_name: Ident, err: Diag): boolean {
  const tcx = this.tcx;
  let field_receiver: [FieldDef, Ty] | undefined;
  for (const [ty] of this.autoderef(span, rcvr_ty).silence_errors()) {
    const k = ty.kind();
    if (k.$ === "Adt" && !k._0.is_enum()) {
      const def = k._0;
      const args = k._1;
      const variant = def.non_enum_variant();
      const index = tcx.find_field_index(item_name, variant);
      if (index !== undefined) {
        const field = variant.fields[index]!;
        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
        field_receiver = [field, field_ty];
        break;
      }
    }
  }
  if (field_receiver !== undefined) {
    const [field, field_ty] = field_receiver;
    const is_accessible = Visibility.is_accessible_from(field.vis, this.mod_id, tcx);

    if (is_accessible) {
      const callable = this.extract_callable_info(field_ty);
      if (callable !== undefined) {
        const [what_] = callable;
        const what = what_.$ === "DefId" ? this.tcx.def_descr(what_._0) : what_._0;
        const expr_span = Span.to(expr.span, item_name.span);
        err.multipart_suggestion(
          `to call the ${what} stored in \`${display_Ident(item_name)}\`, surround the field access with parentheses`,
          [
            [Span.shrink_to_lo(expr_span), "("],
            [Span.shrink_to_hi(expr_span), ")"],
          ],
          "MachineApplicable",
        );
      } else {
        const call_expr = tcx.hir_expect_expr(tcx.parent_hir_id(expr.hir_id));

        const span_ = Span.trim_start(call_expr.span, item_name.span);
        if (span_ !== undefined) {
          err.span_suggestion(span_, "remove the arguments", "", "MaybeIncorrect");
        }
      }
    }

    const field_kind = is_accessible ? "field" : "private field";
    err.span_label(item_name.span, `${field_kind}, not a method`);
    return true;
  }
  return false;
};

/// Suggest possible range with adding parentheses, for example:
/// when encountering `0..1.map(|i| i + 1)` suggest `(0..1).map(|i| i + 1)`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2881 report_failed_method_call_on_range_end
FnCtxt.prototype.report_failed_method_call_on_range_end = function (this: FnCtxt, tcx: TyCtxt, actual: Ty, source: SelfSource, span: Span, item_name: Ident): Result<undefined, ErrorGuaranteed> {
  if (source.$ === "MethodCall") {
    const expr = source._0;
    let n = 0;
    for (const [, parent] of tcx.hir_parent_iter(expr.hir_id)) {
      if (n++ >= 5) break;
      if (parent.$ === "Expr") {
        const parent_expr = parent._0;
        if (!is_range_literal(parent_expr)) {
          continue;
        }
        let lang_item: LangItem | undefined;
        const pk = parent_expr.kind;
        if (pk.$ === "Struct") {
          const li = tcx.qpath_lang_item(pk._0);
          lang_item =
            li !== undefined && (li === LangItem.Range || li === LangItem.RangeCopy || li === LangItem.RangeInclusiveCopy || li === LangItem.RangeTo || li === LangItem.RangeToInclusive)
              ? li
              : undefined;
        } else if (pk.$ === "Call") {
          const func = pk._0;
          // `..=` desugars into `::std::ops::RangeInclusive::new(...)`.
          if (func.kind.$ === "Path" && tcx.qpath_is_lang_item(func.kind._0, LangItem.RangeInclusiveNew)) {
            lang_item = LangItem.RangeInclusiveStruct;
          } else {
            lang_item = undefined;
          }
        } else {
          lang_item = undefined;
        }

        if (lang_item === undefined) {
          continue;
        }

        let span_included: boolean;
        if (pk.$ === "Struct") {
          const eps = pk._1;
          const last = eps[eps.length - 1];
          span_included = last !== undefined && Span.contains(last.span, span);
        } else if (pk.$ === "Call") {
          // `..=` desugars into `::std::ops::RangeInclusive::new(...)`.
          span_included = Span.contains(pk._0.span, span);
        } else {
          span_included = false;
        }

        if (!span_included) {
          continue;
        }

        const range_def_id = this.tcx.lang_items().get(lang_item);
        if (range_def_id === undefined) {
          continue;
        }
        const range_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(range_def_id) as EarlyBinder<Ty>, this.tcx, [GenericArg.from_Ty(actual)], fold_Ty));

        const pick = this.lookup_probe_for_diagnostic(item_name, range_ty, expr, ProbeScope.AllTraits, undefined);
        if (pick.$ === "Ok") {
          const range_span = Span.with_hi(parent_expr.span, Span.hi(expr.span));
          return Err(
            this.dcx().emit_err(
              diagnostics.MissingParenthesesInRange_diagnostic({
                span,
                ty: actual,
                method_name: item_name.as_str(),
                add_missing_parentheses: {
                  func_name: Symbol.as_str(item_name.name),
                  left: Span.shrink_to_lo(range_span),
                  right: Span.shrink_to_hi(range_span),
                },
              }),
            ),
          );
        }
      }
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:2974 report_failed_method_call_on_numerical_infer_var
FnCtxt.prototype.report_failed_method_call_on_numerical_infer_var = function (
  this: FnCtxt,
  tcx: TyCtxt,
  actual: Ty,
  source: SelfSource,
  span: Span,
  item_kind: string,
  item_name: Ident,
  long_ty_path_: PathBuf | undefined,
): Result<undefined, ErrorGuaranteed> {
  // PORT: `long_ty_path: &mut Option<PathBuf>` is passed by value (decls.ts); the caller's `ty_file` is only written on the
  // `Err` path, after which it is never read, so a local cell is equivalent.
  const long_ty_path: MutRef<PathBuf | undefined> = { value: long_ty_path_ };
  let found_candidate = all_traits(this.tcx).some((info) => this.associated_value(info.def_id, item_name) !== undefined);
  const found_assoc = (ty: Ty): boolean => {
    const simp = simplify_type(as_interner(tcx), ty, "InstantiateWithInfer");
    if (simp === undefined) return false;
    for (const id of tcx.incoherent_impls(simp) as readonly DefId[]) {
      if (this.associated_value(id, item_name) !== undefined) return true;
    }
    return false;
  };
  found_candidate =
    found_candidate ||
    found_assoc(tcx.types.i8) ||
    found_assoc(tcx.types.i16) ||
    found_assoc(tcx.types.i32) ||
    found_assoc(tcx.types.i64) ||
    found_assoc(tcx.types.i128) ||
    found_assoc(tcx.types.u8) ||
    found_assoc(tcx.types.u16) ||
    found_assoc(tcx.types.u32) ||
    found_assoc(tcx.types.u64) ||
    found_assoc(tcx.types.u128) ||
    found_assoc(tcx.types.f32) ||
    found_assoc(tcx.types.f64);
  if (found_candidate && actual.is_numeric() && !actual.has_concrete_skeleton() && source.$ === "MethodCall") {
    const expr = source._0;
    const ty_str = this.tcx.short_string(actual, long_ty_path, print_Ty);
    const err = struct_span_code_err(this.dcx(), span, E0689, `can't call ${item_kind} \`${display_Ident(item_name)}\` on ambiguous numeric type \`${ty_str}\``);
    const taken = long_ty_path.value;
    long_ty_path.value = undefined;
    err.long_ty_path().value = taken;
    const concrete_type = actual.is_integral() ? "i32" : "f32";
    const ek = expr.kind;
    if (ek.$ === "Lit") {
      const lit = ek._0;
      // numeric literal
      const r = tcx.sess.source_map().span_to_snippet(lit.span);
      let snippet = r.$ === "Ok" ? r._0.toString() : "<numeric literal>";

      // If this is a floating point literal that ends with '.',
      // get rid of it to stop this from becoming a member access.
      if (snippet.endsWith(".")) snippet = snippet.slice(0, -1);
      err.span_suggestion(lit.span, `you must specify a concrete type for this numeric value, like \`${concrete_type}\``, `${snippet}_${concrete_type}`, "MaybeIncorrect");
    } else if (ek.$ === "Path" && ek._0.$ === "Resolved") {
      const path = ek._0._1;
      // local binding
      if (path.res.$ === "Local") {
        const hir_id = path.res._0;
        const span = tcx.hir_span(hir_id);
        const filename = tcx.sess.source_map().span_to_filename(span);

        const parent_node = this.tcx.parent_hir_node(hir_id);
        const msg = `you must specify a type for this binding, like \`${concrete_type}\``;

        // FIXME: Maybe FileName::Anon should also be handled,
        // otherwise there would be no suggestion if the source is STDIN for example.
        let binding_pat: hir.Node;
        if (filename.$ === "Real" && parent_node.$ === "LetStmt" && parent_node._0.source === "Normal") {
          const ty = parent_node._0.ty;
          const type_span = ty !== undefined ? Span.with_lo(ty.span, Span.hi(span)) : Span.shrink_to_hi(span);
          err.span_suggestion(
            // account for `let x: _ = 42;`
            //                   ^^^
            type_span,
            msg,
            `: ${concrete_type}`,
            "MaybeIncorrect",
          );
        } else if (
          // For closure parameters with reference patterns (e.g., |&v|), suggest the type annotation
          // on the pattern itself, e.g., |&v: &i32|
          filename.$ === "Real" &&
          parent_node.$ === "Pat" &&
          (binding_pat = this.tcx.hir_node(hir_id)).$ === "Pat" &&
          binding_pat._0.kind.$ === "Binding" &&
          parent_node.$ === "Pat" &&
          parent_node._0.kind.$ === "Ref"
        ) {
          const pat = parent_node._0;
          err.span_label(span, "you must specify a type for this binding");

          const ref_muts: Mutability[] = [];
          let current_node: hir.Node = parent_node;

          while (current_node.$ === "Pat") {
            const parent_pat = current_node._0;
            if (parent_pat.kind.$ === "Ref") {
              const mutability = parent_pat.kind._2;
              ref_muts.push(mutability);
              current_node = this.tcx.parent_hir_node(parent_pat.hir_id);
            } else {
              break;
            }
          }

          let type_annotation = "";
          for (const mutability of [...ref_muts].reverse()) {
            switch (mutability) {
              case "Mut":
                type_annotation += "&mut ";
                break;
              case "Not":
                type_annotation += "&";
                break;
            }
          }
          type_annotation += concrete_type;

          err.span_suggestion_verbose(Span.shrink_to_hi(pat.span), "specify the type in the closure argument list", `: ${type_annotation}`, "MaybeIncorrect");
        } else {
          err.span_label(span, msg);
        }
      }
    }
    return Err(err.emit_err());
  }
  return Ok(undefined);
};

/// For code `rect::area(...)`,
/// if `rect` is a local variable and `area` is a valid assoc method for it,
/// we try to suggest `rect.area()`
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3133 suggest_assoc_method_call
FnCtxt.prototype.suggest_assoc_method_call = function (this: FnCtxt, segs: readonly hir.PathSegment[]): void {
  // debug!("suggest_assoc_method_call segs: {:?}", segs);
  if (segs.length !== 2) {
    return;
  }
  const [seg1, seg2] = [segs[0]!, segs[1]!];
  this.dcx().try_steal_modify_and_emit_err(seg1.ident.span, StashKey.CallAssocMethod, (err) => {
    const body = this.tcx.hir_body_owned_by(this.body_def_id);
    class LetVisitor extends Visitor<ControlFlow<hir.Expr | undefined>> {
      // type Result = ControlFlow<Option<&'v hir::Expr<'v>>>;
      override Result: VisitorResult<ControlFlow<hir.Expr | undefined>, unknown> = VisitorResultC.ControlFlow<hir.Expr | undefined>();
      constructor(public ident_name: Symbol) {
        super();
      }

      // FIXME: This really should be taking scoping, etc into account.
      // impl<'v> Visitor<'v> for LetVisitor
      // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3150 visit_stmt
      override visit_stmt(ex: hir.Stmt): ControlFlow<hir.Expr | undefined> {
        if (ex.kind.$ === "Let" && ex.kind._0.pat.kind.$ === "Binding" && ex.kind._0.pat.kind._2.name === this.ident_name) {
          return ControlFlowC.Break(ex.kind._0.init);
        } else {
          return walk_stmt(this, ex);
        }
      }
    }

    const call_expr_node = this.tcx.parent_hir_node(seg1.hir_id);
    if (call_expr_node.$ === "Expr") {
      const call_expr = call_expr_node._0;
      const cf = new LetVisitor(seg1.ident.name).visit_body(body);
      if (cf.$ === "Break" && cf._0 !== undefined) {
        const expr = cf._0;
        const self_ty = this.node_ty_opt(expr.hir_id);
        if (self_ty !== undefined) {
          const probe = this.lookup_probe_for_diagnostic(seg2.ident, self_ty, call_expr, ProbeScope.TraitsInScope, undefined);
          if (probe.$ === "Ok") {
            const sm = this.infcx.tcx.sess.source_map();
            err.span_suggestion_verbose(
              unwrap_result(sm.span_extend_while(Span.shrink_to_hi(seg1.ident.span), (c) => c === 0x3a /* ':' */)),
              "you may have meant to call an instance method",
              ".",
              "MaybeIncorrect",
            );
          }
        }
      }
    }
  });
};

/// Suggest calling a method on a field i.e. `a.field.bar()` instead of `a.bar()`
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3190 suggest_calling_method_on_field
FnCtxt.prototype.suggest_calling_method_on_field = function (this: FnCtxt, err: Diag, source: SelfSource, span: Span, actual: Ty, item_name: Ident, return_type: Ty | undefined): void {
  if (source.$ === "MethodCall") {
    const expr = source._0;
    for (const fields of this.get_field_candidates_considering_privacy_for_diag(span, actual)) {
      const call_expr = this.tcx.hir_expect_expr(this.tcx.parent_hir_id(expr.hir_id));

      const lang_items = this.tcx.lang_items();
      const never_mention_traits = [
        lang_items.clone_trait(),
        lang_items.deref_trait(),
        lang_items.deref_mut_trait(),
        this.tcx.get_diagnostic_item(sym.AsRef),
        this.tcx.get_diagnostic_item(sym.AsMut),
        this.tcx.get_diagnostic_item(sym.Borrow),
        this.tcx.get_diagnostic_item(sym.BorrowMut),
      ];
      const candidate_fields: string[] = [];
      for (const candidate_field of fields) {
        const field_path = this.check_for_nested_field_satisfying_condition_for_diag(
          span,
          (_, field_ty) => {
            const r = this.lookup_probe_for_diagnostic(item_name, field_ty, call_expr, ProbeScope.TraitsInScope, return_type);
            if (r.$ !== "Ok") return false;
            const pick = r._0;
            return !never_mention_traits.some((def_id) => def_id !== undefined && DefId_eq(this.tcx.parent(pick.item.def_id), def_id));
          },
          candidate_field,
          [],
        );
        if (field_path === undefined) continue;
        candidate_fields.push(field_path.map((id) => display_Ident(id)).join("."));
      }
      candidate_fields.sort(str_cmp);

      const len = candidate_fields.length;
      if (len > 0) {
        err.span_suggestions(
          Span.shrink_to_lo(item_name.span),
          `${len > 1 ? "some" : "one"} of the expressions' fields ${len > 1 ? "have" : "has"} a method of the same name`,
          candidate_fields.map((path) => `${path}.`),
          "MaybeIncorrect",
        );
      }
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3264 suggest_unwrapping_inner_self
FnCtxt.prototype.suggest_unwrapping_inner_self = function (this: FnCtxt, err: Diag, source: SelfSource, actual: Ty, item_name: Ident): void {
  const tcx = this.tcx;
  if (source.$ !== "MethodCall") {
    return;
  }
  const expr = source._0;
  const call_expr = tcx.hir_expect_expr(tcx.parent_hir_id(expr.hir_id));

  const ak = actual.kind();
  if (ak.$ !== "Adt") {
    return;
  }
  const kind = ak._0;
  const args = ak._1;
  switch (kind.adt_kind()) {
    case "Enum": {
      const matching_variants: [VariantDef, FieldDef, Pick][] = [];
      for (const variant of kind.variants()) {
        if (variant.fields.length !== 1) {
          continue;
        }
        const field = variant.fields[0]!;
        const field_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));

        // Skip `_`, since that'll just lead to ambiguity.
        if (this.deeply_resolve_ignoring_regions(field_ty, fold_Ty).is_ty_var()) {
          continue;
        }

        const r = this.lookup_probe_for_diagnostic(item_name, field_ty, call_expr, ProbeScope.TraitsInScope, undefined);
        if (r.$ === "Ok") matching_variants.push([variant, field, r._0]);
      }

      const ret_ty_matches = (diagnostic_item: Symbol): boolean => {
        const ret_ty = this.ret_coercion === undefined ? undefined : this.deeply_resolve_ignoring_regions(this.ret_coercion.expected_ty(), fold_Ty);
        if (ret_ty !== undefined) {
          const rk = ret_ty.kind();
          if (rk.$ === "Adt") {
            const d = tcx.get_diagnostic_item(diagnostic_item);
            if (d !== undefined && DefId_eq(d, rk._0.did())) {
              return true;
            }
          }
        }
        return false;
      };

      if (matching_variants.length === 1) {
        const [, field, pick] = matching_variants[0]!;
        const self_ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
        err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_name)}\` exists on the type \`${display_Ty(self_ty)}\``);
        let article: string, kind_: string, variant: string, question: boolean;
        if (
          tcx.is_diagnostic_item(sym.Result, kind.did()) &&
          // Do not suggest `.expect()` in const context where it's not available. rust-lang/rust#149316
          !tcx.hir_is_inside_const_context(expr.hir_id)
        ) {
          [article, kind_, variant, question] = ["a", "Result", "Err", ret_ty_matches(sym.Result)];
        } else if (tcx.is_diagnostic_item(sym.Option, kind.did())) {
          [article, kind_, variant, question] = ["an", "Option", "None", ret_ty_matches(sym.Option)];
        } else {
          return;
        }
        if (question) {
          err.span_suggestion_verbose(
            Span.shrink_to_hi(expr.span),
            `use the \`?\` operator to extract the \`${display_Ty(self_ty)}\` value, propagating ${article} \`${kind_}::${variant}\` value to the caller`,
            "?",
            "MachineApplicable",
          );
        } else {
          err.span_suggestion_verbose(
            Span.shrink_to_hi(expr.span),
            `consider using \`${kind_}::expect\` to unwrap the \`${display_Ty(self_ty)}\` value, panicking if the value is ${article} \`${kind_}::${variant}\``,
            '.expect("REASON")',
            "HasPlaceholders",
          );
        }
      } else {
        // FIXME(compiler-errors): Support suggestions for other matching enum variants
      }
      break;
    }
    // Target wrapper types - types that wrap or pretend to wrap another type,
    // perhaps this inner type is meant to be called?
    case "Struct":
    case "Union": {
      if (args.length !== 1) {
        return;
      }
      const first = args[0]!;
      const fk = GenericArg.kind(first);
      if (fk.$ !== "Type") {
        return;
      }
      const ty = fk._0;
      const r = this.lookup_probe_for_diagnostic(item_name, ty, call_expr, ProbeScope.TraitsInScope, undefined);
      if (r.$ !== "Ok") {
        return;
      }
      const pick = r._0;

      const name = this.ty_to_string(actual);
      const inner_id = kind.did();
      const aopa = pick.autoref_or_ptr_adjustment;
      const mutable = aopa !== undefined && aopa.$ === "Autoref" ? aopa.mutbl : undefined;

      if (tcx.is_diagnostic_item(sym.LocalKey, inner_id)) {
        err.help("use `with` or `try_with` to access thread local storage");
      } else if (tcx.is_lang_item(kind.did(), LangItem.MaybeUninit)) {
        err.help(`if this \`${name}\` has been initialized, use one of the \`assume_init\` methods to access the inner value`);
      } else if (tcx.is_diagnostic_item(sym.RefCell, inner_id)) {
        let suggestion: string, borrow_kind: string, panic_if: string;
        switch (mutable) {
          case "Not":
            [suggestion, borrow_kind, panic_if] = [".borrow()", "borrow", "a mutable borrow exists"];
            break;
          case "Mut":
            [suggestion, borrow_kind, panic_if] = [".borrow_mut()", "mutably borrow", "any borrows exist"];
            break;
          case undefined:
            return;
        }
        err.span_suggestion_verbose(Span.shrink_to_hi(expr.span), `use \`${suggestion}\` to ${borrow_kind} the \`${display_Ty(ty)}\`, panicking if ${panic_if}`, suggestion, "MaybeIncorrect");
      } else if (tcx.is_diagnostic_item(sym.Mutex, inner_id)) {
        err.span_suggestion_verbose(
          Span.shrink_to_hi(expr.span),
          `use \`.lock().unwrap()\` to borrow the \`${display_Ty(ty)}\`, blocking the current thread until it can be acquired`,
          ".lock().unwrap()",
          "MaybeIncorrect",
        );
      } else if (tcx.is_diagnostic_item(sym.RwLock, inner_id)) {
        let suggestion: string, borrow_kind: string;
        switch (mutable) {
          case "Not":
            [suggestion, borrow_kind] = [".read().unwrap()", "borrow"];
            break;
          case "Mut":
            [suggestion, borrow_kind] = [".write().unwrap()", "mutably borrow"];
            break;
          case undefined:
            return;
        }
        err.span_suggestion_verbose(
          Span.shrink_to_hi(expr.span),
          `use \`${suggestion}\` to ${borrow_kind} the \`${display_Ty(ty)}\`, blocking the current thread until it can be acquired`,
          suggestion,
          "MaybeIncorrect",
        );
      } else {
        return;
      }

      err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_name)}\` exists on the type \`${display_Ty(ty)}\``);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3455 note_unmet_impls_on_type
FnCtxt.prototype.note_unmet_impls_on_type = function (this: FnCtxt, err: Diag, errors: readonly FulfillmentError[], suggest_derive: boolean): void {
  const preds: [Predicate, TraitClause][] = [];
  for (const e of errors) {
    const k = Binder.skip_binder(e.obligation.predicate.kind());
    if (k.$ === "Clause" && k._0.$ === "Trait") {
      const pred = k._0._0;
      if (TraitClause.self_ty(pred).kind().$ === "Adt") {
        preds.push([e.root_obligation.predicate, pred]);
      }
    }
  }

  // Note for local items and foreign items respectively.
  const local_preds: [Predicate, TraitClause][] = [];
  const foreign_preds: [Predicate, TraitClause][] = [];
  for (const p of preds) {
    const k = TraitClause.self_ty(p[1]).kind();
    if (k.$ === "Adt" ? k._0.did().is_local() : false) {
      local_preds.push(p);
    } else {
      foreign_preds.push(p);
    }
  }

  sort_by_cached_key(local_preds, ([, pred]) => display_TraitRef(pred.trait_ref), str_cmp);
  // PORT: `FxIndexSet<DefId>`: insertion-ordered, deduplicated.
  const local_def_ids = new DefIdSet();
  for (const [, pred] of local_preds) {
    const k = TraitClause.self_ty(pred).kind();
    if (k.$ === "Adt") local_def_ids.add(k._0.did());
  }
  const local_spans_vec: Span[] = [];
  for (const def_id of local_def_ids) {
    const span = this.tcx.def_span(def_id);
    if (!Span.is_dummy(span)) local_spans_vec.push(span);
  }
  const local_spans: MultiSpan = MultiSpan.from_Vec(local_spans_vec);
  for (const [, pred] of local_preds) {
    const k = TraitClause.self_ty(pred).kind();
    if (k.$ === "Adt") {
      local_spans.push_span_label(this.tcx.def_span(k._0.did()), `must implement \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(pred.trait_ref))}\``);
    }
  }
  if (local_spans.primary_span() !== undefined) {
    let msg: string;
    if (local_preds.length === 1) {
      const [, local_pred] = local_preds[0]!;
      msg = `an implementation of \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(local_pred.trait_ref))}\` might be missing for \`${display_Ty(TraitClause.self_ty(local_pred))}\``;
    } else {
      msg = `the following type${pluralize(local_def_ids.size)} would have to \`impl\` ${local_def_ids.size === 1 ? "its" : "their"} required trait${pluralize(local_preds.length)} for this operation to be valid`;
    }
    err.span_note(local_spans, msg);
  }

  sort_by_cached_key(foreign_preds, ([, pred]) => display_TraitRef(pred.trait_ref), str_cmp);

  for (const [, pred] of foreign_preds) {
    const ty = TraitClause.self_ty(pred);
    const k = ty.kind();
    if (k.$ !== "Adt") continue;
    const def = k._0;
    const span = this.tcx.def_span(def.did());
    if (Span.is_dummy(span)) {
      continue;
    }
    const mspan: MultiSpan = MultiSpan.from_Span(span);
    mspan.push_span_label(span, `\`${display_Ty(ty)}\` is defined in another crate`);
    err.span_note(mspan, `\`${display_Ty(ty)}\` does not implement \`${display_TraitRefPrintSugared(TraitRef_print_trait_sugared(pred.trait_ref))}\``);

    foreign_preds.find(([root_pred, pred]) => {
      const rk = Binder.skip_binder(root_pred.kind());
      if (rk.$ === "Clause" && rk._0.$ === "Trait") {
        const root_adt = TraitClause.self_ty(rk._0._0).ty_adt_def();
        if (root_adt !== undefined) {
          return this.suggest_hashmap_on_unsatisfied_hashset_buildhasher(err, pred, root_adt);
        }
      }
      return false;
    });
  }

  const preds_: UnsatisfiedPredicates = errors.map((e) => [e.obligation.predicate, undefined, e.obligation.cause]);
  if (suggest_derive) {
    this.suggest_derive(err, preds_);
  } else {
    // The predicate comes from a binop where the lhs and rhs have different types.
    this.note_predicate_source_and_get_derives(err, preds_);
  }
};

/// Checks if we can suggest a derive macro for the unmet trait bound.
/// Returns Some(list_of_derives) if possible, or None if not.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3570 consider_suggesting_derives_for_ty
FnCtxt.prototype.consider_suggesting_derives_for_ty = function (this: FnCtxt, trait_pred: TraitClause, adt: AdtDef): [string, OrdSpan, Symbol][] | undefined {
  const diagnostic_name = this.tcx.get_diagnostic_name(TraitClause.def_id(trait_pred));
  if (diagnostic_name === undefined) return undefined;

  let can_derive: boolean;
  if (diagnostic_name === sym.Copy || diagnostic_name === sym.Clone) {
    can_derive = true;
  } else if (adt.is_union()) {
    can_derive = false;
  } else if (
    diagnostic_name === sym.Default ||
    diagnostic_name === sym.Eq ||
    diagnostic_name === sym.PartialEq ||
    diagnostic_name === sym.Ord ||
    diagnostic_name === sym.PartialOrd ||
    diagnostic_name === sym.Hash ||
    diagnostic_name === sym.Debug
  ) {
    can_derive = true;
  } else {
    can_derive = false;
  }

  if (!can_derive) {
    return undefined;
  }

  const trait_def_id = TraitClause.def_id(trait_pred);
  const self_ty = TraitClause.self_ty(trait_pred);

  // We need to check if there is already a manual implementation of the trait
  // for this specific ADT to avoid suggesting `#[derive(..)]` that would conflict.
  for (const impl_def_id of this.tcx.non_blanket_impls_for_ty(trait_def_id, self_ty)) {
    const def = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_def_id) as EarlyBinder<Ty>)).ty_adt_def();
    if (def !== undefined && DefId_eq(def.did(), adt.did())) {
      return undefined;
    }
  }

  const derives: [string, OrdSpan, Symbol][] = [];
  const self_name = display_Ty(self_ty);
  const self_span = new OrdSpan(this.tcx.def_span(adt.did()));

  for (const super_trait of supertraits(this.tcx, Binder.dummy(trait_pred.trait_ref, fold_TraitRef))) {
    const parent_diagnostic_name = this.tcx.get_diagnostic_name(PolyTraitRef.def_id(super_trait));
    if (parent_diagnostic_name !== undefined) {
      derives.push([self_name, self_span, parent_diagnostic_name]);
    }
  }

  derives.push([self_name, self_span, diagnostic_name]);

  return derives;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3626 note_predicate_source_and_get_derives
FnCtxt.prototype.note_predicate_source_and_get_derives = function (this: FnCtxt, err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): [string, OrdSpan, Symbol][] {
  const derives: [string, OrdSpan, Symbol][] = [];
  const traits: DefId[] = [];
  for (const [pred] of unsatisfied_predicates) {
    const k = Binder.no_bound_vars(pred.kind(), d_PredicateKind);
    if (!(k !== undefined && k.$ === "Clause" && k._0.$ === "Trait")) {
      continue;
    }
    const trait_pred = k._0._0;
    const adt_ = TraitClause.self_ty(trait_pred).ty_adt_def();
    if (!(adt_ !== undefined && adt_.did().is_local())) {
      continue;
    }
    const adt = adt_;
    const new_derives = this.consider_suggesting_derives_for_ty(trait_pred, adt);
    if (new_derives !== undefined) {
      derives.push(...new_derives);
    } else {
      traits.push(TraitClause.def_id(trait_pred));
    }
  }
  sort_by_cached_key(traits, (id) => this.tcx.def_path_str(id), str_cmp);
  dedup_by(traits, DefId_eq);

  const len = traits.length;
  if (len > 0) {
    const span = MultiSpan.from_spans(traits.map((did) => this.tcx.def_span(did)));
    let names = `\`${this.tcx.def_path_str(traits[0]!)}\``;
    for (let i = 1; i < traits.length; i++) {
      const did = traits[i]!;
      if (len > 2) {
        names += ", ";
      }
      if (i === len - 1) {
        names += " and ";
      }
      names += "`";
      names += this.tcx.def_path_str(did);
      names += "`";
    }
    err.span_note(span, `the trait${pluralize(len)} ${names} must be implemented`);
  }

  return derives;
};

/** PORT: `Ord for (String, OrdSpan, Symbol)` (derived tuple order; `Symbol`'s derived `Ord` is its index). */
function cmp_derive(a: [string, OrdSpan, Symbol], b: [string, OrdSpan, Symbol]): number {
  const c = str_cmp(a[0], b[0]);
  if (c !== 0) return c;
  const d = a[1].cmp(b[1]);
  if (d !== 0) return d;
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3677 suggest_derive
FnCtxt.prototype.suggest_derive = function (this: FnCtxt, err: Diag, unsatisfied_predicates: UnsatisfiedPredicates): boolean {
  const derives = this.note_predicate_source_and_get_derives(err, unsatisfied_predicates);
  derives.sort(cmp_derive);
  dedup_by(derives, (a, b) => cmp_derive(a, b) === 0);

  const derives_grouped: [string, Span, string][] = [];
  for (const [self_name, self_span, trait_name] of derives) {
    const last = derives_grouped[derives_grouped.length - 1];
    if (last !== undefined) {
      const [last_self_name] = last;
      if (last_self_name === self_name) {
        last[2] += `, ${display_Symbol(trait_name)}`;
        continue;
      }
    }
    derives_grouped.push([self_name, self_span._0, display_Symbol(trait_name)]);
  }

  for (const [self_name, self_span, traits] of derives_grouped) {
    err.span_suggestion_verbose(Span.shrink_to_lo(self_span), `consider annotating \`${self_name}\` with \`#[derive(${traits})]\``, `#[derive(${traits})]\n`, "MaybeIncorrect");
  }
  return derives_grouped.length !== 0;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3708 note_derefed_ty_has_method
FnCtxt.prototype.note_derefed_ty_has_method = function (this: FnCtxt, err: Diag, self_source: SelfSource, rcvr_ty: Ty, item_name: Ident, expected: Expectation): void {
  if (self_source.$ !== "QPath") {
    return;
  }
  const ty = self_source._0;
  let first = true;
  for (const [deref_ty] of this.autoderef(DUMMY_SP, rcvr_ty).silence_errors()) {
    // `.skip(1)`
    if (first) {
      first = false;
      continue;
    }
    const r = this.probe_for_name("Path", item_name, Expectation.only_has_type(expected, this), { _0: true }, deref_ty, ty.hir_id, ProbeScope.TraitsInScope);
    if (r.$ === "Ok") {
      const pick = r._0;
      let self_ty: Ty | undefined;
      if (
        IsSuggestable.is_suggestable(deref_ty, this.tcx, true, fold_Ty) &&
        // If this method receives `&self`, then the provided
        // argument _should_ coerce, so it's valid to suggest
        // just changing the path.
        AssocItem.is_method(pick.item) &&
        (self_ty = Binder.skip_binder(PolyFnSig.inputs(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))))[0]) !== undefined &&
        self_ty.is_ref()
      ) {
        let suggested_path: string;
        const dk = deref_ty.kind();
        if (
          dk.$ === "Bool" ||
          dk.$ === "Char" ||
          dk.$ === "Int" ||
          dk.$ === "Uint" ||
          dk.$ === "Float" ||
          dk.$ === "Adt" ||
          dk.$ === "Str" ||
          (dk.$ === "Alias" && (dk._1.kind.$ === "Projection" || dk._1.kind.$ === "Inherent")) ||
          dk.$ === "Param"
        ) {
          suggested_path = display_Ty(deref_ty);
        } else if (
          // we need to test something like  <&[_]>::len or <(&[u32])>::len
          // and Vec::function();
          // <&[_]>::len or <&[u32]>::len doesn't need an extra "<>" between
          // but for Adt type like Vec::function()
          // we would suggest <[_]>::function();
          this.tcx.sess.source_map().span_wrapped_by_angle_or_parentheses(ty.span)
        ) {
          suggested_path = display_Ty(deref_ty);
        } else {
          suggested_path = `<${display_Ty(deref_ty)}>`;
        }
        err.span_suggestion_verbose(ty.span, `the function \`${display_Ident(item_name)}\` is implemented on \`${display_Ty(deref_ty)}\``, suggested_path, "MaybeIncorrect");
      } else {
        err.span_note(ty.span, `the function \`${display_Ident(item_name)}\` is implemented on \`${display_Ty(deref_ty)}\``);
      }
      return;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3785 suggest_bounds_for_range_to_method
FnCtxt.prototype.suggest_bounds_for_range_to_method = function (this: FnCtxt, err: Diag, source: SelfSource, item_ident: Ident): void {
  if (source.$ !== "MethodCall") return;
  const rcvr_expr = source._0;
  if (rcvr_expr.kind.$ !== "Struct") return;
  const qpath = rcvr_expr.kind._0;
  const fields = rcvr_expr.kind._1;
  const lang_item = this.tcx.qpath_lang_item(qpath);
  if (lang_item === undefined) {
    return;
  }
  let is_inclusive: boolean;
  if (lang_item === LangItem.RangeTo) {
    is_inclusive = false;
  } else if (lang_item === LangItem.RangeToInclusive || lang_item === LangItem.RangeInclusiveCopy) {
    is_inclusive = true;
  } else {
    return;
  }

  const iterator_trait = this.tcx.get_diagnostic_item(sym.Iterator);
  if (iterator_trait === undefined) return;
  if (AssocItems.filter_by_name_unhygienic(this.tcx.associated_items(iterator_trait) as AssocItems, item_ident.name).next().done) {
    return;
  }

  const source_map = this.tcx.sess.source_map();
  const range_type = is_inclusive ? "RangeInclusive" : "Range";
  const end_field = fields.find((f) => f.ident.name === sym.end);
  if (end_field === undefined) {
    return;
  }

  const element_ty = this.typeck_results.expr_ty_opt(end_field.expr);
  const is_integral = element_ty !== undefined && element_ty.is_integral();
  const end_is_negative = is_integral && end_field.expr.kind.$ === "Unary" && end_field.expr.kind._0 === "Neg";

  const sr = source_map.span_to_snippet(rcvr_expr.span);
  if (sr.$ !== "Ok") return;
  const snippet = sr._0.toString();

  let offset = 0;
  for (const c of snippet) {
    const cp = c.codePointAt(0)!;
    if (!(c === "(" || is_whitespace(cp))) break;
    offset += utf8_width(cp);
  }

  const insert_span = Span.shrink_to_lo(Span.with_lo(rcvr_expr.span, (Span.lo(rcvr_expr.span) + offset) as BytePos));

  const [value, appl]: [string, Applicability] = is_integral && !end_is_negative ? ["0", "MachineApplicable"] : ["/* start */", "HasPlaceholders"];

  err.span_suggestion_verbose(insert_span, `consider using a bounded \`${range_type}\` by adding a concrete starting value`, value, appl);
};

/// Print out the type for use in value namespace.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3851 ty_to_value_string
FnCtxt.prototype.ty_to_value_string = function (this: FnCtxt, ty: Ty): string {
  const k = ty.kind();
  if (k.$ === "Adt") {
    return this.tcx.value_path_str_with_args(k._0.did(), k._1);
  }
  return this.ty_to_string(ty);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3858 suggest_await_before_method
FnCtxt.prototype.suggest_await_before_method = function (this: FnCtxt, err: Diag, item_name: Ident, ty: Ty, call: hir.Expr, span: Span, return_type: Ty | undefined): void {
  const output_ty_ = this.tcx.get_impl_future_output_ty(ty);
  if (output_ty_ === undefined) return;
  const output_ty = this.deeply_resolve_ignoring_regions(output_ty_, fold_Ty);
  const method_exists = this.method_exists_for_diagnostic(item_name, output_ty, call.hir_id, return_type);
  // debug!("suggest_await_before_method: is_method_exist={}", method_exists);
  if (method_exists) {
    err.span_suggestion_verbose(Span.shrink_to_lo(span), "consider `await`ing on the `Future` and calling the method on its `Output`", "await.", "MaybeIncorrect");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3882 set_label_for_method_error
FnCtxt.prototype.set_label_for_method_error = function (
  this: FnCtxt,
  err: Diag,
  source: SelfSource,
  rcvr_ty: Ty,
  item_ident: Ident,
  expr_id: HirId,
  span: Span,
  sugg_span: Span,
  within_macro_span: Span | undefined,
  args: readonly hir.Expr[] | undefined,
): void {
  const tcx = this.tcx;
  if (tcx.sess.source_map().is_multiline(sugg_span)) {
    err.span_context(Span.with_hi(sugg_span, Span.lo(span)));
  }
  if (within_macro_span !== undefined) {
    err.span_label(within_macro_span, "due to this macro variable");
  }

  if (source.$ === "QPath" && args !== undefined) {
    this.find_builder_fn(err, rcvr_ty, expr_id);
  }

  if (tcx.ty_is_opaque_future(rcvr_ty) && item_ident.name === sym.poll) {
    const ty_str = this.tcx.short_string(rcvr_ty, err.long_ty_path(), print_Ty);
    err.help(`method \`poll\` found on \`Pin<&mut ${ty_str}>\`, see documentation for \`std::pin::Pin\``);
    err.help("self type must be pinned to call `Future::poll`, see https://rust-lang.github.io/async-book/part-reference/pinning.html");
  }

  const span_ = (tcx.resolutions(null) as ResolverGlobalCtxt).confused_type_with_std_module.get(Span.with_parent(span, undefined));
  if (span_ !== undefined) {
    err.span_suggestion(Span.shrink_to_lo(span_), "you are looking for the module in `std`, not the primitive type", "std::", "MachineApplicable");
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3930 suggest_on_pointer_type
FnCtxt.prototype.suggest_on_pointer_type = function (this: FnCtxt, err: Diag, source: SelfSource, rcvr_ty: Ty, item_ident: Ident): void {
  const tcx = this.tcx;
  // on pointers, check if the method would exist on a reference
  if (source.$ !== "MethodCall") return;
  const rcvr_expr = source._0;
  const rk = rcvr_ty.kind();
  if (rk.$ !== "RawPtr") return;
  const ty = rk._0;
  const ptr_mutbl = rk._1;
  const r = this.lookup_probe_for_diagnostic(
    item_ident,
    Ty.new_ref(tcx, Region.new_error_misc(tcx), ty, ptr_mutbl),
    this.tcx.hir_expect_expr(this.tcx.parent_hir_id(rcvr_expr.hir_id)),
    ProbeScope.TraitsInScope,
    undefined,
  );
  if (r.$ !== "Ok") return;
  const pick = r._0;
  const pk = pick.self_ty.kind();
  if (pk.$ !== "Ref") return;
  const sugg_mutbl = pk._2;
  if (!(Mutability.is_not(sugg_mutbl) || Mutability.is_mut(ptr_mutbl))) return;
  let method: string, method_anchor: string;
  switch (sugg_mutbl) {
    case "Not": {
      switch (ptr_mutbl) {
        case "Not":
          method_anchor = "as_ref";
          break;
        case "Mut":
          method_anchor = "as_ref-1";
          break;
      }
      method = "as_ref";
      break;
    }
    case "Mut":
      [method, method_anchor] = ["as_mut", "as_mut"];
      break;
  }
  err.span_note(tcx.def_span(pick.item.def_id), `the method \`${display_Ident(item_ident)}\` exists on the type \`${display_Ty(pick.self_ty)}\``);
  const mut_str = Mutability.ptr_str(ptr_mutbl);
  err.note(`you might want to use the unsafe method \`<*${mut_str} T>::${method}\` to get an optional reference to the value behind the pointer`);
  err.note(
    `read the documentation for \`<*${mut_str} T>::${method}\` and ensure you satisfy its safety preconditions before calling it to avoid undefined behavior: https://doc.rust-lang.org/std/primitive.pointer.html#method.${method_anchor}`,
  );
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:3978 suggest_use_candidates
FnCtxt.prototype.suggest_use_candidates = function (this: FnCtxt, candidates: DefId[], handle_candidates: (_1: string[], _2: string[], _3: Span) => void): void {
  const parent_map = this.tcx.visible_parent_map(null) as DefIdMap<DefId>;

  const accessible_candidates: DefId[] = [];
  const inaccessible_candidates: DefId[] = [];
  for (const id of candidates) {
    const vis = this.tcx.visibility(id);
    let ok = Visibility.is_accessible_from(vis, this.mod_id, this.tcx);
    if (ok) {
      // Visibility alone does not make `fn_name::Trait` an importable path.
      // We need to make sure all parent are modules, otherwise the path is not importable.
      for (let p = this.tcx.opt_parent(id); p !== undefined; p = this.tcx.opt_parent(p)) {
        if (this.tcx.def_kind(p).$ !== "Mod") {
          ok = false;
          break;
        }
      }
    }
    (ok ? accessible_candidates : inaccessible_candidates).push(id);
  }

  const sugg = (candidates_: DefId[], visible: boolean): string[] => {
    // Separate out candidates that must be imported with a glob, because they are named `_`
    // and cannot be referred with their identifier.
    const candidates: DefId[] = [];
    const globs: DefId[] = [];
    for (const trait_did of candidates_) {
      let keep = true;
      const parent_did = parent_map.get(trait_did);
      if (parent_did !== undefined) {
        // If the item is re-exported as `_`, we should suggest a glob-import instead.
        if (
          !DefId_eq(parent_did, this.tcx.parent(trait_did)) &&
          (this.tcx.module_children(parent_did) as readonly ModChild[])
            .filter((child) => {
              const d = Res.opt_def_id(child.res);
              return d !== undefined && DefId_eq(d, trait_did);
            })
            .every((child) => child.ident.name === kw.Underscore)
        ) {
          keep = false;
        }
      }
      (keep ? candidates : globs).push(trait_did);
    }

    const prefix = visible ? "use " : "";
    const postfix = visible ? ";" : "";
    const path_strings = candidates.map((trait_did) => `${prefix}${with_no_visible_paths_if_doc_hidden(() => with_crate_prefix(() => this.tcx.def_path_str(trait_did)))}${postfix}\n`);

    const glob_path_strings = globs.map((trait_did) => {
      const parent_did = unwrap(parent_map.get(trait_did));
      return `${prefix}${with_no_visible_paths_if_doc_hidden(() => with_crate_prefix(() => this.tcx.def_path_str(parent_did)))}::*${postfix} // trait ${display_Symbol(this.tcx.item_name(trait_did))}\n`;
    });
    const sugg = [...path_strings, ...glob_path_strings];
    sugg.sort(str_cmp);
    return sugg;
  };

  const accessible_sugg = sugg(accessible_candidates, true);
  const inaccessible_sugg = sugg(inaccessible_candidates, false);

  const [module] = this.tcx.hir_get_module(this.mod_id);
  const span = module.spans.inject_use_span;
  handle_candidates(accessible_sugg, inaccessible_sugg, span);
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4050 suggest_valid_traits
FnCtxt.prototype.suggest_valid_traits = function (this: FnCtxt, err: Diag, item_name: Ident, valid_out_of_scope_traits_: DefId[], explain: boolean): boolean {
  const valid_out_of_scope_traits = valid_out_of_scope_traits_.filter((id) => this.tcx.is_user_visible_dep(id.krate));
  if (valid_out_of_scope_traits.length !== 0) {
    const candidates = valid_out_of_scope_traits;
    sort_by_cached_key(candidates, (id) => this.tcx.def_path_str(id), str_cmp);
    dedup_by(candidates, DefId_eq);

    // `TryFrom` and `FromIterator` have no methods
    const edition_fix = candidates.find((did) => this.tcx.is_diagnostic_item(sym.TryInto, did));

    if (explain) {
      err.help("items from traits can only be used if the trait is in scope");
    }

    const this_trait_is =
      candidates.length === 1
        ? `trait \`${display_Symbol(this.tcx.item_name(candidates[0]!))}\` which provides \`${display_Ident(item_name)}\` is`
        : `the following traits which provide \`${display_Ident(item_name)}\` are`;
    const msg = `${this_trait_is} implemented but not in scope`;

    this.suggest_use_candidates(candidates, (accessible_sugg, inaccessible_sugg, span) => {
      const suggest_for_access = (err: Diag, msg_: string, suggs: string[]): void => {
        let msg = msg_;
        msg += `; perhaps you want to import ${suggs.length === 1 ? "it" : "one of them"}`;
        err.span_suggestions(span, msg, suggs, "MaybeIncorrect");
      };
      const suggest_for_privacy = (err: Diag, suggs: string[]): void => {
        const this_trait_is =
          suggs.length === 1 ? `trait \`${suggs[0]!.trim()}\` which provides \`${display_Ident(item_name)}\` is` : `the following traits which provide \`${display_Ident(item_name)}\` are`;
        const msg = `${this_trait_is} implemented but not reachable`;
        if (suggs.length === 1) {
          err.help(msg);
        } else {
          err.help(`${msg}:\n${suggs.join("").trimEnd()}`);
        }
      };
      if (accessible_sugg.length === 0) {
        // `inaccessible_sugg` must not be empty
        suggest_for_privacy(err, inaccessible_sugg);
      } else if (inaccessible_sugg.length === 0) {
        suggest_for_access(err, msg, accessible_sugg);
      } else {
        suggest_for_access(err, msg, accessible_sugg);
        suggest_for_privacy(err, inaccessible_sugg);
      }
    });

    if (edition_fix !== undefined) {
      const did = edition_fix;
      err.note(`'${with_crate_prefix(() => this.tcx.def_path_str(did))}' is included in the prelude starting in Edition 2021`);
    }

    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4132 suggest_traits_to_import
FnCtxt.prototype.suggest_traits_to_import = function (
  this: FnCtxt,
  err: Diag,
  span: Span,
  rcvr_ty: Ty,
  item_name: Ident,
  inputs_len: number | undefined,
  source: SelfSource,
  valid_out_of_scope_traits: DefId[],
  static_candidates: readonly CandidateSource[],
  unsatisfied_bounds: boolean,
  return_type: Ty | undefined,
  trait_missing_method: boolean,
): void {
  let alt_rcvr_sugg = false;
  let trait_in_other_version_found = false;
  if (source.$ === "MethodCall" && unsatisfied_bounds === false) {
    const rcvr = source._0;
    // debug!(
    //     "suggest_traits_to_import: span={:?}, item_name={:?}, rcvr_ty={:?}, rcvr={:?}",
    //     span, item_name, rcvr_ty, rcvr
    // );
    const skippable = [
      this.tcx.lang_items().clone_trait(),
      this.tcx.lang_items().deref_trait(),
      this.tcx.lang_items().deref_mut_trait(),
      this.tcx.lang_items().drop_trait(),
      this.tcx.get_diagnostic_item(sym.AsRef),
    ];
    /** PORT: `skippable.contains(&did)` on `[Option<DefId>; 5]`. */
    const skippable_contains = (did: DefId | undefined): boolean =>
      skippable.some((s) => (s === undefined ? did === undefined : did !== undefined && DefId_eq(s, did)));
    // Try alternative arbitrary self types that could fulfill this call.
    // FIXME: probe for all types that *could* be arbitrary self-types, not
    // just this list.
    const alts: [Ty, string, string | undefined][] = [
      [rcvr_ty, "", undefined],
      [Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_erased, rcvr_ty), "&mut ", "as_mut"],
      [Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, rcvr_ty), "&", "as_ref"],
    ];
    for (const [rcvr_ty, post, pin_call] of alts) {
      const r = this.lookup_probe_for_diagnostic(item_name, rcvr_ty, rcvr, ProbeScope.AllTraits, return_type);
      if (r.$ === "Ok") {
        const pick = r._0;
        // If the method is defined for the receiver we have, it likely wasn't `use`d.
        // We point at the method, but we just skip the rest of the check for arbitrary
        // self types and rely on the suggestion to `use` the trait from
        // `suggest_valid_traits`.
        const did = AssocItem.container_id(pick.item, this.tcx);
        if (skippable_contains(did)) {
          continue;
        }
        trait_in_other_version_found = this.detect_and_explain_multiple_crate_versions_of_trait_item(err, pick.item.def_id, rcvr.hir_id, rcvr_ty);
        if (pick.autoderefs === 0 && !trait_in_other_version_found) {
          err.span_label(AssocItem.ident(pick.item, this.tcx).span, `the method is available for \`${display_Ty(rcvr_ty)}\` here`);
        }
        break;
      } else if (r._0.$ === "Ambiguity") {
        // If the method is defined (but ambiguous) for the receiver we have, it is also
        // likely we haven't `use`d it. It may be possible that if we `Box`/`Pin`/etc.
        // the receiver, then it might disambiguate this method, but I think these
        // suggestions are generally misleading (see #94218).
        break;
      } else {
        // Err(_) => ()
      }

      const unpin_trait = this.tcx.lang_items().unpin_trait();
      if (unpin_trait === undefined) {
        return;
      }
      const pred = TraitRef.new(as_interner(this.tcx), unpin_trait, [GenericArg.from_Ty(rcvr_ty)]);
      const unpin = this.predicate_must_hold_considering_regions(
        Obligation.new(this.tcx, this.misc(rcvr.span), this.param_env, pred, (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx)),
      );
      const wrappers: [Ty | undefined, string][] = [
        [Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.OwnedBox), "Box::new"],
        [Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.Pin), "Pin::new"],
        [Ty.new_diagnostic_item(this.tcx, rcvr_ty, sym.Arc), "Arc::new"],
        [Ty.new_diagnostic_item(this.tcx, rcvr_ty, sym.Rc), "Rc::new"],
      ];
      for (const [rcvr_ty_, pre] of wrappers) {
        if (rcvr_ty_ === undefined) continue;
        const new_rcvr_t = rcvr_ty_;
        const r2 = this.lookup_probe_for_diagnostic(item_name, new_rcvr_t, rcvr, ProbeScope.AllTraits, return_type);
        if (r2.$ !== "Ok") continue;
        const pick = r2._0;
        // debug!("try_alt_rcvr: pick candidate {:?}", pick);
        const did = AssocItem.trait_container(pick.item, this.tcx);
        // We don't want to suggest a container type when the missing
        // method is `.clone()` or `.deref()` otherwise we'd suggest
        // `Arc::new(foo).clone()`, which is far from what the user wants.
        // Explicitly ignore the `Pin::as_ref()` method as `Pin` does not
        // implement the `AsRef` trait.
        const skip =
          skippable_contains(did) ||
          ("Pin::new" === pre && (sym.as_ref === item_name.name || !unpin)) ||
          (inputs_len !== undefined &&
            AssocItem.is_fn(pick.item) &&
            FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))).length !== inputs_len);
        // Make sure the method is defined for the *actual* receiver: we don't
        // want to treat `Box<Self>` as a receiver if it only works because of
        // an autoderef to `&self`
        if (pick.autoderefs === 0 && !skip) {
          err.span_label(AssocItem.ident(pick.item, this.tcx).span, `the method is available for \`${display_Ty(new_rcvr_t)}\` here`);
          err.multipart_suggestion(
            "consider wrapping the receiver expression with the appropriate type",
            [
              [Span.shrink_to_lo(rcvr.span), `${pre}(${post}`],
              [Span.shrink_to_hi(rcvr.span), ")"],
            ],
            "MaybeIncorrect",
          );
          // We don't care about the other suggestions.
          alt_rcvr_sugg = true;
        }
      }
      // We special case the situation where `Pin::new` wouldn't work, and instead
      // suggest using the `pin!()` macro instead.
      const new_rcvr_t = Ty.new_lang_item(this.tcx, rcvr_ty, LangItem.Pin);
      let pick: Pick | undefined;
      if (
        new_rcvr_t !== undefined &&
        // We didn't find an alternative receiver for the method.
        !alt_rcvr_sugg &&
        // `T: !Unpin`
        !unpin &&
        // Either `Pin::as_ref` or `Pin::as_mut`.
        pin_call !== undefined &&
        // Search for `item_name` as a method accessible on `Pin<T>`.
        (pick = ((r) => (r.$ === "Ok" ? r._0 : undefined))(this.lookup_probe_for_diagnostic(item_name, new_rcvr_t, rcvr, ProbeScope.AllTraits, return_type))) !== undefined &&
        // We skip some common traits that we don't want to consider because autoderefs
        // would take care of them.
        !skippable_contains(AssocItem.container_id(pick.item, this.tcx)) &&
        // Do not suggest pinning when the method is directly on `Pin`.
        ((did) => {
          if (did === undefined) return true;
          const k = EarlyBinder.skip_binder(this.tcx.type_of(did) as EarlyBinder<Ty>).kind();
          if (k.$ === "Adt") {
            const pin_type = this.tcx.lang_items().pin_type();
            return !(pin_type !== undefined && DefId_eq(k._0.did(), pin_type));
          }
          return true;
        })(AssocItem.impl_container(pick.item, this.tcx)) &&
        // We don't want to go through derefs.
        pick.autoderefs === 0 &&
        // Check that the method of the same name that was found on the new `Pin<T>`
        // receiver has the same number of arguments that appear in the user's code.
        inputs_len !== undefined &&
        AssocItem.is_fn(pick.item) &&
        FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>))).length === inputs_len
      ) {
        const indent_ = this.tcx.sess.source_map().indentation_before(rcvr.span);
        const indent = indent_ === undefined ? " " : indent_.toString();
        let expr = rcvr;
        for (;;) {
          const n = this.tcx.parent_hir_node(expr.hir_id);
          if (n.$ === "Expr" && n._0.kind.$ === "MethodCall") {
            expr = n._0;
          } else {
            break;
          }
        }
        const pn = this.tcx.parent_hir_node(expr.hir_id);
        let code: Result<Str, unknown> | undefined;
        if (pn.$ === "LetStmt" && pn._0.init !== undefined && (code = this.tcx.sess.source_map().span_to_snippet(rcvr.span)).$ === "Ok") {
          const stmt = pn._0;
          const init = pn._0.init;
          // We need to take care to account for the existing binding when we
          // suggest the code.
          err.multipart_suggestion(
            "consider pinning the expression",
            [
              [Span.shrink_to_lo(stmt.span), `let mut pinned = std::pin::pin!(${code._0.toString()});\n${indent}`],
              [Span.until(init.span, Span.shrink_to_hi(rcvr.span)), `pinned.${pin_call}()`],
            ],
            "MaybeIncorrect",
          );
        } else if (pn.$ === "Block" || pn.$ === "Stmt") {
          // There's no binding, so we can provide a slightly nicer looking
          // suggestion.
          err.multipart_suggestion(
            "consider pinning the expression",
            [
              [Span.shrink_to_lo(rcvr.span), "let mut pinned = std::pin::pin!("],
              [Span.shrink_to_hi(rcvr.span), `);\n${indent}pinned.${pin_call}()`],
            ],
            "MaybeIncorrect",
          );
        } else {
          // We don't quite know what the users' code looks like, so we don't
          // provide a pinning suggestion.
          err.span_help(rcvr.span, "consider pinning the expression with `std::pin::pin!()` and assigning that to a new binding");
        }
        // We don't care about the other suggestions.
        alt_rcvr_sugg = true;
      }
    }
  }

  if (source.$ === "QPath" && valid_out_of_scope_traits.length !== 0 && source._0.kind.$ === "Path" && source._0.kind._0.$ === "Resolved") {
    const ty = source._0;
    const assoc = AssocItems.filter_by_name_unhygienic(this.tcx.associated_items(valid_out_of_scope_traits[0]!) as AssocItems, item_name.name).next();
    if (!assoc.done) {
      // See if the `Type::function(val)` where `function` wasn't found corresponds to a
      // `Trait` that is imported directly, but `Type` came from a different version of the
      // same crate.

      const rcvr_ty = this.node_ty_opt(ty.hir_id);
      trait_in_other_version_found = this.detect_and_explain_multiple_crate_versions_of_trait_item(err, assoc.value.def_id, ty.hir_id, rcvr_ty);
    }
  }
  if (!trait_in_other_version_found && this.suggest_valid_traits(err, item_name, valid_out_of_scope_traits, true)) {
    return;
  }

  const type_is_local = this.type_derefs_to_local(span, rcvr_ty, source);

  const arbitrary_rcvr: Span[] = [];
  // There are no traits implemented, so lets suggest some traits to
  // implement, by finding ones that have the item name, and are
  // legal to implement.
  // PORT: the three lazy `.filter(..)`s run per element in sequence (the third pushes to `arbitrary_rcvr`).
  const candidates = all_traits(this.tcx).filter(
    (info) =>
      // Don't issue suggestions for unstable traits since they're
      // unlikely to be implementable anyway
      ((): boolean => {
        const attr = this.tcx.lookup_stability(info.def_id) as Stability | undefined;
        return attr !== undefined ? StabilityLevel.is_stable(attr.level) : true;
      })() &&
      // Static candidates are already implemented, and known not to work
      // Do not suggest them again
      static_candidates.every((sc) => {
        switch (sc.$) {
          case "Trait":
            return !DefId_eq(sc._0, info.def_id);
          case "Impl": {
            const t = this.tcx.impl_opt_trait_id(sc._0);
            return !(t !== undefined && DefId_eq(t, info.def_id));
          }
        }
      }) &&
      ((): boolean => {
        // We approximate the coherence rules to only suggest
        // traits that are legal to implement by requiring that
        // either the type or trait is local. Multi-dispatch means
        // this isn't perfect (that is, there are cases when
        // implementing a trait would be legal but is rejected
        // here).
        if (!((type_is_local || info.def_id.is_local()) && !this.tcx.trait_is_auto(info.def_id))) return false;
        const item = this.associated_value(info.def_id, item_name);
        if (item === undefined) return false;
        if (AssocItem.is_fn(item)) {
          const local = item.def_id.as_local();
          const id = local === undefined ? undefined : this.tcx.hir_node_by_def_id(local);
          if (id !== undefined && id.$ === "TraitItem" && id._0.kind.$ === "Fn") {
            const fn_sig = id._0.kind._0;
            const method = id._0.kind._1;
            let self_first_arg: boolean;
            switch (method.$) {
              case "Required": {
                const ident = method._0[0];
                self_first_arg = method._0.length >= 1 && ident !== undefined && ident.name === kw.SelfLower;
                break;
              }
              case "Provided": {
                const param = this.tcx.hir_body(method._0).params[0];
                self_first_arg = param !== undefined && param.pat.kind.$ === "Binding" && param.pat.kind._2.name === kw.SelfLower;
                break;
              }
            }

            if (!ImplicitSelfKind.has_implicit_self(fn_sig.decl.implicit_self()) && self_first_arg) {
              const ty = fn_sig.decl.inputs[0];
              if (ty !== undefined) {
                arbitrary_rcvr.push(ty.span);
              }
              return false;
            }
          }
        }
        // We only want to suggest public or local traits (#45781).
        return Visibility.is_public(AssocItem.visibility(item, this.tcx)) || info.def_id.is_local();
      })(),
  );
  for (const span of arbitrary_rcvr) {
    err.span_label(span, "the method might not be found because of this arbitrary self type");
  }
  if (alt_rcvr_sugg) {
    return;
  }

  if (candidates.length !== 0) {
    // Sort local crate results before others
    sort_by_cached_key(
      candidates,
      (info): [boolean, string] => [!info.def_id.is_local(), this.tcx.def_path_str(info.def_id)],
      (a, b) => (a[0] !== b[0] ? (a[0] ? 1 : -1) : str_cmp(a[1], b[1])),
    );
    dedup_by(candidates, (a, b) => DefId_eq(a.def_id, b.def_id));

    let param_type: ParamTy | undefined;
    const rk = rcvr_ty.kind();
    if (rk.$ === "Param") {
      param_type = rk._0;
    } else if (rk.$ === "Ref") {
      const ik = rk._1.kind();
      param_type = ik.$ === "Param" ? ik._0 : undefined;
    } else {
      param_type = undefined;
    }
    if (!trait_missing_method) {
      err.help(
        param_type !== undefined
          ? "items from traits can only be used if the type parameter is bounded by the trait"
          : "items from traits can only be used if the trait is implemented and in scope",
      );
    }

    const candidates_len = candidates.length;
    const message = (action: string): string =>
      `the following ${candidates_len === 1 ? "trait defines" : "traits define"} an item \`${display_Ident(item_name)}\`, perhaps you need to ${action} ${candidates_len === 1 ? "it" : "one of them"}:`;
    // Obtain the span for `param` and use it for a structured suggestion.
    if (param_type !== undefined) {
      const param = param_type;
      const generics = this.tcx.generics_of(LocalDefId.to_def_id(this.body_def_id)) as Generics;
      const type_param = generics.type_param(param, this.tcx);
      const tcx = this.tcx;
      const def_id = type_param.def_id.as_local();
      if (def_id !== undefined) {
        const id = tcx.local_def_id_to_hir_id(def_id);
        // Get the `hir::Param` to verify whether it already has any bounds.
        // We do this to avoid suggesting code that ends up as `T: FooBar`,
        // instead we suggest `T: Foo + Bar` in that case.
        const node = tcx.hir_node(id);
        if (node.$ === "GenericParam") {
          const param = node._0;
          type Introducer = "Plus" | "Colon" | "Nothing";
          const hir_generics = unwrap(tcx.hir_get_generics(id.owner.def_id));
          const trait_def_ids = new DefIdSet();
          for (const bp of hir_generics.bounds_for_param(def_id)) {
            for (const bound of bp.bounds) {
              const tr = GenericBound.trait_ref(bound);
              const d = tr === undefined ? undefined : tr.trait_def_id();
              if (d !== undefined) trait_def_ids.add(d);
            }
          }
          if (candidates.some((t) => trait_def_ids.has(t.def_id))) {
            return;
          }
          const msg = message(`restrict type parameter \`${display_Ident(ParamName.ident(param.name))}\` with`);
          const bounds_span = hir_generics.bounds_span_for_suggestions(def_id);
          let applicability: Applicability = "MaybeIncorrect";
          // Format the path of each suggested candidate, providing placeholders
          // for any generic arguments without defaults.
          const candidate_strs = candidates.map((cand) => {
            const cand_path = tcx.def_path_str(cand.def_id);
            const cand_params = (tcx.generics_of(cand.def_id) as Generics).own_params;
            const cand_args = cand_params
              .slice(1)
              .filter((param) => !((param.kind.$ === "Type" && param.kind.has_default) || (param.kind.$ === "Const" && param.kind.has_default)))
              .map((param) => Symbol.as_str(param.name))
              .join(", ");
            if (cand_args.length === 0) {
              return cand_path;
            } else {
              applicability = "HasPlaceholders";
              return `${cand_path}</* ${cand_args} */>`;
            }
          });

          if (rcvr_ty.is_ref() && param.is_impl_trait() && bounds_span !== undefined) {
            const [bounds_span_] = bounds_span;
            err.multipart_suggestions(
              msg,
              candidate_strs.map((cand): [Span, string][] => [
                [Span.shrink_to_lo(param.span), "("],
                [bounds_span_, ` + ${cand})`],
              ]),
              applicability,
            );
            return;
          }

          let sp: Span, introducer: Introducer, open_paren_sp: Span | undefined;
          if (bounds_span !== undefined) {
            const [span, open_paren_sp_] = bounds_span;
            [sp, introducer, open_paren_sp] = [span, "Plus", open_paren_sp_];
          } else if (param.colon_span !== undefined) {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.colon_span), "Nothing", undefined];
          } else if (param.is_impl_trait()) {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.span), "Plus", undefined];
          } else {
            [sp, introducer, open_paren_sp] = [Span.shrink_to_hi(param.span), "Colon", undefined];
          }

          const all_suggs = candidate_strs.map((cand) => {
            const suggestion = `${introducer === "Plus" ? " +" : introducer === "Colon" ? ":" : ""} ${cand}`;

            const suggs: [Span, string][] = [];

            if (open_paren_sp !== undefined) {
              suggs.push([open_paren_sp, "("]);
              suggs.push([sp, `)${suggestion}`]);
            } else {
              suggs.push([sp, suggestion]);
            }

            return suggs;
          });

          err.multipart_suggestions(msg, all_suggs, applicability);

          return;
        } else if (node.$ === "Item" && node._0.kind.$ === "Trait") {
          const ident = node._0.kind.ident;
          const bounds = node._0.kind.bounds;
          let sp: Span, sep: string, article: string;
          if (bounds.length === 0) {
            [sp, sep, article] = [Span.shrink_to_hi(ident.span), ":", "a"];
          } else {
            [sp, sep, article] = [Span.shrink_to_hi(GenericBound.span(bounds[bounds.length - 1]!)), " +", "another"];
          }
          err.span_suggestions(
            sp,
            message(`add ${article} supertrait for`),
            candidates.map((t) => `${sep} ${tcx.def_path_str(t.def_id)}`),
            "MaybeIncorrect",
          );
          return;
        }
      }
    }

    let potential_candidates: TraitInfo[];
    let explicitly_negative: TraitInfo[];
    const simp_rcvr_ty = param_type !== undefined ? undefined : simplify_type(as_interner(this.tcx), rcvr_ty, "AsRigid");
    if (param_type !== undefined) {
      // FIXME: Even though negative bounds are not implemented, we could maybe handle
      // cases where a positive bound implies a negative impl.
      [potential_candidates, explicitly_negative] = [candidates, []];
    } else if (simp_rcvr_ty !== undefined) {
      potential_candidates = [];
      explicitly_negative = [];
      for (const candidate of candidates) {
        // Check if there's a negative impl of `candidate` for `rcvr_ty`
        let any = false;
        for (const imp_did of this.tcx.all_impls(candidate.def_id)) {
          const header = this.tcx.impl_trait_header(imp_did) as ImplTraitHeader;
          if (header.polarity === "Positive") continue;
          const imp = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref));
          const imp_simp = simplify_type(as_interner(this.tcx), TraitRef.self_ty(imp), "AsRigid");
          if (imp_simp !== undefined && SimplifiedType_key(imp_simp) === SimplifiedType_key(simp_rcvr_ty)) {
            any = true;
            break;
          }
        }
        if (any) {
          explicitly_negative.push(candidate);
        } else {
          potential_candidates.push(candidate);
        }
      }
    } else {
      // We don't know enough about `recv_ty` to make proper suggestions.
      [potential_candidates, explicitly_negative] = [candidates, []];
    }

    const impls_trait = (def_id: DefId): boolean => {
      const args = RawList.for_item(this.tcx, def_id, (param, _) => {
        if (param.index === 0) {
          return GenericArg.from_Ty(rcvr_ty);
        } else {
          return this.infcx.var_for_def(span, param);
        }
      });
      return EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(def_id, args, this.param_env)) && param_type === undefined;
    };
    if (potential_candidates.length === 0) {
      // []
    } else if (potential_candidates.length === 1 && potential_candidates[0]!.def_id.is_local()) {
      const trait_info = potential_candidates[0]!;
      if (impls_trait(trait_info.def_id)) {
        this.suggest_valid_traits(err, item_name, [trait_info.def_id], false);
      } else {
        err.subdiagnostic(
          diagnostics.CandidateTraitNote_subdiagnostic({
            span: this.tcx.def_span(trait_info.def_id),
            trait_name: this.tcx.def_path_str(trait_info.def_id),
            item_name,
            action_or_ty: trait_missing_method
              ? "NONE"
              : param_type === undefined
                ? "implement" // FIXME: it might only need to be imported into scope, not implemented.
                : display_ParamTy(param_type),
          }),
        );
      }
    } else {
      const trait_infos = potential_candidates;
      let msg = message(
        param_type === undefined
          ? "implement" // FIXME: it might only need to be imported into scope, not implemented.
          : `restrict type parameter \`${display_ParamTy(param_type)}\` with`,
      );
      for (const [i, trait_info] of trait_infos.entries()) {
        if (impls_trait(trait_info.def_id)) {
          this.suggest_valid_traits(err, item_name, [trait_info.def_id], false);
        }
        msg += `\ncandidate #${i + 1}: \`${this.tcx.def_path_str(trait_info.def_id)}\``;
      }
      err.note(msg);
    }
    if (explicitly_negative.length === 0) {
      // []
    } else if (explicitly_negative.length === 1) {
      const trait_info = explicitly_negative[0]!;
      const msg = `the trait \`${this.tcx.def_path_str(trait_info.def_id)}\` defines an item \`${display_Ident(item_name)}\`, but is explicitly unimplemented`;
      err.note(msg);
    } else {
      const trait_infos = explicitly_negative;
      let msg = `the following traits define an item \`${display_Ident(item_name)}\`, but are explicitly unimplemented:`;
      for (const trait_info of trait_infos) {
        msg += `\n${this.tcx.def_path_str(trait_info.def_id)}`;
      }
      err.note(msg);
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4799 detect_and_explain_multiple_crate_versions_of_trait_item
FnCtxt.prototype.detect_and_explain_multiple_crate_versions_of_trait_item = function (this: FnCtxt, err: Diag, item_def_id: DefId, hir_id_: HirId, rcvr_ty: Ty | undefined): boolean {
  const hir_id = this.tcx.parent_hir_id(hir_id_);
  const traits = this.tcx.in_scope_traits(hir_id);
  if (traits === undefined) return false;
  if (traits.length === 0) {
    return false;
  }
  const trait_def_id = this.tcx.parent(item_def_id);
  if (!this.tcx.is_trait(trait_def_id)) {
    return false;
  }
  const node = this.tcx.hir_node(hir_id);
  if (node.$ !== "Expr") {
    return false;
  }
  const rcvr = node._0;
  // The trait may have generic parameters beyond `Self` (e.g. `Borrow<Borrowed>`), and
  // `rcvr_ty` may even be unknown. We only ever know the receiver type (the `Self` arg),
  // so fill `Self` from `rcvr_ty` when available and the remaining parameters with fresh
  // inference variables; building a `TraitRef` with a partial arg list would otherwise trip
  // `debug_assert_args_compatible` and ICE. See #157189.
  const trait_ref = TraitRef.new_from_args(
    as_interner(this.tcx),
    trait_def_id,
    RawList.for_item(this.tcx, trait_def_id, (param, _) => {
      if (param.index === 0 && rcvr_ty !== undefined) {
        return GenericArg.from_Ty(rcvr_ty);
      } else {
        return this.var_for_def(rcvr.span, param);
      }
    }),
  );
  const trait_pred = Binder.dummy<TraitClause>({ trait_ref, polarity: "Positive" }, fold_TraitClause);
  const obligation = Obligation.new(this.tcx, this.misc(rcvr.span), this.param_env, trait_ref, (from, _interner) => Predicate_upcast_from_TraitRef(from, this.tcx));
  return this.err_ctxt().note_different_trait_with_same_name(err, obligation, trait_pred);
};

/// issue #102320, for `unwrap_or` with closure as argument, suggest `unwrap_or_else`
/// FIXME: currently not working for suggesting `map_or_else`, see #102408
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4846 suggest_else_fn_with_closure
FnCtxt.prototype.suggest_else_fn_with_closure = function (this: FnCtxt, err: Diag, expr: hir.Expr, found: Ty, expected: Ty): boolean {
  const callable = this.extract_callable_info(found);
  if (callable === undefined) {
    return false;
  }
  const [_def_id_or_name, output, _inputs] = callable;

  if (!this.may_coerce(output, expected)) {
    return false;
  }

  const node = this.tcx.parent_hir_node(expr.hir_id);
  if (node.$ === "Expr" && node._0.kind.$ === "MethodCall") {
    const method_name = node._0.kind._0.ident;
    const self_expr = node._0.kind._1;
    const args = node._0.kind._2;
    const self_ty = this.typeck_results.expr_ty_opt(self_expr);
    if (self_ty !== undefined) {
      const new_name = new Ident(Symbol.intern(`${method_name.as_str()}_else`), method_name.span);
      const probe = this.lookup_probe_for_diagnostic(new_name, self_ty, self_expr, ProbeScope.TraitsInScope, expected);

      // check the method arguments number
      if (probe.$ === "Ok") {
        const pick = probe._0;
        const fn_sig = this.tcx.fn_sig(pick.item.def_id) as EarlyBinder<PolyFnSigT>;
        const fn_args = FnSig.inputs(Binder.skip_binder(EarlyBinder.skip_binder(fn_sig)));
        if (fn_args.length === args.length + 1) {
          err.span_suggestion_verbose(Span.shrink_to_hi(method_name.span), `try calling \`${Symbol.as_str(new_name.name)}\` instead`, "_else", "MaybeIncorrect");
          return true;
        }
      }
    }
  }
  return false;
};

/// Checks whether there is a local type somewhere in the chain of
/// autoderefs of `rcvr_ty`.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4902 type_derefs_to_local
FnCtxt.prototype.type_derefs_to_local = function (this: FnCtxt, span: Span, rcvr_ty: Ty, source: SelfSource): boolean {
  // rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4908 is_local
  function is_local(ty: Ty): boolean {
    const k = ty.kind();
    switch (k.$) {
      case "Adt":
        return k._0.did().is_local();
      case "Foreign":
        return k._0.is_local();
      case "Dynamic": {
        const d = k._0.principal();
        return d !== undefined && PolyExistentialTraitRef.def_id(d).is_local();
      }
      case "Param":
        return true;

      // Everything else (primitive types, etc.) is effectively
      // non-local (there are "edge" cases, e.g., `(LocalType,)`, but
      // the noise from these sort of types is usually just really
      // annoying, rather than any sort of help).
      default:
        return false;
    }
  }

  // This occurs for UFCS desugaring of `T::method`, where there is no
  // receiver expression for the method call, and thus no autoderef.
  if (source.$ === "QPath") {
    return is_local(rcvr_ty);
  }

  for (const [ty] of this.autoderef(span, rcvr_ty).silence_errors()) {
    if (is_local(ty)) return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4932 suggest_hashmap_on_unsatisfied_hashset_buildhasher
FnCtxt.prototype.suggest_hashmap_on_unsatisfied_hashset_buildhasher = function (this: FnCtxt, err: Diag, pred: TraitClause, adt: AdtDef): boolean {
  if (this.tcx.is_diagnostic_item(sym.HashSet, adt.did()) && this.tcx.is_diagnostic_item(sym.BuildHasher, TraitClause.def_id(pred))) {
    err.help("you might have intended to use a HashMap instead");
    return true;
  } else {
    return false;
  }
};

/// Retrieves all traits in this crate and any dependent crates,
/// and wraps them into `TraitInfo` for custom sorting.
// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4962 all_traits
export function all_traits(tcx: TyCtxt): TraitInfo[] {
  return [...tcx.all_traits_including_private()].map((def_id) => ({ def_id }));
}

// rustc: compiler/rustc_hir_typeck/src/method/suggest.rs:4966 print_disambiguation_help
export function print_disambiguation_help(
  tcx: TyCtxt,
  err: Diag,
  source: SelfSource,
  args: readonly hir.Expr[] | undefined,
  trait_ref_: TraitRef,
  candidate_idx: number | undefined,
  span: Span,
  item: AssocItem,
): string | undefined {
  const trait_impl_type = TraitRef.self_ty(trait_ref_).peel_refs();
  const trait_ref = AssocItem.is_method(item)
    ? display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref_))
    : `<${display_GenericArg(trait_ref_.args[0]!)} as ${display_TraitRefPrintOnlyTraitName(TraitRef_print_only_trait_name(trait_ref_))}>`;
  if (AssocItem.is_fn(item) && source.$ === "MethodCall" && args !== undefined) {
    const receiver = source._0;
    const def_kind_descr = tcx.def_kind_descr(AssocItem.as_def_kind(item), item.def_id);
    const item_name = AssocItem.ident(item, tcx);
    const first_input = FnSig.inputs(Binder.skip_binder(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSigT>))))[0];
    const first_arg_type = first_input === undefined ? undefined : first_input.peel_refs();
    const rcvr_mutbl = first_input === undefined ? undefined : first_input.ref_mutability();
    const rcvr_ref = rcvr_mutbl === undefined ? "" : Mutability.ref_prefix_str(rcvr_mutbl);

    // If the type of first arg of this assoc function is `Self` or current trait impl type or `arbitrary_self_types`, we need to take the receiver as args. Otherwise, we don't.
    const args_ = (
      first_arg_type !== undefined && (first_arg_type === tcx.types.self_param || first_arg_type === trait_impl_type || AssocItem.is_method(item)) ? [receiver] : []
    )
      .concat(args)
      .map((arg) => {
        const r = tcx.sess.source_map().span_to_snippet(arg.span);
        return r.$ === "Ok" ? r._0.toString() : "_";
      })
      .join(", ");

    const args_str = `(${rcvr_ref}${args_})`;
    err.span_suggestion_verbose(
      span,
      `disambiguate the ${def_kind_descr} for ${candidate_idx !== undefined ? `candidate #${candidate_idx}` : "the candidate"}`,
      `${trait_ref}::${display_Ident(item_name)}${args_str}`,
      "HasPlaceholders",
    );
    return undefined;
  } else {
    return `${trait_ref}::`;
  }
}
