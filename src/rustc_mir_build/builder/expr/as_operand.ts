// Port of compiler/rustc_mir_build/src/builder/expr/as_operand.rs (declared by lane builder-contract, filled by lane mb-expr-a,
// plan-m4 wave 22; builder/mod.ts's header has the representation notes).
//! See docs in build/expr/mod.rs
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type Scope as region_Scope, type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { type BasicBlock, type Local, LocalInfo, type Operand, Place, Place_from_Local, type SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import { type ExprId } from "../../../rustc_middle/thir.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { assert, unwrap } from "../../../std/panic.ts";
import { and, Builder, type BlockAnd, NeedsTemporary } from "../mod.ts";
import { Category } from "./category.ts";

declare module "../mod.ts" {
  interface Builder {
    local_temp_lifetime(): TempLifetime;
    as_local_operand(block: BasicBlock, expr_id: ExprId): BlockAnd<Operand>;
    as_local_call_operand(block: BasicBlock, expr: ExprId): BlockAnd<Operand>;
    as_operand(block: BasicBlock, scope: TempLifetime, expr_id: ExprId, local_info: LocalInfo, needs_temporary: NeedsTemporary): BlockAnd<Operand>;
    as_call_operand(block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Operand>;
  }
}

/// Construct a temporary lifetime restricted to just the local scope
// rustc: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:14 local_temp_lifetime
Builder.prototype.local_temp_lifetime = function (this: Builder): TempLifetime {
  const local_scope = this.local_scope();
  return { temp_lifetime: local_scope, backwards_incompatible: undefined };
};

/// Returns an operand suitable for use until the end of the current
/// scope expression.
///
/// The operand returned from this function will *not be valid*
/// after the current enclosing `ExprKind::Scope` has ended, so
/// please do *not* return it from functions to avoid bad
/// miscompiles.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:26 as_local_operand
Builder.prototype.as_local_operand = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Operand> {
  return this.as_operand(block, this.local_temp_lifetime(), expr_id, LocalInfo.Boring, NeedsTemporary.Maybe);
};

/// Returns an operand suitable for use until the end of the current scope expression and
/// suitable also to be passed as function arguments.
///
/// The operand returned from this function will *not be valid* after an ExprKind::Scope is
/// passed, so please do *not* return it from functions to avoid bad miscompiles. Returns an
/// operand suitable for use as a call argument. This is almost always equivalent to
/// `as_operand`, except for the particular case of passing values of (potentially) unsized
/// types "by value" (see details below).
///
/// The operand returned from this function will *not be valid*
/// after the current enclosing `ExprKind::Scope` has ended, so
/// please do *not* return it from functions to avoid bad
/// miscompiles.
///
/// # Parameters of unsized types
///
/// We tweak the handling of parameters of unsized type slightly to avoid the need to create a
/// local variable of unsized type. For example, consider this program:
///
/// ```
/// #![feature(unsized_fn_params)]
/// # use core::fmt::Debug;
/// fn foo(_p: dyn Debug) {
///     /* ... */
/// }
///
/// fn bar(box_p: Box<dyn Debug>) { foo(*box_p); }
/// ```
///
/// Ordinarily, for sized types, we would compile the call `foo(*p)` like so:
///
/// ```ignore (illustrative)
/// let tmp0 = *box_p; // tmp0 would be the operand returned by this function call
/// foo(tmp0)
/// ```
///
/// But because the parameter to `foo` is of the unsized type `dyn Debug`, and because it is
/// being moved the deref of a box, we compile it slightly differently. The temporary `tmp0`
/// that we create *stores the entire box*, and the parameter to the call itself will be
/// `*tmp0`:
///
/// ```ignore (illustrative)
/// let tmp0 = box_p; call foo(*tmp0)
/// ```
///
/// This way, the temporary `tmp0` that we create has type `Box<dyn Debug>`, which is sized.
/// The value passed to the call (`*tmp0`) still has the `dyn Debug` type -- but the way that
/// calls are compiled means that this parameter will be passed "by reference", meaning that we
/// will actually provide a pointer to the interior of the box, and not move the `dyn Debug`
/// value to the stack.
///
/// See <https://github.com/rust-lang/rust/issues/68304> for more details.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:92 as_local_call_operand
Builder.prototype.as_local_call_operand = function (this: Builder, block: BasicBlock, expr: ExprId): BlockAnd<Operand> {
  return this.as_call_operand(block, this.local_temp_lifetime(), expr);
};

/// Compile `expr` into a value that can be used as an operand.
/// If `expr` is a place like `x`, this will introduce a
/// temporary `tmp = x`, so that we capture the value of `x` at
/// this time.
///
/// If we end up needing to create a temporary, then we will use
/// `local_info` as its `LocalInfo`, unless `as_temporary`
/// has already assigned it a non-`None` `LocalInfo`.
/// Normally, you should use `None` for `local_info`
///
/// The operand is known to be live until the end of `scope`.
///
/// Like `as_local_call_operand`, except that the argument will
/// not be valid once `scope` ends.
// #[instrument(level = "debug", skip(self, scope))]
// rustc: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:115 as_operand
Builder.prototype.as_operand = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId, local_info: LocalInfo, needs_temporary: NeedsTemporary): BlockAnd<Operand> {
  const expr = this.thir.index_ExprId(expr_id);
  if (expr.kind.$ === "Scope") {
    const { region_scope: region_scope0, hir_id, value } = expr.kind;
    const source_info = this.source_info(expr.span);
    const region_scope: [region_Scope, SourceInfo] = [region_scope0, source_info];
    return this.in_scope(region_scope, { $: "Explicit", _0: hir_id }, (this_) => {
      this_.push_coverage_point_for_expr(block, source_info, hir_id);
      return this_.as_operand(block, scope, value, local_info, needs_temporary);
    });
  }

  const category = unwrap(Category.of(expr.kind));
  // debug!(?category, ?expr.kind);
  if (category.$ === "Constant" && (needs_temporary === NeedsTemporary.No || !expr.ty.needs_drop(this.tcx, this.typing_env()))) {
    const constant = this.as_constant(expr);
    return and(block, { $: "Constant", _0: constant });
  } else {
    // Category::Constant | Category::Place | Category::Rvalue(..)
    let operand: Local;
    [block, operand] = this.as_temp(block, scope, expr_id, Mutability.Mut);
    // Overwrite temp local info if we have something more interesting to record.
    if (local_info.$ !== "Boring") {
      // PORT: `this.local_decls[operand].local_info.as_mut().unwrap_crate_local()` is the `Set` payload, read and
      // written in place (`unwrap_crate_local` ICEs on `Clear`).
      const decl_info = this.local_decls[operand]!.local_info;
      if (decl_info.$ === "Clear") return bug("unwrapping cross-crate data");
      if (decl_info._0.$ === "Boring" || decl_info._0.$ === "BlockTailTemp") {
        decl_info._0 = local_info;
      }
    }
    return and(block, { $: "Move", _0: Place_from_Local(operand) });
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_operand.rs:160 as_call_operand
Builder.prototype.as_call_operand = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Operand> {
  const expr = this.thir.index_ExprId(expr_id);
  // debug!("as_call_operand(block={:?}, expr={:?})", block, expr);

  if (expr.kind.$ === "Scope") {
    const { region_scope: region_scope0, hir_id, value } = expr.kind;
    const source_info = this.source_info(expr.span);
    const region_scope: [region_Scope, SourceInfo] = [region_scope0, source_info];
    return this.in_scope(region_scope, { $: "Explicit", _0: hir_id }, (this_) => {
      this_.push_coverage_point_for_expr(block, source_info, hir_id);
      return this_.as_call_operand(block, scope, value);
    });
  }

  const tcx = this.tcx;

  if (tcx.features().unsized_fn_params()) {
    const ty = expr.ty;
    if (!ty.is_sized(tcx, this.typing_env())) {
      // !sized means !copy, so this is an unsized move
      assert(!tcx.type_is_copy_modulo_regions(this.typing_env(), ty), "assertion failed: !tcx.type_is_copy_modulo_regions(this.typing_env(), ty)");

      // As described above, detect the case where we are passing a value of unsized
      // type, and that value is coming from the deref of a box.
      if (expr.kind.$ === "Deref") {
        const { arg } = expr.kind;
        // Generate let tmp0 = arg0
        let operand: Local;
        [block, operand] = this.as_temp(block, scope, arg, Mutability.Mut);

        // Return the operand *tmp0 to be used as the call argument
        const place = new Place(operand, tcx.mk_place_elems([{ $: "Deref" }]));

        return and(block, { $: "Move", _0: place });
      }
    }
  }

  return this.as_operand(block, scope, expr_id, LocalInfo.Boring, NeedsTemporary.Maybe);
};
