// Port of compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs (lanes errrep-traits-a, errrep-traits-b; contract stub of lane errctxt-contract).
//
// How to fill this stub (docs/handoff/errctxt-contract.md "How to fill a stub"):
// - Every fn of this file is declared in src/rustc_trait_selection/decls.ts under `// error_reporting/traits/fulfillment_errors.rs:<line>`:
//   `interface TypeErrCtxt` (methods), `NiceRegionError` (methods / statics), `Fns_<module>` (free fns) or a comment-only
//   declaration (trait impls, helper types: pick the TS form). Do not change a real signature; write a needed change in
//   your handoff (or a local `declare module` marked `// PORT(decls): pending root`).
// - Methods: in upstream order, `TypeErrCtxt.prototype.<name> = function (this: TypeErrCtxt, ..): R { .. };` with
//   `// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:<line> <name>` directly above, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty). In a split file edit only your lane's list.
// - Free fns: replace `export const f = ((): never => unported(..)) as Fns_..["f"]` by `export function f(..)` with the
//   declared signature and the marker. `self.tcx` / `self.infcx` / InferCtxt methods are read through the Deref forwarders
//   (`this.tcx`, `this.next_ty_var(..)`); a `&TypeErrCtxt` passed as `&InferCtxt` is `this.infcx`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { TypeErrCtxt } from "../../decls.ts";

