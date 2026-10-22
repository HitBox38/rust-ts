// Port of compiler/rustc_mir_build/src/builder/expr/category.rs: DECLARED (lane builder-contract, plan-m4 wave 22). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// mb-expr-a; docs/handoff/builder-contract.md has the split table, the conventions and "How to fill a stub"
// (builder/mod.ts's header has the representation notes).
import { type ExprKind } from "../../../rustc_middle/thir.ts";
import { Builder } from "../mod.ts";
import { unported } from "../../../std/panic.ts";
import * as gen from "./category.gen.ts";
export * from "./category.gen.ts";

export interface Category_methods {
  // category.rs:34 (lane mb-expr-a)
  of(ek: ExprKind): Category | undefined;
}
export type Category = gen.Category;
export const Category = gen.Category as typeof gen.Category & Category_methods;

// stub: compiler/rustc_mir_build/src/builder/expr/category.rs:34 of (lane mb-expr-a)
Category.of = function (ek: ExprKind): Category | undefined {
  return unported("rustc_mir_build::builder::expr::category::Category::of");
};
