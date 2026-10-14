// Port of compiler/rustc_ast_lowering/src/contract.rs
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { BindingMode, type AttrVec, type Expr as AstExpr, type FnContract } from "../rustc_ast/lib.ts";
import { LangItem } from "../rustc_attr_ir/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Ident, sym } from "../rustc_span/symbol.ts";
import { LoweringContext } from "./decls.ts";
import type * as hir from "./hir_shim.ts";
import { ALLOW_CONTRACTS } from "./lib.ts";

/// Lowered contracts are guarded with the `contract_checks` compiler flag,
/// i.e. the flag turns into a boolean guard in the lowered HIR. The reason
/// for not eliminating the contract code entirely when the `contract_checks`
/// flag is disabled is so that contracts can be type checked, even when
/// they are disabled, which avoids them becoming stale (i.e. out of sync
/// with the codebase) over time.
///
/// The optimiser should be able to eliminate all contract code guarded
/// by `if false`, leaving the original body intact when runtime contract
/// checks are disabled.
// rustc: compiler/rustc_ast_lowering/src/contract.rs:21 lower_contract
LoweringContext.prototype.lower_contract = function (
  this: LoweringContext,
  body: (this_: LoweringContext) => hir.Expr,
  contract: FnContract,
): hir.Expr {
  // The order in which things are lowered is important! I.e to
  // refer to variables in contract_decls from postcond/precond,
  // we must lower it first!
  const contract_decls = this.lower_decls(contract);

  const req = contract.requires;
  const ens = contract.ensures;
  if (req !== undefined && ens !== undefined) {
    // Lower the fn contract, which turns:
    //
    // { body }
    //
    // into:
    //
    // let __postcond = if contract_checks {
    //     CONTRACT_DECLARATIONS;
    //     contract_check_requires(PRECOND);
    //     Some(|ret_val| POSTCOND)
    // } else {
    //     None
    // };
    // {
    //     let ret = { body };
    //
    //     if contract_checks {
    //         contract_check_ensures(__postcond, ret)
    //     } else {
    //         ret
    //     }
    // }

    const precond = this.lower_precond(req);
    const postcond_checker = this.lower_postcond_checker(ens);

    const contract_check = this.lower_contract_check_with_postcond(contract_decls, precond, postcond_checker);

    const wrapped_body = this.wrap_body_with_contract_check(body, contract_check, postcond_checker.span);
    return this.expr_block(wrapped_body);
  } else if (req === undefined && ens !== undefined) {
    // Lower the fn contract, which turns:
    //
    // { body }
    //
    // into:
    //
    // let __postcond = if contract_checks {
    //     Some(|ret_val| POSTCOND)
    // } else {
    //     None
    // };
    // {
    //     let ret = { body };
    //
    //     if contract_checks {
    //         CONTRACT_DECLARATIONS;
    //         contract_check_ensures(__postcond, ret)
    //     } else {
    //         ret
    //     }
    // }
    const postcond_checker = this.lower_postcond_checker(ens);
    const contract_check = this.lower_contract_check_with_postcond(contract_decls, undefined, postcond_checker);

    const wrapped_body = this.wrap_body_with_contract_check(body, contract_check, postcond_checker.span);
    return this.expr_block(wrapped_body);
  } else if (req !== undefined && ens === undefined) {
    // Lower the fn contract, which turns:
    //
    // { body }
    //
    // into:
    //
    // {
    //      if contracts_checks {
    //          CONTRACT_DECLARATIONS;
    //          contract_requires(PRECOND);
    //      }
    //      body
    // }
    const precond = this.lower_precond(req);
    const precond_check = this.lower_contract_check_just_precond(contract_decls, precond);

    const body_ = this.arena.alloc(body(this));

    // Flatten the body into precond check, then body.
    const wrapped_body = this.block_all(body_.span, this.arena.alloc_from_iter([precond_check]), body_);
    return this.expr_block(wrapped_body);
  } else {
    return body(this);
  }
};

// rustc: compiler/rustc_ast_lowering/src/contract.rs:130 lower_decls
LoweringContext.prototype.lower_decls = function (this: LoweringContext, contract: FnContract): readonly hir.Stmt[] {
  const [decls, decls_tail] = this.lower_stmts(contract.declarations);

  if (decls_tail !== undefined) {
    const e = decls_tail;
    // include the tail expression in the declaration statements
    // PORT: `*e` copies a `Copy` HIR node; HIR copies are identity (hir-visit decision).
    const tail = this.stmt_expr(e.span, e);
    return this.arena.alloc_from_iter([...decls, tail]);
  } else {
    return decls;
  }
};

