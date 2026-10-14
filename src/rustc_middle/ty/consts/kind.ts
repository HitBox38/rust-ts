// Port of compiler/rustc_middle/src/ty/consts/kind.rs (lane ty-results). The types with their derived Debug /
// TypeVisitable / TypeFoldable impls are generated into kind.gen.ts (set rustc_ty of tools/codegen/types.ts); the fns of
// this file are below, on the `Expr` companion (methods taking `self` first, tyir-binder decision 5).
// PORT (init order): reached from the defining module rustc_type_ir sty/consts.ts: it imports no extension module.
import { GenericArg } from "../generic_args.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert } from "../../../std/panic.ts";
import type { Const } from "../../../rustc_type_ir/sty/consts.ts";
import type { TyCtxt } from "../context.ts";
import type { BinOp, CastKind, UnOp } from "../decls.ts";
import type { GenericArgsRef } from "../generic_args.ts";
import type { Ty } from "../mod.ts";
import type { Expr as ExprT, ExprKind } from "./kind.gen.ts";

export * from "./kind.gen.ts";
/** PORT: the type `Expr` of kind.gen.ts, re-exported next to its companion below (a local `const Expr` would hide it). */
export type Expr = ExprT;

/** `Debug for Expr` (structural_impls.rs:113), required lazily (init order). */
function debug_Expr_(e: ExprT): string {
  const { debug_Expr } = require("../structural_impls.ts") as typeof import("../structural_impls.ts");
  return debug_Expr(e, PLAIN);
}

/** `impl Expr` (kind.rs:32) and `impl inherent::ExprConst for Expr` (kind.rs:26). */
export const Expr = {
  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:27 args
  // (`impl inherent::ExprConst`; same body as the inherent `args` below)
  ir_args(self: ExprT): GenericArgsRef {
    return self.args;
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:33 new_binop
  new_binop(tcx: TyCtxt, binop: BinOp, lhs_ty: Ty, rhs_ty: Ty, lhs_ct: Const, rhs_ct: Const): ExprT {
    const args = tcx.mk_args_from_iter([GenericArg.from_Ty(lhs_ty), GenericArg.from_Ty(rhs_ty), GenericArg.from_Const(lhs_ct), GenericArg.from_Const(rhs_ct)]);

    return { kind: { $: "Binop", _0: binop }, args };
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:48 binop_args
  binop_args(self: ExprT): [Ty, Ty, Const, Const] {
    assert(self.kind.$ === "Binop", "assertion failed: `self.kind` matches `ExprKind::Binop(_)`");

    const s = Expr.args(self);
    if (s.length === 4) {
      const [lhs_ty, rhs_ty, lhs_ct, rhs_ct] = s as readonly GenericArg[];
      return [GenericArg.expect_ty(lhs_ty!), GenericArg.expect_ty(rhs_ty!), GenericArg.expect_const(lhs_ct!), GenericArg.expect_const(rhs_ct!)];
    }
    return bug(`Invalid args for \`Binop\` expr ${debug_Expr_(self)}`);
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:62 new_unop
  new_unop(tcx: TyCtxt, unop: UnOp, ty: Ty, ct: Const): ExprT {
    const args = tcx.mk_args_from_iter([GenericArg.from_Ty(ty), GenericArg.from_Const(ct)]);

    return { kind: { $: "UnOp", _0: unop }, args };
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:69 unop_args
  unop_args(self: ExprT): [Ty, Const] {
    assert(self.kind.$ === "UnOp", "assertion failed: `self.kind` matches `ExprKind::UnOp(_)`");

    const s = Expr.args(self);
    if (s.length === 2) {
      const [ty, ct] = s as readonly GenericArg[];
      return [GenericArg.expect_ty(ty!), GenericArg.expect_const(ct!)];
    }
    return bug(`Invalid args for \`UnOp\` expr ${debug_Expr_(self)}`);
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:78 new_call
  new_call(tcx: TyCtxt, func_ty: Ty, func_expr: Const, arguments_: Iterable<Const>): ExprT {
    const items: GenericArg[] = [GenericArg.from_Ty(func_ty), GenericArg.from_Const(func_expr)];
    for (const ct of arguments_) items.push(GenericArg.from_Const(ct));
    const args = tcx.mk_args_from_iter(items);

    return { kind: { $: "FunctionCall" }, args };
  },

  // PORT: the `impl Iterator<Item = Const>` is an array (eager `expect_const`, same panics in the same order).
  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:93 call_args
  call_args(self: ExprT): [Ty, Const, Const[]] {
    assert(self.kind.$ === "FunctionCall", "assertion failed: `self.kind` matches `ExprKind::FunctionCall`");

    const s = Expr.args(self) as readonly GenericArg[];
    if (s.length >= 2) {
      const func_ty = s[0]!;
      const func = s[1]!;
      const rest = s.slice(2);
      return [GenericArg.expect_ty(func_ty), GenericArg.expect_const(func), rest.map((arg) => GenericArg.expect_const(arg))];
    }
    return bug(`Invalid args for \`Call\` expr ${debug_Expr_(self)}`);
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:106 new_cast
  new_cast(tcx: TyCtxt, cast: CastKind, value_ty: Ty, value: Const, to_ty: Ty): ExprT {
    const args = tcx.mk_args_from_iter([GenericArg.from_Ty(value_ty), GenericArg.from_Const(value), GenericArg.from_Ty(to_ty)]);

    return { kind: { $: "Cast", _0: cast }, args };
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:120 cast_args
  cast_args(self: ExprT): [Ty, Const, Ty] {
    assert(self.kind.$ === "Cast", "assertion failed: `self.kind` matches `ExprKind::Cast(_)`");

    const s = Expr.args(self);
    if (s.length === 3) {
      const [value_ty, value, to_ty] = s as readonly GenericArg[];
      return [GenericArg.expect_ty(value_ty!), GenericArg.expect_const(value!), GenericArg.expect_ty(to_ty!)];
    }
    return bug(`Invalid args for \`Cast\` expr ${debug_Expr_(self)}`);
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:131 new
  new(kind: ExprKind, args: GenericArgsRef): ExprT {
    return { kind, args };
  },

  // rustc: compiler/rustc_middle/src/ty/consts/kind.rs:135 args
  args(self: ExprT): GenericArgsRef {
    return self.args;
  },
};

// #[cfg(target_pointer_width = "64")]
// rustc_data_structures::static_assert_size!(Expr<'_>, 16);
