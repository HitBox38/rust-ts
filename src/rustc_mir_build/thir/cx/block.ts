// Port of compiler/rustc_mir_build/src/thir/cx/block.rs (lane thir-cx-print).
// PORT: the `impl ThirBuildCx` block of this file, attached to the prototype (loaded by lib.ts after cx/mod.ts).
import type { Block as HirBlock, Stmt as HirStmt } from "../../../rustc_hir/hir.ts";
import type { ItemLocalId } from "../../../rustc_hir_id/lib.ts";
import { FirstStatementIndex, Scope, ScopeData } from "../../../rustc_middle/middle/region.ts";
import type { Block, BlockId, BlockSafety, Stmt, StmtId } from "../../../rustc_middle/thir.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { push_idx, ThirBuildCx } from "./mod.ts";

declare module "./mod.ts" {
  interface ThirBuildCx {
    mirror_block(block: HirBlock): BlockId;
    mirror_stmts(block_id: ItemLocalId, stmts: readonly HirStmt[]): StmtId[];
  }
}

// rustc: compiler/rustc_mir_build/src/thir/cx/block.rs:10 mirror_block
ThirBuildCx.prototype.mirror_block = function (this: ThirBuildCx, block: HirBlock): BlockId {
  // We have to eagerly lower the "spine" of the statements
  // in order to get the lexical scoping correctly.
  const stmts = this.mirror_stmts(block.hir_id.local_id, block.stmts);
  let safety_mode: BlockSafety;
  // PORT: the struct literal's fields are evaluated in source order: `expr` (mirrored) before `safety_mode`.
  const expr = block.expr === undefined ? undefined : this.mirror_expr(block.expr);
  const rules = block.rules;
  if (rules.$ === "DefaultBlock") {
    safety_mode = { $: "Safe" };
  } else if (rules._0 === "CompilerGenerated") {
    safety_mode = { $: "BuiltinUnsafe" };
  } else {
    safety_mode = { $: "ExplicitUnsafe", _0: block.hir_id };
  }
  const block_: Block = {
    targeted_by_break: block.targeted_by_break,
    region_scope: new Scope(block.hir_id.local_id, ScopeData.Node),
    span: block.span,
    stmts,
    expr,
    safety_mode,
  };

  return push_idx<BlockId, Block>(this.thir.blocks, block_);
};

// rustc: compiler/rustc_mir_build/src/thir/cx/block.rs:37 mirror_stmts
ThirBuildCx.prototype.mirror_stmts = function (this: ThirBuildCx, block_id: ItemLocalId, stmts: readonly HirStmt[]): StmtId[] {
  const out: StmtId[] = [];
  for (let index = 0; index < stmts.length; index++) {
    const stmt = stmts[index]!;
    const hir_id = stmt.hir_id;
    const kind = stmt.kind;
    switch (kind.$) {
      case "Expr":
      case "Semi": {
        const expr = kind._0;
        const stmt_: Stmt = {
          kind: {
            $: "Expr",
            scope: new Scope(hir_id.local_id, ScopeData.Node),
            expr: this.mirror_expr(expr),
          },
        };
        out.push(push_idx<StmtId, Stmt>(this.thir.stmts, stmt_));
        break;
      }
      case "Item": {
        // ignore for purposes of the MIR
        break;
      }
      case "Let": {
        const local = kind._0;
        const remainder_scope = new Scope(block_id, { $: "Remainder", _0: FirstStatementIndex.new(index) });

        const else_block = local.els === undefined ? undefined : this.mirror_block(local.els);

        const pattern = this.pattern_from_hir_with_annotation(local.pat, local.ty);
        // debug!(?pattern);

        let span: Span;
        const init_span = local.init === undefined ? undefined : Span.find_ancestor_inside_same_ctxt(local.init.span, local.span);
        if (local.init !== undefined && init_span !== undefined) {
          span = Span.with_hi(local.span, Span.hi(init_span));
        } else {
          span = local.span;
        }
        const initializer = local.init === undefined ? undefined : this.mirror_expr(local.init);
        const stmt_: Stmt = {
          kind: {
            $: "Let",
            remainder_scope,
            init_scope: new Scope(hir_id.local_id, ScopeData.Node),
            pattern,
            initializer,
            else_block,
            hir_id: local.hir_id,
            span,
          },
        };
        out.push(push_idx<StmtId, Stmt>(this.thir.stmts, stmt_));
        break;
      }
    }
  }
  return out;
};
