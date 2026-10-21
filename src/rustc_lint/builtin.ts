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
import { type Diagnostic, msg } from "../rustc_errors/lib.ts";
import type { DiagMessage } from "../rustc_error_messages/lib.ts";
import { find_feature_issue, GateIssue } from "../rustc_feature/lib.ts";
import { type Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { assert, panic, unported, unreachable } from "../std/panic.ts";
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
  BuiltinNonShorthandFieldPatterns_diagnostic,
  BuiltinMissingDoc_diagnostic,
  BuiltinMissingCopyImpl_diagnostic,
  BuiltinNoMangleGeneric_diagnostic,
  BuiltinConstNoMangle_diagnostic,
  BuiltinMutablesTransmutes_diagnostic,
  BuiltinUnstableFeatures_diagnostic,
  BuiltinUnreachablePub_diagnostic,
  BuiltinTrivialBounds_diagnostic,
  BuiltinExplicitOutlives_diagnostic,
  BuiltinDerefNullptr_diagnostic,
  InvalidAsmLabel_diagnostic,
  EqInternalMethodImplemented_diagnostic,
  type BuiltinUnpermittedTypeInitSub,
} from "./diagnostics.gen.ts";
import {
  BuiltinMissingDebugImpl_diagnostic,
  BuiltinTypeAliasBounds_diagnostic,
  BuiltinUngatedAsyncFnTrackCaller_diagnostic,
  BuiltinUnpermittedTypeInit_diagnostic,
} from "./diagnostics.ts";
import type { EarlyLintPass, LateLintPass } from "./passes.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { Attribute } from "../rustc_attr_ir/attr.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Mutability_discriminant } from "../rustc_ast_ir/lib.gen.ts";
import { GenericBound, IsAsync, WherePredicateKind } from "../rustc_hir/hir.ts";
import * as hir_visit from "../rustc_hir/intravisit.ts";
import { FnKind as HirFnKind } from "../rustc_hir/intravisit.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { Obligation } from "../rustc_infer/traits/mod.gen.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { EvaluationResult } from "../rustc_middle/traits/select.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { GenericClauses, Generics } from "../rustc_middle/ty/generics.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { HasAttrs_LocalDefId, Ty, type TypingEnv, Visibility } from "../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_TraitClause } from "../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { type DefId, CRATE_DEF_ID, DefId_eq, LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, InnerSpan } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { InlineAsmOptions } from "../rustc_ast/lib.ts";
import { Scalar, Size } from "../rustc_abi/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { VariantDef } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { EXPLICIT_OUTLIVES_REQUIREMENTS } from "../rustc_lint_defs/builtin.ts";
import { is_ascii_alphabetic, is_ascii_alphanumeric, is_ascii_digit } from "../std/char.ts";
import { type SortLayout, slice_sort_unstable_by } from "../std/slice_sort.ts";
import { Str, str_find_char, str_trim_end, str_trim_start } from "../std/str.ts";
import { type_allowed_to_implement_copy } from "../rustc_trait_selection/traits/misc.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { TypeFlags } from "../rustc_type_ir/flags.gen.ts";
import { as_interner, TraitRef, type TraitClause } from "../rustc_type_ir/predicate.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { unwrap } from "../std/panic.ts";
import {
  WhileTrue, NonShorthandFieldPatterns, UnsafeCode, MissingCopyImplementations, AnonymousParameters, InvalidNoMangleItems,
  MutableTransmutes, UnstableFeatures, UngatedAsyncFnTrackCaller, UnreachablePub, TypeAliasBounds, TrivialConstraints,
  DoubleNegations, KeywordIdents, ExplicitOutlivesRequirements, IncompleteInternalFeatures, InvalidValue, DerefNullPtr,
  AsmLabels, SpecialModuleName, InternalEqTraitMethodImpls, MissingDoc_impl_lint_pass,
  MissingDebugImplementations_impl_lint_pass, EllipsisInclusiveRangePatterns_impl_lint_pass, KEYWORD_IDENTS_2018,
  KEYWORD_IDENTS_2024, WHILE_TRUE, NON_SHORTHAND_FIELD_PATTERNS, MISSING_DOCS, MISSING_COPY_IMPLEMENTATIONS,
  MISSING_DEBUG_IMPLEMENTATIONS, ANONYMOUS_PARAMETERS, NO_MANGLE_CONST_ITEMS, MUTABLE_TRANSMUTES, UNSTABLE_FEATURES,
  UNREACHABLE_PUB, TYPE_ALIAS_BOUNDS, TRIVIAL_BOUNDS, DOUBLE_NEGATIONS, ELLIPSIS_INCLUSIVE_RANGE_PATTERNS,
  INCOMPLETE_FEATURES, INTERNAL_FEATURES, SPECIAL_MODULE_NAME, UNGATED_ASYNC_FN_TRACK_CALLER, INVALID_VALUE, DEREF_NULLPTR,
  NAMED_ASM_LABELS, BINARY_ASM_LABELS, INTERNAL_EQ_TRAIT_METHOD_IMPLS,
} from "./builtin.lints.gen.ts";

const expr_to_string = pprust.expr_to_string;

export * from "./builtin.lints.gen.ts";

export interface MissingDoc extends LateLintPass {
  check_missing_docs_attrs(cx: LateContext, def_id: LocalDefId, article: string, desc: string): void;
}
/** `MissingDoc` (builtin.rs:285; its `impl_lint_pass!` expansion is `MissingDoc_impl_lint_pass`). */
// #[derive(Default)]
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

export interface MissingDebugImplementations extends LateLintPass {}
/** `MissingDebugImplementations` (builtin.rs:598; its `impl_lint_pass!` expansion is `MissingDebugImplementations_impl_lint_pass`). */
// #[derive(Default)]
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

// ---- NonShorthandFieldPatterns (builtin.rs:110-154) ----