// ---- imports of lane errrep-traits-a (fulfillment_errors.rs:1..1529) ----
import { type Directive } from "../../../rustc_attr_ir/diagnostic.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import { ControlFlow, VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import { type Diag, E0277, E0741, struct_span_code_err } from "../../../rustc_errors/lib.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { display_CoroutineDesugaring, display_CoroutineKind } from "../../../rustc_hir/hir.ts";
import { ToTrace_Ty } from "../../../rustc_infer/infer/at.ts";
import { debug_Obligation } from "../../../rustc_infer/traits/structural_impls.ts";
import { clone_Obligation } from "../../../rustc_infer/traits/mod.gen.ts";
import { Obligation, type PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import type { Place } from "../../../rustc_middle/hir/place.ts";
import type { CodegenFnAttrs } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import { clone_ObligationCause, clone_ObligationCauseCode } from "../../../rustc_middle/traits/mod.gen.ts";
import {
  type DynCompatibilityViolation,
  ObligationCause,
  ObligationCauseCode,
  type ObligationCauseCode as ObligationCauseCodeT,
  ObligationCauseCodeHandle,
  type SelectionError,
  fold_with_PolyTraitClause,
  try_fold_with_PolyTraitClause,
  visit_with_PolyTraitClause,
} from "../../../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../../../rustc_middle/traits/select.ts";
import type { Predicate } from "../../../rustc_middle/ty/decls.ts";
import { suggest_constraining_type_param } from "../../../rustc_middle/ty/diagnostics.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { HasAttrs_DefId, ParamEnv_eq, Ty } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_PolyTraitClause } from "../../../rustc_middle/ty/predicate.ts";
import { IrPrint_print, IrPrint_print_debug, print_Const, print_Ty, type PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_GenericArg,
  display_Predicate,
  display_Term,
  display_Ty,
  type PrettyPrinter,
  PolyTraitRef_print_trait_sugared,
  print_Binder,
  print_TraitClause,
  print_TraitClausePrintModifiersAndPath,
  print_TraitRefPrintOnlyTraitPath,
  print_TraitRefPrintSugared,
  TraitClause_print_modifiers_and_trait_path,
  TraitRef_print_only_trait_path,
  type TraitRefPrintSugared,
  with_no_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Predicate, fold_Predicate, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { debug_Term, fold_Term } from "../../../rustc_middle/ty/mod.ts";
import { Edition } from "../../../rustc_span/edition.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../../rustc_span/hygiene.ts";
import { type BytePos, DUMMY_SP, type ErrorGuaranteed, type PathBuf, Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { display_Symbol, STDLIB_STABLE_CRATES, Symbol, sym } from "../../../rustc_span/symbol.ts";
import { Binder } from "../../../rustc_type_ir/binder.ts";
import type { PolyTraitClause } from "../../../rustc_type_ir/decls.ts";
import { ExpectedFound } from "../../../rustc_type_ir/error.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Interner } from "../../../rustc_type_ir/interner.ts";
import { display_Binder } from "../../../rustc_type_ir/ir_print.ts";
import { ClosureKind as ClosureKind_ } from "../../../rustc_type_ir/lib.ts";
import { ClosureKind } from "../../../rustc_type_ir/lib.ts";
import {
  type HostEffectClause,
  PolyHostEffectClause,
  PolyTraitClause as PolyTraitClause_,
  TraitClause,
} from "../../../rustc_type_ir/predicate.ts";
import {
  debug_CoercePredicate,
  debug_SubtypePredicate,
  fold_with_TraitClause,
  fold_with_TraitRef,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../../../rustc_type_ir/predicate.gen.ts";
import type { Goal } from "../../../rustc_type_ir/solve/mod.ts";
import { ClosureArgs, CoroutineClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { intern_key } from "../../../rust_ts/intern_key.ts";
import { format_debug, PLAIN } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { unwrap } from "../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import { utf8_len } from "../../../std/str.ts";
import { CoroClosureNotFn_diagnostic } from "../../diagnostics.gen.ts";
import type { NotConstEvaluatable } from "../../traits/const_evaluatable.ts";
import { report_dyn_incompatibility } from "./mod.ts";
import { get_explanation_based_on_obligation } from "./suggestions.ts";

// ==== lane errrep-traits-a: error_reporting/traits/fulfillment_errors.rs:1..1529 ====
// PORT: the methods are declared in ../../decls.ts (`// error_reporting/traits/fulfillment_errors.rs:<line>`) and assigned
// onto `TypeErrCtxt.prototype` in upstream order. `&mut Option<PathBuf>` locals (`long_ty_file`, `file`) are `MutRef`
// cells; `*diag.long_ty_path() = file` / `diag.long_ty_path = file` assign through `Diag::long_ty_path()`.
// `find_attr!(self.tcx, def_id, ..)` is `find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), ..)` (traits/misc.ts
// precedent).

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

/// The `root_obligation` parameter should be the `root_obligation` field
/// from a `FulfillmentError`. If no `FulfillmentError` is available,
/// then it should be the same as `obligation`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:63 report_selection_error
TypeErrCtxt.prototype.report_selection_error = function (
  this: TypeErrCtxt,
  obligation_: PredicateObligation,
  root_obligation: PredicateObligation,
  error: SelectionError,
): ErrorGuaranteed {
  // PORT: `mut obligation` is owned upstream (its cause is reassigned below): the port works on a copy.
  const obligation = clone_Obligation(obligation_, (p) => p);
  const tcx = this.tcx;
  let span = obligation.cause.span;
  const long_ty_file: MutRef<PathBuf | undefined> = { value: undefined };

  let err: Diag;
  switch (error.$) {
    case "Unimplemented": {
      // If this obligation was generated as a result of well-formedness checking, see if we
      // can get a better error message by performing HIR-based well-formedness checking.
      const root_code = ObligationCauseCode.peel_derives(root_obligation.cause.code_());
      if (
        root_code.$ === "WellFormed" &&
        !TypeVisitableExt.has_non_region_infer(obligation.predicate, fold_Predicate) &&
        !(root_code._0.$ === "None")
      ) {
        const wf_loc = root_code._0;
        const cause = this.tcx.diagnostic_hir_wf_check([tcx.erase_and_anonymize_regions(obligation.predicate, fold_Predicate), wf_loc]);
        if (cause !== undefined) {
          obligation.cause = clone_ObligationCause(cause);
          span = obligation.cause.span;
        }
      }

      const code0 = obligation.cause.code_();
      if (code0.$ === "CompareImplItem") {
        const { impl_item_def_id, trait_item_def_id } = code0;
        // debug!("ObligationCauseCode::CompareImplItemObligation");
        return this.report_extra_impl_obligation(span, impl_item_def_id, trait_item_def_id, `\`${display_Predicate(obligation.predicate)}\``).emit_err();
      }

      // Report a const-param specific error
      const code1 = ObligationCauseCode.peel_derives(obligation.cause.code_());
      if (code1.$ === "ConstParam") {
        const ty = code1._0;
        return this.report_const_param_not_wf(ty, obligation).emit_err();
      }

      const bound_predicate = obligation.predicate.kind();
      const pk = Binder.skip_binder(bound_predicate);
      if (pk.$ === "Clause" && pk._0.$ === "Trait") {
        const trait_predicate = pk._0._0;
        const leaf_trait_predicate = this.deeply_resolve_ignoring_regions(Binder.rebind(bound_predicate, trait_predicate), d_PolyTraitClause);

        // Let's use the root obligation as the main message, when we care about the
        // most general case ("X doesn't implement Pattern<'_>") over the case that
        // happened to fail ("char doesn't implement Fn(&mut char)").
        //
        // We rely on a few heuristics to identify cases where this root
        // obligation is more important than the leaf obligation:
        let main_trait_predicate: PolyTraitClause;
        let main_obligation: PredicateObligation;
        const rk = Binder.skip_binder(root_obligation.predicate.kind());
        let root_pred: TraitClause | undefined;
        if (
          rk.$ === "Clause" &&
          rk._0.$ === "Trait" &&
          ((root_pred = rk._0._0), true) &&
          !TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(PolyTraitClause_.self_ty(leaf_trait_predicate)), fold_Ty) &&
          !TypeVisitableExt.has_escaping_bound_vars(TraitClause.self_ty(root_pred), fold_Ty) &&
          // The type of the leaf predicate is (roughly) the same as the type
          // from the root predicate, as a proxy for "we care about the root"
          // FIXME: this doesn't account for trivial derefs, but works as a first
          // approximation.
          // `T: Trait` && `&&T: OtherTrait`, we want `OtherTrait`
          (this.can_eq(obligation.param_env, Binder.skip_binder(PolyTraitClause_.self_ty(leaf_trait_predicate)), TraitClause.self_ty(root_pred).peel_refs(), ToTrace_Ty) ||
            // `&str: Iterator` && `&str: IntoIterator`, we want `IntoIterator`
            this.can_eq(obligation.param_env, Binder.skip_binder(PolyTraitClause_.self_ty(leaf_trait_predicate)), TraitClause.self_ty(root_pred), ToTrace_Ty)) &&
          // The leaf trait and the root trait are different, so as to avoid
          // talking about `&mut T: Trait` and instead remain talking about
          // `T: Trait` instead
          !DefId_eq(PolyTraitClause_.def_id(leaf_trait_predicate), TraitClause.def_id(root_pred)) &&
          // The root trait is not `Unsize`, as to avoid talking about it in
          // `tests/ui/coercion/coerce-issue-49593-box-never.rs`.
          !this.tcx.is_lang_item(TraitClause.def_id(root_pred), "Unsize")
        ) {
          main_trait_predicate = this.deeply_resolve_ignoring_regions(Binder.rebind(root_obligation.predicate.kind(), root_pred), d_PolyTraitClause);
          main_obligation = root_obligation;
        } else {
          main_trait_predicate = leaf_trait_predicate;
          main_obligation = obligation;
        }

        const guar0 = this.emit_specialized_closure_kind_error(obligation, leaf_trait_predicate);
        if (guar0 !== undefined) {
          return guar0;
        }

        const er = TypeVisitableExt.error_reported(leaf_trait_predicate, d_PolyTraitClause);
        if (er.$ === "Err") {
          return er._0;
        }
        // Silence redundant errors on binding access that are already
        // reported on the binding definition (#56607).
        const fa = this.fn_arg_obligation(obligation);
        if (fa.$ === "Err") {
          return fa._0;
        }
        let post_message = "";
        let pre_message = "";
        let type_def: [string, Span] | undefined = undefined;
        const parent = this.get_parent_trait_ref(obligation.cause.code_());
        if (parent !== undefined) {
          const [t0, s] = parent;
          const t = this.tcx.short_string(t0, long_ty_file, print_Ty);
          post_message = ` in \`${t}\``;
          pre_message = `within \`${t}\`, `;
          type_def = s === undefined ? undefined : [`within this \`${t}\``, s];
        }

        const custom = this.on_unimplemented_note(main_trait_predicate, main_obligation, long_ty_file);
        const message0 = custom.message;
        const label = custom.label;
        const notes0 = custom.notes;
        const parent_label = custom.parent_label;

        const have_alt_message = message0 !== undefined || label !== undefined;

        const message1 = message0 ?? this.get_standard_error_message(main_trait_predicate, undefined, post_message, long_ty_file);
        const is_try_conversion = this.is_try_conversion(span, PolyTraitClause_.def_id(main_trait_predicate));
        const is_question_mark =
          ObligationCauseCode.peel_derives(root_obligation.cause.code_()).$ === "QuestionMark" &&
          !(
            this.tcx.is_diagnostic_item(sym.FromResidual, PolyTraitClause_.def_id(main_trait_predicate)) ||
            this.tcx.is_lang_item(PolyTraitClause_.def_id(main_trait_predicate), "Try")
          );
        const is_unsize = this.tcx.is_lang_item(PolyTraitClause_.def_id(leaf_trait_predicate), "Unsize");
        const question_mark_message =
          "the question mark operation (`?`) implicitly performs a conversion on the error value using the `From` trait";
        let message: string;
        let notes: string[];
        if (is_try_conversion) {
          const ty = this.tcx.short_string(TraitClause.self_ty(Binder.skip_binder(main_trait_predicate)), long_ty_file, print_Ty);
          // We have a `-> Result<_, E1>` and `gives_E2()?`.
          message = `\`?\` couldn't convert the error to \`${ty}\``;
          notes = [question_mark_message];
        } else if (is_question_mark) {
          const main_trait_predicate_ = this.tcx.short_string(main_trait_predicate, long_ty_file, print_PolyTraitClause);
          // Similar to the case above, but in this case the conversion is for a
          // trait object: `-> Result<_, Box<dyn Error>` and `gives_E()?` when
          // `E: Error` isn't met.
          message = `\`?\` couldn't convert the error: \`${main_trait_predicate_}\` is not satisfied`;
          notes = [question_mark_message];
        } else {
          message = message1;
          notes = notes0;
        }

        let err_msg: string;
        let safe_transmute_explanation: string | undefined;
        if (this.tcx.is_lang_item(PolyTraitClause_.def_id(main_trait_predicate), "TransmuteTrait")) {
          // Recompute the safe transmute reason and use that for the error reporting
          const [report_obligation, report_pred] = this.select_transmute_obligation_for_reporting(obligation, main_trait_predicate, root_obligation);

          const r = this.get_safe_transmute_error_and_reason(report_obligation, report_pred, span);
          switch (r.$) {
            case "Silent":
              return this.dcx().span_delayed_bug(span, "silent safe transmute error");
            case "Default":
              err_msg = message;
              safe_transmute_explanation = undefined;
              break;
            case "Error":
              err_msg = r.err_msg;
              safe_transmute_explanation = r.safe_transmute_explanation;
              break;
          }
        } else {
          err_msg = message;
          safe_transmute_explanation = undefined;
        }

        const err_ = struct_span_code_err(this.dcx(), span, E0277, err_msg);

        const trait_def_id = PolyTraitClause_.def_id(main_trait_predicate);
        const leaf_trait_def_id = PolyTraitClause_.def_id(leaf_trait_predicate);
        if (
          (this.tcx.is_diagnostic_item(sym.From, trait_def_id) || this.tcx.is_diagnostic_item(sym.TryFrom, trait_def_id)) &&
          (this.tcx.is_diagnostic_item(sym.From, leaf_trait_def_id) || this.tcx.is_diagnostic_item(sym.TryFrom, leaf_trait_def_id))
        ) {
          const leaf_nbv = Binder.no_bound_vars(leaf_trait_predicate, d_TraitClause);
          const trait_ref = leaf_nbv === undefined ? undefined : leaf_nbv.trait_ref;
          const arg1 = trait_ref === undefined ? undefined : trait_ref.args[1];
          const found_ty = arg1 === undefined ? undefined : GenericArg.as_type(arg1);
          const main_nbv = found_ty === undefined ? undefined : Binder.no_bound_vars(main_trait_predicate, d_TraitClause);
          const ty = main_nbv === undefined ? undefined : TraitClause.self_ty(main_nbv);
          const cast_ty = ty === undefined || found_ty === undefined ? undefined : this.find_explicit_cast_type(obligation.param_env, found_ty, ty);
          if (found_ty !== undefined && cast_ty !== undefined) {
            const found_ty_str = this.tcx.short_string(found_ty, long_ty_file, print_Ty);
            const cast_ty_str = this.tcx.short_string(cast_ty, long_ty_file, print_Ty);

            err_.help(`consider casting the \`${found_ty_str}\` value to \`${cast_ty_str}\``);
          }
        }

        err_.long_ty_path().value = long_ty_file.value;

        let suggested = false;
        let noted_missing_impl = false;
        if (is_try_conversion || is_question_mark) {
          [suggested, noted_missing_impl] = this.try_conversion_context(obligation, main_trait_predicate, err_);
        }

        suggested = this.detect_negative_literal(obligation, main_trait_predicate, err_) || suggested;

        const ret_span = this.return_type_span(obligation);
        if (ret_span !== undefined) {
          if (is_try_conversion) {
            const ty = this.tcx.short_string(TraitClause.self_ty(Binder.skip_binder(main_trait_predicate)), err_.long_ty_path(), print_Ty);
            err_.span_label(ret_span, `expected \`${ty}\` because of this`);
          } else if (is_question_mark) {
            const main_trait_predicate_ = this.tcx.short_string(main_trait_predicate, err_.long_ty_path(), print_PolyTraitClause);
            err_.span_label(ret_span, `required \`${main_trait_predicate_}\` because of this`);
          }
        }

        if (tcx.is_lang_item(PolyTraitClause_.def_id(leaf_trait_predicate), "Tuple")) {
          this.add_tuple_trait_message(ObligationCauseCode.peel_derives(obligation.cause.code_()), err_);
        }

        const explanation = get_explanation_based_on_obligation(this.tcx, obligation, leaf_trait_predicate, pre_message, err_.long_ty_path());

        this.check_for_binding_assigned_block_without_tail_expression(obligation, err_, leaf_trait_predicate);
        this.suggest_add_result_as_return_type(obligation, err_, leaf_trait_predicate);

        if (this.suggest_add_reference_to_arg(obligation, err_, leaf_trait_predicate, have_alt_message)) {
          this.note_obligation_cause(err_, obligation);
          return err_.emit_err();
        }

        const lk = TraitClause.self_ty(Binder.skip_binder(leaf_trait_predicate)).kind();
        let ty_span: Span;
        if (lk.$ === "Adt" && lk._0.did().is_local() && !this.can_suggest_derive(obligation, leaf_trait_predicate)) {
          ty_span = this.tcx.def_span(lk._0.did());
        } else if (lk.$ === "Closure") {
          ty_span = this.tcx.def_span(lk._0);
        } else {
          ty_span = DUMMY_SP;
        }
        if (label !== undefined) {
          const s = label;
          // If it has a custom `#[rustc_on_unimplemented]`
          // error message, let's display it as the label!
          err_.span_label(span, s);
          if (
            !(TraitClause.self_ty(Binder.skip_binder(leaf_trait_predicate)).kind().$ === "Param") &&
            // When the self type is a type param We don't need to "the trait
            // `std::marker::Sized` is not implemented for `T`" as we will point
            // at the type param with a label to suggest constraining it.
            !this.tcx.is_diagnostic_item(sym.FromResidual, PolyTraitClause_.def_id(leaf_trait_predicate))
            // Don't say "the trait `FromResidual<Option<!>>` is
            // not implemented for `Result<T, E>`".
          ) {
            // We do this just so that the JSON output's `help` position is the
            // right one and not `file.rs:1:1`. The render is the same.
            if (ty_span === DUMMY_SP) {
              err_.help(explanation);
            } else {
              err_.span_help(ty_span, explanation);
            }
          }
        } else if (safe_transmute_explanation !== undefined) {
          const custom_explanation = safe_transmute_explanation;
          err_.span_label(span, custom_explanation);
        } else if ((utf8_len(explanation) > this.tcx.sess.diagnostic_width() || ty_span !== DUMMY_SP) && !noted_missing_impl) {
          // Really long types don't look good as span labels, instead move it
          // to a `help`.
          err_.span_label(span, "unsatisfied trait bound");

          // We do this just so that the JSON output's `help` position is the
          // right one and not `file.rs:1:1`. The render is the same.
          if (ty_span === DUMMY_SP) {
            err_.help(explanation);
          } else {
            err_.span_help(ty_span, explanation);
          }
        } else {
          err_.span_label(span, explanation);
        }

        const code2 = ObligationCauseCode.peel_derives(obligation.cause.code_());
        if (code2.$ === "Coercion") {
          const { source, target } = code2;
          if (this.tcx.is_lang_item(PolyTraitClause_.def_id(leaf_trait_predicate), "Sized")) {
            this.suggest_borrowing_for_object_cast(err_, root_obligation, source, target);
          }
        }

        if (type_def !== undefined) {
          const [msg, span] = type_def;
          err_.span_label(span, msg);
        }
        // `#[rustc_on_unimplemented]` notes for derivable traits (e.g. `Debug`'s
        // "add `#[derive(Debug)]` to `X` or manually `impl Debug for X`") duplicate
        // the `consider annotating X with #[derive(..)]` suggestion that
        // `suggest_derive` emits below, so skip them when that suggestion will be
        // shown. We keep the note otherwise (e.g. when a field isn't `Debug`, so
        // the derive can't be suggested) to avoid leaving the diagnostic without
        // actionable guidance.
        // PORT: `main_trait_predicate == leaf_trait_predicate` is the derived `PartialEq` of `Binder<TraitClause>`
        // (`intern_key`: interned children by identity).
        const derive_suggestion_will_be_shown =
          intern_key(main_trait_predicate) === intern_key(leaf_trait_predicate) && this.can_suggest_derive(obligation, leaf_trait_predicate);
        if (!derive_suggestion_will_be_shown) {
          for (const note of notes) {
            // If it has a custom `#[rustc_on_unimplemented]` note, let's display
            // it.
            err_.note(note);
          }
        }
        if (parent_label !== undefined) {
          const s = parent_label;
          const body = obligation.cause.body_def_id;
          err_.span_label(tcx.def_span(LocalDefId.to_def_id(body)), s);
        }

        this.suggest_floating_point_literal(obligation, err_, leaf_trait_predicate);
        this.suggest_dereferencing_index(obligation, err_, leaf_trait_predicate);
        suggested =
          (this.suggest_dereferences(obligation, err_, leaf_trait_predicate) || this.suggest_remove_reference(obligation, err_, leaf_trait_predicate)) ||
          suggested;

        suggested = this.suggest_fn_call(obligation, err_, leaf_trait_predicate) || suggested;
        suggested = this.suggest_cast_to_fn_pointer(obligation, err_, leaf_trait_predicate, main_trait_predicate, span) || suggested;

        suggested = this.suggest_semicolon_removal(obligation, err_, span, leaf_trait_predicate) || suggested;
        this.note_different_trait_with_same_name(err_, obligation, leaf_trait_predicate);
        this.note_adt_version_mismatch(err_, leaf_trait_predicate);
        this.suggest_remove_await(obligation, err_);
        this.suggest_derive(obligation, err_, leaf_trait_predicate);

        if (tcx.is_lang_item(PolyTraitClause_.def_id(leaf_trait_predicate), "Try")) {
          this.suggest_await_before_try(err_, obligation, leaf_trait_predicate, span);
        }

        if (this.suggest_add_clone_to_arg(obligation, err_, leaf_trait_predicate)) {
          return err_.emit_err();
        }

        if (this.suggest_impl_trait(err_, obligation, leaf_trait_predicate)) {
          return err_.emit_err();
        }

        if (is_unsize) {
          // If the obligation failed due to a missing implementation of the
          // `Unsize` trait, give a pointer to why that might be the case
          err_.note(
            "all implementations of `Unsize` are provided automatically by the compiler, see " +
              "<https://doc.rust-lang.org/stable/std/marker/trait.Unsize.html> for more information",
          );
        }

        const is_fn_trait = tcx.is_fn_trait(PolyTraitClause_.def_id(leaf_trait_predicate));
        const fk = TraitClause.self_ty(Binder.skip_binder(leaf_trait_predicate)).kind();
        const is_target_feature_fn = fk.$ === "FnDef" ? (this.tcx.codegen_fn_attrs(fk._0) as CodegenFnAttrs).target_features.length !== 0 : false;
        if (is_fn_trait && is_target_feature_fn) {
          err_.note("`#[target_feature(..)]` functions do not implement the `Fn` traits");
          err_.note("try casting the function to a `fn` pointer or wrapping it in a closure");
        }

        this.note_field_shadowed_by_private_candidate_in_cause(err_, obligation.cause, obligation.param_env);
        this.try_to_add_help_message(root_obligation, obligation, leaf_trait_predicate, err_, span, is_fn_trait, suggested);

        // Changing mutability doesn't make a difference to whether we have
        // an `Unsize` impl (Fixes ICE in #71036)
        if (!is_unsize) {
          this.suggest_change_mut(obligation, err_, leaf_trait_predicate);
        }

        // If this error is due to `!: Trait` not implemented but `(): Trait` is
        // implemented, and fallback has occurred, then it could be due to a
        // variable that used to fallback to `()` now falling back to `!`. Issue a
        // note informing about the change in behaviour.
        if (TraitClause.self_ty(Binder.skip_binder(leaf_trait_predicate)).is_never() && this.diverging_fallback_has_occurred) {
          const predicate = Binder.map_bound(leaf_trait_predicate, (trait_pred) =>
            TraitClause.with_replaced_self_ty(trait_pred, this.tcx as unknown as Interner, tcx.types.unit),
          );
          const unit_obligation = obligation.with(tcx, predicate, Predicate_upcast_from_PolyTraitClause as (from: PolyTraitClause, tcx: Interner) => Predicate);
          if (this.predicate_may_hold(unit_obligation)) {
            err_.note(
              "this error might have been caused by changes to Rust's type-inference algorithm (see issue #148922 " +
                "<https://github.com/rust-lang/rust/issues/148922> for more information)",
            );
            err_.help("you might have intended to use the type `()` here instead");
          }
        }

        this.explain_hrtb_projection(err_, leaf_trait_predicate, obligation.param_env, obligation.cause);
        this.suggest_desugaring_async_fn_in_trait(err_, main_trait_predicate);

        // Return early if the trait is Debug or Display and the invocation
        // originates within a standard library macro, because the output
        // is otherwise overwhelming and unhelpful (see #85844 for an
        // example).

        const macro_def_id = SyntaxContext.outer_expn_data(Span.ctxt(obligation.cause.span)).macro_def_id;
        let in_std_macro: boolean;
        if (macro_def_id !== undefined) {
          const crate_name = tcx.crate_name(macro_def_id.krate);
          in_std_macro = STDLIB_STABLE_CRATES.includes(crate_name);
        } else {
          in_std_macro = false;
        }

        const dn = this.tcx.get_diagnostic_name(PolyTraitClause_.def_id(leaf_trait_predicate));
        if (in_std_macro && (dn === sym.Debug || dn === sym.Display)) {
          return err_.emit_err();
        }

        err = err_;
      } else if (pk.$ === "Clause" && pk._0.$ === "HostEffect") {
        const clause = pk._0._0;
        err = this.report_host_effect_error(Binder.rebind(bound_predicate, clause), obligation, span);
      } else if (pk.$ === "Subtype") {
        const predicate = pk._0;
        // Errors for Subtype predicates show up as
        // `FulfillmentErrorCode::SubtypeError`,
        // not selection error.
        return span_bug(span, `subtype requirement gave wrong error: \`${format_debug(predicate, debug_SubtypePredicate, PLAIN)}\``);
      } else if (pk.$ === "Coerce") {
        const predicate = pk._0;
        // Errors for Coerce predicates show up as
        // `FulfillmentErrorCode::SubtypeError`,
        // not selection error.
        return span_bug(span, `coerce requirement gave wrong error: \`${format_debug(predicate, debug_CoercePredicate, PLAIN)}\``);
      } else if (pk.$ === "Clause" && pk._0.$ === "TypeOutlives" && this.next_trait_solver()) {
        // We normalize `TypeOutlives` in the next solver, which is fallible
        return this.dcx().span_delayed_bug(span, "type outlives claues errored outside borrowck without any other error");
      } else if (pk.$ === "Clause" && (pk._0.$ === "RegionOutlives" || pk._0.$ === "TypeOutlives")) {
        return span_bug(span, `outlives clauses should not error outside borrowck. obligation: \`${debug_PredicateObligation(obligation)}\``);
      } else if (pk.$ === "Clause" && pk._0.$ === "Projection") {
        return span_bug(span, `projection clauses should be implied from elsewhere. obligation: \`${debug_PredicateObligation(obligation)}\``);
      } else if (pk.$ === "DynCompatible") {
        const trait_def_id = pk._0;
        const violations = this.tcx.dyn_compatibility_violations(trait_def_id) as readonly DynCompatibilityViolation[];
        const err_ = report_dyn_incompatibility(this.tcx, span, undefined, trait_def_id, violations);
        const node = this.tcx.hir_node_by_def_id(obligation.cause.body_def_id);
        if (
          node.$ === "Item" &&
          node._0.kind.$ === "Impl" &&
          node._0.kind._0.of_trait === undefined &&
          node._0.kind._0.self_ty.kind.$ === "TraitObject" &&
          node._0.kind._0.self_ty.kind._1.tag() === "None" &&
          Edition.at_least_rust_2021(Span.edition(node._0.kind._0.self_ty.span))
        ) {
          // Silence the dyn-compatibility error in favor of the missing dyn on
          // self type error. #131051.
          err_.downgrade_to_delayed_bug();
        }
        err = err_;
      } else if (pk.$ === "Clause" && pk._0.$ === "WellFormed") {
        const ty = this.deeply_resolve_ignoring_regions(pk._0._0, fold_Term);
        if (this.next_trait_solver()) {
          const r = TypeVisitableExt.error_reported(ty, fold_Term);
          if (r.$ === "Err") {
            return r._0;
          }

          // FIXME: we'll need a better message which takes into account
          // which bounds actually failed to hold.
          err = this.dcx().struct_span_err(span, `the type \`${display_Term(ty)}\` is not well-formed`);
        } else {
          // WF predicates cannot themselves make
          // errors. They can only block due to
          // ambiguity; otherwise, they always
          // degenerate into other obligations
          // (which may fail).
          return span_bug(span, `WF predicate not satisfied for ${format_debug(ty, debug_Term, PLAIN)}`);
        }
      } else {
        // Errors for `ConstEvaluatable`, `ConstEquate` predicates show up as
        // `SelectionError::ConstEvalFailure`, not `Unimplemented`.
        // Ambiguous predicates should never error.
        // We never return `Err` when proving `UnstableFeature` goal.
        // (ConstEvaluatable | ConstEquate | Ambiguous | UnstableFeature | NormalizesTo | ConstArgHasType)
        return span_bug(span, `Unexpected \`Predicate\` for \`SelectionError\`: \`${debug_PredicateObligation(obligation)}\``);
      }
      break;
    }

    case "SignatureMismatch": {
      const { found_trait_ref, expected_trait_ref, terr } = error._0;
      if (terr.$ === "CyclicTy") {
        err = this.report_cyclic_signature_error(obligation, found_trait_ref, expected_trait_ref, terr);
      } else {
        const r = this.report_signature_mismatch_error(obligation, span, found_trait_ref, expected_trait_ref);
        if (r.$ === "Ok") {
          err = r._0;
        } else {
          return r._0;
        }
      }
      break;
    }

    case "TraitDynIncompatible": {
      const did = error._0;
      const violations = this.tcx.dyn_compatibility_violations(did) as readonly DynCompatibilityViolation[];
      err = report_dyn_incompatibility(this.tcx, span, undefined, did, violations);
      break;
    }

    case "NotConstEvaluatable": {
      const e = error._0 as NotConstEvaluatable;
      switch (e.$) {
        case "MentionsInfer":
          return bug("MentionsInfer should have been handled in `traits/fulfill.rs` or `traits/select/mod.rs`");
        case "MentionsParam": {
          const r = this.report_not_const_evaluatable_error(obligation, span);
          if (r.$ === "Ok") {
            err = r._0;
          } else {
            return r._0;
          }
          break;
        }
        case "Error": {
          // Already reported in the query.
          const guar = e._0;
          this.set_tainted_by_errors(guar);
          return guar;
        }
      }
      break;
    }

    case "Overflow": {
      if (error._0.$ === "Error") {
        // Already reported in the query.
        const guar = error._0._0;
        this.set_tainted_by_errors(guar);
        return guar;
      }
      return bug("overflow should be handled before the `report_selection_error` path");
    }

    case "ConstArgHasWrongType": {
      const { ct, ct_ty, expected_ty } = error;
      const expected_ty_str = this.tcx.short_string(expected_ty, long_ty_file, print_Ty);
      const ct_str = this.tcx.short_string(ct, long_ty_file, print_Const);
      const diag = this.dcx().struct_span_err(span, `the constant \`${ct_str}\` is not of type \`${expected_ty_str}\``);
      diag.long_ty_path().value = long_ty_file.value;

      this.note_type_err(diag, obligation.cause, undefined, undefined, { $: "Sorts", _0: ExpectedFound.new(expected_ty, ct_ty) }, false, undefined);
      err = diag;
      break;
    }
  }

  this.note_obligation_cause(err, obligation);
  this.silence_redundant_cause(err, obligation, root_obligation);
  return err.emit_err();
};

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:842 apply_do_not_recommend
TypeErrCtxt.prototype.apply_do_not_recommend = function (this: TypeErrCtxt, obligation: PredicateObligation, root_obligation: PredicateObligation): boolean {
  let base_cause = clone_ObligationCauseCode(obligation.cause.code_());
  let applied_do_not_recommend = false;
  for (;;) {
    if (base_cause.$ === "ImplDerived") {
      const c = base_cause._0;
      if (this.tcx.do_not_recommend_impl(c.impl_or_alias_def_id)) {
        const code = clone_ObligationCauseCode(ObligationCauseCodeHandle.deref(c.derived.parent_code));
        // Keep more precise spans that still point within the parent obligation,
        // but do not let hidden impl details move the span outside of it.
        // PORT: `code == *root_obligation.cause.code()` is the derived `PartialEq` (`intern_key`).
        if (
          intern_key(code) === intern_key(root_obligation.cause.code_()) &&
          Span.eq_ctxt(root_obligation.cause.span, obligation.cause.span) &&
          !Span.contains(root_obligation.cause.span, obligation.cause.span)
        ) {
          obligation.cause.span = root_obligation.cause.span;
        }
        obligation.cause.map_code(() => code);
        obligation.predicate = Predicate_upcast_from_PolyTraitClause(c.derived.parent_trait_pred, this.tcx);
        applied_do_not_recommend = true;
      }
    }
    const parent_cause = ObligationCauseCode.parent(base_cause);
    if (parent_cause !== undefined) {
      base_cause = clone_ObligationCauseCode(parent_cause);
    } else {
      break;
    }
  }

  return applied_do_not_recommend;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:876 report_host_effect_error
TypeErrCtxt.prototype.report_host_effect_error = function (
  this: TypeErrCtxt,
  clause: Binder<HostEffectClause>,
  main_obligation: PredicateObligation,
  span: Span,
): Diag {
  // FIXME(const_trait_impl): We should recompute the clause with `[const]`
  // if it's `const`, and if it holds, explain that this bound only
  // *conditionally* holds.
  const trait_ref = Binder.map_bound(clause, (clause): TraitClause => ({
    trait_ref: clause.trait_ref,
    polarity: "Positive",
  }));
  const file: MutRef<PathBuf | undefined> = { value: undefined };

  const err_msg = this.get_standard_error_message(trait_ref, PolyHostEffectClause.constness(clause), "", file);
  const diag = struct_span_code_err(this.dcx(), span, E0277, err_msg);
  diag.long_ty_path().value = file.value;
  const obligation: PredicateObligation = Obligation.new(
    this.tcx,
    ObligationCause.dummy(),
    main_obligation.param_env,
    trait_ref,
    Predicate_upcast_from_PolyTraitClause as (from: PolyTraitClause, tcx: Interner) => Predicate,
  );
  if (!this.predicate_may_hold(obligation)) {
    diag.downgrade_to_delayed_bug();
  }

  const sel = select_mod().SelectionContext.new(this.infcx).poly_select(obligation.with(this.tcx, trait_ref, (p: PolyTraitClause) => p));
  const tk = TraitClause.self_ty(Binder.skip_binder(trait_ref)).kind();
  let generics: hir.Generics | undefined;
  if (sel.$ === "Ok" && sel._0 !== undefined && sel._0.$ === "UserDefined") {
    const impl_data = sel._0._0;
    const impl_did = impl_data.impl_def_id;
    const trait_did = PolyTraitClause_.def_id(trait_ref);
    const impl_span = this.tcx.def_span(impl_did);
    const trait_name = this.tcx.item_name(trait_did);

    if (this.tcx.is_const_trait(trait_did) && !this.tcx.is_const_trait_impl(impl_did)) {
      if (!impl_did.is_local()) {
        diag.span_note(impl_span, `trait \`${display_Symbol(trait_name)}\` is implemented but not \`const\``);
      }

      const command = find_attr(HasAttrs_DefId.get_attrs(impl_did, this.tcx), (k) =>
        k.$ === "OnConst" ? { directive: k.directive as Directive | undefined } : undefined,
      )?.directive;
      const impl_local = impl_did.as_local();
      let item: hir.Item | undefined;
      if (command !== undefined) {
        const [, format_args] = this.on_unimplemented_components(trait_ref, main_obligation, diag.long_ty_path(), false);
        const sk = TraitClause.self_ty(Binder.skip_binder(trait_ref)).kind();
        if (sk.$ === "Adt") {
          const def = sk._0;
          const args = sk._1;
          for (const param of (this.tcx.generics_of(def.did()) as Generics).own_params) {
            switch (param.kind.$) {
              case "Type":
              case "Const":
                format_args.generic_args.push([param.name, display_GenericArg(args[param.index]!)]);
                break;
              default:
                continue;
            }
          }
        }
        const { message, label, notes } = command.eval(undefined, format_args);

        if (message !== undefined) {
          diag.primary_message(message);
        }
        if (label !== undefined) {
          diag.span_label(span, label);
        }
        for (const note of notes) {
          diag.note(note);
        }
      } else if (
        impl_local !== undefined &&
        ((item = this.tcx.hir_expect_item(impl_local)), true) &&
        item.kind.$ === "Impl" &&
        item.kind._0.of_trait !== undefined
      ) {
        // trait is const, impl is local and not const
        diag.span_suggestion_verbose(
          Span.shrink_to_lo(item.span),
          `make the \`impl\` of trait \`${display_Symbol(trait_name)}\` \`const\``,
          "const ",
          "MaybeIncorrect",
        );
      }
    }
  } else if (tk.$ === "Param" && (generics = hir.Node.generics(this.tcx.hir_node_by_def_id(main_obligation.cause.body_def_id))) !== undefined) {
    const param = tk._0;
    const constraint = with_no_trimmed_paths(
      () => `[const] ${display_PolyTraitRefPrintSugared(PolyTraitRef_print_trait_sugared(Binder.map_bound(trait_ref, (tr) => tr.trait_ref)))}`,
    );
    suggest_constraining_type_param(this.tcx, generics, diag, Symbol.as_str(param.name), constraint, PolyTraitClause_.def_id(trait_ref), undefined);
  }
  return diag;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:995 emit_specialized_closure_kind_error
TypeErrCtxt.prototype.emit_specialized_closure_kind_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred_: PolyTraitClause,
): ErrorGuaranteed | undefined {
  let trait_pred = trait_pred_;
  // If we end up on an `AsyncFnKindHelper` goal, try to unwrap the parent
  // `AsyncFn*` goal.
  if (this.tcx.is_lang_item(PolyTraitClause_.def_id(trait_pred), "AsyncFnKindHelper")) {
    let code = obligation.cause.code_();
    // Unwrap a `FunctionArg` cause, which has been refined from a derived obligation.
    if (code.$ === "FunctionArg") {
      code = ObligationCauseCodeHandle.deref(code.parent_code);
    }
    // If we have a derived obligation, then the parent will be a `AsyncFn*` goal.
    const pw = ObligationCauseCode.parent_with_predicate(code);
    if (pw !== undefined && pw[1] !== undefined) {
      trait_pred = pw[1];
    }
  }

  const original_self_ty = Binder.skip_binder(PolyTraitClause_.self_ty(trait_pred));
  const peeled_self_ty = original_self_ty.peel_refs();

  const is_ref_to_closure = original_self_ty.kind().$ === "Ref" && peeled_self_ty.kind().$ === "Closure";

  const self_ty = is_ref_to_closure ? peeled_self_ty : original_self_ty;

  let expected_kind: ClosureKind;
  let is_async: boolean;
  const ek = this.tcx.fn_trait_kind_from_def_id(PolyTraitClause_.def_id(trait_pred));
  if (ek !== undefined) {
    [expected_kind, is_async] = [ek, false];
  } else {
    const aek = this.tcx.async_fn_trait_kind_from_def_id(PolyTraitClause_.def_id(trait_pred));
    if (aek !== undefined) {
      [expected_kind, is_async] = [aek, true];
    } else {
      return undefined;
    }
  }
  const trait_prefix = is_async ? "Async" : "";

  let closure_def_id: DefId;
  let found_args: Binder<Ty>;
  let has_self_borrows: boolean;
  const sk = self_ty.kind();
  switch (sk.$) {
    case "Closure": {
      const def_id = sk._0;
      const args = sk._1;
      [closure_def_id, found_args, has_self_borrows] = [def_id, Binder.map_bound(ClosureArgs.sig(args.as_closure()), (sig) => FnSig.inputs(sig)[0]!), false];
      break;
    }
    case "CoroutineClosure": {
      const def_id = sk._0;
      const args = sk._1;
      [closure_def_id, found_args, has_self_borrows] = [
        def_id,
        Binder.map_bound(CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure()), (sig) => sig.tupled_inputs_ty),
        !CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()).is_ty_var() &&
          CoroutineClosureArgs.has_self_borrows(args.as_coroutine_closure()),
      ];
      break;
    }
    default:
      return undefined;
  }

  const expected_args = Binder.map_bound(trait_pred, (trait_pred) => trait_pred.trait_ref.args.type_at(1));

  // Verify that the arguments are compatible. If the signature is
  // mismatched, then we have a totally different error to report.
  if (
    this.enter_forall(
      found_args,
      (found_args) => this.enter_forall(expected_args, (expected_args) => !this.can_eq(obligation.param_env, expected_args, found_args, ToTrace_Ty), fold_Ty),
      fold_Ty,
    )
  ) {
    return undefined;
  }

  let found_kind = this.closure_kind(self_ty);
  let kind_origin: [Span, Place] | undefined = undefined;

  let local_def_id: LocalDefId | undefined;
  let inferred: [ClosureKind, [Span, Place] | undefined] | undefined;
  if (
    found_kind === undefined &&
    is_ref_to_closure &&
    !is_async &&
    (local_def_id = closure_def_id.as_local()) !== undefined &&
    (inferred = this.infer_closure_kind(local_def_id)) !== undefined
  ) {
    const [inferred_kind, origin] = inferred;
    found_kind = inferred_kind;
    kind_origin = origin;
  }

  if (found_kind !== undefined && !ClosureKind_.extends(found_kind, expected_kind)) {
    const err = this.report_closure_error(obligation, closure_def_id, found_kind, expected_kind, trait_prefix, kind_origin);
    this.suggest_change_mut_ref_for_closure(err, obligation);
    this.note_obligation_cause(err, obligation);
    return err.emit_err();
  }

  // If the closure has captures, then perhaps the reason that the trait
  // is unimplemented is because async closures don't implement `Fn`/`FnMut`
  // if they have captures.
  if (has_self_borrows && expected_kind !== "FnOnce") {
    const ck = unwrap(this.tcx.coroutine_kind(this.tcx.coroutine_for_closure(closure_def_id)) as hir.CoroutineKind | undefined);
    let coro_kind: string;
    if (ck.$ === "Desugared") {
      const desugaring = ck._0;
      coro_kind = display_CoroutineDesugaring(desugaring);
    } else {
      coro_kind = display_CoroutineKind(ck);
    }
    const err = this.dcx().create_err(
      CoroClosureNotFn_diagnostic({
        span: this.tcx.def_span(closure_def_id),
        kind: ClosureKind_.as_str(expected_kind),
        coro_kind,
      }),
    );
    this.note_obligation_cause(err, obligation);
    return err.emit_err();
  }

  return undefined;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1114 fn_arg_obligation
TypeErrCtxt.prototype.fn_arg_obligation = function (this: TypeErrCtxt, obligation: PredicateObligation): Result<undefined, ErrorGuaranteed> {
  const code = obligation.cause.code_();
  if (code.$ === "FunctionArg") {
    const arg_hir_id = code.arg_hir_id;
    const n = this.tcx.hir_node(arg_hir_id);
    if (n.$ === "Expr") {
      const arg = n._0.peel_borrows();
      if (arg.kind.$ === "Path" && arg.kind._0.$ === "Resolved" && arg.kind._0._0 === undefined && arg.kind._0._1.res.$ === "Local") {
        const hir_id = arg.kind._0._1.res._0;
        const pn = this.tcx.hir_node(hir_id);
        if (pn.$ === "Pat") {
          const pat = pn._0;
          const entry = this.reported_trait_errors.get(pat.span);
          if (entry !== undefined) {
            const [preds, guar] = entry;
            const goal = obligation.as_goal();
            if (preds.some((g) => goal_eq(g, goal))) {
              return Err(guar);
            }
          }
        }
      }
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1134 detect_negative_literal
TypeErrCtxt.prototype.detect_negative_literal = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClause,
  err: Diag,
): boolean {
  const code = obligation.cause.code_();
  if (code.$ === "UnOp") {
    const n = this.tcx.hir_node(code.hir_id);
    if (n.$ === "Expr") {
      const expr = n._0;
      if (expr.kind.$ === "Unary" && expr.kind._0 === "Neg") {
        const inner = expr.kind._1;
        if (inner.kind.$ === "Lit") {
          const lit = inner.kind._0;
          if (lit.node.$ === "Int" && lit.node._1.$ === "Unsuffixed") {
            const sk = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
            let sugg: string;
            if (sk.$ === "Uint" && sk._0 === "Usize") sugg = "isize";
            else if (sk.$ === "Uint" && sk._0 === "U8") sugg = "i8";
            else if (sk.$ === "Uint" && sk._0 === "U16") sugg = "i16";
            else if (sk.$ === "Uint" && sk._0 === "U32") sugg = "i32";
            else if (sk.$ === "Uint" && sk._0 === "U64") sugg = "i64";
            else if (sk.$ === "Uint" && sk._0 === "U128") sugg = "i128";
            else sugg = "i64";
            err.span_suggestion_verbose(Span.shrink_to_hi(lit.span), "consider specifying an integer type that can be negative", sugg, "MaybeIncorrect");
            return true;
          }
        }
      }
    }
  }
  return false;
};

/// When the `E` of the resulting `Result<T, E>` in an expression `foo().bar().baz()?`,
/// identify those method chain sub-expressions that could or could not have been annotated
/// with `?`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1169 try_conversion_context
TypeErrCtxt.prototype.try_conversion_context = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClause,
  err: Diag,
): [boolean, boolean] {
  const span = obligation.cause.span;
  /// Look for the (direct) sub-expr of `?`, and return it if it's a `.` method call.
  class FindMethodSubexprOfTry extends hir.intravisit.Visitor<ControlFlow<hir.Expr>> {
    // impl<'v> Visitor<'v> for FindMethodSubexprOfTry { type Result = ControlFlow<&'v hir::Expr<'v>>; }
    override Result = VisitorResult.ControlFlow<hir.Expr>();

    constructor(public search_span: Span) {
      super();
    }

    // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1182 visit_expr
    override visit_expr(ex: hir.Expr): ControlFlow<hir.Expr> {
      if (ex.kind.$ === "Match" && ex.kind._2.$ === "TryDesugar") {
        const expr = ex.kind._0;
        if (
          lo_hi_eq(Span.lo_hi(Span.with_lo(ex.span, (Span.hi(ex.span) - 1) as BytePos)), Span.lo_hi(this.search_span)) &&
          expr.kind.$ === "Call" &&
          expr.kind._1.length >= 1
        ) {
          return ControlFlow.Break(expr.kind._1[0]!);
        }
      }
      return hir.intravisit.walk_expr(this, ex);
    }
  }
  const hir_id = this.tcx.local_def_id_to_hir_id(obligation.cause.body_def_id);
  const body_id = hir.Node.body_id(this.tcx.hir_node(hir_id));
  if (body_id === undefined) return [false, false];
  const found = new FindMethodSubexprOfTry(span).visit_body(this.tcx.hir_body(body_id));
  if (found.$ !== "Break") {
    return [false, false];
  }
  let expr: hir.Expr = found._0;
  const typeck = this.typeck_results;
  if (typeck === undefined) {
    return [false, false];
  }
  if (ObligationCauseCode.peel_derives(obligation.cause.code_()).$ !== "QuestionMark") {
    return [false, false];
  }
  const self_ty = TraitClause.self_ty(Binder.skip_binder(trait_pred));
  const arg1 = Binder.skip_binder(trait_pred).trait_ref.args[1];
  const found_ty = arg1 === undefined ? undefined : GenericArg.as_type(arg1);
  const noted_missing_impl = this.note_missing_impl_for_question_mark(err, self_ty, found_ty, trait_pred);

  let prev_ty = this.deeply_resolve_ignoring_regions(unwrap_or(typeck.expr_ty_adjusted_opt(expr), Ty.new_misc_error(this.tcx)), fold_Ty);

  // We always look at the `E` type, because that's the only one affected by `?`. If the
  // incorrect `Result<T, E>` is because of the `T`, we'll get an E0308 on the whole
  // expression, after the `?` has "unwrapped" the `T`.
  const get_e_type = (prev_ty: Ty): Ty | undefined => {
    const k = prev_ty.kind();
    if (k.$ !== "Adt") {
      return undefined;
    }
    const def = k._0;
    const args = k._1;
    const arg = args[1];
    if (arg === undefined) {
      return undefined;
    }
    if (!this.tcx.is_diagnostic_item(sym.Result, def.did())) {
      return undefined;
    }
    return GenericArg.as_type(arg);
  };

  let suggested = false;
  const chain: [Span, Ty][] = [];

  // The following logic is similar to `point_at_chain`, but that's focused on associated types
  while (expr.kind.$ === "MethodCall") {
    const path_segment = expr.kind._0;
    const rcvr_expr = expr.kind._1;
    const args = expr.kind._2;
    const span = expr.kind._3;
    // Point at every method call in the chain with the `Result` type.
    // let foo = bar.iter().map(mapper)?;
    //               ------ -----------
    expr = rcvr_expr;
    chain.push([span, prev_ty]);

    const next_ty = this.deeply_resolve_ignoring_regions(unwrap_or(typeck.expr_ty_adjusted_opt(expr), Ty.new_misc_error(this.tcx)), fold_Ty);

    const is_diagnostic_item = (symbol: Symbol, ty: Ty): boolean => {
      const k = ty.kind();
      if (k.$ !== "Adt") {
        return false;
      }
      return this.tcx.is_diagnostic_item(symbol, k._0.did());
    };
    // For each method in the chain, see if this is `Result::map_err` or
    // `Option::ok_or_else` and if it is, see if the closure passed to it has an incorrect
    // trailing `;`.
    const ty = get_e_type(prev_ty);
    if (
      ty !== undefined &&
      found_ty !== undefined &&
      // Ideally we would instead use `FnCtxt::lookup_method_for_diagnostic` for 100%
      // accurate check, but we are in the wrong stage to do that and looking for
      // `Result::map_err` by checking the Self type and the path segment is enough.
      // sym::ok_or_else
      // Result::map_err
      ((path_segment.ident.name === sym.map_err && is_diagnostic_item(sym.Result, next_ty)) ||
        // Option::ok_or_else
        (path_segment.ident.name === sym.ok_or_else && is_diagnostic_item(sym.Option, next_ty)))
    ) {
      // Found `Result<_, ()>?`
      const ftk = found_ty.kind();
      if (
        ftk.$ === "Tuple" &&
        ftk._0.length === 0 &&
        // The current method call returns `Result<_, ()>`
        this.can_eq(obligation.param_env, ty, found_ty, ToTrace_Ty) &&
        // There's a single argument in the method call and it is a closure
        args.length === 1 &&
        args[0]!.kind.$ === "Closure"
      ) {
        const arg = args[0]!;
        const closure = (arg.kind as Extract<hir.ExprKind, { $: "Closure" }>)._0;
        // The closure has a block for its body with no tail expression
        const body = this.tcx.hir_body(closure.body);
        if (body.value.kind.$ === "Block" && body.value.kind._0.expr === undefined && body.value.kind._0.stmts.length >= 1) {
          const block = body.value.kind._0;
          // The last statement is of a type that can be converted to the return error type
          const stmt = block.stmts[block.stmts.length - 1]!;
          if (stmt.kind.$ === "Semi") {
            const expr2 = stmt.kind._0;
            const expr_ty = this.deeply_resolve_ignoring_regions(
              unwrap_or(typeck.expr_ty_adjusted_opt(expr2), Ty.new_misc_error(this.tcx)),
              fold_Ty,
            );
            if (
              EvaluationResult.must_apply_modulo_regions(
                this.infcx.type_implements_trait(unwrap(this.tcx.get_diagnostic_item(sym.From)), [self_ty, expr_ty], obligation.param_env),
              )
            ) {
              suggested = true;
              err.span_suggestion_short(Span.with_lo(stmt.span, Span.hi(expr2.span)), "remove this semicolon", "", "MachineApplicable");
            }
          }
        }
      }
    }

    prev_ty = next_ty;

    if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined) {
      const path = expr.kind._0._1;
      if (path.res.$ === "Local") {
        const hir_id = path.res._0;
        const bn = this.tcx.hir_node(hir_id);
        if (bn.$ === "Pat") {
          const binding = bn._0;
          const parent = this.tcx.parent_hir_node(binding.hir_id);
          // We've reached the root of the method call chain...
          if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
            const binding_expr = parent._0.init;
            // ...and it is a binding. Get the binding creation and continue the chain.
            expr = binding_expr;
          }
          if (parent.$ === "Param") {
            // ...and it is an fn argument.
            break;
          }
        }
      }
    }
  }
  // `expr` is now the "root" expression of the method call chain, which can be any
  // expression kind, like a method call or a path. If this expression is `Result<T, E>` as
  // well, then we also point at it.
  prev_ty = this.deeply_resolve_ignoring_regions(unwrap_or(typeck.expr_ty_adjusted_opt(expr), Ty.new_misc_error(this.tcx)), fold_Ty);
  chain.push([expr.span, prev_ty]);

  let prev: Ty | undefined = undefined;
  const iter = [...chain].reverse();
  for (let i = 0; i < iter.length; i++) {
    const [span, err_ty0] = iter[i]!;
    const is_last = i + 1 >= iter.length;
    const err_ty1 = get_e_type(err_ty0);
    let err_ty: Ty;
    if (err_ty1 !== undefined && prev !== undefined && !this.can_eq(obligation.param_env, err_ty1, prev, ToTrace_Ty)) {
      err_ty = err_ty1;
    } else if (err_ty1 !== undefined && prev === undefined) {
      err_ty = err_ty1;
    } else {
      prev = err_ty1;
      continue;
    }

    const implements_from = EvaluationResult.must_apply_modulo_regions(
      this.infcx.type_implements_trait(unwrap(this.tcx.get_diagnostic_item(sym.From)), [self_ty, err_ty], obligation.param_env),
    );

    const err_ty_str = this.tcx.short_string(err_ty, err.long_ty_path(), print_Ty);
    let label: string;
    if (!implements_from && is_last) {
      label = `this can't be annotated with \`?\` because it has type \`Result<_, ${err_ty_str}>\``;
    } else {
      label = `this has type \`Result<_, ${err_ty_str}>\``;
    }

    if (!suggested || !implements_from) {
      err.span_label(span, label);
    }
    prev = err_ty;
  }
  return [suggested, noted_missing_impl];
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1379 note_missing_impl_for_question_mark
TypeErrCtxt.prototype.note_missing_impl_for_question_mark = function (
  this: TypeErrCtxt,
  err: Diag,
  self_ty: Ty,
  found_ty: Ty | undefined,
  trait_pred: PolyTraitClause,
): boolean {
  const sk = self_ty.kind();
  const fk = found_ty === undefined ? undefined : found_ty.kind();
  // PORT: `found` of the guard `if let ty::Adt(found, _) = ty.kind()`.
  const found = fk !== undefined && fk.$ === "Adt" ? fk._0 : undefined;
  if (sk.$ === "Adt" && found_ty !== undefined && found !== undefined && sk._0.did().is_local() && found.did().is_local()) {
    const def = sk._0;
    const ty = found_ty;
    err.span_note(this.tcx.def_span(def.did()), `\`${display_Ty(self_ty)}\` needs to implement \`From<${display_Ty(ty)}>\``);
  } else if (sk.$ === "Adt" && found_ty === undefined && sk._0.did().is_local()) {
    const def = sk._0;
    const trait_path = this.tcx.short_string(
      TraitRef_print_only_trait_path(Binder.skip_binder(trait_pred).trait_ref),
      err.long_ty_path(),
      print_TraitRefPrintOnlyTraitPath,
    );
    err.span_note(this.tcx.def_span(def.did()), `\`${display_Ty(self_ty)}\` needs to implement \`${trait_path}\``);
  } else if (sk.$ === "Adt" && found_ty !== undefined && sk._0.did().is_local()) {
    const def = sk._0;
    const ty = found_ty;
    err.span_note(this.tcx.def_span(def.did()), `\`${display_Ty(self_ty)}\` needs to implement \`From<${display_Ty(ty)}>\``);
  } else if (found_ty !== undefined && found !== undefined && found.did().is_local()) {
    const def = found;
    const ty = found_ty;
    err.span_note(this.tcx.def_span(def.did()), `\`${display_Ty(ty)}\` needs to implement \`Into<${display_Ty(self_ty)}>\``);
  } else {
    return false;
  }
  return true;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1427 report_const_param_not_wf
TypeErrCtxt.prototype.report_const_param_not_wf = function (this: TypeErrCtxt, ty: Ty, obligation: PredicateObligation): Diag {
  const def_id = obligation.cause.body_def_id;
  const span = this.tcx.ty_span(def_id);

  const file: MutRef<PathBuf | undefined> = { value: undefined };
  const ty_str = this.tcx.short_string(ty, file, print_Ty);
  let diag: Diag;
  const k = ty.kind();
  switch (k.$) {
    case "Float":
      diag = struct_span_code_err(this.dcx(), span, E0741, `\`${ty_str}\` is forbidden as the type of a const generic parameter`);
      break;
    case "FnPtr":
      diag = struct_span_code_err(this.dcx(), span, E0741, "using function pointers as const generic parameters is forbidden");
      break;
    case "RawPtr":
      diag = struct_span_code_err(this.dcx(), span, E0741, "using raw pointers as const generic parameters is forbidden");
      break;
    case "Adt": {
      const def = k._0;
      // We should probably see if we're *allowed* to derive `ConstParamTy` on the type...
      const diag_ = struct_span_code_err(
        this.dcx(),
        span,
        E0741,
        `\`${ty_str}\` must implement \`ConstParamTy\` to be used as the type of a const generic parameter`,
      );
      // Only suggest derive if this isn't a derived obligation,
      // and the struct is local.
      const span_ = this.tcx.hir_span_if_local(def.did());
      if (span_ !== undefined && ObligationCauseCode.parent(obligation.cause.code_()) === undefined) {
        if (ty.is_structural_eq_shallow(this.tcx)) {
          diag_.span_suggestion_verbose(
            Span.shrink_to_lo(span_),
            `add \`#[derive(ConstParamTy)]\` to the ${def.descr()}`,
            "#[derive(ConstParamTy)]\n",
            "MachineApplicable",
          );
        } else {
          // FIXME(adt_const_params): We should check there's not already an
          // overlapping `Eq`/`PartialEq` impl.
          diag_.span_suggestion_verbose(
            Span.shrink_to_lo(span_),
            `add \`#[derive(ConstParamTy, PartialEq, Eq)]\` to the ${def.descr()}`,
            "#[derive(ConstParamTy, PartialEq, Eq)]\n",
            "MachineApplicable",
          );
        }
      }
      diag = diag_;
      break;
    }
    default:
      diag = struct_span_code_err(this.dcx(), span, E0741, `\`${ty_str}\` can't be used as a const parameter type`);
      break;
  }
  diag.long_ty_path().value = file.value;

  let code = obligation.cause.code_();
  let pred = obligation.predicate.as_trait_clause();
  let next: [ObligationCauseCodeT, PolyTraitClause | undefined] | undefined;
  while ((next = ObligationCauseCode.parent_with_predicate(code)) !== undefined) {
    const [next_code, next_pred] = next;
    if (pred !== undefined) {
      this.enter_forall(
        pred,
        (pred) => {
          const ty = this.tcx.short_string(TraitClause.self_ty(pred), diag.long_ty_path(), print_Ty);
          const trait_path = this.tcx.short_string(TraitClause_print_modifiers_and_trait_path(pred), diag.long_ty_path(), print_TraitClausePrintModifiersAndPath);
          diag.note(`\`${ty}\` must implement \`${trait_path}\`, but it does not`);
        },
        d_TraitClause,
      );
    }
    code = next_code;
    pred = next_pred;
  }

  return diag;
};

// ---- lane errrep-traits-a helpers -----------------------------------------------------------------------------------

/** `Option::unwrap_or(default)` (the default is evaluated by the caller, as Rust evaluates the argument). */
function unwrap_or<T>(v: T | undefined, default_: T): T {
  return v !== undefined ? v : default_;
}

/** `(BytePos, BytePos) == (BytePos, BytePos)` */
function lo_hi_eq(a: readonly [BytePos, BytePos], b: readonly [BytePos, BytePos]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** `Goal<Predicate>`'s derived `PartialEq` (`ParamEnv_eq`, interned `Predicate`). */
function goal_eq(a: Goal<Predicate>, b: Goal<Predicate>): boolean {
  return ParamEnv_eq(a.param_env, b.param_env) && a.predicate === b.predicate;
}

/** `{:?}` of a `PredicateObligation` (rustc_infer traits/structural_impls.rs). */
function debug_PredicateObligation(o: PredicateObligation): string {
  return debug_Obligation(o, PLAIN, debug_Predicate);
}

/** `TraitClause`'s derived `TypeFoldable` (rustc_type_ir predicate.rs) as a descriptor. */
const d_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** `Binder<TraitClause>`'s `TypeFoldable` (rustc_middle traits/mod.ts's `PolyTraitClause` impls). */
const d_PolyTraitClause: TypeFoldable<PolyTraitClause> = {
  visit_with: visit_with_PolyTraitClause,
  try_fold_with: try_fold_with_PolyTraitClause,
  fold_with: fold_with_PolyTraitClause,
};

/** `Print for ty::Binder<'tcx, TraitClause>` (pretty.rs:2960) for `tcx.short_string`. */
const print_PolyTraitClause = (v: PolyTraitClause, p: PrettyPrinter): PrintResult => print_Binder(v, p, print_TraitClause, d_TraitClause);

/** `TraitRefPrintSugared`'s derived `TypeFoldable` (pretty.rs:2997, a newtype over `TraitRef`). */
const d_TraitRefPrintSugared: TypeFoldable<TraitRefPrintSugared> = {
  visit_with: (v, visitor) => visit_with_TraitRef(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitRef(v._0, folder);
    return r.$ === "Err" ? r : Ok({ _0: r._0 });
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitRef(v._0, folder) }),
};

/** `Display for ty::Binder<'tcx, TraitRefPrintSugared>` (rustc_type_ir ir_print.rs through `IrPrint` for `TyCtxt`). */
function display_PolyTraitRefPrintSugared(self: Binder<TraitRefPrintSugared>): string {
  const print = (t: Binder<TraitRefPrintSugared>, p: PrettyPrinter) => print_Binder(t, p, print_TraitRefPrintSugared, d_TraitRefPrintSugared);
  return display_Binder(self, {
    print: (t, fmt) => IrPrint_print(t, fmt, print),
    print_debug: (t, fmt) => IrPrint_print_debug(t, fmt, print),
  });
}

/** The crate's traits/select/mod.ts (`SelectionContext`), read lazily (init order). */
function select_mod(): typeof import("../../traits/select/mod.ts") {
  return require("../../traits/select/mod.ts") as typeof import("../../traits/select/mod.ts");
}


// ==== lane errrep-traits-b: error_reporting/traits/fulfillment_errors.rs ====
// Lane errrep-traits-b ports `impl TypeErrCtxt` (fulfillment_errors.rs:1530..4136) here; its imports are kept in this
// region (separate from lane errrep-traits-a's) to keep the two lanes' edits apart.
// - Same-crate modules (traits/engine.ts, traits/select/mod.ts, traits/specialize/specialization_graph.ts,
//   error_reporting/traits/mod.ts, diagnostics.gen.ts) are read lazily (`lazy_*()` at the end): init order.
// - `rustc_transmute` is not ported (no lane yet): `Assume::from_const` / `TransmuteTypeEnv` are `unported(..)` with
//   local structural stand-ins (precedent traits/select/confirmation.ts).
// - `TyCategory::from_ty` (error_reporting/infer/mod.rs:2738, lane errrep-infer-a) is read lazily from infer/mod.ts.
// - The `TypeFoldable` derives of rustc_middle's printing wrappers (`TraitClausePrintWithBoundConstness`,
//   `TraitClausePrintModifiersAndPath`), needed to print them inside a `Binder`, are local descriptors (pretty.ts has
//   none yet).
import { Applicability, DiagMessage, E0059, E0271, E0593, MultiSpan, msg, pluralize, StringPart } from "../../../rustc_errors/lib.ts";
import { LangItem } from "../../../rustc_attr_ir/lang_items.ts";
import { PolyTraitClause as PolyTraitClauseV } from "../../../rustc_type_ir/predicate.ts";
import { expr_needs_parens } from "../../../rustc_hir/hir.ts";
import { debug_Node } from "../../../rustc_hir/hir.gen.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { ToTrace_AliasTerm, ToTrace_GenericArg, ToTrace_Term, ToTrace_TraitRef } from "../../../rustc_infer/infer/at.ts";
import { BoundRegionConversionTime } from "../../../rustc_infer/infer/mod.gen.ts";
import { TypeTrace, type ValuePairs } from "../../../rustc_infer/infer/mod.ts";
import { type SortLayout, slice_sort_by, slice_sort_unstable_by } from "../../../std/slice_sort.ts";
import { FxHashSet, type KeyType, String_key } from "../../../rust_ts/hash_map.ts";
import { TraitErrors } from "../../../rustc_infer/traits/engine.ts";
import type { MismatchedProjectionTypes } from "../../../rustc_infer/traits/project.gen.ts";
import { place_to_string_for_capture } from "../../../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Clause } from "../../../rustc_middle/ty/decls.ts";
import type { PolyProjectionClause, PolyTraitClause as PolyTraitClauseT } from "../../../rustc_type_ir/decls.ts";
import { Elaboratable_Predicate } from "../../../rustc_middle/ty/elaborate_impl.ts";
import { GenericClauses } from "../../../rustc_middle/ty/generics.ts";
import { type ImplTraitHeader, type ParamEnv, type Term as TermT, Term, TypingEnv, Visibility } from "../../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_Clause, Predicate_upcast_from_TraitClause } from "../../../rustc_middle/ty/predicate.ts";
import type { Print } from "../../../rustc_middle/ty/print/mod.ts";
import {
  display_TraitRefPrintOnlyTraitPath,
  display_TraitRefPrintSugared,
  PolyTraitClause_print_modifiers_and_trait_path,
  PolyTraitClause_print_with_bound_constness,
  print_Predicate,
  print_Term,
  print_TraitClausePrintWithBoundConstness,
  type TraitClausePrintModifiersAndPath,
  type TraitClausePrintWithBoundConstness,
  TraitRef_print_trait_sugared,
  with_forced_trimmed_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Const, fold_Const } from "../../../rustc_type_ir/sty/consts.ts";
import { display_Const } from "../../../rustc_type_ir/ir_print.ts";
import { TraitImpls } from "../../../rustc_middle/ty/trait_def.ts";
import { type CrateNum, DefIdSet, LOCAL_CRATE } from "../../../rustc_span/def_id.ts";
import { str_cmp } from "../../../rustc_session/options.ts";
import { EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import type { AliasConst } from "../../../rustc_type_ir/ty/alias.gen.ts";
import { AliasConstKind } from "../../../rustc_type_ir/const_kind.ts";
import { elaborate } from "../../../rustc_type_ir/elaborate.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { fold_with_ExpectedFound, try_fold_with_ExpectedFound, visit_with_ExpectedFound } from "../../../rustc_type_ir/error.gen.ts";
import type { TypeFolder, PredicateProxy } from "../../../rustc_type_ir/fold.ts";
import { TypeFolder_provided } from "../../../rustc_type_ir/fold.ts";
import { TypeFlags } from "../../../rustc_type_ir/flags.ts";
import { display_ClosureKind } from "../../../rustc_type_ir/lib.ts";
import {
  as_interner,
  BoundConstness,
  type ClausePolarity,
  fold_with_HostEffectClause,
  fold_with_ProjectionClause,
  ProjectionClause,
  TraitRef,
  try_fold_with_HostEffectClause,
  try_fold_with_ProjectionClause,
  visit_with_HostEffectClause,
  visit_with_ProjectionClause,
} from "../../../rustc_type_ir/predicate.ts";
import { AliasTerm, AliasTermKind, fold_with_AliasTermKind, try_fold_with_AliasTermKind, visit_with_AliasTermKind } from "../../../rustc_type_ir/term_kind.ts";
import { fold_with_Alias, try_fold_with_Alias, visit_with_Alias, type AliasTerm as AliasTermT } from "../../../rustc_type_ir/ty/alias.ts";
import { fold_with_AliasTyKind } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { IsRigid } from "../../../rustc_type_ir/ty_kind.gen.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { panic, unported } from "../../../std/panic.ts";
import type { ArgKind as ArgKindT, CandidateSimilarity, ImplCandidate } from "./mod.gen.ts";
import { GetSafeTransmuteErrorAndReason } from "./mod.gen.ts";
import { clone_ImplCandidate } from "./mod.gen.ts";
import type { FulfillmentError } from "../../traits/mod.gen.ts";
import type { InferCtxt } from "../../../rustc_infer/decls.ts";
import type { Clauses, Const, Region } from "../../../rustc_middle/ty/decls.ts";
import { print_TraitRef } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { IntoMultiSpan } from "../../../rustc_errors/lib.ts";
import { DefKind } from "../../../rustc_hir/def.ts";
import { AliasConst as AliasConstC } from "../../../rustc_type_ir/const_kind.ts";
import type { ClosureKindMismatch } from "../../diagnostics.gen.ts";
import { unreachable } from "../../../std/panic.ts";

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx> (fulfillment_errors.rs:1530)

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1531 can_match_trait
TypeErrCtxt.prototype.can_match_trait = function (this: TypeErrCtxt, param_env: ParamEnv, goal: TraitClause, assumption: PolyTraitClauseT): boolean {
  // Fast path
  if (goal.polarity !== PolyTraitClauseV.polarity(assumption)) {
    return false;
  }

  const trait_assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption, d_TraitClause);

  return this.can_eq(param_env, goal.trait_ref, trait_assumption.trait_ref, ToTrace_TraitRef);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1551 can_match_host_effect
TypeErrCtxt.prototype.can_match_host_effect = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  goal: HostEffectClause,
  assumption_: Binder<HostEffectClause>,
): boolean {
  const assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption_, d_HostEffectClause);

  return BoundConstness.satisfies(assumption.constness, goal.constness) && this.can_eq(param_env, goal.trait_ref, assumption.trait_ref, ToTrace_TraitRef);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1567 as_host_effect_clause
TypeErrCtxt.as_host_effect_clause = function (predicate: Predicate): Binder<HostEffectClause> | undefined {
  const clause = predicate.as_clause();
  if (clause === undefined) return undefined;
  const kind = Binder.skip_binder(clause.kind());
  switch (kind.$) {
    case "HostEffect":
      return Binder.rebind(clause.kind(), kind._0);
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1576 can_match_projection
TypeErrCtxt.prototype.can_match_projection = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  goal: ProjectionClause,
  assumption_: PolyProjectionClause,
): boolean {
  const assumption = this.instantiate_binder_with_fresh_vars(DUMMY_SP, BoundRegionConversionTime.HigherRankedType, assumption_, d_ProjectionClause);

  return (
    this.can_eq(param_env, goal.projection_term, assumption.projection_term, ToTrace_AliasTerm) &&
    this.can_eq(param_env, goal.term, assumption.term, ToTrace_Term)
  );
};

// returns if `cond` not occurring implies that `error` does not occur - i.e., that
// `error` occurring implies that `cond` occurs.
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1595 error_implies
TypeErrCtxt.prototype.error_implies = function (this: TypeErrCtxt, cond: Goal<Predicate>, error: Goal<Predicate>): boolean {
  // PORT: `Goal`'s derived `PartialEq` (`goal_eq`: `ParamEnv_eq`, interned `Predicate`); `ParamEnv` is not unique per value.
  if (goal_eq(cond, error)) {
    return true;
  }

  // FIXME: We could be smarter about this, i.e. if cond's param-env is a
  // subset of error's param-env. This only matters when binders will carry
  // predicates though, and obviously only matters for error reporting.
  if (!ParamEnv_eq(cond.param_env, error.param_env)) {
    return false;
  }
  const param_env = error.param_env;

  let trait_error: PolyTraitClauseT | undefined;
  let host_error: Binder<HostEffectClause> | undefined;
  let projection_error: PolyProjectionClause | undefined;
  if ((trait_error = error.predicate.as_trait_clause()) !== undefined) {
    return this.enter_forall(
      trait_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = implied.as_trait_clause();
          if (implied_ === undefined) continue;
          if (this.can_match_trait(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_TraitClause,
    );
  } else if ((host_error = TypeErrCtxt.as_host_effect_clause(error.predicate)) !== undefined) {
    return this.enter_forall(
      host_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = TypeErrCtxt.as_host_effect_clause(implied);
          if (implied_ === undefined) continue;
          if (this.can_match_host_effect(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_HostEffectClause,
    );
  } else if ((projection_error = error.predicate.as_projection_clause()) !== undefined) {
    return this.enter_forall(
      projection_error,
      (error) => {
        for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
          const implied_ = implied.as_projection_clause();
          if (implied_ === undefined) continue;
          if (this.can_match_projection(param_env, error, implied_)) return true;
        }
        return false;
      },
      d_ProjectionClause,
    );
  } else {
    return false;
  }
};

/// Whether `error`, a projection goal, only failed because the trait goal it rests on
/// did: `<T as Trait>::Assoc == U` cannot hold when `T: Trait` doesn't, so an error on
/// the latter says everything the former would.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1638 trait_error_implies_projection_error
TypeErrCtxt.prototype.trait_error_implies_projection_error = function (this: TypeErrCtxt, cond: Goal<Predicate>, error_: Goal<Predicate>): boolean {
  if (!ParamEnv_eq(cond.param_env, error_.param_env)) {
    return false;
  }
  const error = error_.predicate.as_projection_clause();
  if (error === undefined) {
    return false;
  }

  return this.enter_forall(
    error,
    (error) => {
      if (!AliasTermKind.is_trait_projection(error.projection_term.kind)) {
        return false;
      }
      const trait_pred: TraitClause = {
        trait_ref: AliasTerm.trait_ref(error.projection_term, as_interner(this.tcx)),
        polarity: "Positive",
      };
      // Elaborating is what pairs a failing `C: FnMut(..)` with the
      // `<C as FnOnce<..>>::Output` projection resting on it. A supertrait can hold
      // while `cond` fails though, so the projection is only covered if its own trait
      // goal is unproven too, otherwise it failed for its own reasons.
      let any = false;
      for (const implied of elaborate(this.tcx, [cond.predicate], Elaboratable_Predicate)) {
        const implied_ = implied.as_trait_clause();
        if (implied_ === undefined) continue;
        if (this.can_match_trait(cond.param_env, trait_pred, implied_)) {
          any = true;
          break;
        }
      }
      return (
        any &&
        !this.predicate_must_hold_modulo_regions(Obligation.new(this.tcx, ObligationCause.dummy(), cond.param_env, trait_pred, Predicate_upcast_from_TraitClause_))
      );
    },
    d_ProjectionClause,
  );
};

// #[instrument(level = "debug", skip_all)]
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1675 report_projection_error
TypeErrCtxt.prototype.report_projection_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  error: MismatchedProjectionTypes,
): ErrorGuaranteed {
  const predicate = this.deeply_resolve_ignoring_regions(obligation.predicate, fold_Predicate);

  const reported = TypeVisitableExt.error_reported(predicate, fold_Predicate);
  if (reported.$ === "Err") {
    return reported._0;
  }

  return this.probe((_) => {
    // try to find the mismatched types to report the error with.
    //
    // this can fail if the problem was higher-ranked, in which
    // cause I have no idea for a good error message.
    const bound_predicate = predicate.kind();
    let values: [AliasTermT, TermT, TermT] | undefined;
    let err: TypeError;
    const pk = Binder.skip_binder(bound_predicate);
    if (pk.$ === "Clause" && pk._0.$ === "Projection") {
      const data_ = pk._0._0;
      const ocx = lazy_engine().ObligationCtxt.new(this.infcx);

      const data = this.instantiate_binder_with_fresh_vars(
        obligation.cause.span,
        BoundRegionConversionTime.HigherRankedType,
        Binder.rebind(bound_predicate, data_),
        d_ProjectionClause,
      );
      const unnormalized_term = AliasTerm.to_term(data.projection_term, this.tcx, IsRigid.No);
      const normalized_term = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(unnormalized_term), fold_Term);

      // constrain inference variables a bit more to nested obligations from normalize so
      // we can have more helpful errors.
      //
      // we intentionally drop errors from normalization here,
      // since the normalization is just done to improve the error message.
      void ocx.try_evaluate_obligations();

      const new_err = ocx.eq(obligation.cause, obligation.param_env, data.term, normalized_term, ToTrace_Term);
      if (new_err.$ === "Err") {
        values = [data.projection_term, this.deeply_resolve_ignoring_regions(normalized_term, fold_Term), data.term];
        err = new_err._0;
      } else {
        values = undefined;
        err = error.err;
      }
    } else {
      values = undefined;
      err = error.err;
    }

    const file: MutRef<PathBuf | undefined> = { value: undefined };
    let msg_: string;
    let span: Span;
    let closure_span: Span | undefined;
    const detailed =
      values !== undefined ? this.maybe_detailed_projection_msg(obligation.cause.span, values[0], values[1], values[2], file) : undefined;
    if (detailed !== undefined) {
      [msg_, span, closure_span] = detailed;
    } else {
      msg_ = with_forced_trimmed_paths(
        () =>
          `type mismatch resolving \`${this.tcx.short_string(this.deeply_resolve_ignoring_regions(predicate, fold_Predicate), file, print_Predicate)}\``,
      );
      span = obligation.cause.span;
      closure_span = undefined;
    }

    // When the obligation comes from a closure arg and the projection isn't FnOnceOutput
    // (which maybe_detailed_projection_msg handles via self_ty), point at the closure's
    // return expression and label the closure declaration.
    const cause_code = obligation.cause.code_();
    if (closure_span === undefined && cause_code.$ === "FunctionArg") {
      const arg_node = this.tcx.hir_node(cause_code.arg_hir_id);
      if (arg_node.$ === "Expr" && arg_node._0.kind.$ === "Closure" && arg_node._0.kind._0.kind.$ === "Closure") {
        const closure = arg_node._0.kind._0;
        const body = this.tcx.hir_body(closure.body);
        let ret_span: Span;
        const body_kind = body.value.kind;
        if (body_kind.$ === "Block" && body_kind._0.expr !== undefined) {
          ret_span = body_kind._0.expr.span;
        } else if (body_kind.$ === "Block" && body_kind._0.expr === undefined && body_kind._0.stmts.length >= 1) {
          ret_span = body_kind._0.stmts[body_kind._0.stmts.length - 1]!.span;
        } else {
          ret_span = body.value.span;
        }
        if (!Span.overlaps(closure.fn_decl_span, ret_span)) {
          closure_span = closure.fn_decl_span;
          span = ret_span;
        }
      }
    }

    const diag = struct_span_code_err(this.dcx(), span, E0271, msg_);
    diag.long_ty_path().value = file.value;
    let mention_bounds = true;
    if (closure_span !== undefined) {
      const span_ = closure_span;
      // `if let Some((_, _, expected_ty)) = values && let Some(expected_ty) = expected_ty.as_type() && ..`
      let bound_requires_itself: [DefId, Span, HirId] | undefined;
      if (values !== undefined) {
        const expected_ty = Term.as_type(values[2]);
        if (expected_ty !== undefined) {
          const ek = expected_ty.kind();
          if (ek.$ === "Closure" && Span.overlaps(this.tcx.def_span(ek._0), span_)) {
            const code = obligation.cause.code_();
            if (code.$ === "FunctionArg") {
              const parent_code = ObligationCauseCodeHandle.deref(code.parent_code);
              if (parent_code.$ === "WhereClauseInExpr" || parent_code.$ === "WhereClause") {
                bound_requires_itself = [parent_code._0, parent_code._1, code.arg_hir_id];
              }
            }
          }
        }
      }
      if (bound_requires_itself !== undefined) {
        const [def_id, span, arg_hir_id] = bound_requires_itself;
        // We have a trait bound for a closure to return itself, like
        // `T: FnOnce() -> T`. This is nonsensical, but as far as the type system is
        // concerned, valid. This is quite an edge case, but lets produce a reasonable
        // diagnostic even in the face of an unreasonable user :)
        const multispan = MultiSpan.from_span(span);
        multispan.push_span_label(span, "this requires the closure to return itself");
        const arg = this.tcx.hir_node(arg_hir_id);
        if (arg.$ === "Expr") {
          multispan.push_span_label(arg._0.span, "this closure would have to return itself");
        }
        const name = this.tcx.opt_item_name(def_id);
        const in_the_item = name !== undefined ? `in \`${display_Symbol(name)}\`` : "";
        diag.span_note(multispan, `a bound ${in_the_item} requires that a closure return itself, which is not possible`);
        mention_bounds = false;
      } else {
        // Mark the closure decl so that it is seen even if we are pointing at the
        // return type or expression.
        //
        // error[E0271]: expected `{closure@foo.rs:41:16}` to be a closure that returns
        //               `Unit3`, but it returns `Unit4`
        //   --> $DIR/foo.rs:43:17
        //    |
        // LL |     let v = Unit2.m(
        //    |                   - required by a bound introduced by this call
        // ...
        // LL |             f: |x| {
        //    |                --- /* this span */
        // LL |                 drop(x);
        // LL |                 Unit4
        //    |                 ^^^^^ expected `Unit3`, found `Unit4`
        //    |
        diag.span_label(span_, "this closure");
        if (!Span.overlaps(span_, obligation.cause.span)) {
          // Point at the binding corresponding to the closure where it is used.
          diag.span_label(obligation.cause.span, "closure used here");
        }
      }
    }

    const secondary_span = this.probe((_): [Span, string, boolean] | undefined => {
      const pk = Binder.skip_binder(predicate.kind());
      if (!(pk.$ === "Clause" && pk._0.$ === "Projection")) {
        return undefined;
      }
      const proj = pk._0._0;
      if (!AliasTermKind.is_trait_projection(proj.projection_term.kind)) {
        return undefined;
      }

      const trait_ref = this.enter_forall_and_leak_universe(
        Binder.rebind(predicate.kind(), AliasTerm.trait_ref(proj.projection_term, as_interner(this.tcx))),
        d_TraitRef,
      );
      const selection = lazy_select().SelectionContext.new(this.infcx).select(obligation.with(this.tcx, trait_ref, TraitClause_upcast_from_TraitRef));
      if (!(selection.$ === "Ok" && selection._0 !== undefined && selection._0.$ === "UserDefined")) {
        return undefined;
      }
      const impl_data = selection._0._0;

      const node_r = lazy_specialization_graph().assoc_def(this.tcx, impl_data.impl_def_id, ProjectionClause.def_id(proj));
      if (node_r.$ !== "Ok") {
        return undefined;
      }
      const node = node_r._0;

      if (!node.is_final()) {
        return undefined;
      }

      const item = this.tcx.hir_get_if_local(node.item.def_id);
      let ty: hir.Ty | undefined;
      if (item?.$ === "TraitItem" && item._0.kind.$ === "Type" && item._0.kind._1 !== undefined) {
        ty = item._0.kind._1;
      } else if (item?.$ === "ImplItem" && item._0.kind.$ === "Type") {
        ty = item._0.kind._0;
      }
      if (ty === undefined) {
        return undefined;
      }
      return [
        ty.span,
        with_forced_trimmed_paths(
          () =>
            `type mismatch resolving \`${this.tcx.short_string(this.deeply_resolve_ignoring_regions(predicate, fold_Predicate), diag.long_ty_path(), print_Predicate)}\``,
        ),
        true,
      ];
    });

    this.note_type_err(
      diag,
      obligation.cause,
      secondary_span,
      values === undefined
        ? undefined
        : obligation.param_env.and<ValuePairs>({ $: "Terms", _0: ExpectedFound.new(values[2], values[1]) }),
      err,
      false,
      span,
    );
    if (mention_bounds) {
      this.note_obligation_cause(diag, obligation);
    }
    return diag.emit_err();
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1916 maybe_detailed_projection_msg
TypeErrCtxt.prototype.maybe_detailed_projection_msg = function (
  this: TypeErrCtxt,
  span_: Span,
  projection_term: AliasTermT,
  normalized_ty: TermT,
  expected_ty: TermT,
  long_ty_path: MutRef<PathBuf | undefined>,
): [string, Span, Span | undefined] | undefined {
  let span = span_;
  if (!AliasTermKind.is_trait_projection(projection_term.kind)) {
    return undefined;
  }

  const projection_def_id = AliasTerm.expect_projection_def_id(projection_term);
  const trait_def_id = AliasTerm.trait_def_id(projection_term, as_interner(this.tcx));
  const self_ty = AliasTerm.self_ty(projection_term);

  return with_forced_trimmed_paths((): [string, Span, Span | undefined] | undefined => {
    if (this.tcx.is_lang_item(projection_def_id, LangItem.FnOnceOutput)) {
      let closure_span: Span | undefined;
      const sk = self_ty.kind();
      if (sk.$ === "Closure") {
        const def_id = sk._0;
        const def_span = this.tcx.def_span(def_id);
        const local_def_id = def_id.as_local();
        if (local_def_id !== undefined) {
          const node = this.tcx.hir_node_by_def_id(local_def_id);
          const fn_decl = hir.Node.fn_decl(node);
          const id = fn_decl !== undefined ? hir.Node.body_id(node) : undefined;
          if (fn_decl !== undefined && id !== undefined) {
            switch (fn_decl.output.$) {
              case "Return":
                span = fn_decl.output._0.span;
                break;
              case "DefaultReturn": {
                const body = this.tcx.hir_body(id);
                const body_kind = body.value.kind;
                if (body_kind.$ === "Block" && body_kind._0.expr !== undefined) {
                  span = body_kind._0.expr.span;
                } else if (body_kind.$ === "Block" && body_kind._0.expr === undefined && body_kind._0.stmts.length >= 1) {
                  span = body_kind._0.stmts[body_kind._0.stmts.length - 1]!.span;
                } else {
                  span = body.value.span;
                }
                break;
              }
            }
          }
        }
        closure_span = def_span;
      } else {
        closure_span = undefined;
      }
      const sk2 = self_ty.kind();
      const item = sk2.$ === "FnDef" ? display_Symbol(this.tcx.item_name(sk2._0)) : this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [`expected \`${item}\` to return \`${expected_ty_}\`, but it returns \`${normalized_ty_}\``, span, closure_span];
    } else if (this.tcx.is_lang_item(trait_def_id, LangItem.Future)) {
      const self_ty_ = this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [
        `expected \`${self_ty_}\` to be a future that resolves to \`${expected_ty_}\`, but it resolves to \`${normalized_ty_}\``,
        span,
        undefined,
      ];
    } else if (opt_def_id_eq(trait_def_id, this.tcx.get_diagnostic_item(sym.Iterator))) {
      const self_ty_ = this.tcx.short_string(self_ty, long_ty_path, print_Ty);
      const expected_ty_ = this.tcx.short_string(expected_ty, long_ty_path, print_Term);
      const normalized_ty_ = this.tcx.short_string(normalized_ty, long_ty_path, print_Term);
      return [`expected \`${self_ty_}\` to be an iterator that yields \`${expected_ty_}\`, but it yields \`${normalized_ty_}\``, span, undefined];
    } else {
      return undefined;
    }
  });
};

/// returns the fuzzy category of a given type, or None
/// if the type can be equated to any type.
// PORT: the nested `fn type_category` of `fuzzy_match_tys` (no captures), at module level.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2004 type_category
function type_category(tcx: TyCtxt, t: Ty): number | undefined {
  const k = t.kind();
  switch (k.$) {
    case "Bool":
      return 0;
    case "Char":
      return 1;
    case "Str":
      return 2;
    case "Adt":
      if (tcx.is_lang_item(k._0.did(), LangItem.String)) return 2;
      return 17;
    case "Int":
    case "Uint":
    case "Float":
      return 4;
    case "Infer":
      if (k._0.$ === "IntVar" || k._0.$ === "FloatVar") return 4;
      return undefined;
    case "Ref":
    case "RawPtr":
      return 5;
    case "Array":
    case "Slice":
      return 6;
    case "FnDef":
    case "FnPtr":
      return 7;
    case "Dynamic":
      return 8;
    case "Closure":
      return 9;
    case "Tuple":
      return 10;
    case "Param":
      return 11;
    case "Alias":
      switch (k._1.kind.$) {
        case "Projection":
          return 12;
        case "Inherent":
          return 13;
        case "Opaque":
          return 14;
        case "Free":
          return 15;
      }
      break;
    case "Never":
      return 16;
    case "Coroutine":
      return 18;
    case "Foreign":
      return 19;
    case "CoroutineWitness":
      return 20;
    case "CoroutineClosure":
      return 21;
    case "Pat":
      return 22;
    case "UnsafeBinder":
      return 23;
    case "Placeholder":
    case "Bound":
    case "Error":
      return undefined;
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:1996 fuzzy_match_tys
TypeErrCtxt.prototype.fuzzy_match_tys = function (this: TypeErrCtxt, a_: Ty, b_: Ty, ignoring_lifetimes: boolean): CandidateSimilarity | undefined {
  let a = a_;
  let b = b_;
  // fn type_category: see `type_category` above.

  const strip_references = (t_: Ty): Ty => {
    let t = t_;
    for (;;) {
      const k = t.kind();
      if (k.$ === "Ref") {
        t = k._1;
      } else if (k.$ === "RawPtr") {
        t = k._0;
      } else {
        return t;
      }
    }
  };

  if (!ignoring_lifetimes) {
    a = strip_references(a);
    b = strip_references(b);
  }

  const cat_a = type_category(this.tcx, a);
  if (cat_a === undefined) return undefined;
  const cat_b = type_category(this.tcx, b);
  if (cat_b === undefined) return undefined;
  if (a === b) {
    return { $: "Exact", ignoring_lifetimes };
  } else if (cat_a === cat_b) {
    const ak = a.kind();
    const bk = b.kind();
    let matches: boolean;
    if (ak.$ === "Adt" && bk.$ === "Adt") {
      matches = ak._0 === bk._0;
    } else if (ak.$ === "Foreign" && bk.$ === "Foreign") {
      matches = DefId_eq(ak._0, bk._0);
    } else if ((ak.$ === "Ref" || ak.$ === "RawPtr") && (bk.$ === "Ref" || bk.$ === "RawPtr")) {
      // Matching on references results in a lot of unhelpful
      // suggestions, so let's just not do that for now.
      //
      // We still upgrade successful matches to `ignoring_lifetimes: true`
      // to prioritize that impl.
      matches = this.fuzzy_match_tys(a, b, true) !== undefined;
    } else {
      matches = true;
    }
    return matches ? { $: "Fuzzy", ignoring_lifetimes } : undefined;
  } else if (ignoring_lifetimes) {
    return undefined;
  } else {
    return this.fuzzy_match_tys(a, b, true);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2077 describe_closure
TypeErrCtxt.prototype.describe_closure = function (this: TypeErrCtxt, kind: hir.ClosureKind): string {
  switch (kind.$) {
    case "Closure":
      return "a closure";
    case "Coroutine": {
      const ck = kind._0;
      if (ck.$ === "Coroutine") return "a coroutine";
      switch (ck._0) {
        case "Async":
          switch (ck._1) {
            case "Block":
              return "an async block";
            case "Fn":
              return "an async function";
            case "Closure":
              return "an async closure";
          }
          break;
        case "AsyncGen":
          switch (ck._1) {
            case "Block":
              return "an async gen block";
            case "Fn":
              return "an async gen function";
            case "Closure":
              return "an async gen closure";
          }
          break;
        case "Gen":
          switch (ck._1) {
            case "Block":
              return "a gen block";
            case "Fn":
              return "a gen function";
            case "Closure":
              return "a gen closure";
          }
          break;
      }
      break;
    }
    case "CoroutineClosure":
      switch (kind._0) {
        case "Async":
          return "an async closure";
        case "AsyncGen":
          return "an async gen closure";
        case "Gen":
          return "a gen closure";
      }
      break;
  }
  return unreachable();
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2127 find_similar_impl_candidates
TypeErrCtxt.prototype.find_similar_impl_candidates = function (this: TypeErrCtxt, trait_def_id: DefId, self_ty: Ty): ImplCandidate[] {
  let candidates: ImplCandidate[] = [];
  for (const def_id of this.tcx.all_impls(trait_def_id)) {
    const imp_ = this.tcx.impl_trait_header(def_id) as ImplTraitHeader;
    if (imp_.polarity !== "Positive" || !this.tcx.is_user_visible_dep(def_id.krate)) {
      continue;
    }
    const imp = EarlyBinder.skip_binder(imp_.trait_ref);

    const similarity = this.fuzzy_match_tys(self_ty, TraitRef.self_ty(imp), false);
    if (similarity !== undefined) {
      candidates.push({ trait_ref: imp, similarity, impl_def_id: def_id });
    }
  }
  if (candidates.some((c) => c.similarity.$ === "Exact")) {
    // If any of the candidates is a perfect match, we don't want to show all of them.
    // This is particularly relevant for the case of numeric types (as they all have the
    // same category).
    candidates = candidates.filter((c) => c.similarity.$ === "Exact");
  }
  return candidates;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2158 report_similar_impl_candidates
TypeErrCtxt.prototype.report_similar_impl_candidates = function (
  this: TypeErrCtxt,
  impl_candidates_: readonly ImplCandidate[],
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
  body_def_id: LocalDefId,
  err: Diag,
  other_: boolean,
  param_env: ParamEnv,
): boolean {
  const parent_map = this.tcx.visible_parent_map(null);
  const alternative_candidates = (def_id: DefId): [TraitRef, DefId][] => {
    // PORT: the lazy `filter` / `map` / `filter_map` / `filter` chain, one element at a time.
    const impl_candidates: [TraitRef, DefId][] = [];
    for (const def_id_ of this.tcx.all_impls(def_id)) {
      // ignore `do_not_recommend` items
      if (this.tcx.do_not_recommend_impl(def_id_)) continue;
      // Ignore automatically derived impls and `!Trait` impls.
      const header = this.tcx.impl_trait_header(def_id_) as ImplTraitHeader;
      if (!(header.polarity === "Positive" || this.tcx.is_automatically_derived(def_id_))) continue;
      const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(header.trait_ref));
      const keep = ((): boolean => {
        const self_ty = TraitRef.self_ty(trait_ref);
        const peeled = self_ty.peel_refs().kind();
        // Avoid mentioning type parameters.
        if (self_ty.kind().$ === "Param") {
          return false;
        }
        // Avoid mentioning types that are private to another crate
        else if (peeled.$ === "Adt") {
          // FIXME(compiler-errors): This could be generalized, both to
          // be more granular, and probably look past other `#[fundamental]`
          // types, too.
          let did = peeled._0.did();
          if (Visibility.is_accessible_from(this.tcx.visibility(did), body_def_id, this.tcx)) {
            // don't suggest foreign `#[doc(hidden)]` types
            if (!did.is_local()) {
              const previously_seen_dids = new DefIdSet();
              previously_seen_dids.add(did);
              for (;;) {
                const parent = parent_map.get(did);
                if (parent === undefined || previously_seen_dids.has(parent)) break;
                if (this.tcx.is_doc_hidden(did)) {
                  return false;
                }
                previously_seen_dids.add(parent);
                did = parent;
              }
            }
            return true;
          } else {
            return false;
          }
        } else {
          return true;
        }
      })();
      if (!keep) continue;
      impl_candidates.push([trait_ref, def_id_]);
    }

    sort_by_key_stable(impl_candidates, ([tr]) => display_TraitRef(tr), str_cmp);
    dedup_by(impl_candidates, TraitRef_DefId_eq);
    return impl_candidates;
  };

  if (impl_candidates_.length === 1 && !this.tcx.do_not_recommend_impl(impl_candidates_[0]!.impl_def_id)) {
    const single = impl_candidates_[0]!;
    const self_ty_ = TraitClause.self_ty(Binder.skip_binder(trait_pred));
    if (!TypeVisitableExt.has_escaping_bound_vars(self_ty_, fold_Ty)) {
      const self_ty = this.tcx.instantiate_bound_regions_with_erased(PolyTraitClauseV.self_ty(trait_pred), fold_Ty);
      const sk = self_ty.kind();
      if (
        sk.$ === "Ref" &&
        this.can_eq(param_env, TraitRef.self_ty(single.trait_ref), sk._1, ToTrace_Ty) &&
        !this.where_clause_expr_matches_failed_self_ty(obligation, self_ty)
      ) {
        // Avoid pointing at a nearby impl like `String: Borrow<str>` when the
        // failing obligation comes from something nested inside an enclosing call
        // expression such as `foo(&[String::from("a")])`.
        return true;
      }
    }

    // If we have a single implementation, try to unify it with the trait ref
    // that failed. This should uncover a better hint for what *is* implemented.
    if (
      this.probe((_) => {
        const ocx = lazy_engine().ObligationCtxt.new(this.infcx);

        return this.enter_forall(
          trait_pred,
          (obligation_trait_ref) => {
            const impl_args = this.fresh_args_for_item(DUMMY_SP, single.impl_def_id);
            const impl_trait_ref_ = ocx.normalize(
              ObligationCause.dummy(),
              param_env,
              EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, single.trait_ref, d_TraitRef), this.tcx, impl_args, d_TraitRef),
              d_TraitRef,
            );

            ocx.register_obligations(
              Array.from(GenericClauses.instantiate(this.tcx.clauses_of(single.impl_def_id) as GenericClauses, this.tcx, impl_args), ([clause, _]) =>
                Obligation.new(this.tcx, ObligationCause.dummy(), param_env, Unnormalized.skip_norm_wip(clause), Predicate_upcast_from_Clause_),
              ),
            );
            if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
              return false;
            }

            const terrs: TypeError[] = [];
            const obligation_args = obligation_trait_ref.trait_ref.args;
            const impl_args_ = impl_trait_ref_.args;
            for (let i = 0; i < Math.min(obligation_args.length, impl_args_.length); i++) {
              const obligation_arg = obligation_args[i]!;
              const impl_arg = impl_args_[i]!;
              // PORT: `(obligation_arg, impl_arg).references_error()`: the tuple's visit is both elements'.
              if (TypeVisitableExt.references_error(obligation_arg, fold_GenericArg_) || TypeVisitableExt.references_error(impl_arg, fold_GenericArg_)) {
                return false;
              }
              const r = ocx.eq(ObligationCause.dummy(), param_env, impl_arg, obligation_arg, ToTrace_GenericArg);
              if (r.$ === "Err") {
                terrs.push(r._0);
              }
              if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
                return false;
              }
            }

            // Literally nothing unified, just give up.
            if (terrs.length === impl_trait_ref_.args.length) {
              return false;
            }

            const impl_trait_ref = this.deeply_resolve_ignoring_regions(impl_trait_ref_, d_TraitRef);
            if (TypeVisitableExt.references_error(impl_trait_ref, d_TraitRef)) {
              return false;
            }

            const children = err.deref().children;
            const child = children[0];
            if (child !== undefined && child.level === "Help") {
              const line_ = child.messages[0];
              const line = line_ !== undefined ? DiagMessage.as_str(line_[0]) : undefined;
              if (line !== undefined && line.startsWith("the trait") && line.includes("is not implemented for")) {
                // HACK(estebank): we remove the pre-existing
                // "the trait `X` is not implemented for" note, which only happens if there
                // was a custom label. We do this because we want that note to always be the
                // first, and making this logic run earlier will get tricky. For now, we
                // instead keep the logic the same and modify the already constructed error
                // to avoid the wording duplication.
                children.splice(0, 1);
              }
            }

            const traits = this.cmp_traits(
              TraitClause.def_id(obligation_trait_ref),
              obligation_trait_ref.trait_ref.args.slice(1),
              impl_trait_ref.def_id,
              impl_trait_ref.args.slice(1),
            );
            const traits_content = [traits[0].content(), traits[1].content()];
            const types = this.cmp(TraitClause.self_ty(obligation_trait_ref), TraitRef.self_ty(impl_trait_ref));
            const types_content = [types[0].content(), types[1].content()];
            const msg_: StringPart[] = [StringPart.normal("the trait `")];
            if (traits_content[0] === traits_content[1]) {
              msg_.push(StringPart.normal(display_TraitRefPrintSugared(TraitRef_print_trait_sugared(impl_trait_ref))));
            } else {
              msg_.push(...traits[0]._0);
            }
            msg_.push(StringPart.normal("` "), StringPart.highlighted("is not"), StringPart.normal(" implemented for `"));
            if (types_content[0] === types_content[1]) {
              const ty = this.tcx.short_string(TraitClause.self_ty(obligation_trait_ref), err.long_ty_path(), print_Ty);
              msg_.push(StringPart.normal(ty));
            } else {
              msg_.push(...types[0]._0);
            }
            msg_.push(StringPart.normal("`"));
            if (types_content[0] === types_content[1]) {
              msg_.push(StringPart.normal("\nbut trait `"));
              msg_.push(...traits[1]._0);
              msg_.push(StringPart.normal("` "), StringPart.highlighted("is"), StringPart.normal(" implemented for it"));
            } else if (traits_content[0] === traits_content[1]) {
              msg_.push(StringPart.normal("\nbut it "), StringPart.highlighted("is"), StringPart.normal(" implemented for `"));
              msg_.push(...types[1]._0);
              msg_.push(StringPart.normal("`"));
            } else {
              msg_.push(StringPart.normal("\nbut trait `"));
              msg_.push(...traits[1]._0);
              msg_.push(StringPart.normal("` "), StringPart.highlighted("is"), StringPart.normal(" implemented for `"));
              msg_.push(...types[1]._0);
              msg_.push(StringPart.normal("`"));
            }
            err.highlighted_span_help(this.tcx.def_span(single.impl_def_id), msg_);

            if (terrs.length === 1 && terrs[0]!.$ === "Sorts") {
              const exp_found = this.deeply_resolve_ignoring_regions(terrs[0]!._0, d_ExpectedFound_Ty);
              const expected = this.tcx.short_string(exp_found.expected, err.long_ty_path(), print_Ty);
              const found = this.tcx.short_string(exp_found.found, err.long_ty_path(), print_Ty);
              err.highlighted_help([
                StringPart.normal("for that trait implementation, "),
                StringPart.normal("expected `"),
                StringPart.highlighted(expected),
                StringPart.normal("`, found `"),
                StringPart.highlighted(found),
                StringPart.normal("`"),
              ]);
              this.suggest_function_pointers_impl(undefined, exp_found, err);
            }

            const pk = Binder.skip_binder(PolyTraitClauseV.self_ty(trait_pred)).peel_refs().kind();
            if (pk.$ === "Adt") {
              const crates = this.tcx.duplicate_crate_names(pk._0.did().krate);
              if (crates.length !== 0) {
                this.note_two_crate_versions(pk._0.did().krate, MultiSpan.new(), err);
                err.help("you can use `cargo tree` to explore your dependency tree");
              }
            }
            return true;
          },
          d_TraitClause,
        );
      })
    ) {
      return true;
    }
  }

  const other = other_ ? "other " : "";
  const report = (candidates_: [TraitRef, DefId][], err: Diag): boolean => {
    let candidates = candidates_.filter(([tr]) => !TypeVisitableExt.references_error(tr, d_TraitRef));
    if (candidates.length === 0) {
      return false;
    }
    let specific_candidates = candidates.slice();
    specific_candidates = specific_candidates.filter(([tr]) =>
      TraitRef_eq(
        TraitRef.with_replaced_self_ty(tr, as_interner(this.tcx), TraitClause.self_ty(Binder.skip_binder(trait_pred))),
        Binder.skip_binder(trait_pred).trait_ref,
      ),
    );
    if (specific_candidates.length !== 0) {
      // We have found a subset of impls that fully satisfy the expected trait, only
      // mention those types.
      candidates = specific_candidates;
    }
    if (candidates.length === 1) {
      const [cand, def_id] = candidates[0]!;
      if (this.tcx.is_diagnostic_item(sym.FromResidual, cand.def_id) && !this.tcx.features().enabled(sym.try_trait_v2)) {
        return false;
      }
      const multi_span = MultiSpan.from_span(this.tcx.def_span(def_id));
      let desc: string;
      let mention_castable: string;
      const ck = TraitRef.self_ty(cand).kind();
      const tk = TraitClause.self_ty(Binder.skip_binder(trait_pred)).kind();
      if (ck.$ === "FnPtr" && tk.$ === "FnDef") {
        [desc, mention_castable] = [" implemented for fn pointer `", ", cast using `as`"];
      } else if (ck.$ === "FnPtr") {
        [desc, mention_castable] = [" implemented for fn pointer `", ""];
      } else {
        const evaluate_obligations = (): TraitErrors<FulfillmentError> => {
          const ocx = lazy_engine().ObligationCtxt.new_with_diagnostics(this.infcx);
          return this.enter_forall(
            trait_pred,
            (obligation_trait_ref) => {
              const impl_args = this.fresh_args_for_item(DUMMY_SP, def_id);
              const impl_trait_ref = ocx.normalize(
                ObligationCause.dummy(),
                param_env,
                EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, cand, d_TraitRef), this.tcx, impl_args, d_TraitRef),
                d_TraitRef,
              );
              if (ocx.eq(ObligationCause.dummy(), param_env, obligation_trait_ref.trait_ref, impl_trait_ref, ToTrace_TraitRef).$ === "Err") {
                return TraitErrors.NoErrors;
              }
              ocx.register_obligations(
                Array.from(GenericClauses.instantiate(this.tcx.clauses_of(def_id) as GenericClauses, this.tcx, impl_args), ([clause, span]) =>
                  Obligation.new(
                    this.tcx,
                    ObligationCause.dummy_with_span(span),
                    param_env,
                    Unnormalized.skip_normalization(clause),
                    Predicate_upcast_from_Clause_,
                  ),
                ),
              );
              return ocx.try_evaluate_obligations();
            },
            d_TraitClause,
          );
        };
        const failing_obligations: TraitErrors<FulfillmentError> =
          (this.tcx.clauses_of(def_id) as GenericClauses).clauses.length !== 0 ? this.probe((_) => evaluate_obligations()) : TraitErrors.NoErrors;

        if (TraitErrors.no_errors(failing_obligations)) {
          [desc, mention_castable] = [" implemented for `", ""];
        } else {
          for (const error of TraitErrors.into_iter_ref(failing_obligations)) {
            multi_span.push_span_label(
              error.root_obligation.cause.span,
              `unsatisfied requirement introduced here: \`${this.tcx.short_string(error.root_obligation.predicate, err.long_ty_path(), print_Predicate)}\``,
            );
          }

          [desc, mention_castable] = [" conditionally implemented for `", ""];
        }
      }
      const trait_ = this.tcx.short_string(TraitRef_print_trait_sugared(cand), err.long_ty_path(), print_TraitRefPrintSugared);
      const self_ty = this.tcx.short_string(TraitRef.self_ty(cand), err.long_ty_path(), print_Ty);
      err.highlighted_span_help(multi_span, [
        StringPart.normal(`the trait \`${trait_}\` `),
        StringPart.highlighted("is"),
        StringPart.normal(desc),
        StringPart.highlighted(self_ty),
        StringPart.normal("`"),
        StringPart.normal(mention_castable),
      ]);
      return true;
    }
    const trait_ref = TraitRef.identity(this.tcx, candidates[0]![0].def_id);
    // Check if the trait is the same in all cases. If so, we'll only show the type.
    const traits = candidates.map(([c]) => display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(c)));
    traits.sort(str_cmp);
    dedup_by(traits, (a, b) => a === b);
    // FIXME: this could use a better heuristic, like just checking
    // that args[1..] is the same.
    const all_traits_equal = traits.length === 1;
    const types = candidates.map(([c]) => display_Ty(TraitRef.self_ty(c)));
    types.sort(str_cmp);
    dedup_by(types, (a, b) => a === b);
    const all_types_equal = types.length === 1;

    let end = candidates.length <= 9 || this.tcx.sess.opts.verbose ? candidates.length : 8;
    if (candidates.length < 5) {
      const spans = candidates.map(([_, def_id]) => this.tcx.def_span(def_id));
      const span = MultiSpan.from_Vec(spans);
      for (const [c, def_id] of candidates) {
        let msg_: string;
        if (all_traits_equal) {
          msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\``;
        } else if (all_types_equal) {
          msg_ = `\`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        } else {
          msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\` implements \`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        }
        span.push_span_label(this.tcx.def_span(def_id), msg_);
      }
      let msg_: string;
      if (all_types_equal) {
        msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(candidates[0]![0]), err.long_ty_path(), print_Ty)}\` implements trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      } else {
        msg_ = `the following ${other}types implement trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      }
      err.span_help(span, msg_);
    } else {
      // When more than 5 tuples implement the same trait, the output might be very verbose
      // Instead of displaying each of these, we sort the candidates by arity in ascending
      // order, then we compute the min and the max arity, ensuring that the arities are
      // consecutive (by step of one). If these conditions are met, then the output is shown
      // as a range of tuples [tuple_min_arity:tuple_max_arity]
      let tuple_min_arity = Number.MAX_SAFE_INTEGER; // PORT: `usize::MAX` (only compared and then overwritten)
      let tuple_max_arity = 0;
      let last_arity: number | undefined = undefined;
      let all_types_tuples_cont_arity = true;
      sort_by_stable(candidates, ([c1], [c2]) => {
        const k1 = TraitRef.self_ty(c1).kind();
        const k2 = TraitRef.self_ty(c2).kind();
        if (k1.$ === "Tuple" && k2.$ === "Tuple") {
          return k1._0.length < k2._0.length ? -1 : k1._0.length > k2._0.length ? 1 : 0;
        } else {
          return 0;
        }
      }, LAYOUT_TraitRef_DefId);
      let candidate_names: string[] = candidates.map(([c]) => {
        if (all_traits_equal) {
          const k = TraitRef.self_ty(c).kind();
          if (all_types_tuples_cont_arity && k.$ === "Tuple" && (last_arity === undefined ? 1 : Math.abs(last_arity - k._0.length)) === 1) {
            last_arity = k._0.length;
            if (k._0.length > tuple_max_arity) {
              tuple_max_arity = k._0.length;
            }
            if (k._0.length < tuple_min_arity) {
              tuple_min_arity = k._0.length;
            }
          } else {
            all_types_tuples_cont_arity = false;
          }
          return `\n  ${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}`;
        } else if (all_types_equal) {
          return `\n  ${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}`;
        } else {
          return `\n  \`${this.tcx.short_string(TraitRef.self_ty(c), err.long_ty_path(), print_Ty)}\` implements \`${this.tcx.short_string(TraitRef_print_only_trait_path(c), err.long_ty_path(), print_TraitRefPrintOnlyTraitPath)}\``;
        }
      });

      let details: string;
      if (all_traits_equal && all_types_tuples_cont_arity) {
        if (tuple_min_arity === 0) {
          details = `up to tuples of arity ${tuple_max_arity}`;
        } else {
          details = `for tuples of arity ${tuple_min_arity} up to and including ${tuple_max_arity}`;
        }
      } else {
        details = "";
      }
      if (all_traits_equal && all_types_tuples_cont_arity) {
        [candidate_names, end] = [
          [
            // (T₁, T₂, …, Tₙ)
            `\n  (T\u{2081}, T\u{2082}, …, T\u{2099}) ${details}`,
          ],
          1,
        ];
      }
      let msg_: string;
      if (all_types_equal) {
        msg_ = `\`${this.tcx.short_string(TraitRef.self_ty(candidates[0]![0]), err.long_ty_path(), print_Ty)}\` implements trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      } else {
        msg_ = `the following ${other}types implement trait \`${this.tcx.short_string(TraitRef_print_trait_sugared(trait_ref), err.long_ty_path(), print_TraitRefPrintSugared)}\``;
      }

      err.help(
        `${msg_}:${candidate_names.slice(0, end).join("")}${candidates.length > 9 && !this.tcx.sess.opts.verbose ? `\nand ${candidates.length - 8} others` : ""}`,
      );
    }

    const pk = Binder.skip_binder(PolyTraitClauseV.self_ty(trait_pred)).peel_refs().kind();
    if (pk.$ === "Adt") {
      const crates = this.tcx.duplicate_crate_names(pk._0.did().krate);
      if (crates.length !== 0) {
        this.note_two_crate_versions(pk._0.did().krate, MultiSpan.new(), err);
        err.help("you can use `cargo tree` to explore your dependency tree");
      }
    }
    return true;
  };

  // we filter before checking if `impl_candidates` is empty
  // to get the fallback solution if we filtered out any impls
  const impl_candidates = impl_candidates_.map(clone_ImplCandidate).filter((cand) => !this.tcx.do_not_recommend_impl(cand.impl_def_id));

  const def_id = PolyTraitClauseV.def_id(trait_pred);
  if (impl_candidates.length === 0) {
    let is_lang_item = false;
    if (!this.tcx.trait_is_auto(def_id)) {
      for (const [_, id] of this.tcx.lang_items().iter()) {
        if (DefId_eq(id, def_id)) {
          is_lang_item = true;
          break;
        }
      }
    }
    if (this.tcx.trait_is_auto(def_id) || is_lang_item || this.tcx.get_diagnostic_name(def_id) !== undefined) {
      // Mentioning implementers of `Copy`, `Debug` and friends is not useful.
      return false;
    }
    return report(alternative_candidates(def_id), err);
  }

  // Sort impl candidates so that ordering is consistent for UI tests.
  // because the ordering of `impl_candidates` may not be deterministic:
  // https://github.com/rust-lang/rust/pull/57475#issuecomment-455519507
  //
  // Prefer more similar candidates first, then sort lexicographically
  // by their normalized string representation.
  const impl_candidates2: ImplCandidate[] = impl_candidates
    .map(clone_ImplCandidate)
    .filter((cand) => !TypeVisitableExt.references_error(cand.trait_ref, d_TraitRef))
    .map((cand) => {
      // Normalize the trait ref in its *own* param-env so
      // that consts are folded and any trivial projections
      // are normalized.
      const r = this.tcx.try_normalize_erasing_regions(
        TypingEnv.non_body_analysis(this.tcx, cand.impl_def_id),
        Unnormalized.new_wip(cand.trait_ref),
        d_TraitRef,
      );
      cand.trait_ref = r.$ === "Ok" ? r._0 : cand.trait_ref;
      return cand;
    });
  // PORT: `sort_by_key` with the key `(cand.similarity, len, cand.trait_ref.to_string())` (tuple `Ord`); the keys are
  // computed once per candidate (they are pure).
  sort_by_key_stable(
    impl_candidates2,
    (cand): [CandidateSimilarity, number, string] => {
      // When suggesting array types, sort them by the length of the array, not lexicographically (#135098)
      let len: number;
      const arg0 = GenericArg.kind(cand.trait_ref.args[0]!);
      const ak = arg0.$ === "Type" ? arg0._0.kind() : undefined;
      if (ak !== undefined && ak.$ === "Array") {
        // Deprioritize suggestions for parameterized arrays.
        // PORT: `u64::MAX` is `Infinity` (only compared).
        len = ak._1.try_to_target_usize(this.tcx) ?? Infinity;
      } else {
        len = 0;
      }

      return [cand.similarity, len, display_TraitRef(cand.trait_ref)];
    },
    ([s1, l1, t1], [s2, l2, t2]) => {
      const c = CandidateSimilarity_cmp(s1, s2);
      if (c !== 0) return c;
      if (l1 !== l2) return l1 < l2 ? -1 : 1;
      return str_cmp(t1, t2);
    },
  );
  const impl_candidates3: [TraitRef, DefId][] = impl_candidates2.map((cand) => [cand.trait_ref, cand.impl_def_id]);
  dedup_by(impl_candidates3, TraitRef_DefId_eq);

  return report(impl_candidates3, err);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2749 report_similar_impl_candidates_for_root_obligation
TypeErrCtxt.prototype.report_similar_impl_candidates_for_root_obligation = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_predicate: Binder<TraitClause>,
  body_def_id: LocalDefId,
  err: Diag,
): void {
  // This is *almost* equivalent to
  // `obligation.cause.code().peel_derives()`, but it gives us the
  // trait predicate for that corresponding root obligation. This
  // lets us get a derived obligation from a type parameter, like
  // when calling `string.strip_suffix(p)` where `p` is *not* an
  // implementer of `Pattern<'_>`.
  let code = obligation.cause.code_();
  let trait_pred = trait_predicate;
  let peeled = false;
  let next: [ObligationCauseCode, PolyTraitClauseT | undefined] | undefined;
  while ((next = ObligationCauseCode.parent_with_predicate(code)) !== undefined) {
    const [parent_code, parent_trait_pred] = next;
    code = parent_code;
    if (parent_trait_pred !== undefined) {
      trait_pred = parent_trait_pred;
      peeled = true;
    }
  }
  const def_id = PolyTraitClauseV.def_id(trait_pred);
  // Mention *all* the `impl`s for the *top most* obligation, the
  // user might have meant to use one of them, if any found. We skip
  // auto-traits or fundamental traits that might not be exactly what
  // the user might expect to be presented with. Instead this is
  // useful for less general traits.
  if (peeled && !this.tcx.trait_is_auto(def_id) && this.tcx.as_lang_item(def_id) === undefined) {
    const impl_candidates = this.find_similar_impl_candidates(PolyTraitClauseV.def_id(trait_pred), Binder.skip_binder(PolyTraitClauseV.self_ty(trait_pred)));
    this.report_similar_impl_candidates(impl_candidates, obligation, trait_pred, body_def_id, err, true, obligation.param_env);
  }
};

/// Gets the parent trait chain start
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2796 get_parent_trait_ref
TypeErrCtxt.prototype.get_parent_trait_ref = function (this: TypeErrCtxt, code: ObligationCauseCode): [Ty, Span | undefined] | undefined {
  switch (code.$) {
    case "BuiltinDerived": {
      const data = code._0;
      const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause);
      const t = this.get_parent_trait_ref(ObligationCauseCodeHandle.deref(data.parent_code));
      if (t !== undefined) {
        return t;
      } else {
        const ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
        const r = lazy_infer_mod().TyCategory_from_ty(this.tcx, ty);
        const span = r !== undefined ? this.tcx.def_span(r[1]) : undefined;
        return [ty, span];
      }
    }
    case "FunctionArg":
      return this.get_parent_trait_ref(ObligationCauseCodeHandle.deref(code.parent_code));
    default:
      return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2820 check_same_trait_different_version
TypeErrCtxt.prototype.check_same_trait_different_version = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClauseT): boolean {
  const get_trait_impls = (trait_def_id: DefId): Span[] => {
    const trait_impls: Span[] = [];
    this.tcx.for_each_relevant_impl(
      trait_def_id,
      TraitClause.self_ty(Binder.skip_binder(trait_pred)),
      (impl_def_id) => {
        const impl_trait_header = this.tcx.impl_trait_header(impl_def_id) as ImplTraitHeader;
        trait_impls.push(this.tcx.def_span(EarlyBinder.skip_binder(impl_trait_header.trait_ref).def_id));
      },
      VisitorResult.unit,
    );
    return trait_impls;
  };
  return this.check_same_definition_different_crate(err, PolyTraitClauseV.def_id(trait_pred), this.tcx.visible_traits(), get_trait_impls, "trait");
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2847 note_two_crate_versions
TypeErrCtxt.prototype.note_two_crate_versions = function (this: TypeErrCtxt, krate: CrateNum, sp: IntoMultiSpan, err: Diag): void {
  const crate_name = this.tcx.crate_name(krate);
  const crate_msg = `there are multiple different versions of crate \`${display_Symbol(crate_name)}\` in the dependency graph`;
  err.span_note(sp, crate_msg);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2860 note_adt_version_mismatch
TypeErrCtxt.prototype.note_adt_version_mismatch = function (this: TypeErrCtxt, err: Diag, trait_pred: PolyTraitClauseT): void {
  const pk = Binder.skip_binder(PolyTraitClauseV.self_ty(trait_pred)).peel_refs().kind();
  if (pk.$ !== "Adt") {
    return;
  }
  const impl_self_def = pk._0;

  const impl_self_did = impl_self_def.did();

  // We only want to warn about different versions of a dependency.
  // If no dependency is involved, bail.
  if (impl_self_did.krate === LOCAL_CRATE) {
    return;
  }

  const impl_self_path = this.comparable_path(impl_self_did);
  const impl_self_crate_name = this.tcx.crate_name(impl_self_did.krate);
  // PORT: `UnordSet<(DefId, String)>` is an `FxHashSet` (hashbrown order; the items are distinct `visible_parent_map`
  // keys, so `===` on the fresh tuples is the tuple's `Eq`), and `into_sorted_stable_ord_by_key(|(_, path)| path)` is
  // `sort_unstable_by` (`String` has `CAN_USE_UNSTABLE_SORT`): ties (same path, different `DefId`) keep hashbrown's
  // iteration order, as rustc's.
  const similar_items_ = new FxHashSet<[DefId, string]>(DefId_String_key);
  for (const [item, _] of this.tcx.visible_parent_map(null)) {
    // If we found ourselves, ignore.
    if (DefId_eq(impl_self_did, item)) {
      continue;
    }
    // We only want to warn about different versions of a dependency.
    // Ignore items from our own crate.
    if (item.krate === LOCAL_CRATE) {
      continue;
    }
    // We want to warn about different versions of a dependency.
    // So make sure the crate names are the same.
    if (impl_self_crate_name !== this.tcx.crate_name(item.krate)) {
      continue;
    }
    // Filter out e.g. constructors that often have the same path
    // str as the relevant ADT.
    if (!DefKind.is_adt(this.tcx.def_kind(item))) {
      continue;
    }
    const path = this.comparable_path(item);
    // We don't know if our item or the one we found is the re-exported one.
    // Check both cases.
    const is_similar = path.endsWith(impl_self_path) || impl_self_path.endsWith(path);
    if (is_similar) {
      similar_items_.add([item, path]);
    }
  }

  const similar_items = [...similar_items_];
  slice_sort_unstable_by(similar_items, (a, b) => str_cmp(a[1], b[1]), LAYOUT_DefId_String);
  dedup_by(similar_items, ([a1, a2], [b1, b2]) => DefId_eq(a1, b1) && a2 === b2);

  for (const [similar_item, _] of similar_items) {
    err.span_help(this.tcx.def_span(similar_item), "item with same name found");
    this.note_two_crate_versions(similar_item.krate, MultiSpan.new(), err);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2918 check_same_name_different_path
TypeErrCtxt.prototype.check_same_name_different_path = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
): boolean {
  let suggested = false;
  const trait_def_id = PolyTraitClauseV.def_id(trait_pred);
  const trait_has_same_params = (other_trait_def_id: DefId): boolean => {
    const trait_generics = this.tcx.generics_of(trait_def_id) as Generics;
    const other_trait_generics = this.tcx.generics_of(other_trait_def_id) as Generics;

    if (trait_generics.count() !== other_trait_generics.count()) {
      return false;
    }
    const n = Math.min(trait_generics.own_params.length, other_trait_generics.own_params.length);
    for (let i = 0; i < n; i++) {
      const a = trait_generics.own_params[i]!;
      const b = other_trait_generics.own_params[i]!;
      const same =
        (a.kind.$ === "Lifetime" && b.kind.$ === "Lifetime") ||
        (a.kind.$ === "Type" && b.kind.$ === "Type") ||
        (a.kind.$ === "Const" && b.kind.$ === "Const");
      if (!same) return false;
    }
    return true;
  };
  const trait_name = this.tcx.item_name(trait_def_id);
  let other_trait_def_id: DefId | undefined;
  for (const def_id of this.tcx.all_traits_including_private()) {
    if (
      !DefId_eq(trait_def_id, def_id) &&
      trait_name === this.tcx.item_name(def_id) &&
      trait_has_same_params(def_id) &&
      // `PointeeSized` is removed during lowering.
      !this.tcx.is_lang_item(def_id, LangItem.PointeeSized) &&
      this.predicate_must_hold_modulo_regions(
        Obligation.new(
          this.tcx,
          clone_ObligationCause(obligation.cause),
          obligation.param_env,
          Binder.map_bound(trait_pred, (tr): TraitClause => ({ trait_ref: TraitRef.new(as_interner(this.tcx), def_id, tr.trait_ref.args), polarity: tr.polarity })),
          Predicate_upcast_from_PolyTraitClause_,
        ),
      )
    ) {
      other_trait_def_id = def_id;
      break;
    }
  }
  if (other_trait_def_id !== undefined) {
    err.note(
      `\`${display_PolyTy(PolyTraitClauseV.self_ty(trait_pred))}\` implements similarly named trait \`${this.tcx.def_path_str(other_trait_def_id)}\`, but not \`${display_Poly_TraitClausePrintModifiersAndPath(PolyTraitClause_print_modifiers_and_trait_path(trait_pred))}\``,
    );
    suggested = true;
  }
  return suggested;
};

/// If the `Self` type of the unsatisfied trait `trait_ref` implements a trait
/// with the same path as `trait_ref`, a help message about a multiple different
/// versions of the same crate is added to `err`. Otherwise if it implements another
/// trait with the same name, a note message about a similarly named trait is added to `err`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2980 note_different_trait_with_same_name
TypeErrCtxt.prototype.note_different_trait_with_same_name = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  trait_pred: PolyTraitClauseT,
): boolean {
  if (this.check_same_trait_different_version(err, trait_pred)) {
    return true;
  }
  return this.check_same_name_different_path(err, obligation, trait_pred);
};

/// Add a `::` prefix when comparing paths so that paths with just one item
/// like "Foo" does not equal the end of "OtherFoo".
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:2994 comparable_path
TypeErrCtxt.prototype.comparable_path = function (this: TypeErrCtxt, did: DefId): string {
  return `::${this.tcx.def_path_str(did)}`;
};

/// Creates a `PredicateObligation` with `new_self_ty` replacing the existing type in the
/// `trait_ref`.
///
/// For this to work, `new_self_ty` must have no escaping bound variables.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3002 mk_trait_obligation_with_new_self_ty
TypeErrCtxt.prototype.mk_trait_obligation_with_new_self_ty = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  trait_ref_and_ty: Binder<[TraitClause, Ty]>,
): PredicateObligation {
  const trait_pred = Binder.map_bound(trait_ref_and_ty, ([tr, new_self_ty]) => TraitClause.with_replaced_self_ty(tr, as_interner(this.tcx), new_self_ty));

  return Obligation.new(this.tcx, ObligationCause.dummy(), param_env, trait_pred, Predicate_upcast_from_PolyTraitClause_);
};

// PORT: `struct ParamToVarFolder` (local to `predicate_can_apply`, fulfillment_errors.rs:3020), at module level.
class ParamToVarFolder implements TypeFolder {
  constructor(
    public infcx: InferCtxt,
    public var_map: Map<Ty, Ty>,
  ) {}

  // impl<'a, 'tcx> TypeFolder<TyCtxt<'tcx>> for ParamToVarFolder<'a, 'tcx>
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3026 cx
  cx(): TyCtxt {
    return this.infcx.tcx;
  }

  // FIXME: why don't we also instantiate const and region params with infer vars
  // here? Because diagnostics isn't soundness critical and no one bothers to be
  // pedantic yet.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3033 fold_ty
  fold_ty(ty: Ty): Ty {
    const k = ty.kind();
    if (k.$ === "Param") {
      const infcx = this.infcx;
      let v = this.var_map.get(ty);
      if (v === undefined) {
        v = infcx.next_ty_var(DUMMY_SP);
        this.var_map.set(ty, v);
      }
      return v;
    }
    // FIXME(#155345): This should automatically
    // handled by type folders instead of needing to do it
    // manually here.
    else if (k.$ === "Alias" && k._0 === IsRigid.Yes && TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_TY_PARAM, fold_Ty)) {
      const alias = fold_with_Alias(k._1, this, fold_with_AliasTyKind);
      return Ty.new_alias(this.cx(), IsRigid.No, alias);
    } else {
      return fold_Ty.super_fold_with(ty, this);
    }
  }

  // (provided) the `TypeFolder` methods `ParamToVarFolder` does not override.
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

/// Returns `true` if the trait predicate may apply for *some* assignment
/// to the type parameters.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3015 predicate_can_apply
TypeErrCtxt.prototype.predicate_can_apply = function <T>(
  this: TypeErrCtxt,
  param_env: ParamEnv,
  pred: T,
  upcast_from_T: (from: T, tcx: Interner) => Predicate,
  d_T: TypeFoldable<T>,
): boolean {
  // struct ParamToVarFolder / impl TypeFolder for ParamToVarFolder: see `ParamToVarFolder` above.

  return this.probe((_) => {
    const cleaned_pred_ = d_T.fold_with(pred, new ParamToVarFolder(this.infcx, new Map()));

    const { value: cleaned_pred } = this.infcx.at(ObligationCause.dummy(), param_env).normalize(Unnormalized.new_wip(cleaned_pred_), d_T);

    const obligation = Obligation.new(this.tcx, ObligationCause.dummy(), param_env, cleaned_pred, upcast_from_T);

    return this.predicate_may_hold(obligation);
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3070 suggest_change_mut_ref_for_closure
TypeErrCtxt.prototype.suggest_change_mut_ref_for_closure = function (this: TypeErrCtxt, err: Diag, obligation_: PredicateObligation): void {
  const code = obligation_.cause.code_();
  if (code.$ !== "FunctionArg") return;
  const [, root_trait_pred] = ObligationCauseCode.peel_derives_with_predicate(obligation_.cause.code_());
  if (root_trait_pred === undefined) return;
  const arg = this.tcx.hir_node(code.arg_hir_id);
  if (arg.$ !== "Expr") return;
  if (arg._0.kind.$ === "AddrOf" && arg._0.kind._0 === "Ref" && arg._0.kind._1 === "Not") {
    const obligation = clone_Obligation(obligation_, (p) => p);
    // Error reporting may narrow the cause span to the borrow's operand.
    // Use the whole argument so `suggest_change_mut` can replace the shared borrow.
    obligation.cause.span = arg._0.span;
    this.suggest_change_mut(obligation, err, root_trait_pred);
  }
};

/// Register when multiple obligations come from the same statement and only emit one.
///
/// This can significantly reduce the number of `_: Sized` failures on method chains.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3092 silence_redundant_cause
TypeErrCtxt.prototype.silence_redundant_cause = function (
  this: TypeErrCtxt,
  err: Diag,
  obligation: PredicateObligation,
  root_obligation: PredicateObligation,
): void {
  const code = root_obligation.cause.code_();
  let hir_id: HirId;
  if (code.$ === "WellFormed" && code._0.$ === "HirId") {
    hir_id = code._0._0;
  } else if (code.$ === "VariableType" || code.$ === "SizedCallReturnType") {
    hir_id = code._0;
  } else if (code.$ === "WhereClauseInExpr") {
    hir_id = code._2;
  } else if (code.$ === "WellFormed" && code._0.$ === "Param") {
    hir_id = this.tcx.local_def_id_to_hir_id(code._0.function);
  } else {
    return;
  }

  // The lifetimes for different sub-expressions would be different inference variables.
  const pred = this.tcx.erase_and_anonymize_regions(obligation.predicate, fold_Predicate);

  // Registering the expression itself is necessary to catch tail expressions and literals.
  const preds = this.reported_hir_errors.get(hir_id);
  if (preds !== undefined && preds.has(pred)) {
    err.downgrade_to_delayed_bug();
  } else {
    hir_id_map_entry_or_default(this.reported_hir_errors, hir_id).add(pred);
  }

  // Look for the expression's parent statement, bail otherwise. We'll register the predicate
  // against the statement's HirId.
  for (const [_, node] of this.tcx.hir_parent_iter(hir_id)) {
    let hir_id: HirId;
    switch (node.$) {
      case "LetStmt":
        hir_id = node._0.hir_id;
        break;
      case "Stmt":
        hir_id = node._0.hir_id;
        break;
      case "Crate":
      case "Item":
      case "ImplItem":
      case "TraitItem":
        return;
      default:
        continue;
    }
    const preds = this.reported_hir_errors.get(hir_id);
    if (preds !== undefined && preds.has(pred)) {
      err.downgrade_to_delayed_bug();
    } else {
      hir_id_map_entry_or_default(this.reported_hir_errors, hir_id).add(pred);
    }
    break;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3144 note_obligation_cause
TypeErrCtxt.prototype.note_obligation_cause = function (this: TypeErrCtxt, err: Diag, obligation: PredicateObligation): void {
  // First, attempt to add note to this error with an async-await-specific
  // message, and fall back to regular note otherwise.
  if (!this.maybe_note_obligation_cause_for_async_await(err, obligation)) {
    this.note_obligation_cause_code(
      obligation.cause.body_def_id,
      err,
      obligation.predicate,
      obligation.param_env,
      obligation.cause.code_(),
      [],
      new DefIdSet(),
      upcast_from_self,
    );
    this.suggest_swapping_lhs_and_rhs(err, obligation.predicate, obligation.param_env, obligation.cause.code_(), upcast_from_self);
    this.suggest_borrow_for_unsized_closure_return(obligation.cause.body_def_id, err, obligation.predicate);
    this.suggest_unsized_bound_if_applicable(err, obligation);
    const span = err.deref().span.primary_span();
    if (span !== undefined && this.tcx.resolutions(null).paths_matching_assoc_types.has(Span.with_parent(span, undefined))) {
      err.subdiagnostic(lazy_diagnostics().AssocTypeWithSameName_subdiagnostic({ span: Span.shrink_to_lo(span) }));
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3185 is_recursive_obligation
TypeErrCtxt.prototype.is_recursive_obligation = function (this: TypeErrCtxt, obligated_types: Ty[], cause_code: ObligationCauseCode): boolean {
  if (cause_code.$ === "BuiltinDerived") {
    const data = cause_code._0;
    const parent_trait_ref = this.deeply_resolve_ignoring_regions(data.parent_trait_pred, d_PolyTraitClause);
    const self_ty = TraitClause.self_ty(Binder.skip_binder(parent_trait_ref));
    if (obligated_types.some((ot) => ot === self_ty)) {
      return true;
    }
    const sk = self_ty.kind();
    if (sk.$ === "Adt" && sk._1.length === 1) {
      const arg = GenericArg.kind(sk._1[0]!);
      if (arg.$ === "Type") {
        const ik = arg._0.kind();
        if (ik.$ === "Adt" && ik._0 === sk._0) {
          return true;
        }
      }
    }
  }
  return false;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3208 get_standard_error_message
TypeErrCtxt.prototype.get_standard_error_message = function (
  this: TypeErrCtxt,
  trait_predicate: PolyTraitClauseT,
  predicate_constness: BoundConstness | undefined,
  post_message: string,
  long_ty_path: MutRef<PathBuf | undefined>,
): string {
  return `the trait bound \`${this.tcx.short_string(
    PolyTraitClause_print_with_bound_constness(trait_predicate, predicate_constness),
    long_ty_path,
    print_Poly_TraitClausePrintWithBoundConstness,
  )}\` is not satisfied${post_message}`;
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3224 select_transmute_obligation_for_reporting
TypeErrCtxt.prototype.select_transmute_obligation_for_reporting = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
  root_obligation: PredicateObligation,
): [PredicateObligation, PolyTraitClauseT] {
  if (TypeVisitableExt.has_non_region_param(obligation.predicate, fold_Predicate) || TypeVisitableExt.has_non_region_infer(obligation, d_PredicateObligation())) {
    return [clone_Obligation(obligation, (p) => p), trait_predicate];
  }

  const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
  const normalized_predicate = this.tcx.erase_and_anonymize_regions(this.tcx.instantiate_bound_regions_with_erased(trait_predicate, d_TraitClause), d_TraitClause);
  const trait_ref = normalized_predicate.trait_ref;

  const assume_ct = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(trait_ref.args.const_at(2)), fold_Const);

  // PORT: rustc_transmute is not ported (no lane yet).
  void assume_ct;
  const assume = unported("rustc_transmute::Assume::from_const") as TransmuteAssume | undefined;
  if (assume === undefined) {
    return [clone_Obligation(obligation, (p) => p), trait_predicate];
  }

  // let is_normalized_yes = matches!(rustc_transmute::TransmuteTypeEnv::new(self.tcx).is_transmutable(
  //     trait_ref.args.type_at(1), trait_ref.args.type_at(0), assume), rustc_transmute::Answer::Yes);
  void [trait_ref.args.type_at(1), trait_ref.args.type_at(0)];
  const is_normalized_yes = (unported("rustc_transmute::TransmuteTypeEnv::is_transmutable") as TransmuteAnswer).$ === "Yes";

  // If the normalized check unexpectedly passes, fall back to root obligation for reporting.
  if (is_normalized_yes) {
    const rk = Binder.skip_binder(root_obligation.predicate.kind());
    if (rk.$ === "Clause" && rk._0.$ === "Trait") {
      const root_pred = rk._0._0;
      if (DefId_eq(TraitClause.def_id(root_pred), PolyTraitClauseV.def_id(trait_predicate))) {
        return [clone_Obligation(root_obligation, (p) => p), Binder.rebind(root_obligation.predicate.kind(), root_pred)];
      }
    }
  }

  return [clone_Obligation(obligation, (p) => p), trait_predicate];
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3271 get_safe_transmute_error_and_reason
TypeErrCtxt.prototype.get_safe_transmute_error_and_reason = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  trait_pred_: PolyTraitClauseT,
  span: Span,
): GetSafeTransmuteErrorAndReason {
  // use rustc_transmute::Answer;
  return this.probe((_): GetSafeTransmuteErrorAndReason => {
    // We don't assemble a transmutability candidate for types that are generic
    // and we should have ambiguity for types that still have non-region infer.
    if (TypeVisitableExt.has_non_region_param(obligation.predicate, fold_Predicate) || TypeVisitableExt.has_non_region_infer(obligation, d_PredicateObligation())) {
      return GetSafeTransmuteErrorAndReason.Default;
    }

    // Erase regions because layout code doesn't particularly care about regions.
    const trait_pred = this.tcx.erase_and_anonymize_regions(this.tcx.instantiate_bound_regions_with_erased(trait_pred_, d_TraitClause), d_TraitClause);

    const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
    const assume_ct = ocx.normalize(obligation.cause, obligation.param_env, Unnormalized.new_wip(trait_pred.trait_ref.args.const_at(2)), fold_Const);

    // PORT: rustc_transmute is not ported (no lane yet).
    void assume_ct;
    const assume = unported("rustc_transmute::Assume::from_const") as TransmuteAssume | undefined;
    if (assume === undefined) {
      this.dcx().span_delayed_bug(span, "Unable to construct rustc_transmute::Assume where it was previously possible");
      return GetSafeTransmuteErrorAndReason.Silent;
    }

    const dst = trait_pred.trait_ref.args.type_at(0);
    const src = trait_pred.trait_ref.args.type_at(1);
    const err_msg = `\`${display_Ty(src)}\` cannot be safely transmuted into \`${display_Ty(dst)}\``;

    const answer = unported("rustc_transmute::TransmuteTypeEnv::is_transmutable") as TransmuteAnswer;
    switch (answer.$) {
      case "No": {
        const reason = answer._0;
        let safe_transmute_explanation: string;
        switch (reason.$) {
          case "SrcIsNotYetSupported":
            safe_transmute_explanation = `analyzing the transmutability of \`${display_Ty(src)}\` is not yet supported`;
            break;
          case "DstIsNotYetSupported":
            safe_transmute_explanation = `analyzing the transmutability of \`${display_Ty(dst)}\` is not yet supported`;
            break;
          case "DstIsBitIncompatible":
            safe_transmute_explanation = `at least one value of \`${display_Ty(src)}\` isn't a bit-valid value of \`${display_Ty(dst)}\``;
            break;
          case "DstUninhabited":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` is uninhabited`;
            break;
          case "DstMayHaveSafetyInvariants":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` may carry safety invariants`;
            break;
          case "DstIsTooBig":
            safe_transmute_explanation = `the size of \`${display_Ty(src)}\` is smaller than the size of \`${display_Ty(dst)}\``;
            break;
          case "DstRefIsTooBig": {
            const { src, src_size, dst, dst_size } = reason;
            safe_transmute_explanation = `the size of \`${display_Ty(src)}\` (${src_size} bytes) is smaller than that of \`${display_Ty(dst)}\` (${dst_size} bytes)`;
            break;
          }
          case "SrcSizeOverflow":
            safe_transmute_explanation = `values of the type \`${display_Ty(src)}\` are too big for the target architecture`;
            break;
          case "DstSizeOverflow":
            safe_transmute_explanation = `values of the type \`${display_Ty(dst)}\` are too big for the target architecture`;
            break;
          case "DstHasStricterAlignment": {
            const { src_min_align, dst_min_align } = reason;
            safe_transmute_explanation = `the minimum alignment of \`${display_Ty(src)}\` (${src_min_align}) should be greater than that of \`${display_Ty(dst)}\` (${dst_min_align})`;
            break;
          }
          case "DstIsMoreUnique":
            safe_transmute_explanation = `\`${display_Ty(src)}\` is a shared reference, but \`${display_Ty(dst)}\` is a unique reference`;
            break;
          // Already reported by rustc
          case "TypeError":
            return GetSafeTransmuteErrorAndReason.Silent;
          case "SrcLayoutUnknown":
            safe_transmute_explanation = `\`${display_Ty(src)}\` has an unknown layout`;
            break;
          case "DstLayoutUnknown":
            safe_transmute_explanation = `\`${display_Ty(dst)}\` has an unknown layout`;
            break;
        }
        return { $: "Error", err_msg, safe_transmute_explanation };
      }
      // Should never get a Yes at this point! We already ran it before, and did not get a Yes.
      case "Yes":
        return span_bug(span, "Inconsistent rustc_transmute::is_transmutable(...) result, got Yes");
      // Reached when a different obligation (namely `Freeze`) causes the
      // transmutability analysis to fail. In this case, silence the
      // transmutability error message in favor of that more specific
      // error.
      case "If":
        return { $: "Error", err_msg, safe_transmute_explanation: undefined };
    }
  });
};

/// If `found_ty` is a reference that can be explicitly cast to another reference type for which
/// a `From` / `TryFrom` impl exists for `self_ty`, return that type.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3404 find_explicit_cast_type
TypeErrCtxt.prototype.find_explicit_cast_type = function (this: TypeErrCtxt, param_env: ParamEnv, found_ty: Ty, self_ty: Ty): Ty | undefined {
  const fk = found_ty.kind();
  if (fk.$ !== "Ref") {
    return undefined;
  }
  const [region, inner_ty, mutbl] = [fk._0, fk._1, fk._2];

  const derefs = this.autoderef_steps(inner_ty)[globalThis.Symbol.iterator]();
  derefs.next(); // skip the first one, which is inner_ty itself
  const next = derefs.next();
  if (next.done) return undefined;
  const deref_target = next.value[0];

  const cast_ty = Ty.new_ref(this.tcx, region, deref_target, mutbl);

  const from_def_id = this.tcx.get_diagnostic_item(sym.From);
  if (from_def_id === undefined) {
    return undefined;
  }
  const try_from_def_id = this.tcx.get_diagnostic_item(sym.TryFrom);
  if (try_from_def_id === undefined) {
    return undefined;
  }

  if (this.has_impl_for_type(param_env, TraitRef.new(as_interner(this.tcx), from_def_id, this.tcx.mk_args([self_ty, cast_ty])))) {
    return cast_ty;
  } else if (this.has_impl_for_type(param_env, TraitRef.new(as_interner(this.tcx), try_from_def_id, this.tcx.mk_args([self_ty, cast_ty])))) {
    return cast_ty;
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3450 has_impl_for_type
TypeErrCtxt.prototype.has_impl_for_type = function (this: TypeErrCtxt, param_env: ParamEnv, trait_ref: TraitRef): boolean {
  const obligation = Obligation.new(this.tcx, ObligationCause.dummy(), param_env, { trait_ref, polarity: "Positive" } satisfies TraitClause, Predicate_upcast_from_TraitClause_);

  return this.predicate_must_hold_modulo_regions(obligation);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3465 add_tuple_trait_message
TypeErrCtxt.prototype.add_tuple_trait_message = function (this: TypeErrCtxt, obligation_cause_code: ObligationCauseCode, err: Diag): void {
  if (obligation_cause_code.$ === "RustCall") {
    err.primary_message('functions with the "rust-call" ABI must take a single non-self tuple argument');
  } else if (obligation_cause_code.$ === "WhereClause" && this.tcx.is_fn_trait(obligation_cause_code._0)) {
    err.code(E0059);
    err.primary_message(`type parameter to bare \`${this.tcx.def_path_str(obligation_cause_code._0)}\` trait must be a tuple`);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3485 try_to_add_help_message
TypeErrCtxt.prototype.try_to_add_help_message = function (
  this: TypeErrCtxt,
  root_obligation: PredicateObligation,
  obligation: PredicateObligation,
  trait_predicate: PolyTraitClauseT,
  err: Diag,
  span_: Span,
  is_fn_trait: boolean,
  suggested: boolean,
): void {
  const body_def_id = obligation.cause.body_def_id;
  const code = obligation.cause.code_();
  const span = code.$ === "BinOp" ? code.rhs_span : span_;

  // Try to report a help message
  const trait_def_id = PolyTraitClauseV.def_id(trait_predicate);
  let fn_trait: Result<[ClosureKind, Binder<Ty>], undefined> | undefined;
  if (
    is_fn_trait &&
    (fn_trait = this.type_implements_fn_trait(obligation.param_env, PolyTraitClauseV.self_ty(trait_predicate), Binder.skip_binder(trait_predicate).polarity))
      .$ === "Ok"
  ) {
    const [implemented_kind, params] = fn_trait._0;
    this.add_help_message_for_fn_trait(trait_predicate, err, implemented_kind, params);
  } else if (
    !TypeVisitableExt.has_non_region_infer(trait_predicate, d_PolyTraitClause) &&
    this.predicate_can_apply(obligation.param_env, trait_predicate, Predicate_upcast_from_PolyTraitClause_, d_PolyTraitClause)
  ) {
    // If a where-clause may be useful, remind the
    // user that they can add it.
    //
    // don't display an on-unimplemented note, as
    // these notes will often be of the form
    //     "the type `T` can't be frobnicated"
    // which is somewhat confusing.
    this.suggest_restricting_param_bound(err, trait_predicate, undefined, obligation.cause.body_def_id);
  } else if (
    trait_def_id.is_local() &&
    TraitImpls.is_empty(this.tcx.trait_impls_of(trait_def_id) as TraitImpls) &&
    !this.tcx.trait_is_auto(trait_def_id) &&
    !this.tcx.trait_is_alias(trait_def_id) &&
    PolyTraitClauseV.polarity(trait_predicate) === "Positive"
  ) {
    err.span_help(this.tcx.def_span(trait_def_id), msg("this trait has no implementations, consider adding one"));
  } else if (!suggested && PolyTraitClauseV.polarity(trait_predicate) === "Positive") {
    // Can't show anything else useful, try to find similar impls.
    const impl_candidates = this.find_similar_impl_candidates(PolyTraitClauseV.def_id(trait_predicate), Binder.skip_binder(PolyTraitClauseV.self_ty(trait_predicate)));
    if (!this.report_similar_impl_candidates(impl_candidates, obligation, trait_predicate, body_def_id, err, true, obligation.param_env)) {
      this.report_similar_impl_candidates_for_root_obligation(obligation, trait_predicate, body_def_id, err);
    }

    this.suggest_convert_to_slice(err, obligation, trait_predicate, impl_candidates, span);

    this.suggest_tuple_wrapping(err, root_obligation, obligation);
  }
  this.suggest_shadowed_inherent_method(err, obligation, trait_predicate);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3574 add_help_message_for_fn_trait
TypeErrCtxt.prototype.add_help_message_for_fn_trait = function (
  this: TypeErrCtxt,
  trait_pred: PolyTraitClauseT,
  err: Diag,
  implemented_kind: ClosureKind,
  params: Binder<Ty>,
): void {
  // If the type implements `Fn`, `FnMut`, or `FnOnce`, suppress the following
  // suggestion to add trait bounds for the type, since we only typically implement
  // these traits once.

  // Note if the `FnMut` or `FnOnce` is less general than the trait we're trying
  // to implement.
  const selected_kind = unwrap(this.tcx.fn_trait_kind_from_def_id(PolyTraitClauseV.def_id(trait_pred)), "expected to map DefId to ClosureKind");
  if (!ClosureKind.extends(implemented_kind, selected_kind)) {
    err.note(
      `\`${display_Ty(TraitClause.self_ty(Binder.skip_binder(trait_pred)))}\` implements \`${display_ClosureKind(implemented_kind)}\`, but it must implement \`${display_ClosureKind(selected_kind)}\`, which is more general`,
    );
  }

  // Note any argument mismatches
  const gk = Binder.skip_binder(params).kind();
  if (gk.$ !== "Tuple") {
    return;
  }
  const given = gk._0;

  const expected_ty_ = Binder.skip_binder(trait_pred).trait_ref.args.type_at(1);
  const ek = expected_ty_.kind();
  if (ek.$ !== "Tuple") {
    return;
  }
  const expected = ek._0;

  if (expected.length !== given.length) {
    // Note number of types that were expected and given
    err.note(
      `expected a closure taking ${given.length} argument${pluralize(given.length)}, but one taking ${expected.length} argument${pluralize(expected.length)} was given`,
    );
    return;
  }

  const given_ty = Ty.new_fn_ptr(this.tcx, Binder.rebind(params, this.tcx.mk_fn_sig_safe_rust_abi(given, this.tcx.types.unit)));
  const expected_ty = Ty.new_fn_ptr(this.tcx, Binder.rebind(trait_pred, this.tcx.mk_fn_sig_safe_rust_abi(expected, this.tcx.types.unit)));

  if (!this.same_type_modulo_infer(given_ty, expected_ty, ToTrace_Ty)) {
    // Print type mismatch
    const [expected_args, given_args] = this.cmp(expected_ty, given_ty);
    err.note_expected_found("a closure with signature", expected_args, "a closure with signature", given_args);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3643 report_closure_error
TypeErrCtxt.prototype.report_closure_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  closure_def_id: DefId,
  found_kind: ClosureKind,
  kind: ClosureKind,
  trait_prefix: string,
  kind_origin: [Span, Place] | undefined,
): Diag {
  const closure_span = this.tcx.def_span(closure_def_id);

  const err: ClosureKindMismatch = {
    closure_span,
    expected: kind,
    found: found_kind,
    cause_span: obligation.cause.span,
    trait_prefix,
    fn_once_label: undefined,
    fn_mut_label: undefined,
  };

  // Additional context information explaining why the closure only implements
  // a particular trait.
  const origin =
    kind_origin ??
    ((): [Span, Place] | undefined => {
      const typeck_results = this.typeck_results;
      if (typeck_results === undefined) return undefined;
      const local_def_id = closure_def_id.as_local();
      if (local_def_id === undefined) return undefined;
      const hir_id = this.tcx.local_def_id_to_hir_id(local_def_id);
      return typeck_results.closure_kind_origins().get(hir_id);
    })();

  if (found_kind === "FnOnce" && origin !== undefined) {
    const [span, place] = origin;
    err.fn_once_label = {
      span,
      place: place_to_string_for_capture(this.tcx, place),
      trait_prefix,
    };
  } else if (found_kind === "FnMut" && origin !== undefined) {
    const [span, place] = origin;
    err.fn_mut_label = {
      span,
      place: place_to_string_for_capture(this.tcx, place),
      trait_prefix,
    };
  }
  return this.dcx().create_err(lazy_diagnostics().ClosureKindMismatch_diagnostic(err));
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3693 report_cyclic_signature_error
TypeErrCtxt.prototype.report_cyclic_signature_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  found_trait_ref: TraitRef,
  expected_trait_ref: TraitRef,
  terr_: TypeError,
): Diag {
  const self_ty = TraitRef.self_ty(found_trait_ref);
  const sk = self_ty.kind();
  let cause: ObligationCause;
  let terr: TypeError;
  if (sk.$ === "Closure") {
    [cause, terr] = [ObligationCause.dummy_with_span(this.tcx.def_span(sk._0)), { $: "CyclicTy", _0: self_ty }];
  } else {
    [cause, terr] = [clone_ObligationCause(obligation.cause), terr_];
  }
  return this.report_and_explain_type_error(TypeTrace.trait_refs(cause, expected_trait_ref, found_trait_ref), obligation.param_env, terr);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3716 report_signature_mismatch_error
TypeErrCtxt.prototype.report_signature_mismatch_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  span: Span,
  found_trait_ref_: TraitRef,
  expected_trait_ref_: TraitRef,
): Result<Diag, ErrorGuaranteed> {
  const found_trait_ref = this.deeply_resolve_ignoring_regions(found_trait_ref_, d_TraitRef);
  const expected_trait_ref = this.deeply_resolve_ignoring_regions(expected_trait_ref_, d_TraitRef);

  const reported = TypeVisitableExt.error_reported(TraitRef.self_ty(expected_trait_ref), fold_Ty);
  if (reported.$ === "Err") return reported;
  const found_trait_ty = TraitRef.self_ty(found_trait_ref);

  const fk = found_trait_ty.kind();
  const found_did = fk.$ === "Closure" || fk.$ === "FnDef" || fk.$ === "Coroutine" ? fk._0 : undefined;

  const found_node = found_did !== undefined ? this.tcx.hir_get_if_local(found_did) : undefined;
  const found_span = found_did !== undefined ? this.tcx.hir_span_if_local(found_did) : undefined;

  if (!keyed_set_insert(this.reported_signature_mismatch, [span, found_span])) {
    // We check closures twice, with obligations flowing in different directions,
    // but we want to complain about them only once.
    return Err(this.dcx().span_delayed_bug(span, "already_reported"));
  }

  let not_tupled = false;

  const ArgKind = lazy_traits_mod().ArgKind;
  let found: ArgKindT[];
  const found_k = found_trait_ref.args.type_at(1).kind();
  if (found_k.$ === "Tuple") {
    found = Array.from({ length: found_k._0.length }, () => ArgKind.empty());
  } else {
    not_tupled = true;
    found = [ArgKind.empty()];
  }

  const expected_ty = expected_trait_ref.args.type_at(1);
  let expected: ArgKindT[];
  const expected_k = expected_ty.kind();
  if (expected_k.$ === "Tuple") {
    expected = expected_k._0.map((t) => ArgKind.from_expected_ty(t, span));
  } else {
    not_tupled = true;
    expected = [{ $: "Arg", _0: "_", _1: display_Ty(expected_ty) }];
  }

  // If this is a `Fn` family trait and either the expected or found
  // is not tupled, then fall back to just a regular mismatch error.
  // This shouldn't be common unless manually implementing one of the
  // traits manually, but don't make it more confusing when it does
  // happen.
  if (!this.tcx.is_lang_item(expected_trait_ref.def_id, LangItem.Coroutine) && not_tupled) {
    return Ok(
      this.report_and_explain_type_error(TypeTrace.trait_refs(obligation.cause, expected_trait_ref, found_trait_ref), obligation.param_env, {
        $: "Mismatch",
      }),
    );
  }
  if (found.length !== expected.length) {
    const r = ((): [Span | undefined, Span | undefined, ArgKindT[]] | undefined => {
      if (found_did === undefined) return undefined;
      const node = this.tcx.hir_get_if_local(found_did);
      if (node === undefined) return undefined;
      const args = this.get_fn_like_arguments(node);
      if (args === undefined) return undefined;
      const [found_span, closure_arg_span, found] = args;
      return [found_span, closure_arg_span, found];
    })();
    const [closure_span, closure_arg_span, found_] = r ?? [found_span, undefined, found];

    // If the coroutine take a single () as its argument,
    // the trait argument would found the coroutine take 0 arguments,
    // but get_fn_like_arguments would give 1 argument.
    // This would result in "Expected to take 1 argument, but it takes 1 argument".
    // Check again to avoid this.
    if (found_.length !== expected.length) {
      return Ok(this.report_arg_count_mismatch(span, closure_span, expected, found_, found_trait_ty.is_closure(), closure_arg_span));
    }
  }
  return Ok(
    this.report_closure_arg_mismatch(span, found_span, found_trait_ref, expected_trait_ref, obligation.cause.code_(), found_node, obligation.param_env),
  );
};

/// Given some node representing a fn-like thing in the HIR map,
/// returns a span and `ArgKind` information that describes the
/// arguments it expects. This can be supplied to
/// `report_arg_count_mismatch`.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3816 get_fn_like_arguments
TypeErrCtxt.prototype.get_fn_like_arguments = function (this: TypeErrCtxt, node: hir.Node): [Span, Span | undefined, ArgKindT[]] | undefined {
  const ArgKind = lazy_traits_mod().ArgKind;
  const sm = this.tcx.sess.source_map();
  if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const { body, fn_decl_span, fn_arg_span } = node._0.kind._0;
    const args: ArgKindT[] = [];
    for (const arg of this.tcx.hir_body(body).params) {
      const pat = arg.pat;
      let kind: ArgKindT | undefined;
      if (pat.kind.$ === "Tuple") {
        const span = pat.span;
        const fields: [string, string][] = [];
        let all = true;
        for (const p of pat.kind._0) {
          const snippet = sm.span_to_snippet(p.span);
          if (snippet.$ !== "Ok") {
            all = false;
            break;
          }
          fields.push([snippet._0.toString(), "_"]);
        }
        kind = all ? { $: "Tuple", _0: span, _1: fields } : undefined;
      } else {
        const name = sm.span_to_snippet(pat.span);
        kind = name.$ === "Ok" ? { $: "Arg", _0: name._0.toString(), _1: "_" } : undefined;
      }
      if (kind === undefined) return undefined;
      args.push(kind);
    }
    return [fn_decl_span, fn_arg_span, args];
  }
  let sig: hir.FnSig | undefined;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    sig = node._0.kind.sig;
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
    sig = node._0.kind._0;
  }
  if (sig !== undefined) {
    return [
      sig.span,
      undefined,
      sig.decl.inputs.map((arg): ArgKindT => {
        if (arg.kind.$ === "Tup") {
          return { $: "Tuple", _0: arg.span, _1: Array.from({ length: arg.kind._0.length }, (): [string, string] => ["_", "_"]) };
        } else {
          return ArgKind.empty();
        }
      }),
    ];
  }
  if (node.$ === "Ctor") {
    const variant_data = node._0;
    const id = hir.VariantData.ctor_hir_id(variant_data);
    const span = id === undefined ? DUMMY_SP : this.tcx.hir_span(id);
    return [span, undefined, Array.from({ length: hir.VariantData.fields(variant_data).length }, () => ArgKind.empty())];
  }
  return panic(`non-FnLike node found: ${debug_Node(node, PLAIN)}`);
};

/// Reports an error when the number of arguments needed by a
/// trait match doesn't match the number that the expression
/// provides.
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:3886 report_arg_count_mismatch
TypeErrCtxt.prototype.report_arg_count_mismatch = function (
  this: TypeErrCtxt,
  span: Span,
  found_span: Span | undefined,
  expected_args: ArgKindT[],
  found_args: ArgKindT[],
  is_closure: boolean,
  closure_arg_span: Span | undefined,
): Diag {
  const kind = is_closure ? "closure" : "function";

  const args_str = (arguments_: readonly ArgKindT[], other: readonly ArgKindT[]): string => {
    const arg_length = arguments_.length;
    const distinct = other.length === 1 && other[0]!.$ === "Tuple";
    const first = arguments_[0];
    if (arg_length === 1 && first !== undefined && first.$ === "Tuple") {
      return `a single ${first._1.length}-tuple as argument`;
    } else {
      return `${arg_length} ${distinct && arg_length > 1 ? "distinct " : ""}argument${pluralize(arg_length)}`;
    }
  };

  const expected_str = args_str(expected_args, found_args);
  const found_str = args_str(found_args, expected_args);

  const err = struct_span_code_err(this.dcx(), span, E0593, `${kind} is expected to take ${expected_str}, but it takes ${found_str}`);

  err.span_label(span, `expected ${kind} that takes ${expected_str}`);

  if (found_span !== undefined) {
    err.span_label(found_span, `takes ${found_str}`);

    // Suggest to take and ignore the arguments with expected_args_length `_`s if
    // found arguments is empty (assume the user just wants to ignore args in this case).
    // For example, if `expected_args_length` is 2, suggest `|_, _|`.
    if (found_args.length === 0 && is_closure) {
      const underscores = Array.from({ length: expected_args.length }, () => "_").join(", ");
      err.span_suggestion_verbose(
        closure_arg_span ?? found_span,
        `consider changing the closure to take and ignore the expected argument${pluralize(expected_args.length)}`,
        `|${underscores}|`,
        "MachineApplicable",
      );
    }

    if (found_args.length === 1 && found_args[0]!.$ === "Tuple") {
      const fields = found_args[0]!._1;
      if (fields.length === expected_args.length) {
        const sugg = fields.map(([name, _]) => name).join(", ");
        err.span_suggestion_verbose(found_span, "change the closure to take multiple arguments instead of a single tuple", `|${sugg}|`, "MachineApplicable");
      }
    }
    if (expected_args.length === 1 && expected_args[0]!.$ === "Tuple" && expected_args[0]!._1.length === found_args.length && is_closure) {
      const fields = expected_args[0]!._1;
      const sugg = `|(${found_args
        .map((arg) => {
          switch (arg.$) {
            case "Arg":
              return arg._0;
            default:
              return "_";
          }
        })
        .join(", ")})${
        // add type annotations if available
        found_args.some((arg) => {
          switch (arg.$) {
            case "Arg":
              return arg._1 !== "_";
            default:
              return false;
          }
        })
          ? `: (${fields.map(([_, ty]) => ty).join(", ")})`
          : ""
      }|`;
      err.span_suggestion_verbose(found_span, "change the closure to accept a tuple instead of individual arguments", sugg, "MachineApplicable");
    }
  }

  return err;
};

/// Checks if the type implements one of `Fn`, `FnMut`, or `FnOnce`
/// in that order, and returns the generic type corresponding to the
/// argument of that trait (corresponding to the closure arguments).
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:4008 type_implements_fn_trait
TypeErrCtxt.prototype.type_implements_fn_trait = function (
  this: TypeErrCtxt,
  param_env: ParamEnv,
  ty: Binder<Ty>,
  polarity: ClausePolarity,
): Result<[ClosureKind, Binder<Ty>], undefined> {
  return this.commit_if_ok((_): Result<[ClosureKind, Binder<Ty>], undefined> => {
    for (const trait_def_id_ of [this.tcx.lang_items().fn_trait(), this.tcx.lang_items().fn_mut_trait(), this.tcx.lang_items().fn_once_trait()]) {
      if (trait_def_id_ === undefined) continue;
      const trait_def_id = trait_def_id_;
      // Make a fresh inference variable so we can determine what the generic parameters
      // of the trait are.
      const var_ = this.next_ty_var(DUMMY_SP);
      // FIXME(const_trait_impl)
      const trait_ref = TraitRef.new(as_interner(this.tcx), trait_def_id, [Binder.skip_binder(ty), var_]);
      const obligation = Obligation.new(
        this.tcx,
        ObligationCause.dummy(),
        param_env,
        Binder.rebind(ty, { trait_ref, polarity } satisfies TraitClause),
        Predicate_upcast_from_PolyTraitClause_,
      );
      const ocx = lazy_engine().ObligationCtxt.new(this.infcx);
      ocx.register_obligation(obligation);
      if (TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity())) {
        return Ok([
          unwrap(this.tcx.fn_trait_kind_from_def_id(trait_def_id), "expected to map DefId to ClosureKind"),
          Binder.rebind(ty, this.deeply_resolve_ignoring_regions(var_, fold_Ty)),
        ]);
      }
    }

    return Err(undefined);
  });
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/fulfillment_errors.rs:4048 report_not_const_evaluatable_error
TypeErrCtxt.prototype.report_not_const_evaluatable_error = function (
  this: TypeErrCtxt,
  obligation: PredicateObligation,
  span: Span,
): Result<Diag, ErrorGuaranteed> {
  if (!this.tcx.features().generic_const_exprs() && !this.tcx.features().gca()) {
    const guar = this.dcx()
      .struct_span_err(span, "constant expression depends on a generic parameter")
      // FIXME(const_generics): we should suggest to the user how they can resolve this
      // issue. However, this is currently not actually possible
      // (see https://github.com/rust-lang/rust/issues/66962#issuecomment-575907083).
      //
      // Note that with `feature(generic_const_exprs)` this case should not
      // be reachable.
      .with_note("this may fail depending on what value the parameter takes")
      .emit_err();
    return Err(guar);
  }

  const pk = Binder.skip_binder(obligation.predicate.kind());
  if (pk.$ === "Clause" && pk._0.$ === "ConstEvaluatable") {
    const ct = pk._0._0;
    const ck = ct.kind();
    switch (ck.$) {
      case "Alias": {
        const alias_const: AliasConst = ck._1;
        const err = this.dcx().struct_span_err(span, "unconstrained generic constant");

        const const_span = AliasConstKind.def_span(alias_const.kind, as_interner(this.tcx));
        const const_ty = Unnormalized.skip_norm_wip(AliasConstC.type_of(alias_const, this.tcx));

        const msg_ = "try adding a `where` bound";
        const snippet_ = this.tcx.sess.source_map().span_to_snippet(const_span);
        if (snippet_.$ === "Ok") {
          const snippet = snippet_._0.toString();
          let code: string;
          let local_body: hir.Body | undefined;
          const local_def_id = alias_const.kind.$ === "Anon" ? alias_const.kind.def_id.as_local() : undefined;
          if (const_ty === this.tcx.types.usize) {
            code = `[(); ${snippet}]:`;
          } else if (
            local_def_id !== undefined &&
            (local_body = this.tcx.hir_maybe_body_owned_by(local_def_id)) !== undefined &&
            expr_needs_parens(local_body.value)
          ) {
            code = `[(); (${snippet}) as usize]:`;
          } else {
            code = `[(); ${snippet} as usize]:`;
          }

          const cause_code = obligation.cause.code_();
          const suggestion_def_id = cause_code.$ === "CompareImplItem" ? cause_code.trait_item_def_id.as_local() : obligation.cause.body_def_id;

          let generics: hir.Generics | undefined;
          if (suggestion_def_id !== undefined && (generics = this.tcx.hir_get_generics(suggestion_def_id)) !== undefined) {
            err.span_suggestion_verbose(
              generics.tail_span_for_predicate_suggestion(),
              msg_,
              `${generics.add_where_or_trailing_comma()} ${code}`,
              "MaybeIncorrect",
            );
          } else {
            err.help(`${msg_}: where ${code}`);
          }
        } else {
          err.help(msg_);
        }
        return Ok(err);
      }
      case "Expr": {
        const err = this.dcx().struct_span_err(span, `unconstrained generic constant \`${display_Const(ct)}\``);
        return Ok(err);
      }
      default:
        return bug(`const evaluatable failed for non-alias const \`${debug_Const(ct, PLAIN)}\``);
    }
  } else {
    return span_bug(span, "unexpected non-ConstEvaluatable predicate, this should not be reachable");
  }
};

// ---- helpers (lane errrep-traits-b) -----------------------------------------------------------------------------------

/** The generated `TypeFoldable` impl fns of `ProjectionClause` as a D4 descriptor. */
const d_ProjectionClause: TypeFoldable<ProjectionClause> = {
  visit_with: visit_with_ProjectionClause,
  try_fold_with: try_fold_with_ProjectionClause,
  fold_with: fold_with_ProjectionClause,
};
/** The generated `TypeFoldable` impl fns of `HostEffectClause` as a D4 descriptor. */
const d_HostEffectClause: TypeFoldable<HostEffectClause> = {
  visit_with: visit_with_HostEffectClause,
  try_fold_with: try_fold_with_HostEffectClause,
  fold_with: fold_with_HostEffectClause,
};
/** The generated `TypeFoldable` impl fns of `TraitRef` as a D4 descriptor. */
const d_TraitRef: TypeFoldable<TraitRef> = {
  visit_with: visit_with_TraitRef,
  try_fold_with: try_fold_with_TraitRef,
  fold_with: fold_with_TraitRef,
};
/** `ExpectedFound<Ty>`'s derived `TypeFoldable` (rustc_type_ir error.rs). */
const d_ExpectedFound_Ty: TypeFoldable<ExpectedFound<Ty>> = {
  visit_with: (v, visitor) => visit_with_ExpectedFound(v, visitor, fold_Ty.visit_with),
  try_fold_with: (v, folder) => try_fold_with_ExpectedFound(v, folder, fold_Ty.try_fold_with),
  fold_with: (v, folder) => fold_with_ExpectedFound(v, folder, fold_Ty.fold_with),
};
/** `GenericArg`'s `TypeFoldable` (`TypeVisitable` part used for `references_error`). */
const fold_GenericArg_: TypeFoldable<GenericArg> = fold_GenericArg;

/**
 * PORT: `#[derive(TypeFoldable, TypeVisitable)]` of rustc_middle's `TraitClausePrintWithBoundConstness` (pretty.rs:3073),
 * needed to print it inside a `Binder` (`Print for Binder<T>` requires `T: TypeFoldable`); pretty.ts has no descriptor
 * yet (root: move next to the type).
 */
const d_TraitClausePrintWithBoundConstness: TypeFoldable<TraitClausePrintWithBoundConstness> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0, _1: v._1 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder), _1: v._1 }),
};
/** PORT: as above, `TraitClausePrintModifiersAndPath` (pretty.rs:3057). */
const d_TraitClausePrintModifiersAndPath: TypeFoldable<TraitClausePrintModifiersAndPath> = {
  visit_with: (v, visitor) => visit_with_TraitClause(v._0, visitor),
  try_fold_with: (v, folder) => {
    const r = try_fold_with_TraitClause(v._0, folder);
    return r.$ === "Ok" ? Ok({ _0: r._0 }) : r;
  },
  fold_with: (v, folder) => ({ _0: fold_with_TraitClause(v._0, folder) }),
};

/** `impl Print for Binder<TraitClausePrintWithBoundConstness>` (pretty.rs:2960, `Print for Binder<T>`). */
function print_Poly_TraitClausePrintWithBoundConstness(v: Binder<TraitClausePrintWithBoundConstness>, p: PrettyPrinter): PrintResult {
  return print_Binder(v, p, print_TraitClausePrintWithBoundConstness, d_TraitClausePrintWithBoundConstness);
}

/** `impl Display for Binder<TraitClausePrintModifiersAndPath>` (rustc_type_ir ir_print.rs `Display for Binder<I, T>`). */
function display_Poly_TraitClausePrintModifiersAndPath(v: Binder<TraitClausePrintModifiersAndPath>): string {
  return IrPrint_print(v, PLAIN, (v, p) => print_Binder(v, p, print_TraitClausePrintModifiersAndPath, d_TraitClausePrintModifiersAndPath));
}

/** `impl Display for Binder<Ty>` (rustc_type_ir ir_print.rs `Display for Binder<I, T>`). */
function display_PolyTy(v: Binder<Ty>): string {
  return IrPrint_print(v, PLAIN, (v, p) => print_Binder(v, p, print_Ty, fold_Ty));
}

/** `impl Display for TraitRef` (`ToString` of a `TraitRef`). */
function display_TraitRef(v: TraitRef): string {
  return IrPrint_print(v, PLAIN, print_TraitRef);
}

/** The reflexive `impl<I, T> UpcastFrom<I, T> for T` at `Predicate`. */
const upcast_from_self: (from: Predicate, tcx: Interner) => Predicate = (from) => from;
/** `impl UpcastFrom<TyCtxt, TraitClause> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_TraitClause_ = (from: TraitClause, tcx: Interner): Predicate => Predicate_upcast_from_TraitClause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<TyCtxt, PolyTraitClauseV> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_PolyTraitClause_ = (from: PolyTraitClauseT, tcx: Interner): Predicate =>
  Predicate_upcast_from_PolyTraitClause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<TyCtxt, Clause> for Predicate` (rustc_middle predicate.rs). */
const Predicate_upcast_from_Clause_ = (from: Clause, tcx: Interner): Predicate => Predicate_upcast_from_Clause(from, tcx as unknown as TyCtxt);
/** `impl UpcastFrom<I, TraitRef<I>> for TraitClause<I>` (rustc_type_ir predicate.rs:243). */
const TraitClause_upcast_from_TraitRef = (from: TraitRef, tcx: Interner): TraitClause => TraitClause.upcast_from_TraitRef(from, tcx);

/** `PredicateObligation`'s `TypeFoldable` (../../traits/mod.ts), read lazily (init order). */
function d_PredicateObligation(): TypeFoldable<PredicateObligation> {
  const m = lazy_traits();
  return { visit_with: m.visit_with_PredicateObligation, try_fold_with: m.try_fold_with_PredicateObligation, fold_with: m.fold_with_PredicateObligation };
}

/** `TraitRef`'s derived `PartialEq` (interned `GenericArgs`). */
function TraitRef_eq(a: TraitRef, b: TraitRef): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}
/** `(TraitRef, DefId)`'s derived `PartialEq`. */
function TraitRef_DefId_eq(a: readonly [TraitRef, DefId], b: readonly [TraitRef, DefId]): boolean {
  return TraitRef_eq(a[0], b[0]) && DefId_eq(a[1], b[1]);
}
/** `Some(a) == b` for a `DefId` and an `Option<DefId>`. */
function opt_def_id_eq(a: DefId, b: DefId | undefined): boolean {
  return b !== undefined && DefId_eq(a, b);
}
/** `CandidateSimilarity`'s derived `Ord` (variant order `Exact < Fuzzy`, then `ignoring_lifetimes`). */
function CandidateSimilarity_cmp(a: CandidateSimilarity, b: CandidateSimilarity): number {
  const da = a.$ === "Exact" ? 0 : 1;
  const db = b.$ === "Exact" ? 0 : 1;
  if (da !== db) return da < db ? -1 : 1;
  if (a.ignoring_lifetimes !== b.ignoring_lifetimes) return a.ignoring_lifetimes ? 1 : -1;
  return 0;
}

/**
 * `<[T]>::sort_by` (stable): core's driftsort (std/slice_sort.ts). `layout` is the Rust element type's `size_of` / `Freeze`:
 * driftsort's sequence of comparisons depends on them, which matters for comparators that are not a consistent total
 * preorder (report_similar_impl_candidates' tuple-arity comparator says `Equal` unless both self types are tuples).
 */
function sort_by_stable<T>(v: T[], cmp: (a: T, b: T) => number, layout: SortLayout): void {
  slice_sort_by(v, cmp, layout);
}
/**
 * PORT: the layout of `(TraitRef<'tcx>, DefId)` at the pin (64-bit hosts): `TraitRef { def_id: DefId (8 bytes), args:
 * GenericArgsRef (a thin reference, 8), () }` is 16 bytes, the tuple 24; nothing in it has an `UnsafeCell`, so `Freeze`.
 */
const LAYOUT_TraitRef_DefId: SortLayout = { size_of: 24, freeze: true };
/**
 * `<[T]>::sort_by_key` (stable). PORT: every caller's key is under a total order (`String`, tuple `Ord`), so any two stable
 * sorts agree and the result does not depend on driftsort's comparisons: JS's stable `Array.prototype.sort` is used.
 */
function sort_by_key_stable<T, K>(v: T[], key: (x: T) => K, cmp: (a: K, b: K) => number): void {
  const keyed = v.map((x): [K, T] => [key(x), x]);
  keyed.sort((a, b) => cmp(a[0], b[0]));
  for (let i = 0; i < v.length; i++) v[i] = keyed[i]![1];
}
/** `Vec::dedup_by` with `PartialEq` (removes consecutive equal elements, keeps the first). */
function dedup_by<T>(v: T[], eq: (a: T, b: T) => boolean): void {
  let w = 0;
  for (let r = 0; r < v.length; r++) {
    if (w === 0 || !eq(v[r]!, v[w - 1]!)) {
      v[w++] = v[r]!;
    }
  }
  v.length = w;
}

/** `HashSet::insert` on a `KeyedSet`: `false` when the value was present. */
function keyed_set_insert<K>(set: Set<K>, k: K): boolean {
  if (set.has(k)) return false;
  set.add(k);
  return true;
}
/** `map.entry(hir_id).or_default()` on the `HirIdMap<FxIndexSet<Predicate>>`. */
function hir_id_map_entry_or_default(map: Map<HirId, Set<Predicate>>, hir_id: HirId): Set<Predicate> {
  let v = map.get(hir_id);
  if (v === undefined) {
    v = new Set();
    map.set(hir_id, v);
  }
  return v;
}

/** PORT: stand-in for `rustc_transmute::Assume` (crate not ported; as traits/select/confirmation.ts). */
interface TransmuteAssume {
  alignment: boolean;
  lifetimes: boolean;
  safety: boolean;
  validity: boolean;
}
/** PORT: stand-in for `rustc_transmute::Reason<Ty>` (crate not ported), in PORTING's enum representation. */
type TransmuteReason =
  | { readonly $: "SrcIsNotYetSupported" }
  | { readonly $: "DstIsNotYetSupported" }
  | { readonly $: "DstIsBitIncompatible" }
  | { readonly $: "DstUninhabited" }
  | { readonly $: "DstMayHaveSafetyInvariants" }
  | { readonly $: "DstIsTooBig" }
  | { readonly $: "DstRefIsTooBig"; src: Ty; src_size: number; dst: Ty; dst_size: number }
  | { readonly $: "SrcSizeOverflow" }
  | { readonly $: "DstSizeOverflow" }
  | { readonly $: "DstHasStricterAlignment"; src_min_align: number; dst_min_align: number }
  | { readonly $: "DstIsMoreUnique" }
  | { readonly $: "TypeError" }
  | { readonly $: "SrcLayoutUnknown" }
  | { readonly $: "DstLayoutUnknown" };
/** PORT: stand-in for `rustc_transmute::Answer<Region, Ty>` (crate not ported). */
type TransmuteAnswer = { readonly $: "Yes" } | { readonly $: "No"; _0: TransmuteReason } | { readonly $: "If"; _0: unknown };

/** The crate's traits/engine.ts (`ObligationCtxt`), read lazily (init order). */
function lazy_engine(): typeof import("../../traits/engine.ts") {
  return require("../../traits/engine.ts") as typeof import("../../traits/engine.ts");
}
/** The crate's traits/select/mod.ts (`SelectionContext`), read lazily (init order). */
function lazy_select(): typeof import("../../traits/select/mod.ts") {
  return require("../../traits/select/mod.ts") as typeof import("../../traits/select/mod.ts");
}
/** The crate's traits/specialize/specialization_graph.ts (`assoc_def`), read lazily (init order). */
function lazy_specialization_graph(): typeof import("../../traits/specialize/specialization_graph.ts") {
  return require("../../traits/specialize/specialization_graph.ts") as typeof import("../../traits/specialize/specialization_graph.ts");
}
/** The crate's traits/mod.ts, read lazily (init order). */
function lazy_traits(): typeof import("../../traits/mod.ts") {
  return require("../../traits/mod.ts") as typeof import("../../traits/mod.ts");
}
/** This module's parent error_reporting/traits/mod.ts (`ArgKind`), read lazily (init order). */
function lazy_traits_mod(): typeof import("./mod.ts") {
  return require("./mod.ts") as typeof import("./mod.ts");
}
/** The sibling error_reporting/infer/mod.ts (`TyCategory::from_ty`), read lazily (init order). */
function lazy_infer_mod(): typeof import("../infer/mod.ts") {
  return require("../infer/mod.ts") as typeof import("../infer/mod.ts");
}
/** The crate's diagnostics.gen.ts (`ClosureKindMismatch`, `AssocTypeWithSameName`), read lazily (init order). */
function lazy_diagnostics(): typeof import("../../diagnostics.gen.ts") {
  return require("../../diagnostics.gen.ts") as typeof import("../../diagnostics.gen.ts");
}

/** `#[derive(Hash)]` of `(DefId, String)`: `DefId`'s `Hash` (def_id.rs:268: the `u64` `krate << 32 | index`), then
 * `write_str` of the path; element size 32, align 8. */
const DefId_String_key: KeyType<[DefId, string]> = {
  hash: ([d, p], state) => {
    state.write_u64((BigInt(d.krate) << 32n) | BigInt(d.index));
    String_key.hash(p, state);
  },
  size: 32,
  align: 8,
};

/** `size_of::<(DefId, String)>()` = 32; no `UnsafeCell`. */
const LAYOUT_DefId_String: SortLayout = { size_of: 32, freeze: true };

