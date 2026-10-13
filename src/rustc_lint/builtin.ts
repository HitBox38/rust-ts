// compiler/rustc_lint/src/builtin.rs. The lint statics and `declare_lint_pass!` / `impl_lint_pass!` expansions are
// generated (builtin.lints.gen.ts). The early passes are ported (KeywordIdents by lane lint-early-a, the rest by
// lint-early-b); the late passes (M3) are still `unported` placeholders (rust_ts/stubs.ts), so no pass silently
// does nothing.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { Applicability } from "../rustc_lint_defs/lib.ts";
import { type ast, HasAttrs, type NodeId } from "../rustc_ast/lib.ts";
import type { FnKind } from "../rustc_ast/visit.ts";
import { UnusedDocComment, UNSAFE_CODE, UNUSED_DOC_COMMENTS } from "../rustc_lint_defs/builtin.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import type { Lint } from "../rustc_lint_defs/lib.ts";
import { pprust } from "../rustc_ast_pretty/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { Diagnostic } from "../rustc_errors/lib.ts";
import { find_feature_issue, GateIssue } from "../rustc_feature/lib.ts";
import { type Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { unreachable } from "../std/panic.ts";
import type { EarlyContext } from "./context.ts";
import { BuiltinKeywordIdents_diagnostic } from "./diagnostics.ts";
import {
  type BuiltinFeatureIssueNote,
  type BuiltinIncompleteFeaturesHelp,
  type BuiltinUnsafe,
  type BuiltinUnusedDocCommentSub,
  BuiltinAnonymousParams_diagnostic,
  BuiltinDoubleNegations_diagnostic,
  BuiltinEllipsisInclusiveRangePatterns_diagnostic,
  BuiltinEllipsisInclusiveRangePatternsLint_diagnostic,
  BuiltinIncompleteFeatures_diagnostic,
  BuiltinInternalFeatures_diagnostic,
  BuiltinSpecialModuleNameUsed_diagnostic,
  BuiltinUnsafe_diagnostic,
  BuiltinUnusedDocComment_diagnostic,
  BuiltinWhileTrue_diagnostic,
} from "./diagnostics.gen.ts";
import type { EarlyLintPass } from "./passes.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import {
  WhileTrue, NonShorthandFieldPatterns, UnsafeCode, MissingCopyImplementations, AnonymousParameters, InvalidNoMangleItems,
  MutableTransmutes, UnstableFeatures, UngatedAsyncFnTrackCaller, UnreachablePub, TypeAliasBounds, TrivialConstraints,
  DoubleNegations, KeywordIdents, ExplicitOutlivesRequirements, IncompleteInternalFeatures, InvalidValue, DerefNullPtr,
  AsmLabels, SpecialModuleName, InternalEqTraitMethodImpls, MissingDoc_impl_lint_pass,
  MissingDebugImplementations_impl_lint_pass, EllipsisInclusiveRangePatterns_impl_lint_pass, KEYWORD_IDENTS_2018,
  KEYWORD_IDENTS_2024, WHILE_TRUE, NON_SHORTHAND_FIELD_PATTERNS, MISSING_DOCS, MISSING_COPY_IMPLEMENTATIONS,
  MISSING_DEBUG_IMPLEMENTATIONS, ANONYMOUS_PARAMETERS, NO_MANGLE_CONST_ITEMS, MUTABLE_TRANSMUTES, UNSTABLE_FEATURES,
  UNREACHABLE_PUB, TYPE_ALIAS_BOUNDS, TRIVIAL_BOUNDS, DOUBLE_NEGATIONS, ELLIPSIS_INCLUSIVE_RANGE_PATTERNS,
  INCOMPLETE_FEATURES, INTERNAL_FEATURES, SPECIAL_MODULE_NAME,
} from "./builtin.lints.gen.ts";

const expr_to_string = pprust.expr_to_string;

export * from "./builtin.lints.gen.ts";

/** `MissingDoc` (struct defined in builtin.rs; its `impl_lint_pass!` expansion is `MissingDoc_impl_lint_pass`). PORT: stub. */
export class MissingDoc implements LintPass {
  name(): string {
    return MissingDoc_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MissingDoc_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MissingDoc_impl_lint_pass.lint_vec();
  }
}

