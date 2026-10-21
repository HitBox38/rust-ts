// Port of compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs. Lanes: typeck-gaps (`fn_sig`, `is_field_suggestable`:
// success-path blockers), typeck-fnsugg-a (lines 1..2025), typeck-fnsugg-b (lines 2026..: still placeholders below).
//
// Every fn of this file is declared in ../decls.ts under `// fn_ctxt/suggestions.rs:<line>`:
// - methods of FnCtxt: assigned onto the prototype in upstream order with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:<line> <name>` directly above it;
// - comment-only declarations (nested fns): ported inside their parent with their own marker.
// PORT notes (lane typeck-fnsugg-a):
// - `debug!` / `#[instrument]` are tracing only and stay as comments.
// - `self.err_ctxt()` is rustc_trait_selection's `TypeErrCtxt`; a `&FnCtxt` passed as `&InferCtxt` is `this.infcx`.
// - `impl FnOnce(Ty) -> bool` closures are plain fns; lazy iterator chains whose closures are pure are collected eagerly.
// - `Ord` on `Applicability` / `ExprPrecedence` compares the `*_discriminant` tables (derived `Ord`, declaration order).
// - `format!("{ty}")` of a `Ty` is `display_Ty`; of a `Symbol` `Symbol.as_str`.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported_methods } from "../../rust_ts/stubs.ts";
import { ExprPrecedence, ExprPrecedence_discriminant } from "../../rustc_ast/util/parser.gen.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { Applicability, type Diag, MultiSpan, msg } from "../../rustc_errors/lib.ts";
import { Applicability_discriminant } from "../../rustc_lint_defs/lib.gen.ts";
import { Res } from "../../rustc_hir/def.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { type CoroutineKind, debug_HirId, type HirId, type Node, type Upvar } from "../../rustc_hir/lib.ts";
import { suggest_impl_trait } from "../../rustc_hir_analysis/collect.ts";
import { ty_to_string } from "../../rustc_hir_pretty/lib.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { EvaluationResult } from "../../rustc_middle/traits/select.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { type Asyncness, type FieldDef, Ty, Visibility } from "../../rustc_middle/ty/mod.ts";
import { Predicate_upcast_from_TraitRef } from "../../rustc_middle/ty/predicate.ts";
import { display_Ty, with_no_trimmed_paths } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { BytePos, DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { DefId_eq, type LocalDefId, LocalDefId as LocalDefIdC } from "../../rustc_span/def_id.ts";
import { Ident, Symbol, sym } from "../../rustc_span/symbol.ts";
import { ReturnsVisitor } from "../../rustc_trait_selection/error_reporting/traits/suggestions.ts";
import type { DefIdOrName } from "../../rustc_trait_selection/error_reporting/traits/mod.gen.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { as_interner, TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { ToTrace_Ty } from "../../rustc_infer/infer/at.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { str_is_char_boundary } from "../../std/str.ts";
import { str_to_uppercase } from "../../std/unicode/str_case.ts";
import { FnCtxt } from "../decls.ts";
import {
  AddReturnTypeSuggestion_subdiagnostic,
  ExpectedReturnTypeLabel_subdiagnostic,
  NoteCallerChoosesTyForTyParam_subdiagnostic,
  OptionResultRefMismatch_subdiagnostic,
  type OptionResultRefMismatch,
  SuggestBoxing_subdiagnostic,
  type SuggestBoxing,
  SuggestBoxingForReturnImplTrait_subdiagnostic,
  SuggestConvertViaMethod_subdiagnostic,
  ExprParenthesesNeeded_subdiagnostic,
} from "../diagnostics.gen.ts";
import { ExprParenthesesNeeded_surrounding } from "../diagnostics.ts";
import { FnCtxt_as_PpAnn } from "./mod.ts";
import { Mode, ProbeScope } from "../method/probe.gen.ts";

/** `Applicability: Ord` (derived): `a.max(b)`. */
function applicability_max(a: Applicability, b: Applicability): Applicability {
  return Applicability_discriminant[b] >= Applicability_discriminant[a] ? b : a;
}
// ---- lane typeck-fnsugg-b (suggestions.rs:2026..3956) ----
import { BinOpKind, LitKind } from "../../rustc_ast/lib.ts";
import { FloatTy, IntTy, Mutability_cmp, UintTy } from "../../rustc_ast_ir/lib.ts";
import { listify } from "../../rustc_errors/lib.ts";
import type { CtorKind } from "../../rustc_hir/def.ts";
import { expr_needs_parens, is_range_literal } from "../../rustc_hir/lib.ts";
import { HirId_eq } from "../../rustc_hir_id/lib.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import { ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { type AssocItem as AssocItemT } from "../../rustc_middle/ty/assoc.ts";
import { suggest_constraining_type_params } from "../../rustc_middle/ty/diagnostics.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { type Predicate } from "../../rustc_middle/ty/predicate.ts";
import { display_Predicate, with_types_for_suggestion } from "../../rustc_middle/ty/print/pretty.ts";
import { Article_TyKind } from "../../rustc_middle/ty/sty.ts";
import { display_Ident } from "../../rustc_span/symbol.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { FnSig as FnSigC } from "../../rustc_type_ir/ty_kind.ts";
import { ch, is_whitespace } from "../../std/char.ts";
import { utf8_len } from "../../std/str.ts";
import { ReplaceCommaWithSemicolon_subdiagnostic } from "../diagnostics.gen.ts";

const C_LPAREN = ch("(");
// ---- end lane typeck-fnsugg-b imports ----


/** `ExprPrecedence: Ord` (derived): `a < b`. */
function precedence_lt(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] < ExprPrecedence_discriminant[b];
}

