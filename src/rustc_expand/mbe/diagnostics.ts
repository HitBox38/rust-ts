// Port of compiler/rustc_expand/src/mbe/diagnostics.rs
//
// PORT: types are hand-written (no codegen set covers this file yet). `ExplainDocComment`
// (`#[derive(Subdiagnostic)]`) is a stand-in until tools/codegen generates this file's derive
// (see docs/handoff/mbe-b.md).

import "../../rustc_parse/lib.ts";
import { token } from "../../rustc_ast/lib.ts";
import type { Token } from "../../rustc_ast/token.ts";
import type { TokenStream } from "../../rustc_ast/tokenstream.ts";
import { default_CustomDiagnostic, type FormatArgs } from "../../rustc_attr_ir/diagnostic.gen.ts";
import type { CustomDiagnostic, Directive } from "../../rustc_attr_ir/diagnostic.ts";
import "../../rustc_attr_ir/diagnostic.ts";
import { Applicability, type Diag, type DiagCtxtHandle, type ErrorGuaranteed, pluralize } from "../../rustc_errors/lib.ts";
import type { Subdiagnostic } from "../../rustc_errors/diagnostic.ts";
import { type Parser, type Recovery, token_descr } from "../../rustc_parse/parser/mod.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import type { SourceMap } from "../../rustc_span/source_map.ts";
import { display_Ident, type Ident, Symbol } from "../../rustc_span/symbol.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import type { AstFragmentKind } from "../expand.ts";
import { parse_ast_fragment } from "../expand.ts";
import { display_MatcherLoc, MatcherLoc, type NamedParseResult, CowParser, TtParser } from "./macro_parser.ts";
import {
  type MacroRule,
  NoopTracker,
  parser_from_cx,
  type Tracker,
  try_match_macro,
  try_match_macro_attr,
  try_match_macro_derive,
  WhichMatcher,
  WhichMatcher_discriminant,
} from "./macro_rules.ts";

const { TokenKind: TokenKind_ } = token;

// rustc-type: compiler/rustc_expand/src/mbe/diagnostics.rs:23 FailedMacro
export type FailedMacro = { readonly $: "Func" } | { readonly $: "Attr"; _0: TokenStream } | { readonly $: "Derive" };
export const FailedMacro = {
  Func: Object.freeze({ $: "Func" as const }),
  Attr(_0: TokenStream): FailedMacro {
    return { $: "Attr", _0 };
  },
  Derive: Object.freeze({ $: "Derive" as const }),
};

// rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:29 failed_to_match_macro
export function failed_to_match_macro(
  psess: ParseSess,
  sp: Span,
  def_span: Span,
  name: Ident,
  args: FailedMacro,
  body: TokenStream,
  rules: readonly MacroRule[],
  on_unmatched_args: Directive | undefined,
): [Span, ErrorGuaranteed] {
  // debug!("failed to match macro");
  const def_head_span = !Span.is_dummy(def_span) && !psess.source_map().is_imported(def_span) ? psess.source_map().guess_head_span(def_span) : DUMMY_SP;

  // An error occurred, try the expansion again, tracking the expansion closely for better
  // diagnostics.
  const tracker = CollectTrackerAndEmitter.new(name, psess.dcx(), sp);

  let try_success_result;
  switch (args.$) {
    case "Func":
      try_success_result = try_match_macro(psess, body, rules, tracker);
      break;
    case "Attr": {
      const attr_args = args._0;
      try_success_result = try_match_macro_attr(psess, attr_args, body, rules, tracker);
      break;
    }
    case "Derive":
      try_success_result = try_match_macro_derive(psess, body, rules, tracker);
      break;
  }

  if (try_success_result.$ === "Ok") {
    // Nonterminal parser recovery might turn failed matches into successful ones,
    // but for that it must have emitted an error already
    assert(tracker.dcx.has_errors() !== undefined, "Macro matching returned a success on the second try");
  }

  if (tracker.result !== undefined) {
    // An irrecoverable error occurred and has been emitted.
    return tracker.result;
  }

  if (tracker.best_failure === undefined) {
    return [sp, psess.dcx().span_delayed_bug(sp, "failed to match a macro")];
  }
  const { token: token_, msg: label, remaining_matcher } = tracker.best_failure;

  const span = Span.substitute_dummy(token_.span, sp);
  const {
    message: custom_message,
    label: custom_label,
    notes: custom_notes,
  }: CustomDiagnostic =
    on_unmatched_args !== undefined
      ? on_unmatched_args.eval(undefined, {
          this: display_Ident(name),
          // PORT: the default field values of `FormatArgs` (`..`), written out.
          this_resolved: "",
          this_path: "",
          found: "",
          expected: "",
          unresolved: "",
          item_context: "",
          generic_args: [],
        } satisfies FormatArgs)
      : default_CustomDiagnostic();

  let err: Diag;
  if (custom_message !== undefined) {
    err = psess.dcx().struct_span_err(span, custom_message);
  } else {
    err = psess.dcx().struct_span_err(span, parse_failure_msg(token_, undefined));
  }
  err.span_label(span, custom_label ?? label);
  if (!Span.is_dummy(def_head_span)) {
    err.span_label(def_head_span, "when calling this macro");
  }

  annotate_doc_comment(err, psess.source_map(), span);

  const rm_span = MatcherLoc.span(remaining_matcher);
  if (rm_span !== undefined) {
    err.span_note(rm_span, `while trying to match ${display_MatcherLoc(remaining_matcher)}`);
  } else {
    err.note(`while trying to match ${display_MatcherLoc(remaining_matcher)}`);
  }
  for (const note of custom_notes) {
    err.note(note);
  }

  if (
    remaining_matcher.$ === "Token" &&
    (remaining_matcher.token.kind.$ === "OpenInvisible" || token_.kind.$ === "OpenInvisible")
  ) {
    err.note("captured metavariables except for `:tt`, `:ident` and `:lifetime` cannot be compared to other tokens");
    err.note(
      "see <https://doc.rust-lang.org/nightly/reference/macros-by-example.html#forwarding-a-matched-fragment> for more information",
    );

    if (!Span.is_dummy(def_span) && !psess.source_map().is_imported(def_span)) {
      err.help("try using `:tt` instead in the macro definition");
    }
  }

  // Check whether there's a missing comma in this macro call, like `println!("{}" a);`
  let comma: [TokenStream, Span] | undefined;
  if (args.$ === "Func" && (comma = body.add_comma()) !== undefined) {
    const [body, comma_span] = comma;
    for (const rule of rules) {
      if (rule.$ !== "Func") continue;
      const lhs = rule.lhs;
      const parser = parser_from_cx(psess, body.clone(), "Allowed");
      const tt_parser = TtParser.new();

      if (tt_parser.parse_tt(CowParser.Borrowed(parser), lhs, new NoopTracker()).$ === "Success") {
        if (Span.is_dummy(comma_span)) {
          err.note("you might be missing a comma");
        } else {
          err.span_suggestion_short(comma_span, "missing comma here", ", ", Applicability.MachineApplicable);
        }
      }
    }
  }
  const guar = err.emit_err();
  return [sp, guar];
}