/** `MissingDebugImplementations` (struct defined in builtin.rs; its `impl_lint_pass!` expansion is `MissingDebugImplementations_impl_lint_pass`). PORT: stub. */
export class MissingDebugImplementations implements LintPass {
  name(): string {
    return MissingDebugImplementations_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return MissingDebugImplementations_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return MissingDebugImplementations_impl_lint_pass.lint_vec();
  }
}

export interface EllipsisInclusiveRangePatterns extends EarlyLintPass {}
/** `EllipsisInclusiveRangePatterns` (builtin.rs:1562; its `impl_lint_pass!` expansion is `EllipsisInclusiveRangePatterns_impl_lint_pass`). */
// #[derive(Default)]
export class EllipsisInclusiveRangePatterns implements LintPass {
  constructor(
    /// If `Some(_)`, suppress all subsequent pattern
    /// warnings for better diagnostics.
    public node_id: NodeId | undefined,
  ) {}

  /** `#[derive(Default)]` */
  static default(): EllipsisInclusiveRangePatterns {
    return new EllipsisInclusiveRangePatterns(undefined);
  }

  name(): string {
    return EllipsisInclusiveRangePatterns_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return EllipsisInclusiveRangePatterns_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return EllipsisInclusiveRangePatterns_impl_lint_pass.lint_vec();
  }
}

// Late passes (M3): `check_*` placeholders.
// impl LateLintPass for NonShorthandFieldPatterns (builtin.rs:150)
unported_methods(NonShorthandFieldPatterns.prototype, "rustc_lint::builtin::NonShorthandFieldPatterns", ["check_pat"]);
// impl LateLintPass for MissingDoc (builtin.rs:351)
unported_methods(MissingDoc.prototype, "rustc_lint::builtin::MissingDoc", ["check_crate", "check_item", "check_trait_item", "check_impl_item", "check_foreign_item", "check_field_def", "check_variant"]);
// impl LateLintPass for MissingCopyImplementations (builtin.rs:459)
unported_methods(MissingCopyImplementations.prototype, "rustc_lint::builtin::MissingCopyImplementations", ["check_item"]);
// impl LateLintPass for MissingDebugImplementations (builtin.rs:603)
unported_methods(MissingDebugImplementations.prototype, "rustc_lint::builtin::MissingDebugImplementations", ["check_item"]);
// impl LateLintPass for InvalidNoMangleItems (builtin.rs:888)
unported_methods(InvalidNoMangleItems.prototype, "rustc_lint::builtin::InvalidNoMangleItems", ["check_item", "check_impl_item"]);
// impl LateLintPass for MutableTransmutes (builtin.rs:966)
unported_methods(MutableTransmutes.prototype, "rustc_lint::builtin::MutableTransmutes", ["check_expr"]);
// impl LateLintPass for UnstableFeatures (builtin.rs:1032)
unported_methods(UnstableFeatures.prototype, "rustc_lint::builtin::UnstableFeatures", ["check_attributes"]);
// impl LateLintPass for UngatedAsyncFnTrackCaller (builtin.rs:1074)
unported_methods(UngatedAsyncFnTrackCaller.prototype, "rustc_lint::builtin::UngatedAsyncFnTrackCaller", ["check_fn"]);
// impl LateLintPass for UnreachablePub (builtin.rs:1189)
unported_methods(UnreachablePub.prototype, "rustc_lint::builtin::UnreachablePub", ["check_item", "check_foreign_item", "check_field_def", "check_impl_item"]);
// impl LateLintPass for TypeAliasBounds (builtin.rs:1275)
unported_methods(TypeAliasBounds.prototype, "rustc_lint::builtin::TypeAliasBounds", ["check_item"]);
// impl LateLintPass for TrivialConstraints (builtin.rs:1411)
unported_methods(TrivialConstraints.prototype, "rustc_lint::builtin::TrivialConstraints", ["check_item"]);
// impl LateLintPass for ExplicitOutlivesRequirements (builtin.rs:1975)
unported_methods(ExplicitOutlivesRequirements.prototype, "rustc_lint::builtin::ExplicitOutlivesRequirements", ["check_item"]);
// impl LateLintPass for InvalidValue (builtin.rs:2334)
unported_methods(InvalidValue.prototype, "rustc_lint::builtin::InvalidValue", ["check_expr"]);
// impl LateLintPass for DerefNullPtr (builtin.rs:2636)
unported_methods(DerefNullPtr.prototype, "rustc_lint::builtin::DerefNullPtr", ["check_expr"]);
// impl LateLintPass for AsmLabels (builtin.rs:2864)
unported_methods(AsmLabels.prototype, "rustc_lint::builtin::AsmLabels", ["check_expr"]);
// impl LateLintPass for InternalEqTraitMethodImpls (builtin.rs:3162)
unported_methods(InternalEqTraitMethodImpls.prototype, "rustc_lint::builtin::InternalEqTraitMethodImpls", ["check_impl_item"]);

