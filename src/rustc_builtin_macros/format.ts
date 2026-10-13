// Port of compiler/rustc_builtin_macros/src/format.rs
//
// PORT: `fmt_str` (the cooked format string) is a `Str`: the format-string parser and the foreign
// (printf/shell) detectors index it by byte offset. Snippets from the source map are `Str` as well.
import { ast, token } from "../rustc_ast/lib.ts";
import { CRATE_NODE_ID } from "../rustc_ast/node_id.ts";
import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import type { SingleLabelManySpans } from "../rustc_errors/diagnostic_impls.ts";
import { Applicability, DecorateDiagCompat, type Diag, type ErrorGuaranteed, listify, pluralize, type PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExpandResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { LintId } from "../rustc_lint_defs/lib.ts";
import { NAMED_ARGUMENTS_USED_POSITIONALLY } from "../rustc_lint_defs/builtin.ts";
import { exp } from "../rustc_parse/parser/token_type.ts";
import * as parse from "../rustc_parse_format/lib.ts";
import { Session } from "../rustc_session/session.ts";
import { BytePos, InnerSpan, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol } from "../rustc_span/symbol.ts";
import { is_whitespace } from "../std/char.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str } from "../std/str.ts";
import * as diagnostics from "./diagnostics.ts";
import * as foreign from "./format_foreign.ts";
import { type ExprToSpannedString, expr_to_spanned_string } from "./util.ts";

type Expr = ast.Expr;
type ExprKind = ast.ExprKind;
type FormatArgs = ast.FormatArgs;
type FormatArgsPiece = ast.FormatArgsPiece;
type FormatArgPosition = ast.FormatArgPosition;
type FormatArgPositionKind = ast.FormatArgPositionKind;
type FormatArguments = ast.FormatArguments;
type FormatCount = ast.FormatCount;
type FormatOptions = ast.FormatOptions;
type FormatTrait = ast.FormatTrait;
type FormatAlignment = ast.FormatAlignment;
type Range = { start: number; end: number };

// The format_args!() macro is expanded in three steps:
//  1. First, `parse_args` will parse the `(literal, arg, arg, name=arg, name=arg)` syntax,
//     but doesn't parse the template (the literal) itself.
//  2. Second, `make_format_args` will parse the template, the format options, resolve argument references,
//     produce diagnostics, and turn the whole thing into a `FormatArgs` AST node.
//  3. Much later, in AST lowering (rustc_ast_lowering), that `FormatArgs` structure will be turned
//     into the expression of type `core::fmt::Arguments`.

// See rustc_ast/src/format.rs for the FormatArgs structure and glossary.

// Only used in parse_args and report_invalid_references,
// to indicate how a referred argument was used.
type PositionUsedAs = { readonly $: "Placeholder"; _0: Span | undefined } | { readonly $: "Precision" } | { readonly $: "Width" };
const Precision: PositionUsedAs = Object.freeze({ $: "Precision" as const });
const Width: PositionUsedAs = Object.freeze({ $: "Width" as const });
const Placeholder = (s: Span | undefined): PositionUsedAs => ({ $: "Placeholder", _0: s });

interface MacroInput {
  fmtstr: Expr;
  args: FormatArguments;
  /// Whether the first argument was a string literal or a result from eager macro expansion.
  /// If it's not a string literal, we disallow implicit argument capturing.
  ///
  /// This does not correspond to whether we can treat spans to the literal normally, as the whole
  /// invocation might be the result of another macro expansion, in which case this flag may still be true.
  ///
  /// See [RFC 2795] for more information.
  ///
  /// [RFC 2795]: https://rust-lang.github.io/rfcs/2795-format-args-implicit-identifiers.html#macro-hygiene
  is_direct_literal: boolean;
}

/// Parses the arguments from the given list of tokens, returning the diagnostic
/// if there's a parse error so we can continue parsing other format!
/// expressions.
///
/// If parsing succeeds, the return value is:
///
/// ```text
/// Ok((fmtstr, parsed arguments))
/// ```
// rustc: compiler/rustc_builtin_macros/src/format.rs:71 parse_args
function parse_args(ecx: ExtCtxt, sp: Span, tts: TokenStream): PResult<MacroInput> {
  const p = ecx.new_parser_from_tts(tts);

  // parse the format string
  let fmtstr: Expr;
  const k = p.token.kind;
  if (k.$ === "Eof") {
    return Err(ecx.dcx().create_err(diagnostics.FormatRequiresString_diagnostic({ span: sp })));
  }
  // This allows us to properly handle cases when the first comma
  // after the format string is mistakenly replaced with any operator,
  // which cause the expression parser to eat too much tokens.
  else if (k.$ === "Literal" && (k._0.kind.$ === "Str" || k._0.kind.$ === "StrRaw")) {
    const r = p.parse_literal_maybe_minus();
    if (r.$ === "Err") return r;
    fmtstr = r._0;
  }
  // Otherwise, we fall back to the expression parser.
  else {
    const r = p.parse_expr();
    if (r.$ === "Err") return r;
    fmtstr = r._0;
  }

  // parse comma FormatArgument pairs
  const args = ast.FormatArguments.new();
  let first = true;
  while (!p.token.eq(token.TokenKind.Eof)) {
    // parse a comma, or else report an error
    if (!p.eat(exp.Comma)) {
      if (first) {
        p.clear_expected_token_types();
      }

      const r = p.expect(exp.Comma);
      if (r.$ === "Err") {
        const err = r._0;
        if (token.TokenKind.similar_tokens(token.TokenKind.Comma).some((t) => token.TokenKind_eq(t, p.token.kind))) {
          // If a similar token is found, then it may be a typo. We
          // consider it as a comma, and continue parsing.
          err.emit();
          p.bump();
        } else {
          // Otherwise stop the parsing and return the error.
          return Err(err);
        }
      } else if (r._0.$ === "Yes") {
        // ()
      } else {
        unreachable();
      }
    }
    first = false;
    // accept a trailing comma
    if (p.token.eq(token.TokenKind.Eof)) {
      break;
    }
    // parse a FormatArgument
    const id = p.token.ident();
    if (id !== undefined && p.look_ahead(1, (t) => t.eq(token.TokenKind.Eq))) {
      const [ident] = id;
      p.bump();
      const re = p.expect(exp.Eq);
      if (re.$ === "Err") return re;
      const er = p.parse_expr();
      if (er.$ === "Err") return er;
      const expr = er._0;
      const prev_ = args.by_name(ident.name);
      if (prev_ !== undefined) {
        const [, prev] = prev_;
        ecx.dcx().emit_err(
          diagnostics.FormatDuplicateArg_diagnostic({
            span: ident.span,
            prev: ast.FormatArgumentKind.ident(prev.kind)!.span,
            duplicate: ident.span,
            ident,
          }),
        );
        continue;
      }
      args.add({
        original_span: Span.to(ident.span, expr.span),
        kind: { $: "Named", _0: ident },
        expr,
      });
    } else {
      const er = p.parse_expr();
      if (er.$ === "Err") return er;
      const expr = er._0;
      if (args.named_args().length !== 0) {
        return Err(
          ecx.dcx().create_err(
            diagnostics.PositionalAfterNamed_diagnostic({
              span: expr.span,
              args: args
                .named_args()
                .flatMap((a) => {
                  const ident = ast.FormatArgumentKind.ident(a.kind);
                  return ident === undefined ? [] : [[a, ident] as const];
                })
                .map(([arg, n]) => Span.to(n.span, arg.expr.span)),
            }),
          ),
        );
      }
      args.add({
        original_span: expr.span,
        kind: { $: "Normal" },
        expr,
      });
    }
  }

  // Only allow implicit captures for direct literals
  const is_direct_literal = fmtstr.kind.$ === "Lit";

  return Ok({ fmtstr, args, is_direct_literal });
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:169 make_format_args
function make_format_args(
  ecx: ExtCtxt,
  input: MacroInput,
  append_newline: boolean,
  macro_span: Span,
): ExpandResult<Result<FormatArgs, ErrorGuaranteed>, undefined> {
  const unexpanded_fmt_span = input.fmtstr.span;

  const { fmtstr: efmt, args, is_direct_literal } = input;

  let spanned: ExprToSpannedString;
  {
    // Extract snippet so that we can check cases `{}`, `{:?}` and `{:#?}` and emit help for
    // them later.
    let snippet: Result<Str, unknown> | undefined;
    const ek = efmt.kind;
    if (ek.$ === "Block" && ek._1 === undefined && ek._0.stmts.length <= 1) {
      snippet = ecx.sess.source_map().span_to_snippet(unexpanded_fmt_span);
    } else {
      snippet = undefined;
    }

    const mac_ = expr_to_spanned_string(ecx, ast.clone_Expr(efmt), "format argument must be a string literal");
    if (mac_.$ !== "Ready") {
      return { $: "Retry", _0: undefined };
    }
    const mac = mac_._0;
    if (mac.$ === "Ok" && append_newline) {
      const fmt = mac._0;
      fmt.symbol = Symbol.intern(`${Symbol.as_str(fmt.symbol)}\n`);
      spanned = fmt;
    } else if (mac.$ === "Ok") {
      spanned = mac._0;
    } else {
      const err_ = mac._0;
      let guar: ErrorGuaranteed;
      if (err_.$ === "Ok") {
        const [err, suggested] = err_._0;
        if (!suggested) {
          let quoted = false;
          if (ek.$ === "Block" && ek._1 === undefined) {
            const block = ek._0;
            if (block.stmts.length === 1) {
              const stmt = block.stmts[0]!;
              if (stmt.kind.$ === "Expr") {
                const expr = stmt.kind._0;
                if (expr.kind.$ === "Path" && expr.kind._0 === undefined) {
                  const path = expr.kind._1;
                  if (path.segments.length === 1 && path.segments[0]!.args === undefined) {
                    quoted = true;
                    err.multipart_suggestion(
                      "quote your inlined format argument to use as string literal",
                      [
                        [Span.shrink_to_hi(unexpanded_fmt_span), '"'],
                        [Span.shrink_to_lo(unexpanded_fmt_span), '"'],
                      ],
                      Applicability.MaybeIncorrect,
                    );
                  }
                }
              }
            }
          }
          if (!quoted) {
            // `{}` or `()`
            const should_suggest = (kind: ExprKind): boolean => {
              if (kind.$ === "Block" && kind._1 === undefined && kind._0.stmts.length === 0) return true;
              if (kind.$ === "Tup" && kind._0.length === 0) return true;
              return false;
            };

            let sugg_fmt = "";
            for (const kind of [efmt.kind, ...args.explicit_args().map((a) => a.expr.kind)]) {
              sugg_fmt += should_suggest(kind) ? "{:?} " : "{} ";
            }
            // PORT: `str::trim_end`; the string only holds ASCII.
            sugg_fmt = sugg_fmt.trimEnd();
            err.span_suggestion_verbose(
              Span.shrink_to_lo(unexpanded_fmt_span),
              "you might be missing a string literal to format with",
              `"${sugg_fmt}", `,
              Applicability.MaybeIncorrect,
            );

            if (snippet !== undefined && snippet.$ === "Ok") {
              const snippet_ = snippet._0.toString();
              switch (snippet_) {
                case "{}":
                case "{:?}":
                case "{:#?}": {
                  err.span_suggestion_verbose(
                    unexpanded_fmt_span,
                    `you might want to enclose \`${snippet_}\` with \`""\``,
                    `"${snippet_}"`,
                    Applicability.MaybeIncorrect,
                  );
                  break;
                }
                default:
                  break;
              }
            }
          }
        }
        guar = err.emit_err();
      } else {
        guar = err_._0;
      }
      return { $: "Ready", _0: Err(guar) };
    }
  }
  const { symbol: fmt_sym, span: fmt_span, style: fmt_style, uncooked_symbol: uncooked_fmt_str } = spanned;

  let str_style: number | undefined;
  switch (fmt_style.$) {
    case "Cooked":
      str_style = undefined;
      break;
    case "Raw":
      str_style = fmt_style._0;
      break;
  }

  const fmt_str = Str.from(Symbol.as_str(fmt_sym)); // for the suggestions below
  const fmt_snippet_r = ecx.source_map().span_to_snippet(unexpanded_fmt_span);
  const fmt_snippet = fmt_snippet_r.$ === "Ok" ? fmt_snippet_r._0 : undefined;
  const parser = parse.Parser.new(fmt_str, str_style, fmt_snippet, append_newline, parse.ParseMode.Format);

  const pieces: parse.Piece[] = [];
  for (let piece = parser.next(); piece !== undefined; piece = parser.next()) {
    if (parser.errors.length !== 0) {
      break;
    } else {
      pieces.push(piece);
    }
  }

  const is_source_literal = parser.is_source_literal;

  if (parser.errors.length !== 0) {
    const err = parser.errors.shift()!;
    let sp: Span;
    if (is_source_literal) {
      sp = Span.from_inner(fmt_span, InnerSpan.new(err.span.start, err.span.end));
    } else {
      // The format string could be another macro invocation, e.g.:
      //     format!(concat!("abc", "{}"), 4);
      // However, `err.span` is an inner span relative to the *result* of
      // the macro invocation, which is why we would get a nonsensical
      // result calling `fmt_span.from_inner(err.span)` as above, and
      // might even end up inside a multibyte character (issue #86085).
      // Therefore, we conservatively report the error for the entire
      // argument span here.
      sp = fmt_span;
    }
    const e: diagnostics.InvalidFormatString = {
      span: sp,
      note_: undefined,
      label_: undefined,
      sugg_: undefined,
      desc: err.description,
      label1: err.label,
    };
    if (err.note !== undefined) {
      const note = err.note;
      e.note_ = { note };
    }
    if (err.secondary_label !== undefined && is_source_literal) {
      const [label, span] = err.secondary_label;
      e.label_ = {
        span: Span.from_inner(fmt_span, InnerSpan.new(span.start, span.end)),
        label,
      };
    }
    const sugg = err.suggestion;
    switch (sugg.$) {
      case "None":
        break;
      case "UsePositional": {
        const captured_arg_span = Span.from_inner(fmt_span, InnerSpan.new(err.span.start, err.span.end));
        if (is_source_literal) {
          const arg_r = ecx.source_map().span_to_snippet(captured_arg_span);
          if (arg_r.$ === "Ok") {
            const arg = arg_r._0.toString();
            const unnamed = args.unnamed_args();
            const last = unnamed[unnamed.length - 1];
            const span = last !== undefined ? last.expr.span : fmt_span;
            e.sugg_ = {
              $: "UsePositional",
              captured: captured_arg_span,
              len: String(args.unnamed_args().length),
              span: Span.shrink_to_hi(span),
              arg,
            };
          }
        }
        break;
      }
      case "RemoveRawIdent": {
        if (is_source_literal) {
          const span = Span.from_inner(fmt_span, InnerSpan.new(sugg._0.start, sugg._0.end));
          e.sugg_ = { $: "RemoveRawIdent", span };
        }
        break;
      }
      case "ReorderFormatParameter": {
        const replacement = sugg._1;
        if (is_source_literal) {
          const span = Span.from_inner(fmt_span, InnerSpan.new(sugg._0.start, sugg._0.end));
          e.sugg_ = { $: "ReorderFormatParameter", span, replacement };
        }
        break;
      }
      case "AddMissingColon": {
        if (is_source_literal) {
          const span = Span.from_inner(fmt_span, InnerSpan.new(sugg._0.start, sugg._0.end));
          e.sugg_ = { $: "AddMissingColon", span };
        }
        break;
      }
      case "UseRustDebugPrintingMacro": {
        // This targets `println!("{=}", x);` and `println!("{0=}", x);`
        const all = args.all_args();
        if (all.length === 1) {
          const arg = all[0]!;
          const expr_span = arg.expr.span;
          const expr_snippet = ecx.source_map().span_to_snippet(expr_span);
          if (expr_snippet.$ === "Ok") {
            const replacement = `${"dbg"}!(${expr_snippet._0.toString()})`;

            const call_span = Span.source_callsite(macro_span);
            e.sugg_ = {
              $: "UseRustDebugPrintingMacro",
              macro_span: call_span,
              replacement,
            };
          }
        }
        break;
      }
    }
    const guar = ecx.dcx().emit_err(diagnostics.InvalidFormatString_diagnostic(e));
    return { $: "Ready", _0: Err(guar) };
  }

  const to_span = (inner_span: Range): Span | undefined => {
    return is_source_literal ? Span.from_inner(fmt_span, new InnerSpan(inner_span.start, inner_span.end)) : undefined;
  };

  const used: boolean[] = new Array<boolean>(args.explicit_args().length).fill(false);
  const invalid_refs: [number, Span | undefined, PositionUsedAs, FormatArgPositionKind][] = [];
  const numeric_references_to_named_arg: [number, Span | undefined, PositionUsedAs][] = [];

  type ArgRef = { readonly $: "Index"; _0: number } | { readonly $: "Name"; _0: string; _1: Span | undefined };
  const Index = (i: number): ArgRef => ({ $: "Index", _0: i });
  const Name = (n: string, s: Span | undefined): ArgRef => ({ $: "Name", _0: n, _1: s });

  let unnamed_arg_after_named_arg = false;

  const lookup_arg = (arg: ArgRef, span: Span | undefined, used_as: PositionUsedAs, kind: FormatArgPositionKind): FormatArgPosition => {
    let index: Result<number, number>;
    switch (arg.$) {
      case "Index": {
        const index_ = arg._0;
        const a = args.by_index(index_);
        if (a !== undefined) {
          used[index_] = true;
          if (ast.FormatArgumentKind.ident(a.kind) !== undefined) {
            // This was a named argument, but it was used as a positional argument.
            numeric_references_to_named_arg.push([index_, span, used_as]);
          }
          index = Ok(index_);
        } else {
          // Doesn't exist as an explicit argument.
          invalid_refs.push([index_, span, used_as, kind]);
          index = Err(index_);
        }
        break;
      }
      case "Name": {
        const name = Symbol.intern(arg._0);
        const found = args.by_name(name);
        if (found !== undefined) {
          const [index_] = found;
          // Name found in `args`, so we resolve it to its index.
          if (index_ < args.explicit_args().length) {
            // Mark it as used, if it was an explicit argument.
            used[index_] = true;
          }
          index = Ok(index_);
        } else {
          // Name not found in `args`, so we add it as an implicitly captured argument.
          const span = arg._1 ?? fmt_span;
          const ident = Ident.new(name, span);
          let expr: Expr;
          if (is_direct_literal) {
            expr = ecx.expr_ident(span, ident);
          } else {
            // For the moment capturing variables from format strings expanded from macros is
            // disabled (see RFC #2795)
            const guar = ecx.dcx().emit_err(diagnostics.FormatNoArgNamed_diagnostic({ span, name }));
            unnamed_arg_after_named_arg = true;
            expr = DummyResult.raw_expr(span, guar);
          }
          index = Ok(
            args.add({
              original_span: span,
              kind: { $: "Captured", _0: ident },
              expr,
            }),
          );
        }
        break;
      }
    }
    return { index, kind, span };
  };

  const template: FormatArgsPiece[] = [];
  let unfinished_literal = "";
  let placeholder_index = 0;

  for (const piece_ of pieces) {
    const piece = parse.clone_Piece(piece_);
    switch (piece.$) {
      case "Lit": {
        unfinished_literal += piece._0;
        break;
      }
      case "NextArgument": {
        const { position, position_span: position_span_, format } = piece._0;
        if (unfinished_literal.length !== 0) {
          template.push({ $: "Literal", _0: Symbol.intern(unfinished_literal) });
          unfinished_literal = "";
        }

        const s = parser.arg_places[placeholder_index];
        const span = s === undefined ? undefined : to_span(s);
        placeholder_index += 1;

        const position_span = to_span(position_span_);
        let argument: FormatArgPosition;
        switch (position.$) {
          case "ArgumentImplicitlyIs":
            argument = lookup_arg(Index(position._0), position_span, Placeholder(span), "Implicit");
            break;
          case "ArgumentIs":
            argument = lookup_arg(Index(position._0), position_span, Placeholder(span), "Number");
            break;
          case "ArgumentNamed":
            argument = lookup_arg(Name(position._0, position_span), position_span, Placeholder(span), "Named");
            break;
        }

        let alignment: FormatAlignment | undefined;
        switch (format.align) {
          case "AlignUnknown":
            alignment = undefined;
            break;
          case "AlignLeft":
            alignment = "Left";
            break;
          case "AlignRight":
            alignment = "Right";
            break;
          case "AlignCenter":
            alignment = "Center";
            break;
        }

        let format_trait: FormatTrait;
        switch (format.ty) {
          case "":
            format_trait = "Display";
            break;
          case "?":
            format_trait = "Debug";
            break;
          case "e":
            format_trait = "LowerExp";
            break;
          case "E":
            format_trait = "UpperExp";
            break;
          case "o":
            format_trait = "Octal";
            break;
          case "p":
            format_trait = "Pointer";
            break;
          case "b":
            format_trait = "Binary";
            break;
          case "x":
            format_trait = "LowerHex";
            break;
          case "X":
            format_trait = "UpperHex";
            break;
          default: {
            invalid_placeholder_type_error(ecx, format.ty, format.ty_span, fmt_span);
            format_trait = "Display";
          }
        }

        const precision_span = format.precision_span === undefined ? undefined : to_span(format.precision_span);
        let precision: FormatCount | undefined;
        const fp = format.precision;
        switch (fp.$) {
          case "CountIs":
            precision = { $: "Literal", _0: fp._0 };
            break;
          case "CountIsName":
            precision = { $: "Argument", _0: lookup_arg(Name(fp._0, to_span(fp._1)), precision_span, Precision, "Named") };
            break;
          case "CountIsParam":
            precision = { $: "Argument", _0: lookup_arg(Index(fp._0), precision_span, Precision, "Number") };
            break;
          case "CountIsStar":
            precision = { $: "Argument", _0: lookup_arg(Index(fp._0), precision_span, Precision, "Implicit") };
            break;
          case "CountImplied":
            precision = undefined;
            break;
        }

        const width_span = format.width_span === undefined ? undefined : to_span(format.width_span);
        let width: FormatCount | undefined;
        const fw = format.width;
        switch (fw.$) {
          case "CountIs":
            width = { $: "Literal", _0: fw._0 };
            break;
          case "CountIsName":
            width = { $: "Argument", _0: lookup_arg(Name(fw._0, to_span(fw._1)), width_span, Width, "Named") };
            break;
          case "CountIsParam":
            width = { $: "Argument", _0: lookup_arg(Index(fw._0), width_span, Width, "Number") };
            break;
          case "CountIsStar":
            unreachable();
          case "CountImplied":
            width = undefined;
            break;
        }

        template.push({
          $: "Placeholder",
          _0: {
            argument,
            span,
            format_trait,
            format_options: {
              fill: format.fill,
              alignment,
              sign: format.sign === undefined ? undefined : format.sign === "Plus" ? "Plus" : "Minus",
              alternate: format.alternate,
              zero_pad: format.zero_pad,
              debug_hex: format.debug_hex === undefined ? undefined : format.debug_hex === "Lower" ? "Lower" : "Upper",
              precision,
              width,
            },
          },
        });
        break;
      }
    }
  }

  if (unfinished_literal.length !== 0) {
    template.push({ $: "Literal", _0: Symbol.intern(unfinished_literal) });
  }

  if (invalid_refs.length !== 0) {
    report_invalid_references(ecx, invalid_refs, template, fmt_span, args, parser);
  }

  const unused: [Span, boolean][] = [];
  used.forEach((u, i) => {
    if (!u) {
      const named = args.explicit_args()[i]!.kind.$ === "Named";
      unused.push([args.explicit_args()[i]!.expr.span, named]);
    }
  });

  const has_unused = unused.length !== 0;
  if (has_unused) {
    // `fmt_str.strip_suffix('\n').unwrap_or(fmt_str)`
    const foreign_fmt_str =
      append_newline && fmt_str.len() > 0 && fmt_str.byte(fmt_str.len() - 1) === 0x0a ? fmt_str.slice(0, fmt_str.len() - 1) : fmt_str;
    report_missing_placeholders(
      ecx,
      unused,
      used,
      args,
      pieces,
      invalid_refs,
      str_style,
      foreign_fmt_str,
      Symbol.as_str(uncooked_fmt_str[1]),
      fmt_span,
    );
  }

  // Only check for unused named argument names if there are no other errors to avoid causing
  // too much noise in output errors, such as when a named argument is entirely unused.
  if (invalid_refs.length === 0 && !has_unused && !unnamed_arg_after_named_arg) {
    for (const [index, span, used_as] of numeric_references_to_named_arg) {
      let position_sp_to_replace: Span | undefined, position_sp_for_msg: Span | undefined;
      switch (used_as.$) {
        case "Placeholder":
          [position_sp_to_replace, position_sp_for_msg] = [span, used_as._0];
          break;
        case "Precision": {
          // Strip the leading `.` for precision.
          const span_ = span === undefined ? undefined : Span.with_lo(span, BytePos(Span.lo(span) + 1));
          [position_sp_to_replace, position_sp_for_msg] = [span_, span_];
          break;
        }
        case "Width":
          [position_sp_to_replace, position_sp_for_msg] = [span, span];
          break;
      }
      const arg_name = ast.FormatArgumentKind.ident(args.explicit_args()[index]!.kind)!;
      ecx.buffered_early_lint.push({
        span: MultiSpan.from_Span(arg_name.span),
        node_id: CRATE_NODE_ID,
        lint_id: LintId.of(NAMED_ARGUMENTS_USED_POSITIONALLY),
        diagnostic: new DecorateDiagCompat((dcx, level, sess) => {
          let suggestion: Span | undefined, name: string;
          if (position_sp_to_replace !== undefined) {
            const positional_arg_to_replace = position_sp_to_replace;
            name = Symbol.as_str(arg_name.name);
            const is_formatting_arg = used_as.$ === "Width" || used_as.$ === "Precision";
            if (is_formatting_arg) {
              name += "$";
            }
            // `sess.downcast_ref::<rustc_session::Session>().expect("expected a `Session`")`
            const sess_ = sess instanceof Session ? sess : panic("expected a `Session`");
            const positional_arg_content = sess_.source_map().span_to_snippet(positional_arg_to_replace);
            let span_to_replace: Span;
            if (positional_arg_content.$ === "Ok" && positional_arg_content._0.starts_with(":")) {
              span_to_replace = Span.shrink_to_lo(positional_arg_to_replace);
            } else {
              span_to_replace = positional_arg_to_replace;
            }
            [suggestion, name] = [span_to_replace, name];
          } else {
            [suggestion, name] = [undefined, ""];
          }

          return diagnostics.NamedArgumentUsedPositionally_into_diag(
            {
              named_arg_sp: arg_name.span,
              position_label_sp: position_sp_for_msg,
              suggestion,
              name,
              named_arg_name: Symbol.as_str(arg_name.name),
            },
            dcx,
            level,
          );
        }),
      });
    }
  }

  return {
    $: "Ready",
    _0: Ok({
      span: fmt_span,
      template,
      arguments: args,
      uncooked_fmt_str,
      is_source_literal,
    }),
  };
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:706 invalid_placeholder_type_error
function invalid_placeholder_type_error(ecx: ExtCtxt, ty: string, ty_span: Range | undefined, fmt_span: Span): void {
  const sp = ty_span === undefined ? undefined : Span.from_inner(fmt_span, InnerSpan.new(ty_span.start, ty_span.end));
  let suggs: diagnostics.FormatUnknownTraitSugg[];
  if (sp !== undefined) {
    suggs = (
      [
        ["", "Display"],
        ["?", "Debug"],
        ["e", "LowerExp"],
        ["E", "UpperExp"],
        ["o", "Octal"],
        ["p", "Pointer"],
        ["b", "Binary"],
        ["x", "LowerHex"],
        ["X", "UpperHex"],
      ] as const
    ).map(([fmt, trait_name]) => ({ span: sp, fmt, trait_name }));
  } else {
    suggs = [];
  }
  ecx.dcx().emit_err(diagnostics.FormatUnknownTrait_diagnostic({ span: sp ?? fmt_span, ty, suggs }));
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:734 report_missing_placeholders
function report_missing_placeholders(
  ecx: ExtCtxt,
  unused: [Span, boolean][],
  used: readonly boolean[],
  args: FormatArguments,
  pieces: readonly parse.Piece[],
  invalid_refs: readonly [number, Span | undefined, PositionUsedAs, FormatArgPositionKind][],
  str_style: number | undefined,
  fmt_str: Str,
  uncooked_fmt_str: string,
  fmt_span: Span,
): void {
  let diag: Diag;
  if (unused.length === 1) {
    const [span, named] = unused[0]!;
    diag = ecx.dcx().create_err(diagnostics.FormatUnusedArg_diagnostic({ span, named }));
  } else {
    const unused_labels = unused.map(([span, named]) => ({ span, named }));
    const unused_spans = unused.map(([span]) => span);
    diag = ecx.dcx().create_err(
      diagnostics.FormatUnusedArgs_diagnostic({
        fmt: fmt_span,
        unused: unused_spans,
        unused_labels,
      }),
    );
  }

  const placeholders: [Span, string][] = [];
  for (const piece of pieces) {
    if (piece.$ === "NextArgument" && piece._0.position.$ === "ArgumentNamed") {
      const argument = piece._0;
      const binding = piece._0.position._0;
      const span = Span.from_inner(fmt_span, InnerSpan.new(argument.position_span.start, argument.position_span.end));
      placeholders.push([span, binding]);
    }
  }

  if (placeholders.length !== 0) {
    const new_diag = report_redundant_format_arguments(ecx, args, used, placeholders);
    if (new_diag !== undefined) {
      diag.cancel();
      new_diag.emit();
      return;
    }
  }

  // Used to ensure we only report translations for *one* kind of foreign format.
  let found_foreign = false;

  // If there's a lot of unused arguments,
  // let's check if this format arguments looks like another syntax (printf / shell).
  if (unused.length > Math.floor(args.explicit_args().length / 2)) {
    // The set of foreign substitutions we've explained. This prevents spamming the user
    // with `%d should be written as {}` over and over again.
    const explained = new Set<string>();

    // PORT: `macro_rules! check_foreign` is a closure over the module (`printf` or `shell`) and its name.
    interface ForeignSub<S> {
      translate(s: S): Result<string, string | undefined>;
      position(s: S): InnerSpan;
      to_string(s: S): string;
    }
    const check_foreign = <S>(kind: string, iter_subs: (s: Str, start: number) => Iterable<S>, Sub: ForeignSub<S>): void => {
      let show_doc_note = false;

      const suggestions: [Span, string][] = [];
      // account for `"` and account for raw strings `r#`
      const padding = str_style !== undefined ? str_style + 2 : 1;
      for (const sub of iter_subs(fmt_str, padding)) {
        let trn: string, success: boolean;
        const t = Sub.translate(sub);
        if (t.$ === "Ok") {
          [trn, success] = [t._0, true];
        } else if (t._0 !== undefined) {
          [trn, success] = [t._0, false];
        }

        // If it has no translation, don't call it out specifically.
        else {
          continue;
        }

        const pos = Sub.position(sub);
        const key = Sub.to_string(sub);
        if (explained.has(key)) {
          continue;
        }
        explained.add(key);

        if (!found_foreign) {
          found_foreign = true;
          show_doc_note = true;
        }

        const sp = Span.from_inner(fmt_span, pos);

        if (success) {
          suggestions.push([sp, trn]);
        } else {
          diag.span_note(sp, `format specifiers use curly braces, and ${trn}`);
        }
      }

      if (show_doc_note) {
        diag.note(`${kind} formatting is not supported; see the documentation for \`std::fmt\``);
      }
      if (suggestions.length > 0) {
        diag.multipart_suggestion("format specifiers use curly braces", suggestions, Applicability.MachineApplicable);
      }
    };

    check_foreign("printf", foreign.printf.iter_subs, foreign.printf.Substitution);
    if (!found_foreign) {
      check_foreign("shell", foreign.shell.iter_subs, foreign.shell.Substitution);
    }
  }
  if (!found_foreign && unused.length === 1) {
    diag.span_label(fmt_span, "formatting specifier missing");
  }

  if (!found_foreign && invalid_refs.length === 0) {
    // Show example if user didn't use any format specifiers
    const show_example = !used.includes(true);

    if (!show_example) {
      if (unused.length > 1) {
        diag.note(`consider adding ${unused.length} format specifiers`);
      }
    } else {
      const msg_ = unused.length === 1 ? "a format specifier" : `${unused.length} format specifiers`;

      let sugg: string;
      if (str_style === undefined) {
        sugg = `"${uncooked_fmt_str}${"{}".repeat(unused.length)}"`;
      } else {
        const n_hashes = str_style;
        const hashes = "#".repeat(n_hashes);
        const fmt_specifiers = "{}".repeat(unused.length);
        sugg = `r${hashes}"${uncooked_fmt_str}${fmt_specifiers}"${hashes}`;
      }
      const msg = `format specifiers use curly braces, consider adding ${msg_}`;

      diag.span_suggestion_verbose(fmt_span, msg, sugg, Applicability.MaybeIncorrect);
    }
  }

  diag.emit();
}

/// This function detects and reports unused format!() arguments that are
/// redundant due to implicit captures (e.g. `format!("{x}", x)`).
// rustc: compiler/rustc_builtin_macros/src/format.rs:895 report_redundant_format_arguments
function report_redundant_format_arguments(
  ecx: ExtCtxt,
  args: FormatArguments,
  used: readonly boolean[],
  placeholders: [Span, string][],
): Diag | undefined {
  const fmt_arg_indices: number[] = [];
  const args_spans: Span[] = [];
  const fmt_spans: Span[] = [];

  const unnamed_args = args.unnamed_args();
  for (let i = unnamed_args.length - 1; i >= 0; i--) {
    const unnamed_arg = unnamed_args[i]!;
    const ty = unnamed_arg.expr.to_ty();
    if (ty === undefined) continue;
    const argument_binding_ = ast.TyKind.is_simple_path(ty.kind);
    if (argument_binding_ === undefined) continue;
    const argument_binding = Symbol.as_str(argument_binding_);

    if (used[i]) {
      continue;
    }

    const matching_placeholders = placeholders.filter(([, inline_binding]) => argument_binding === inline_binding).map(([span]) => span);

    if (matching_placeholders.length !== 0) {
      fmt_arg_indices.push(i);
      args_spans.push(unnamed_arg.expr.span);
      for (const span of matching_placeholders) {
        if (fmt_spans.includes(span)) {
          continue;
        }
        fmt_spans.push(span);
      }
    }
  }

  if (args_spans.length !== 0) {
    const multispan = MultiSpan.from_Vec(fmt_spans);
    const suggestion_spans: Span[] = [];

    for (let k = 0; k < Math.min(args_spans.length, fmt_arg_indices.length); k++) {
      const arg_span = args_spans[k]!;
      const fmt_arg_idx = fmt_arg_indices[k]!;
      let span: Span;
      if (fmt_arg_idx + 1 === args.explicit_args().length) {
        span = arg_span;
      } else {
        span = Span.until(arg_span, args.explicit_args()[fmt_arg_idx + 1]!.expr.span);
      }

      suggestion_spans.push(span);
    }

    const sugg: diagnostics.FormatRedundantArgsSugg | undefined = args.named_args().length === 0 ? { spans: suggestion_spans } : undefined;

    return ecx.dcx().create_err(
      diagnostics.FormatRedundantArgs_diagnostic({
        n: args_spans.length,
        span: MultiSpan.from_Vec(args_spans),
        note: multispan,
        sugg,
      }),
    );
  }

  return undefined;
}

/** `FormatOptions { precision: Some(FormatCount::Argument(FormatArgPosition { kind: Number, .. })), .. }` */
function count_is_number_arg(c: FormatCount | undefined): boolean {
  return c !== undefined && c.$ === "Argument" && c._0.kind === "Number";
}

/// PORT: `*f != FormatOptions::default()` (derived `PartialEq` and `Default`: every field `None`/`false`).
function format_options_is_default(f: FormatOptions): boolean {
  return (
    f.width === undefined &&
    f.precision === undefined &&
    f.alignment === undefined &&
    f.fill === undefined &&
    f.sign === undefined &&
    !f.alternate &&
    !f.zero_pad &&
    f.debug_hex === undefined
  );
}

/// Handle invalid references to positional arguments. Output different
/// errors for the case where all arguments are positional and for when
/// there are named arguments or numbered positional arguments in the
/// format string.
// rustc: compiler/rustc_builtin_macros/src/format.rs:967 report_invalid_references
function report_invalid_references(
  ecx: ExtCtxt,
  invalid_refs: readonly [number, Span | undefined, PositionUsedAs, FormatArgPositionKind][],
  template: readonly FormatArgsPiece[],
  fmt_span: Span,
  args: FormatArguments,
  parser: parse.Parser,
): void {
  let num_args_desc: string;
  const n = args.explicit_args().length;
  switch (n) {
    case 0:
      num_args_desc = "no arguments were given";
      break;
    case 1:
      num_args_desc = "there is 1 argument";
      break;
    default:
      num_args_desc = `there are ${n} arguments`;
  }

  let e: Diag;

  if (
    template.every((piece) => {
      if (piece.$ === "Placeholder" && piece._0.argument.kind === "Number") return false;
      if (
        piece.$ === "Placeholder" &&
        (count_is_number_arg(piece._0.format_options.precision) || count_is_number_arg(piece._0.format_options.width))
      ) {
        return false;
      }
      return true;
    })
  ) {
    // There are no numeric positions.
    // Collect all the implicit positions:
    const spans: Span[] = [];
    let num_placeholders = 0;
    let has_white_space_only_missing_arg = false;
    for (const piece of template) {
      let placeholder: Span | undefined = undefined;
      // `{arg:.*}`
      if (piece.$ === "Placeholder") {
        const precision = piece._0.format_options.precision;
        if (precision !== undefined && precision.$ === "Argument" && precision._0.kind === "Implicit") {
          placeholder = precision._0.span;
          num_placeholders += 1;
        }
      }
      // `{}`
      if (piece.$ === "Placeholder" && piece._0.argument.kind === "Implicit") {
        const { index } = piece._0.argument;
        const span = piece._0.span;
        placeholder = span;
        num_placeholders += 1;
        //  Check whether there's any non-space whitespace in the placeholder. If so, we should emit a note suggesting an escaping `{`.
        if (index.$ === "Err" && span !== undefined) {
          const snippet = ecx.source_map().span_to_snippet(span);
          if (snippet.$ === "Ok") {
            const chars = snippet._0.chars();
            let any = false;
            for (let c = chars.next(); c !== undefined; c = chars.next()) {
              if (is_whitespace(c) && c !== 0x20 /* ' ' */) {
                any = true;
                break;
              }
            }
            if (any) {
              has_white_space_only_missing_arg = true;
            }
          }
        }
      }
      // For `{:.*}`, we only push one span.
      if (placeholder !== undefined) spans.push(placeholder);
    }
    const span = spans.length === 0 ? MultiSpan.from_span(fmt_span) : MultiSpan.from_spans(spans);
    const highlight: SingleLabelManySpans = {
      spans: args.explicit_args().map((arg) => arg.expr.span),
      label: "",
    };
    e = ecx.dcx().create_err(
      diagnostics.FormatPositionalMismatch_diagnostic({
        span,
        n: num_placeholders,
        desc: num_args_desc,
        highlight,
      }),
    );
    // Point out `{:.*}` placeholders: those take an extra argument.
    let has_precision_star = false;
    for (const piece of template) {
      if (piece.$ !== "Placeholder") continue;
      const precision = piece._0.format_options.precision;
      if (precision !== undefined && precision.$ === "Argument" && precision._0.span !== undefined && precision._0.kind === "Implicit") {
        const span = precision._0.span;
        const index = precision._0.index._0;
        has_precision_star = true;
        e.span_label(
          span,
          `this precision flag adds an extra required argument at position ${index}, which is why there ${
            num_placeholders === 1 ? "is 1 argument" : `are ${num_placeholders} arguments`
          } expected`,
        );
      }
    }
    if (has_precision_star) {
      e.note("positional arguments are zero-based");
    }
    if (has_white_space_only_missing_arg) {
      e.note("if you intended to print `{`, you can escape it with `{{`");
    }
  } else {
    let indexes: number[] = invalid_refs.map(([index]) => index);
    // Avoid `invalid reference to positional arguments 7 and 7 (there is 1 argument)`
    // for `println!("{7:7$}", 1);`
    indexes.sort((a, b) => a - b);
    indexes = indexes.filter((x, i) => i === 0 || x !== indexes[i - 1]);
    let span: MultiSpan;
    if (!parser.is_source_literal || parser.arg_places.length === 0) {
      span = MultiSpan.from_span(fmt_span);
    } else {
      span = MultiSpan.from_spans(invalid_refs.flatMap(([, span]) => (span === undefined ? [] : [span])));
    }
    const arg_list = `argument${pluralize(indexes.length)} ${listify(indexes, (i: number) => String(i)) ?? ""}`;
    e = ecx.dcx().struct_span_err(span, `invalid reference to positional ${arg_list} (${num_args_desc})`);
    e.note("positional arguments are zero-based");
  }

  if (template.some((piece) => piece.$ === "Placeholder" && !format_options_is_default(piece._0.format_options))) {
    e.note("for information about formatting flags, visit https://doc.rust-lang.org/std/fmt/index.html");
  }

  e.emit();
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:1145 expand_format_args_impl
function expand_format_args_impl(ecx: ExtCtxt, sp: Span, tts: TokenStream, nl: boolean): MacroExpanderResult {
  sp = ecx.with_def_site_ctxt(sp);
  const r = parse_args(ecx, sp, tts);
  if (r.$ === "Ok") {
    const input = r._0;
    const mac_ = make_format_args(ecx, input, nl, sp);
    if (mac_.$ !== "Ready") {
      return { $: "Retry", _0: undefined };
    }
    const mac = mac_._0;
    if (mac.$ === "Ok") {
      const format_args = mac._0;
      return { $: "Ready", _0: MacEager.expr(ecx.expr(sp, { $: "FormatArgs", _0: format_args })) };
    } else {
      const guar = mac._0;
      return { $: "Ready", _0: MacEager.expr(DummyResult.raw_expr(sp, guar)) };
    }
  } else {
    const err = r._0;
    const guar = err.emit_err();
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  }
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:1171 expand_format_args
export function expand_format_args(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  return expand_format_args_impl(ecx, sp, tts, false);
}

// rustc: compiler/rustc_builtin_macros/src/format.rs:1179 expand_format_args_nl
export function expand_format_args_nl(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  return expand_format_args_impl(ecx, sp, tts, true);
}