/// The tracker used for the slow error path that collects useful info for diagnostics.
// rustc-type: compiler/rustc_expand/src/mbe/diagnostics.rs:148 CollectTrackerAndEmitter
class CollectTrackerAndEmitter implements Tracker {
  constructor(
    public macro_name: Ident,
    public dcx: DiagCtxtHandle,

    /// The matcher currently being parsed.
    //
    // FIXME: Factor out a per-arm `Tracker` so that the `Option` is unnecessary.
    public current: [WhichMatcher, readonly MatcherLoc[]] | undefined,

    /// Matches of [`MatcherLoc`]s that successfully consumed input from the parser.
    ///
    /// This accumulates all calls to [`Tracker::matched_one()`]. It is used to identify all
    /// competing matches for ambiguity errors.
    // PORT: `FxHashSet<SuccessfulMatch>` keyed by `input_pos:loc_index`; its only reader filters on one
    // `input_pos` and sorts by `loc_index`, so the iteration order never shows.
    public matches: Map<string, SuccessfulMatch>,

    public remaining_matcher: MatcherLoc | undefined,
    /// Which arm's failure should we report? (the one furthest along)
    public best_failure: BestFailure | undefined,
    public root_span: Span,
    public result: [Span, ErrorGuaranteed] | undefined,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:203 prepare
  prepare(which_matcher: WhichMatcher, matcher: readonly MatcherLoc[]): void {
    if (this.current !== undefined) {
      panic("`Self::after_arm()` was not called to clean up context");
    }

    this.current = [which_matcher, matcher];
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:211 before_match_loc
  before_match_loc(parser: TtParser, matcher: MatcherLoc): void {
    if (this.remaining_matcher === undefined || (parser.has_no_remaining_items_for_step() && matcher.$ !== "Eof")) {
      this.remaining_matcher = matcher;
    }
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:219 matched_one
  matched_one(parser: Parser, loc_index: number): void {
    const input_pos = parser.approx_token_stream_pos();
    // `loc_index.try_into().unwrap()`: a matcher index always fits a `u32`.
    const m: SuccessfulMatch = { input_pos, loc_index };
    this.matches.set(`${input_pos}:${loc_index}`, m);
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:226 after_arm
  after_arm(result: NamedParseResult): void {
    switch (result.$) {
      case "Success": {
        // Nonterminal parser recovery might turn failed matches into successful ones,
        // but for that it must have emitted an error already
        this.dcx.span_delayed_bug(this.root_span, "should not collect detailed info for successful macro match");
        break;
      }
      case "Failure": {
        if (this.best_failure === undefined) {
          panic("A matching failure occurred but `Self::failure()` was not called");
        }
        break;
      }
      case "Ambiguity": {
        if (this.result === undefined) {
          panic("An ambiguity error occurred but `Self::ambiguity()` was not called");
        }
        break;
      }
      case "ErrorReported":
        this.result = [this.root_span, result._0];
        break;
    }

    this.current = undefined;
    this.matches.clear();
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:253 failure
  failure(parser: Parser): void {
    if (this.current === undefined) {
      panic("`Self::prepare()` was not called to initialize context");
    }
    const [which_matcher] = this.current;

    // PORT: `let mut token = parser.token;` (`Token` is `Copy`); the span change below builds a new `Token`.
    let token_ = parser.token;
    const approx_position = parser.approx_token_stream_pos();
    let msg: string;
    if (token_.kind.$ === "Eof") {
      // FIXME: Can this be factored out of the EOF case?
      if (!Span.is_dummy(token_.span)) {
        token_ = token.Token.new(token_.kind, Span.shrink_to_hi(token_.span));
      }
      msg = "missing tokens in macro arguments";
    } else {
      msg = "no rules expected this token in macro call";
    }

    // debug!(?token, ?msg, "a new failure of an arm");

    if (this.best_failure === undefined || this.best_failure.is_better_position(which_matcher, approx_position)) {
      if (this.remaining_matcher === undefined) panic("must have collected matcher already");
      this.best_failure = new BestFailure(token_, which_matcher, approx_position, msg, this.remaining_matcher);
    }
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:290 ambiguity
  ambiguity(parser: Parser): void {
    if (this.current === undefined) {
      panic("`Self::prepare()` was not called to initialize context");
    }
    const [, matcher] = this.current;

    // #[expect(rustc::potential_query_instability, reason = "sorting the results deterministically afterwards")]
    const bb_locs: SuccessfulMatch[] = [];
    const next_locs: SuccessfulMatch[] = [];
    for (const m of this.matches.values()) {
      if (m.input_pos !== parser.approx_token_stream_pos()) continue;
      const loc = matcher[m.loc_index]!;
      if (loc.$ === "MetaVarDecl") {
        bb_locs.push(m);
      } else {
        next_locs.push(m);
      }
    }

    // Use a reasonable and deterministic ordering for data in the error message.
    bb_locs.sort((a, b) => a.loc_index - b.loc_index);
    next_locs.sort((a, b) => a.loc_index - b.loc_index);

    const span = Span.substitute_dummy(parser.token.span, this.root_span);

    if (parser.token.eq(TokenKind_.Eof)) {
      const msg = "ambiguity: multiple successful parses";
      const guar = this.dcx.span_err(span, msg);
      this.result = [span, guar];
      return;
    }

    const nts = bb_locs
      .map((m) => {
        const loc = matcher[m.loc_index]!;
        if (loc.$ !== "MetaVarDecl") return unreachable();
        return `${token.display_NonterminalKind(loc.kind)} ('${display_Ident(loc.bind)}')`;
      })
      .join(" or ");

    const n = next_locs.length;
    const msg = `local ambiguity when calling macro \`${display_Ident(this.macro_name)}\`: multiple parsing options: ${
      n === 0 ? `built-in NTs ${nts}.` : `built-in NTs ${nts} or ${n} other option${pluralize(n)}.`
    }`;

    const guar = this.dcx.span_err(span, msg);
    this.result = [span, guar];
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:344 description
  description(): string {
    return "detailed";
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:348 recovery
  recovery(): Recovery {
    return "Allowed";
  }

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:354 new
  static new(macro_name: Ident, dcx: DiagCtxtHandle, root_span: Span): CollectTrackerAndEmitter {
    return new CollectTrackerAndEmitter(macro_name, dcx, undefined, new Map(), undefined, undefined, root_span, undefined);
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/diagnostics.rs:171 SuccessfulMatch
interface SuccessfulMatch {
  /// The position in the parser.
  ///
  /// As per [`Parser::approx_token_stream_pos()`].
  input_pos: number;

  /// The index of the [`MatcherLoc`].
  loc_index: number;
}

// rustc-type: compiler/rustc_expand/src/mbe/diagnostics.rs:181 BestFailure
class BestFailure {
  constructor(
    public token: Token,

    /// The matcher in which the failure occurred.
    public matcher: WhichMatcher,

    /// The approximate (parser) position of the failure.
    ///
    /// This is relative to [`Self::matcher`].
    public position: number,

    public msg: string,
    public remaining_matcher: MatcherLoc,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:197 is_better_position
  is_better_position(matcher: WhichMatcher, position: number): boolean {
    // `(matcher, position) > (self.matcher, self.position)`
    const a = WhichMatcher_discriminant[matcher];
    const b = WhichMatcher_discriminant[this.matcher];
    return a !== b ? a > b : position > this.position;
  }
}

// rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:368 emit_frag_parse_err
export function emit_frag_parse_err(
  e: Diag,
  parser: Parser,
  orig_parser: Parser,
  site_span: Span,
  arm_span: Span,
  kind: AstFragmentKind,
  bindings: readonly MacroRule[],
  matched_rule_bindings: readonly MatcherLoc[],
): ErrorGuaranteed {
  // FIXME(davidtwco): avoid depending on the error message text
  const inner = e.deref();
  const m0 = inner.messages[0]!;
  if (parser.token.eq(TokenKind_.Eof) && m0[0].$ === "Str" && m0[0]._0.endsWith(", found `<eof>`")) {
    const message = m0[0]._0;
    const msg = m0;
    inner.messages[0] = [{ $: "Str", _0: `macro expansion ends with an incomplete expression: ${message.replaceAll(", found `<eof>`", "")}` }, msg[1]];
    if (!inner.span.is_dummy()) {
      // early end of macro arm (#52866)
      e.replace_span_with(Span.shrink_to_hi(parser.token.span), true);
    }
  }
  if (e.deref().span.is_dummy()) {
    // Get around lack of span in error (#30128)
    e.replace_span_with(site_span, true);
    if (!parser.psess.source_map().is_imported(arm_span)) {
      e.span_label(arm_span, "in this macro arm");
    }
  } else if (parser.psess.source_map().is_imported(parser.token.span)) {
    e.span_label(site_span, "in this macro invocation");
  }
  switch (kind) {
    // Try a statement if an expression is wanted but failed and suggest adding `;` to call.
    case "Expr": {
      const r = parse_ast_fragment(orig_parser, "Stmts");
      if (r.$ === "Err") {
        r._0.cancel();
      } else {
        e.note("the macro call doesn't expand to an expression, but it can expand to a statement");

        if (parser.token.eq(TokenKind_.Semi)) {
          const snippet = parser.psess.source_map().span_to_snippet(site_span);
          if (snippet.$ === "Ok") {
            e.span_suggestion_verbose(
              site_span,
              "surround the macro invocation with `{}` to interpret the expansion as a statement",
              `{ ${snippet._0.toString()}; }`,
              Applicability.MaybeIncorrect,
            );
          }
        } else {
          e.span_suggestion_verbose(Span.shrink_to_hi(site_span), "add `;` to interpret the expansion as a statement", ";", Applicability.MaybeIncorrect);
        }
      }
      break;
    }
    default:
      annotate_err_with_kind(e, kind, site_span);
      break;
  }

  if (parser.token.kind.$ === "Dollar") {
    const dollar_span = parser.token.span;
    parser.bump();
    const k = parser.token.kind;
    if (k.$ === "Ident") {
      const name = k._0;
      const metavar_span = Span.to(dollar_span, parser.token.span);
      const bindings_names: Symbol[] = [];
      for (const rule of bindings) {
        if (rule.$ !== "Func") continue;
        for (const param of rule.lhs) {
          if (param.$ !== "MetaVarDecl") continue;
          bindings_names.push(param.bind.name);
        }
      }

      const matched_rule_bindings_names: Symbol[] = [];
      for (const param of matched_rule_bindings) {
        if (param.$ !== "MetaVarDecl") continue;
        matched_rule_bindings_names.push(param.bind.name);
      }

      // Report the unbound metavariable as the primary error up front, so every
      // case is consistent regardless of which suggestion (if any) we attach below.
      e.primary_message(`cannot find macro parameter \`$${Symbol.as_str(name)}\` in this scope`);
      e.span(metavar_span);
      e.span_label(metavar_span, "not found in this scope");
      if (parser.psess.source_map().is_imported(metavar_span)) {
        e.span_label(site_span, "in this macro invocation");
      }

      let matched_name: Symbol | undefined;
      if ((matched_name = find_best_match_for_name(matched_rule_bindings_names, name, undefined)) !== undefined) {
        e.span_suggestion_verbose(parser.token.span, "there is a macro metavariable with a similar name", Symbol.as_str(matched_name), Applicability.MaybeIncorrect);
      } else if (bindings_names.includes(name)) {
        e.span_label(parser.token.span, "there is an macro metavariable with this name in another macro matcher");
      } else if ((matched_name = find_best_match_for_name(bindings_names, name, undefined)) !== undefined) {
        e.span_suggestion_verbose(
          parser.token.span,
          "there is a macro metavariable with a similar name in another macro matcher",
          Symbol.as_str(matched_name),
          Applicability.MaybeIncorrect,
        );
      } else if (matched_rule_bindings_names.length !== 0) {
        const msg = matched_rule_bindings_names.map((sym) => `$${Symbol.as_str(sym)}`).join(", ");
        e.note(`available metavariable names are: ${msg}`);
      }
    }
  }
  return e.emit_err();
}

// rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:503 annotate_err_with_kind
export function annotate_err_with_kind(err: Diag, kind: AstFragmentKind, span: Span): void {
  switch (kind) {
    case "Ty":
      err.span_label(span, "this macro call doesn't expand to a type");
      break;
    case "Pat":
      err.span_label(span, "this macro call doesn't expand to a pattern");
      break;
    default:
      break;
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/diagnostics.rs:516 ExplainDocComment
type ExplainDocComment = { readonly $: "Inner"; span: Span } | { readonly $: "Outer"; span: Span };
// PORT: pending codegen of this file's `#[derive(Subdiagnostic)]` (see the header).
function ExplainDocComment_subdiagnostic(_self: ExplainDocComment): Subdiagnostic {
  return { add_to_diag: () => unported("rustc_expand::mbe::diagnostics::ExplainDocComment (derive(Subdiagnostic) codegen)") };
}

// rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:533 annotate_doc_comment
function annotate_doc_comment(err: Diag, sm: SourceMap, span: Span): void {
  const r = sm.span_to_snippet(span);
  if (r.$ === "Ok") {
    const src = r._0;
    if (src.starts_with("///") || src.starts_with("/**")) {
      err.subdiagnostic(ExplainDocComment_subdiagnostic({ $: "Outer", span }));
    } else if (src.starts_with("//!") || src.starts_with("/*!")) {
      err.subdiagnostic(ExplainDocComment_subdiagnostic({ $: "Inner", span }));
    }
  }
}

/// Generates an appropriate parsing failure message. For EOF, this is "unexpected end...". For
/// other tokens, this is "unexpected token...".
// rustc: compiler/rustc_expand/src/mbe/diagnostics.rs:545 parse_failure_msg
function parse_failure_msg(tok: Token, expected_token: Token | undefined): string {
  if (expected_token !== undefined) {
    return `expected ${token_descr(expected_token)}, found ${token_descr(tok)}`;
  } else {
    switch (tok.kind.$) {
      case "Eof":
        return "unexpected end of macro invocation";
      default:
        return `no rules expected ${token_descr(tok)}`;
    }
  }
}
