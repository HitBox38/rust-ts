// Port of compiler/rustc_middle/src/thir/visit.rs (lane middle-traits-thir).
//
// PORT: `trait Visitor<'thir, 'tcx>` is an abstract class (precedent: rustc_ast visit.ts `Visitor`): `thir()` is
// abstract, the provided `visit_*` methods call the `walk_*` functions. `visitor.thir()[id]` is the `Index` impl of
// `Thir` for the id type (thir.ts `index_ExprId`, ...).
import type { Arm, Block, Expr, Pat, Stmt, Thir } from "../thir.ts";

/// Every `walk_*` method uses deconstruction to access fields of structs and
/// enums. This will result in a compile error if a field is added, which makes
/// it more likely the appropriate visit call will be added for it.
export abstract class Visitor {
  // rustc: compiler/rustc_middle/src/thir/visit.rs:11 thir
  abstract thir(): Thir;

  // rustc: compiler/rustc_middle/src/thir/visit.rs:13 visit_expr
  visit_expr(expr: Expr): void {
    walk_expr(this, expr);
  }

  // rustc: compiler/rustc_middle/src/thir/visit.rs:17 visit_stmt
  visit_stmt(stmt: Stmt): void {
    walk_stmt(this, stmt);
  }

  // rustc: compiler/rustc_middle/src/thir/visit.rs:21 visit_block
  visit_block(block: Block): void {
    walk_block(this, block);
  }

  // rustc: compiler/rustc_middle/src/thir/visit.rs:25 visit_arm
  visit_arm(arm: Arm): void {
    walk_arm(this, arm);
  }

  // rustc: compiler/rustc_middle/src/thir/visit.rs:29 visit_pat
  visit_pat(pat: Pat): void {
    walk_pat(this, pat);
  }

  // Note: We don't have visitors for `ty::Const` and `mir::Const`
  // (even though these types occur in THIR) for consistency and to reduce confusion,
  // since the lazy creation of constants during thir construction causes most
  // 'constants' to not be of type `ty::Const` or `mir::Const` at that
  // stage (they are mostly still identified by `DefId` or `hir::Lit`, see
  // the variants `Literal`, `NonHirLiteral` and `NamedConst` in `thir::ExprKind`).
  // You have to manually visit `ty::Const` and `mir::Const` through the
  // other `visit*` functions.
}

// rustc: compiler/rustc_middle/src/thir/visit.rs:43 walk_expr
export function walk_expr(visitor: Visitor, expr: Expr): void {
  const { kind } = expr;
  switch (kind.$) {
    case "Scope":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      break;
    case "If": {
      const { cond, then, else_opt } = kind;
      visitor.visit_expr(visitor.thir().index_ExprId(cond));
      visitor.visit_expr(visitor.thir().index_ExprId(then));
      if (else_opt !== undefined) {
        const else_expr = else_opt;
        visitor.visit_expr(visitor.thir().index_ExprId(else_expr));
      }
      break;
    }
    case "Call": {
      visitor.visit_expr(visitor.thir().index_ExprId(kind.fun));
      for (const arg of kind.args) {
        visitor.visit_expr(visitor.thir().index_ExprId(arg));
      }
      break;
    }
    case "ByUse":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.expr));
      break;
    case "Deref":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.arg));
      break;
    case "Binary":
    case "LogicalOp":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.lhs));
      visitor.visit_expr(visitor.thir().index_ExprId(kind.rhs));
      break;
    case "Unary":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.arg));
      break;
    case "Cast":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "ValueExpr":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "NeverToAny":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "PointerCoercion":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "Let":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.expr));
      visitor.visit_pat(kind.pat);
      break;
    case "Loop":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.body));
      break;
    case "LoopMatch":
    case "Match": {
      const { scrutinee, arms } = kind.$ === "LoopMatch" ? kind.match_data : kind;
      visitor.visit_expr(visitor.thir().index_ExprId(scrutinee));
      for (const arm of arms) {
        visitor.visit_arm(visitor.thir().index_ArmId(arm));
      }
      break;
    }
    case "Block":
      visitor.visit_block(visitor.thir().index_BlockId(kind.block));
      break;
    case "Assign":
    case "AssignOp":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.lhs));
      visitor.visit_expr(visitor.thir().index_ExprId(kind.rhs));
      break;
    case "Field":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.lhs));
      break;
    case "Index":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.lhs));
      visitor.visit_expr(visitor.thir().index_ExprId(kind.index));
      break;
    case "VarRef":
    case "UpvarRef":
      break;
    case "Borrow":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.arg));
      break;
    case "RawBorrow":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.arg));
      break;
    case "Break":
      if (kind.value !== undefined) {
        visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      }
      break;
    case "Continue":
      break;
    case "ConstContinue":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      break;
    case "Return":
      if (kind.value !== undefined) {
        visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      }
      break;
    case "Become":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      break;
    case "ConstBlock":
      break;
    case "Repeat":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      break;
    case "Array":
    case "Tuple":
      for (const field of kind.fields) {
        visitor.visit_expr(visitor.thir().index_ExprId(field));
      }
      break;
    case "Adt": {
      const { fields, base } = kind._0;
      for (const field of fields) {
        visitor.visit_expr(visitor.thir().index_ExprId(field.expr));
      }
      if (base.$ === "Base") {
        visitor.visit_expr(visitor.thir().index_ExprId(base._0.base));
      }
      break;
    }
    case "PlaceTypeAscription":
    case "ValueTypeAscription":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "PlaceUnwrapUnsafeBinder":
    case "ValueUnwrapUnsafeBinder":
    case "WrapUnsafeBinder":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
    case "Closure":
      break;
    case "Literal":
      break;
    case "NonHirLiteral":
      break;
    case "ZstLiteral":
      break;
    case "NamedConst":
      break;
    case "ConstParam":
      break;
    case "StaticRef":
      break;
    case "InlineAsm": {
      for (const op of kind._0.operands) {
        switch (op.$) {
          case "In":
          case "InOut":
            visitor.visit_expr(visitor.thir().index_ExprId(op.expr));
            break;
          case "Out":
            if (op.expr !== undefined) {
              visitor.visit_expr(visitor.thir().index_ExprId(op.expr));
            }
            break;
          case "SplitInOut":
            visitor.visit_expr(visitor.thir().index_ExprId(op.in_expr));
            if (op.out_expr !== undefined) {
              visitor.visit_expr(visitor.thir().index_ExprId(op.out_expr));
            }
            break;
          case "Const":
          case "SymFn":
          case "SymStatic":
            break;
          case "Label":
            visitor.visit_block(visitor.thir().index_BlockId(op.block));
            break;
        }
      }
      break;
    }
    case "ThreadLocalRef":
      break;
    case "Yield":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.value));
      break;
    case "Reborrow":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.source));
      break;
  }
}

