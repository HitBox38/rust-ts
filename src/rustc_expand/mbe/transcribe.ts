// Port of compiler/rustc_expand/src/mbe/transcribe.rs
//
// PORT: types are hand-written (rustc_expand has no codegen set); none of them derives Debug.
// `FxHashMap<MacroRulesNormalizedIdent, NamedMatch>` is `NamedMatches` (macro_parser.ts
// `MacroRulesIdentMap`, iterating in hashbrown bucket order; `transcribe_sequence` is the one place that
// iterates it).

import "../../rustc_parse/lib.ts";
import { ast, HasAttrs, HasTokens, token, tokenstream } from "../../rustc_ast/lib.ts";
import type { Delimiter, MetaVarKind, Token, TokenKind } from "../../rustc_ast/token.ts";
import type { DelimSpacing, DelimSpan, Spacing, TokenStream, TokenTree } from "../../rustc_ast/tokenstream.ts";
import { type Diag, type DiagCtxtHandle, listify, type PResult, pluralize } from "../../rustc_errors/lib.ts";
import { is_ident } from "../../rustc_lexer/lib.ts";
import { nfc_normalize } from "../../rustc_parse/lexer/mod.ts";
import type { ParseNtResult } from "../../rustc_parse/parser/mod.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import { find_best_match_for_name } from "../../rustc_span/edit_distance.ts";
import { type LocalExpnId, LocalExpnId as LocalExpnId_, SyntaxContext, type Transparency } from "../../rustc_span/hygiene.ts";
import { BytePos, Span, with_metavar_spans } from "../../rustc_span/lib.ts";
import { display_MacroRulesNormalizedIdent, Ident, kw, MacroRulesNormalizedIdent, sym, Symbol } from "../../rustc_span/symbol.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import { type Delimited, type KleeneOp, type MetaVarExpr, type SequenceRepetition, TokenTree as MbeTokenTree } from "../mbe.ts";
import type * as mbe from "../mbe.ts";
import type { NamedMatch, NamedMatches } from "./macro_parser.ts";
import { NamedMatch as NamedMatch_ } from "./macro_parser.ts";
import { MetaVarExpr as MetaVarExpr_, type MetaVarExprConcatElem, validate_ident_kind } from "./metavar_expr.ts";

const { DelimSpan: DelimSpan_, DelimSpacing: DelimSpacing_, TokenStream: TokenStream_, TokenTree: TokenTree_, clone_DelimSpan, debug_WithTokens } = tokenstream;
const { LitKind: LitKind_, Token: Token_, TokenKind: TokenKind_ } = token;

import {
  ConcatInvalidIdent_diagnostic,
  CountRepetitionMisplaced_diagnostic,
  InvalidIdentReason,
  MacroVarStillRepeating_diagnostic,
  MetaVarsDifSeqMatchers_diagnostic,
  MustRepeatOnce_diagnostic,
  MveUnrecognizedVar_diagnostic,
  type NoRepeatableVar,
  NoSyntaxVarsExprRepeat_diagnostic,
  type VarNoTypo,
  type VarTypoSuggestionRepeatable,
  type VarTypoSuggestionUnrepeatable,
  type VarTypoSuggestionUnrepeatableLabel,
} from "../diagnostics.ts";

/// Context needed to perform transcription of metavariable expressions.
// rustc-type: compiler/rustc_expand/src/mbe/transcribe.rs:32 TranscrCtx
class TranscrCtx {
  constructor(
    public psess: ParseSess,

    /// Map from metavars to matched tokens
    public interp: NamedMatches,

    /// Allow marking spans.
    public marker: Marker,

    /// The stack of things yet to be completely expanded.
    ///
    /// We descend into the RHS (`src`), expanding things as we go. This stack contains the things
    /// we have yet to expand/are still expanding. We start the stack off with the whole RHS. The
    /// choice of spacing values doesn't matter.
    public stack: Frame[],

    /// A stack of where we are in the repeat expansion.
    ///
    /// As we descend in the RHS, we will need to be able to match nested sequences of matchers.
    /// `repeats` keeps track of where we are in matching at each level, with the last element
    /// being the most deeply nested sequence. This is used as a stack.
    public repeats: [number, number][],

    /// The resulting token stream from the `TokenTree` we just finished processing.
    ///
    /// At the end, this will contain the full result of transcription, but at arbitrary points
    /// during `transcribe`, `result` will contain subsets of the final result.
    ///
    /// Specifically, as we descend into each TokenTree, we will push the existing results onto the
    /// `result_stack` and clear `results`. We will then produce the results of transcribing the
    /// TokenTree into `results`. Then, as we unwind back out of the `TokenTree`, we will pop the
    /// `result_stack` and append `results` too it to produce the new `results` up to that point.
    ///
    /// Thus, if we try to pop the `result_stack` and it is empty, we have reached the top-level
    /// again, and we are done transcribing.
    public result: TokenTree[],

    /// The in-progress `result` lives at the top of this stack. Each entered `TokenTree` adds a
    /// new entry.
    public result_stack: TokenTree[][],
  ) {}

  /// Span marked with the correct expansion and transparency.
  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:76 visited_dspan
  visited_dspan(dspan: DelimSpan): Span {
    const span = { value: dspan.entire() };
    this.marker.mark_span(span);
    return span.value;
  }
}

/// A Marker adds the given mark to the syntax context.
// rustc-type: compiler/rustc_expand/src/mbe/transcribe.rs:84 Marker
class Marker {
  constructor(
    public expand_id: LocalExpnId,
    public transparency: Transparency,
    // Most macro bodies have only one context. Keep that entry inline and
    // allocate the map only for additional contexts in generated macros.
    public cache: [SyntaxContext, SyntaxContext] | undefined,
    public fallback_cache: Map<SyntaxContext, SyntaxContext>,
  ) {}

  /// Mark a span with the stored expansion ID and transparency.
  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:95 mark_span
  mark_span(span: MutRef<Span>): void {
    // `apply_mark` is a relatively expensive operation, both due to taking hygiene lock, and
    // by itself. All tokens in a macro body typically have the same syntactic context, unless
    // it's some advanced case with macro-generated macros. So if we cache the marked version
    // of that context once, we'll typically have a 100% cache hit rate after that.
    span.value = Span.map_ctxt(span.value, (ctxt) => {
      const cache = this.cache;
      if (cache !== undefined && cache[0] === ctxt) {
        return cache[1];
      } else if (cache === undefined) {
        const marked = SyntaxContext.apply_mark(ctxt, LocalExpnId_.to_expn_id(this.expand_id), this.transparency);
        this.cache = [ctxt, marked];
        return marked;
      } else {
        let marked = this.fallback_cache.get(ctxt);
        if (marked === undefined) {
          marked = SyntaxContext.apply_mark(ctxt, LocalExpnId_.to_expn_id(this.expand_id), this.transparency);
          this.fallback_cache.set(ctxt, marked);
        }
        return marked;
      }
    });
  }
}