// impl<'a, 'tcx> FnCtxt<'a, 'tcx> {
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:43 fn_sig
FnCtxt.prototype.fn_sig = function (this: FnCtxt): FnSig | undefined {
  return this.typeck_results.liberated_fn_sigs().get(this.tcx.local_def_id_to_hir_id(this.body_def_id));
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:51 suggest_semicolon_at_end
FnCtxt.prototype.suggest_semicolon_at_end = function (this: FnCtxt, span: Span, err: Diag): void {
  // This suggestion is incorrect for
  // fn foo() -> bool { match () { () => true } || match () { () => true } }
  err.span_suggestion_short(Span.shrink_to_hi(span), "consider using a semicolon here", ";", Applicability.MaybeIncorrect);
};

/// On implicit return expressions with mismatched types, provides the following suggestions:
///
/// - Points out the method's return type as the reason for the expected type.
/// - Possible missing semicolon.
/// - Possible missing return type if the return type is the default, and not `fn main()`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:67 suggest_mismatched_types_on_tail
FnCtxt.prototype.suggest_mismatched_types_on_tail = function (this: FnCtxt, err: Diag, expr_: hir.Expr, expected: Ty, found: Ty, blk_id: HirId): boolean {
  const expr = expr_.peel_drop_temps();
  let pointing_at_return_type = false;
  if (expr.kind.$ === "Break") {
    // `break` type mismatches provide better context for tail `loop` expressions.
    return false;
  }
  const r = this.get_fn_decl(blk_id);
  if (r !== undefined) {
    const [fn_id, fn_decl] = r;
    pointing_at_return_type = this.suggest_missing_return_type(err, fn_decl, expected, found, fn_id);
    this.suggest_missing_break_or_return_expr(err, expr, fn_decl, expected, found, blk_id, fn_id);
  }
  return pointing_at_return_type;
};

/// When encountering an fn-like type, try accessing the output of the type
/// and suggesting calling it if it satisfies a predicate (i.e. if the
/// output has a method or a field):
/// ```compile_fail,E0308
/// fn foo(x: usize) -> usize { x }
/// let x: usize = foo;  // suggest calling the `foo` function: `foo(42)`
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:98 suggest_fn_call
FnCtxt.prototype.suggest_fn_call = function (this: FnCtxt, err: Diag, expr: hir.Expr, found: Ty, can_satisfy: (_1: Ty) => boolean): boolean {
  const info = this.extract_callable_info(found);
  if (info === undefined) {
    return false;
  }
  const [def_id_or_name, output, inputs] = info;
  if (can_satisfy(output)) {
    let [sugg_call, applicability]: [string, Applicability] = (() => {
      const n = inputs.length;
      if (n === 0) {
        return ["", Applicability.MachineApplicable] as [string, Applicability];
      } else if (n >= 1 && n <= 4) {
        return [
          inputs
            .map((ty) => {
              if (IsSuggestable.is_suggestable(ty, this.tcx, false, fold_Ty)) {
                return `/* ${display_Ty(ty)} */`;
              } else {
                return "/* value */";
              }
            })
            .join(", "),
          Applicability.HasPlaceholders,
        ] as [string, Applicability];
      } else {
        return ["/* ... */", Applicability.HasPlaceholders] as [string, Applicability];
      }
    })();

    let msg_: string;
    switch (def_id_or_name.$) {
      case "DefId": {
        const def_id = def_id_or_name._0;
        const kind = this.tcx.def_kind(def_id);
        if (kind.$ === "Ctor" && kind._0 === "Struct") {
          msg_ = "construct this tuple struct";
        } else if (kind.$ === "Ctor" && kind._0 === "Variant") {
          msg_ = "construct this tuple variant";
        } else {
          msg_ = `call this ${this.tcx.def_kind_descr(kind, def_id)}`;
        }
        break;
      }
      case "Name":
        msg_ = `call this ${def_id_or_name._0}`;
        break;
    }

    let sugg: [Span, string][];
    switch (expr.kind.$) {
      case "Call":
      case "Path":
      case "Index":
      case "Lit":
        sugg = [[Span.shrink_to_hi(expr.span), `(${sugg_call})`]];
        break;
      case "Closure":
        // Might be `{ expr } || { bool }`
        applicability = Applicability.MaybeIncorrect;
        sugg = [
          [Span.shrink_to_lo(expr.span), "("],
          [Span.shrink_to_hi(expr.span), `)(${sugg_call})`],
        ];
        break;
      default:
        sugg = [
          [Span.shrink_to_lo(expr.span), "("],
          [Span.shrink_to_hi(expr.span), `)(${sugg_call})`],
        ];
    }

    err.multipart_suggestion(`use parentheses to ${msg_}`, sugg, applicability);
    return true;
  }
  return false;
};

/// Extracts information about a callable type for diagnostics. This is a
/// heuristic -- it doesn't necessarily mean that a type is always callable,
/// because the callable type must also be well-formed to be called.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:169 extract_callable_info
FnCtxt.prototype.extract_callable_info = function (this: FnCtxt, ty: Ty): [DefIdOrName, Ty, Ty[]] | undefined {
  return this.err_ctxt().extract_callable_info(this.body_def_id, this.param_env, ty);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:176 suggest_two_fn_call
FnCtxt.prototype.suggest_two_fn_call = function (
  this: FnCtxt,
  err: Diag,
  lhs_expr: hir.Expr,
  lhs_ty: Ty,
  rhs_expr: hir.Expr,
  rhs_ty: Ty,
  can_satisfy: (_1: Ty, _2: Ty) => boolean,
): boolean {
  if (Span.in_derive_expansion(lhs_expr.span) || Span.in_derive_expansion(rhs_expr.span)) {
    return false;
  }
  const lhs = this.extract_callable_info(lhs_ty);
  if (lhs === undefined) {
    return false;
  }
  const [, lhs_output_ty, lhs_inputs] = lhs;
  const rhs = this.extract_callable_info(rhs_ty);
  if (rhs === undefined) {
    return false;
  }
  const [, rhs_output_ty, rhs_inputs] = rhs;

  if (can_satisfy(lhs_output_ty, rhs_output_ty)) {
    const sugg: [Span, string][] = [];
    let applicability: Applicability = Applicability.MachineApplicable;

    for (const [expr, inputs] of [
      [lhs_expr, lhs_inputs],
      [rhs_expr, rhs_inputs],
    ] as [hir.Expr, Ty[]][]) {
      const [sugg_call, this_applicability]: [string, Applicability] = (() => {
        const n = inputs.length;
        if (n === 0) {
          return ["", Applicability.MachineApplicable] as [string, Applicability];
        } else if (n >= 1 && n <= 4) {
          return [
            inputs
              .map((ty) => {
                if (IsSuggestable.is_suggestable(ty, this.tcx, false, fold_Ty)) {
                  return `/* ${display_Ty(ty)} */`;
                } else {
                  return "/* value */";
                }
              })
              .join(", "),
            Applicability.HasPlaceholders,
          ] as [string, Applicability];
        } else {
          return ["/* ... */", Applicability.HasPlaceholders] as [string, Applicability];
        }
      })();

      applicability = applicability_max(applicability, this_applicability);

      switch (expr.kind.$) {
        case "Call":
        case "Path":
        case "Index":
        case "Lit":
          sugg.push([Span.shrink_to_hi(expr.span), `(${sugg_call})`]);
          break;
        case "Closure":
          // Might be `{ expr } || { bool }`
          applicability = Applicability.MaybeIncorrect;
          sugg.push([Span.shrink_to_lo(expr.span), "("], [Span.shrink_to_hi(expr.span), `)(${sugg_call})`]);
          break;
        default:
          sugg.push([Span.shrink_to_lo(expr.span), "("], [Span.shrink_to_hi(expr.span), `)(${sugg_call})`]);
      }
    }

    err.multipart_suggestion("use parentheses to call these", sugg, applicability);

    return true;
  } else {
    return false;
  }
};

/// Suggests calling `.collect()` on an `Iterator` it can be collected in the return type
/// ```compile_fail
/// let x: String = "foo".chars().map(|c| c); // with a .collect() here the code compiles
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:257 suggest_collect
FnCtxt.prototype.suggest_collect = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected_type: Ty, found_type: Ty): boolean {
  const tcx = this.tcx;
  const expected = this.deeply_resolve_ignoring_regions(expected_type, fold_Ty);
  const found = this.deeply_resolve_ignoring_regions(found_type, fold_Ty);

  if (TypeVisitableExt.references_error(expected, fold_Ty) || TypeVisitableExt.references_error(found, fold_Ty) || expected.is_unit()) {
    return false;
  }

  const iterator_trait_id = tcx.get_diagnostic_item(sym.Iterator);
  if (iterator_trait_id === undefined) {
    return false;
  }

  if (!EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(iterator_trait_id, [found], this.param_env))) {
    return false;
  }

  const from_iterator_trait_id = tcx.get_diagnostic_item(sym.FromIterator);
  if (from_iterator_trait_id === undefined) {
    return false;
  }

  let iterator_item_id;
  for (const item of AssocItems.in_definition_order(tcx.associated_items(iterator_trait_id) as AssocItems)) {
    if (AssocItem.name(item) === sym.Item) {
      iterator_item_id = item.def_id;
      break;
    }
  }
  if (iterator_item_id === undefined) {
    return false;
  }

  const item_type_ = Ty.new_projection(tcx, "No", iterator_item_id, [found]);
  const item_type = this.normalize(expr.span, Unnormalized.new_wip(item_type_), fold_Ty);

  const can_collect = EvaluationResult.may_apply(this.infcx.type_implements_trait(from_iterator_trait_id, [expected, item_type], this.param_env));

  if (can_collect) {
    err.span_suggestion_verbose(
      Span.shrink_to_hi(expr.span),
      `consider using \`.collect()\` to convert the \`Iterator\` into a \`${display_Ty(expected)}\``,
      ".collect()",
      Applicability.MaybeIncorrect,
    );
    return true;
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:321 suggest_remove_last_method_call
FnCtxt.prototype.suggest_remove_last_method_call = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty): boolean {
  let recv_ty: Ty | undefined;
  let name: string;
  const k = expr.kind;
  if (
    k.$ === "MethodCall" &&
    k._2.length === 0 &&
    (recv_ty = this.typeck_results.expr_ty_opt(k._1)) !== undefined &&
    this.may_coerce(recv_ty, expected) &&
    ((name = Symbol.as_str(k._0.ident.name)), name.startsWith("to_") || name.startsWith("as_") || name === "into")
  ) {
    const method = k._0.ident;
    const recv_expr = k._1;
    const recv_span = Span.find_ancestor_inside(recv_expr.span, expr.span);
    const span = recv_span !== undefined ? Span.with_lo(expr.span, Span.hi(recv_span)) : Span.with_lo(expr.span, BytePos(Span.lo(method.span) - 1));
    err.span_suggestion_verbose(span, "try removing the method call", "", Applicability.MachineApplicable);
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:350 suggest_deref_ref_or_into
FnCtxt.prototype.suggest_deref_ref_or_into = function (this: FnCtxt, err: Diag, expr_: hir.Expr, expected: Ty, found: Ty, expected_ty_expr: hir.Expr | undefined): boolean {
  const expr = expr_.peel_blocks();
  const methods = this.get_conversion_methods_for_diagnostic(expr.span, expected, found, expr.hir_id);

  const r = this.suggest_deref_or_ref(expr, found, expected);
  if (r !== undefined) {
    const [suggestion, msg_, applicability, annotation] = r;
    err.multipart_suggestion(msg_, suggestion, applicability);
    if (annotation) {
      let suggest_annotation: string;
      const pk = expr.peel_drop_temps().kind;
      if (pk.$ === "AddrOf" && pk._0 === "Ref") {
        suggest_annotation = Mutability.ref_prefix_str(pk._1);
      } else {
        return true;
      }
      const tuple_indexes: number[] = [];
      let expr_id = expr.hir_id;
      for (const [parent_id, node] of this.tcx.hir_parent_iter(expr.hir_id)) {
        if (node.$ === "Expr" && node._0.kind.$ === "Tup") {
          const subs = node._0.kind._0;
          tuple_indexes.push(unwrap(subs.map((sub_expr, i) => [i, sub_expr] as const).find(([, sub_expr]) => hir.HirId_eq(sub_expr.hir_id, expr_id)))[0]);
          expr_id = parent_id;
        } else if (node.$ === "LetStmt") {
          const local = node._0;
          if (local.ty !== undefined) {
            let ty = local.ty;
            let index: number | undefined;
            while ((index = tuple_indexes.pop()) !== undefined) {
              if (ty.kind.$ === "Tup") {
                ty = ty.kind._0[index]!;
              } else {
                return true;
              }
            }
            const annotation_span = ty.span;
            err.span_suggestion(
              Span.with_hi(annotation_span, Span.lo(annotation_span)),
              "alternatively, consider changing the type annotation",
              suggest_annotation,
              Applicability.MaybeIncorrect,
            );
          }
          break;
        } else {
          break;
        }
      }
    }
    return true;
  }

  if (this.suggest_else_fn_with_closure(err, expr, found, expected)) {
    return true;
  }

  let fk;
  let sp: Span | undefined;
  if (
    this.suggest_fn_call(err, expr, found, (output) => this.may_coerce(output, expected)) &&
    (fk = found.kind()).$ === "FnDef" &&
    (sp = this.tcx.hir_span_if_local(fk._0)) !== undefined
  ) {
    const def_id = fk._0;
    const name = this.tcx.item_name(def_id);
    const kind = this.tcx.def_kind(def_id);
    if (kind.$ === "Ctor" && kind._1 === "Fn") {
      const of = kind._0;
      err.span_label(
        sp,
        `\`${Symbol.as_str(name)}\` defines ${(() => {
          switch (of) {
            case "Struct":
              return "a struct";
            case "Variant":
              return "an enum variant";
          }
        })()} constructor here, which should be called`,
      );
    } else {
      const descr = this.tcx.def_kind_descr(kind, def_id);
      err.span_label(sp, `${descr} \`${Symbol.as_str(name)}\` defined here`);
    }
    return true;
  }

  if (this.suggest_cast(err, expr, found, expected, expected_ty_expr)) {
    return true;
  }

  if (methods.length !== 0) {
    // PORT: the `filter_map(..).peekable()` closure is pure; the suggestions are collected eagerly.
    const suggestions: [Span, string][][] = [];
    for (const conversion_method of methods) {
      const conversion_method_name = AssocItem.name(conversion_method);
      const receiver_method_ident = expr.method_ident();
      if (receiver_method_ident !== undefined && receiver_method_ident.name === conversion_method_name) {
        continue; // do not suggest code that is already there (#53348)
      }

      const method_call_list = [sym.to_vec, sym.to_string];
      let sugg: [Span, string][];
      const ek = expr.kind;
      if (ek.$ === "MethodCall" && ek._0.ident.name === sym.clone && method_call_list.includes(conversion_method_name)) {
        // If receiver is `.clone()` and found type has one of those methods,
        // we guess that the user wants to convert from a slice type (`&[]` or `&str`)
        // to an owned type (`Vec` or `String`). These conversions clone internally,
        // so we remove the user's `clone` call.
        sugg = [[ek._0.ident.span, Symbol.as_str(conversion_method_name)]];
      } else if (precedence_lt(this.precedence(expr), ExprPrecedence.Unambiguous)) {
        sugg = [
          [Span.shrink_to_lo(expr.span), "("],
          [Span.shrink_to_hi(expr.span), `).${Symbol.as_str(conversion_method_name)}()`],
        ];
      } else {
        sugg = [[Span.shrink_to_hi(expr.span), `.${Symbol.as_str(conversion_method_name)}()`]];
      }
      const struct_pat_shorthand_field = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      if (struct_pat_shorthand_field !== undefined) {
        sugg.unshift([Span.shrink_to_lo(expr.span), `${Symbol.as_str(struct_pat_shorthand_field)}: `]);
      }
      suggestions.push(sugg);
    }
    if (suggestions.length !== 0) {
      err.multipart_suggestions("try using a conversion method", suggestions, Applicability.MaybeIncorrect);
      return true;
    }
  }

  const deconstructed = this.deconstruct_option_or_result(found, expected);
  let eik;
  if (deconstructed !== undefined && (eik = deconstructed[1].kind()).$ === "Ref" && eik._2 === "Not") {
    const [found_ty_inner, , error_tys] = deconstructed;
    const peeled = eik._1;
    // Suggest removing any stray borrows (unless there's macro shenanigans involved).
    const inner_expr = expr.peel_borrows();
    if (!Span.eq_ctxt(inner_expr.span, expr.span)) {
      return false;
    }
    const borrow_removal_span = hir.HirId_eq(inner_expr.hir_id, expr.hir_id) ? undefined : Span.until(Span.shrink_to_lo(expr.span), inner_expr.span);
    // Given `Result<_, E>`, check our expected ty is `Result<_, &E>` for
    // `as_ref` and `as_deref` compatibility.
    const error_tys_equate_as_ref =
      error_tys === undefined ||
      this.can_eq(this.param_env, Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_erased, error_tys[0]), error_tys[1], ToTrace_Ty);

    const prefix_wrap = (sugg: string): string => {
      const name = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      if (name !== undefined) {
        return `: ${Symbol.as_str(name)}${sugg}`;
      } else {
        return sugg;
      }
    };

    // FIXME: This could/should be extended to suggest `as_mut` and `as_deref_mut`,
    // but those checks need to be a bit more delicate and the benefit is diminishing.
    let fik;
    let pk;
    if (this.can_eq(this.param_env, found_ty_inner, peeled, ToTrace_Ty) && error_tys_equate_as_ref) {
      const sugg = prefix_wrap(".as_ref()");
      err.subdiagnostic(SuggestConvertViaMethod_subdiagnostic({ span: Span.shrink_to_hi(expr.span), sugg, expected, found, borrow_removal_span }));
      return true;
    } else if (
      (fik = found_ty_inner.kind()).$ === "Ref" &&
      (pk = fik._1.peel_refs().kind()).$ === "Adt" &&
      this.tcx.is_lang_item(pk._0.did(), LangItem.String) &&
      peeled.is_str() &&
      // `Result::map`, conversely, does not take ref of the error type.
      (error_tys === undefined || this.can_eq(this.param_env, error_tys[0], error_tys[1], ToTrace_Ty))
    ) {
      const sugg = prefix_wrap(".map(|x| x.as_str())");
      err.span_suggestion_verbose(Span.shrink_to_hi(expr.span), msg("try converting the passed type into a `&str`"), sugg, Applicability.MachineApplicable);
      return true;
    } else {
      if (!error_tys_equate_as_ref) {
        return false;
      }
      const steps = this.autoderef(expr.span, found_ty_inner).silence_errors();
      // `steps.nth(1)`
      const nth = steps.next() === undefined ? undefined : steps.next();
      if (nth !== undefined && this.can_eq(this.param_env, nth[0], peeled, ToTrace_Ty)) {
        const sugg = prefix_wrap(".as_deref()");
        err.subdiagnostic(SuggestConvertViaMethod_subdiagnostic({ span: Span.shrink_to_hi(expr.span), sugg, expected, found, borrow_removal_span }));
        return true;
      }
      for (const [deref_ty, n_step] of steps) {
        if (this.can_eq(this.param_env, deref_ty, peeled, ToTrace_Ty)) {
          const explicit_deref = "*".repeat(n_step);
          const sugg = prefix_wrap(`.map(|v| &${explicit_deref}v)`);
          err.subdiagnostic(SuggestConvertViaMethod_subdiagnostic({ span: Span.shrink_to_hi(expr.span), sugg, expected, found, borrow_removal_span }));
          return true;
        }
      }
    }
  }

  return false;
};

/// If `ty` is `Option<T>`, returns `T, T, None`.
/// If `ty` is `Result<T, E>`, returns `T, T, Some(E, E)`.
/// Otherwise, returns `None`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:592 deconstruct_option_or_result
FnCtxt.prototype.deconstruct_option_or_result = function (this: FnCtxt, found_ty: Ty, expected_ty: Ty): [Ty, Ty, [Ty, Ty] | undefined] | undefined {
  const fk = found_ty.peel_refs().kind();
  if (fk.$ !== "Adt") {
    return undefined;
  }
  const [found_adt, found_args] = [fk._0, fk._1];
  const ek = expected_ty.kind();
  if (ek.$ !== "Adt") {
    return undefined;
  }
  const [expected_adt, expected_args] = [ek._0, ek._1];
  if (this.tcx.is_diagnostic_item(sym.Option, found_adt.did()) && this.tcx.is_diagnostic_item(sym.Option, expected_adt.did())) {
    return [found_args.type_at(0), expected_args.type_at(0), undefined];
  } else if (this.tcx.is_diagnostic_item(sym.Result, found_adt.did()) && this.tcx.is_diagnostic_item(sym.Result, expected_adt.did())) {
    return [found_args.type_at(0), expected_args.type_at(0), [found_args.type_at(1), expected_args.type_at(1)]];
  } else {
    return undefined;
  }
};

/// When encountering the expected boxed value allocated in the stack, suggest allocating it
/// in the heap by calling `Box::new()`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:622 suggest_boxing_when_appropriate
FnCtxt.prototype.suggest_boxing_when_appropriate = function (this: FnCtxt, err: Diag, span: Span, hir_id: HirId, expected: Ty, found: Ty): boolean {
  // Do not suggest `Box::new` in const context.
  if (this.tcx.hir_is_inside_const_context(hir_id) || !expected.is_box() || found.is_box()) {
    return false;
  }
  if (this.may_coerce(Ty.new_box(this.tcx, found), expected)) {
    let suggest_boxing: SuggestBoxing;
    const fk = found.kind();
    let parent: Node;
    if (fk.$ === "Tuple" && fk._0.length === 0) {
      suggest_boxing = { $: "Unit", start: Span.shrink_to_lo(span), end: span };
    } else if (
      fk.$ === "Coroutine" &&
      (() => {
        const ck = this.tcx.coroutine_kind(fk._0) as CoroutineKind | undefined;
        return ck !== undefined && ck.$ === "Desugared" && ck._0 === "Async" && ck._1 === "Closure";
      })()
    ) {
      suggest_boxing = { $: "AsyncBody" };
    } else if ((parent = this.tcx.parent_hir_node(hir_id)).$ === "ExprField" && parent._0.is_shorthand) {
      suggest_boxing = { $: "ExprFieldShorthand", start: Span.shrink_to_lo(span), end: Span.shrink_to_hi(span), ident: parent._0.ident };
    } else {
      suggest_boxing = { $: "Other", start: Span.shrink_to_lo(span), end: Span.shrink_to_hi(span) };
    }
    err.subdiagnostic(SuggestBoxing_subdiagnostic(suggest_boxing));

    return true;
  } else {
    return false;
  }
};

/// When encountering a closure that captures variables, where a FnPtr is expected,
/// explain why coercion fails and suggest changing the return type to `impl Fn(...)`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:674 suggest_closure_to_fn_ptr_coercion
FnCtxt.prototype.suggest_closure_to_fn_ptr_coercion = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  const ek = expected.kind();
  const fk = found.kind();
  let upvars;
  if (ek.$ === "FnPtr" && fk.$ === "Closure" && (upvars = this.tcx.upvars_mentioned(fk._0) as Map<HirId, Upvar> | undefined) !== undefined) {
    // Report upto four upvars being captured to reduce the amount error messages
    // reported back to the user.
    const spans_and_labels: [Span, string][] = [];
    for (const [var_hir_id, upvar] of upvars) {
      if (spans_and_labels.length === 4) break;
      const var_name = Symbol.as_str(this.tcx.hir_name(var_hir_id));
      const msg_ = `\`${var_name}\` captured here`;
      spans_and_labels.push([upvar.span, msg_]);
    }

    const multi_span: MultiSpan = MultiSpan.from_spans(spans_and_labels.map(([sp]) => sp));
    for (const [sp, label] of spans_and_labels) {
      multi_span.push_span_label(sp, label);
    }
    err.span_note(multi_span, "closures can only be coerced to `fn` types if they do not capture any variables");

    // If the expected fn pointer type comes from the enclosing function's return type,
    // suggest changing it to `impl Fn(...)` so that a capturing closure can be returned.
    this.suggest_impl_fn_for_fn_ptr_ret(err, expr);

    return true;
  }
  return false;
};

/// When a capturing closure is returned where a `fn(...)` pointer return type is expected,
/// suggest changing the return type to `impl Fn(...)`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:717 suggest_impl_fn_for_fn_ptr_ret
FnCtxt.prototype.suggest_impl_fn_for_fn_ptr_ret = function (this: FnCtxt, err: Diag, expr: hir.Expr): void {
  const r = this.get_fn_decl(expr.hir_id);
  if (r === undefined) return;
  const [, fn_decl] = r;
  if (fn_decl.output.$ !== "Return") return;
  const ret_ty = fn_decl.output._0;
  if (ret_ty.kind.$ !== "FnPtr") return;
  const fn_ptr_ty = ret_ty.kind._0;

  const { inputs, output } = fn_ptr_ty.decl;

  const inputs_str = inputs.map((ty) => ty_to_string(FnCtxt_as_PpAnn(this), ty)).join(", ");

  let output_str: string;
  switch (output.$) {
    case "DefaultReturn":
      output_str = "";
      break;
    case "Return":
      output_str = ` -> ${ty_to_string(FnCtxt_as_PpAnn(this), output._0)}`;
      break;
  }

  const suggestion = `impl Fn(${inputs_str})${output_str}`;
  err.span_suggestion(ret_ty.span, "change the return type to return a type-erased closure instead", suggestion, Applicability.MaybeIncorrect);
};

/// When encountering an `impl Future` where `BoxFuture` is expected, suggest `Box::pin`.
// #[instrument(skip(self, err))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:745 suggest_calling_boxed_future_when_appropriate
FnCtxt.prototype.suggest_calling_boxed_future_when_appropriate = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  // Handle #68197.

  if (this.tcx.hir_is_inside_const_context(expr.hir_id)) {
    // Do not suggest `Box::new` in const context.
    return false;
  }
  const pin_did = this.tcx.lang_items().pin_type();
  // This guards the `new_box` below.
  if (pin_did === undefined || this.tcx.lang_items().owned_box() === undefined) {
    return false;
  }
  const box_found = Ty.new_box(this.tcx, found);
  const pin_box_found = Ty.new_lang_item(this.tcx, box_found, LangItem.Pin);
  if (pin_box_found === undefined) {
    return false;
  }
  const pin_found = Ty.new_lang_item(this.tcx, found, LangItem.Pin);
  if (pin_found === undefined) {
    return false;
  }
  const ek = expected.kind();
  if (ek.$ === "Adt" && DefId_eq(ek._0.did(), pin_did)) {
    if (this.may_coerce(pin_box_found, expected)) {
      // debug!("can coerce {:?} to {:?}, suggesting Box::pin", pin_box_found, expected);
      const fk = found.kind();
      if (fk.$ === "Adt" && fk._0.is_box()) {
        err.help("use `Box::pin`");
      } else {
        const name = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
        const prefix = name !== undefined ? `${Symbol.as_str(name)}: ` : "";
        const suggestion: [Span, string][] = [
          [Span.shrink_to_lo(expr.span), `${prefix}Box::pin(`],
          [Span.shrink_to_hi(expr.span), ")"],
        ];
        err.multipart_suggestion("you need to pin and box this expression", suggestion, Applicability.MaybeIncorrect);
      }
      return true;
    } else if (this.may_coerce(pin_found, expected)) {
      const fk = found.kind();
      if (fk.$ === "Adt" && fk._0.is_box()) {
        err.help("use `Box::pin`");
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else if (ek.$ === "Adt" && ek._0.is_box() && this.may_coerce(box_found, expected)) {
    // Check if the parent expression is a call to Pin::new. If it
    // is and we were expecting a Box, ergo Pin<Box<expected>>, we
    // can suggest Box::pin.
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (!(parent.$ === "Expr" && parent._0.kind.$ === "Call")) {
      return false;
    }
    const fn_name = parent._0.kind._0;
    const fk = fn_name.kind;
    if (
      fk.$ === "Path" &&
      fk._0.$ === "TypeRelative" &&
      fk._0._0.kind.$ === "Path" &&
      fk._0._0.kind._0.$ === "Resolved" &&
      (() => { const d = Res.opt_def_id(fk._0._0.kind._0._1.res); return d !== undefined && DefId_eq(d, pin_did); })() &&
      fk._0._1.ident.name === sym.new
    ) {
      err.span_suggestion(fn_name.span, "use `Box::pin` to pin and box this expression", "Box::pin", Applicability.MachineApplicable);
      return true;
    } else {
      return false;
    }
  } else {
    return false;
  }
};

/// A common error is to forget to add a semicolon at the end of a block, e.g.,
///
/// ```compile_fail,E0308
/// # fn bar_that_returns_u32() -> u32 { 4 }
/// fn foo() {
///     bar_that_returns_u32()
/// }
/// ```
///
/// This routine checks if the return expression in a block would make sense on its own as a
/// statement and the return type has been left as default or has been specified as `()`. If so,
/// it suggests adding a semicolon.
///
/// If the expression is the expression of a closure without block (`|| expr`), a
/// block is needed to be added too (`|| { expr; }`). This is denoted by `needs_block`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:857 suggest_missing_semicolon
FnCtxt.prototype.suggest_missing_semicolon = function (this: FnCtxt, err: Diag, expression: hir.Expr, expected: Ty, needs_block: boolean, parent_is_closure: boolean): void {
  if (!expected.is_unit()) {
    return;
  }
  // `BlockTailExpression` only relevant if the tail expr would be
  // useful on its own.
  const k = expression.kind.$;
  let stmt: hir.Stmt | undefined;
  if (
    (k === "Call" || k === "MethodCall" || k === "Loop" || k === "If" || k === "Match" || k === "Block") &&
    expression.can_have_side_effects() &&
    // If the expression is from an external macro, then do not suggest
    // adding a semicolon, because there's nowhere to put it.
    // See issue #81943.
    !Span.in_external_macro(expression.span, this.tcx.sess.source_map())
  ) {
    if (needs_block) {
      err.multipart_suggestion(
        "consider using a semicolon here",
        [
          [Span.shrink_to_lo(expression.span), "{ "],
          [Span.shrink_to_hi(expression.span), "; }"],
        ],
        Applicability.MachineApplicable,
      );
    } else if ((stmt = (() => {
      const block = this.tcx.parent_hir_node(expression.hir_id);
      if (block.$ !== "Block") return undefined;
      const expr = this.tcx.parent_hir_node(block._0.hir_id);
      if (expr.$ !== "Expr") return undefined;
      const if_expr = this.tcx.parent_hir_node(expr._0.hir_id);
      if (if_expr.$ !== "Expr") return undefined;
      if (!(if_expr._0.kind.$ === "If" && if_expr._0.kind._2 !== undefined)) return undefined;
      const stmt = this.tcx.parent_hir_node(if_expr._0.hir_id);
      if (stmt.$ !== "Stmt") return undefined;
      if (stmt._0.kind.$ !== "Expr") return undefined;
      if (!this.is_next_stmt_expr_continuation(stmt._0.hir_id)) return undefined;
      return stmt._0;
    })()) !== undefined) {
      err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(stmt.span)));
    } else {
      err.span_suggestion(Span.shrink_to_hi(expression.span), "consider using a semicolon here", ";", Applicability.MachineApplicable);
    }
  } else if ((k === "Path" || k === "Lit") && parent_is_closure && !Span.in_external_macro(expression.span, this.tcx.sess.source_map())) {
    err.span_suggestion_verbose(Span.shrink_to_lo(expression.span), "consider ignoring the value", "_ = ", Applicability.MachineApplicable);
  } else {
    if ((stmt = (() => {
      const block = this.tcx.parent_hir_node(expression.hir_id);
      if (block.$ !== "Block") return undefined;
      const expr = this.tcx.parent_hir_node(block._0.hir_id);
      if (expr.$ !== "Expr") return undefined;
      const if_expr = this.tcx.parent_hir_node(expr._0.hir_id);
      if (if_expr.$ !== "Expr") return undefined;
      if (!(if_expr._0.kind.$ === "If" && if_expr._0.kind._2 !== undefined)) return undefined;
      const stmt = this.tcx.parent_hir_node(if_expr._0.hir_id);
      if (stmt.$ !== "Stmt") return undefined;
      if (stmt._0.kind.$ !== "Expr") return undefined;
      if (!this.is_next_stmt_expr_continuation(stmt._0.hir_id)) return undefined;
      return stmt._0;
    })()) !== undefined) {
      // The error is pointing at an arm of an if-expression, and we want to get the
      // `Span` of the whole if-expression for the suggestion. This only works for a
      // single level of nesting, which is fine.
      // We have something like `if true { false } else { true } && true`. Suggest
      // wrapping in parentheses. We find the statement or expression following the
      // `if` (`&& true`) and see if it is something that can reasonably be
      // interpreted as a binop following an expression.
      err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(stmt.span)));
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:943 is_next_stmt_expr_continuation
FnCtxt.prototype.is_next_stmt_expr_continuation = function (this: FnCtxt, hir_id: HirId): boolean {
  const b = this.tcx.parent_hir_node(hir_id);
  if (b.$ !== "Block") return false;
  const all = b._0.stmts;
  let i = 0;
  while (i < all.length && !hir.HirId_eq(all[i]!.hir_id, hir_id)) i++;
  // The statement the statement that was passed in
  if (i >= all.length) return false;
  i++;
  // The following statement
  let next: hir.Expr | undefined;
  const following = all[i];
  if (following !== undefined) {
    next = following.kind.$ === "Expr" || following.kind.$ === "Semi" ? following.kind._0 : undefined;
  } else if (b._0.expr !== undefined) {
    next = b._0.expr;
  } else {
    next = undefined;
  }
  if (next === undefined) return false;
  const nk = next.kind.$;
  // prev_stmt && next | prev_stmt * next | prev_stmt + next
  return nk === "AddrOf" || nk === "Unary" || nk === "Err";
};

/// A possible error is to forget to add a return type that is needed:
///
/// ```compile_fail,E0308
/// # fn bar_that_returns_u32() -> u32 { 4 }
/// fn foo() {
///     bar_that_returns_u32()
/// }
/// ```
///
/// This routine checks if the return type is left as default, the method is not part of an
/// `impl` block and that it isn't the `main` method. If so, it suggests setting the return
/// type.
// #[instrument(level = "trace", skip(self, err))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:979 suggest_missing_return_type
FnCtxt.prototype.suggest_missing_return_type = function (this: FnCtxt, err: Diag, fn_decl: hir.FnDecl, expected: Ty, found_: Ty, fn_id: LocalDefId): boolean {
  // Can't suggest `->` on a block-like coroutine
  const ck = this.tcx.coroutine_kind(fn_id) as CoroutineKind | undefined;
  if (ck !== undefined && ck.$ === "Desugared" && ck._1 === "Block") {
    return false;
  }

  const found = this.resolve_numeric_literals_with_default(this.deeply_resolve_ignoring_regions(found_, fold_Ty), fold_Ty);
  // Only suggest changing the return type for methods that
  // haven't set a return type at all (and aren't `fn main()`, impl or closure).
  const output = fn_decl.output;
  if (output.$ === "DefaultReturn" && this.tcx.is_closure_like(LocalDefIdC.to_def_id(fn_id))) {
    // For closure with default returns, don't suggest adding return type
  } else if (output.$ === "DefaultReturn" && expected.is_unit()) {
    const span = output._0;
    let sugg_found: Ty | undefined;
    let sugg: string | undefined;
    if (!this.can_add_return_type(fn_id)) {
      err.subdiagnostic(ExpectedReturnTypeLabel_subdiagnostic({ $: "Unit", span }));
    } else if ((sugg_found = IsSuggestable.make_suggestable(found, this.tcx, false, undefined, fold_Ty)) !== undefined) {
      err.subdiagnostic(AddReturnTypeSuggestion_subdiagnostic({ $: "Add", span, found: display_Ty(sugg_found) }));
    } else if ((sugg = suggest_impl_trait(this.infcx, this.param_env, found)) !== undefined) {
      err.subdiagnostic(AddReturnTypeSuggestion_subdiagnostic({ $: "Add", span, found: sugg }));
    } else {
      // FIXME: if `found` could be `impl Iterator` we should suggest that.
      err.subdiagnostic(AddReturnTypeSuggestion_subdiagnostic({ $: "MissingHere", span }));
    }

    return true;
  } else if (output.$ === "Return") {
    const hir_ty = output._0;
    const hk = hir_ty.kind;
    let trait_ref: hir.PolyTraitRef | undefined;
    let last_args: hir.GenericArgs | undefined;
    let constraint_ty: hir.Ty | undefined;
    if (
      hk.$ === "OpaqueDef" &&
      hk._0.bounds.length === 1 &&
      hk._0.bounds[0]!.$ === "Trait" &&
      ((trait_ref = hk._0.bounds[0]!._0), true) &&
      !(() => {
        const last = trait_ref.trait_ref.path.segments.at(-1);
        const args = last?.args;
        return args !== undefined && !(args.constraints.length === 0);
      })()
    ) {
      // Use the path to get the trait name string
      const trait_name = trait_ref.trait_ref.path.segments.map((seg) => seg.ident.as_str()).join("::");

      err.subdiagnostic(ExpectedReturnTypeLabel_subdiagnostic({ $: "ImplTrait", span: hir_ty.span, trait_name }));

      const ret_coercion_span = this.ret_coercion_span;
      if (ret_coercion_span !== undefined) {
        const expected_name = display_Ty(expected);
        err.span_label(ret_coercion_span, `return type resolved to be \`${expected_name}\``);
      }

      const trait_def_id = Res.def_id(trait_ref.trait_ref.path.res, debug_HirId);
      if (this.tcx.is_dyn_compatible(trait_def_id)) {
        err.subdiagnostic(
          SuggestBoxingForReturnImplTrait_subdiagnostic({
            $: "ChangeReturnType",
            start_sp: Span.with_hi(hir_ty.span, BytePos(Span.lo(hir_ty.span) + 4)),
            end_sp: Span.shrink_to_hi(hir_ty.span),
          }),
        );

        const body = this.tcx.hir_body_owned_by(fn_id);
        const visitor = ReturnsVisitor.default();
        visitor.visit_body(body);

        if (visitor.returns.length !== 0) {
          const starts: Span[] = visitor.returns.filter((expr) => Span.can_be_used_for_suggestions(expr.span)).map((expr) => Span.shrink_to_lo(expr.span));
          const ends: Span[] = visitor.returns.filter((expr) => Span.can_be_used_for_suggestions(expr.span)).map((expr) => Span.shrink_to_hi(expr.span));

          if (starts.length !== 0) {
            err.subdiagnostic(SuggestBoxingForReturnImplTrait_subdiagnostic({ $: "BoxReturnExpr", starts, ends }));
          }
        }
      }

      this.try_suggest_return_impl_trait(err, expected, found, fn_id);
      this.try_note_caller_chooses_ty_for_ty_param(err, expected, found);
      return true;
    } else if (
      hk.$ === "OpaqueDef" &&
      // FIXME: account for RPITIT.
      hk._0.bounds.length === 1 &&
      hk._0.bounds[0]!.$ === "Trait" &&
      (last_args = hk._0.bounds[0]!._0.trait_ref.path.segments.at(-1)?.args) !== undefined &&
      last_args.constraints.length === 1 &&
      (constraint_ty = last_args.constraints[0]!.ty()) !== undefined
    ) {
      const ty = constraint_ty;
      // Check if async function's return type was omitted.
      // Don't emit suggestions if the found type is `impl Future<...>`.
      // debug!(?found);
      if (IsSuggestable.is_suggestable(found, this.tcx, false, fold_Ty)) {
        if (Span.is_empty(ty.span)) {
          err.subdiagnostic(AddReturnTypeSuggestion_subdiagnostic({ $: "Add", span: ty.span, found: display_Ty(found) }));
          return true;
        } else {
          err.subdiagnostic(ExpectedReturnTypeLabel_subdiagnostic({ $: "Other", span: ty.span, expected }));
        }
      }
    } else {
      // Only point to return type if the expected type is the return type, as if they
      // are not, the expectation must have been caused by something else.
      // debug!(?hir_ty, "return type");
      const ty0 = this.lowerer().lower_ty(hir_ty);
      // debug!(?ty, "return type (lowered)");
      // debug!(?expected, "expected type");
      const bound_vars = this.tcx.late_bound_vars(this.tcx.local_def_id_to_hir_id(fn_id));
      const ty1 = Binder.bind_with_vars(ty0, bound_vars);
      const ty2 = this.normalize(hir_ty.span, Unnormalized.new_wip(ty1), fold_Binder(fold_Ty));
      const ty = this.tcx.instantiate_bound_regions_with_erased(ty2, fold_Ty);
      if (this.may_coerce(expected, ty)) {
        err.subdiagnostic(ExpectedReturnTypeLabel_subdiagnostic({ $: "Other", span: hir_ty.span, expected }));
        this.try_suggest_return_impl_trait(err, expected, found, fn_id);
        this.try_note_caller_chooses_ty_for_ty_param(err, expected, found);
        return true;
      }
    }
  }
  return false;
};

/// Checks whether we can add a return type to a function.
/// Assumes given function doesn't have a explicit return type.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1147 can_add_return_type
FnCtxt.prototype.can_add_return_type = function (this: FnCtxt, fn_id: LocalDefId): boolean {
  const node = this.tcx.hir_node_by_def_id(fn_id);
  switch (node.$) {
    case "Item": {
      const [ident] = node._0.expect_fn();
      // This is less than ideal, it will not suggest a return type span on any
      // method called `main`, regardless of whether it is actually the entry point,
      // but it will still present it as the reason for the expected type.
      return ident.name !== sym.main;
    }
    case "ImplItem": {
      // If it doesn't impl a trait, we can add a return type
      const parent = this.tcx.parent_hir_node(node._0.hir_id());
      if (!(parent.$ === "Item" && parent._0.kind.$ === "Impl")) {
        return unreachable();
      }
      const of_trait = parent._0.kind._0.of_trait;

      return of_trait === undefined;
    }
    default:
      return true;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1172 try_note_caller_chooses_ty_for_ty_param
FnCtxt.prototype.try_note_caller_chooses_ty_for_ty_param = function (this: FnCtxt, diag: Diag, expected: Ty, found: Ty): void {
  // Only show the note if:
  // 1. `expected` ty is a type parameter;
  // 2. The `expected` type parameter does *not* occur in the return expression type. This can
  //    happen for e.g. `fn foo<T>(t: &T) -> T { t }`, where `expected` is `T` but `found` is
  //    `&T`. Saying "the caller chooses a type for `T` which can be different from `&T`" is
  //    "well duh" and is only confusing and not helpful.
  const ek = expected.kind();
  if (ek.$ !== "Param") {
    return;
  }
  const expected_ty_as_param = ek._0;

  if (found.contains(expected)) {
    return;
  }

  diag.subdiagnostic(NoteCallerChoosesTyForTyParam_subdiagnostic({ ty_param_name: expected_ty_as_param.name, found_ty: found }));
};

/// check whether the return type is a generic type with a trait bound
/// only suggest this if the generic param is not present in the arguments
/// if this is true, hint them towards changing the return type to `impl Trait`
/// ```compile_fail,E0308
/// fn cant_name_it<T: Fn() -> u32>() -> T {
///     || 3
/// }
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1206 try_suggest_return_impl_trait
FnCtxt.prototype.try_suggest_return_impl_trait = function (this: FnCtxt, err: Diag, expected: Ty, found: Ty, fn_id: LocalDefId): void {
  // Only apply the suggestion if:
  //  - the return type is a generic parameter
  //  - the generic param is not used as a fn param
  //  - the generic param has at least one bound
  //  - the generic param doesn't appear in any other bounds where it's not the Self type
  // Suggest:
  //  - Changing the return type to be `impl <all bounds>`

  // debug!("try_suggest_return_impl_trait, expected = {:?}, found = {:?}", expected, found);

  const ek = expected.kind();
  if (ek.$ !== "Param") return;
  const expected_ty_as_param = ek._0;

  const fn_node = this.tcx.hir_node_by_def_id(fn_id);

  if (!(fn_node.$ === "Item" && fn_node._0.kind.$ === "Fn")) {
    return;
  }
  const fn_parameters = fn_node._0.kind.sig.decl.inputs;
  const fn_return = fn_node._0.kind.sig.decl.output;
  const { params, predicates } = fn_node._0.kind.generics;

  if (params[expected_ty_as_param.index] === undefined) {
    return;
  }

  // get all where BoundPredicates here, because they are used in two cases below
  // PORT: `.filter_map(..).map(..).collect::<Result<Vec<_>, _>>()` stops at the first `Err` (the lowering is lazy).
  const where_predicates: (readonly hir.GenericBound[] | undefined)[] = [];
  for (const p of predicates) {
    if (p.kind.$ !== "BoundPredicate") continue;
    const { bounds, bounded_ty } = p.kind._0;
    // FIXME: Maybe these calls to `lower_ty` can be removed (and the ones below)
    const ty = this.lowerer().lower_ty(bounded_ty);
    const tk = ty.kind();
    if (tk.$ === "Param" && tk._0.index === expected_ty_as_param.index && tk._0.name === expected_ty_as_param.name) {
      where_predicates.push(bounds);
    } else {
      // check whether there is any predicate that contains our `T`, like `Option<T>: Send`
      if (ty.contains(expected)) {
        return;
      } else {
        where_predicates.push(undefined);
      }
    }
  }

  // now get all predicates in the same types as the where bounds, so we can chain them
  // extract all bounds from the source code using their spans
  const all_matching_bounds_strs: string[] = [];
  for (const bounds of where_predicates) {
    if (bounds === undefined) continue;
    for (const bound of bounds) {
      if (bound.$ === "Trait") {
        const r = this.tcx.sess.source_map().span_to_snippet(hir.GenericBound.span(bound));
        if (r.$ === "Ok") all_matching_bounds_strs.push(r._0.toString());
      }
    }
  }

  if (all_matching_bounds_strs.length === 0) {
    return;
  }

  const all_bounds_str = all_matching_bounds_strs.join(" + ");

  const ty_param_used_in_fn_params = fn_parameters.some((param) => {
    const ty = this.lowerer().lower_ty(param);
    const tk = ty.kind();
    return tk.$ === "Param" && expected_ty_as_param.index === tk._0.index && expected_ty_as_param.name === tk._0.name;
  });

  if (ty_param_used_in_fn_params) {
    return;
  }

  err.span_suggestion(hir.FnRetTy.span(fn_return), "consider using an impl return type", `impl ${all_bounds_str}`, Applicability.MaybeIncorrect);
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1312 suggest_missing_break_or_return_expr
FnCtxt.prototype.suggest_missing_break_or_return_expr = function (
  this: FnCtxt,
  err: Diag,
  expr: hir.Expr,
  fn_decl: hir.FnDecl,
  expected: Ty,
  found_: Ty,
  id: HirId,
  fn_id: LocalDefId,
): void {
  if (!expected.is_unit()) {
    return;
  }
  const found = this.deeply_resolve_ignoring_regions(found_, fold_Ty);

  let innermost_loop: Node | undefined;
  if (this.is_loop(id)) {
    innermost_loop = this.tcx.hir_node(id);
  } else {
    for (const [parent_id, node] of this.tcx.hir_parent_iter(id)) {
      // look at parents until we find the first body owner
      if (!(hir.Node.body_id(node) === undefined)) break;
      if (this.is_loop(parent_id)) {
        innermost_loop = node;
        break;
      }
    }
  }
  const can_break_with_value =
    innermost_loop !== undefined && innermost_loop.$ === "Expr" && innermost_loop._0.kind.$ === "Loop" && innermost_loop._0.kind._2 === "Loop";

  let in_local_statement = this.is_local_statement(id);
  if (!in_local_statement) {
    for (const [parent_id] of this.tcx.hir_parent_iter(id)) {
      if (this.is_local_statement(parent_id)) {
        in_local_statement = true;
        break;
      }
    }
  }

  if (can_break_with_value && in_local_statement) {
    err.multipart_suggestion(
      "you might have meant to break the loop with this value",
      [
        [Span.shrink_to_lo(expr.span), "break "],
        [Span.shrink_to_hi(expr.span), ";"],
      ],
      Applicability.MaybeIncorrect,
    );
    return;
  }

  let scope: [HirId, Node] | undefined;
  for (const entry of this.tcx.hir_parent_iter(id)) {
    const node = entry[1];
    if ((node.$ === "Expr" && node._0.kind.$ === "Closure") || node.$ === "Item" || node.$ === "TraitItem" || node.$ === "ImplItem") {
      scope = entry;
      break;
    }
  }
  const in_closure = scope !== undefined && scope[1].$ === "Expr" && scope[1]._0.kind.$ === "Closure";

  let can_return: boolean;
  const output = fn_decl.output;
  if (output.$ === "Return") {
    const ty0 = this.lowerer().lower_ty(output._0);
    const bound_vars = this.tcx.late_bound_vars(this.tcx.local_def_id_to_hir_id(fn_id));
    const ty1 = this.tcx.instantiate_bound_regions_with_erased(Binder.bind_with_vars(ty0, bound_vars), fold_Ty);
    let ty2: Ty;
    switch (this.tcx.asyncness(fn_id) as Asyncness) {
      case "Yes": {
        const out = this.tcx.get_impl_future_output_ty(ty1);
        ty2 = out !== undefined ? out : span_bug(hir.FnRetTy.span(fn_decl.output), "failed to get output type of async function");
        break;
      }
      case "No":
        ty2 = ty1;
        break;
    }
    const ty = this.normalize(expr.span, Unnormalized.new_wip(ty2), fold_Ty);
    can_return = this.may_coerce(found, ty);
  } else if (output.$ === "DefaultReturn" && in_closure) {
    const ret = this.ret_coercion;
    can_return =
      ret !== undefined &&
      (() => {
        const ret_ty = ret.expected_ty();
        return this.may_coerce(found, ret_ty);
      })();
  } else {
    can_return = false;
  }
  let span: Span | undefined;
  if (can_return && (span = Span.find_ancestor_inside(expr.span, this.tcx.hir_span_with_body(this.tcx.local_def_id_to_hir_id(fn_id)))) !== undefined) {
    // When the expr is in a match arm's body, we shouldn't add semicolon ';' at the end.
    // For example:
    // fn mismatch_types() -> i32 {
    //     match 1 {
    //         x => dbg!(x),
    //     }
    //     todo!()
    // }
    // -------------^^^^^^^-
    // Don't add semicolon `;` at the end of `dbg!(x)` expr
    // rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1419 is_in_arm
    const is_in_arm = (expr: hir.Expr, tcx: typeof this.tcx): boolean => {
      for (const [, node] of tcx.hir_parent_iter(expr.hir_id)) {
        let ret: hir.Expr | undefined;
        if (node.$ === "Block") {
          if ((ret = node._0.expr) !== undefined && hir.HirId_eq(ret.hir_id, expr.hir_id)) {
            continue;
          }
        } else if (node.$ === "Arm") {
          const arm = node._0;
          if (arm.body.kind.$ === "Block" && (ret = arm.body.kind._0.expr) !== undefined && hir.HirId_eq(ret.hir_id, expr.hir_id)) {
            return true;
          }
        } else if (node.$ === "Expr" && node._0.kind.$ === "Block") {
          const block = node._0.kind._0;
          if ((ret = block.expr) !== undefined && hir.HirId_eq(ret.hir_id, expr.hir_id)) {
            continue;
          }
        } else {
          return false;
        }
      }

      return false;
    };
    const suggs: [Span, string][] = [[Span.shrink_to_lo(span), "return "]];
    if (!is_in_arm(expr, this.tcx)) {
      suggs.push([Span.shrink_to_hi(span), ";"]);
    }
    err.multipart_suggestion("you might have meant to return this value", suggs, Applicability.MaybeIncorrect);
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1464 suggest_missing_parentheses
FnCtxt.prototype.suggest_missing_parentheses = function (this: FnCtxt, err: Diag, expr: hir.Expr): boolean {
  const sp = Span.with_parent(this.tcx.sess.source_map().start_point(expr.span), undefined);
  const sp2 = this.tcx.sess.psess.complete_stmt_exprs_before_bin_op_lookalike.get(sp);
  if (sp2 !== undefined) {
    // `{ 42 } &&x` (#61475) or `{ 42 } && if x { 1 } else { 0 }`
    err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded_surrounding(sp2)));
    return true;
  } else {
    return false;
  }
};

/// Given an expression type mismatch, peel any `&` expressions until we get to
/// a block expression, and then suggest replacing the braces with square braces
/// if it was possibly mistaken array syntax.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1484 suggest_block_to_brackets_peeling_refs
FnCtxt.prototype.suggest_block_to_brackets_peeling_refs = function (this: FnCtxt, diag: Diag, expr_: hir.Expr, expr_ty_: Ty, expected_ty_: Ty): boolean {
  let expr = expr_;
  let expr_ty = expr_ty_;
  let expected_ty = expected_ty_;
  for (;;) {
    const ek = expr.kind;
    const tk = expr_ty.kind();
    const xk = expected_ty.kind();
    if (ek.$ === "AddrOf" && tk.$ === "Ref" && xk.$ === "Ref") {
      expr = ek._2;
      expr_ty = tk._1;
      expected_ty = xk._1;
    } else if (ek.$ === "Block") {
      this.suggest_block_to_brackets(diag, ek._0, expr_ty, expected_ty);
      return true;
    } else {
      return false;
    }
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1511 suggest_clone_for_ref
FnCtxt.prototype.suggest_clone_for_ref = function (this: FnCtxt, diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean {
  const ek = expr_ty.kind();
  let clone_trait_def;
  if (
    ek.$ === "Ref" &&
    ek._2 === "Not" &&
    (clone_trait_def = this.tcx.lang_items().clone_trait()) !== undefined &&
    expected_ty === ek._1 &&
    EvaluationResult.must_apply_modulo_regions(
      this.infcx.type_implements_trait(clone_trait_def, [this.tcx.erase_and_anonymize_regions(expected_ty, fold_Ty)], this.param_env),
    )
  ) {
    const ident = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
    const suggestion = ident !== undefined ? `: ${Symbol.as_str(ident)}.clone()` : ".clone()";

    const span = Span.shrink_to_hi(Span.find_ancestor_not_from_macro(expr.span) ?? expr.span);

    diag.span_suggestion_verbose(span, "consider using clone here", suggestion, Applicability.MachineApplicable);
    return true;
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1548 suggest_copied_cloned_or_as_ref
FnCtxt.prototype.suggest_copied_cloned_or_as_ref = function (this: FnCtxt, diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean {
  const ek = expr_ty.kind();
  if (ek.$ !== "Adt") {
    return false;
  }
  const [adt_def, args] = [ek._0, ek._1];
  const xk = expected_ty.kind();
  if (xk.$ !== "Adt") {
    return false;
  }
  const [expected_adt_def, expected_args] = [xk._0, xk._1];
  if (adt_def !== expected_adt_def) {
    return false;
  }

  const result_did = this.tcx.get_diagnostic_item(sym.Result);
  const option_did = this.tcx.get_diagnostic_item(sym.Option);
  if (
    (result_did !== undefined && DefId_eq(adt_def.did(), result_did) && this.can_eq(this.param_env, args.type_at(1), expected_args.type_at(1), ToTrace_Ty)) ||
    (option_did !== undefined && DefId_eq(adt_def.did(), option_did))
  ) {
    const expr_inner_ty = args.type_at(0);
    const expected_inner_ty = expected_args.type_at(0);
    const ik = expr_inner_ty.kind();
    if (ik.$ === "Ref" && this.can_eq(this.param_env, ik._1, expected_inner_ty, ToTrace_Ty)) {
      const ty = ik._1;
      const def_path = this.tcx.def_path_str(adt_def.did());
      const span = Span.shrink_to_hi(expr.span);
      let subdiag: OptionResultRefMismatch;
      if (this.infcx.type_is_copy_modulo_regions(this.param_env, ty)) {
        subdiag = { $: "Copied", span, def_path };
      } else if (this.infcx.type_is_clone_modulo_regions(this.param_env, ty)) {
        subdiag = { $: "Cloned", span, def_path };
      } else {
        return false;
      }
      diag.subdiagnostic(OptionResultRefMismatch_subdiagnostic(subdiag));
      return true;
    }
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1591 suggest_into
FnCtxt.prototype.suggest_into = function (this: FnCtxt, diag: Diag, expr_: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean {
  const expr = expr_.peel_blocks();

  // We have better suggestions for scalar interconversions...
  if (expr_ty.is_scalar() && expected_ty.is_scalar()) {
    return false;
  }

  // Don't suggest turning a block into another type (e.g. `{}.into()`)
  if (expr.kind.$ === "Block") {
    return false;
  }

  // We'll later suggest `.as_ref` when noting the type error,
  // so skip if we will suggest that instead.
  if (this.err_ctxt().should_suggest_as_ref(expected_ty, expr_ty) !== undefined) {
    return false;
  }

  const into_def_id = this.tcx.get_diagnostic_item(sym.Into);
  if (
    into_def_id !== undefined &&
    this.infcx.predicate_must_hold_modulo_regions(
      Obligation.new(this.tcx, this.misc(expr.span), this.param_env, TraitRef.new(as_interner(this.tcx), into_def_id, [expr_ty, expected_ty]), (from, _interner) =>
        Predicate_upcast_from_TraitRef(from, this.tcx),
      ),
    ) &&
    !(() => {
      for (const x of Span.macro_backtrace(expr.span)) {
        if (x.kind.$ === "Macro" && (x.kind._0 === "Attr" || x.kind._0 === "Derive")) return true;
      }
      return false;
    })()
  ) {
    const span = Span.find_ancestor_not_from_extern_macro(expr.span, this.tcx.sess.source_map()) ?? expr.span;

    let sugg: [Span, string][];
    if (!precedence_lt(this.precedence(expr), ExprPrecedence.Unambiguous)) {
      sugg = [[Span.shrink_to_hi(span), ".into()"]];
    } else {
      sugg = [
        [Span.shrink_to_lo(span), "("],
        [Span.shrink_to_hi(span), ").into()"],
      ];
    }
    const name = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
    if (name !== undefined) {
      sugg.unshift([Span.shrink_to_lo(expr.span), `${Symbol.as_str(name)}: `]);
    }
    diag.multipart_suggestion(
      `call \`Into::into\` on this expression to convert \`${display_Ty(expr_ty)}\` into \`${display_Ty(expected_ty)}\``,
      sugg,
      Applicability.MaybeIncorrect,
    );
    return true;
  }

  return false;
};

/// When expecting a `bool` and finding an `Option`, suggests using `let Some(..)` or `.is_some()`
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1656 suggest_option_to_bool
FnCtxt.prototype.suggest_option_to_bool = function (this: FnCtxt, diag: Diag, expr: hir.Expr, expr_ty: Ty, expected_ty: Ty): boolean {
  if (!expected_ty.is_bool()) {
    return false;
  }

  const ek = expr_ty.peel_refs().kind();
  if (ek.$ !== "Adt") {
    return false;
  }
  const def = ek._0;
  if (!this.tcx.is_diagnostic_item(sym.Option, def.did())) {
    return false;
  }

  let cond_parent: [HirId, Node] | undefined;
  for (const entry of this.tcx.hir_parent_iter(expr.hir_id)) {
    const node = entry[1];
    if (!(node.$ === "Expr" && node._0.kind.$ === "Binary" && node._0.kind._0.node === "And")) {
      cond_parent = entry;
      break;
    }
  }
  // Don't suggest:
  //     `let Some(_) = a.is_some() && b`
  //                     ++++++++++
  // since the user probably just misunderstood how `let else`
  // and `&&` work together.
  if (cond_parent !== undefined && cond_parent[1].$ === "LetStmt") {
    const local = cond_parent[1]._0;
    const pk = local.pat.kind;
    let qpath: hir.QPath | undefined;
    if (pk.$ === "Expr" && pk._0.kind.$ === "Path") {
      qpath = pk._0.kind._0;
    } else if (pk.$ === "TupleStruct") {
      qpath = pk._0;
    }
    let did;
    if (
      qpath !== undefined &&
      qpath.$ === "Resolved" &&
      qpath._0 === undefined &&
      (did = (() => {
        const d0 = Res.opt_def_id(qpath._1.res);
        const d1 = d0 === undefined ? undefined : this.tcx.opt_parent(d0);
        return d1 === undefined ? undefined : this.tcx.opt_parent(d1);
      })()) !== undefined &&
      this.tcx.is_diagnostic_item(sym.Option, did)
    ) {
      return false;
    }
  }

  let suggestion: [Span, string][];
  const ident = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
  if (ident !== undefined) {
    suggestion = [[Span.shrink_to_hi(expr.span), `: ${Symbol.as_str(ident)}.is_some()`]];
  } else if (precedence_lt(this.precedence(expr), ExprPrecedence.Unambiguous)) {
    // Apply the method to the whole expression, e.g. `(*value).is_some()`.
    suggestion = [
      [Span.shrink_to_lo(expr.span), "("],
      [Span.shrink_to_hi(expr.span), ").is_some()"],
    ];
  } else {
    suggestion = [[Span.shrink_to_hi(expr.span), ".is_some()"]];
  }

  diag.multipart_suggestion("use `Option::is_some` to test if the `Option` has a value", suggestion, Applicability.MachineApplicable);
  return true;
};

// Suggest to change `Option<&Vec<T>>::unwrap_or(&[])` to `Option::map_or(&[], |v| v)`.
// #[instrument(level = "trace", skip(self, err, provided_expr))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1718 suggest_deref_unwrap_or
FnCtxt.prototype.suggest_deref_unwrap_or = function (
  this: FnCtxt,
  err: Diag,
  callee_ty: Ty | undefined,
  call_ident: Ident | undefined,
  expected_ty: Ty,
  provided_ty: Ty,
  provided_expr: hir.Expr,
  is_method: boolean,
): void {
  if (!is_method) {
    return;
  }
  if (callee_ty === undefined) {
    return;
  }
  const ck = callee_ty.peel_refs().kind();
  if (ck.$ !== "Adt") {
    return;
  }
  const callee_adt = ck._0;
  let adt_name: string;
  if (this.tcx.is_diagnostic_item(sym.Option, callee_adt.did())) {
    adt_name = "Option";
  } else if (this.tcx.is_diagnostic_item(sym.Result, callee_adt.did())) {
    adt_name = "Result";
  } else {
    return;
  }

  if (call_ident === undefined) {
    return;
  }
  if (call_ident.name !== sym.unwrap_or) {
    return;
  }

  const pk = provided_ty.kind();
  if (pk.$ !== "Ref") {
    return;
  }
  const peeled = pk._1;

  // NOTE: Can we reuse `suggest_deref_or_ref`?

  // Create an dummy type `&[_]` so that both &[] and `&Vec<T>` can coerce to it.
  let dummy_ty: Ty;
  const ak = peeled.kind();
  if (
    ak.$ === "Array" &&
    ak._0.kind().$ === "Infer" &&
    this.try_structurally_resolve_const(provided_expr.span, ak._1).try_to_target_usize(this.tcx) === 0
  ) {
    const slice = Ty.new_slice(this.tcx, ak._0);
    dummy_ty = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_static, slice);
  } else {
    dummy_ty = provided_ty;
  }

  if (!this.may_coerce_except_never(expected_ty, dummy_ty)) {
    return;
  }
  const msg_ = `use \`${adt_name}::map_or\` to deref inner value of \`${adt_name}\``;
  err.multipart_suggestion(
    msg_,
    [
      [call_ident.span, "map_or"],
      [Span.shrink_to_hi(provided_expr.span), ", |v| v"],
    ],
    Applicability.MachineApplicable,
  );
};

/// Suggest wrapping the block in square brackets instead of curly braces
/// in case the block was mistaken array syntax, e.g. `{ 1 }` -> `[ 1 ]`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1788 suggest_block_to_brackets
FnCtxt.prototype.suggest_block_to_brackets = function (this: FnCtxt, diag: Diag, blk: hir.Block, blk_ty: Ty, expected_ty: Ty): void {
  const ek = expected_ty.kind();
  if (ek.$ === "Slice" || ek.$ === "Array") {
    const elem_ty = ek._0;
    let snippet;
    if (
      this.may_coerce(blk_ty, elem_ty) &&
      blk.stmts.length === 0 &&
      blk.rules.$ === "DefaultBlock" &&
      (snippet = this.tcx.sess.source_map().span_to_snippet(blk.span)).$ === "Ok" &&
      snippet._0.starts_with("{") &&
      snippet._0.len() > 0 &&
      snippet._0.byte(snippet._0.len() - 1) === 0x7d /* '}' */
    ) {
      diag.multipart_suggestion(
        "to create an array, use square brackets instead of curly braces",
        [
          [Span.with_hi(Span.shrink_to_lo(blk.span), BytePos(Span.lo(blk.span) + 1)), "["],
          [Span.with_lo(Span.shrink_to_hi(blk.span), BytePos(Span.hi(blk.span) - 1)), "]"],
        ],
        Applicability.MachineApplicable,
      );
    }
  }
};

// #[instrument(skip(self, err))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1827 suggest_floating_point_literal
FnCtxt.prototype.suggest_floating_point_literal = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected_ty: Ty): boolean {
  if (!expected_ty.is_floating_point()) {
    return false;
  }
  const ek = expr.kind;
  let qpath;
  if (ek.$ === "Struct" && ek._1.length === 2 && hir.is_range_literal(expr) && this.tcx.qpath_is_lang_item(ek._0, LangItem.Range)) {
    const [start, end] = [ek._1[0]!, ek._1[1]!];
    err.span_suggestion_verbose(
      Span.with_hi(Span.shrink_to_hi(start.expr.span), Span.lo(end.expr.span)),
      "remove the unnecessary `.` operator for a floating point literal",
      ".",
      Applicability.MaybeIncorrect,
    );
    return true;
  } else if (
    ek.$ === "Struct" &&
    ek._1.length === 1 &&
    hir.is_range_literal(expr) &&
    ((qpath = this.tcx.qpath_lang_item(ek._0)) === LangItem.RangeFrom || qpath === LangItem.RangeTo)
  ) {
    const arg = ek._1[0]!;
    const range_span = unwrap(Span.parent_callsite(expr.span));
    switch (qpath) {
      case LangItem.RangeFrom:
        err.span_suggestion_verbose(
          Span.with_lo(range_span, Span.hi(arg.expr.span)),
          "remove the unnecessary `.` operator for a floating point literal",
          ".",
          Applicability.MaybeIncorrect,
        );
        break;
      default:
        err.span_suggestion_verbose(
          Span.until(range_span, arg.expr.span),
          "remove the unnecessary `.` operator and add an integer part for a floating point literal",
          "0.",
          Applicability.MaybeIncorrect,
        );
    }
    return true;
  } else if (ek.$ === "Lit" && ek._0.node.$ === "Int" && ek._0.node._1.$ === "Unsuffixed") {
    const lit = ek._0.node._0;
    const span = ek._0.span;
    const r = this.tcx.sess.source_map().span_to_snippet(span);
    if (r.$ !== "Ok") {
      return false;
    }
    const snippet = r._0;
    if (!(snippet.starts_with("0x") || snippet.starts_with("0X"))) {
      return false;
    }
    if (snippet.len() <= 5 || !str_is_char_boundary(snippet, snippet.len() - 3)) {
      return false;
    }
    const suffix = snippet.slice(snippet.len() - 3).toString();
    let value: bigint;
    switch (suffix) {
      case "f32":
        value = (lit - 0xf32n) / (16n * 16n * 16n);
        break;
      case "f64":
        value = (lit - 0xf64n) / (16n * 16n * 16n);
        break;
      default:
        return false;
    }
    err.span_suggestions(
      expr.span,
      "rewrite this as a decimal floating point literal, or use `as` to turn a hex literal into a float",
      [`0x${value.toString(16).toUpperCase()} as ${suffix}`, `${value.toString()}_${suffix}`],
      Applicability.MaybeIncorrect,
    );
    return true;
  } else {
    return false;
  }
};

/// Suggest providing `std::ptr::null()` or `std::ptr::null_mut()` if they
/// pass in a literal 0 to an raw pointer.
// #[instrument(skip(self, err))]
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1909 suggest_null_ptr_for_literal_zero_given_to_ptr_arg
FnCtxt.prototype.suggest_null_ptr_for_literal_zero_given_to_ptr_arg = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected_ty: Ty): boolean {
  // Expected type needs to be a raw pointer.
  const ek = expected_ty.kind();
  if (ek.$ !== "RawPtr") {
    return false;
  }
  const mutbl = ek._1;

  // Provided expression needs to be a literal `0`.
  const xk = expr.kind;
  if (!(xk.$ === "Lit" && xk._0.node.$ === "Int" && xk._0.node._0 === 0n)) {
    return false;
  }
  const span = xk._0.span;

  // We need to find a null pointer symbol to suggest
  let null_sym: Symbol;
  switch (mutbl) {
    case "Not":
      null_sym = sym.ptr_null;
      break;
    case "Mut":
      null_sym = sym.ptr_null_mut;
      break;
  }
  const null_did = this.tcx.get_diagnostic_item(null_sym);
  if (null_did === undefined) {
    return false;
  }
  const null_path_str = with_no_trimmed_paths(() => this.tcx.def_path_str(null_did));

  // We have satisfied all requirements to provide a suggestion. Emit it.
  err.span_suggestion(span, `if you meant to create a null pointer, use \`${null_path_str}()\``, null_path_str + "()", Applicability.MachineApplicable);

  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:1947 suggest_associated_const
FnCtxt.prototype.suggest_associated_const = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected_ty: Ty): boolean {
  const tdd = this.typeck_results.type_dependent_def(expr.hir_id);
  if (!(tdd !== undefined && tdd[0].$ === "AssocFn")) {
    return false;
  }
  const old_def_id = tdd[1];
  const old_item_name = this.tcx.item_name(old_def_id);
  const capitalized_name = Symbol.intern(str_to_uppercase(Symbol.as_str(old_item_name)));
  if (old_item_name === capitalized_name) {
    return false;
  }
  let item: AssocItem;
  let segment: hir.PathSegment;
  const ek = expr.kind;
  let ty: hir.Ty | undefined;
  let seg: hir.PathSegment | undefined;
  if (ek.$ === "Path" && ek._0.$ === "Resolved" && ek._0._0 !== undefined && ek._0._1.segments.length === 1) {
    ty = ek._0._0;
    seg = ek._0._1.segments[0]!;
  } else if (ek.$ === "Path" && ek._0.$ === "TypeRelative") {
    ty = ek._0._0;
    seg = ek._0._1;
  }
  let self_ty: Ty | undefined;
  let pick;
  if (
    ty !== undefined &&
    seg !== undefined &&
    (self_ty = this.typeck_results.node_type_opt(ty.hir_id)) !== undefined &&
    (pick = this.probe_for_name(Mode.Path, Ident.new(capitalized_name, seg.ident.span), expected_ty, { _0: true }, self_ty, expr.hir_id, ProbeScope.TraitsInScope)).$ ===
      "Ok"
  ) {
    [item, segment] = [pick._0.item, seg];
  } else if (ek.$ === "Path" && ek._0.$ === "Resolved" && ek._0._0 === undefined && ek._0._1.segments.length >= 1) {
    segment = ek._0._1.segments.at(-1)!;
    // we resolved through some path that doesn't end in the item name,
    // better not do a bad suggestion by accident.
    if (old_item_name !== segment.ident.name) {
      return false;
    }
    const first = AssocItems.filter_by_name_unhygienic(this.tcx.associated_items(this.tcx.parent(old_def_id)) as AssocItems, capitalized_name).next();
    if (first.done === true) {
      return false;
    }
    item = first.value;
  } else {
    return false;
  }
  if (DefId_eq(item.def_id, old_def_id) || this.tcx.def_kind(item.def_id).$ !== "AssocConst") {
    // Same item
    return false;
  }
  const item_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(item.def_id) as EarlyBinder<Ty>));
  // FIXME(compiler-errors): This check is *so* rudimentary
  if (TypeVisitableExt.has_param(item_ty, fold_Ty)) {
    return false;
  }
  // An unused associated const of type `!` may not have been evaluated yet. Do not
  // suggest referring to it just because `!` can coerce to the expected type.
  if (this.may_coerce_except_never(item_ty, expected_ty)) {
    err.span_suggestion_verbose(
      segment.ident.span,
      `try referring to the associated const \`${Symbol.as_str(capitalized_name)}\` instead`,
      Symbol.as_str(capitalized_name),
      Applicability.MachineApplicable,
    );
    return true;
  } else {
    return false;
  }
};

// ==== lane typeck-fnsugg-b: suggestions.rs:2026..3956 ====

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2027 is_loop
FnCtxt.prototype.is_loop = function (this: FnCtxt, id: HirId): boolean {
  const node = this.tcx.hir_node(id);
  return node.$ === "Expr" && node._0.kind.$ === "Loop";
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2032 is_local_statement
FnCtxt.prototype.is_local_statement = function (this: FnCtxt, id: HirId): boolean {
  const node = this.tcx.hir_node(id);
  return node.$ === "Stmt" && node._0.kind.$ === "Let";
};

/// Suggest that `&T` was cloned instead of `T` because `T` does not implement `Clone`,
/// which is a side-effect of autoref.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2039 note_type_is_not_clone
FnCtxt.prototype.note_type_is_not_clone = function (this: FnCtxt, diag: Diag, expected_ty: Ty, found_ty: Ty, expr_: hir.Expr): void {
  // When `expr` is `x` in something like `let x = foo.clone(); x`, need to recurse up to get
  // `foo` and `clone`.
  const expr = this.note_type_is_not_clone_inner_expr(expr_);

  // If we've recursed to an `expr` of `foo.clone()`, get `foo` and `clone`.
  if (!(expr.kind.$ === "MethodCall" && expr.kind._2.length === 0)) {
    return;
  }
  const [segment, callee_expr] = [expr.kind._0, expr.kind._1];

  const clone_trait_did = this.tcx.lang_items().clone_trait();
  if (clone_trait_did === undefined) {
    return;
  }
  const found_kind = found_ty.kind();
  if (found_kind.$ !== "Ref") {
    return;
  }
  const pointee_ty = found_kind._1;
  const results = this.typeck_results;
  // First, look for a `Clone::clone` call
  if (
    segment.ident.name === sym.clone &&
    is_some_and(results.type_dependent_def_id(expr.hir_id), (did) => {
      // PORT: the `associated_item` query's value is typed `unknown` in queries.gen.ts (callee.ts precedent).
      const assoc_item = this.tcx.associated_item(did) as AssocItemT;
      return assoc_item.container.$ === "Trait" && DefId_eq(AssocItem.container_id(assoc_item, this.tcx), clone_trait_did);
    }) &&
    // If that clone call hasn't already dereferenced the self type (i.e. don't give this
    // diagnostic in cases where we have `(&&T).clone()` and we expect `T`).
    !results.expr_adjustments(callee_expr).some((adj) => adj.kind.$ === "Deref") &&
    // Check that we're in fact trying to clone into the expected type
    this.may_coerce(pointee_ty, expected_ty)
  ) {
    const trait_ref = TraitRef.new(as_interner(this.tcx), clone_trait_did, [expected_ty]);
    // And the expected type doesn't implement `Clone`
    if (
      !this.predicate_must_hold_considering_regions(
        Obligation.new(
          this.tcx,
          ObligationCause.dummy(),
          this.param_env,
          trait_ref,
          Predicate_upcast_from_TraitRef as (from: TraitRef, tcx: Interner) => Predicate,
        ),
      )
    ) {
      diag.span_note(callee_expr.span, `\`${display_Ty(expected_ty)}\` does not implement \`Clone\`, so \`${display_Ty(found_ty)}\` was cloned instead`);
      const owner = this.tcx.hir_enclosing_body_owner(expr.hir_id);
      const expected_kind = expected_ty.kind();
      const generics = expected_kind.$ === "Param" ? this.tcx.hir_get_generics(owner) : undefined;
      if (expected_kind.$ === "Param" && generics !== undefined) {
        const param = expected_kind._0;
        suggest_constraining_type_params(this.tcx, generics, diag, [[Symbol.as_str(param.name), "Clone", clone_trait_did]], undefined);
      } else {
        let suggest_derive = true;
        const errors = this.type_implements_trait_shallow(clone_trait_did, expected_ty, this.param_env);
        if (errors !== undefined) {
          const manually_impl = "consider manually implementing `Clone` to avoid the implicit type parameter bounds";
          const errors_slice = TraitErrors.as_slice(errors);
          if (errors_slice.length === 0) {
            // nothing
          } else if (errors_slice.length === 1) {
            const error = errors_slice[0]!;
            const msg = "`Clone` is not implemented because a trait bound is not satisfied";
            const code = error.obligation.cause.code_();
            if (code.$ === "ImplDerived") {
              const data = code._0;
              const span: MultiSpan = MultiSpan.from_Span(data.span);
              if (this.tcx.is_automatically_derived(data.impl_or_alias_def_id)) {
                span.push_span_label(data.span, `derive introduces an implicit \`${display_Predicate(error.obligation.predicate)}\` bound`);
              }
              diag.span_help(span, msg);
              if (this.tcx.is_automatically_derived(data.impl_or_alias_def_id) && data.impl_or_alias_def_id.is_local()) {
                diag.help(manually_impl);
                suggest_derive = false;
              }
            } else {
              diag.help(msg);
            }
          } else {
            const unsatisfied_bounds: [Span, string][] = [];
            for (const error of errors_slice) {
              const code = error.obligation.cause.code_();
              if (code.$ === "ImplDerived") {
                const data = code._0;
                const pre = this.tcx.is_automatically_derived(data.impl_or_alias_def_id) ? "derive introduces an implicit " : "";
                unsatisfied_bounds.push([data.span, `${pre}unsatisfied trait bound \`${display_Predicate(error.obligation.predicate)}\``]);
              }
            }
            const msg = "`Clone` is not implemented because the some trait bounds could not be satisfied";
            if (TraitErrors.len(errors) === unsatisfied_bounds.length) {
              const unsatisfied_bounds_spans: MultiSpan = MultiSpan.from_Vec(unsatisfied_bounds.map(([span, _]) => span));
              for (const [span, label] of unsatisfied_bounds) {
                unsatisfied_bounds_spans.push_span_label(span, label);
              }
              diag.span_help(unsatisfied_bounds_spans, msg);
              if (
                errors_slice.every((error) => {
                  const code = error.obligation.cause.code_();
                  if (code.$ === "ImplDerived") {
                    const data = code._0;
                    return this.tcx.is_automatically_derived(data.impl_or_alias_def_id) && data.impl_or_alias_def_id.is_local();
                  } else {
                    return false;
                  }
                })
              ) {
                diag.help(manually_impl);
                suggest_derive = false;
              }
            } else {
              diag.help(`${msg}: ${unwrap(listify(errors_slice, (e) => `\`${display_Predicate(e.obligation.predicate)}\``))}`);
            }
          }
          for (const error of TraitErrors.into_iter(errors)) {
            if (error.code.$ === "Select" && error.code._0.$ === "Unimplemented") {
              const kind = Binder.skip_binder(error.obligation.predicate.kind());
              if (kind.$ === "Clause" && kind._0.$ === "Trait") {
                const pred = kind._0._0;
                this.infcx.err_ctxt().suggest_derive(error.obligation, diag, Binder.rebind(error.obligation.predicate.kind(), pred));
              }
            }
          }
        }
        if (suggest_derive) {
          this.suggest_derive(diag, [[Predicate_upcast_from_TraitRef(trait_ref, this.tcx), undefined, undefined]]);
        }
      }
    }
  }
};

/// Given a type mismatch error caused by `&T` being cloned instead of `T`, and
/// the `expr` as the source of this type mismatch, try to find the method call
/// as the source of this error and return that instead. Otherwise, return the
/// original expression.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2222 note_type_is_not_clone_inner_expr
FnCtxt.prototype.note_type_is_not_clone_inner_expr = function (this: FnCtxt, expr: hir.Expr): hir.Expr {
  const kind = expr.peel_blocks().kind;
  if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._0._1.segments.length === 1 && kind._0._1.res.$ === "Local") {
    const binding = kind._0._1.res._0;
    const binding_node = this.tcx.hir_node(binding);
    if (binding_node.$ !== "Pat") {
      return expr;
    }
    const hir_id = binding_node._0.hir_id;

    const parent = this.tcx.parent_hir_node(hir_id);
    if (parent.$ === "LetStmt" && parent._0.init !== undefined) {
      // foo.clone()
      return this.note_type_is_not_clone_inner_expr(parent._0.init);
    } else if (parent.$ === "Pat" && parent._0.kind.$ === "Tuple") {
      // When `expr` is more complex like a tuple
      const pat_hir_id = parent._0.hir_id;
      const pats = parent._0.kind._0;
      const let_node = this.tcx.parent_hir_node(pat_hir_id);
      if (!(let_node.$ === "LetStmt" && let_node._0.init !== undefined)) {
        return expr;
      }
      const init = let_node._0.init;

      const init_kind = init.peel_blocks().kind;
      if (init_kind.$ === "Tup") {
        const init_tup = init_kind._0;
        let found: hir.Expr | undefined;
        for (let i = 0; i < pats.length; i++) {
          if (HirId_eq(pats[i]!.hir_id, hir_id) && i < init_tup.length) {
            found = init_tup[i]!;
            break;
          }
        }
        if (found !== undefined) {
          return this.note_type_is_not_clone_inner_expr(found);
        } else {
          return expr;
        }
      } else {
        return expr;
      }
    } else {
      return expr;
    }
  } else if (kind.$ === "Call") {
    // If we're calling into a closure that may not be typed recurse into that call. no need
    // to worry if it's a call to a typed function or closure as this would ne handled
    // previously.
    const call_expr_kind = kind._0.kind;
    if (call_expr_kind.$ === "Path" && call_expr_kind._0.$ === "Resolved" && call_expr_kind._0._0 === undefined) {
      const call_expr_path = call_expr_kind._0._1;
      if (call_expr_path.segments.length === 1 && call_expr_path.res.$ === "Local") {
        const binding = call_expr_path.res._0;
        const pat_node = this.tcx.hir_node(binding);
        if (pat_node.$ === "Pat") {
          const let_node = this.tcx.parent_hir_node(pat_node._0.hir_id);
          if (let_node.$ === "LetStmt" && let_node._0.init !== undefined && let_node._0.init.kind.$ === "Closure") {
            const body_id = let_node._0.init.kind._0.body;
            const body_expr = this.tcx.hir_body(body_id).value;
            return this.note_type_is_not_clone_inner_expr(body_expr);
          }
        }
      }
    }
    return expr;
  } else {
    return expr;
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2297 is_field_suggestable
FnCtxt.prototype.is_field_suggestable = function (this: FnCtxt, field: FieldDef, span: Span): boolean {
  // The field must be visible in the containing module.
  return (
    Visibility.is_accessible_from(field.vis, this.mod_id, this.tcx) &&
    // The field must not be unstable.
    !(this.tcx.eval_stability(field.did, undefined, DUMMY_SP, undefined).$ === "Deny") &&
    // If the field is from an external crate it must not be `doc(hidden)`.
    (field.did.is_local() || !this.tcx.is_doc_hidden(field.did)) &&
    // If the field is hygienic it must come from the same syntax context.
    Span.eq_ctxt(Span.normalize_to_macros_2_0(unwrap(this.tcx.def_ident_span(field.did))), span)
  );
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2311 suggest_missing_unwrap_expect
FnCtxt.prototype.suggest_missing_unwrap_expect = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  // don't suggest missing `.expect()` or `?` in destructuring assignments LHS.
  // If the immediate parent is an Assign Expr, and the LHS and the RHS of that Expr
  // overlap with each other, it's guaranteed that the expression came from desugaring
  // a destructuring assignment.
  const parent_node = this.tcx.parent_hir_node(expr.hir_id);
  if (parent_node.$ === "Expr" && parent_node._0.kind.$ === "Assign") {
    const [lhs, rhs] = [parent_node._0.kind._0, parent_node._0.kind._1];
    if (HirId_eq(rhs.hir_id, expr.hir_id) && Span.overlaps(lhs.span, rhs.span)) {
      return false;
    }
  }

  const found_kind = found.kind();
  if (found_kind.$ !== "Adt") {
    return false;
  }
  const [adt, args] = [found_kind._0, found_kind._1];
  const ret_ty_matches = (diagnostic_item: Symbol): boolean => {
    const sig = this.fn_sig();
    if (sig === undefined) {
      return false;
    }
    const k = FnSigC.output(sig).kind();
    if (k.$ !== "Adt") {
      return false;
    }
    const kind = k._0;
    return this.tcx.is_diagnostic_item(diagnostic_item, kind.did());
  };

  // don't suggest anything like `Ok(ok_val).unwrap()` , `Some(some_val).unwrap()`,
  // `None.unwrap()` etc.
  const is_ctor_path = (k: hir.ExprKind): boolean =>
    k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined && k._0._1.res.$ === "Def" && k._0._1.res._0.$ === "Ctor";
  const is_ctor = (expr.kind.$ === "Call" && is_ctor_path(expr.kind._0.kind)) || is_ctor_path(expr.kind);

  let article: string, kind: string, variant: string, sugg_operator: boolean;
  if (
    this.tcx.is_diagnostic_item(sym.Result, adt.did()) &&
    // Do not suggest `.expect()` in const context where it's not available. rust-lang/rust#149316
    !this.tcx.hir_is_inside_const_context(expr.hir_id)
  ) {
    [article, kind, variant, sugg_operator] = ["a", "Result", "Err", ret_ty_matches(sym.Result)];
  } else if (this.tcx.is_diagnostic_item(sym.Option, adt.did())) {
    [article, kind, variant, sugg_operator] = ["an", "Option", "None", ret_ty_matches(sym.Option)];
  } else {
    return false;
  }
  const inner_ty = args.type_at(0);

  // For `Option<!>` where `Option<u32>` is expected, extracting `!` cannot produce
  // an `Option<u32>`. Never-to-any coercion alone must not justify `.expect()` or `?`.
  if (is_ctor || !this.may_coerce_except_never(inner_ty, expected)) {
    return false;
  }

  let msg: string, sugg_: string;
  if (sugg_operator) {
    [msg, sugg_] = [
      `use the \`?\` operator to extract the \`${display_Ty(found)}\` value, propagating ${article} \`${kind}::${variant}\` value to the caller`,
      "?",
    ];
  } else {
    [msg, sugg_] = [
      `consider using \`${kind}::expect\` to unwrap the \`${display_Ty(found)}\` value, panicking if the value is ${article} \`${kind}::${variant}\``,
      '.expect("REASON")',
    ];
  }

  let sugg: string;
  const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
  if (shorthand !== undefined && Span.from_expansion(expr.span)) {
    return false;
  } else if (shorthand !== undefined) {
    const ident = shorthand;
    sugg = `: ${Symbol.as_str(ident)}${sugg_}`;
  } else {
    sugg = sugg_;
  }

  const span = Span.find_ancestor_not_from_extern_macro(expr.span, this.tcx.sess.source_map()) ?? expr.span;
  err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, sugg, "HasPlaceholders");
  return true;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2413 suggest_coercing_result_via_try_operator
FnCtxt.prototype.suggest_coercing_result_via_try_operator = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, found: Ty): boolean {
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  const returned = (parent.$ === "Expr" && parent._0.kind.$ === "Ret") || this.tcx.hir_get_fn_id_for_return_block(expr.hir_id) !== undefined;
  if (returned) {
    const ek = expected.kind();
    const fk = found.kind();
    if (ek.$ === "Adt" && fk.$ === "Adt") {
      const [e, args_e] = [ek._0, ek._1];
      const [f, args_f] = [fk._0, fk._1];
      if (DefId_eq(e.did(), f.did()) && ((d) => d !== undefined && DefId_eq(e.did(), d))(this.tcx.get_diagnostic_item(sym.Result))) {
        const e_ok = args_e.type_at(0);
        const f_ok = args_f.type_at(0);
        if (this.infcx.can_eq(this.param_env, f_ok, e_ok, ToTrace_Ty)) {
          const e_err = args_e.type_at(1);
          const f_err = args_f.type_at(1);
          if (
            EvaluationResult.must_apply_modulo_regions(
              this.infcx.type_implements_trait(unwrap(this.tcx.get_diagnostic_item(sym.Into)), [f_err, e_err], this.param_env),
            )
          ) {
            err.multipart_suggestion(
              "use `?` to coerce and return an appropriate `Err`, and wrap the resulting value in `Ok` so the expression remains of type `Result`",
              [
                [Span.shrink_to_lo(expr.span), "Ok("],
                [Span.shrink_to_hi(expr.span), "?)"],
              ],
              "MaybeIncorrect",
            );
            return true;
          }
        }
      }
    }
  }
  return false;
};

// If the expr is a while or for loop and is the tail expr of its
// enclosing body suggest returning a value right after it
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2459 suggest_returning_value_after_loop
FnCtxt.prototype.suggest_returning_value_after_loop = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty): boolean {
  const tcx = this.tcx;
  const scope_id = tcx.hir_get_enclosing_scope(expr.hir_id);
  const enclosing_scope = scope_id === undefined ? undefined : tcx.hir_node(scope_id);

  // Get tail expr of the enclosing block or body
  let tail_expr: hir.Expr | undefined;
  if (enclosing_scope !== undefined && enclosing_scope.$ === "Block" && enclosing_scope._0.expr !== undefined) {
    tail_expr = enclosing_scope._0.expr;
  } else {
    const body_def_id = tcx.hir_enclosing_body_owner(expr.hir_id);
    const body = tcx.hir_body_owned_by(body_def_id);

    // Get tail expr of the body
    const k = body.value.kind;
    switch (k.$) {
      // Regular function body etc.
      case "Block":
        tail_expr = k._0.expr;
        break;
      // Anon const body (there's no block in this case)
      case "DropTemps":
        tail_expr = k._0;
        break;
      default:
        tail_expr = undefined;
    }
  }

  if (tail_expr === undefined) {
    return false; // Body doesn't have a tail expr we can compare with
  }

  // Get the loop expr within the tail expr
  let loop_expr_in_tail: hir.Expr;
  if (expr.kind.$ === "Loop" && expr.kind._2 === "While") {
    loop_expr_in_tail = tail_expr;
  } else if (expr.kind.$ === "Loop" && expr.kind._2 === "ForLoop") {
    const peeled = tail_expr.peel_drop_temps();
    if (peeled.kind.$ === "Match" && peeled.kind._1.length === 1) {
      loop_expr_in_tail = peeled.kind._1[0]!.body;
    } else {
      return false; // Not really a for loop
    }
  } else {
    return false; // Not a while or a for loop
  }

  // If the expr is the loop expr in the tail
  // then make the suggestion
  if (HirId_eq(expr.hir_id, loop_expr_in_tail.hir_id)) {
    const span = expr.span;

    let msg: string, suggestion: string;
    if (expected.is_never()) {
      [msg, suggestion] = ["consider adding a diverging expression here", '`loop {}` or `panic!("...")`'];
    } else {
      [msg, suggestion] = ["consider returning a value here", `\`${display_Ty(expected)}\` value`];
    }

    const src_map = tcx.sess.source_map();
    let suggestion_: string;
    if (src_map.is_multiline(expr.span)) {
      const indentation = src_map.indentation_before(span)?.toString() ?? "";
      suggestion_ = `\n${indentation}/* ${suggestion} */`;
    } else {
      // If the entire expr is on a single line
      // put the suggestion also on the same line
      suggestion_ = ` /* ${suggestion} */`;
    }

    err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, suggestion_, "MaybeIncorrect");

    return true;
  } else {
    return false;
  }
};

/// Suggest replacing comma with semicolon in incorrect repeat expressions
/// like `["_", 10]` or `vec![String::new(), 10]`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2543 suggest_semicolon_in_repeat_expr
FnCtxt.prototype.suggest_semicolon_in_repeat_expr = function (this: FnCtxt, err: Diag, expr: hir.Expr, expr_ty: Ty): boolean {
  // Check if `expr` is contained in array of two elements
  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (parent.$ === "Expr" && parent._0.kind.$ === "Array" && parent._0.kind._0.length === 2 && HirId_eq(parent._0.kind._0[1]!.hir_id, expr.hir_id)) {
    const array_expr = parent._0;
    const [first, second] = [parent._0.kind._0[0]!, parent._0.kind._0[1]!];
    // Span between the two elements of the array
    const comma_span = Span.between(first.span, second.span);

    // Check if `expr` is a constant value of type `usize`.
    // This can only detect const variable declarations and
    // calls to const functions.

    // Checking this here instead of rustc_hir::hir because
    // this check needs access to `self.tcx` but rustc_hir
    // has no access to `TyCtxt`.
    const expr_is_const_usize =
      expr_ty.is_usize() &&
      ((): boolean => {
        const k = expr.kind;
        if (k.$ === "Path" && k._0.$ === "Resolved" && k._0._0 === undefined && k._0._1.res.$ === "Def" && k._0._1.res._0.$ === "Const") {
          return true;
        } else if (k.$ === "Call") {
          const ck = k._0.kind;
          if (ck.$ === "Path" && ck._0.$ === "Resolved" && ck._0._0 === undefined && ck._0._1.res.$ === "Def" && ck._0._1.res._0.$ === "Fn") {
            const fn_def_id = ck._0._1.res._1;
            return this.tcx.is_const_fn(fn_def_id);
          }
          return false;
        } else {
          return false;
        }
      })();

    // Type of the first element is guaranteed to be checked
    // when execution reaches here because `mismatched types`
    // error occurs only when type of second element of array
    // is not the same as type of first element.
    const first_ty = this.typeck_results.expr_ty(first);

    // `array_expr` is from a macro `vec!["a", 10]` if
    // 1. array expression's span is imported from a macro
    // 2. first element of array implements `Clone` trait
    // 3. second element is an integer literal or is an expression of `usize` like type
    if (
      this.tcx.sess.source_map().is_imported(array_expr.span) &&
      this.type_is_clone_modulo_regions(this.param_env, first_ty) &&
      (expr.is_size_lit() || expr_ty.is_usize_like())
    ) {
      err.subdiagnostic(ReplaceCommaWithSemicolon_subdiagnostic({ comma_span, descr: "a vector" }));
      return true;
    }

    // `array_expr` is from an array `["a", 10]` if
    // 1. first element of array implements `Copy` trait
    // 2. second element is an integer literal or is a const value of type `usize`
    if (this.type_is_copy_modulo_regions(this.param_env, first_ty) && (expr.is_size_lit() || expr_is_const_usize)) {
      err.subdiagnostic(ReplaceCommaWithSemicolon_subdiagnostic({ comma_span, descr: "an array" }));
      return true;
    }
  }
  return false;
};

/// If the expected type is an enum (Issue #55250) with any variants whose
/// sole field is of the found type, suggest such variants. (Issue #42764)
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2624 suggest_compatible_variants
FnCtxt.prototype.suggest_compatible_variants = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean {
  if (Span.in_external_macro(expr.span, this.tcx.sess.source_map())) {
    return false;
  }
  const expected_kind = expected.kind();
  if (expected_kind.$ === "Adt") {
    const [expected_adt, args] = [expected_kind._0, expected_kind._1];
    if (expr.kind.$ === "Field") {
      const [base, ident] = [expr.kind._0, expr.kind._1];
      const base_ty = this.typeck_results.expr_ty(base);
      if (this.can_eq(this.param_env, base_ty, expected, ToTrace_Ty)) {
        const base_span = Span.find_ancestor_inside(base.span, expr.span);
        if (base_span !== undefined) {
          err.span_suggestion_verbose(
            Span.with_lo(expr.span, Span.hi(base_span)),
            `consider removing the tuple struct field \`${display_Ident(ident)}\``,
            "",
            "MaybeIncorrect",
          );
          return true;
        }
      }
    }

    // If the expression is of type () and it's the return expression of a block,
    // we suggest adding a separate return expression instead.
    // (To avoid things like suggesting `Ok(while .. { .. })`.)
    if (expr_ty.is_unit()) {
      let id = expr.hir_id;
      let parent: HirId;

      // Unroll desugaring, to make sure this works for `for` loops etc.
      for (;;) {
        parent = this.tcx.parent_hir_id(id);
        const parent_span = this.tcx.hir_span(parent);
        if (Span.find_ancestor_inside(parent_span, expr.span) !== undefined) {
          // The parent node is part of the same span, so is the result of the
          // same expansion/desugaring and not the 'real' parent node.
          id = parent;
          continue;
        }
        break;
      }

      const parent_node = this.tcx.hir_node(parent);
      if (parent_node.$ === "Block" && parent_node._0.expr !== undefined) {
        const [block_span, e] = [parent_node._0.span, parent_node._0.expr];
        if (HirId_eq(e.hir_id, id)) {
          const span = Span.find_ancestor_inside(expr.span, block_span);
          if (span !== undefined) {
            let return_suggestions: string[];
            if (this.tcx.is_diagnostic_item(sym.Result, expected_adt.did())) {
              return_suggestions = ["Ok(())"];
            } else if (this.tcx.is_diagnostic_item(sym.Option, expected_adt.did())) {
              return_suggestions = ["None", "Some(())"];
            } else {
              return false;
            }
            const indent = this.tcx.sess.source_map().indentation_before(Span.shrink_to_lo(span));
            if (indent !== undefined) {
              // Add a semicolon, except after `}`.
              const snippet = this.tcx.sess.source_map().span_to_snippet(span);
              const semicolon = snippet.$ === "Ok" && snippet._0.toString().endsWith("}") ? "" : ";";
              err.span_suggestions(
                Span.shrink_to_hi(span),
                "try adding an expression at the end of the block",
                return_suggestions.map((r) => `${semicolon}\n${indent.toString()}${r}`),
                "MaybeIncorrect",
              );
            }
            return true;
          }
        }
      }
    }

    const compatible_variants: [string, CtorKind | undefined, Symbol, string | undefined][] = [];
    for (const variant of expected_adt.variants()) {
      if (!(variant.fields.length === 1)) {
        continue;
      }
      const sole_field = variant.single_field();

      // When expected_ty and expr_ty are the same ADT, we prefer to compare their internal generic params,
      // When the current variant has a sole field whose type is still an unresolved inference variable,
      // suggestions would be often wrong. So suppress the suggestion. See #145294.
      const [ek, ak] = [expected.kind(), expr_ty.kind()];
      if (ek.$ === "Adt" && ak.$ === "Adt" && DefId_eq(ek._0.did(), ak._0.did()) && Unnormalized.skip_norm_wip(sole_field.ty(this.tcx, args)).is_ty_var()) {
        continue;
      }

      const field_is_local = sole_field.did.is_local();
      const field_is_accessible =
        Visibility.is_accessible_from(sole_field.vis, expr.hir_id.owner.def_id, this.tcx) &&
        // Skip suggestions for unstable public fields (for example `Pin::__pointer`)
        ((): boolean => {
          const r = this.tcx.eval_stability(sole_field.did, undefined, expr.span, undefined);
          return r.$ === "Allow" || r.$ === "Unmarked";
        })();

      if (!field_is_local && !field_is_accessible) {
        continue;
      }

      const note_about_variant_field_privacy =
        field_is_local && !field_is_accessible ? " (its field is private, but it's local to this crate and its privacy can be changed)" : undefined;

      const sole_field_ty = Unnormalized.skip_norm_wip(sole_field.ty(this.tcx, args));
      if (this.may_coerce(expr_ty, sole_field_ty)) {
        const variant_path = with_types_for_suggestion(() => with_no_trimmed_paths(() => this.tcx.def_path_str(variant.def_id)));
        // FIXME #56861: DRYer prelude filtering
        if (variant_path.startsWith("std::prelude::")) {
          const path = variant_path.slice("std::prelude::".length);
          const idx = path.indexOf("::");
          if (idx !== -1) {
            const path_ = path.slice(idx + 2);
            compatible_variants.push([path_, variant.ctor_kind(), sole_field.name, note_about_variant_field_privacy]);
            continue;
          }
        }
        compatible_variants.push([variant_path, variant.ctor_kind(), sole_field.name, note_about_variant_field_privacy]);
      }
    }

    const suggestions_for = (variant: string, ctor_kind: CtorKind | undefined, field_name: Symbol): [Span, string][] => {
      const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

      let open: string, close: string;
      if (ctor_kind === "Fn") {
        [open, close] = ["(", ")"];
      } else if (ctor_kind === undefined) {
        [open, close] = [` { ${Symbol.as_str(field_name)}: `, " }"];
      } else {
        return unreachable("unit variants don't have fields");
      }

      // Suggest constructor as deep into the block tree as possible,
      // but don't cross macro contexts. This fixes #101065 while
      // keeping suggestions out of macro definitions (#142359).
      let expr_ = expr;
      while (expr_.kind.$ === "Block" && expr_.kind._0.expr !== undefined && Span.eq_ctxt(expr_.kind._0.expr.span, expr_.span)) {
        expr_ = expr_.kind._0.expr;
      }

      return [
        [Span.shrink_to_lo(expr_.span), `${prefix}${variant}${open}`],
        [Span.shrink_to_hi(expr_.span), close],
      ];
    };

    if (compatible_variants.length === 0) {
      /* No variants to format */
    } else if (compatible_variants.length === 1) {
      const [variant, ctor_kind, field_name, note] = compatible_variants[0]!;
      // Just a single matching variant.
      err.multipart_suggestion(
        `try wrapping the expression in \`${variant}\`${note ?? ""}`,
        suggestions_for(variant, ctor_kind, field_name),
        "MaybeIncorrect",
      );
      return true;
    } else {
      // More than one matching variant.
      err.multipart_suggestions(
        `try wrapping the expression in a variant of \`${this.tcx.def_path_str(expected_adt.did())}\``,
        compatible_variants.map(([variant, ctor_kind, field_name, _]) => suggestions_for(variant, ctor_kind, field_name)),
        "MaybeIncorrect",
      );
      return true;
    }
  }

  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2824 suggest_non_zero_new_unwrap
FnCtxt.prototype.suggest_non_zero_new_unwrap = function (this: FnCtxt, err: Diag, expr: hir.Expr, expected: Ty, expr_ty: Ty): boolean {
  const tcx = this.tcx;
  const ek = expected.kind();
  let adt: AdtDef, args: GenericArgs, unwrap_: string;
  if (ek.$ === "Adt" && tcx.is_diagnostic_item(sym.Option, ek._0.did())) {
    // In case `Option<NonZero<T>>` is wanted, but `T` is provided, suggest calling `new`.
    const nonzero_type = ek._1.type_at(0); // Unwrap option type.
    const nk = nonzero_type.kind();
    if (nk.$ !== "Adt") {
      return false;
    }
    [adt, args, unwrap_] = [nk._0, nk._1, ""];
  } else if (ek.$ === "Adt") {
    // In case `NonZero<T>` is wanted but `T` is provided, also add `.unwrap()` to satisfy types.
    [adt, args, unwrap_] = [ek._0, ek._1, ".unwrap()"];
  } else {
    return false;
  }

  if (!this.tcx.is_diagnostic_item(sym.NonZero, adt.did())) {
    return false;
  }

  const int_type = args.type_at(0);
  if (!this.may_coerce(expr_ty, int_type)) {
    return false;
  }

  err.multipart_suggestion(
    `consider calling \`${Symbol.as_str(sym.NonZero)}::new\``,
    [
      [Span.shrink_to_lo(expr.span), `${Symbol.as_str(sym.NonZero)}::new(`],
      [Span.shrink_to_hi(expr.span), `)${unwrap_}`],
    ],
    "MaybeIncorrect",
  );

  return true;
};

/// Identify some cases where `as_ref()` or `as_mut()` would be appropriate and suggest it.
///
/// Given the following code:
/// ```compile_fail,E0308
/// struct Foo;
/// fn takes_ref(_: &Foo) {}
/// let ref opt = Some(Foo);
///
/// opt.map(|param| takes_ref(param));
/// ```
/// Suggest using `opt.as_ref().map(|param| takes_ref(param));` instead.
///
/// It only checks for `Option` and `Result` and won't work with
/// ```ignore (illustrative)
/// opt.map(|param| { takes_ref(param) });
/// ```
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2883 can_use_as_ref_or_mut
FnCtxt.prototype.can_use_as_ref_or_mut = function (this: FnCtxt, expr: hir.Expr, mutability: Mutability): [[Span, string][], string] | undefined {
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved")) {
    return undefined;
  }
  const path = expr.kind._0._1;

  if (path.res.$ !== "Local") {
    return undefined;
  }
  const local_id = path.res._0;

  const param_node = this.tcx.parent_hir_node(local_id);
  if (param_node.$ !== "Param") {
    return undefined;
  }
  const param_hir_id = param_node._0.hir_id;

  const closure_node = this.tcx.parent_hir_node(param_hir_id);
  if (!(closure_node.$ === "Expr" && closure_node._0.kind.$ === "Closure")) {
    return undefined;
  }
  const expr_hir_id = closure_node._0.hir_id;
  const closure_fn_decl = closure_node._0.kind._0.fn_decl;

  const hir_ = this.tcx.parent_hir_node(expr_hir_id);
  const closure_params_len = closure_fn_decl.inputs.length;
  if (!(hir_.$ === "Expr" && hir_._0.kind.$ === "MethodCall" && closure_params_len === 1)) {
    return undefined;
  }
  const [method_path, receiver] = [hir_._0.kind._0, hir_._0.kind._1];

  let self_ty = this.typeck_results.expr_ty_opt(receiver);
  if (self_ty === undefined) {
    return undefined;
  }
  for (let k = self_ty.kind(); k.$ === "Ref"; k = self_ty.kind()) {
    const [inner, ref_mutability] = [k._1, k._2];
    // `as_mut()` cannot borrow through a shared reference,
    // also we cannot suggest `as_ref()` either when the reference is shared
    if (Mutability.is_mut(mutability) && Mutability.is_not(ref_mutability)) {
      return undefined;
    }
    self_ty = inner;
  }
  const name = method_path.ident.name;
  const sk = self_ty.kind();
  let can_borrow: boolean;
  if (sk.$ === "Adt") {
    const def = sk._0;
    can_borrow =
      (this.tcx.is_diagnostic_item(sym.Option, def.did()) || this.tcx.is_diagnostic_item(sym.Result, def.did())) &&
      (name === sym.map || name === sym.and_then);
  } else {
    can_borrow = false;
  }
  if (can_borrow) {
    let suggestion: string, message: string;
    switch (mutability) {
      case "Not":
        [suggestion, message] = ["as_ref().", "consider using `as_ref` instead"];
        break;
      case "Mut":
        [suggestion, message] = ["as_mut().", "consider using `as_mut` instead"];
        break;
    }
    return [[[Span.shrink_to_lo(method_path.ident.span), suggestion]], message];
  } else {
    return undefined;
  }
};

/// This function is used to determine potential "simple" improvements or users' errors and
/// provide them useful help. For example:
///
/// ```compile_fail,E0308
/// fn some_fn(s: &str) {}
///
/// let x = "hey!".to_owned();
/// some_fn(x); // error
/// ```
///
/// No need to find every potential function which could make a coercion to transform a
/// `String` into a `&str` since a `&` would do the trick!
///
/// In addition of this check, it also checks between references mutability state. If the
/// expected is mutable but the provided isn't, maybe we could just say "Hey, try with
/// `&mut`!".
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:2969 suggest_deref_or_ref
FnCtxt.prototype.suggest_deref_or_ref = function (
  this: FnCtxt,
  expr_: hir.Expr,
  checked_ty: Ty,
  expected: Ty,
): [[Span, string][], string, Applicability, boolean /* suggest `&` or `&mut` type annotation */] | undefined {
  const sess = this.sess();
  const sp = expr_.range_span() ?? expr_.span;
  const sm = sess.source_map();

  // If the span is from an external macro, there's no suggestion we can make.
  if (Span.in_external_macro(sp, sm)) {
    return undefined;
  }

  const replace_prefix = (s: string, old: string, new_: string): string | undefined => (s.startsWith(old) ? new_ + s.slice(old.length) : undefined);

  // `ExprKind::DropTemps` is semantically irrelevant for these suggestions.
  const expr = expr_.peel_drop_temps();
  const ek = expected.kind();
  const ck = checked_ty.kind();
  // Handle call arguments that need another shared or mutable reference, such as
  // `&T` to `&&T` or `&T` to `&mut &T`.
  // Keep ordinary `T` to `&T` cases on later path so its more
  // specific suggestions, such as `Option::as_ref()`, are preserved.
  if (
    ek.$ === "Ref" &&
    ek._1.is_ref() &&
    ((): boolean => {
      const parent = this.tcx.parent_hir_node(expr.hir_id);
      if (parent.$ !== "Expr") {
        return false;
      }
      const pk = parent._0.kind;
      const args = pk.$ === "Call" ? pk._1 : pk.$ === "MethodCall" ? pk._2 : undefined;
      return args !== undefined && args.some((arg) => HirId_eq(arg.hir_id, expr.hir_id));
    })() &&
    this.can_eq(this.param_env, ek._1, checked_ty, ToTrace_Ty)
  ) {
    const mutability = ek._2;
    const borrow = Mutability.ref_prefix_str(mutability);
    let sugg: [Span, string][];
    if (expr_needs_parens(expr)) {
      sugg = [
        [Span.shrink_to_lo(sp), `${borrow}(`],
        [Span.shrink_to_hi(sp), ")"],
      ];
    } else {
      sugg = [[Span.shrink_to_lo(sp), borrow]];
    }
    return [sugg, `consider ${Mutability.mutably_str(mutability)}borrowing here`, "MachineApplicable", false];
  } else if (ek.$ === "Ref" && ck.$ === "Ref") {
    const [exp, check] = [ek._1, ck._1];
    const [xk, kk] = [exp.kind(), check.kind()];
    if (xk.$ === "Str" && (kk.$ === "Array" || kk.$ === "Slice") && kk._0 === this.tcx.types.u8) {
      if (expr.kind.$ === "Lit") {
        const src = sm.span_to_snippet(sp);
        if (src.$ === "Ok" && replace_prefix(src._0.toString(), 'b"', '"') !== undefined) {
          const pos = BytePos(Span.lo(sp) + 1);
          return [[[Span.with_hi(sp, pos), ""]], "consider removing the leading `b`", "MachineApplicable", false];
        }
      }
    } else if ((xk.$ === "Array" || xk.$ === "Slice") && kk.$ === "Str" && xk._0 === this.tcx.types.u8) {
      if (expr.kind.$ === "Lit") {
        const src = sm.span_to_snippet(sp);
        if (src.$ === "Ok" && replace_prefix(src._0.toString(), '"', 'b"') !== undefined) {
          return [[[Span.shrink_to_lo(sp), "b"]], "consider adding a leading `b`", "MachineApplicable", false];
        }
      }
    }
  } else if (ek.$ === "Ref") {
    const mutability = ek._2;
    // Check if it can work when put into a ref. For example:
    //
    // ```
    // fn bar(x: &mut i32) {}
    //
    // let x = 0u32;
    // bar(&x); // error, expected &mut
    // ```
    let ref_ty: Ty;
    switch (mutability) {
      case "Mut":
        ref_ty = Ty.new_mut_ref(this.tcx, this.tcx.lifetimes.re_static, checked_ty);
        break;
      case "Not":
        ref_ty = Ty.new_imm_ref(this.tcx, this.tcx.lifetimes.re_static, checked_ty);
        break;
    }
    if (this.may_coerce(ref_ty, expected)) {
      let sugg_sp = sp;
      if (expr.kind.$ === "MethodCall") {
        const [segment, receiver, args] = [expr.kind._0, expr.kind._1, expr.kind._2];
        const clone_trait = this.tcx.require_lang_item(LangItem.Clone, segment.ident.span);
        if (
          args.length === 0 &&
          is_some_and(this.typeck_results.type_dependent_def_id(expr.hir_id), (did) => {
            const ai = this.tcx.associated_item(did) as AssocItemT;
            const tc = AssocItem.trait_container(ai, this.tcx);
            return tc !== undefined && DefId_eq(tc, clone_trait);
          }) &&
          segment.ident.name === sym.clone
        ) {
          // If this expression had a clone call when suggesting borrowing
          // we want to suggest removing it because it'd now be unnecessary.
          sugg_sp = receiver.span;
        }
      }

      if (expr.kind.$ === "Unary" && expr.kind._0 === "Deref") {
        const inner = expr.kind._1;
        if (this.deref_steps_for_suggestion(expected, checked_ty) === 1 && this.typeck_results.expr_ty(inner).is_ref()) {
          // We have `*&T`, check if what was expected was `&T`.
          // If so, we may want to suggest removing a `*`.
          sugg_sp = Span.with_hi(sugg_sp, Span.lo(inner.span));
          return [[[sugg_sp, ""]], "consider removing deref here", "MachineApplicable", false];
        }
      }

      // Don't try to suggest ref/deref on an `if` expression, because:
      // - The `if` could be part of a desugared `if else` statement,
      //   which would create impossible suggestions such as `if ... { ... } else &if { ... } else { ... }`.
      // - In general the suggestions it creates such as `&if ... { ... } else { ... }` are not very helpful.
      // We try to generate a suggestion such as `if ... { &... } else { &... }` instead.
      if (expr.kind.$ === "If") {
        const [_c, then_, els] = [expr.kind._0, expr.kind._1, expr.kind._2];
        // The `then` of a `Expr::If` always contains a block, and that block may have a final expression that we can borrow
        // If the block does not have a final expression, it will return () and we do not make a suggestion to borrow that.
        if (then_.kind.$ !== "Block") {
          return undefined;
        }
        const then = then_.kind._0.expr;
        if (then === undefined) {
          return undefined;
        }
        const r = this.suggest_deref_or_ref(then, checked_ty, expected);
        if (r === undefined) {
          return undefined;
        }
        const [suggs, help, app, mutref] = r;

        // If there is no `else`, the return type of this `if` will be (), so suggesting to change the `then` block is useless
        if (els === undefined) {
          return undefined;
        }
        let els_expr: hir.Expr;
        if (els.kind.$ === "Block") {
          if (els.kind._0.expr === undefined) {
            return undefined;
          }
          els_expr = els.kind._0.expr;
        } else {
          els_expr = els;
        }
        const r2 = this.suggest_deref_or_ref(els_expr, checked_ty, expected);
        if (r2 === undefined) {
          return undefined;
        }
        const [else_suggs] = r2;
        suggs.push(...else_suggs);

        return [suggs, help, app, mutref];
      }

      const as_ref = this.can_use_as_ref_or_mut(expr, mutability);
      if (as_ref !== undefined) {
        const [sugg, msg] = as_ref;
        return [sugg, msg, "MachineApplicable", false];
      }

      const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr);
      const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

      const assign_parent = this.tcx.parent_hir_node(expr.hir_id);
      if (assign_parent.$ === "Expr" && assign_parent._0.kind.$ === "Assign") {
        if (Mutability.is_mut(mutability)) {
          // Suppressing this diagnostic, we'll properly print it in `check_expr_assign`
          return undefined;
        }
      }

      const make_sugg = (expr: hir.Expr, span: Span, sugg: string): [Span, string][] => {
        if (expr_needs_parens(expr)) {
          return [
            [Span.shrink_to_lo(span), `${prefix}${sugg}(`],
            [Span.shrink_to_hi(span), ")"],
          ];
        } else {
          return [[Span.shrink_to_lo(span), `${prefix}${sugg}`]];
        }
      };

      // Suggest dereferencing the lhs for expressions such as `&T <= T`
      const bin_parent = this.tcx.parent_hir_node(expr.hir_id);
      if (bin_parent.$ === "Expr" && bin_parent._0.kind.$ === "Binary") {
        const lhs = bin_parent._0.kind._1;
        if (this.check_expr(lhs).kind().$ === "Ref") {
          const sugg = make_sugg(lhs, lhs.span, "*");

          return [sugg, "consider dereferencing the borrow", "MachineApplicable", false];
        }
      }

      const sugg_str = Mutability.ref_prefix_str(mutability);
      const sugg = make_sugg(expr, sp, sugg_str);
      return [sugg, `consider ${Mutability.mutably_str(mutability)}borrowing here`, "MachineApplicable", false];
    }
  } else if (
    expr.kind.$ === "AddrOf" &&
    expr.kind._0 === "Ref" &&
    ck.$ === "Ref" &&
    this.can_eq(this.param_env, ck._1, expected, ToTrace_Ty)
  ) {
    const inner_expr = expr.kind._2;
    const make_sugg = (start: Span, end: BytePos): [[Span, string][], string, Applicability, boolean] | undefined => {
      // skip `(` for tuples such as `(c) = (&123)`.
      // make sure we won't suggest like `(c) = 123)` which is incorrect.
      const extended = sm.span_extend_while(Span.shrink_to_lo(start), (c) => c === C_LPAREN || is_whitespace(c));
      const sp = extended.$ === "Ok" ? Span.shrink_to_hi(extended._0) : start;
      return [[[Span.with_hi(sp, end), ""]], "consider removing the borrow", "MachineApplicable", true];
    };

    // We have `&T`, check if what was expected was `T`. If so,
    // we may want to suggest removing a `&`.
    if (sm.is_imported(inner_expr.span)) {
      // Go through the spans from which this span was expanded,
      // and find the one that's pointing inside `sp`.
      //
      // E.g. for `&format!("")`, where we want the span to the
      // `format!()` invocation instead of its expansion.
      let call_span: Span | undefined;
      for (let s: Span | undefined = inner_expr.span; s !== undefined; s = Span.parent_callsite(s)) {
        if (Span.contains(sp, s)) {
          call_span = s;
          break;
        }
      }
      if (call_span !== undefined && sm.is_span_accessible(call_span)) {
        return make_sugg(sp, Span.lo(call_span));
      }
      return undefined;
    }
    if (Span.contains(sp, inner_expr.span) && sm.is_span_accessible(inner_expr.span)) {
      return make_sugg(sp, Span.lo(inner_expr.span));
    }
  } else if (ek.$ === "RawPtr" && ck.$ === "Ref") {
    const [ty_b, mutbl_b] = [ek._0, ek._1];
    const [ty_a, mutbl_a] = [ck._1, ck._2];
    const steps = this.deref_steps_for_suggestion(ty_a, ty_b);
    if (
      steps !== undefined &&
      // Only suggest valid if dereferencing needed.
      steps > 0
    ) {
      // The pointer type implements `Copy` trait so the suggestion is always valid.
      const src = sm.span_to_snippet(sp);
      if (src.$ === "Ok") {
        const derefs = "*".repeat(steps);
        const old_prefix = Mutability.ref_prefix_str(mutbl_a);
        const new_prefix = Mutability.ref_prefix_str(mutbl_b) + derefs;

        let suggestion: [Span, string, Applicability] | undefined;
        if (replace_prefix(src._0.toString(), old_prefix, new_prefix) !== undefined) {
          // skip `&` or `&mut ` if both mutabilities are mutable
          const lo = BytePos(Span.lo(sp) + Math.min(utf8_len(old_prefix), utf8_len(Mutability.ref_prefix_str(mutbl_b))));
          // skip `&` or `&mut `
          const hi = BytePos(Span.lo(sp) + utf8_len(old_prefix));
          const sp_ = Span.with_hi(Span.with_lo(sp, lo), hi);

          suggestion = [
            sp_,
            `${mutbl_a !== mutbl_b ? Mutability.prefix_str(mutbl_b) : ""}${derefs}`,
            Mutability_cmp(mutbl_b, mutbl_a) <= 0 ? "MachineApplicable" : "MaybeIncorrect",
          ];
        }

        if (suggestion !== undefined) {
          const [span, src_, applicability] = suggestion;
          return [[[span, src_]], "consider dereferencing", applicability, false];
        }
      }
    }
  } else if (sp === expr.span) {
    let steps = this.deref_steps_for_suggestion(checked_ty, expected);
    if (steps !== undefined) {
      let expr_ = expr.peel_blocks();
      let prefix_span = Span.shrink_to_lo(expr_.span);
      let remove = "";

      // Try peeling off any existing `&` and `&mut` to reach our target type
      while (steps > 0) {
        if (expr_.kind.$ === "AddrOf") {
          const [mutbl, inner] = [expr_.kind._1, expr_.kind._2];
          // If the expression has `&`, removing it would fix the error
          prefix_span = Span.with_hi(prefix_span, Span.lo(inner.span));
          expr_ = inner;
          remove += Mutability.ref_prefix_str(mutbl);
          steps -= 1;
        } else {
          break;
        }
      }
      // If we've reached our target type with just removing `&`, then just print now.
      if (steps === 0 && remove.trim().length !== 0) {
        return [
          [[prefix_span, ""]],
          `consider removing the \`${remove.trim()}\``,
          // Do not remove `&&` to get to bool, because it might be something like
          // { a } && b, which we have a separate fixup suggestion that is more
          // likely correct...
          remove.trim() === "&&" && expected === this.tcx.types.bool ? "MaybeIncorrect" : "MachineApplicable",
          false,
        ];
      }

      // For this suggestion to make sense, the type would need to be `Copy`,
      // or we have to be moving out of a `Box<T>`
      if (
        this.type_is_copy_modulo_regions(this.param_env, expected) ||
        // FIXME(compiler-errors): We can actually do this if the checked_ty is
        // `steps` layers of boxes, not just one, but this is easier and most likely.
        (checked_ty.is_box() && steps === 1) ||
        // We can always deref a binop that takes its arguments by ref.
        ((): boolean => {
          const parent = this.tcx.parent_hir_node(expr_.hir_id);
          return parent.$ === "Expr" && parent._0.kind.$ === "Binary" && !BinOpKind.is_by_value(parent._0.kind._0.node);
        })()
      ) {
        let deref_kind: string;
        if (checked_ty.is_box()) {
          // detect Box::new(..)
          if (expr_.kind.$ === "Call" && expr_.kind._1.length === 1) {
            const box_new = expr_.kind._0;
            if (box_new.kind.$ === "Path") {
              const qpath = box_new.kind._0;
              const res = this.typeck_results.qpath_res(qpath, box_new.hir_id);
              if (res.$ === "Def" && res._0.$ === "AssocFn" && this.tcx.is_diagnostic_item(sym.box_new, res._1)) {
                const l_paren = this.tcx.sess.source_map().next_point(box_new.span);
                const r_paren = this.tcx.sess.source_map().end_point(expr_.span);
                return [
                  [
                    [Span.to(box_new.span, l_paren), ""],
                    [r_paren, ""],
                  ],
                  "consider removing the Box",
                  "MachineApplicable",
                  false,
                ];
              }
            }
          }
          deref_kind = "unboxing the value";
        } else if (checked_ty.is_ref()) {
          deref_kind = "dereferencing the borrow";
        } else {
          deref_kind = "dereferencing the type";
        }

        // Suggest removing `&` if we have removed any, otherwise suggest just
        // dereferencing the remaining number of steps.
        const message = remove.length === 0 ? `consider ${deref_kind}` : `consider removing the \`${remove.trim()}\` and ${deref_kind} instead`;

        const shorthand = this.tcx.hir_maybe_get_struct_pattern_shorthand_field(expr_);
        const prefix = shorthand !== undefined ? `${Symbol.as_str(shorthand)}: ` : "";

        let span: Span, suggestion: string;
        if (this.is_else_if_block(expr_)) {
          // Don't suggest nonsense like `else *if`
          return undefined;
        } else {
          const block_expr = this.maybe_get_block_expr(expr_);
          if (block_expr !== undefined) {
            // prefix should be empty here..
            [span, suggestion] = [Span.shrink_to_lo(block_expr.span), "*"];
          } else {
            [span, suggestion] = [prefix_span, `${prefix}${"*".repeat(steps)}`];
          }
        }
        if (suggestion.trim().length === 0) {
          return undefined;
        }

        if (expr_needs_parens(expr_)) {
          return [
            [
              [span, `${suggestion}(`],
              [Span.shrink_to_hi(expr_.span), ")"],
            ],
            message,
            "MachineApplicable",
            false,
          ];
        }

        return [[[span, suggestion]], message, "MachineApplicable", false];
      }
    }
  }
  return undefined;
};

/// Returns whether the given expression is an `else if`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3413 is_else_if_block
FnCtxt.prototype.is_else_if_block = function (this: FnCtxt, expr: hir.Expr): boolean {
  if (expr.kind.$ === "If") {
    const parent = this.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "If" && parent._0.kind._2 !== undefined) {
      const else_expr = parent._0.kind._2;
      return HirId_eq(else_expr.hir_id, expr.hir_id);
    }
  }
  return false;
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3423 suggest_cast
FnCtxt.prototype.suggest_cast = function (this: FnCtxt, err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty, expected_ty_expr: hir.Expr | undefined): boolean {
  if (this.tcx.sess.source_map().is_imported(expr.span)) {
    // Ignore if span is from within a macro.
    return false;
  }

  const span = expr.kind.$ === "Lit" ? expr.kind._0.span : expr.span;
  const src_r = this.tcx.sess.source_map().span_to_snippet(span);
  if (src_r.$ !== "Ok") {
    return false;
  }
  const src = src_r._0.toString();

  // If casting this expression to a given numeric type would be appropriate in case of a type
  // mismatch.
  //
  // We want to minimize the amount of casting operations that are suggested, as it can be a
  // lossy operation with potentially bad side effects, so we only suggest when encountering
  // an expression that indicates that the original type couldn't be directly changed.
  //
  // For now, don't suggest casting with `as`.
  const can_cast = false;

  const sugg: [Span, string][] = [];

  const parent = this.tcx.parent_hir_node(expr.hir_id);
  if (parent.$ === "ExprField") {
    const field = parent._0;
    // `expr` is a literal field for a struct, only suggest if appropriate
    if (field.is_shorthand) {
      // This is a field literal
      sugg.push([Span.shrink_to_lo(field.ident.span), `${display_Ident(field.ident)}: `]);
    } else {
      // Likely a field was meant, but this field wasn't found. Do not suggest anything.
      return false;
    }
  }

  if (expr.kind.$ === "Call") {
    const [path, args] = [expr.kind._0, expr.kind._1];
    if (path.kind.$ === "Path" && path.kind._0.$ === "TypeRelative" && args.length === 1) {
      const [base_ty, path_segment] = [path.kind._0._0, path.kind._0._1];
      // `expr` is a conversion like `u32::from(val)`, do not suggest anything (#63697).
      if (base_ty.kind.$ === "Path" && base_ty.kind._0.$ === "Resolved" && base_ty.kind._0._0 === undefined && path_segment.ident.name === sym.from) {
        const base_ty_path = base_ty.kind._0._1;
        const first = base_ty_path.segments[0];
        if (first !== undefined) {
          const ident = first.ident;
          switch (ident.name) {
            case sym.i128:
            case sym.i64:
            case sym.i32:
            case sym.i16:
            case sym.i8:
            case sym.u128:
            case sym.u64:
            case sym.u32:
            case sym.u16:
            case sym.u8:
            case sym.isize:
            case sym.usize:
              if (base_ty_path.segments.length === 1) {
                return false;
              }
              break;
            default:
              break;
          }
        }
      }
    }
  }

  const msg = `you can convert ${Article_TyKind.article(checked_ty.kind())} \`${display_Ty(checked_ty)}\` to ${Article_TyKind.article(expected_ty.kind())} \`${display_Ty(expected_ty)}\``;
  const cast_msg = `you can cast ${Article_TyKind.article(checked_ty.kind())} \`${display_Ty(checked_ty)}\` to ${Article_TyKind.article(expected_ty.kind())} \`${display_Ty(expected_ty)}\``;
  const lit_msg = `change the type of the numeric literal from \`${display_Ty(checked_ty)}\` to \`${display_Ty(expected_ty)}\``;

  let close_paren: string;
  if (ExprPrecedence_discriminant[this.precedence(expr)] < ExprPrecedence_discriminant["Unambiguous"]) {
    sugg.push([Span.shrink_to_lo(expr.span), "("]);
    close_paren = ")";
  } else {
    close_paren = "";
  }

  const cast_suggestion: [Span, string][] = [...sugg];
  cast_suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren} as ${display_Ty(expected_ty)}`]);
  const into_suggestion: [Span, string][] = [...sugg];
  into_suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren}.into()`]);
  const suffix_suggestion: [Span, string][] = [...sugg];
  {
    const [ek, ck] = [expected_ty.kind(), checked_ty.kind()];
    let suffix_span: Span;
    if ((ek.$ === "Int" || ek.$ === "Uint") && ck.$ === "Float") {
      // Remove fractional part from literal, for example `42.0f32` into `42`
      const src_ = trim_end_matches(src, display_Ty(checked_ty));
      const len = utf8_len(src_.split(".")[0]!);
      suffix_span = Span.with_lo(span, BytePos(Span.lo(span) + len));
    } else {
      const len = utf8_len(trim_end_matches(src, display_Ty(checked_ty)));
      suffix_span = Span.with_lo(span, BytePos(Span.lo(span) + len));
    }
    suffix_suggestion.push([
      suffix_span,
      ExprPrecedence_discriminant[this.precedence(expr)] < ExprPrecedence_discriminant["Unambiguous"]
        ? // Readd `)`
          `${display_Ty(expected_ty)})`
        : display_Ty(expected_ty),
    ]);
  }
  const literal_is_ty_suffixed = (expr: hir.Expr): boolean => {
    if (expr.kind.$ === "Lit") {
      return LitKind.is_suffixed(expr.kind._0.node);
    } else {
      return false;
    }
  };
  const is_negative_int = (expr: hir.Expr): boolean => expr.kind.$ === "Unary" && expr.kind._0 === "Neg";
  const is_uint = (ty: Ty): boolean => ty.kind().$ === "Uint";

  const in_const_context = this.tcx.hir_is_inside_const_context(expr.hir_id);

  const suggest_fallible_into_or_lhs_from = (err: Diag, exp_to_found_is_fallible: boolean): void => {
    // If we know the expression the expected type is derived from, we might be able
    // to suggest a widening conversion rather than a narrowing one (which may
    // panic). For example, given x: u8 and y: u32, if we know the span of "x",
    //   x > y
    // can be given the suggestion "u32::from(x) > y" rather than
    // "x > y.try_into().unwrap()".
    let lhs_expr_and_src: [hir.Expr, string] | undefined;
    if (expected_ty_expr !== undefined) {
      const s = this.tcx.sess.source_map().span_to_snippet(expected_ty_expr.span);
      lhs_expr_and_src = s.$ === "Ok" ? [expected_ty_expr, s._0.toString()] : undefined;
    }
    let msg_: string, suggestion: [Span, string][];
    if (lhs_expr_and_src !== undefined && !exp_to_found_is_fallible) {
      const [lhs_expr, lhs_src] = lhs_expr_and_src;
      msg_ = `you can convert \`${lhs_src}\` from \`${display_Ty(expected_ty)}\` to \`${display_Ty(checked_ty)}\`, matching the type of \`${src}\``;
      suggestion = [
        [Span.shrink_to_lo(lhs_expr.span), `${display_Ty(checked_ty)}::from(`],
        [Span.shrink_to_hi(lhs_expr.span), ")"],
      ];
    } else {
      msg_ = `${msg} and panic if the converted value doesn't fit`;
      suggestion = [...sugg];
      suggestion.push([Span.shrink_to_hi(expr.span), `${close_paren}.try_into().unwrap()`]);
    }
    err.multipart_suggestion(msg_, suggestion, "MachineApplicable");
  };

  const suggest_to_change_suffix_or_into = (err: Diag, found_to_exp_is_fallible: boolean, exp_to_found_is_fallible: boolean): void => {
    const exp_is_lhs = expected_ty_expr !== undefined && this.tcx.hir_is_lhs(expected_ty_expr.hir_id);

    if (exp_is_lhs) {
      return;
    }

    const always_fallible = found_to_exp_is_fallible && (exp_to_found_is_fallible || expected_ty_expr === undefined);
    let msg_: string;
    if (literal_is_ty_suffixed(expr)) {
      msg_ = lit_msg;
    } else if (always_fallible && is_negative_int(expr) && is_uint(expected_ty)) {
      // We now know that converting either the lhs or rhs is fallible. Before we
      // suggest a fallible conversion, check if the value can never fit in the
      // expected type.
      const msg = `\`${src}\` cannot fit into type \`${display_Ty(expected_ty)}\``;
      err.note(msg);
      return;
    } else if (in_const_context) {
      // Do not recommend `into` or `try_into` in const contexts.
      return;
    } else if (found_to_exp_is_fallible) {
      return suggest_fallible_into_or_lhs_from(err, exp_to_found_is_fallible);
    } else {
      msg_ = msg;
    }
    const suggestion = literal_is_ty_suffixed(expr) ? [...suffix_suggestion] : [...into_suggestion];
    err.multipart_suggestion(msg_, suggestion, "MachineApplicable");
  };

  const ek = expected_ty.kind();
  const ck = checked_ty.kind();
  if (ek.$ === "Int" && ck.$ === "Int") {
    const [exp, found] = [IntTy.bit_width(ek._0), IntTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && exp < found) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp !== undefined && found !== undefined && exp > found) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && (found === 8 || found === 16)) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if ((exp === 8 || exp === 16) && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === undefined || found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [false, false];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Uint" && ck.$ === "Uint") {
    const [exp, found] = [UintTy.bit_width(ek._0), UintTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && exp < found) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp !== undefined && found !== undefined && exp > found) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && (found === 8 || found === 16)) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if ((exp === 8 || exp === 16) && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === undefined || found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [false, false];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Int" && ck.$ === "Uint") {
    const [exp, found] = [IntTy.bit_width(ek._0), UintTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && found < exp) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else if (exp === undefined && found === 8) {
      [f2e_is_fallible, e2f_is_fallible] = [false, true];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Uint" && ck.$ === "Int") {
    const [exp, found] = [UintTy.bit_width(ek._0), IntTy.bit_width(ck._0)];
    let f2e_is_fallible: boolean, e2f_is_fallible: boolean;
    if (exp !== undefined && found !== undefined && found > exp) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else if (exp === 8 && found === undefined) {
      [f2e_is_fallible, e2f_is_fallible] = [true, false];
    } else {
      [f2e_is_fallible, e2f_is_fallible] = [true, true];
    }
    suggest_to_change_suffix_or_into(err, f2e_is_fallible, e2f_is_fallible);
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Float") {
    const [exp, found] = [ek._0, ck._0];
    if (FloatTy.bit_width(found) < FloatTy.bit_width(exp)) {
      suggest_to_change_suffix_or_into(err, false, true);
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else if (can_cast) {
      // Missing try_into implementation for `f64` to `f32`
      err.multipart_suggestion(
        `${cast_msg}, producing the closest possible value`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if ((ek.$ === "Uint" || ek.$ === "Int") && ck.$ === "Float") {
    if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else if (can_cast) {
      // Missing try_into implementation for `{float}` to `{integer}`
      err.multipart_suggestion(
        `${msg}, rounding the float towards zero`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Uint") {
    const [exp, found] = [ek._0, ck._0];
    // if `found` is `None` (meaning found is `usize`), don't suggest `.into()`
    if (FloatTy.bit_width(exp) > (UintTy.bit_width(found) ?? 256)) {
      err.multipart_suggestion(`${msg}, producing the floating point representation of the integer`, into_suggestion, "MachineApplicable");
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else {
      // Missing try_into implementation for `{integer}` to `{float}`
      err.multipart_suggestion(
        `${cast_msg}, producing the floating point representation of the integer, rounded if necessary`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (ek.$ === "Float" && ck.$ === "Int") {
    const [exp, found] = [ek._0, ck._0];
    // if `found` is `None` (meaning found is `isize`), don't suggest `.into()`
    if (FloatTy.bit_width(exp) > (IntTy.bit_width(found) ?? 256)) {
      err.multipart_suggestion(`${msg}, producing the floating point representation of the integer`, into_suggestion, "MachineApplicable");
    } else if (literal_is_ty_suffixed(expr)) {
      err.multipart_suggestion(lit_msg, suffix_suggestion, "MachineApplicable");
    } else {
      // Missing try_into implementation for `{integer}` to `{float}`
      err.multipart_suggestion(
        `${msg}, producing the floating point representation of the integer, rounded if necessary`,
        cast_suggestion,
        "MaybeIncorrect", // lossy conversion
      );
    }
    return true;
  } else if (
    ((ek.$ === "Uint" && (ek._0 === "U32" || ek._0 === "U64" || ek._0 === "U128")) || (ek.$ === "Int" && (ek._0 === "I32" || ek._0 === "I64" || ek._0 === "I128"))) &&
    ck.$ === "Char"
  ) {
    err.multipart_suggestion(`${cast_msg}, since a \`char\` always occupies 4 bytes`, cast_suggestion, "MachineApplicable");
    return true;
  } else {
    return false;
  }
};

/// Identify when the user has written `foo..bar()` instead of `foo.bar()`.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3788 suggest_method_call_on_range_literal
FnCtxt.prototype.suggest_method_call_on_range_literal = function (this: FnCtxt, err: Diag, expr_: hir.Expr, checked_ty: Ty, expected_ty: Ty): void {
  if (!is_range_literal(expr_)) {
    return;
  }
  if (!(expr_.kind.$ === "Struct" && expr_.kind._1.length === 2)) {
    return;
  }
  const qpath = expr_.kind._0;
  const [start, end] = [expr_.kind._1[0]!, expr_.kind._1[1]!];
  if (!this.tcx.qpath_is_lang_item(qpath, LangItem.Range)) {
    return;
  }
  if (this.tcx.parent_hir_node(expr_.hir_id).$ === "ExprField") {
    // Ignore `Foo { field: a..Default::default() }`
    return;
  }
  let expr = end.expr;
  let expectation: Ty | undefined = expected_ty;
  while (expr.kind.$ === "MethodCall") {
    const rcvr = expr.kind._1;
    // Getting to the root receiver and asserting it is a fn call let's us ignore cases in
    // `tests/ui/methods/issues/issue-90315.stderr`.
    expr = rcvr;
    // If we have more than one layer of calls, then the expected ty
    // cannot guide the method probe.
    expectation = undefined;
  }
  if (expr.kind.$ !== "Call") {
    return;
  }
  const method_name = expr.kind._0;
  const ck = checked_ty.kind();
  if (ck.$ !== "Adt") {
    return;
  }
  const adt = ck._0;
  const range_struct = this.tcx.lang_items().range_struct();
  if (range_struct === undefined || !DefId_eq(range_struct, adt.did())) {
    return;
  }
  const ek = expected_ty.kind();
  if (ek.$ === "Adt" && this.tcx.is_lang_item(ek._0.did(), LangItem.Range)) {
    return;
  }
  // Check if start has method named end.
  if (!(method_name.kind.$ === "Path" && method_name.kind._0.$ === "Resolved" && method_name.kind._0._0 === undefined)) {
    return;
  }
  const p = method_name.kind._0._1;
  if (p.segments.length !== 1) {
    return;
  }
  const ident = p.segments[0]!.ident;
  const self_ty = this.typeck_results.expr_ty(start.expr);
  const pick = this.lookup_probe_for_diagnostic(ident, self_ty, expr, ProbeScope.AllTraits, expectation);
  if (pick.$ !== "Ok") {
    return;
  }
  let sugg = ".";
  let span = Span.between(start.expr.span, end.expr.span);
  if (Span.lo(span) + 2 === Span.hi(span)) {
    // There's no space between the start, the range op and the end, suggest removal which
    // will be more noticeable than the replacement of `..` with `.`.
    span = Span.with_lo(span, BytePos(Span.lo(span) + 1));
    sugg = "";
  }
  err.span_suggestion_verbose(span, "you likely meant to write a method call instead of a range", sugg, "MachineApplicable");
};

/// Identify when the type error is because `()` is found in a binding that was assigned a
/// block without a tail expression.
// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3867 suggest_return_binding_for_missing_tail_expr
FnCtxt.prototype.suggest_return_binding_for_missing_tail_expr = function (this: FnCtxt, err: Diag, expr: hir.Expr, checked_ty: Ty, expected_ty: Ty): void {
  if (!checked_ty.is_unit()) {
    return;
  }
  if (!(expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved" && expr.kind._0._0 === undefined)) {
    return;
  }
  const path = expr.kind._0._1;
  if (path.res.$ !== "Local") {
    return;
  }
  const hir_id = path.res._0;
  const pat_node = this.tcx.hir_node(hir_id);
  if (pat_node.$ !== "Pat") {
    return;
  }
  const pat = pat_node._0;
  const let_node = this.tcx.parent_hir_node(pat.hir_id);
  if (!(let_node.$ === "LetStmt" && let_node._0.ty === undefined && let_node._0.init !== undefined)) {
    return;
  }
  const init = let_node._0.init;
  if (!(init.kind.$ === "Block" && init.kind._1 === undefined)) {
    return;
  }
  const block = init.kind._0;
  if (block.expr !== undefined) {
    return;
  }
  if (block.stmts.length === 0) {
    err.span_label(block.span, "this empty block is missing a tail expression");
    return;
  }
  const stmt = block.stmts[block.stmts.length - 1]!;
  if (stmt.kind.$ !== "Semi") {
    return;
  }
  const tail_expr = stmt.kind._0;
  const ty = this.node_ty_opt(tail_expr.hir_id);
  if (ty === undefined) {
    return;
  }
  if (
    this.can_eq(this.param_env, expected_ty, ty, ToTrace_Ty) &&
    // FIXME: this happens with macro calls. Need to figure out why the stmt
    // `println!();` doesn't include the `;` in its `Span`. (#133845)
    // We filter these out to avoid ICEs with debug assertions on caused by
    // empty suggestions.
    Span.hi(stmt.span) !== Span.hi(tail_expr.span)
  ) {
    err.span_suggestion_short(Span.with_lo(stmt.span, Span.hi(tail_expr.span)), "remove this semicolon", "", "MachineApplicable");
  } else {
    err.span_label(block.span, "this block is missing a tail expression");
  }
};

// rustc: compiler/rustc_hir_typeck/src/fn_ctxt/suggestions.rs:3925 suggest_swapping_lhs_and_rhs
FnCtxt.prototype.suggest_swapping_lhs_and_rhs = function (this: FnCtxt, err: Diag, rhs_ty: Ty, lhs_ty: Ty, rhs_expr: hir.Expr, lhs_expr: hir.Expr): void {
  const partial_eq_def_id = this.infcx.tcx.lang_items().eq_trait();
  if (
    partial_eq_def_id !== undefined &&
    EvaluationResult.must_apply_modulo_regions(this.infcx.type_implements_trait(partial_eq_def_id, [rhs_ty, lhs_ty], this.param_env))
  ) {
    const sm = this.tcx.sess.source_map();
    // If the span of rhs_expr or lhs_expr is in an external macro,
    // we just suppress the suggestion. See issue #139050
    if (!Span.in_external_macro(rhs_expr.span, sm) && !Span.in_external_macro(lhs_expr.span, sm)) {
      const rhs_snippet = sm.span_to_snippet(rhs_expr.span);
      if (rhs_snippet.$ === "Ok") {
        const lhs_snippet = sm.span_to_snippet(lhs_expr.span);
        if (lhs_snippet.$ === "Ok") {
          err.note(`\`${display_Ty(rhs_ty)}\` implements \`PartialEq<${display_Ty(lhs_ty)}>\``);
          err.multipart_suggestion(
            "consider swapping the equality",
            [
              [lhs_expr.span, rhs_snippet._0.toString()],
              [rhs_expr.span, lhs_snippet._0.toString()],
            ],
            "MaybeIncorrect",
          );
        }
      }
    }
  }
};

// PORT: `str::trim_end_matches(&str)`: strips repeated occurrences of `pat` from the end.
function trim_end_matches(s: string, pat: string): string {
  if (pat.length === 0) {
    return s;
  }
  while (s.endsWith(pat)) {
    s = s.slice(0, s.length - pat.length);
  }
  return s;
}

// PORT: `Option::is_some_and`.
function is_some_and<T>(v: T | undefined, f: (v: T) => boolean): boolean {
  return v !== undefined && f(v);
}

// ==== end lane typeck-fnsugg-b ====
