// Port of compiler/rustc_parse/src/parser/function.rs
// Types (`IsDotDotDot`, `FnParseMode`, `FnContext`, `FrontMatterParsingMode`) are generated into
// function.gen.ts; `ReqName` (a fn pointer type) is hand-written below.
import { ast, HasAttrs, HasTokens, token } from "../../rustc_ast/lib.ts";
import type { AttrVec, Block, FnContract, FnDecl as FnDeclT, FnHeader as FnHeaderT, Generics, Lifetime, Param, Pat, Ty, Visibility } from "../../rustc_ast/lib.ts";
import type { TokenTree } from "../../rustc_ast/tokenstream.ts";
import { Case } from "../../rustc_ast/util/case.ts";
import * as pprust from "../../rustc_ast_pretty/pprust/mod.ts";
import type { Diag, PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { VARARGS_WITHOUT_PATTERN } from "../../rustc_lint_defs/builtin.gen.ts";
import type { Edition } from "../../rustc_span/edition.ts";
import { debug_SpanSnippetError, type ErrorGuaranteed, respan, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { is_whitespace } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../../std/panic.ts";
import { Err, expect_result, Ok, unwrap_result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { dummy_arg } from "./diagnostics.ts";
import type { SnapshotParser } from "./diagnostics.ts";
import type { FnContext, FnParseMode, IsDotDotDot } from "./function.gen.ts";
import { FrontMatterParsingMode } from "./function.gen.ts";
import { FollowedByType, ForceCollect, Parser, Trailing } from "./mod.ts";
import { exp, type ExpKeywordPair } from "./token_type.ts";
import { AllowPlus, RecoverQPath, RecoverReturnSign } from "./ty.gen.ts";

export * from "./function.gen.ts";

const { TokenKind: TK } = token;

/// The parsing configuration used to parse a parameter list (see `parse_fn_params`).
///
/// The function decides if, per-parameter `p`, `p` must have a pattern or just a type.
///
/// This function pointer accepts an edition, because in edition 2015, trait declarations
/// were allowed to omit parameter names. In 2018, they became required. It also accepts an
/// `IsDotDotDot` parameter, as `extern` function declarations and function pointer types are
/// allowed to omit the name of the `...` but regular function items are not.
// PORT: `type ReqName = fn(Edition, IsDotDotDot) -> bool;` (hand: the probe does not describe fn types).
export type ReqName = (edition: Edition, is_dot_dot_dot: IsDotDotDot) => boolean;
/** `fn` pointers are `Copy`. */
export function clone_ReqName(v: ReqName): ReqName {
  return v;
}

// (`IsDotDotDot`, `FnParseMode` and `FnContext` are generated.)

/// Parsing of functions and methods.

/// Parse a function starting from the front matter (`const ...`) to the body `{ ... }` or `;`.
// rustc: compiler/rustc_parse/src/parser/function.rs:116 parse_fn
Parser.prototype.parse_fn = function (
  this: Parser,
  attrs: AttrVec,
  fn_parse_mode: FnParseMode,
  sig_lo: Span,
  vis: Visibility,
  case_: Case,
): PResult<[Ident, ast.FnSig, Generics, FnContract | undefined, Block | undefined]> {
  const fn_span = this.token.span;
  const rh = this.parse_fn_front_matter(vis, case_, FrontMatterParsingMode.Function); // `const ... fn`
  if (rh.$ === "Err") return rh;
  const header = rh._0;
  const ri = this.parse_ident(); // `foo`
  if (ri.$ === "Err") return ri;
  const ident = ri._0;
  const rg = this.parse_generics(); // `<'a, T, ...>`
  if (rg.$ === "Err") return rg;
  const generics = rg._0;
  let decl: FnDeclT;
  const rd = this.parse_fn_decl(fn_parse_mode, AllowPlus.Yes, RecoverReturnSign.Yes);
  if (rd.$ === "Ok") {
    decl = rd._0;
  } else {
    const old_err = rd._0;
    // If we see `for Ty ...` then user probably meant `impl` item.
    if (this.token.is_keyword(kw.For)) {
      old_err.cancel();
      return Err(this.dcx().create_err(diagnostics.FnTypoWithImpl_diagnostic({ fn_span })));
    } else {
      return Err(old_err);
    }
  }

  // Store the end of function parameters to give better diagnostics
  // inside `parse_fn_body()`.
  const fn_params_end_ = Span.shrink_to_hi(this.prev_token.span);

  const rc = this.parse_contract();
  if (rc.$ === "Err") return rc;
  const contract = rc._0;

  const rw = this.parse_where_clause(); // `where T: Ord`
  if (rw.$ === "Err") return rw;
  generics.where_clause = rw._0;

  // `fn_params_end` is needed only when it's followed by a where clause.
  const fn_params_end = generics.where_clause.has_where_token ? fn_params_end_ : undefined;

  const sig_hi: MutRef<Span> = { value: this.prev_token.span };
  // Either `;` or `{ ... }`.
  const rb = this.parse_fn_body(attrs, ident, sig_hi, fn_parse_mode.req_body, fn_params_end);
  if (rb.$ === "Err") return rb;
  const body = rb._0;
  const fn_sig_span = Span.to(sig_lo, sig_hi.value);
  return Ok([ident, new ast.FnSig(header, decl, fn_sig_span), generics, contract, body]);
};

/// Provide diagnostics when function body is not found
// rustc: compiler/rustc_parse/src/parser/function.rs:163 error_fn_body_not_found
Parser.prototype.error_fn_body_not_found = function (
  this: Parser,
  ident_span: Span,
  req_body: boolean,
  fn_params_end: Span | undefined,
): PResult<ErrorGuaranteed> {
  const expected: readonly import("./token_type.ts").ExpTokenPair[] = req_body ? [exp.OpenBrace] : [exp.Semi, exp.OpenBrace];
  const r = this.expected_one_of_not_found([], expected);
  if (r.$ === "Ok") {
    const error_guaranteed = r._0;
    return Ok(error_guaranteed);
  }
  const err = r._0;
  if (this.token.eq(TK.CloseBrace)) {
    // The enclosing `mod`, `trait` or `impl` is being closed, so keep the `fn` in
    // the AST for typechecking.
    err.span_label(ident_span, "while parsing this `fn`");
    return Ok(err.emit_err());
  } else if (this.token.eq(TK.RArrow) && fn_params_end !== undefined) {
    // Instead of a function body, the parser has encountered a right arrow
    // preceded by a where clause.

    // Find whether token behind the right arrow is a function trait and
    // store its span.
    let fn_trait_span: Span | undefined;
    for (const symbol of [sym.FnOnce, sym.FnMut, sym.Fn]) {
      if (this.prev_token.is_ident_named(symbol)) {
        fn_trait_span = this.prev_token.span;
        break;
      }
    }

    // Parse the return type (along with the right arrow) and store its span.
    // If there's a parse error, cancel it and return the existing error
    // as we are primarily concerned with the
    // expected-function-body-but-found-something-else error here.
    const arrow_span = this.token.span;
    let ty_span: Span;
    const rt = this.parse_ret_ty(AllowPlus.Yes, RecoverQPath.Yes, RecoverReturnSign.Yes);
    if (rt.$ === "Ok") {
      ty_span = Span.shrink_to_hi(ast.FnRetTy.span(rt._0));
    } else {
      const parse_error = rt._0;
      parse_error.cancel();
      return Err(err);
    }
    const ret_ty_span = Span.to(arrow_span, ty_span);

    let snippet_r;
    if (fn_trait_span !== undefined) {
      // Typo'd Fn* trait bounds such as
      // fn foo<F>() where F: FnOnce -> () {}
      err.subdiagnostic(diagnostics.FnTraitMissingParen_subdiagnostic({ span: fn_trait_span }));
    } else if ((snippet_r = this.psess.source_map().span_to_snippet(ret_ty_span)).$ === "Ok") {
      const snippet = snippet_r._0.toString();
      // If token behind right arrow is not a Fn* trait, the programmer
      // probably misplaced the return type after the where clause like
      // `fn foo<T>() where T: Default -> u8 {}`
      err.primary_message("return type should be specified after the function parameters");
      err.subdiagnostic(
        diagnostics.MisplacedReturnType_subdiagnostic({
          fn_params_end,
          snippet,
          ret_ty_span,
        }),
      );
    }
    return Err(err);
  } else {
    return Err(err);
  }
};

/// Parse the "body" of a function.
/// This can either be `;` when there's no body,
/// or e.g. a block when the function is a provided one.
// rustc: compiler/rustc_parse/src/parser/function.rs:243 parse_fn_body
Parser.prototype.parse_fn_body = function (
  this: Parser,
  attrs: AttrVec,
  ident: Ident,
  sig_hi: MutRef<Span>,
  req_body: boolean,
  fn_params_end: Span | undefined,
): PResult<Block | undefined> {
  let has_semi: boolean;
  if (req_body) {
    has_semi = this.token.eq(TK.Semi);
  } else {
    // Only include `;` in list of expected tokens if body is not required
    has_semi = this.check(exp.Semi);
  }
  let inner_attrs: AttrVec;
  let body: Block | undefined;
  if (has_semi) {
    // Include the trailing semicolon in the span of the signature
    const r = this.expect_semi();
    if (r.$ === "Err") return r;
    sig_hi.value = this.prev_token.span;
    [inner_attrs, body] = [[], undefined];
  } else if (this.check(exp.OpenBrace) || this.token.is_metavar_block()) {
    const prev_in_fn_body = this.in_fn_body;
    this.in_fn_body = true;
    const r = this.parse_block_common(this.token.span, ast.BlockCheckMode.Default, undefined);
    let res: PResult<[AttrVec, Block | undefined]>;
    if (r.$ === "Ok") {
      const [attrs, body] = r._0;
      const guar = this.fn_body_missing_semi_guar;
      this.fn_body_missing_semi_guar = undefined;
      if (guar !== undefined) {
        body.stmts.push(
          this.mk_stmt(body.span, { $: "Expr", _0: this.mk_expr(body.span, { $: "Err", _0: guar }) }),
        );
      }
      res = Ok([attrs, body]);
    } else {
      res = r;
    }
    this.in_fn_body = prev_in_fn_body;
    if (res.$ === "Err") return res;
    [inner_attrs, body] = res._0;
  } else if (this.token.eq(TK.Eq)) {
    // Recover `fn foo() = $expr;`.
    this.bump(); // `=`
    const eq_sp = this.prev_token.span;
    const r = this.parse_expr();
    if (r.$ === "Err") return r;
    const r2 = this.expect_semi(); // `;`
    if (r2.$ === "Err") return r2;
    const span = Span.to(eq_sp, this.prev_token.span);
    const guar = this.dcx().emit_err(
      diagnostics.FunctionBodyEqualsExpr_diagnostic({
        span,
        sugg: {
          eq: eq_sp,
          semi: this.prev_token.span,
        },
      }),
    );
    [inner_attrs, body] = [[], this.mk_block_err(span, guar)];
  } else {
    const r = this.error_fn_body_not_found(ident.span, req_body, fn_params_end);
    if (r.$ === "Err") return r;
    [inner_attrs, body] = [[], undefined];
  }
  attrs.push(...inner_attrs);
  return Ok(body);
};

const ALL_QUALS: readonly ExpKeywordPair[] = [
  exp.Pub,
  exp.Gen,
  exp.Const,
  exp.Async,
  exp.Unsafe,
  exp.Safe,
  exp.Extern,
];
// PORT: the `const ALL_QUALS` of `check_fn_front_matter` (hoisted, it is a `const` item) and the
// non-`pub` qualifier slice of the same fn.
const QUALS_NO_PUB: readonly ExpKeywordPair[] = [exp.Gen, exp.Const, exp.Async, exp.Unsafe, exp.Safe, exp.Extern];

/// Is the current token the start of an `FnHeader` / not a valid parse?
///
/// `check_pub` adds additional `pub` to the checks in case users place it
/// wrongly, can be used to ensure `pub` never comes after `default`.
// rustc: compiler/rustc_parse/src/parser/function.rs:305 check_fn_front_matter
Parser.prototype.check_fn_front_matter = function (this: Parser, check_pub: boolean, case_: Case): boolean {
  // We use an over-approximation here.
  // `const const`, `fn const` won't parse, but we're not stepping over other syntax either.
  // `pub` is added in case users got confused with the ordering like `async pub fn`,
  // only if it wasn't preceded by `default` as `default pub` is invalid.
  const quals: readonly ExpKeywordPair[] = check_pub ? ALL_QUALS : QUALS_NO_PUB;
  return (
    this.check_keyword_case(exp.Fn, case_) || // Definitely an `fn`.
    // `$qual fn` or `$qual $qual`:
    (quals.some((exp_) => this.check_keyword_case(exp_, case_)) &&
      this.look_ahead(1, (t) => {
        // `$qual fn`, e.g. `const fn` or `async fn`.
        if (t.is_keyword_case(kw.Fn, case_)) return true;
        // Two qualifiers `$qual $qual` is enough, e.g. `async unsafe`.
        const i1 = t.non_raw_ident();
        const i2 = case_ === Case.Insensitive ? t.non_raw_ident() : undefined;
        return (
          ((i1 !== undefined &&
            quals.some((exp_) => exp_.kw === i1.name) &&
            // Rule out 2015 `const async: T = val`.
            i1.is_reserved()) ||
            (case_ === Case.Insensitive &&
              i2 !== undefined &&
              quals.some((exp_) => Symbol.as_str(exp_.kw) === to_lowercase(Symbol.as_str(i2.name))))) &&
          // Rule out `unsafe extern {`.
          !this.is_unsafe_foreign_mod() &&
          // Rule out `async gen {` and `async gen move {`
          !this.is_async_gen_block() &&
          // Rule out `const unsafe auto` and `const unsafe trait` and `const unsafe impl`
          !this.is_keyword_ahead(2, [kw.Auto, kw.Trait, kw.Impl])
        );
      })) ||
    // `extern ABI fn`
    (this.check_keyword_case(exp.Extern, case_) &&
      // Use `tree_look_ahead` because `ABI` might be a metavariable,
      // i.e. an invisible-delimited sequence, and `tree_look_ahead`
      // will consider that a single element when looking ahead.
      this.look_ahead(1, (t) => t.can_begin_string_literal()) &&
      (this.tree_look_ahead(2, (tt: TokenTree) => {
        switch (tt.$) {
          case "Token":
            return tt._0.is_keyword_case(kw.Fn, case_);
          case "Delimited":
            return false;
        }
      }) === true ||
        // This branch is only for better diagnostics; `pub`, `unsafe`, etc. are not
        // allowed here.
        // This branch also follows `$qual fn` or `$qual $qual` rule
        // above since a valid `fn` can be after `extern`.
        (this.may_recover() &&
          this.tree_look_ahead(2, (tt: TokenTree) => {
            switch (tt.$) {
              case "Token": {
                const t = tt._0;
                return ALL_QUALS.some((exp_) => t.is_keyword(exp_.kw));
              }
              case "Delimited":
                return false;
            }
          }) === true &&
          this.tree_look_ahead(3, (tt: TokenTree) => {
            switch (tt.$) {
              case "Token": {
                const t = tt._0;
                return t.is_keyword_case(kw.Fn, case_) || ALL_QUALS.some((exp_) => t.is_keyword(exp_.kw));
              }
              case "Delimited":
                return false;
            }
          }) === true)))
  );
};

// PORT: `str::to_lowercase` (Unicode lowercase mapping); only compared against ASCII keyword names.
function to_lowercase(s: string): string {
  return s.toLowerCase();
}

// Qualifier keywords ordering check (the fn-local `enum WrongKw` of `parse_fn_front_matter`)
type WrongKw =
  | { readonly $: "Duplicated"; _0: Span }
  | { readonly $: "Misplaced"; _0: Span }
  /// `MisplacedDisallowedQualifier` is only used instead of `Misplaced`,
  /// when the misplaced keyword is disallowed by the current `FrontMatterParsingMode`.
  /// In this case, we avoid generating the suggestion to swap around the keywords,
  /// as we already generated a suggestion to remove the keyword earlier.
  | { readonly $: "MisplacedDisallowedQualifier" };

/// Parses all the "front matter" (or "qualifiers") for a `fn` declaration,
/// up to and including the `fn` keyword. The formal grammar is:
///
/// ```text
/// Extern = "extern" StringLit? ;
/// FnQual = "const"? "async"? "unsafe"? Extern? ;
/// FnFrontMatter = FnQual "fn" ;
/// ```
///
/// `vis` represents the visibility that was already parsed, if any. Use
/// `Visibility::Inherited` when no visibility is known.
///
/// If `parsing_mode` is `FrontMatterParsingMode::FunctionPtrType`, we error on `const` and `async` qualifiers,
/// which are not allowed in function pointer types.
// rustc: compiler/rustc_parse/src/parser/function.rs:407 parse_fn_front_matter
Parser.prototype.parse_fn_front_matter = function (
  this: Parser,
  orig_vis: Visibility,
  case_: Case,
  parsing_mode: FrontMatterParsingMode,
): PResult<FnHeaderT> {
  const sp_start = this.token.span;
  const constness = this.parse_constness(case_);
  if (parsing_mode === FrontMatterParsingMode.FunctionPtrType && constness.$ === "Yes") {
    const const_span = constness._0;
    this.dcx().emit_err(
      diagnostics.FnPointerCannotBeConst_diagnostic({
        span: const_span,
        suggestion: Span.until(const_span, this.token.span),
      }),
    );
  }

  const async_start_sp = this.token.span;
  const coroutine_marker = this.parse_coroutine_marker(case_);
  if (
    parsing_mode === FrontMatterParsingMode.FunctionPtrType &&
    coroutine_marker !== undefined &&
    coroutine_marker.kind === ast.CoroutineKind.Async
  ) {
    this.dcx().emit_err(
      diagnostics.FnPointerCannotBeAsync_diagnostic({
        span: coroutine_marker.span,
        suggestion: Span.until(coroutine_marker.span, this.token.span),
      }),
    );
  }
  // FIXME(gen_blocks): emit a similar error for `gen fn()`

  const unsafe_start_sp = this.token.span;
  const safety = this.parse_safety(case_);

  const ext_start_sp = this.token.span;
  const ext = this.parse_extern(case_);

  if (
    coroutine_marker !== undefined &&
    coroutine_marker.kind === ast.CoroutineKind.Async &&
    Span.is_rust_2015(coroutine_marker.span)
  ) {
    this.dcx().emit_err(
      diagnostics.AsyncFnIn2015_diagnostic({
        span: coroutine_marker.span,
        help: diagnostics.HelpUseLatestEdition.new(),
      }),
    );
  }

  if (coroutine_marker !== undefined && ast.CoroutineKind.is_gen(coroutine_marker.kind)) {
    this.psess.gated_spans.gate(sym.gen_blocks, coroutine_marker.span);
  }

  if (!this.eat_keyword_case(exp.Fn, case_)) {
    // It is possible for `expect_one_of` to recover given the contents of
    // `self.expected_token_types`, therefore, do not use `self.unexpected()` which doesn't
    // account for this.
    const r = this.expect_one_of([], []);
    if (r.$ === "Ok") {
      if (r._0.$ === "Yes") {
        // Ok(Recovered::Yes(_)) => {}
      } else {
        return unreachable();
      }
    } else {
      const err = r._0;
      // We may be able to recover
      let recover_constness = constness;
      let recover_coroutine_marker = coroutine_marker;
      let recover_safety = safety;
      // This will allow the machine fix to directly place the keyword in the correct place or to indicate
      // that the keyword is already present and the second instance should be removed.
      let wrong_kw: WrongKw | undefined;
      if (this.check_keyword(exp.Const)) {
        switch (constness.$) {
          case "Yes":
            wrong_kw = { $: "Duplicated", _0: constness._0 };
            break;
          case "No": {
            recover_constness = { $: "Yes", _0: this.token.span };
            switch (parsing_mode) {
              case "Function":
                wrong_kw = { $: "Misplaced", _0: async_start_sp };
                break;
              case "FunctionPtrType":
                this.dcx().emit_err(
                  diagnostics.FnPointerCannotBeConst_diagnostic({
                    span: this.token.span,
                    suggestion: Span.with_lo(this.token.span, Span.hi(this.prev_token.span)),
                  }),
                );
                wrong_kw = { $: "MisplacedDisallowedQualifier" };
                break;
            }
            break;
          }
        }
      } else if (this.check_keyword(exp.Async)) {
        if (
          coroutine_marker !== undefined &&
          (coroutine_marker.kind === ast.CoroutineKind.Async || coroutine_marker.kind === ast.CoroutineKind.AsyncGen)
        ) {
          wrong_kw = { $: "Duplicated", _0: coroutine_marker.span };
        } else if (coroutine_marker !== undefined && coroutine_marker.kind === ast.CoroutineKind.Gen) {
          recover_coroutine_marker = ast.CoroutineMarker.new(ast.CoroutineKind.AsyncGen, this.token.span);
          // FIXME(gen_blocks): This span is wrong, didn't want to think about it.
          wrong_kw = { $: "Misplaced", _0: unsafe_start_sp };
        } else {
          // None
          recover_coroutine_marker = ast.CoroutineMarker.new(ast.CoroutineKind.Async, this.token.span);
          switch (parsing_mode) {
            case "Function":
              wrong_kw = { $: "Misplaced", _0: async_start_sp };
              break;
            case "FunctionPtrType":
              this.dcx().emit_err(
                diagnostics.FnPointerCannotBeAsync_diagnostic({
                  span: this.token.span,
                  suggestion: Span.with_lo(this.token.span, Span.hi(this.prev_token.span)),
                }),
              );
              wrong_kw = { $: "MisplacedDisallowedQualifier" };
              break;
          }
        }
      } else if (this.check_keyword(exp.Unsafe)) {
        switch (safety.$) {
          case "Unsafe":
            wrong_kw = { $: "Duplicated", _0: safety._0 };
            break;
          case "Safe":
            recover_safety = { $: "Unsafe", _0: this.token.span };
            wrong_kw = { $: "Misplaced", _0: safety._0 };
            break;
          case "Default":
            recover_safety = { $: "Unsafe", _0: this.token.span };
            wrong_kw = { $: "Misplaced", _0: ext_start_sp };
            break;
        }
      } else if (this.check_keyword(exp.Safe)) {
        switch (safety.$) {
          case "Safe":
            wrong_kw = { $: "Duplicated", _0: safety._0 };
            break;
          case "Unsafe":
            recover_safety = { $: "Safe", _0: this.token.span };
            wrong_kw = { $: "Misplaced", _0: safety._0 };
            break;
          case "Default":
            recover_safety = { $: "Safe", _0: this.token.span };
            wrong_kw = { $: "Misplaced", _0: ext_start_sp };
            break;
        }
      } else {
        wrong_kw = undefined;
      }

      // The keyword is already present, suggest removal of the second instance
      if (wrong_kw !== undefined && wrong_kw.$ === "Duplicated") {
        const original_sp = wrong_kw._0;
        const original_kw = expect_result(
          this.span_to_snippet(original_sp),
          "Span extracted directly from keyword should always work",
          debug_SpanSnippetError,
        );

        err
          .span_suggestion_verbose(
            this.token_uninterpolated_span(),
            `\`${original_kw}\` already used earlier, remove this one`,
            "",
            Applicability.MachineApplicable,
          )
          .span_note(original_sp, `\`${original_kw}\` first seen here`);
      }
      // The keyword has not been seen yet, suggest correct placement in the function front matter
      else if (wrong_kw !== undefined && wrong_kw.$ === "Misplaced") {
        const correct_pos_sp = Span.to(wrong_kw._0, this.prev_token.span);
        const rs = this.span_to_snippet(correct_pos_sp);
        if (rs.$ === "Ok") {
          const current_qual = rs._0;
          const misplaced_qual_sp = this.token_uninterpolated_span();
          const misplaced_qual = unwrap_result(this.span_to_snippet(misplaced_qual_sp), debug_SpanSnippetError);

          err
            .span_suggestion_verbose(
              Span.to(correct_pos_sp, misplaced_qual_sp),
              `\`${misplaced_qual}\` must come before \`${current_qual}\``,
              `${misplaced_qual} ${current_qual}`,
              Applicability.MachineApplicable,
            )
            .note("keyword order for functions declaration is `pub`, `default`, `const`, `async`, `unsafe`, `extern`");
        }
      }
      // Recover incorrect visibility order such as `async pub`
      else if (this.check_keyword(exp.Pub)) {
        const sp = Span.to(sp_start, this.prev_token.span);
        const rs = this.span_to_snippet(sp);
        if (rs.$ === "Ok") {
          const snippet = rs._0;
          const rv = this.parse_visibility(FollowedByType.No);
          let current_vis: Visibility;
          if (rv.$ === "Ok") {
            current_vis = rv._0;
          } else {
            const d = rv._0;
            d.cancel();
            return Err(err);
          }
          const vs_ = pprust.vis_to_string(current_vis);
          const vs = trim_end(vs_);

          // There was no explicit visibility
          if (orig_vis.kind.$ === "Inherited") {
            err.span_suggestion_verbose(
              Span.to(sp_start, this.prev_token.span),
              `visibility \`${vs}\` must come before \`${snippet}\``,
              `${vs} ${snippet}`,
              Applicability.MachineApplicable,
            );
          }
          // There was an explicit visibility
          else {
            err
              .span_suggestion_verbose(
                current_vis.span,
                "there is already a visibility modifier, remove one",
                "",
                Applicability.MachineApplicable,
              )
              .span_note(orig_vis.span, "explicit visibility first seen here");
          }
        }
      }

      // FIXME(gen_blocks): add keyword recovery logic for genness

      if (wrong_kw !== undefined && this.may_recover() && this.look_ahead(1, (tok) => tok.is_keyword_case(kw.Fn, case_))) {
        // Advance past the misplaced keyword and `fn`
        this.bump();
        this.bump();
        // When we recover from a `MisplacedDisallowedQualifier`, we already emitted an error for the disallowed qualifier
        // So we don't emit another error that the qualifier is unexpected.
        if (wrong_kw.$ === "MisplacedDisallowedQualifier") {
          err.cancel();
        } else {
          err.emit();
        }
        return Ok(new ast.FnHeader(recover_constness, recover_coroutine_marker, recover_safety, ext));
      }

      return Err(err);
    }
  }

  return Ok(new ast.FnHeader(constness, coroutine_marker, safety, ext));
};

// PORT: `str::trim_end` (`char::is_whitespace`) on a `string`; src/std/str.ts `str_trim_end` takes a `Str`.
function trim_end(s: string): string {
  const cs = Array.from(s);
  let end = cs.length;
  while (end > 0 && is_whitespace(cs[end - 1]!.codePointAt(0)!)) end--;
  return cs.slice(0, end).join("");
}

/// Parses the parameter list and result type of a function declaration.
// rustc: compiler/rustc_parse/src/parser/function.rs:669 parse_fn_decl
Parser.prototype.parse_fn_decl = function (
  this: Parser,
  fn_parse_mode: FnParseMode,
  ret_allow_plus: AllowPlus,
  recover_return_sign: RecoverReturnSign,
): PResult<FnDeclT> {
  const ri = this.parse_fn_params(fn_parse_mode);
  if (ri.$ === "Err") return ri;
  const inputs = ri._0;
  const ro = this.parse_ret_ty(ret_allow_plus, RecoverQPath.Yes, recover_return_sign);
  if (ro.$ === "Err") return ro;
  const output = ro._0;
  return Ok(new ast.FnDecl(inputs, output));
};

/// Parses the parameter list of a function, including the `(` and `)` delimiters.
// rustc: compiler/rustc_parse/src/parser/function.rs:682 parse_fn_params
Parser.prototype.parse_fn_params = function (this: Parser, fn_parse_mode: FnParseMode): PResult<Param[]> {
  let first_param = true;
  // Parse the arguments, starting out with `self` being allowed...
  if (
    !this.token.eq(TK.OpenParen) &&
    // might be typo'd trait impl, handled elsewhere
    !this.token.is_keyword(kw.For)
  ) {
    // recover from missing argument list, e.g. `fn main -> () {}`
    this.dcx().emit_err(
      diagnostics.MissingFnParams_diagnostic({
        span: Span.shrink_to_hi(this.prev_token.span),
      }),
    );
    return Ok([]);
  }

  const r = this.parse_paren_comma_seq((p) => {
    p.recover_vcs_conflict_marker();
    const snapshot: SnapshotParser = p.create_snapshot_for_diagnostic();
    let param: PResult<Param> = p.parse_param_general(fn_parse_mode, first_param);
    if (param.$ === "Err") {
      const e = param._0;
      const guar = e.emit_err();
      // When parsing a param failed, we should check to make the span of the param
      // not contain '(' before it.
      // For example when parsing `*mut Self` in function `fn oof(*mut Self)`.
      const lo = p.prev_token.kind.$ === "OpenParen" ? Span.shrink_to_hi(p.prev_token.span) : p.prev_token.span;
      p.restore_snapshot(snapshot);
      // Skip every token until next possible arg or end.
      p.eat_to_tokens([exp.Comma, exp.CloseParen]);
      // Create a placeholder argument for proper arg count (issue #34264).
      param = Ok(dummy_arg(Ident.new(sym.dummy, Span.to(lo, p.prev_token.span)), guar));
    }
    // ...now that we've parsed the first argument, `self` is no longer allowed.
    first_param = false;
    return param;
  });
  if (r.$ === "Err") return r;
  const [params] = r._0;
  // Replace duplicated recovered params with `_` pattern to avoid unnecessary errors.
  this.deduplicate_recovered_params_names(params);
  return Ok(params);
};

/// Parses a single function parameter.
///
/// - `self` is syntactically allowed when `first_param` holds.
/// - `recover_arg_parse` is used to recover from a failed argument parse.
// rustc: compiler/rustc_parse/src/parser/function.rs:731 parse_param_general
Parser.prototype.parse_param_general = function (
  this: Parser,
  fn_parse_mode: FnParseMode,
  first_param: boolean,
): PResult<Param> {
  const lo = this.token.span;
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  return this.collect_tokens<Param>(
    undefined,
    attrs,
    ForceCollect.No,
    (this_, attrs) => {
      // Possibly parse `self`. Recover if we parsed it and it wasn't allowed here.
      const rs = this_.parse_self_param();
      if (rs.$ === "Err") return rs;
      const param = rs._0;
      if (param !== undefined) {
        param.attrs = attrs;
        const res = first_param ? Ok(param) : this_.recover_bad_self_param(param);
        if (res.$ === "Err") return res;
        return Ok([res._0, Trailing.No, "No"]);
      }

      const is_dot_dot_dot: IsDotDotDot = this_.token.kind.$ === "DotDotDot" ? "Yes" : "No";
      let is_name_required = fn_parse_mode.req_name(
        Span.edition(Span.with_neighbor(this_.token.span, this_.prev_token.span)),
        is_dot_dot_dot,
      );
      if (is_name_required && is_dot_dot_dot === "Yes") {
        this_.psess.buffer_lint(
          VARARGS_WITHOUT_PATTERN,
          this_.token.span,
          ast.CRATE_NODE_ID,
          diagnostics.VarargsWithoutPattern_diagnostic({ span: this_.token.span }),
        );
        is_name_required = false;
      }
      let pat: Pat;
      let ty: Ty;
      if (is_name_required || this_.is_named_param()) {
        // debug!("parse_param_general parse_pat (is_name_required:{})", is_name_required);
        const rp = this_.parse_fn_param_pat_colon();
        if (rp.$ === "Err") return rp;
        const [pat_, colon] = rp._0;
        if (!colon) {
          const ru = this_.unexpected();
          const err: Diag =
            ru.$ === "Err" ? ru._0 : panic("called `Result::unwrap_err()` on an `Ok` value: ()");
          const pat_span = pat_.span;
          const ident = this_.parameter_without_type(err, pat_, is_name_required, first_param, fn_parse_mode);
          if (ident !== undefined) {
            const guar = err.emit_err();
            const arg = dummy_arg(ident, guar);
            arg.span = pat_span;
            return Ok([arg, Trailing.No, "No"]);
          } else {
            return Err(err);
          }
        }

        const rt = this_.parse_ty_for_param();
        if (rt.$ === "Err") return rt;
        [pat, ty] = [pat_, rt._0];
      } else {
        // debug!("parse_param_general ident_to_pat");
        const parser_snapshot_before_ty = this_.create_snapshot_for_diagnostic();
        let ty_: PResult<Ty> = this_.parse_ty_for_param();

        if (ty_.$ === "Ok") {
          const t = ty_._0;
          // Check for trailing angle brackets
          if (t.kind.$ === "Path") {
            const segments = t.kind._1.segments;
            const segment = segments[segments.length - 1];
            if (segment !== undefined) {
              const guar = this_.check_trailing_angle_brackets(segment, [exp.CloseParen]);
              if (guar !== undefined) {
                return Ok([dummy_arg(segment.ident, guar), Trailing.No, "No"]);
              }
            }
          }

          if (!this_.token.eq(TK.Comma) && !this_.token.eq(TK.CloseParen)) {
            // This wasn't actually a type, but a pattern looking like a type,
            // so we are going to rollback and re-parse for recovery.
            ty_ = this_.unexpected_any();
          }
        }
        if (ty_.$ === "Ok") {
          const ty__ = ty_._0;
          const pat_ = this_.mk_pat(ty__.span, ast.PatKind.Missing);
          [pat, ty] = [pat_, ty__];
        } else {
          const err = ty_._0;
          // If this is a C-variadic argument and we hit an error, return the error.
          if (this_.token.eq(TK.DotDotDot)) {
            return Err(err);
          } else if (this_.unmatched_angle_bracket_count > 0) {
            return Err(err);
          } else {
            // Recover from attempting to parse the argument as a type without pattern.
            this_.restore_snapshot(parser_snapshot_before_ty);
            const rr = this_.recover_arg_parse(fn_parse_mode.context);
            if (rr.$ === "Ok") {
              // We managed to parse the argument as a pattern, cancel the original error and emit a better one
              err.cancel();
              [pat, ty] = rr._0;
            } else {
              const new_err = rr._0;
              // We did not manage to parse the argument as a pattern, avoid suggesting a pattern and emit the original error
              new_err.cancel();
              return Err(err);
            }
          }
        }
      }

      const span = Span.to(lo, this_.prev_token.span);

      return Ok([new ast.Param(attrs, ty, pat, ast.DUMMY_NODE_ID, span, false), Trailing.No, "No"]);
    },
    HasTokens.Param,
    HasAttrs.Param,
  );
};

/// Returns the parsed optional self parameter and whether a self shortcut was used.
// rustc: compiler/rustc_parse/src/parser/function.rs:852 parse_self_param
Parser.prototype.parse_self_param = function (this: Parser): PResult<Param | undefined> {
  // Extract an identifier *after* having confirmed that the token is one.
  const expect_self_ident = (this_: Parser): Ident => {
    const ident = unwrap(this_.token.non_raw_ident());
    this_.bump();
    return ident;
  };
  // is lifetime `n` tokens ahead?
  const is_lifetime = (this_: Parser, n: number): boolean => this_.look_ahead(n, (t) => t.is_lifetime());
  // Is `self` `n` tokens ahead?
  const is_isolated_self = (this_: Parser, n: number): boolean =>
    this_.is_keyword_ahead(n, [kw.SelfLower]) && this_.look_ahead(n + 1, (t) => !t.eq(TK.PathSep));
  // Is `pin const self` `n` tokens ahead?
  const is_isolated_pin_const_self = (this_: Parser, n: number): boolean =>
    this_.is_keyword_ahead(n, [kw.Pin]) && this_.is_keyword_ahead(n + 1, [kw.Const]) && is_isolated_self(this_, n + 2);
  // Is `mut self` `n` tokens ahead?
  const is_isolated_mut_self = (this_: Parser, n: number): boolean =>
    this_.is_keyword_ahead(n, [kw.Mut]) && is_isolated_self(this_, n + 1);
  // Is `pin mut self` `n` tokens ahead?
  const is_isolated_pin_mut_self = (this_: Parser, n: number): boolean =>
    this_.is_keyword_ahead(n, [kw.Pin]) && is_isolated_mut_self(this_, n + 1);
  // Parse `self` or `self: TYPE`. We already know the current token is `self`.
  const parse_self_possibly_typed = (this_: Parser, m: ast.Mutability): PResult<[ast.SelfKind, Ident, Span]> => {
    const eself_ident = expect_self_ident(this_);
    const eself_hi = this_.prev_token.span;
    let eself: ast.SelfKind;
    if (this_.eat(exp.Colon)) {
      const r = this_.parse_ty();
      if (r.$ === "Err") return r;
      eself = { $: "Explicit", _0: r._0, _1: m };
    } else {
      eself = { $: "Value", _0: m };
    }
    return Ok([eself, eself_ident, eself_hi]);
  };
  const expect_self_ident_not_typed = (this_: Parser, modifier: ast.SelfKind, modifier_span: Span): Ident => {
    const eself_ident = expect_self_ident(this_);

    // Recover `: Type` after a qualified self
    if (this_.may_recover() && this_.eat_noexpect(TK.Colon)) {
      const snap = this_.create_snapshot_for_diagnostic();
      const r = this_.parse_ty();
      if (r.$ === "Ok") {
        const ty = r._0;
        this_.dcx().emit_err(
          diagnostics.IncorrectTypeOnSelf_diagnostic({
            span: ty.span,
            move_self_modifier: {
              removal_span: modifier_span,
              insertion_span: Span.shrink_to_lo(ty.span),
              modifier: ast.SelfKind.to_ref_suggestion(modifier),
            },
          }),
        );
      } else {
        const diag = r._0;
        diag.cancel();
        this_.restore_snapshot(snap);
      }
    }
    return eself_ident;
  };
  // Recover for the grammar `*self`, `*const self`, and `*mut self`.
  const recover_self_ptr = (this_: Parser): PResult<[ast.SelfKind, Ident, Span]> => {
    this_.dcx().emit_err(diagnostics.SelfArgumentPointer_diagnostic({ span: this_.token.span }));

    return Ok([{ $: "Value", _0: "Not" }, expect_self_ident(this_), this_.prev_token.span]);
  };

  // Parse optional `self` parameter of a method.
  // Only a limited set of initial token sequences is considered `self` parameters; anything
  // else is parsed as a normal function parameter list, so some lookahead is required.
  const eself_lo = this.token.span;
  let eself: ast.SelfKind;
  let eself_ident: Ident;
  let eself_hi: Span;
  const kind = this.token.uninterpolate().kind;
  if (kind.$ === "And") {
    const has_lifetime = is_lifetime(this, 1);
    const skip_lifetime_count = has_lifetime ? 1 : 0;
    let eself_: ast.SelfKind;
    if (is_isolated_self(this, skip_lifetime_count + 1)) {
      // `&{'lt} self`
      this.bump(); // &
      const lifetime: Lifetime | undefined = has_lifetime ? this.expect_lifetime() : undefined;
      eself_ = { $: "Region", _0: lifetime, _1: "Not" };
    } else if (is_isolated_mut_self(this, skip_lifetime_count + 1)) {
      // `&{'lt} mut self`
      this.bump(); // &
      const lifetime: Lifetime | undefined = has_lifetime ? this.expect_lifetime() : undefined;
      this.bump(); // mut
      eself_ = { $: "Region", _0: lifetime, _1: "Mut" };
    } else if (is_isolated_pin_const_self(this, skip_lifetime_count + 1)) {
      // `&{'lt} pin const self`
      this.bump(); // &
      const lifetime: Lifetime | undefined = has_lifetime ? this.expect_lifetime() : undefined;
      this.psess.gated_spans.gate(sym.pin_ergonomics, this.token.span);
      this.bump(); // pin
      this.bump(); // const
      eself_ = { $: "Pinned", _0: lifetime, _1: "Not" };
    } else if (is_isolated_pin_mut_self(this, skip_lifetime_count + 1)) {
      // `&{'lt} pin mut self`
      this.bump(); // &
      const lifetime: Lifetime | undefined = has_lifetime ? this.expect_lifetime() : undefined;
      this.psess.gated_spans.gate(sym.pin_ergonomics, this.token.span);
      this.bump(); // pin
      this.bump(); // mut
      eself_ = { $: "Pinned", _0: lifetime, _1: "Mut" };
    } else {
      // `&not_self`
      return Ok(undefined);
    }
    const hi = this.token.span;
    const self_ident = expect_self_ident_not_typed(this, eself_, Span.until(eself_lo, hi));
    [eself, eself_ident, eself_hi] = [eself_, self_ident, hi];
  }
  // `*self`
  else if (kind.$ === "Star" && is_isolated_self(this, 1)) {
    this.bump();
    const r = recover_self_ptr(this);
    if (r.$ === "Err") return r;
    [eself, eself_ident, eself_hi] = r._0;
  }
  // `*mut self` and `*const self`
  else if (kind.$ === "Star" && this.look_ahead(1, (t) => t.is_mutability()) && is_isolated_self(this, 2)) {
    this.bump();
    this.bump();
    const r = recover_self_ptr(this);
    if (r.$ === "Err") return r;
    [eself, eself_ident, eself_hi] = r._0;
  }
  // `self` and `self: TYPE`
  else if (kind.$ === "Ident" && is_isolated_self(this, 0)) {
    const r = parse_self_possibly_typed(this, "Not");
    if (r.$ === "Err") return r;
    [eself, eself_ident, eself_hi] = r._0;
  }
  // `mut self` and `mut self: TYPE`
  else if (kind.$ === "Ident" && is_isolated_mut_self(this, 0)) {
    this.bump();
    const r = parse_self_possibly_typed(this, "Mut");
    if (r.$ === "Err") return r;
    [eself, eself_ident, eself_hi] = r._0;
  } else {
    return Ok(undefined);
  }

  const eself_sp = respan(Span.to(eself_lo, eself_hi), eself);
  return Ok(ast.Param.from_self([], eself_sp, eself_ident));
};

// rustc: compiler/rustc_parse/src/parser/function.rs:995 is_named_param
Parser.prototype.is_named_param = function (this: Parser): boolean {
  let offset: number;
  const kind = this.token.kind;
  if (kind.$ === "OpenInvisible") {
    const origin = kind._0;
    if (origin.$ === "MetaVar" && origin._0.$ === "Pat") {
      return this.check_noexpect_past_close_delim(TK.Colon);
    } else {
      offset = 0;
    }
  } else if (kind.$ === "And" || kind.$ === "AndAnd") {
    offset = 1;
  } else if (this.token.is_keyword(kw.Mut)) {
    offset = 1;
  } else {
    offset = 0;
  }

  return this.look_ahead(offset, (t) => t.is_ident()) && this.look_ahead(offset + 1, (t) => t.eq(TK.Colon));
};

// rustc: compiler/rustc_parse/src/parser/function.rs:1012 recover_self_param
Parser.prototype.recover_self_param = function (this: Parser): boolean {
  const ra = this.parse_outer_attributes();
  const r = ra.$ === "Ok" ? this.parse_self_param() : ra;
  if (r.$ === "Err") {
    r._0.cancel();
    return false;
  }
  return r._0 !== undefined;
};

// (`FrontMatterParsingMode` is generated.)
