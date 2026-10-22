// Port of compiler/rustc_mir_build/src/builder/expr/category.rs (declared by lane builder-contract, filled by lane mb-expr-a,
// plan-m4 wave 22; builder/mod.ts's header has the representation notes).
import { type ExprKind } from "../../../rustc_middle/thir.ts";
import * as gen from "./category.gen.ts";
import { RvalueFunc } from "./category.gen.ts";
export * from "./category.gen.ts";

export interface Category_methods {
  of(ek: ExprKind): Category | undefined;
}
export type Category = gen.Category;
export const Category = gen.Category as typeof gen.Category & Category_methods;

/// Determines the category for a given expression. Note that scope
/// and paren expressions have no category.
// rustc: compiler/rustc_mir_build/src/builder/expr/category.rs:34 of
Category.of = function (ek: ExprKind): Category | undefined {
  switch (ek.$) {
    case "Scope":
      return undefined;

    case "Field":
    case "Deref":
    case "Index":
    case "UpvarRef":
    case "VarRef":
    case "PlaceTypeAscription":
    case "ValueTypeAscription":
    case "PlaceUnwrapUnsafeBinder":
    case "ValueUnwrapUnsafeBinder":
      return Category.Place;

    case "LogicalOp":
    case "Match":
    case "If":
    case "Let":
    case "NeverToAny":
    case "ValueExpr":
    case "Adt":
    case "Borrow":
    case "RawBorrow":
    case "Yield":
    case "Call":
    case "ByUse":
    case "InlineAsm":
      return { $: "Rvalue", _0: RvalueFunc.Into };

    case "Array":
    case "Tuple":
    case "Closure":
    case "Unary":
    case "Binary":
    case "Cast":
    case "PointerCoercion":
    case "Repeat":
    case "Assign":
    case "AssignOp":
    // A reborrow expression produces a value represented in MIR as
    // `Rvalue::Reborrow`. Its source may be a place, but the reborrow
    // expression itself does not denote an assignable place.
    case "Reborrow":
    case "ThreadLocalRef":
    case "WrapUnsafeBinder":
      return { $: "Rvalue", _0: RvalueFunc.AsRvalue };

    case "ConstBlock":
    case "Literal":
    case "NonHirLiteral":
    case "ZstLiteral":
    case "ConstParam":
    case "StaticRef":
    case "NamedConst":
      return Category.Constant;

    case "Loop":
    case "LoopMatch":
    case "Block":
    case "Break":
    case "Continue":
    case "ConstContinue":
    case "Return":
    case "Become":
      // FIXME(#27840) these probably want their own
      // category, like "nonterminating"
      {
        return { $: "Rvalue", _0: RvalueFunc.Into };
      }
  }
};
