// Stub of compiler/rustc_lint/src/builtin.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (builtin.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { ast, NodeId } from "../rustc_ast/lib.ts";
import { UnusedDocComment } from "../rustc_lint_defs/builtin.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import type { Lint } from "../rustc_lint_defs/lib.ts";
import { type Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Ident, kw, Symbol } from "../rustc_span/symbol.ts";
import type { EarlyContext } from "./context.ts";
import { BuiltinKeywordIdents_diagnostic } from "./diagnostics.ts";
import type { EarlyLintPass } from "./passes.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { WhileTrue, NonShorthandFieldPatterns, UnsafeCode, MissingCopyImplementations, AnonymousParameters, InvalidNoMangleItems, MutableTransmutes, UnstableFeatures, UngatedAsyncFnTrackCaller, UnreachablePub, TypeAliasBounds, TrivialConstraints, DoubleNegations, KeywordIdents, ExplicitOutlivesRequirements, IncompleteInternalFeatures, InvalidValue, DerefNullPtr, AsmLabels, SpecialModuleName, InternalEqTraitMethodImpls, MissingDoc_impl_lint_pass, MissingDebugImplementations_impl_lint_pass, EllipsisInclusiveRangePatterns_impl_lint_pass, KEYWORD_IDENTS_2018, KEYWORD_IDENTS_2024 } from "./builtin.lints.gen.ts";

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

// impl EarlyLintPass for WhileTrue (builtin.rs:90)
unported_methods(WhileTrue.prototype, "rustc_lint::builtin::WhileTrue", ["check_expr"]);
// impl LateLintPass for NonShorthandFieldPatterns (builtin.rs:150)
unported_methods(NonShorthandFieldPatterns.prototype, "rustc_lint::builtin::NonShorthandFieldPatterns", ["check_pat"]);
// impl EarlyLintPass for UnsafeCode (builtin.rs:207)
unported_methods(UnsafeCode.prototype, "rustc_lint::builtin::UnsafeCode", ["check_expr", "check_item", "check_fn"]);
// impl LateLintPass for MissingDoc (builtin.rs:351)
unported_methods(MissingDoc.prototype, "rustc_lint::builtin::MissingDoc", ["check_crate", "check_item", "check_trait_item", "check_impl_item", "check_foreign_item", "check_field_def", "check_variant"]);
// impl LateLintPass for MissingCopyImplementations (builtin.rs:459)
unported_methods(MissingCopyImplementations.prototype, "rustc_lint::builtin::MissingCopyImplementations", ["check_item"]);
// impl LateLintPass for MissingDebugImplementations (builtin.rs:603)
unported_methods(MissingDebugImplementations.prototype, "rustc_lint::builtin::MissingDebugImplementations", ["check_item"]);
// impl EarlyLintPass for AnonymousParameters (builtin.rs:715)
unported_methods(AnonymousParameters.prototype, "rustc_lint::builtin::AnonymousParameters", ["check_trait_item"]);
// impl EarlyLintPass for UnusedDocComment (builtin.rs:786)
unported_methods(UnusedDocComment.prototype, "rustc_lint::builtin::UnusedDocComment", ["check_stmt", "check_arm", "check_pat", "check_expr", "check_generic_param", "check_block", "check_item"]);
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
// impl EarlyLintPass for DoubleNegations (builtin.rs:1480)
unported_methods(DoubleNegations.prototype, "rustc_lint::builtin::DoubleNegations", ["check_expr"]);
// impl EarlyLintPass for EllipsisInclusiveRangePatterns (builtin.rs:1570)
unported_methods(EllipsisInclusiveRangePatterns.prototype, "rustc_lint::builtin::EllipsisInclusiveRangePatterns", ["check_pat", "check_pat_post"]);
// impl LateLintPass for ExplicitOutlivesRequirements (builtin.rs:1975)
unported_methods(ExplicitOutlivesRequirements.prototype, "rustc_lint::builtin::ExplicitOutlivesRequirements", ["check_item"]);
// impl EarlyLintPass for IncompleteInternalFeatures (builtin.rs:2237)
unported_methods(IncompleteInternalFeatures.prototype, "rustc_lint::builtin::IncompleteInternalFeatures", ["check_crate"]);
// impl LateLintPass for InvalidValue (builtin.rs:2334)
unported_methods(InvalidValue.prototype, "rustc_lint::builtin::InvalidValue", ["check_expr"]);
// impl LateLintPass for DerefNullPtr (builtin.rs:2636)
unported_methods(DerefNullPtr.prototype, "rustc_lint::builtin::DerefNullPtr", ["check_expr"]);
// impl LateLintPass for AsmLabels (builtin.rs:2864)
unported_methods(AsmLabels.prototype, "rustc_lint::builtin::AsmLabels", ["check_expr"]);
// impl EarlyLintPass for SpecialModuleName (builtin.rs:3087)
unported_methods(SpecialModuleName.prototype, "rustc_lint::builtin::SpecialModuleName", ["check_crate"]);
// impl LateLintPass for InternalEqTraitMethodImpls (builtin.rs:3162)
unported_methods(InternalEqTraitMethodImpls.prototype, "rustc_lint::builtin::InternalEqTraitMethodImpls", ["check_impl_item"]);

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
