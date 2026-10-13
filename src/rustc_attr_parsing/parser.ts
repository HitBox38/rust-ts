//! Parsing of attribute arguments.
//!
//! Depending on the attribute parser, an [`ArgParser`] can be used to parse the arguments given to
//! an attribute. See its documentation for more information.
//!
//! This is in essence an (improved) duplicate of `rustc_ast/attr/mod.rs`.
//! That module is intended to be deleted in its entirety.
//!
//! FIXME(jdonszelmann): delete `rustc_ast/attr/mod.rs`
// Port of compiler/rustc_attr_parsing/src/parser.rs
//
// PORT:
// - `PathParser<P: Borrow<Path>>` is one class over `Path` (`OwnedPathParser` / `RefPathParser` are
//   aliases): `self.0.borrow()` is `this._0`. `segments()` (`impl Iterator`) is a generator.
// - `MetaItemParser`'s private fields `path` / `args` clash with its accessor methods, so the fields
//   are `path_` / `args_` (`debug_MetaItemParser` prints the upstream names).
// - `ArgParser` / `MetaItemOrLitParser` are data enums; their methods live on the companion consts
//   (PORTING §8). `MetaItemOrLitParser::MetaItemParser` keeps its variant name.
// - `#[cfg(debug_assertions)]` code (`args_checked`, `are_args_checked`, the bodies of
//   `ignore_args`) is omitted: rustc ships without debug assertions.
// - Closures handed to the parser (`eat_metavar_seq`, `parse_paren_comma_seq`) build a new
//   `MetaItemListParserContext` over the parser they receive, as upstream does.
import * as ast from "../rustc_ast/lib.ts";
import { type Expr, type MetaItemLit, type Path, StmtKind } from "../rustc_ast/lib.ts";
import { token, type tokenstream } from "../rustc_ast/lib.ts";
import { MetaItemLit as MetaItemLitC } from "../rustc_ast/util/literal.ts";
import { path_to_string } from "../rustc_ast_pretty/pprust/mod.ts";
import { AttrPath } from "../rustc_attr_ir/lib.ts";
import { Applicability, type Diag, type PResult } from "../rustc_errors/lib.ts";
import { parser as rustc_parse_parser } from "../rustc_parse/lib.ts";
import type { PathStyle } from "../rustc_parse/parser/path.gen.ts";
import { create_lit_error } from "../rustc_session/diagnostics.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import { debug_Span, Span } from "../rustc_span/lib.ts";
import { Ident } from "../rustc_span/symbol.ts";
import { debug_Path } from "../rustc_ast/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, debug_struct, debug_tuple, debug_vec } from "../std/fmt.ts";
import { assert, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { ShouldEmit } from "./context.ts";
import {
  type AdditionalCommaSuggestion,
  ExpectedComma_diagnostic,
  type InvalidMetaItem,
  InvalidMetaItem_diagnostic,
  MetaBadDelim_diagnostic,
  SuffixedLiteralInAttribute_diagnostic,
} from "./diagnostics.ts";

type Parser = rustc_parse_parser.Parser;
const Parser = rustc_parse_parser.Parser;
const { exp, token_descr } = { exp: rustc_parse_parser.token_type.exp, token_descr: rustc_parse_parser.token_descr };
const PathStyle_Mod: PathStyle = "Mod";
const ForceCollect_No: rustc_parse_parser.ForceCollect = "No";

/** `#[derive(Clone, Debug)] pub struct PathParser<P: Borrow<Path>>(pub P);` */
export class PathParser {
  constructor(public _0: Path) {}

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:44 get_attribute_path
  get_attribute_path(): AttrPath {
    return new AttrPath(
      [...this.segments()].map((s) => s.name),
      this.span(),
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:51 segments
  *segments(): Generator<Ident> {
    for (const seg of this._0.segments) yield seg.ident;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:55 span
  span(): Span {
    return this._0.span;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:59 len
  len(): number {
    return this._0.segments.length;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:63 segments_is
  segments_is(segments: readonly Symbol[]): boolean {
    // `self.segments().map(|segment| &segment.name).eq(segments)`
    const mine = [...this.segments()].map((segment) => segment.name);
    return mine.length === segments.length && mine.every((s, i) => s === segments[i]);
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:67 word
  word(): Ident | undefined {
    return this.len() === 1 ? unwrap(this.segments().next().value as Ident | undefined) : undefined;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:71 word_sym
  word_sym(): Symbol | undefined {
    const w = this.word();
    return w === undefined ? undefined : w.name;
  }

  /// Asserts that this `MetaItem` is some specific word.
  ///
  /// See [`word`](Self::word) for examples of what a word is.
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:78 word_is
  word_is(sym_: Symbol): boolean {
    const w = this.word();
    return w !== undefined && w.name === sym_;
  }

  /// Checks whether the first segments match the givens.
  ///
  /// Unlike [`segments_is`](Self::segments_is),
  /// `self` may contain more segments than the number matched  against.
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:86 starts_with
  starts_with(segments: readonly Symbol[]): boolean {
    if (!(segments.length < this.len())) return false;
    // `self.segments().zip(segments).all(|(a, b)| a.name == *b)`
    let i = 0;
    for (const a of this.segments()) {
      if (i >= segments.length) break;
      if (a.name !== segments[i]) return false;
      i++;
    }
    return true;
  }
}

export type OwnedPathParser = PathParser;
export type RefPathParser = PathParser;

export const debug_PathParser: Debug<PathParser> = (v, f) => debug_tuple(f, "PathParser", [debug_Path(v._0, f)]);

// impl<P: Borrow<Path>> Display for PathParser<P>
// rustc: compiler/rustc_attr_parsing/src/parser.rs:92 fmt
export function display_PathParser(self: PathParser): string {
  return path_to_string(self._0);
}

/// Used for parsing attribute arguments.
///
/// See also [`AttributeDiagnosticContext`], which is the preferred interface for issuing argument
/// parsing related diagnostics.
///
/// [`AttributeDiagnosticContext`]: crate::context::AttributeDiagnosticContext
/** `#[derive(Debug)] #[must_use] pub enum ArgParser` */
export type ArgParser =
  | { readonly $: "NoArgs" }
  | { readonly $: "List"; readonly _0: MetaItemListParser }
  | { readonly $: "NameValue"; readonly _0: NameValueParser };

export const debug_ArgParser: Debug<ArgParser> = (v, f) => {
  switch (v.$) {
    case "NoArgs":
      return "NoArgs";
    case "List":
      return debug_tuple(f, "List", [debug_MetaItemListParser(v._0, f)]);
    case "NameValue":
      return debug_tuple(f, "NameValue", [debug_NameValueParser(v._0, f)]);
  }
};

export const ArgParser = {
  NoArgs: Object.freeze({ $: "NoArgs" as const }) as ArgParser,

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:112 span
  span(self: ArgParser): Span | undefined {
    switch (self.$) {
      case "NoArgs":
        return undefined;
      case "List":
        return self._0.span;
      case "NameValue": {
        const n = self._0;
        return Span.with_lo(n.value_span, Span.lo(n.eq_span));
      }
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:120 from_attr_args
  from_attr_args(
    value: ast.AttrArgs,
    parts: readonly Symbol[],
    psess: ParseSess,
    should_emit: ShouldEmit,
    allow_expr_metavar: AllowExprMetavar,
  ): ArgParser | undefined {
    switch (value.$) {
      case "Empty":
        return ArgParser.NoArgs;
      case "Delimited": {
        const args = value._0;
        // Diagnostic attributes can't error if they encounter non meta item syntax.
        // However, the current syntax for diagnostic attributes is meta item syntax.
        // Therefore we can substitute with a dummy value on invalid syntax.
        if ((parts.length === 1 && parts[0] === sym.rustc_dummy) || (parts.length >= 1 && parts[0] === sym.diagnostic)) {
          const r = MetaItemListParser.new(
            args.tokens,
            args.dspan.entire(),
            psess,
            { $: "ErrorsAndLints", recovery: "Forbidden" },
            allow_expr_metavar,
          );
          if (r.$ === "Ok") {
            return { $: "List", _0: r._0 };
          } else {
            const e = r._0;
            // We can just dispose of the diagnostic and not bother with a lint,
            // because this will look like `#[diagnostic::attr()]` was used. This
            // is invalid for all diagnostic attrs, so a lint explaining the proper
            // form will be issued later.
            e.cancel();
            return { $: "List", _0: new MetaItemListParser([], args.dspan.entire()) };
          }
        }

        if (args.delim.$ !== "Parenthesis") {
          ShouldEmit.emit_err(
            should_emit,
            psess.dcx().create_err(
              MetaBadDelim_diagnostic({
                span: args.dspan.entire(),
                sugg: { open: args.dspan.open, close: args.dspan.close },
              }),
            ),
          );
          return undefined;
        }

        const r = MetaItemListParser.new(args.tokens, args.dspan.entire(), psess, should_emit, allow_expr_metavar);
        if (r.$ === "Err") {
          ShouldEmit.emit_err(should_emit, r._0);
          return undefined;
        }
        return { $: "List", _0: r._0 };
      }
      case "Eq": {
        const { eq_span, expr } = value;
        const r = expr_to_lit(psess, expr, expr.span, should_emit);
        if (r.$ === "Err") {
          ShouldEmit.emit_err(should_emit, r._0);
          return undefined;
        }
        if (r._0 === undefined) return undefined;
        return { $: "NameValue", _0: new NameValueParser(eq_span, r._0, expr.span) };
      }
    }
  },

  /// Asserts that this `MetaItem` is a list
  ///
  /// Some examples:
  ///
  /// - `#[allow(clippy::complexity)]`: `(clippy::complexity)` is a list
  /// - `#[rustfmt::skip::macros(target_macro_name)]`: `(target_macro_name)` is a list
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:192 as_list
  as_list(self: ArgParser): MetaItemListParser | undefined {
    switch (self.$) {
      case "List":
        return self._0;
      case "NameValue":
      case "NoArgs":
        return undefined;
    }
  },

  /// Asserts that this `MetaItem` is a name-value pair.
  ///
  /// Some examples:
  ///
  /// - `#[clippy::cyclomatic_complexity = "100"]`: `clippy::cyclomatic_complexity = "100"` is a name value pair,
  ///   where the name is a path (`clippy::cyclomatic_complexity`). You already checked the path
  ///   to get an `ArgParser`, so this method will effectively only assert that the `= "100"` is
  ///   there
  /// - `#[doc = "hello"]`: `doc = "hello`  is also a name value pair
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:208 as_name_value
  as_name_value(self: ArgParser): NameValueParser | undefined {
    switch (self.$) {
      case "NameValue":
        return self._0;
      case "List":
      case "NoArgs":
        return undefined;
    }
  },

  /// Assert that there were no args.
  /// If there were, get a span to the arguments
  /// (to pass to [`AttributeDiagnosticContext::expected_no_args`](crate::context::AttributeDiagnosticContext::expected_no_args)).
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:218 as_no_args
  as_no_args(self: ArgParser): Result<undefined, Span> {
    switch (self.$) {
      case "NoArgs":
        return Ok(undefined);
      case "List":
        return Err(self._0.span);
      case "NameValue":
        return Err(self._0.args_span());
    }
  },

  /// Explicitly ignore the arguments, disarming the arguments-used check
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:227 ignore_args
  ignore_args(_self: ArgParser): void {
    // #[cfg(debug_assertions)]
    // if let ArgParser::List(list) = self {
    //     for item in list.mixed() {
    //         item.ignore_args();
    //     }
    // }
  },
};

/// Inside lists, values could be either literals, or more deeply nested meta items.
/// This enum represents that.
///
/// Choose which one you want using the provided methods.
/** `#[derive(Debug)] pub enum MetaItemOrLitParser` */
export type MetaItemOrLitParser =
  | { readonly $: "MetaItemParser"; readonly _0: MetaItemParser }
  | { readonly $: "Lit"; readonly _0: MetaItemLit };

export const debug_MetaItemOrLitParser: Debug<MetaItemOrLitParser> = (v, f) => {
  switch (v.$) {
    case "MetaItemParser":
      return debug_tuple(f, "MetaItemParser", [debug_MetaItemParser(v._0, f)]);
    case "Lit":
      return debug_tuple(f, "Lit", [ast.debug_MetaItemLit(v._0, f)]);
  }
};

export const MetaItemOrLitParser = {
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:248 parse_single
  parse_single(parser: Parser, should_emit: ShouldEmit, allow_expr_metavar: AllowExprMetavar): PResult<MetaItemOrLitParser> {
    const this_ = new MetaItemListParserContext(parser, should_emit, allow_expr_metavar);
    return this_.parse_meta_item_inner();
  },

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:257 span
  span(self: MetaItemOrLitParser): Span {
    switch (self.$) {
      case "MetaItemParser": {
        const generic_meta_item_parser = self._0;
        return generic_meta_item_parser.span();
      }
      case "Lit":
        return self._0.span;
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:266 as_lit
  as_lit(self: MetaItemOrLitParser): MetaItemLit | undefined {
    switch (self.$) {
      case "Lit":
        return self._0;
      case "MetaItemParser":
        return undefined;
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:273 meta_item
  meta_item(self: MetaItemOrLitParser): MetaItemParser | undefined {
    switch (self.$) {
      case "MetaItemParser":
        return self._0;
      case "Lit":
        return undefined;
    }
  },

  /// Returns some if this `MetaItemOrLitParser` is a `MetaItem` with no arguments
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:281 meta_item_no_args
  meta_item_no_args(self: MetaItemOrLitParser): MetaItemParser | undefined {
    const meta_item = MetaItemOrLitParser.meta_item(self);
    if (meta_item === undefined) return undefined;
    const r = ArgParser.as_no_args(meta_item.args());
    switch (r.$) {
      case "Ok":
        return meta_item;
      case "Err":
        return undefined;
    }
  },

  /// Explicitly ignore the arguments, disarming the arguments-used check
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:290 ignore_args
  ignore_args(_self: MetaItemOrLitParser): void {
    // #[cfg(debug_assertions)]
    // match self {
    //     MetaItemOrLitParser::MetaItemParser(meta_item) => {
    //         meta_item.ignore_args();
    //     }
    //     MetaItemOrLitParser::Lit(_) => {}
    // }
  },
};

/// Utility that deconstructs a `MetaItem` into usable parts.
///
/// `MetaItems` are syntactically extremely flexible, but specific attributes want to parse
/// them in custom, more restricted ways. For common argument shapes, prefer the higher-level
/// [`AcceptContext::expect_list`](crate::context::AcceptContext::expect_list) and
/// [`AcceptContext::expect_single`](crate::context::AcceptContext::expect_single) helpers.
/// Use this struct when parsing a custom restricted syntax.
///
/// `MetaItems` consist of some path, and some args. The args could be empty. In other words:
///
/// - `name` -> args are empty
/// - `name(...)` -> args are a [`list`](ArgParser::as_list), which is the bit between the
///   parentheses
/// - `name = value`-> arg is [`name_value`](ArgParser::as_name_value), where the argument is the
///   `= value` part
///
/// The syntax of `MetaItems` can be found at <https://doc.rust-lang.org/reference/attributes.html>
/** `#[derive(Debug)] pub struct MetaItemParser` */
export class MetaItemParser {
  constructor(
    public path_: OwnedPathParser,
    public args_: ArgParser,

    // /// Whether the `args` of this meta item have been looked at.
    // /// This is tracked because if the arguments of a `MetaItemParser` are ignored, this is probably a mistake
    // #[cfg(debug_assertions)]
    // args_checked: AtomicBool,
  ) {}

  /// For a single-segment meta item, returns its name; otherwise, returns `None`.
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:331 ident
  ident(): Ident | undefined {
    const segments = this.path_._0.segments;
    if (segments.length === 1) {
      const { ident } = segments[0]!;
      return ident;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:335 span
  span(): Span {
    const other = ArgParser.span(this.args_);
    if (other !== undefined) {
      return Span.with_hi(this.path_.span(), Span.hi(other));
    } else {
      return this.path_.span();
    }
  }

  /// Gets just the path, without the args. Some examples:
  ///
  /// - `#[rustfmt::skip]`: `rustfmt::skip` is a path
  /// - `#[allow(clippy::complexity)]`: `clippy::complexity` is a path
  /// - `#[inline]`: `inline` is a single segment path
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:348 path
  path(): OwnedPathParser {
    return this.path_;
  }

  /// Gets just the args parser, without caring about the path.
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:353 args
  args(): ArgParser {
    // #[cfg(debug_assertions)]
    // self.args_checked.store(true, Ordering::Relaxed);
    return this.args_;
  }

  /// Asserts that this `MetaItem` starts with a word, or single segment path.
  ///
  /// Some examples:
  /// - `#[inline]`: `inline` is a word
  /// - `#[rustfmt::skip]`: `rustfmt::skip` is a path,
  ///   and not a word and should instead be parsed using [`path`](Self::path)
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:365 word_is
  word_is(sym_: Symbol): ArgParser | undefined {
    return this.path().word_is(sym_) ? this.args() : undefined;
  }

  /// Explicitly ignore the arguments, disarming the arguments-used check
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:370 ignore_args
  ignore_args(): void {
    ArgParser.ignore_args(this.args());
  }

  // #[cfg(debug_assertions)]
  // rustc-skip: compiler/rustc_attr_parsing/src/parser.rs:375 are_args_checked #[cfg(debug_assertions)]-only (rustc ships without debug assertions)
}

export const debug_MetaItemParser: Debug<MetaItemParser> = (v, f) =>
  debug_struct(f, "MetaItemParser", [
    ["path", debug_PathParser(v.path_, f)],
    ["args", debug_ArgParser(v.args_, f)],
  ]);

/** `#[derive(Clone, Debug)] pub struct NameValueParser` */
export class NameValueParser {
  constructor(
    public eq_span: Span,
    public value: MetaItemLit,
    public value_span: Span,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:388 value_as_lit
  value_as_lit(): MetaItemLit {
    return this.value;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:392 value_as_str
  value_as_str(): Symbol | undefined {
    return ast.LitKind.str(this.value_as_lit().kind);
  }

  /// If the value is a string literal, it will return its value associated with its span (an
  /// `Ident` in short).
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:398 value_as_ident
  value_as_ident(): Ident | undefined {
    const meta_item = this.value_as_lit();
    const name = ast.LitKind.str(meta_item.kind);
    return name === undefined ? undefined : new Ident(name, meta_item.span);
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:403 args_span
  args_span(): Span {
    return Span.to(this.eq_span, this.value_span);
  }
}

export const debug_NameValueParser: Debug<NameValueParser> = (v, f) =>
  debug_struct(f, "NameValueParser", [
    ["eq_span", debug_Span(v.eq_span, f)],
    ["value", ast.debug_MetaItemLit(v.value, f)],
    ["value_span", debug_Span(v.value_span, f)],
  ]);

// rustc: compiler/rustc_attr_parsing/src/parser.rs:408 expr_to_lit
function expr_to_lit(psess: ParseSess, expr: Expr, span: Span, should_emit: ShouldEmit): PResult<MetaItemLit | undefined> {
  if (expr.kind.$ === "Lit") {
    const token_lit = expr.kind._0;
    const res = MetaItemLitC.from_token_lit(token_lit, expr.span);
    switch (res.$) {
      case "Ok": {
        const lit = res._0;
        if (token_lit.suffix !== undefined) {
          return Err(psess.dcx().create_err(SuffixedLiteralInAttribute_diagnostic({ span: lit.span })));
        } else if (ast.LitKind.is_unsuffixed(lit.kind)) {
          return Ok(lit);
        } else {
          return Err(psess.dcx().create_err(SuffixedLiteralInAttribute_diagnostic({ span: lit.span })));
        }
      }
      case "Err": {
        const err = create_lit_error(psess, res._0, token_lit, expr.span);
        if (should_emit.$ === "ErrorsAndLints" && should_emit.recovery === "Forbidden") {
          return Err(err);
        } else {
          const lit = new ast.MetaItemLit(token_lit.symbol, token_lit.suffix, { $: "Err", _0: err.emit_err() }, expr.span);
          return Ok(lit);
        }
      }
    }
  } else {
    if (should_emit.$ === "Nothing" || expr.kind.$ === "Err") {
      return Ok(undefined);
    }

    // Example cases:
    // - `#[foo = 1+1]`: results in `ast::ExprKind::BinOp`.
    // - `#[foo = include_str!("nonexistent-file.rs")]`:
    //   results in `ast::ExprKind::Err`.
    const msg = "attribute value must be a literal";
    const err = psess.dcx().struct_span_err(span, msg);

    // Suggest adding quotation marks to turn an identifier into a string literal
    if (expr.kind.$ === "Path" && expr.kind._0 === undefined && expr.kind._1.segments.length === 1) {
      err.multipart_suggestion(
        "you might have meant to write a string literal",
        [
          [Span.shrink_to_lo(expr.span), '"'],
          [Span.shrink_to_hi(expr.span), '"'],
        ],
        Applicability.MaybeIncorrect,
      );
    }

    return Err(err);
  }
}

/// Whether expansions of `expr` metavariables from declarative  macros
/// are permitted. Used when parsing meta items; currently, only `cfg` predicates
/// enable this option
/** `#[derive(Clone, Copy, PartialEq, Eq)] pub enum AllowExprMetavar` */
export type AllowExprMetavar = "No" | "Yes";
export const AllowExprMetavar = { No: "No", Yes: "Yes" } as const;

class MetaItemListParserContext {
  constructor(
    public parser: Parser,
    public should_emit: ShouldEmit,
    public allow_expr_metavar: AllowExprMetavar,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:490 parse_unsuffixed_meta_item_lit
  parse_unsuffixed_meta_item_lit(): PResult<MetaItemLit> {
    const token_lit = this.parser.eat_token_lit();
    if (token_lit === undefined) {
      return Err(this.expected_lit());
    }
    return this.unsuffixed_meta_item_from_lit(token_lit);
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:495 unsuffixed_meta_item_from_lit
  unsuffixed_meta_item_from_lit(token_lit: token.Lit): PResult<MetaItemLit> {
    let lit: MetaItemLit;
    const r = MetaItemLitC.from_token_lit(token_lit, this.parser.prev_token.span);
    switch (r.$) {
      case "Ok":
        lit = r._0;
        break;
      case "Err": {
        const err = r._0;
        return Err(create_lit_error(this.parser.psess, err, token_lit, this.parser.prev_token_uninterpolated_span()));
      }
    }

    if (!ast.LitKind.is_unsuffixed(lit.kind)) {
      // Emit error and continue, we can still parse the attribute as if the suffix isn't there
      const err = this.parser.dcx().create_err(SuffixedLiteralInAttribute_diagnostic({ span: lit.span }));
      if (this.should_emit.$ === "ErrorsAndLints" && this.should_emit.recovery === "Forbidden") {
        return Err(err);
      }
      ShouldEmit.emit_err(this.should_emit, err);
    }

    return Ok(lit);
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:526 parse_meta_item
  parse_meta_item(): PResult<MetaItemParser> {
    const metavar = this.parser.token.is_metavar_seq();
    if (metavar !== undefined) {
      if (metavar.$ === "Expr" && this.allow_expr_metavar === "Yes") {
        const kind = metavar;
        const r = this.parser.eat_metavar_seq(kind, (this_) =>
          new MetaItemListParserContext(this_, this.should_emit, "Yes").parse_meta_item(),
        );
        if (r !== undefined) return Ok(r);
        // `.ok_or_else(|| self.parser.unexpected_any::<Infallible>().unwrap_err())`
        const e = this.parser.unexpected_any<never>();
        assert(e.$ === "Err", "called `Result::unwrap_err()` on an `Ok` value");
        return Err(e._0);
      } else if (metavar.$ === "Meta") {
        const { has_meta_form } = metavar;
        if (has_meta_form) {
          const attr_item = unwrap(
            this.parser.eat_metavar_seq({ $: "Meta", has_meta_form: true }, (this_) =>
              new MetaItemListParserContext(this_, this.should_emit, this.allow_expr_metavar).parse_meta_item(),
            ),
          );
          return Ok(attr_item);
        } else {
          return this.parser.unexpected_any();
        }
      } else {
        // _ => {}
      }
    }

    const path_r = this.parser.parse_path(PathStyle_Mod);
    if (path_r.$ === "Err") return path_r;
    const path = path_r._0;

    // Check style of arguments that this meta item has
    let args: ArgParser;
    if (this.parser.check(exp.OpenParen)) {
      const start = this.parser.token.span;
      const r = this.parser.parse_paren_comma_seq((parser) =>
        new MetaItemListParserContext(parser, this.should_emit, this.allow_expr_metavar).parse_meta_item_inner(),
      );
      if (r.$ === "Err") return r;
      const [sub_parsers] = r._0;
      const end = this.parser.prev_token.span;
      args = { $: "List", _0: new MetaItemListParser(sub_parsers, Span.with_hi(start, Span.hi(end))) };
    } else if (this.parser.eat(exp.Eq)) {
      const eq_span = this.parser.prev_token.span;
      const value_r = this.parse_unsuffixed_meta_item_lit();
      if (value_r.$ === "Err") return value_r;
      const value = value_r._0;

      args = { $: "NameValue", _0: new NameValueParser(eq_span, value, value.span) };
    } else {
      args = ArgParser.NoArgs;
    }

    return Ok(
      new MetaItemParser(
        new PathParser(path),
        args,
        // #[cfg(debug_assertions)]
        // args_checked: AtomicBool::new(false),
      ),
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:598 parse_meta_item_inner
  parse_meta_item_inner(): PResult<MetaItemOrLitParser> {
    const token_lit = this.parser.eat_token_lit();
    if (token_lit !== undefined) {
      // If a literal token is parsed, we commit to parsing a MetaItemLit for better errors
      const r = this.unsuffixed_meta_item_from_lit(token_lit);
      if (r.$ === "Err") return r;
      return Ok({ $: "Lit", _0: r._0 });
    } else {
      const prev_pros = this.parser.approx_token_stream_pos();
      const r = this.parse_meta_item();
      switch (r.$) {
        case "Ok":
          return Ok({ $: "MetaItemParser", _0: r._0 });
        case "Err": {
          const err = r._0;
          // If `parse_attr_item` made any progress, it likely has a more precise error we should prefer
          // If it didn't make progress we use the `expected_lit` from below
          if (this.parser.approx_token_stream_pos() === prev_pros) {
            err.cancel();
            return Err(this.expected_lit());
          } else {
            return Err(err);
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:620 expected_lit
  expected_lit(): Diag {
    const err: InvalidMetaItem = {
      span: this.parser.token.span,
      descr: token_descr(this.parser.token),
      quote_ident_sugg: undefined,
      remove_neg_sugg: undefined,
      label: undefined,
    };

    if (this.parser.token.kind.$ === "OpenInvisible") {
      // Do not attempt to suggest anything when encountered as part of a macro expansion.
      return this.parser.dcx().create_err(InvalidMetaItem_diagnostic(err));
    }

    if (this.should_emit.$ === "ErrorsAndLints" && this.should_emit.recovery === "Forbidden") {
      // Do not attempt to suggest anything in `Recovery::Forbidden` mode.
      // Malformed diagnostic-attr arguments that start with an `if` expression can lead to
      // an ICE (https://github.com/rust-lang/rust/issues/152744), because callers may cancel the `InvalidMetaItem` error.
      return this.parser.dcx().create_err(InvalidMetaItem_diagnostic(err));
    }

    // Suggest quoting idents, e.g. in `#[cfg(key = value)]`. We don't use `Token::ident` and
    // don't `uninterpolate` the token to avoid suggesting anything butchered or questionable
    // when macro metavariables are involved.
    const snapshot = this.parser.create_snapshot_for_diagnostic();
    const r = this.parser.parse_stmt_without_recovery(false, ForceCollect_No, false);
    switch (r.$) {
      case "Ok": {
        const stmt = r._0;
        // The user tried to write something like
        // `#[deprecated(note = concat!("a", "b"))]`.
        err.descr = StmtKind.descr(stmt.kind);
        err.label = stmt.span;
        err.span = stmt.span;
        const sk = stmt.kind;
        if (sk.$ === "Expr" && sk._0.kind.$ === "Unary" && sk._0.kind._0 === "Neg" && sk._0.kind._1.kind.$ === "Lit") {
          const expr = sk._0;
          const val = sk._0.kind._1;
          err.remove_neg_sugg = { negative_sign: Span.until(expr.span, val.span) };
        } else if (sk.$ === "Expr" && sk._0.kind.$ === "Path" && sk._0.kind._0 === undefined && sk._0.kind._1.segments.length === 1) {
          const expr = sk._0;
          for (;;) {
            const k = this.parser.token.kind;
            if (!(k.$ === "Ident" || k.$ === "Literal" || k.$ === "Dot")) break;
            // We've got a word, so we try to consume the rest of a potential sentence.
            // We include `.` to correctly handle things like `A sentence here.`.
            this.parser.bump();
          }
          err.quote_ident_sugg = {
            before: Span.shrink_to_lo(expr.span),
            after: Span.shrink_to_hi(this.parser.prev_token.span),
          };
        }
        break;
      }
      case "Err": {
        const e = r._0;
        e.cancel();
        this.parser.restore_snapshot(snapshot);
        break;
      }
    }

    return this.parser.dcx().create_err(InvalidMetaItem_diagnostic(err));
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:685 should_continue_parsing_meta_items
  should_continue_parsing_meta_items(): Result<boolean, Diag> {
    if (this.parser.eat(exp.Comma)) {
      return Ok(true);
    } else if (this.parser.token.eq(token.TokenKind.Eof)) {
      return Ok(false);
    }

    const snapshot = this.parser.create_snapshot_for_diagnostic();
    if (this.should_emit.$ === "ErrorsAndLints" && this.should_emit.recovery === "Allowed") {
      const missing_commas: Span[] = [];
      let found_comma = false;
      while (!this.parser.token.eq(token.TokenKind.Eof)) {
        const span = Span.shrink_to_hi(this.parser.prev_token.span);
        this.should_emit = ShouldEmit.Nothing;
        const r = this.parse_meta_item_inner();
        if (r.$ === "Ok") {
          if (!found_comma) {
            missing_commas.push(span);
          }
        } else {
          const e = r._0;
          e.cancel();
          break;
        }
        found_comma = this.parser.eat(exp.Comma);
      }

      if (missing_commas.length > 0) {
        const span = missing_commas[0]!;
        const additional: AdditionalCommaSuggestion[] = missing_commas.slice(1).map((span) => ({ span }));
        return Err(this.parser.dcx().create_err(ExpectedComma_diagnostic({ span, additional })));
      }
    }
    // `snapshot.unexpected_any()` (through `SnapshotParser`'s `Deref`)
    return snapshot.parser.unexpected_any();
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:723 parse
  static parse(
    tokens: tokenstream.TokenStream,
    psess: ParseSess,
    span: Span,
    should_emit: ShouldEmit,
    allow_expr_metavar: AllowExprMetavar,
  ): PResult<MetaItemListParser> {
    let parser = Parser.new(psess, tokens, undefined);
    if (should_emit.$ === "ErrorsAndLints") {
      const { recovery } = should_emit;
      parser = parser.recovery(recovery);
    }

    const this_ = new MetaItemListParserContext(parser, should_emit, allow_expr_metavar);

    // Presumably, the majority of the time there will only be one attr.
    const sub_parsers: MetaItemOrLitParser[] = [];
    while (!this_.parser.token.eq(token.TokenKind.Eof)) {
      const r = this_.parse_meta_item_inner();
      if (r.$ === "Err") return r;
      sub_parsers.push(r._0);

      const c = this_.should_continue_parsing_meta_items();
      if (c.$ === "Err") return c;
      if (!c._0) {
        break;
      }
    }

    return Ok(new MetaItemListParser(sub_parsers, span));
  }
}

/** `#[derive(Debug)] pub struct MetaItemListParser` */
export class MetaItemListParser {
  constructor(
    public sub_parsers: MetaItemOrLitParser[],
    public span: Span,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:759 new
  static new(
    tokens: tokenstream.TokenStream,
    span: Span,
    psess: ParseSess,
    should_emit: ShouldEmit,
    allow_expr_metavar: AllowExprMetavar,
  ): Result<MetaItemListParser, Diag> {
    // PORT: `tokens.clone()` (an `Arc` clone) shares the trees (tokenstream.ts convention).
    return MetaItemListParserContext.parse(new TokenStreamC(tokens._0), psess, span, should_emit, allow_expr_metavar);
  }

  /// Lets you pick and choose as what you want to parse each element in the list
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:776 mixed
  *mixed(): Generator<MetaItemOrLitParser> {
    yield* this.sub_parsers;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:780 len
  len(): number {
    return this.sub_parsers.length;
  }

  // rustc: compiler/rustc_attr_parsing/src/parser.rs:784 is_empty
  is_empty(): boolean {
    return this.len() === 0;
  }

  /// Returns Some if the list contains only a single element.
  ///
  /// Inside the Some is the parser to parse this single element.
  // rustc: compiler/rustc_attr_parsing/src/parser.rs:791 as_single
  as_single(): MetaItemOrLitParser | undefined {
    const iter = this.mixed();
    const first = iter.next();
    if (first.done) return undefined;
    return iter.next().done ? first.value : undefined;
  }
}

export const debug_MetaItemListParser: Debug<MetaItemListParser> = (v, f) =>
  debug_struct(f, "MetaItemListParser", [
    ["sub_parsers", debug_vec(v.sub_parsers, f, debug_MetaItemOrLitParser)],
    ["span", debug_Span(v.span, f)],
  ]);

const TokenStreamC = ast.tokenstream.TokenStream;
