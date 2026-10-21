// Port of compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs (lane errrep-infer-b; contract of lane
// errctxt-contract).
//
// The types (`StatementAsExpression`, `SuggestAsRefKind`) are generated into suggest.gen.ts; the methods of the two
// `impl TypeErrCtxt` blocks are assigned onto `TypeErrCtxt.prototype` below, in upstream order (declarations: ../../decls.ts
// `// error_reporting/infer/suggest.rs:<line>`). `self.tcx` / InferCtxt methods are read through the Deref forwarders.
// - The fn-local `fn collect_blocks` (suggest.rs:395) and `struct IfVisitor` (suggest.rs:673) stay local to their method.
// - `T: Relate` arguments of `same_type_modulo_infer` are the `relate_*` descriptors (decls.ts signature rule).
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; ../../diagnostics.ts is read inside function bodies only.
export * from "./suggest.gen.ts";
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../../../rustc_ast_ir/visit.ts";
import type { Diag } from "../../../rustc_errors/lib.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../../rustc_hir_id/lib.ts";
import type { ObligationCause } from "../../../rustc_middle/traits/mod.ts";
import type { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Binder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { IsSuggestable } from "../../../rustc_middle/ty/diagnostics.ts";
import type { ExpectedFound } from "../../../rustc_middle/ty/error.ts";
import { fold_GenericArgs, GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../../rustc_middle/ty/mod.ts";
import { IrPrint_print } from "../../../rustc_middle/ty/print/mod.ts";
import { print_Binder, print_FnSig, with_no_trimmed_paths } from "../../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { Visibility } from "../../../rustc_middle/ty/mod.ts";
import { original_sp } from "../../../rustc_span/source_map.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { display_Ident, type Ident, sym, type Symbol } from "../../../rustc_span/symbol.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { TypeError } from "../../../rustc_type_ir/error.ts";
import { display_Binder } from "../../../rustc_type_ir/ir_print.ts";
import type { TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { relate_Binder, relate_FnSig, relate_Ty } from "../../../rustc_type_ir/relate.ts";
import { fold_FnSig, type FnSig, PolyFnSigTys } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { unwrap } from "../../../std/panic.ts";
import type { PolyFnSig } from "../../../rustc_type_ir/decls.ts";
import { TypeErrCtxt } from "../../decls.ts";
import type {
  ConsiderAddingAwait,
  FunctionPointerSuggestion,
  SuggestAccessingField,
  SuggestRemoveSemiOrReturnBinding,
  TypeErrorAdditionalDiags,
} from "../../diagnostics.gen.ts";
import { StatementAsExpression, SuggestAsRefKind } from "./suggest.gen.ts";

/** `crate::diagnostics` (read lazily: init order). */
function diagnostics(): typeof import("../../diagnostics.ts") {
  return require("../../diagnostics.ts") as typeof import("../../diagnostics.ts");
}

/** `impl Display for ty::Binder<'tcx, ty::FnSig<'tcx>>` (rustc_type_ir ir_print.rs:89 through `IrPrint` for `TyCtxt`,
 * ty/print/mod.rs:423): `format!("{sig}")`. */
function display_PolyFnSig(sig: PolyFnSig): string {
  const print_B = (v: PolyFnSig, p: Parameters<typeof print_FnSig>[1]) => print_Binder(v, p, print_FnSig, fold_FnSig);
  return display_Binder(sig, {
    print: (t, fmt) => IrPrint_print(t, fmt, print_B),
    print_debug: (t, fmt) => IrPrint_print(t, fmt, print_B),
  });
}

// impl<'tcx> TypeErrCtxt<'_, 'tcx>

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:41 suggest_remove_semi_or_return_binding
TypeErrCtxt.prototype.suggest_remove_semi_or_return_binding = function (
  this: TypeErrCtxt,
  first_id: HirId | undefined,
  first_ty: Ty,
  first_span: Span,
  second_id: HirId | undefined,
  second_ty: Ty,
  second_span: Span,
): SuggestRemoveSemiOrReturnBinding | undefined {
  let remove_semicolon: [Span, StatementAsExpression] | undefined;
  for (const [id, ty] of [
    [first_id, this.deeply_resolve_ignoring_regions(second_ty, fold_Ty)],
    [second_id, this.deeply_resolve_ignoring_regions(first_ty, fold_Ty)],
  ] as const) {
    // `.find_map(|(id, ty)| { .. })`
    const r = ((): [Span, StatementAsExpression] | undefined => {
      if (id === undefined) return undefined;
      const node = this.tcx.hir_node(id);
      if (node.$ !== "Block") return undefined;
      const blk = node._0;
      return this.could_remove_semicolon(blk, ty);
    })();
    if (r !== undefined) {
      remove_semicolon = r;
      break;
    }
  }
  if (remove_semicolon !== undefined && remove_semicolon[1] === StatementAsExpression.NeedsBoxing) {
    const sp = remove_semicolon[0];
    return {
      $: "RemoveAndBox",
      first_lo: Span.shrink_to_lo(first_span),
      first_hi: Span.shrink_to_hi(first_span),
      second_lo: Span.shrink_to_lo(second_span),
      second_hi: Span.shrink_to_hi(second_span),
      sp,
    };
  } else if (remove_semicolon !== undefined && remove_semicolon[1] === StatementAsExpression.CorrectType) {
    const sp = remove_semicolon[0];
    return { $: "Remove", sp };
  } else {
    let ret: SuggestRemoveSemiOrReturnBinding | undefined = undefined;
    for (const [id, ty] of [
      [first_id, second_ty],
      [second_id, first_ty],
    ] as const) {
      if (id !== undefined) {
        const node = this.tcx.hir_node(id);
        if (node.$ === "Block") {
          const blk = node._0;
          const diag = this.consider_returning_binding_diag(blk, ty);
          if (diag !== undefined) {
            ret = diag;
            break;
          }
        }
      }
    }
    return ret;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:88 suggest_tuple_pattern
TypeErrCtxt.prototype.suggest_tuple_pattern = function (this: TypeErrCtxt, cause: ObligationCause, exp_found: ExpectedFound<Ty>, diag: Diag): void {
  // Heavily inspired by `FnCtxt::suggest_compatible_variants`, with
  // some modifications due to that being in typeck and this being in infer.
  const k = exp_found.expected.kind();
  if (cause.code_().$ === "Pattern" && k.$ === "Adt") {
    const expected_adt = k._0;
    const args = k._1;
    const compatible_variants: string[] = [];
    for (const variant of expected_adt.variants()) {
      if (!(variant.fields.length === 1 && variant.ctor_kind() === "Fn")) continue;
      const sole_field = variant.single_field();
      const sole_field_ty = Unnormalized.skip_norm_wip(sole_field.ty(this.tcx, args));
      if (this.same_type_modulo_infer(sole_field_ty, exp_found.found, relate_Ty)) {
        const variant_path = with_no_trimmed_paths(() => this.tcx.def_path_str(variant.def_id));
        // FIXME #56861: DRYer prelude filtering
        if (variant_path.startsWith("std::prelude::")) {
          const path = variant_path.slice("std::prelude::".length);
          const i = path.indexOf("::");
          if (i !== -1) {
            const path_ = path.slice(i + "::".length);
            compatible_variants.push(path_);
            continue;
          }
        }
        compatible_variants.push(variant_path);
      }
    }
    if (compatible_variants.length === 0) {
      // nothing
    } else if (compatible_variants.length === 1) {
      const variant = compatible_variants[0]!;
      const sugg = {
        variant: variant,
        span_low: Span.shrink_to_lo(cause.span),
        span_high: Span.shrink_to_hi(cause.span),
      };
      diag.subdiagnostic(diagnostics().SuggestTuplePatternOne_subdiagnostic(sugg));
    } else {
      // More than one matching variant.
      const sugg = {
        path: this.tcx.def_path_str(expected_adt.did()),
        cause_span: cause.span,
        compatible_variants,
      };
      diag.subdiagnostic(diagnostics().SuggestTuplePatternMany_subdiagnostic(sugg));
    }
  }
};

/// A possible error is to forget to add `.await` when using futures:
///
/// ```compile_fail,E0308
/// async fn make_u32() -> u32 {
///     22
/// }
///
/// fn take_u32(x: u32) {}
///
/// async fn foo() {
///     let x = make_u32();
///     take_u32(x);
/// }
/// ```
///
/// This routine checks if the found type `T` implements `Future<Output=U>` where `U` is the
/// expected type. In an async body, it suggests adding `.await` to the expression. For a
/// return expression in a synchronous function, it suggests making the function async and
/// awaiting the expression together.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:165 suggest_await_on_expect_found
TypeErrCtxt.prototype.suggest_await_on_expect_found = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  exp_span: Span,
  exp_found: ExpectedFound<Ty>,
  diag: Diag,
): void {
  // debug!("suggest_await_on_expect_found: exp_span={:?}, expected_ty={:?}, found_ty={:?}", exp_span, exp_found.expected, exp_found.found);

  const coroutine_kind = this.tcx.coroutine_kind(cause.body_def_id) as hir.CoroutineKind | undefined;
  if (coroutine_kind === undefined) {
    this.suggest_add_async_for_tail_return_expr(cause, exp_span, exp_found, diag);
    return;
  } else if (coroutine_kind.$ === "Desugared" && (coroutine_kind._0 === "Async" || coroutine_kind._0 === "AsyncGen")) {
    // ()
  } else {
    // `Coroutine(_) | Desugared(Gen, _)`
    return;
  }

  if (cause.code_().$ === "CompareImplItem") {
    return;
  }

  const exp = this.tcx.get_impl_future_output_ty(exp_found.expected);
  const found = this.tcx.get_impl_future_output_ty(exp_found.found);
  let subdiag: ConsiderAddingAwait | undefined;
  let ty: Ty | undefined;
  if (exp !== undefined && found !== undefined && this.same_type_modulo_infer(exp, found, relate_Ty)) {
    const code = cause.code_();
    switch (code.$) {
      case "IfExpression": {
        const expr_id = code.expr_id;
        const node = this.tcx.hir_node(expr_id);
        if (!(node.$ === "Expr" && node._0.kind.$ === "If")) {
          return;
        }
        const then_expr = node._0.kind._1;
        const then_span = this.find_block_span_from_hir_id(then_expr.hir_id);
        subdiag = { $: "BothFuturesSugg", first: Span.shrink_to_hi(then_span), second: Span.shrink_to_hi(exp_span) };
        break;
      }
      case "MatchExpressionArm": {
        const prior_non_diverging_arms = code._0.prior_non_diverging_arms;
        if (prior_non_diverging_arms.length >= 1) {
          const arm_span = prior_non_diverging_arms[prior_non_diverging_arms.length - 1]!;
          subdiag = { $: "BothFuturesSugg", first: Span.shrink_to_hi(arm_span), second: Span.shrink_to_hi(exp_span) };
        } else {
          subdiag = { $: "BothFuturesHelp" };
        }
        break;
      }
      default:
        subdiag = { $: "BothFuturesHelp" };
    }
  } else if (found !== undefined && ((ty = found), true) && this.same_type_modulo_infer(exp_found.expected, ty, relate_Ty)) {
    // FIXME: Seems like we can't have a suggestion and a note with different spans in a single subdiagnostic
    diag.subdiagnostic(diagnostics().ConsiderAddingAwait_subdiagnostic({ $: "FutureSugg", span: Span.shrink_to_hi(exp_span) }));
    subdiag = { $: "FutureSuggNote", span: exp_span };
  } else if (exp !== undefined && ((ty = exp), true) && this.same_type_modulo_infer(ty, exp_found.found, relate_Ty)) {
    const code = cause.code_();
    switch (code.$) {
      case "Pattern": {
        if (code.span !== undefined) {
          const then_span = code.span;
          const origin_expr = code.origin_expr;
          subdiag = origin_expr !== undefined ? { $: "FutureSugg", span: Span.shrink_to_hi(then_span) } : undefined;
        } else {
          subdiag = undefined;
        }
        break;
      }
      case "IfExpression": {
        const expr_id = code.expr_id;
        const node = this.tcx.hir_node(expr_id);
        if (!(node.$ === "Expr" && node._0.kind.$ === "If")) {
          return;
        }
        const then_expr = node._0.kind._1;
        const then_span = this.find_block_span_from_hir_id(then_expr.hir_id);
        subdiag = { $: "FutureSugg", span: Span.shrink_to_hi(then_span) };
        break;
      }
      case "MatchExpressionArm": {
        const prior_non_diverging_arms = code._0.prior_non_diverging_arms;
        subdiag = {
          $: "FutureSuggMultiple",
          spans: prior_non_diverging_arms.map((arm: Span) => Span.shrink_to_hi(arm)),
        };
        break;
      }
      default:
        subdiag = undefined;
    }
  } else {
    subdiag = undefined;
  }
  if (subdiag !== undefined) {
    diag.subdiagnostic(diagnostics().ConsiderAddingAwait_subdiagnostic(subdiag));
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:275 suggest_add_async_for_tail_return_expr
TypeErrCtxt.prototype.suggest_add_async_for_tail_return_expr = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  exp_span: Span,
  exp_found: ExpectedFound<Ty>,
  diag: Diag,
): void {
  const code = cause.code_();
  let return_hir_id: HirId;
  if (code.$ === "BlockTailExpression") {
    return_hir_id = code._0;
  } else if (code.$ === "ReturnValue") {
    return_hir_id = code._0;
  } else {
    return;
  }

  const body_def_id = cause.body_def_id;
  if (!this.tcx.sess.at_least_rust_2018() || this.tcx.is_entrypoint(LocalDefId.to_def_id(body_def_id))) {
    return;
  }

  const node = this.tcx.hir_node_by_def_id(body_def_id);
  let item_span: Span, vis_span: Span;
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    const item = node._0;
    [item_span, vis_span] = [item.span, item.vis_span];
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    const item = node._0;
    const vis_span_ = item.vis_span();
    if (vis_span_ === undefined) return;
    [item_span, vis_span] = [item.span, vis_span_];
  } else {
    return;
  }
  const sig = hir.Node.fn_sig(node);
  if (sig === undefined) {
    return;
  }
  if (hir.IsAsync.is_async(sig.header.asyncness) || sig.header.constness.$ !== "NotConst" || Span.from_expansion(item_span)) {
    return;
  }

  let async_span: Span, async_prefix: string;
  if (Span.is_empty(vis_span)) {
    [async_span, async_prefix] = [Span.shrink_to_lo(item_span), "async "];
  } else {
    [async_span, async_prefix] = [Span.shrink_to_hi(vis_span), " async"];
  }
  const body_hir_id = this.tcx.local_def_id_to_hir_id(body_def_id);
  const fn_id = this.tcx.hir_get_fn_id_for_return_block(return_hir_id);
  let found: Ty | undefined;
  if (
    fn_id !== undefined &&
    HirId_eq(fn_id, body_hir_id) &&
    (found = this.tcx.get_impl_future_output_ty(exp_found.found)) !== undefined &&
    this.same_type_modulo_infer(exp_found.expected, found, relate_Ty) &&
    Span.can_be_used_for_suggestions(exp_span)
  ) {
    diag.subdiagnostic(
      diagnostics().ConsiderAddingAwait_subdiagnostic({
        $: "MakeFunctionAsync",
        async_span,
        async_prefix,
        await_span: Span.shrink_to_hi(exp_span),
      }),
    );
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:333 suggest_accessing_field_where_appropriate
TypeErrCtxt.prototype.suggest_accessing_field_where_appropriate = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  exp_found: ExpectedFound<Ty>,
  diag: Diag,
): void {
  // debug!("suggest_accessing_field_where_appropriate(cause={:?}, exp_found={:?})", cause, exp_found);
  const k = exp_found.expected.kind();
  if (k.$ === "Adt") {
    const expected_def = k._0;
    const expected_args = k._1;
    if (expected_def.is_enum()) {
      return;
    }

    let found_field: [Symbol, Ty] | undefined;
    for (const field of expected_def.non_enum_variant().fields) {
      if (!Visibility.is_accessible_from(field.vis, field.did, this.tcx)) continue;
      const pair: [Symbol, Ty] = [field.name, Unnormalized.skip_norm_wip(field.ty(this.tcx, expected_args))];
      if (this.same_type_modulo_infer(pair[1], exp_found.found, relate_Ty)) {
        found_field = pair;
        break;
      }
    }
    const code = cause.code_();
    if (found_field !== undefined && code.$ === "Pattern" && code.span !== undefined) {
      const [name, ty] = found_field;
      const span = code.span;
      const snippet_r = this.tcx.sess.source_map().span_to_snippet(span);
      if (snippet_r.$ === "Ok") {
        const snippet = snippet_r._0.toString();
        let suggestion: SuggestAccessingField;
        if (expected_def.is_struct()) {
          suggestion = { $: "Safe", span, snippet, name, ty };
        } else if (expected_def.is_union()) {
          suggestion = { $: "Unsafe", span, snippet, name, ty };
        } else {
          return;
        }
        diag.subdiagnostic(diagnostics().SuggestAccessingField_subdiagnostic(suggestion));
      }
    }
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:370 suggest_turning_stmt_into_expr
TypeErrCtxt.prototype.suggest_turning_stmt_into_expr = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  exp_found: ExpectedFound<Ty>,
  diag: Diag,
): void {
  const { expected, found } = exp_found;
  if (!found.peel_refs().is_unit()) {
    return;
  }

  const code = cause.code_();
  if (!(code.$ === "BlockTailExpression" && code._1.$ === "Normal")) {
    return;
  }
  const hir_id = code._0;

  const node = this.tcx.hir_node(hir_id);
  const blocks: hir.Block[] = [];
  let expr: hir.Expr | undefined, qpath: hir.QPath, parent: hir.Node;
  if (
    node.$ === "Block" &&
    (expr = node._0.expr) !== undefined &&
    expr.kind.$ === "Path" &&
    ((qpath = expr.kind._0), true) &&
    qpath.$ === "Resolved" &&
    qpath._1.res.$ === "Local" &&
    ((parent = this.tcx.parent_hir_node(qpath._1.res._0)), true) &&
    parent.$ === "LetStmt" &&
    parent._0.init !== undefined
  ) {
    const init = parent._0.init;
    // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:395 collect_blocks
    function collect_blocks(expr: hir.Expr, blocks: hir.Block[]): void {
      const kind = expr.kind;
      switch (kind.$) {
        // `blk1` and `blk2` must be have the same types, it will be reported before reaching here
        case "If": {
          if (kind._2 !== undefined) {
            const blk1 = kind._1;
            const blk2 = kind._2;
            collect_blocks(blk1, blocks);
            collect_blocks(blk2, blocks);
          }
          break;
        }
        case "Match": {
          const arms = kind._1;
          // all arms must have same types
          for (const arm of arms) {
            collect_blocks(arm.body, blocks);
          }
          break;
        }
        case "Block": {
          const blk = kind._0;
          blocks.push(blk);
          break;
        }
        default:
          break;
      }
    }
    collect_blocks(init, blocks);
  }

  const expected_inner: Ty = expected.peel_refs();
  for (const block of blocks) {
    this.consider_removing_semicolon(block, expected_inner, diag);
  }
};

/// A common error is to add an extra semicolon:
///
/// ```compile_fail,E0308
/// fn foo() -> usize {
///     22;
/// }
/// ```
///
/// This routine checks if the final statement in a block is an
/// expression with an explicit semicolon whose type is compatible
/// with `expected_ty`. If so, it suggests removing the semicolon.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:434 consider_removing_semicolon
TypeErrCtxt.prototype.consider_removing_semicolon = function (this: TypeErrCtxt, blk: hir.Block, expected_ty: Ty, diag: Diag): boolean {
  const r = this.could_remove_semicolon(blk, expected_ty);
  if (r !== undefined) {
    const [span_semi, boxed] = r;
    if (boxed === StatementAsExpression.NeedsBoxing) {
      diag.span_suggestion_verbose(span_semi, "consider removing this semicolon and boxing the expression", "", "HasPlaceholders");
    } else {
      diag.span_suggestion_short(span_semi, "remove this semicolon to return this value", "", "MachineApplicable");
    }
    return true;
  } else {
    return false;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:462 suggest_function_pointers_impl
TypeErrCtxt.prototype.suggest_function_pointers_impl = function (
  this: TypeErrCtxt,
  span: Span | undefined,
  exp_found: ExpectedFound<Ty>,
  diag: Diag,
): void {
  const { expected, found } = exp_found;
  const expected_inner = expected.peel_refs();
  const found_inner = found.peel_refs();
  if (!expected_inner.is_fn() || !found_inner.is_fn()) {
    return;
  }
  const ek = expected_inner.kind();
  const fk = found_inner.kind();
  if (ek.$ === "FnPtr" && fk.$ === "FnDef") {
    const [sig_tys, hdr] = [ek._0, ek._1];
    const [did, args_] = [fk._0, fk._1];
    const args = unwrap(Binder.no_bound_vars(args_, fold_GenericArgs));

    const sig = PolyFnSigTys.with(sig_tys, hdr);
    const expected_sig = this.normalize_fn_sig(Unnormalized.new_wip(sig));
    const found_sig = this.normalize_fn_sig(fn_sig_instantiate(this, did, args));

    const fn_name = this.tcx.def_path_str_with_args(did, args);

    if (
      !this.same_type_modulo_infer(found_sig, expected_sig, relate_Binder(relate_FnSig)) ||
      !IsSuggestable.is_suggestable(sig, this.tcx, true, fold_Binder(fold_FnSig)) ||
      this.tcx.intrinsic(did) !== undefined
    ) {
      return;
    }

    if (span === undefined) {
      const casting = `${fn_name} as ${display_PolyFnSig(sig)}`;
      diag.subdiagnostic(diagnostics().FnItemsAreDistinct_subdiagnostic({}));
      diag.subdiagnostic(diagnostics().FnConsiderCasting_subdiagnostic({ casting }));
      return;
    }

    let sugg: FunctionPointerSuggestion;
    const e_ref = expected.is_ref();
    const f_ref = found.is_ref();
    if (e_ref && !f_ref) {
      sugg = { $: "UseRef", span: Span.shrink_to_lo(span) };
    } else if (!e_ref && f_ref) {
      sugg = { $: "RemoveRef", span, fn_name };
    } else if (e_ref && f_ref) {
      diag.subdiagnostic(diagnostics().FnItemsAreDistinct_subdiagnostic({}));
      sugg = { $: "CastRef", span, fn_name, sig };
    } else {
      diag.subdiagnostic(diagnostics().FnItemsAreDistinct_subdiagnostic({}));
      sugg = { $: "Cast", span: Span.shrink_to_hi(span), sig };
    }
    diag.subdiagnostic(diagnostics().FunctionPointerSuggestion_subdiagnostic(sugg));
  } else if (ek.$ === "FnDef" && fk.$ === "FnDef") {
    const [did1, args1_] = [ek._0, ek._1];
    const [did2, args2_] = [fk._0, fk._1];
    const args1 = unwrap(Binder.no_bound_vars(args1_, fold_GenericArgs));
    const args2 = unwrap(Binder.no_bound_vars(args2_, fold_GenericArgs));

    const expected_sig = this.normalize_fn_sig(fn_sig_instantiate(this, did1, args1));
    const found_sig = this.normalize_fn_sig(fn_sig_instantiate(this, did2, args2));

    const expected_sig_anon = this.tcx.anonymize_bound_vars(expected_sig, fold_FnSig);
    const found_sig_anon = this.tcx.anonymize_bound_vars(found_sig, fold_FnSig);
    if (this.same_type_modulo_infer(expected_sig_anon, found_sig_anon, relate_Binder(relate_FnSig))) {
      diag.subdiagnostic(diagnostics().FnUniqTypes_subdiagnostic({}));
    }

    if (
      !this.same_type_modulo_infer(found_sig, expected_sig, relate_Binder(relate_FnSig)) ||
      !IsSuggestable.is_suggestable(found_sig, this.tcx, true, fold_Binder(fold_FnSig)) ||
      !IsSuggestable.is_suggestable(expected_sig, this.tcx, true, fold_Binder(fold_FnSig)) ||
      this.tcx.intrinsic(did1) !== undefined ||
      this.tcx.intrinsic(did2) !== undefined
    ) {
      return;
    }

    const fn_name = this.tcx.def_path_str_with_args(did2, args2);

    if (span === undefined) {
      diag.subdiagnostic(diagnostics().FnConsiderCastingBoth_subdiagnostic({ sig: expected_sig }));
      return;
    }

    let sug: FunctionPointerSuggestion;
    if (found.is_ref()) {
      sug = { $: "CastBothRef", span, fn_name, found_sig, expected_sig };
    } else {
      sug = { $: "CastBoth", span: Span.shrink_to_hi(span), found_sig, expected_sig };
    }

    diag.subdiagnostic(diagnostics().FunctionPointerSuggestion_subdiagnostic(sug));
  } else if (ek.$ === "FnDef" && fk.$ === "FnPtr") {
    const [did, args_] = [ek._0, ek._1];
    const [sig_tys, hdr] = [fk._0, fk._1];
    const args = unwrap(Binder.no_bound_vars(args_, fold_GenericArgs));

    const expected_sig = this.normalize_fn_sig(fn_sig_instantiate(this, did, args));
    const found_sig = this.normalize_fn_sig(Unnormalized.new_wip(PolyFnSigTys.with(sig_tys, hdr)));

    if (!this.same_type_modulo_infer(found_sig, expected_sig, relate_Binder(relate_FnSig))) {
      return;
    }

    const fn_name = this.tcx.def_path_str_with_args(did, args);

    let casting: string;
    if (expected.is_ref()) {
      casting = `&(${fn_name} as ${display_PolyFnSig(found_sig)})`;
    } else {
      casting = `${fn_name} as ${display_PolyFnSig(found_sig)}`;
    }

    diag.subdiagnostic(diagnostics().FnConsiderCasting_subdiagnostic({ casting }));
  } else {
    return;
  }
};

/** `self.tcx.fn_sig(did).instantiate(self.tcx, args)` */
function fn_sig_instantiate(self: TypeErrCtxt, did: DefId, args: import("../../../rustc_middle/ty/generic_args.ts").GenericArgs): Unnormalized<PolyFnSig> {
  const { EarlyBinder: EB } = require("../../../rustc_type_ir/binder.ts") as typeof import("../../../rustc_type_ir/binder.ts");
  return EB.instantiate(self.tcx.fn_sig(did) as EarlyBinder<PolyFnSig>, self.tcx, args, fold_Binder(fold_FnSig));
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:590 suggest_function_pointers
TypeErrCtxt.prototype.suggest_function_pointers = function (
  this: TypeErrCtxt,
  cause: ObligationCause,
  span: Span,
  exp_found: ExpectedFound<Ty>,
  terr: TypeError,
  diag: Diag,
): void {
  void cause; // debug!("suggest_function_pointers(cause={:?}, exp_found={:?})", cause, exp_found);

  if (exp_found.expected.peel_refs().is_fn() && exp_found.found.peel_refs().is_fn()) {
    this.suggest_function_pointers_impl(span, exp_found, diag);
  } else if (terr.$ === "Sorts") {
    const exp_found = terr._0;
    this.suggest_function_pointers_impl(undefined, exp_found, diag);
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:607 should_suggest_as_ref_kind
TypeErrCtxt.prototype.should_suggest_as_ref_kind = function (this: TypeErrCtxt, expected: Ty, found: Ty): SuggestAsRefKind | undefined {
  const ek = expected.kind();
  const fk = found.kind();
  if (ek.$ === "Adt" && fk.$ === "Ref") {
    const [exp_def, exp_args] = [ek._0, ek._1];
    const found_ty = fk._1;
    const fck = found_ty.kind();
    if (fck.$ === "Adt") {
      const [found_def, found_args] = [fck._0, fck._1];
      if (exp_def === found_def) {
        const have_as_ref: [Symbol, SuggestAsRefKind][] = [
          [sym.Option, SuggestAsRefKind.Option],
          [sym.Result, SuggestAsRefKind.Result],
        ];
        const msg = have_as_ref.find(([name, _msg]) => this.tcx.is_diagnostic_item(name, exp_def.did()))?.[1];
        if (msg !== undefined) {
          let show_suggestion = true;
          const exp_tys = [...exp_args.types()];
          const found_tys = [...found_args.types()];
          for (let i = 0; i < Math.min(exp_tys.length, found_tys.length); i++) {
            const exp_ty = exp_tys[i]!;
            const found_ty = found_tys[i]!;
            const ek = exp_ty.kind();
            switch (ek.$) {
              case "Ref": {
                const exp_ty = ek._1;
                const a = exp_ty.kind();
                const b = found_ty.kind();
                if (b.$ === "Param" || b.$ === "Infer" || a.$ === "Param" || a.$ === "Infer") {
                  // {}
                } else if (this.same_type_modulo_infer(exp_ty, found_ty, relate_Ty)) {
                  // {}
                } else {
                  show_suggestion = false;
                }
                break;
              }
              case "Param":
              case "Infer":
                break;
              default:
                show_suggestion = false;
            }
          }
          if (show_suggestion) {
            return msg;
          }
        }
      }
    }
  }
  return undefined;
};

// FIXME: Remove once `rustc_hir_typeck` is migrated to diagnostic structs
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:651 should_suggest_as_ref
TypeErrCtxt.prototype.should_suggest_as_ref = function (this: TypeErrCtxt, expected: Ty, found: Ty): string | undefined {
  switch (this.should_suggest_as_ref_kind(expected, found)) {
    case SuggestAsRefKind.Option:
      return "you can convert from `&Option<T>` to `Option<&T>` using `.as_ref()`";
    case SuggestAsRefKind.Result:
      return "you can convert from `&Result<T, E>` to `Result<&T, &E>` using `.as_ref()`";
    case undefined:
      return undefined;
  }
};

/// Try to find code with pattern `if Some(..) = expr`
/// use a `visitor` to mark the `if` which its span contains given error span,
/// and then try to find a assignment in the `cond` part, which span is equal with error span
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:667 suggest_let_for_letchains
TypeErrCtxt.prototype.suggest_let_for_letchains = function (this: TypeErrCtxt, cause: ObligationCause, span: Span): TypeErrorAdditionalDiags | undefined {
  /// Find the if expression with given span
  class IfVisitor extends hir.intravisit.Visitor<ControlFlow<null>> {
    // type Result = ControlFlow<()>;
    override Result: VisitorResult<ControlFlow<null>, unknown> = VisitorResultC.ControlFlow<null>();

    constructor(
      public found_if: boolean,
      public err_span: Span,
    ) {
      super();
    }

    // impl<'v> Visitor<'v> for IfVisitor

    // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:680 visit_expr
    override visit_expr(ex: hir.Expr): ControlFlow<null> {
      const kind = ex.kind;
      switch (kind.$) {
        case "If": {
          const cond = kind._0;
          this.found_if = true;
          const r = hir.intravisit.walk_expr(this, cond);
          if (r.$ === "Break") return r;
          this.found_if = false;
          return ControlFlow.CONTINUE;
        }
        default:
          return hir.intravisit.walk_expr(this, ex);
      }
    }

    // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:692 visit_stmt
    override visit_stmt(ex: hir.Stmt): ControlFlow<null> {
      if (
        ex.kind.$ === "Let" &&
        ex.kind._0.ty === undefined &&
        ex.kind._0.init !== undefined &&
        this.found_if &&
        ex.kind._0.span === this.err_span
      ) {
        return ControlFlow.Break(null);
      } else {
        return hir.intravisit.walk_stmt(this, ex);
      }
    }
  }

  const body = this.tcx.hir_maybe_body_owned_by(cause.body_def_id);
  if (body === undefined) return undefined;
  return new IfVisitor(false, span).visit_body(body).$ === "Break"
    ? { $: "AddLetForLetChains", span: Span.shrink_to_lo(span) }
    : undefined;
};

/// For "one type is more general than the other" errors on closures, suggest changing the lifetime
/// of the parameters to accept all lifetimes.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:720 suggest_for_all_lifetime_closure
TypeErrCtxt.prototype.suggest_for_all_lifetime_closure = function (
  this: TypeErrCtxt,
  span: Span,
  hir_: hir.Node,
  exp_found: ExpectedFound<TraitRef>,
  diag: Diag,
): void {
  // 0. Extract fn_decl from hir
  if (!(hir_.$ === "Expr" && hir_._0.kind.$ === "Closure")) {
    return;
  }
  const { body, fn_decl } = hir_._0.kind._0;
  const { params } = this.tcx.hir_body(body);

  // 1. Get the args of the closure.
  // 2. Assume exp_found is FnOnce / FnMut / Fn, we can extract function parameters from [1].
  const expected_ = exp_found.expected.args[1];
  if (expected_ === undefined) {
    return;
  }
  const found_ = exp_found.found.args[1];
  if (found_ === undefined) {
    return;
  }
  const expected_k = GenericArg.kind(expected_);
  const found_k = GenericArg.kind(found_);
  // 3. Extract the tuple type from Fn trait and suggest the change.
  let ek, fk;
  if (
    expected_k.$ === "Type" &&
    found_k.$ === "Type" &&
    (ek = expected_k._0.kind()).$ === "Tuple" &&
    (fk = found_k._0.kind()).$ === "Tuple" &&
    [...ek._0].length === [...fk._0].length
  ) {
    const expected = [...ek._0];
    const found = [...fk._0];
    let suggestion = "|";
    let is_first = true;
    let has_suggestion = false;

    const n = Math.min(expected.length, found.length, params.length, fn_decl.inputs.length);
    for (let i = 0; i < n; i++) {
      const expected_i = expected[i]!;
      const found_i = found[i]!;
      const param_hir = params[i]!;
      const arg_hir = fn_decl.inputs[i]!;
      if (is_first) {
        is_first = false;
      } else {
        suggestion += ", ";
      }

      const ek = expected_i.kind();
      const fk = found_i.kind();
      if (ek.$ === "Ref" && fk.$ === "Ref" && ek._0.is_bound() && !fk._0.is_bound() && arg_hir.kind.$ === "Infer") {
        // If the expected region is late bound, the found region is not, and users are asking compiler
        // to infer the type, we can suggest adding `: &_`.
        if (param_hir.pat.span === param_hir.ty_span) {
          // for `|x|`, `|_|`, `|x: impl Foo|`
          const pat = this.tcx.sess.source_map().span_to_snippet(param_hir.pat.span);
          if (pat.$ !== "Ok") {
            return;
          }
          suggestion += `${pat._0.toString()}: &_`;
        } else {
          // for `|x: ty|`, `|_: ty|`
          const pat = this.tcx.sess.source_map().span_to_snippet(param_hir.pat.span);
          if (pat.$ !== "Ok") {
            return;
          }
          const ty = this.tcx.sess.source_map().span_to_snippet(param_hir.ty_span);
          if (ty.$ !== "Ok") {
            return;
          }
          suggestion += `${pat._0.toString()}: &${ty._0.toString()}`;
        }
        has_suggestion = true;
      } else {
        const arg = this.tcx.sess.source_map().span_to_snippet(param_hir.span);
        if (arg.$ !== "Ok") {
          return;
        }
        // Otherwise, keep it as-is.
        suggestion += arg._0.toString();
      }
    }
    suggestion += "|";

    if (has_suggestion) {
      diag.span_suggestion_verbose(span, "consider specifying the type of the closure parameters", suggestion, "MaybeIncorrect");
    }
  }
};

// impl<'tcx> TypeErrCtxt<'_, 'tcx>

/// Be helpful when the user wrote `{... expr; }` and taking the `;` off
/// is enough to fix the error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:822 could_remove_semicolon
TypeErrCtxt.prototype.could_remove_semicolon = function (this: TypeErrCtxt, blk_: hir.Block, expected_ty: Ty): [Span, StatementAsExpression] | undefined {
  const blk = blk_.innermost_block();
  // Do not suggest if we have a tail expr.
  if (blk.expr !== undefined) {
    return undefined;
  }
  const last_stmt = blk.stmts[blk.stmts.length - 1];
  if (last_stmt === undefined) return undefined;
  if (last_stmt.kind.$ !== "Semi") {
    return undefined;
  }
  const last_expr = last_stmt.kind._0;
  if (this.typeck_results === undefined) return undefined;
  const last_expr_ty = this.typeck_results.expr_ty_opt(last_expr);
  if (last_expr_ty === undefined) return undefined;
  let needs_box: StatementAsExpression;
  const lk = last_expr_ty.kind();
  const ek = expected_ty.kind();
  if (TypeVisitableExt.references_error(last_expr_ty, fold_Ty)) {
    return undefined;
  } else if (this.same_type_modulo_infer(last_expr_ty, expected_ty, relate_Ty)) {
    needs_box = StatementAsExpression.CorrectType;
  } else if (
    lk.$ === "Alias" &&
    lk._1.kind.$ === "Opaque" &&
    ek.$ === "Alias" &&
    ek._1.kind.$ === "Opaque" &&
    DefId_eq(lk._1.kind.def_id, ek._1.kind.def_id)
  ) {
    needs_box = StatementAsExpression.CorrectType;
  } else if (lk.$ === "Alias" && lk._1.kind.$ === "Opaque" && ek.$ === "Alias" && ek._1.kind.$ === "Opaque") {
    const last_def_id = lk._1.kind.def_id;
    const exp_def_id = ek._1.kind.def_id;
    // debug!("both opaque, likely future {:?} {:?} {:?} {:?}", last_def_id, last_bounds, exp_def_id, exp_bounds);

    const last_local_id = last_def_id.as_local();
    if (last_local_id === undefined) return undefined;
    const exp_local_id = exp_def_id.as_local();
    if (exp_local_id === undefined) return undefined;

    const last_bounds = this.tcx.hir_expect_opaque_ty(last_local_id).bounds;
    const exp_bounds = this.tcx.hir_expect_opaque_ty(exp_local_id).bounds;
    let all = true;
    for (let i = 0; i < Math.min(last_bounds.length, exp_bounds.length); i++) {
      const left = last_bounds[i]!;
      const right = exp_bounds[i]!;
      // FIXME: Suspicious
      if (
        left.$ === "Trait" &&
        right.$ === "Trait" &&
        DefId_opt_eq(left._0.trait_ref.trait_def_id(), right._0.trait_ref.trait_def_id()) &&
        TraitBoundModifiers_eq(left._0.modifiers, right._0.modifiers)
      ) {
        continue;
      }
      all = false;
      break;
    }
    if (all) {
      needs_box = StatementAsExpression.NeedsBoxing;
    } else {
      needs_box = StatementAsExpression.CorrectType;
    }
  } else {
    return undefined;
  }
  let span: Span;
  if (Span.from_expansion(last_stmt.span)) {
    const mac_call = original_sp(last_stmt.span, blk.span);
    const s = this.tcx.sess.source_map().mac_call_stmt_semi_span(mac_call);
    if (s === undefined) return undefined;
    span = s;
  } else {
    span = Span.with_hi(Span.shrink_to_hi(this.tcx.sess.source_map().span_extend_while_whitespace(last_expr.span)), Span.hi(last_stmt.span));
  }

  return [span, needs_box];
};

/// Suggest returning a local binding with a compatible type if the block
/// has no return expression.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:912 consider_returning_binding_diag
TypeErrCtxt.prototype.consider_returning_binding_diag = function (
  this: TypeErrCtxt,
  blk_: hir.Block,
  expected_ty: Ty,
): SuggestRemoveSemiOrReturnBinding | undefined {
  const blk = blk_.innermost_block();
  // Do not suggest if we have a tail expr.
  if (blk.expr !== undefined) {
    return undefined;
  }
  // PORT: `FxIndexSet<Symbol>` → insertion-ordered `Set`.
  const shadowed: Set<Symbol> = new Set();
  const candidate_idents: [Ident, Ty][] = [];
  const find_compatible_candidates = (pat: hir.Pat): boolean => {
    let pat_ty: Ty | undefined;
    if (
      pat.kind.$ === "Binding" &&
      (pat_ty = this.typeck_results === undefined ? undefined : this.typeck_results.node_type_opt(pat.kind._1)) !== undefined
    ) {
      const ident = pat.kind._2;
      const pat_ty_ = this.deeply_resolve_ignoring_regions(pat_ty, fold_Ty);
      if (
        this.same_type_modulo_infer(pat_ty_, expected_ty, relate_Ty) &&
        !(TypeVisitableExt.references_error(pat_ty_, fold_Ty) || TypeVisitableExt.references_error(expected_ty, fold_Ty)) &&
        !shadowed.has(ident.name) &&
        (shadowed.add(ident.name), true)
      ) {
        candidate_idents.push([ident, pat_ty_]);
      }
    }
    return true;
  };

  for (let i = blk.stmts.length - 1; i >= 0; i--) {
    const stmt = blk.stmts[i]!;
    if (stmt.kind.$ !== "Let") {
      continue;
    }
    const local = stmt.kind._0;
    local.pat.walk(find_compatible_candidates);
  }
  const parent = this.tcx.parent_hir_node(blk.hir_id);
  if (parent.$ === "Expr") {
    const hir_id = parent._0.hir_id;
    const node = this.tcx.parent_hir_node(hir_id);
    let body: hir.BodyId | undefined;
    if (node.$ === "Arm") {
      const pat = node._0.pat;
      pat.walk(find_compatible_candidates);
    } else if (
      (node.$ === "Item" && node._0.kind.$ === "Fn" && ((body = node._0.kind.body), true)) ||
      (node.$ === "ImplItem" && node._0.kind.$ === "Fn" && ((body = node._0.kind._1), true)) ||
      (node.$ === "TraitItem" && node._0.kind.$ === "Fn" && node._0.kind._1.$ === "Provided" && ((body = node._0.kind._1._0), true)) ||
      (node.$ === "Expr" && node._0.kind.$ === "Closure" && ((body = node._0.kind._0.body), true))
    ) {
      for (const param of this.tcx.hir_body(unwrap(body)).params) {
        param.pat.walk(find_compatible_candidates);
      }
    } else if (
      node.$ === "Expr" &&
      node._0.kind.$ === "If" &&
      node._0.kind._0.kind.$ === "Let" &&
      HirId_eq(node._0.kind._1.hir_id, hir_id)
    ) {
      const let_ = node._0.kind._0.kind._0;
      let_.pat.walk(find_compatible_candidates);
    }
  }

  if (candidate_idents.length === 1) {
    const [ident, _ty] = candidate_idents[0]!;
    const sm = this.tcx.sess.source_map();
    let span: Span, sugg: string;
    const stmt = blk.stmts[blk.stmts.length - 1];
    if (stmt !== undefined) {
      const stmt_span = sm.stmt_span(stmt.span, blk.span);
      let spacing;
      const sugg_ =
        sm.is_multiline(blk.span) && (spacing = sm.indentation_before(stmt_span)) !== undefined
          ? `\n${spacing.toString()}${display_Ident(ident)}`
          : ` ${display_Ident(ident)}`;
      [span, sugg] = [Span.shrink_to_hi(stmt_span), sugg_];
    } else {
      let spacing;
      const sugg_ =
        sm.is_multiline(blk.span) && (spacing = sm.indentation_before(Span.shrink_to_lo(blk.span))) !== undefined
          ? `\n${spacing.toString()}    ${display_Ident(ident)}\n${spacing.toString()}`
          : ` ${display_Ident(ident)} `;
      const left_span = Span.shrink_to_hi(sm.span_through_char(blk.span, "{".charCodeAt(0)));
      [span, sugg] = [sm.span_extend_while_whitespace(left_span), sugg_];
    }
    return { $: "Add", sp: span, code: sugg, ident };
  } else if (candidate_idents.length >= 1 && candidate_idents.length < 3) {
    const spans = candidate_idents.map(([ident, _]) => ident.span);
    return { $: "AddOne", spans: MultiSpan.from_Vec(spans) };
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/suggest.rs:1020 consider_returning_binding
TypeErrCtxt.prototype.consider_returning_binding = function (this: TypeErrCtxt, blk: hir.Block, expected_ty: Ty, err: Diag): boolean {
  const diag = this.consider_returning_binding_diag(blk, expected_ty);
  if (diag !== undefined) {
    err.subdiagnostic(diagnostics().SuggestRemoveSemiOrReturnBinding_subdiagnostic(diag));
    return true;
  } else {
    return false;
  }
};

/** `Option<DefId> == Option<DefId>` */
function DefId_opt_eq(a: DefId | undefined, b: DefId | undefined): boolean {
  return a === undefined || b === undefined ? a === b : DefId_eq(a, b);
}

// PORT: `#[derive(PartialEq)]` of `hir::TraitBoundModifiers` (and of its two field enums, whose payloads are `Span`s
// compared by value); local because no `_eq` is generated for it (same helper as rustc_resolve late/diagnostics.ts).
function TraitBoundModifiers_eq(a: hir.TraitBoundModifiers, b: hir.TraitBoundModifiers): boolean {
  const eq = (x: { $: string; _0?: Span }, y: { $: string; _0?: Span }): boolean => x.$ === y.$ && x._0 === y._0;
  return eq(a.constness, b.constness) && eq(a.polarity, b.polarity);
}
