// Port of compiler/rustc_mir_build/src/builder/expr/stmt.rs (declared by lane builder-contract, filled by lane mb-expr-a,
// plan-m4 wave 22; builder/mod.ts's header has the representation notes).
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type Scope as region_Scope } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, BinOp_from_AssignOp, type Local, type Operand, type Place, type Rvalue } from "../../../rustc_middle/mir/mod.ts";
import { debug_Expr, type ExprId } from "../../../rustc_middle/thir.ts";
import { type Span, type Spanned } from "../../../rustc_span/lib.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { assert } from "../../../std/panic.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Builder, type BlockAnd, BlockAnd as BlockAndC, BlockFrame, unit } from "../mod.ts";
import { type BreakableTarget } from "../scope.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    stmt_expr(block: BasicBlock, expr_id: ExprId, statement_scope: region_Scope | undefined): BlockAnd<null>;
  }
}

/// Builds a block of MIR statements to evaluate the THIR `expr`.
///
/// The `statement_scope` is used if a statement temporary must be dropped.
// rustc: compiler/rustc_mir_build/src/builder/expr/stmt.rs:14 stmt_expr
Builder.prototype.stmt_expr = function (this: Builder, block: BasicBlock, expr_id: ExprId, statement_scope: region_Scope | undefined): BlockAnd<null> {
  const expr = this.thir.index_ExprId(expr_id);
  const expr_span = expr.span;
  const source_info = this.source_info(expr.span);
  // Handle a number of expressions that don't need a destination at all. This
  // avoids needing a mountain of temporary `()` variables.
  const kind = expr.kind;
  switch (kind.$) {
    case "Scope": {
      const { region_scope, hir_id, value } = kind;
      return this.in_scope([region_scope, source_info], { $: "Explicit", _0: hir_id }, (this_) => {
        this_.push_coverage_point_for_expr(block, source_info, hir_id);
        return this_.stmt_expr(block, value, statement_scope);
      });
    }
    case "Assign": {
      const { lhs, rhs } = kind;
      const lhs_expr = this.thir.index_ExprId(lhs);

      // Note: we evaluate assignments right-to-left. This
      // is better for borrowck interaction with overloaded
      // operators like x[j] = x[i].

      // debug!("stmt_expr Assign block_context.push(SubExpr) : {:?}", expr);
      this.block_context.push(BlockFrame.SubExpr);

      // Generate better code for things that don't need to be
      // dropped.
      if (lhs_expr.ty.needs_drop(this.tcx, this.typing_env())) {
        let rhs_: Rvalue;
        [block, rhs_] = this.as_local_rvalue(block, rhs);
        let lhs_: Place;
        [block, lhs_] = this.as_place(block, lhs);
        block = BlockAndC.into_block(this.build_drop_and_replace(block, lhs_expr.span, lhs_, rhs_));
      } else {
        let rhs_: Rvalue;
        [block, rhs_] = this.as_local_rvalue(block, rhs);
        let lhs_: Place;
        [block, lhs_] = this.as_place(block, lhs);
        this.cfg.push_assign(block, source_info, lhs_, rhs_);
      }

      this.block_context.pop();
      return unit(block);
    }
    case "AssignOp": {
      const { op, lhs, rhs } = kind;
      // FIXME(#28160) there is an interesting semantics
      // question raised here -- should we "freeze" the
      // value of the lhs here?  I'm inclined to think not,
      // since it seems closer to the semantics of the
      // overloaded version, which takes `&mut self`. This
      // only affects weird things like `x += {x += 1; x}`
      // -- is that equal to `x + (x + 1)` or `2*(x+1)`?

      const lhs_ty = this.thir.index_ExprId(lhs).ty;

      // debug!("stmt_expr AssignOp block_context.push(SubExpr) : {:?}", expr);
      this.block_context.push(BlockFrame.SubExpr);

      // As above, RTL.
      let rhs_: Operand;
      [block, rhs_] = this.as_local_operand(block, rhs);
      let lhs_: Place;
      [block, lhs_] = this.as_place(block, lhs);

      // we don't have to drop prior contents or anything
      // because AssignOp is only legal for Copy types
      // (overloaded ops should be desugared into a call).
      let result: Rvalue;
      [block, result] = this.build_binary_op(block, BinOp_from_AssignOp(op), expr_span, lhs_ty, { $: "Copy", _0: lhs_ }, rhs_);
      this.cfg.push_assign(block, source_info, lhs_, result);

      this.block_context.pop();
      return unit(block);
    }
    case "Continue": {
      const { label } = kind;
      return this.break_scope(block, undefined, { $: "Continue", _0: label } satisfies BreakableTarget, source_info);
    }
    case "Break": {
      const { label, value } = kind;
      return this.break_scope(block, value, { $: "Break", _0: label } satisfies BreakableTarget, source_info);
    }
    case "ConstContinue": {
      const { label, value } = kind;
      return this.break_const_continuable_scope(block, value, label, source_info);
    }
    case "Return": {
      const { value } = kind;
      return this.break_scope(block, value, { $: "Return" } satisfies BreakableTarget, source_info);
    }
    case "Become": {
      const { value: value0 } = kind;
      const v0 = this.thir.index_ExprId(value0);
      const k0 = v0.kind;
      if (k0.$ !== "Scope") {
        return span_bug(v0.span, `\`thir_check_tail_calls\` should have disallowed this ${debug_Expr(v0, PLAIN)}`);
      }
      const { value, hir_id, region_scope } = k0;

      const v = this.thir.index_ExprId(value);
      const k = v.kind;
      if (k.$ !== "Call") {
        return span_bug(v.span, `\`thir_check_tail_calls\` should have disallowed this ${debug_Expr(v, PLAIN)}`);
      }
      const { args, fun, fn_span } = k;

      return this.in_scope([region_scope, source_info], { $: "Explicit", _0: hir_id }, (this_) => {
        let fun_: Operand;
        [block, fun_] = this_.as_local_operand(block, fun);
        const args_: Spanned<Operand>[] = args.map((arg) => {
          let node: Operand;
          [block, node] = this_.as_local_call_operand(block, arg);
          return {
            node,
            span: this_.thir.exprs[arg]!.span,
          };
        });

        this_.record_operands_moved(args_);

        // debug!("expr_into_dest: fn_span={:?}", fn_span);

        [block] = this_.break_for_tail_call(block, args_, source_info);

        this_.cfg.terminate(block, source_info, { $: "TailCall", func: fun_, args: args_, fn_span });

        return unit(this_.cfg.start_new_block());
      });
    }
    default: {
      assert(statement_scope !== undefined, "Should not be calling `stmt_expr` on a general expression without a statement scope");

      // Issue #54382: When creating temp for the value of
      // expression like:
      //
      // `{ side_effects(); { let l = stuff(); the_value } }`
      //
      // it is usually better to focus on `the_value` rather
      // than the entirety of block(s) surrounding it.
      let adjusted_span: Span | undefined;
      let tail_ex: ExprId | undefined;
      if (kind.$ === "Block" && (tail_ex = this.thir.index_BlockId(kind.block).expr) !== undefined) {
        let expr = this.thir.index_ExprId(tail_ex);
        for (;;) {
          const ek = expr.kind;
          let nested_expr: ExprId | undefined;
          if (ek.$ === "Block" && (nested_expr = this.thir.index_BlockId(ek.block).expr) !== undefined) {
            expr = this.thir.index_ExprId(nested_expr);
          } else if (ek.$ === "Scope") {
            expr = this.thir.index_ExprId(ek.value);
          } else {
            break;
          }
        }
        this.block_context.push({ $: "TailExpr", info: { tail_result_is_ignored: true, span: expr.span } });
        adjusted_span = expr.span;
      } else {
        adjusted_span = undefined;
      }

      let temp: Local;
      [block, temp] = this.as_temp(block, { temp_lifetime: statement_scope, backwards_incompatible: undefined }, expr_id, Mutability.Not);

      if (adjusted_span !== undefined) {
        const span = adjusted_span;
        this.local_decls[temp]!.source_info.span = span;
        this.block_context.pop();
      }

      return unit(block);
    }
  }
};
