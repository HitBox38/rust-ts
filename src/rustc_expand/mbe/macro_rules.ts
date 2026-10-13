// Port of compiler/rustc_expand/src/mbe/macro_rules.rs
//
// PORT: types are hand-written (rustc_expand has no codegen set for this file); none derives Debug
// except `WhichMatcher` (a string union) and `TtHandle` (unused Debug, not ported).
//
// PORT: trait representations (shared contract with lanes expand-base / expand-core):
// - `MacroRulesMacroExpander` implements both `TTMacroExpander` and `AttrProcMacro`, whose methods are
//   both named `expand`; a TS class cannot carry both, so each trait impl is a view object
//   (`as_TTMacroExpander()` / `as_AttrProcMacro()`), which `SyntaxExtensionKind::as_legacy_bang/as_attr`
//   (base.ts) return.
// - `impl MacResult for ParserAnyMacro` lives in expand.rs (`ast_fragments!`); expand.ts exports it as the
//   table `ParserAnyMacro_MacResult`, and `ParserAnyMacro`'s `make_*` methods below call into it at call
//   time (never at module load: base.ts -> macro_rules.ts -> expand.ts -> base.ts is an import cycle).
// - `Tracker<'matcher>`: the generic `T: Tracker` is erased, so the associated fns `description()` and
//   `recovery()` are methods of the tracker object (`T::recovery()` -> `track.recovery()`).
//
// Load order: base.ts imports this module (for `ParserAnyMacro.from_tts`); top-level code here reads no
// base.ts / expand.ts / diagnostics.ts values.

import "../../rustc_parse/lib.ts";
import { ast, token, tokenstream } from "../../rustc_ast/lib.ts";
import type { NonterminalKind, Token, TokenKind } from "../../rustc_ast/token.ts";
import type { DelimSpan, TokenStream } from "../../rustc_ast/tokenstream.ts";
import { CRATE_NODE_ID, DUMMY_NODE_ID, type NodeId } from "../../rustc_ast/node_id.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import type { Attribute as attrs_Attribute } from "../../rustc_attr_ir/lib.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { Directive } from "../../rustc_attr_ir/diagnostic.ts";
import { Applicability, type Diag, type ErrorGuaranteed, MultiSpan } from "../../rustc_errors/lib.ts";
import type { Diagnostic } from "../../rustc_errors/diagnostic.ts";
import type { Features } from "../../rustc_feature/lib.ts";
import { MacroKinds } from "../../rustc_hir/def.ts";
import { builtin } from "../../rustc_lint_defs/lib.ts";
import { MACRO_ARGUMENTS } from "../../rustc_parse/lib.ts";
import { Parser, type Recovery } from "../../rustc_parse/parser/mod.ts";
import { exp } from "../../rustc_parse/parser/token_type.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import type { Session } from "../../rustc_session/lib.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { Transparency } from "../../rustc_span/hygiene.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type {
  AttrProcMacro,
  BangProcMacro,
  ExtCtxt,
  MacResult,
  MacroExpanderResult,
  SyntaxExtension as SyntaxExtensionT,
  SyntaxExtensionKind,
  TTMacroExpander,
} from "../base.ts";
import { DummyResult, SyntaxExtension } from "../base.ts";
import { type AstFragment, AstFragmentKind, ensure_complete_parse, parse_ast_fragment, ParserAnyMacro_MacResult } from "../expand.ts";
import * as mbe from "../mbe.ts";
import type { SequenceRepetition } from "../mbe.ts";
import { emit_frag_parse_err, FailedMacro, failed_to_match_macro } from "./diagnostics.ts";
import { check_meta_variables } from "./macro_check.ts";
import { compute_locs, CowParser, type MatcherLoc, type NamedMatches, type NamedParseResult, TtParser } from "./macro_parser.ts";
import type { MetaVarExprConcatElem } from "./metavar_expr.ts";
import { parse_one_tt } from "./quoted.ts";
import { transcribe } from "./transcribe.ts";

const { Delimiter, Token: Token_, TokenKind: TokenKind_, display_NonterminalKind } = token;