// ---- WhileTrue (builtin.rs:63-108) ----

declare module "./builtin.lints.gen.ts" {
  interface WhileTrue extends EarlyLintPass {}
  interface UnsafeCode extends EarlyLintPass {
    report_unsafe(cx: EarlyContext, span: Span, decorate: Diagnostic): void;
  }
  interface AnonymousParameters extends EarlyLintPass {}
  interface DoubleNegations extends EarlyLintPass {}
  interface IncompleteInternalFeatures extends EarlyLintPass {}
  interface SpecialModuleName extends EarlyLintPass {}
}
declare module "../rustc_lint_defs/builtin.ts" {
  interface UnusedDocComment extends EarlyLintPass {}
}

// impl EarlyLintPass for WhileTrue
// #[inline]
// rustc: compiler/rustc_lint/src/builtin.rs:92 check_expr
WhileTrue.prototype.check_expr = function (this: WhileTrue, cx: EarlyContext, e: ast.Expr): void {
  if (e.kind.$ !== "While") return;
  const cond = e.kind._0;
  const label = e.kind._2;
  const k = cond.peel_parens().kind;
  if (k.$ === "Lit") {
    const token_lit = k._0;
    if (token_lit.kind.$ === "Bool" && token_lit.symbol === kw.True && !Span.from_expansion(cond.span)) {
      const condition_span = Span.with_hi(e.span, Span.hi(cond.span));
      const replace = `${label === undefined ? "" : `${display_Ident(label.ident)}: `}loop`;
      cx.emit_span_lint(WHILE_TRUE, condition_span, BuiltinWhileTrue_diagnostic({ suggestion: condition_span, replace }));
    }
  }
};

// ---- UnsafeCode (builtin.rs:156-282) ----

// impl UnsafeCode
// rustc: compiler/rustc_lint/src/builtin.rs:192 report_unsafe
UnsafeCode.prototype.report_unsafe = function (this: UnsafeCode, cx: EarlyContext, span: Span, decorate: Diagnostic): void {
  // This comes from a macro that has `#[allow_internal_unsafe]`.
  if (Span.allows_unsafe(span)) {
    return;
  }

  cx.emit_span_lint(UNSAFE_CODE, span, decorate);
};