declare module "./builtin.lints.gen.ts" {
  interface NonShorthandFieldPatterns extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for NonShorthandFieldPatterns
// rustc: compiler/rustc_lint/src/builtin.rs:151 check_pat
NonShorthandFieldPatterns.prototype.check_pat = function (this: NonShorthandFieldPatterns, cx: LateContext, pat: hir.Pat): void {
  if (pat.kind.$ === "Struct") {
    const qpath = pat.kind._0;
    const field_pats = pat.kind._1;
    const variant = unwrap(cx.typeck_results_().pat_ty(pat).ty_adt_def(), "struct pattern type is not an ADT").variant_of_res(
      cx.qpath_res(qpath, pat.hir_id),
    );
    for (const fieldpat of field_pats) {
      if (fieldpat.is_shorthand) {
        continue;
      }
      if (Span.from_expansion(fieldpat.span)) {
        // Don't lint if this is a macro expansion: macro authors
        // shouldn't have to worry about this kind of style issue
        // (Issue #49588)
        continue;
      }
      if (fieldpat.pat.kind.$ === "Binding" && fieldpat.pat.kind._3 === undefined) {
        const binding_annot = fieldpat.pat.kind._0;
        const ident = fieldpat.pat.kind._2;
        if (cx.tcx.find_field_index(ident, variant) === cx.typeck_results_().field_index(fieldpat.hir_id)) {
          cx.emit_span_lint(
            NON_SHORTHAND_FIELD_PATTERNS,
            fieldpat.span,
            BuiltinNonShorthandFieldPatterns_diagnostic({
              ident,
              suggestion: fieldpat.span,
              prefix: binding_annot.prefix_str(),
            }),
          );
        }
      }
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

// ---- MissingDoc (builtin.rs:278-424) ----

// rustc: compiler/rustc_lint/src/builtin.rs:310 has_doc
function has_doc(attr: Attribute): boolean {
  if (attr.$ === "Parsed" && attr._0.$ === "DocComment") {
    return true;
  }

  if (attr.$ === "Parsed" && attr._0.$ === "Doc" && attr._0._0.hidden !== undefined) {
    return true;
  }

  return false;
}

// impl MissingDoc
// rustc: compiler/rustc_lint/src/builtin.rs:325 check_missing_docs_attrs
MissingDoc.prototype.check_missing_docs_attrs = function (
  this: MissingDoc,
  cx: LateContext,
  def_id: LocalDefId,
  article: string,
  desc: string,
): void {
  // Only check publicly-visible items, using the result from the privacy pass.
  // It's an option so the crate root can also use this function (it doesn't
  // have a `NodeId`).
  if (def_id !== CRATE_DEF_ID && !cx.effective_visibilities.is_exported(def_id)) {
    return;
  }

  const attrs = cx.tcx.hir_attrs(cx.tcx.local_def_id_to_hir_id(def_id));
  const has_doc_ = attrs.some(has_doc);
  if (!has_doc_) {
    cx.emit_span_lint(MISSING_DOCS, cx.tcx.def_span(def_id), BuiltinMissingDoc_diagnostic({ article, desc }));
  }
};

// impl<'tcx> LateLintPass<'tcx> for MissingDoc
// rustc: compiler/rustc_lint/src/builtin.rs:352 check_crate
MissingDoc.prototype.check_crate = function (this: MissingDoc, cx: LateContext): void {
  this.check_missing_docs_attrs(cx, CRATE_DEF_ID, "the", "crate");
};

// rustc: compiler/rustc_lint/src/builtin.rs:356 check_item
MissingDoc.prototype.check_item = function (this: MissingDoc, cx: LateContext, it: hir.Item): void {
  // Previously the Impl and Use types have been excluded from missing docs,
  // so we will continue to exclude them for compatibility.
  //
  // The documentation on `ExternCrate` is not used at the moment so no need to warn for it.
  if (it.kind.$ === "Impl" || it.kind.$ === "Use" || it.kind.$ === "ExternCrate") {
    return;
  }

  const [article, desc] = cx.tcx.article_and_description(it.owner_id.to_def_id());
  this.check_missing_docs_attrs(cx, it.owner_id.def_id, article, desc);
};

// rustc: compiler/rustc_lint/src/builtin.rs:371 check_trait_item
MissingDoc.prototype.check_trait_item = function (this: MissingDoc, cx: LateContext, trait_item: hir.TraitItem): void {
  const [article, desc] = cx.tcx.article_and_description(trait_item.owner_id.to_def_id());

  this.check_missing_docs_attrs(cx, trait_item.owner_id.def_id, article, desc);
};

// rustc: compiler/rustc_lint/src/builtin.rs:377 check_impl_item
MissingDoc.prototype.check_impl_item = function (this: MissingDoc, cx: LateContext, impl_item: hir.ImplItem): void {
  const container = (cx.tcx.associated_item(impl_item.owner_id.def_id) as AssocItem).container;

  switch (container.$) {
    // If the method is an impl for a trait, don't doc.
    case "TraitImpl":
      return;
    case "Trait":
      break;
    // If the method is an impl for an item with docs_hidden, don't doc.
    case "InherentImpl": {
      const parent = cx.tcx.hir_get_parent_item(impl_item.hir_id());
      const impl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(parent.to_def_id()) as EarlyBinder<Ty>));
      const kind = impl_ty.kind();
      const outerdef: DefId | undefined = kind.$ === "Adt" ? kind._0.did() : kind.$ === "Foreign" ? kind._0 : undefined;
      const is_hidden = outerdef !== undefined ? cx.tcx.is_doc_hidden(outerdef) : false;
      if (is_hidden) {
        return;
      }
      break;
    }
  }

  const [article, desc] = cx.tcx.article_and_description(impl_item.owner_id.to_def_id());
  this.check_missing_docs_attrs(cx, impl_item.owner_id.def_id, article, desc);
};

// rustc: compiler/rustc_lint/src/builtin.rs:407 check_foreign_item
MissingDoc.prototype.check_foreign_item = function (this: MissingDoc, cx: LateContext, foreign_item: hir.ForeignItem): void {
  const [article, desc] = cx.tcx.article_and_description(foreign_item.owner_id.to_def_id());
  this.check_missing_docs_attrs(cx, foreign_item.owner_id.def_id, article, desc);
};

// rustc: compiler/rustc_lint/src/builtin.rs:412 check_field_def
MissingDoc.prototype.check_field_def = function (this: MissingDoc, cx: LateContext, sf: hir.FieldDef): void {
  if (!sf.is_positional()) {
    this.check_missing_docs_attrs(cx, sf.def_id, "a", "struct field");
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:418 check_variant
MissingDoc.prototype.check_variant = function (this: MissingDoc, cx: LateContext, v: hir.Variant): void {
  this.check_missing_docs_attrs(cx, v.def_id, "a", "variant");
};

// ---- MissingCopyImplementations (builtin.rs:426-565) ----

declare module "./builtin.lints.gen.ts" {
  interface MissingCopyImplementations extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for MissingCopyImplementations
// rustc: compiler/rustc_lint/src/builtin.rs:460 check_item
MissingCopyImplementations.prototype.check_item = function (this: MissingCopyImplementations, cx: LateContext, item: hir.Item): void {
  if (!cx.effective_visibilities.is_reachable(item.owner_id.def_id)) {
    return;
  }
  let def: AdtDef;
  let ty: Ty;
  switch (item.kind.$) {
    case "Struct": {
      const generics = item.kind._1;
      if (!(generics.params.length === 0)) {
        return;
      }
      def = cx.tcx.adt_def(item.owner_id.to_def_id()) as AdtDef;
      ty = Ty.new_adt(cx.tcx, def, RawList.empty());
      break;
    }
    case "Union": {
      const generics = item.kind._1;
      if (!(generics.params.length === 0)) {
        return;
      }
      def = cx.tcx.adt_def(item.owner_id.to_def_id()) as AdtDef;
      ty = Ty.new_adt(cx.tcx, def, RawList.empty());
      break;
    }
    case "Enum": {
      const generics = item.kind._1;
      if (!(generics.params.length === 0)) {
        return;
      }
      def = cx.tcx.adt_def(item.owner_id.to_def_id()) as AdtDef;
      ty = Ty.new_adt(cx.tcx, def, RawList.empty());
      break;
    }
    default:
      return;
  }
  if (def.has_dtor(cx.tcx)) {
    return;
  }

  // If the type contains a raw pointer, it may represent something like a handle,
  // and recommending Copy might be a bad idea.
  for (const field of def.all_fields()) {
    const did = field.did;
    if (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(did) as EarlyBinder<Ty>)).is_raw_ptr()) {
      return;
    }
  }
  if (cx.type_is_copy_modulo_regions(ty)) {
    return;
  }
  if (type_implements_negative_copy_modulo_regions(cx.tcx, ty, cx.typing_env())) {
    return;
  }
  if (def.is_variant_list_non_exhaustive() || def.variants().some((variant) => variant.is_field_list_non_exhaustive())) {
    return;
  }

  // We shouldn't recommend implementing `Copy` on stateful things,
  // such as iterators.
  const iter_trait = cx.tcx.get_diagnostic_item(sym.Iterator);
  if (
    iter_trait !== undefined &&
    EvaluationResult.must_apply_modulo_regions(
      cx.tcx.infer_ctxt().build(cx.typing_mode()).type_implements_trait(iter_trait, [GenericArg.from_Ty(ty)], cx.param_env),
    )
  ) {
    return;
  }

  // Default value of clippy::trivially_copy_pass_by_ref
  const MAX_SIZE = 256n;

  const l = cx.layout_of(ty);
  const size = l.$ === "Ok" ? l._0.size.bytes() : undefined;
  if (size !== undefined) {
    if (size > MAX_SIZE) {
      return;
    }
  }

  if (
    type_allowed_to_implement_copy(
      cx.tcx,
      cx.param_env,
      ty,
      ObligationCause.misc(item.span, item.owner_id.def_id),
      "Safe",
    ).$ === "Ok"
  ) {
    cx.emit_span_lint(MISSING_COPY_IMPLEMENTATIONS, item.span, BuiltinMissingCopyImpl_diagnostic({}));
  }
};

/// Check whether a `ty` has a negative `Copy` implementation, ignoring outlives constraints.
// rustc: compiler/rustc_lint/src/builtin.rs:549 type_implements_negative_copy_modulo_regions
function type_implements_negative_copy_modulo_regions(tcx: TyCtxt, ty: Ty, typing_env: TypingEnv): boolean {
  const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env);
  const trait_ref = TraitRef.new(as_interner(tcx), tcx.require_lang_item("Copy", DUMMY_SP), [GenericArg.from_Ty(ty)]);
  const pred: TraitClause = { trait_ref, polarity: "Negative" };
  const obligation = new Obligation<Predicate>(
    /* cause */ ObligationCause.dummy(),
    /* param_env */ param_env,
    /* predicate */ Predicate_upcast_from_TraitClause(pred, tcx),
    /* recursion_depth */ 0,
  );
  return infcx.predicate_must_hold_modulo_regions(obligation);
}

// ---- MissingDebugImplementations (builtin.rs:567-662) ----

// impl<'tcx> LateLintPass<'tcx> for MissingDebugImplementations
// rustc: compiler/rustc_lint/src/builtin.rs:604 check_item
MissingDebugImplementations.prototype.check_item = function (this: MissingDebugImplementations, cx: LateContext, item: hir.Item): void {
  const def_id = item.owner_id.def_id;
  if (!cx.effective_visibilities.is_reachable(def_id)) {
    return;
  }

  let is_generic: boolean;
  switch (item.kind.$) {
    case "Struct":
    case "Union":
    case "Enum": {
      const generics = item.kind._1;
      is_generic = !(generics.params.length === 0);
      break;
    }
    default:
      return;
  }

  const tcx = cx.tcx;

  // Avoid listing trait impls if the trait is allowed.
  if (tcx.lint_level_spec_at_node(MISSING_DEBUG_IMPLEMENTATIONS, item.hir_id()).is_allow()) {
    return;
  }

  const debug = tcx.get_diagnostic_item(sym.Debug);
  if (debug === undefined) return;

  const ty = tcx.type_of(item.owner_id.to_def_id()) as EarlyBinder<Ty>;
  if (
    tcx
      .non_blanket_impls_for_ty(debug, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(ty)))
      [globalThis.Symbol.iterator]()
      .next().done === false
  ) {
    return;
  }

  const infcx = tcx.infer_ctxt().build(cx.typing_mode());
  if (is_generic) {
    const args = infcx.fresh_args_for_item(item.span, LocalDefId.to_def_id(def_id));
    if (
      infcx.type_implements_trait_shallow(debug, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(ty, tcx, args, fold_Ty)), cx.param_env) !==
      undefined
    ) {
      return;
    }
  } else if (
    EvaluationResult.must_apply_modulo_regions(
      infcx.type_implements_trait(debug, [GenericArg.from_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(ty)))], cx.param_env),
    )
  ) {
    return;
  }

  cx.emit_span_lint(MISSING_DEBUG_IMPLEMENTATIONS, item.span, BuiltinMissingDebugImpl_diagnostic({ tcx: cx.tcx, def_id: debug }));
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

// ---- InvalidNoMangleItems (builtin.rs:849-937) ----

declare module "./builtin.lints.gen.ts" {
  interface InvalidNoMangleItems extends LateLintPass {
    check_no_mangle_on_generic_fn(cx: LateContext, attr_span: Span, def_id: LocalDefId): void;
  }
}

