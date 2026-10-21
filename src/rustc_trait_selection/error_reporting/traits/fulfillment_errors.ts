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
import type { ClosureKind } from "../../../rustc_type_ir/lib.ts";
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
unported_methods(TypeErrCtxt, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", ["as_host_effect_clause"]);
unported_methods(TypeErrCtxt.prototype, "rustc_trait_selection::error_reporting::traits::fulfillment_errors::TypeErrCtxt", [
  "can_match_trait", "can_match_host_effect", "can_match_projection", "error_implies", "trait_error_implies_projection_error", "report_projection_error", "maybe_detailed_projection_msg", "fuzzy_match_tys", "describe_closure", "find_similar_impl_candidates", "report_similar_impl_candidates", "report_similar_impl_candidates_for_root_obligation", "get_parent_trait_ref", "check_same_trait_different_version", "note_two_crate_versions", "note_adt_version_mismatch", "check_same_name_different_path", "note_different_trait_with_same_name", "comparable_path", "mk_trait_obligation_with_new_self_ty", "predicate_can_apply", "suggest_change_mut_ref_for_closure", "silence_redundant_cause", "note_obligation_cause", "is_recursive_obligation", "get_standard_error_message", "select_transmute_obligation_for_reporting", "get_safe_transmute_error_and_reason", "find_explicit_cast_type", "has_impl_for_type", "add_tuple_trait_message", "try_to_add_help_message", "add_help_message_for_fn_trait", "report_closure_error", "report_cyclic_signature_error", "report_signature_mismatch_error", "get_fn_like_arguments", "report_arg_count_mismatch", "type_implements_fn_trait", "report_not_const_evaluatable_error",
]);