/// An iterator over the token trees in a delimited token tree (`{ ... }`) or a sequence (`$(...)`).
// rustc-type: compiler/rustc_expand/src/mbe/transcribe.rs:116 Frame
class Frame {
  constructor(
    public tts: readonly mbe.TokenTree[],
    public idx: number,
    public kind: FrameKind,
  ) {}

  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:128 new_delimited
  static new_delimited(src: Delimited, span: DelimSpan, spacing: DelimSpacing): Frame {
    return new Frame(src.tts, 0, { $: "Delimited", delim: src.delim, span, spacing });
  }

  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:136 new_sequence
  static new_sequence(src: SequenceRepetition, sep: Token | undefined, kleene_op: KleeneOp): Frame {
    return new Frame(src.tts, 0, { $: "Sequence", sep, kleene_op });
  }

  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:148 next
  next(): mbe.TokenTree | undefined {
    const res = this.tts[this.idx];
    this.idx += 1;
    return res;
  }
}

// rustc-type: compiler/rustc_expand/src/mbe/transcribe.rs:122 FrameKind
type FrameKind =
  | { readonly $: "Delimited"; delim: Delimiter; span: DelimSpan; spacing: DelimSpacing }
  | { readonly $: "Sequence"; sep: Token | undefined; kleene_op: KleeneOp };

/// This can do Macro-By-Example transcription.
/// - `interp` is a map of meta-variables to the tokens (non-terminals) they matched in the
///   invocation. We are assuming we already know there is a match.
/// - `src` is the RHS of the MBE, that is, the "example" we are filling in.
///
/// For example,
///
/// ```rust
/// macro_rules! foo {
///     ($id:ident) => { println!("{}", stringify!($id)); }
/// }
///
/// foo!(bar);
/// ```
///
/// `interp` would contain `$id => bar` and `src` would contain `println!("{}", stringify!($id));`.
///
/// `transcribe` would return a `TokenStream` containing `println!("{}", stringify!(bar));`.
///
/// Along the way, we do some additional error checking.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:175 transcribe
export function transcribe(
  psess: ParseSess,
  interp: NamedMatches,
  src: Delimited,
  src_span: DelimSpan,
  transparency: Transparency,
  expand_id: LocalExpnId,
): PResult<TokenStream> {
  // Nothing for us to transcribe...
  if (src.tts.length === 0) {
    return Ok(TokenStream_.default());
  }

  const tscx = new TranscrCtx(
    psess,
    interp,
    new Marker(expand_id, transparency, undefined, new Map()),
    [Frame.new_delimited(src, src_span, DelimSpacing_.new("Alone", "Alone"))],
    [],
    [],
    [],
  );

  for (;;) {
    // Look at the last frame on the stack.
    // If it still has a TokenTree we have not looked at yet, use that tree.
    const tree = unwrap(tscx.stack[tscx.stack.length - 1]).next();
    if (tree === undefined) {
      // This else-case never produces a value for `tree` (it `continue`s or `return`s).

      // Otherwise, if we have just reached the end of a sequence and we can keep repeating,
      // go back to the beginning of the sequence.
      const frame = unwrap(tscx.stack[tscx.stack.length - 1]);
      if (frame.kind.$ === "Sequence") {
        const sep = frame.kind.sep;
        const repeat = unwrap(tscx.repeats[tscx.repeats.length - 1]);
        repeat[0] += 1;
        if (repeat[0] < repeat[1]) {
          frame.idx = 0;
          if (sep !== undefined) {
            tscx.result.push({ $: "Token", _0: sep, _1: "Alone" });
          }
          continue;
        }
      }

      // We are done with the top of the stack. Pop it. Depending on what it was, we do
      // different things. Note that the outermost item must be the delimited, wrapped RHS
      // that was passed in originally to `transcribe`.
      const kind = unwrap(tscx.stack.pop()).kind;
      switch (kind.$) {
        // Done with a sequence. Pop from repeats.
        case "Sequence": {
          tscx.repeats.pop();
          break;
        }

        // We are done processing a Delimited. If this is the top-level delimited, we are
        // done. Otherwise, we unwind the result_stack to append what we have produced to
        // any previous results.
        case "Delimited": {
          const { delim, span } = kind;
          // PORT: `mut spacing`: `DelimSpacing` is `Copy`; the frame's value is copied.
          const spacing = DelimSpacing_.new(kind.spacing.open, kind.spacing.close);
          // Hack to force-insert a space after `]` in certain case.
          // See discussion of the `hex-literal` crate in #114571.
          if (delim.$ === "Bracket") {
            spacing.close = "Alone";
          }
          if (tscx.result_stack.length === 0) {
            // No results left to compute! We are back at the top-level.
            return Ok(TokenStream_.new(tscx.result));
          }

          // Step back into the parent Delimited.
          const tree: TokenTree = { $: "Delimited", _0: span, _1: spacing, _2: delim, _3: TokenStream_.new(tscx.result) };
          tscx.result = unwrap(tscx.result_stack.pop());
          tscx.result.push(tree);
          break;
        }
      }
      continue;
    }

    // At this point, we know we are in the middle of a TokenTree (the last one on `stack`).
    // `tree` contains the next `TokenTree` to be processed.
    switch (tree.$) {
      // Replace the sequence with its expansion.
      case "Sequence": {
        const seq = tree;
        const seq_rep = tree._1;
        const r = transcribe_sequence(tscx, seq, seq_rep, interp);
        if (r.$ === "Err") return r;
        break;
      }

      // Replace the meta-var with the matched token tree from the invocation.
      case "MetaVar": {
        const sp = tree._0;
        const original_ident = tree._1;
        const r = transcribe_metavar(tscx, sp, original_ident);
        if (r.$ === "Err") return r;
        break;
      }

      // Replace meta-variable expressions with the result of their expansion.
      case "MetaVarExpr": {
        const r = transcribe_metavar_expr(tscx, tree._0, tree._1);
        if (r.$ === "Err") return r;
        break;
      }

      // If we are entering a new delimiter, we push its contents to the `stack` to be
      // processed, and we push all of the currently produced results to the `result_stack`.
      // We will produce all of the results of the inside of the `Delimited` and then we will
      // jump back out of the Delimited, pop the result_stack and add the new results back to
      // the previous results (from outside the Delimited).
      case "Delimited": {
        // PORT: `mut span`: `DelimSpan` is `Copy`; the matcher's value is copied.
        const span = clone_DelimSpan(tree._0);
        const spacing = tree._1;
        const delimited = tree._2;
        const open = { value: span.open };
        tscx.marker.mark_span(open);
        span.open = open.value;
        const close = { value: span.close };
        tscx.marker.mark_span(close);
        span.close = close.value;
        tscx.stack.push(Frame.new_delimited(delimited, span, spacing));
        tscx.result_stack.push(tscx.result);
        tscx.result = [];
        break;
      }

      // Nothing much to do here. Just push the token to the result, being careful to
      // preserve syntax context.
      case "Token": {
        // PORT: `mut token`: `Token` is `Copy`; a new `Token` is built (tokens are never mutated in place).
        const sp = { value: tree._0.span };
        tscx.marker.mark_span(sp);
        let kind = tree._0.kind;
        if (kind.$ === "NtIdent" || kind.$ === "NtLifetime") {
          const ident_span = { value: kind._0.span };
          tscx.marker.mark_span(ident_span);
          kind = { $: kind.$, _0: Ident.new(kind._0.name, ident_span.value), _1: kind._1 };
        }
        const tt = TokenTree_.token_alone(kind, sp.value);
        tscx.result.push(tt);
        break;
      }

      // There should be no meta-var declarations in the invocation of a macro.
      case "MetaVarDecl":
        panic("unexpected `TokenTree::MetaVarDecl`");
    }
  }
}

