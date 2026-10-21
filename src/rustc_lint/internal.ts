//! Some lints that are only useful in the compiler or crates that use compiler internals, such as
//! Clippy.
// Port of compiler/rustc_lint/src/internal.rs. The lint statics and `declare_lint_pass!` expansions are generated
// (internal.lints.gen.ts). The early passes form `InternalCombinedEarlyLintPass`, the late ones
// `InternalCombinedLateLintModPass` (both registered with `-Zunstable-options`, lib.rs `register_internals`).
// PORT: `cx.typeck_results()` is `cx.typeck_results_()`, and `LateContext::qpath_res` / `typing_env` return `unknown`
// until context.rs's `LateContext` is ported: their results are cast here.
import type { ast } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../rustc_hir_id/lib.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, GenericArg, type GenericArgsRef } from "../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../rustc_middle/ty/generics.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { HasAttrs_DefId, type Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { display_GenericArg } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { display_Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { Interner } from "../rustc_type_ir/interner.ts";
import {
  as_interner,
  fold_with_TraitClause,
  TraitRef,
  type TraitClause,
  type TraitRef as TraitRefT,
  try_fold_with_TraitClause,
  visit_with_TraitClause,
} from "../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitClause } from "../rustc_type_ir/unnormalized.ts";
import { unwrap } from "../std/panic.ts";
import type { EarlyContext, LateContext } from "./context.ts";
import {
  AttributeKindInFindAttr_diagnostic,
  BadOptAccessDiag_diagnostic,
  DefaultHashTypesDiag_diagnostic,
  ImplicitSysrootCrateImportDiag_diagnostic,
  LintPassByHand_diagnostic,
  MissingGenericTypeVisitableDeriveDiag_diagnostic,
  NonGlobImportTypeIrInherent_diagnostic,
  QueryInstability_diagnostic,
  QueryUntracked_diagnostic,
  RustcMustMatchExhaustivelyNotExhaustive_diagnostic,
  SpanUseEqCtxtDiag_diagnostic,
  SymbolInternStringLiteralDiag_diagnostic,
  TyQualified_diagnostic,
  TykindDiag_diagnostic,
  TykindKind_diagnostic,
  TypeIrDirectUse_diagnostic,
  TypeIrInherentUsage_diagnostic,
  TypeIrTraitUsage_diagnostic,
} from "./diagnostics.gen.ts";
import {
  BAD_OPT_ACCESS,
  BAD_USE_OF_FIND_ATTR,
  BadOptAccess,
  BadUseOfFindAttr,
  DEFAULT_HASH_TYPES,
  DIRECT_USE_OF_RUSTC_TYPE_IR,
  DefaultHashTypes,
  IMPLICIT_SYSROOT_CRATE_IMPORT,
  ImplicitSysrootCrateImport,
  LINT_PASS_IMPL_WITHOUT_MACRO,
  LintPassImpl,
  MISSING_GENERIC_TYPE_VISITABLE_DERIVE,
  MissingGenericTypeVisitableDerive,
  NON_GLOB_IMPORT_OF_TYPE_IR_INHERENT,
  POTENTIAL_QUERY_INSTABILITY,
  QueryStability,
  RUSTC_MUST_MATCH_EXHAUSTIVELY,
  RustcMustMatchExhaustively,
  SPAN_USE_EQ_CTXT,
  SYMBOL_INTERN_STRING_LITERAL,
  SpanUseEqCtxt,
  SymbolInternStringLiteral,
  TyTyKind,
  TypeIr,
  UNTRACKED_QUERY_INFORMATION,
  USAGE_OF_QUALIFIED_TY,
  USAGE_OF_TY_TYKIND,
  USAGE_OF_TYPE_IR_INHERENT,
  USAGE_OF_TYPE_IR_TRAITS,
} from "./internal.lints.gen.ts";
import type { EarlyLintPass, LateLintPass } from "./passes.ts";

export * from "./internal.lints.gen.ts";

declare module "./internal.lints.gen.ts" {
  interface DefaultHashTypes extends LateLintPass {}
  interface QueryStability extends LateLintPass {}
  interface TyTyKind extends LateLintPass {}
  interface TypeIr extends LateLintPass {}
  interface LintPassImpl extends EarlyLintPass {}
  interface BadOptAccess extends LateLintPass {}
  interface SpanUseEqCtxt extends LateLintPass {}
  interface SymbolInternStringLiteral extends LateLintPass {}
  interface ImplicitSysrootCrateImport extends EarlyLintPass {}
  interface BadUseOfFindAttr extends EarlyLintPass {}
  interface RustcMustMatchExhaustively extends LateLintPass {}
  interface MissingGenericTypeVisitableDerive extends LateLintPass {}
}

