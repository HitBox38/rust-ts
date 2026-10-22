// Port of compiler/rustc_mir_build/src/builder/expr/as_temp.rs (declared by lane builder-contract, filled by lane mb-expr-a,
// plan-m4 wave 22; builder/mod.ts's header has the representation notes).
//! See docs in build/expr/mod.rs
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { HirId } from "../../../rustc_hir_id/lib.ts";
import { IndexVec } from "../../../rustc_index/vec.ts";
import { Scope_eq, type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Local, type LocalInfo, LocalDecl, Place_from_Local, Statement } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { assert } from "../../../std/panic.ts";
import { and, Builder, type BlockAnd, BlockAnd as BlockAndC } from "../mod.ts";

declare module "../mod.ts" {
  interface Builder {
    as_temp(block: BasicBlock, temp_lifetime: TempLifetime, expr_id: ExprId, mutability: Mutability): BlockAnd<Local>;
  }
}

/// Compile `expr` into a fresh temporary. This is used when building
/// up rvalues so as to freeze the value that will be consumed.
// #[instrument(skip(self), level = "debug")]
// rustc: compiler/rustc_mir_build/src/builder/expr/as_temp.rs:16 as_temp
Builder.prototype.as_temp = function (this: Builder, block: BasicBlock, temp_lifetime: TempLifetime, expr_id: ExprId, mutability: Mutability): BlockAnd<Local> {
  const expr = this.thir.index_ExprId(expr_id);
  const expr_span = expr.span;
  const source_info = this.source_info(expr_span);
  if (expr.kind.$ === "Scope") {
    const { region_scope, hir_id, value } = expr.kind;
    return this.in_scope([region_scope, source_info], { $: "Explicit", _0: hir_id }, (this_) => {
      this_.push_coverage_point_for_expr(block, source_info, hir_id);
      return this_.as_temp(block, temp_lifetime, value, mutability);
    });
  }

  const expr_ty = expr.ty;
  // `self.fixed_temps_scope == temp_lifetime.temp_lifetime` (`Option<Scope>` equality).
  const deduplicate_temps =
    this.fixed_temps_scope !== undefined && temp_lifetime.temp_lifetime !== undefined && Scope_eq(this.fixed_temps_scope, temp_lifetime.temp_lifetime);
  let temp: Local;
  let temp_index: Local | undefined;
  if (deduplicate_temps && (temp_index = this.fixed_temps.get(expr_id)) !== undefined) {
    temp = temp_index;
  } else {
    let local_decl = LocalDecl.new(expr_ty, expr_span);
    if (Mutability.is_not(mutability)) {
      local_decl = local_decl.immutable();
    }

    // debug!("creating temp {:?} with block_context: {:?}", local_decl, this.block_context);
    let local_info: LocalInfo;
    const kind = expr.kind;
    let tail_info;
    if (kind.$ === "StaticRef") {
      const { def_id } = kind;
      assert(!this.tcx.is_thread_local_static(def_id), "assertion failed: !this.tcx.is_thread_local_static(def_id)");
      local_info = { $: "StaticRef", def_id, is_thread_local: false };
    } else if (kind.$ === "ThreadLocalRef") {
      const def_id = kind._0;
      assert(this.tcx.is_thread_local_static(def_id), "assertion failed: this.tcx.is_thread_local_static(def_id)");
      local_info = { $: "StaticRef", def_id, is_thread_local: true };
    } else if (kind.$ === "NamedConst" || kind.$ === "ConstParam") {
      const { def_id } = kind;
      local_info = { $: "ConstRef", def_id };
    }
    // Find out whether this temp is being created within the
    // tail expression of a block whose result is ignored.
    else if ((tail_info = this.block_context.currently_in_block_tail()) !== undefined) {
      local_info = { $: "BlockTailTemp", _0: tail_info };
    } else if (temp_lifetime.temp_lifetime !== undefined && temp_lifetime.temp_lifetime.data.$ === "IfThenRescope") {
      const { local_id } = temp_lifetime.temp_lifetime;
      local_info = { $: "IfThenRescopeTemp", if_then: new HirId(this.hir_id.owner, local_id) };
    } else {
      local_info = { $: "Boring" };
    }
    // PORT: `**local_decl.local_info.as_mut().unwrap_crate_local() = local_info`: the `Box<LocalInfo>` is the
    // payload of the `Set` variant, written in place (`unwrap_crate_local` ICEs on `Clear`).
    const cell = local_decl.local_info;
    if (cell.$ === "Clear") return bug("unwrapping cross-crate data");
    cell._0 = local_info;
    temp = IndexVec.push<Local, LocalDecl>(this.local_decls, local_decl);
  }
  // debug!(?temp);
  if (deduplicate_temps) {
    this.fixed_temps.set(expr_id, temp);
  }
  const temp_place = Place_from_Local(temp);

  const kind = expr.kind;
  let blk;
  if (kind.$ === "Break" || kind.$ === "Continue" || kind.$ === "Return") {
    // Don't bother with StorageLive and Dead for these temporaries,
    // they are never assigned.
  } else if (
    kind.$ === "Block" &&
    (blk = this.thir.index_BlockId(kind.block)).expr === undefined &&
    !blk.targeted_by_break &&
    expr_ty.is_never()
  ) {
    // (nothing)
  } else {
    this.cfg.push(block, Statement.new(source_info, { $: "StorageLive", _0: temp }));

    // In constants, `temp_lifetime` is `None` for temporaries that
    // live for the `'static` lifetime. Thus we do not drop these
    // temporaries and simply leak them.
    // This is equivalent to what `let x = &foo();` does in
    // functions. The temporary is lifted to their surrounding
    // scope. In a function that means the temporary lives until
    // just before the function returns. In constants that means it
    // outlives the constant's initialization value computation.
    // Anything outliving a constant must have the `'static`
    // lifetime and live forever.
    // Anything with a shorter lifetime (e.g the `&foo()` in
    // `bar(&foo())` or anything within a block will keep the
    // regular drops just like runtime code.
    if (temp_lifetime.temp_lifetime !== undefined) {
      this.schedule_drop_storage(expr_span, temp_lifetime.temp_lifetime, temp);
    }
  }

  block = BlockAndC.into_block(this.expr_into_dest(temp_place, block, expr_id));

  if (temp_lifetime.temp_lifetime !== undefined) {
    this.schedule_drop_value(expr_span, temp_lifetime.temp_lifetime, temp);
  }

  if (temp_lifetime.backwards_incompatible !== undefined) {
    this.schedule_backwards_incompatible_drop(expr_span, temp_lifetime.backwards_incompatible, temp);
  }

  return and(block, temp);
};