/// Turn `$(...)*` sequences into tokens.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:304 transcribe_sequence
function transcribe_sequence(
  tscx: TranscrCtx,
  seq: mbe.TokenTree,
  seq_rep: SequenceRepetition,
  // Used only for better diagnostics in the face of typos.
  interp: NamedMatches,
): PResult<undefined> {
  const dcx = tscx.psess.dcx();

  // We are descending into a sequence. We first make sure that the matchers in the RHS
  // and the matches in `interp` have the same shape. Otherwise, either the caller or the
  // macro writer has made a mistake.
  const size = lockstep_iter_size(seq, tscx.interp, tscx.repeats);
  switch (size.$) {
    case "Unconstrained": {
      const repeatables: MacroRulesNormalizedIdent[] = [];
      const non_repeatables: MacroRulesNormalizedIdent[] = [];

      // #[allow(rustc::potential_query_instability)]
      for (const [name, matcher] of interp.iter()) {
        if (NamedMatch_.is_repeatable(matcher)) {
          repeatables.push(name);
        } else {
          non_repeatables.push(name);
        }
      }

      const repeatable_names: Symbol[] = repeatables.map((name) => name.symbol());
      const non_repeatable_names: Symbol[] = non_repeatables.map((name) => name.symbol());
      const meta_vars: Ident[] = [];
      MbeTokenTree.meta_vars(seq, meta_vars);
      let typo_repeatable: VarTypoSuggestionRepeatable | undefined = undefined;
      let typo_unrepeatable: VarTypoSuggestionUnrepeatable | undefined = undefined;
      let typo_unrepeatable_label: VarTypoSuggestionUnrepeatableLabel | undefined = undefined;
      let var_no_typo: VarNoTypo | undefined = undefined;
      let no_repeatable_var: NoRepeatableVar | undefined = undefined;

      for (const ident of meta_vars) {
        let name: Symbol | undefined;
        let msg: string | undefined;
        if ((name = find_best_match_for_name(repeatable_names, ident.name, undefined)) !== undefined) {
          typo_repeatable = { span: ident.span, name };
        } else if ((name = find_best_match_for_name(non_repeatable_names, ident.name, undefined)) !== undefined) {
          typo_unrepeatable = { span: ident.span };
          const orig_ident = non_repeatables.find((n) => n.symbol() === name);
          if (orig_ident !== undefined) {
            typo_unrepeatable_label = {
              span: orig_ident.ident().span,
            };
          }
        } else {
          if (repeatable_names.length !== 0 && (msg = listify(repeatable_names, (s) => `\`$${Symbol.as_str(s)}\``)) !== undefined) {
            var_no_typo = { span: ident.span, msg };
          } else {
            no_repeatable_var = { span: ident.span };
          }
        }
      }
      return Err(
        dcx.create_err(
          NoSyntaxVarsExprRepeat_diagnostic({
            span: MbeTokenTree.span(seq),
            typo_unrepeatable,
            typo_repeatable,
            typo_unrepeatable_label,
            var_no_typo,
            no_repeatable_var,
          }),
        ),
      );
    }

    case "Contradiction": {
      const msg = size._0;
      // FIXME: this really ought to be caught at macro definition time... It
      // happens when two meta-variables are used in the same repetition in a
      // sequence, but they come from different sequence matchers and repeat
      // different amounts.
      return Err(dcx.create_err(MetaVarsDifSeqMatchers_diagnostic({ span: MbeTokenTree.span(seq), msg })));
    }

    case "Constraint": {
      const len = size._0;
      // We do this to avoid an extra clone above. We know that this is a
      // sequence already.
      if (seq.$ !== "Sequence") return unreachable();
      const sp = seq._0;
      const seq_ = seq._1;

      // Is the repetition empty?
      if (len === 0) {
        if (seq_.kleene.op === "OneOrMore") {
          // FIXME: this really ought to be caught at macro definition
          // time... It happens when the Kleene operator in the matcher and
          // the body for the same meta-variable do not match.
          return Err(dcx.create_err(MustRepeatOnce_diagnostic({ span: sp.entire() })));
        }
      } else {
        // 0 is the initial counter (we have done 0 repetitions so far). `len`
        // is the total number of repetitions we should generate.
        tscx.repeats.push([0, len]);

        // The first time we encounter the sequence we push it to the stack. It
        // then gets reused (see the beginning of the loop) until we are done
        // repeating.
        tscx.stack.push(Frame.new_sequence(seq_rep, seq_.separator, seq_.kleene.op));
      }
      break;
    }
  }

  return Ok(undefined);
}