/// Lower the precondition check intrinsic.
// rustc: compiler/rustc_ast_lowering/src/contract.rs:143 lower_precond
LoweringContext.prototype.lower_precond = function (this: LoweringContext, req: AstExpr): hir.Stmt {
  const lowered_req = this.lower_expr_mut(req);
  const req_span = this.mark_span_with_reason(DesugaringKind.Contract, lowered_req.span, ALLOW_CONTRACTS);
  const precond = this.expr_call_lang_item_fn_mut(req_span, LangItem.ContractCheckRequires, [lowered_req]);
  return this.stmt_expr(req.span, precond);
};

// rustc: compiler/rustc_ast_lowering/src/contract.rs:158 lower_postcond_checker
LoweringContext.prototype.lower_postcond_checker = function (this: LoweringContext, ens: AstExpr): hir.Expr {
  const ens_span_ = this.lower_span(ens.span);
  const ens_span = this.mark_span_with_reason(DesugaringKind.Contract, ens_span_, ALLOW_CONTRACTS);
  const lowered_ens = this.lower_expr_mut(ens);
  return this.expr_call_lang_item_fn(ens_span, LangItem.ContractBuildCheckEnsures, [lowered_ens]);
};

// rustc: compiler/rustc_ast_lowering/src/contract.rs:176 lower_contract_check_just_precond
LoweringContext.prototype.lower_contract_check_just_precond = function (
  this: LoweringContext,
  contract_decls: readonly hir.Stmt[],
  precond: hir.Stmt,
): hir.Stmt {
  const stmts = this.arena.alloc_from_iter([...contract_decls, precond]);

  const then_block_stmts = this.block_all(precond.span, stmts, undefined);
  const then_block = this.arena.alloc(this.expr_block(then_block_stmts));

  const precond_check_: hir.ExprKind = {
    $: "If",
    _0: this.arena.alloc(this.expr_bool_literal(precond.span, this.tcx.sess.contract_checks())),
    _1: then_block,
    _2: undefined,
  };

  const precond_check = this.expr(precond.span, precond_check_);
  return this.stmt_expr(precond.span, precond_check);
};

// rustc: compiler/rustc_ast_lowering/src/contract.rs:198 lower_contract_check_with_postcond
LoweringContext.prototype.lower_contract_check_with_postcond = function (
  this: LoweringContext,
  contract_decls: readonly hir.Stmt[],
  precond: hir.Stmt | undefined,
  postcond_checker_: hir.Expr,
): hir.Expr {
  const stmts = this.arena.alloc_from_iter(precond !== undefined ? [...contract_decls, precond] : [...contract_decls]);
  const span = precond !== undefined ? precond.span : postcond_checker_.span;

  // PORT: `*postcond_checker` copies a `Copy` HIR node; HIR copies are identity (hir-visit decision).
  const postcond_checker = this.arena.alloc(
    this.expr_enum_variant_lang_item(postcond_checker_.span, LangItem.OptionSome, [postcond_checker_]),
  );
  const then_block_stmts = this.block_all(span, stmts, postcond_checker);
  const then_block = this.arena.alloc(this.expr_block(then_block_stmts));

  const none_expr = this.arena.alloc(this.expr_enum_variant_lang_item(postcond_checker.span, LangItem.OptionNone, []));
  const else_block_ = this.block_expr(none_expr);
  const else_block = this.arena.alloc(this.expr_block(else_block_));

  const contract_check: hir.ExprKind = {
    $: "If",
    _0: this.arena.alloc(this.expr_bool_literal(span, this.tcx.sess.contract_checks())),
    _1: then_block,
    _2: else_block,
  };
  return this.arena.alloc(this.expr(span, contract_check));
};

