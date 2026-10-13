// Port of compiler/rustc_parse/src/parser/generics.rs
// Types (`PredicateKindOrStructBody`) are generated into generics.gen.ts.
// Init order: see parser/mod.ts (top-level code touches only `Parser`, generics.gen.ts and
// non-parser modules; other extension modules are used inside function bodies only).
import { ast, HasAttrs, HasTokens, token } from "../../rustc_ast/lib.ts";
import type {
  AttrVec,
  Expr,
  FieldDef,
  FnContract,
  GenericBound,
  GenericBounds,
  GenericParam,
  Generics,
  Stmt,
  Ty,
  WhereBoundPredicate,
  WhereClause,
  WherePredicate,
  WherePredicateKind,
} from "../../rustc_ast/lib.ts";
import type { Diag, PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { type Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { Err, Ok } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import {
  MultipleWhereClauses_diagnostic,
  UnexpectedDefaultValueForLifetimeInGenericParameters_diagnostic,
  UnexpectedSelfInGenericParameters_diagnostic,
  WhereClauseBeforeTupleStructBody_diagnostic,
  type WhereClauseBeforeTupleStructBodySugg,
} from "../diagnostics.ts";
import { UsePreAttrPos } from "./attr_wrapper.ts";
import type { SnapshotParser } from "./diagnostics.ts";
import type { PredicateKindOrStructBody } from "./generics.gen.ts";
import { ForceCollect, Parser, Trailing } from "./mod.ts";
import { exp } from "./token_type.ts";

export * from "./generics.gen.ts";

const { TokenKind: TK } = token;

/// Parses bounds of a lifetime parameter `BOUND + BOUND + BOUND`, possibly with trailing `+`.
///
/// ```text
/// BOUND = LT_BOUND (e.g., `'a`)
/// ```
// rustc: compiler/rustc_parse/src/parser/generics.rs:28 parse_lt_param_bounds
Parser.prototype.parse_lt_param_bounds = function (this: Parser): GenericBounds {
  const lifetimes: GenericBound[] = [];
  while (this.check_lifetime()) {
    lifetimes.push({ $: "Outlives", _0: this.expect_lifetime() });

    if (!this.eat_plus()) {
      break;
    }
  }
  return lifetimes;
};

// PORT: `str::to_ascii_lowercase` (only ASCII letters change); no std helper yet.
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

/// Matches `typaram = IDENT (`?` unbound)? optbounds ( EQ ty )?`.
// rustc: compiler/rustc_parse/src/parser/generics.rs:41 parse_ty_param
Parser.prototype.parse_ty_param = function (this: Parser, preceding_attrs: AttrVec): PResult<GenericParam> {
  const r_ident = this.parse_ident();
  if (r_ident.$ === "Err") return r_ident;
  const ident = r_ident._0;

  // We might have a typo'd `Const` that was parsed as a type parameter.
  if (
    this.may_recover() &&
    to_ascii_lowercase(ident.as_str()) === Symbol.as_str(kw.Const) &&
    this.check_ident()
    // `Const` followed by IDENT
  ) {
    return this.recover_const_param_with_mistyped_const(preceding_attrs, ident);
  }

  // Parse optional colon and param bounds.
  let colon_span: Span | undefined = undefined;
  let bounds: GenericBounds;
  if (this.eat(exp.Colon)) {
    colon_span = this.prev_token.span;
    // recover from `impl Trait` in type param bound
    if (this.token.is_keyword(kw.Impl)) {
      const impl_span = this.token.span;
      const snapshot = this.create_snapshot_for_diagnostic();
      const r = this.parse_ty();
      if (r.$ === "Ok") {
        const p = r._0;
        if (p.kind.$ === "ImplTrait") {
          const bounds = p.kind._1;
          const span = Span.to(impl_span, Span.shrink_to_lo(this.token.span));
          const err = this.dcx().struct_span_err(span, "expected trait bound, found `impl Trait` type");
          err.span_label(span, "not a trait");
          if (bounds.length >= 1) {
            const bound = bounds[0]!;
            err.span_suggestion_verbose(
              Span.until(impl_span, ast.GenericBound.span(bound)),
              "use the trait bounds directly",
              "",
              Applicability.MachineApplicable,
            );
          }
          return Err(err);
        }
      } else {
        const err = r._0;
        err.cancel();
      }
      this.restore_snapshot(snapshot);
    }
    const r = this.parse_generic_bounds();
    if (r.$ === "Err") return r;
    bounds = r._0;
  } else {
    bounds = [];
  }

  let default_: Ty | undefined;
  if (this.eat(exp.Eq)) {
    const r = this.parse_ty();
    if (r.$ === "Err") return r;
    default_ = r._0;
  } else {
    default_ = undefined;
  }
  return Ok(
    new ast.GenericParam(
      ast.DUMMY_NODE_ID,
      ident,
      preceding_attrs,
      bounds,
      false,
      { $: "Type", default: default_ },
      colon_span,
    ),
  );
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:104 parse_const_param
Parser.prototype.parse_const_param = function (this: Parser, preceding_attrs: AttrVec): PResult<GenericParam> {
  const const_span = this.token.span;

  const r_kw = this.expect_keyword(exp.Const);
  if (r_kw.$ === "Err") return r_kw;
  const r_ident = this.parse_ident();
  if (r_ident.$ === "Err") return r_ident;
  const ident = r_ident._0;
  const r_colon = this.expect(exp.Colon);
  if (r_colon.$ === "Err") {
    const err = r_colon._0;
    if (this.token.kind.$ === "Comma" || this.token.kind.$ === "Gt") {
      // Recover parse from `<const N>` where the type is missing.
      const span = Span.to(const_span, ident.span);
      err.span_suggestion_verbose(
        Span.shrink_to_hi(ident.span),
        "you likely meant to write the type of the const parameter here",
        ": /* Type */",
        Applicability.HasPlaceholders,
      );
      const kind: ast.TyKind = { $: "Err", _0: err.emit_err() };
      const ty = this.mk_ty(span, kind);
      return Ok(
        new ast.GenericParam(
          ast.DUMMY_NODE_ID,
          ident,
          preceding_attrs,
          [],
          false,
          { $: "Const", ty, span, default: undefined },
          undefined,
        ),
      );
    } else {
      return Err(err);
    }
  }
  const r_ty = this.parse_ty();
  if (r_ty.$ === "Err") return r_ty;
  const ty = r_ty._0;

  // Parse optional const generics default value.
  let default_: ast.AnonConst | undefined;
  if (this.eat(exp.Eq)) {
    const r = this.parse_const_arg();
    if (r.$ === "Err") return r;
    default_ = r._0;
  } else {
    default_ = undefined;
  }
  const span = default_ !== undefined ? Span.to(const_span, default_.value.span) : Span.to(const_span, ty.span);

  return Ok(
    new ast.GenericParam(
      ast.DUMMY_NODE_ID,
      ident,
      preceding_attrs,
      [],
      false,
      { $: "Const", ty, span, default: default_ },
      undefined,
    ),
  );
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:158 recover_const_param_with_mistyped_const
Parser.prototype.recover_const_param_with_mistyped_const = function (
  this: Parser,
  preceding_attrs: AttrVec,
  mistyped_const_ident: Ident,
): PResult<GenericParam> {
  const r_ident = this.parse_ident();
  if (r_ident.$ === "Err") return r_ident;
  const ident = r_ident._0;
  const r_colon = this.expect(exp.Colon);
  if (r_colon.$ === "Err") return r_colon;
  const r_ty = this.parse_ty();
  if (r_ty.$ === "Err") return r_ty;
  const ty = r_ty._0;

  // Parse optional const generics default value.
  let default_: ast.AnonConst | undefined;
  if (this.eat(exp.Eq)) {
    const r = this.parse_const_arg();
    if (r.$ === "Err") return r;
    default_ = r._0;
  } else {
    default_ = undefined;
  }
  const span =
    default_ !== undefined
      ? Span.to(mistyped_const_ident.span, default_.value.span)
      : Span.to(mistyped_const_ident.span, ty.span);

  this.dcx()
    .struct_span_err(
      mistyped_const_ident.span,
      `\`const\` keyword was mistyped as \`${mistyped_const_ident.as_str()}\``,
    )
    .with_span_suggestion_verbose(
      mistyped_const_ident.span,
      "use the `const` keyword",
      Symbol.as_str(kw.Const),
      Applicability.MachineApplicable,
    )
    .emit();

  return Ok(
    new ast.GenericParam(
      ast.DUMMY_NODE_ID,
      ident,
      preceding_attrs,
      [],
      false,
      { $: "Const", ty, span, default: default_ },
      undefined,
    ),
  );
};

/// Parse a (possibly empty) list of generic (lifetime, type, const) parameters.
///
/// ```ebnf
/// GenericParams = (GenericParam ("," GenericParam)* ","?)?
/// ```
// rustc: compiler/rustc_parse/src/parser/generics.rs:204 parse_generic_params
Parser.prototype.parse_generic_params = function (this: Parser): PResult<GenericParam[]> {
  const params: GenericParam[] = [];
  let done = false;
  const prev = this.parsing_generics;
  this.parsing_generics = true;
  while (!done) {
    const r_attrs = this.parse_outer_attributes();
    if (r_attrs.$ === "Err") return r_attrs;
    const attrs = r_attrs._0;
    const r_param = this.collect_tokens(
      undefined,
      attrs,
      ForceCollect.No,
      (this_, attrs): PResult<[GenericParam | undefined, Trailing, UsePreAttrPos]> => {
        if (this_.eat_keyword_noexpect(kw.SelfUpper)) {
          // `Self` as a generic param is invalid. Here we emit the diagnostic and continue parsing
          // as if `Self` never existed.
          this_.dcx().emit_err(UnexpectedSelfInGenericParameters_diagnostic({ span: this_.prev_token.span }));

          // Eat a trailing comma, if it exists.
          void this_.eat(exp.Comma);
        }

        let param: GenericParam | undefined;
        if (this_.check_lifetime()) {
          const lifetime = this_.expect_lifetime();
          // Parse lifetime parameter.
          let colon_span: Span | undefined;
          let bounds: GenericBounds;
          if (this_.eat(exp.Colon)) {
            [colon_span, bounds] = [this_.prev_token.span, this_.parse_lt_param_bounds()];
          } else {
            [colon_span, bounds] = [undefined, []];
          }

          if (this_.check_noexpect(TK.Eq) && this_.look_ahead(1, (t) => t.is_lifetime())) {
            const lo = this_.token.span;
            // Parse `= 'lifetime`.
            this_.bump(); // `=`
            this_.bump(); // `'lifetime`
            const span = Span.to(lo, this_.prev_token.span);
            this_.dcx().emit_err(UnexpectedDefaultValueForLifetimeInGenericParameters_diagnostic({ span }));
          }

          param = new ast.GenericParam(
            lifetime.id,
            lifetime.ident,
            attrs,
            bounds,
            false,
            ast.GenericParamKind.Lifetime,
            colon_span,
          );
        } else if (this_.check_keyword(exp.Const)) {
          // Parse const parameter.
          const r = this_.parse_const_param(attrs);
          if (r.$ === "Err") return r;
          param = r._0;
        } else if (this_.check_ident()) {
          // Parse type parameter.
          const r = this_.parse_ty_param(attrs);
          if (r.$ === "Err") return r;
          param = r._0;
        } else if (this_.token.can_begin_type()) {
          // Trying to write an associated type bound? (#26271)
          const snapshot = this_.create_snapshot_for_diagnostic();
          const lo = this_.token.span;
          const r = this_.parse_ty_where_predicate_kind();
          if (r.$ === "Ok") {
            this_.dcx().emit_err(
              diagnostics.BadAssocTypeBounds_diagnostic({
                span: Span.to(lo, this_.prev_token.span),
              }),
            );
            // FIXME - try to continue parsing other generics?
          } else {
            const err = r._0;
            err.cancel();
            // FIXME - maybe we should overwrite 'self' outside of `collect_tokens`?
            this_.restore_snapshot(snapshot);
          }
          return Ok([undefined, Trailing.No, UsePreAttrPos.No]);
        } else {
          // Check for trailing attributes and stop parsing.
          if (!(attrs.length === 0)) {
            if (!(params.length === 0)) {
              this_.dcx().emit_err(diagnostics.AttrAfterGeneric_diagnostic({ span: attrs[0]!.span }));
            } else {
              this_.dcx().emit_err(diagnostics.AttrWithoutGenerics_diagnostic({ span: attrs[0]!.span }));
            }
          }
          return Ok([undefined, Trailing.No, UsePreAttrPos.No]);
        }

        if (!this_.eat(exp.Comma)) {
          done = true;
        }
        // We just ate the comma, so no need to capture the trailing token.
        return Ok([param, Trailing.No, UsePreAttrPos.No]);
      },
      HasTokens.Option(HasTokens.GenericParam),
      HasAttrs.Option(HasAttrs.GenericParam),
    );
    let param: GenericParam | undefined;
    if (r_param.$ === "Ok") {
      param = r_param._0;
    } else {
      const err = r_param._0;
      this.parsing_generics = prev;
      return Err(err);
    }

    if (param !== undefined) {
      params.push(param);
    } else {
      break;
    }
  }
  this.parsing_generics = prev;
  return Ok(params);
};

/// Parses a set of optional generic type parameter declarations. Where
/// clauses are not parsed here, and must be added later via
/// `parse_where_clause()`.
///
/// matches generics = ( ) | ( < > ) | ( < typaramseq ( , )? > ) | ( < lifetimes ( , )? > )
///                  | ( < lifetimes , typaramseq ( , )? > )
/// where   typaramseq = ( typaram ) | ( typaram , typaramseq )
// rustc: compiler/rustc_parse/src/parser/generics.rs:319 parse_generics
Parser.prototype.parse_generics = function (this: Parser): PResult<Generics> {
  // invalid path separator `::` in function definition
  // for example `fn invalid_path_separator::<T>() {}`
  if (this.eat_noexpect(TK.PathSep)) {
    this.dcx().emit_err(diagnostics.InvalidPathSepInFnDefinition_diagnostic({ span: this.prev_token.span }));
  }

  const span_lo = this.token.span;
  let params: GenericParam[];
  let span: Span;
  if (this.eat_lt()) {
    const r = this.parse_generic_params();
    if (r.$ === "Err") return r;
    const params_ = r._0;
    const r_gt = this.expect_gt_or_maybe_suggest_closing_generics(params_);
    if (r_gt.$ === "Err") return r_gt;
    [params, span] = [params_, Span.to(span_lo, this.prev_token.span)];
  } else {
    [params, span] = [[], Span.shrink_to_hi(this.prev_token.span)];
  }
  return Ok({
    params,
    where_clause: new ast.WhereClause(false, [], Span.shrink_to_hi(this.prev_token.span)),
    span,
  });
};

/// Parses an experimental fn contract
/// (`contract_requires(WWW) contract_ensures(ZZZ)`)
// rustc: compiler/rustc_parse/src/parser/generics.rs:348 parse_contract
Parser.prototype.parse_contract = function (this: Parser): PResult<FnContract | undefined> {
  const r_req = this.parse_contract_requires();
  if (r_req.$ === "Err") return r_req;
  const [declarations, requires] = r_req._0;
  const r_ens = this.parse_contract_ensures();
  if (r_ens.$ === "Err") return r_ens;
  const ensures = r_ens._0;

  if (requires === undefined && ensures === undefined) {
    return Ok(undefined);
  } else {
    return Ok({ declarations, requires, ensures });
  }
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:359 parse_contract_requires
Parser.prototype.parse_contract_requires = function (this: Parser): PResult<[Stmt[], Expr | undefined]> {
  if (this.eat_keyword_noexpect(exp.ContractRequires.kw)) {
    this.psess.gated_spans.gate(sym.contracts_internals, this.prev_token.span);
    const r = this.parse_block();
    if (r.$ === "Err") return r;
    const decls_and_precond = r._0;

    let precond: Expr;
    const last = decls_and_precond.stmts.pop();
    if (last !== undefined) {
      const precond_ = last;
      if (precond_.kind.$ === "Expr") {
        precond = precond_.kind._0;
      } else {
        // Insert dummy node that will be rejected by typechecker to
        // avoid reinventing an error
        precond = this.mk_unit_expr(decls_and_precond.span);
      }
    } else {
      precond = this.mk_unit_expr(decls_and_precond.span);
    }
    const precond2 = this.mk_closure_expr(precond.span, precond);
    const decls = decls_and_precond.stmts;
    return Ok([decls, precond2]);
  } else {
    return Ok([[], undefined]);
  }
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:383 parse_contract_ensures
Parser.prototype.parse_contract_ensures = function (this: Parser): PResult<Expr | undefined> {
  if (this.eat_keyword_noexpect(exp.ContractEnsures.kw)) {
    this.psess.gated_spans.gate(sym.contracts_internals, this.prev_token.span);
    const r = this.parse_expr();
    if (r.$ === "Err") return r;
    const postcond = r._0;
    return Ok(postcond);
  } else {
    return Ok(undefined);
  }
};

/// Parses an optional where-clause.
///
/// ```ignore (only-for-syntax-highlight)
/// where T : Trait<U, V> + 'b, 'a : 'b
/// ```
// rustc: compiler/rustc_parse/src/parser/generics.rs:398 parse_where_clause
Parser.prototype.parse_where_clause = function (this: Parser): PResult<WhereClause> {
  const r = this.parse_where_clause_common(undefined);
  if (r.$ === "Err") return r;
  const [clause] = r._0;
  return Ok(clause);
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:402 parse_struct_where_clause
Parser.prototype.parse_struct_where_clause = function (
  this: Parser,
  struct_name: Ident,
  body_insertion_point: Span,
): PResult<[WhereClause, FieldDef[] | undefined]> {
  return this.parse_where_clause_common([struct_name, body_insertion_point]);
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:410 parse_where_clause_common
Parser.prototype.parse_where_clause_common = function (
  this: Parser,
  struct_: [Ident, Span] | undefined,
): PResult<[WhereClause, FieldDef[] | undefined]> {
  if (!this.eat_keyword(exp.Where)) {
    return Ok([new ast.WhereClause(false, [], Span.shrink_to_hi(this.prev_token.span)), undefined]);
  }

  if (this.eat_noexpect(TK.Colon)) {
    const colon_span = this.prev_token.span;
    this.dcx()
      .struct_span_err(colon_span, "unexpected colon after `where`")
      .with_span_suggestion_short(colon_span, "remove the colon", "", Applicability.MachineApplicable)
      .emit();
  }

  const where_lo = this.prev_token.span;

  // We are considering adding generics to the `where` keyword as an alternative higher-rank
  // parameter syntax (as in `where<'a>` or `where<T>`. To avoid that being a breaking
  // change we parse those generics now, but report an error.
  if (this.choose_generics_over_qpath(0)) {
    const r = this.parse_generics();
    if (r.$ === "Err") return r;
    const generics = r._0;
    this.dcx().emit_err(diagnostics.WhereOnGenerics_diagnostic({ span: generics.span }));
  }

  const r = this.parse_where_clause_predicates(struct_, where_lo);
  if (r.$ === "Err") return r;
  const [predicates, tuple_struct_body] = r._0;
  const where_clause = new ast.WhereClause(true, predicates, Span.to(where_lo, this.prev_token.span));
  return Ok([where_clause, tuple_struct_body]);
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:458 parse_where_clause_predicates
Parser.prototype.parse_where_clause_predicates = function (
  this: Parser,
  struct_: [Ident, Span] | undefined,
  where_lo: Span,
): PResult<[WherePredicate[], FieldDef[] | undefined]> {
  const predicates: WherePredicate[] = [];
  let tuple_struct_body: FieldDef[] | undefined = undefined;

  for (;;) {
    const where_sp = Span.to(where_lo, this.prev_token.span);
    const r_attrs = this.parse_outer_attributes();
    if (r_attrs.$ === "Err") return r_attrs;
    const attrs = r_attrs._0;
    const pred_lo = this.token.span;
    const r_pred = this.collect_tokens(
      undefined,
      attrs,
      ForceCollect.No,
      (this_, attrs): PResult<[WherePredicate | undefined, Trailing, UsePreAttrPos]> => {
        for (const attr of attrs) {
          this.psess.gated_spans.gate(sym.where_clause_attrs, attr.span);
        }
        let kind: WherePredicateKind | undefined;
        if (this_.check_lifetime() && this_.look_ahead(1, (t) => !t.is_like_plus())) {
          const lifetime = this_.expect_lifetime();
          // Bounds starting with a colon are mandatory, but possibly empty.
          const r = this_.expect(exp.Colon);
          if (r.$ === "Err") return r;
          const bounds = this_.parse_lt_param_bounds();
          kind = { $: "RegionPredicate", _0: { lifetime, bounds } };
        } else if (this_.check_type()) {
          const r = this_.parse_ty_where_predicate_kind_or_recover_tuple_struct_body(struct_, pred_lo, where_sp);
          if (r.$ === "Err") return r;
          const k = r._0;
          switch (k.$) {
            case "PredicateKind":
              kind = k._0;
              break;
            case "StructBody": {
              const body = k._0;
              tuple_struct_body = body;
              kind = undefined;
              break;
            }
          }
        } else {
          const last = attrs[attrs.length - 1];
          if (last !== undefined) {
            if (last.is_doc_comment()) {
              this_.dcx().emit_err(
                diagnostics.DocCommentDoesNotDocumentAnything_diagnostic({
                  span: last.span,
                  missing_comma: undefined,
                }),
              );
            } else {
              this_.dcx().emit_err(
                diagnostics.AttrWithoutWherePredicates_diagnostic({
                  span: last.span,
                }),
              );
            }
          }
          kind = undefined;
        }
        const predicate: WherePredicate | undefined =
          kind === undefined
            ? undefined
            : {
                attrs,
                kind,
                id: ast.DUMMY_NODE_ID,
                span: Span.to(pred_lo, this_.prev_token.span),
                is_placeholder: false,
              };
        return Ok([predicate, Trailing.No, UsePreAttrPos.No]);
      },
      HasTokens.Option(HasTokens.WherePredicate),
      HasAttrs.Option(HasAttrs.WherePredicate),
    );
    if (r_pred.$ === "Err") return r_pred;
    const predicate = r_pred._0;
    if (predicate !== undefined) {
      predicates.push(predicate);
    } else {
      break;
    }

    const prev_token = this.prev_token.span;
    const ate_comma = this.eat(exp.Comma);

    if (this.eat_keyword_noexpect(kw.Where)) {
      this.dcx().emit_err(
        MultipleWhereClauses_diagnostic({
          span: this.token.span,
          previous: pred_lo,
          between: Span.to(Span.shrink_to_hi(prev_token), this.prev_token.span),
        }),
      );
    } else if (!ate_comma) {
      break;
    }
  }

  return Ok([predicates, tuple_struct_body]);
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:539 parse_ty_where_predicate_kind_or_recover_tuple_struct_body
Parser.prototype.parse_ty_where_predicate_kind_or_recover_tuple_struct_body = function (
  this: Parser,
  struct_: [Ident, Span] | undefined,
  pred_lo: Span,
  where_sp: Span,
): PResult<PredicateKindOrStructBody> {
  let snapshot: [[Ident, Span], SnapshotParser] | undefined = undefined;

  if (struct_ !== undefined && this.may_recover() && this.token.eq(TK.OpenParen)) {
    snapshot = [struct_, this.create_snapshot_for_diagnostic()];
  }

  const r = this.parse_ty_where_predicate_kind();
  if (r.$ === "Ok") {
    const pred = r._0;
    return Ok({ $: "PredicateKind", _0: { $: "BoundPredicate", _0: pred } });
  } else {
    const type_err = r._0;
    if (snapshot === undefined) {
      return Err(type_err);
    }
    const [[struct_name, body_insertion_point], snapshot_] = snapshot;

    // Check if we might have encountered an out of place tuple struct body.
    const r_body = snapshot_.parser.parse_tuple_struct_body();
    // Since we don't know the exact reason why we failed to parse the
    // predicate (we might have stumbled upon something bogus like `(T): ?`),
    // employ a simple heuristic to weed out some pathological cases:
    // Look for a semicolon (strong indicator) or anything that might mark
    // the end of the item (weak indicator) following the body.
    if (
      r_body.$ === "Ok" &&
      (snapshot_.parser.token.kind.$ === "Semi" ||
        snapshot_.parser.token.kind.$ === "Eof" ||
        snapshot_.parser.token.can_begin_item())
    ) {
      const body = r_body._0;
      type_err.cancel();

      const body_sp = Span.to(pred_lo, snapshot_.parser.prev_token.span);
      const map = this.psess.source_map();

      const snippet = map.span_to_snippet(body_sp);
      let sugg: WhereClauseBeforeTupleStructBodySugg | undefined;
      if (snippet.$ === "Ok") {
        const body = snippet._0;
        sugg = {
          left: Span.shrink_to_hi(body_insertion_point),
          snippet: body.toString(),
          right: Span.to(map.end_point(where_sp), body_sp),
        };
      } else {
        sugg = undefined;
      }
      this.dcx().emit_err(
        WhereClauseBeforeTupleStructBody_diagnostic({
          span: where_sp,
          name: struct_name.span,
          body: body_sp,
          sugg,
        }),
      );

      this.restore_snapshot(snapshot_);
      return Ok({ $: "StructBody", _0: body });
    } else if (r_body.$ === "Ok") {
      return Err(type_err);
    } else {
      const body_err = r_body._0;
      body_err.cancel();
      return Err(type_err);
    }
  }
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:605 parse_ty_where_predicate_kind
Parser.prototype.parse_ty_where_predicate_kind = function (this: Parser): PResult<WhereBoundPredicate> {
  // Parse optional `for<'a, 'b>`.
  // This `for` is parsed greedily and applies to the whole predicate,
  // the bounded type can have its own `for` applying only to it.
  // Examples:
  // * `for<'a> Trait1<'a>: Trait2<'a /* ok */>`
  // * `(for<'a> Trait1<'a>): Trait2<'a /* not ok */>`
  // * `for<'a> for<'b> Trait1<'a, 'b>: Trait2<'a /* ok */, 'b /* not ok */>`
  const r_binder = this.parse_higher_ranked_binder();
  if (r_binder.$ === "Err") return r_binder;
  const [bound_vars] = r_binder._0;

  const r_ty = this.parse_ty_for_where_clause();
  if (r_ty.$ === "Err") return r_ty;
  const ty = r_ty._0;

  if (this.eat(exp.Colon)) {
    // The bounds may be empty; we intentionally accept predicates like  `Ty:`.
    const r = this.parse_generic_bounds();
    if (r.$ === "Err") return r;
    const bounds = r._0;

    return Ok({
      bound_generic_params: bound_vars,
      bounded_ty: ty,
      bounds,
    });
  }

  // NOTE: If we ever end up impl'ing and stabilizing equality predicates (#20041),
  //       we need to pick between `=` and `==`, both is not an option!
  if (this.eat(exp.Eq) || this.eat(exp.EqEq)) {
    const lhs_ty = ty;
    const r = this.parse_ty();
    if (r.$ === "Err") return r;
    const rhs_ty = r._0;

    // NOTE: If we ever end up impl'ing equality predicates,
    //       we ought to track the binder in the AST node!
    void bound_vars;

    const diag = this.dcx().struct_span_err(
      Span.to(lhs_ty.span, rhs_ty.span),
      "general type equality constraints are not supported",
    );
    diag.note("see issue #20041 <https://github.com/rust-lang/rust/issues/20041> " + "for more information");
    diag.span(Span.to(lhs_ty.span, rhs_ty.span));
    diag.span_label(Span.to(lhs_ty.span, rhs_ty.span), "not supported");

    suggest_replacing_equality_pred_with_assoc_item_constraint(diag, lhs_ty, rhs_ty);

    return Err(diag);
  }

  const r = this.maybe_recover_bounds_doubled_colon(ty);
  if (r.$ === "Err") return r;
  return this.unexpected_any();
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:660 choose_generics_over_qpath
Parser.prototype.choose_generics_over_qpath = function (this: Parser, start: number): boolean {
  // There's an ambiguity between generic parameters and qualified paths in impls.
  // If we see `<` it may start both, so we have to inspect some following tokens.
  // The following combinations can only start generics,
  // but not qualified paths (with one exception):
  //     `<` `>` - empty generic parameters
  //     `<` `#` - generic parameters with attributes
  //     `<` (LIFETIME|IDENT) `>` - single generic parameter
  //     `<` (LIFETIME|IDENT) `,` - first generic parameter in a list
  //     `<` (LIFETIME|IDENT) `:` - generic parameter with bounds
  //     `<` (LIFETIME|IDENT) `=` - generic parameter with a default
  //     `<` const                - generic const parameter
  //     `<` IDENT `?`            - RECOVERY for `impl<T ?Bound` missing a `:`, meant to
  //                                avoid the `T?` to `Option<T>` recovery for types.
  // The only truly ambiguous case is
  //     `<` IDENT `>` `::` IDENT ...
  // we disambiguate it in favor of generics (`impl<T> ::absolute::Path<T> { ... }`)
  // because this is what almost always expected in practice, qualified paths in impls
  // (`impl <Type>::AssocTy { ... }`) aren't even allowed by type checker at the moment.
  return (
    this.look_ahead(start, (t) => t.eq(TK.Lt)) &&
    (this.look_ahead(start + 1, (t) => t.eq(TK.Pound) || t.eq(TK.Gt)) ||
      (this.look_ahead(start + 1, (t) => t.is_lifetime() || t.is_ident()) &&
        this.look_ahead(start + 2, (t) => {
          const k = t.kind.$;
          return (
            k === "Gt" ||
            k === "Comma" ||
            k === "Colon" ||
            k === "Eq" ||
            // Recovery-only branch -- this could be removed,
            // since it only affects diagnostics currently.
            k === "Question"
          );
        })) ||
      this.is_keyword_ahead(start + 1, [kw.Const]))
  );
};

// rustc: compiler/rustc_parse/src/parser/generics.rs:692 suggest_replacing_equality_pred_with_assoc_item_constraint
function suggest_replacing_equality_pred_with_assoc_item_constraint(diag: Diag, lhs_ty: Ty, rhs_ty: Ty): void {
  if (lhs_ty.kind.$ !== "Path") return;
  const qself = lhs_ty.kind._0;
  const segments = lhs_ty.kind._1.segments;

  const parts: [Span, string][] = [];
  let applicability: Applicability;
  // PORT: `match qself` with `if let` guards; a failing guard falls through to `_ => return`.
  if (qself === undefined && segments.length === 2 && segments[0]!.ident.name !== kw.PathRoot) {
    // We have something like `Ty::Item<i32> = Rhs`.
    const self_ty_seg = segments[0]!;
    const assoc_item_seg = segments[1]!;
    parts.push([Span.between(self_ty_seg.span(), assoc_item_seg.span()), ": /* Trait */</* ... */"]);
    applicability = Applicability.HasPlaceholders;
  } else if (qself !== undefined && segments.slice(qself.position).length === 1) {
    const assoc_item_seg = segments[qself.position]!;
    parts.push([Span.until(lhs_ty.span, qself.ty.span), ""]);

    // We have something like `<Option<usize> as self::Trait<i32>>::Item = Rhs`.
    const trait_segs = segments.slice(0, qself.position);
    if (trait_segs.length >= 1) {
      const final_trait_seg = trait_segs[trait_segs.length - 1]!;
      parts.push([Span.between(qself.ty.span, trait_segs[0]!.span()), ": "]);
      let span: Span;
      let snippet: string;
      const args_ = final_trait_seg.args;
      if (args_ !== undefined) {
        if (args_.$ !== "AngleBracketed") return;
        const args = args_._0.args[args_._0.args.length - 1];
        if (args === undefined) return;
        [span, snippet] = [ast.AngleBracketedArg.span(args), ", "];
      } else {
        [span, snippet] = [final_trait_seg.span(), "<"];
      }
      parts.push([Span.between(span, assoc_item_seg.span()), snippet]);
      applicability = Applicability.MaybeIncorrect;
    }
    // We have something like `<[u8]>::Item == Rhs`.
    else {
      parts.push([Span.between(qself.ty.span, assoc_item_seg.span()), ": /* Trait */</* ... */"]);
      applicability = Applicability.HasPlaceholders;
    }
  } else {
    return;
  }

  parts.push([Span.between(lhs_ty.span, rhs_ty.span), " = "]);
  parts.push([Span.shrink_to_hi(rhs_ty.span), ">"]);

  diag.multipart_suggestion("replace it with an associated item constraint if possible", parts, applicability);
}