// impl InvalidNoMangleItems
// rustc: compiler/rustc_lint/src/builtin.rs:872 check_no_mangle_on_generic_fn
InvalidNoMangleItems.prototype.check_no_mangle_on_generic_fn = function (
  this: InvalidNoMangleItems,
  cx: LateContext,
  attr_span: Span,
  def_id: LocalDefId,
): void {
  const generics = cx.tcx.generics_of(LocalDefId.to_def_id(def_id)) as Generics;
  if (generics.requires_monomorphization(cx.tcx)) {
    cx.tcx.dcx().emit_err(
      BuiltinNoMangleGeneric_diagnostic({
        span: cx.tcx.def_span(LocalDefId.to_def_id(def_id)),
        suggestion: attr_span,
      }),
    );
  }
};

// impl<'tcx> LateLintPass<'tcx> for InvalidNoMangleItems
// rustc: compiler/rustc_lint/src/builtin.rs:889 check_item
InvalidNoMangleItems.prototype.check_item = function (this: InvalidNoMangleItems, cx: LateContext, it: hir.Item): void {
  const attrs = cx.tcx.hir_attrs(it.hir_id());
  switch (it.kind.$) {
    case "Fn": {
      const attr_span =
        find_attr(attrs, (k) => (k.$ === "ExportName" ? k.span : undefined)) ?? find_attr(attrs, (k) => (k.$ === "NoMangle" ? k._0 : undefined));
      if (attr_span !== undefined) {
        this.check_no_mangle_on_generic_fn(cx, attr_span, it.owner_id.def_id);
      }
      break;
    }
    case "Const": {
      const ident = it.kind._0;
      const generics = it.kind._1;
      if (find_attr(attrs, (k) => (k.$ === "NoMangle" ? null : undefined)) !== undefined) {
        const suggestion =
          generics.params.length === 0 && Span.is_empty(generics.where_clause_span)
            ? // account for "pub const" (#45562)
              Span.until(it.span, ident.span)
            : undefined;

        // Const items do not refer to a particular location in memory, and therefore
        // don't have anything to attach a symbol to
        cx.emit_span_lint(NO_MANGLE_CONST_ITEMS, it.span, BuiltinConstNoMangle_diagnostic({ suggestion }));
      }
      break;
    }
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/builtin.rs:922 check_impl_item
InvalidNoMangleItems.prototype.check_impl_item = function (this: InvalidNoMangleItems, cx: LateContext, it: hir.ImplItem): void {
  const attrs = cx.tcx.hir_attrs(it.hir_id());
  switch (it.kind.$) {
    case "Fn": {
      const attr_span =
        find_attr(attrs, (k) => (k.$ === "ExportName" ? k.span : undefined)) ?? find_attr(attrs, (k) => (k.$ === "NoMangle" ? k._0 : undefined));
      if (attr_span !== undefined) {
        this.check_no_mangle_on_generic_fn(cx, attr_span, it.owner_id.def_id);
      }
      break;
    }
    default:
      break;
  }
};

// ---- MutableTransmutes (builtin.rs:939-998) ----

declare module "./builtin.lints.gen.ts" {
  interface MutableTransmutes extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for MutableTransmutes
// rustc: compiler/rustc_lint/src/builtin.rs:967 check_expr
MutableTransmutes.prototype.check_expr = function (this: MutableTransmutes, cx: LateContext, expr: hir.Expr): void {
  const tys = get_transmute_from_to(cx, expr);
  if (tys !== undefined) {
    const [k1, k2] = [tys[0].kind(), tys[1].kind()];
    if (k1.$ === "Ref" && k2.$ === "Ref") {
      const from_mutbl = k1._2;
      const to_mutbl = k2._2;
      if (Mutability_discriminant[from_mutbl] < Mutability_discriminant[to_mutbl]) {
        cx.emit_span_lint(MUTABLE_TRANSMUTES, expr.span, BuiltinMutablesTransmutes_diagnostic({}));
      }
    }
  }

  // rustc: compiler/rustc_lint/src/builtin.rs:976 get_transmute_from_to
  function get_transmute_from_to(cx: LateContext, expr: hir.Expr): [Ty, Ty] | undefined {
    if (expr.kind.$ !== "Path") return undefined;
    const qpath = expr.kind._0;
    const def = cx.qpath_res(qpath, expr.hir_id);
    if (def.$ === "Def" && def._0.$ === "Fn") {
      const did = def._1;
      if (!def_id_is_transmute(cx, did)) {
        return undefined;
      }
      const sig = cx.typeck_results_().node_type(expr.hir_id).fn_sig(cx.tcx);
      const from = Binder.skip_binder(PolyFnSig.inputs(sig))[0]!;
      const to = Binder.skip_binder(PolyFnSig.output(sig));
      return [from, to];
    }
    return undefined;
  }

  // rustc: compiler/rustc_lint/src/builtin.rs:994 def_id_is_transmute
  function def_id_is_transmute(cx: LateContext, def_id: DefId): boolean {
    return cx.tcx.is_intrinsic(def_id, sym.transmute);
  }
};

// ---- UnstableFeatures (builtin.rs:1000-1040) ----

declare module "./builtin.lints.gen.ts" {
  interface UnstableFeatures extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for UnstableFeatures
// rustc: compiler/rustc_lint/src/builtin.rs:1033 check_attributes
UnstableFeatures.prototype.check_attributes = function (this: UnstableFeatures, cx: LateContext, attrs: readonly Attribute[]): void {
  const features = find_attr(attrs, (k) => (k.$ === "Feature" ? k._0 : undefined));
  if (features !== undefined) {
    for (const feature of features) {
      cx.emit_span_lint(UNSTABLE_FEATURES, feature.span, BuiltinUnstableFeatures_diagnostic({}));
    }
  }
};

// ---- UngatedAsyncFnTrackCaller (builtin.rs:1042-1093) ----

declare module "./builtin.lints.gen.ts" {
  interface UngatedAsyncFnTrackCaller extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for UngatedAsyncFnTrackCaller
// rustc: compiler/rustc_lint/src/builtin.rs:1075 check_fn
UngatedAsyncFnTrackCaller.prototype.check_fn = function (
  this: UngatedAsyncFnTrackCaller,
  cx: LateContext,
  fn_kind: HirFnKind,
  _: hir.FnDecl,
  __: hir.Body,
  span: Span,
  def_id: LocalDefId,
): void {
  let attr_span: Span | undefined;
  if (
    IsAsync.is_async(HirFnKind.asyncness(fn_kind)) &&
    !cx.tcx.features().async_fn_track_caller() &&
    // Now, check if the function has the `#[track_caller]` attribute
    (attr_span = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, cx.tcx), (k) => (k.$ === "TrackCaller" ? k._0 : undefined))) !== undefined
  ) {
    cx.emit_span_lint(
      UNGATED_ASYNC_FN_TRACK_CALLER,
      attr_span,
      BuiltinUngatedAsyncFnTrackCaller_diagnostic({ label: span, session: cx.tcx.sess }),
    );
  }
};

// ---- UnreachablePub (builtin.rs:1095-1220) ----

declare module "./builtin.lints.gen.ts" {
  interface UnreachablePub extends LateLintPass {
    perform_lint(cx: LateContext, what: string, def_id: LocalDefId, vis_span: Span, exportable: boolean): void;
  }
}

// impl UnreachablePub
// rustc: compiler/rustc_lint/src/builtin.rs:1142 perform_lint
UnreachablePub.prototype.perform_lint = function (
  this: UnreachablePub,
  cx: LateContext,
  what: string,
  def_id: LocalDefId,
  vis_span: Span,
  exportable: boolean,
): void {
  let applicability: Applicability = "MachineApplicable";
  if (!Visibility.is_public(cx.tcx.visibility(LocalDefId.to_def_id(def_id))) || cx.effective_visibilities.is_reachable(def_id)) {
    return;
  }

  // prefer suggesting `pub(super)` instead of `pub(crate)` when possible,
  // except when `pub(super) == pub(crate)`
  const effective_vis = cx.effective_visibilities.effective_vis(def_id);
  const vis = effective_vis === undefined ? undefined : effective_vis.at_level("Reachable");
  let new_vis: string;
  if (vis !== undefined && vis.$ === "Restricted") {
    const restricted_did = vis._0;
    const parent_parent = cx.tcx.parent_module_from_def_id(LocalModId.to_local_def_id(cx.tcx.parent_module_from_def_id(def_id)));
    new_vis =
      restricted_did === parent_parent && !LocalModId.to_def_id(restricted_did).is_crate_root() ? "pub(super)" : "pub(crate)";
  } else {
    new_vis = "pub(crate)";
  }

  if (Span.from_expansion(vis_span)) {
    applicability = "MaybeIncorrect";
  }
  const def_span = cx.tcx.def_span(LocalDefId.to_def_id(def_id));
  cx.emit_span_lint(
    UNREACHABLE_PUB,
    def_span,
    BuiltinUnreachablePub_diagnostic({
      what,
      new_vis,
      suggestion: [vis_span, applicability],
      help: exportable,
    }),
  );
};

// impl<'tcx> LateLintPass<'tcx> for UnreachablePub
// rustc: compiler/rustc_lint/src/builtin.rs:1190 check_item
UnreachablePub.prototype.check_item = function (this: UnreachablePub, cx: LateContext, item: hir.Item): void {
  this.perform_lint(cx, "item", item.owner_id.def_id, item.vis_span, true);
};

// rustc: compiler/rustc_lint/src/builtin.rs:1194 check_foreign_item
UnreachablePub.prototype.check_foreign_item = function (this: UnreachablePub, cx: LateContext, foreign_item: hir.ForeignItem): void {
  this.perform_lint(cx, "item", foreign_item.owner_id.def_id, foreign_item.vis_span, true);
};

// rustc: compiler/rustc_lint/src/builtin.rs:1198 check_field_def
UnreachablePub.prototype.check_field_def = function (this: UnreachablePub, _cx: LateContext, _field: hir.FieldDef): void {
  // - If an ADT definition is reported then we don't need to check fields
  //   (as it would add unnecessary complexity to the source code, the struct
  //   definition is in the immediate proximity to give the "real" visibility).
  // - If an ADT is not reported because it's not `pub` - we don't need to
  //   check fields.
  // - If an ADT is not reported because it's reachable - we also don't need
  //   to check fields because then they are reachable by construction if they
  //   are pub.
  //
  // Therefore in no case we check the fields.
  //
  // cf. https://github.com/rust-lang/rust/pull/126013#issuecomment-2152839205
  // cf. https://github.com/rust-lang/rust/pull/126040#issuecomment-2152944506
};

// rustc: compiler/rustc_lint/src/builtin.rs:1214 check_impl_item
UnreachablePub.prototype.check_impl_item = function (this: UnreachablePub, cx: LateContext, impl_item: hir.ImplItem): void {
  if (impl_item.impl_kind.$ === "Inherent") {
    const vis_span = impl_item.impl_kind.vis_span;
    this.perform_lint(cx, "item", impl_item.owner_id.def_id, vis_span, false);
  }
};

// ---- TypeAliasBounds (builtin.rs:1222-1373) ----

declare module "./builtin.lints.gen.ts" {
  interface TypeAliasBounds extends LateLintPass {}
  namespace TypeAliasBounds {
    export let affects_object_lifetime_defaults: (pred: hir.WherePredicate) => boolean;
  }
}

// impl TypeAliasBounds
// rustc: compiler/rustc_lint/src/builtin.rs:1262 affects_object_lifetime_defaults
TypeAliasBounds.affects_object_lifetime_defaults = function (pred: hir.WherePredicate): boolean {
  // Bounds of the form `T: 'a` with `T` type param affect object lifetime defaults.
  if (
    pred.kind.$ === "BoundPredicate" &&
    pred.kind._0.bounds.some((bound) => bound.$ === "Outlives") &&
    pred.kind._0.bound_generic_params.length === 0 && // indeed, even if absent from the RHS
    pred.kind._0.bounded_ty.as_generic_param() !== undefined
  ) {
    return true;
  }
  return false;
};

// impl<'tcx> LateLintPass<'tcx> for TypeAliasBounds
// rustc: compiler/rustc_lint/src/builtin.rs:1276 check_item
TypeAliasBounds.prototype.check_item = function (this: TypeAliasBounds, cx: LateContext, item: hir.Item): void {
  if (item.kind.$ !== "TyAlias") return;
  const generics = item.kind._1;
  const hir_ty = item.kind._2;

  // There must not be a where clause.
  if (generics.predicates.length === 0) {
    return;
  }

  // Bounds of checked type aliases and TAITs are respected.
  if (cx.tcx.type_alias_is_checked(item.owner_id.to_def_id())) {
    return;
  }

  // FIXME(generic_const_exprs): Revisit this before stabilization.
  // See also `tests/ui/const-generics/generic_const_exprs/type-alias-bounds.rs`.
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(item.owner_id.to_def_id()) as EarlyBinder<Ty>));
  if (TypeVisitableExt.has_type_flags(ty, TypeFlags.HAS_CONST_ALIAS, fold_Ty) && cx.tcx.features().generic_const_exprs()) {
    return;
  }

  // NOTE(inherent_associated_types): While we currently do take some bounds in type
  // aliases into consideration during IAT *selection*, we don't perform full use+def
  // site wfchecking for such type aliases. Therefore TAB should still trigger.
  // See also `tests/ui/associated-inherent-types/type-alias-bounds.rs`.

  const where_spans: Span[] = [];
  const inline_spans: Span[] = [];
  const inline_sugg: [Span, string][] = [];

  for (const p of generics.predicates) {
    const span = p.span;
    if (WherePredicateKind.in_where_clause(p.kind)) {
      where_spans.push(span);
    } else {
      for (const b of WherePredicateKind.bounds(p.kind)) {
        inline_spans.push(GenericBound.span(b));
      }
      inline_sugg.push([span, ""]);
    }
  }

  let ty_: hir.Ty | undefined = hir_ty;
  const enable_feat_help = cx.tcx.sess.is_nightly_build();

  if (where_spans.length > 0) {
    const label_sp = where_spans[where_spans.length - 1]!;
    const taken = ty_;
    ty_ = undefined;
    cx.emit_span_lint(
      TYPE_ALIAS_BOUNDS,
      where_spans,
      BuiltinTypeAliasBounds_diagnostic({
        in_where_clause: true,
        label: label_sp,
        enable_feat_help,
        suggestions: [[generics.where_clause_span, ""]],
        preds: generics.predicates,
        ty: taken,
      }),
    );
  }
  if (inline_spans.length > 0) {
    const label_sp = inline_spans[inline_spans.length - 1]!;
    cx.emit_span_lint(
      TYPE_ALIAS_BOUNDS,
      inline_spans,
      BuiltinTypeAliasBounds_diagnostic({
        in_where_clause: false,
        label: label_sp,
        enable_feat_help,
        suggestions: inline_sugg,
        preds: generics.predicates,
        ty: ty_,
      }),
    );
  }
};

export class ShorthandAssocTyCollector extends hir_visit.Visitor {
  constructor(public qselves: Span[]) {
    super();
  }

  // impl hir::intravisit::Visitor<'_> for ShorthandAssocTyCollector
  // rustc: compiler/rustc_lint/src/builtin.rs:1358 visit_qpath
  override visit_qpath(qpath: hir.QPath, id: HirId, _: Span): undefined {
    // Look for "type-parameter shorthand-associated-types". I.e., paths of the
    // form `T::Assoc` with `T` type param. These are reliant on trait bounds.
    if (qpath.$ === "TypeRelative" && qpath._0.as_generic_param() !== undefined) {
      this.qselves.push(qpath._0.span);
    }
    return hir_visit.walk_qpath(this, qpath, id);
  }
}

// ---- TrivialConstraints (builtin.rs:1375-1448) ----

declare module "./builtin.lints.gen.ts" {
  interface TrivialConstraints extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for TrivialConstraints
// rustc: compiler/rustc_lint/src/builtin.rs:1412 check_item
TrivialConstraints.prototype.check_item = function (this: TrivialConstraints, cx: LateContext, item: hir.Item): void {
  if (cx.tcx.features().trivial_bounds()) {
    const gen_clauses = cx.tcx.clauses_of(item.owner_id.to_def_id()) as GenericClauses;
    for (const [clause, span] of gen_clauses.clauses) {
      let clause_kind_name: string;
      const kind = Binder.skip_binder(clause.kind());
      switch (kind.$) {
        case "Trait":
          clause_kind_name = "trait";
          break;
        case "TypeOutlives":
        case "RegionOutlives":
          clause_kind_name = "lifetime";
          break;

        case "UnstableFeature":
        // `ConstArgHasType` is never global as `ct` is always a param
        case "ConstArgHasType":
        // Ignore projections, as they can only be global
        // if the trait bound is global
        case "Projection":
        // Ignore bounds that a user can't type
        case "WellFormed":
        // FIXME(generic_const_exprs): `ConstEvaluatable` can be written
        case "ConstEvaluatable":
        // Users don't write this directly, only via another trait ref.
        case "HostEffect":
          continue;
      }
      if (TypeVisitableExt.is_global(clause, fold_Clause)) {
        cx.emit_span_lint(TRIVIAL_BOUNDS, span, BuiltinTrivialBounds_diagnostic({ clause_kind_name, clause }));
      }
    }
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

// ---- ExplicitOutlivesRequirements (builtin.rs:1837-2181) ----

declare module "./builtin.lints.gen.ts" {
  interface ExplicitOutlivesRequirements extends LateLintPass {
    collect_outlives_bound_spans(
      tcx: TyCtxt,
      bounds: hir.GenericBounds,
      inferred_outlives: readonly Region[],
      predicate_span: Span,
      item: DefId,
    ): [number, Span][];
    consolidate_outlives_bound_spans(lo: Span, bounds: hir.GenericBounds, bound_spans: [number, Span][]): Span[];
  }
  namespace ExplicitOutlivesRequirements {
    export let lifetimes_outliving_lifetime: (
      tcx: TyCtxt,
      inferred_outlives: Iterable<readonly [Clause, Span]>,
      item: LocalDefId,
      lifetime: LocalDefId,
    ) => Region[];
    export let lifetimes_outliving_type: (inferred_outlives: Iterable<readonly [Clause, Span]>, index: number) => Region[];
  }
}

// impl ExplicitOutlivesRequirements
// rustc: compiler/rustc_lint/src/builtin.rs:1840 lifetimes_outliving_lifetime
ExplicitOutlivesRequirements.lifetimes_outliving_lifetime = function (
  tcx: TyCtxt,
  inferred_outlives: Iterable<readonly [Clause, Span]>,
  item: LocalDefId,
  lifetime: LocalDefId,
): Region[] {
  const item_generics = tcx.generics_of(LocalDefId.to_def_id(item)) as Generics;

  const out: Region[] = [];
  for (const [clause, _] of inferred_outlives) {
    const kind = Binder.skip_binder(clause.kind());
    if (kind.$ === "RegionOutlives") {
      const [a, b] = [kind._0._0, kind._0._1];
      const ak = a.kind();
      if (ak.$ === "ReEarlyParam" && DefId_eq(item_generics.region_param(ak._0, tcx).def_id, LocalDefId.to_def_id(lifetime))) {
        out.push(b);
      }
    }
  }
  return out;
};

// rustc: compiler/rustc_lint/src/builtin.rs:1863 lifetimes_outliving_type
ExplicitOutlivesRequirements.lifetimes_outliving_type = function (
  inferred_outlives: Iterable<readonly [Clause, Span]>,
  index: number,
): Region[] {
  const out: Region[] = [];
  for (const [clause, _] of inferred_outlives) {
    const kind = Binder.skip_binder(clause.kind());
    if (kind.$ === "TypeOutlives") {
      const [a, b] = [kind._0._0, kind._0._1];
      if (a.is_param(index)) out.push(b);
    }
  }
  return out;
};

// rustc: compiler/rustc_lint/src/builtin.rs:1877 collect_outlives_bound_spans
ExplicitOutlivesRequirements.prototype.collect_outlives_bound_spans = function (
  this: ExplicitOutlivesRequirements,
  tcx: TyCtxt,
  bounds: hir.GenericBounds,
  inferred_outlives: readonly Region[],
  predicate_span: Span,
  item: DefId,
): [number, Span][] {
  const item_generics = tcx.generics_of(item) as Generics;

  const out: [number, Span][] = [];
  for (const [i, bound] of bounds.entries()) {
    if (bound.$ !== "Outlives") {
      continue;
    }
    const lifetime = bound._0;

    const r = tcx.named_bound_var(lifetime.hir_id);
    let is_inferred: boolean;
    if (r !== undefined && r.$ === "EarlyBound") {
      const def_id = r._0;
      is_inferred = inferred_outlives.some((r) => {
        const k = r.kind();
        return k.$ === "ReEarlyParam" && DefId_eq(item_generics.region_param(k._0, tcx).def_id, LocalDefId.to_def_id(def_id));
      });
    } else {
      is_inferred = false;
    }

    if (!is_inferred) {
      continue;
    }

    const span = Span.find_ancestor_inside(GenericBound.span(bound), predicate_span);
    if (span === undefined) continue;
    if (Span.in_external_macro(span, tcx.sess.source_map())) {
      continue;
    }

    out.push([i, span]);
  }
  return out;
};

// rustc: compiler/rustc_lint/src/builtin.rs:1918 consolidate_outlives_bound_spans
ExplicitOutlivesRequirements.prototype.consolidate_outlives_bound_spans = function (
  this: ExplicitOutlivesRequirements,
  lo: Span,
  bounds: hir.GenericBounds,
  bound_spans: [number, Span][],
): Span[] {
  if (bounds.length === 0) {
    return [];
  }
  if (bound_spans.length === bounds.length) {
    const [, last_bound_span] = bound_spans[bound_spans.length - 1]!;
    // If all bounds are inferable, we want to delete the colon, so
    // start from just after the parameter (span passed as argument)
    return [Span.to(lo, last_bound_span)];
  } else {
    const merged: Span[] = [];
    let last_merged_i: number | undefined = undefined;

    let from_start = true;
    for (const [i, bound_span] of bound_spans) {
      if (last_merged_i === undefined && i === 0) {
        // If the first bound is inferable, our span should also eat the leading `+`.
        merged.push(Span.to(bound_span, Span.shrink_to_lo(GenericBound.span(index(bounds, 1)))));
        last_merged_i = 0;
      } else if (last_merged_i !== undefined && i === last_merged_i + 1) {
        // If consecutive bounds are inferable, merge their spans
        if (merged.length > 0) {
          const tail = merged[merged.length - 1]!;
          // Also eat the trailing `+` if the first
          // more-than-one bound is inferable
          const to_span = from_start && i < bounds.length ? Span.shrink_to_lo(GenericBound.span(index(bounds, i + 1))) : bound_span;
          merged[merged.length - 1] = Span.to(tail, to_span);
          last_merged_i = i;
        } else {
          bug("another bound-span visited earlier");
        }
      } else {
        // When we find a non-inferable bound, subsequent inferable bounds
        // won't be consecutive from the start (and we'll eat the leading
        // `+` rather than the trailing one)
        from_start = false;
        merged.push(Span.to(Span.shrink_to_hi(GenericBound.span(index(bounds, i - 1))), bound_span));
        last_merged_i = i;
      }
    }
    return merged;
  }
};

/** `slice[i]`: panics when out of bounds, as Rust's indexing. */
function index<T>(xs: readonly T[], i: number): T {
  if (i < 0 || i >= xs.length) return panic(`index out of bounds: the len is ${xs.length} but the index is ${i}`);
  return xs[i]!;
}

// impl<'tcx> LateLintPass<'tcx> for ExplicitOutlivesRequirements
// rustc: compiler/rustc_lint/src/builtin.rs:1976 check_item
ExplicitOutlivesRequirements.prototype.check_item = function (this: ExplicitOutlivesRequirements, cx: LateContext, item: hir.Item): void {
  const def_id = item.owner_id.def_id;
  if (item.kind.$ === "Struct" || item.kind.$ === "Enum" || item.kind.$ === "Union") {
    const generics = item.kind._1;
    const inferred_outlives = cx.tcx.inferred_outlives_of(LocalDefId.to_def_id(def_id)) as readonly (readonly [Clause, Span])[];
    if (inferred_outlives.length === 0) {
      return;
    }

    const ty_generics = cx.tcx.generics_of(LocalDefId.to_def_id(def_id)) as Generics;
    const num_where_predicates = generics.predicates.filter((predicate) => WherePredicateKind.in_where_clause(predicate.kind)).length;

    let bound_count = 0;
    const lint_spans: Span[] = [];
    const where_lint_spans: Span[] = [];
    let dropped_where_predicate_count = 0;
    for (const [i, where_predicate] of generics.predicates.entries()) {
      let relevant_lifetimes: Region[];
      let bounds: hir.GenericBounds;
      let predicate_span: Span;
      let in_where_clause: boolean;
      switch (where_predicate.kind.$) {
        case "RegionPredicate": {
          const predicate = where_predicate.kind._0;
          const r = cx.tcx.named_bound_var(predicate.lifetime.hir_id);
          if (r !== undefined && r.$ === "EarlyBound") {
            const region_def_id = r._0;
            [relevant_lifetimes, bounds, predicate_span, in_where_clause] = [
              ExplicitOutlivesRequirements.lifetimes_outliving_lifetime(
                cx.tcx,
                // don't warn if the inferred span actually came from the predicate we're looking at
                // this happens if the type is recursively defined
                inferred_outlives.filter(([_, span]) => !Span.contains(where_predicate.span, span)),
                item.owner_id.def_id,
                region_def_id,
              ),
              predicate.bounds,
              where_predicate.span,
              predicate.in_where_clause,
            ];
          } else {
            continue;
          }
          break;
        }
        case "BoundPredicate": {
          const predicate = where_predicate.kind._0;
          // FIXME we can also infer bounds on associated types,
          // and should check for them here.
          const bk = predicate.bounded_ty.kind;
          if (bk.$ === "Path" && bk._0.$ === "Resolved" && bk._0._0 === undefined) {
            const path = bk._0._1;
            if (!(path.res.$ === "Def" && path.res._0.$ === "TyParam")) {
              continue;
            }
            const def_id = path.res._1;
            const index = unwrap(ty_generics.param_def_id_to_index.get(def_id));
            // Removing a `T: 'r` outlives bound can silently change
            // the object lifetime default for `Struct<'r, dyn Trait>`
            // (RFC 599): the explicit bound sets the default to `'r`,
            // so removing it may change it to `'static` (or cause an
            // ambiguity error if there is no unique default). Only
            // suppress the lint for non-higher-ranked predicates when
            // T is not `Sized` (i.e. can hold trait object types).
            // Higher-ranked predicates (`for<'x> T: 'r`) are excluded
            // from RFC 599 object lifetime defaulting and are always
            // safe to remove.
            if (predicate.bound_generic_params.length === 0) {
              const ty_param = unwrap(ty_generics.own_params[index]);
              const param_ty = Ty.new_param(cx.tcx, ty_param.index, ty_param.name);
              if (!param_ty.is_sized(cx.tcx, cx.typing_env())) {
                continue;
              }
            }
            [relevant_lifetimes, bounds, predicate_span, in_where_clause] = [
              ExplicitOutlivesRequirements.lifetimes_outliving_type(
                // don't warn if the inferred span actually came from the predicate we're looking at
                // this happens if the type is recursively defined
                inferred_outlives.filter(([_, span]) => !Span.contains(where_predicate.span, span)),
                index,
              ),
              predicate.bounds,
              where_predicate.span,
              predicate.origin === "WhereClause",
            ];
          } else {
            continue;
          }
          break;
        }
      }
      if (relevant_lifetimes.length === 0) {
        continue;
      }

      const bound_spans = this.collect_outlives_bound_spans(
        cx.tcx,
        bounds,
        relevant_lifetimes,
        predicate_span,
        item.owner_id.to_def_id(),
      );
      bound_count += bound_spans.length;

      const drop_predicate = bound_spans.length === bounds.length;
      if (drop_predicate && in_where_clause) {
        dropped_where_predicate_count += 1;
      }

      if (drop_predicate) {
        if (!in_where_clause) {
          lint_spans.push(predicate_span);
        } else if (Span.from_expansion(predicate_span)) {
          // Don't try to extend the span if it comes from a macro expansion.
          where_lint_spans.push(predicate_span);
        } else if (i + 1 < num_where_predicates) {
          // If all the bounds on a predicate were inferable and there are
          // further predicates, we want to eat the trailing comma.
          const next_predicate_span = index(generics.predicates, i + 1).span;
          if (Span.from_expansion(next_predicate_span)) {
            where_lint_spans.push(predicate_span);
          } else {
            where_lint_spans.push(Span.to(predicate_span, Span.shrink_to_lo(next_predicate_span)));
          }
        } else {
          // Eat the optional trailing comma after the last predicate.
          const where_span = generics.where_clause_span;
          if (Span.from_expansion(where_span)) {
            where_lint_spans.push(predicate_span);
          } else {
            where_lint_spans.push(Span.to(predicate_span, Span.shrink_to_hi(where_span)));
          }
        }
      } else {
        where_lint_spans.push(...this.consolidate_outlives_bound_spans(Span.shrink_to_lo(predicate_span), bounds, bound_spans));
      }
    }

    // If all predicates in where clause are inferable, drop the entire clause
    // (including the `where`)
    if (generics.has_where_clause_predicates && dropped_where_predicate_count === num_where_predicates) {
      const where_span = generics.where_clause_span;
      // Extend the where clause back to the closing `>` of the
      // generics, except for tuple struct, which have the `where`
      // after the fields of the struct.
      const full_where_span =
        item.kind.$ === "Struct" && item.kind._2.$ === "Tuple" ? where_span : Span.to(Span.shrink_to_hi(generics.span), where_span);

      // Due to macro expansions, the `full_where_span` might not actually contain all
      // predicates.
      if (where_lint_spans.every((sp) => Span.contains(full_where_span, sp))) {
        lint_spans.push(full_where_span);
      } else {
        lint_spans.push(...where_lint_spans);
      }
    } else {
      lint_spans.push(...where_lint_spans);
    }

    if (!(lint_spans.length === 0)) {
      // Do not automatically delete outlives requirements from macros.
      const applicability: Applicability = lint_spans.every((sp) => Span.can_be_used_for_suggestions(sp))
        ? "MachineApplicable"
        : "MaybeIncorrect";

      // Due to macros, there might be several predicates with the same span
      // and we only want to suggest removing them once.
      slice_sort_unstable_by(lint_spans, cmp_lo_hi, LAYOUT_Span);
      dedup_by_key_lo_hi(lint_spans);

      cx.emit_span_lint(
        EXPLICIT_OUTLIVES_REQUIREMENTS,
        [...lint_spans],
        BuiltinExplicitOutlives_diagnostic({
          suggestion: {
            spans: lint_spans,
            applicability,
            count: bound_count,
          },
        }),
      );
    }
  }
};

/** The key comparison of `spans.sort_unstable_by_key(|span| span.lo_hi())` (`(BytePos, BytePos)` tuple order). */
function cmp_lo_hi(a: Span, b: Span): number {
  const [alo, ahi] = Span.lo_hi(a);
  const [blo, bhi] = Span.lo_hi(b);
  return alo !== blo ? alo - blo : ahi - bhi;
}
// PORT: `size_of::<Span>()` is 8 and `Span: Freeze` (the `SortLayout` of std/slice_sort.ts).
const LAYOUT_Span: SortLayout = { size_of: 8, freeze: true };

/** `spans.dedup_by_key(|span| span.lo_hi())`: keeps the first of each run of consecutive equal keys. */
function dedup_by_key_lo_hi(spans: Span[]): void {
  let w = 0;
  for (let r = 0; r < spans.length; r++) {
    if (w > 0) {
      const [plo, phi] = Span.lo_hi(spans[w - 1]!);
      const [lo, hi] = Span.lo_hi(spans[r]!);
      if (plo === lo && phi === hi) continue;
    }
    spans[w++] = spans[r]!;
  }
  spans.length = w;
}

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

// ---- InvalidValue (builtin.rs:2265-2602) ----

declare module "./builtin.lints.gen.ts" {
  interface InvalidValue extends LateLintPass {}
}

/// Information about why a type cannot be initialized this way.
export class InitError {
  constructor(
    public message: string,
    public span: Span | undefined,
    public nested: InitError | undefined,
  ) {}

  // rustc: compiler/rustc_lint/src/builtin.rs:2313 spanned
  spanned(span: Span): InitError {
    return new InitError(this.message, span, this.nested);
  }

  // PORT: the method `nested` is `nested_` (the field keeps the name `nested`).
  // rustc: compiler/rustc_lint/src/builtin.rs:2317 nested
  nested_(nested: InitError | undefined): InitError {
    assert(this.nested === undefined, "assertion failed: self.nested.is_none()");
    return new InitError(this.message, this.span, nested);
  }

  /** `impl<'a> From<&'a str> for InitError` */
  // rustc: compiler/rustc_lint/src/builtin.rs:2324 from
  static from_str(s: string): InitError {
    return InitError.from_String(s);
  }

  /** `impl From<String> for InitError` */
  // rustc: compiler/rustc_lint/src/builtin.rs:2329 from
  static from_String(message: string): InitError {
    return new InitError(message, undefined, undefined);
  }
}

// #[derive(Debug, Copy, Clone, PartialEq)]
type InitKind = "Zeroed" | "Uninit";

// impl<'tcx> LateLintPass<'tcx> for InvalidValue
// rustc: compiler/rustc_lint/src/builtin.rs:2335 check_expr
InvalidValue.prototype.check_expr = function (this: InvalidValue, cx: LateContext, expr: hir.Expr): void {
  /// Test if this constant is all-0.
  // rustc: compiler/rustc_lint/src/builtin.rs:2343 is_zero
  function is_zero(expr: hir.Expr): boolean {
    switch (expr.kind.$) {
      case "Lit": {
        const lit = expr.kind._0;
        if (lit.node.$ === "Int") {
          return lit.node._0 === 0n;
        } else {
          return false;
        }
      }
      case "Tup":
        return expr.kind._0.every(is_zero);
      default:
        return false;
    }
  }

  /// Determine if this expression is a "dangerous initialization".
  // rustc: compiler/rustc_lint/src/builtin.rs:2360 is_dangerous_init
  function is_dangerous_init(cx: LateContext, expr: hir.Expr): InitKind | undefined {
    if (expr.kind.$ === "Call" && expr.kind._0.kind.$ === "Path") {
      // Find calls to `mem::{uninitialized,zeroed}` methods.
      const path_expr = expr.kind._0;
      const args = expr.kind._1;
      const qpath = expr.kind._0.kind._0;
      const def_id = Res.opt_def_id(cx.qpath_res(qpath, path_expr.hir_id));
      if (def_id === undefined) return undefined;
      const name = cx.tcx.get_diagnostic_name(def_id);
      if (name === sym.mem_zeroed) return "Zeroed";
      if (name === sym.mem_uninitialized) return "Uninit";
      if (name === sym.transmute && is_zero(index(args, 0))) return "Zeroed";
    } else if (expr.kind.$ === "MethodCall") {
      const receiver = expr.kind._1;
      // Find problematic calls to `MaybeUninit::assume_init`.
      const def_id = cx.typeck_results_().type_dependent_def_id(expr.hir_id);
      if (def_id === undefined) return undefined;
      if (cx.tcx.is_diagnostic_item(sym.assume_init, def_id)) {
        // This is a call to *some* method named `assume_init`.
        // See if the `self` parameter is one of the dangerous constructors.
        if (receiver.kind.$ === "Call" && receiver.kind._0.kind.$ === "Path") {
          const path_expr = receiver.kind._0;
          const qpath = receiver.kind._0.kind._0;
          const def_id = Res.opt_def_id(cx.qpath_res(qpath, path_expr.hir_id));
          if (def_id === undefined) return undefined;
          const name = cx.tcx.get_diagnostic_name(def_id);
          if (name === sym.maybe_uninit_zeroed) return "Zeroed";
          if (name === sym.maybe_uninit_uninit) return "Uninit";
        }
      }
    }

    return undefined;
  }

  // rustc: compiler/rustc_lint/src/builtin.rs:2394 variant_find_init_error
  function variant_find_init_error(
    cx: LateContext,
    ty: Ty,
    variant: VariantDef,
    args: GenericArgs,
    descr: string,
    init: InitKind,
  ): InitError | undefined {
    let field_err: InitError | undefined = undefined;
    for (const field of variant.fields) {
      const err = ty_find_init_error(cx, Unnormalized.skip_norm_wip(field.ty(cx.tcx, args)), init);
      if (err === undefined) continue;
      if (!field.did.is_local()) {
        field_err = err;
      } else if (err.span === undefined) {
        err.span = cx.tcx.def_span(field.did);
        err.message += ` (in this ${descr})`;
        field_err = err;
      } else {
        field_err = InitError.from_String(`in this ${descr}`).spanned(cx.tcx.def_span(field.did)).nested_(err);
      }
      break;
    }

    // Check if this ADT has a constrained layout (like `NonNull` and friends).
    const layout = cx.tcx.layout_of(cx.typing_env().as_query_input(ty));
    if (layout.$ === "Ok") {
      const backend_repr = layout._0.backend_repr;
      const scalar = backend_repr.$ === "Scalar" ? backend_repr._0 : backend_repr.$ === "ScalarPair" ? backend_repr.a : undefined;
      if (scalar !== undefined) {
        const range = Scalar.valid_range(scalar, cx);
        let msg: string;
        if (!range.contains(0n)) {
          msg = "must be non-null";
        } else if (init === "Uninit" && !Scalar.is_always_valid(scalar, cx)) {
          // Prefer reporting on the fields over the entire struct for uninit,
          // as the information bubbles out and it may be unclear why the type can't
          // be null from just its outside signature.

          msg = "must be initialized inside its custom valid range";
        } else {
          return field_err;
        }
        if (field_err !== undefined) {
          // Most of the time, if the field error is the same as the struct error,
          // the struct error only happens because of the field error.
          if (field_err.message.includes(msg)) {
            field_err.message = `because ${field_err.message}`;
          }
        }
        return InitError.from_String(`\`${display_Ty(ty)}\` ${msg}`).nested_(field_err);
      }
    }
    return field_err;
  }

  /// Return `Some` only if we are sure this type does *not*
  /// allow zero initialization.
  // rustc: compiler/rustc_lint/src/builtin.rs:2452 ty_find_init_error
  function ty_find_init_error(cx: LateContext, ty: Ty, init: InitKind): InitError | undefined {
    const r = cx.tcx.try_normalize_erasing_regions(cx.typing_env(), Unnormalized.new_wip(ty), fold_Ty);
    ty = r.$ === "Ok" ? r._0 : ty;

    const kind = ty.kind();
    // Primitive types that don't like 0 as a value.
    if (kind.$ === "Ref") return InitError.from_str("references must be non-null");
    if (kind.$ === "Adt" && ty.is_box()) return InitError.from_str("`Box` must be non-null");
    if (kind.$ === "FnPtr") return InitError.from_str("function pointers must be non-null");
    if (kind.$ === "Never") return InitError.from_str("the `!` type has no valid value");
    if (kind.$ === "RawPtr" && kind._0.kind().$ === "Dynamic") {
      // raw ptr to dyn Trait
      return InitError.from_str("the vtable of a wide raw pointer must be non-null");
    }
    // Primitive types with other constraints.
    if (kind.$ === "Bool" && init === "Uninit") return InitError.from_str("booleans must be either `true` or `false`");
    if (kind.$ === "Char" && init === "Uninit") return InitError.from_str("characters must be a valid Unicode codepoint");
    if ((kind.$ === "Int" || kind.$ === "Uint") && init === "Uninit") return InitError.from_str("integers must be initialized");
    if (kind.$ === "Float" && init === "Uninit") return InitError.from_str("floats must be initialized");
    if (kind.$ === "RawPtr" && init === "Uninit") return InitError.from_str("raw pointers must be initialized");
    // Recurse and checks for some compound types. (but not unions)
    if (kind.$ === "Adt" && !kind._0.is_union()) {
      const [adt_def, args] = [kind._0, kind._1];
      // Handle structs.
      if (adt_def.is_struct()) {
        return variant_find_init_error(cx, ty, adt_def.non_enum_variant(), args, "struct field", init);
      }
      // And now, enums.
      const span = cx.tcx.def_span(adt_def.did());
      const potential_variants = (function* (): Generator<[VariantDef, boolean]> {
        for (const variant of adt_def.variants()) {
          // `variant.inhabited_predicate(cx.tcx).instantiate(cx.tcx, args).apply_any_module(cx.tcx, cx.typing_env())`
          void variant;
          return unported("rustc_middle::ty::inhabitedness VariantDef::inhabited_predicate (not ported)");
        }
      })();
      const first = potential_variants.next();
      if (first.done === true) {
        return InitError.from_str("enums with no inhabited variants have no valid value").spanned(span);
      }
      const first_variant = first.value;
      // So we have at least one potentially inhabited variant. Might we have two?
      const second = potential_variants.next();
      if (second.done === true) {
        // There is only one potentially inhabited variant. So we can recursively
        // check that variant!
        return variant_find_init_error(cx, ty, first_variant[0], args, "field of the only potentially inhabited enum variant", init);
      }
      const second_variant = second.value;
      // So we have at least two potentially inhabited variants. If we can prove that
      // we have at least two *definitely* inhabited variants, then we have a tag and
      // hence leaving this uninit is definitely disallowed. (Leaving it zeroed could
      // be okay, depending on which variant is encoded as zero tag.)
      if (init === "Uninit") {
        let definitely_inhabited = Number(first_variant[1]) + Number(second_variant[1]);
        for (const [_variant, d] of potential_variants) if (d) definitely_inhabited++;
        if (definitely_inhabited > 1) {
          return InitError.from_str("enums with multiple inhabited variants have to be initialized to a variant").spanned(span);
        }
      }
      // We couldn't find anything wrong here.
      return undefined;
    }
    if (kind.$ === "Tuple") {
      // Proceed recursively, check all fields.
      for (const field of ty.tuple_fields()) {
        const e = ty_find_init_error(cx, field, init);
        if (e !== undefined) return e;
      }
      return undefined;
    }
    if (kind.$ === "Array") {
      const [ty_, len] = [kind._0, kind._1];
      const v = len.try_to_target_usize(cx.tcx);
      if (v !== undefined && v > 0) {
        // Array length known at array non-empty -- recurse.
        return ty_find_init_error(cx, ty_, init);
      } else {
        // Empty array or size unknown.
        return undefined;
      }
    }
    // Conservative fallback.
    return undefined;
  }

  const init = is_dangerous_init(cx, expr);
  if (init !== undefined) {
    // This conjures an instance of a type out of nothing,
    // using zeroed or uninitialized memory.
    // We are extremely conservative with what we warn about.
    const conjured_ty = cx.typeck_results_().expr_ty(expr);
    const err = with_no_trimmed_paths(() => ty_find_init_error(cx, conjured_ty, init));
    if (err !== undefined) {
      let msg_: DiagMessage;
      switch (init) {
        case "Zeroed":
          msg_ = msg("the type `{$ty}` does not permit zero-initialization");
          break;
        case "Uninit":
          msg_ = msg("the type `{$ty}` does not permit being left uninitialized");
          break;
      }
      const sub: BuiltinUnpermittedTypeInitSub = { err };
      cx.emit_span_lint(
        INVALID_VALUE,
        expr.span,
        BuiltinUnpermittedTypeInit_diagnostic({
          msg: msg_,
          ty: conjured_ty,
          label: expr.span,
          sub,
          tcx: cx.tcx,
        }),
      );
    }
  }
};

// ---- DerefNullPtr (builtin.rs:2604-2703) ----

declare module "./builtin.lints.gen.ts" {
  interface DerefNullPtr extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for DerefNullPtr
// rustc: compiler/rustc_lint/src/builtin.rs:2637 check_expr
DerefNullPtr.prototype.check_expr = function (this: DerefNullPtr, cx: LateContext, expr: hir.Expr): void {
  /// test if expression is a null ptr
  // rustc: compiler/rustc_lint/src/builtin.rs:2639 is_null_ptr
  function is_null_ptr(cx: LateContext, expr: hir.Expr): boolean {
    const pointer_ty = cx.typeck_results_().expr_ty(expr);
    const pk = pointer_ty.kind();
    if (pk.$ !== "RawPtr") {
      return false;
    }
    const pointee = pk._0;
    const layout = cx.tcx.layout_of(cx.typing_env().as_query_input(pointee));
    if (layout.$ === "Ok") {
      if (layout._0.layout.size().raw === Size.ZERO.raw) {
        return false;
      }
    }

    switch (expr.kind.$) {
      case "Cast": {
        const [expr_, ty] = [expr.kind._0, expr.kind._1];
        if (ty.kind.$ === "Ptr") {
          return is_zero(expr_) || is_null_ptr(cx, expr_);
        }
        break;
      }
      // check for call to `core::ptr::null` or `core::ptr::null_mut`
      case "Call": {
        const path = expr.kind._0;
        if (path.kind.$ === "Path") {
          const def_id = Res.opt_def_id(cx.qpath_res(path.kind._0, path.hir_id));
          if (def_id !== undefined) {
            const name = cx.tcx.get_diagnostic_name(def_id);
            return name === sym.ptr_null || name === sym.ptr_null_mut;
          }
        }
        break;
      }
      default:
        break;
    }
    return false;
  }

  /// test if expression is the literal `0`
  // rustc: compiler/rustc_lint/src/builtin.rs:2673 is_zero
  function is_zero(expr: hir.Expr): boolean {
    switch (expr.kind.$) {
      case "Lit": {
        const lit = expr.kind._0;
        if (lit.node.$ === "Int") {
          return lit.node._0 === 0n;
        }
        break;
      }
      default:
        break;
    }
    return false;
  }

  if (expr.kind.$ === "Unary" && expr.kind._0 === "Deref" && is_null_ptr(cx, expr.kind._1)) {
    const parent = cx.tcx.parent_hir_node(expr.hir_id);
    if (parent.$ === "Expr" && parent._0.kind.$ === "AddrOf" && parent._0.kind._0 === "Raw") {
      // `&raw *NULL` is ok.
    } else {
      cx.emit_span_lint(DEREF_NULLPTR, expr.span, BuiltinDerefNullptr_diagnostic({ label: expr.span }));
    }
  }
};

// ---- AsmLabels (builtin.rs:2705-3037) ----

declare module "./builtin.lints.gen.ts" {
  interface AsmLabels extends LateLintPass {}
}

// #[derive(Debug, Clone, Copy, PartialEq, Eq)]
type AsmLabelKind = "Named" | "FormatArg" | "Binary";

/// Checks if a potential label is actually a Hexagon register span notation.
///
/// Hexagon assembly uses register span notation like `r1:0`, `V5:4.w`, `p1:0` etc.
/// These follow the pattern: `[letter][digit(s)]:[digit(s)][optional_suffix]`
///
/// Returns `true` if the string matches a valid Hexagon register span pattern.
// rustc: compiler/rustc_lint/src/builtin.rs:2805 is_hexagon_register_span
export function is_hexagon_register_span(possible_label: Str): boolean {
  // Extract the full register span from the context
  const colon_idx = possible_label.find(":");
  if (colon_idx !== undefined) {
    const after_colon = possible_label.slice(colon_idx + 1);
    return is_hexagon_register_span_impl(possible_label.slice(0, colon_idx), after_colon);
  } else {
    return false;
  }
}

/// Helper function for use within the lint when we have statement context.
// rustc: compiler/rustc_lint/src/builtin.rs:2816 is_hexagon_register_span_context
function is_hexagon_register_span_context(possible_label: Str, statement: Str, colon_idx: number): boolean {
  // Extract what comes after the colon in the statement
  const after_colon_start = colon_idx + 1;
  if (after_colon_start >= statement.len()) {
    return false;
  }

  // Get the part after the colon, up to the next whitespace or special character
  const after_colon_full = statement.slice(after_colon_start);
  let after_colon_ = "";
  const chars = after_colon_full.chars();
  for (let c = chars.next(); c !== undefined && (is_ascii_alphanumeric(c) || c === C_DOT); c = chars.next()) {
    after_colon_ += String.fromCodePoint(c);
  }

  return is_hexagon_register_span_impl(possible_label, Str.from(after_colon_));
}

/// Core implementation for checking hexagon register spans.
// rustc: compiler/rustc_lint/src/builtin.rs:2838 is_hexagon_register_span_impl
function is_hexagon_register_span_impl(before_colon: Str, after_colon: Str): boolean {
  if (before_colon.len() < 1 || after_colon.is_empty()) {
    return false;
  }

  const chars = before_colon.chars();
  const start = unwrap(chars.next());

  // Must start with a letter (r, V, p, etc.)
  if (!is_ascii_alphabetic(start)) {
    return false;
  }

  const rest = before_colon.slice(1);

  // Check if the part after the first letter is all digits and non-empty
  if (rest.is_empty() || !all_chars(rest, is_ascii_digit)) {
    return false;
  }

  // Check if after colon starts with digits (may have suffix like .w, .h)
  let digits_after = "";
  const ac = after_colon.chars();
  for (let c = ac.next(); c !== undefined && is_ascii_digit(c); c = ac.next()) {
    digits_after += String.fromCodePoint(c);
  }

  return !(digits_after.length === 0);
}

/** `s.chars().all(pred)` */
function all_chars(s: Str, pred: (c: number) => boolean): boolean {
  const chars = s.chars();
  for (let c = chars.next(); c !== undefined; c = chars.next()) {
    if (!pred(c)) return false;
  }
  return true;
}

const C_DOT = 0x2e; // '.'
const C_COLON = 0x3a; // ':'
const C_LBRACE = 0x7b; // '{'
const C_RBRACE = 0x7d; // '}'
const C_UNDERSCORE = 0x5f; // '_'
const C_DOLLAR = 0x24; // '$'
const C_0 = 0x30; // '0'
const C_1 = 0x31; // '1'

// impl<'tcx> LateLintPass<'tcx> for AsmLabels
// rustc: compiler/rustc_lint/src/builtin.rs:2865 check_expr
AsmLabels.prototype.check_expr = function (this: AsmLabels, cx: LateContext, expr: hir.Expr): void {
  if (expr.kind.$ === "InlineAsm" && (expr.kind._0.asm_macro === "Asm" || expr.kind._0.asm_macro === "NakedAsm")) {
    const { asm_macro, template_strs, options } = expr.kind._0;
    // Non-generic naked functions are allowed to define arbitrary
    // labels.
    if (asm_macro === "NakedAsm") {
      const def_id = expr.hir_id.owner.def_id;
      if (!(cx.tcx.generics_of(LocalDefId.to_def_id(def_id)) as Generics).requires_monomorphization(cx.tcx)) {
        return;
      }
    }

    // asm with `options(raw)` does not do replacement with `{` and `}`.
    const raw = InlineAsmOptions.contains(options, InlineAsmOptions.RAW);

    for (const [template_sym, template_snippet, template_span] of template_strs) {
      const template_str = Str.from(Symbol.as_str(template_sym));
      const find_label_span = (needle: Str): Span | undefined => {
        if (template_snippet !== undefined) {
          const snippet = Str.from(Symbol.as_str(template_snippet));
          const pos = snippet.find(needle.toString());
          if (pos !== undefined) {
            const rest = snippet.slice(pos);
            const end = pos + (str_find_char(rest, C_COLON) ?? rest.len() - 1);
            const inner = new InnerSpan(pos, end);
            return Span.from_inner(template_span, inner);
          }
        }

        return undefined;
      };

      // diagnostics are emitted per-template, so this is created here as opposed to the outer loop
      const spans: [Span | undefined, AsmLabelKind][] = [];

      // A semicolon might not actually be specified as a separator for all targets, but
      // it seems like LLVM accepts it always.
      const statements = split_newline_semicolon(template_str);
      for (let statement of statements) {
        // If there's a comment, trim it from the statement
        const idx = statement.find("//");
        statement = idx === undefined ? statement : statement.slice(0, idx);

        // In this loop, if there is ever a non-label, no labels can come after it.
        let start_idx = 0;
        label_loop: for (const idx of match_indices_byte(statement, C_COLON)) {
          const possible_label = str_trim_end(str_trim_start(statement.slice(start_idx, idx)));
          const chars = possible_label.chars();

          const start = chars.next();
          if (start === undefined) {
            // Empty string means a leading ':' in this section, which is not a
            // label.
            break label_loop;
          }

          // Whether a { bracket has been seen and its } hasn't been found yet.
          let in_bracket = false;
          let label_kind: AsmLabelKind = "Named";

          // A label can also start with a format arg, if it's not a raw asm block.
          if (!raw && start === C_LBRACE) {
            in_bracket = true;
            label_kind = "FormatArg";
          } else if (start === C_0 || start === C_1) {
            // Binary labels have only the characters `0` or `1`.
            label_kind = "Binary";
          } else if (!(is_ascii_alphabetic(start) || start === C_DOT || start === C_UNDERSCORE)) {
            // Named labels start with ASCII letters, `.` or `_`.
            // anything else is not a label
            break label_loop;
          }

          // Check for Hexagon register span notation (e.g., "r1:0", "V5:4", "V3:2.w")
          // This is valid Hexagon assembly syntax, not a label
          if (cx.tcx.sess.asm_arch === "Hexagon" && is_hexagon_register_span_context(possible_label, statement, idx)) {
            break label_loop;
          }

          for (let c = chars.next(); c !== undefined; c = chars.next()) {
            // Inside a template format arg, any character is permitted for the
            // purposes of label detection because we assume that it can be
            // replaced with some other valid label string later. `options(raw)`
            // asm blocks cannot have format args, so they are excluded from this
            // special case.
            if (!raw && in_bracket) {
              if (c === C_LBRACE) {
                // Nested brackets are not allowed in format args, this cannot
                // be a label.
                break label_loop;
              }

              if (c === C_RBRACE) {
                // The end of the format arg.
                in_bracket = false;
              }
            } else if (!raw && c === C_LBRACE) {
              // Start of a format arg.
              in_bracket = true;
              label_kind = "FormatArg";
            } else {
              let can_continue: boolean;
              switch (label_kind) {
                // Format arg labels are considered to be named labels for the purposes
                // of continuing outside of their {} pair.
                case "Named":
                case "FormatArg":
                  can_continue = is_ascii_alphanumeric(c) || c === C_UNDERSCORE || c === C_DOLLAR;
                  break;
                case "Binary":
                  can_continue = c === C_0 || c === C_1;
                  break;
              }

              if (!can_continue) {
                // The potential label had an invalid character inside it, it
                // cannot be a label.
                break label_loop;
              }
            }
          }

          // If all characters passed the label checks, this is a label.
          spans.push([find_label_span(possible_label), label_kind]);
          start_idx = idx + 1;
        }
      }

      for (const [span_, label_kind] of spans) {
        const missing_precise_span = span_ === undefined;
        const span = span_ ?? template_span;
        switch (label_kind) {
          case "Named":
            cx.emit_span_lint(NAMED_ASM_LABELS, span, InvalidAsmLabel_diagnostic({ $: "Named", missing_precise_span }));
            break;
          case "FormatArg":
            cx.emit_span_lint(NAMED_ASM_LABELS, span, InvalidAsmLabel_diagnostic({ $: "FormatArg", missing_precise_span }));
            break;
          // the binary asm issue only occurs when using intel syntax on x86 targets
          case "Binary":
            if (
              !InlineAsmOptions.contains(options, InlineAsmOptions.ATT_SYNTAX) &&
              (cx.tcx.sess.asm_arch === "X86" || cx.tcx.sess.asm_arch === "X86_64" || cx.tcx.sess.asm_arch === undefined)
            ) {
              cx.emit_span_lint(BINARY_ASM_LABELS, span, InvalidAsmLabel_diagnostic({ $: "Binary", missing_precise_span, span }));
            }
            // No lint on anything other than x86
            break;
        }
      }
    }
  }
};

/** `s.split(|c| matches!(c, '\n' | ';'))` (both are ASCII, so splitting the bytes is exact). */
function split_newline_semicolon(s: Str): Str[] {
  const out: Str[] = [];
  let start = 0;
  for (let i = 0; i < s.len(); i++) {
    const b = s.byte(i);
    if (b === 0x0a || b === 0x3b) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** The byte indices of `s.match_indices(c)` for an ASCII `c`. */
function match_indices_byte(s: Str, c: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.len(); i++) if (s.byte(i) === c) out.push(i);
  return out;
}

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

// ---- InternalEqTraitMethodImpls (builtin.rs:3120-3175) ----

declare module "./builtin.lints.gen.ts" {
  interface InternalEqTraitMethodImpls extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for InternalEqTraitMethodImpls
// rustc: compiler/rustc_lint/src/builtin.rs:3163 check_impl_item
InternalEqTraitMethodImpls.prototype.check_impl_item = function (this: InternalEqTraitMethodImpls, cx: LateContext, item: hir.ImplItem): void {
  if (
    item.impl_kind.$ === "Trait" &&
    item.impl_kind.trait_item_def_id.$ === "Ok" &&
    cx.tcx.is_diagnostic_item(sym.assert_receiver_is_total_eq, item.impl_kind.trait_item_def_id._0)
  ) {
    cx.emit_span_lint(INTERNAL_EQ_TRAIT_METHOD_IMPLS, item.span, EqInternalMethodImplemented_diagnostic({}));
  }
};
