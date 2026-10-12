// Port of compiler/rustc_ast/src/util/parser.rs
// Types and derived Debug impls are generated into parser.gen.ts (tools/codegen/types.ts).
import { BinOpKind } from "../ast.ts";
import type { Expr } from "../ast.ts";
import type { Token } from "../token.ts";
import { kw } from "../../rustc_span/symbol.ts";
import * as gen from "./parser.gen.ts";
import type { ExprPrecedence as ExprPrecedenceT, Fixity } from "./parser.gen.ts";

export * from "./parser.gen.ts";


/// Associative operator.
export type AssocOp = gen.AssocOp;
export const AssocOp = {
  ...gen.AssocOp,

  /// Creates a new AssocOp from a token.
  // rustc: compiler/rustc_ast/src/util/parser.rs:33 from_token
  from_token(t: Token): AssocOp | undefined {
    switch (t.kind.$) {
      case "Eq":
        return gen.AssocOp.Assign;
      case "Plus":
        return { $: "Binary", _0: "Add" };
      case "Minus":
        return { $: "Binary", _0: "Sub" };
      case "Star":
        return { $: "Binary", _0: "Mul" };
      case "Slash":
        return { $: "Binary", _0: "Div" };
      case "Percent":
        return { $: "Binary", _0: "Rem" };
      case "Caret":
        return { $: "Binary", _0: "BitXor" };
      case "And":
        return { $: "Binary", _0: "BitAnd" };
      case "Or":
        return { $: "Binary", _0: "BitOr" };
      case "Shl":
        return { $: "Binary", _0: "Shl" };
      case "Shr":
        return { $: "Binary", _0: "Shr" };
      case "PlusEq":
        return { $: "AssignOp", _0: "AddAssign" };
      case "MinusEq":
        return { $: "AssignOp", _0: "SubAssign" };
      case "StarEq":
        return { $: "AssignOp", _0: "MulAssign" };
      case "SlashEq":
        return { $: "AssignOp", _0: "DivAssign" };
      case "PercentEq":
        return { $: "AssignOp", _0: "RemAssign" };
      case "CaretEq":
        return { $: "AssignOp", _0: "BitXorAssign" };
      case "AndEq":
        return { $: "AssignOp", _0: "BitAndAssign" };
      case "OrEq":
        return { $: "AssignOp", _0: "BitOrAssign" };
      case "ShlEq":
        return { $: "AssignOp", _0: "ShlAssign" };
      case "ShrEq":
        return { $: "AssignOp", _0: "ShrAssign" };
      case "Lt":
        return { $: "Binary", _0: "Lt" };
      case "Le":
        return { $: "Binary", _0: "Le" };
      case "Ge":
        return { $: "Binary", _0: "Ge" };
      case "Gt":
        return { $: "Binary", _0: "Gt" };
      case "EqEq":
        return { $: "Binary", _0: "Eq" };
      case "Ne":
        return { $: "Binary", _0: "Ne" };
      case "AndAnd":
        return { $: "Binary", _0: "And" };
      case "OrOr":
        return { $: "Binary", _0: "Or" };
      case "DotDot":
        return { $: "Range", _0: "HalfOpen" };
      // DotDotDot is no longer supported, but we need some way to display the error
      case "DotDotEq":
      case "DotDotDot":
        return { $: "Range", _0: "Closed" };
      // `<-` should probably be `< -`
      case "LArrow":
        return { $: "Binary", _0: "Lt" };
      default:
        if (t.is_keyword(kw.As)) return gen.AssocOp.Cast;
        return undefined;
    }
  },

  /// Gets the precedence of this operator
  // rustc: compiler/rustc_ast/src/util/parser.rs:76 precedence
  precedence(self: AssocOp): ExprPrecedence {
    switch (self.$) {
      case "Cast":
        return "Cast";
      case "Binary":
        return BinOpKind.precedence(self._0);
      case "Range":
        return "Range";
      case "Assign":
      case "AssignOp":
        return "Assign";
    }
  },

  /// Gets the fixity of this operator
  // rustc: compiler/rustc_ast/src/util/parser.rs:87 fixity
  fixity(self: AssocOp): Fixity {
    // NOTE: it is a bug to have an operators that has same precedence but different fixities!
    switch (self.$) {
      case "Assign":
      case "AssignOp":
        return "Right";
      case "Binary":
        return BinOpKind.fixity(self._0);
      case "Cast":
        return "Left";
      case "Range":
        return "None";
    }
  },

  // rustc: compiler/rustc_ast/src/util/parser.rs:98 is_comparison
  is_comparison(self: AssocOp): boolean {
    switch (self.$) {
      case "Binary":
        return BinOpKind.is_comparison(self._0);
      case "Assign":
      case "AssignOp":
      case "Cast":
      case "Range":
        return false;
    }
  },

  // rustc: compiler/rustc_ast/src/util/parser.rs:106 is_assign_like
  is_assign_like(self: AssocOp): boolean {
    switch (self.$) {
      case "Assign":
      case "AssignOp":
        return true;
      case "Cast":
      case "Binary":
      case "Range":
        return false;
    }
  },
};