// ---------------------------------------------------------------------------------------------
// PORT: pending expand-base/expand-core: `crate::diagnostics` (compiler/rustc_expand/src/diagnostics.rs,
// generated into src/rustc_expand/diagnostics.gen.ts). Until it lands, these stand-ins have the generated
// shapes (field interfaces + `<T>_diagnostic`) and stop with `unported` when the diagnostic is built.
// Replace this block with imports from "../diagnostics.ts".
interface TrailingMacro {
  is_trailing: boolean;
  name: Ident;
}
function TrailingMacro_diagnostic(_self: TrailingMacro): Diagnostic {
  return { into_diag: () => unported("rustc_expand::diagnostics::TrailingMacro") };
}
interface MacroArgsBadDelim {
  span: Span;
  sugg: MacroArgsBadDelimSugg;
  rule_kw: Symbol;
}
interface MacroArgsBadDelimSugg {
  open: Span;
  close: Span;
}
function MacroArgsBadDelim_diagnostic(_self: MacroArgsBadDelim): Diagnostic {
  return { into_diag: () => unported("rustc_expand::diagnostics::MacroArgsBadDelim") };
}
interface OrPatternsBackCompat {
  span: Span;
  suggestion: string;
}
function OrPatternsBackCompat_diagnostic(_self: OrPatternsBackCompat): Diagnostic {
  return { into_diag: () => unported("rustc_expand::diagnostics::OrPatternsBackCompat") };
}
// ---------------------------------------------------------------------------------------------

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:48 ParserAnyMacro
export class ParserAnyMacro implements MacResult {
  constructor(
    public parser: Parser,

    /// Span of the expansion site of the macro this parser is for
    public site_span: Span,
    /// The ident of the macro we're parsing
    public macro_ident: Ident,
    public lint_node_id: NodeId,
    public is_trailing_mac: boolean,
    public arm_span: Span,
    /// Whether or not this macro is defined in the current crate
    public is_local: boolean,
    public bindings: readonly MacroRule[],
    public matched_rule_bindings: readonly MatcherLoc[],
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:65 make
  make(kind: AstFragmentKind): AstFragment {
    const { site_span, macro_ident, parser, lint_node_id, arm_span, is_trailing_mac, is_local, bindings, matched_rule_bindings } = this;
    const snapshot = parser.create_snapshot_for_diagnostic();
    const r = parse_ast_fragment(parser, kind);
    let fragment: AstFragment;
    if (r.$ === "Ok") {
      fragment = r._0;
    } else {
      const err = r._0;
      const guar = emit_frag_parse_err(err, parser, snapshot.parser, site_span, arm_span, kind, bindings, matched_rule_bindings);
      return AstFragmentKind.dummy(kind, site_span, guar);
    }

    // We allow semicolons at the end of expressions -- e.g., the semicolon in
    // `macro_rules! m { () => { panic!(); } }` isn't parsed by `.parse_expr()`,
    // but `m!()` is allowed in expression positions (cf. issue #34706).
    if (kind === "Expr" && parser.token.eq(TokenKind_.Semi)) {
      const lint = is_local ? builtin.SEMICOLON_IN_EXPRESSIONS_FROM_MACROS : builtin.SEMICOLON_IN_EXPRESSIONS_FROM_NON_LOCAL_MACROS;
      parser.psess.buffer_lint(lint, parser.token.span, lint_node_id, TrailingMacro_diagnostic({ is_trailing: is_trailing_mac, name: macro_ident }));
      parser.bump();
    }

    // Make sure we don't have any tokens left to parse so we don't silently drop anything.
    const path = ast.Path.from_ident(macro_ident.with_span_pos(site_span));
    ensure_complete_parse(parser, path, AstFragmentKind.name(kind), site_span);
    return fragment;
  }

  // #[instrument(skip(cx, tts, bindings, matched_rule_bindings))]
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:123 from_tts
  static from_tts(
    cx: ExtCtxt,
    tts: TokenStream,
    site_span: Span,
    arm_span: Span,
    is_local: boolean,
    macro_ident: Ident,
    // bindings and lhs is for diagnostics
    bindings: readonly MacroRule[],
    matched_rule_bindings: readonly MatcherLoc[],
  ): ParserAnyMacro {
    return new ParserAnyMacro(
      Parser.new(cx.sess.psess, tts, undefined),

      // Pass along the original expansion site and the name of the macro
      // so we can print a useful error message if the parse of the expanded
      // macro leaves unparsed tokens.
      site_span,
      macro_ident,
      cx.current_expansion.lint_node_id,
      cx.current_expansion.is_trailing_mac,
      arm_span,
      is_local,
      bindings,
      matched_rule_bindings,
    );
  }

  // `impl MacResult for ParserAnyMacro` (expand.rs, `ParserAnyMacro_MacResult` in expand.ts; markers there).
  make_expr(): ReturnType<MacResult["make_expr"]> {
    return ParserAnyMacro_MacResult.make_expr.call(this);
  }
  make_items(): ReturnType<MacResult["make_items"]> {
    return ParserAnyMacro_MacResult.make_items.call(this);
  }
  make_impl_items(): ReturnType<MacResult["make_impl_items"]> {
    return ParserAnyMacro_MacResult.make_impl_items.call(this);
  }
  make_trait_impl_items(): ReturnType<MacResult["make_trait_impl_items"]> {
    return ParserAnyMacro_MacResult.make_trait_impl_items.call(this);
  }
  make_trait_items(): ReturnType<MacResult["make_trait_items"]> {
    return ParserAnyMacro_MacResult.make_trait_items.call(this);
  }
  make_foreign_items(): ReturnType<MacResult["make_foreign_items"]> {
    return ParserAnyMacro_MacResult.make_foreign_items.call(this);
  }
  make_pat(): ReturnType<MacResult["make_pat"]> {
    return ParserAnyMacro_MacResult.make_pat.call(this);
  }
  make_stmts(): ReturnType<MacResult["make_stmts"]> {
    return ParserAnyMacro_MacResult.make_stmts.call(this);
  }
  make_ty(): ReturnType<MacResult["make_ty"]> {
    return ParserAnyMacro_MacResult.make_ty.call(this);
  }
  make_arms(): ReturnType<MacResult["make_arms"]> {
    return ParserAnyMacro_MacResult.make_arms.call(this);
  }
  make_expr_fields(): ReturnType<MacResult["make_expr_fields"]> {
    return ParserAnyMacro_MacResult.make_expr_fields.call(this);
  }
  make_pat_fields(): ReturnType<MacResult["make_pat_fields"]> {
    return ParserAnyMacro_MacResult.make_pat_fields.call(this);
  }
  make_generic_params(): ReturnType<MacResult["make_generic_params"]> {
    return ParserAnyMacro_MacResult.make_generic_params.call(this);
  }
  make_params(): ReturnType<MacResult["make_params"]> {
    return ParserAnyMacro_MacResult.make_params.call(this);
  }
  make_field_defs(): ReturnType<MacResult["make_field_defs"]> {
    return ParserAnyMacro_MacResult.make_field_defs.call(this);
  }
  make_variants(): ReturnType<MacResult["make_variants"]> {
    return ParserAnyMacro_MacResult.make_variants.call(this);
  }
  make_where_predicates(): ReturnType<MacResult["make_where_predicates"]> {
    return ParserAnyMacro_MacResult.make_where_predicates.call(this);
  }
  make_crate(): ReturnType<MacResult["make_crate"]> {
    return ParserAnyMacro_MacResult.make_crate.call(this);
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:152 MacroRule
export type MacroRule =
  /// A function-style rule, for use with `m!()`
  | { readonly $: "Func"; lhs: MatcherLoc[]; lhs_span: Span; rhs: mbe.TokenTree }
  /// An attr rule, for use with `#[m]`
  | {
      readonly $: "Attr";
      unsafe_rule: boolean;
      args: MatcherLoc[];
      args_span: Span;
      body: MatcherLoc[];
      body_span: Span;
      rhs: mbe.TokenTree;
    }
  /// A derive rule, for use with `#[m]`
  | { readonly $: "Derive"; body: MatcherLoc[]; body_span: Span; rhs: mbe.TokenTree };

/// A selection of a matcher in a [`MacroRule`].
///
/// [`MacroRule::Attr`] has two different matchers (args and body). This enum allows distinguishing
/// between them, even when used for other kinds of rules.
///
/// This type implements [`Ord`]. The arms within a rule come in a fixed order and this type is
/// consistent with that ordering.
// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:176 WhichMatcher
export type WhichMatcher =
  /// The arguments of an attr macro ([`MacroRule::Attr::args`]).
  | "Args"
  /// The body of an attr macro ([`MacroRule::Attr::body`]), **or** the only arm of the rule.
  ///
  /// This is also used to express the only arm in a [`MacroRule::Func`] or [`MacroRule::Derive`].
  | "Body";

export const WhichMatcher = {
  Args: "Args",
  Body: "Body",

  /// The [`WhichMatcher`] for [`MacroRule::Func`].
  FOR_FUNC: "Body",

  /// The [`WhichMatcher`] for [`MacroRule::Derive`].
  FOR_DERIVE: "Body",
} as const satisfies Record<string, WhichMatcher>;

/** `#[derive(PartialOrd, Ord)]`: declaration order. */
export const WhichMatcher_discriminant: Record<WhichMatcher, number> = { Args: 0, Body: 1 };
/** `#[derive(Debug)]` */
export const debug_WhichMatcher = (v: WhichMatcher): string => v;

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:194 MacroRulesMacroExpander
export class MacroRulesMacroExpander {
  constructor(
    public node_id: NodeId,
    public name: Ident,
    public span: Span,
    public on_unmatched_args: Directive | undefined,
    public transparency: Transparency,
    public kinds_: MacroKinds,
    public rules: MacroRule[],
    public macro_rules: boolean,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:206 get_unused_rule
  get_unused_rule(rule_i: number): [Ident, MultiSpan] | undefined {
    // If the rhs contains an invocation like `compile_error!`, don't report it as unused.
    const rule = unwrap(this.rules[rule_i]);
    let span: MultiSpan;
    let rhs: mbe.TokenTree;
    switch (rule.$) {
      case "Func":
        [span, rhs] = [MultiSpan.from_span(rule.lhs_span), rule.rhs];
        break;
      case "Attr":
        [span, rhs] = [MultiSpan.from_spans([rule.args_span, rule.body_span]), rule.rhs];
        break;
      case "Derive":
        [span, rhs] = [MultiSpan.from_span(rule.body_span), rule.rhs];
        break;
    }
    if (has_compile_error_macro(rhs)) {
      return undefined;
    } else {
      return [this.name, span];
    }
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:218 kinds
  kinds(): MacroKinds {
    return this.kinds_;
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:222 nrules
  nrules(): number {
    return this.rules.length;
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:226 is_macro_rules
  is_macro_rules(): boolean {
    return this.macro_rules;
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:230 expand_derive
  expand_derive(cx: ExtCtxt, sp: Span, body: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    // This is similar to `expand_macro`, but they have very different signatures, and will
    // diverge further once derives support arguments.
    const name = this.name;
    const rules = this.rules;
    const psess = cx.sess.psess;

    if (cx.trace_macros()) {
      const msg = `expanding \`#[derive(${display_Ident(name)})] ${pprust.tts_to_string(body)}\``;
      trace_macros_note(cx.expansions, sp, msg);
    }

    const r = try_match_macro_derive(psess, body, rules, new NoopTracker());
    if (r.$ === "Ok") {
      const [rule_index, rule, named_matches] = r._0;
      if (rule.$ !== "Derive") {
        return panic("try_match_macro_derive returned non-derive rule");
      }
      const rhs_ = rule.rhs;
      if (rhs_.$ !== "Delimited") {
        return cx.dcx().span_bug(sp, "malformed macro derive rhs");
      }
      const [rhs_span, rhs] = [rhs_._0, rhs_._2];

      const id = cx.current_expansion.id;
      const t = transcribe(psess, named_matches, rhs, rhs_span, this.transparency, id);
      if (t.$ === "Err") return Err(t._0.emit_err());
      const tts = t._0;

      if (cx.trace_macros()) {
        const msg = `to \`${pprust.tts_to_string(tts)}\``;
        trace_macros_note(cx.expansions, sp, msg);
      }

      if (is_defined_in_current_crate(this.node_id)) {
        cx.resolver.record_macro_rule_usage(this.node_id, rule_index);
      }

      return Ok(tts);
    } else if (r._0.$ === "No") {
      return Err(r._0._0);
    } else {
      const [, guar] = failed_to_match_macro(cx.psess(), sp, this.span, name, FailedMacro.Derive, body, rules, this.on_unmatched_args);
      cx.macro_error_and_trace_macros_diag();
      return Err(guar);
    }
  }

  /** `impl TTMacroExpander for MacroRulesMacroExpander` */
  as_TTMacroExpander(): TTMacroExpander {
    const self = this;
    return {
      // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:291 expand
      expand(cx: ExtCtxt, sp: Span, input: TokenStream): MacroExpanderResult {
        return {
          $: "Ready",
          _0: expand_macro(cx, sp, self.span, self.node_id, self.name, self.transparency, input, self.rules, self.on_unmatched_args),
        };
      },
    };
  }

  /** `impl AttrProcMacro for MacroRulesMacroExpander` */
  as_AttrProcMacro(): AttrProcMacro {
    const self = this;
    return {
      // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:312 expand
      expand(_cx: ExtCtxt, _sp: Span, _args: TokenStream, _body: TokenStream): Result<TokenStream, ErrorGuaranteed> {
        return unreachable("`expand` called on `MacroRulesMacroExpander`, expected `expand_with_safety`");
      },

      // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:322 expand_with_safety
      expand_with_safety(cx: ExtCtxt, safety: ast.Safety, sp: Span, args: TokenStream, body: TokenStream): Result<TokenStream, ErrorGuaranteed> {
        return expand_macro_attr(cx, sp, self.span, self.node_id, self.name, self.transparency, safety, args, body, self.rules, self.on_unmatched_args);
      },
    };
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:346 DummyBang
class DummyBang implements BangProcMacro {
  constructor(public _0: ErrorGuaranteed) {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:349 expand
  expand(_: ExtCtxt, _1: Span, _2: TokenStream): Result<TokenStream, ErrorGuaranteed> {
    return Err(this._0);
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:359 trace_macros_note
function trace_macros_note(cx_expansions: Map<Span, string[]>, sp: Span, message: string): void {
  // `sp.macro_backtrace().last().map_or(sp, |trace| trace.call_site)`
  let last: Span | undefined;
  for (const trace of Span.macro_backtrace(sp)) last = trace.call_site;
  sp = last ?? sp;
  let v = cx_expansions.get(sp);
  if (v === undefined) {
    v = [];
    cx_expansions.set(sp, v);
  }
  v.push(message);
}

// rustc-trait: compiler/rustc_expand/src/mbe/macro_rules.rs:364 Tracker
export interface Tracker {
  /// Provide context on the arm that's about to be matched.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:366 prepare
  prepare(which_matcher: WhichMatcher, matcher: readonly MatcherLoc[]): void;

  /// This is called before trying to match next MatcherLoc on the current token.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:369 before_match_loc
  before_match_loc(parser: TtParser, matcher: MatcherLoc): void;

  /// A [`MatcherLoc`] successfully consumed input from the parser.
  ///
  /// This is called for [`MatcherLoc::Token`] and [`MatcherLoc::SequenceSep`], which consume
  /// single tokens, when they successfully match [`Parser::token`]. It is also called for
  /// [`MatcherLoc::MetaVarDecl`] when non-terminal parsing is guaranteed to occur (i.e. after
  /// [`Parser::nonterminal_may_begin_with()`] returns `true`).
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:377 matched_one
  matched_one(parser: Parser, loc_index: number): void;

  /// This is called after an arm has been parsed, either successfully or unsuccessfully. When
  /// this is called, `before_match_loc` was called at least once (with a `MatcherLoc::Eof`).
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:381 after_arm
  after_arm(result: NamedParseResult): void;

  /// The arm could not be matched successfully.
  ///
  /// If the parser is located at [`token::Eof`], it indicates an unexpected end of macro
  /// invocation. Otherwise, the parser is located at a token in the middle of the input, and it
  /// indicates that no rules in the arm expected the given token.
  ///
  /// The parser will return [`NamedParseResult::Failure`] after calling this.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:390 failure
  failure(parser: Parser): void;

  /// An ambiguity error occurred.
  ///
  /// The parser will return [`NamedParseResult::Ambiguity`] after calling this.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:395 ambiguity
  ambiguity(parser: Parser): void;

  /// For tracing.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:398 description
  description(): string;

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:400 recovery
  recovery(): Recovery;
}

/// A noop tracker that is used in the hot path of the expansion, has zero overhead thanks to
/// monomorphization.
// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:405 NoopTracker
export class NoopTracker implements Tracker {
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:408 prepare
  prepare(_which_matcher: WhichMatcher, _matcher: readonly MatcherLoc[]): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:410 before_match_loc
  before_match_loc(_parser: TtParser, _matcher: MatcherLoc): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:412 matched_one
  matched_one(_parser: Parser, _loc_index: number): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:414 ambiguity
  ambiguity(_parser: Parser): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:416 after_arm
  after_arm(_result: NamedParseResult): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:418 failure
  failure(_parser: Parser): void {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:420 description
  description(): string {
    return "none";
  }

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:424 recovery
  recovery(): Recovery {
    return "Forbidden";
  }
}

/// Expands the rules based macro defined by `rules` for a given input `arg`.
// #[instrument(skip(cx, transparency, arg, rules, on_unmatched_args))]
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:431 expand_macro
function expand_macro(
  cx: ExtCtxt,
  sp: Span,
  def_span: Span,
  node_id: NodeId,
  name: Ident,
  transparency: Transparency,
  arg: TokenStream,
  rules: readonly MacroRule[],
  on_unmatched_args: Directive | undefined,
): MacResult {
  const psess = cx.sess.psess;

  if (cx.trace_macros()) {
    const msg = `expanding \`${display_Ident(name)}! { ${pprust.tts_to_string(arg)} }\``;
    trace_macros_note(cx.expansions, sp, msg);
  }

  // Track nothing for the best performance.
  const try_success_result = try_match_macro(psess, arg, rules, new NoopTracker());

  if (try_success_result.$ === "Ok") {
    const [rule_index, rule, named_matches] = try_success_result._0;
    if (rule.$ !== "Func") {
      return panic("try_match_macro returned non-func rule");
    }
    const { lhs, rhs: rhs_ } = rule;
    if (rhs_.$ !== "Delimited") {
      return cx.dcx().span_bug(sp, "malformed macro rhs");
    }
    const [rhs_span, rhs] = [rhs_._0, rhs_._2];
    const arm_span = rhs_span.entire();

    // rhs has holes ( `$id` and `$(...)` that need filled)
    const id = cx.current_expansion.id;
    const t = transcribe(psess, named_matches, rhs, rhs_span, transparency, id);
    let tts: TokenStream;
    if (t.$ === "Ok") {
      tts = t._0;
    } else {
      const guar = t._0.emit_err();
      return DummyResult.any(arm_span, guar);
    }

    if (cx.trace_macros()) {
      const msg = `to \`${pprust.tts_to_string(tts)}\``;
      trace_macros_note(cx.expansions, sp, msg);
    }

    const is_local = is_defined_in_current_crate(node_id);
    if (is_local) {
      cx.resolver.record_macro_rule_usage(node_id, rule_index);
    }

    // Let the context choose how to interpret the result. Weird, but useful for X-macros.
    return ParserAnyMacro.from_tts(cx, tts, sp, arm_span, is_local, name, rules, lhs);
  } else if (try_success_result._0.$ === "No") {
    const guar = try_success_result._0._0;
    // debug!("Will not retry matching as an error was emitted already");
    return DummyResult.any(sp, guar);
  } else {
    // Retry and emit a better error.
    const [span, guar] = failed_to_match_macro(cx.psess(), sp, def_span, name, FailedMacro.Func, arg, rules, on_unmatched_args);
    cx.macro_error_and_trace_macros_diag();
    return DummyResult.any(span, guar);
  }
}

/// Expands the rules based macro defined by `rules` for a given attribute `args` and `body`.
// #[instrument(skip(cx, transparency, args, body, rules, on_unmatched_args))]
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:509 expand_macro_attr
function expand_macro_attr(
  cx: ExtCtxt,
  sp: Span,
  def_span: Span,
  node_id: NodeId,
  name: Ident,
  transparency: Transparency,
  safety: ast.Safety,
  args: TokenStream,
  body: TokenStream,
  rules: readonly MacroRule[],
  on_unmatched_args: Directive | undefined,
): Result<TokenStream, ErrorGuaranteed> {
  const psess = cx.sess.psess;
  // Macros defined in the current crate have a real node id,
  // whereas macros from an external crate have a dummy id.
  const is_local = node_id !== DUMMY_NODE_ID;

  if (!is_local && !cx.ecfg.features.macro_attr()) {
    feature_err(cx.sess, sym.macro_attr, sp, "`macro_rules!` attributes are unstable").emit();
  }

  if (cx.trace_macros()) {
    const msg = `expanding \`#[${display_Ident(name)}(${pprust.tts_to_string(args)})] ${pprust.tts_to_string(body)}\``;
    trace_macros_note(cx.expansions, sp, msg);
  }

  // Track nothing for the best performance.
  const r = try_match_macro_attr(psess, args, body, rules, new NoopTracker());
  if (r.$ === "Ok") {
    const [i, rule, named_matches] = r._0;
    if (rule.$ !== "Attr") {
      return panic("try_macro_match_attr returned non-attr rule");
    }
    const { rhs: rhs_, unsafe_rule } = rule;
    if (rhs_.$ !== "Delimited") {
      return cx.dcx().span_bug(sp, "malformed macro rhs");
    }
    const [rhs_span, rhs] = [rhs_._0, rhs_._2];

    if ((safety.$ === "Default" && !unsafe_rule) || (safety.$ === "Unsafe" && unsafe_rule)) {
      // ok
    } else if (safety.$ === "Default" && unsafe_rule) {
      cx.dcx().span_err(sp, "unsafe attribute invocation requires `unsafe`");
    } else if (safety.$ === "Unsafe" && !unsafe_rule) {
      const span = safety._0;
      cx.dcx().span_err(span, "unnecessary `unsafe` on safe attribute invocation");
    } else if (safety.$ === "Safe") {
      const span = safety._0;
      cx.dcx().span_bug(span, "unexpected `safe` keyword");
    }

    const id = cx.current_expansion.id;
    const t = transcribe(psess, named_matches, rhs, rhs_span, transparency, id);
    if (t.$ === "Err") return Err(t._0.emit_err());
    const tts = t._0;

    if (cx.trace_macros()) {
      const msg = `to \`${pprust.tts_to_string(tts)}\``;
      trace_macros_note(cx.expansions, sp, msg);
    }

    if (is_local) {
      cx.resolver.record_macro_rule_usage(node_id, i);
    }

    return Ok(tts);
  } else if (r._0.$ === "No") {
    return Err(r._0._0);
  } else {
    // Retry and emit a better error.
    const [, guar] = failed_to_match_macro(cx.psess(), sp, def_span, name, FailedMacro.Attr(args), body, rules, on_unmatched_args);
    cx.trace_macros_diag();
    return Err(guar);
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:597 CanRetry
export type CanRetry =
  | { readonly $: "Yes" }
  /// We are not allowed to retry macro expansion as a fatal error has been emitted already.
  | { readonly $: "No"; _0: ErrorGuaranteed };
export const CanRetry = {
  Yes: Object.freeze({ $: "Yes" as const }),
};

/** `mem::take(&mut *psess.gated_spans.spans.borrow_mut())` */
function take_gated_spans(psess: ParseSess): Map<Symbol, Span[]> {
  const spans = psess.gated_spans.spans;
  psess.gated_spans.spans = new Map();
  return spans;
}

/// Try expanding the macro. Returns the index of the successful arm and its named_matches if it was successful,
/// and nothing if it failed. On failure, it's the callers job to use `track` accordingly to record all errors
/// correctly.
// #[instrument(level = "debug", skip(psess, arg, rules, track), fields(tracking = %T::description()))]
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:607 try_match_macro
export function try_match_macro<R extends MacroRule>(
  psess: ParseSess,
  arg: TokenStream,
  rules: readonly R[],
  track: Tracker,
): Result<[number, R, NamedMatches], CanRetry> {
  // We create a base parser that can be used for the "black box" parts.
  // Every iteration needs a fresh copy of that parser. However, the parser
  // is not mutated on many of the iterations, particularly when dealing with
  // macros like this:
  //
  // macro_rules! foo {
  //     ("a") => (A);
  //     ("b") => (B);
  //     ("c") => (C);
  //     // ... etc. (maybe hundreds more)
  // }
  //
  // as seen in the `html5ever` benchmark. We use a `Cow` so that the base
  // parser is only cloned when necessary (upon mutation). Furthermore, we
  // reinitialize the `Cow` with the base parser at the start of every
  // iteration, so that any mutated parsers are not reused. This is all quite
  // hacky, but speeds up the `html5ever` benchmark significantly. (Issue
  // 68836 suggests a more comprehensive but more complex change to deal with
  // this situation.)
  const parser = parser_from_cx(psess, arg.clone(), track.recovery());
  // Try each arm's matchers.
  const tt_parser = TtParser.new();
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (rule.$ !== "Func") continue;
    const lhs = rule.lhs;
    // let _tracing_span = trace_span!("Matching arm", %i);

    // Take a snapshot of the state of pre-expansion gating at this point.
    // This is used so that if a matcher is not `Success(..)`ful,
    // then the spans which became gated when parsing the unsuccessful matcher
    // are not recorded. On the first `Success(..)`ful matcher, the spans are merged.
    const gated_spans_snapshot = take_gated_spans(psess);

    track.prepare(WhichMatcher.FOR_FUNC, lhs);
    const result = tt_parser.parse_tt(CowParser.Borrowed(parser), lhs, track);
    track.after_arm(result);

    switch (result.$) {
      case "Success": {
        // debug!("Parsed arm successfully");
        // The matcher was `Success(..)`ful.
        // Merge the gated spans from parsing the matcher with the preexisting ones.
        psess.gated_spans.merge(gated_spans_snapshot);

        return Ok([i, rule, result._0]);
      }
      case "Failure": {
        // trace!("Failed to match arm, trying the next one");
        // Try the next arm.
        break;
      }
      case "Ambiguity": {
        // debug!("Fatal error occurred during matching");
        // We haven't emitted an error yet, so we can retry.
        return Err(CanRetry.Yes);
      }
      case "ErrorReported": {
        // debug!("Fatal error occurred and was reported during matching");
        // An error has been reported already, we cannot retry as that would cause duplicate errors.
        return Err({ $: "No", _0: result._0 });
      }
    }

    // The matcher was not `Success(..)`ful.
    // Restore to the state before snapshotting and maybe try again.
    psess.gated_spans.spans = gated_spans_snapshot;
  }

  return Err(CanRetry.Yes);
}

/// Try expanding the macro attribute. Returns the index of the successful arm and its
/// named_matches if it was successful, and nothing if it failed. On failure, it's the caller's job
/// to use `track` accordingly to record all errors correctly.
// #[instrument(level = "debug", skip(psess, attr_args, attr_body, rules, track), fields(tracking = %T::description()))]
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:686 try_match_macro_attr
export function try_match_macro_attr<R extends MacroRule>(
  psess: ParseSess,
  attr_args: TokenStream,
  attr_body: TokenStream,
  rules: readonly R[],
  track: Tracker,
): Result<[number, R, NamedMatches], CanRetry> {
  // This uses the same strategy as `try_match_macro`
  const args_parser = parser_from_cx(psess, attr_args.clone(), track.recovery());
  const body_parser = parser_from_cx(psess, attr_body.clone(), track.recovery());
  const tt_parser = TtParser.new();
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (rule.$ !== "Attr") continue;
    const { args, body } = rule;

    const gated_spans_snapshot = take_gated_spans(psess);

    track.prepare(WhichMatcher.Args, args);
    let result = tt_parser.parse_tt(CowParser.Borrowed(args_parser), args, track);
    track.after_arm(result);

    let named_matches: NamedMatches;
    switch (result.$) {
      case "Success":
        named_matches = result._0;
        break;
      case "Failure":
        psess.gated_spans.spans = gated_spans_snapshot;
        continue;
      case "Ambiguity":
        return Err(CanRetry.Yes);
      case "ErrorReported":
        return Err({ $: "No", _0: result._0 });
    }

    track.prepare(WhichMatcher.Body, body);
    result = tt_parser.parse_tt(CowParser.Borrowed(body_parser), body, track);
    track.after_arm(result);

    switch (result.$) {
      case "Success": {
        const body_named_matches = result._0;
        psess.gated_spans.merge(gated_spans_snapshot);
        // #[allow(rustc::potential_query_instability)]
        for (const [k, v] of body_named_matches.iter()) named_matches.insert(k, v);
        return Ok([i, rule, named_matches]);
      }
      case "Failure":
        psess.gated_spans.spans = gated_spans_snapshot;
        break;
      case "Ambiguity":
        return Err(CanRetry.Yes);
      case "ErrorReported":
        return Err({ $: "No", _0: result._0 });
    }
  }

  return Err(CanRetry.Yes);
}

/// Try expanding the macro derive. Returns the index of the successful arm and its
/// named_matches if it was successful, and nothing if it failed. On failure, it's the caller's job
/// to use `track` accordingly to record all errors correctly.
// #[instrument(level = "debug", skip(psess, body, rules, track), fields(tracking = %T::description()))]
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:742 try_match_macro_derive
export function try_match_macro_derive<R extends MacroRule>(
  psess: ParseSess,
  body: TokenStream,
  rules: readonly R[],
  track: Tracker,
): Result<[number, R, NamedMatches], CanRetry> {
  // This uses the same strategy as `try_match_macro`
  const body_parser = parser_from_cx(psess, body.clone(), track.recovery());
  const tt_parser = TtParser.new();
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (rule.$ !== "Derive") continue;
    const body = rule.body;

    const gated_spans_snapshot = take_gated_spans(psess);

    track.prepare(WhichMatcher.FOR_DERIVE, body);
    const result = tt_parser.parse_tt(CowParser.Borrowed(body_parser), body, track);
    track.after_arm(result);

    switch (result.$) {
      case "Success": {
        psess.gated_spans.merge(gated_spans_snapshot);
        return Ok([i, rule, result._0]);
      }
      case "Failure":
        psess.gated_spans.spans = gated_spans_snapshot;
        break;
      case "Ambiguity":
        return Err(CanRetry.Yes);
      case "ErrorReported":
        return Err({ $: "No", _0: result._0 });
    }
  }

  return Err(CanRetry.Yes);
}

/// Converts a macro item into a syntax extension.
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:777 compile_declarative_macro
export function compile_declarative_macro(
  sess: Session,
  features: Features,
  macro_def: ast.MacroDef,
  ident: Ident,
  attrs: readonly attrs_Attribute[],
  span: Span,
  node_id: NodeId,
  edition: Edition,
): SyntaxExtensionT {
  const mk_syn_ext = (kind: SyntaxExtensionKind): SyntaxExtensionT => {
    const is_local = is_defined_in_current_crate(node_id);
    return SyntaxExtension.new(sess, kind, span, [], edition, ident.name, attrs, is_local);
  };
  const dummy_syn_ext = (guar: ErrorGuaranteed): SyntaxExtensionT => mk_syn_ext({ $: "Bang", _0: new DummyBang(guar) });

  const macro_rules = macro_def.macro_rules;
  const exp_sep = macro_rules ? exp.Semi : exp.Comma;

  const body = macro_def.body.tokens.clone();
  const p = Parser.new(sess.psess, body, MACRO_ARGUMENTS);

  // Don't abort iteration early, so that multiple errors can be reported. We only abort early on
  // parse failures we can't recover from.
  let guar: ErrorGuaranteed | undefined = undefined;
  const check_emission = (ret: Result<undefined, ErrorGuaranteed>): void => {
    guar = guar ?? (ret.$ === "Err" ? ret._0 : undefined);
  };

  let kinds = MacroKinds.empty();
  const rules: MacroRule[] = [];

  while (!p.token.eq(TokenKind_.Eof)) {
    const unsafe_rule = p.eat_keyword_noexpect(kw.Unsafe);
    const unsafe_keyword_span = p.prev_token.span;
    let g: ErrorGuaranteed | undefined;
    if (unsafe_rule && (g = check_no_eof(sess, p, "expected `attr`")) !== undefined) {
      return dummy_syn_ext(g);
    }
    let args: mbe.TokenTree | undefined;
    let is_derive: boolean;
    if (p.eat_keyword_noexpect(sym.attr)) {
      kinds = MacroKinds.union(kinds, MacroKinds.ATTR);
      if (is_defined_in_current_crate(node_id) && !features.macro_attr()) {
        feature_err(sess, sym.macro_attr, span, "`macro_rules!` attributes are unstable").emit();
      }
      if ((g = check_no_eof(sess, p, "expected macro attr args")) !== undefined) {
        return dummy_syn_ext(g);
      }
      const args_tt = p.parse_token_tree();
      check_args_parens(sess, sym.attr, args_tt);
      const args_ = parse_one_tt(args_tt, "Pattern", sess, node_id, features, edition);
      check_emission(check_lhs(sess, features, node_id, args_));
      if ((g = check_no_eof(sess, p, "expected macro attr body")) !== undefined) {
        return dummy_syn_ext(g);
      }
      [args, is_derive] = [args_, false];
    } else if (p.eat_keyword_noexpect(sym.derive)) {
      kinds = MacroKinds.union(kinds, MacroKinds.DERIVE);
      const derive_keyword_span = p.prev_token.span;
      if (!features.macro_derive()) {
        feature_err(sess, sym.macro_derive, span, "`macro_rules!` derives are unstable").emit();
      }
      if (unsafe_rule) {
        sess.dcx().span_err(unsafe_keyword_span, "`unsafe` is only supported on `attr` rules");
      }
      if ((g = check_no_eof(sess, p, "expected `()` after `derive`")) !== undefined) {
        return dummy_syn_ext(g);
      }
      const args_tt = p.parse_token_tree();
      check_args_parens(sess, sym.derive, args_tt);
      const args_empty_result = check_args_empty(sess, args_tt);
      const args_not_empty = args_empty_result.$ === "Err";
      check_emission(args_empty_result);
      if ((g = check_no_eof(sess, p, "expected macro derive body")) !== undefined) {
        return dummy_syn_ext(g);
      }
      // If the user has `=>` right after the `()`, they might have forgotten the empty
      // parentheses.
      if (p.token.eq(TokenKind_.FatArrow)) {
        const err = sess.dcx().struct_span_err(p.token.span, "expected macro derive body, got `=>`");
        if (args_not_empty) {
          err.span_label(derive_keyword_span, "need `()` after this `derive`");
        }
        return dummy_syn_ext(err.emit_err());
      }
      [args, is_derive] = [undefined, true];
    } else {
      kinds = MacroKinds.union(kinds, MacroKinds.BANG);
      if (unsafe_rule) {
        sess.dcx().span_err(unsafe_keyword_span, "`unsafe` is only supported on `attr` rules");
      }
      [args, is_derive] = [undefined, false];
    }
    const lhs_tt_ = p.parse_token_tree();
    const lhs_tt = parse_one_tt(lhs_tt_, "Pattern", sess, node_id, features, edition);
    check_emission(check_lhs(sess, features, node_id, lhs_tt));
    const e = p.expect(exp.FatArrow);
    if (e.$ === "Err") {
      return dummy_syn_ext(e._0.emit_err());
    }
    if ((g = check_no_eof(sess, p, "expected right-hand side of macro rule")) !== undefined) {
      return dummy_syn_ext(g);
    }
    const rhs_ = p.parse_token_tree();
    const rhs = parse_one_tt(rhs_, "Body", sess, node_id, features, edition);
    check_emission(check_rhs(sess, rhs));
    check_emission(check_meta_variables(sess.psess, node_id, args, lhs_tt, rhs));
    const lhs_span = mbe.TokenTree.span(lhs_tt);
    // Convert the lhs into `MatcherLoc` form, which is better for doing the
    // actual matching.
    if (lhs_tt.$ !== "Delimited") {
      return dummy_syn_ext(unwrap(guar as ErrorGuaranteed | undefined));
    }
    const lhs = compute_locs(lhs_tt._2.tts);
    if (args !== undefined) {
      const args_span = mbe.TokenTree.span(args);
      if (args.$ !== "Delimited") {
        return dummy_syn_ext(unwrap(guar as ErrorGuaranteed | undefined));
      }
      const args_ = compute_locs(args._2.tts);
      const body_span = lhs_span;
      rules.push({ $: "Attr", unsafe_rule, args: args_, args_span, body: lhs, body_span, rhs });
    } else if (is_derive) {
      rules.push({ $: "Derive", body: lhs, body_span: lhs_span, rhs });
    } else {
      rules.push({ $: "Func", lhs, lhs_span, rhs });
    }
    if (p.token.eq(TokenKind_.Eof)) {
      break;
    }
    const e2 = p.expect(exp_sep);
    if (e2.$ === "Err") {
      return dummy_syn_ext(e2._0.emit_err());
    }
  }

  if (rules.length === 0) {
    const guar = sess.dcx().span_err(span, "macros must contain at least one rule");
    return dummy_syn_ext(guar);
  }
  assert(!MacroKinds.is_empty(kinds), "assertion failed: !kinds.is_empty()");

  const transparency = find_attr(attrs, (k) => (k.$ === "RustcMacroTransparency" ? k._0 : undefined)) ?? Transparency.fallback(macro_rules);

  if (guar !== undefined) {
    // To avoid warning noise, only consider the rules of this
    // macro for the lint, if all rules are valid.
    return dummy_syn_ext(guar);
  }

  // PORT: `find_attr!(..).flatten()`: the first `OnUnmatchedArgs` decides, even when its directive is `None`.
  const on_unmatched_args = find_attr(attrs, (k) => (k.$ === "OnUnmatchedArgs" ? { directive: k.directive } : undefined))?.directive;

  const exp_ = new MacroRulesMacroExpander(node_id, ident, span, on_unmatched_args, transparency, kinds, rules, macro_rules);
  return mk_syn_ext({ $: "MacroRules", _0: exp_ });
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:948 check_no_eof
function check_no_eof(sess: Session, p: Parser, msg: string): ErrorGuaranteed | undefined {
  if (p.token.eq(TokenKind_.Eof)) {
    const err_sp = Span.shrink_to_hi(p.token.span);
    const guar = sess.dcx().struct_span_err(err_sp, "macro definition ended unexpectedly").with_span_label(err_sp, msg).emit_err();
    return guar;
  }
  return undefined;
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:961 check_args_parens
function check_args_parens(sess: Session, rule_kw: Symbol, args: tokenstream.TokenTree): void {
  // This does not handle the non-delimited case; that gets handled separately by `check_lhs`.
  if (args.$ === "Delimited" && args._2.$ !== "Parenthesis") {
    const dspan = args._0;
    sess.dcx().emit_err(
      MacroArgsBadDelim_diagnostic({
        span: dspan.entire(),
        sugg: { open: dspan.open, close: dspan.close },
        rule_kw,
      }),
    );
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:974 check_args_empty
function check_args_empty(sess: Session, args: tokenstream.TokenTree): Result<undefined, ErrorGuaranteed> {
  if (args.$ === "Delimited" && args._3.is_empty()) {
    return Ok(undefined);
  } else {
    const msg = "`derive` rules do not accept arguments; `derive` must be followed by `()`";
    return Err(sess.dcx().span_err(tokenstream.TokenTree.span(args), msg));
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:984 check_lhs
function check_lhs(sess: Session, features: Features, node_id: NodeId, lhs: mbe.TokenTree): Result<undefined, ErrorGuaranteed> {
  const e1 = check_lhs_nt_follows(sess, features, node_id, lhs);
  const e2 = check_lhs_no_empty_seq(sess, [lhs]);
  // `e1.and(e2)`
  return e1.$ === "Err" ? e1 : e2;
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:995 check_lhs_nt_follows
function check_lhs_nt_follows(sess: Session, features: Features, node_id: NodeId, lhs: mbe.TokenTree): Result<undefined, ErrorGuaranteed> {
  // lhs is going to be like TokenTree::Delimited(...), where the
  // entire lhs is those tts. Or, it can be a "bare sequence", not wrapped in parens.
  if (lhs.$ === "Delimited") {
    return check_matcher(sess, features, node_id, lhs._2.tts);
  } else {
    const msg = "invalid macro matcher; matchers must be contained in balanced delimiters";
    return Err(sess.dcx().span_err(mbe.TokenTree.span(lhs), msg));
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1011 is_empty_token_tree
function is_empty_token_tree(sess: Session, seq: SequenceRepetition): boolean {
  if (seq.separator !== undefined) {
    return false;
  } else {
    let is_empty = true;
    // `seq.tts.iter().peekable()`
    const tts = seq.tts;
    let idx = 0;
    while (idx < tts.length) {
      const tt = tts[idx++]!;
      if (tt.$ === "MetaVarDecl" && tt.kind.$ === "Vis") {
        // nothing
      } else if (tt.$ === "Token" && tt._0.kind.$ === "DocComment") {
        const t = tt._0;
        let now = t;
        for (;;) {
          const peek = tts[idx];
          if (peek !== undefined && peek.$ === "Token" && peek._0.kind.$ === "DocComment") {
            now = peek._0;
            idx++;
          } else {
            break;
          }
        }
        const span = Span.to(t.span, now.span);
        sess.dcx().span_note(span, "doc comments are ignored in matcher position");
      } else if (tt.$ === "Sequence" && (tt._1.kleene.op === "ZeroOrMore" || tt._1.kleene.op === "ZeroOrOne")) {
        // nothing
      } else {
        is_empty = false;
      }
    }
    return is_empty;
  }
}

/// Checks if a `vis` nonterminal fragment is unnecessarily wrapped in an optional repetition.
///
/// When a `vis` fragment (which can already be empty) is wrapped in `$(...)?`,
/// this suggests removing the redundant repetition syntax since it provides no additional benefit.
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1046 check_redundant_vis_repetition
function check_redundant_vis_repetition(err: Diag, sess: Session, seq: SequenceRepetition, span: DelimSpan): void {
  const first = seq.tts[0];
  if (seq.kleene.op === "ZeroOrOne" && first !== undefined && first.$ === "MetaVarDecl" && first.kind.$ === "Vis") {
    err.note("a `vis` fragment can already be empty");
    err.multipart_suggestion(
      "remove the `$(` and `)?`",
      [
        [sess.source_map().span_extend_to_prev_char_before(span.open, 0x24 /* '$' */, true), ""],
        [Span.with_hi(span.close, Span.hi(seq.kleene.span)), ""],
      ],
      Applicability.MaybeIncorrect,
    );
  }
}

/// Checks that the lhs contains no repetition which could match an empty token
/// tree, because then the matcher would hang indefinitely.
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1075 check_lhs_no_empty_seq
function check_lhs_no_empty_seq(sess: Session, tts: readonly mbe.TokenTree[]): Result<undefined, ErrorGuaranteed> {
  for (const tt of tts) {
    switch (tt.$) {
      case "Token":
      case "MetaVar":
      case "MetaVarDecl":
      case "MetaVarExpr":
        break;
      case "Delimited": {
        const r = check_lhs_no_empty_seq(sess, tt._2.tts);
        if (r.$ === "Err") return r;
        break;
      }
      case "Sequence": {
        const [span, seq] = [tt._0, tt._1];
        if (is_empty_token_tree(sess, seq)) {
          const sp = span.entire();
          const err = sess.dcx().struct_span_err(sp, "repetition matches empty token tree");
          check_redundant_vis_repetition(err, sess, seq, span);
          return Err(err.emit_err());
        }
        const r = check_lhs_no_empty_seq(sess, seq.tts);
        if (r.$ === "Err") return r;
        break;
      }
    }
  }

  return Ok(undefined);
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1100 check_rhs
function check_rhs(sess: Session, rhs: mbe.TokenTree): Result<undefined, ErrorGuaranteed> {
  switch (rhs.$) {
    case "Delimited":
      return Ok(undefined);
    default:
      return Err(sess.dcx().span_err(mbe.TokenTree.span(rhs), "macro rhs must be delimited"));
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1107 check_matcher
function check_matcher(sess: Session, features: Features, node_id: NodeId, matcher: readonly mbe.TokenTree[]): Result<undefined, ErrorGuaranteed> {
  const first_sets = FirstSets.new(matcher);
  const empty_suffix = TokenSet.empty();
  const r = check_matcher_core(sess, features, node_id, first_sets, matcher, empty_suffix);
  if (r.$ === "Err") return r;
  return Ok(undefined);
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1119 has_compile_error_macro
function has_compile_error_macro(rhs: mbe.TokenTree): boolean {
  switch (rhs.$) {
    case "Delimited": {
      const d = rhs._2;
      // `d.tts.array_windows::<3>().any(..)`
      let has_compile_error = false;
      for (let i = 0; i + 3 <= d.tts.length; i++) {
        const [ident, bang, args] = [d.tts[i]!, d.tts[i + 1]!, d.tts[i + 2]!];
        if (
          ident.$ === "Token" &&
          ident._0.kind.$ === "Ident" &&
          ident._0.kind._0 === sym.compile_error &&
          bang.$ === "Token" &&
          bang._0.kind.$ === "Bang" &&
          args.$ === "Delimited" &&
          !Delimiter.skip(args._2.delim)
        ) {
          has_compile_error = true;
          break;
        }
      }
      if (has_compile_error) {
        return true;
      } else {
        return d.tts.some(has_compile_error_macro);
      }
    }
    default:
      return false;
  }
}

// `The FirstSets` for a matcher is a mapping from subsequences in the
// matcher to the FIRST set for that subsequence.
//
// This mapping is partially precomputed via a backwards scan over the
// token trees of the matcher, which provides a mapping from each
// repetition sequence to its *first* set.
//
// (Hypothetically, sequences should be uniquely identifiable via their
// spans, though perhaps that is false, e.g., for macro-generated macros
// that do not try to inject artificial span information. My plan is
// to try to catch such cases ahead of time and not include them in
// the precomputed mapping.)
// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:1154 FirstSets
class FirstSets {
  constructor(
    // this maps each TokenTree::Sequence `$(tt ...) SEP OP` that is uniquely identified by its
    // span in the original matcher to the First set for the inner sequence `tt ...`.
    //
    // If two sequences have the same span in a matcher, then map that
    // span to None (invalidating the mapping here and forcing the code to
    // use a slow path).
    // PORT: `FxHashMap<Span, Option<TokenSet>>`: an entry whose value is `undefined` is `Some(None)`
    // (`has` tells it apart from a missing entry). Only looked up, never iterated.
    public first: Map<Span, TokenSet | undefined>,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1165 new
  static new(tts: readonly mbe.TokenTree[]): FirstSets {
    const sets = new FirstSets(new Map());
    build_recur(sets, tts);
    return sets;

    // walks backward over `tts`, returning the FIRST for `tts`
    // and updating `sets` at the same time for all sequence
    // substructure we find within `tts`.
    // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1175 build_recur
    function build_recur(sets: FirstSets, tts: readonly mbe.TokenTree[]): TokenSet {
      let first = TokenSet.empty();
      for (let i = tts.length - 1; i >= 0; i--) {
        const tt = tts[i]!;
        switch (tt.$) {
          case "Token":
          case "MetaVar":
          case "MetaVarDecl":
          case "MetaVarExpr": {
            first.replace_with({ $: "TtRef", _0: tt });
            break;
          }
          case "Delimited": {
            const [span, delimited] = [tt._0, tt._2];
            build_recur(sets, delimited.tts);
            first.replace_with(TtHandle.from_token_kind(Delimiter.as_open_token_kind(delimited.delim), span.open));
            break;
          }
          case "Sequence": {
            const [sp, seq_rep] = [tt._0, tt._1];
            const subfirst = build_recur(sets, seq_rep.tts);

            const key = sp.entire();
            if (!sets.first.has(key)) {
              sets.first.set(key, subfirst.clone());
            } else {
              // if there is already an entry, then a span must have collided.
              // This should not happen with typical macro_rules macros,
              // but syntax extensions need not maintain distinct spans,
              // so distinct syntax trees can be assigned the same span.
              // In such a case, the map cannot be trusted; so mark this
              // entry as unusable.
              sets.first.set(key, undefined);
            }

            // If the sequence contents can be empty, then the first
            // token could be the separator token itself.

            if (seq_rep.separator !== undefined && subfirst.maybe_empty) {
              first.add_one_maybe(TtHandle.from_token(seq_rep.separator));
            }

            // Reverse scan: Sequence comes before `first`.
            if (subfirst.maybe_empty || seq_rep.kleene.op === "ZeroOrMore" || seq_rep.kleene.op === "ZeroOrOne") {
              // If sequence is potentially empty, then
              // union them (preserving first emptiness).
              first.add_all(new TokenSet(subfirst.tokens, true));
            } else {
              // Otherwise, sequence guaranteed
              // non-empty; replace first.
              first = subfirst;
            }
            break;
          }
        }
      }

      return first;
    }
  }

  // walks forward over `tts` until all potential FIRST tokens are
  // identified.
  // PORT: `fn first` is `first_of`: the class already has the field `first`.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1240 first
  first_of(tts: readonly mbe.TokenTree[]): TokenSet {
    const first = TokenSet.empty();
    for (const tt of tts) {
      assert(first.maybe_empty, "assertion failed: first.maybe_empty");
      switch (tt.$) {
        case "Token":
        case "MetaVar":
        case "MetaVarDecl":
        case "MetaVarExpr": {
          first.add_one({ $: "TtRef", _0: tt });
          return first;
        }
        case "Delimited": {
          const [span, delimited] = [tt._0, tt._2];
          first.add_one(TtHandle.from_token_kind(Delimiter.as_open_token_kind(delimited.delim), span.open));
          return first;
        }
        case "Sequence": {
          const [sp, seq_rep] = [tt._0, tt._1];
          let subfirst: TokenSet;
          const key = sp.entire();
          if (this.first.has(key)) {
            const s = this.first.get(key);
            if (s !== undefined) {
              subfirst = s;
            } else {
              subfirst = this.first_of(seq_rep.tts);
            }
          } else {
            return panic("We missed a sequence during FirstSets construction");
          }

          // If the sequence contents can be empty, then the first
          // token could be the separator token itself.
          if (seq_rep.separator !== undefined && subfirst.maybe_empty) {
            first.add_one_maybe(TtHandle.from_token(seq_rep.separator));
          }

          assert(first.maybe_empty, "assertion failed: first.maybe_empty");
          first.add_all(subfirst);
          if (subfirst.maybe_empty || seq_rep.kleene.op === "ZeroOrMore" || seq_rep.kleene.op === "ZeroOrOne") {
            // Continue scanning for more first
            // tokens, but also make sure we
            // restore empty-tracking state.
            first.maybe_empty = true;
            continue;
          } else {
            return first;
          }
        }
      }
    }

    // we only exit the loop if `tts` was empty or if every
    // element of `tts` matches the empty sequence.
    assert(first.maybe_empty, "assertion failed: first.maybe_empty");
    return first;
  }
}

// Most `mbe::TokenTree`s are preexisting in the matcher, but some are defined
// implicitly, such as opening/closing delimiters and sequence repetition ops.
// This type encapsulates both kinds. It implements `Clone` while avoiding the
// need for `mbe::TokenTree` to implement `Clone`.
// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:1310 TtHandle
type TtHandle =
  /// This is used in most cases.
  | { readonly $: "TtRef"; _0: mbe.TokenTree }
  /// This is only used for implicit token trees. The `mbe::TokenTree` *must*
  /// be `mbe::TokenTree::Token`. No other variants are allowed. We store an
  /// `mbe::TokenTree` rather than a `Token` so that `get()` can return a
  /// `&mbe::TokenTree`.
  | { readonly $: "Token"; _0: mbe.TokenTree };

const TtHandle = {
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1322 from_token
  from_token(tok: Token): TtHandle {
    return { $: "Token", _0: { $: "Token", _0: tok } };
  },

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1326 from_token_kind
  from_token_kind(kind: TokenKind, span: Span): TtHandle {
    return TtHandle.from_token(Token_.new(kind, span));
  },

  // Get a reference to a token tree.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1331 get
  get(self: TtHandle): mbe.TokenTree {
    return self._0;
  },

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1340 eq
  eq(self: TtHandle, other: TtHandle): boolean {
    return mbe_TokenTree_eq(TtHandle.get(self), TtHandle.get(other));
  },

  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1346 clone
  clone(self: TtHandle): TtHandle {
    switch (self.$) {
      case "TtRef":
        return { $: "TtRef", _0: self._0 };

      // This variant *must* contain a `mbe::TokenTree::Token`, and not
      // any other variant of `mbe::TokenTree`.
      case "Token":
        if (self._0.$ === "Token") {
          return { $: "Token", _0: { $: "Token", _0: self._0._0 } };
        }
        return unreachable();
    }
  },
};

// PORT: `#[derive(PartialEq)]` of `mbe::TokenTree` and the types it contains (mbe.rs / metavar_expr.rs,
// lane mbe-a, which ported no `_eq` helpers). Only `TtHandle::eq` uses it. Candidate to move to mbe.ts.
function mbe_TokenTree_eq(a: mbe.TokenTree, b: mbe.TokenTree): boolean {
  const ident_eq = (x: Ident, y: Ident): boolean => x.eq(y);
  const opt_token_eq = (x: Token | undefined, y: Token | undefined): boolean =>
    x === undefined || y === undefined ? x === y : token.Token_eq(x, y);
  const dspan_eq = (x: DelimSpan, y: DelimSpan): boolean => x.open === y.open && x.close === y.close;
  const tts_eq = (x: readonly mbe.TokenTree[], y: readonly mbe.TokenTree[]): boolean =>
    x.length === y.length && x.every((t, i) => mbe_TokenTree_eq(t, y[i]!));
  const elem_eq = (x: MetaVarExprConcatElem, y: MetaVarExprConcatElem): boolean => {
    if (x.$ !== y.$) return false;
    if (x.$ === "Literal") return x._0 === (y as typeof x)._0;
    return ident_eq(x._0, (y as typeof x)._0);
  };
  const expr_eq = (x: mbe.MetaVarExpr, y: mbe.MetaVarExpr): boolean => {
    switch (x.$) {
      case "ConcatIdent":
      case "ConcatStr": {
        const y_ = y as typeof x;
        return x.$ === y.$ && x._0.length === y_._0.length && x._0.every((e, i) => elem_eq(e, y_._0[i]!));
      }
      case "Count":
        return y.$ === "Count" && ident_eq(x._0, y._0) && x._1 === y._1;
      case "Ignore":
        return y.$ === "Ignore" && ident_eq(x._0, y._0);
      case "Index":
        return y.$ === "Index" && x._0 === y._0;
      case "Len":
        return y.$ === "Len" && x._0 === y._0;
    }
  };
  switch (a.$) {
    case "Token":
      return b.$ === "Token" && token.Token_eq(a._0, b._0);
    case "Delimited":
      return (
        b.$ === "Delimited" &&
        dspan_eq(a._0, b._0) &&
        a._1.open === b._1.open &&
        a._1.close === b._1.close &&
        token.Delimiter_eq(a._2.delim, b._2.delim) &&
        tts_eq(a._2.tts, b._2.tts)
      );
    case "Sequence":
      return (
        b.$ === "Sequence" &&
        dspan_eq(a._0, b._0) &&
        tts_eq(a._1.tts, b._1.tts) &&
        opt_token_eq(a._1.separator, b._1.separator) &&
        a._1.kleene.span === b._1.kleene.span &&
        a._1.kleene.op === b._1.kleene.op &&
        a._1.num_captures === b._1.num_captures
      );
    case "MetaVar":
      return b.$ === "MetaVar" && a._0 === b._0 && ident_eq(a._1, b._1);
    case "MetaVarDecl":
      return b.$ === "MetaVarDecl" && a.span === b.span && ident_eq(a.name, b.name) && token.NonterminalKind_eq(a.kind, b.kind);
    case "MetaVarExpr":
      return b.$ === "MetaVarExpr" && dspan_eq(a._0, b._0) && expr_eq(a._1, b._1);
  }
}

// A set of `mbe::TokenTree`s, which may include `TokenTree::Match`s
// (for macro-by-example syntactic variables). It also carries the
// `maybe_empty` flag; that is true if and only if the matcher can
// match an empty token sequence.
//
// The First set is computed on submatchers like `$($a:expr b),* $(c)* d`,
// which has corresponding FIRST = {$a:expr, c, d}.
// Likewise, `$($a:expr b),* $(c)+ d` has FIRST = {$a:expr, c}.
//
// (Notably, we must allow for *-op to occur zero times.)
// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:1372 TokenSet
class TokenSet {
  constructor(
    public tokens: TtHandle[],
    public maybe_empty: boolean,
  ) {}

  /** `#[derive(Clone)]` */
  clone(): TokenSet {
    return new TokenSet(this.tokens.map(TtHandle.clone), this.maybe_empty);
  }

  // Returns a set for the empty sequence.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1379 empty
  static empty(): TokenSet {
    return new TokenSet([], true);
  }

  // Returns the set `{ tok }` for the single-token (and thus
  // non-empty) sequence [tok].
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1385 singleton
  static singleton(tt: TtHandle): TokenSet {
    return new TokenSet([tt], false);
  }

  // Changes self to be the set `{ tok }`.
  // Since `tok` is always present, marks self as non-empty.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1391 replace_with
  replace_with(tt: TtHandle): void {
    this.tokens.length = 0;
    this.tokens.push(tt);
    this.maybe_empty = false;
  }

  // Changes self to be the empty set `{}`; meant for use when
  // the particular token does not matter, but we want to
  // record that it occurs.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1400 replace_with_irrelevant
  replace_with_irrelevant(): void {
    this.tokens.length = 0;
    this.maybe_empty = false;
  }

  // Adds `tok` to the set for `self`, marking sequence as non-empty.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1406 add_one
  add_one(tt: TtHandle): void {
    if (!this.tokens.some((t) => TtHandle.eq(t, tt))) {
      this.tokens.push(tt);
    }
    this.maybe_empty = false;
  }

  // Adds `tok` to the set for `self`. (Leaves `maybe_empty` flag alone.)
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1414 add_one_maybe
  add_one_maybe(tt: TtHandle): void {
    if (!this.tokens.some((t) => TtHandle.eq(t, tt))) {
      this.tokens.push(tt);
    }
  }

  // Adds all elements of `other` to this.
  //
  // (Since this is a set, we filter out duplicates.)
  //
  // If `other` is potentially empty, then preserves the previous
  // setting of the empty flag of `self`. If `other` is guaranteed
  // non-empty, then `self` is marked non-empty.
  // rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1427 add_all
  add_all(other: TokenSet): void {
    for (const tt of other.tokens) {
      if (!this.tokens.some((t) => TtHandle.eq(t, tt))) {
        this.tokens.push(TtHandle.clone(tt));
      }
    }
    if (!other.maybe_empty) {
      this.maybe_empty = false;
    }
  }
}

// Checks that `matcher` is internally consistent and that it
// can legally be followed by a token `N`, for all `N` in `follow`.
// (If `follow` is empty, then it imposes no constraint on
// the `matcher`.)
//
// Returns the set of NT tokens that could possibly come last in
// `matcher`. (If `matcher` matches the empty sequence, then
// `maybe_empty` will be set to true.)
//
// Requires that `first_sets` is pre-computed for `matcher`;
// see `FirstSets::new`.
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1450 check_matcher_core
function check_matcher_core(
  sess: Session,
  features: Features,
  node_id: NodeId,
  first_sets: FirstSets,
  matcher: readonly mbe.TokenTree[],
  follow: TokenSet,
): Result<TokenSet, ErrorGuaranteed> {
  let last = TokenSet.empty();

  let errored: Result<undefined, ErrorGuaranteed> = Ok(undefined);

  // 2. For each token and suffix  [T, SUFFIX] in M:
  // ensure that T can be followed by SUFFIX, and if SUFFIX may be empty,
  // then ensure T can also be followed by any element of FOLLOW.
  each_token: for (let i = 0; i < matcher.length; i++) {
    const token_ = matcher[i]!;
    const suffix = matcher.slice(i + 1);

    const build_suffix_first = (): TokenSet => {
      const s = first_sets.first_of(suffix);
      if (s.maybe_empty) {
        s.add_all(follow);
      }
      return s;
    };

    // (we build `suffix_first` on demand below; you can tell
    // which cases are supposed to fall through by looking for the
    // initialization of this variable.)
    let suffix_first: TokenSet;

    // First, update `last` so that it corresponds to the set
    // of NT tokens that might end the sequence `... token`.
    switch (token_.$) {
      case "Token":
      case "MetaVar":
      case "MetaVarDecl":
      case "MetaVarExpr": {
        if (token_.$ === "MetaVarDecl" && token_.kind.$ === "Guard" && !features.macro_guard_matcher()) {
          feature_err(sess, sym.macro_guard_matcher, mbe.TokenTree.span(token_), "`guard` fragments in macro are unstable").emit();
        }
        if (token_can_be_followed_by_any(token_)) {
          // don't need to track tokens that work with any,
          last.replace_with_irrelevant();
          // ... and don't need to check tokens that can be
          // followed by anything against SUFFIX.
          continue each_token;
        } else {
          last.replace_with({ $: "TtRef", _0: token_ });
          suffix_first = build_suffix_first();
        }
        break;
      }
      case "Delimited": {
        const [span, d] = [token_._0, token_._2];
        const my_suffix = TokenSet.singleton(TtHandle.from_token_kind(Delimiter.as_close_token_kind(d.delim), span.close));
        const r = check_matcher_core(sess, features, node_id, first_sets, d.tts, my_suffix);
        if (r.$ === "Err") return r;
        // don't track non NT tokens
        last.replace_with_irrelevant();

        // also, we don't need to check delimited sequences
        // against SUFFIX
        continue each_token;
      }
      case "Sequence": {
        const seq_rep = token_._1;
        suffix_first = build_suffix_first();
        // The trick here: when we check the interior, we want
        // to include the separator (if any) as a potential
        // (but not guaranteed) element of FOLLOW. So in that
        // case, we make a temp copy of suffix and stuff
        // delimiter in there.
        //
        // FIXME: Should I first scan suffix_first to see if
        // delimiter is already in it before I go through the
        // work of cloning it? But then again, this way I may
        // get a "tighter" span?
        let my_suffix: TokenSet;
        if (seq_rep.separator !== undefined) {
          const new_ = suffix_first.clone();
          new_.add_one_maybe(TtHandle.from_token(seq_rep.separator));
          my_suffix = new_;
        } else {
          my_suffix = suffix_first;
        }

        // At this point, `suffix_first` is built, and
        // `my_suffix` is some TokenSet that we can use
        // for checking the interior of `seq_rep`.
        const r = check_matcher_core(sess, features, node_id, first_sets, seq_rep.tts, my_suffix);
        if (r.$ === "Err") return r;
        const next = r._0;
        if (next.maybe_empty) {
          last.add_all(next);
        } else {
          last = next;
        }

        // the recursive call to check_matcher_core already ran the 'each_last
        // check below, so we can just keep going forward here.
        continue each_token;
      }
    }

    // (`suffix_first` guaranteed initialized once reaching here.)

    // Now `last` holds the complete set of NT tokens that could
    // end the sequence before SUFFIX. Check that every one works with `suffix`.
    for (const tt of last.tokens) {
      const t = TtHandle.get(tt);
      if (t.$ === "MetaVarDecl") {
        const { span, name, kind } = t;
        for (const next_token_ of suffix_first.tokens) {
          const next_token = TtHandle.get(next_token_);

          // Check if the old pat is used and the next token is `|`
          // to warn about incompatibility with Rust 2021.
          // We only emit this lint if we're parsing the original
          // definition of this macro_rules, not while (re)parsing
          // the macro when compiling another crate that is using the
          // macro. (See #86567.)
          if (
            is_defined_in_current_crate(node_id) &&
            kind.$ === "Pat" &&
            kind._0.$ === "PatParam" &&
            kind._0.inferred &&
            next_token.$ === "Token" &&
            next_token._0.eq(TokenKind_.Or)
          ) {
            // It is suggestion to use pat_param, for example: $x:pat -> $x:pat_param.
            const suggestion = quoted_tt_to_string({
              $: "MetaVarDecl",
              span,
              name,
              kind: { $: "Pat", _0: { $: "PatParam", inferred: false } },
            });
            sess.psess.buffer_lint(builtin.RUST_2021_INCOMPATIBLE_OR_PATTERNS, span, CRATE_NODE_ID, OrPatternsBackCompat_diagnostic({ span, suggestion }));
          }
          const f = is_in_follow(next_token, kind);
          if (f.$ === "Yes") {
            // ok
          } else {
            const possible = f._0;
            const may_be = last.tokens.length === 1 && suffix_first.tokens.length === 1 ? "is" : "may be";

            const sp = mbe.TokenTree.span(next_token);
            const frag = display_NonterminalKind(kind);
            const err = sess
              .dcx()
              .struct_span_err(
                sp,
                `\`$${display_Ident(name)}:${frag}\` ${may_be} followed by \`${quoted_tt_to_string(next_token)}\`, which is not allowed for \`${frag}\` fragments`,
              );
            err.span_label(sp, `not allowed after \`${frag}\` fragments`);

            if (
              kind.$ === "Pat" &&
              kind._0.$ === "PatWithOr" &&
              Edition.at_least_rust_2021(sess.psess.edition) &&
              mbe.TokenTree.is_token(next_token, TokenKind_.Or)
            ) {
              const suggestion = quoted_tt_to_string({
                $: "MetaVarDecl",
                span,
                name,
                kind: { $: "Pat", _0: { $: "PatParam", inferred: false } },
              });
              err.span_suggestion(span, "try a `pat_param` fragment specifier instead", suggestion, Applicability.MaybeIncorrect);
            }

            const msg = "allowed there are: ";
            if (possible.length === 0) {
              // nothing
            } else if (possible.length === 1) {
              const t = possible[0]!;
              err.note(`only ${t} is allowed after \`${frag}\` fragments`);
            } else {
              const ts = possible;
              err.note(`${msg}${ts.slice(0, ts.length - 1).join(", ")} or ${ts[ts.length - 1]!}`);
            }
            errored = Err(err.emit_err());
          }
        }
      }
    }
  }
  if (errored.$ === "Err") return errored;
  return Ok(last);
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1674 token_can_be_followed_by_any
function token_can_be_followed_by_any(tok: mbe.TokenTree): boolean {
  if (tok.$ === "MetaVarDecl") {
    return frag_can_be_followed_by_any(tok.kind);
  } else {
    // (Non NT's can always be followed by anything in matchers.)
    return true;
  }
}

/// Returns `true` if a fragment of type `frag` can be followed by any sort of
/// token. We use this (among other things) as a useful approximation
/// for when `frag` can be followed by a repetition like `$(...)*` or
/// `$(...)+`. In general, these can be a bit tricky to reason about,
/// so we adopt a conservative position that says that any fragment
/// specifier which consumes at most one token tree can be followed by
/// a fragment specifier (indeed, these fragments can be followed by
/// ANYTHING without fear of future compatibility hazards).
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1691 frag_can_be_followed_by_any
function frag_can_be_followed_by_any(kind: NonterminalKind): boolean {
  return (
    kind.$ === "Item" || // always terminated by `}` or `;`
    kind.$ === "Block" || // exactly one token tree
    kind.$ === "Ident" || // exactly one token tree
    kind.$ === "Literal" || // exactly one token tree
    kind.$ === "Meta" || // exactly one token tree
    kind.$ === "Lifetime" || // exactly one token tree
    kind.$ === "TT" // exactly one token tree
  );
}

// rustc-type: compiler/rustc_expand/src/mbe/macro_rules.rs:1704 IsInFollow
type IsInFollow = { readonly $: "Yes" } | { readonly $: "No"; _0: readonly string[] };
const IsInFollow_Yes: IsInFollow = Object.freeze({ $: "Yes" as const });

/// Returns `true` if `frag` can legally be followed by the token `tok`. For
/// fragments that can consume an unbounded number of tokens, `tok`
/// must be within a well-defined follow set. This is intended to
/// guarantee future compatibility: for example, without this rule, if
/// we expanded `expr` to include a new binary operator, we might
/// break macros that were relying on that binary operator as a
/// separator.
// when changing this do not forget to update doc/book/macros.md!
// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1717 is_in_follow
function is_in_follow(tok: mbe.TokenTree, kind: NonterminalKind): IsInFollow {
  const No = (ts: readonly string[]): IsInFollow => ({ $: "No", _0: ts });
  const is_if_in = (k: TokenKind): boolean => k.$ === "Ident" && (k._0 === kw.If || k._0 === kw.In) && (k._1 === "Normal" || k._1 === "ForcedKeyword");

  if (tok.$ === "Token" && TokenKind_.close_delim(tok._0.kind) !== undefined) {
    // closing a token tree can never be matched by any fragment;
    // iow, we always require that `(` and `)` match, etc.
    return IsInFollow_Yes;
  } else {
    switch (kind.$) {
      case "Item": {
        // since items *must* be followed by either a `;` or a `}`, we can
        // accept anything after them
        return IsInFollow_Yes;
      }
      case "Block": {
        // anything can follow block, the braces provide an easy boundary to
        // maintain
        return IsInFollow_Yes;
      }
      case "Stmt":
      case "Expr": {
        const TOKENS: readonly string[] = ["`=>`", "`,`", "`;`"];
        if (tok.$ === "Token") {
          switch (tok._0.kind.$) {
            case "FatArrow":
            case "Comma":
            case "Semi":
              return IsInFollow_Yes;
            default:
              return No(TOKENS);
          }
        }
        return No(TOKENS);
      }
      case "Pat": {
        if (kind._0.$ === "PatParam") {
          const TOKENS: readonly string[] = ["`=>`", "`,`", "`=`", "`|`", "`if`", "`if let`", "`in`"];
          if (tok.$ === "Token") {
            const k = tok._0.kind;
            switch (k.$) {
              case "FatArrow":
              case "Comma":
              case "Eq":
              case "Or":
                return IsInFollow_Yes;
              default:
                if (is_if_in(k)) return IsInFollow_Yes;
                return No(TOKENS);
            }
          }
          if (tok.$ === "MetaVarDecl" && tok.kind.$ === "Guard") return IsInFollow_Yes;
          return No(TOKENS);
        } else {
          const TOKENS: readonly string[] = ["`=>`", "`,`", "`=`", "`if`", "`if let`", "`in`"];
          if (tok.$ === "Token") {
            const k = tok._0.kind;
            switch (k.$) {
              case "FatArrow":
              case "Comma":
              case "Eq":
                return IsInFollow_Yes;
              default:
                if (is_if_in(k)) return IsInFollow_Yes;
                return No(TOKENS);
            }
          }
          if (tok.$ === "MetaVarDecl" && tok.kind.$ === "Guard") return IsInFollow_Yes;
          return No(TOKENS);
        }
      }
      case "Guard": {
        const TOKENS: readonly string[] = ["`=>`", "`,`", "`{`"];
        if (tok.$ === "Token") {
          switch (tok._0.kind.$) {
            case "FatArrow":
            case "Comma":
            case "OpenBrace":
              return IsInFollow_Yes;
            default:
              return No(TOKENS);
          }
        }
        return No(TOKENS);
      }
      case "Path":
      case "Ty": {
        const TOKENS: readonly string[] = ["`{`", "`[`", "`=>`", "`,`", "`>`", "`=`", "`:`", "`;`", "`|`", "`as`", "`where`"];
        if (tok.$ === "Token") {
          const k = tok._0.kind;
          switch (k.$) {
            case "OpenBrace":
            case "OpenBracket":
            case "Comma":
            case "FatArrow":
            case "Colon":
            case "Eq":
            case "Gt":
            case "Shr":
            case "Semi":
            case "Or":
              return IsInFollow_Yes;
            default:
              if (k.$ === "Ident" && (k._0 === kw.As || k._0 === kw.Where) && (k._1 === "Normal" || k._1 === "ForcedKeyword")) {
                return IsInFollow_Yes;
              }
              return No(TOKENS);
          }
        }
        if (tok.$ === "MetaVarDecl" && tok.kind.$ === "Block") return IsInFollow_Yes;
        return No(TOKENS);
      }
      case "Ident":
      case "Lifetime": {
        // being a single token, idents and lifetimes are harmless
        return IsInFollow_Yes;
      }
      case "Literal": {
        // literals may be of a single token, or two tokens (negative numbers)
        return IsInFollow_Yes;
      }
      case "Meta":
      case "TT": {
        // being either a single token or a delimited sequence, tt is
        // harmless
        return IsInFollow_Yes;
      }
      case "Vis": {
        // Explicitly disallow `priv`, on the off chance it comes back.
        const TOKENS: readonly string[] = ["`,`", "an ident", "a type"];
        if (tok.$ === "Token") {
          const token_ = tok._0;
          const k = token_.kind;
          if (k.$ === "Comma") return IsInFollow_Yes;
          if (k.$ === "Ident" && k._1 === "Raw") return IsInFollow_Yes;
          if (k.$ === "Ident" && k._0 !== kw.Priv) return IsInFollow_Yes;
          if (token_.can_begin_type()) {
            return IsInFollow_Yes;
          } else {
            return No(TOKENS);
          }
        }
        if (tok.$ === "MetaVarDecl" && (tok.kind.$ === "Ident" || tok.kind.$ === "Ty" || tok.kind.$ === "Path")) {
          return IsInFollow_Yes;
        }
        return No(TOKENS);
      }
    }
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1844 quoted_tt_to_string
function quoted_tt_to_string(tt: mbe.TokenTree): string {
  switch (tt.$) {
    case "Token":
      return pprust.token_to_string(tt._0);
    case "MetaVar":
      return `$${display_Ident(tt._1)}`;
    case "MetaVarDecl":
      return `$${display_Ident(tt.name)}:${display_NonterminalKind(tt.kind)}`;
    default:
      return panic("unexpected mbe::TokenTree::{Sequence or Delimited} in follow set checker");
  }
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1857 is_defined_in_current_crate
function is_defined_in_current_crate(node_id: NodeId): boolean {
  // Macros defined in the current crate have a real node id,
  // whereas macros from an external crate have a dummy id.
  return node_id !== DUMMY_NODE_ID;
}

// rustc: compiler/rustc_expand/src/mbe/macro_rules.rs:1863 parser_from_cx
export function parser_from_cx(psess: ParseSess, tts: TokenStream, recovery: Recovery): Parser {
  tts.desugar_doc_comments();
  return Parser.new(psess, tts, MACRO_ARGUMENTS).recovery(recovery);
}

