// Port of compiler/rustc_mir_build/src/builder/block.rs (lane mb-mod, plan-m4 wave 22): `impl Builder` methods put on its
// prototype (builder/mod.ts header: conventions; `BlockAnd` is the tuple `[BasicBlock, T]`).
import { type Scope } from "../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Place, type SourceInfo, type SourceScope, TerminatorKind } from "../../rustc_middle/mir/mod.ts";
import { type BlockId, type ExprId, type StmtId } from "../../rustc_middle/thir.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { assert } from "../../std/panic.ts";
import { DeclareLetBindings, ScheduleDrops } from "./matches/mod.gen.ts";
import { LintLevel } from "./scope.gen.ts";
import { BlockAnd, BlockFrame, Builder, ForGuard, and, unit } from "./mod.ts";

declare module "./mod.ts" {
  interface Builder {
    ast_block(destination: Place, block: BasicBlock, ast_block: BlockId, source_info: SourceInfo): BlockAnd<null>;
    ast_block_stmts(destination: Place, block: BasicBlock, span: Span, stmts: readonly StmtId[], expr: ExprId | undefined, region_scope: Scope): BlockAnd<null>;
  }
}

const OutsideGuard = ForGuard.OutsideGuard;

// rustc: compiler/rustc_mir_build/src/builder/block.rs:14 ast_block
Builder.prototype.ast_block = function (this: Builder, destination: Place, block: BasicBlock, ast_block: BlockId, source_info: SourceInfo): BlockAnd<null> {
  const { region_scope, span, stmts, expr, targeted_by_break } = this.thir.index_BlockId(ast_block);
  return this.in_scope([region_scope, source_info], LintLevel.Inherited, (this_) => {
    if (targeted_by_break) {
      return this_.in_breakable_scope(undefined, destination, span, (this_) => {
        return this_.ast_block_stmts(destination, block, span, stmts, expr, region_scope);
      });
    } else {
      return this_.ast_block_stmts(destination, block, span, stmts, expr, region_scope);
    }
  });
};