/// Find the matched nonterminal from the macro invocation, and use it to replace
/// the meta-var.
///
/// We use `Spacing::Alone` everywhere here, because that's the conservative choice
/// and spacing of declarative macros is tricky. E.g. in this macro:
/// ```
/// macro_rules! idents {
///     ($($a:ident,)*) => { stringify!($($a)*) }
/// }
/// ```
/// `$a` has no whitespace after it and will be marked `JointHidden`. If you then
/// call `idents!(x,y,z,)`, each of `x`, `y`, and `z` will be marked as `Joint`. So
/// if you choose to use `$x`'s spacing or the identifier's spacing, you'll end up
/// producing "xyz", which is bad because it effectively merges tokens.
/// `Spacing::Alone` is the safer option. Fortunately, `space_between` will avoid
/// some of the unnecessary whitespace.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:433 transcribe_metavar
function transcribe_metavar(tscx: TranscrCtx, sp_: Span, original_ident_: Ident): PResult<undefined> {
  const dcx = tscx.psess.dcx();

  const ident = MacroRulesNormalizedIdent.new(original_ident_);
  const cur_matched = lookup_cur_matched(ident, tscx.interp, tscx.repeats);
  if (cur_matched === undefined) {
    // If we aren't able to match the meta-var, we push it back into the result but
    // with modified syntax context. (I believe this supports nested macros).
    const sp = { value: sp_ };
    tscx.marker.mark_span(sp);
    const ident_span = { value: original_ident_.span };
    tscx.marker.mark_span(ident_span);
    const original_ident = Ident.new(original_ident_.name, ident_span.value);
    tscx.result.push(TokenTree_.token_joint_hidden(TokenKind_.Dollar, sp.value));
    tscx.result.push({ $: "Token", _0: Token_.from_ast_ident(original_ident), _1: "Alone" });
    return Ok(undefined);
  }

  if (cur_matched.$ !== "MatchedSingle") {
    // We were unable to descend far enough. This is an error.
    return Err(dcx.create_err(MacroVarStillRepeating_diagnostic({ span: sp_, ident })));
  }
  const pnr = cur_matched._0;

  return transcribe_pnr(tscx, sp_, pnr);
}

// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:459 transcribe_pnr
function transcribe_pnr(tscx: TranscrCtx, sp_: Span, pnr: ParseNtResult): PResult<undefined> {
  const sp = { value: sp_ };
  // We wrap the tokens in invisible delimiters, unless they are already wrapped
  // in invisible delimiters with the same `MetaVarKind`. Because some proc
  // macros can't handle multiple layers of invisible delimiters of the same
  // `MetaVarKind`. This loses some span info, though it hopefully won't matter.
  const mk_delimited = (mk_span: Span, mv_kind: MetaVarKind, stream: TokenStream): TokenTree => {
    if (stream.len() === 1) {
      const tree = unwrap(stream.iter().next());
      if (tree.$ === "Delimited") {
        const delim = tree._2;
        const inner = tree._3;
        if (delim.$ === "Invisible" && delim._0.$ === "MetaVar" && token.MetaVarKind_eq(mv_kind, delim._0._0)) {
          stream = TokenStream_.new(inner._0);
        }
      }
    }

    // Emit as a token stream within `Delimiter::Invisible` to maintain
    // parsing priorities.
    tscx.marker.mark_span(sp);
    with_metavar_spans((mspans) => mspans.insert(mk_span, sp.value));
    // Both the open delim and close delim get the same span, which covers the
    // `$foo` in the decl macro RHS.
    return {
      $: "Delimited",
      _0: DelimSpan_.from_single(sp.value),
      _1: DelimSpacing_.new("Alone", "Alone"),
      _2: { $: "Invisible", _0: { $: "MetaVar", _0: mv_kind } },
      _3: stream,
    };
  };

  let tt: TokenTree;
  switch (pnr.$) {
    case "Tt": {
      // `tt`s are emitted into the output stream directly as "raw tokens",
      // without wrapping them into groups. Other variables are emitted into
      // the output stream as groups with `Delimiter::Invisible` to maintain
      // parsing priorities.
      tt = maybe_use_metavar_location(tscx.psess, tscx.stack, sp.value, pnr._0, tscx.marker);
      break;
    }
    case "Ident": {
      const ident = pnr._0;
      tscx.marker.mark_span(sp);
      with_metavar_spans((mspans) => mspans.insert(ident.span, sp.value));
      const kind: TokenKind = { $: "NtIdent", _0: ident, _1: pnr._1 };
      tt = TokenTree_.token_alone(kind, sp.value);
      break;
    }
    case "Lifetime": {
      const ident = pnr._0;
      tscx.marker.mark_span(sp);
      with_metavar_spans((mspans) => mspans.insert(ident.span, sp.value));
      const kind: TokenKind = { $: "NtLifetime", _0: ident, _1: pnr._1 };
      tt = TokenTree_.token_alone(kind, sp.value);
      break;
    }
    case "Item": {
      const item = pnr._0;
      tt = mk_delimited(item.span, MetaVarKind_Item, TokenStream_.from_ast(item, { tokens: HasTokens.Item.tokens, attrs: HasAttrs.Item.attrs, debug: debug_Item }));
      break;
    }
    case "Block": {
      const block = pnr._0;
      tt = mk_delimited(
        block.node.span,
        MetaVarKind_Block,
        TokenStream_.from_ast(block, { tokens: HasTokens.WithTokens<ast.Block>().tokens, attrs: HasAttrs.WithTokens(HasAttrs.Block).attrs, debug: (v, f) => debug_WithTokens(v, f, ast.debug_Block) }),
      );
      break;
    }
    case "Stmt": {
      const stmt = pnr._0;
      let stream: TokenStream;
      if (stmt.kind.$ === "Empty") {
        // FIXME: Properly collect tokens for empty statements.
        stream = TokenStream_.token_alone(TokenKind_.Semi, stmt.span);
      } else {
        stream = TokenStream_.from_ast(stmt, { tokens: HasTokens.Stmt.tokens, attrs: HasAttrs.Stmt.attrs, debug: ast.debug_Stmt });
      }
      tt = mk_delimited(stmt.span, MetaVarKind_Stmt, stream);
      break;
    }
    case "Pat": {
      const pat = pnr._0;
      tt = mk_delimited(
        pat.node.span,
        { $: "Pat", _0: pnr._1 },
        TokenStream_.from_ast(pat, { tokens: HasTokens.WithTokens<ast.Pat>().tokens, attrs: HasAttrs.WithTokens(HasAttrs.Pat).attrs, debug: (v, f) => debug_WithTokens(v, f, ast.debug_Pat) }),
      );
      break;
    }
    case "Expr": {
      const expr = pnr._0;
      let can_begin_literal_maybe_minus: boolean;
      let can_begin_string_literal: boolean;
      const ek = expr.kind;
      if (ek.$ === "Lit") {
        [can_begin_literal_maybe_minus, can_begin_string_literal] = [true, true];
      } else if (ek.$ === "Unary" && ek._0 === "Neg" && ek._1.kind.$ === "Lit") {
        [can_begin_literal_maybe_minus, can_begin_string_literal] = [true, false];
      } else {
        [can_begin_literal_maybe_minus, can_begin_string_literal] = [false, false];
      }
      tt = mk_delimited(
        expr.span,
        {
          $: "Expr",
          kind: pnr._1,
          can_begin_literal_maybe_minus,
          can_begin_string_literal,
        },
        TokenStream_.from_ast(expr, { tokens: HasTokens.Expr.tokens, attrs: HasAttrs.Expr.attrs, debug: ast.debug_Expr }),
      );
      break;
    }
    case "Literal": {
      const lit = pnr._0;
      tt = mk_delimited(lit.span, MetaVarKind_Literal, TokenStream_.from_ast(lit, { tokens: HasTokens.Expr.tokens, attrs: HasAttrs.Expr.attrs, debug: ast.debug_Expr }));
      break;
    }
    case "Ty": {
      const ty = pnr._0;
      const tk = ty.node.kind;
      const is_path = tk.$ === "Path" && tk._0 === undefined;
      tt = mk_delimited(
        ty.node.span,
        { $: "Ty", is_path },
        TokenStream_.from_ast(ty, { tokens: HasTokens.WithTokens<ast.Ty>().tokens, attrs: HasAttrs.WithTokens(HasAttrs.Ty).attrs, debug: (v, f) => debug_WithTokens(v, f, ast.debug_Ty) }),
      );
      break;
    }
    case "Meta": {
      const attr_item = pnr._0;
      const has_meta_form = attr_item.node.meta_kind() !== undefined;
      tt = mk_delimited(
        attr_item.node.span,
        { $: "Meta", has_meta_form },
        TokenStream_.from_ast(attr_item, {
          tokens: HasTokens.WithTokens<ast.AttrItem>().tokens,
          attrs: HasAttrs.WithTokens(HasAttrs.AttrItem).attrs,
          debug: (v, f) => debug_WithTokens(v, f, ast.debug_AttrItem),
        }),
      );
      break;
    }
    case "Path": {
      const path = pnr._0;
      tt = mk_delimited(
        path.node.span,
        MetaVarKind_Path,
        TokenStream_.from_ast(path, { tokens: HasTokens.WithTokens<ast.Path>().tokens, attrs: HasAttrs.WithTokens(HasAttrs.Path).attrs, debug: (v, f) => debug_WithTokens(v, f, ast.debug_Path) }),
      );
      break;
    }
    case "Vis": {
      const vis = pnr._0;
      tt = mk_delimited(
        vis.node.span,
        MetaVarKind_Vis,
        TokenStream_.from_ast(vis, {
          tokens: HasTokens.WithTokens<ast.Visibility>().tokens,
          attrs: HasAttrs.WithTokens(HasAttrs.Visibility).attrs,
          debug: (v, f) => debug_WithTokens(v, f, ast.debug_Visibility),
        }),
      );
      break;
    }
    case "Guard": {
      const guard = pnr._0;
      // FIXME(macro_guard_matcher):
      // Perhaps it would be better to treat the leading `if` as part of `ast::Guard` during parsing?
      // Currently they are separate, but in macros we match and emit the leading `if` for `:guard` matchers, which creates some inconsistency.

      const leading_if_span = Span.with_hi(guard.span_with_leading_if, BytePos(Span.lo(guard.span_with_leading_if) + 2));
      const ts = TokenStream_.from_iter([
        TokenTree_.token_alone({ $: "Ident", _0: kw.If, _1: "Normal" }, leading_if_span),
        ...TokenStream_.from_ast(guard.cond, { tokens: HasTokens.Expr.tokens, attrs: HasAttrs.Expr.attrs, debug: ast.debug_Expr })._0,
      ]);

      tt = mk_delimited(guard.span_with_leading_if, MetaVarKind_Guard, ts);
      break;
    }
  }

  tscx.result.push(tt);
  return Ok(undefined);
}