// rustc: compiler/rustc_ast_lowering/src/contract.rs:236 wrap_body_with_contract_check
LoweringContext.prototype.wrap_body_with_contract_check = function (
  this: LoweringContext,
  body: (this_: LoweringContext) => hir.Expr,
  contract_check: hir.Expr,
  postcond_span: Span,
): hir.Block {
  const check_ident: Ident = Ident.new(sym.__ensures_checker, postcond_span);
  let check_hir_id: HirId;
  let postcond_decl: hir.Stmt;
  {
    // Set up the postcondition `let` statement.
    const [checker_pat, check_hir_id_] = this.pat_ident_binding_mode_mut(postcond_span, check_ident, BindingMode.NONE);
    check_hir_id = check_hir_id_;
    postcond_decl = this.stmt_let_pat(undefined, postcond_span, contract_check, this.arena.alloc(checker_pat), "Contract");
  }

  // Install contract_ensures so we will intercept `return` statements,
  // then lower the body.
  this.contract_ensures = [postcond_span, check_ident, check_hir_id];
  const body_ = this.arena.alloc(body(this));

  // Finally, inject an ensures check on the implicit return of the body.
  const body_checked = this.inject_ensures_check(body_, postcond_span, check_ident, check_hir_id);

  // Flatten the body into precond, then postcond, then wrapped body.
  const wrapped_body = this.block_all(body_checked.span, this.arena.alloc_from_iter([postcond_decl]), body_checked);
  return wrapped_body;
};

/// Create an `ExprKind::Ret` that is optionally wrapped by a call to check
/// a contract ensures clause, if it exists.
// rustc: compiler/rustc_ast_lowering/src/contract.rs:282 checked_return
LoweringContext.prototype.checked_return = function (this: LoweringContext, opt_expr: hir.Expr | undefined): hir.ExprKind {
  let checked_ret: hir.Expr | undefined;
  if (this.contract_ensures !== undefined) {
    const [check_span, check_ident, check_hir_id] = this.contract_ensures;
    const expr = opt_expr !== undefined ? opt_expr : this.expr_unit(check_span);
    checked_ret = this.inject_ensures_check(expr, check_span, check_ident, check_hir_id);
  } else {
    checked_ret = opt_expr;
  }
  return { $: "Ret", _0: checked_ret };
};

/// Wraps an expression with a call to the ensures check before it gets returned.
// rustc: compiler/rustc_ast_lowering/src/contract.rs:297 inject_ensures_check
LoweringContext.prototype.inject_ensures_check = function (
  this: LoweringContext,
  expr: hir.Expr,
  span: Span,
  cond_ident: Ident,
  cond_hir_id: HirId,
): hir.Expr {
  // {
  //     let ret = { body };
  //
  //     if contract_checks {
  //         contract_check_ensures(__postcond, ret)
  //     } else {
  //         ret
  //     }
  // }
  const ret_ident: Ident = Ident.new(sym.__ret, span);

  // Set up the return `let` statement.
  const [ret_pat, ret_hir_id] = this.pat_ident_binding_mode_mut(span, ret_ident, BindingMode.NONE);

  const ret_stmt = this.stmt_let_pat(undefined, span, expr, this.arena.alloc(ret_pat), "Contract");

  const ret = this.expr_ident(span, ret_ident, ret_hir_id);

  const cond_fn = this.expr_ident(span, cond_ident, cond_hir_id);
  // PORT: `*cond_fn, *ret` copy `Copy` HIR nodes; HIR copies are identity (hir-visit decision).
  const contract_check_ = this.expr_call_lang_item_fn_mut(span, LangItem.ContractCheckEnsures, [cond_fn, ret]);
  const contract_check__ = this.arena.alloc(contract_check_);
  const call_expr = this.block_expr_block(contract_check__);

  // same ident can't be used in 2 places, so we create a new one for the
  // else branch
  const ret2 = this.expr_ident(span, ret_ident, ret_hir_id);
  const ret_block = this.block_expr_block(ret2);

  const contracts_enabled: hir.Expr = this.expr_bool_literal(span, this.tcx.sess.contract_checks());
  const contract_check = this.arena.alloc(
    this.expr(span, { $: "If", _0: this.arena.alloc(contracts_enabled), _1: call_expr, _2: ret_block }),
  );

  const attrs: AttrVec = [this.unreachable_code_attr(span)];
  this.lower_attrs(contract_check.hir_id, attrs, span, Target.Expression);

  const ret_block2 = this.block_all(span, [ret_stmt], contract_check);
  return this.arena.alloc(this.expr_block(this.arena.alloc(ret_block2)));
};
