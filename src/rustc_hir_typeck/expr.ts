// Port of compiler/rustc_hir_typeck/src/expr.rs (STUB, lane typeck-expr-a|typeck-expr-b): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// expr.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/expr.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { str_cmp } from "../rustc_session/options.ts";
import { AsmMacro } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { DiagMessage, MultiSpan } from "../rustc_error_messages/lib.ts";
import {
  Applicability,
  type Diag,
  E0063,
  E0559,
  E0560,
  E0608,
  E0610,
  E0615,
  E0616,
  E0784,
  E0795,
  listify,
  pluralize,
  StashKey,
  struct_span_code_err,
} from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { CtorKind } from "../rustc_hir/def.ts";
import { HirId_eq } from "../rustc_hir_id/lib.ts";
import { NoFieldOnType_diagnostic, NoVariantNamed_diagnostic } from "../rustc_hir_analysis/diagnostics.gen.ts";
import { DefineOpaqueTypes } from "../rustc_infer/infer/at.gen.ts";
import { ToTrace_Ty } from "../rustc_infer/infer/at.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { clone_ObligationCause, ObligationCauseCode } from "../rustc_middle/traits/mod.ts";
import { type Adjustment, AllowTwoPhase } from "../rustc_middle/ty/adjustment.ts";
import { type AdtDef, AdtKind } from "../rustc_middle/ty/adt.ts";
import { AssocItem, AssocItems } from "../rustc_middle/ty/assoc.ts";
import type { Const, FieldIdx, ParamTy, VariantIdx } from "../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { GenericClauses, type Generics } from "../rustc_middle/ty/generics.ts";
import { type FieldDef, HasAttrs_LocalDefId, Ty, type VariantDef, Visibility } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { BytePos, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { display_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { predicates_for_generics } from "../rustc_trait_selection/traits/mod.ts";
import type { FulfillmentError } from "../rustc_trait_selection/traits/mod.gen.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT, TraitClause, TraitRef as TraitRefT } from "../rustc_type_ir/decls.ts";
import { NoSolution_from_TypeError, type TypeError } from "../rustc_type_ir/error.ts";
import {
  ClausePolarity,
  fold_with_TraitClause,
  fold_with_TraitRef,
  TraitRef,
  try_fold_with_TraitClause,
  try_fold_with_TraitRef,
  visit_with_TraitClause,
  visit_with_TraitRef,
} from "../rustc_type_ir/predicate.ts";
import type { PredicateKind } from "../rustc_type_ir/predicate_kind.gen.ts";
import type { NoSolution } from "../rustc_type_ir/solve/mod.gen.ts";
import { fold_FnSig, IsRigid, PolyFnSig as PolyFnSigC } from "../rustc_type_ir/ty_kind.ts";
import { ClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedMap, KeyedSet } from "../rust_ts/keyed.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { ch, is_ascii_digit, is_control, is_numeric } from "../std/char.ts";
import { assert, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str, utf8_len } from "../std/str.ts";
import { FnCtxt } from "./decls.ts";
import {
  BaseExpressionDoubleDot_diagnostic,
  FieldMultiplySpecifiedInInitializer_diagnostic,
  FunctionalRecordUpdateOnNonStruct_diagnostic,
  NakedAsmOutsideNakedFn_diagnostic,
  NoFieldOnVariant_diagnostic,
  YieldExprOutsideOfCoroutine_diagnostic,
} from "./diagnostics.gen.ts";
import { HelpUseLatestEdition_add_to_diag } from "./diagnostics.gen.ts";
import { HelpUseLatestEdition_new, TypeMismatchFruTypo_subdiagnostic } from "./diagnostics.ts";
import { Expectation } from "./expectation.ts";
import { type_error_struct, Needs } from "./lib.ts";

// ==== lane typeck-expr-a: expr.rs:1..1854 ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::expr::FnCtxt", ["precedence", "check_expr_has_type_or_error", "check_expr_coercible_to_type", "check_expr_coercible_to_type_or_error", "check_expr_with_hint", "check_expr_with_expectation_and_needs", "check_expr", "check_expr_with_needs", "check_expr_with_expectation", "check_expr_with_expectation_and_args", "check_expr_kind", "check_expr_unop", "check_expr_addr_of", "check_named_place_expr", "check_expr_path", "check_expr_break", "check_expr_continue", "check_expr_return", "check_expr_become", "check_return_or_body_tail", "emit_return_outside_of_fn_body", "point_at_return_for_opaque_ty_error", "check_lhs_assignable", "check_for_missing_semi", "comes_from_while_condition", "check_expr_if", "check_expr_assign", "expr_assign_expected_bool_error", "check_expr_let", "check_expr_loop", "check_expr_method_call", "check_expr_use", "check_expr_cast", "check_expr_unsafe_binder_cast", "check_expr_array", "check_expr_const_block", "check_expr_repeat", "check_expr_tuple", "check_expr_struct"]);
// ==== lane typeck-expr-b: expr.rs:1855..3957 ====

// rustc: compiler/rustc_hir_typeck/src/expr.rs:1856 check_expr_struct_fields
FnCtxt.prototype.check_expr_struct_fields = function (
  this: FnCtxt,
  adt_ty_: Ty,
  expected: Expectation,
  expr: hir.Expr,
  path_span: Span,
  variant: VariantDef,
  hir_fields: readonly hir.ExprField[],
  base_expr: hir.StructTailExpr,
): void {
  const tcx = this.tcx;

  const adt_ty = this.deeply_resolve_ignoring_regions_with_obligations(adt_ty_, fold_Ty);
  const expected_ty = Expectation.only_has_type(expected, this);
  let adt_ty_hint: Ty | undefined;
  if (expected_ty !== undefined) {
    const r = this.fudge_inference_if_ok((): Result<Ty, TypeError> => {
      const ocx = ObligationCtxt.new(this.infcx);
      const sup = ocx.sup(this.misc(path_span), this.param_env, expected_ty, adt_ty, ToTrace_Ty);
      if (sup.$ === "Err") return sup;
      if (!TraitErrors.no_errors(ocx.try_evaluate_obligations())) {
        return Err({ $: "Mismatch" });
      }
      return Ok(this.deeply_resolve_ignoring_regions(adt_ty, fold_Ty));
    }, fold_Ty);
    adt_ty_hint = r.$ === "Ok" ? r._0 : undefined;
  }
  if (adt_ty_hint !== undefined) {
    // re-link the variables that the fudging above can create.
    this.demand_eqtype(path_span, adt_ty_hint, adt_ty);
  }

  const adt_ty_kind = adt_ty.kind();
  if (adt_ty_kind.$ !== "Adt") {
    span_bug(path_span, "non-ADT passed to check_expr_struct_fields");
  }
  const adt = adt_ty_kind._0;
  const args = adt_ty_kind._1;
  const adt_kind = adt.adt_kind();

  // PORT: `UnordMap<Ident, (FieldIdx, &FieldDef)>` / `FxHashMap<Ident, Span>`: `Ident` is an object, so the maps are
  // keyed by its `Eq` (`Ident_key`).
  const remaining_fields = new KeyedMap<Ident, [FieldIdx, FieldDef]>(
    Ident_key,
    variant.fields.map((field, i): [Ident, [FieldIdx, FieldDef]] => [field.ident(tcx).normalize_to_macros_2_0(), [i as FieldIdx, field]]),
  );

  const seen_fields = new KeyedMap<Ident, Span>(Ident_key);

  let error_happened = false;

  if (variant.fields.length !== remaining_fields.size) {
    // Some field is defined more than once. Make sure we don't try to
    // instantiate this struct in static/const context.
    const guar = this.dcx().span_delayed_bug(expr.span, "struct fields have non-unique names");
    this.set_tainted_by_errors(guar);
    error_happened = true;
  }

  // Type-check each field.
  for (let idx = 0; idx < hir_fields.length; idx++) {
    const field = hir_fields[idx]!;
    const ident = tcx.adjust_ident(field.ident, variant.def_id);
    let field_type: Ty;
    const removed = remove_keyed(remaining_fields, ident);
    if (removed !== undefined) {
      const [i, v_field] = removed;
      seen_fields.set(ident, field.span);
      this.write_field_index(field.hir_id, i);

      // We don't look at stability attributes on
      // struct-like enums (yet...), but it's definitely not
      // a bug to have constructed one.
      if (adt_kind !== AdtKind.Enum) {
        tcx.check_stability(v_field.did, field.hir_id, field.span, undefined);
      }

      field_type = this.field_ty(field.span, v_field, args);
    } else {
      error_happened = true;
      let guar: ErrorGuaranteed;
      const prev_span = seen_fields.get(ident);
      if (prev_span !== undefined) {
        guar = this.dcx().emit_err(
          FieldMultiplySpecifiedInInitializer_diagnostic({
            span: field.ident.span,
            prev_span,
            ident,
          }),
        );
      } else {
        guar = this.report_unknown_field(adt_ty, variant, expr, field, hir_fields, adt.variant_descr());
      }

      field_type = Ty.new_error(tcx, guar);
    }

    // Check that the expected field type is WF. Otherwise, we emit no use-site error
    // in the case of coercions for non-WF fields, which leads to incorrect error
    // tainting. See issue #126272.
    this.register_wf_obligation(field_type, field.expr.span, {
      $: "WellFormed",
      _0: { $: "HirId", _0: field.expr.hir_id },
    });

    // Make sure to give a type to the field even if there's
    // an error, so we can continue type-checking.
    const ty = this.check_expr_with_hint(field.expr, field_type);
    const diag = this.demand_coerce_diag(field.expr, ty, field_type, undefined, AllowTwoPhase.No);

    if (diag.$ === "Err") {
      const diag_ = diag._0;
      if (idx === hir_fields.length - 1) {
        if (remaining_fields.size === 0) {
          this.suggest_fru_from_range_and_emit(field, variant, args, diag_);
        } else {
          diag_.stash(field.span, StashKey.MaybeFruTypo);
        }
      } else {
        diag_.emit();
      }
    }
  }

  // Make sure the programmer specified correct number of fields.
  if (adt_kind === AdtKind.Union && hir_fields.length !== 1) {
    struct_span_code_err(this.dcx(), path_span, E0784, "union expressions should have exactly one field").emit();
  }

  // If check_expr_struct_fields hit an error, do not attempt to populate
  // the fields with the base_expr. This could cause us to hit errors later
  // when certain fields are assumed to exist that in fact do not.
  if (error_happened) {
    if (base_expr.$ === "Base") {
      this.check_expr(base_expr._0);
    }
    return;
  }

  switch (base_expr.$) {
    case "DefaultFields": {
      const span = base_expr._0;
      const missing_mandatory_fields: Ident[] = [];
      const missing_optional_fields: Ident[] = [];
      for (const f of variant.fields) {
        const ident = this.tcx.adjust_ident(f.ident(this.tcx), variant.def_id);
        if (remove_keyed(remaining_fields, ident) !== undefined) {
          if (f.value === undefined) {
            missing_mandatory_fields.push(ident);
          } else {
            missing_optional_fields.push(ident);
          }
        }
      }
      if (!this.tcx.features().default_field_values()) {
        const sugg = this.tcx.crate_level_attribute_injection_span();
        this.dcx().emit_err(
          BaseExpressionDoubleDot_diagnostic({
            span: Span.shrink_to_hi(span),
            // We only mention enabling the feature if this is a nightly rustc *and* the
            // expression would make sense with the feature enabled.
            default_field_values_suggestion:
              this.tcx.sess.is_nightly_build() && missing_mandatory_fields.length === 0 && missing_optional_fields.length !== 0
                ? sugg
                : undefined,
            add_expr:
              missing_mandatory_fields.length !== 0 || missing_optional_fields.length !== 0
                ? { span: Span.shrink_to_hi(span) }
                : undefined,
            remove_dots: missing_mandatory_fields.length === 0 && missing_optional_fields.length === 0 ? { span } : undefined,
          }),
        );
        return;
      }
      if (variant.fields.length === 0) {
        const err = this.dcx().struct_span_err(
          span,
          `\`${display_Ty(adt_ty)}\` has no fields, \`..\` needs at least one default field in the struct definition`,
        );
        err.span_label(path_span, "this type has no fields");
        err.emit();
      }
      if (missing_mandatory_fields.length !== 0) {
        const s = pluralize(missing_mandatory_fields.length);
        const fields = unwrap(listify(missing_mandatory_fields, (f) => `\`${display_Ident(f)}\``));
        this.dcx()
          .struct_span_err(Span.shrink_to_lo(span), `missing field${s} ${fields} in initializer`)
          .with_span_label(Span.shrink_to_lo(span), "fields that do not have a defaulted value must be provided explicitly")
          .emit();
        return;
      }
      let fru_tys: Ty[];
      const k = adt_ty.kind();
      if (k.$ === "Adt" && k._0.is_struct()) {
        const args = k._1;
        fru_tys = variant.fields.map((f) => this.normalize(span, f.ty(this.tcx, args), fold_Ty));
      } else if (k.$ === "Adt" && k._0.is_enum()) {
        const args = k._1;
        fru_tys = variant.fields.map((f) => this.normalize(span, f.ty(this.tcx, args), fold_Ty));
      } else {
        this.dcx().emit_err(FunctionalRecordUpdateOnNonStruct_diagnostic({ span }));
        return;
      }
      this.typeck_results.fru_field_types_mut().insert(expr.hir_id, fru_tys);
      break;
    }
    case "Base": {
      const base_expr_ = base_expr._0;
      // FIXME: We are currently creating two branches here in order to maintain
      // consistency. But they should be merged as much as possible.
      let fru_tys: Ty[];
      if (this.tcx.features().type_changing_struct_update()) {
        if (adt.is_struct()) {
          // Make some fresh generic parameters for our ADT type.
          const fresh_args = this.fresh_args_for_item(base_expr_.span, adt.did());
          // We do subtyping on the FRU fields first, so we can
          // learn exactly what types we expect the base expr
          // needs constrained to be compatible with the struct
          // type we expect from the expectation value.
          const fru_tys_ = variant.fields.map((f) => {
            const fru_ty = this.normalize(expr.span, Unnormalized.new_wip(this.field_ty(base_expr_.span, f, fresh_args)), fold_Ty);
            const ident = this.tcx.adjust_ident(f.ident(this.tcx), variant.def_id);
            if (remove_keyed(remaining_fields, ident) !== undefined) {
              const target_ty = this.field_ty(base_expr_.span, f, args);
              const cause = this.misc(base_expr_.span);
              const r = this.at(cause, this.param_env).sup(
                // We're already using inference variables for any params,
                // and don't allow converting between different structs,
                // so there is no way this ever actually defines an opaque
                // type. Thus choosing `Yes` is fine.
                DefineOpaqueTypes.Yes,
                target_ty,
                fru_ty,
                ToTrace_Ty,
              );
              if (r.$ === "Ok") {
                const { obligations } = r._0;
                this.register_predicates(obligations);
              } else {
                span_bug(
                  cause.span,
                  `subtyping remaining fields of type changing FRU failed: ${display_Ty(target_ty)} != ${display_Ty(fru_ty)}: ${Symbol.as_str(variant.name)}::${Symbol.as_str(ident.name)}`,
                );
              }
            }
            return this.deeply_resolve_ignoring_regions(fru_ty, fold_Ty);
          });
          // The use of fresh args that we have subtyped against
          // our base ADT type's fields allows us to guide inference
          // along so that, e.g.
          // ```
          // MyStruct<'a, F1, F2, const C: usize> {
          //     f: F1,
          //     // Other fields that reference `'a`, `F2`, and `C`
          // }
          //
          // let x = MyStruct {
          //    f: 1usize,
          //    ..other_struct
          // };
          // ```
          // will have the `other_struct` expression constrained to
          // `MyStruct<'a, _, F2, C>`, as opposed to just `_`...
          // This is important to allow coercions to happen in
          // `other_struct` itself. See `coerce-in-base-expr.rs`.
          const fresh_base_ty = Ty.new_adt(this.tcx, adt, fresh_args);
          this.check_expr_has_type_or_error(base_expr_, this.deeply_resolve_ignoring_regions(fresh_base_ty, fold_Ty), (_) => {});
          fru_tys = fru_tys_;
        } else {
          // Check the base_expr, regardless of a bad expected adt_ty, so we can get
          // type errors on that expression, too.
          this.check_expr(base_expr_);
          this.dcx().emit_err(FunctionalRecordUpdateOnNonStruct_diagnostic({ span: base_expr_.span }));
          return;
        }
      } else {
        this.check_expr_has_type_or_error(base_expr_, adt_ty, (_) => {
          const base_ty = this.typeck_results.expr_ty(base_expr_);
          const a = adt_ty.kind();
          const b = base_ty.kind();
          const same_adt = a.$ === "Adt" && b.$ === "Adt" && a._0 === b._0;
          if (this.tcx.sess.is_nightly_build() && same_adt) {
            feature_err(this.tcx.sess, sym.type_changing_struct_update, base_expr_.span, "type changing struct updating is experimental").emit();
          }
        });
        const k = adt_ty.kind();
        if (k.$ === "Adt" && k._0.is_struct()) {
          const args = k._1;
          fru_tys = variant.fields.map((f) => this.normalize(expr.span, f.ty(this.tcx, args), fold_Ty));
        } else {
          this.dcx().emit_err(FunctionalRecordUpdateOnNonStruct_diagnostic({ span: base_expr_.span }));
          return;
        }
      }
      this.typeck_results.fru_field_types_mut().insert(expr.hir_id, fru_tys);
      break;
    }
    case "NoneWithError": {
      const guaranteed = base_expr._0;
      // If parsing the struct recovered from a syntax error, do not report missing
      // fields. This prevents spurious errors when a field is intended to be present
      // but a preceding syntax error caused it not to be parsed. For example, if a
      // struct type `StructName` has fields `foo` and `bar`, then
      //     StructName { foo(), bar: 2 }
      // will not successfully parse a field `foo`, but we will not mention that,
      // since the syntax error has already been reported.

      // Signal that type checking has failed, even though we haven’t emitted a diagnostic
      // about it ourselves.
      this.infcx.set_tainted_by_errors(guaranteed);
      break;
    }
    case "None": {
      if (
        adt_kind !== AdtKind.Union &&
        remaining_fields.size !== 0 &&
        //~ non_exhaustive already reported, which will only happen for extern modules
        !variant.field_list_has_applicable_non_exhaustive()
      ) {
        // debug!(?remaining_fields);

        // Report missing fields.

        const private_fields: FieldDef[] = variant.fields.filter(
          (field) => !Visibility.is_accessible_from(field.vis, this.mod_id, tcx),
        );

        if (private_fields.length !== 0) {
          this.report_private_fields(adt_ty, path_span, expr.span, private_fields, hir_fields);
        } else {
          this.report_missing_fields(adt_ty, path_span, expr.span, remaining_fields, variant, hir_fields, args);
        }
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2254 check_struct_fields_on_error
FnCtxt.prototype.check_struct_fields_on_error = function (
  this: FnCtxt,
  fields: readonly hir.ExprField[],
  base_expr: hir.StructTailExpr,
): void {
  for (const field of fields) {
    this.check_expr(field.expr);
  }
  if (base_expr.$ === "Base") {
    const base = base_expr._0;
    this.check_expr(base);
  }
};

/// Report an error for a struct field expression when there are fields which aren't provided.
///
/// ```text
/// error: missing field `you_can_use_this_field` in initializer of `foo::Foo`
///  --> src/main.rs:8:5
///   |
/// 8 |     foo::Foo {};
///   |     ^^^^^^^^ missing `you_can_use_this_field`
///
/// error: aborting due to 1 previous error
/// ```
// rustc: compiler/rustc_hir_typeck/src/expr.rs:2278 report_missing_fields
FnCtxt.prototype.report_missing_fields = function (
  this: FnCtxt,
  adt_ty: Ty,
  span: Span,
  full_span: Span,
  remaining_fields: Map<Ident, [FieldIdx, FieldDef]>,
  variant: VariantDef,
  hir_fields: readonly hir.ExprField[],
  args: GenericArgs,
): void {
  const len = remaining_fields.size;

  // PORT: `into_sorted_stable_ord` of `&str`s is `Ord for str` (`str_cmp`).
  const displayable_field_names: string[] = [...remaining_fields.keys()].map((ident) => ident.as_str()).sort(str_cmp);

  let truncated_fields_error = "";
  let remaining_fields_names: string;
  if (displayable_field_names.length === 1) {
    const [field1] = displayable_field_names;
    remaining_fields_names = `\`${field1}\``;
  } else if (displayable_field_names.length === 2) {
    const [field1, field2] = displayable_field_names;
    remaining_fields_names = `\`${field1}\` and \`${field2}\``;
  } else if (displayable_field_names.length === 3) {
    const [field1, field2, field3] = displayable_field_names;
    remaining_fields_names = `\`${field1}\`, \`${field2}\` and \`${field3}\``;
  } else {
    truncated_fields_error = ` and ${len - 3} other field${pluralize(len - 3)}`;
    remaining_fields_names = displayable_field_names
      .slice(0, 3)
      .map((n) => `\`${n}\``)
      .join(", ");
  }

  const err = struct_span_code_err(
    this.dcx(),
    span,
    E0063,
    `missing field${pluralize(len)} ${remaining_fields_names}${truncated_fields_error} in initializer of \`${display_Ty(adt_ty)}\``,
  );
  err.span_label(span, `missing ${remaining_fields_names}${truncated_fields_error}`);

  if ([...remaining_fields.values()].every(([_, field]) => field.value !== undefined) && this.tcx.sess.is_nightly_build()) {
    const you_can = this.tcx.features().default_field_values()
      ? "you can"
      : "if you added `#![feature(default_field_values)]` to your crate you could";
    const msg = `all remaining fields have default values, ${you_can} use those values with \`..\``;
    const hir_field = hir_fields[hir_fields.length - 1];
    if (hir_field !== undefined) {
      err.span_suggestion_verbose(Span.shrink_to_hi(hir_field.span), msg, ", ..", Applicability.MachineApplicable);
    } else if (hir_fields.length === 0) {
      err.span_suggestion_verbose(
        Span.with_hi(Span.shrink_to_hi(span), Span.hi(full_span)),
        msg,
        " { .. }",
        Applicability.MachineApplicable,
      );
    }
  }

  const hir_field = hir_fields[hir_fields.length - 1];
  if (hir_field !== undefined) {
    this.suggest_fru_from_range_and_emit(hir_field, variant, args, err);
  } else {
    err.emit();
  }
};

/// If the last field is a range literal, but it isn't supposed to be, then they probably
/// meant to use functional update syntax.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:2359 suggest_fru_from_range_and_emit
FnCtxt.prototype.suggest_fru_from_range_and_emit = function (
  this: FnCtxt,
  last_expr_field: hir.ExprField,
  variant: VariantDef,
  args: GenericArgs,
  err: Diag,
): void {
  const k = last_expr_field.expr.kind;
  let range_start: hir.ExprField | undefined;
  let range_end: hir.ExprField | undefined;
  let matched = false;
  if (hir.is_range_literal(last_expr_field.expr) && k.$ === "Struct" && k._1.length === 2) {
    const qpath = k._0;
    range_start = k._1[0]!;
    range_end = k._1[1]!;
    if (this.tcx.qpath_is_lang_item(qpath, LangItem.Range)) {
      const variant_field = variant.fields.find((field) => field.ident(this.tcx).eq(last_expr_field.ident));
      const range_def_id = this.tcx.lang_items().range_struct();
      const variant_field_adt_did =
        variant_field === undefined ? undefined : Unnormalized.skip_norm_wip(variant_field.ty(this.tcx, args)).ty_adt_def()?.did();
      // PORT: `Option<DefId> != Option<DefId>` (derived `PartialEq` of `DefId`).
      if (!Option_DefId_eq(variant_field_adt_did, range_def_id)) {
        matched = true;
      }
    }
  }
  if (matched && range_start !== undefined && range_end !== undefined) {
    // Use a (somewhat arbitrary) filtering heuristic to avoid printing
    // expressions that are either too long, or have control character
    // such as newlines in them.
    const snippet = this.tcx.sess.source_map().span_to_snippet(range_end.expr.span);
    let expr: string | undefined = snippet.$ === "Ok" ? snippet._0.toString() : undefined;
    if (expr !== undefined && !(utf8_len(expr) < 25 && ![...expr].some((c) => is_control(c.codePointAt(0)!)))) {
      expr = undefined;
    }

    const fru_span = Span.to(
      Span.shrink_to_hi(this.tcx.sess.source_map().span_extend_while_whitespace(range_start.expr.span)),
      range_end.expr.span,
    );

    err.subdiagnostic(
      TypeMismatchFruTypo_subdiagnostic({
        expr_span: range_start.expr.span,
        fru_span,
        expr,
      }),
    );

    // Suppress any range expr type mismatches
    this.dcx().try_steal_replace_and_emit_err(last_expr_field.span, StashKey.MaybeFruTypo, err);
  } else {
    err.emit();
  }
};

/// Report an error for a struct field expression when there are invisible fields.
///
/// ```text
/// error: cannot construct `Foo` with struct literal syntax due to private fields
///  --> src/main.rs:8:5
///   |
/// 8 |     foo::Foo {};
///   |     ^^^^^^^^
///
/// error: aborting due to 1 previous error
/// ```
// rustc: compiler/rustc_hir_typeck/src/expr.rs:2424 report_private_fields
FnCtxt.prototype.report_private_fields = function (
  this: FnCtxt,
  adt_ty: Ty,
  span: Span,
  expr_span: Span,
  private_fields: FieldDef[],
  used_fields: readonly hir.ExprField[],
): void {
  const err = this.dcx().struct_span_err(
    span,
    `cannot construct \`${display_Ty(adt_ty)}\` with struct literal syntax due to private fields`,
  );
  const used_private_fields: [Symbol, Span, boolean][] = [];
  const remaining_private_fields: [Symbol, Span, boolean][] = [];
  for (const field of private_fields) {
    const used_field = used_fields.find((used_field) => field.name === used_field.ident.name);
    const entry: [Symbol, Span, boolean] =
      used_field !== undefined ? [field.name, used_field.span, true] : [field.name, this.tcx.def_span(field.did), false];
    if (entry[2]) {
      used_private_fields.push(entry);
    } else {
      remaining_private_fields.push(entry);
    }
  }
  err.span_labels(
    used_private_fields.map(([_, span, _b]) => span),
    "private field",
  );

  const k = adt_ty.kind();
  if (k.$ === "Adt") {
    const def = k._0;
    if ((def.did().is_local() || used_fields.length !== 0) && remaining_private_fields.length !== 0) {
      const names =
        remaining_private_fields.length > 6
          ? ""
          : `${unwrap(
              listify(remaining_private_fields, ([name, _, _b]) => `\`${Symbol.as_str(name)}\``),
              "expected at least one private field to report",
            )} `;
      err.note(
        `${used_fields.length === 0 ? "" : "...and other "}private field${pluralize(remaining_private_fields.length)} ${names}that ${pluralize("was", remaining_private_fields.length)} not provided`,
      );
    }

    const def_id = def.did();
    const items: [boolean, Symbol, number][] = [];
    for (const i of this.tcx.inherent_impls(def_id)) {
      for (const item of AssocItems.in_definition_order(this.tcx.associated_items(i) as AssocItems)) {
        // Only assoc fn with no receivers.
        if (!(AssocItem.is_fn(item) && !AssocItem.is_method(item))) continue;
        // Only assoc fns that return `Self`
        const fn_sig = Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(
            this.tcx.fn_sig(item.def_id) as EarlyBinder<PolyFnSigT>,
            this.tcx,
            this.fresh_args_for_item(span, item.def_id),
            fold_Binder(fold_FnSig),
          ),
        );
        const ret_ty = this.tcx.instantiate_bound_regions_with_erased(PolyFnSigC.output(fn_sig), fold_Ty);
        if (!this.can_eq(this.param_env, ret_ty, adt_ty, ToTrace_Ty)) {
          continue;
        }
        const input_len = Binder.skip_binder(PolyFnSigC.inputs(fn_sig)).length;
        const name = AssocItem.name(item);
        const order = !Symbol.as_str(name).startsWith("new");
        items.push([order, name, input_len]);
      }
    }
    // PORT: `sort_by_key` is a stable sort (as `Array.prototype.sort`); `bool`'s `Ord` puts `false` first.
    items.sort(([a], [b]) => Number(a) - Number(b));
    const suggestion = (name: Symbol, args: number): string =>
      `::${Symbol.as_str(name)}(${Array.from({ length: args }, () => "_").join(", ")})`;
    if (items.length === 0) {
      // nothing
    } else if (items.length === 1) {
      const [, name, args] = items[0]!;
      err.span_suggestion_verbose(
        Span.with_hi(Span.shrink_to_hi(span), Span.hi(expr_span)),
        `you might have meant to use the \`${Symbol.as_str(name)}\` associated function`,
        suggestion(name, args),
        Applicability.MaybeIncorrect,
      );
    } else {
      err.span_suggestions(
        Span.with_hi(Span.shrink_to_hi(span), Span.hi(expr_span)),
        "you might have meant to use an associated function to build this type",
        items.map(([, name, args]) => suggestion(name, args)),
        Applicability.MaybeIncorrect,
      );
    }
    const default_trait = this.tcx.get_diagnostic_item(sym.Default);
    if (
      default_trait !== undefined &&
      EvaluationResult.may_apply(this.infcx.type_implements_trait(default_trait, [adt_ty], this.param_env))
    ) {
      err.multipart_suggestion(
        "consider using the `Default` trait",
        [
          [Span.shrink_to_lo(span), "<"],
          [Span.with_hi(Span.shrink_to_hi(span), Span.hi(expr_span)), " as std::default::Default>::default()"],
        ],
        Applicability.MaybeIncorrect,
      );
    }
  }

  err.emit();
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2548 report_unknown_field
FnCtxt.prototype.report_unknown_field = function (
  this: FnCtxt,
  ty: Ty,
  variant: VariantDef,
  expr: hir.Expr,
  field: hir.ExprField,
  skip_fields: readonly hir.ExprField[],
  kind_name: string,
): ErrorGuaranteed {
  // we don't care to report errors for a struct if the struct itself is tainted
  const has_errors = variant.has_errors();
  if (has_errors.$ === "Err") {
    return has_errors._0;
  }
  const err = err_ctxt_view(this).type_error_struct_with_diag(
    field.ident.span,
    (actual: string): Diag => {
      const k = ty.kind();
      if (k.$ === "Adt" && k._0.is_enum()) {
        return struct_span_code_err(
          this.dcx(),
          field.ident.span,
          E0559,
          `${kind_name} \`${actual}::${Symbol.as_str(variant.name)}\` has no field named \`${display_Ident(field.ident)}\``,
        );
      } else {
        return struct_span_code_err(
          this.dcx(),
          field.ident.span,
          E0560,
          `${kind_name} \`${actual}\` has no field named \`${display_Ident(field.ident)}\``,
        );
      }
    },
    ty,
  );

  const variant_ident_span = unwrap(this.tcx.def_ident_span(variant.def_id));
  if (variant.ctor !== undefined && variant.ctor[0] === CtorKind.Fn) {
    const def_id = variant.ctor[1];
    const k = ty.kind();
    if (k.$ === "Adt" && k._0.is_enum()) {
      err.span_label(variant_ident_span, `\`${display_Ty(ty)}::${Symbol.as_str(variant.name)}\` defined here`);
      err.span_label(field.ident.span, "field does not exist");
      const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSigT>));
      const inputs = Binder.skip_binder(PolyFnSigC.inputs(fn_sig));
      const fields = `(${inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")})`;
      let replace_span: Span;
      let sugg: string;
      if (expr.kind.$ === "Struct") {
        const qpath = expr.kind._0;
        [replace_span, sugg] = [Span.with_hi(Span.shrink_to_hi(hir.QPath.span(qpath)), Span.hi(expr.span)), fields];
      } else {
        [replace_span, sugg] = [expr.span, `${display_Ty(ty)}::${Symbol.as_str(variant.name)}${fields}`];
      }
      err.span_suggestion_verbose(
        replace_span,
        `\`${display_Ty(ty)}::${Symbol.as_str(variant.name)}\` is a tuple ${kind_name}, use the appropriate syntax`,
        sugg,
        Applicability.HasPlaceholders,
      );
    } else {
      err.span_label(variant_ident_span, `\`${display_Ty(ty)}\` defined here`);
      err.span_label(field.ident.span, "field does not exist");
      const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<PolyFnSigT>));
      const inputs = Binder.skip_binder(PolyFnSigC.inputs(fn_sig));
      const fields = `(${inputs.map((i) => `/* ${display_Ty(i)} */`).join(", ")})`;
      err.span_suggestion_verbose(
        expr.span,
        `\`${display_Ty(ty)}\` is a tuple ${kind_name}, use the appropriate syntax`,
        `${display_Ty(ty)}${fields}`,
        Applicability.HasPlaceholders,
      );
    }
  } else {
    // prevent all specified fields from being suggested
    const available_field_names = this.available_field_names(variant, expr, skip_fields);
    const field_name = find_best_match_for_name(available_field_names, field.ident.name, undefined);
    if (
      field_name !== undefined &&
      !(parse_usize(Symbol.as_str(field.ident.name)) !== undefined && parse_usize(Symbol.as_str(field_name)) !== undefined)
    ) {
      err.span_label(field.ident.span, "unknown field");
      err.span_suggestion_verbose(
        field.ident.span,
        "a field with a similar name exists",
        Symbol.as_str(field_name),
        Applicability.MaybeIncorrect,
      );
    } else {
      const k = ty.kind();
      if (k.$ === "Adt") {
        const adt = k._0;
        if (adt.is_enum()) {
          err.span_label(field.ident.span, `\`${display_Ty(ty)}::${Symbol.as_str(variant.name)}\` does not have this field`);
        } else {
          err.span_label(field.ident.span, `\`${display_Ty(ty)}\` does not have this field`);
        }
        if (available_field_names.length === 0) {
          err.note("all struct fields are already assigned");
        } else {
          err.note(`available fields are: ${this.name_series_display(available_field_names)}`);
        }
      } else {
        bug("non-ADT passed to report_unknown_field");
      }
    }
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2688 available_field_names
FnCtxt.prototype.available_field_names = function (
  this: FnCtxt,
  variant: VariantDef,
  expr: hir.Expr,
  skip_fields: readonly hir.ExprField[],
): Symbol[] {
  return variant.fields
    .filter((field) => skip_fields.every((skip) => skip.ident.name !== field.name) && this.is_field_suggestable(field, expr.span))
    .map((field) => field.name);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2705 name_series_display
FnCtxt.prototype.name_series_display = function (this: FnCtxt, names: Symbol[]): string {
  // dynamic limit, to never omit just one field
  const limit = names.length === 6 ? 6 : 5;
  let display = names
    .slice(0, limit)
    .map((n) => `\`${Symbol.as_str(n)}\``)
    .join(", ");
  if (names.length > limit) {
    display = `${display} ... and ${names.length - limit} others`;
  }
  return display;
};

/// Find the position of a field named `ident` in `base_def`, accounting for unnammed fields.
/// Return whether such a field has been found. The path to it is stored in `nested_fields`.
/// `ident` must have been adjusted beforehand.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:2719 find_adt_field
FnCtxt.prototype.find_adt_field = function (this: FnCtxt, base_def: AdtDef, ident: Ident): [FieldIdx, FieldDef] | undefined {
  // No way to find a field in an enum.
  if (base_def.is_enum()) {
    return undefined;
  }

  const fields = base_def.non_enum_variant().fields;
  for (let field_idx = 0; field_idx < fields.length; field_idx++) {
    const field = fields[field_idx]!;
    if (field.ident(this.tcx).normalize_to_macros_2_0().eq(ident)) {
      // We found the field we wanted.
      return [field_idx as FieldIdx, field];
    }
  }

  return undefined;
};

/// Check field access expressions, this works for both structs and tuples.
/// Returns the Ty of the field.
///
/// ```ignore (illustrative)
/// base.field
/// ^^^^^^^^^^ expr
/// ^^^^       base
///      ^^^^^ field
/// ```
// rustc: compiler/rustc_hir_typeck/src/expr.rs:2748 check_expr_field
FnCtxt.prototype.check_expr_field = function (
  this: FnCtxt,
  expr: hir.Expr,
  base: hir.Expr,
  field: Ident,
  // The expected type hint of the field.
  expected: Expectation,
): Ty {
  // debug!("check_field(expr: {:?}, base: {:?}, field: {:?})", expr, base, field);
  const base_ty_ = this.check_expr(base);
  const base_ty = this.structurally_resolve_type(base.span, base_ty_);

  // Whether we are trying to access a private field. Used for error reporting.
  let private_candidate: [Adjustment[], DefId] | undefined = undefined;

  // Field expressions automatically deref
  const autoderef = this.autoderef(expr.span, base_ty);
  let step: [Ty, number] | undefined;
  while ((step = autoderef.next()) !== undefined) {
    const [deref_base_ty] = step;
    // debug!("deref_base_ty: {:?}", deref_base_ty);
    const k = deref_base_ty.kind();
    if (k.$ === "Adt" && !k._0.is_enum()) {
      const base_def = k._0;
      const args = k._1;
      // debug!("struct named {:?}", deref_base_ty);
      // we don't care to report errors for a struct if the struct itself is tainted
      const has_errors = base_def.non_enum_variant().has_errors();
      if (has_errors.$ === "Err") {
        return Ty.new_error(this.tcx, has_errors._0);
      }

      const [ident, def_scope] = this.tcx.adjust_ident_and_get_scope(field, base_def.did(), this.mod_id);

      const found = this.find_adt_field(base_def, ident);
      if (found !== undefined) {
        const [idx, field_] = found;
        this.write_field_index(expr.hir_id, idx);

        const adjustments = this.adjust_steps(autoderef);
        if (Visibility.is_accessible_from(field_.vis, def_scope, this.tcx)) {
          this.apply_adjustments(base, adjustments);
          this.register_predicates(autoderef.into_obligations());

          this.tcx.check_stability(field_.did, expr.hir_id, expr.span, undefined);
          return this.field_ty(expr.span, field_, args);
        }

        // The field is not accessible, fall through to error reporting.
        private_candidate = [adjustments, base_def.did()];
      }
    } else if (k.$ === "Tuple") {
      const tys = k._0;
      const index = parse_usize(field.as_str());
      if (index !== undefined) {
        if (field.name === sym.integer(index)) {
          const field_ty = index < BigInt(tys.length) ? tys[Number(index)] : undefined;
          if (field_ty !== undefined) {
            const adjustments = this.adjust_steps(autoderef);
            this.apply_adjustments(base, adjustments);
            this.register_predicates(autoderef.into_obligations());

            this.write_field_index(expr.hir_id, FieldIdx_from_usize(Number(index)));
            return field_ty;
          }
        }
      }
    }
  }
  // We failed to check the expression, report an error.

  // Emits an error if we deref an infer variable, like calling `.field` on a base type
  // of `&_`. We can also use this to suppress unnecessary "missing field" errors that
  // will follow ambiguity errors.
  const final_ty = this.structurally_resolve_type(autoderef.span(), autoderef.final_ty());
  if (final_ty.kind().$ === "Error") {
    return final_ty;
  }

  if (private_candidate !== undefined) {
    const [adjustments, did] = private_candidate;
    // (#90483) apply adjustments to avoid ExprUseVisitor from
    // creating erroneous projection.
    this.apply_adjustments(base, adjustments);
    const guar = this.ban_private_field_access(expr, base_ty, field, did, Expectation.only_has_type(expected, this));
    return Ty.new_error(this.tcx, guar);
  }

  let guar: ErrorGuaranteed;
  if (this.method_exists_for_diagnostic(field, base_ty, expr.hir_id, Expectation.only_has_type(expected, this))) {
    // If taking a method instead of calling it
    guar = this.ban_take_value_of_method(expr, base_ty, field);
  } else if (!base_ty.is_primitive_ty()) {
    guar = this.ban_nonexisting_field(field, base, expr, base_ty);
  } else {
    const field_name = display_Ident(field);
    const err = type_error_struct(
      this.dcx(),
      field.span,
      base_ty,
      E0610,
      `\`${display_Ty(base_ty)}\` is a primitive type and therefore doesn't have fields`,
    );
    const is_valid_suffix = (field: string): boolean => {
      if (field === "f32" || field === "f64") {
        return true;
      }
      // PORT: `field.chars().peekable()`: the code points and a cursor.
      const chars = [...field].map((c) => c.codePointAt(0)!);
      let pos = 0;
      const c0 = chars[pos];
      if (c0 === ch("e") || c0 === ch("E")) {
        pos++;
        const c = chars[pos];
        if (c !== undefined && !is_numeric(c) && c !== ch("-") && c !== ch("+")) {
          return false;
        }
        let c2: number | undefined;
        while ((c2 = chars[pos]) !== undefined) {
          if (!is_numeric(c2)) {
            break;
          }
          pos++;
        }
      }
      const suffix = String.fromCodePoint(...chars.slice(pos));
      return suffix.length === 0 || suffix === "f32" || suffix === "f64";
    };
    const maybe_partial_suffix = (field: string): string | undefined => {
      const first_chars = [ch("f"), ch("l")];
      const lower = field.toLowerCase();
      if (
        utf8_len(field) >= 1 &&
        lower.length > 0 &&
        first_chars.includes(lower.codePointAt(0)!) &&
        [...str_from_byte(field, 1)].every((c) => is_ascii_digit(c.codePointAt(0)!))
      ) {
        if (lower.codePointAt(0) === ch("f")) {
          return "f32";
        } else {
          return "f64";
        }
      } else {
        return undefined;
      }
    };
    const bk = base_ty.kind();
    if (
      bk.$ === "Infer" &&
      bk._0.$ === "IntVar" &&
      base.kind.$ === "Lit" &&
      base.kind._0.node.$ === "Int" &&
      base.kind._0.node._1.$ === "Unsuffixed" &&
      !Span.from_expansion(base.span)
    ) {
      let correct_suffix: string | undefined;
      if (is_valid_suffix(field_name)) {
        err.span_suggestion_verbose(
          Span.shrink_to_lo(field.span),
          "if intended to be a floating point literal, consider adding a `0` after the period",
          "0",
          Applicability.MaybeIncorrect,
        );
      } else if ((correct_suffix = maybe_partial_suffix(field_name)) !== undefined) {
        err.span_suggestion_verbose(
          field.span,
          `if intended to be a floating point literal, consider adding a \`0\` after the period and a \`${correct_suffix}\` suffix`,
          `0${correct_suffix}`,
          Applicability.MaybeIncorrect,
        );
      }
    }
    guar = err.emit_err();
  }

  return Ty.new_error(this.tcx, guar);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2921 suggest_await_on_field_access
FnCtxt.prototype.suggest_await_on_field_access = function (this: FnCtxt, err: Diag, field_ident: Ident, base: hir.Expr, ty: Ty): void {
  const output_ty = this.tcx.get_impl_future_output_ty(ty);
  if (output_ty === undefined) {
    err.span_label(field_ident.span, "unknown field");
    return;
  }
  const k = output_ty.kind();
  if (k.$ !== "Adt") {
    err.span_label(field_ident.span, "unknown field");
    return;
  }
  const def = k._0;
  // no field access on enum type
  if (def.is_enum()) {
    err.span_label(field_ident.span, "unknown field");
    return;
  }
  if (!def.non_enum_variant().fields.some((field) => field.ident(this.tcx).eq(field_ident))) {
    err.span_label(field_ident.span, "unknown field");
    return;
  }
  err.span_label(field_ident.span, "field not available in `impl Future`, but it is available in its `Output`");
  const coroutine_kind = this.tcx.coroutine_kind(this.body_def_id) as hir.CoroutineKind | undefined;
  if (coroutine_kind !== undefined && coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
    err.span_suggestion_verbose(
      Span.shrink_to_hi(base.span),
      "consider `await`ing on the `Future` to access the field",
      ".await",
      Applicability.MaybeIncorrect,
    );
  } else {
    const span: MultiSpan = MultiSpan.from_span(base.span);
    span.push_span_label(this.tcx.def_span(this.body_def_id), "this is not `async`");
    err.span_note(
      span,
      "this implements `Future` and its output type has the field, but the future cannot be awaited in a synchronous function",
    );
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:2970 ban_nonexisting_field
FnCtxt.prototype.ban_nonexisting_field = function (this: FnCtxt, ident: Ident, base: hir.Expr, expr: hir.Expr, base_ty: Ty): ErrorGuaranteed {
  // debug!(
  //     "ban_nonexisting_field: field={:?}, base={:?}, expr={:?}, base_ty={:?}",
  //     ident, base, expr, base_ty
  // );
  const err = this.no_such_field_err(ident, base_ty, expr);

  const k = base_ty.peel_refs().kind();
  if (k.$ === "Array") {
    const len = k._1;
    this.maybe_suggest_array_indexing(err, base, ident, len);
  } else if (k.$ === "RawPtr") {
    this.suggest_first_deref_field(err, base, ident);
  } else if (k.$ === "Param") {
    const param_ty = k._0;
    err.span_label(ident.span, "unknown field");
    this.point_at_param_definition(err, param_ty);
  } else if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
    this.suggest_await_on_field_access(err, ident, base, base_ty.peel_refs());
  } else {
    err.span_label(ident.span, "unknown field");
  }

  this.suggest_fn_call(err, base, base_ty, (output_ty) => {
    const ok = output_ty.kind();
    let idx: bigint | undefined;
    if (ok.$ === "Adt" && !ok._0.is_enum()) {
      const def = ok._0;
      return def
        .non_enum_variant()
        .fields.some((field) => field.ident(this.tcx).eq(ident) && Visibility.is_accessible_from(field.vis, expr.hir_id.owner.def_id, this.tcx));
    } else if (ok.$ === "Tuple" && (idx = parse_usize(ident.as_str())) !== undefined) {
      const tys = ok._0;
      return idx < BigInt(tys.length);
    } else {
      return false;
    }
  });

  if (ident.name === kw.Await) {
    // We know by construction that `<expr>.await` is either on Rust 2015
    // or results in `ExprKind::Await`. Suggest switching the edition to 2018.
    err.note("to `.await` a `Future`, switch to Rust 2018 or later");
    HelpUseLatestEdition_add_to_diag(HelpUseLatestEdition_new(), err);
  }

  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3029 ban_private_field_access
FnCtxt.prototype.ban_private_field_access = function (
  this: FnCtxt,
  expr: hir.Expr,
  expr_t: Ty,
  field: Ident,
  base_did: DefId,
  return_ty: Ty | undefined,
): ErrorGuaranteed {
  const err = this.private_field_err(field, base_did);

  // Also check if an accessible method exists, which is often what is meant.
  if (this.method_exists_for_diagnostic(field, expr_t, expr.hir_id, return_ty) && !this.expr_in_place(expr.hir_id)) {
    this.suggest_method_call(
      err,
      DiagMessage.from_String(`a method \`${display_Ident(field)}\` also exists, call it with parentheses`),
      field,
      expr_t,
      expr,
      undefined,
    );
  }
  return err.emit_err();
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3055 ban_take_value_of_method
FnCtxt.prototype.ban_take_value_of_method = function (this: FnCtxt, expr: hir.Expr, expr_t: Ty, field: Ident): ErrorGuaranteed {
  const err = type_error_struct(
    this.dcx(),
    field.span,
    expr_t,
    E0615,
    `attempted to take value of method \`${display_Ident(field)}\` on type \`${display_Ty(expr_t)}\``,
  );
  err.span_label(field.span, "method, not a field");
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  let expr_is_call: boolean;
  if (parent.$ === "Expr" && parent._0.kind.$ === "Call") {
    const callee = parent._0.kind._0;
    expr_is_call = HirId_eq(expr.hir_id, callee.hir_id);
  } else {
    expr_is_call = false;
  }
  const snippet = this.tcx.sess.source_map().span_to_snippet(expr.span);
  const expr_snippet = snippet.$ === "Ok" ? snippet._0.toString() : "";
  const is_wrapped = expr_snippet.startsWith("(") && expr_snippet.endsWith(")");
  const after_open = BytePos(Span.lo(expr.span) + 1);
  const before_close = BytePos(Span.hi(expr.span) - 1);

  if (expr_is_call && is_wrapped) {
    err.multipart_suggestion(
      "remove wrapping parentheses to call the method",
      [
        [Span.with_hi(expr.span, after_open), ""],
        [Span.with_lo(expr.span, before_close), ""],
      ],
      Applicability.MachineApplicable,
    );
  } else if (!this.expr_in_place(expr.hir_id)) {
    // Suggest call parentheses inside the wrapping parentheses
    const span = is_wrapped ? Span.with_hi(Span.with_lo(expr.span, after_open), before_close) : expr.span;
    this.suggest_method_call(err, DiagMessage.from_str("use parentheses to call the method"), field, expr_t, expr, span);
  } else {
    // `let ty::RawPtr(ptr_ty, _) = expr_t.kind() && let ty::Adt(adt_def, _) = ptr_ty.kind()
    //  && let ExprKind::Field(base_expr, _) = expr.kind && let [variant] = &adt_def.variants().raw
    //  && variant.fields.iter().any(|f| f.ident(self.tcx) == field)`
    const base_expr = ((): hir.Expr | undefined => {
      const ek = expr_t.kind();
      if (ek.$ !== "RawPtr") return undefined;
      const pk = ek._0.kind();
      if (pk.$ !== "Adt") return undefined;
      const adt_def = pk._0;
      if (expr.kind.$ !== "Field") return undefined;
      const base_expr = expr.kind._0;
      const variants = adt_def.variants();
      if (variants.length !== 1) return undefined;
      const variant = variants[0]!;
      if (!variant.fields.some((f) => f.ident(this.tcx).eq(field))) return undefined;
      return base_expr;
    })();
    if (base_expr !== undefined) {
      err.multipart_suggestion(
        "to access the field, dereference first",
        [
          [Span.shrink_to_lo(base_expr.span), "(*"],
          [Span.shrink_to_hi(base_expr.span), ")"],
        ],
        Applicability.MaybeIncorrect,
      );
    } else {
      err.help("methods are immutable and cannot be assigned to");
    }
  }

  // See `StashKey::GenericInFieldExpr` for more info
  return this.dcx().try_steal_replace_and_emit_err(field.span, StashKey.GenericInFieldExpr, err);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3129 point_at_param_definition
FnCtxt.prototype.point_at_param_definition = function (this: FnCtxt, err: Diag, param: ParamTy): void {
  const generics = this.tcx.generics_of(this.body_def_id) as Generics;
  const generic_param = generics.type_param(param, this.tcx);
  if (generic_param.kind.$ === "Type" && generic_param.kind.synthetic) {
    return;
  }
  const param_def_id = generic_param.def_id;
  const x = param_def_id.as_local();
  if (x === undefined) {
    return;
  }
  const param_hir_id = this.tcx.local_def_id_to_hir_id(x);
  const param_span = this.tcx.hir_span(param_hir_id);
  const param_name = this.tcx.hir_ty_param_name(param_def_id.expect_local());

  err.span_label(param_span, `type parameter '${Symbol.as_str(param_name)}' declared here`);
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3146 maybe_suggest_array_indexing
FnCtxt.prototype.maybe_suggest_array_indexing = function (this: FnCtxt, err: Diag, base: hir.Expr, field: Ident, len_: Const): void {
  err.span_label(field.span, "unknown field");
  const len = this.try_structurally_resolve_const(base.span, len_).try_to_target_usize(this.tcx);
  const user_index = parse_u64(field.as_str());
  if (len !== undefined && user_index !== undefined) {
    const help = "instead of using tuple indexing, use array indexing";
    const applicability = BigInt(len) < user_index ? Applicability.MachineApplicable : Applicability.MaybeIncorrect;
    err.multipart_suggestion(
      help,
      [
        [Span.between(base.span, field.span), "["],
        [Span.shrink_to_hi(field.span), "]"],
      ],
      applicability,
    );
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3175 suggest_first_deref_field
FnCtxt.prototype.suggest_first_deref_field = function (this: FnCtxt, err: Diag, base: hir.Expr, field: Ident): void {
  err.span_label(field.span, "unknown field");
  if (Span.from_expansion(base.span) || Span.from_expansion(field.span)) {
    return;
  }
  const snippet = this.tcx.sess.source_map().span_to_snippet(base.span);
  let val: string;
  if (snippet.$ === "Ok" && snippet._0.len() < 20) {
    const base_ = snippet._0.toString();
    val = `\`${base_}\``;
  } else {
    val = "the value";
  }
  err.multipart_suggestion(
    `${val} is a raw pointer; try dereferencing it`,
    [
      [Span.shrink_to_lo(base.span), "(*"],
      [Span.between(base.span, field.span), ")."],
    ],
    Applicability.MaybeIncorrect,
  );
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3197 no_such_field_err
FnCtxt.prototype.no_such_field_err = function (this: FnCtxt, field: Ident, base_ty: Ty, expr: hir.Expr): Diag {
  const span = field.span;
  // debug!("no_such_field_err(span: {:?}, field: {:?}, expr_t: {:?})", span, field, base_ty);

  const err = this.dcx().create_err(NoFieldOnType_diagnostic({ span, ty: base_ty, field }));
  if (TypeVisitableExt.references_error(base_ty, fold_Ty)) {
    err.downgrade_to_delayed_bug();
  }

  const within_macro_span = Span.within_macro(span, expr.span, this.tcx.sess.source_map());
  if (within_macro_span !== undefined) {
    err.span_label(within_macro_span, "due to this macro variable");
  }

  // Check if there is an associated function with the same name.
  const def_id = base_ty.peel_refs().ty_adt_def()?.did();
  if (def_id !== undefined) {
    for (const impl_def_id of this.tcx.inherent_impls(def_id)) {
      for (const item of AssocItems.in_definition_order(this.tcx.associated_items(impl_def_id) as AssocItems)) {
        if (expr.kind.$ === "Field" && AssocItem.name(item) === field.name && item.kind.$ === "Fn" && !item.kind.has_self) {
          const base_expr = expr.kind._0;
          err.span_label(field.span, "this is an associated function, not a method");
          err.note("found the following associated function; to be used as method, it must have a `self` parameter");
          const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_def_id) as EarlyBinder<Ty>));
          err.span_note(this.tcx.def_span(item.def_id), `the candidate is defined in an impl for the type \`${display_Ty(impl_ty)}\``);

          const pk = base_ty.peel_refs().kind();
          const ty_str = pk.$ === "Adt" ? this.tcx.def_path_str_with_args(pk._0.did(), pk._1) : display_Ty(base_ty.peel_refs());
          err.multipart_suggestion(
            "use associated function syntax instead",
            [
              [base_expr.span, ty_str],
              [Span.between(base_expr.span, field.span), "::"],
            ],
            Applicability.MaybeIncorrect,
          );
          return err;
        }
      }
    }
  }

  // try to add a suggestion in case the field is a nested field of a field of the Adt
  let ty: Ty;
  let unwrap_: string;
  const bk = base_ty.kind();
  let arg_ty: Ty | undefined;
  if (
    bk.$ === "Adt" &&
    (this.tcx.is_diagnostic_item(sym.Result, bk._0.did()) || this.tcx.is_diagnostic_item(sym.Option, bk._0.did())) &&
    bk._1.length > 0 &&
    (arg_ty = GenericArg.as_type(bk._1[0]!)) !== undefined
  ) {
    [ty, unwrap_] = [arg_ty, "unwrap()."];
  } else {
    [ty, unwrap_] = [base_ty, ""];
  }
  for (const found_fields of this.get_field_candidates_considering_privacy_for_diag(span, ty)) {
    const field_names = found_fields.map((field) => field[0].name);
    const candidate_fields: string[] = [];
    for (const candidate_field of found_fields) {
      const field_path = this.check_for_nested_field_satisfying_condition_for_diag(
        span,
        (candidate_field, _) => candidate_field.eq(field),
        candidate_field,
        [],
      );
      if (field_path === undefined) continue;
      field_path.pop();
      candidate_fields.push(field_path.map((id) => `${display_Ident(id)}.`).join(""));
    }
    candidate_fields.sort(str_cmp);

    const len = candidate_fields.length;
    // Don't suggest `.field` if the base expr is from a different
    // syntax context than the field.
    let field_name: Symbol | undefined;
    if (len > 0 && Span.eq_ctxt(expr.span, field.span)) {
      err.span_suggestions(
        Span.shrink_to_lo(field.span),
        `${len > 1 ? "some" : "one"} of the expressions' fields ${len > 1 ? "have" : "has"} a field of the same name`,
        candidate_fields.map((path) => `${unwrap_}${path}`),
        Applicability.MaybeIncorrect,
      );
    } else if (
      (field_name = find_best_match_for_name(field_names, field.name, undefined)) !== undefined &&
      !(parse_usize(Symbol.as_str(field.name)) !== undefined && parse_usize(Symbol.as_str(field_name)) !== undefined)
    ) {
      err.span_suggestion_verbose(
        field.span,
        "a field with a similar name exists",
        `${unwrap_}${Symbol.as_str(field_name)}`,
        Applicability.MaybeIncorrect,
      );
    } else if (field_names.length !== 0) {
      const is = field_names.length === 1 ? " is" : "s are";
      err.note(`available field${is}: ${this.name_series_display(field_names)}`);
    }
  }
  return err;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3315 private_field_err
FnCtxt.prototype.private_field_err = function (this: FnCtxt, field: Ident, base_did: DefId): Diag {
  const struct_path = this.tcx.def_path_str(base_did);
  const kind_name = this.tcx.def_descr(base_did);
  return struct_span_code_err(
    this.dcx(),
    field.span,
    E0616,
    `field \`${display_Ident(field)}\` of ${kind_name} \`${struct_path}\` is private`,
  ).with_span_label(field.span, "private field");
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3327 get_field_candidates_considering_privacy_for_diag
FnCtxt.prototype.get_field_candidates_considering_privacy_for_diag = function (this: FnCtxt, span: Span, base_ty: Ty): [Ident, Ty][][] {
  // debug!("get_field_candidates(span: {:?}, base_t: {:?}", span, base_ty);

  const autoderef = this.autoderef(span, base_ty).silence_errors();
  const deref_chain: [Ty, number][] = [];
  let step: [Ty, number] | undefined;
  while ((step = autoderef.next()) !== undefined) deref_chain.push(step);

  // Don't probe if we hit the recursion limit, since it may result in
  // quadratic blowup if we then try to further deref the results of this
  // function. This is a best-effort method, after all.
  if (autoderef.reached_recursion_limit()) {
    return [];
  }

  const result: [Ident, Ty][][] = [];
  for (const [base_t] of deref_chain) {
    const k = base_t.kind();
    if (k.$ === "Adt" && !k._0.is_enum()) {
      const base_def = k._0;
      const args = k._1;
      const tcx = this.tcx;
      const fields = base_def.non_enum_variant().fields;
      // Some struct, e.g. some that impl `Deref`, have all private fields
      // because you're expected to deref them to access the _real_ fields.
      // This, for example, will help us suggest accessing a field through a `Box<T>`.
      if (fields.every((field) => !Visibility.is_accessible_from(field.vis, this.mod_id, tcx))) {
        continue;
      }
      // PORT: `.filter(..).take(100).map(..)` (lazy): the loop stops once 100 fields are taken.
      const candidates: [Ident, Ty][] = [];
      for (const field of fields) {
        // For compile-time reasons put a limit on number of fields we search
        if (candidates.length >= 100) break;
        if (!(Visibility.is_accessible_from(field.vis, this.mod_id, tcx) && this.is_field_suggestable(field, span))) continue;
        candidates.push([field.ident(this.tcx).normalize_to_macros_2_0(), Unnormalized.skip_norm_wip(field.ty(this.tcx, args))]);
      }
      result.push(candidates);
    } else if (k.$ === "Tuple") {
      const types = k._0;
      result.push(
        types
          // For compile-time reasons put a limit on number of fields we search
          .slice(0, 100)
          .map((ty, i): [Ident, Ty] => [Ident.from_str(`${i}`), ty]),
      );
    }
  }
  return result;
};

/// This method is called after we have encountered a missing field error to recursively
/// search for the field
// #[instrument(skip(self, matches), level = "debug")]
// rustc: compiler/rustc_hir_typeck/src/expr.rs:3398 check_for_nested_field_satisfying_condition_for_diag
FnCtxt.prototype.check_for_nested_field_satisfying_condition_for_diag = function (
  this: FnCtxt,
  span: Span,
  matches: (_1: Ident, _2: Ty) => boolean,
  [candidate_name, candidate_ty]: [Ident, Ty],
  field_path: Ident[],
): Ident[] | undefined {
  if (field_path.length > 3) {
    // For compile-time reasons and to avoid infinite recursion we only check for fields
    // up to a depth of three
    return undefined;
  }
  field_path.push(candidate_name);
  if (matches(candidate_name, candidate_ty)) {
    return field_path;
  }
  for (const nested_fields of this.get_field_candidates_considering_privacy_for_diag(span, candidate_ty)) {
    // recursively search fields of `candidate_field` if it's a ty::Adt
    for (const field of nested_fields) {
      const field_path_ = this.check_for_nested_field_satisfying_condition_for_diag(span, matches, field, field_path.slice());
      if (field_path_ !== undefined) {
        return field_path_;
      }
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3432 check_expr_index
FnCtxt.prototype.check_expr_index = function (this: FnCtxt, base: hir.Expr, idx: hir.Expr, expr: hir.Expr, brackets_span: Span): Ty {
  const base_t_ = this.check_expr(base);
  const idx_t = this.check_expr(idx);

  if (TypeVisitableExt.references_error(base_t_, fold_Ty)) {
    return base_t_;
  } else if (TypeVisitableExt.references_error(idx_t, fold_Ty)) {
    return idx_t;
  } else {
    const base_t = this.structurally_resolve_type(base.span, base_t_);
    const r = this.lookup_indexing(expr, base, base_t, idx, idx_t);
    if (r !== undefined) {
      const [index_ty, element_ty] = r;
      // two-phase not needed because index_ty is never mutable
      this.demand_coerce(idx, idx_t, index_ty, undefined, AllowTwoPhase.No);
      this.select_obligations_where_possible((errors) => {
        this.point_at_index(errors, idx.span);
      });
      return element_ty;
    } else {
      // Attempt to *shallowly* search for an impl which matches,
      // but has nested obligations which are unsatisfied.
      for (const [base_t_] of this.autoderef(base.span, base_t).silence_errors()) {
        const found = this.find_and_report_unsatisfied_index_impl(base, base_t_);
        if (found !== undefined) {
          const [, index_ty, element_ty] = found;
          this.demand_coerce(idx, idx_t, index_ty, undefined, AllowTwoPhase.No);
          return element_ty;
        }
      }

      const err = type_error_struct(
        this.dcx(),
        brackets_span,
        base_t,
        E0608,
        `cannot index into a value of type \`${display_Ty(base_t)}\``,
      );
      // Try to give some advice about indexing tuples.
      const bk = base_t.kind();
      if (bk.$ === "Tuple") {
        const types = bk._0;
        err.help("tuples are indexed with a dot and a literal index: `tuple.0`, `tuple.1`, etc.");
        // If index is an unsuffixed integer, show the fixed expression:
        if (idx.kind.$ === "Lit") {
          const lit = idx.kind._0;
          if (lit.node.$ === "Int" && lit.node._1.$ === "Unsuffixed" && lit.node._0 < BigInt(types.length)) {
            const i = lit.node._0;
            err.span_suggestion(brackets_span, `to access tuple element \`${i}\`, use`, `.${i}`, Applicability.MachineApplicable);
          }
        }
      }

      if (base_t.is_raw_ptr() && idx_t.is_integral()) {
        err.multipart_suggestion(
          "consider using `wrapping_add` or `add` for indexing into raw pointer",
          [
            [Span.between(base.span, idx.span), ".wrapping_add("],
            [Span.until(Span.shrink_to_hi(idx.span), Span.shrink_to_hi(expr.span)), ")"],
          ],
          Applicability.MaybeIncorrect,
        );
      }

      const guar = err.emit_err();
      return Ty.new_error(this.tcx, guar);
    }
  }
};

/// Try to match an implementation of `Index` against a self type, and report
/// the unsatisfied predicates that result from confirming this impl.
///
/// Given an index expression, sometimes the `Self` type shallowly but does not
/// deeply satisfy an impl predicate. Instead of simply saying that the type
/// does not support being indexed, we want to point out exactly what nested
/// predicates cause this to be, so that the user can add them to fix their code.
// rustc: compiler/rustc_hir_typeck/src/expr.rs:3523 find_and_report_unsatisfied_index_impl
FnCtxt.prototype.find_and_report_unsatisfied_index_impl = function (
  this: FnCtxt,
  base_expr: hir.Expr,
  base_ty: Ty,
): [ErrorGuaranteed, Ty, Ty] | undefined {
  const index_trait_def_id = this.tcx.lang_items().index_trait();
  if (index_trait_def_id === undefined) return undefined;
  const index_trait_output_def_id = this.tcx.get_diagnostic_item(sym.IndexOutput);
  if (index_trait_output_def_id === undefined) return undefined;

  const relevant_impls: DefId[] = [];
  this.tcx.for_each_relevant_impl(
    index_trait_def_id,
    base_ty,
    (impl_def_id) => {
      relevant_impls.push(impl_def_id);
    },
    VisitorResult.unit,
  );
  if (relevant_impls.length !== 1) {
    // Only report unsatisfied impl predicates if there's one impl
    return undefined;
  }
  const impl_def_id = relevant_impls[0]!;

  const r = this.commit_if_ok((snapshot): Result<[ErrorGuaranteed, Ty, Ty], NoSolution> => {
    const outer_universe = this.universe();

    const ocx = ObligationCtxt.new_with_diagnostics(this.infcx);
    const impl_args = this.fresh_args_for_item(base_expr.span, impl_def_id);
    const impl_trait_ref_ = EarlyBinder.instantiate(this.tcx.impl_trait_ref(impl_def_id), this.tcx, impl_args, fold_TraitRef);
    const cause = this.misc(base_expr.span);

    // Match the impl self type against the base ty. If this fails,
    // we just skip this impl, since it's not particularly useful.
    const impl_trait_ref = ocx.normalize(cause, this.param_env, impl_trait_ref_, fold_TraitRef);
    const eq = ocx.eq(cause, this.param_env, base_ty, TraitRef.self_ty(impl_trait_ref), ToTrace_Ty);
    // PORT: `?` on `Result<(), TypeError>` inside a closure returning `Result<_, NoSolution>` (`From<TypeError> for
    // NoSolution`).
    if (eq.$ === "Err") return Err(NoSolution_from_TypeError(eq._0));

    // Register the impl's predicates. One of these predicates
    // must be unsatisfied, or else we wouldn't have gotten here
    // in the first place.
    const unnormalized_clauses = GenericClauses.instantiate(this.tcx.clauses_of(impl_def_id) as GenericClauses, this.tcx, impl_args);
    ocx.register_obligations(
      predicates_for_generics(
        (idx, span) =>
          clone_ObligationCause(cause).derived_cause(
            Binder.dummy<TraitClause>(
              {
                trait_ref: impl_trait_ref,
                polarity: ClausePolarity.Positive,
              },
              fold_TraitClause,
            ),
            (derived): ObligationCauseCode => ({
              $: "ImplDerived",
              _0: {
                derived,
                impl_or_alias_def_id: impl_def_id,
                impl_def_clause_index: idx,
                span,
              },
            }),
          ),
        (clause) => ocx.normalize(cause, this.param_env, clause, fold_Clause),
        this.param_env,
        unnormalized_clauses,
      ),
    );

    // Normalize the output type, which we can use later on as the
    // return type of the index expression...
    const element_ty = ocx.normalize(
      cause,
      this.param_env,
      Unnormalized.new(Ty.new_projection_from_args(this.tcx, IsRigid.No, index_trait_output_def_id, impl_trait_ref.args)),
      fold_Ty,
    );

    const true_errors = ocx.try_evaluate_obligations();

    // Do a leak check -- we can't really report a useful error here,
    // but it at least avoids an ICE when the error has to do with higher-ranked
    // lifetimes.
    const leak = this.leak_check(outer_universe, snapshot);
    if (leak.$ === "Err") return Err(NoSolution_from_TypeError(leak._0));

    // Bail if we have ambiguity errors, which we can't report in a useful way.
    const ambiguity_errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (TraitErrors.no_errors(true_errors) && TraitErrors.has_errors(ambiguity_errors)) {
      return Err(NO_SOLUTION);
    }

    // There should be at least one error reported. If not, we
    // will still delay a span bug in `report_fulfillment_errors`.
    return Ok<[ErrorGuaranteed, Ty, Ty]>([
      err_ctxt_view(this).report_fulfillment_errors(TraitErrors.into_thin_vec(true_errors)),
      impl_trait_ref.args.type_at(1),
      element_ty,
    ]);
  });
  return r.$ === "Ok" ? r._0 : undefined;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3618 point_at_index
FnCtxt.prototype.point_at_index = function (this: FnCtxt, errors: FulfillmentError[], span: Span): void {
  // PORT: `FxHashSet<PredicateKind>`: `PredicateKind` is a value (not interned), so the set is keyed by its `Eq`
  // (`intern_key`).
  const seen_preds = new KeyedSet<PredicateKind>(intern_key);
  // We re-sort here so that the outer most root obligations comes first, as we have the
  // subsequent weird logic to identify *every* relevant obligation for proper deduplication
  // of diagnostics.
  // PORT: `sort_by_key` is stable, as `Array.prototype.sort`.
  errors.sort((a, b) => a.root_obligation.recursion_depth - b.root_obligation.recursion_depth);
  for (const error of errors) {
    const root = Binder.skip_binder(error.root_obligation.predicate.kind());
    const pred = Binder.skip_binder(error.obligation.predicate.kind());
    if (
      root.$ === "Clause" &&
      root._0.$ === "Trait" &&
      this.tcx.is_lang_item(root._0._0.trait_ref.def_id, LangItem.Index)
    ) {
      seen_preds.add(Binder.skip_binder(error.obligation.predicate.kind()));
    } else if (
      pred.$ === "Clause" &&
      pred._0.$ === "Trait" &&
      this.tcx.is_diagnostic_item(sym.SliceIndex, pred._0._0.trait_ref.def_id)
    ) {
      seen_preds.add(Binder.skip_binder(error.obligation.predicate.kind()));
    } else if (seen_preds.has(pred) || seen_preds.has(root)) {
      // nothing
    } else {
      continue;
    }
    // PORT: the cause is owned by the obligation in Rust; it is cloned before the span is overwritten so that no
    // other obligation sharing the TS object sees the change.
    error.obligation.cause = clone_ObligationCause(error.obligation.cause);
    error.obligation.cause.span = span;
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3646 check_expr_yield
FnCtxt.prototype.check_expr_yield = function (this: FnCtxt, value: hir.Expr, expr: hir.Expr): Ty {
  const coroutine_types = this.coroutine_types;
  if (coroutine_types !== undefined) {
    const { resume_ty, yield_ty } = coroutine_types;
    this.check_expr_coercible_to_type(value, yield_ty, undefined);

    return resume_ty;
  } else {
    this.dcx().emit_err(YieldExprOutsideOfCoroutine_diagnostic({ span: expr.span }));
    // Avoid expressions without types during writeback (#78653).
    this.check_expr(value);
    return this.tcx.types.unit;
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3666 check_expr_asm_operand
FnCtxt.prototype.check_expr_asm_operand = function (this: FnCtxt, expr: hir.Expr, is_input: boolean): void {
  const needs = is_input ? Needs.None : Needs.MutPlace;
  const ty_ = this.check_expr_with_needs(expr, needs);
  this.require_type_is_sized(ty_, expr.span, ObligationCauseCode.InlineAsmSized);

  if (!is_input && !expr.is_syntactic_place_expr()) {
    this.dcx().struct_span_err(expr.span, "invalid asm output").with_span_label(expr.span, "cannot assign to this expression").emit();
  }

  // If this is an input value, we require its type to be fully resolved
  // at this point. This allows us to provide helpful coercions which help
  // pass the type candidate list in a later pass.
  //
  // We don't require output types to be resolved at this point, which
  // allows them to be inferred based on how they are used later in the
  // function.
  if (is_input) {
    const ty = this.structurally_resolve_type(expr.span, ty_);
    const k = ty.kind();
    switch (k.$) {
      case "FnDef": {
        const fnptr_ty = Ty.new_fn_ptr(this.tcx, ty.fn_sig(this.tcx));
        this.demand_coerce(expr, ty, fnptr_ty, undefined, AllowTwoPhase.No);
        break;
      }
      case "Ref": {
        const base_ty = k._1;
        const mutbl = k._2;
        const ptr_ty = Ty.new_ptr(this.tcx, base_ty, mutbl);
        this.demand_coerce(expr, ty, ptr_ty, undefined, AllowTwoPhase.No);
        break;
      }
      default:
        break;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3701 check_expr_asm
FnCtxt.prototype.check_expr_asm = function (this: FnCtxt, asm: hir.InlineAsm, span: Span): Ty {
  if (asm.asm_macro === "NakedAsm") {
    if (find_attr(HasAttrs_LocalDefId.get_attrs(this.body_def_id, this.tcx), (k) => (k.$ === "Naked" ? null : undefined)) === undefined) {
      this.tcx.dcx().emit_err(NakedAsmOutsideNakedFn_diagnostic({ span }));
    }
  }

  let diverge = AsmMacro.diverges(asm.asm_macro, asm.options);

  for (const [op, _op_sp] of asm.operands) {
    switch (op.$) {
      case "In": {
        this.check_expr_asm_operand(op.expr, true);
        break;
      }
      case "Out":
      case "InOut": {
        if (op.expr !== undefined) {
          this.check_expr_asm_operand(op.expr, false);
        }
        break;
      }
      case "SplitInOut": {
        this.check_expr_asm_operand(op.in_expr, true);
        if (op.out_expr !== undefined) {
          this.check_expr_asm_operand(op.out_expr, false);
        }
        break;
      }
      case "Const": {
        const anon_const = op.anon_const;
        // This is mostly similar to type-checking of inline const expressions `const { ... }`, however
        // asm const has special coercion rules (per RFC 3848) where function items and closures are coerced to
        // function pointers (while pointers and integer remain as-is).
        const body = this.tcx.hir_body(anon_const.body);

        const fcx = FnCtxt.new(this.root_ctxt, this.param_env, anon_const.def_id);
        const ty = fcx.check_expr(body.value);
        let target_ty: Ty;
        const k = this.structurally_resolve_type(body.value.span, ty).kind();
        if (k.$ === "FnDef") {
          const fn_sig = ty.fn_sig(this.tcx);
          target_ty = Ty.new_fn_ptr(this.tcx, fn_sig);
        } else if (k.$ === "Closure") {
          const args = k._1;
          const closure_sig = ClosureArgs.sig(args.as_closure());
          const fn_sig = this.tcx.signature_unclosure(closure_sig, hir.Safety.Safe);
          target_ty = Ty.new_fn_ptr(this.tcx, fn_sig);
        } else {
          target_ty = ty;
        }

        const r = this.demand_coerce_diag(body.value, ty, target_ty, undefined, AllowTwoPhase.No);
        if (r.$ === "Err") {
          r._0.emit();
        }

        fcx.require_type_is_sized(target_ty, body.value.span, ObligationCauseCode.SizedConstOrStatic);
        fcx.write_ty(anon_const.hir_id, target_ty);
        break;
      }
      case "SymFn": {
        this.check_expr(op.expr);
        break;
      }
      case "SymStatic":
        break;
      case "Label": {
        const block = op.block;
        const previous_diverges = this.diverges;

        // The label blocks should have unit return value or diverge.
        const ty = this.check_expr_block(block, { $: "ExpectHasType", _0: this.tcx.types.unit });
        if (!ty.is_never()) {
          this.demand_suptype(block.span, this.tcx.types.unit, ty);
          diverge = false;
        }

        // We need this to avoid false unreachable warning when a label diverges.
        this.diverges = previous_diverges;
        break;
      }
    }
  }

  return diverge ? this.tcx.types.never : this.tcx.types.unit;
};

// rustc: compiler/rustc_hir_typeck/src/expr.rs:3785 check_expr_offset_of
FnCtxt.prototype.check_expr_offset_of = function (this: FnCtxt, container: hir.Ty, fields_: readonly Ident[], expr: hir.Expr): Ty {
  let current_container = this.lower_ty(container).normalized;
  const field_indices: [Ty, VariantIdx, FieldIdx][] = [];
  // PORT: `fields.into_iter()` with `fields.next()` in the loop body: an index into the slice.
  let fields_pos = 0;

  while (fields_pos < fields_.length) {
    const field = fields_[fields_pos++]!;
    const container = this.structurally_resolve_type(expr.span, current_container);

    const ck = container.kind();
    if (ck.$ === "Adt" && ck._0.is_enum()) {
      const container_def = ck._0;
      const args = ck._1;
      const ident = this.tcx.adjust_ident(field, container_def.did());

      if (!this.tcx.features().offset_of_enum()) {
        feature_err(this.tcx.sess, sym.offset_of_enum, ident.span, "using enums in offset_of is experimental").emit();
      }

      const variants = container_def.variants();
      const variant_index = variants.findIndex((v) => v.ident(this.tcx).normalize_to_macros_2_0().eq(ident));
      if (variant_index === -1) {
        this.dcx()
          .create_err(NoVariantNamed_diagnostic({ span: ident.span, ident, ty: container }))
          .with_span_label(field.span, "variant not found")
          .emit_err_unless_delay(TypeVisitableExt.references_error(container, fold_Ty));
        break;
      }
      const index = variant_index as VariantIdx;
      const variant = variants[variant_index]!;
      const subfield = fields_[fields_pos++];
      if (subfield === undefined) {
        type_error_struct(
          this.dcx(),
          ident.span,
          container,
          E0795,
          `\`${display_Ident(ident)}\` is an enum variant; expected field at end of \`offset_of\``,
        )
          .with_span_label(field.span, "enum variant")
          .emit();
        break;
      }
      const [subident, sub_def_scope] = this.tcx.adjust_ident_and_get_scope(subfield, variant.def_id, this.mod_id);

      const subfield_index = variant.fields.findIndex((f) => f.ident(this.tcx).normalize_to_macros_2_0().eq(subident));
      if (subfield_index === -1) {
        this.dcx()
          .create_err(
            NoFieldOnVariant_diagnostic({
              span: ident.span,
              container,
              ident,
              field: subfield,
              enum_span: field.span,
              field_span: subident.span,
            }),
          )
          .emit_err_unless_delay(TypeVisitableExt.references_error(container, fold_Ty));
        break;
      }
      const subindex = subfield_index as FieldIdx;
      const field_ = variant.fields[subfield_index]!;

      const field_ty = this.field_ty(expr.span, field_, args);

      // Enums are anyway always sized. But just to safeguard against future
      // language extensions, let's double-check.
      this.require_type_is_sized(field_ty, expr.span, {
        $: "FieldSized",
        adt_kind: AdtKind.Enum,
        span: this.tcx.def_span(field_.did),
        last: false,
      });

      if (Visibility.is_accessible_from(field_.vis, sub_def_scope, this.tcx)) {
        this.tcx.check_stability(field_.did, expr.hir_id, expr.span, undefined);
      } else {
        this.private_field_err(ident, container_def.did()).emit();
      }

      // Save the index of all fields regardless of their visibility in case
      // of error recovery.
      field_indices.push([current_container, index, subindex]);
      current_container = field_ty;

      continue;
    } else if (ck.$ === "Adt") {
      const container_def = ck._0;
      const args = ck._1;
      const [ident, def_scope] = this.tcx.adjust_ident_and_get_scope(field, container_def.did(), this.mod_id);

      const fields = container_def.non_enum_variant().fields;
      const found = fields.findIndex((f) => f.ident(this.tcx).normalize_to_macros_2_0().eq(ident));
      if (found !== -1) {
        const index = found as FieldIdx;
        const field_ = fields[found]!;
        const field_ty = this.field_ty(expr.span, field_, args);

        if (this.tcx.features().offset_of_slice()) {
          this.require_type_has_static_alignment(field_ty, expr.span);
        } else {
          this.require_type_is_sized(field_ty, expr.span, {
            $: "WellFormed",
            _0: { $: "HirId", _0: expr.hir_id },
          });
        }

        if (Visibility.is_accessible_from(field_.vis, def_scope, this.tcx)) {
          this.tcx.check_stability(field_.did, expr.hir_id, expr.span, undefined);
        } else {
          this.private_field_err(ident, container_def.did()).emit();
        }

        // Save the index of all fields regardless of their visibility in case
        // of error recovery.
        field_indices.push([current_container, FIRST_VARIANT, index]);
        current_container = field_ty;

        continue;
      }
    } else if (ck.$ === "Tuple") {
      const tys = ck._0;
      const index = parse_usize(field.as_str());
      if (index !== undefined && field.name === sym.integer(index)) {
        const field_ty = index < BigInt(tys.length) ? tys[Number(index)] : undefined;
        if (field_ty !== undefined) {
          if (this.tcx.features().offset_of_slice()) {
            this.require_type_has_static_alignment(field_ty, expr.span);
          } else {
            this.require_type_is_sized(field_ty, expr.span, {
              $: "WellFormed",
              _0: { $: "HirId", _0: expr.hir_id },
            });
          }

          field_indices.push([current_container, FIRST_VARIANT, FieldIdx_from_usize(Number(index))]);
          current_container = field_ty;

          continue;
        }
      }
    }

    this.no_such_field_err(field, container, expr).emit();

    break;
  }

  this.typeck_results.offset_of_data_mut().insert(expr.hir_id, field_indices);

  return this.tcx.types.usize;
};

// ---- helpers (not upstream fns) ------------------------------------------------------------------------------------

/** `TypeFoldable` descriptors of `TraitRef` / `TraitClause` (their generated impl fns, as rustc_infer traits/util.ts). */
const fold_TraitRef: TypeFoldable<TraitRefT> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const fold_TraitClause: TypeFoldable<TraitClause> = {
  visit_with: visit_with_TraitClause,
  try_fold_with: try_fold_with_TraitClause,
  fold_with: fold_with_TraitClause,
};

/** `NoSolution` (unit struct). */
const NO_SOLUTION: NoSolution = Object.freeze({});

/** rustc_abi `FIRST_VARIANT` (`VariantIdx::ZERO`). */
const FIRST_VARIANT = 0 as VariantIdx;

/** `UnordMap::remove` / `FxHashMap::remove` on a struct-keyed map. */
function remove_keyed<K, V>(m: KeyedMap<K, V>, k: K): V | undefined {
  const v = m.get(k);
  if (v !== undefined) m.delete(k);
  return v;
}

/** `Ident`'s `Eq`/`Hash` (rustc_span symbol.rs:2574): the name and the span's `SyntaxContext`. */
function Ident_key(ident: Ident): string {
  return `${ident.name}:${Span.ctxt(ident.span)}`;
}

/** `Option<DefId> == Option<DefId>` (derived `PartialEq`). */
function Option_DefId_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.krate === b.krate && a.index === b.index;
}

/**
 * `s.parse::<usize>()` (core `from_str_radix`, radix 10): an optional leading `+`, then at least one ASCII digit, no
 * overflow past `usize::MAX` (64-bit host). PORT: a `bigint`, as the value may exceed 2^53.
 */
function parse_usize(s: string): bigint | undefined {
  const digits = s.startsWith("+") ? s.slice(1) : s;
  if (digits.length === 0 || !/^[0-9]+$/.test(digits)) return undefined;
  const v = BigInt(digits);
  return v > 0xffff_ffff_ffff_ffffn ? undefined : v;
}

/** `s.parse::<u64>()`: as `parse_usize` (64-bit host). */
function parse_u64(s: string): bigint | undefined {
  return parse_usize(s);
}

/** `FieldIdx::from_usize` (`newtype_index!`, `MAX` 0xFFFF_FF00): asserts the value is in range. */
function FieldIdx_from_usize(value: number): FieldIdx {
  assert(value <= 0xffff_ff00, "assertion failed: value <= (0xFFFF_FF00 as usize)");
  return value as FieldIdx;
}

/** `&s[from..]` on a `&str` (byte offset `from`, which must be a char boundary). */
function str_from_byte(s: string, from: number): string {
  return Str.from(s).slice(from).toString();
}

/**
 * `TypeErrCtxt<'_, 'tcx>` (rustc_trait_selection error_reporting, wave 19): the methods this file calls on
 * `self.err_ctxt()`. PORT: a view over `FnCtxt::err_ctxt` (its stub stops as UNPORTED), as rustc_hir_analysis
 * check/entry.ts; root drops it when `TypeErrCtxt` is ported.
 */
interface TypeErrCtxtView {
  type_error_struct_with_diag(sp: Span, mk_diag: (actual: string) => Diag, actual_ty: Ty): Diag;
  report_fulfillment_errors(errors: FulfillmentError[]): ErrorGuaranteed;
}

function err_ctxt_view(fcx: FnCtxt): TypeErrCtxtView {
  return fcx.err_ctxt() as unknown as TypeErrCtxtView;
}