const MetaVarKind_Item: MetaVarKind = { $: "Item" };
const MetaVarKind_Block: MetaVarKind = { $: "Block" };
const MetaVarKind_Stmt: MetaVarKind = { $: "Stmt" };
const MetaVarKind_Literal: MetaVarKind = { $: "Literal" };
const MetaVarKind_Path: MetaVarKind = { $: "Path" };
const MetaVarKind_Vis: MetaVarKind = { $: "Vis" };
const MetaVarKind_Guard: MetaVarKind = { $: "Guard" };
const debug_Item = (v: ast.Item, f: Parameters<typeof ast.debug_Expr>[1]): string => ast.debug_Item(v, f, ast.debug_ItemKind);

/// Turn `${expr(...)}` metavariable expressionss into tokens.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:593 transcribe_metavar_expr
function transcribe_metavar_expr(tscx: TranscrCtx, dspan: DelimSpan, expr: MetaVarExpr): PResult<undefined> {
  const dcx = tscx.psess.dcx();
  let tt: TokenTree;
  switch (expr.$) {
    case "ConcatIdent": {
      const r = metavar_expr_concat_ident(tscx, dspan, expr._0);
      if (r.$ === "Err") return r;
      tt = r._0;
      break;
    }
    case "ConcatStr": {
      const r = metavar_expr_concat_str(tscx, dspan, expr._0);
      if (r.$ === "Err") return r;
      tt = r._0;
      break;
    }
    case "Count": {
      const original_ident = expr._0;
      const depth = expr._1;
      const matched = matched_from_ident(dcx, original_ident, tscx.interp);
      if (matched.$ === "Err") return matched;
      const count = count_repetitions(dcx, depth, matched._0, tscx.repeats, dspan);
      if (count.$ === "Err") return count;
      tt = TokenTree_.token_alone(TokenKind_.lit(LitKind_.Integer, sym.integer(count._0), undefined), tscx.visited_dspan(dspan));
      break;
    }
    case "Ignore": {
      const original_ident = expr._0;
      // Used to ensure that `original_ident` is present in the LHS
      const r = matched_from_ident(dcx, original_ident, tscx.interp);
      if (r.$ === "Err") return r;
      return Ok(undefined);
    }
    case "Index": {
      const depth = expr._0;
      // `tscx.repeats.iter().nth_back(depth)`
      const entry = depth < tscx.repeats.length ? tscx.repeats[tscx.repeats.length - 1 - depth] : undefined;
      if (entry !== undefined) {
        const index = entry[0];
        tt = TokenTree_.token_alone(TokenKind_.lit(LitKind_.Integer, sym.integer(index), undefined), tscx.visited_dspan(dspan));
      } else {
        return Err(out_of_bounds_err(dcx, tscx.repeats.length, dspan.entire(), "index"));
      }
      break;
    }
    case "Len": {
      const depth = expr._0;
      const entry = depth < tscx.repeats.length ? tscx.repeats[tscx.repeats.length - 1 - depth] : undefined;
      if (entry !== undefined) {
        const length = entry[1];
        tt = TokenTree_.token_alone(TokenKind_.lit(LitKind_.Integer, sym.integer(length), undefined), tscx.visited_dspan(dspan));
      } else {
        return Err(out_of_bounds_err(dcx, tscx.repeats.length, dspan.entire(), "len"));
      }
      break;
    }
  }
  tscx.result.push(tt);
  return Ok(undefined);
}

