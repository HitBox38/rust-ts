// Port of compiler/rustc_parse/src/parser/diagnostics.rs
// Types (`ConsumeClosingDelim`, `AttemptLocalParseRecovery`, `SnapshotParser`) are generated into
// diagnostics.gen.ts; the diagnostic structs used here live in ../diagnostics.ts (generated
// `#[derive(Diagnostic)]` impls, `X_diagnostic(..)` / `X_subdiagnostic(..)`).
//
// PORT: `impl Parser` methods are assigned onto `Parser.prototype` (declared in ./decls.ts).
// Init order (see ./mod.ts): top-level code here touches only `Parser`, our own .gen.ts and
// non-parser modules (`PathStyle` comes from path.gen.ts, which has no `impl Parser`).
import { ast, token } from "../../rustc_ast/lib.ts";
import type {
  AngleBracketedArg,
  BlockCheckMode,
  Block,
  Expr,
  GenericArg,
  GenericParam,
  Generics,
  Item,
  Param,
  Pat,
  PatKind,
  PathSegment,
  QSelf,
  Ty,
} from "../../rustc_ast/lib.ts";
import type { Token, TokenKind, IdentKind } from "../../rustc_ast/token.ts";
import { AssocOp, ExprPrecedence_discriminant } from "../../rustc_ast/util/parser.ts";
import { MetaItemLit } from "../../rustc_ast/util/literal.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import { type Diag, type DiagCtxtHandle, msg, type PResult } from "../../rustc_errors/lib.ts";
import { Applicability, pluralize } from "../../rustc_lint_defs/lib.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import {
  BytePos,
  DUMMY_SP,
  type ErrorGuaranteed,
  Span,
  type SpanSnippetError,
  type Spanned,
  debug_SpanSnippetError,
} from "../../rustc_span/lib.ts";
import { Ident, display_Ident, debug_Ident, kw, sym, Symbol, used_keywords } from "../../rustc_span/symbol.ts";
import { ch } from "../../std/char.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import {
  AmbiguousPlus_diagnostic,
  AsyncMoveBlockIn2015_diagnostic,
  AsyncUseBlockIn2015_diagnostic,
  BadQPathStage2_diagnostic,
  type BadTypePlusSub,
  BadTypePlus_diagnostic,
  ColonAsSemi_diagnostic,
  type ComparisonOperatorsCannotBeChained,
  ComparisonOperatorsCannotBeChained_diagnostic,
  DocCommentDoesNotDocumentAnything_diagnostic,
  DoubleColonInBound_diagnostic,
  ExpectedIdentifier_diagnostic,
  ExpectedSemi_diagnostic,
  ExprParenthesesNeeded,
  ExprParenthesesNeeded_subdiagnostic,
  FoundPathInGenerics_diagnostic,
  GenericParamsWithoutAngleBrackets_diagnostic,
  type HelpIdentifierStartsWithNumber,
  HelpUseLatestEdition,
  HelpUseLatestEdition_subdiagnostic,
  InInTypo_diagnostic,
  IncorrectAwait_diagnostic,
  type IncorrectSemicolon,
  IncorrectSemicolon_diagnostic,
  IncorrectUseOfAwait_diagnostic,
  IncorrectUseOfUse_diagnostic,
  type MisspelledKw,
  MisspelledKw_subdiagnostic,
  PatternMethodParamWithoutBody_diagnostic,
  QuestionMarkInType_diagnostic,
  SelfParamNotFirst_diagnostic,
  StructLiteralBodyWithoutPath_diagnostic,
  SuggAddMissingLetStmt_add_to_diag,
  type SuggEscapeIdentifier,
  type SuggRemoveComma,
  SuggestBindTypeParameter_subdiagnostic,
  SuggestIntroduceTypeParameter_subdiagnostic,
  TernaryOperator_diagnostic,
  type TernaryOperatorSuggestion,
  type UnexpectedConstInGenericParam,
  UnexpectedConstInGenericParam_diagnostic,
  type UnexpectedConstParamDeclarationSugg,
  UnexpectedConstParamDeclaration_diagnostic,
  UnmatchedAngleBrackets_diagnostic,
  UseEqInstead_diagnostic,
} from "../diagnostics.ts";
import * as gen from "./diagnostics.gen.ts";
import type { ConsumeClosingDelim } from "./diagnostics.gen.ts";
import type { FnContext, FnParseMode } from "./function.gen.ts";
import { BlockMode, clone_Parser, Parser, Recovery, Restrictions, SemiColonMode, SeqSep, token_descr } from "./mod.ts";
import type { CommaRecoveryMode, Expected } from "./pat.gen.ts";
import { PathStyle } from "./path.gen.ts";
import { exp, type ExpTokenPair, TokenType } from "./token_type.ts";

export * from "./diagnostics.gen.ts";

const { TokenKind: TK, TokenKind_eq } = token;

/// Creates a placeholder argument.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:48 dummy_arg
export function dummy_arg(ident: Ident, guar: ErrorGuaranteed): Param {
  const pat = new ast.Pat(
    ast.DUMMY_NODE_ID,
    { $: "Ident", _0: ast.clone_BindingMode(ast.BindingMode.NONE), _1: ident, _2: undefined },
    ident.span,
  );
  const ty = new ast.Ty(ast.DUMMY_NODE_ID, { $: "Err", _0: guar }, ident.span);
  return new ast.Param([], ty, pat, ast.DUMMY_NODE_ID, ident.span, false);
}

// rustc-trait: compiler/rustc_parse/src/parser/diagnostics.rs:65 RecoverQPath
/// PORT: `pub(crate) trait RecoverQPath: Sized + 'static` -> an impl table per type (ast-visit
/// convention): generic fns bounded by it take `T_RecoverQPath: RecoverQPath<T>` (see decls.ts).
/// `const PATH_STYLE: PathStyle = PathStyle::Expr;` (provided default) is written out in each impl.
export interface RecoverQPath<T> {
  readonly PATH_STYLE: PathStyle;
  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:67 to_ty
  to_ty(self: T): Ty | undefined;
  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:68 recovered
  recovered(qself: QSelf | undefined, path: ast.Path): T;
}

export const RecoverQPath = {
  /** `impl<T: RecoverQPath> RecoverQPath for Box<T>` (`Box` is erased: the table of `T`). */
  Box<T>(T_: RecoverQPath<T>): RecoverQPath<T> {
    return {
      PATH_STYLE: T_.PATH_STYLE,
      // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:73 to_ty
      to_ty(self: T): Ty | undefined {
        return T_.to_ty(self);
      },
      // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:76 recovered
      recovered(qself: QSelf | undefined, path: ast.Path): T {
        return T_.recovered(qself, path);
      },
    };
  },

  /** `impl RecoverQPath for Ty` */
  Ty: {
    PATH_STYLE: PathStyle.Type,
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:83 to_ty
    to_ty(self: Ty): Ty | undefined {
      return ast.clone_Ty(self);
    },
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:86 recovered
    recovered(qself: QSelf | undefined, path: ast.Path): Ty {
      return new ast.Ty(ast.DUMMY_NODE_ID, { $: "Path", _0: qself, _1: path }, path.span);
    },
  } as RecoverQPath<Ty>,

  /** `impl RecoverQPath for Pat` */
  Pat: {
    PATH_STYLE: PathStyle.Pat,
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:93 to_ty
    to_ty(self: Pat): Ty | undefined {
      return self.to_ty();
    },
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:96 recovered
    recovered(qself: QSelf | undefined, path: ast.Path): Pat {
      return new ast.Pat(ast.DUMMY_NODE_ID, { $: "Path", _0: qself, _1: path }, path.span);
    },
  } as RecoverQPath<Pat>,

  /** `impl RecoverQPath for Expr` (`PATH_STYLE` is the trait default, `PathStyle::Expr`). */
  Expr: {
    PATH_STYLE: PathStyle.Expr,
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:102 to_ty
    to_ty(self: Expr): Ty | undefined {
      return self.to_ty();
    },
    // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:105 recovered
    recovered(qself: QSelf | undefined, path: ast.Path): Expr {
      return new ast.Expr(ast.DUMMY_NODE_ID, { $: "Path", _0: qself, _1: path }, path.span, [], undefined);
    },
  } as RecoverQPath<Expr>,
};

/** `RecoverQPath for Box<Expr>` (created once; see ast_traits.ts). */
const RecoverQPath_Box_Expr: RecoverQPath<Expr> = RecoverQPath.Box(RecoverQPath.Expr);

export type AttemptLocalParseRecovery = gen.AttemptLocalParseRecovery;
export const AttemptLocalParseRecovery = {
  ...gen.AttemptLocalParseRecovery,

  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:129 yes
  yes(self: AttemptLocalParseRecovery): boolean {
    switch (self) {
      case "Yes":
        return true;
      case "No":
        return false;
    }
  },

  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:136 no
  no(self: AttemptLocalParseRecovery): boolean {
    switch (self) {
      case "Yes":
        return false;
      case "No":
        return true;
    }
  },
};

/// Checks if the given `lookup` identifier is similar to any keyword symbol in `candidates`.
///
/// This is a specialized version of [`Symbol::find_similar`] that constructs an error when a
/// candidate is found.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:148 find_similar_kw
function find_similar_kw(lookup: Ident, candidates: readonly Symbol[]): MisspelledKw | undefined {
  const r = Symbol.find_similar(lookup.name, candidates);
  if (r === undefined) return undefined;
  const [similar_kw, is_incorrect_case] = r;
  return {
    similar_kw: Symbol.as_str(similar_kw),
    is_incorrect_case,
    span: lookup.span,
  };
}

/// SnapshotParser is used to create a snapshot of the parser
/// without causing duplicate errors being emitted when the `Parser`
/// is dropped.
// PORT: `Deref`/`DerefMut` to the inner parser: callers write `snapshot.parser.x()` (parser-core
// contract rule 6); the impls are kept on the companion for completeness.
export type SnapshotParser = gen.SnapshotParser;
export const SnapshotParser = {
  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:166 deref
  deref(self: SnapshotParser): Parser {
    return self.parser;
  },

  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:172 deref_mut
  deref_mut(self: SnapshotParser): Parser {
    return self.parser;
  },
};

/** `Result::unwrap_err` on a `PResult` (`Ok` is an ICE, as upstream). */
function unwrap_err<T>(r: PResult<T>, debug_ok: (v: T) => string): Diag {
  if (r.$ === "Ok") return panic(`called \`Result::unwrap_err()\` on an \`Ok\` value: ${debug_ok(r._0)}`);
  return r._0;
}

/** `str` ordering (`Ord for str`, bytewise UTF-8 = code point order), for `sort_by_cached_key`. */
function cmp_str(a: string, b: string): -1 | 0 | 1 {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const c = x[i]!.codePointAt(0)!;
    const d = y[i]!.codePointAt(0)!;
    if (c !== d) return c < d ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** `Option<usize> < Option<usize>` (derived `PartialOrd`: `None < Some(_)`). */
function option_lt(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined) return b !== undefined;
  if (b === undefined) return false;
  return a < b;
}

/** `self.psess.source_map().span_to_snippet(sp)` with the `String` as a JS string (upstream calls the
 *  source map directly in two places instead of `Parser::span_to_snippet`). */
function sm_span_to_snippet(p: Parser, sp: Span): Result<string, SpanSnippetError> {
  const r = p.psess.source_map().span_to_snippet(sp);
  if (r.$ === "Err") return r;
  return Ok(r._0.toString());
}

// ---- impl<'a> Parser<'a> ----

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:178 dcx
Parser.prototype.dcx = function (this: Parser): DiagCtxtHandle {
  return this.psess.dcx();
};

/// Replace `self` with `snapshot.parser`.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:183 restore_snapshot
Parser.prototype.restore_snapshot = function (this: Parser, snapshot: SnapshotParser): void {
  // PORT: `*self = snapshot.parser;` moves every field of the snapshot into `self` (the snapshot is
  // consumed; nothing uses it afterwards).
  Object.assign(this, snapshot.parser);
};

