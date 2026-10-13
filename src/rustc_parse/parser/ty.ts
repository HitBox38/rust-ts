// Port of compiler/rustc_parse/src/parser/ty.rs
// Types (`AllowPlus`, `RecoverQPath`, `RecoverQuestionMark`, `RecoverReturnSign`, `AllowCVariadic`)
// are generated into ty.gen.ts.
// Init order: see parser/mod.ts (top-level code touches only `Parser`, ty.gen.ts and non-parser
// modules; other extension modules are used inside function bodies only).
import { ast, token } from "../../rustc_ast/lib.ts";
import type {
  BoundAsyncness,
  BoundConstness,
  BoundPolarity,
  FnRetTy,
  GenericBound,
  GenericBounds,
  GenericParam,
  Generics,
  Lifetime,
  Mutability,
  Param,
  Parens,
  Path,
  Pinnedness,
  PreciseCapturingArg,
  TraitBoundModifiers,
  Ty,
  TyKind,
} from "../../rustc_ast/lib.ts";
import type { Token, TokenKind } from "../../rustc_ast/token.ts";
import { Case } from "../../rustc_ast/util/case.ts";
import { type Diag, debug_Diag, E0516, type PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { Edition } from "../../rustc_span/edition.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { field_mut, type MutRef } from "../../std/mut_ref.ts";
import { assert, unreachable, unwrap } from "../../std/panic.ts";
import { Err, Ok, type Result, unwrap_result } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import {
  DynAfterMut_diagnostic,
  ExpectedFnPathFoundFnKeyword_diagnostic,
  ExpectedMutOrConstInRawPointerType_diagnostic,
  FnPtrWithGenerics_diagnostic,
  type FnPtrWithGenericsSugg,
  HelpUseLatestEdition,
  InvalidCVariadicType_diagnostic,
  InvalidDynKeyword_diagnostic,
  LifetimeAfterMut_diagnostic,
  NeedPlusAfterTraitObjectLifetime_diagnostic,
  NestedCVariadicType_diagnostic,
  ReturnTypesUseThinArrow_diagnostic,
} from "../diagnostics.ts";
import { RecoverQPath as RecoverQPathImpl } from "./diagnostics.ts";
import { FnContext, type FnParseMode, FrontMatterParsingMode } from "./function.ts";
import { Parser, SeqSep, Trailing, token_descr } from "./mod.ts";
import { PathStyle } from "./path.ts";
import { exp, TokenType } from "./token_type.ts";
import * as gen from "./ty.gen.ts";
import { AllowCVariadic, AllowPlus, RecoverQPath, RecoverQuestionMark } from "./ty.gen.ts";

export * from "./ty.gen.ts";

const { TokenKind: TK } = token;

/// Signals whether parsing a type should recover `->`.
///
/// More specifically, when parsing a function like:
/// ```compile_fail
/// fn foo() => u8 { 0 }
/// fn bar(): u8 { 0 }
/// ```
/// The compiler will try to recover interpreting `foo() => u8` as `foo() -> u8` when calling
/// `parse_ty` with anything except `RecoverReturnSign::No`, and it will try to recover `bar(): u8`
/// as `bar() -> u8` when passing `RecoverReturnSign::Yes` to `parse_ty`
export type RecoverReturnSign = gen.RecoverReturnSign;
export const RecoverReturnSign = {
  ...gen.RecoverReturnSign,

  /// [RecoverReturnSign::Yes] allows for recovering `fn foo() => u8` and `fn foo(): u8`,
  /// [RecoverReturnSign::OnlyFatArrow] allows for recovering only `fn foo() => u8` (recovering
  /// colons can cause problems when parsing where clauses), and
  /// [RecoverReturnSign::No] doesn't allow for any recovery of the return type arrow
  // rustc: compiler/rustc_parse/src/parser/ty.rs:67 can_recover
  can_recover(self: RecoverReturnSign, token: TokenKind): boolean {
    switch (self) {
      case "Yes":
        return token.$ === "FatArrow" || token.$ === "Colon";
      case "OnlyFatArrow":
        return token.$ === "FatArrow";
      case "No":
        return false;
    }
  },
};

// Is `...` (`CVarArgs`) legal at this level of type parsing?
// (`AllowCVariadic` is generated.)

/// Determine if the given token can begin a bound assuming it follows Rust 2015 identifier `dyn`.
///
/// In Rust 2015, `dyn` is a contextual keyword, not a full one.
// rustc: compiler/rustc_parse/src/parser/ty.rs:86 can_begin_dyn_bound_in_rust_2015
function can_begin_dyn_bound_in_rust_2015(t: Token): boolean {
  // In `dyn::x`, `dyn<X>` and `dyn<<X>::Y>`, `dyn` should (continue to) denote a regular path
  // segment for backward compatibility. We make an exception for `dyn(X)` which used to be
  // interpreted as a path with parenthesized generic arguments which can be semantically
  // well-formed (consider: `use std::ops::Fn as dyn;`). Instead, we treat it as a trait
  // object type whose first bound is parenthesized.

  // Contrary to `Parser::can_begin_bound`, `!`, `const`, `[` and `async` are deliberately not
  // part of this list to contain the number of potential regressions esp. in MBE code.
  // `const` and `[` would regress UI test `macro-dyn-const-2015.rs` and
  // `!` would regress `dyn!(...)` macro calls in Rust 2015 for example.

  if (t.is_path_start()) {
    return !t.eq(TK.PathSep) && !t.eq(TK.Lt) && !t.eq(TK.Shl);
  }

  return t.eq(TK.OpenParen) || t.eq(TK.Question) || t.is_lifetime() || t.is_keyword(kw.For);
}

/// Parses a type.
// rustc: compiler/rustc_parse/src/parser/ty.rs:107 parse_ty
Parser.prototype.parse_ty = function (this: Parser): PResult<Ty> {
  if (this.token.eq(TK.DotDotDot)) {
    // We special case this so that we don't talk about "nested C-variadics" in types.
    // We still pass in `AllowCVariadic::No` so that `parse_ty_common` can complain about
    // things like `Vec<...>`.
    const span = this.token.span;
    this.bump();
    const kind: TyKind = { $: "Err", _0: this.dcx().emit_err(InvalidCVariadicType_diagnostic({ span })) };
    return Ok(this.mk_ty(span, kind));
  }
  return this.parse_ty_common(
    AllowPlus.Yes,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    undefined,
    RecoverQuestionMark.Yes,
  );
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:127 parse_ty_with_generics_recovery
Parser.prototype.parse_ty_with_generics_recovery = function (this: Parser, ty_params: Generics): PResult<Ty> {
  return this.parse_ty_common(
    AllowPlus.Yes,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    ty_params,
    RecoverQuestionMark.Yes,
  );
};

/// Parse a type suitable for a function or function pointer parameter.
/// The difference from `parse_ty` is that this version allows `...`
/// (`CVarArgs`) at the top level of the type.
// rustc: compiler/rustc_parse/src/parser/ty.rs:144 parse_ty_for_param
Parser.prototype.parse_ty_for_param = function (this: Parser): PResult<Ty> {
  const r = this.parse_ty_common(
    AllowPlus.Yes,
    AllowCVariadic.Yes,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    undefined,
    RecoverQuestionMark.Yes,
  );
  if (r.$ === "Err") return r;
  const ty = r._0;

  // Recover a trailing `= EXPR` if present.
  if (this.may_recover() && this.check_noexpect(TK.Eq) && this.look_ahead(1, (tok) => tok.can_begin_expr())) {
    const snapshot = this.create_snapshot_for_diagnostic();
    this.bump();
    const eq_span = this.prev_token.span;
    const r_e = this.parse_expr();
    if (r_e.$ === "Ok") {
      const e = r_e._0;
      this.dcx().struct_span_err(Span.to(eq_span, e.span), "parameter defaults are not supported").emit();
    } else {
      const diag = r_e._0;
      diag.cancel();
      this.restore_snapshot(snapshot);
    }
  }

  return Ok(ty);
};

/// Parses a type in restricted contexts where `+` is not permitted.
///
/// Example 1: `&'a TYPE`
///     `+` is prohibited to maintain operator priority (P(+) < P(&)).
/// Example 2: `value1 as TYPE + value2`
///     `+` is prohibited to avoid interactions with expression grammar.
// rustc: compiler/rustc_parse/src/parser/ty.rs:184 parse_ty_no_plus
Parser.prototype.parse_ty_no_plus = function (this: Parser): PResult<Ty> {
  return this.parse_ty_common(
    AllowPlus.No,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    undefined,
    RecoverQuestionMark.Yes,
  );
};

/// Parses a type following an `as` cast. Similar to `parse_ty_no_plus`, but signaling origin
/// for better diagnostics involving `?`.
// rustc: compiler/rustc_parse/src/parser/ty.rs:197 parse_as_cast_ty
Parser.prototype.parse_as_cast_ty = function (this: Parser): PResult<Ty> {
  return this.parse_ty_common(
    AllowPlus.No,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    undefined,
    RecoverQuestionMark.No,
  );
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:208 parse_ty_no_question_mark_recover
Parser.prototype.parse_ty_no_question_mark_recover = function (this: Parser): PResult<Ty> {
  return this.parse_ty_common(
    AllowPlus.Yes,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.Yes,
    undefined,
    RecoverQuestionMark.No,
  );
};

/// Parse a type without recovering `:` as `->` to avoid breaking code such
/// as `where fn() : for<'a>`.
// rustc: compiler/rustc_parse/src/parser/ty.rs:221 parse_ty_for_where_clause
Parser.prototype.parse_ty_for_where_clause = function (this: Parser): PResult<Ty> {
  return this.parse_ty_common(
    AllowPlus.Yes,
    AllowCVariadic.No,
    RecoverQPath.Yes,
    RecoverReturnSign.OnlyFatArrow,
    undefined,
    RecoverQuestionMark.Yes,
  );
};

/// Parses an optional return type `[ -> TY ]` in a function declaration.
// rustc: compiler/rustc_parse/src/parser/ty.rs:233 parse_ret_ty
Parser.prototype.parse_ret_ty = function (
  this: Parser,
  allow_plus: AllowPlus,
  recover_qpath: RecoverQPath,
  recover_return_sign: RecoverReturnSign,
): PResult<FnRetTy> {
  const lo = this.prev_token.span;
  if (this.eat(exp.RArrow)) {
    // FIXME(Centril): Can we unconditionally `allow_plus`?
    const r = this.parse_ty_common(
      allow_plus,
      AllowCVariadic.No,
      recover_qpath,
      recover_return_sign,
      undefined,
      RecoverQuestionMark.Yes,
    );
    if (r.$ === "Err") return r;
    return Ok({ $: "Ty", _0: r._0 });
  } else if (RecoverReturnSign.can_recover(recover_return_sign, this.token.kind)) {
    // Don't `eat` to prevent `=>` from being added as an expected token which isn't
    // actually expected and could only confuse users
    this.bump();
    this.dcx().emit_err(
      ReturnTypesUseThinArrow_diagnostic({
        span: this.prev_token.span,
        suggestion: Span.between(lo, this.token.span),
      }),
    );
    const r = this.parse_ty_common(
      allow_plus,
      AllowCVariadic.No,
      recover_qpath,
      recover_return_sign,
      undefined,
      RecoverQuestionMark.Yes,
    );
    if (r.$ === "Err") return r;
    return Ok({ $: "Ty", _0: r._0 });
  } else {
    return Ok({ $: "Default", _0: Span.shrink_to_hi(this.prev_token.span) });
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:273 parse_ty_common
Parser.prototype.parse_ty_common = function (
  this: Parser,
  allow_plus: AllowPlus,
  allow_c_variadic: AllowCVariadic,
  recover_qpath: RecoverQPath,
  recover_return_sign: RecoverReturnSign,
  ty_generics: Generics | undefined,
  recover_question_mark: RecoverQuestionMark,
): PResult<Ty> {
  const allow_qpath_recovery = recover_qpath === RecoverQPath.Yes;
  // maybe_recover_from_interpolated_ty_qpath!(self, allow_qpath_recovery);
  // PORT: the `macro_rules!` of parser/mod.rs:165, expanded in place.
  {
    let mv_kind: token.MetaVarKind | undefined;
    if (
      allow_qpath_recovery &&
      this.may_recover() &&
      (mv_kind = this.token.is_metavar_seq()) !== undefined &&
      mv_kind.$ === "Ty" &&
      this.check_noexpect_past_close_delim(TK.PathSep)
    ) {
      // Reparse the type, then move to recovery.
      const ty = this.eat_metavar_seq(mv_kind, (this_) => this_.parse_ty_no_question_mark_recover());
      if (ty === undefined) return unreachable("metavar seq ty");

      return this.maybe_recover_from_bad_qpath_stage_2(this.prev_token.span, ty, RecoverQPathImpl.Ty);
    }
  }

  const mv_ty = this.eat_metavar_seq_with_matcher(
    (mv_kind) => mv_kind.$ === "Ty",
    (this_) => this_.parse_ty_no_question_mark_recover(),
  );
  if (mv_ty !== undefined) {
    return Ok(mv_ty);
  }

  const r_attrs = this.recover_from_outer_attributes("types");
  if (r_attrs.$ === "Err") return r_attrs;

  const lo = this.token.span;
  const impl_dyn_multi = { value: false };
  let kind: TyKind;
  if (this.check(exp.OpenParen)) {
    const r = this.parse_paren_start_ty(lo, allow_plus);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat(exp.Bang)) {
    // Never type `!`
    kind = ast.TyKind.Never;
  } else if (this.eat(exp.Star)) {
    const r = this.parse_ty_ptr();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat(exp.OpenBracket)) {
    const r = this.parse_array_or_slice_ty();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.check(exp.And) || this.check(exp.AndAnd)) {
    // Reference
    const r_and = this.expect_and();
    if (r_and.$ === "Err") return r_and;
    const r = this.parse_borrowed_pointee();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat_keyword_noexpect(kw.Typeof)) {
    const r = this.parse_typeof_ty(lo);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.is_builtin()) {
    const r = this.parse_builtin_ty();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat_keyword(exp.Underscore)) {
    // A type to be inferred `_`
    kind = ast.TyKind.Infer;
  } else if (this.check_fn_front_matter(false, Case.Sensitive)) {
    // Function pointer type
    const r = this.parse_ty_fn_ptr(lo, [], undefined, recover_return_sign);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.check_keyword(exp.For)) {
    // Function pointer type or bound list (trait object type) starting with a poly-trait.
    //   `for<'lt> [unsafe] [extern "ABI"] fn (&'lt S) -> T`
    //   `for<'lt> Trait1<'lt> + Trait2 + 'a`
    const r_binder = this.parse_higher_ranked_binder();
    if (r_binder.$ === "Err") return r_binder;
    const [bound_vars] = r_binder._0;
    if (this.check_fn_front_matter(false, Case.Sensitive)) {
      const r = this.parse_ty_fn_ptr(lo, bound_vars, Span.shrink_to_lo(this.prev_token.span), recover_return_sign);
      if (r.$ === "Err") return r;
      kind = r._0;
    } else {
      // Try to recover `for<'a> dyn Trait` or `for<'a> impl Trait`.
      if (this.may_recover() && (this.token.is_keyword(kw.Impl) || this.can_begin_dyn_ty())) {
        this.bump();
        const [kw_] = unwrap(this.prev_token.ident());
        const removal_span = Span.with_hi(kw_.span, Span.lo(this.token.span));
        const r_path = this.parse_path(PathStyle.Type);
        if (r_path.$ === "Err") return r_path;
        const path = r_path._0;
        const bounds: GenericBound[] = [
          {
            $: "Trait",
            _0: ast.PolyTraitRef.new(
              bound_vars,
              path,
              ast.clone_TraitBoundModifiers(ast.TraitBoundModifiers.NONE),
              Span.to(lo, this.prev_token.span),
              ast.Parens.No,
            ),
          },
        ];
        if (allow_plus === AllowPlus.Yes && this.check_plus()) {
          this.eat_plus();
          const r = this.parse_generic_bounds();
          if (r.$ === "Err") return r;
          bounds.push(...r._0);
        }
        this.dcx().emit_err(
          diagnostics.TransposeDynOrImpl_diagnostic({
            span: kw_.span,
            kw: kw_.as_str(),
            sugg: {
              removal_span,
              insertion_span: Span.shrink_to_lo(lo),
              kw: kw_.as_str(),
            },
          }),
        );
        switch (kw_.name) {
          case kw.Dyn:
            kind = { $: "TraitObject", _0: bounds, _1: ast.TraitObjectSyntax.Dyn };
            break;
          case kw.Impl:
            kind = { $: "ImplTrait", _0: ast.DUMMY_NODE_ID, _1: bounds };
            break;
          default:
            return unreachable();
        }
      } else {
        const r_path = this.parse_path(PathStyle.Type);
        if (r_path.$ === "Err") return r_path;
        const path = r_path._0;
        const parse_plus = allow_plus === AllowPlus.Yes && this.check_plus();
        const r = this.finish_parsing_bare_trait_object_ty(bound_vars, path, lo, parse_plus, ast.Parens.No);
        if (r.$ === "Err") return r;
        kind = r._0;
      }
    }
  } else if (this.eat_keyword(exp.Impl)) {
    const r = this.parse_impl_ty(impl_dyn_multi);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.can_begin_dyn_ty()) {
    const r = this.parse_dyn_ty(impl_dyn_multi);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat_lt()) {
    // Qualified path
    const r = this.parse_qpath(PathStyle.Type);
    if (r.$ === "Err") return r;
    const [qself, path] = r._0;
    kind = { $: "Path", _0: qself, _1: path };
  } else if (
    (this.token.is_keyword(kw.Const) || this.token.is_keyword(kw.Mut)) &&
    this.look_ahead(1, (t) => t.eq(TK.Star))
  ) {
    const r = this.parse_ty_c_style_pointer();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.check_path()) {
    const r = this.parse_path_start_ty(lo, allow_plus, ty_generics);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.can_begin_bound()) {
    const r = this.parse_bare_trait_object_ty(lo, allow_plus);
    if (r.$ === "Err") return r;
    kind = r._0;
  } else if (this.eat(exp.DotDotDot)) {
    switch (allow_c_variadic) {
      case "Yes":
        kind = ast.TyKind.CVarArgs;
        break;
      case "No": {
        // FIXME(c_variadic): Should we just allow `...` syntactically
        // anywhere in a type and use semantic restrictions instead?
        // NOTE: This may regress certain MBE calls if done incorrectly.
        const guar = this.dcx().emit_err(NestedCVariadicType_diagnostic({ span: lo }));
        kind = { $: "Err", _0: guar };
        break;
      }
    }
  } else if (this.check_keyword(exp.Unsafe) && this.look_ahead(1, (tok) => tok.kind.$ === "Lt")) {
    const r = this.parse_unsafe_binder_ty();
    if (r.$ === "Err") return r;
    kind = r._0;
  } else {
    const msg = `expected type, found ${token_descr(this.token)}`;
    const err = this.dcx().struct_span_err(lo, msg);
    err.span_label(lo, "expected type");
    if (this.may_recover() && (this.eat_keyword_noexpect(kw.True) || this.eat_keyword_noexpect(kw.False))) {
      err.span_suggestion(this.prev_token.span, "the type is called", "bool", Applicability.MachineApplicable);
      err.emit();
      kind = { $: "Path", _0: undefined, _1: ast.Path.from_ident(Ident.new(sym.bool, this.prev_token.span)) };
    } else {
      return Err(err);
    }
  }

  const span = Span.to(lo, this.prev_token.span);
  let ty = this.mk_ty(span, kind);

  // Try to recover from use of `+` with incorrect priority.
  switch (allow_plus) {
    case "Yes": {
      const r = this.maybe_recover_from_bad_type_plus(ty);
      if (r.$ === "Err") return r;
      break;
    }
    case "No":
      this.maybe_report_ambiguous_plus(impl_dyn_multi.value, ty);
      break;
  }
  if (recover_question_mark === RecoverQuestionMark.Yes) {
    ty = this.maybe_recover_from_question_mark(ty);
  }
  if (allow_qpath_recovery) {
    return this.maybe_recover_from_bad_qpath(ty, RecoverQPathImpl.Ty);
  } else {
    return Ok(ty);
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:445 parse_unsafe_binder_ty
Parser.prototype.parse_unsafe_binder_ty = function (this: Parser): PResult<TyKind> {
  const lo = this.token.span;
  assert(this.eat_keyword(exp.Unsafe), "assertion failed: self.eat_keyword(exp!(Unsafe))");
  const r_lt = this.expect_lt();
  if (r_lt.$ === "Err") return r_lt;
  const r_params = this.parse_generic_params();
  if (r_params.$ === "Err") return r_params;
  const generic_params = r_params._0;
  const r_gt = this.expect_gt();
  if (r_gt.$ === "Err") return r_gt;
  const r_ty = this.parse_ty();
  if (r_ty.$ === "Err") return r_ty;
  const inner_ty = r_ty._0;
  const span = Span.to(lo, this.prev_token.span);
  this.psess.gated_spans.gate(sym.unsafe_binders, span);

  return Ok({ $: "UnsafeBinder", _0: { generic_params, inner_ty } });
};

/// Parse a type that begins with an opening parenthesis `(`.
///
/// More specifically, it parses one of the following:
///
/// 1. parenthesized type
/// 2. tuple type
/// 3. bare trait object type where the first trait bound is parenthesized
// rustc: compiler/rustc_parse/src/parser/ty.rs:465 parse_paren_start_ty
Parser.prototype.parse_paren_start_ty = function (this: Parser, lo: Span, allow_plus: AllowPlus): PResult<TyKind> {
  let inside_has_trailing_plus = false;
  const r = this.parse_paren_comma_seq((p) => {
    const r = p.parse_ty();
    if (r.$ === "Err") return r;
    const ty = r._0;
    inside_has_trailing_plus = p.prev_token.eq(TK.Plus);
    return Ok(ty);
  });
  if (r.$ === "Err") return r;
  const [ts, trailing_comma] = r._0;

  if (ts.length === 1 && trailing_comma === Trailing.No) {
    const ty = ts[0]!;

    // Let's check if we actually have a bare trait object type where the first trait bound
    // is parenthesized. That's the case if the parentheses are followed by a `+` and if
    // what's contained between the parentheses resembles a *BareTraitBound*.
    //
    // For context, looking at bounds in general (see *Bound*), only trait bounds are
    // allowed to be wrapped in parentheses, not however outlives and use bounds.
    const outside_has_eligible_trailing_plus = allow_plus === AllowPlus.Yes && this.token.is_like_plus();
    const kind = ty.kind;
    // `"(" TypePath ")" "+"`
    if (kind.$ === "Path" && kind._0 === undefined && outside_has_eligible_trailing_plus) {
      return this.finish_parsing_bare_trait_object_ty([], kind._1, lo, true, ast.Parens.Yes);
    }
    // `"(" BareTraitBound\TypePath ")" "+"`
    //
    // We actually accept outlives bounds here, too, purely to reduce diagnostic output
    // for ill-formed code like `('a)+`: We know for a fact that the `parse_ty` above
    // has already emitted an error for the inner `'a` as it's not followed by `+`.
    // This way we indirectly suppress unhelpful follow-up diagnostics like E0178
    // ("bad `+` in type") and E0224 ("no trait bound in trait object type").
    else if (
      kind.$ === "TraitObject" &&
      kind._1 === ast.TraitObjectSyntax.None &&
      outside_has_eligible_trailing_plus &&
      !inside_has_trailing_plus &&
      kind._0.length === 1 &&
      (kind._0[0]!.$ === "Trait" || kind._0[0]!.$ === "Outlives")
    ) {
      const bounds = kind._0;
      this.eat_plus();
      const r = this.parse_generic_bounds();
      if (r.$ === "Err") return r;
      bounds.push(...r._0);
      return Ok({ $: "TraitObject", _0: bounds, _1: ast.TraitObjectSyntax.None });
    } else {
      return Ok({ $: "Paren", _0: ty });
    }
  } else {
    return Ok({ $: "Tup", _0: ts });
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:518 parse_bare_trait_object_ty
Parser.prototype.parse_bare_trait_object_ty = function (this: Parser, lo: Span, allow_plus: AllowPlus): PResult<TyKind> {
  // A lifetime only begins a bare trait object type if it is followed by `+`!
  if (this.token.is_lifetime() && !this.look_ahead(1, (t) => t.is_like_plus())) {
    // In Rust 2021 and beyond, we assume that the user didn't intend to write a bare trait
    // object type with a leading lifetime bound since that seems very unlikely given the
    // fact that `dyn`-less trait objects are *semantically* invalid.
    if (Edition.at_least_rust_2021(this.psess.edition)) {
      const lt = this.expect_lifetime();
      const err = this.dcx().struct_span_err(lo, "expected type, found lifetime");
      err.span_label(lo, "expected type");
      const r = this.maybe_recover_ref_ty_no_leading_ampersand(lt, lo, err);
      if (r.$ === "Ok") {
        return Ok(r._0);
      } else {
        return Ok({ $: "Err", _0: r._0.emit_err() });
      }
    }

    this.dcx().emit_err(
      NeedPlusAfterTraitObjectLifetime_diagnostic({
        span: lo,
        suggestion: Span.shrink_to_hi(lo),
      }),
    );
  }
  const r = this.parse_generic_bounds_common(allow_plus);
  if (r.$ === "Err") return r;
  return Ok({ $: "TraitObject", _0: r._0, _1: ast.TraitObjectSyntax.None });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:549 parse_ref_ty_no_leading_ampersand
Parser.prototype.parse_ref_ty_no_leading_ampersand = function (this: Parser): [Mutability, Ty | undefined] {
  const mutbl = this.parse_mutability();
  const r = this.parse_ty_no_plus();
  if (r.$ === "Ok") {
    return [mutbl, r._0];
  } else {
    const err = r._0;
    err.cancel();
    return [mutbl, undefined];
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:560 maybe_recover_ref_ty_no_leading_ampersand
Parser.prototype.maybe_recover_ref_ty_no_leading_ampersand = function (
  this: Parser,
  lt: Lifetime,
  lo: Span,
  err: Diag,
): Result<TyKind, Diag> {
  if (!this.may_recover()) {
    return Err(err);
  }
  const snapshot = this.create_snapshot_for_diagnostic();
  const [mutbl, ty] = this.parse_ref_ty_no_leading_ampersand();
  if (ty === undefined) {
    this.restore_snapshot(snapshot);
    return Err(err);
  } else {
    err.span_suggestion_verbose(
      Span.shrink_to_lo(lo),
      "you might have meant to write a reference type here",
      "&",
      Applicability.MaybeIncorrect,
    );
    err.emit();
    return Ok({ $: "Ref", _0: lt, _1: ty, _2: mutbl });
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:588 finish_parsing_bare_trait_object_ty
Parser.prototype.finish_parsing_bare_trait_object_ty = function (
  this: Parser,
  generic_params: GenericParam[],
  path: Path,
  lo: Span,
  parse_plus: boolean,
  parens: Parens,
): PResult<TyKind> {
  const bounds: GenericBound[] = [
    {
      $: "Trait",
      _0: ast.PolyTraitRef.new(
        generic_params,
        path,
        ast.clone_TraitBoundModifiers(ast.TraitBoundModifiers.NONE),
        Span.to(lo, this.prev_token.span),
        parens,
      ),
    },
  ];
  if (parse_plus) {
    this.eat_plus();
    const r = this.parse_generic_bounds();
    if (r.$ === "Err") return r;
    bounds.push(...r._0);
  }
  return Ok({ $: "TraitObject", _0: bounds, _1: ast.TraitObjectSyntax.None });
};

/// Parses a raw pointer with a C-style typo
// rustc: compiler/rustc_parse/src/parser/ty.rs:611 parse_ty_c_style_pointer
Parser.prototype.parse_ty_c_style_pointer = function (this: Parser): PResult<TyKind> {
  const kw_span = this.token.span;
  const mutbl = this.parse_mut_or_const();

  if (mutbl !== undefined && this.eat(exp.Star)) {
    const star_span = this.prev_token.span;

    let mutability: string;
    switch (mutbl) {
      case "Not":
        mutability = "const";
        break;
      case "Mut":
        mutability = "mut";
        break;
    }

    const r = this.parse_ty_no_question_mark_recover();
    if (r.$ === "Err") return r;
    const ty = r._0;

    this.dcx()
      .struct_span_err(kw_span, `raw pointer types must be written as \`*${mutability} T\``)
      .with_multipart_suggestion(
        `put the \`*\` before \`${mutability}\``,
        [
          [star_span, ""],
          [Span.shrink_to_lo(kw_span), "*"],
        ],
        Applicability.MachineApplicable,
      )
      .emit();

    return Ok({ $: "Ptr", _0: ty, _1: mutbl });
  }
  // This is unreachable because we always get into if above and return from it
  return unreachable("this could never happen");
};

/// Parses a raw pointer type: `*[const | mut] $type`.
// rustc: compiler/rustc_parse/src/parser/ty.rs:646 parse_ty_ptr
Parser.prototype.parse_ty_ptr = function (this: Parser): PResult<TyKind> {
  let mutbl = this.parse_mut_or_const();
  if (mutbl === undefined) {
    const span = this.prev_token.span;
    this.dcx().emit_err(
      ExpectedMutOrConstInRawPointerType_diagnostic({
        span,
        after_asterisk: Span.shrink_to_hi(span),
      }),
    );
    mutbl = "Not";
  }
  const r = this.parse_ty_no_plus();
  if (r.$ === "Err") return r;
  return Ok({ $: "Ptr", _0: r._0, _1: mutbl });
};

/// Parses an array (`[TYPE; EXPR]`) or slice (`[TYPE]`) type.
/// The opening `[` bracket is already eaten.
// rustc: compiler/rustc_parse/src/parser/ty.rs:661 parse_array_or_slice_ty
Parser.prototype.parse_array_or_slice_ty = function (this: Parser): PResult<TyKind> {
  const r_elt = this.parse_ty();
  if (r_elt.$ === "Err") return r_elt;
  const elt_ty = r_elt._0;

  let ty: TyKind;
  if (this.eat(exp.Semi)) {
    const r_len = this.parse_expr_anon_const();
    if (r_len.$ === "Err") return r_len;
    const length = r_len._0;

    const r_close = this.expect(exp.CloseBracket);
    if (r_close.$ === "Err") {
      const e = r_close._0;
      // Try to recover from `X<Y, ...>` when `X::<Y, ...>` works
      const r = this.check_mistyped_turbofish_with_multiple_type_params(e, field_mut(length, "value"));
      if (r.$ === "Err") return r;
      const r2 = this.expect(exp.CloseBracket);
      if (r2.$ === "Err") return r2;
    }
    ty = { $: "Array", _0: elt_ty, _1: length };
  } else if (this.eat(exp.CloseBracket)) {
    ty = { $: "Slice", _0: elt_ty };
  } else {
    const r = this.maybe_recover_array_ty_without_semi(elt_ty);
    if (r.$ === "Err") return r;
    ty = r._0;
  }

  return Ok(ty);
};

/// Recover from malformed array type syntax.
///
/// This method attempts to recover from cases like:
/// - `[u8, 5]` → suggests using `;`, return a Array type
/// - `[u8 5]` → suggests using `;`, return a Array type
/// Consider to add more cases in the future.
// rustc: compiler/rustc_parse/src/parser/ty.rs:688 maybe_recover_array_ty_without_semi
Parser.prototype.maybe_recover_array_ty_without_semi = function (this: Parser, elt_ty: Ty): PResult<TyKind> {
  const span = this.token.span;
  const token_descr_ = token_descr(this.token);
  const err = this.dcx().struct_span_err(span, `expected \`;\` or \`]\`, found ${token_descr_}`);
  err.span_label(span, "expected `;` or `]`");

  // If we cannot recover, return the error immediately.
  if (!this.may_recover()) {
    return Err(err);
  }

  const snapshot = this.create_snapshot_for_diagnostic();

  // Consume common erroneous separators.
  const hi = Span.hi(this.prev_token.span);
  void (this.eat(exp.Comma) || this.eat(exp.Colon) || this.eat(exp.Star));
  const suggestion_span = Span.with_lo(this.prev_token.span, hi);

  // FIXME(mgca): recovery is broken for `const {` args
  // we first try to parse pattern like `[u8 5]`
  const r_len = this.parse_expr_anon_const();
  if (r_len.$ === "Err") {
    const e = r_len._0;
    e.cancel();
    this.restore_snapshot(snapshot);
    return Err(err);
  }
  const length = r_len._0;

  const r_close = this.expect(exp.CloseBracket);
  if (r_close.$ === "Err") {
    const e = r_close._0;
    e.cancel();
    this.restore_snapshot(snapshot);
    return Err(err);
  }

  err.span_suggestion_verbose(
    suggestion_span,
    "you might have meant to use `;` as the separator",
    ";",
    Applicability.MaybeIncorrect,
  );
  err.emit();
  return Ok({ $: "Array", _0: elt_ty, _1: length });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:734 parse_borrowed_pointee
Parser.prototype.parse_borrowed_pointee = function (this: Parser): PResult<TyKind> {
  const and_span = this.prev_token.span;
  let opt_lifetime = this.check_lifetime() ? this.expect_lifetime() : undefined;
  let [pinned, mutbl] = this.parse_pin_and_mut();
  if (this.token.is_lifetime() && mutbl === "Mut" && opt_lifetime === undefined) {
    // A lifetime is invalid here: it would be part of a bare trait bound, which requires
    // it to be followed by a plus, but we disallow plus in the pointee type.
    // So we can handle this case as an error here, and suggest `'a mut`.
    // If there *is* a plus next though, handling the error later provides better suggestions
    // (like adding parentheses)
    if (!this.look_ahead(1, (t) => t.is_like_plus())) {
      const lifetime_span = this.token.span;
      const span = Span.to(and_span, lifetime_span);

      let suggest_lifetime: Span | undefined;
      let snippet: string;
      const r = this.span_to_snippet(lifetime_span);
      if (r.$ === "Ok") {
        const lifetime_src = r._0;
        [suggest_lifetime, snippet] = [span, lifetime_src];
      } else {
        [suggest_lifetime, snippet] = [undefined, ""];
      }
      this.dcx().emit_err(LifetimeAfterMut_diagnostic({ span, suggest_lifetime, snippet }));

      opt_lifetime = this.expect_lifetime();
    }
  } else if (this.token.is_keyword(kw.Dyn) && mutbl === "Not" && this.look_ahead(1, (t) => t.is_keyword(kw.Mut))) {
    // We have `&dyn mut ...`, which is invalid and should be `&mut dyn ...`.
    const span = Span.to(
      and_span,
      this.look_ahead(1, (t) => t.span),
    );
    this.dcx().emit_err(DynAfterMut_diagnostic({ span }));

    // Recovery
    mutbl = "Mut";
    const [dyn_tok, dyn_tok_sp] = [this.token, this.token_spacing];
    this.bump();
    this.bump_with([dyn_tok, dyn_tok_sp]);
  }
  const r = this.parse_ty_no_plus();
  if (r.$ === "Err") return r;
  const ty = r._0;
  switch (pinned) {
    case "Not":
      return Ok({ $: "Ref", _0: opt_lifetime, _1: ty, _2: mutbl });
    case "Pinned":
      return Ok({ $: "PinnedRef", _0: opt_lifetime, _1: ty, _2: mutbl });
  }
};

/// Parse nothing, mutability or `pin` followed by "explicit" mutability.
///
/// ```ebnf
/// PinAndMut = "pin" MutOrConst | "mut"
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:784 parse_pin_and_mut
Parser.prototype.parse_pin_and_mut = function (this: Parser): [Pinnedness, Mutability] {
  if (this.token.is_keyword(kw.Pin) && this.look_ahead(1, (t) => t.is_mutability())) {
    this.psess.gated_spans.gate(sym.pin_ergonomics, this.token.span);
    assert(this.eat_keyword(exp.Pin), "assertion failed: self.eat_keyword(exp!(Pin))");
    const mutbl = unwrap(this.parse_mut_or_const());
    return ["Pinned", mutbl];
  } else {
    return ["Not", this.parse_mutability()];
  }
};

/// Parses the `typeof(EXPR)` for better diagnostics before returning
/// an error type.
// rustc: compiler/rustc_parse/src/parser/ty.rs:797 parse_typeof_ty
Parser.prototype.parse_typeof_ty = function (this: Parser, lo: Span): PResult<TyKind> {
  const r_open = this.expect(exp.OpenParen);
  if (r_open.$ === "Err") return r_open;
  const r_expr = this.parse_expr_anon_const();
  if (r_expr.$ === "Err") return r_expr;
  const r_close = this.expect(exp.CloseParen);
  if (r_close.$ === "Err") return r_close;
  const span = Span.to(lo, this.prev_token.span);
  const guar = this.dcx()
    .struct_span_err(span, "`typeof` is a reserved keyword but unimplemented")
    .with_note("consider replacing `typeof(...)` with an actual type")
    .with_code(E0516)
    .emit_err();
  return Ok({ $: "Err", _0: guar });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:811 parse_builtin_ty
Parser.prototype.parse_builtin_ty = function (this: Parser): PResult<TyKind> {
  return this.parse_builtin((this_, lo, ident): PResult<TyKind | undefined> => {
    switch (ident.name) {
      case sym.field_of: {
        const r = this_.parse_ty_field_of(lo);
        if (r.$ === "Err") return r;
        return Ok(r._0);
      }
      default:
        return Ok(undefined);
    }
  });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:820 parse_ty_field_of
Parser.prototype.parse_ty_field_of = function (this: Parser, _lo: Span): PResult<TyKind> {
  const r_container = this.parse_ty();
  if (r_container.$ === "Err") return r_container;
  const container = r_container._0;
  const r_comma = this.expect(exp.Comma);
  if (r_comma.$ === "Err") return r_comma;

  const r_fields = this.parse_floating_field_access();
  if (r_fields.$ === "Err") return r_fields;
  const fields = r_fields._0;
  const trailing_comma = this.eat_noexpect(TK.Comma);

  const r_close = this.expect_one_of([], [exp.CloseParen]);
  if (r_close.$ === "Err") {
    const e = r_close._0;
    if (trailing_comma) {
      e.note("unexpected third argument to field_of");
    } else {
      e.note("field_of expects dot-separated field and variant names");
    }
    e.emit();
  }

  // Eat tokens until the macro call ends.
  if (this.may_recover()) {
    while (!token.TokenKind.is_close_delim_or_eof(this.token.kind)) {
      this.bump();
    }
  }

  switch (fields.length) {
    case 0:
      return Err(
        this.dcx().struct_span_err(this.token.span, "`field_of!` expects dot-separated field and variant names"),
      );
    case 1:
      return Ok({ $: "FieldOf", _0: container, _1: undefined, _2: fields[0]! });
    case 2:
      return Ok({ $: "FieldOf", _0: container, _1: fields[0]!, _2: fields[1]! });
    default:
      return Err(
        this.dcx().struct_span_err(
          fields.map((f) => f.span),
          "`field_of!` only supports a single field or a variant with a field",
        ),
      );
  }
};

/// Parses a function pointer type (`TyKind::FnPtr`).
/// ```ignore (illustrative)
///    [unsafe] [extern "ABI"] fn (S) -> T
/// //  ^~~~~^          ^~~~^     ^~^    ^
/// //    |               |        |     |
/// //    |               |        |   Return type
/// // Function Style    ABI  Parameter types
/// ```
/// We actually parse `FnHeader FnDecl`, but we error on `const` and `async` qualifiers.
// rustc: compiler/rustc_parse/src/parser/ty.rs:866 parse_ty_fn_ptr
Parser.prototype.parse_ty_fn_ptr = function (
  this: Parser,
  lo: Span,
  params: GenericParam[],
  param_insertion_point: Span | undefined,
  recover_return_sign: RecoverReturnSign,
): PResult<TyKind> {
  const inherited_vis: ast.Visibility = {
    span: DUMMY_SP,
    kind: ast.VisibilityKind.Inherited,
  };
  const span_start = this.token.span;
  const r_header = this.parse_fn_front_matter(inherited_vis, Case.Sensitive, FrontMatterParsingMode.FunctionPtrType);
  if (r_header.$ === "Err") return r_header;
  const { ext, safety } = r_header._0;
  if (this.may_recover() && this.token.eq(TK.Lt)) {
    const r = this.recover_fn_ptr_with_generics(lo, params, param_insertion_point);
    if (r.$ === "Err") return r;
  }
  const mode: FnParseMode = {
    req_name: (_, __) => false,
    context: FnContext.FunctionPtrType,
    req_body: false,
  };
  const r_decl = this.parse_fn_decl(mode, AllowPlus.No, recover_return_sign);
  if (r_decl.$ === "Err") return r_decl;
  const decl = r_decl._0;

  const decl_span = Span.to(span_start, this.prev_token.span);
  return Ok({ $: "FnPtr", _0: new ast.FnPtrTy(safety, ext, params, decl, decl_span) });
};

/// Recover from function pointer types with a generic parameter list (e.g. `fn<'a>(&'a str)`).
// rustc: compiler/rustc_parse/src/parser/ty.rs:904 recover_fn_ptr_with_generics
Parser.prototype.recover_fn_ptr_with_generics = function (
  this: Parser,
  lo: Span,
  params: GenericParam[],
  param_insertion_point: Span | undefined,
): PResult<undefined> {
  const r = this.parse_generics();
  if (r.$ === "Err") return r;
  const generics = r._0;
  const arity = generics.params.length;

  const lifetimes: GenericParam[] = generics.params.filter((param) => param.kind.$ === "Lifetime");

  let sugg: FnPtrWithGenericsSugg | undefined;
  if (!(lifetimes.length === 0)) {
    const snippet = lifetimes.map((param) => param.ident.as_str()).join(", ");

    let left: Span;
    let snippet_: string;
    if (param_insertion_point !== undefined) {
      const span = param_insertion_point;
      [left, snippet_] = [span, params.length === 0 ? snippet : `, ${snippet}`];
    } else {
      [left, snippet_] = [Span.shrink_to_lo(lo), `for<${snippet}> `];
    }

    sugg = {
      left,
      snippet: snippet_,
      right: generics.span,
      arity,
      for_param_list_exists: param_insertion_point !== undefined,
    };
  } else {
    sugg = undefined;
  }

  this.dcx().emit_err(FnPtrWithGenerics_diagnostic({ span: generics.span, sugg }));
  params.push(...lifetimes);
  return Ok(undefined);
};

/// Parses an `impl B0 + ... + Bn` type.
// rustc: compiler/rustc_parse/src/parser/ty.rs:946 parse_impl_ty
Parser.prototype.parse_impl_ty = function (this: Parser, impl_dyn_multi: MutRef<boolean>): PResult<TyKind> {
  // If we encounter a type like `impl 'a Sized`, suggest `impl 'a + Sized`.
  if (this.token.is_lifetime()) {
    const ident = this.look_ahead(1, (t) => t.non_reserved_ident());
    if (ident !== undefined) {
      this.dcx().emit_err(
        diagnostics.MissingPlusBounds_diagnostic({
          span: this.token.span,
          hi: Span.shrink_to_hi(this.token.span),
          sym: ident.name,
        }),
      );
    }
  }

  // Always parse bounds greedily for better error recovery.
  const r = this.parse_generic_bounds();
  if (r.$ === "Err") return r;
  const bounds = r._0;

  impl_dyn_multi.value = bounds.length > 1 || this.prev_token.eq(TK.Plus);

  return Ok({ $: "ImplTrait", _0: ast.DUMMY_NODE_ID, _1: bounds });
};

/// Parse a use-bound aka precise capturing list.
///
/// ```ebnf
/// UseBound = "use" "<" (PreciseCapture ("," PreciseCapture)* ","?)? ">"
/// PreciseCapture = "Self" | Ident | Lifetime
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:972 parse_use_bound
Parser.prototype.parse_use_bound = function (this: Parser, lo: Span, parens: Parens): PResult<GenericBound> {
  const r_lt = this.expect_lt();
  if (r_lt.$ === "Err") return r_lt;
  const r = this.parse_seq_to_before_tokens(
    [exp.Gt],
    [TK.Ge, TK.Shr, TK.Shr],
    SeqSep.trailing_allowed(exp.Comma),
    (self_): PResult<PreciseCapturingArg> => {
      if (self_.check_keyword(exp.SelfUpper)) {
        self_.bump();
        return Ok({
          $: "Arg",
          _0: ast.Path.from_ident(unwrap(self_.prev_token.ident())[0]),
          _1: ast.DUMMY_NODE_ID,
        });
      } else if (self_.check_ident()) {
        const r = self_.parse_ident();
        if (r.$ === "Err") return r;
        return Ok({ $: "Arg", _0: ast.Path.from_ident(r._0), _1: ast.DUMMY_NODE_ID });
      } else if (self_.check_lifetime()) {
        return Ok({ $: "Lifetime", _0: self_.expect_lifetime() });
      } else {
        return self_.unexpected_any();
      }
    },
  );
  if (r.$ === "Err") return r;
  const [args] = r._0;
  const r_gt = this.expect_gt();
  if (r_gt.$ === "Err") return r_gt;

  if (parens === ast.Parens.Yes) {
    const r = this.expect(exp.CloseParen);
    if (r.$ === "Err") return r;
    this.report_parenthesized_bound(lo, this.prev_token.span, "precise capturing lists");
  }

  return Ok({ $: "Use", _0: args, _1: Span.to(lo, this.prev_token.span) });
};

/// Can the current token begin a `dyn`-prefixed trait object type?
// rustc: compiler/rustc_parse/src/parser/ty.rs:1008 can_begin_dyn_ty
Parser.prototype.can_begin_dyn_ty = function (this: Parser): boolean {
  return (
    this.token.is_keyword(kw.Dyn) &&
    (Span.at_least_rust_2018(this.token_uninterpolated_span()) ||
      this.look_ahead(1, (t) => can_begin_dyn_bound_in_rust_2015(t)))
  );
};

/// Parse a `dyn`-prefixed trait object type.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1015 parse_dyn_ty
Parser.prototype.parse_dyn_ty = function (this: Parser, impl_dyn_multi: MutRef<boolean>): PResult<TyKind> {
  this.bump(); // `dyn`

  // Always parse bounds greedily for better error recovery.
  const r = this.parse_generic_bounds();
  if (r.$ === "Err") return r;
  const bounds = r._0;
  impl_dyn_multi.value = bounds.length > 1 || this.prev_token.eq(TK.Plus);

  return Ok({ $: "TraitObject", _0: bounds, _1: ast.TraitObjectSyntax.Dyn });
};

/// Parse a type that begins with a path.
///
/// This can be:
/// 1. a type macro, `mac!(...)`,
/// 2. a bare trait object type, `B0 + ... + Bn`,
/// 3. or a path, `path::to::MyType`.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1031 parse_path_start_ty
Parser.prototype.parse_path_start_ty = function (
  this: Parser,
  lo: Span,
  allow_plus: AllowPlus,
  ty_generics: Generics | undefined,
): PResult<TyKind> {
  // Simple path
  const r_path = this.parse_path_inner(PathStyle.Type, ty_generics);
  if (r_path.$ === "Err") return r_path;
  const path = r_path._0;
  if (this.eat(exp.Bang)) {
    // Macro invocation in type position
    const r = this.parse_delim_args();
    if (r.$ === "Err") return r;
    return Ok({ $: "MacCall", _0: new ast.MacCall(path, r._0) });
  } else if (allow_plus === AllowPlus.Yes && this.check_plus()) {
    // `Trait1 + Trait2 + 'a`
    return this.finish_parsing_bare_trait_object_ty([], path, lo, true, ast.Parens.No);
  } else {
    // Just a type path.
    return Ok({ $: "Path", _0: undefined, _1: path });
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1057 parse_generic_bounds
Parser.prototype.parse_generic_bounds = function (this: Parser): PResult<GenericBounds> {
  return this.parse_generic_bounds_common(AllowPlus.Yes);
};

/// Parse generic bounds.
///
/// Only if `allow_plus` this parses a `+`-separated list of bounds (trailing `+` is admitted).
/// Otherwise, this only parses a single bound or none.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1065 parse_generic_bounds_common
Parser.prototype.parse_generic_bounds_common = function (this: Parser, allow_plus: AllowPlus): PResult<GenericBounds> {
  const bounds: GenericBound[] = [];

  // In addition to looping while we find generic bounds:
  // We continue even if we find a keyword. This is necessary for error recovery on,
  // for example, `impl fn()`. The only keyword that can go after generic bounds is
  // `where`, so stop if it's it.
  // We also continue if we find types (not traits), again for error recovery.
  while (
    this.can_begin_bound() ||
    (this.may_recover() &&
      (this.token.can_begin_type() || (this.token.is_reserved_ident() && !this.token.is_keyword(kw.Where))))
  ) {
    // Account for `&dyn Trait + dyn Other`.
    if (this.can_begin_dyn_ty()) {
      this.bump();
      this.dcx().emit_err(
        InvalidDynKeyword_diagnostic({
          span: this.prev_token.span,
          suggestion: Span.until(this.prev_token.span, this.token.span),
        }),
      );
    }
    const r = this.parse_generic_bound();
    if (r.$ === "Err") return r;
    bounds.push(r._0);
    if (allow_plus === AllowPlus.No || !this.eat_plus()) {
      break;
    }
  }

  return Ok(bounds);
};

/// Can the current token begin a bound?
// rustc: compiler/rustc_parse/src/parser/ty.rs:1096 can_begin_bound
Parser.prototype.can_begin_bound = function (this: Parser): boolean {
  // NOTE: Tokens `!`, `~`, `const` & `async` which represent the start of currently unstable
  //       trait bound modifiers are intentionally not included in `Token::can_begin_type` to
  //       avoid affecting stable macro matching behavior.

  return (
    this.check_path() ||
    this.check_lifetime() ||
    this.check(exp.Bang) ||
    this.check(exp.Question) ||
    this.check(exp.Tilde) ||
    this.check_keyword(exp.For) ||
    this.check(exp.OpenParen) ||
    this.can_begin_maybe_const_bound() ||
    this.check_keyword(exp.Const) ||
    this.check_keyword(exp.Async) ||
    this.check_keyword(exp.Use)
  );
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1114 can_begin_maybe_const_bound
Parser.prototype.can_begin_maybe_const_bound = function (this: Parser): boolean {
  return (
    this.check(exp.OpenBracket) &&
    this.look_ahead(1, (t) => t.is_keyword(kw.Const)) &&
    this.look_ahead(2, (t) => t.eq(TK.CloseBracket))
  );
};

/// Parse a bound.
///
/// ```ebnf
/// Bound = LifetimeBound | UseBound | TraitBound
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:1125 parse_generic_bound
Parser.prototype.parse_generic_bound = function (this: Parser): PResult<GenericBound> {
  const leading_token = this.prev_token;
  const lo = this.token.span;

  // We only admit parenthesized *trait* bounds. However, we want to gracefully recover from
  // other kinds of parenthesized bounds, so parse the opening parenthesis *here*.
  //
  // In the future we might want to lift this syntactic restriction and
  // introduce "`GenericBound::Paren(Box<GenericBound>)`".
  const parens: Parens = this.eat(exp.OpenParen) ? ast.Parens.Yes : ast.Parens.No;

  if (this.token.is_lifetime()) {
    return this.parse_lifetime_bound(lo, parens);
  } else if (this.eat_keyword(exp.Use)) {
    return this.parse_use_bound(lo, parens);
  } else {
    return this.parse_trait_bound(lo, parens, leading_token);
  }
};

/// Parse a lifetime-bound aka outlives-bound.
///
/// ```ebnf
/// LifetimeBound = Lifetime
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:1150 parse_lifetime_bound
Parser.prototype.parse_lifetime_bound = function (this: Parser, lo: Span, parens: Parens): PResult<GenericBound> {
  const lt = this.expect_lifetime();

  if (parens === ast.Parens.Yes) {
    const r = this.expect(exp.CloseParen);
    if (r.$ === "Err") return r;
    this.report_parenthesized_bound(lo, this.prev_token.span, "lifetime bounds");
  }

  return Ok({ $: "Outlives", _0: lt });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1161 report_parenthesized_bound
Parser.prototype.report_parenthesized_bound = function (this: Parser, lo: Span, hi: Span, kind: string): ErrorGuaranteed {
  const diag = this.dcx().struct_span_err(Span.to(lo, hi), `${kind} may not be parenthesized`);
  diag.multipart_suggestion(
    "remove the parentheses",
    [
      [lo, ""],
      [hi, ""],
    ],
    Applicability.MachineApplicable,
  );
  return diag.emit_err();
};

/// Emits an error if any trait bound modifiers were present.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1173 error_lt_bound_with_modifiers
Parser.prototype.error_lt_bound_with_modifiers = function (
  this: Parser,
  modifiers: TraitBoundModifiers,
  binder_span: Span | undefined,
): ErrorGuaranteed {
  const { constness, asyncness, polarity } = modifiers;

  switch (constness.$) {
    case "Never":
      break;
    case "Always":
    case "Maybe": {
      const span = constness._0;
      return this.dcx().emit_err(
        diagnostics.ModifierLifetime_diagnostic({
          span,
          modifier: ast.BoundConstness.as_str(constness),
        }),
      );
    }
  }

  switch (polarity.$) {
    case "Positive":
      break;
    case "Negative":
    case "Maybe": {
      const span = polarity._0;
      return this.dcx().emit_err(
        diagnostics.ModifierLifetime_diagnostic({ span, modifier: ast.BoundPolarity.as_str(polarity) }),
      );
    }
  }

  switch (asyncness.$) {
    case "Normal":
      break;
    case "Async": {
      const span = asyncness._0;
      return this.dcx().emit_err(
        diagnostics.ModifierLifetime_diagnostic({
          span,
          modifier: ast.BoundAsyncness.as_str(asyncness),
        }),
      );
    }
  }

  if (binder_span !== undefined) {
    const span = binder_span;
    return this.dcx().emit_err(diagnostics.ModifierLifetime_diagnostic({ span, modifier: "for<...>" }));
  }

  return unreachable("lifetime bound intercepted in `parse_generic_ty_bound` but no modifiers?");
};

/// Parses the modifiers that may precede a trait in a bound, e.g. `?Trait` or `[const] Trait`.
///
/// If no modifiers are present, this does not consume any tokens.
///
/// ```ebnf
/// Constness = ("const" | "[" "const" "]")?
/// Asyncness = "async"?
/// Polarity = ("?" | "!")?
/// ```
///
/// See `parse_trait_bound` for more context.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1229 parse_trait_bound_modifiers
Parser.prototype.parse_trait_bound_modifiers = function (this: Parser): PResult<TraitBoundModifiers> {
  const modifier_lo = this.token.span;
  const r_constness = this.parse_bound_constness();
  if (r_constness.$ === "Err") return r_constness;
  const constness = r_constness._0;

  let asyncness: BoundAsyncness;
  if (Span.at_least_rust_2018(this.token_uninterpolated_span()) && this.eat_keyword(exp.Async)) {
    this.psess.gated_spans.gate(sym.async_trait_bounds, this.prev_token.span);
    asyncness = { $: "Async", _0: this.prev_token.span };
  } else if (
    this.may_recover() &&
    Span.is_rust_2015(this.token_uninterpolated_span()) &&
    this.is_kw_followed_by_ident(kw.Async)
  ) {
    this.bump(); // eat `async`
    this.dcx().emit_err(
      diagnostics.AsyncBoundModifierIn2015_diagnostic({
        span: this.prev_token.span,
        help: HelpUseLatestEdition.new(),
      }),
    );
    this.psess.gated_spans.gate(sym.async_trait_bounds, this.prev_token.span);
    asyncness = { $: "Async", _0: this.prev_token.span };
  } else {
    asyncness = ast.BoundAsyncness.Normal;
  }
  const modifier_hi = this.prev_token.span;

  let polarity: BoundPolarity;
  if (this.eat(exp.Question)) {
    polarity = { $: "Maybe", _0: this.prev_token.span };
  } else if (this.eat(exp.Bang)) {
    this.psess.gated_spans.gate(sym.negative_bounds, this.prev_token.span);
    polarity = { $: "Negative", _0: this.prev_token.span };
  } else {
    polarity = ast.BoundPolarity.Positive;
  }

  // Enforce the mutual-exclusivity of `const`/`async` and `?`/`!`.
  switch (polarity.$) {
    case "Positive":
      // All trait bound modifiers allowed to combine with positive polarity
      break;
    case "Maybe":
    case "Negative": {
      const polarity_span = polarity._0;
      if (asyncness.$ === "Normal" && constness.$ === "Never") {
        // Ok, no modifiers.
      } else {
        const constness_ = ast.BoundConstness.as_str(constness);
        const asyncness_ = ast.BoundAsyncness.as_str(asyncness);
        const glue = !(constness_.length === 0) && !(asyncness_.length === 0) ? " " : "";
        const modifiers_concatenated = `${constness_}${glue}${asyncness_}`;
        this.dcx().emit_err(
          diagnostics.PolarityAndModifiers_diagnostic({
            polarity_span,
            polarity: ast.BoundPolarity.as_str(polarity),
            modifiers_span: Span.to(modifier_lo, modifier_hi),
            modifiers_concatenated,
          }),
        );
      }
      break;
    }
  }

  return Ok({ constness, asyncness, polarity });
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1293 parse_bound_constness
Parser.prototype.parse_bound_constness = function (this: Parser): PResult<BoundConstness> {
  // FIXME(const_trait_impl): remove `~const` parser support once bootstrap has the new syntax
  // in rustfmt
  if (this.eat(exp.Tilde)) {
    const tilde = this.prev_token.span;
    const r = this.expect_keyword(exp.Const);
    if (r.$ === "Err") return r;
    const span = Span.to(tilde, this.prev_token.span);
    this.psess.gated_spans.gate(sym.const_trait_impl, span);
    return Ok({ $: "Maybe", _0: span });
  } else if (this.can_begin_maybe_const_bound()) {
    const start = this.token.span;
    this.bump();
    unwrap_result(this.expect_keyword(exp.Const), debug_Diag);
    this.bump();
    const span = Span.to(start, this.prev_token.span);
    this.psess.gated_spans.gate(sym.const_trait_impl, span);
    return Ok({ $: "Maybe", _0: span });
  } else if (this.eat_keyword(exp.Const)) {
    this.psess.gated_spans.gate(sym.const_trait_impl, this.prev_token.span);
    return Ok({ $: "Always", _0: this.prev_token.span });
  } else {
    return Ok(ast.BoundConstness.Never);
  }
};

/// Parse a trait bound.
///
/// ```ebnf
/// TraitBound = BareTraitBound | "(" BareTraitBound ")"
/// BareTraitBound =
///     (HigherRankedBinder Constness Asyncness | Polarity)
///     TypePath
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:1326 parse_trait_bound
Parser.prototype.parse_trait_bound = function (
  this: Parser,
  lo: Span,
  parens: Parens,
  leading_token: Token,
): PResult<GenericBound> {
  const r_binder = this.parse_higher_ranked_binder();
  if (r_binder.$ === "Err") return r_binder;
  const [bound_vars, binder_span] = r_binder._0;

  const modifiers_lo = this.token.span;
  const r_mods = this.parse_trait_bound_modifiers();
  if (r_mods.$ === "Err") return r_mods;
  const modifiers = r_mods._0;
  const modifiers_span = Span.to(modifiers_lo, this.prev_token.span);

  if (binder_span !== undefined) {
    switch (modifiers.polarity.$) {
      case "Negative":
      case "Maybe": {
        const polarity_span = modifiers.polarity._0;
        this.dcx().emit_err(
          diagnostics.BinderAndPolarity_diagnostic({
            binder_span,
            polarity_span,
            polarity: ast.BoundPolarity.as_str(modifiers.polarity),
          }),
        );
        break;
      }
      case "Positive":
        break;
    }
  }

  // Recover erroneous lifetime bound with modifiers or binder.
  // e.g. `T: for<'a> 'a` or `T: [const] 'a`.
  if (this.token.is_lifetime()) {
    const _: ErrorGuaranteed = this.error_lt_bound_with_modifiers(modifiers, binder_span);
    return this.parse_lifetime_bound(lo, parens);
  }

  const r_more = this.parse_higher_ranked_binder();
  if (r_more.$ === "Err") return r_more;
  {
    const [more_bound_vars, binder_span] = r_more._0;
    if (binder_span !== undefined) {
      bound_vars.push(...more_bound_vars);
      this.dcx().emit_err(diagnostics.BinderBeforeModifiers_diagnostic({ binder_span, modifiers_span }));
    }
  }

  let path: Path;
  let recovered_from_fn: Path | undefined;
  if (
    this.token.is_keyword(kw.Fn) &&
    this.look_ahead(1, (t) => t.eq(TK.OpenParen)) &&
    (recovered_from_fn = this.recover_path_from_fn()) !== undefined
  ) {
    path = recovered_from_fn;
  } else if (!this.token.is_path_start() && this.token.can_begin_type()) {
    const r_ty = this.parse_ty_no_plus();
    if (r_ty.$ === "Err") return r_ty;
    const ty = r_ty._0;
    // Instead of finding a path (a trait), we found a type.
    const err = this.dcx().struct_span_err(ty.span, "expected a trait, found type");

    // If we can recover, try to extract a path from the type. Note
    // that we do not use the try operator when parsing the type because
    // if it fails then we get a parser error which we don't want (we're trying
    // to recover from errors, not make more).
    let path_: Path;
    if (this.may_recover()) {
      let span: Span;
      let message: string;
      let sugg: string;
      let p: Path;
      let applicability: Applicability;
      const kind = ty.kind;
      const peeled = ty.peel_refs().kind;
      if ((kind.$ === "Ptr" || kind.$ === "Ref") && peeled.$ === "Path") {
        const path = peeled._1;
        [span, message, sugg, p, applicability] = [
          Span.until(ty.span, path.span),
          "consider removing the indirection",
          "",
          path,
          Applicability.MaybeIncorrect,
        ];
      } else if (kind.$ === "ImplTrait" && kind._1.length >= 1 && kind._1[0]!.$ === "Trait") {
        const tr = kind._1[0]._0;
        [span, message, sugg, p, applicability] = [
          Span.until(ty.span, tr.span),
          "use the trait bounds directly",
          "",
          tr.trait_ref.path,
          Applicability.MachineApplicable,
        ];
      } else {
        return Err(err);
      }

      err.span_suggestion_verbose(span, message, sugg, applicability);

      path_ = ast.clone_Path(p);
    } else {
      return Err(err);
    }

    err.emit();

    path = path_;
  } else {
    const r = this.parse_path(PathStyle.Type);
    if (r.$ === "Err") return r;
    path = r._0;
  }

  if (this.may_recover() && this.token.eq(TK.OpenParen)) {
    const r = this.recover_fn_trait_with_lifetime_params(path, bound_vars);
    if (r.$ === "Err") return r;
  }

  if (parens === ast.Parens.Yes) {
    // Someone has written something like `&dyn (Trait + Other)`. The correct code
    // would be `&(dyn Trait + Other)`
    if (this.token.is_like_plus() && leading_token.is_keyword(kw.Dyn)) {
      this.eat_plus();
      const r = this.parse_generic_bounds();
      if (r.$ === "Err") return r;
      const r2 = this.expect(exp.CloseParen);
      if (r2.$ === "Err") return r2;

      this.dcx().emit_err(
        diagnostics.IncorrectParensTraitBounds_diagnostic({
          span: [lo, this.prev_token.span],
          sugg: {
            wrong_span: Span.to(Span.shrink_to_hi(leading_token.span), lo),
            new_span: Span.shrink_to_lo(leading_token.span),
          },
        }),
      );
    } else {
      const r = this.expect(exp.CloseParen);
      if (r.$ === "Err") return r;
    }
  }

  const poly_trait = ast.PolyTraitRef.new(bound_vars, path, modifiers, Span.to(lo, this.prev_token.span), parens);
  return Ok({ $: "Trait", _0: poly_trait });
};

// recovers a `Fn(..)` parenthesized-style path from `fn(..)`
// rustc: compiler/rustc_parse/src/parser/ty.rs:1448 recover_path_from_fn
Parser.prototype.recover_path_from_fn = function (this: Parser): Path | undefined {
  const fn_token_span = this.token.span;
  this.bump();
  const args_lo = this.token.span;
  const snapshot = this.create_snapshot_for_diagnostic();
  const mode: FnParseMode = { req_name: (_, __) => false, context: FnContext.Free, req_body: false };
  const r = this.parse_fn_decl(mode, AllowPlus.No, RecoverReturnSign.OnlyFatArrow);
  if (r.$ === "Ok") {
    const decl = r._0;
    this.dcx().emit_err(ExpectedFnPathFoundFnKeyword_diagnostic({ fn_token_span }));
    const span = Span.to(fn_token_span, this.prev_token.span);
    return new ast.Path(span, [
      new ast.PathSegment(
        Ident.new(sym.Fn, fn_token_span),
        ast.DUMMY_NODE_ID,
        ast.GenericArgs.from_ParenthesizedArgs(
          new ast.ParenthesizedArgs(
            Span.to(args_lo, this.prev_token.span),
            decl.inputs.map((a: Param) => ast.clone_Param(a)),
            Span.until(args_lo, ast.FnRetTy.span(decl.output)),
            ast.clone_FnRetTy(decl.output),
          ),
        ),
      ),
    ]);
  } else {
    const diag = r._0;
    diag.cancel();
    this.restore_snapshot(snapshot);
    return undefined;
  }
};

/// Parse an optional higher-ranked binder.
///
/// ```ebnf
/// HigherRankedBinder = ("for" "<" GenericParams ">")?
/// ```
// rustc: compiler/rustc_parse/src/parser/ty.rs:1487 parse_higher_ranked_binder
Parser.prototype.parse_higher_ranked_binder = function (this: Parser): PResult<[GenericParam[], Span | undefined]> {
  if (this.eat_keyword(exp.For)) {
    const lo = this.token.span;
    const r_lt = this.expect_lt();
    if (r_lt.$ === "Err") return r_lt;
    const r = this.parse_generic_params();
    if (r.$ === "Err") return r;
    const params = r._0;
    const r_gt = this.expect_gt();
    if (r_gt.$ === "Err") return r_gt;
    // We rely on AST validation to rule out invalid cases: There must not be
    // type or const parameters, and parameters must not have bounds.
    return Ok([params, Span.to(lo, this.prev_token.span)]);
  } else {
    return Ok([[], undefined]);
  }
};

/// Recover from `Fn`-family traits (Fn, FnMut, FnOnce) with lifetime arguments
/// (e.g. `FnOnce<'a>(&'a str) -> bool`). Up to generic arguments have already
/// been eaten.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1506 recover_fn_trait_with_lifetime_params
Parser.prototype.recover_fn_trait_with_lifetime_params = function (
  this: Parser,
  fn_path: Path,
  lifetime_defs: GenericParam[],
): PResult<undefined> {
  const fn_path_segment_idx = fn_path.segments.length - 1;
  const fn_path_segment = unwrap(fn_path.segments[fn_path_segment_idx]);
  let generic_args: ast.GenericArgs;
  if (fn_path_segment.args !== undefined) {
    const p_args = fn_path_segment.args;
    generic_args = ast.clone_GenericArgs(p_args);
  } else {
    // Normally it wouldn't come here because the upstream should have parsed
    // generic parameters (otherwise it's impossible to call this function).
    return Ok(undefined);
  }
  let lifetimes: Lifetime[];
  if (generic_args.$ === "AngleBracketed") {
    const args = generic_args._0.args;
    lifetimes = [];
    for (const arg of args) {
      if (arg.$ === "Arg" && arg._0.$ === "Lifetime") {
        lifetimes.push(arg._0._0);
      }
    }
  } else {
    lifetimes = [];
  }
  // Only try to recover if the trait has lifetime params.
  if (lifetimes.length === 0) {
    return Ok(undefined);
  }

  // The snapshot is only relevant if we're parsing the generics of an `fn` to avoid
  // incorrect recovery.
  const snapshot = this.parsing_generics ? this.create_snapshot_for_diagnostic() : undefined;
  // Parse `(T, U) -> R`.
  const inputs_lo = this.token.span;
  const mode: FnParseMode = { req_name: (_, __) => false, context: FnContext.Free, req_body: false };
  let inputs: Param[];
  const r_inputs = this.parse_fn_params(mode);
  if (r_inputs.$ === "Ok") {
    inputs = r_inputs._0;
  } else {
    const err = r_inputs._0;
    if (snapshot !== undefined) {
      this.restore_snapshot(snapshot);
      err.cancel();
      return Ok(undefined);
    } else {
      return Err(err);
    }
  }
  const inputs_span = Span.to(inputs_lo, this.prev_token.span);
  let output: FnRetTy;
  const r_output = this.parse_ret_ty(AllowPlus.No, RecoverQPath.No, RecoverReturnSign.No);
  if (r_output.$ === "Ok") {
    output = r_output._0;
  } else {
    const err = r_output._0;
    if (snapshot !== undefined) {
      this.restore_snapshot(snapshot);
      err.cancel();
      return Ok(undefined);
    } else {
      return Err(err);
    }
  }
  const args = ast.GenericArgs.from_ParenthesizedArgs(
    new ast.ParenthesizedArgs(Span.to(fn_path_segment.span(), this.prev_token.span), inputs, inputs_span, output),
  );

  if (snapshot !== undefined && !(["Comma", "Gt", "Plus"] as string[]).includes(this.token.kind.$)) {
    // We would expect another bound or the end of type params by now. Most likely we've
    // encountered a `(` *not* representing `Trait()`, but rather the start of the `fn`'s
    // argument list where the generic param list wasn't properly closed.
    this.restore_snapshot(snapshot);
    return Ok(undefined);
  }

  fn_path.segments[fn_path_segment_idx] = new ast.PathSegment(fn_path_segment.ident, ast.DUMMY_NODE_ID, args);

  // Convert parsed `<'a>` in `Fn<'a>` into `for<'a>`.
  const generic_params: GenericParam[] = lifetimes.map(
    (lt) => new ast.GenericParam(lt.id, lt.ident, [], [], false, ast.GenericParamKind.Lifetime, undefined),
  );
  lifetime_defs.push(...generic_params);

  const generic_args_span = ast.GenericArgs.span(generic_args);
  const snippet = `for<${lifetimes.map((lt) => lt.ident.as_str()).join(", ")}> `;
  const before_fn_path = Span.shrink_to_lo(fn_path.span);
  this.dcx()
    .struct_span_err(generic_args_span, "`Fn` traits cannot take lifetime parameters")
    .with_multipart_suggestion(
      "consider using a higher-ranked trait bound instead",
      [
        [generic_args_span, ""],
        [before_fn_path, snippet],
      ],
      Applicability.MaybeIncorrect,
    )
    .emit();
  return Ok(undefined);
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1635 check_lifetime
Parser.prototype.check_lifetime = function (this: Parser): boolean {
  this.expected_token_types.insert(TokenType.Lifetime);
  return this.token.is_lifetime();
};

/// Parses a single lifetime `'a` or panics.
// rustc: compiler/rustc_parse/src/parser/ty.rs:1641 expect_lifetime
Parser.prototype.expect_lifetime = function (this: Parser): Lifetime {
  const lt = this.token.lifetime();
  if (lt !== undefined) {
    const [ident, kind] = lt;
    if (kind === token.IdentKind.Normal && ident.without_first_quote().is_reserved_lifetime()) {
      this.dcx().emit_err(diagnostics.KeywordLifetime_diagnostic({ span: ident.span }));
    }

    this.bump();
    return { ident, id: ast.DUMMY_NODE_ID };
  } else {
    return this.dcx().span_bug(this.token.span, "not a lifetime");
  }
};

// rustc: compiler/rustc_parse/src/parser/ty.rs:1654 mk_ty
Parser.prototype.mk_ty = function (this: Parser, span: Span, kind: TyKind): Ty {
  return new ast.Ty(ast.DUMMY_NODE_ID, kind, span);
};