/// Handle the `${concat(...)}` metavariable expression.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:639 metavar_expr_concat_ident
function metavar_expr_concat_ident(tscx: TranscrCtx, dspan: DelimSpan, elements: readonly MetaVarExprConcatElem[]): PResult<TokenTree> {
  const r = metavar_expr_concat(tscx, dspan, elements);
  if (r.$ === "Err") return r;
  const [symbol, concatenated_span] = r._0;
  if (!is_ident(Symbol.as_str(symbol))) {
    return Err(
      tscx.psess.dcx().create_err(
        ConcatInvalidIdent_diagnostic({
          span: concatenated_span,
          reason: InvalidIdentReason.new(symbol),
        }),
      ),
    );
  }
  tscx.psess.symbol_gallery.insert(symbol, concatenated_span);

  // The current implementation marks the span as coming from the macro regardless of
  // contexts of the concatenated identifiers but this behavior may change in the
  // future.
  return Ok({ $: "Token", _0: Token_.from_ast_ident(Ident.new(symbol, concatenated_span)), _1: "Alone" });
}

/// Handle the `${concat_str(...)}` metavariable expression.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:663 metavar_expr_concat_str
function metavar_expr_concat_str(tscx: TranscrCtx, dspan: DelimSpan, elements: readonly MetaVarExprConcatElem[]): PResult<TokenTree> {
  const r = metavar_expr_concat(tscx, dspan, elements);
  if (r.$ === "Err") return r;
  const [symbol, concatenated_span] = r._0;

  // The current implementation marks the span as coming from the macro regardless of
  // contexts of the concatenated identifiers but this behavior may change in the
  // future.
  return Ok({ $: "Token", _0: Token_.new(TokenKind_.lit(LitKind_.Str, symbol, undefined), concatenated_span), _1: "Alone" });
}

/// Shared logic for concat/concat_str metavariable expressions
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:680 metavar_expr_concat
function metavar_expr_concat(tscx: TranscrCtx, dspan: DelimSpan, elements: readonly MetaVarExprConcatElem[]): PResult<[Symbol, Span]> {
  const dcx = tscx.psess.dcx();
  let concatenated = "";
  for (const element of elements) {
    let symbol: Symbol;
    switch (element.$) {
      case "Ident":
        symbol = element._0.name;
        break;
      case "Literal":
        symbol = element._0;
        break;
      case "Var": {
        const ident = element._0;
        const key = MacroRulesNormalizedIdent.new(ident);
        const m = lookup_cur_matched(key, tscx.interp, tscx.repeats);
        if (m !== undefined && m.$ === "MatchedSingle") {
          const r = extract_symbol_from_pnr(dcx, m._0, ident.span);
          if (r.$ === "Err") return r;
          symbol = r._0;
        } else if (m !== undefined && m.$ === "MatchedSeq") {
          return Err(dcx.struct_span_err(ident.span, "`${concat(...)}` variable is still repeating at this depth"));
        } else {
          return Err(dcx.create_err(MveUnrecognizedVar_diagnostic({ span: ident.span, key })));
        }
        break;
      }
    }
    concatenated += Symbol.as_str(symbol);
  }
  const symbol = nfc_normalize(concatenated);
  const concatenated_span = tscx.visited_dspan(dspan);
  return Ok([symbol, concatenated_span]);
}

/// Store the metavariable span for this original span into a side table.
/// FIXME: Try to put the metavariable span into `SpanData` instead of a side table (#118517).
/// An optimal encoding for inlined spans will need to be selected to minimize regressions.
/// The side table approach is relatively good, but not perfect due to collisions.
/// In particular, collisions happen when token is passed as an argument through several macro
/// calls, like in recursive macros.
/// The old heuristic below is used to improve spans in case of collisions, but diagnostics are
/// still degraded sometimes in those cases.
///
/// The old heuristic:
///
/// Usually metavariables `$var` produce interpolated tokens, which have an additional place for
/// keeping both the original span and the metavariable span. For `tt` metavariables that's not the
/// case however, and there's no place for keeping a second span. So we try to give the single
/// produced span a location that would be most useful in practice (the hygiene part of the span
/// must not be changed).
///
/// Different locations are useful for different purposes:
/// - The original location is useful when we need to report a diagnostic for the original token in
///   isolation, without combining it with any surrounding tokens. This case occurs, but it is not
///   very common in practice.
/// - The metavariable location is useful when we need to somehow combine the token span with spans
///   of its surrounding tokens. This is the most common way to use token spans.
///
/// So this function replaces the original location with the metavariable location in all cases
/// except these two:
/// - The metavariable is an element of undelimited sequence `$($tt)*`.
///   These are typically used for passing larger amounts of code, and tokens in that code usually
///   combine with each other and not with tokens outside of the sequence.
/// - The metavariable span comes from a different crate, then we prefer the more local span.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:746 maybe_use_metavar_location
function maybe_use_metavar_location(psess: ParseSess, stack: readonly Frame[], metavar_span_: Span, orig_tt: TokenTree, marker: Marker): TokenTree {
  const last = stack[stack.length - 1];
  const undelimited_seq =
    last !== undefined &&
    last.tts.length === 1 &&
    last.kind.$ === "Sequence" &&
    last.kind.sep === undefined &&
    (last.kind.kleene_op === "ZeroOrMore" || last.kind.kleene_op === "OneOrMore");
  if (undelimited_seq) {
    // Do not record metavar spans for tokens from undelimited sequences, for perf reasons.
    return clone_TokenTree(orig_tt);
  }

  const metavar_span_ref = { value: metavar_span_ };
  marker.mark_span(metavar_span_ref);
  const metavar_span = metavar_span_ref.value;
  let no_collision: boolean;
  switch (orig_tt.$) {
    case "Token": {
      const token = orig_tt._0;
      no_collision = with_metavar_spans((mspans) => mspans.insert(token.span, metavar_span));
      break;
    }
    case "Delimited": {
      const dspan = orig_tt._0;
      no_collision = with_metavar_spans(
        (mspans) => mspans.insert(dspan.open, metavar_span) && mspans.insert(dspan.close, metavar_span) && mspans.insert(dspan.entire(), metavar_span),
      );
      break;
    }
  }
  if (no_collision || psess.source_map().is_imported(metavar_span)) {
    return clone_TokenTree(orig_tt);
  }

  // Setting metavar spans for the heuristic spans gives better opportunities for combining them
  // with neighboring spans even despite their different syntactic contexts.
  switch (orig_tt.$) {
    case "Token": {
      const { kind, span: span_ } = orig_tt._0;
      const spacing = orig_tt._1;
      const span = Span.with_ctxt(metavar_span, Span.ctxt(span_));
      with_metavar_spans((mspans) => mspans.insert(span, metavar_span));
      return { $: "Token", _0: Token_.new(kind, span), _1: spacing };
    }
    case "Delimited": {
      const [dspan, dspacing, delimiter, tts] = [orig_tt._0, orig_tt._1, orig_tt._2, orig_tt._3];
      const open = Span.with_ctxt(metavar_span, Span.ctxt(dspan.open));
      const close = Span.with_ctxt(metavar_span, Span.ctxt(dspan.close));
      with_metavar_spans((mspans) => mspans.insert(open, metavar_span) && mspans.insert(close, metavar_span));
      const dspan_ = DelimSpan_.from_pair(open, close);
      return { $: "Delimited", _0: dspan_, _1: dspacing, _2: delimiter, _3: new TokenStream_(tts._0) };
    }
  }
}

