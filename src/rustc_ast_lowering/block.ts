// Port of compiler/rustc_ast_lowering/src/block.rs (lane lower-pat-path-block).
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned onto
// `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { type Block, type BlockCheckMode, type Local, LocalKind, type Stmt } from "../rustc_ast/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { sym } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import { LoweringContext } from "./decls.ts";
import type { ImplTraitContext, ImplTraitPosition } from "./lib.ts";

// rustc: compiler/rustc_ast_lowering/src/block.rs:10 lower_block
LoweringContext.prototype.lower_block = function (this: LoweringContext, b: Block, targeted_by_break: boolean): hir.Block {
  const hir_id = this.lower_node_id(b.id);
  return this.arena.alloc(this.lower_block_noalloc(hir_id, b, targeted_by_break));
};

// rustc: compiler/rustc_ast_lowering/src/block.rs:19 lower_block_noalloc
LoweringContext.prototype.lower_block_noalloc = function (
  this: LoweringContext,
  hir_id: HirId,
  b: Block,
  targeted_by_break: boolean,
): hir.Block {
  const [stmts, expr] = this.lower_stmts(b.stmts);
  const rules = this.lower_block_check_mode(b.rules);
  // `hir::Block { hir_id, stmts, expr, rules, span: self.lower_span(b.span), targeted_by_break }`
  const span = this.lower_span(b.span);
  return new hir.Block(stmts, expr, hir_id, rules, span, targeted_by_break);
};

// rustc: compiler/rustc_ast_lowering/src/block.rs:30 lower_stmts
LoweringContext.prototype.lower_stmts = function (
  this: LoweringContext,
  ast_stmts: readonly Stmt[],
): [readonly hir.Stmt[], hir.Expr | undefined] {
  const stmts: hir.Stmt[] = [];
  let expr: hir.Expr | undefined = undefined;
  // `while let [s, tail @ ..] = ast_stmts { .. ast_stmts = tail; }`: `i` is the start of `ast_stmts`.
  for (let i = 0; i < ast_stmts.length; i++) {
    const s = ast_stmts[i]!;
    const tail_is_empty = i + 1 === ast_stmts.length;
    const k = s.kind;
    switch (k.$) {
      case "Let": {
        const hir_id = this.lower_node_id(s.id);
        const local = this.lower_local(k._0);
        this.alias_attrs(hir_id, local.hir_id);
        const kind: hir.StmtKind = { $: "Let", _0: local };
        const span = this.lower_span(s.span);
        stmts.push({ hir_id, kind, span });
        break;
      }
      case "Item": {
        const item_id = this.lower_item_ref(k._0);
        const hir_id = this.lower_node_id(s.id);
        const kind: hir.StmtKind = { $: "Item", _0: item_id };
        const span = this.lower_span(s.span);
        stmts.push({ hir_id, kind, span });
        break;
      }
      case "Expr": {
        const e = this.lower_expr(k._0);
        if (tail_is_empty) {
          expr = e;
        } else {
          const hir_id = this.lower_node_id(s.id);
          this.alias_attrs(hir_id, e.hir_id);
          const kind: hir.StmtKind = { $: "Expr", _0: e };
          const span = this.lower_span(s.span);
          stmts.push({ hir_id, kind, span });
        }
        break;
      }
      case "Semi": {
        const e = this.lower_expr(k._0);
        const hir_id = this.lower_node_id(s.id);
        this.alias_attrs(hir_id, e.hir_id);
        const kind: hir.StmtKind = { $: "Semi", _0: e };
        const span = this.lower_span(s.span);
        stmts.push({ hir_id, kind, span });
        break;
      }
      case "Empty":
        break;
      case "MacCall":
        panic("shouldn't exist here");
    }
  }
  return [this.arena.alloc_from_iter(stmts), expr];
};

/// Return an `ImplTraitContext` that allows impl trait in bindings if
/// the feature gate is enabled, or issues a feature error if it is not.
// rustc: compiler/rustc_ast_lowering/src/block.rs:83 impl_trait_in_bindings_ctxt
LoweringContext.prototype.impl_trait_in_bindings_ctxt = function (
  this: LoweringContext,
  position: ImplTraitPosition,
): ImplTraitContext {
  if (this.tcx.features().impl_trait_in_bindings()) {
    return { $: "InBinding" };
  } else {
    return { $: "FeatureGated", _0: position, _1: sym.impl_trait_in_bindings };
  }
};

// rustc: compiler/rustc_ast_lowering/src/block.rs:91 lower_local
LoweringContext.prototype.lower_local = function (this: LoweringContext, l: Local): hir.LetStmt {
  // Let statements are allowed to have impl trait in bindings.
  const super_ = l.super_ === undefined ? undefined : this.lower_span(l.super_);
  const ty =
    l.ty === undefined ? undefined : this.lower_ty_alloc(l.ty, this.impl_trait_in_bindings_ctxt("Variable"));
  const l_init = LocalKind.init(l.kind);
  const init = l_init === undefined ? undefined : this.lower_expr(l_init);
  const hir_id = this.lower_node_id(l.id);
  const pat = this.lower_pat(l.pat);
  const els = l.kind.$ === "InitElse" ? this.lower_block(l.kind._1, false) : undefined;
  const span = this.lower_span(l.span);
  const source: hir.LocalSource = "Normal";
  this.lower_attrs(hir_id, l.attrs, l.span, Target.Statement);
  return this.arena.alloc({ hir_id, super_, ty, pat, init, els, span, source });
};

// rustc: compiler/rustc_ast_lowering/src/block.rs:111 lower_block_check_mode
LoweringContext.prototype.lower_block_check_mode = function (this: LoweringContext, b: BlockCheckMode): hir.BlockCheckMode {
  switch (b.$) {
    case "Default":
      return { $: "DefaultBlock" };
    case "Unsafe":
      return { $: "UnsafeBlock", _0: this.lower_unsafe_source(b._0) };
  }
};
