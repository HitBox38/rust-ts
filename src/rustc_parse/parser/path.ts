// Port of compiler/rustc_parse/src/parser/path.rs
// Types (`PathStyle`) are generated into path.gen.ts.
// Init order: see parser/mod.ts (top-level code touches only `Parser`, path.gen.ts and non-parser
// modules; other extension modules are used inside function bodies only).
import { ast, token } from "../../rustc_ast/lib.ts";
import type {
  AngleBracketedArg,
  AnonConst,
  AssocItemConstraint,
  AssocItemConstraintKind,
  Expr,
  GenericArg,
  GenericArgs,
  Generics,
  Param,
  Path,
  PathSegment,
  QSelf,
  Term,
} from "../../rustc_ast/lib.ts";
import type { Token } from "../../rustc_ast/token.ts";
import { type Diag, type PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { BytePos, Span } from "../../rustc_span/lib.ts";
import { display_Ident, type Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import {
  ConstGenericWithoutBraces_diagnostic,
  PathFoundAttributeInParams_diagnostic,
  PathFoundCVariadicParams_diagnostic,
  PathSingleColon_diagnostic,
  PathTripleColon_diagnostic,
} from "../diagnostics.ts";
import type { SnapshotParser } from "./diagnostics.ts";
import { FnContext, type FnParseMode } from "./function.ts";
import { clone_Parser, Parser, Restrictions, token_descr } from "./mod.ts";
import { CommaRecoveryMode, RecoverColon, RecoverComma } from "./pat.ts";
import * as gen from "./path.gen.ts";
import { exp, TokenType } from "./token_type.ts";
import { AllowPlus, RecoverQPath, RecoverReturnSign } from "./ty.ts";

export * from "./path.gen.ts";

const { TokenKind: TK } = token;

/// Specifies how to parse a path.
export type PathStyle = gen.PathStyle;
export const PathStyle = {
  ...gen.PathStyle,

  // rustc: compiler/rustc_parse/src/parser/path.rs:60 has_generic_ambiguity
  has_generic_ambiguity(self: PathStyle): boolean {
    return self === "Expr" || self === "Pat";
  },
};

/// Parses a qualified path.
/// Assumes that the leading `<` has been parsed already.
///
/// `qualified_path = <type [as trait_ref]>::path`
///
/// # Examples
/// `<T>::default`
/// `<T as U>::a`
/// `<T as U>::F::a<S>` (without disambiguator)
/// `<T as U>::F::a::<S>` (with disambiguator)
// rustc: compiler/rustc_parse/src/parser/path.rs:76 parse_qpath
Parser.prototype.parse_qpath = function (this: Parser, style: PathStyle): PResult<[QSelf, Path]> {
  const lo = this.prev_token.span;
  const r_ty = this.parse_ty();
  if (r_ty.$ === "Err") return r_ty;
  const ty = r_ty._0;

  // `path` will contain the prefix of the path up to the `>`,
  // if any (e.g., `U` in the `<T as U>::*` examples
  // above). `path_span` has the span of that path, or an empty
  // span in the case of something like `<T>::Bar`.
  let path: Path;
  let path_span: Span;
  if (this.eat_keyword(exp.As)) {
    const path_lo = this.token.span;
    const r = this.parse_path(PathStyle.Type);
    if (r.$ === "Err") return r;
    path = r._0;
    path_span = Span.to(path_lo, this.prev_token.span);
  } else {
    path_span = Span.to(this.token.span, this.token.span);
    path = new ast.Path(path_span, []);
  }

  // See doc comment for `unmatched_angle_bracket_count`.
  const r_gt = this.expect(exp.Gt);
  if (r_gt.$ === "Err") return r_gt;
  if (this.unmatched_angle_bracket_count > 0) {
    this.unmatched_angle_bracket_count -= 1;
    // debug!("parse_qpath: (decrement) count={:?}", self.unmatched_angle_bracket_count);
  }

  const is_import_coupler = this.is_import_coupler();
  if (!is_import_coupler && !this.recover_colon_before_qpath_proj()) {
    const r = this.expect(exp.PathSep);
    if (r.$ === "Err") return r;
  }

  const qself: QSelf = { ty, path_span, position: path.segments.length };
  if (!is_import_coupler) {
    const r = this.parse_path_segments(path.segments, style, undefined);
    if (r.$ === "Err") return r;
  }

  return Ok([qself, new ast.Path(Span.to(lo, this.prev_token.span), path.segments)]);
};

/// Recover from an invalid single colon, when the user likely meant a qualified path.
/// We avoid emitting this if not followed by an identifier, as our assumption that the user
/// intended this to be a qualified path may not be correct.
///
/// ```ignore (diagnostics)
/// <Bar as Baz<T>>:Qux
///                ^ help: use double colon
/// ```
// rustc: compiler/rustc_parse/src/parser/path.rs:122 recover_colon_before_qpath_proj
Parser.prototype.recover_colon_before_qpath_proj = function (this: Parser): boolean {
  if (!this.check_noexpect(TK.Colon) || this.look_ahead(1, (t) => !t.is_non_reserved_ident())) {
    return false;
  }

  this.bump(); // colon

  this.dcx()
    .struct_span_err(this.prev_token.span, "found single colon before projection in qualified path")
    .with_span_suggestion(this.prev_token.span, "use double colon", "::", Applicability.MachineApplicable)
    .emit();

  return true;
};

// rustc: compiler/rustc_parse/src/parser/path.rs:147 parse_path
Parser.prototype.parse_path = function (this: Parser, style: PathStyle): PResult<Path> {
  return this.parse_path_inner(style, undefined);
};

/// Parses simple paths.
///
/// `path = [::] segment+`
/// `segment = ident | ident[::]<args> | ident[::](args) [-> type]`
///
/// # Examples
/// `a::b::C<D>` (without disambiguator)
/// `a::b::C::<D>` (with disambiguator)
/// `Fn(Args)` (without disambiguator)
/// `Fn::(Args)` (with disambiguator)
// rustc: compiler/rustc_parse/src/parser/path.rs:161 parse_path_inner
Parser.prototype.parse_path_inner = function (
  this: Parser,
  style: PathStyle,
  ty_generics: Generics | undefined,
): PResult<Path> {
  const reject_generics_if_mod_style = (parser: Parser, path: Path): Path => {
    // Ensure generic arguments don't end up in attribute paths, such as:
    //
    //     macro_rules! m {
    //         ($p:path) => { #[$p] struct S; }
    //     }
    //
    //     m!(inline<u8>); //~ ERROR: unexpected generic arguments in path
    //
    if (style === PathStyle.Mod && path.segments.some((segment) => segment.args !== undefined)) {
      const span = path.segments
        .filter((segment) => segment.args !== undefined)
        .map((segment) => segment.args!)
        .map((arg) => ast.GenericArgs.span(arg));
      parser.dcx().emit_err(diagnostics.GenericsInPath_diagnostic({ span }));
      // Ignore these arguments to prevent unexpected behaviors.
      const segments = path.segments.map((segment) => new ast.PathSegment(segment.ident, segment.id, undefined));
      return new ast.Path(path.span, segments);
    } else {
      return path;
    }
  };

  const path1 = this.eat_metavar_seq(token.MetaVarKind.Path, (this_) => this_.parse_path(PathStyle.Type));
  if (path1 !== undefined) {
    return Ok(reject_generics_if_mod_style(this, path1));
  }

  // If we have a `ty` metavar in the form of a path, reparse it directly as a path, instead
  // of reparsing it as a `ty` and then extracting the path.
  const path2 = this.eat_metavar_seq({ $: "Ty", is_path: true }, (this_) => this_.parse_path(PathStyle.Type));
  if (path2 !== undefined) {
    return Ok(reject_generics_if_mod_style(this, path2));
  }

  const lo = this.token.span;
  const segments: PathSegment[] = [];
  const mod_sep_ctxt = Span.ctxt(this.token.span);
  if (this.eat_path_sep()) {
    segments.push(ast.PathSegment.path_root(Span.with_ctxt(Span.shrink_to_lo(lo), mod_sep_ctxt)));
  }
  const r = this.parse_path_segments(segments, style, ty_generics);
  if (r.$ === "Err") return r;
  return Ok(new ast.Path(Span.to(lo, this.prev_token.span), segments));
};

// rustc: compiler/rustc_parse/src/parser/path.rs:220 parse_path_segments
Parser.prototype.parse_path_segments = function (
  this: Parser,
  segments: PathSegment[],
  style: PathStyle,
  ty_generics: Generics | undefined,
): PResult<undefined> {
  for (;;) {
    const r = this.parse_path_segment(style, ty_generics);
    if (r.$ === "Err") return r;
    const segment = r._0;
    if (PathStyle.has_generic_ambiguity(style)) {
      // In order to check for trailing angle brackets, we must have finished
      // recursing (`parse_path_segment` can indirectly call this function),
      // that is, the next token must be the highlighted part of the below example:
      //
      // `Foo::<Bar as Baz<T>>::Qux`
      //                      ^ here
      //
      // As opposed to the below highlight (if we had only finished the first
      // recursion):
      //
      // `Foo::<Bar as Baz<T>>::Qux`
      //                     ^ here
      //
      // `PathStyle::Expr` is only provided at the root invocation and never in
      // `parse_path_segment` to recurse and therefore can be checked to maintain
      // this invariant.
      this.check_trailing_angle_brackets(segment, [exp.PathSep]);
    }
    segments.push(segment);

    if (this.is_import_coupler() || !this.eat_path_sep()) {
      // IMPORTANT: We can *only ever* treat single colons as typo'ed double colons in
      // expression contexts (!) since only there paths cannot possibly be followed by
      // a colon and still form a syntactically valid construct. In pattern contexts,
      // a path may be followed by a type annotation. E.g., `let pat:ty`. In type
      // contexts, a path may be followed by a list of bounds. E.g., `where ty:bound`.
      if (
        this.may_recover() &&
        style === PathStyle.Expr && // (!)
        this.token.eq(TK.Colon) &&
        this.look_ahead(1, (token) => token.is_non_reserved_ident())
      ) {
        // Emit a special error message for `a::b:c` to help users
        // otherwise, `a: c` might have meant to introduce a new binding
        if (
          Span.lo(this.token.span) === Span.hi(this.prev_token.span) &&
          this.look_ahead(1, (token) => Span.hi(this.token.span) === Span.lo(token.span))
        ) {
          this.bump(); // bump past the colon
          this.dcx().emit_err(
            PathSingleColon_diagnostic({
              span: this.prev_token.span,
              suggestion: Span.shrink_to_hi(this.prev_token.span),
            }),
          );
        }
        continue;
      }

      return Ok(undefined);
    }
  }
};

/// Eat `::` or, potentially, `:::`.
// rustc: compiler/rustc_parse/src/parser/path.rs:281 eat_path_sep
Parser.prototype.eat_path_sep = function (this: Parser): boolean {
  const result = this.eat(exp.PathSep);
  if (result && this.may_recover()) {
    if (this.eat_noexpect(TK.Colon)) {
      this.dcx().emit_err(PathTripleColon_diagnostic({ span: this.prev_token.span }));
    }
  }
  return result;
};

// rustc: compiler/rustc_parse/src/parser/path.rs:291 parse_path_segment
Parser.prototype.parse_path_segment = function (
  this: Parser,
  style: PathStyle,
  ty_generics: Generics | undefined,
): PResult<PathSegment> {
  const r_ident = this.parse_path_segment_ident();
  if (r_ident.$ === "Err") return r_ident;
  const ident = r_ident._0;
  const is_args_start = (token: Token): boolean => {
    const k = token.kind.$;
    return k === "Lt" || k === "Shl" || k === "OpenParen" || k === "LArrow";
  };
  const check_args_start = (this_: Parser): boolean => {
    this_.expected_token_types.insert(TokenType.Lt);
    this_.expected_token_types.insert(TokenType.OpenParen);
    return is_args_start(this_.token);
  };

  if (
    (style === PathStyle.Type && check_args_start(this)) ||
    (style !== PathStyle.Mod && this.check_path_sep_and_look_ahead(is_args_start))
  ) {
    // We use `style == PathStyle::Expr` to check if this is in a recursion or not. If
    // it isn't, then we reset the unmatched angle bracket count as we're about to start
    // parsing a new path.
    if (style === PathStyle.Expr) {
      this.unmatched_angle_bracket_count = 0;
    }

    // Generic arguments are found - `<`, `(`, `::<` or `::(`.
    // First, eat `::` if it exists.
    void this.eat_path_sep();

    const lo = this.token.span;
    let args: GenericArgs;
    if (this.eat_lt()) {
      // `<'a, T, A = U>`
      const r_args = this.parse_angle_args_with_leading_angle_bracket_recovery(style, lo, ty_generics);
      if (r_args.$ === "Err") return r_args;
      const args_ = r_args._0;
      const r_gt = this.expect_gt();
      if (r_gt.$ === "Err") {
        let err = r_gt._0;
        // Try to recover a `:` into a `::`
        if (this.token.eq(TK.Colon) && this.look_ahead(1, (token) => token.is_non_reserved_ident())) {
          err.cancel();
          err = this.dcx().create_err(
            PathSingleColon_diagnostic({
              span: this.token.span,
              suggestion: Span.shrink_to_hi(this.prev_token.span),
            }),
          );
        }
        // Attempt to find places where a missing `>` might belong.
        else {
          const arg = args_
            .slice()
            .reverse()
            .find((arg) => !(arg.$ === "Constraint"));
          if (arg !== undefined) {
            err.span_suggestion_verbose(
              Span.shrink_to_hi(ast.AngleBracketedArg.span(arg)),
              "you might have meant to end the type parameters here",
              ">",
              Applicability.MaybeIncorrect,
            );
          }
        }
        return Err(err);
      }
      const span = Span.to(lo, this.prev_token.span);
      args = ast.GenericArgs.from_AngleBracketedArgs({ span, args: args_ });
    } else if (
      this.token.eq(TK.OpenParen) &&
      // FIXME(return_type_notation): Could also recover `...` here.
      this.look_ahead(1, (t) => t.eq(TK.DotDot))
    ) {
      this.bump(); // (
      this.bump(); // ..
      const r = this.expect(exp.CloseParen);
      if (r.$ === "Err") return r;
      const span = Span.to(lo, this.prev_token.span);

      this.psess.gated_spans.gate(sym.return_type_notation, span);

      const prev_lo = Span.shrink_to_hi(this.prev_token.span);
      if (this.eat_noexpect(TK.RArrow)) {
        const lo = this.prev_token.span;
        const r_ty = this.parse_ty();
        if (r_ty.$ === "Err") return r_ty;
        const ty = r_ty._0;
        const span = Span.to(lo, ty.span);
        const suggestion = Span.to(prev_lo, ty.span);
        this.dcx().emit_err(diagnostics.BadReturnTypeNotationOutput_diagnostic({ span, suggestion }));
      }

      args = { $: "ParenthesizedElided", _0: span };
    } else {
      // `(T, U) -> R`

      const prev_token_before_parsing = this.prev_token;
      const token_before_parsing = this.token;
      let snapshot: SnapshotParser | undefined = undefined;
      if (
        this.may_recover() &&
        prev_token_before_parsing.eq(TK.PathSep) &&
        ((style === PathStyle.Expr && this.token.can_begin_expr()) ||
          (style === PathStyle.Pat && this.token.can_begin_pattern({ $: "PatParam", inferred: false })))
      ) {
        snapshot = this.create_snapshot_for_diagnostic();
      }

      const dcx = this.dcx();
      let first_param = true;
      const parse_params_result = this.parse_paren_comma_seq((p): PResult<Param> => {
        // Inside parenthesized type arguments, we want types only, not names.
        const mode: FnParseMode = {
          context: FnContext.ParenthesizedArgumentList,
          req_name: (_, __) => false,
          req_body: false,
        };
        const r = p.parse_param_general(mode, first_param);
        if (r.$ === "Err") return r;
        const param = r._0;
        first_param = false;
        if (!(param.pat.kind.$ === "Missing")) {
          this.psess.gated_spans.gate(sym.named_fn_trait_parameters, param.pat.span);
        }
        if (param.ty.kind.$ === "CVarArgs") {
          dcx.emit_err(PathFoundCVariadicParams_diagnostic({ span: param.pat.span }));
        }
        if (!(param.attrs.length === 0)) {
          dcx.emit_err(PathFoundAttributeInParams_diagnostic({ span: param.attrs[0]!.span }));
        }
        return Ok(param);
      });

      let inputs: Param[];
      if (parse_params_result.$ === "Ok") {
        inputs = parse_params_result._0[0];
      } else if (prev_token_before_parsing.eq(TK.PathSep)) {
        const error = parse_params_result._0;
        error.span_label(
          Span.to(prev_token_before_parsing.span, token_before_parsing.span),
          "while parsing this parenthesized list of type arguments starting here",
        );

        if (snapshot !== undefined) {
          snapshot.parser.recover_fn_call_leading_path_sep(style, prev_token_before_parsing, error);
        }

        return Err(error);
      } else {
        return parse_params_result;
      }
      const inputs_span = Span.to(lo, this.prev_token.span);
      const r_output = this.parse_ret_ty(AllowPlus.No, RecoverQPath.No, RecoverReturnSign.No);
      if (r_output.$ === "Err") return r_output;
      const output = r_output._0;
      const span = Span.to(ident.span, this.prev_token.span);
      args = ast.GenericArgs.from_ParenthesizedArgs(new ast.ParenthesizedArgs(span, inputs, inputs_span, output));
    }

    return Ok(new ast.PathSegment(ident, ast.DUMMY_NODE_ID, args));
  } else {
    // Generic arguments are not found.
    return Ok(ast.PathSegment.from_ident(ident));
  }
};

// rustc: compiler/rustc_parse/src/parser/path.rs:458 parse_path_segment_ident
Parser.prototype.parse_path_segment_ident = function (this: Parser): PResult<Ident> {
  const ident = this.token.non_raw_ident();
  if (ident !== undefined && ident.is_path_segment_keyword()) {
    this.bump();
    return Ok(ident);
  } else {
    return this.parse_ident();
  }
};

/// Recover `$path::(...)` as `$path(...)`.
///
/// ```ignore (diagnostics)
/// foo::(420, "bar")
///    ^^ remove extra separator to make the function call
/// // or
/// match x {
///    Foo::(420, "bar") => { ... },
///       ^^ remove extra separator to turn this into tuple struct pattern
///    _ => { ... },
/// }
/// ```
// rustc: compiler/rustc_parse/src/parser/path.rs:481 recover_fn_call_leading_path_sep
Parser.prototype.recover_fn_call_leading_path_sep = function (
  this: Parser,
  style: PathStyle,
  prev_token_before_parsing: Token,
  error: Diag,
): void {
  // PORT: `match style { Expr if let Ok(_) = .. => {} Pat if let Ok(_) = .. => {} _ => return }`:
  // a failing guard falls through to the `_` arm (the other arm's pattern cannot match).
  if (style === PathStyle.Expr) {
    const r = this.parse_paren_comma_seq((p) => p.parse_expr());
    if (r.$ === "Err") {
      r._0.cancel();
      return;
    }
  } else if (style === PathStyle.Pat) {
    const r = this.parse_paren_comma_seq((p) =>
      p.parse_pat_allow_top_guard(undefined, RecoverComma.No, RecoverColon.No, CommaRecoveryMode.LikelyTuple),
    );
    if (r.$ === "Err") {
      r._0.cancel();
      return;
    }
  } else {
    return;
  }

  if (this.token.kind.$ === "PathSep" || this.token.kind.$ === "RArrow") {
    return;
  }

  let what: string;
  switch (style) {
    case "Expr":
      what = "call the expression";
      break;
    case "Pat":
      what = "turn this into a tuple struct pattern";
      break;
    default: {
      return;
    }
  }
  error.span_suggestion_verbose(
    prev_token_before_parsing.span,
    `consider removing the \`::\` here to ${what}`,
    "",
    Applicability.MaybeIncorrect,
  );
};

/// Parses generic args (within a path segment) with recovery for extra leading angle brackets.
/// For the purposes of understanding the parsing logic of generic arguments, this function
/// can be thought of being the same as just calling `self.parse_angle_args()` if the source
/// had the correct amount of leading angle brackets.
///
/// ```ignore (diagnostics)
/// bar::<<<<T as Foo>::Output>();
///      ^^ help: remove extra angle brackets
/// ```
// rustc: compiler/rustc_parse/src/parser/path.rs:538 parse_angle_args_with_leading_angle_bracket_recovery
Parser.prototype.parse_angle_args_with_leading_angle_bracket_recovery = function (
  this: Parser,
  style: PathStyle,
  lo: Span,
  ty_generics: Generics | undefined,
): PResult<AngleBracketedArg[]> {
  // We need to detect whether there are extra leading left angle brackets and produce an
  // appropriate error and suggestion. This cannot be implemented by looking ahead at
  // upcoming tokens for a matching `>` character - if there are unmatched `<` tokens
  // then there won't be matching `>` tokens to find.
  //
  // To explain how this detection works, consider the following example:
  //
  // ```ignore (diagnostics)
  // bar::<<<<T as Foo>::Output>();
  //      ^^ help: remove extra angle brackets
  // ```
  //
  // Parsing of the left angle brackets starts in this function. We start by parsing the
  // `<` token (incrementing the counter of unmatched angle brackets on `Parser` via
  // `eat_lt`):
  //
  // *Upcoming tokens:* `<<<<T as Foo>::Output>;`
  // *Unmatched count:* 1
  // *`parse_path_segment` calls deep:* 0
  //
  // This has the effect of recursing as this function is called if a `<` character
  // is found within the expected generic arguments:
  //
  // *Upcoming tokens:* `<<<T as Foo>::Output>;`
  // *Unmatched count:* 2
  // *`parse_path_segment` calls deep:* 1
  //
  // Eventually we will have recursed until having consumed all of the `<` tokens and
  // this will be reflected in the count:
  //
  // *Upcoming tokens:* `T as Foo>::Output>;`
  // *Unmatched count:* 4
  // `parse_path_segment` calls deep:* 3
  //
  // The parser will continue until reaching the first `>` - this will decrement the
  // unmatched angle bracket count and return to the parent invocation of this function
  // having succeeded in parsing:
  //
  // *Upcoming tokens:* `::Output>;`
  // *Unmatched count:* 3
  // *`parse_path_segment` calls deep:* 2
  //
  // This will continue until the next `>` character which will also return successfully
  // to the parent invocation of this function and decrement the count:
  //
  // *Upcoming tokens:* `;`
  // *Unmatched count:* 2
  // *`parse_path_segment` calls deep:* 1
  //
  // At this point, this function will expect to find another matching `>` character but
  // won't be able to and will return an error. This will continue all the way up the
  // call stack until the first invocation:
  //
  // *Upcoming tokens:* `;`
  // *Unmatched count:* 2
  // *`parse_path_segment` calls deep:* 0
  //
  // In doing this, we have managed to work out how many unmatched leading left angle
  // brackets there are, but we cannot recover as the unmatched angle brackets have
  // already been consumed. To remedy this, we keep a snapshot of the parser state
  // before we do the above. We can then inspect whether we ended up with a parsing error
  // and unmatched left angle brackets and if so, restore the parser state before we
  // consumed any `<` characters to emit an error and consume the erroneous tokens to
  // recover by attempting to parse again.
  //
  // In practice, the recursion of this function is indirect and there will be other
  // locations that consume some `<` characters - as long as we update the count when
  // this happens, it isn't an issue.

  const is_first_invocation = style === PathStyle.Expr;
  // Take a snapshot before attempting to parse - we can restore this later.
  const snapshot = is_first_invocation ? clone_Parser(this) : undefined;

  this.angle_bracket_nesting += 1;
  // debug!("parse_generic_args_with_leading_angle_bracket_recovery: (snapshotting)");
  const r = this.parse_angle_args(ty_generics);
  if (r.$ === "Ok") {
    this.angle_bracket_nesting -= 1;
    return r;
  }
  const e = r._0;
  if (this.angle_bracket_nesting > 10) {
    this.angle_bracket_nesting -= 1;
    // When encountering severely malformed code where there are several levels of
    // nested unclosed angle args (`f::<f::<f::<f::<...`), we avoid severe O(n^2)
    // behavior by bailing out earlier (#117080).
    return e.emit_err().raise_fatal();
  } else if (is_first_invocation && this.unmatched_angle_bracket_count > 0) {
    this.angle_bracket_nesting -= 1;

    // Swap `self` with our backup of the parser state before attempting to parse
    // generic arguments.
    // PORT: `mem::replace(self, snapshot.unwrap())`: the current state moves into a fresh
    // `Parser` object and `self` takes the snapshot's fields (`Object.assign`, as `restore_snapshot`).
    const saved = unwrap(snapshot);
    const snapshot_ = Object.assign(Object.create(Parser.prototype) as Parser, this);
    Object.assign(this, saved);

    // Eat the unmatched angle brackets.
    let all_angle_brackets = true;
    for (let i = 0; i < snapshot_.unmatched_angle_bracket_count; i++) {
      all_angle_brackets = all_angle_brackets && this.eat_lt();
    }

    if (!all_angle_brackets) {
      // If there are other tokens in between the extraneous `<`s, we cannot simply
      // suggest to remove them. This check also prevents us from accidentally ending
      // up in the middle of a multibyte character (issue #84104).
      Object.assign(this, snapshot_);
      return Err(e);
    } else {
      // Cancel error from being unable to find `>`. We know the error
      // must have been this due to a non-zero unmatched angle bracket
      // count.
      e.cancel();

      // debug!(
      //     "parse_generic_args_with_leading_angle_bracket_recovery: (snapshot failure) \
      //      snapshot.count={:?}",
      //     snapshot.unmatched_angle_bracket_count,
      // );

      // Make a span over ${unmatched angle bracket count} characters.
      // This is safe because `all_angle_brackets` ensures that there are only `<`s,
      // i.e. no multibyte characters, in this range.
      const span = Span.with_hi(lo, BytePos(Span.lo(lo) + snapshot_.unmatched_angle_bracket_count));
      this.dcx().emit_err(
        diagnostics.UnmatchedAngle_diagnostic({
          span,
          plural: snapshot_.unmatched_angle_bracket_count > 1,
        }),
      );

      // Try again without unmatched angle bracket characters.
      return this.parse_angle_args(ty_generics);
    }
  } else {
    this.angle_bracket_nesting -= 1;
    return Err(e);
  }
};

/// Parses (possibly empty) list of generic arguments / associated item constraints,
/// possibly including trailing comma.
// rustc: compiler/rustc_parse/src/parser/path.rs:683 parse_angle_args
Parser.prototype.parse_angle_args = function (
  this: Parser,
  ty_generics: Generics | undefined,
): PResult<AngleBracketedArg[]> {
  const args: AngleBracketedArg[] = [];
  for (;;) {
    const r = this.parse_angle_arg(ty_generics);
    if (r.$ === "Err") return r;
    const arg = r._0;
    if (arg === undefined) break;
    args.push(arg);
    if (!this.eat(exp.Comma)) {
      if (this.check_noexpect(TK.Semi) && this.look_ahead(1, (t) => t.is_ident() || t.is_lifetime())) {
        // Add `>` to the list of expected tokens.
        this.check(exp.Gt);
        // Handle `,` to `;` substitution
        const u = this.unexpected();
        if (u.$ === "Ok") return panic("called `Result::unwrap_err()` on an `Ok` value: ()");
        const err = u._0;
        this.bump();
        err.span_suggestion_verbose(
          Span.until(this.prev_token.span, this.token.span),
          "use a comma to separate type parameters",
          ", ",
          Applicability.MachineApplicable,
        );
        err.emit();
        continue;
      }
      if (!token.TokenKind.should_end_const_arg(this.token.kind)) {
        const last = args[args.length - 1];
        if (last !== undefined && last.$ === "Arg" && last._0.$ === "Lifetime") {
          const arg = last;
          const r = this.handle_lifetime_arg_preceding_type(ast.AngleBracketedArg.span(arg));
          if (r.$ === "Err") return r;
        }
        const r = this.handle_ambiguous_unbraced_const_arg(args);
        if (r.$ === "Err") return r;
        if (r._0) {
          // We've managed to (partially) recover, so continue trying to parse
          // arguments.
          continue;
        }
      }
      break;
    }
  }
  return Ok(args);
};

/// Parses a single argument in the angle arguments `<...>` of a path segment.
// rustc: compiler/rustc_parse/src/parser/path.rs:726 parse_angle_arg
Parser.prototype.parse_angle_arg = function (
  this: Parser,
  ty_generics: Generics | undefined,
): PResult<AngleBracketedArg | undefined> {
  const lo = this.token.span;
  const r = this.parse_generic_arg(ty_generics);
  if (r.$ === "Err") return r;
  const arg = r._0;
  if (arg !== undefined) {
    // we are using noexpect here because we first want to find out if either `=` or `:`
    // is present and then use that info to push the other token onto the tokens list
    const separated = this.check_noexpect(TK.Colon) || this.check_noexpect(TK.Eq);
    // PORT: `|` (non-short-circuiting): both `check`s run.
    if (separated && (Number(this.check(exp.Colon)) | Number(this.check(exp.Eq))) !== 0) {
      const arg_span = ast.GenericArg.span(arg);
      const r_ident = this.get_ident_from_generic_arg(arg);
      if (r_ident.$ === "Err") return Ok({ $: "Arg", _0: arg });
      const [binder, ident, gen_args] = r_ident._0;
      if (binder) {
        // FIXME(compiler-errors): this could be improved by suggesting lifting
        // this up to the trait, at least before this becomes real syntax.
        // e.g. `Trait<for<'a> Assoc = Ty>` -> `for<'a> Trait<Assoc = Ty>`
        return Err(this.dcx().struct_span_err(arg_span, "`for<...>` is not allowed on associated type bounds"));
      }
      let kind: AssocItemConstraintKind;
      if (this.eat(exp.Colon)) {
        const r = this.parse_generic_bounds();
        if (r.$ === "Err") return r;
        kind = { $: "Bound", bounds: r._0 };
      } else if (this.check(exp.Eq)) {
        const r = this.parse_assoc_equality_term(ident, gen_args);
        if (r.$ === "Err") return r;
        kind = r._0;
      } else {
        return unreachable();
      }

      const span = Span.to(lo, this.prev_token.span);
      const constraint: AssocItemConstraint = { id: ast.DUMMY_NODE_ID, ident, gen_args, kind, span };
      return Ok({ $: "Constraint", _0: constraint });
    } else {
      // we only want to suggest `:` and `=` in contexts where the previous token
      // is an ident and the current token or the next token is an ident
      if (this.prev_token.is_ident() && (this.token.is_ident() || this.look_ahead(1, (token) => token.is_ident()))) {
        this.check(exp.Colon);
        this.check(exp.Eq);
      }
      return Ok({ $: "Arg", _0: arg });
    }
  } else {
    return Ok(undefined);
  }
};

/// Parse the term to the right of an associated item equality constraint.
///
/// That is, parse `$term` in `Item = $term` where `$term` is a type or
/// a const expression (wrapped in curly braces if complex).
// rustc: compiler/rustc_parse/src/parser/path.rs:785 parse_assoc_equality_term
Parser.prototype.parse_assoc_equality_term = function (
  this: Parser,
  ident: Ident,
  gen_args: GenericArgs | undefined,
): PResult<AssocItemConstraintKind> {
  const prev_token_span = this.prev_token.span;
  const eq_span = this.token.span;
  const r_eq = this.expect(exp.Eq);
  if (r_eq.$ === "Err") return r_eq;
  const r = this.parse_generic_arg(undefined);
  if (r.$ === "Err") return r;
  const arg = r._0;
  const span = Span.to(ident.span, this.prev_token.span);
  let term: Term;
  if (arg !== undefined && arg.$ === "Type") {
    term = ast.Term.from_Ty(arg._0);
  } else if (arg !== undefined && arg.$ === "Const") {
    this.psess.gated_spans.gate(sym.associated_const_equality, span);
    term = ast.Term.from_AnonConst(arg._0);
  } else if (arg !== undefined && arg.$ === "Lifetime") {
    const lt = arg._0;
    const guar = this.dcx().emit_err(
      diagnostics.LifetimeInEqConstraint_diagnostic({
        span: lt.ident.span,
        lifetime: lt.ident,
        binding_label: span,
        colon_sugg: Span.between(gen_args === undefined ? ident.span : ast.GenericArgs.span(gen_args), lt.ident.span),
      }),
    );
    term = ast.Term.from_Ty(this.mk_ty(lt.ident.span, { $: "Err", _0: guar }));
  } else {
    const after_eq = Span.shrink_to_hi(eq_span);
    const before_next = Span.shrink_to_lo(this.token.span);
    const err = this.dcx().struct_span_err(Span.to(after_eq, before_next), "missing type to the right of `=`");
    if (this.token.kind.$ === "Comma" || this.token.kind.$ === "Gt") {
      err.span_suggestion_verbose(
        Span.to(this.psess.source_map().next_point(eq_span), before_next),
        "to constrain the associated type, add a type after `=`",
        " TheType",
        Applicability.HasPlaceholders,
      );
      err.span_suggestion_verbose(
        Span.to(Span.shrink_to_hi(prev_token_span), before_next),
        `remove the \`=\` if \`${display_Ident(ident)}\` is a type`,
        "",
        Applicability.MaybeIncorrect,
      );
    } else {
      err.span_label(this.token.span, `expected type, found ${token_descr(this.token)}`);
    }
    return Err(err);
  }
  return Ok({ $: "Equality", term });
};

/// We do not permit arbitrary expressions as const arguments. They must be one of:
/// - An expression surrounded in `{}`.
/// - A literal.
/// - A numeric literal prefixed by `-`.
/// - A single-segment path.
/// - A const block (under mGCA)
// rustc: compiler/rustc_parse/src/parser/path.rs:849 expr_is_valid_const_arg
Parser.prototype.expr_is_valid_const_arg = function (this: Parser, expr: Expr): boolean {
  const kind = expr.kind;
  switch (kind.$) {
    case "Block":
    case "Lit":
    case "IncludedBytes":
      return true;
    case "Unary":
      if (kind._0 === ast.UnOp.Neg) {
        return kind._1.kind.$ === "Lit";
      }
      return false;
    // We can only resolve single-segment paths at the moment, because multi-segment paths
    // require type-checking: see `visit_generic_arg` in `src/librustc_resolve/late.rs`.
    case "Path":
      if (kind._0 === undefined && kind._1.segments.length === 1 && kind._1.segments[0]!.args === undefined) {
        return true;
      }
      return false;
    case "ConstBlock":
      this.psess.gated_spans.gate(sym.gca_min_const_items, expr.span);
      return true;
    default:
      return false;
  }
};

/// Parse a const argument, e.g. `<3>`. It is assumed the angle brackets will be parsed by
/// the caller.
// rustc: compiler/rustc_parse/src/parser/path.rs:875 parse_const_arg
Parser.prototype.parse_const_arg = function (this: Parser): PResult<AnonConst> {
  // Parse const argument.
  let value: Expr;
  if (this.token.kind.$ === "OpenBrace") {
    const r = this.parse_expr_block(undefined, this.token.span, ast.BlockCheckMode.Default);
    if (r.$ === "Err") return r;
    value = r._0;
  } else {
    const r = this.parse_unambiguous_unbraced_const_arg();
    if (r.$ === "Err") return r;
    value = r._0;
  }
  return Ok({ id: ast.DUMMY_NODE_ID, value });
};

/// Attempt to parse a const argument that has not been enclosed in braces.
/// There are a limited number of expressions that are permitted without being
/// enclosed in braces:
/// - Literals.
/// - Single-segment paths (i.e. standalone generic const parameters).
/// All other expressions that can be parsed will emit an error suggesting the expression be
/// wrapped in braces.
// rustc: compiler/rustc_parse/src/parser/path.rs:892 parse_unambiguous_unbraced_const_arg
Parser.prototype.parse_unambiguous_unbraced_const_arg = function (this: Parser): PResult<Expr> {
  const start = this.token.span;
  const r = this.parse_expr_res(Restrictions.CONST_EXPR);
  if (r.$ === "Err") {
    const err = r._0;
    err.span_label(Span.shrink_to_lo(start), "while parsing a const generic argument starting here");
    return Err(err);
  }
  const expr = r._0;
  if (!this.expr_is_valid_const_arg(expr)) {
    return Err(
      this.dcx().create_err(
        ConstGenericWithoutBraces_diagnostic({
          span: expr.span,
          sugg: {
            left: Span.shrink_to_lo(expr.span),
            right: Span.shrink_to_hi(expr.span),
          },
        }),
      ),
    );
  }

  return Ok(expr);
};

/// Parse a generic argument in a path segment.
/// This does not include constraints, e.g., `Item = u8`, which is handled in `parse_angle_arg`.
// rustc: compiler/rustc_parse/src/parser/path.rs:916 parse_generic_arg
Parser.prototype.parse_generic_arg = function (
  this: Parser,
  ty_generics: Generics | undefined,
): PResult<GenericArg | undefined> {
  const r_attrs = this.recover_from_outer_attributes("generic arguments");
  if (r_attrs.$ === "Err") return r_attrs;

  const start = this.token.span;
  let arg: GenericArg;
  if (this.check_lifetime() && this.look_ahead(1, (t) => !t.is_like_plus())) {
    // Parse lifetime argument.
    arg = { $: "Lifetime", _0: this.expect_lifetime() };
  } else if (this.check_const_arg()) {
    // Parse const argument.
    const r = this.parse_const_arg();
    if (r.$ === "Err") return r;
    arg = { $: "Const", _0: r._0 };
  } else if (this.check_type()) {
    // Parse type argument.

    // Proactively create a parser snapshot enabling us to rewind and try to reparse the
    // input as a const expression in case we fail to parse a type. If we successfully
    // do so, we will report an error that it needs to be wrapped in braces.
    let snapshot: SnapshotParser | undefined = undefined;
    if (this.may_recover() && this.token.can_begin_expr()) {
      snapshot = this.create_snapshot_for_diagnostic();
    }

    const r = this.parse_ty();
    if (r.$ === "Ok") {
      arg = { $: "Type", _0: r._0 };
    } else {
      const err = r._0;
      if (snapshot !== undefined) {
        const expr = this.recover_unbraced_const_arg_that_can_begin_ty(snapshot);
        if (expr !== undefined) {
          return Ok(this.dummy_const_arg_needs_braces(err, expr.span));
        }
      }
      // Try to recover from possible `const` arg without braces.
      const r2 = this.recover_const_arg(start, err);
      if (r2.$ === "Err") return r2;
      return Ok(r2._0);
    }
  } else if (this.token.is_keyword(kw.Const)) {
    return this.recover_const_param_declaration(ty_generics);
  } else {
    // Fall back by trying to parse a const-expr expression. If we successfully do so,
    // then we should report an error that it needs to be wrapped in braces.
    const snapshot = this.create_snapshot_for_diagnostic();
    const r = this.parse_expr_res(Restrictions.CONST_EXPR);
    if (r.$ === "Ok") {
      const expr = r._0;
      return Ok(
        this.dummy_const_arg_needs_braces(
          this.dcx().struct_span_err(expr.span, "invalid const generic expression"),
          expr.span,
        ),
      );
    } else {
      const err = r._0;
      this.restore_snapshot(snapshot);
      err.cancel();
      return Ok(undefined);
    }
  }

  return Ok(arg);
};

/// Given a arg inside of generics, we try to destructure it as if it were the LHS in
/// `LHS = ...`, i.e. an associated item binding.
/// This returns a bool indicating if there are any `for<'a, 'b>` binder args, the
/// identifier, and any GAT arguments.
// rustc: compiler/rustc_parse/src/parser/path.rs:981 get_ident_from_generic_arg
Parser.prototype.get_ident_from_generic_arg = function (
  this: Parser,
  gen_arg: GenericArg,
): Result<[boolean, Ident, GenericArgs | undefined], undefined> {
  if (gen_arg.$ === "Type") {
    const ty = gen_arg._0;
    const kind = ty.kind;
    if (kind.$ === "Path" && kind._0 === undefined && kind._1.segments.length === 1) {
      const seg = kind._1.segments[0]!;
      return Ok([false, seg.ident, seg.args === undefined ? undefined : ast.clone_GenericArgs(seg.args)]);
    } else if (kind.$ === "TraitObject" && kind._1 === ast.TraitObjectSyntax.None && kind._0.length === 1) {
      const bound = kind._0[0]!;
      if (bound.$ === "Trait") {
        const trait_ref = bound._0;
        if (
          TraitBoundModifiers_eq(trait_ref.modifiers, ast.TraitBoundModifiers.NONE) &&
          trait_ref.trait_ref.path.segments.length === 1
        ) {
          const seg = trait_ref.trait_ref.path.segments[0]!;
          return Ok([true, seg.ident, seg.args === undefined ? undefined : ast.clone_GenericArgs(seg.args)]);
        }
      }
    }
  }
  return Err(undefined);
};

// PORT: `#[derive(PartialEq)]` of `TraitBoundModifiers` (and of its three field enums, whose
// payloads are `Span`s compared by value); local because no `_eq` is generated for it yet.
function TraitBoundModifiers_eq(a: ast.TraitBoundModifiers, b: ast.TraitBoundModifiers): boolean {
  const eq = (x: { $: string; _0?: Span }, y: { $: string; _0?: Span }): boolean => x.$ === y.$ && x._0 === y._0;
  return eq(a.constness, b.constness) && eq(a.asyncness, b.asyncness) && eq(a.polarity, b.polarity);
}