// rustc: compiler/rustc_mir_build/src/builder/block.rs:34 ast_block_stmts
Builder.prototype.ast_block_stmts = function (
  this: Builder,
  destination: Place,
  block: BasicBlock,
  span: Span,
  stmts: readonly StmtId[],
  expr: ExprId | undefined,
  region_scope: Scope,
): BlockAnd<null> {
  // `let this = self;` (LET_THIS_SELF): `this`.

  // This convoluted structure is to avoid using recursion as we walk down a list
  // of statements. Basically, the structure we get back is something like:
  //
  //    let x = <init> in {
  //       expr1;
  //       let y = <init> in {
  //           expr2;
  //           expr3;
  //           ...
  //       }
  //    }
  //
  // The let bindings are valid till the end of block so all we have to do is to pop all
  // the let-scopes at the end.
  //
  // First we build all the statements in the block.
  const let_scope_stack: Scope[] = [];
  const outer_source_scope = this.source_scope;
  // This scope information is kept for breaking out of the parent remainder scope in case
  // one let-else pattern matching fails.
  // By doing so, we can be sure that even temporaries that receive extended lifetime
  // assignments are dropped, too.
  let last_remainder_scope = region_scope;

  const source_info = this.source_info(span);
  for (const stmt of stmts) {
    const { kind } = this.thir.index_StmtId(stmt);
    if (kind.$ === "Expr") {
      const { scope, expr } = kind;
      this.block_context.push({ $: "Statement", ignores_expr_result: true });
      const si: [Scope, SourceInfo] = [scope, source_info];
      const block_ = block;
      block = BlockAnd.into_block(
        this.in_scope(si, LintLevel.Inherited, (this_) => {
          return this_.stmt_expr(block_, expr, scope);
        }),
      );
    } else if (kind.initializer !== undefined && kind.else_block !== undefined) {
      const { remainder_scope, init_scope, pattern, initializer, hir_id, else_block } = kind;
      // When lowering the statement `let <pat> = <expr> else { <else> };`,
      // the `<else>` block is nested in the parent scope enclosing this statement.
      // That scope is usually either the enclosing block scope,
      // or the remainder scope of the last statement.
      // This is to make sure that temporaries instantiated in `<expr>` are dropped
      // as well.
      // In addition, even though bindings in `<pat>` only come into scope if
      // the pattern matching passes, in the MIR building the storages for them
      // are declared as live any way.
      // This is similar to `let x;` statements without an initializer expression,
      // where the value of `x` in this example may or may be assigned,
      // because the storage for their values may not be live after all due to
      // failure in pattern matching.
      // For this reason, we declare those storages as live but we do not schedule
      // any drop yet- they are scheduled later after the pattern matching.
      // The generated MIR will have `StorageDead` whenever the control flow breaks out
      // of the parent scope, regardless of the result of the pattern matching.
      // However, the drops are inserted in MIR only when the control flow breaks out of
      // the scope of the remainder scope associated with this `let .. else` statement.
      // Pictorial explanation of the scope structure:
      // ┌─────────────────────────────────┐
      // │  Scope of the enclosing block,  │
      // │  or the last remainder scope    │
      // │  ┌───────────────────────────┐  │
      // │  │  Scope for <else> block   │  │
      // │  └───────────────────────────┘  │
      // │  ┌───────────────────────────┐  │
      // │  │  Remainder scope of       │  │
      // │  │  this let-else statement  │  │
      // │  │  ┌─────────────────────┐  │  │
      // │  │  │ <expr> scope        │  │  │
      // │  │  └─────────────────────┘  │  │
      // │  │  extended temporaries in  │  │
      // │  │  <expr> lives in this     │  │
      // │  │  scope                    │  │
      // │  │  ┌─────────────────────┐  │  │
      // │  │  │ Scopes for the rest │  │  │
      // │  │  └─────────────────────┘  │  │
      // │  └───────────────────────────┘  │
      // └─────────────────────────────────┘
      // Generated control flow:
      //          │ let Some(x) = y() else { return; }
      //          │
      // ┌────────▼───────┐
      // │ evaluate y()   │
      // └────────┬───────┘
      //          │              ┌────────────────┐
      // ┌────────▼───────┐      │Drop temporaries│
      // │Test the pattern├──────►in y()          │
      // └────────┬───────┘      │because breaking│
      //          │              │out of <expr>   │
      // ┌────────▼───────┐      │scope           │
      // │Move value into │      └───────┬────────┘
      // │binding x       │              │
      // └────────┬───────┘      ┌───────▼────────┐
      //          │              │Drop extended   │
      // ┌────────▼───────┐      │temporaries in  │
      // │Drop temporaries│      │<expr> because  │
      // │in y()          │      │breaking out of │
      // │because breaking│      │remainder scope │
      // │out of <expr>   │      └───────┬────────┘
      // │scope           │              │
      // └────────┬───────┘      ┌───────▼────────┐
      //          │              │Enter <else>    ├────────►
      // ┌────────▼───────┐      │block           │ return;
      // │Continue...     │      └────────────────┘
      // └────────────────┘

      const ignores_expr_result = pattern.kind.$ === "Wild";
      this.block_context.push({ $: "Statement", ignores_expr_result });

      // Lower the `else` block first because its parent scope is actually
      // enclosing the rest of the `let .. else ..` parts.
      const else_block_span = this.thir.index_BlockId(else_block).span;
      // This place is not really used because this destination place
      // should never be used to take values at the end of the failure
      // block.
      const dummy_place = this.temp(this.tcx.types.never, else_block_span);
      // An unsuccessful match will jump to this block.
      const failure_entry_block = this.cfg.start_new_block();
      const failure_end_block = BlockAnd.into_block(this.ast_block(dummy_place, failure_entry_block, else_block, this.source_info(else_block_span)));
      this.cfg.terminate(failure_end_block, this.source_info(else_block_span), TerminatorKind.Unreachable);

      // Declare the bindings, which may create a source scope.
      const remainder_span = remainder_scope.span(this.tcx, this.region_scope_tree);
      this.push_scope(remainder_scope);
      let_scope_stack.push(remainder_scope);

      const visibility_scope: SourceScope | undefined = this.new_source_scope(remainder_span, LintLevel.Inherited);

      const initializer_span = this.thir.index_ExprId(initializer).span;
      const scope: [Scope, SourceInfo] = [init_scope, source_info];
      const lint_level: LintLevel = { $: "Explicit", _0: hir_id };

      // Lower the initializer and test it against the pattern, leading to a
      // true path (successful match) and a false path (failure).
      const block_ = block;
      const last_remainder_scope_ = last_remainder_scope;
      const true_and_false_blocks: BlockAnd<BasicBlock> = this.in_scope(scope, lint_level, (this_) => {
        this_.declare_bindings(visibility_scope, remainder_span, pattern, undefined, [destination, initializer_span]);
        const else_block_span = this_.thir.index_BlockId(else_block).span;
        const [true_block, false_block] = this_.in_if_then_scope(last_remainder_scope_, else_block_span, (this_) => {
          // Bypass `lower_if_condition` and call `lower_fallible_let` directly,
          // since we don't have an actual THIR let-expression here.
          return this_.lower_fallible_let(block_, pattern, initializer, undefined, initializer_span, DeclareLetBindings.No);
        });
        // Pack `(true_block, false_block)` into `BlockAnd<BasicBlock>`.
        return and(true_block, false_block);
      });
      // Unpack `BlockAnd<BasicBlock>` into `(true_block, false_block)`.
      let true_block: BasicBlock, false_block: BasicBlock;
      [true_block, false_block] = true_and_false_blocks;

      // Proceed along the successful path, or jump to the failure path.
      block = true_block;
      this.cfg.goto(false_block, source_info, failure_entry_block);

      if (visibility_scope !== undefined) {
        const source_scope = visibility_scope;
        this.source_scope = source_scope;
      }
      last_remainder_scope = remainder_scope;
    } else if (kind.initializer === undefined && kind.else_block !== undefined) {
      const { init_scope } = kind;
      span_bug(init_scope.span(this.tcx, this.region_scope_tree), "initializer is missing, but else block is present in this let binding");
    } else {
      // `StmtKind::Let { .., else_block: None, .. }`
      const { remainder_scope, init_scope, pattern, initializer, hir_id } = kind;
      const ignores_expr_result = pattern.kind.$ === "Wild";
      this.block_context.push({ $: "Statement", ignores_expr_result });

      // Enter the remainder scope, i.e., the bindings' destruction scope.
      this.push_scope(remainder_scope);
      let_scope_stack.push(remainder_scope);

      // Declare the bindings, which may create a source scope.
      const remainder_span = remainder_scope.span(this.tcx, this.region_scope_tree);

      const visibility_scope: SourceScope | undefined = this.new_source_scope(remainder_span, LintLevel.Inherited);

      // Evaluate the initializer, if present.
      const lint_level: LintLevel = { $: "Explicit", _0: hir_id };
      if (initializer !== undefined) {
        const init = initializer;
        const initializer_span = this.thir.index_ExprId(init).span;
        const scope: [Scope, SourceInfo] = [init_scope, source_info];

        const block_ = block;
        block = BlockAnd.into_block(
          this.in_scope(scope, lint_level, (this_) => {
            this_.declare_bindings(visibility_scope, remainder_span, pattern, undefined, [undefined, initializer_span]);
            return this_.expr_into_pattern(block_, pattern, init);
            // irrefutable pattern
          }),
        );
      } else {
        const scope: [Scope, SourceInfo] = [init_scope, source_info];
        const block_ = block;
        const _: BlockAnd<null> = this.in_scope(scope, lint_level, (this_) => {
          this_.declare_bindings(visibility_scope, remainder_span, pattern, undefined, undefined);
          return unit(block_);
        });

        // debug!("ast_block_stmts: pattern={:?}", pattern);
        this.visit_primary_bindings(pattern, (this_, node, span) => {
          this_.storage_live_binding(block_, node, span, false, OutsideGuard, ScheduleDrops.Yes);
          this_.schedule_drop_for_binding(node, span, OutsideGuard);
        });
      }

      // Enter the visibility scope, after evaluating the initializer.
      if (visibility_scope !== undefined) {
        const source_scope = visibility_scope;
        this.source_scope = source_scope;
      }
      last_remainder_scope = remainder_scope;
    }

    const popped = this.block_context.pop();
    assert(popped !== undefined && BlockFrame.is_statement(popped), "assertion failed: popped.is_some_and(|bf| bf.is_statement())");
  }

  // Then, the block may have an optional trailing expression which is a “return” value
  // of the block, which is stored into `destination`.
  const tcx = this.tcx;
  const destination_ty = destination.ty(this.local_decls, tcx).ty;
  if (expr !== undefined) {
    const expr_id = expr;
    const expr_ = this.thir.index_ExprId(expr_id);
    const tail_result_is_ignored = destination_ty.is_unit() || this.block_context.currently_ignores_tail_results();
    this.block_context.push({ $: "TailExpr", info: { tail_result_is_ignored, span: expr_.span } });

    block = BlockAnd.into_block(this.expr_into_dest(destination, block, expr_id));
    const popped = this.block_context.pop();

    assert(popped !== undefined && BlockFrame.is_tail_expr(popped), "assertion failed: popped.is_some_and(|bf| bf.is_tail_expr())");
  } else {
    // If a block has no trailing expression, then it is given an implicit return type.
    // This return type is usually `()`, unless the block is diverging, in which case the
    // return type is `!`. For the unit type, we need to actually return the unit, but in
    // the case of `!`, no return value is required, as the block will never return.
    // Opaque types of empty bodies also need this unit assignment, in order to infer that their
    // type is actually unit. Otherwise there will be no defining use found in the MIR.
    const kind = destination_ty.kind();
    if (destination_ty.is_unit() || (kind.$ === "Alias" && kind._1.kind.$ === "Opaque")) {
      // We only want to assign an implicit `()` as the return value of the block if the
      // block does not diverge. (Otherwise, we may try to assign a unit to a `!`-type.)
      this.cfg.push_assign_unit(block, source_info, destination, this.tcx);
    }
  }
  // Finally, we pop all the let scopes before exiting out from the scope of block
  // itself.
  for (const scope of let_scope_stack.reverse()) {
    block = BlockAnd.into_block(this.pop_scope(scope, block));
  }
  // Restore the original source scope.
  this.source_scope = outer_source_scope;
  return unit(block);
};
