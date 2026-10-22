// Port of compiler/rustc_mir_build/src/builder/expr/as_constant.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type Const, type ConstOperand } from "../../../rustc_middle/mir/mod.ts";
import { type Expr } from "../../../rustc_middle/thir.ts";
import { type LitToConstInput } from "../../../rustc_middle/ty/consts/lit.ts";
import { type TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type CanonicalUserType, type UserTypeAnnotationIndex } from "../../../rustc_middle/ty/typeck_results.ts";
import { Builder } from "../mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../mod.ts" {
  interface Builder {
    // as_constant.rs:23 (lane mb-expr-a)
    as_constant(expr: Expr): ConstOperand;
  }
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:23 as_constant (lane mb-expr-a)
Builder.prototype.as_constant = function (this: Builder, expr: Expr): ConstOperand {
  return unported("rustc_mir_build::builder::expr::as_constant::Builder::as_constant");
};

// stub: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:46 as_constant_inner (lane mb-expr-a)
export function as_constant_inner(expr: Expr, push_cuta: (a0: CanonicalUserType) => UserTypeAnnotationIndex | undefined, tcx: TyCtxt): ConstOperand {
  return unported("rustc_mir_build::builder::expr::as_constant::as_constant_inner");
}

// stub: compiler/rustc_mir_build/src/builder/expr/as_constant.rs:145 lit_to_mir_constant (lane mb-expr-a)
export function lit_to_mir_constant(tcx: TyCtxt, lit_input: LitToConstInput): Const {
  return unported("rustc_mir_build::builder::expr::as_constant::lit_to_mir_constant");
}