/** `TokenTree::clone()`: tokens and streams are shared (immutable); `DelimSpan`/`DelimSpacing` are copied. */
function clone_TokenTree(tt: TokenTree): TokenTree {
  switch (tt.$) {
    case "Token":
      return { $: "Token", _0: tt._0, _1: tt._1 };
    case "Delimited":
      return { $: "Delimited", _0: clone_DelimSpan(tt._0), _1: DelimSpacing_.new(tt._1.open, tt._1.close), _2: tt._2, _3: new TokenStream_(tt._3._0) };
  }
}

/// Lookup the meta-var named `ident` and return the matched token tree from the invocation using
/// the set of matches `interpolations`.
///
/// See the definition of `repeats` in the `transcribe` function. `repeats` is used to descend
/// into the right place in nested matchers. If we attempt to descend too far, the macro writer has
/// made a mistake, and we return `None`.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:811 lookup_cur_matched
function lookup_cur_matched(ident: MacroRulesNormalizedIdent, interpolations: NamedMatches, repeats: readonly (readonly [number, number])[]): NamedMatch | undefined {
  let matched = interpolations.get(ident);
  if (matched === undefined) return undefined;
  for (const [idx] of repeats) {
    if (matched.$ === "MatchedSingle") {
      break;
    } else {
      matched = unwrap(matched._0[idx]);
    }
  }

  return matched;
}

/// An accumulator over a TokenTree to be used with `fold`. During transcription, we need to make
/// sure that the size of each sequence and all of its nested sequences are the same as the sizes
/// of all the matched (nested) sequences in the macro invocation. If they don't match, somebody
/// has made a mistake (either the macro writer or caller).
// rustc-type: compiler/rustc_expand/src/mbe/transcribe.rs:833 LockstepIterSize
type LockstepIterSize =
  /// No constraints on length of matcher. This is true for any TokenTree variants except a
  /// `MetaVar` with an actual `MatchedSeq` (as opposed to a `MatchedNonterminal`).
  | { readonly $: "Unconstrained" }
  /// A `MetaVar` with an actual `MatchedSeq`. The length of the match and the name of the
  /// meta-var are returned.
  | { readonly $: "Constraint"; _0: number; _1: MacroRulesNormalizedIdent }
  /// Two `Constraint`s on the same sequence had different lengths. This is an error.
  | { readonly $: "Contradiction"; _0: string };

const Unconstrained: LockstepIterSize = Object.freeze({ $: "Unconstrained" as const });

const LockstepIterSize = {
  /// Find incompatibilities in matcher/invocation sizes.
  /// - `Unconstrained` is compatible with everything.
  /// - `Contradiction` is incompatible with everything.
  /// - `Constraint(len)` is only compatible with other constraints of the same length.
  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:851 with
  with(self: LockstepIterSize, other: LockstepIterSize): LockstepIterSize {
    switch (self.$) {
      case "Unconstrained":
        return other;
      case "Contradiction":
        return self;
      case "Constraint": {
        const [l_len, l_id] = [self._0, self._1];
        switch (other.$) {
          case "Unconstrained":
            return self;
          case "Contradiction":
            return other;
          case "Constraint": {
            if (l_len === other._0) return self;
            const [r_len, r_id] = [other._0, other._1];
            const msg = `meta-variable \`${display_MacroRulesNormalizedIdent(l_id)}\` repeats ${l_len} time${pluralize(l_len)}, but \`${display_MacroRulesNormalizedIdent(r_id)}\` repeats ${r_len} time${pluralize(r_len)}`;
            return { $: "Contradiction", _0: msg };
          }
        }
      }
    }
  },
};

/// Given a `tree`, make sure that all sequences have the same length as the matches for the
/// appropriate meta-vars in `interpolations`.
///
/// Note that if `repeats` does not match the exact correct depth of a meta-var,
/// `lookup_cur_matched` will return `None`, which is why this still works even in the presence of
/// multiple nested matcher sequences.
///
/// Example: `$($($x $y)+*);+` -- we need to make sure that `x` and `y` repeat the same amount as
/// each other at the given depth when the macro was invoked. If they don't it might mean they were
/// declared at depths which weren't equal or there was a compiler bug. For example, if we have 3 repetitions of
/// the outer sequence and 4 repetitions of the inner sequence for `x`, we should have the same for
/// `y`; otherwise, we can't transcribe them both at the given depth.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:888 lockstep_iter_size
function lockstep_iter_size(tree: mbe.TokenTree, interpolations: NamedMatches, repeats: readonly (readonly [number, number])[]): LockstepIterSize {
  switch (tree.$) {
    case "Delimited": {
      const delimited = tree._2;
      return delimited.tts.reduce<LockstepIterSize>((size, tt) => LockstepIterSize.with(size, lockstep_iter_size(tt, interpolations, repeats)), Unconstrained);
    }
    case "Sequence": {
      const seq = tree._1;
      return seq.tts.reduce<LockstepIterSize>((size, tt) => LockstepIterSize.with(size, lockstep_iter_size(tt, interpolations, repeats)), Unconstrained);
    }
    case "MetaVar":
    case "MetaVarDecl": {
      const name_ = tree.$ === "MetaVar" ? tree._1 : tree.name;
      const name = MacroRulesNormalizedIdent.new(name_);
      const matched = lookup_cur_matched(name, interpolations, repeats);
      if (matched !== undefined) {
        switch (matched.$) {
          case "MatchedSingle":
            return Unconstrained;
          case "MatchedSeq":
            return { $: "Constraint", _0: matched._0.length, _1: name };
        }
      } else {
        return Unconstrained;
      }
      break;
    }
    case "MetaVarExpr": {
      const expr = tree._1;
      return MetaVarExpr_.for_each_metavar<LockstepIterSize>(expr, Unconstrained, (lis, ident) =>
        LockstepIterSize.with(lis, lockstep_iter_size({ $: "MetaVar", _0: ident.span, _1: ident }, interpolations, repeats)),
      );
    }
    case "Token":
      return Unconstrained;
  }
}

