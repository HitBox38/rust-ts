// Port of compiler/rustc_parse/src/parser/stmt.rs
// (this file defines no types)
import { HasAttrs, HasTokens, ast, token, visit } from "../../rustc_ast/lib.ts";
import type {
  AttrVec,
  Block,
  BlockCheckMode,
  Expr,
  Label,
  Local,
  LocalKind,
  MacCallStmt,
  MacStmtStyle,
  Pat,
  Path,
  Stmt,
  StmtKind,
  Ty,
} from "../../rustc_ast/lib.ts";
import type { TokenTree } from "../../rustc_ast/tokenstream.ts";
import { expr_requires_semi_to_be_stmt, expr_trailing_brace } from "../../rustc_ast/util/classify.ts";
import type { Diag, PResult } from "../../rustc_errors/lib.ts";
import { Applicability } from "../../rustc_lint_defs/lib.ts";
import { DUMMY_SP, type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { Ident, display_Ident, kw, sym } from "../../rustc_span/symbol.ts";
import { is_uppercase } from "../../std/char.ts";
import { field_mut, replace_in_place } from "../../std/mut_ref.ts";
import { assert_eq, unwrap } from "../../std/panic.ts";
import { Err, Ok } from "../../std/result.ts";
import * as diagnostics from "../diagnostics.ts";
import { InnerAttrForbiddenReason, InnerAttrPolicy } from "./attr.gen.ts";
import { AttrWrapper, UsePreAttrPos } from "./attr_wrapper.ts";
import { clone_AttrWrapper } from "./attr_wrapper.gen.ts";
import { AttemptLocalParseRecovery, RecoverQPath } from "./diagnostics.ts";
import { op_can_continue_stmt_expr_unambiguously } from "./expr/diagnostics.ts";
import { FnContext } from "./function.gen.ts";
import { AllowConstBlockItems, BlockMode, ForceCollect, Parser, Restrictions, SemiColonMode, Trailing, clone_Parser, token_descr } from "./mod.ts";
import { PatternLocation, RecoverComma } from "./pat.gen.ts";
import { PathStyle } from "./path.gen.ts";
import { exp } from "./token_type.ts";

const { TokenKind: TK } = token;

// ---- impl<'a> Parser<'a> ----

/// Parses a statement nonterminal, which has a peculiar syntax preserved for backward
/// compatibility. The parsing stops just before trailing semicolons on everything but items.
/// e.g., a `StmtKind::Semi` parses to a `StmtKind::Expr`, leaving the trailing `;` unconsumed.
///
/// If `force_collect` is [`ForceCollect::Yes`], forces collection of tokens regardless of
/// whether or not we have attributes.
// Public for rustfmt usage.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:37 parse_stmt_nonterminal
Parser.prototype.parse_stmt_nonterminal = function (this: Parser, force_collect: ForceCollect): Stmt | undefined {
  const r = this.parse_stmt_without_recovery(false, force_collect, false);
  if (r.$ === "Ok") {
    return r._0;
  } else {
    const e = r._0;
    e.emit();
    this.recover_stmt_(SemiColonMode.Break, BlockMode.Ignore);
    return undefined;
  }
};

/// If `force_collect` is [`ForceCollect::Yes`], forces collection of tokens regardless of
/// whether or not we have attributes. If `force_full_expr` is true, parses the stmt without
/// using `Restriction::STMT_EXPR`. Public for `cfg_eval` macro expansion.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:51 parse_stmt_without_recovery
Parser.prototype.parse_stmt_without_recovery = function (
  this: Parser,
  capture_semi: boolean,
  force_collect: ForceCollect,
  force_full_expr: boolean,
): PResult<Stmt> {
  this.current_closure = undefined;

  const pre_attr_pos = this.collect_pos();
  const ra = this.parse_outer_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  const lo = this.token.span;

  const nt = this.eat_metavar_seq(token.MetaVarKind.Stmt, (this_) =>
    this_.parse_stmt_without_recovery(false, ForceCollect.Yes, false),
  );
  if (nt !== undefined) {
    const stmt = nt;
    HasAttrs.Stmt.visit_attrs(stmt, (stmt_attrs) => {
      attrs.prepend_to_nt_inner(stmt_attrs);
    });
    return Ok(stmt);
  }

  if (this.token.is_keyword(kw.Mut) && this.is_keyword_ahead(1, [kw.Let])) {
    this.bump();
    const mut_let_span = Span.to(lo, this.token.span);
    this.dcx().emit_err(
      diagnostics.InvalidVariableDeclaration_diagnostic({
        span: mut_let_span,
        sub: { $: "SwitchMutLetOrder", _0: mut_let_span },
      }),
    );
  }

  let stmt: Stmt;
  if (this.token.is_keyword(kw.Super) && this.is_keyword_ahead(1, [kw.Let])) {
    const r = this.collect_tokens<Stmt>(
      undefined,
      attrs,
      force_collect,
      (this_, attrs) => {
        const super_span = this_.token.span;
        const r1 = this_.expect_keyword(exp.Super);
        if (r1.$ === "Err") return r1;
        const r2 = this_.expect_keyword(exp.Let);
        if (r2.$ === "Err") return r2;
        this_.psess.gated_spans.gate(sym.super_let, super_span);
        const rl = this_.parse_local(super_span, attrs);
        if (rl.$ === "Err") return rl;
        const local = rl._0;
        const trailing = Trailing.from(capture_semi && this_.token.eq(TK.Semi));
        return Ok([this_.mk_stmt(Span.to(lo, this_.prev_token.span), { $: "Let", _0: local }), trailing, UsePreAttrPos.No]);
      },
      HasTokens.Stmt,
      HasAttrs.Stmt,
    );
    if (r.$ === "Err") return r;
    stmt = r._0;
  } else if (this.token.is_keyword(kw.Let)) {
    const r = this.collect_tokens<Stmt>(
      undefined,
      attrs,
      force_collect,
      (this_, attrs) => {
        const r1 = this_.expect_keyword(exp.Let);
        if (r1.$ === "Err") return r1;
        const rl = this_.parse_local(undefined, attrs);
        if (rl.$ === "Err") return rl;
        const local = rl._0;
        const trailing = Trailing.from(capture_semi && this_.token.eq(TK.Semi));
        return Ok([this_.mk_stmt(Span.to(lo, this_.prev_token.span), { $: "Let", _0: local }), trailing, UsePreAttrPos.No]);
      },
      HasTokens.Stmt,
      HasAttrs.Stmt,
    );
    if (r.$ === "Err") return r;
    stmt = r._0;
  } else if (this.is_kw_followed_by_ident(kw.Mut) && this.may_recover()) {
    const r = this.recover_stmt_local_after_let(lo, attrs, (s) => ({ $: "MissingLet", _0: s }), force_collect);
    if (r.$ === "Err") return r;
    stmt = r._0;
  } else if (this.is_kw_followed_by_ident(kw.Auto) && this.may_recover()) {
    this.bump(); // `auto`
    const r = this.recover_stmt_local_after_let(lo, attrs, (s) => ({ $: "UseLetNotAuto", _0: s }), force_collect);
    if (r.$ === "Err") return r;
    stmt = r._0;
  } else if (this.is_kw_followed_by_ident(sym.var) && this.may_recover()) {
    this.bump(); // `var`
    const r = this.recover_stmt_local_after_let(lo, attrs, (s) => ({ $: "UseLetNotVar", _0: s }), force_collect);
    if (r.$ === "Err") return r;
    stmt = r._0;
  } else if (this.check_path() && !this.token.is_qpath_start() && !this.is_path_start_item() && !this.is_builtin()) {
    // We have avoided contextual keywords like `union`, items with `crate` visibility,
    // or `auto trait` items. We aim to parse an arbitrary path `a::b` but not something
    // that starts like a path (1 token), but it fact not a path.
    // Also, we avoid stealing syntax from `parse_item_`.
    //
    // `UsePreAttrPos::Yes` here means the attribute belongs unconditionally to the
    // expression, not the statement. (But the statement attributes/tokens are obtained
    // from the expression anyway, because `Stmt` delegates `HasAttrs`/`HasTokens` to
    // the things within `StmtKind`.)
    const r = this.collect_tokens<Stmt>(
      pre_attr_pos,
      AttrWrapper.empty(),
      force_collect,
      (this_, _empty_attrs) => {
        const rs = this_.parse_stmt_path_start(lo, attrs);
        if (rs.$ === "Err") return rs;
        return Ok([rs._0, Trailing.No, UsePreAttrPos.Yes]);
      },
      HasTokens.Stmt,
      HasAttrs.Stmt,
    );
    if (r.$ === "Ok") {
      stmt = r._0;
    } else {
      const err = r._0;
      this.suggest_add_missing_let_for_stmt(err);
      return Err(err);
    }
  } else {
    const ri = this.parse_item_common(
      clone_AttrWrapper(attrs), // FIXME: unwanted clone of attrs
      false,
      true,
      { req_name: (_, __) => true, context: FnContext.Free, req_body: true },
      force_collect,
      AllowConstBlockItems.No,
    );
    if (ri.$ === "Err") return ri;
    const item = ri._0;
    if (item !== undefined) {
      stmt = this.mk_stmt(Span.to(lo, item.span), { $: "Item", _0: item });
    } else if (this.eat(exp.Semi)) {
      // Do not attempt to parse an expression if we're done here.
      const re = this.error_outer_attrs(attrs);
      if (re.$ === "Err") return re;
      stmt = this.mk_stmt(lo, ast.StmtKind.Empty);
    } else {
      if (this.token.eq(TK.CloseBrace)) {
        const re = this.error_outer_attrs(clone_AttrWrapper(attrs));
        if (re.$ === "Err") return re;
      }

      // Remainder are line-expr stmts. This is similar to the `parse_stmt_path_start` case
      // above.
      const restrictions = force_full_expr ? Restrictions.empty() : Restrictions.STMT_EXPR;
      const re = this.collect_tokens<Expr>(
        pre_attr_pos,
        AttrWrapper.empty(),
        force_collect,
        (this_, _empty_attrs) => {
          const rx = this_.parse_expr_res_after_attrs(restrictions, attrs);
          if (rx.$ === "Err") return rx;
          const [expr] = rx._0;
          return Ok([expr, Trailing.No, UsePreAttrPos.Yes]);
        },
        HasTokens.Expr,
        HasAttrs.Expr,
      );
      if (re.$ === "Err") return re;
      const e = re._0;
      if (e.kind.$ === "Assign" && this.eat_keyword(exp.Else)) {
        const rb = this.parse_block();
        if (rb.$ === "Err") return rb;
        const bl = rb._0;
        // Destructuring assignment ... else.
        // This is not allowed, but point it out in a nice way.
        this.dcx().emit_err(diagnostics.AssignmentElseNotAllowed_diagnostic({ span: Span.to(e.span, bl.span) }));
      }
      stmt = this.mk_stmt(Span.to(lo, e.span), { $: "Expr", _0: e });
    }
  }

  this.maybe_augment_stashed_expr_in_pats_with_suggestions(stmt);
  return Ok(stmt);
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:203 parse_stmt_path_start
Parser.prototype.parse_stmt_path_start = function (this: Parser, lo: Span, attrs: AttrWrapper): PResult<Stmt> {
  const rs = this.collect_tokens<Stmt>(
    undefined,
    attrs,
    ForceCollect.No,
    (this_, attrs) => {
      const rp = this_.parse_path(PathStyle.Expr);
      if (rp.$ === "Err") return rp;
      const path = rp._0;

      if (this_.eat(exp.Bang)) {
        const rm = this_.parse_stmt_mac(lo, attrs, path);
        if (rm.$ === "Err") return rm;
        const stmt_mac = rm._0;
        return Ok([stmt_mac, Trailing.from(this_.token.eq(TK.Semi)), UsePreAttrPos.No]);
      }

      let expr: Expr;
      if (this_.eat(exp.OpenBrace)) {
        const r = this_.parse_expr_struct(undefined, path, true);
        if (r.$ === "Err") return r;
        expr = r._0;
      } else {
        const hi = this_.prev_token.span;
        expr = this_.mk_expr(Span.to(lo, hi), { $: "Path", _0: undefined, _1: path });
      }

      const rd = this_.with_res(Restrictions.STMT_EXPR, (this__) => this__.parse_expr_dot_or_call_with(attrs, expr, lo));
      if (rd.$ === "Err") return rd;
      const expr2 = rd._0;
      // `DUMMY_SP` will get overwritten later in this function
      return Ok([this_.mk_stmt(DUMMY_SP, { $: "Expr", _0: expr2 }), Trailing.No, UsePreAttrPos.No]);
    },
    HasTokens.Stmt,
    HasAttrs.Stmt,
  );
  if (rs.$ === "Err") return rs;
  const stmt = rs._0;

  if (stmt.kind.$ === "Expr") {
    const expr = stmt.kind._0;
    // Perform this outside of the `collect_tokens` closure, since our
    // outer attributes do not apply to this part of the expression.
    const r = this.with_res(Restrictions.STMT_EXPR, (this_) => this_.parse_expr_assoc_rest({ $: "Unbounded" }, true, expr));
    if (r.$ === "Err") return r;
    const [expr2] = r._0;
    return Ok(this.mk_stmt(Span.to(lo, this.prev_token.span), { $: "Expr", _0: expr2 }));
  } else {
    return Ok(stmt);
  }
};

/// Parses a statement macro `mac!(args)` provided a `path` representing `mac`.
/// At this point, the `!` token after the path has already been eaten.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:248 parse_stmt_mac
Parser.prototype.parse_stmt_mac = function (this: Parser, lo: Span, attrs: AttrVec, path: Path): PResult<Stmt> {
  const ra = this.parse_delim_args();
  if (ra.$ === "Err") return ra;
  const args = ra._0;
  const hi = this.prev_token.span;

  let style: MacStmtStyle;
  switch (args.delim.$) {
    case "Brace":
      style = ast.MacStmtStyle.Braces;
      break;
    default:
      style = ast.MacStmtStyle.NoBraces;
      break;
  }

  const mac = new ast.MacCall(path, args);

  let kind: StmtKind;
  const tk = this.token.kind;
  if (
    (style === ast.MacStmtStyle.Braces && !(tk.$ === "Dot" || tk.$ === "Question")) ||
    tk.$ === "Semi" ||
    tk.$ === "Eof" ||
    (tk.$ === "CloseInvisible" && tk._0.$ === "MetaVar" && tk._0._0.$ === "Stmt")
  ) {
    const mcs: MacCallStmt = { mac, style, attrs, tokens: undefined };
    kind = { $: "MacCall", _0: mcs };
  } else {
    // Since none of the above applied, this is an expression statement macro.
    const e0 = this.mk_expr(Span.to(lo, hi), { $: "MacCall", _0: mac });
    const r1 = this.maybe_recover_from_bad_qpath(e0, RecoverQPath.Box(RecoverQPath.Expr));
    if (r1.$ === "Err") return r1;
    const r2 = this.parse_expr_dot_or_call_with(attrs, r1._0, lo);
    if (r2.$ === "Err") return r2;
    const r3 = this.parse_expr_assoc_rest({ $: "Unbounded" }, false, r2._0);
    if (r3.$ === "Err") return r3;
    const [e] = r3._0;
    kind = { $: "Expr", _0: e };
  }
  return Ok(this.mk_stmt(Span.to(lo, hi), kind));
};

/// Error on outer attributes in this context.
/// Also error if the previous token was a doc comment.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:281 error_outer_attrs
Parser.prototype.error_outer_attrs = function (this: Parser, attrs_: AttrWrapper): PResult<undefined> {
  if (attrs_.is_empty()) {
    return Ok(undefined);
  }
  const attrs = attrs_.take_for_recovery(this.psess);
  const last = unwrap(attrs[attrs.length - 1]);
  if (last.is_doc_comment()) {
    return Err(
      this.dcx().create_err(
        diagnostics.DocCommentDoesNotDocumentAnything_diagnostic({ span: last.span, missing_comma: undefined }),
      ),
    );
  } else {
    assert_eq(last.style, ast.AttrStyle.Outer, (v) => v);
    return Err(this.dcx().create_err(diagnostics.ExpectedStatementAfterOuterAttr_diagnostic({ span: last.span })));
  }
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:298 recover_stmt_local_after_let
Parser.prototype.recover_stmt_local_after_let = function (
  this: Parser,
  lo: Span,
  attrs: AttrWrapper,
  subdiagnostic: (a0: Span) => diagnostics.InvalidVariableDeclarationSub,
  force_collect: ForceCollect,
): PResult<Stmt> {
  const rs = this.collect_tokens<Stmt>(
    undefined,
    attrs,
    force_collect,
    (this_, attrs) => {
      const rl = this_.parse_local(undefined, attrs);
      if (rl.$ === "Err") return rl;
      const local = rl._0;
      // FIXME - maybe capture semicolon in recovery?
      return Ok([this_.mk_stmt(Span.to(lo, this_.prev_token.span), { $: "Let", _0: local }), Trailing.No, UsePreAttrPos.No]);
    },
    HasTokens.Stmt,
    HasAttrs.Stmt,
  );
  if (rs.$ === "Err") return rs;
  const stmt = rs._0;
  this.dcx().emit_err(diagnostics.InvalidVariableDeclaration_diagnostic({ span: lo, sub: subdiagnostic(lo) }));
  return Ok(stmt);
};

/// Parses a local variable declaration.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:320 parse_local
Parser.prototype.parse_local = function (this: Parser, super_: Span | undefined, attrs: AttrVec): PResult<Local> {
  const lo = super_ ?? this.prev_token.span;

  if (this.token.is_keyword(kw.Const) && this.look_ahead(1, (t) => t.is_ident())) {
    this.dcx().emit_err(diagnostics.ConstLetMutuallyExclusive_diagnostic({ span: Span.to(lo, this.token.span) }));
    this.bump();
  }

  const rp = this.parse_pat_before_ty(undefined, RecoverComma.Yes, PatternLocation.LetBinding);
  if (rp.$ === "Err") return rp;
  const [pat, colon] = rp._0;

  let err: [Parser, Span, Diag] | undefined;
  let ty: Ty | undefined;
  let colon_sp: Span | undefined;
  if (colon) {
    // Save the state of the parser before parsing type normally, in case there is a `:`
    // instead of an `=` typo.
    const parser_snapshot_before_type = clone_Parser(this);
    const colon_sp_ = this.prev_token.span;
    const rt = this.parse_ty();
    if (rt.$ === "Ok") {
      [err, ty, colon_sp] = [undefined, rt._0, colon_sp_];
    } else {
      const err_ = rt._0;
      const d = pat.descr();
      err_.span_label(colon_sp_, `while parsing the type for ${d === undefined ? "the binding" : `\`${d}\``}`);
      // we use noexpect here because we don't actually expect Eq to be here
      // but we are still checking for it in order to be able to handle it if
      // it is there
      let e: [Parser, Span, Diag] | undefined;
      if (this.check_noexpect(TK.Eq)) {
        err_.emit();
        e = undefined;
      } else {
        // Rewind to before attempting to parse the type and continue parsing.
        // PORT: `mem::replace(self, parser_snapshot_before_type)`: move the current state out into a
        // fresh `Parser`, then overwrite `self` with the snapshot.
        const parser_snapshot_after_type = move_parser(this);
        replace_in_place(this, parser_snapshot_before_type);
        e = [parser_snapshot_after_type, colon_sp_, err_];
      }
      [err, ty, colon_sp] = [e, undefined, colon_sp_];
    }
  } else {
    [err, ty, colon_sp] = [undefined, undefined, undefined];
  }

  const init_wrapped =
    this.tree_look_ahead(2, (tree: TokenTree) => {
      switch (tree.$) {
        case "Token":
          return tree._0.is_keyword(kw.Else);
        case "Delimited":
          return false;
      }
    }) ?? false;

  let init: Expr | undefined;
  const ri = this.parse_initializer(err !== undefined);
  if (ri.$ === "Ok") {
    if (err === undefined) {
      // init parsed, ty parsed
      init = ri._0;
    } else {
      const [, colon_sp_, err_] = err;
      // init parsed, ty error
      // Could parse the type as if it were the initializer, it is likely there was a
      // typo in the code: `:` instead of `=`. Add suggestion and emit the error.
      err_.span_suggestion_verbose(colon_sp_, "use `=` if you meant to assign", " =", Applicability.MachineApplicable);
      err_.emit();
      // As this was parsed successfully, continue as if the code has been fixed for the
      // rest of the file. It will still fail due to the emitted error, but we avoid
      // extra noise.
      init = ri._0;
    }
  } else {
    if (err !== undefined) {
      const init_err = ri._0;
      const [snapshot, , ty_err] = err;
      // init error, ty error
      init_err.cancel();
      // Couldn't parse the type nor the initializer, only raise the type error and
      // return to the parser state before parsing the type as the initializer.
      // let x: <parse_error>;
      replace_in_place(this, snapshot);
      return Err(ty_err);
    } else {
      // init error, ty parsed
      // Couldn't parse the initializer and we're not attempting to recover a failed
      // parse of the type, return the error.
      return ri;
    }
  }
  const trailing_token = this.prev_token;
  let kind: LocalKind;
  if (init === undefined) {
    kind = ast.LocalKind.Decl;
  } else {
    if (this.eat_keyword(exp.Else)) {
      if (this.token.is_keyword(kw.If)) {
        // `let...else if`. Emit the same error that `parse_block()` would,
        // but explicitly point out that this pattern is not allowed.
        const msg = "conditional `else if` is not supported for `let...else`";
        return Err(this.error_block_no_opening_brace_msg(msg));
      }
      const rb = this.parse_block();
      if (rb.$ === "Err") return rb;
      const els = rb._0;
      // These checks should also respect invisible delimiter
      if (!init_wrapped) {
        this.check_let_else_init_bool_expr(init);
      }
      if (trailing_token.kind.$ === "CloseBrace") {
        this.check_let_else_init_trailing_brace(init);
      }

      kind = { $: "InitElse", _0: init, _1: els };
    } else {
      kind = { $: "Init", _0: init };
    }
  }
  const hi = this.token.eq(TK.Semi) ? this.token.span : this.prev_token.span;
  return Ok({
    id: ast.DUMMY_NODE_ID,
    super_,
    pat,
    ty,
    kind,
    span: Span.to(lo, hi),
    colon_sp,
    attrs,
    tokens: undefined,
  });
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:451 check_let_else_init_bool_expr
Parser.prototype.check_let_else_init_bool_expr = function (this: Parser, init: Expr): void {
  if (init.kind.$ === "Binary") {
    const op = init.kind._0;
    if (ast.BinOpKind.is_lazy(op.node)) {
      this.dcx().emit_err(
        diagnostics.InvalidExpressionInLetElse_diagnostic({
          span: init.span,
          operator: ast.BinOpKind.as_str(op.node),
          sugg: { $: "Expression", left: Span.shrink_to_lo(init.span), right: Span.shrink_to_hi(init.span) },
        }),
      );
    }
  }
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:466 check_let_else_init_trailing_brace
Parser.prototype.check_let_else_init_trailing_brace = function (this: Parser, init: Expr): void {
  const trailing = expr_trailing_brace(init);
  if (trailing !== undefined) {
    let span: Span;
    let sugg: diagnostics.WrapInParentheses;
    switch (trailing.$) {
      case "MacCall": {
        const mac = trailing._0;
        [span, sugg] = [mac.span(), { $: "MacroArgs", left: mac.args.dspan.open, right: mac.args.dspan.close }];
        break;
      }
      case "Expr": {
        const expr = trailing._0;
        [span, sugg] = [
          expr.span,
          { $: "Expression", left: Span.shrink_to_lo(expr.span), right: Span.shrink_to_hi(expr.span) },
        ];
        break;
      }
    }
    this.dcx().emit_err(
      diagnostics.InvalidCurlyInLetElse_diagnostic({ span: this.psess.source_map().end_point(span), sugg }),
    );
  }
};

/// Parses the RHS of a local variable declaration (e.g., `= 14;`).
// rustc: compiler/rustc_parse/src/parser/stmt.rs:492 parse_initializer
Parser.prototype.parse_initializer = function (this: Parser, eq_optional: boolean): PResult<Expr | undefined> {
  let eq_consumed: boolean;
  switch (this.token.kind.$) {
    case "PlusEq":
    case "MinusEq":
    case "StarEq":
    case "SlashEq":
    case "PercentEq":
    case "CaretEq":
    case "AndEq":
    case "OrEq":
    case "ShlEq":
    case "ShrEq": {
      // Recover `let x <op>= 1` as `let x = 1` We must not use `+ BytePos(1)` here
      // because `<op>` can be a multi-byte lookalike that was recovered, e.g. `➖=` (the
      // `➖` is a U+2796 Heavy Minus Sign Unicode Character) that was recovered as a
      // `-=`.
      const extra_op_span = this.psess.source_map().start_point(this.token.span);
      this.dcx().emit_err(
        diagnostics.CompoundAssignmentExpressionInLet_diagnostic({ span: this.token.span, suggestion: extra_op_span }),
      );
      this.bump();
      eq_consumed = true;
      break;
    }
    default:
      eq_consumed = this.eat(exp.Eq);
  }

  if (eq_consumed || eq_optional) {
    const r = this.parse_expr_in_let();
    if (r.$ === "Err") return r;
    return Ok(r._0);
  } else {
    return Ok(undefined);
  }
};

/// Parses a block. No inner attributes are allowed.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:523 parse_block
Parser.prototype.parse_block = function (this: Parser): PResult<Block> {
  const r = this.parse_inner_attrs_and_block(undefined);
  if (r.$ === "Err") return r;
  const [attrs, block] = r._0;
  const last = attrs[attrs.length - 1];
  if (last !== undefined) {
    const suggest_to_outer = last.kind.$ === "Normal" ? last.kind._0.item.is_valid_for_outer_style() : false;
    this.error_on_forbidden_inner_attr(
      last.span,
      { $: "Forbidden", _0: InnerAttrForbiddenReason.InCodeBlock },
      suggest_to_outer,
    );
  }
  return Ok(block);
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:541 error_block_no_opening_brace_msg
Parser.prototype.error_block_no_opening_brace_msg = function (this: Parser, msg: string): Diag {
  const prev = this.prev_token.span;
  const sp = this.token.span;
  const err = this.dcx().struct_span_err(sp, msg);
  this.label_expected_raw_ref(err);
  err.span_label(sp, "expected `{`");
  if (this.token.eq(TK.CloseBrace)) {
    return err;
  }

  const do_not_suggest_help = this.token.is_keyword(kw.In) || this.token.eq(TK.Colon) || this.prev_token.is_keyword(kw.Raw);

  // Check to see if the user has written something like
  //
  //    if (cond)
  //      bar;
  //
  // which is valid in other languages, but not Rust.
  const r = this.parse_stmt_without_recovery(false, ForceCollect.No, false);
  // If the next token is an open brace, e.g., we have:
  //
  //     if expr other_expr {
  //        ^    ^          ^- lookahead(1) is a brace
  //        |    |- current token is not "else"
  //        |- (statement we just parsed)
  //
  // the place-inside-a-block suggestion would be more likely wrong than right.
  //
  // FIXME(compiler-errors): this should probably parse an arbitrary expr and not
  // just lookahead one token, so we can see if there's a brace after _that_,
  // since we want to protect against:
  //     `if 1 1 + 1 {` being suggested as  `if { 1 } 1 + 1 {`
  //                                            +   +
  if (
    r.$ === "Ok" &&
    ((!this.token.is_keyword(kw.Else) && this.look_ahead(1, (t) => t.eq(TK.OpenBrace))) || do_not_suggest_help)
  ) {
    // nothing
  }
  // Do not suggest `if foo println!("") {;}` (as would be seen in test for #46836).
  else if (r.$ === "Ok" && r._0.kind.$ === "Empty") {
    // nothing
  } else if (r.$ === "Ok") {
    const stmt = r._0;
    const stmt_own_line = this.psess.source_map().is_line_before_span_empty(sp);
    let stmt_span: Span;
    if (stmt_own_line && this.eat(exp.Semi)) {
      // Expand the span to include the semicolon.
      stmt_span = Span.with_hi(stmt.span, Span.hi(this.prev_token.span));
    } else {
      stmt_span = stmt.span;
    }
    this.suggest_fixes_misparsed_for_loop_head(err, Span.between(prev, sp), stmt_span, stmt.kind);
  } else {
    const e = r._0;
    e.delay_as_bug();
  }
  return err;
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:604 suggest_fixes_misparsed_for_loop_head
Parser.prototype.suggest_fixes_misparsed_for_loop_head = function (
  this: Parser,
  e: Diag,
  between: Span,
  stmt_span: Span,
  stmt_kind: StmtKind,
): void {
  const tk = this.token.kind;
  const expr = stmt_kind.$ === "Expr" ? stmt_kind._0 : undefined;
  if (tk.$ === "OpenBrace" && expr !== undefined && expr.kind.$ === "Call") {
    // for _ in x y() {}
    e.span_suggestion_verbose(between, "you might have meant to write a method call", ".", Applicability.MaybeIncorrect);
  } else if (tk.$ === "OpenBrace" && expr !== undefined && expr.kind.$ === "Field") {
    // for _ in x y.z {}
    e.span_suggestion_verbose(between, "you might have meant to write a field access", ".", Applicability.MaybeIncorrect);
  } else if (
    tk.$ === "CloseBrace" &&
    expr !== undefined &&
    expr.kind.$ === "Struct" &&
    expr.kind._0.qself === undefined &&
    expr.kind._0.path.segments.length === 1
  ) {
    // This is specific to "mistyped `if` condition followed by empty body"
    //
    // for _ in x y {}
    e.span_suggestion_verbose(between, "you might have meant to write a field access", ".", Applicability.MaybeIncorrect);
  } else if (
    tk.$ === "OpenBrace" &&
    expr !== undefined &&
    expr.kind.$ === "Lit" &&
    expr.kind._0.suffix === undefined &&
    (expr.kind._0.kind.$ === "Integer" || expr.kind._0.kind.$ === "Float")
  ) {
    // for _ in x 0 {}
    // for _ in x 0.0 {}
    e.span_suggestion_verbose(between, `you might have meant to write a field access`, ".", Applicability.MaybeIncorrect);
  } else if (
    tk.$ === "OpenBrace" &&
    expr !== undefined &&
    (expr.kind.$ === "Loop" ||
      expr.kind.$ === "If" ||
      expr.kind.$ === "While" ||
      expr.kind.$ === "Match" ||
      expr.kind.$ === "ForLoop" ||
      expr.kind.$ === "TryBlock" ||
      expr.kind.$ === "Ret" ||
      expr.kind.$ === "Closure" ||
      expr.kind.$ === "Struct" ||
      expr.kind.$ === "Try")
  ) {
    // These are more likely to have been meant as a block body.
    e.multipart_suggestion(
      "you might have meant to write this as part of a block",
      [
        [Span.shrink_to_lo(stmt_span), "{ "],
        [Span.shrink_to_hi(stmt_span), " }"],
      ],
      // Speculative; has been misleading in the past (#46836).
      Applicability.MaybeIncorrect,
    );
  } else if (tk.$ === "OpenBrace") {
    // nothing
  } else {
    e.multipart_suggestion(
      "you might have meant to write this as part of a block",
      [
        [Span.shrink_to_lo(stmt_span), "{ "],
        [Span.shrink_to_hi(stmt_span), " }"],
      ],
      // Speculative; has been misleading in the past (#46836).
      Applicability.MaybeIncorrect,
    );
  }
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:697 error_block_no_opening_brace
Parser.prototype.error_block_no_opening_brace = function <T>(this: Parser): PResult<T> {
  const tok = token_descr(this.token);
  const msg = `expected \`{\`, found ${tok}`;
  return Err(this.error_block_no_opening_brace_msg(msg));
};

/// Parses a block. Inner attributes are allowed, block labels are not.
///
/// If `loop_header` is `Some` and an unexpected block label is encountered,
/// it is suggested to be moved just before `loop_header`, else it is suggested to be removed.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:707 parse_inner_attrs_and_block
Parser.prototype.parse_inner_attrs_and_block = function (this: Parser, loop_header: Span | undefined): PResult<[AttrVec, Block]> {
  return this.parse_block_common(this.token.span, ast.BlockCheckMode.Default, loop_header);
};

/// Parses a block. Inner attributes are allowed, block labels are not.
///
/// If `loop_header` is `Some` and an unexpected block label is encountered,
/// it is suggested to be moved just before `loop_header`, else it is suggested to be removed.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:718 parse_block_common
Parser.prototype.parse_block_common = function (
  this: Parser,
  lo: Span,
  blk_mode: BlockCheckMode,
  loop_header: Span | undefined,
): PResult<[AttrVec, Block]> {
  const block = this.eat_metavar_seq(token.MetaVarKind.Block, (this_) => this_.parse_block());
  if (block !== undefined) {
    return Ok([[], block]);
  }

  const maybe_ident = this.prev_token;
  this.maybe_recover_unexpected_block_label(loop_header);
  if (!this.eat(exp.OpenBrace)) {
    return this.error_block_no_opening_brace();
  }

  const ra = this.parse_inner_attributes();
  if (ra.$ === "Err") return ra;
  const attrs = ra._0;
  let tail: Block;
  const s = this.maybe_suggest_struct_literal(lo, blk_mode, maybe_ident);
  if (s !== undefined) {
    if (s.$ === "Err") return s;
    tail = s._0;
  } else {
    const r = this.parse_block_tail(lo, blk_mode, AttemptLocalParseRecovery.Yes);
    if (r.$ === "Err") return r;
    tail = r._0;
  }
  return Ok([attrs, tail]);
};

/// Parses the rest of a block expression or function body.
/// Precondition: already parsed the '{'.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:744 parse_block_tail
Parser.prototype.parse_block_tail = function (
  this: Parser,
  lo: Span,
  s: BlockCheckMode,
  recover: AttemptLocalParseRecovery,
): PResult<Block> {
  const stmts: Stmt[] = [];
  let snapshot: ReturnType<Parser["create_snapshot_for_diagnostic"]> | undefined = undefined;
  while (!this.eat(exp.CloseBrace)) {
    if (this.token.eq(TK.Eof)) {
      break;
    }
    if (this.is_vcs_conflict_marker(TK.Shl, TK.Lt)) {
      // Account for `<<<<<<<` diff markers. We can't proactively error here because
      // that can be a valid path start, so we snapshot and reparse only we've
      // encountered another parse error.
      snapshot = this.create_snapshot_for_diagnostic();
    }
    let stmt: Stmt;
    const r = this.parse_full_stmt(recover);
    if (r.$ === "Err" && AttemptLocalParseRecovery.yes(recover)) {
      const err = r._0;
      if (snapshot !== undefined) {
        snapshot.parser.recover_vcs_conflict_marker();
      }
      if (this.token.eq(TK.Colon)) {
        // if a previous and next token of the current one is
        // integer literal (e.g. `1:42`), it's likely a range
        // expression for Pythonistas and we can suggest so.
        if (this.prev_token.is_integer_lit() && this.may_recover() && this.look_ahead(1, (token_) => token_.is_integer_lit())) {
          // FIXME(hkmatsumoto): Might be better to trigger
          // this only when parsing an index expression.
          err.span_suggestion_verbose(this.token.span, "you might have meant a range expression", "..", Applicability.MaybeIncorrect);
        } else {
          // if next token is following a colon, it's likely a path
          // and we can suggest a path separator
          this.bump();
          if (Span.lo(this.token.span) === Span.hi(this.prev_token.span)) {
            err.span_suggestion_verbose(this.prev_token.span, "maybe write a path separator here", "::", Applicability.MaybeIncorrect);
          }
        }
      }

      const guar = err.emit_err();
      this.recover_stmt_(SemiColonMode.Ignore, BlockMode.Ignore);
      stmt = this.mk_stmt_err(this.token.span, guar);
    } else if (r.$ === "Ok") {
      stmt = r._0;
    } else {
      return r;
    }
    stmts.push(stmt);
  }
  return Ok(this.mk_block(stmts, s, Span.to(lo, this.prev_token.span)));
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:810 recover_missing_let_else
Parser.prototype.recover_missing_let_else = function (this: Parser, err: Diag, pat: Pat, stmt_span: Span): void {
  if (this.token.kind.$ !== "OpenBrace") {
    return;
  }
  switch (pat.kind.$) {
    case "Ident":
    case "Missing":
    case "Wild":
      // Not if let or let else
      return;
    default:
      break;
  }
  const snapshot = this.create_snapshot_for_diagnostic();
  const block_span = this.token.span;
  let if_let: boolean;
  let let_else: boolean;
  const rb = this.parse_block();
  if (rb.$ === "Ok") {
    const block = rb._0;
    const idents: Ident[] = [];
    pat.walk((pat: Pat) => {
      if (pat.kind.$ === "Ident") {
        const ident = pat.kind._1;
        idents.push(ident);
      }
      return true;
    });

    // PORT: the fn-local `struct IdentFinder` (default field values) and its `impl Visitor`.
    class IdentFinder extends visit.Visitor {
      /// If a block references one of the bindings introduced by the let pattern,
      /// we likely meant to use `if let`.
      /// This is pre-expansion, so if we encounter
      /// `let Some(x) = foo() { println!("{x}") }` we won't find it.
      references_ident = false;
      /// If a block has a `return`, then we know with high certainty that it was
      /// meant to be let-else.
      has_return = false;
      constructor(public idents: Ident[]) {
        super();
      }

      // rustc: compiler/rustc_parse/src/parser/stmt.rs:846 visit_ident
      override visit_ident(ident: Ident): undefined {
        for (const i of this.idents) {
          if (ident.name === i.name) {
            this.references_ident = true;
          }
        }
        return undefined;
      }
      // rustc: compiler/rustc_parse/src/parser/stmt.rs:853 visit_expr
      override visit_expr(node: Expr): undefined {
        if (node.kind.$ === "Ret") {
          this.has_return = true;
        }
        visit.walk_expr(this, node);
        return undefined;
      }
    }

    // Collect all bindings in pattern and see if they appear in the block. Likely meant
    // to write `if let`. See if the block has a return. Likely meant to write
    // `let else`.
    const visitor = new IdentFinder(idents);
    visitor.visit_block(block);

    [if_let, let_else] = [visitor.references_ident, visitor.has_return];
  } else {
    const e = rb._0;
    e.cancel();
    this.restore_snapshot(snapshot);
    [if_let, let_else] = [false, false];
  }

  let alternatively = "";
  if (if_let || !let_else) {
    alternatively = "alternatively, ";
    err.span_suggestion_verbose(
      Span.shrink_to_lo(stmt_span),
      "you might have meant to use `if let`",
      "if ",
      if_let ? Applicability.MachineApplicable : Applicability.MaybeIncorrect,
    );
  }
  if (let_else || !if_let) {
    err.span_suggestion_verbose(
      Span.shrink_to_lo(block_span),
      `${alternatively}you might have meant to use \`let...else\``,
      "else ",
      let_else ? Applicability.MachineApplicable : Applicability.MaybeIncorrect,
    );
  }
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:904 recover_missing_dot
Parser.prototype.recover_missing_dot = function (this: Parser, err: Diag): void {
  const id = this.token.ident();
  if (id === undefined) {
    return;
  }
  const [ident] = id;
  const c = [...ident.as_str()][0];
  if (c !== undefined && is_uppercase(c.codePointAt(0)!)) {
    return;
  }
  if (this.token.is_reserved_ident() && !this.token.is_ident_named(kw.Await)) {
    return;
  }
  if (this.prev_token.is_reserved_ident() && this.prev_token.is_ident_named(kw.Await)) {
    // Likely `foo.await bar`
  } else if (this.prev_token.is_non_reserved_ident()) {
    // Likely `foo bar`
  } else if (this.prev_token.kind.$ === "Question") {
    // `foo? bar`
  } else if (this.prev_token.kind.$ === "CloseParen") {
    // `foo() bar`
  } else {
    return;
  }
  if (this.token.span === this.prev_token.span) {
    // Account for syntax errors in proc-macros.
    return;
  }
  if (this.look_ahead(1, (t) => [TK.Semi, TK.Question, TK.Dot].some((k) => token.TokenKind_eq(k, t.kind)))) {
    err.span_suggestion_verbose(
      Span.between(this.prev_token.span, this.token.span),
      "you might have meant to write a field access",
      ".",
      Applicability.MaybeIncorrect,
    );
  }
  if (this.look_ahead(1, (t) => t.kind.$ === "OpenParen")) {
    err.span_suggestion_verbose(
      Span.between(this.prev_token.span, this.token.span),
      "you might have meant to write a method call",
      ".",
      Applicability.MaybeIncorrect,
    );
  }
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:949 try_recover_let_missing_semi
Parser.prototype.try_recover_let_missing_semi = function (this: Parser, local: Local): ErrorGuaranteed | undefined {
  const k = local.kind;
  let expr: Expr;
  switch (k.$) {
    case "Init":
    case "InitElse":
      expr = k._0;
      break;
    case "Decl":
      return undefined;
  }
  const r = this.missing_semi_from_binop("`let` binding", expr, Span.shrink_to_lo(local.span));
  if (r !== undefined) {
    const [span, guar] = r;
    this.fn_body_missing_semi_guar = guar;
    // PORT: `*expr = ..` writes the new expression into `local.kind`.
    k._0 = this.mk_expr(span, { $: "Err", _0: guar });
    return guar;
  }
  return undefined;
};

/// Parses a statement, including the trailing semicolon.
// rustc: compiler/rustc_parse/src/parser/stmt.rs:965 parse_full_stmt
Parser.prototype.parse_full_stmt = function (this: Parser, recover: AttemptLocalParseRecovery): PResult<Stmt> {
  // Skip looking for a trailing semicolon when we have a metavar seq.
  const nt = this.eat_metavar_seq(token.MetaVarKind.Stmt, (this_) => {
    // Why pass `true` for `force_full_expr`? Statement expressions are less expressive
    // than "full" expressions, due to the `STMT_EXPR` restriction, and sometimes need
    // parentheses. E.g. the "full" expression `match paren_around_match {} | true` when
    // used in statement context must be written `(match paren_around_match {} | true)`.
    // However, if the expression we are parsing in this statement context was pasted by a
    // declarative macro, it may have come from a "full" expression context, and lack
    // these parentheses. So we lift the `STMT_EXPR` restriction to ensure the statement
    // will reparse successfully.
    return this_.parse_stmt_without_recovery(false, ForceCollect.No, true);
  });
  if (nt !== undefined) {
    return Ok(nt);
  }

  const rs = this.parse_stmt_without_recovery(true, ForceCollect.No, false);
  if (rs.$ === "Err") return rs;
  let stmt = rs._0;

  let eat_semi = true;
  let add_semi_to_stmt = false;

  const kind = stmt.kind;
  const tk = this.token.kind.$;
  if (
    kind.$ === "Expr" &&
    expr_requires_semi_to_be_stmt(kind._0) &&
    kind._0.attrs.length !== 0 &&
    !(tk === "Eof" || tk === "Semi" || tk === "CloseBrace")
  ) {
    // Expression without semicolon.
    const expr = kind._0;
    // The user has written `#[attr] expr` which is unsupported. (#106020)
    const guar = this.attr_on_non_tail_expr(expr);
    // We already emitted an error, so don't emit another type error
    const sp = Span.to(expr.span, this.prev_token.span);
    kind._0 = this.mk_expr_err(sp, guar);
  } else if (kind.$ === "Expr" && !this.token.eq(TK.Eof) && expr_requires_semi_to_be_stmt(kind._0)) {
    // Expression without semicolon.
    // Just check for errors and recover; do not eat semicolon yet.

    let expect_result: PResult<ast.Recovered>;
    const rt = this.maybe_recover_from_ternary_operator(kind._0.span);
    if (rt.$ === "Err") {
      expect_result = Err(rt._0);
    } else {
      expect_result = this.expect_one_of([], [exp.Semi, exp.CloseBrace]);
    }

    // Try to both emit a better diagnostic, and avoid further errors by replacing
    // the `expr` with `ExprKind::Err`.
    let replace_with_err: ErrorGuaranteed | undefined;
    break_recover: {
      if (expect_result.$ === "Ok" && expect_result._0.$ === "No") {
        replace_with_err = undefined;
      } else if (expect_result.$ === "Ok" && expect_result._0.$ === "Yes") {
        const guar = expect_result._0._0;
        // Skip type error to avoid extra errors.
        replace_with_err = guar;
      } else if (expect_result.$ === "Err") {
        const e = expect_result._0;
        if (this.recover_colon_as_semi()) {
          // recover_colon_as_semi has already emitted a nicer error.
          e.delay_as_bug();
          add_semi_to_stmt = true;
          eat_semi = false;

          replace_with_err = undefined;
          break break_recover;
        }

        const ek = kind._0.kind;
        if (
          this.token.eq(TK.Colon) &&
          ek.$ === "Path" &&
          ek._0 === undefined &&
          ek._1.segments.length === 1 &&
          this.look_ahead(1, (t) => {
            if (t.is_metavar_block() || t.kind.$ === "OpenBrace") return true;
            const ident = t.non_raw_ident();
            return ident !== undefined && (ident.name === kw.For || ident.name === kw.Loop || ident.name === kw.While);
          })
        ) {
          const segment = ek._1.segments[0]!;
          const snapshot = this.create_snapshot_for_diagnostic();
          const label: Label = {
            ident: Ident.from_str_and_span(`'${display_Ident(segment.ident)}`, segment.ident.span),
          };
          const rl = this.parse_expr_labeled(label, false);
          if (rl.$ === "Ok") {
            const labeled_expr = rl._0;
            e.cancel();
            this.dcx().emit_err(
              diagnostics.MalformedLoopLabel_diagnostic({
                span: label.ident.span,
                suggestion: Span.shrink_to_lo(label.ident.span),
              }),
            );
            kind._0 = labeled_expr;
            replace_with_err = undefined;
            break break_recover;
          } else {
            const err = rl._0;
            err.cancel();
            this.restore_snapshot(snapshot);
          }
        }

        const res = this.check_mistyped_turbofish_with_multiple_type_params(e, field_mut(kind, "_0"));

        if (AttemptLocalParseRecovery.no(recover)) {
          if (res.$ === "Err") return res;
          replace_with_err = res._0;
        } else {
          if (res.$ === "Ok") {
            replace_with_err = res._0;
          } else {
            const e2 = res._0;
            this.recover_missing_dot(e2);
            const guar = e2.emit_err();
            this.recover_stmt();
            replace_with_err = guar;
          }
        }
      }
    }

    if (replace_with_err !== undefined) {
      const guar = replace_with_err;
      // We already emitted an error, so don't emit another type error
      const sp = Span.to(kind._0.span, this.prev_token.span);
      kind._0 = this.mk_expr_err(sp, guar);
    }
  } else if (kind.$ === "Expr" || kind.$ === "MacCall") {
    // nothing
  } else if (kind.$ === "Let") {
    const local = kind._0;
    if (this.try_recover_let_missing_semi(local) !== undefined) {
      return Ok(stmt);
    }
    const rsemi = this.expect_semi();
    if (rsemi.$ === "Err") {
      const e = rsemi._0;
      // We might be at the `,` in `let x = foo<bar, baz>;`. Try to recover.
      const lk = local.kind;
      switch (lk.$) {
        case "Init":
        case "InitElse": {
          const rt = this.check_mistyped_turbofish_with_multiple_type_params(e, field_mut(lk, "_0"));
          if (rt.$ === "Err") {
            const e2 = rt._0;
            this.recover_missing_dot(e2);
            this.recover_missing_let_else(e2, local.pat, stmt.span);
            return Err(e2);
          }
          // We found `foo<bar, baz>`, have we fully recovered?
          const rs2 = this.expect_semi();
          if (rs2.$ === "Err") return rs2;
          break;
        }
        case "Decl": {
          if (local.colon_sp !== undefined) {
            const colon_sp = local.colon_sp;
            const d = local.pat.descr();
            e.span_label(colon_sp, `while parsing the type for ${d === undefined ? "the binding" : `\`${d}\``}`);
            let suggest_eq: boolean;
            let op: ReturnType<Parser["check_assoc_op"]>;
            if (this.token.eq(TK.Dot) && (this.bump(), true) && suggest_eq_dot_suffix(this, colon_sp)) {
              suggest_eq = true;
            } else if (
              (op = this.check_assoc_op()) !== undefined &&
              op_can_continue_stmt_expr_unambiguously(op.node)
            ) {
              suggest_eq = true;
            } else {
              suggest_eq = false;
            }
            if (suggest_eq && local.ty !== undefined) {
              const ty = local.ty;
              e.span_suggestion_verbose(
                Span.between(local.pat.span, ty.span),
                "use `=` if you meant to assign",
                " = ",
                Applicability.MaybeIncorrect,
              );
            }
          }
          return Err(e);
        }
      }
    }
    eat_semi = false;
  } else {
    // StmtKind::Empty | StmtKind::Item(_) | StmtKind::Semi(_)
    eat_semi = false;
  }

  if (add_semi_to_stmt || (eat_semi && this.eat(exp.Semi))) {
    stmt = stmt.add_trailing_semicolon();
  }

  stmt.span = Span.to(stmt.span, this.prev_token.span);
  return Ok(stmt);
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:1169 mk_block
Parser.prototype.mk_block = function (this: Parser, stmts: Stmt[], rules: BlockCheckMode, span: Span): Block {
  return { stmts, id: ast.DUMMY_NODE_ID, rules, span };
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:1178 mk_stmt
Parser.prototype.mk_stmt = function (this: Parser, span: Span, kind: StmtKind): Stmt {
  return new ast.Stmt(ast.DUMMY_NODE_ID, kind, span);
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:1182 mk_stmt_err
Parser.prototype.mk_stmt_err = function (this: Parser, span: Span, guar: ErrorGuaranteed): Stmt {
  return this.mk_stmt(span, { $: "Expr", _0: this.mk_expr_err(span, guar) });
};

// rustc: compiler/rustc_parse/src/parser/stmt.rs:1186 mk_block_err
Parser.prototype.mk_block_err = function (this: Parser, span: Span, guar: ErrorGuaranteed): Block {
  return this.mk_block([this.mk_stmt_err(span, guar)], ast.BlockCheckMode.Default, span);
};

// ---- local helpers (no upstream fn) ----

/// PORT: the value moved out by `mem::replace(self, ..)`: a fresh `Parser` holding `p`'s current
/// fields (a move, so sharing the field values is exact; `p` is overwritten right after).
function move_parser(p: Parser): Parser {
  return Object.assign(Object.create(Parser.prototype) as Parser, p);
}

/// PORT: the `let _ = self.bump() && let mut snapshot = .. && let Ok(_) = snapshot.parse_dot_suffix_expr(..)`
/// tail of the `suggest_eq` condition in `parse_full_stmt` (stmt.rs:1120-1134), after the bump.
function suggest_eq_dot_suffix(this_: Parser, colon_sp: Span): boolean {
  const snapshot = this_.create_snapshot_for_diagnostic();
  const r = snapshot.parser.parse_dot_suffix_expr(
    colon_sp,
    this_.mk_expr_err(colon_sp, this_.dcx().delayed_bug("error during `:` -> `=` recovery")),
  );
  if (r.$ === "Err") {
    r._0.cancel();
    return false;
  }
  return true;
}