/// Create a snapshot of the `Parser`.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:188 create_snapshot_for_diagnostic
Parser.prototype.create_snapshot_for_diagnostic = function (this: Parser): SnapshotParser {
  const snapshot = clone_Parser(this);
  return { parser: snapshot };
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:193 span_to_snippet
Parser.prototype.span_to_snippet = function (this: Parser, span: Span): Result<string, SpanSnippetError> {
  // PORT: `SourceMap::span_to_snippet` returns the source text as `Str`; the `String` is a JS string.
  const r = this.psess.source_map().span_to_snippet(span);
  if (r.$ === "Err") return r;
  return Ok(r._0.toString());
};

/// Emits an error with suggestions if an identifier was expected but not found.
///
/// Returns a possibly recovered identifier.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:200 expected_ident_found
Parser.prototype.expected_ident_found = function (this: Parser, recover: boolean): PResult<[Ident, IdentKind]> {
  const valid_follow: readonly TokenKind[] = [
    TK.Eq,
    TK.Colon,
    TK.Comma,
    TK.Semi,
    TK.PathSep,
    TK.OpenBrace,
    TK.OpenParen,
    TK.CloseBrace,
    TK.CloseParen,
  ];
  if (this.prev_token.kind.$ === "DocComment" && valid_follow.some((k) => TokenKind_eq(k, this.token.kind))) {
    const err = this.dcx().create_err(
      DocCommentDoesNotDocumentAnything_diagnostic({
        span: this.prev_token.span,
        missing_comma: undefined,
      }),
    );
    return Err(err);
  }

  let recovered_ident: [Ident, IdentKind] | undefined = undefined;
  // we take this here so that the correct original token is retained in
  // the diagnostic, regardless of eager recovery.
  const bad_token = this.token;

  // suggest prepending a keyword in identifier position with `r#`
  let suggest_raw: SuggEscapeIdentifier | undefined;
  const tok_ident = this.token.ident();
  if (
    tok_ident !== undefined &&
    tok_ident[1] === "Normal" &&
    tok_ident[0].is_raw_guess() &&
    this.look_ahead(1, (t) => valid_follow.some((k) => TokenKind_eq(k, t.kind)))
  ) {
    const ident = tok_ident[0];
    recovered_ident = [ident, "Raw"];

    // `Symbol::to_string()` is different from `Symbol::into_diag_arg()`,
    // which uses `Symbol::to_ident_string()` and "helpfully" adds an implicit `r#`
    const ident_name = Symbol.as_str(ident.name);

    suggest_raw = { span: Span.shrink_to_lo(ident.span), ident_name };
  } else {
    suggest_raw = undefined;
  }

  let suggest_remove_comma: SuggRemoveComma | undefined;
  let comma_ident: [Ident, IdentKind] | undefined;
  if (this.token.eq(TK.Comma) && (comma_ident = this.look_ahead(1, (t) => t.ident())) !== undefined) {
    const ident = comma_ident;
    if (recover) {
      this.bump();
      recovered_ident = ident;
    }

    suggest_remove_comma = { span: bad_token.span };
  } else {
    suggest_remove_comma = undefined;
  }

  const bad = this.is_lit_bad_ident();
  let help_cannot_start_number: HelpIdentifierStartsWithNumber | undefined;
  if (bad !== undefined) {
    const [len, valid_portion] = bad;
    const [invalid, valid] = Span.split_at(this.token.span, len);

    recovered_ident = [Ident.new(valid_portion, valid), "Normal"];

    help_cannot_start_number = { num_span: invalid };
  }

  const err = this.dcx().create_err(
    ExpectedIdentifier_diagnostic({
      span: bad_token.span,
      token: bad_token,
      suggest_raw,
      suggest_remove_comma,
      help_cannot_start_number,
    }),
  );

  // If the token we have is a `<` it *might* be a misplaced generic
  // parameter list as in `fn <T>id(x: T) -> T { x }`.
  // FIXME: Could we recover with this?
  if (this.token.eq(TK.Lt)) {
    // Let's check if the previous token could denote the start of an item
    // whose kind can have generics.
    const prev_ident = this.prev_token.non_raw_ident();
    if (prev_ident !== undefined) {
      const name = prev_ident.name;
      if (
        name === kw.Fn ||
        name === kw.Type ||
        name === kw.Struct ||
        name === kw.Enum ||
        name === kw.Union ||
        name === kw.Trait
      ) {
        const r = this.parse_generics();
        if (r.$ === "Ok") {
          const generics = r._0;
          let snippet: Result<string, SpanSnippetError> | undefined;
          if (
            !this.look_ahead(1, (t) => t.eq(TK.Lt)) &&
            (snippet = sm_span_to_snippet(this, generics.span)).$ === "Ok"
          ) {
            err.multipart_suggestion(
              `place the generic parameter name after the ${Symbol.as_str(name)} name`,
              [
                [Span.shrink_to_hi(this.token.span), snippet._0],
                [generics.span, ""],
              ],
              Applicability.MaybeIncorrect,
            );
          } else {
            err.help(`place the generic parameter name after the ${Symbol.as_str(name)} name`);
          }
        } else {
          // It's unlikely that the user meant to write a generic parameter list.
          // Let's not show them errors specific to generics.
          r._0.cancel();
        }
      }
    }
  }

  if (recovered_ident !== undefined && recover) {
    err.emit();
    return Ok(recovered_ident);
  } else {
    return Err(err);
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:321 expected_ident_found_err
Parser.prototype.expected_ident_found_err = function (this: Parser): Diag {
  return unwrap_err(this.expected_ident_found(false), ([i, k]) => `(${debug_Ident(i, PLAIN)}, ${k})`);
};

/// Checks if the current token is a integer or float literal and looks like
/// it could be a invalid identifier with digits at the start.
///
/// Returns the number of characters (bytes) composing the invalid portion
/// of the identifier and the valid portion of the identifier.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:330 is_lit_bad_ident
Parser.prototype.is_lit_bad_ident = function (this: Parser): [number, Symbol] | undefined {
  // ensure that the integer literal is followed by a *invalid*
  // suffix: this is how we know that it is a identifier with an
  // invalid beginning.
  const k = this.token.kind;
  if (
    k.$ === "Literal" &&
    (k._0.kind.$ === "Integer" || k._0.kind.$ === "Float") &&
    k._0.suffix !== undefined && // no suffix makes it a valid literal
    MetaItemLit.from_token(this.token) === undefined
  ) {
    return [utf8_len(Symbol.as_str(k._0.symbol)), k._0.suffix];
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:347 expected_one_of_not_found
Parser.prototype.expected_one_of_not_found = function (
  this: Parser,
  edible: readonly ExpTokenPair[],
  inedible: readonly ExpTokenPair[],
): PResult<ErrorGuaranteed> {
  // debug!("expected_one_of_not_found(edible: {:?}, inedible: {:?})", edible, inedible);
  // rustc: compiler/rustc_parse/src/parser/diagnostics.rs:353 tokens_to_string
  function tokens_to_string(tokens: readonly TokenType[]): string {
    // This might be a sign we need a connect method on `Iterator`.
    let b = tokens.length === 0 ? "" : TokenType.to_string(tokens[0]!);
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i + 1]!;
      if (tokens.length > 2 && i === tokens.length - 2) {
        b += ", or ";
      } else if (tokens.length === 2 && i === tokens.length - 2) {
        b += " or ";
      } else {
        b += ", ";
      }
      b += TokenType.to_string(a);
    }
    return b;
  }

  for (const exp_ of [...edible, ...inedible]) {
    this.expected_token_types.insert(exp_.token_type);
  }
  // PORT: `sort_by_cached_key(|x| x.to_string())` is a stable sort by the key; then `dedup()`.
  const keyed: [string, TokenType][] = [...this.expected_token_types.iter()].map((x) => [TokenType.to_string(x), x]);
  keyed.sort((a, b) => cmp_str(a[0], b[0]));
  const expected: TokenType[] = [];
  for (const [, t] of keyed) {
    if (expected.length === 0 || expected[expected.length - 1] !== t) expected.push(t);
  }

  const sm = this.psess.source_map();

  // Special-case "expected `;`" errors.
  if (expected.includes(TokenType.Semi)) {
    // If the user is trying to write a ternary expression, recover it and
    // return an Err to prevent a cascade of irrelevant diagnostics.
    if (this.prev_token.eq(TK.Question)) {
      const r = this.maybe_recover_from_ternary_operator(undefined);
      if (r.$ === "Err") {
        return Err(r._0);
      }
    }

    if (this.token.span === DUMMY_SP || this.prev_token.span === DUMMY_SP) {
      // Likely inside a macro, can't provide meaningful suggestions.
    } else if (!sm.is_multiline(Span.until(this.prev_token.span, this.token.span))) {
      // The current token is in the same line as the prior token, not recoverable.
    } else if (
      [TK.Comma, TK.Colon].some((k) => TokenKind_eq(k, this.token.kind)) &&
      this.prev_token.eq(TK.CloseParen)
    ) {
      // Likely typo: The current token is on a new line and is expected to be
      // `.`, `;`, `?`, or an operator after a close delimiter token.
      //
      // let a = std::process::Command::new("echo")
      //         .arg("1")
      //         ,arg("2")
      //         ^
      // https://github.com/rust-lang/rust/issues/72253
    } else if (
      this.look_ahead(1, (t) => t.eq(TK.CloseBrace) || (t.can_begin_expr() && !t.eq(TK.Colon))) &&
      [TK.Comma, TK.Colon].some((k) => TokenKind_eq(k, this.token.kind))
    ) {
      // Likely typo: `,` → `;` or `:` → `;`. This is triggered if the current token is
      // either `,` or `:`, and the next token could either start a new statement or is a
      // block close. For example:
      //
      //   let x = 32:
      //   let y = 42;
      const guar = this.dcx().emit_err(
        ExpectedSemi_diagnostic({
          span: this.token.span,
          token: this.token,
          unexpected_token_label: undefined,
          sugg: { $: "ChangeToSemi", _0: this.token.span },
        }),
      );
      this.bump();
      return Ok(guar);
    } else if (
      this.look_ahead(
        0,
        (t) =>
          t.eq(TK.CloseBrace) ||
          ((t.can_begin_expr() || t.can_begin_item()) && !t.eq(TK.Semi) && !t.eq(TK.Pound)) ||
          // Avoid triggering with too many trailing `#` in raw string.
          (sm.is_multiline(Span.until(Span.shrink_to_hi(this.prev_token.span), Span.shrink_to_lo(this.token.span))) &&
            t.eq(TK.Pound)),
      ) &&
      !expected.includes(TokenType.Comma)
    ) {
      // Missing semicolon typo. This is triggered if the next token could either start a
      // new statement or is a block close. For example:
      //
      //   let x = 32
      //   let y = 42;
      const span = Span.shrink_to_hi(this.prev_token.span);
      const guar = this.dcx().emit_err(
        ExpectedSemi_diagnostic({
          span,
          token: this.token,
          unexpected_token_label: this.token.span,
          sugg: { $: "AddSemi", _0: span, _1: Applicability.MachineApplicable },
        }),
      );
      return Ok(guar);
    }
  }

  if (this.token.eq(TK.EqEq) && this.prev_token.is_ident() && expected.includes(TokenType.Eq)) {
    // Likely typo: `=` → `==` in let expr or enum item
    return Err(this.dcx().create_err(UseEqInstead_diagnostic({ span: this.token.span })));
  }

  if ((this.token.is_keyword(kw.Move) || this.token.is_keyword(kw.Use)) && this.prev_token.is_keyword(kw.Async)) {
    // The 2015 edition is in use because parsing of `async move` or `async use` has failed.
    const span = Span.to(this.prev_token.span, this.token.span);
    if (this.token.is_keyword(kw.Move)) {
      return Err(this.dcx().create_err(AsyncMoveBlockIn2015_diagnostic({ span })));
    } else {
      // kw::Use
      return Err(this.dcx().create_err(AsyncUseBlockIn2015_diagnostic({ span })));
    }
  }

  const expect = tokens_to_string(expected);
  const actual = token_descr(this.token);
  let msg_exp: string;
  let label_sp: Span;
  let label_exp: string;
  if (expected.length > 1) {
    const fmt = `expected one of ${expect}, found ${actual}`;
    const short_expect = expected.length > 6 ? `${expected.length} possible tokens` : expect;
    [msg_exp, label_sp, label_exp] = [fmt, Span.shrink_to_hi(this.prev_token.span), `expected one of ${short_expect}`];
  } else if (expected.length === 0) {
    [msg_exp, label_sp, label_exp] = [`unexpected token: ${actual}`, this.prev_token.span, "unexpected token after this"];
  } else {
    [msg_exp, label_sp, label_exp] = [
      `expected ${expect}, found ${actual}`,
      Span.shrink_to_hi(this.prev_token.span),
      `expected ${expect}`,
    ];
  }
  this.last_unexpected_token_span = this.token.span;
  // FIXME: translation requires list formatting (for `expect`)
  const err = this.dcx().struct_span_err(this.token.span, msg_exp);

  this.label_expected_raw_ref(err);

  // Look for usages of '=>' where '>=' was probably intended
  if (
    this.token.eq(TK.FatArrow) &&
    expected.some((tok) => tok === TokenType.Operator || tok === TokenType.Le) &&
    !expected.some((tok) => tok === TokenType.FatArrow || tok === TokenType.CloseBrace)
  ) {
    err.span_suggestion_verbose(
      this.token.span,
      'you might have meant to write a "greater than or equal to" comparison',
      ">=",
      Applicability.MaybeIncorrect,
    );
  }

  const prev_nr = this.prev_token.non_raw_ident();
  if (prev_nr !== undefined) {
    const ident = prev_nr;
    const s = Symbol.as_str(ident.name);
    if (s === "def" || s === "fun" || s === "func" || s === "function") {
      err.span_suggestion_short(
        this.prev_token.span,
        `write \`fn\` instead of \`${Symbol.as_str(ident.name)}\` to declare a function`,
        "fn",
        Applicability.MachineApplicable,
      );
    }
  }

  const pk = this.prev_token.kind;
  const ck = this.token.kind;
  if (pk.$ === "Ident" && ck.$ === "Ident") {
    const prev = pk._0;
    const cur = ck._0;
    const concat = Symbol.intern(`${Symbol.as_str(prev)}${Symbol.as_str(cur)}`);
    const ident = Ident.new(concat, DUMMY_SP);
    if (ident.is_used_keyword() || ident.is_reserved() || ident.is_raw_guess()) {
      const concat_span = Span.to(this.prev_token.span, this.token.span);
      err.span_suggestion_verbose(
        concat_span,
        `consider removing the space to spell keyword \`${Symbol.as_str(concat)}\``,
        Symbol.as_str(concat),
        Applicability.MachineApplicable,
      );
    }
  }

  // Try to detect an intended c-string literal while using a pre-2021 edition. The heuristic
  // here is to identify a cooked, uninterpolated `c` id immediately followed by a string, or
  // a cooked, uninterpolated `cr` id immediately followed by a string or a `#`, in an edition
  // where c-string literals are not allowed. There is the very slight possibility of a false
  // positive for a `cr#` that wasn't intended to start a c-string literal, but identifying
  // that in the parser requires unbounded lookahead, so we only add a hint to the existing
  // error rather than replacing it entirely.
  if (
    ((this.prev_token.eq({ $: "Ident", _0: sym.character(ch("c")), _1: "Normal" }) &&
      ck.$ === "Literal" &&
      ck._0.kind.$ === "Str") ||
      (this.prev_token.eq({ $: "Ident", _0: sym.cr, _1: "Normal" }) &&
        ((ck.$ === "Literal" && ck._0.kind.$ === "Str") || ck.$ === "Pound"))) &&
    Span.hi(this.prev_token.span) === Span.lo(this.token.span) &&
    !Span.at_least_rust_2021(this.token.span)
  ) {
    err.note("you may be trying to write a c-string literal");
    err.note("c-string literals require Rust 2021 or later");
    err.subdiagnostic(HelpUseLatestEdition_subdiagnostic(HelpUseLatestEdition.new()));
  }

  // `pub` may be used for an item or `pub(crate)`
  if (this.prev_token.is_ident_named(sym.public) && (this.token.can_begin_item() || this.token.eq(TK.OpenParen))) {
    err.span_suggestion_short(
      this.prev_token.span,
      "write `pub` instead of `public` to make the item public",
      "pub",
      Applicability.MachineApplicable,
    );
  }

  if (ck.$ === "DocComment") {
    const kind = ck._0;
    const style = ck._1;
    // This is to avoid suggesting converting a doc comment to a regular comment
    // when missing a comma before the doc comment in lists (#142311):
    //
    // ```
    // enum Foo{
    //     A /// xxxxxxx
    //     B,
    // }
    // ```
    if (!expected.includes(TokenType.Comma)) {
      // We have something like `expr //!val` where the user likely meant `expr // !val`
      const pos = BytePos(Span.lo(this.token.span) + 2);
      const span = Span.with_hi(Span.with_lo(this.token.span, pos), pos);
      let what: string;
      if (kind === "Line" && style === "Inner") what = "`!`";
      else if (kind === "Block" && style === "Inner") what = "`!`";
      else if (kind === "Line" && style === "Outer") what = "the last `/`";
      else what = "the last `*`";
      err.span_suggestion_verbose(
        span,
        `add a space before ${what} to write a regular comment`,
        " ",
        Applicability.MaybeIncorrect,
      );
    }
  }

  let sp: Span;
  if (this.token.eq(TK.Eof)) {
    // This is EOF; don't want to point at the following char, but rather the last token.
    sp = this.prev_token.span;
  } else {
    sp = label_sp;
  }

  if (this.check_too_many_raw_str_terminators(err)) {
    if (expected.includes(TokenType.Semi) && this.eat(exp.Semi)) {
      const guar = err.emit_err();
      return Ok(guar);
    } else {
      return Err(err);
    }
  }

  if (this.prev_token.span === DUMMY_SP) {
    // Account for macro context where the previous span might not be
    // available to avoid incorrect output (#54841).
    err.span_label(this.token.span, label_exp);
  } else if (!sm.is_multiline(Span.until(Span.shrink_to_hi(this.token.span), Span.shrink_to_lo(sp)))) {
    // When the spans are in the same line, it means that the only content between
    // them is whitespace, point at the found token in that case:
    //
    // X |     () => { syntax error };
    //   |                    ^^^^^ expected one of 8 possible tokens here
    //
    // instead of having:
    //
    // X |     () => { syntax error };
    //   |                   -^^^^^ unexpected token
    //   |                   |
    //   |                   expected one of 8 possible tokens here
    err.span_label(this.token.span, label_exp);
  } else {
    err.span_label(sp, label_exp);
    err.span_label(this.token.span, "unexpected token");
  }

  // Check for misspelled keywords if there are no suggestions added to the diagnostic.
  const suggestions = err.deref().suggestions;
  if (suggestions.$ === "Enabled" && suggestions._0.length === 0) {
    this.check_for_misspelled_kw(err, expected);
  }
  return Err(err);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:652 is_expected_raw_ref_mut
Parser.prototype.is_expected_raw_ref_mut = function (this: Parser): boolean {
  return (
    this.prev_token.is_keyword(kw.Raw) &&
    this.expected_token_types.contains(TokenType.KwMut) &&
    this.expected_token_types.contains(TokenType.KwConst) &&
    this.token.can_begin_expr()
  );
};

/// Adds a label when `&raw EXPR` was written instead of `&raw const EXPR`/`&raw mut EXPR`.
///
/// Given that not all parser diagnostics flow through `expected_one_of_not_found`, this
/// label may need added to other diagnostics emission paths as needed.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:663 label_expected_raw_ref
Parser.prototype.label_expected_raw_ref = function (this: Parser, err: Diag): void {
  if (this.is_expected_raw_ref_mut()) {
    err.span_suggestions(
      Span.shrink_to_hi(this.prev_token.span),
      "`&raw` must be followed by `const` or `mut` to be a raw reference expression",
      [" const", " mut"],
      Applicability.MaybeIncorrect,
    );
  }
};

/// Checks if the current token or the previous token are misspelled keywords
/// and adds a helpful suggestion.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:676 check_for_misspelled_kw
Parser.prototype.check_for_misspelled_kw = function (this: Parser, err: Diag, expected: readonly TokenType[]): void {
  const curr = this.token.ident();
  if (curr === undefined) {
    return;
  }
  const curr_ident = curr[0];
  // `expected.len().checked_sub(10).map_or(&expected, |index| &expected[index..])`
  const expected_token_types: readonly TokenType[] = expected.length >= 10 ? expected.slice(expected.length - 10) : expected;
  const expected_keywords: Symbol[] = [];
  for (const token_ of expected_token_types) {
    const k = TokenType.is_keyword(token_);
    if (k !== undefined) expected_keywords.push(k);
  }

  // When there are a few keywords in the last ten elements of `self.expected_token_types`
  // and the current token is an identifier, it's probably a misspelled keyword. This handles
  // code like `async Move {}`, misspelled `if` in match guard, misspelled `else` in
  // `if`-`else` and misspelled `where` in a where clause.
  let misspelled_kw: MisspelledKw | undefined;
  let prev: [Ident, IdentKind] | undefined;
  if (
    expected_keywords.length !== 0 &&
    !curr_ident.is_used_keyword() &&
    (misspelled_kw = find_similar_kw(curr_ident, expected_keywords)) !== undefined
  ) {
    err.subdiagnostic(MisspelledKw_subdiagnostic(misspelled_kw));
    // We don't want other suggestions to be added as they are most likely meaningless
    // when there is a misspelled keyword.
    err.seal_suggestions();
  } else if ((prev = this.prev_token.ident()) !== undefined && !prev[0].is_used_keyword()) {
    const prev_ident = prev[0];
    // We generate a list of all keywords at runtime rather than at compile time
    // so that it gets generated only when the diagnostic needs it.
    // Also, it is unlikely that this list is generated multiple times because the
    // parser halts after execution hits this path.
    const all_keywords = used_keywords(() => Span.edition(prev_ident.span));

    // Otherwise, check the previous token with all the keywords as possible candidates.
    // This handles code like `Struct Human;` and `While a < b {}`.
    // We check the previous token only when the current token is an identifier to avoid
    // false positives like suggesting keyword `for` for `extern crate foo {}`.
    const misspelled_kw = find_similar_kw(prev_ident, all_keywords);
    if (misspelled_kw !== undefined) {
      err.subdiagnostic(MisspelledKw_subdiagnostic(misspelled_kw));
      // We don't want other suggestions to be added as they are most likely meaningless
      // when there is a misspelled keyword.
      err.seal_suggestions();
    }
  }
};

/// The user has written `#[attr] expr` which is unsupported. (#106020)
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:720 attr_on_non_tail_expr
Parser.prototype.attr_on_non_tail_expr = function (this: Parser, expr: Expr): ErrorGuaranteed {
  // Missing semicolon typo error.
  const span = Span.shrink_to_hi(this.prev_token.span);
  const err = this.dcx().create_err(
    ExpectedSemi_diagnostic({
      span,
      token: this.token,
      unexpected_token_label: this.token.span,
      // A semicolon may discard the intended return value of a cfg-gated tail expression.
      sugg: { $: "AddSemi", _0: span, _1: Applicability.MaybeIncorrect },
    }),
  );
  let attr_span: Span;
  if (expr.attrs.length === 0) {
    return unreachable();
  } else if (expr.attrs.length === 1) {
    attr_span = expr.attrs[0]!.span;
  } else {
    const first = expr.attrs[0]!;
    for (const attr of expr.attrs.slice(1)) {
      err.span_label(attr.span, "");
    }
    attr_span = first.span;
  }
  err.span_label(
    attr_span,
    `only \`;\` terminated statements or tail expressions are allowed after ${
      expr.attrs.length === 1 ? "this attribute" : "these attributes"
    }`,
  );
  if (this.token.eq(TK.Pound) && this.look_ahead(1, (t) => t.eq(TK.OpenBracket))) {
    // We have
    // #[attr]
    // expr
    // #[not_attr]
    // other_expr
    err.span_label(span, "expected `;` here");
    err.multipart_suggestion(
      "alternatively, consider surrounding the expression with a block",
      [
        [Span.shrink_to_lo(expr.span), "{ "],
        [Span.shrink_to_hi(expr.span), " }"],
      ],
      Applicability.MaybeIncorrect,
    );

    // Special handling for `#[cfg(...)]` chains
    const snapshot = this.create_snapshot_for_diagnostic();
    // PORT: the let-chain is a labeled block; `break chain` is a failed condition.
    chain: {
      if (expr.attrs.length !== 1) break chain;
      const attr = expr.attrs[0]!;
      if (attr.kind.$ !== "Normal") break chain;
      const attr_kind = attr.kind._0;
      if (attr_kind.item.path.segments.length !== 1) break chain;
      const segment = attr_kind.item.path.segments[0]!;
      if (segment.ident.name !== sym.cfg) break chain;
      const args_span = ast.AttrArgs.span(attr_kind.item.args);
      if (args_span === undefined) break chain;
      const r = snapshot.parser.parse_attribute({ $: "Forbidden", _0: undefined });
      if (r.$ === "Err") {
        const inner_err = r._0;
        inner_err.cancel();
        return err.emit_err();
      }
      const next_attr = r._0;
      if (next_attr.kind.$ !== "Normal") break chain;
      const next_attr_kind = next_attr.kind._0;
      const next_attr_args_span = ast.AttrArgs.span(next_attr_kind.item.args);
      if (next_attr_args_span === undefined) break chain;
      if (next_attr_kind.item.path.segments.length !== 1) break chain;
      const next_segment = next_attr_kind.item.path.segments[0]!;
      if (next_segment.ident.name !== sym.cfg) break chain;

      const re = snapshot.parser.parse_expr();
      if (re.$ === "Err") {
        const inner_err = re._0;
        inner_err.cancel();
        return err.emit_err();
      }
      const next_expr = re._0;
      // We have for sure
      // #[cfg(..)]
      // expr
      // #[cfg(..)]
      // other_expr
      // So we suggest using `if cfg!(..) { expr } else if cfg!(..) { other_expr }`.
      const margin = this.psess.source_map().span_to_margin(next_expr.span) ?? 0;
      const sugg: [Span, string][] = [
        [Span.with_hi(attr.span, Span.hi(segment.span())), "if cfg!"],
        [Span.with_hi(Span.shrink_to_hi(args_span), Span.hi(attr.span)), " {"],
        [Span.shrink_to_lo(expr.span), "    "],
        [Span.with_hi(next_attr.span, Span.hi(next_segment.span())), "} else if cfg!"],
        [Span.with_hi(Span.shrink_to_hi(next_attr_args_span), Span.hi(next_attr.span)), " {"],
        [Span.shrink_to_lo(next_expr.span), "    "],
        [Span.shrink_to_hi(next_expr.span), `\n${" ".repeat(margin)}}`],
      ];
      err.multipart_suggestion(
        "it seems like you are trying to provide different expressions depending on `cfg`, consider using `if cfg!(..)`",
        sugg,
        // Unlike `#[cfg]`, `if cfg!` still checks disabled branches.
        Applicability.MaybeIncorrect,
      );
    }
  }

  return err.emit_err();
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:825 check_too_many_raw_str_terminators
Parser.prototype.check_too_many_raw_str_terminators = function (this: Parser, err: Diag): boolean {
  const sm = this.psess.source_map();
  const pk = this.prev_token.kind;
  if (
    pk.$ === "Literal" &&
    (pk._0.kind.$ === "StrRaw" || pk._0.kind.$ === "ByteStrRaw") &&
    this.token.kind.$ === "Pound" &&
    !sm.is_multiline(Span.until(Span.shrink_to_hi(this.prev_token.span), Span.shrink_to_lo(this.token.span)))
  ) {
    const n_hashes: number = pk._0.kind._0;
    err.primary_message("too many `#` when terminating raw string");
    const str_span = this.prev_token.span;
    let span = this.token.span;
    let count = 0;
    while (this.token.eq(TK.Pound) && !sm.is_multiline(Span.until(Span.shrink_to_hi(span), Span.shrink_to_lo(this.token.span)))) {
      span = Span.with_hi(span, Span.hi(this.token.span));
      this.bump();
      count += 1;
    }
    err.span(span);
    err.span_suggestion_verbose(span, `remove the extra \`#\`${pluralize(count)}`, "", Applicability.MachineApplicable);
    err.span_label(str_span, `this raw string started with ${n_hashes} \`#\`${pluralize(n_hashes)}`);
    return true;
  }
  return false;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:867 maybe_suggest_struct_literal
Parser.prototype.maybe_suggest_struct_literal = function (
  this: Parser,
  lo: Span,
  s: BlockCheckMode,
  maybe_struct_name: Token,
): PResult<Block> | undefined {
  void maybe_struct_name;
  if (this.token.is_ident() && this.look_ahead(1, (t) => t.eq(TK.Colon))) {
    // We might be having a struct literal where people forgot to include the path:
    // fn foo() -> Foo {
    //     field: value,
    // }
    // debug!(?maybe_struct_name, ?self.token);
    const snapshot = this.create_snapshot_for_diagnostic();
    const path = new ast.Path(Span.shrink_to_lo(this.prev_token.span), []);
    const struct_expr = snapshot.parser.parse_expr_struct(undefined, path, false);
    const block_tail = this.parse_block_tail(lo, s, "No");
    if (struct_expr.$ === "Ok" && block_tail.$ === "Err") {
      const expr = struct_expr._0;
      const err = block_tail._0;
      // We have encountered the following:
      // fn foo() -> Foo {
      //     field: value,
      // }
      // Suggest:
      // fn foo() -> Foo { Path {
      //     field: value,
      // } }
      err.cancel();
      this.restore_snapshot(snapshot);
      const guar = this.dcx().emit_err(
        StructLiteralBodyWithoutPath_diagnostic({
          span: expr.span,
          sugg: {
            before: Span.shrink_to_lo(expr.span),
            after: Span.shrink_to_hi(expr.span),
          },
        }),
      );
      return Ok(this.mk_block([this.mk_stmt_err(expr.span, guar)], s, Span.to(lo, this.prev_token.span)));
    } else if (struct_expr.$ === "Err" && block_tail.$ === "Ok") {
      const err = struct_expr._0;
      const tail = block_tail._0;
      // We have a block tail that contains a somehow valid expr.
      err.cancel();
      return Ok(tail);
    } else if (struct_expr.$ === "Err" && block_tail.$ === "Err") {
      const snapshot_err = struct_expr._0;
      const err = block_tail._0;
      // We don't know what went wrong, emit the normal error.
      snapshot_err.cancel();
      this.consume_block(exp.OpenBrace, exp.CloseBrace, "Yes");
      return Err(err);
    } else {
      // (Ok(_), Ok(tail))
      return block_tail;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:925 recover_closure_body
Parser.prototype.recover_closure_body = function (
  this: Parser,
  err: Diag,
  before: Token,
  prev: Token,
  token_: Token,
  lo: Span,
  decl_hi: Span,
): PResult<Expr> {
  err.span_label(Span.to(lo, decl_hi), "while parsing the body of this closure");
  let guar: ErrorGuaranteed;
  if (before.kind.$ === "OpenBrace" && token_.kind.$ !== "OpenBrace") {
    // `{ || () }` should have been `|| { () }`
    err.multipart_suggestion(
      "you might have meant to open the body of the closure, instead of enclosing the closure in a block",
      [
        [before.span, ""],
        [Span.shrink_to_hi(prev.span), " {"],
      ],
      Applicability.MaybeIncorrect,
    );
    const g = err.emit_err();
    this.eat_to_tokens([exp.CloseBrace]);
    guar = g;
  } else if (before.kind.$ === "OpenParen" && token_.kind.$ !== "OpenBrace") {
    // We are within a function call or tuple, we can emit the error
    // and recover.
    this.eat_to_tokens([exp.CloseParen, exp.Comma]);

    err.multipart_suggestion(
      "you might have meant to open the body of the closure",
      [
        [Span.shrink_to_hi(prev.span), " {"],
        [Span.shrink_to_lo(this.token.span), "}"],
      ],
      Applicability.MaybeIncorrect,
    );
    guar = err.emit_err();
  } else if (token_.kind.$ !== "OpenBrace") {
    // We don't have a heuristic to correctly identify where the block
    // should be closed.
    err.multipart_suggestion(
      "you might have meant to open the body of the closure",
      [[Span.shrink_to_hi(prev.span), " {"]],
      Applicability.HasPlaceholders,
    );
    return Err(err);
  } else {
    return Err(err);
  }
  return Ok(this.mk_expr_err(Span.to(lo, this.token.span), guar));
};

/// Eats and discards tokens until one of `closes` is encountered. Respects token trees,
/// passes through any errors encountered. Used for error recovery.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:983 eat_to_tokens
Parser.prototype.eat_to_tokens = function (this: Parser, closes: readonly ExpTokenPair[]): void {
  const r = this.parse_seq_to_before_tokens(closes, [], SeqSep.none(), (p) => Ok(p.parse_token_tree()));
  if (r.$ === "Err") {
    r._0.cancel();
  }
};

/// This function checks if there are trailing angle brackets and produces
/// a diagnostic to suggest removing them.
///
/// ```ignore (diagnostic)
/// let _ = [1, 2, 3].into_iter().collect::<Vec<usize>>>>();
///                                                    ^^ help: remove extra angle brackets
/// ```
///
/// If `true` is returned, then trailing brackets were recovered, tokens were consumed
/// up until one of the tokens in 'end' was encountered, and an error was emitted.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1001 check_trailing_angle_brackets
Parser.prototype.check_trailing_angle_brackets = function (
  this: Parser,
  segment: PathSegment,
  end: readonly ExpTokenPair[],
): ErrorGuaranteed | undefined {
  if (!this.may_recover()) {
    return undefined;
  }

  // This function is intended to be invoked after parsing a path segment where there are two
  // cases:
  //
  // 1. A specific token is expected after the path segment.
  //    eg. `x.foo(`, `x.foo::<u32>(` (parenthesis - method call),
  //        `Foo::`, or `Foo::<Bar>::` (mod sep - continued path).
  // 2. No specific token is expected after the path segment.
  //    eg. `x.foo` (field access)
  //
  // This function is called after parsing `.foo` and before parsing the token `end` (if
  // present). This includes any angle bracket arguments, such as `.foo::<u32>` or
  // `Foo::<Bar>`.

  // We only care about trailing angle brackets if we previously parsed angle bracket
  // arguments. This helps stop us incorrectly suggesting that extra angle brackets be
  // removed in this case:
  //
  // `x.foo >> (3)` (where `x.foo` is a `u32` for example)
  //
  // This case is particularly tricky as we won't notice it just looking at the tokens -
  // it will appear the same (in terms of upcoming tokens) as below (since the `::<u32>` will
  // have already been parsed):
  //
  // `x.foo::<u32>>>(3)`
  const parsed_angle_bracket_args = segment.args !== undefined && ast.GenericArgs.is_angle_bracketed(segment.args);

  // debug!("check_trailing_angle_brackets: parsed_angle_bracket_args={:?}", parsed_angle_bracket_args);
  if (!parsed_angle_bracket_args) {
    return undefined;
  }

  // Keep the span at the start so we can highlight the sequence of `>` characters to be
  // removed.
  const lo = this.token.span;

  // We need to look-ahead to see if we have `>` characters without moving the cursor forward
  // (since we might have the field access case and the characters we're eating are
  // actual operators and not trailing characters - ie `x.foo >> 3`).
  let position = 0;

  // We can encounter `>` or `>>` tokens in any order, so we need to keep track of how
  // many of each (so we can correctly pluralize our error messages) and continue to
  // advance.
  let number_of_shr = 0;
  let number_of_gt = 0;
  while (
    this.look_ahead(position, (t) => {
      // trace!("check_trailing_angle_brackets: t={:?}", t);
      if (t.eq(TK.Shr)) {
        number_of_shr += 1;
        return true;
      } else if (t.eq(TK.Gt)) {
        number_of_gt += 1;
        return true;
      } else {
        return false;
      }
    })
  ) {
    position += 1;
  }

  // If we didn't find any trailing `>` characters, then we have nothing to error about.
  // debug!("check_trailing_angle_brackets: number_of_gt={:?} number_of_shr={:?}", number_of_gt, number_of_shr);
  if (number_of_gt < 1 && number_of_shr < 1) {
    return undefined;
  }

  // Finally, double check that we have our end token as otherwise this is the
  // second case.
  if (
    this.look_ahead(position, (t) => {
      // trace!("check_trailing_angle_brackets: t={:?}", t);
      return end.some((exp_) => TokenKind_eq(exp_.tok, t.kind));
    })
  ) {
    // Eat from where we started until the end token so that parsing can continue
    // as if we didn't have those extra angle brackets.
    this.eat_to_tokens(end);
    const span = Span.to(lo, this.prev_token.span);

    const num_extra_brackets = number_of_gt + number_of_shr * 2;
    return this.dcx().emit_err(UnmatchedAngleBrackets_diagnostic({ span, num_extra_brackets }));
  }
  return undefined;
};

/// Check if a method call with an intended turbofish has been written without surrounding
/// angle brackets.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1102 check_turbofish_missing_angle_brackets
Parser.prototype.check_turbofish_missing_angle_brackets = function (this: Parser, segment: PathSegment): void {
  if (!this.may_recover()) {
    return;
  }

  if (this.token.eq(TK.PathSep) && segment.args === undefined) {
    const snapshot = this.create_snapshot_for_diagnostic();
    this.bump();
    const lo = this.token.span;
    const r = this.parse_angle_args(undefined);
    if (r.$ === "Ok") {
      const args = r._0;
      const span = Span.to(lo, this.prev_token.span);
      // Detect trailing `>` like in `x.collect::Vec<_>>()`.
      let trailing_span = Span.shrink_to_hi(this.prev_token.span);
      while (this.token.eq(TK.Shr) || this.token.eq(TK.Gt)) {
        trailing_span = Span.to(trailing_span, this.token.span);
        this.bump();
      }
      if (this.token.eq(TK.OpenParen)) {
        // Recover from bad turbofish: `foo.collect::Vec<_>()`.
        segment.args = ast.GenericArgs.from_AngleBracketedArgs({ args, span });

        this.dcx().emit_err(
          GenericParamsWithoutAngleBrackets_diagnostic({
            span,
            sugg: {
              left: Span.shrink_to_lo(span),
              right: trailing_span,
            },
          }),
        );
      } else {
        // This doesn't look like an invalid turbofish, can't recover parse state.
        this.restore_snapshot(snapshot);
      }
    } else {
      // We couldn't parse generic parameters, unlikely to be a turbofish. Rely on
      // generic parse error instead.
      r._0.cancel();
      this.restore_snapshot(snapshot);
    }
  }
};

/// When writing a turbofish with multiple type parameters missing the leading `::`, we will
/// encounter a parse error when encountering the first `,`.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1148 check_mistyped_turbofish_with_multiple_type_params
Parser.prototype.check_mistyped_turbofish_with_multiple_type_params = function (
  this: Parser,
  e: Diag,
  expr: MutRef<Expr>,
): PResult<ErrorGuaranteed> {
  const ek = expr.value.kind;
  if (ek.$ === "Binary" && ek._0.node === "Lt" && this.eat(exp.Comma)) {
    const binop = ek._0;
    const x = this.parse_seq_to_before_end(exp.Gt, SeqSep.trailing_allowed(exp.Comma), (p): PResult<GenericArg> => {
      const r = p.parse_generic_arg(undefined);
      if (r.$ === "Err") return r;
      const arg = r._0;
      if (arg !== undefined) {
        return Ok(arg);
      }
      // If we didn't eat a generic arg, then we should error.
      return p.unexpected_any();
    });
    if (x.$ === "Ok" && x._0[2].$ === "No") {
      if (this.eat(exp.Gt)) {
        // We made sense of it. Improve the error message.
        e.span_suggestion_verbose(
          Span.shrink_to_lo(binop.span),
          msg("use `::<...>` instead of `<...>` to specify lifetime, type, or const arguments"),
          "::",
          Applicability.MaybeIncorrect,
        );
        const r = this.parse_expr();
        if (r.$ === "Ok") {
          // The subsequent expression is valid. Mark
          // `expr` as erroneous and emit `e` now, but
          // return `Ok` so parsing can continue.
          const guar = e.emit_err();
          expr.value = this.mk_expr_err(Span.to(expr.value.span, this.prev_token.span), guar);
          return Ok(guar);
        } else {
          r._0.cancel();
        }
      }
    } else if (x.$ === "Ok") {
      // Ok((_, _, Recovered::Yes(_)))
    } else {
      x._0.cancel();
    }
  }
  return Err(e);
};

/// Suggest add the missing `let` before the identifier in stmt
/// `a: Ty = 1` -> `let a: Ty = 1`
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1202 suggest_add_missing_let_for_stmt
Parser.prototype.suggest_add_missing_let_for_stmt = function (this: Parser, err: Diag): void {
  if (this.token.eq(TK.Colon)) {
    const prev_span = Span.shrink_to_lo(this.prev_token.span);
    const snapshot = this.create_snapshot_for_diagnostic();
    this.bump();
    const r = this.parse_ty();
    if (r.$ === "Ok") {
      if (this.token.eq(TK.Eq)) {
        const sugg = { span: prev_span };
        SuggAddMissingLetStmt_add_to_diag(sugg, err);
      }
    } else {
      r._0.cancel();
    }
    this.restore_snapshot(snapshot);
  }
};

/// Check to see if a pair of chained operators looks like an attempt at chained comparison,
/// e.g. `1 < x <= 3`. If so, suggest either splitting the comparison into two, or
/// parenthesising the leftmost comparison. The return value indicates if recovery happened.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1225 attempt_chained_comparison_suggestion
Parser.prototype.attempt_chained_comparison_suggestion = function (
  this: Parser,
  err: ComparisonOperatorsCannotBeChained,
  inner_op: Expr,
  outer_op: Spanned<AssocOp>,
): boolean {
  const ik = inner_op.kind;
  if (ik.$ === "Binary") {
    const op = ik._0;
    const l1 = ik._1;
    const r1 = ik._2;
    if (l1.kind.$ === "Field" && !l1.kind._1.is_numeric() && r1.kind.$ !== "Lit") {
      // The parser has encountered `foo.bar<baz`, the likelihood of the turbofish
      // suggestion being the only one to apply is high.
      return false;
    }
    const o = outer_op.node;
    const outer = o.$ === "Binary" ? o._0 : undefined;
    const outer_is = (...ks: string[]): boolean => outer !== undefined && ks.includes(outer);
    if (
      // `x == y == z`
      (op.node === "Eq" && outer_is("Eq")) ||
      // `x < y < z` and friends.
      (op.node === "Lt" && outer_is("Lt", "Le")) ||
      (op.node === "Le" && outer_is("Lt", "Le")) ||
      // `x > y > z` and friends.
      (op.node === "Gt" && outer_is("Gt", "Ge")) ||
      (op.node === "Ge" && outer_is("Gt", "Ge"))
    ) {
      const expr_to_str = (e: Expr): string => {
        const r = this.span_to_snippet(e.span);
        return r.$ === "Ok" ? r._0 : pprust.expr_to_string(e);
      };
      err.chaining_sugg = {
        $: "SplitComparison",
        span: Span.shrink_to_hi(inner_op.span),
        middle_term: expr_to_str(r1),
      };
      return false; // Keep the current parse behavior, where the AST is `(x < y) < z`.
    } else if (op.node === "Eq" && outer_is("Lt", "Le", "Gt", "Ge")) {
      // `x == y < z`
      // Consume `z`/outer-op-rhs.
      const snapshot = this.create_snapshot_for_diagnostic();
      const r = this.parse_expr();
      if (r.$ === "Ok") {
        const r2 = r._0;
        // We are sure that outer-op-rhs could be consumed, the suggestion is
        // likely correct.
        err.chaining_sugg = {
          $: "Parenthesize",
          left: Span.shrink_to_lo(r1.span),
          right: Span.shrink_to_hi(r2.span),
        };
        return true;
      } else {
        const expr_err = r._0;
        expr_err.cancel();
        this.restore_snapshot(snapshot);
        return true;
      }
    } else if ((op.node === "Lt" || op.node === "Le" || op.node === "Gt" || op.node === "Ge") && outer_is("Eq")) {
      // `x > y == z`
      const snapshot = this.create_snapshot_for_diagnostic();
      // At this point it is always valid to enclose the lhs in parentheses, no
      // further checks are necessary.
      const r = this.parse_expr();
      if (r.$ === "Ok") {
        err.chaining_sugg = {
          $: "Parenthesize",
          left: Span.shrink_to_lo(l1.span),
          right: Span.shrink_to_hi(r1.span),
        };
        return true;
      } else {
        const expr_err = r._0;
        expr_err.cancel();
        this.restore_snapshot(snapshot);
        return false;
      }
    } else {
      return false;
    }
  }
  return false;
};

/// Produces an error if comparison operators are chained (RFC #558).
/// We only need to check the LHS, not the RHS, because all comparison ops have same
/// precedence (see `fn precedence`) and are left-associative (see `fn fixity`).
///
/// This can also be hit if someone incorrectly writes `foo<bar>()` when they should have used
/// the turbofish (`foo::<bar>()`) syntax. We attempt some heuristic recovery if that is the
/// case.
///
/// Keep in mind that given that `outer_op.is_comparison()` holds and comparison ops are left
/// associative we can infer that we have:
///
/// ```text
///           outer_op
///           /   \
///     inner_op   r2
///        /  \
///      l1    r1
/// ```
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1332 check_no_chained_comparison
Parser.prototype.check_no_chained_comparison = function (
  this: Parser,
  inner_op: Expr,
  outer_op: Spanned<AssocOp>,
): PResult<Expr | undefined> {
  // debug_assert!(outer_op.node.is_comparison(), "check_no_chained_comparison: {:?} is not comparison", outer_op.node);

  const mk_err_expr = (this_: Parser, span: Span, guar: ErrorGuaranteed): PResult<Expr | undefined> =>
    Ok(this_.mk_expr(span, { $: "Err", _0: guar }));

  const ik = inner_op.kind;
  if (ik.$ === "Binary" && ast.BinOpKind.is_comparison(ik._0.node)) {
    const op = ik._0;
    const l1 = ik._1;
    const r1 = ik._2;
    const err: ComparisonOperatorsCannotBeChained = {
      span: [op.span, this.prev_token.span],
      suggest_turbofish: undefined,
      help_turbofish: false,
      chaining_sugg: undefined,
    };
    const outer_is = (k: string): boolean => outer_op.node.$ === "Binary" && outer_op.node._0 === k;

    // Include `<` to provide this recommendation even in a case like
    // `Foo<Bar<Baz<Qux, ()>>>`
    if ((op.node === "Lt" && outer_is("Lt")) || outer_is("Gt")) {
      if (outer_is("Lt")) {
        const snapshot = this.create_snapshot_for_diagnostic();
        this.bump();
        // So far we have parsed `foo<bar<`, consume the rest of the type args.
        const modifiers: [TokenKind, number][] = [
          [TK.Lt, 1],
          [TK.Gt, -1],
          [TK.Shr, -2],
        ];
        this.consume_tts(1, modifiers);

        if (!(this.token.kind.$ === "OpenParen" || this.token.kind.$ === "PathSep")) {
          // We don't have `foo< bar >(` or `foo< bar >::`, so we rewind the
          // parser and bail out.
          this.restore_snapshot(snapshot);
        }
      }
      if (this.token.eq(TK.PathSep)) {
        // We have some certainty that this was a bad turbofish at this point.
        // `foo< bar >::`
        const k = inner_op.kind;
        if (k.$ === "Binary" && k._0.node === "Lt") {
          err.suggest_turbofish = Span.shrink_to_lo(op.span);
        } else {
          err.help_turbofish = true;
        }

        const snapshot = this.create_snapshot_for_diagnostic();
        this.bump(); // `::`

        // Consume the rest of the likely `foo<bar>::new()` or return at `foo<bar>`.
        const r = this.parse_expr();
        if (r.$ === "Ok") {
          // 99% certain that the suggestion is correct, continue parsing.
          const guar = this.dcx().emit_err(ComparisonOperatorsCannotBeChained_diagnostic(err));
          // FIXME: actually check that the two expressions in the binop are
          // paths and resynthesize new fn call expression instead of using
          // `ExprKind::Err` placeholder.
          return mk_err_expr(this, Span.to(inner_op.span, this.prev_token.span), guar);
        } else {
          const expr_err = r._0;
          expr_err.cancel();
          // Not entirely sure now, but we bubble the error up with the
          // suggestion.
          this.restore_snapshot(snapshot);
          return Err(this.dcx().create_err(ComparisonOperatorsCannotBeChained_diagnostic(err)));
        }
      } else if (this.token.eq(TK.OpenParen)) {
        // We have high certainty that this was a bad turbofish at this point.
        // `foo< bar >(`
        const k = inner_op.kind;
        if (k.$ === "Binary" && k._0.node === "Lt") {
          err.suggest_turbofish = Span.shrink_to_lo(op.span);
        } else {
          err.help_turbofish = true;
        }
        // Consume the fn call arguments.
        const r = this.consume_fn_args();
        if (r.$ === "Err") {
          return Err(this.dcx().create_err(ComparisonOperatorsCannotBeChained_diagnostic(err)));
        } else {
          const guar = this.dcx().emit_err(ComparisonOperatorsCannotBeChained_diagnostic(err));
          // FIXME: actually check that the two expressions in the binop are
          // paths and resynthesize new fn call expression instead of using
          // `ExprKind::Err` placeholder.
          return mk_err_expr(this, Span.to(inner_op.span, this.prev_token.span), guar);
        }
      } else {
        if (l1.kind.$ !== "Lit" && r1.kind.$ !== "Lit") {
          // All we know is that this is `foo < bar >` and *nothing* else. Try to
          // be helpful, but don't attempt to recover.
          err.help_turbofish = true;
        }

        // If it looks like a genuine attempt to chain operators (as opposed to a
        // misformatted turbofish, for instance), suggest a correct form.
        const recovered = this.attempt_chained_comparison_suggestion(err, inner_op, outer_op);
        if (recovered) {
          const guar = this.dcx().emit_err(ComparisonOperatorsCannotBeChained_diagnostic(err));
          return mk_err_expr(this, Span.to(inner_op.span, this.prev_token.span), guar);
        } else {
          // These cases cause too many knock-down errors, bail out (#61329).
          return Err(this.dcx().create_err(ComparisonOperatorsCannotBeChained_diagnostic(err)));
        }
      }
    }
    const recovered = this.attempt_chained_comparison_suggestion(err, inner_op, outer_op);
    const guar = this.dcx().emit_err(ComparisonOperatorsCannotBeChained_diagnostic(err));
    if (recovered) {
      return mk_err_expr(this, Span.to(inner_op.span, this.prev_token.span), guar);
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1460 consume_fn_args
Parser.prototype.consume_fn_args = function (this: Parser): Result<undefined, undefined> {
  const snapshot = this.create_snapshot_for_diagnostic();
  this.bump(); // `(`

  // Consume the fn call arguments.
  const modifiers: [TokenKind, number][] = [
    [TK.OpenParen, 1],
    [TK.CloseParen, -1],
  ];
  this.consume_tts(1, modifiers);

  if (this.token.eq(TK.Eof)) {
    // Not entirely sure that what we consumed were fn arguments, rollback.
    this.restore_snapshot(snapshot);
    return Err(undefined);
  } else {
    // 99% certain that the suggestion is correct, continue parsing.
    return Ok(undefined);
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1478 maybe_report_ambiguous_plus
Parser.prototype.maybe_report_ambiguous_plus = function (this: Parser, impl_dyn_multi: boolean, ty: Ty): void {
  if (impl_dyn_multi) {
    this.dcx().emit_err(
      AmbiguousPlus_diagnostic({
        span: ty.span,
        suggestion: { lo: Span.shrink_to_lo(ty.span), hi: Span.shrink_to_hi(ty.span) },
      }),
    );
  }
};

/// Swift lets users write `Ty?` to mean `Option<Ty>`. Parse the construct and recover from it.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1488 maybe_recover_from_question_mark
Parser.prototype.maybe_recover_from_question_mark = function (this: Parser, ty: Ty): Ty {
  if (this.token.eq(TK.Question)) {
    this.bump();
    const guar = this.dcx().emit_err(
      QuestionMarkInType_diagnostic({
        span: this.prev_token.span,
        sugg: {
          left: Span.shrink_to_lo(ty.span),
          right: this.prev_token.span,
        },
      }),
    );
    return this.mk_ty(Span.to(ty.span, this.prev_token.span), { $: "Err", _0: guar });
  } else {
    return ty;
  }
};

/// Rust has no ternary operator (`cond ? then : else`). Parse it and try
/// to recover from it if `then` and `else` are valid expressions. Returns
/// an err if this appears to be a ternary expression.
/// If we have the span of the condition, we can provide a better error span
/// and code suggestion.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1509 maybe_recover_from_ternary_operator
Parser.prototype.maybe_recover_from_ternary_operator = function (this: Parser, cond: Span | undefined): PResult<undefined> {
  if (!this.prev_token.eq(TK.Question)) {
    return Ok(undefined);
  }

  const question = this.prev_token.span;
  const lo = Span.lo(cond ?? question);
  const snapshot = this.create_snapshot_for_diagnostic();

  let parsed: boolean;
  const r = this.parse_expr();
  if (r.$ === "Ok") {
    parsed = true;
  } else {
    r._0.cancel();
    // The colon can sometimes be mistaken for type
    // ascription. Catch when this happens and continue.
    parsed = this.token.eq(TK.Colon);
  }
  if (parsed) {
    if (this.eat_noexpect(TK.Colon)) {
      const colon = this.prev_token.span;
      const r2 = this.parse_expr();
      if (r2.$ === "Ok") {
        const expr = r2._0;
        const sugg: TernaryOperatorSuggestion | undefined =
          cond === undefined
            ? undefined
            : {
                before_cond: Span.shrink_to_lo(cond),
                question,
                colon,
                end: Span.shrink_to_hi(expr.span),
              };
        return Err(
          this.dcx().create_err(
            TernaryOperator_diagnostic({
              span: Span.with_lo(this.prev_token.span, lo),
              sugg,
              no_sugg: sugg === undefined,
            }),
          ),
        );
      } else {
        r2._0.cancel();
      }
    }
  }
  this.restore_snapshot(snapshot);
  return Ok(undefined);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1556 maybe_recover_from_bad_type_plus
Parser.prototype.maybe_recover_from_bad_type_plus = function (this: Parser, ty: Ty): PResult<undefined> {
  // Do not add `+` to expected tokens.
  if (!this.token.is_like_plus()) {
    return Ok(undefined);
  }

  this.bump(); // `+`
  const r = this.parse_generic_bounds();
  if (r.$ === "Err") return r;
  let sub: BadTypePlusSub;
  const k = ty.kind;
  if (k.$ === "Ref") {
    const inner_ty = k._1;
    const lo = Span.shrink_to_lo(inner_ty.span);
    const hi = Span.shrink_to_hi(this.prev_token.span);
    sub = { $: "AddParen", suggestion: { lo, hi } };
  } else if (k.$ === "Ptr" || k.$ === "FnPtr") {
    sub = { $: "ForgotParen", span: Span.to(ty.span, this.prev_token.span) };
  } else {
    sub = { $: "ExpectPath", span: ty.span };
  }

  this.dcx().emit_err(BadTypePlus_diagnostic({ span: ty.span, sub }));

  return Ok(undefined);
};

/// Tries to recover from associated item paths like `[T]::AssocItem` / `(T, U)::AssocItem`.
/// Attempts to convert the base expression/pattern/type into a type, parses the `::AssocItem`
/// tail, and combines them into a `<Ty>::AssocItem` expression/pattern/type.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1584 maybe_recover_from_bad_qpath
Parser.prototype.maybe_recover_from_bad_qpath = function <T>(this: Parser, base: T, T_RecoverQPath: RecoverQPath<T>): PResult<T> {
  // Do not add `::` to expected tokens.
  if (this.may_recover() && this.token.eq(TK.PathSep)) {
    return this.recover_from_bad_qpath(base, T_RecoverQPath);
  }
  return Ok(base);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1596 recover_from_bad_qpath
Parser.prototype.recover_from_bad_qpath = function <T>(this: Parser, base: T, T_RecoverQPath: RecoverQPath<T>): PResult<T> {
  const ty = T_RecoverQPath.to_ty(base);
  if (ty !== undefined) {
    return this.maybe_recover_from_bad_qpath_stage_2(ty.span, ty, T_RecoverQPath);
  }
  return Ok(base);
};

/// Given an already parsed `Ty`, parses the `::AssocItem` tail and
/// combines them into a `<Ty>::AssocItem` expression/pattern/type.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1605 maybe_recover_from_bad_qpath_stage_2
Parser.prototype.maybe_recover_from_bad_qpath_stage_2 = function <T>(
  this: Parser,
  ty_span: Span,
  ty: Ty,
  T_RecoverQPath: RecoverQPath<T>,
): PResult<T> {
  const r = this.expect(exp.PathSep);
  if (r.$ === "Err") return r;

  const path = new ast.Path(DUMMY_SP, []);
  const r2 = this.parse_path_segments(path.segments, T_RecoverQPath.PATH_STYLE, undefined);
  if (r2.$ === "Err") return r2;
  path.span = Span.to(ty_span, this.prev_token.span);

  this.dcx().emit_err(
    BadQPathStage2_diagnostic({
      span: ty_span,
      wrap: { lo: Span.shrink_to_lo(ty_span), hi: Span.shrink_to_hi(ty_span) },
    }),
  );

  const path_span = Span.shrink_to_hi(ty_span); // Use an empty path since `position == 0`.
  return Ok(T_RecoverQPath.recovered({ ty, path_span, position: 0 }, path));
};

/// This function gets called in places where a semicolon is NOT expected and if there's a
/// semicolon it emits the appropriate error and returns true.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1627 maybe_consume_incorrect_semicolon
Parser.prototype.maybe_consume_incorrect_semicolon = function (this: Parser, previous_item: Item | undefined): boolean {
  if (!this.token.eq(TK.Semi)) {
    return false;
  }

  // Check previous item to add it to the diagnostic, for example to say
  // `enum declarations are not followed by a semicolon`
  let err: IncorrectSemicolon;
  if (previous_item !== undefined) {
    let name: string;
    // Say "braced struct" because tuple-structs and
    // braceless-empty-struct declarations do take a semicolon.
    if (previous_item.kind.$ === "Struct") name = "braced struct";
    else name = ast.ItemKind.descr(previous_item.kind);
    err = { span: this.token.span, name, show_help: true };
  } else {
    err = { span: this.token.span, name: "", show_help: false };
  }
  this.dcx().emit_err(IncorrectSemicolon_diagnostic(err));

  this.bump();
  return true;
};

/// Creates a `Diag` for an unexpected token `t`
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1653 unexpected_err
Parser.prototype.unexpected_err = function (this: Parser, t: TokenKind): Diag {
  const token_str = pprust.token_kind_to_string(t);
  const this_token_str = token_descr(this.token);
  const k = this.token.kind;
  const origin = this.subparser_name;
  let prev_sp: Span;
  let sp: Span;
  if (k.$ === "Eof" && origin !== undefined) {
    // Point at the end of the macro call when reaching end of macro arguments.
    const s = Span.shrink_to_hi(this.prev_token.span);
    [prev_sp, sp] = [s, s];
  } else if (this.prev_token.span === DUMMY_SP) {
    // We don't want to point at the following span after DUMMY_SP.
    // This happens when the parser finds an empty TokenStream.
    [prev_sp, sp] = [this.token.span, this.token.span];
  } else if (k.$ === "Eof" && origin === undefined) {
    // EOF, don't want to point at the following char, but rather the last token.
    [prev_sp, sp] = [this.prev_token.span, this.token.span];
  } else {
    [prev_sp, sp] = [Span.shrink_to_hi(this.prev_token.span), this.token.span];
  }
  const msg_ = `expected \`${token_str}\`, found ${k.$ === "Eof" && origin !== undefined ? `end of ${origin}` : this_token_str}`;
  const err = this.dcx().struct_span_err(sp, msg_);
  const label_exp = `expected \`${token_str}\``;
  const sm = this.psess.source_map();
  if (!sm.is_multiline(Span.until(prev_sp, sp))) {
    // When the spans are in the same line, it means that the only content
    // between them is whitespace, point only at the found token.
    err.span_label(sp, label_exp);
  } else {
    err.span_label(prev_sp, label_exp);
    err.span_label(sp, "unexpected token");
  }
  return err;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1691 expect_semi
Parser.prototype.expect_semi = function (this: Parser): PResult<undefined> {
  if (this.eat(exp.Semi) || this.recover_colon_as_semi()) {
    return Ok(undefined);
  }
  const r = this.expect(exp.Semi); // Error unconditionally
  if (r.$ === "Err") return r;
  return Ok(undefined);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1698 recover_colon_as_semi
Parser.prototype.recover_colon_as_semi = function (this: Parser): boolean {
  const line_idx = (span: Span): number | undefined => {
    const r = this.psess.source_map().span_to_lines(span);
    if (r.$ === "Err") return undefined;
    const first = r._0.lines[0];
    return first === undefined ? undefined : first.line_index;
  };

  if (
    this.may_recover() &&
    this.token.eq(TK.Colon) &&
    this.look_ahead(1, (next) => option_lt(line_idx(this.token.span), line_idx(next.span)))
  ) {
    this.dcx().emit_err(ColonAsSemi_diagnostic({ span: this.token.span }));
    this.bump();
    return true;
  }

  return false;
};

/// Consumes alternative await syntaxes like `await!(<expr>)`, `await <expr>`,
/// `await? <expr>`, `await(<expr>)`, and `await { <expr> }`.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1721 recover_incorrect_await_syntax
Parser.prototype.recover_incorrect_await_syntax = function (this: Parser, await_sp: Span): PResult<Expr> {
  let r: PResult<[Span, Span, boolean]>;
  if (this.token.eq(TK.Bang)) {
    // Handle `await!(<expr>)`.
    r = this.recover_await_macro();
  } else {
    r = this.recover_await_prefix(await_sp);
  }
  if (r.$ === "Err") return r;
  const [hi, expr_span, is_question] = r._0;
  const [sp, guar] = this.error_on_incorrect_await(await_sp, hi, expr_span, is_question);
  const expr = this.mk_expr_err(Span.to(await_sp, sp), guar);
  return this.maybe_recover_from_bad_qpath(expr, RecoverQPath_Box_Expr);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1736 recover_await_macro
Parser.prototype.recover_await_macro = function (this: Parser): PResult<[Span, Span, boolean]> {
  let r: PResult<unknown> = this.expect(exp.Bang);
  if (r.$ === "Err") return r;
  r = this.expect(exp.OpenParen);
  if (r.$ === "Err") return r;
  const open = this.prev_token.span;
  const re = this.parse_expr();
  if (re.$ === "Err") return re;
  const expr = re._0;
  r = this.expect(exp.CloseParen);
  if (r.$ === "Err") return r;
  const close = this.prev_token.span;
  // Keep parentheses when needed for `.await`, e.g. `(&mut future).await`.
  // Use the delimiters to preserve any comments around the operand.
  let expr_span: Span;
  if (ExprPrecedence_discriminant[expr.precedence()] < ExprPrecedence_discriminant.Unambiguous) {
    expr_span = Span.to(open, close);
  } else {
    expr_span = Span.to(Span.shrink_to_hi(open), Span.shrink_to_lo(close));
  }
  return Ok([close, expr_span, false]);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1753 recover_await_prefix
Parser.prototype.recover_await_prefix = function (this: Parser, await_sp: Span): PResult<[Span, Span, boolean]> {
  const is_question = this.eat(exp.Question); // Handle `await? <expr>`.
  let r: PResult<Expr>;
  if (this.token.eq(TK.OpenBrace)) {
    // Handle `await { <expr> }`.
    // This needs to be handled separately from the next arm to avoid
    // interpreting `await { <expr> }?` as `<expr>?.await`.
    r = this.parse_expr_block(undefined, this.token.span, ast.BlockCheckMode.Default);
  } else {
    r = this.parse_expr();
  }
  if (r.$ === "Err") {
    const err = r._0;
    err.span_label(await_sp, `while parsing this incorrect await expression`);
    return Err(err);
  }
  const expr = r._0;
  return Ok([expr.span, expr.span, is_question]);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1770 error_on_incorrect_await
Parser.prototype.error_on_incorrect_await = function (
  this: Parser,
  lo: Span,
  hi: Span,
  expr_span: Span,
  is_question: boolean,
): [Span, ErrorGuaranteed] {
  const span = Span.to(lo, hi);
  const guar = this.dcx().emit_err(
    IncorrectAwait_diagnostic({
      span,
      suggestion: {
        removal: Span.until(lo, expr_span),
        dot_await: Span.to(Span.shrink_to_hi(expr_span), Span.shrink_to_hi(hi)),
        question_mark: is_question ? "?" : "",
      },
    }),
  );
  return [span, guar];
};

/// If encountering `future.await()`, consumes and emits an error.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1790 recover_from_await_method_call
Parser.prototype.recover_from_await_method_call = function (this: Parser): void {
  if (this.token.eq(TK.OpenParen) && this.look_ahead(1, (t) => t.eq(TK.CloseParen))) {
    // future.await()
    const lo = this.token.span;
    this.bump(); // (
    const span = Span.to(lo, this.token.span);
    this.bump(); // )

    this.dcx().emit_err(IncorrectUseOfAwait_diagnostic({ span }));
  }
};
///
/// If encountering `x.use()`, consumes and emits an error.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1803 recover_from_use
Parser.prototype.recover_from_use = function (this: Parser): void {
  if (this.token.eq(TK.OpenParen) && this.look_ahead(1, (t) => t.eq(TK.CloseParen))) {
    // var.use()
    const lo = this.token.span;
    this.bump(); // (
    const span = Span.to(lo, this.token.span);
    this.bump(); // )

    this.dcx().emit_err(IncorrectUseOfUse_diagnostic({ span }));
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1815 try_macro_suggestion
Parser.prototype.try_macro_suggestion = function (this: Parser): PResult<Expr> {
  const is_try = this.token.is_keyword(kw.Try);
  const is_questionmark = this.look_ahead(1, (t) => t.eq(TK.Bang)); //check for !
  const is_open = this.look_ahead(2, (t) => t.eq(TK.OpenParen)); //check for (

  if (is_try && is_questionmark && is_open) {
    const lo = this.token.span;
    this.bump(); //remove try
    this.bump(); //remove !
    const try_span = Span.to(lo, this.token.span); //we take the try!( span
    this.bump(); //remove (
    const is_empty = this.token.eq(TK.CloseParen); //check if the block is empty
    this.consume_block(exp.OpenParen, exp.CloseParen, "No"); //eat the block
    const hi = this.token.span;
    this.bump(); //remove )
    const err = this.dcx().struct_span_err(Span.to(lo, hi), "use of deprecated `try` macro");
    err.note("in the 2018 edition `try` is a reserved keyword, and the `try!()` macro is deprecated");
    const prefix = is_empty ? "" : "alternatively, ";
    if (!is_empty) {
      err.multipart_suggestion(
        "you can use the `?` operator instead",
        [
          [try_span, ""],
          [hi, "?"],
        ],
        Applicability.MachineApplicable,
      );
    }
    err.span_suggestion_verbose(
      Span.shrink_to_lo(lo),
      `${prefix}you can still access the deprecated \`try!()\` macro using the "raw identifier" syntax`,
      "r#",
      Applicability.MachineApplicable,
    );
    const guar = err.emit_err();
    return Ok(this.mk_expr_err(Span.to(lo, hi), guar));
  } else {
    return Err(this.expected_expression_found()); // The user isn't trying to invoke the try! macro
  }
};

/// When trying to close a generics list and encountering code like
/// ```text
/// impl<S: Into<std::borrow::Cow<'static, str>> From<S> for Canonical {}
///                                          // ^ missing > here
/// ```
/// we provide a structured suggestion on the error from `expect_gt`.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1862 expect_gt_or_maybe_suggest_closing_generics
Parser.prototype.expect_gt_or_maybe_suggest_closing_generics = function (
  this: Parser,
  params: readonly GenericParam[],
): PResult<undefined> {
  const r = this.expect_gt();
  if (r.$ === "Ok") {
    return Ok(undefined);
  }
  const err = r._0;
  // Attempt to find places where a missing `>` might belong.
  const last = params[params.length - 1];
  if (last !== undefined) {
    const bounds = last.bounds;
    // `.filter_map(|bound| match bound { Trait(poly) => Some(poly), _ => None }).next_back()`
    let poly: ast.PolyTraitRef | undefined;
    for (let i = bounds.length - 1; i >= 0; i--) {
      const bound = bounds[i]!;
      if (bound.$ === "Trait") {
        poly = bound._0;
        break;
      }
    }
    if (poly !== undefined) {
      err.span_suggestion_verbose(
        Span.shrink_to_hi(poly.span),
        "you might have meant to end the type parameters here",
        ">",
        Applicability.MaybeIncorrect,
      );
    }
  }
  return Err(err);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1889 recover_seq_parse_error
Parser.prototype.recover_seq_parse_error = function (
  this: Parser,
  open: ExpTokenPair,
  close: ExpTokenPair,
  lo: Span,
  err: Diag,
): Expr {
  const guar = err.emit_err();
  // Recover from parse error, callers expect the closing delim to be consumed.
  this.consume_block(open, close, "Yes");
  return this.mk_expr(Span.to(lo, this.prev_token.span), { $: "Err", _0: guar });
};

/// Eats tokens until we can be relatively sure we reached the end of the
/// statement. This is something of a best-effort heuristic.
///
/// We terminate when we find an unmatched `}` (without consuming it).
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1906 recover_stmt
Parser.prototype.recover_stmt = function (this: Parser): void {
  this.recover_stmt_(SemiColonMode.Ignore, BlockMode.Ignore);
};

/// If `break_on_semi` is `Break`, then we will stop consuming tokens after
/// finding (and consuming) a `;` outside of `{}` or `[]` (note that this is
/// approximate -- it can mean we break too early due to macros, but that
/// should only lead to sub-optimal recovery, not inaccurate parsing).
///
/// If `break_on_block` is `Break`, then we will stop consuming tokens
/// after finding (and consuming) a brace-delimited block.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1917 recover_stmt_
Parser.prototype.recover_stmt_ = function (this: Parser, break_on_semi: SemiColonMode, break_on_block: BlockMode): void {
  let brace_depth = 0;
  let bracket_depth = 0;
  let in_block = false;
  // debug!("recover_stmt_ enter loop (semi={:?}, block={:?})", break_on_semi, break_on_block);
  loop: for (;;) {
    // debug!("recover_stmt_ loop {:?}", self.token);
    switch (this.token.kind.$) {
      case "OpenBrace":
        brace_depth += 1;
        this.bump();
        if (break_on_block === BlockMode.Break && brace_depth === 1 && bracket_depth === 0) {
          in_block = true;
        }
        break;
      case "OpenBracket":
        bracket_depth += 1;
        this.bump();
        break;
      case "CloseBrace":
        if (brace_depth === 0) {
          // debug!("recover_stmt_ return - close delim {:?}", self.token);
          break loop;
        }
        brace_depth -= 1;
        this.bump();
        if (in_block && bracket_depth === 0 && brace_depth === 0) {
          // debug!("recover_stmt_ return - block end {:?}", self.token);
          break loop;
        }
        break;
      case "CloseBracket":
        bracket_depth -= 1;
        if (bracket_depth < 0) {
          bracket_depth = 0;
        }
        this.bump();
        break;
      case "Eof":
        // debug!("recover_stmt_ return - Eof");
        break loop;
      case "Semi":
        this.bump();
        if (break_on_semi === SemiColonMode.Break && brace_depth === 0 && bracket_depth === 0) {
          // debug!("recover_stmt_ return - Semi");
          break loop;
        }
        break;
      case "Comma":
        if (break_on_semi === SemiColonMode.Comma && brace_depth === 0 && bracket_depth === 0) {
          break loop;
        }
        // PORT: the guard failed: falls through to the `_` arm.
        this.bump();
        break;
      default:
        this.bump();
        break;
    }
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1986 check_for_for_in_in_typo
Parser.prototype.check_for_for_in_in_typo = function (this: Parser, in_span: Span): void {
  if (this.eat_keyword(exp.In)) {
    // a common typo: `for _ in in bar {}`
    this.dcx().emit_err(
      InInTypo_diagnostic({
        span: this.prev_token.span,
        sugg_span: Span.until(in_span, this.prev_token.span),
      }),
    );
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:1996 parameter_without_type
Parser.prototype.parameter_without_type = function (
  this: Parser,
  err: Diag,
  pat: Pat,
  require_name: boolean,
  first_param: boolean,
  fn_parse_mode: FnParseMode,
): Ident | undefined {
  // If we find a pattern followed by an identifier, it could be an (incorrect)
  // C-style parameter declaration.
  if (this.check_ident() && this.look_ahead(1, (t) => t.eq(TK.Comma) || t.eq(TK.CloseParen))) {
    // `fn foo(String s) {}`
    const ident = unwrap_result(this.parse_ident_common(true));
    const span = Span.with_hi(pat.span, Span.hi(ident.span));

    err.span_suggestion_verbose(
      span,
      "declare the type after the parameter binding",
      "<identifier>: <type>",
      Applicability.HasPlaceholders,
    );
    return ident;
  } else if (require_name && (this.token.eq(TK.Comma) || this.token.eq(TK.Lt) || this.token.eq(TK.CloseParen))) {
    const maybe_emit_anon_params_note = (this_: Parser, err: Diag): void => {
      const ed = Span.edition(Span.with_neighbor(this_.token.span, this_.prev_token.span));
      if ((fn_parse_mode.context as FnContext) === "Trait" && fn_parse_mode.req_name(ed, "No")) {
        err.note("anonymous parameters are removed in the 2018 edition (see RFC 1685)");
      }
    };

    let ident: Ident;
    let self_sugg: string;
    let param_sugg: string;
    let type_sugg: string;
    let self_span: Span;
    let param_span: Span;
    let type_span: Span;
    const pk = pat.kind;
    // PORT: the second arm's let-chain guard (`PatKind::Ref(..) if let ... && ...`).
    const multi_ref_self = (): boolean => {
      if (pk.$ !== "Ref") return false;
      const inner_pat = pk._0;
      if (inner_pat.kind.$ !== "Ref") return false;
      const peeled = pat.peel_refs().kind;
      if (peeled.$ !== "Path") return false;
      const path = peeled._1;
      const a = path.segments[0];
      if (a === undefined) return false;
      return a.ident.name === kw.SelfLower;
    };
    if (pk.$ === "Ident") {
      [ident, self_sugg, param_sugg, type_sugg, self_span, param_span, type_span] = [
        pk._1,
        "self: ",
        ": TypeName",
        "_: ",
        Span.shrink_to_lo(pat.span),
        Span.shrink_to_hi(pat.span),
        Span.shrink_to_lo(pat.span),
      ];
    } else if (pk.$ === "Ref" && multi_ref_self()) {
      // Fix suggestions for multi-reference `self` parameters (e.g. `&&&self`)
      // cc: https://github.com/rust-lang/rust/pull/146305
      const inner_pat = pk._0;
      let inner = inner_pat;
      const span_vec: Span[] = [pat.span];

      while (inner.kind.$ === "Ref") {
        const inner_type = inner.kind._0;
        inner = inner_type;
        span_vec.push(Span.shrink_to_lo(inner.span));
      }

      let span: Span;
      switch (span_vec.length) {
        // Should be unreachable: match guard ensures at least 2 references
        case 0:
        case 1:
          return unreachable();
        case 2:
          span = Span.until(span_vec[0]!, Span.shrink_to_lo(inner_pat.span));
          break;
        default:
          span = Span.until(span_vec[0]!, Span.shrink_to_lo(span_vec[span_vec.length - 2]!));
          break;
      }

      err.span_suggestion_verbose(
        span,
        "`self` should be `self`, `&self` or `&mut self`, consider removing extra references",
        "",
        Applicability.MachineApplicable,
      );

      return undefined;
    } else if (pk.$ === "Ref" && pk._0.kind.$ === "Ident") {
      // Also catches `fn foo(&a)`.
      const pinned = pk._1;
      const mutab = ast.Pinnedness.prefix_str(pinned, pk._2);
      const inner_ident = pk._0.kind._1;
      [ident, self_sugg, param_sugg, type_sugg, self_span, param_span, type_span] = [
        inner_ident,
        "self: ",
        `${display_Ident(inner_ident)}: &${mutab}TypeName`,
        "_: ",
        Span.shrink_to_lo(pat.span),
        pat.span,
        Span.shrink_to_lo(pat.span),
      ];
    } else {
      // Otherwise, try to get a type and emit a suggestion.
      if (pat.to_ty() !== undefined) {
        err.span_suggestion_verbose(
          Span.shrink_to_lo(pat.span),
          "explicitly ignore the parameter name",
          "_: ",
          Applicability.MachineApplicable,
        );
        maybe_emit_anon_params_note(this, err);
      }

      return undefined;
    }

    // `fn foo(a, b) {}`, `fn foo(a<x>, b<y>) {}` or `fn foo(usize, usize) {}`
    if (
      first_param &&
      // Only when the fn is a method, we emit this suggestion.
      (fn_parse_mode.context === "Trait" || fn_parse_mode.context === "Impl")
    ) {
      err.span_suggestion_verbose(
        self_span,
        "if this is a `self` type, give it a parameter name",
        self_sugg,
        Applicability.MaybeIncorrect,
      );
    }
    // Avoid suggesting that `fn foo(HashMap<u32>)` is fixed with a change to
    // `fn foo(HashMap: TypeName<u32>)`.
    if (!this.token.eq(TK.Lt)) {
      err.span_suggestion_verbose(
        param_span,
        "if this is a parameter name, give it a type",
        param_sugg,
        Applicability.HasPlaceholders,
      );
    }
    err.span_suggestion_verbose(
      type_span,
      "if this is a type, explicitly ignore the parameter name",
      type_sugg,
      Applicability.MachineApplicable,
    );
    maybe_emit_anon_params_note(this, err);

    // Don't attempt to recover by using the `X` in `X<Y>` as the parameter name.
    return this.token.eq(TK.Lt) ? undefined : ident;
  }
  return undefined;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2148 recover_arg_parse
Parser.prototype.recover_arg_parse = function (this: Parser, context: FnContext): PResult<[Pat, Ty]> {
  const rp = this.parse_pat_no_top_alt("ArgumentName" satisfies Expected, undefined);
  if (rp.$ === "Err") return rp;
  const pat = rp._0;
  const rc = this.expect(exp.Colon);
  if (rc.$ === "Err") return rc;
  const rt = this.parse_ty();
  if (rt.$ === "Err") return rt;
  const ty = rt._0;
  switch (context) {
    case "Trait":
    case "FunctionPtrType":
    case "ParenthesizedArgumentList":
      this.dcx().emit_err(
        PatternMethodParamWithoutBody_diagnostic({
          span: pat.span,
          target:
            context === "Trait"
              ? "methods without bodies"
              : context === "FunctionPtrType"
                ? "function pointer types"
                : "parenthesized argument list",
        }),
      );
      break;
    case "Free":
    case "Impl":
      this.dcx().span_delayed_bug(
        pat.span,
        context === "Free"
          ? "This method is not called in free functions, as patterns are always allowed there"
          : "This method is not called in impls, as patterns are always allowed there",
      );
      break;
  }

  // Pretend the pattern is `_`, to avoid duplicate errors from AST validation.
  const pat_ = new ast.Pat(ast.DUMMY_NODE_ID, ast.PatKind.Wild, pat.span);
  return Ok([pat_, ty]);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2187 recover_bad_self_param
Parser.prototype.recover_bad_self_param = function (this: Parser, param: Param): PResult<Param> {
  const span = param.pat.span;
  const guar = this.dcx().emit_err(SelfParamNotFirst_diagnostic({ span }));
  param.ty.kind = { $: "Err", _0: guar };
  return Ok(param);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2194 consume_block
Parser.prototype.consume_block = function (
  this: Parser,
  open: ExpTokenPair,
  close: ExpTokenPair,
  consume_close: ConsumeClosingDelim,
): void {
  let brace_depth = 0;
  for (;;) {
    if (this.eat(open)) {
      brace_depth += 1;
    } else if (this.check(close)) {
      if (brace_depth === 0) {
        if (consume_close === "Yes") {
          // Some of the callers of this method expect to be able to parse the
          // closing delimiter themselves, so we leave it alone. Otherwise we advance
          // the parser.
          this.bump();
        }
        return;
      } else {
        this.bump();
        brace_depth -= 1;
        continue;
      }
    } else if (this.token.eq(TK.Eof)) {
      return;
    } else {
      this.bump();
    }
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2226 expected_expression_found
Parser.prototype.expected_expression_found = function (this: Parser): Diag {
  let span: Span;
  let msg_: string;
  const origin = this.subparser_name;
  if (this.token.kind.$ === "Eof" && origin !== undefined) {
    const sp = Span.shrink_to_hi(this.prev_token.span);
    [span, msg_] = [sp, `expected expression, found end of ${origin}`];
  } else {
    [span, msg_] = [this.token.span, `expected expression, found ${token_descr(this.token)}`];
  }
  const err = this.dcx().struct_span_err(span, msg_);
  const sp = this.psess.source_map().start_point(this.token.span);
  const found = this.psess.complete_stmt_exprs_before_bin_op_lookalike.get(sp);
  if (found !== undefined) {
    err.subdiagnostic(ExprParenthesesNeeded_subdiagnostic(ExprParenthesesNeeded.surrounding(found)));
  }
  err.span_label(span, "expected expression");
  return err;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2246 consume_tts
Parser.prototype.consume_tts = function (
  this: Parser,
  acc: number, // `i64` because malformed code can have more closing delims than opening.
  // Not using `FxHashMap` due to `token::TokenKind: !Eq + !Hash`.
  modifier: readonly [TokenKind, number][],
): void {
  while (acc > 0) {
    const found = modifier.find(([t]) => this.token.eq(t));
    if (found !== undefined) {
      const val = found[1];
      acc += val;
    }
    if (this.token.eq(TK.Eof)) {
      break;
    }
    this.bump();
  }
};

/// Replace duplicated recovered parameters with `_` pattern to avoid unnecessary errors.
///
/// This is necessary because at this point we don't know whether we parsed a function with
/// anonymous parameters or a function with names but no types. In order to minimize
/// unnecessary errors, we assume the parameters are in the shape of `fn foo(a, b, c)` where
/// the parameters are *names* (so we don't emit errors about not being able to find `b` in
/// the local scope), but if we find the same name multiple times, like in `fn foo(i8, i8)`,
/// we deduplicate them to not complain about duplicated parameter names.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2271 deduplicate_recovered_params_names
Parser.prototype.deduplicate_recovered_params_names = function (this: Parser, fn_inputs: Param[]): void {
  // PORT: `FxHashSet<Ident>`: `Ident`'s `Eq` is name + syntax context (`Ident::eq`), so the set is a
  // list searched with `Ident::eq` (only membership is observable).
  const seen_inputs: Ident[] = [];
  for (const input of fn_inputs) {
    let opt_ident: Ident | undefined;
    const pk = input.pat.kind;
    if (pk.$ === "Ident" && input.ty.kind.$ === "Err") {
      opt_ident = pk._1;
    } else {
      opt_ident = undefined;
    }
    if (opt_ident !== undefined) {
      const ident = opt_ident;
      if (seen_inputs.some((i) => i.eq(ident))) {
        input.pat.kind = ast.PatKind.Wild;
      }
      if (!seen_inputs.some((i) => i.eq(ident))) seen_inputs.push(ident);
    }
  }
};

/// Handle encountering a lifetime in a generic argument list that is not
/// followed by a `,` or `>`.
/// We emit an error and check if the lifetime is followed by a type
/// in, e.g. `Foo<'a T>`.
/// In this case, it is likely the user meant either `Foo<&'a T>` or `Foo<'a, T>`.
/// We give both suggestions, then emit an error. Note that we do not try to recover,
/// since we cannot know which of the two suggestions is correct and emitting either
/// of the two types could cause confusing errors further on.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2298 handle_lifetime_arg_preceding_type
Parser.prototype.handle_lifetime_arg_preceding_type = function (this: Parser, span: Span): PResult<undefined> {
  const snapshot = this.create_snapshot_for_diagnostic();
  const [mutbl, ty] = this.parse_ref_ty_no_leading_ampersand();
  this.restore_snapshot(snapshot);
  if (ty === undefined) {
    // The lifetime is not followed by a type, do nothing.
    return Ok(undefined);
  }
  // If we find `'a mut T`, suggesting to add a comma is wrong.
  const suggest_comma = ast.Mutability.is_not(mutbl);
  // Add `>` to the list of expected tokens.
  this.check(exp.Gt);
  const err = unwrap_err(this.unexpected(), () => "()");
  err.span_suggestion_verbose(
    Span.shrink_to_lo(span),
    "you might have meant to write a reference type here",
    "&",
    Applicability.MaybeIncorrect,
  );
  if (suggest_comma) {
    err.span_suggestion_verbose(
      Span.shrink_to_hi(span),
      "use a comma to separate type parameters",
      ",",
      Applicability.MaybeIncorrect,
    );
  }
  return Err(err);
};

/// Handle encountering a symbol in a generic argument list that is not a `,` or `>`. In this
/// case, we emit an error and try to suggest enclosing a const argument in braces if it looks
/// like the user has forgotten them.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2331 handle_ambiguous_unbraced_const_arg
Parser.prototype.handle_ambiguous_unbraced_const_arg = function (this: Parser, args: AngleBracketedArg[]): PResult<boolean> {
  // If we haven't encountered a closing `>`, then the argument is malformed.
  // It's likely that the user has written a const expression without enclosing it
  // in braces, so we try to recover here.
  const arg = unwrap(args.pop());
  // FIXME: for some reason using `unexpected` or `expected_one_of_not_found` has
  // adverse side-effects to subsequent errors and seems to advance the parser.
  // We are causing this error here exclusively in case that a `const` expression
  // could be recovered from the current parser state, even if followed by more
  // arguments after a comma.
  const err = this.dcx().struct_span_err(
    this.token.span,
    `expected one of \`,\` or \`>\`, found ${token_descr(this.token)}`,
  );
  err.span_label(this.token.span, "expected one of `,` or `>`");
  const r = this.recover_const_arg(ast.AngleBracketedArg.span(arg), err);
  if (r.$ === "Ok") {
    const arg_ = r._0;
    args.push({ $: "Arg", _0: arg_ });
    if (this.eat(exp.Comma)) {
      return Ok(true); // Continue
    }
  } else {
    const err_ = r._0;
    args.push(arg);
    // We will emit a more generic error later.
    err_.delay_as_bug();
  }
  return Ok(false); // Don't continue.
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2365 recover_const_param_decl
Parser.prototype.recover_const_param_decl = function (this: Parser, ty_generics: Generics | undefined): GenericArg | undefined {
  const snapshot = this.create_snapshot_for_diagnostic();
  const r = this.parse_const_param([]);
  if (r.$ === "Err") {
    r._0.cancel();
    this.restore_snapshot(snapshot);
    return undefined;
  }
  const param = r._0;

  const ident = display_Ident(param.ident);
  const snippet_r = sm_span_to_snippet(this, param.span());
  let sugg: UnexpectedConstParamDeclarationSugg | undefined;
  if (ty_generics !== undefined && snippet_r.$ === "Ok") {
    const params = ty_generics.params;
    const impl_generics = ty_generics.span;
    const snippet = snippet_r._0;
    if (params.length === 0) {
      sugg = {
        $: "AddParam",
        impl_generics,
        incorrect_decl: param.span(),
        snippet,
        ident,
      };
    } else {
      const generic = params[params.length - 1]!;
      sugg = {
        $: "AppendParam",
        impl_generics_end: Span.shrink_to_hi(generic.span()),
        incorrect_decl: param.span(),
        snippet,
        ident,
      };
    }
  } else {
    sugg = undefined;
  }
  const guar = this.dcx().emit_err(UnexpectedConstParamDeclaration_diagnostic({ span: param.span(), sugg }));

  const value = this.mk_expr_err(param.span(), guar);
  return { $: "Const", _0: { id: ast.DUMMY_NODE_ID, value } };
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2403 recover_const_param_declaration
Parser.prototype.recover_const_param_declaration = function (
  this: Parser,
  ty_generics: Generics | undefined,
): PResult<GenericArg | undefined> {
  // We have to check for a few different cases.
  const arg = this.recover_const_param_decl(ty_generics);
  if (arg !== undefined) {
    return Ok(arg);
  }

  // We haven't consumed `const` yet.
  const start = this.token.span;
  this.bump(); // `const`

  // Detect and recover from the old, pre-RFC2000 syntax for const generics.
  const err: UnexpectedConstInGenericParam = { span: start, to_remove: undefined };
  if (this.check_const_arg()) {
    err.to_remove = Span.until(start, this.token.span);
    this.dcx().emit_err(UnexpectedConstInGenericParam_diagnostic(err));
    const r = this.parse_const_arg();
    if (r.$ === "Err") return r;
    return Ok({ $: "Const", _0: r._0 });
  } else {
    const after_kw_const = this.token.span;
    const r = this.recover_const_arg(after_kw_const, this.dcx().create_err(UnexpectedConstInGenericParam_diagnostic(err)));
    if (r.$ === "Err") return r;
    return Ok(r._0);
  }
};

/// Try to recover from possible generic const argument without `{` and `}`.
///
/// When encountering code like `foo::< bar + 3 >` or `foo::< bar - baz >` we suggest
/// `foo::<{ bar + 3 }>` and `foo::<{ bar - baz }>`, respectively. We only provide a suggestion
/// if we think that the resulting expression would be well formed.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2433 recover_const_arg
Parser.prototype.recover_const_arg = function (this: Parser, start: Span, err: Diag): PResult<GenericArg> {
  const op = AssocOp.from_token(this.token);
  let kept: AssocOp | undefined;
  if (op === undefined) {
    kept = undefined;
  } else if (
    (op.$ === "Binary" && (op._0 === "Gt" || op._0 === "Lt" || op._0 === "Shr" || op._0 === "Ge")) ||
    // Don't recover from `foo::<bar = baz>`, because this could be an attempt to
    // assign a value to a defaulted generic parameter.
    op.$ === "Assign" ||
    op.$ === "AssignOp"
  ) {
    kept = undefined;
  } else {
    kept = op;
  }
  const is_op_or_dot = kept !== undefined || this.token.eq(TK.Dot);
  // This will be true when a trait object type `Foo +` or a path which was a `const fn` with
  // type params has been parsed.
  const pk = this.prev_token.kind.$;
  const was_op = pk === "Plus" || pk === "Shr" || pk === "Gt";
  if (!is_op_or_dot && !was_op) {
    // We perform these checks and early return to avoid taking a snapshot unnecessarily.
    return Err(err);
  }
  const snapshot = this.create_snapshot_for_diagnostic();
  if (is_op_or_dot) {
    this.bump();
  }
  const r = this.parse_expr_res(Restrictions.CONST_EXPR);
  if (r.$ === "Ok") {
    const expr = r._0;
    // Find a mistake like `MyTrait<Assoc == S::Assoc>`.
    if (snapshot.parser.token.eq(TK.EqEq)) {
      err.span_suggestion_verbose(
        snapshot.parser.token.span,
        "if you meant to use an associated type binding, replace `==` with `=`",
        "=",
        Applicability.MaybeIncorrect,
      );
      const guar = err.emit_err();
      const value = this.mk_expr_err(Span.to(start, expr.span), guar);
      return Ok({ $: "Const", _0: { id: ast.DUMMY_NODE_ID, value } });
    } else if (
      snapshot.parser.token.eq(TK.Colon) &&
      Span.lo(expr.span) === Span.hi(snapshot.parser.token.span) &&
      expr.kind.$ === "Path"
    ) {
      // Find a mistake like "foo::var:A".
      err.span_suggestion_verbose(
        snapshot.parser.token.span,
        "write a path separator here",
        "::",
        Applicability.MaybeIncorrect,
      );
      const guar = err.emit_err();
      return Ok({ $: "Type", _0: this.mk_ty(Span.to(start, expr.span), { $: "Err", _0: guar }) });
    } else if (this.token.eq(TK.Comma) || token.TokenKind.should_end_const_arg(this.token.kind)) {
      // Avoid the following output by checking that we consumed a full const arg:
      // help: expressions must be enclosed in braces to be used as const generic
      //       arguments
      //    |
      // LL |     let sr: Vec<{ (u32, _, _) = vec![] };
      //    |                 ^                      ^
      return Ok(this.dummy_const_arg_needs_braces(err, Span.to(start, expr.span)));
    }
  } else {
    r._0.cancel();
  }
  this.restore_snapshot(snapshot);
  return Err(err);
};

/// Try to recover from an unbraced const argument whose first token [could begin a type][ty].
///
/// [ty]: token::Token::can_begin_type
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2518 recover_unbraced_const_arg_that_can_begin_ty
Parser.prototype.recover_unbraced_const_arg_that_can_begin_ty = function (
  this: Parser,
  snapshot: SnapshotParser,
): Expr | undefined {
  const r = snapshot.parser.parse_expr_res(Restrictions.CONST_EXPR);
  if (r.$ === "Ok") {
    const expr = r._0;
    // Since we don't know the exact reason why we failed to parse the type or the
    // expression, employ a simple heuristic to weed out some pathological cases.
    const k = snapshot.parser.token.kind.$;
    if (k === "Comma" || k === "Gt") {
      this.restore_snapshot(snapshot);
      return expr;
    }
    return undefined;
  } else {
    r._0.cancel();
    return undefined;
  }
};

/// Creates a dummy const argument, and reports that the expression must be enclosed in braces
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2538 dummy_const_arg_needs_braces
Parser.prototype.dummy_const_arg_needs_braces = function (this: Parser, err: Diag, span: Span): GenericArg {
  err.multipart_suggestion(
    "expressions must be enclosed in braces to be used as const generic arguments",
    [
      [Span.shrink_to_lo(span), "{ "],
      [Span.shrink_to_hi(span), " }"],
    ],
    Applicability.MaybeIncorrect,
  );
  const guar = err.emit_err();
  const value = this.mk_expr_err(span, guar);
  return { $: "Const", _0: { id: ast.DUMMY_NODE_ID, value } };
};

/// Some special error handling for the "top-level" patterns in a match arm,
/// `for` loop, `let`, &c. (in contrast to subpatterns within such).
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2553 recover_colon_colon_in_pat_typo
Parser.prototype.recover_colon_colon_in_pat_typo = function (
  this: Parser,
  first_pat: Pat,
  expected: Expected | undefined,
): Pat {
  if (!TokenKind_eq(TK.Colon, this.token.kind)) {
    return first_pat;
  }

  // The pattern looks like it might be a path with a `::` -> `:` typo:
  // `match foo { bar:baz => {} }`
  const colon_span = this.token.span;
  // We only emit "unexpected `:`" error here if we can successfully parse the
  // whole pattern correctly in that case.
  const snapshot_pat = this.create_snapshot_for_diagnostic();
  const snapshot_type = this.create_snapshot_for_diagnostic();

  // Create error for "unexpected `:`".
  const r = this.expected_one_of_not_found([], []);
  if (r.$ === "Err") {
    const err = r._0;
    // Skip the `:`.
    snapshot_pat.parser.bump();
    snapshot_type.parser.bump();
    const rp = snapshot_pat.parser.parse_pat_no_top_alt(expected, undefined);
    if (rp.$ === "Err") {
      const inner_err = rp._0;
      inner_err.cancel();
    } else {
      const pat = rp._0;
      // We've parsed the rest of the pattern.
      const new_span = Span.to(first_pat.span, pat.span);
      let show_sugg = false;
      // Try to construct a recovered pattern.
      const pk = pat.kind;
      if ((pk.$ === "Struct" || pk.$ === "TupleStruct" || pk.$ === "Path") && pk._0 === undefined) {
        const path = pk._1;
        const fk = first_pat.kind;
        if (fk.$ === "Ident") {
          path.segments.splice(0, 0, ast.PathSegment.from_ident(fk._1));
          path.span = new_span;
          show_sugg = true;
          first_pat = pat;
        } else if (fk.$ === "Path") {
          const old_qself = fk._0;
          const old_path = fk._1;
          // `old_path.segments.iter().cloned().chain(take(&mut path.segments)).collect()`
          const taken = path.segments;
          path.segments = [];
          path.segments = [...old_path.segments.map(ast.clone_PathSegment), ...taken];
          path.span = new_span;
          pk._0 = old_qself === undefined ? undefined : ast.clone_QSelf(old_qself);
          first_pat = pat;
          show_sugg = true;
        }
      } else if (pk.$ === "Ident" && ast.BindingMode_eq(pk._0, ast.BindingMode.NONE) && pk._2 === undefined) {
        const ident = pk._1;
        const fk = first_pat.kind;
        if (fk.$ === "Ident") {
          const old_ident = fk._1;
          const path: PatKind = {
            $: "Path",
            _0: undefined,
            _1: new ast.Path(new_span, [ast.PathSegment.from_ident(old_ident), ast.PathSegment.from_ident(ident)]),
          };
          first_pat = this.mk_pat(new_span, path);
          show_sugg = true;
        } else if (fk.$ === "Path") {
          const old_qself = fk._0;
          const old_path = fk._1;
          const segments = old_path.segments.map(ast.clone_PathSegment);
          segments.push(ast.PathSegment.from_ident(ident));
          const path: PatKind = {
            $: "Path",
            _0: old_qself === undefined ? undefined : ast.clone_QSelf(old_qself),
            _1: new ast.Path(new_span, segments),
          };
          first_pat = this.mk_pat(new_span, path);
          show_sugg = true;
        }
      }
      if (show_sugg) {
        err.span_suggestion_verbose(
          Span.until(
            colon_span,
            this.look_ahead(1, (t) => t.span),
          ),
          "maybe write a path separator here",
          "::",
          Applicability.MaybeIncorrect,
        );
      } else {
        first_pat = this.mk_pat(new_span, {
          $: "Err",
          _0: this.dcx().span_delayed_bug(colon_span, "recovered bad path pattern"),
        });
      }
      this.restore_snapshot(snapshot_pat);
    }
    const rt = snapshot_type.parser.parse_ty();
    if (rt.$ === "Err") {
      const inner_err = rt._0;
      inner_err.cancel();
    } else {
      const ty = rt._0;
      err.span_label(ty.span, "specifying the type of a pattern isn't supported");
      this.restore_snapshot(snapshot_type);
      const new_span = Span.to(first_pat.span, ty.span);
      first_pat = this.mk_pat(new_span, {
        $: "Err",
        _0: this.dcx().span_delayed_bug(colon_span, "recovered bad pattern with type"),
      });
    }
    err.emit();
  } else {
    // Carry on as if we had not done anything. This should be unreachable.
  }
  return first_pat;
};

/// If `loop_header` is `Some` and an unexpected block label is encountered,
/// it is suggested to be moved just before `loop_header`, else it is suggested to be removed.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2688 maybe_recover_unexpected_block_label
Parser.prototype.maybe_recover_unexpected_block_label = function (this: Parser, loop_header: Span | undefined): boolean {
  // Check for `'a : {`
  if (
    !(
      this.check_lifetime() &&
      this.look_ahead(1, (t) => t.eq(TK.Colon)) &&
      this.look_ahead(2, (t) => t.eq(TK.OpenBrace))
    )
  ) {
    return false;
  }
  const label = unwrap(this.eat_label(), "just checked if a label exists");
  this.bump(); // eat `:`
  const span = Span.to(label.ident.span, this.prev_token.span);
  const diag = this.dcx()
    .struct_span_err(span, "block label not supported here")
    .with_span_label(span, "not supported here");
  if (loop_header !== undefined) {
    diag.multipart_suggestion(
      "if you meant to label the loop, move this label before the loop",
      [
        [Span.until(label.ident.span, this.token.span), ""],
        [Span.shrink_to_lo(loop_header), `${display_Ident(label.ident)}: `],
      ],
      Applicability.MachineApplicable,
    );
  } else {
    diag.tool_only_span_suggestion(
      Span.until(label.ident.span, this.token.span),
      "remove this block label",
      "",
      Applicability.MachineApplicable,
    );
  }
  diag.emit();
  return true;
};

/// Some special error handling for the "top-level" patterns in a match arm,
/// `for` loop, `let`, &c. (in contrast to subpatterns within such).
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2729 maybe_recover_unexpected_comma
Parser.prototype.maybe_recover_unexpected_comma = function (this: Parser, lo: Span, rt: CommaRecoveryMode): PResult<undefined> {
  if (!this.token.eq(TK.Comma)) {
    return Ok(undefined);
  }
  return this.recover_unexpected_comma(lo, rt);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2741 recover_unexpected_comma
Parser.prototype.recover_unexpected_comma = function (this: Parser, lo: Span, rt: CommaRecoveryMode): PResult<undefined> {
  // An unexpected comma after a top-level pattern is a clue that the
  // user (perhaps more accustomed to some other language) forgot the
  // parentheses in what should have been a tuple pattern; return a
  // suggestion-enhanced error here rather than choking on the comma later.
  const comma_span = this.token.span;
  this.bump();
  const r = this.skip_pat_list();
  if (r.$ === "Err") {
    // We didn't expect this to work anyway; we just wanted to advance to the
    // end of the comma-sequence so we know the span to suggest parenthesizing.
    r._0.cancel();
  }
  const seq_span = Span.to(lo, this.prev_token.span);
  const err = this.dcx().struct_span_err(comma_span, "unexpected `,` in pattern");
  err.multipart_suggestion(
    `try adding parentheses to match on a tuple${rt === "LikelyTuple" ? "" : "..."}`,
    [
      [Span.shrink_to_lo(seq_span), "("],
      [Span.shrink_to_hi(seq_span), ")"],
    ],
    Applicability.MachineApplicable,
  );
  if (rt === "EitherTupleOrPipe") {
    err.span_suggestion_verbose(
      comma_span,
      "...or a vertical bar to match on alternatives",
      " |",
      Applicability.MachineApplicable,
    );
  }
  return Err(err);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2777 maybe_recover_bounds_doubled_colon
Parser.prototype.maybe_recover_bounds_doubled_colon = function (this: Parser, ty: Ty): PResult<undefined> {
  const k = ty.kind;
  if (k.$ !== "Path") {
    return Ok(undefined);
  }
  const qself = k._0;
  const path = k._1;
  const qself_position = qself === undefined ? undefined : qself.position;
  // `path.segments.windows(2).enumerate()`
  for (let i = 0; i + 1 < path.segments.length; i++) {
    if (qself_position !== undefined && i < qself_position) {
      continue;
    }
    const a = path.segments[i]!;
    const b = path.segments[i + 1]!;
    const [a_span, b_span] = [a.span(), b.span()];
    const between_span = Span.to(Span.shrink_to_hi(a_span), Span.shrink_to_lo(b_span));
    const snippet = this.span_to_snippet(between_span);
    if (snippet.$ === "Ok" && snippet._0 === ":: ") {
      return Err(
        this.dcx().create_err(
          DoubleColonInBound_diagnostic({
            span: Span.shrink_to_hi(path.span),
            between: between_span,
          }),
        ),
      );
    }
  }
  return Ok(undefined);
};

/// Check for exclusive ranges written as `..<`
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2799 maybe_err_dotdotlt_syntax
Parser.prototype.maybe_err_dotdotlt_syntax = function (this: Parser, maybe_lt: Token, err: Diag): Diag {
  if (
    maybe_lt.eq(TK.Lt) &&
    (this.expected_token_types.contains(TokenType.Gt) || this.token.kind.$ === "Literal")
  ) {
    err.span_suggestion_verbose(
      maybe_lt.span,
      "remove the `<` to write an exclusive range",
      "",
      Applicability.MachineApplicable,
    );
  }
  return err;
};

/// This checks if this is a conflict marker, depending of the parameter passed.
///
/// * `<<<<<<<`
/// * `|||||||`
/// * `=======`
/// * `>>>>>>>`
///
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2821 is_vcs_conflict_marker
Parser.prototype.is_vcs_conflict_marker = function (this: Parser, long_kind: TokenKind, short_kind: TokenKind): boolean {
  if (TokenKind_eq(long_kind, short_kind)) {
    // For conflict marker chars like `%` and `\`.
    for (let i = 0; i < 7; i++) {
      if (!this.look_ahead(i, (tok) => tok.eq(long_kind))) return false;
    }
    return true;
  } else {
    // For conflict marker chars like `<` and `|`.
    for (let i = 0; i < 3; i++) {
      if (!this.look_ahead(i, (tok) => tok.eq(long_kind))) return false;
    }
    return this.look_ahead(3, (tok) => tok.eq(short_kind) || tok.eq(long_kind));
  }
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2836 conflict_marker
Parser.prototype.conflict_marker = function (
  this: Parser,
  long_kind: TokenKind,
  short_kind: TokenKind,
  expected: number | undefined,
): [Span, number] | undefined {
  if (this.is_vcs_conflict_marker(long_kind, short_kind)) {
    const lo = this.token.span;
    if (this.psess.source_map().span_to_margin(lo) !== 0) {
      return undefined;
    }
    let len = 0;
    while (TokenKind_eq(this.token.kind, long_kind) || TokenKind_eq(this.token.kind, short_kind)) {
      if (token.TokenKind.break_two_token_op(this.token.kind, 1) !== undefined) {
        len += 2;
      } else {
        len += 1;
      }
      this.bump();
      if (expected === len) {
        break;
      }
    }
    if (expected !== undefined && expected !== len) {
      return undefined;
    }
    return [Span.to(lo, this.prev_token.span), len];
  }
  return undefined;
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2867 recover_vcs_conflict_marker
Parser.prototype.recover_vcs_conflict_marker = function (this: Parser): void {
  // <<<<<<<
  const first = this.conflict_marker(TK.Shl, TK.Lt, undefined);
  if (first === undefined) {
    return;
  }
  const [start, len] = first;
  const spans: Span[] = [];
  spans.push(start);
  // |||||||
  let middlediff3: Span | undefined = undefined;
  // =======
  let middle: Span | undefined = undefined;
  // >>>>>>>
  let end: Span | undefined = undefined;
  for (;;) {
    if (this.token.eq(TK.Eof)) {
      break;
    }
    let m = this.conflict_marker(TK.OrOr, TK.Or, len);
    if (m !== undefined) {
      middlediff3 = m[0];
    }
    m = this.conflict_marker(TK.EqEq, TK.Eq, len);
    if (m !== undefined) {
      middle = m[0];
    }
    m = this.conflict_marker(TK.Shr, TK.Gt, len);
    if (m !== undefined) {
      const span = m[0];
      spans.push(span);
      end = span;
      break;
    }
    this.bump();
  }

  const err = this.dcx().struct_span_fatal(spans, "encountered diff marker");
  let middle_marker: string;
  if (middlediff3 !== undefined) {
    // We're using diff3
    err.span_label(
      middlediff3,
      "between this marker and `=======` is the base code (what the two refs diverged from)",
    );
    middle_marker = "|||||||";
  } else {
    middle_marker = "=======";
  }
  err.span_label(start, `between this marker and \`${middle_marker}\` is the code that you are merging into`);

  if (middle !== undefined) {
    err.span_label(middle, "between this marker and `>>>>>>>` is the incoming code");
  }
  if (end !== undefined) {
    err.span_label(end, "this marker concludes the conflict region");
  }
  err.note(
    "conflict markers indicate that a merge was started but could not be completed due " +
      "to merge conflicts\n" +
      "to resolve a conflict, keep only the code you want and then delete the lines " +
      "containing conflict markers",
  );
  err.help(
    "if you are in a merge, the top section is the code you already had checked out and " +
      "the bottom section is the new code\n" +
      "if you are in a rebase, the top section is the code being rebased onto and the bottom " +
      "section is the code you had checked out which is being rebased",
  );

  err.note(
    "for an explanation on these markers from the `git` documentation, visit " +
      "<https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging#_checking_out_conflicts>",
  );

  err.emit();
};

/// Parse and throw away a parenthesized comma separated
/// sequence of patterns until `)` is reached.
// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2953 skip_pat_list
Parser.prototype.skip_pat_list = function (this: Parser): PResult<undefined> {
  while (!this.check(exp.CloseParen)) {
    const r = this.parse_pat_no_top_alt(undefined, undefined);
    if (r.$ === "Err") return r;
    if (!this.eat(exp.Comma)) {
      return Ok(undefined);
    }
  }
  return Ok(undefined);
};

// rustc: compiler/rustc_parse/src/parser/diagnostics.rs:2962 maybe_type_in_generic_parameter
Parser.prototype.maybe_type_in_generic_parameter = function (this: Parser, origin_error: Diag): Diag {
  if (!this.may_recover()) {
    return origin_error;
  }
  return this.with_recovery(Recovery.Forbidden, (snapshot) => {
    snapshot.bump();
    const lo = Span.shrink_to_lo(snapshot.token.span);

    const r = snapshot.parse_ty();
    if (r.$ === "Err") {
      r._0.cancel();
      return origin_error;
    }
    const ty = r._0;
    if (ty.kind.$ !== "Path") {
      return origin_error;
    }
    const path = ty.kind._1;
    // PORT: `path.segments[0]` (indexing panics on an empty path, as upstream).
    if (path.segments.length === 0) {
      return panic(`index out of bounds: the len is 0 but the index is 0`);
    }
    const ga = path.segments[0]!.args;
    if (ga === undefined || ga.$ !== "AngleBracketed") {
      return origin_error;
    }
    const args = ga._0.args;

    const path_span = path.span;
    const new_error = snapshot.dcx().create_err(
      FoundPathInGenerics_diagnostic({
        span: path_span,
        path: unwrap_result(snapshot.span_to_snippet(path_span), debug_SpanSnippetError),
      }),
    );
    new_error.subdiagnostic(SuggestBindTypeParameter_subdiagnostic({ span: lo }));
    origin_error.cancel();

    const params = args
      .map((arg) => unwrap_result(snapshot.span_to_snippet(ast.AngleBracketedArg.span(arg)), debug_SpanSnippetError))
      .join(", ");
    new_error.subdiagnostic(
      SuggestIntroduceTypeParameter_subdiagnostic({
        span: path_span,
        parameters: params,
      }),
    );
    return new_error;
  });
};