/// Used solely by the `count` meta-variable expression, counts the outermost repetitions at a
/// given optional nested depth.
///
/// For example, a macro parameter of `$( { $( $foo:ident ),* } )*` called with `{ a, b } { c }`:
///
/// * `[ $( ${count(foo)} ),* ]` will return [2, 1] with a, b = 2 and c = 1
/// * `[ $( ${count(foo, 0)} ),* ]` will be the same as `[ $( ${count(foo)} ),* ]`
/// * `[ $( ${count(foo, 1)} ),* ]` will return an error because `${count(foo, 1)}` is
///   declared inside a single repetition and the index `1` implies two nested repetitions.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:937 count_repetitions
function count_repetitions(dcx: DiagCtxtHandle, depth_user: number, matched: NamedMatch, repeats: readonly (readonly [number, number])[], sp: DelimSpan): PResult<number> {
  // Recursively count the number of matches in `matched` at given depth
  // (or at the top-level of `matched` if no depth is given).
  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:946 count
  function count(depth_curr: number, depth_max: number, matched: NamedMatch): PResult<number> {
    switch (matched.$) {
      case "MatchedSingle":
        return Ok(1);
      case "MatchedSeq": {
        const named_matches = matched._0;
        if (depth_curr === depth_max) {
          return Ok(named_matches.length);
        } else {
          // `.map(..).sum()` over `PResult`s: stops at the first `Err`.
          let sum = 0;
          for (const elem of named_matches) {
            const r = count(depth_curr + 1, depth_max, elem);
            if (r.$ === "Err") return r;
            sum += r._0;
          }
          return Ok(sum);
        }
      }
    }
  }

  /// Maximum depth
  // rustc: compiler/rustc_expand/src/mbe/transcribe.rs:960 depth
  function depth(counter: number, matched: NamedMatch): number {
    switch (matched.$) {
      case "MatchedSingle":
        return counter;
      case "MatchedSeq": {
        const named_matches = matched._0;
        const rslt = counter + 1;
        const elem = named_matches[0];
        if (elem !== undefined) {
          return depth(rslt, elem);
        } else {
          return rslt;
        }
      }
    }
  }

  // `.checked_sub(1).and_then(|el| el.checked_sub(repeats.len())).unwrap_or_default()`
  const d = depth(0, matched);
  const depth_max = d >= 1 && d - 1 >= repeats.length ? d - 1 - repeats.length : 0;
  if (depth_user > depth_max) {
    return Err(out_of_bounds_err(dcx, depth_max + 1, sp.entire(), "count"));
  }

  // `repeats` records all of the nested levels at which we are currently
  // matching meta-variables. The meta-var-expr `count($x)` only counts
  // matches that occur in this "subtree" of the `NamedMatch` where we
  // are currently transcribing, so we need to descend to that subtree
  // before we start counting. `matched` contains the various levels of the
  // tree as we descend, and its final value is the subtree we are currently at.
  for (const [idx] of repeats) {
    if (matched.$ === "MatchedSeq") {
      matched = unwrap(matched._0[idx]);
    }
  }

  if (matched.$ === "MatchedSingle") {
    return Err(dcx.create_err(CountRepetitionMisplaced_diagnostic({ span: sp.entire() })));
  }

  return count(depth_user, depth_max, matched);
}

/// Returns a `NamedMatch` item declared on the LHS given an arbitrary [Ident]
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:998 matched_from_ident
function matched_from_ident(dcx: DiagCtxtHandle, ident: Ident, interp: NamedMatches): PResult<NamedMatch> {
  const span = ident.span;
  const key = MacroRulesNormalizedIdent.new(ident);
  const m = interp.get(key);
  return m !== undefined ? Ok(m) : Err(dcx.create_err(MveUnrecognizedVar_diagnostic({ span, key })));
}

/// Used by meta-variable expressions when an user input is out of the actual declared bounds. For
/// example, index(999999) in an repetition of only three elements.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:1013 out_of_bounds_err
function out_of_bounds_err(dcx: DiagCtxtHandle, max: number, span: Span, ty: string): Diag {
  let msg: string;
  if (max === 0) {
    msg = `meta-variable expression \`${ty}\` with depth parameter must be called inside of a macro repetition`;
  } else {
    msg = `depth parameter of meta-variable expression \`${ty}\` must be less than ${max}`;
  }
  return dcx.struct_span_err(span, msg);
}

/// Extracts an metavariable symbol that can be an identifier, a token tree or a literal.
// rustc: compiler/rustc_expand/src/mbe/transcribe.rs:1029 extract_symbol_from_pnr
function extract_symbol_from_pnr(dcx: DiagCtxtHandle, pnr: ParseNtResult, span_err: Span): PResult<Symbol> {
  if (pnr.$ === "Ident") {
    const r = validate_ident_kind(dcx, pnr._1, span_err);
    if (r.$ === "Err") return r;
    return Ok(pnr._0.name);
  }
  if (pnr.$ === "Tt" && pnr._0.$ === "Token" && pnr._0._0.kind.$ === "Ident") {
    const kind = pnr._0._0.kind;
    const r = validate_ident_kind(dcx, kind._1, span_err);
    if (r.$ === "Err") return r;
    return Ok(kind._0);
  }
  if (pnr.$ === "Tt" && pnr._0.$ === "Token" && pnr._0._0.kind.$ === "Literal") {
    const lit = pnr._0._0.kind._0;
    if (lit.kind.$ === "Str" && lit.suffix === undefined) {
      return Ok(lit.symbol);
    }
  }
  if (pnr.$ === "Literal") {
    const ek = pnr._0.kind;
    if (ek.$ === "Lit" && ek._0.kind.$ === "Str" && ek._0.suffix === undefined) {
      return Ok(ek._0.symbol);
    }
  }
  if (pnr.$ === "Literal") {
    const ek = pnr._0.kind;
    if (ek.$ === "Lit" && ek._0.kind.$ === "Integer") {
      const lit = ek._0;
      const symbol = lit.symbol;
      const suffix = lit.suffix;
      if (lit.is_semantic_float()) {
        return Err(dcx.struct_err("floats are not supported as metavariables of `${concat(..)}`").with_span(span_err));
      } else if (suffix === undefined) {
        return Ok(symbol);
      } else {
        return Err(dcx.struct_err("integer metavariables of `${concat(..)}` must not be suffixed").with_span(span_err));
      }
    }
  }
  return Err(
    dcx
      .struct_err("metavariables of `${concat(..)}` must be of type `ident`, `literal` or `tt`")
      .with_note("currently only string and integer literals are supported")
      .with_span(span_err),
  );
}