// rustc: compiler/rustc_middle/src/thir/visit.rs:196 walk_stmt
export function walk_stmt(visitor: Visitor, stmt: Stmt): void {
  const { kind } = stmt;
  switch (kind.$) {
    case "Expr":
      visitor.visit_expr(visitor.thir().index_ExprId(kind.expr));
      break;
    case "Let": {
      const { initializer, pattern, else_block } = kind;
      if (initializer !== undefined) {
        const init = initializer;
        visitor.visit_expr(visitor.thir().index_ExprId(init));
      }
      visitor.visit_pat(pattern);
      if (else_block !== undefined) {
        const block = else_block;
        visitor.visit_block(visitor.thir().index_BlockId(block));
      }
      break;
    }
  }
}

// rustc: compiler/rustc_middle/src/thir/visit.rs:223 walk_block
export function walk_block(visitor: Visitor, block: Block): void {
  const { stmts, expr } = block;
  for (const stmt of stmts) {
    visitor.visit_stmt(visitor.thir().index_StmtId(stmt));
  }
  if (expr !== undefined) {
    visitor.visit_expr(visitor.thir().index_ExprId(expr));
  }
}

// rustc: compiler/rustc_middle/src/thir/visit.rs:237 walk_arm
export function walk_arm(visitor: Visitor, arm: Arm): void {
  const { guard, pattern, body } = arm;
  if (guard !== undefined) {
    const expr = guard;
    visitor.visit_expr(visitor.thir().index_ExprId(expr));
  }
  visitor.visit_pat(pattern);
  visitor.visit_expr(visitor.thir().index_ExprId(body));
}

// rustc: compiler/rustc_middle/src/thir/visit.rs:249 walk_pat
export function walk_pat(visitor: Visitor, pat: Pat): void {
  if (pat.kind.$ === "Guard") {
    const { subpattern, condition } = pat.kind;
    visitor.visit_pat(subpattern);
    visitor.visit_expr(visitor.thir().index_ExprId(condition));
    return;
  }

  for_each_immediate_subpat(pat, (p) => visitor.visit_pat(p));
}

/// Invokes `callback` on each immediate subpattern of `pat`, if any.
/// A building block for assembling THIR pattern visitors.
// rustc: compiler/rustc_middle/src/thir/visit.rs:264 for_each_immediate_subpat
export function for_each_immediate_subpat(pat: Pat, callback: (p: Pat) => void): void {
  const { kind } = pat;
  switch (kind.$) {
    case "Missing":
    case "Wild":
    case "Constant":
    case "Range":
    case "Never":
    case "Error":
      break;

    case "Binding":
      if (kind.subpattern !== undefined) callback(kind.subpattern);
      break;
    case "Deref":
    case "DerefPattern":
      callback(kind.subpattern);
      break;

    case "Variant":
    case "Leaf":
      for (const field_pat of kind.subpatterns) {
        callback(field_pat.pattern);
      }
      break;

    case "Slice":
    case "Array": {
      const { prefix, slice, suffix } = kind;
      for (const pat of [...prefix, ...(slice !== undefined ? [slice] : []), ...suffix]) {
        callback(pat);
      }
      break;
    }

    case "Or":
      for (const pat of kind.pats) {
        callback(pat);
      }
      break;

    case "Guard":
      callback(kind.subpattern);
      break;
  }
}