// impl EarlyLintPass for UnsafeCode
// #[inline]
// rustc: compiler/rustc_lint/src/builtin.rs:209 check_expr
UnsafeCode.prototype.check_expr = function (this: UnsafeCode, cx: EarlyContext, e: ast.Expr): void {
  if (e.kind.$ === "Block") {
    const blk = e.kind._0;
    // Don't warn about generated blocks; that'll just pollute the output.
    if (blk.rules.$ === "Unsafe" && blk.rules._0 === "UserProvided") {
      this.report_unsafe(cx, blk.span, BuiltinUnsafe_diagnostic("UnsafeBlock"));
    }
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:218 check_item
UnsafeCode.prototype.check_item = function (this: UnsafeCode, cx: EarlyContext, it: ast.Item): void {
  const kind = it.kind;
  switch (kind.$) {
    case "Trait":
      if (kind._0.safety.$ === "Unsafe") {
        this.report_unsafe(cx, it.span, BuiltinUnsafe_diagnostic("UnsafeTrait"));
      }
      break;

    case "Impl":
      if (kind._0.of_trait !== undefined && kind._0.of_trait.safety.$ === "Unsafe") {
        this.report_unsafe(cx, it.span, BuiltinUnsafe_diagnostic("UnsafeImpl"));
      }
      break;

    case "GlobalAsm":
      this.report_unsafe(cx, it.span, BuiltinUnsafe_diagnostic("GlobalAsm"));
      break;

    case "ForeignMod": {
      const safety = kind._0.safety;
      if (safety.$ === "Unsafe") {
        this.report_unsafe(cx, it.span, BuiltinUnsafe_diagnostic("UnsafeExternBlock"));
      }
      break;
    }

    case "MacroDef": {
      const parsed = AttributeParser.parse_limited_sym(cx.builder.sess(), it.attrs, [sym.allow_internal_unsafe]);
      if (parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "AllowInternalUnsafe") {
        const span = parsed._0._0;
        this.report_unsafe(cx, span, BuiltinUnsafe_diagnostic("AllowInternalUnsafe"));
      }
      break;
    }

    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:257 check_fn
UnsafeCode.prototype.check_fn = function (this: UnsafeCode, cx: EarlyContext, fk: FnKind, span: Span, _: NodeId): void {
  if (fk.$ === "Fn" && fk._2.sig.header.safety.$ === "Unsafe") {
    const ctxt = fk._0;
    const body = fk._2.body;
    let decorator: BuiltinUnsafe;
    switch (ctxt.$) {
      case "Foreign":
        return;
      case "Free":
        decorator = "DeclUnsafeFn";
        break;
      case "Assoc":
        decorator = body === undefined ? "DeclUnsafeMethod" : "ImplUnsafeMethod";
        break;
    }
    this.report_unsafe(cx, span, BuiltinUnsafe_diagnostic(decorator));
  }
};

// ---- AnonymousParameters (builtin.rs:665-739) ----

// impl EarlyLintPass for AnonymousParameters
// rustc: compiler/rustc_lint/src/builtin.rs:716 check_trait_item
AnonymousParameters.prototype.check_trait_item = function (this: AnonymousParameters, cx: EarlyContext, it: ast.AssocItem): void {
  if (cx.sess().edition() !== "Edition2015") {
    // This is a hard error in future editions; avoid linting and erroring
    return;
  }
  if (it.kind.$ === "Fn") {
    const sig = it.kind._0.sig;
    for (const arg of sig.decl.inputs) {
      if (arg.pat.kind.$ === "Missing") {
        const ty_snip_ = cx.sess().source_map().span_to_snippet(arg.ty.span);

        let ty_snip: string;
        let appl: Applicability;
        if (ty_snip_.$ === "Ok") {
          const snip = ty_snip_._0;
          [ty_snip, appl] = [snip.toString(), "MachineApplicable"];
        } else {
          [ty_snip, appl] = ["<type>", "HasPlaceholders"];
        }
        cx.emit_span_lint(
          ANONYMOUS_PARAMETERS,
          arg.pat.span,
          BuiltinAnonymousParams_diagnostic({ suggestion: [arg.pat.span, appl], ty_snip }),
        );
      }
    }
  }
};

// ---- UnusedDocComment (builtin.rs:741-847) ----

// rustc: compiler/rustc_lint/src/builtin.rs:742 warn_if_doc
function warn_if_doc(cx: EarlyContext, node_span: Span, node_kind: string, attrs_: readonly ast.Attribute[]): void {
  // use rustc_ast::token::CommentKind;

  // PORT: `attrs.iter().peekable()` → an index into the slice.
  let i = 0;

  // Accumulate a single span for sugared doc comments.
  let sugared_span: Span | undefined = undefined;

  while (i < attrs_.length) {
    const attr = attrs_[i++]!;
    let is_doc_comment: boolean;
    let is_doc_attribute: boolean;
    if (attr.kind.$ === "DocComment") {
      [is_doc_comment, is_doc_attribute] = [true, false];
    } else if (attr.kind.$ === "Normal" && attr.kind._0.item.path.eq_Symbol(sym.doc)) {
      [is_doc_comment, is_doc_attribute] = [true, true];
    } else {
      [is_doc_comment, is_doc_attribute] = [false, false];
    }
    if (is_doc_comment) {
      sugared_span = sugared_span === undefined ? attr.span : Span.with_hi(sugared_span, Span.hi(attr.span));
    }

    if (!is_doc_attribute && i < attrs_.length && attrs_[i]!.is_doc_comment()) {
      continue;
    }

    const taken = sugared_span;
    sugared_span = undefined;
    const span = taken ?? attr.span;

    if (is_doc_comment || is_doc_attribute) {
      let sub: BuiltinUnusedDocCommentSub;
      switch (attr.kind.$) {
        case "DocComment":
          sub = attr.kind._0 === "Line" ? "PlainHelp" : "BlockHelp";
          break;
        case "Normal":
          sub = "PlainHelp";
          break;
        case "Synthetic":
          return unreachable();
      }
      cx.emit_span_lint(UNUSED_DOC_COMMENTS, span, BuiltinUnusedDocComment_diagnostic({ kind: node_kind, label: node_span, sub }));
    }
  }
}

// impl EarlyLintPass for UnusedDocComment
// rustc: compiler/rustc_lint/src/builtin.rs:787 check_stmt
UnusedDocComment.prototype.check_stmt = function (this: UnusedDocComment, cx: EarlyContext, stmt: ast.Stmt): void {
  let kind: string;
  switch (stmt.kind.$) {
    case "Let":
      kind = "statements";
      break;
    // Disabled pending discussion in #78306
    case "Item":
      return;
    // expressions will be reported by `check_expr`.
    case "Empty":
    case "Semi":
    case "Expr":
    case "MacCall":
      return;
  }

  warn_if_doc(cx, stmt.span, kind, HasAttrs.StmtKind.attrs(stmt.kind));
};

// rustc: compiler/rustc_lint/src/builtin.rs:802 check_arm
UnusedDocComment.prototype.check_arm = function (this: UnusedDocComment, cx: EarlyContext, arm: ast.Arm): void {
  if (arm.body !== undefined) {
    const body = arm.body;
    const arm_span = Span.with_hi(arm.pat.span, Span.hi(body.span));
    warn_if_doc(cx, arm_span, "match arms", arm.attrs);
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:809 check_pat
UnusedDocComment.prototype.check_pat = function (this: UnusedDocComment, cx: EarlyContext, pat: ast.Pat): void {
  if (pat.kind.$ === "Struct") {
    const fields = pat.kind._2;
    for (const field of fields) {
      warn_if_doc(cx, field.span, "pattern fields", field.attrs);
    }
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:817 check_expr
UnusedDocComment.prototype.check_expr = function (this: UnusedDocComment, cx: EarlyContext, expr: ast.Expr): void {
  warn_if_doc(cx, expr.span, "expressions", expr.attrs);

  if (expr.kind.$ === "Struct") {
    const s = expr.kind._0;
    for (const field of s.fields) {
      warn_if_doc(cx, field.span, "expression fields", field.attrs);
    }
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:827 check_generic_param
UnusedDocComment.prototype.check_generic_param = function (this: UnusedDocComment, cx: EarlyContext, param: ast.GenericParam): void {
  warn_if_doc(cx, param.ident.span, "generic parameters", param.attrs);
};

// rustc: compiler/rustc_lint/src/builtin.rs:831 check_block
UnusedDocComment.prototype.check_block = function (this: UnusedDocComment, cx: EarlyContext, block: ast.Block): void {
  warn_if_doc(cx, block.span, "blocks", HasAttrs.Block.attrs(block));
};

// rustc: compiler/rustc_lint/src/builtin.rs:835 check_item
UnusedDocComment.prototype.check_item = function (this: UnusedDocComment, cx: EarlyContext, item: ast.Item): void {
  if (item.kind.$ === "ForeignMod") {
    warn_if_doc(cx, item.span, "extern blocks", item.attrs);
  }
};

// ---- DoubleNegations (builtin.rs:1450-1503) ----

// impl EarlyLintPass for DoubleNegations
// #[inline]
// rustc: compiler/rustc_lint/src/builtin.rs:1482 check_expr
DoubleNegations.prototype.check_expr = function (this: DoubleNegations, cx: EarlyContext, expr: ast.Expr): void {
  // only lint on the innermost `--` in a chain of `-` operators,
  // even if there are 3 or more negations
  if (expr.kind.$ === "Unary" && expr.kind._0 === "Neg") {
    const inner = expr.kind._1;
    if (
      inner.kind.$ === "Unary" &&
      inner.kind._0 === "Neg" &&
      !(inner.kind._1.kind.$ === "Unary" && inner.kind._1.kind._0 === "Neg") &&
      // Don't lint if this jumps macro expansion boundary (Issue #143980)
      Span.eq_ctxt(expr.span, inner.span)
    ) {
      cx.emit_span_lint(
        DOUBLE_NEGATIONS,
        expr.span,
        BuiltinDoubleNegations_diagnostic({
          add_parens: { start_span: Span.shrink_to_lo(inner.span), end_span: Span.shrink_to_hi(inner.span) },
        }),
      );
    }
  }
};

/** `pub mod soft` (builtin.rs:1505) */
export const soft = {
  // rustc: compiler/rustc_lint/src/builtin.rs:1508 lint_vec
  lint_vec(): LintVec {
    return [
      WHILE_TRUE,
      NON_SHORTHAND_FIELD_PATTERNS,
      UNSAFE_CODE,
      MISSING_DOCS,
      MISSING_COPY_IMPLEMENTATIONS,
      MISSING_DEBUG_IMPLEMENTATIONS,
      ANONYMOUS_PARAMETERS,
      UNUSED_DOC_COMMENTS,
      NO_MANGLE_CONST_ITEMS,
      MUTABLE_TRANSMUTES,
      UNSTABLE_FEATURES,
      UNREACHABLE_PUB,
      TYPE_ALIAS_BOUNDS,
      TRIVIAL_BOUNDS,
      DOUBLE_NEGATIONS,
    ];
  },
};

// ---- EllipsisInclusiveRangePatterns (builtin.rs:1529-1650) ----

// impl EarlyLintPass for EllipsisInclusiveRangePatterns
// rustc: compiler/rustc_lint/src/builtin.rs:1571 check_pat
EllipsisInclusiveRangePatterns.prototype.check_pat = function (this: EllipsisInclusiveRangePatterns, cx: EarlyContext, pat: ast.Pat): void {
  if (this.node_id !== undefined) {
    // Don't recursively warn about patterns inside range endpoints.
    return;
  }

  // use self::ast::PatKind;
  // use self::ast::RangeSyntax::DotDotDot;

  /// If `pat` is a `...` pattern, return the start and end of the range, as well as the span
  /// corresponding to the ellipsis.
  // rustc: compiler/rustc_lint/src/builtin.rs:1582 matches_ellipsis_pat
  function matches_ellipsis_pat(pat: ast.Pat): [ast.Expr | undefined, ast.Expr, Span] | undefined {
    const kind = pat.kind;
    if (kind.$ === "Range" && kind._1 !== undefined && kind._2.node.$ === "Included" && kind._2.node._0 === "DotDotDot") {
      const a = kind._0;
      const b = kind._1;
      const span = kind._2.span;
      return [a, b, span];
    }
    return undefined;
  }

  const [parentheses, endpoints] = pat.kind.$ === "Ref" ? [true, matches_ellipsis_pat(pat.kind._0)] : [false, matches_ellipsis_pat(pat)];

  if (endpoints !== undefined) {
    const [start, end_, join] = endpoints;
    if (parentheses) {
      this.node_id = pat.id;
      const end = expr_to_string(end_);
      const replace = start !== undefined ? `&(${expr_to_string(start)}..=${end})` : `&(..=${end})`;
      if (Edition_discriminant[Span.edition(join)] >= Edition_discriminant.Edition2021) {
        cx.sess()
          .dcx()
          .emit_err(BuiltinEllipsisInclusiveRangePatterns_diagnostic({ span: pat.span, suggestion: pat.span, replace }));
      } else {
        cx.emit_span_lint(
          ELLIPSIS_INCLUSIVE_RANGE_PATTERNS,
          pat.span,
          BuiltinEllipsisInclusiveRangePatternsLint_diagnostic({ $: "Parenthesise", suggestion: pat.span, replace }),
        );
      }
    } else {
      const replace = "..=";
      if (Edition_discriminant[Span.edition(join)] >= Edition_discriminant.Edition2021) {
        cx.sess()
          .dcx()
          .emit_err(BuiltinEllipsisInclusiveRangePatterns_diagnostic({ span: pat.span, suggestion: join, replace: replace }));
      } else {
        cx.emit_span_lint(
          ELLIPSIS_INCLUSIVE_RANGE_PATTERNS,
          join,
          BuiltinEllipsisInclusiveRangePatternsLint_diagnostic({ $: "NonParenthesise", suggestion: join }),
        );
      }
    }
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:1643 check_pat_post
EllipsisInclusiveRangePatterns.prototype.check_pat_post = function (this: EllipsisInclusiveRangePatterns, _cx: EarlyContext, pat: ast.Pat): void {
  if (this.node_id !== undefined) {
    const node_id = this.node_id;
    if (pat.id === node_id) {
      this.node_id = undefined;
    }
  }
};

// ---- KeywordIdents (builtin.rs:1740-1835) ----
// PORT: ported ahead of lane lint-early-b: it is the only pass of `BuiltinCombinedPreExpansionLintPass`, which runs
// before expansion on every crate (decision recorded in docs/handoff/lint-early-a.md).

declare module "./builtin.lints.gen.ts" {
  interface KeywordIdents extends EarlyLintPass {
    check_tokens(cx: EarlyContext, tokens: TokenStream): void;
    check_ident_token(cx: EarlyContext, under_macro: UnderMacro, ident: Ident, prefix: string): void;
  }
}

/** `struct UnderMacro(bool);` */
type UnderMacro = { readonly _0: boolean };

// rustc: compiler/rustc_lint/src/builtin.rs:1748 check_tokens
KeywordIdents.prototype.check_tokens = function (this: KeywordIdents, cx: EarlyContext, tokens: TokenStream): void {
  // Check if the preceding token is `$`, because we want to allow `$async`, etc.
  let prev_dollar = false;
  const it = tokens.iter();
  for (let tt = it.next(); tt !== undefined; tt = it.next()) {
    switch (tt.$) {
      // Only report non-raw idents.
      case "Token": {
        const token = tt._0;
        const id = token.ident();
        let lt: ReturnType<typeof token.lifetime>;
        if (id !== undefined && id[1] === "Normal") {
          const ident = id[0];
          if (!prev_dollar) {
            this.check_ident_token(cx, { _0: true }, ident, "");
          }
        } else if ((lt = token.lifetime()) !== undefined && lt[1] === "Normal") {
          const ident = lt[0];
          this.check_ident_token(cx, { _0: true }, ident.without_first_quote(), "'");
        } else if (token.kind.$ === "Dollar") {
          prev_dollar = true;
          continue;
        }
        break;
      }
      case "Delimited":
        this.check_tokens(cx, tt._3);
        break;
    }
    prev_dollar = false;
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:1777 check_ident_token
KeywordIdents.prototype.check_ident_token = function (
  this: KeywordIdents,
  cx: EarlyContext,
  { _0: under_macro }: UnderMacro,
  ident: Ident,
  prefix: string,
): void {
  let lint: Lint;
  let edition: Edition;
  switch (ident.name) {
    case kw.Async:
    case kw.Await:
    case kw.Try:
      [lint, edition] = [KEYWORD_IDENTS_2018, "Edition2018"];
      break;

    // rust-lang/rust#56327: Conservatively do not
    // attempt to report occurrences of `dyn` within
    // macro definitions or invocations, because `dyn`
    // can legitimately occur as a contextual keyword
    // in 2015 code denoting its 2018 meaning, and we
    // do not want rustfix to inject bugs into working
    // code by rewriting such occurrences.
    //
    // But if we see `dyn` outside of a macro, we know
    // its precise role in the parsed AST and thus are
    // assured this is truly an attempt to use it as
    // an identifier.
    case kw.Dyn:
      if (under_macro) return;
      [lint, edition] = [KEYWORD_IDENTS_2018, "Edition2018"];
      break;

    case kw.Gen:
      [lint, edition] = [KEYWORD_IDENTS_2024, "Edition2024"];
      break;

    default:
      return;
  }

  // Don't lint `r#foo`.
  if (
    Edition_discriminant[Span.edition(ident.span)] >= Edition_discriminant[edition] ||
    cx.sess().psess.raw_identifier_spans.includes(ident.span)
  ) {
    return;
  }

  cx.emit_span_lint(lint, ident.span, BuiltinKeywordIdents_diagnostic({ kw: ident, next: edition, suggestion: ident.span, prefix }));
};

// impl EarlyLintPass for KeywordIdents
// rustc: compiler/rustc_lint/src/builtin.rs:1822 check_mac_def
KeywordIdents.prototype.check_mac_def = function (this: KeywordIdents, cx: EarlyContext, mac_def: ast.MacroDef): void {
  this.check_tokens(cx, mac_def.body.tokens);
};
// rustc: compiler/rustc_lint/src/builtin.rs:1825 check_mac
KeywordIdents.prototype.check_mac = function (this: KeywordIdents, cx: EarlyContext, mac: ast.MacCall): void {
  this.check_tokens(cx, mac.args.tokens);
};
// rustc: compiler/rustc_lint/src/builtin.rs:1828 check_ident
KeywordIdents.prototype.check_ident = function (this: KeywordIdents, cx: EarlyContext, ident: Ident): void {
  if (Symbol.as_str(ident.name).startsWith("'")) {
    this.check_ident_token(cx, { _0: false }, ident.without_first_quote(), "'");
  } else {
    this.check_ident_token(cx, { _0: false }, ident, "");
  }
};

// ---- IncompleteInternalFeatures (builtin.rs:2183-2263) ----

// impl EarlyLintPass for IncompleteInternalFeatures
// rustc: compiler/rustc_lint/src/builtin.rs:2238 check_crate
IncompleteInternalFeatures.prototype.check_crate = function (this: IncompleteInternalFeatures, cx: EarlyContext, _: ast.Crate): void {
  const features = cx.builder.features();

  features
    .enabled_features_iter_stable_order()
    .filter(([name, _]) => features.incomplete(name) || features.internal(name))
    .forEach(([name, span]) => {
      if (features.incomplete(name)) {
        const n = find_feature_issue(name, GateIssue.Language);
        const note: BuiltinFeatureIssueNote | undefined = n === undefined ? undefined : { n };
        const help: BuiltinIncompleteFeaturesHelp | undefined = HAS_MIN_FEATURES.includes(name) ? { name } : undefined;

        cx.emit_span_lint(INCOMPLETE_FEATURES, span, BuiltinIncompleteFeatures_diagnostic({ name, note, help }));
      } else {
        cx.emit_span_lint(INTERNAL_FEATURES, span, BuiltinInternalFeatures_diagnostic({ name }));
      }
    });
};

const HAS_MIN_FEATURES: readonly Symbol[] = [sym.specialization];

// ---- SpecialModuleName (builtin.rs:3050-3118) ----

// impl EarlyLintPass for SpecialModuleName
// rustc: compiler/rustc_lint/src/builtin.rs:3088 check_crate
SpecialModuleName.prototype.check_crate = function (this: SpecialModuleName, cx: EarlyContext, krate: ast.Crate): void {
  for (const item of krate.items) {
    if (
      item.kind.$ === "Mod" &&
      (item.kind._2.$ === "Unloaded" || (item.kind._2.$ === "Loaded" && item.kind._2._1.$ === "No"))
    ) {
      const ident = item.kind._1;
      if (item.attrs.some((a) => a.has_name(sym.path))) {
        continue;
      }

      switch (Symbol.as_str(ident.name)) {
        case "lib":
          cx.emit_span_lint(SPECIAL_MODULE_NAME, item.span, BuiltinSpecialModuleNameUsed_diagnostic("Lib"));
          break;
        case "main":
          cx.emit_span_lint(SPECIAL_MODULE_NAME, item.span, BuiltinSpecialModuleNameUsed_diagnostic("Main"));
          break;
        default:
          continue;
      }
    }
  }
};