export type ExprPrecedence = ExprPrecedenceT;
export const ExprPrecedence = gen.ExprPrecedence;

/// In `let p = e`, operators with precedence `<=` this one requires parentheses in `e`.
// rustc: compiler/rustc_ast/src/util/parser.rs:150 prec_let_scrutinee_needs_par
export function prec_let_scrutinee_needs_par(): ExprPrecedence {
  return "LAnd";
}

/// Suppose we have `let _ = e` and the `order` of `e`.
/// Is the `order` such that `e` in `let _ = e` needs parentheses when it is on the RHS?
///
/// Conversely, suppose that we have `(let _ = a) OP b` and `order` is that of `OP`.
/// Can we print this as `let _ = a OP b`?
// rustc: compiler/rustc_ast/src/util/parser.rs:159 needs_par_as_let_scrutinee
export function needs_par_as_let_scrutinee(order: ExprPrecedence): boolean {
  // PORT: `#[derive(PartialOrd)]` compares the variants by discriminant (generated `ExprPrecedence_discriminant`).
  return gen.ExprPrecedence_discriminant[order] <= gen.ExprPrecedence_discriminant[prec_let_scrutinee_needs_par()];
}

/// Expressions that syntactically contain an "exterior" struct literal i.e., not surrounded by any
/// parens or other delimiters, e.g., `X { y: 1 }`, `X { y: 1 }.method()`, `foo == X { y: 1 }` and
/// `X { y: 1 } == foo` all do, but `(X { y: 1 }) == foo` does not.
// rustc: compiler/rustc_ast/src/util/parser.rs:166 contains_exterior_struct_lit
export function contains_exterior_struct_lit(value: Expr): boolean {
  const kind = value.kind;
  switch (kind.$) {
    case "Struct":
      return true;

    case "Assign":
      // X { y: 1 } + X { y: 2 }
      return contains_exterior_struct_lit(kind._0) || contains_exterior_struct_lit(kind._1);
    case "AssignOp":
    case "Binary":
      // X { y: 1 } + X { y: 2 }
      return contains_exterior_struct_lit(kind._1) || contains_exterior_struct_lit(kind._2);
    case "Await":
    case "Cast":
    case "Type":
    case "Field":
    case "Index":
      // &X { y: 1 }, X { y: 1 }.y
      return contains_exterior_struct_lit(kind._0);
    case "Unary":
      // &X { y: 1 }, X { y: 1 }.y
      return contains_exterior_struct_lit(kind._1);
    case "Match":
      if (kind._2 === "Postfix") {
        // &X { y: 1 }, X { y: 1 }.y
        return contains_exterior_struct_lit(kind._0);
      }
      return false;

    case "MethodCall":
      // X { y: 1 }.bar(...)
      return contains_exterior_struct_lit(kind._0.receiver);

    default:
      return false;
  }
}