// impl LateLintPass<'_> for DefaultHashTypes
// rustc: compiler/rustc_lint/src/internal.rs:43 check_path
DefaultHashTypes.prototype.check_path = function (this: DefaultHashTypes, cx: LateContext, path: hir.Path, hir_id: HirId): void {
  if (!(path.res.$ === "Def" && path.res._0.$ === "Struct")) return;
  const def_id = path.res._1;
  const node = cx.tcx.hir_node(hir_id);
  if ((node.$ === "Item" && node._0.kind.$ === "Use") || node.$ === "NestedUseTree") {
    // Don't lint imports, only actual usages.
    return;
  }
  let preferred: string;
  switch (cx.tcx.get_diagnostic_name(def_id)) {
    case sym.HashMap:
      preferred = "FxHashMap";
      break;
    case sym.HashSet:
      preferred = "FxHashSet";
      break;
    default:
      return;
  }
  cx.emit_span_lint(DEFAULT_HASH_TYPES, path.span, DefaultHashTypesDiag_diagnostic({ preferred, used: cx.tcx.item_name(def_id) }));
};

// impl<'tcx> LateLintPass<'tcx> for QueryStability
// rustc: compiler/rustc_lint/src/internal.rs:93 check_expr
QueryStability.prototype.check_expr = function (this: QueryStability, cx: LateContext, expr: hir.Expr): void {
  const c = get_callee_span_generic_args_and_args(cx, expr);
  let r;
  if (
    c !== undefined &&
    (r = Instance.try_resolve(cx.tcx, cx.typing_env() as TypingEnv, c[0], c[2])).$ === "Ok" &&
    r._0 !== undefined
  ) {
    const [callee_def_id, span, generic_args] = c;
    const instance = r._0;
    const def_id = Instance.def_id(instance);
    if (find_attr(HasAttrs_DefId.get_attrs(def_id, cx.tcx), (k) => (k.$ === "RustcLintQueryInstability" ? null : undefined)) !== undefined) {
      cx.emit_span_lint(POTENTIAL_QUERY_INSTABILITY, span, QueryInstability_diagnostic({ query: cx.tcx.item_name(def_id) }));
    } else if (has_unstable_into_iter_predicate(cx, callee_def_id, generic_args)) {
      const call_span = Span.with_hi(span, Span.hi(expr.span));
      cx.emit_span_lint(POTENTIAL_QUERY_INSTABILITY, call_span, QueryInstability_diagnostic({ query: sym.into_iter }));
    }

    if (find_attr(HasAttrs_DefId.get_attrs(def_id, cx.tcx), (k) => (k.$ === "RustcLintUntrackedQueryInformation" ? null : undefined)) !== undefined) {
      cx.emit_span_lint(UNTRACKED_QUERY_INFORMATION, span, QueryUntracked_diagnostic({ method: cx.tcx.item_name(def_id) }));
    }
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:126 has_unstable_into_iter_predicate
function has_unstable_into_iter_predicate(cx: LateContext, callee_def_id: DefId, generic_args: GenericArgsRef): boolean {
  const into_iterator_def_id = cx.tcx.get_diagnostic_item(sym.IntoIterator);
  if (into_iterator_def_id === undefined) {
    return false;
  }
  const into_iter_fn_def_id = cx.tcx.lang_items().into_iter_fn();
  if (into_iter_fn_def_id === undefined) {
    return false;
  }
  const clauses = GenericClauses.instantiate(cx.tcx.clauses_of(callee_def_id) as GenericClauses, cx.tcx, generic_args);
  for (const [clause] of clauses) {
    const trait_clause = UnnormalizedClause.as_trait_clause(clause);
    if (trait_clause === undefined) {
      continue;
    }
    if (
      !DefId_eq(UnnormalizedPolyTraitClause.def_id(trait_clause), into_iterator_def_id) ||
      UnnormalizedPolyTraitClause.polarity(trait_clause) !== "Positive"
    ) {
      continue;
    }
    // `IntoIterator::into_iter` has no additional method args.
    const into_iter_fn_args = cx.tcx.instantiate_bound_regions_with_erased(Unnormalized.skip_norm_wip(trait_clause), d_TraitClause)
      .trait_ref.args;
    const r = Instance.try_resolve(cx.tcx, cx.typing_env() as TypingEnv, into_iter_fn_def_id, into_iter_fn_args);
    if (!(r.$ === "Ok" && r._0 !== undefined)) {
      continue;
    }
    const instance = r._0;
    // Does the input type's `IntoIterator` implementation have the
    // `rustc_lint_query_instability` attribute on its `into_iter` method?
    if (
      find_attr(HasAttrs_DefId.get_attrs(Instance.def_id(instance), cx.tcx), (k) => (k.$ === "RustcLintQueryInstability" ? null : undefined)) !==
      undefined
    ) {
      return true;
    }
  }
  return false;
}

/// Checks whether an expression is a function or method call and, if so, returns its `DefId`,
/// `Span`, `GenericArgs`, and arguments. This is a slight augmentation of a similarly named Clippy
/// function, `get_callee_generic_args_and_args`.
// rustc: compiler/rustc_lint/src/internal.rs:173 get_callee_span_generic_args_and_args
function get_callee_span_generic_args_and_args(
  cx: LateContext,
  expr: hir.Expr,
): [DefId, Span, GenericArgsRef, hir.Expr | undefined, readonly hir.Expr[]] | undefined {
  let callee_ty;
  if (expr.kind.$ === "Call" && (callee_ty = (cx.typeck_results_() as TypeckResults).expr_ty(expr.kind._0).kind()).$ === "FnDef") {
    const [callee, args] = [expr.kind._0, expr.kind._1];
    return [callee_ty._0, callee.span, unwrap(Binder.no_bound_vars(callee_ty._1, fold_GenericArgs)), undefined, args];
  }
  let method_def_id;
  if (expr.kind.$ === "MethodCall" && (method_def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id)) !== undefined) {
    const [segment, recv, args] = [expr.kind._0, expr.kind._1, expr.kind._2];
    const generic_args = (cx.typeck_results_() as TypeckResults).node_args(expr.hir_id);
    return [method_def_id, segment.ident.span, generic_args, recv, args];
  }
  return undefined;
}

// impl<'tcx> LateLintPass<'tcx> for TyTyKind
// rustc: compiler/rustc_lint/src/internal.rs:222 check_path
TyTyKind.prototype.check_path = function (this: TyTyKind, cx: LateContext, path: hir.Path, _: HirId): void {
  const segment = path.segments[path.segments.length - 2];
  if (segment !== undefined && lint_ty_kind_usage(cx, segment.res)) {
    const span = Span.with_hi(path.span, Span.hi(segment.args === undefined ? segment.ident.span : segment.args.span_ext));
    cx.emit_span_lint(USAGE_OF_TY_TYKIND, path.span, TykindKind_diagnostic({ suggestion: span }));
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:237 check_ty
TyTyKind.prototype.check_ty = function (this: TyTyKind, cx: LateContext, ty: hir.Ty<hir.AmbigArg>): void {
  if (ty.kind.$ === "Path" && ty.kind._0.$ === "Resolved") {
    const path = ty.kind._0._1;
    if (lint_ty_kind_usage(cx, path.res)) {
      const node = cx.tcx.parent_hir_node(ty.hir_id);
      let qpath: hir.QPath | undefined;
      if (node.$ === "PatExpr" && node._0.kind.$ === "Path") {
        qpath = node._0.kind._0;
      } else if (node.$ === "Pat" && (node._0.kind.$ === "TupleStruct" || node._0.kind.$ === "Struct")) {
        qpath = node._0.kind._0;
      } else if (node.$ === "Expr" && (node._0.kind.$ === "Path" || node._0.kind.$ === "Struct")) {
        qpath = node._0.kind._0;
      }
      let span: Span | undefined;
      if (qpath !== undefined) {
        if (qpath.$ === "TypeRelative" && HirId_eq(qpath._0.hir_id, ty.hir_id)) {
          span = path.span;
        } else {
          span = undefined;
        }
      } else {
        span = undefined;
      }

      if (span !== undefined) {
        cx.emit_span_lint(USAGE_OF_TY_TYKIND, path.span, TykindKind_diagnostic({ suggestion: span }));
      } else {
        cx.emit_span_lint(USAGE_OF_TY_TYKIND, path.span, TykindDiag_diagnostic({}));
      }
    } else {
      let t: string | undefined;
      if (!Span.from_expansion(ty.span) && path.segments.length > 1 && (t = is_ty_or_ty_ctxt(cx, path)) !== undefined) {
        cx.emit_span_lint(USAGE_OF_QUALIFIED_TY, path.span, TyQualified_diagnostic({ ty: t, suggestion: path.span }));
      }
    }
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:292 lint_ty_kind_usage
function lint_ty_kind_usage(cx: LateContext, res: Res): boolean {
  const did = Res.opt_def_id(res);
  if (did !== undefined) {
    return cx.tcx.is_diagnostic_item(sym.TyKind, did) || cx.tcx.is_diagnostic_item(sym.IrTyKind, did);
  } else {
    return false;
  }
}

// rustc: compiler/rustc_lint/src/internal.rs:300 is_ty_or_ty_ctxt
function is_ty_or_ty_ctxt(cx: LateContext, path: hir.Path): string | undefined {
  const res = path.res;
  if (res.$ === "Def") {
    const def_id = res._1;
    const name = cx.tcx.get_diagnostic_name(def_id);
    if (name === sym.Ty || name === sym.TyCtxt) {
      return `${Symbol.as_str(name)}${gen_args(path.segments[path.segments.length - 1]!)}`;
    }
  }
  // Only lint on `&Ty` and `&TyCtxt` if it is used outside of a trait.
  else if (res.$ === "SelfTyAlias" && !res.is_trait_impl) {
    const did = res.alias_to;
    const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(did) as EarlyBinder<Ty>)).kind();
    let name;
    if (k.$ === "Adt" && ((name = cx.tcx.get_diagnostic_name(k._0.did())) === sym.Ty || name === sym.TyCtxt)) {
      const args = k._1;
      return `${Symbol.as_str(name)}<${display_GenericArg(args[0]!)}>`;
    }
  }

  return undefined;
}

// rustc: compiler/rustc_lint/src/internal.rs:322 gen_args
function gen_args(segment: hir.PathSegment): string {
  const args = segment.args;
  if (args !== undefined) {
    const lifetimes: string[] = [];
    for (const arg of args.args) {
      if (arg.$ === "Lifetime") {
        lifetimes.push(display_Ident(arg._0.ident));
      }
    }

    if (lifetimes.length !== 0) {
      return `<${lifetimes.join(", ")}>`;
    }
  }

  return "";
}

// impl<'tcx> LateLintPass<'tcx> for TypeIr
// rustc: compiler/rustc_lint/src/internal.rs:394 check_expr
TypeIr.prototype.check_expr = function (this: TypeIr, cx: LateContext, expr: hir.Expr): void {
  let res_def_id: DefId | undefined;
  const k = expr.kind;
  if (k.$ === "Path" && k._0.$ === "Resolved") {
    res_def_id = Res.opt_def_id(k._0._1.res);
  } else if ((k.$ === "Path" && k._0.$ === "TypeRelative") || k.$ === "MethodCall") {
    res_def_id = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
  } else {
    return;
  }
  if (res_def_id === undefined) {
    return;
  }
  const assoc_item = cx.tcx.opt_associated_item(res_def_id);
  let trait_def_id;
  if (
    assoc_item !== undefined &&
    (trait_def_id = AssocItem.trait_container(assoc_item, cx.tcx)) !== undefined &&
    // PORT: `|` (non-short-circuiting) on two `bool`s: both queries run, as upstream.
    (Number(cx.tcx.is_diagnostic_item(sym.type_ir_interner, trait_def_id)) |
      Number(cx.tcx.is_diagnostic_item(sym.type_ir_infer_ctxt_like, trait_def_id))) !==
      0
  ) {
    cx.emit_span_lint(USAGE_OF_TYPE_IR_TRAITS, expr.span, TypeIrTraitUsage_diagnostic({}));
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:414 check_item
TypeIr.prototype.check_item = function (this: TypeIr, cx: LateContext, item: hir.Item): void {
  if (item.kind.$ !== "Use") {
    return;
  }
  const tree = item.kind._0;

  check_use(cx, tree, []);

  // rustc: compiler/rustc_lint/src/internal.rs:421 check_use
  function check_use(cx: LateContext, tree: hir.UseTree, prefix: hir.PathSegment[]): void {
    const is_mod_inherent = (res: Res | undefined): boolean => {
      const def_id = res === undefined ? undefined : Res.opt_def_id(res);
      return def_id !== undefined && cx.tcx.is_diagnostic_item(sym.type_ir_inherent, def_id);
    };

    prefix.push(...tree.prefix.segments);

    switch (tree.kind.$) {
      case "Single":
      case "Glob":
        break;
      case "Nested":
        for (const [nested] of tree.kind.items) {
          check_use(cx, nested, [...prefix]);
        }
        break;
    }

    // Path segments except for the final.
    const seg = prefix.find((seg) => is_mod_inherent(seg.res));
    if (seg !== undefined) {
      cx.emit_span_lint(USAGE_OF_TYPE_IR_INHERENT, seg.ident.span, TypeIrInherentUsage_diagnostic({}));
    }
    // Final path resolutions, like `use rustc_type_ir::inherent`
    else if (tree.prefix.res.type_ns !== undefined && is_mod_inherent(tree.prefix.res.type_ns)) {
      cx.emit_span_lint(USAGE_OF_TYPE_IR_INHERENT, unwrap(prefix[prefix.length - 1]).ident.span, TypeIrInherentUsage_diagnostic({}));
    }

    let lo: Span;
    let hi: Span;
    let snippet: string;
    const penultimate = prefix[prefix.length - 2];
    const segment = prefix[prefix.length - 1];
    if (penultimate !== undefined && segment !== undefined && is_mod_inherent(penultimate.res) && tree.kind.$ === "Single") {
      const ident = tree.kind._0;
      [lo, hi, snippet] = [segment.ident.span, ident.span, "*"];
    } else if (segment !== undefined && tree.prefix.res.type_ns !== undefined && is_mod_inherent(tree.prefix.res.type_ns) && tree.kind.$ === "Single") {
      const ident = tree.kind._0;
      let lo_: Span;
      let snippet_: string;
      const s = cx.tcx.sess.source_map().span_to_snippet(tree.prefix.span);
      if (s.$ === "Ok" && s._0.toString() === "self") {
        [lo_, snippet_] = [tree.prefix.span, "*"];
      } else {
        [lo_, snippet_] = [Span.shrink_to_hi(segment.ident.span), "::*"];
      }
      [lo, hi, snippet] = [lo_, segment.ident.eq(ident) ? lo_ : ident.span, snippet_];
    } else {
      return;
    }
    cx.emit_span_lint(
      NON_GLOB_IMPORT_OF_TYPE_IR_INHERENT,
      tree.prefix.span,
      NonGlobImportTypeIrInherent_diagnostic({
        suggestion: Span.eq_ctxt(lo, hi) ? Span.to(lo, hi) : undefined,
        snippet,
      }),
    );
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:490 check_path
TypeIr.prototype.check_path = function (this: TypeIr, cx: LateContext, path: hir.Path, _: HirId): void {
  const seg = path.segments.find((seg) => {
    const def_id = Res.opt_def_id(seg.res);
    return def_id !== undefined && cx.tcx.is_diagnostic_item(sym.type_ir, def_id);
  });
  if (seg !== undefined) {
    cx.emit_span_lint(DIRECT_USE_OF_RUSTC_TYPE_IR, seg.ident.span, TypeIrDirectUse_diagnostic({}));
  }
};

// impl EarlyLintPass for LintPassImpl
// rustc: compiler/rustc_lint/src/internal.rs:517 check_item
LintPassImpl.prototype.check_item = function (this: LintPassImpl, cx: EarlyContext, item: ast.Item): void {
  if (item.kind.$ === "Impl" && item.kind._0.of_trait !== undefined) {
    const of_trait = item.kind._0.of_trait;
    const segments = of_trait.trait_ref.path.segments;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.ident.name === sym.LintPass) {
      const expn_data = SyntaxContext.outer_expn_data(Span.ctxt(of_trait.trait_ref.path.span));
      const call_site = expn_data.call_site;
      const call_site_kind = SyntaxContext.outer_expn_data(Span.ctxt(call_site)).kind;
      if (
        !(expn_data.kind.$ === "Macro" && expn_data.kind._0 === "Bang" && expn_data.kind._1 === sym.impl_lint_pass) &&
        !(call_site_kind.$ === "Macro" && call_site_kind._0 === "Bang" && call_site_kind._1 === sym.declare_lint_pass)
      ) {
        cx.emit_span_lint(LINT_PASS_IMPL_WITHOUT_MACRO, of_trait.trait_ref.path.span, LintPassByHand_diagnostic({}));
      }
    }
  }
};

// impl LateLintPass<'_> for BadOptAccess
// rustc: compiler/rustc_lint/src/internal.rs:550 check_expr
BadOptAccess.prototype.check_expr = function (this: BadOptAccess, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ !== "Field") return;
  const [base, target] = [expr.kind._0, expr.kind._1];
  const adt_def = (cx.typeck_results_() as TypeckResults).expr_ty(base).ty_adt_def();
  if (adt_def === undefined) return;
  // Skip types without `#[rustc_lint_opt_ty]` - only so that the rest of the lint can be
  // avoided.
  if (find_attr(HasAttrs_DefId.get_attrs(adt_def.did(), cx.tcx), (k) => (k.$ === "RustcLintOptTy" ? null : undefined)) === undefined) {
    return;
  }

  for (const field of adt_def.all_fields()) {
    let lint_message: Symbol | undefined;
    if (
      field.name === target.name &&
      (lint_message = find_attr(HasAttrs_DefId.get_attrs(field.did, cx.tcx), (k) =>
        k.$ === "RustcLintOptDenyFieldAccess" ? k.lint_message : undefined,
      )) !== undefined
    ) {
      cx.emit_span_lint(BAD_OPT_ACCESS, expr.span, BadOptAccessDiag_diagnostic({ msg: Symbol.as_str(lint_message) }));
    }
  }
};

// impl<'tcx> LateLintPass<'tcx> for SpanUseEqCtxt
// rustc: compiler/rustc_lint/src/internal.rs:583 check_expr
SpanUseEqCtxt.prototype.check_expr = function (this: SpanUseEqCtxt, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ === "Binary" && (expr.kind._0.node === "Eq" || expr.kind._0.node === "Ne")) {
    const [lhs, rhs] = [expr.kind._1, expr.kind._2];
    if (is_span_ctxt_call(cx, lhs) && is_span_ctxt_call(cx, rhs)) {
      cx.emit_span_lint(SPAN_USE_EQ_CTXT, expr.span, SpanUseEqCtxtDiag_diagnostic({}));
    }
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:597 is_span_ctxt_call
function is_span_ctxt_call(cx: LateContext, expr: hir.Expr): boolean {
  switch (expr.kind.$) {
    case "MethodCall": {
      const call_did = (cx.typeck_results_() as TypeckResults).type_dependent_def_id(expr.hir_id);
      return call_did !== undefined && cx.tcx.is_diagnostic_item(sym.SpanCtxt, call_did);
    }

    default:
      return false;
  }
}

// impl<'tcx> LateLintPass<'tcx> for SymbolInternStringLiteral
// rustc: compiler/rustc_lint/src/internal.rs:619 check_expr
SymbolInternStringLiteral.prototype.check_expr = function (this: SymbolInternStringLiteral, cx: LateContext, expr: hir.Expr): void {
  let def_id: DefId | undefined;
  if (
    expr.kind.$ === "Call" &&
    expr.kind._0.kind.$ === "Path" &&
    (def_id = Res.opt_def_id(cx.qpath_res(expr.kind._0.kind._0, expr.kind._0.hir_id) as Res)) !== undefined
  ) {
    const args = expr.kind._1;
    let arg: hir.Expr;
    let fn_name: string;
    if (cx.tcx.is_diagnostic_item(sym.SymbolIntern, def_id) && args.length === 1) {
      [arg, fn_name] = [args[0]!, "Symbol::intern"];
    } else if (cx.tcx.is_diagnostic_item(sym.ident_from_str_and_span, def_id) && args.length === 2) {
      [arg, fn_name] = [args[0]!, "Ident::from_str_and_span"];
    } else {
      return;
    }
    if (arg.kind.$ === "Lit" && arg.kind._0.node.$ === "Str") {
      const kind = arg.kind._0;
      cx.emit_span_lint(SYMBOL_INTERN_STRING_LITERAL, kind.span, SymbolInternStringLiteralDiag_diagnostic({ fn_name }));
    }
  }
};

// impl EarlyLintPass for ImplicitSysrootCrateImport
// rustc: compiler/rustc_lint/src/internal.rs:661 check_item
ImplicitSysrootCrateImport.prototype.check_item = function (this: ImplicitSysrootCrateImport, cx: EarlyContext, item: ast.Item): void {
  // rustc: compiler/rustc_lint/src/internal.rs:662 is_whitelisted
  function is_whitelisted(crate_name: string): boolean {
    // Whitelist of allowed crates.
    return (
      crate_name.startsWith("rustc_") ||
      ["test", "self", "core", "alloc", "std", "proc_macro", "tikv_jemalloc_sys"].includes(crate_name)
    );
  }

  if (item.kind.$ === "ExternCrate") {
    const original_name = item.kind._0;
    const imported_name = item.kind._1;
    const name = Symbol.as_str(original_name ?? imported_name.name);
    const externs = cx.builder.sess().opts.externs;
    if (externs.get(name) === undefined && !is_whitelisted(name)) {
      cx.emit_span_lint(IMPLICIT_SYSROOT_CRATE_IMPORT, item.span, ImplicitSysrootCrateImportDiag_diagnostic({ name }));
    }
  }
};

// impl EarlyLintPass for BadUseOfFindAttr
// rustc: compiler/rustc_lint/src/internal.rs:694 check_arm
BadUseOfFindAttr.prototype.check_arm = function (this: BadUseOfFindAttr, cx: EarlyContext, arm: ast.Arm): void {
  // rustc: compiler/rustc_lint/src/internal.rs:695 path_contains_attribute_kind
  function path_contains_attribute_kind(cx: EarlyContext, path: ast.Path): void {
    for (const segment of path.segments) {
      if (Symbol.as_str(segment.ident.name) === "AttributeKind") {
        cx.emit_span_lint(BAD_USE_OF_FIND_ATTR, segment.span(), AttributeKindInFindAttr_diagnostic({}));
      }
    }
  }

  // rustc: compiler/rustc_lint/src/internal.rs:707 find_attr_kind_in_pat
  function find_attr_kind_in_pat(cx: EarlyContext, pat: ast.Pat): void {
    const k = pat.kind;
    switch (k.$) {
      case "Struct": {
        const [path, fields] = [k._1, k._2];
        path_contains_attribute_kind(cx, path);
        for (const field of fields) {
          find_attr_kind_in_pat(cx, field.pat);
        }
        break;
      }
      case "TupleStruct": {
        const [path, fields] = [k._1, k._2];
        path_contains_attribute_kind(cx, path);
        for (const field of fields) {
          find_attr_kind_in_pat(cx, field);
        }
        break;
      }
      case "Or":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;
      case "Path":
        path_contains_attribute_kind(cx, k._1);
        break;
      case "Tuple":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;
      case "Deref":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Ref":
        // PORT: as upstream, this recurses on `pat` itself (not the subpattern).
        find_attr_kind_in_pat(cx, pat);
        break;
      case "Slice":
        for (const pat of k._0) {
          find_attr_kind_in_pat(cx, pat);
        }
        break;

      case "Guard":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Paren":
        find_attr_kind_in_pat(cx, k._0);
        break;
      case "Expr":
      case "Range":
      case "MacCall":
      case "Rest":
      case "Missing":
      case "Err":
      case "Ident":
      case "Never":
      case "Wild":
        break;
    }
  }

  const expn_data = Span.source_callee(arm.span);
  if (expn_data !== undefined && expn_data.kind.$ === "Macro" && Symbol.as_str(expn_data.kind._1) === "find_attr") {
    find_attr_kind_in_pat(cx, arm.pat);
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:781 is_rustc_must_match_exhaustively
function is_rustc_must_match_exhaustively(cx: LateContext, id: HirId): Span | undefined {
  const res = cx.typeck_results_() as TypeckResults;

  let ty = res.node_type(id);

  const k = ty.kind();
  ty = k.$ === "Ref" ? k._1 : ty;

  const adt_def = ty.ty_adt_def();
  if (adt_def !== undefined && adt_def.is_enum()) {
    return find_attr(HasAttrs_DefId.get_attrs(adt_def.did(), cx.tcx), (k) => (k.$ === "RustcMustMatchExhaustively" ? k._0 : undefined));
  } else {
    return undefined;
  }
}

// rustc: compiler/rustc_lint/src/internal.rs:797 pat_is_not_exhaustive_heuristic
function pat_is_not_exhaustive_heuristic(pat: hir.Pat): [Span, string] | undefined {
  const k = pat.kind;
  switch (k.$) {
    case "Missing":
      return undefined;
    case "Wild":
      return [pat.span, "because of this wildcard pattern"];
    case "Binding":
      if (k._3 !== undefined) return pat_is_not_exhaustive_heuristic(k._3);
      return [pat.span, "because of this variable binding"];
    case "Struct":
      return undefined;
    case "TupleStruct":
      return undefined;
    case "Or":
      return undefined;
    case "Never":
      return undefined;
    case "Tuple":
      return undefined;
    case "Deref":
      return pat_is_not_exhaustive_heuristic(k._0);
    case "Ref":
      return pat_is_not_exhaustive_heuristic(k._0);
    case "Expr":
      return undefined;
    case "Guard":
      return undefined;
    case "Range":
      return undefined;
    case "Slice":
      return undefined;
    case "Err":
      return undefined;
  }
}

// impl<'tcx> LateLintPass<'tcx> for RustcMustMatchExhaustively
// rustc: compiler/rustc_lint/src/internal.rs:819 check_expr
RustcMustMatchExhaustively.prototype.check_expr = function (this: RustcMustMatchExhaustively, cx: LateContext, expr: hir.Expr): void {
  const k = expr.kind;
  switch (k.$) {
    // This is not perfect exhaustiveness checking, that's why this is just a rustc internal
    // attribute. But it catches most reasonable cases
    case "Match": {
      const [expr, arms] = [k._0, k._1];
      const attr_span = is_rustc_must_match_exhaustively(cx, expr.hir_id);
      if (attr_span !== undefined) {
        for (const arm of arms) {
          const r = pat_is_not_exhaustive_heuristic(arm.pat);
          if (r !== undefined) {
            const [span, message] = r;
            cx.emit_span_lint(
              RUSTC_MUST_MATCH_EXHAUSTIVELY,
              expr.span,
              RustcMustMatchExhaustivelyNotExhaustive_diagnostic({
                attr_span,
                pat_span: span,
                message,
              }),
            );
          }
        }
      }
      break;
    }
    case "Let": {
      const expr = k._0;
      const attr_span = is_rustc_must_match_exhaustively(cx, expr.init.hir_id);
      if (attr_span !== undefined) {
        cx.emit_span_lint(
          RUSTC_MUST_MATCH_EXHAUSTIVELY,
          expr.span,
          RustcMustMatchExhaustivelyNotExhaustive_diagnostic({
            attr_span,
            pat_span: expr.span,
            message: "using `if let` only matches on one variant (try using `match`)",
          }),
        );
      }
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/internal.rs:857 check_stmt
RustcMustMatchExhaustively.prototype.check_stmt = function (this: RustcMustMatchExhaustively, cx: LateContext, stmt: hir.Stmt): void {
  switch (stmt.kind.$) {
    case "Let": {
      const let_stmt = stmt.kind._0;
      let attr_span: Span | undefined;
      if (let_stmt.els !== undefined && (attr_span = is_rustc_must_match_exhaustively(cx, let_stmt.pat.hir_id)) !== undefined) {
        cx.emit_span_lint(
          RUSTC_MUST_MATCH_EXHAUSTIVELY,
          let_stmt.span,
          RustcMustMatchExhaustivelyNotExhaustive_diagnostic({
            attr_span,
            pat_span: let_stmt.pat.span,
            message: "using `let else` only matches on one variant (try using `match`)",
          }),
        );
      }
      break;
    }
    default:
      break;
  }
};

// impl<'tcx> LateLintPass<'tcx> for MissingGenericTypeVisitableDerive
// rustc: compiler/rustc_lint/src/internal.rs:897 check_item
MissingGenericTypeVisitableDerive.prototype.check_item = function (this: MissingGenericTypeVisitableDerive, cx: LateContext, item: hir.Item): void {
  // lint ADTs except unions, as neither trait can be implemented on the latter
  if (!(item.kind.$ === "Struct" || item.kind.$ === "Enum")) return;
  const regular_id = cx.tcx.get_diagnostic_item(sym.TypeVisitable);
  if (regular_id === undefined) return;
  const generic_id = cx.tcx.get_diagnostic_item(sym.GenericTypeVisitable);
  if (generic_id === undefined) return;
  const [infcx, param_env] = cx.tcx.infer_ctxt().build_with_typing_env(cx.typing_env() as TypingEnv);
  let self_ty: Ty;
  {
    const self_id = item.owner_id.to_def_id();
    const args = infcx.fresh_args_for_item(DUMMY_SP, self_id);
    self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(cx.tcx.type_of(self_id) as EarlyBinder<Ty>, cx.tcx, args, fold_Ty));
  }
  // check whether `Self: TypeVisitable<I>` holds for some `I`..
  {
    const predicate = TraitRef.new(as_interner(cx.tcx), regular_id, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(infcx.next_ty_var(DUMMY_SP))]);
    const obligation = Obligation.new(cx.tcx, ObligationCause.dummy(), param_env, predicate, upcast_TraitRef);

    // NOTE: I initially went with `predicate_must_hold_modulo_regions` (which is what's
    // used by Clippy's [`implements_trait`](https://doc.rust-lang.org/nightly/nightly-rustc/clippy_utils/ty/fn.implements_trait.html),
    // but that returned `false` more often than I'd hoped, and so I went with the
    // next-most strict function.
    if (!infcx.predicate_may_hold(obligation)) return;
  }
  // ..while `Self: GenericTypeVisitable<V>` doesn't
  {
    const predicate = TraitRef.new(as_interner(cx.tcx), generic_id, [GenericArg.from_Ty(self_ty), GenericArg.from_Ty(infcx.next_ty_var(DUMMY_SP))]);
    const obligation = Obligation.new(cx.tcx, ObligationCause.dummy(), param_env, predicate, upcast_TraitRef);

    if (!!infcx.predicate_may_hold(obligation)) return;
  }
  cx.emit_span_lint(MISSING_GENERIC_TYPE_VISITABLE_DERIVE, item.span, MissingGenericTypeVisitableDeriveDiag_diagnostic({}));
};

/** The TypeFoldable descriptor of `TraitClause` (as rustc_hir_analysis hir_ty_lowering/dyn_trait.ts). */
const d_TraitClause: TypeFoldable<TraitClause> = { visit_with: visit_with_TraitClause, try_fold_with: try_fold_with_TraitClause, fold_with: fold_with_TraitClause };

/** `TraitRef<TyCtxt>: Upcast<TyCtxt, Predicate>` as `Obligation::new`'s upcast (as rustc_hir_analysis coherence/builtin.ts). */
function upcast_TraitRef(from: TraitRefT, cx: Interner): Predicate {
  return Predicate_upcast_from_TraitRef(from, cx as unknown as TyCtxt);
}
