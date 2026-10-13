// STUB for compiler/rustc_expand/src/mbe/macro_rules.rs (owned by lane mbe-b; replace freely).
// Published by lane expand-base with only the signatures base.ts uses, so the crate type-checks before
// mbe-b lands. No markers here: every body is `unported`. mbe-b: keep the export names and shapes (or
// update the callers in base.ts when you merge), then port the file in place.
//
// Load order: base.ts imports this module for `ParserAnyMacro.from_tts` (used only inside a fn body).
// Top-level code here must not read base.ts values (no `extends MacResult_provided`): `ParserAnyMacro`
// overrides every `MacResult` method (expand.rs `ast_fragments!`), so it `implements MacResult`.
import type { TokenStream } from "../../rustc_ast/tokenstream.ts";
import type { MacroKinds } from "../../rustc_hir/def.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";
import type { AttrProcMacro, ExtCtxt, MacResult, TTMacroExpander } from "../base.ts";

const STUB = "(stub published by expand-base; lane mbe-b)";

// PORT: `MacroRulesMacroExpander` implements both `TTMacroExpander` and `AttrProcMacro`, whose methods are
// both named `expand`; a TS class cannot carry both, so each trait impl is a view object
// (`as_TTMacroExpander()` / `as_AttrProcMacro()`), which `SyntaxExtensionKind::as_legacy_bang/as_attr` return.
export class MacroRulesMacroExpander {
  kinds(): MacroKinds {
    return unported(`rustc_expand::mbe::macro_rules::MacroRulesMacroExpander::kinds ${STUB}`);
  }
  /** `impl TTMacroExpander for MacroRulesMacroExpander` */
  as_TTMacroExpander(): TTMacroExpander {
    return unported(`rustc_expand::mbe::macro_rules::MacroRulesMacroExpander as TTMacroExpander ${STUB}`);
  }
  /** `impl AttrProcMacro for MacroRulesMacroExpander` */
  as_AttrProcMacro(): AttrProcMacro {
    return unported(`rustc_expand::mbe::macro_rules::MacroRulesMacroExpander as AttrProcMacro ${STUB}`);
  }
}

export abstract class ParserAnyMacro implements MacResult {
  // PORT(stub): `bindings: &[MacroRule]`, `matched_rule_bindings: &[MatcherLoc]` (mbe types).
  static from_tts(
    _cx: ExtCtxt,
    _tts: TokenStream,
    _site_span: Span,
    _arm_span: Span,
    _is_local: boolean,
    _macro_ident: Ident,
    _bindings: readonly unknown[],
    _matched_rule_bindings: readonly unknown[],
  ): MacResult {
    return unported(`rustc_expand::mbe::macro_rules::ParserAnyMacro::from_tts ${STUB}`);
  }
  abstract make_expr: MacResult["make_expr"];
  abstract make_items: MacResult["make_items"];
  abstract make_impl_items: MacResult["make_impl_items"];
  abstract make_trait_impl_items: MacResult["make_trait_impl_items"];
  abstract make_trait_items: MacResult["make_trait_items"];
  abstract make_foreign_items: MacResult["make_foreign_items"];
  abstract make_pat: MacResult["make_pat"];
  abstract make_stmts: MacResult["make_stmts"];
  abstract make_ty: MacResult["make_ty"];
  abstract make_arms: MacResult["make_arms"];
  abstract make_expr_fields: MacResult["make_expr_fields"];
  abstract make_pat_fields: MacResult["make_pat_fields"];
  abstract make_generic_params: MacResult["make_generic_params"];
  abstract make_params: MacResult["make_params"];
  abstract make_field_defs: MacResult["make_field_defs"];
  abstract make_variants: MacResult["make_variants"];
  abstract make_where_predicates: MacResult["make_where_predicates"];
  abstract make_crate: MacResult["make_crate"];
}
