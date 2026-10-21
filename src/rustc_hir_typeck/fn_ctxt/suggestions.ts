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
  // PORT: `str::to_uppercase` (Unicode full case mapping) is `String.prototype.toUpperCase`.
  const capitalized_name = Symbol.intern(Symbol.as_str(old_item_name).toUpperCase());
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

// ==== lane typeck-fnsugg-b: suggestions.rs:2026.. ====
unported_methods(FnCtxt.prototype, "rustc_hir_typeck::fn_ctxt::suggestions::FnCtxt", ["is_loop", "is_local_statement", "note_type_is_not_clone", "note_type_is_not_clone_inner_expr", "suggest_missing_unwrap_expect", "suggest_coercing_result_via_try_operator", "suggest_returning_value_after_loop", "suggest_semicolon_in_repeat_expr", "suggest_compatible_variants", "suggest_non_zero_new_unwrap", "can_use_as_ref_or_mut", "suggest_deref_or_ref", "is_else_if_block", "suggest_cast", "suggest_method_call_on_range_literal", "suggest_return_binding_for_missing_tail_expr", "suggest_swapping_lhs_and_rhs"]);

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
// }
