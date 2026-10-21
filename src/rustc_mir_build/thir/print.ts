// Port of compiler/rustc_mir_build/src/thir/print.rs (lane thir-cx-print).
//
// `{:?}` of the rustc_middle `mir/syntax.rs` enums THIR stores (`BinOp`, `UnOp`, `AssignOp`, `BorrowKind`,
// `FakeReadCause`) is their derived Debug from the partial mir/syntax.ts (codegen set rustc_middle_mir).
// PORT: `{:?}` of `mir::Const` and `AllocId` (never built by the ported lowering: asm `const` operands and statics stop
// as UNPORTED there) is `unported`.
import { debug_AsmMacro, debug_BindingMode, debug_InlineAsmOptions, debug_InlineAsmTemplatePiece, debug_LitKind } from "../../rustc_ast/lib.ts";
import { debug_Movability, debug_Mutability, debug_Pinnedness } from "../../rustc_ast_ir/lib.ts";
import { debug_ImplicitSelfKind, debug_MatchSource } from "../../rustc_hir/hir.ts";
import { debug_HirId, debug_ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { debug_Scope } from "../../rustc_middle/middle/region.ts";
import {
  type AdtExpr,
  type ArmId,
  type BlockId,
  type ClosureExpr,
  debug_Ascription,
  debug_BlockSafety,
  debug_Pat as debug_Pat_,
  debug_LocalVarId,
  debug_LogicalOp,
  debug_PatRange,
  debug_Thir,
  type ExprId,
  type ExprKind,
  type FruInfo,
  type InlineAsmExpr,
  type InlineAsmOperand,
  type Param,
  type Pat,
  type PatExtra,
  type PatKind,
  type StmtId,
  type Thir,
  type UserTy,
} from "../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { debug_AdtFlags } from "../../rustc_middle/ty/adt.ts";
import { debug_PointerCoercion } from "../../rustc_middle/ty/adjustment.gen.ts";
import { debug_ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { display_Value } from "../../rustc_middle/ty/consts/valtree.ts";
import type { AdtDef } from "../../rustc_middle/ty/decls.ts";
import { debug_AssignOp, debug_BinOp, debug_BorrowKind, debug_FakeReadCause, debug_UnOp } from "../../rustc_middle/mir/mod.ts";
import { debug_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_Ty, debug_VariantDef } from "../../rustc_middle/ty/mod.ts";
import { debug_ParamConst } from "../../rustc_middle/ty/structural_impls.ts";
import { debug_UpvarArgs } from "../../rustc_middle/ty/sty.gen.ts";
import { debug_UserType } from "../../rustc_middle/ty/typeck_results.ts";
import { debug_ReprOptions } from "../../rustc_abi/lib.ts";
import { debug_DefId, debug_LocalDefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { debug_Span, debug_Spanned } from "../../rustc_span/lib.ts";
import { debug_Symbol } from "../../rustc_span/symbol.ts";
import { debug_InlineAsmRegOrRegClass } from "../../rustc_target/asm/mod.ts";
import { debug_Canonical } from "../../rustc_type_ir/canonical.ts";
import { debug_AliasConstKind } from "../../rustc_type_ir/const_kind.ts";
import { debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_bool, debug_int, debug_option, debug_vec, PLAIN, PRETTY } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { Ok, type Result } from "../../std/result.ts";
import * as cx from "./cx/mod.ts";

/// Create a THIR tree for debugging.
// rustc: compiler/rustc_mir_build/src/thir/print.rs:9 thir_tree
export function thir_tree(tcx: TyCtxt, owner_def: LocalDefId): string {
  const r = cx.thir_body(tcx, owner_def);
  if (r.$ === "Ok") {
    const [thir_, expr] = r._0;
    const thir = thir_.steal();
    const printer = ThirPrinter.new(thir);
    printer.print(expr);
    return printer.into_buffer();
  } else {
    return "error";
  }
}

/// Create a list-like THIR representation for debugging.
// rustc: compiler/rustc_mir_build/src/thir/print.rs:22 thir_flat
export function thir_flat(tcx: TyCtxt, owner_def: LocalDefId): string {
  const r = cx.thir_body(tcx, owner_def);
  if (r.$ === "Ok") {
    const [thir] = r._0;
    return debug_Thir(thir.steal(), PRETTY);
  } else {
    return "error";
  }
}

const INDENT = "    ";

/**
 * `macro_rules! print_indented` (print.rs:35): `$writer.indent($indent_lvl); writeln!($writer, "{}", $s)` (`$s` is
 * written with `{}`, so it is never itself a format string).
 */
function print_indented(writer: ThirPrinter, s: string, indent_lvl: number): void {
  writer.indent(indent_lvl);
  writer.write_str(`${s}\n`);
}

// PORT: exported (private upstream) so that print.test.ts can print a hand-built `Thir`.
// rustc-type: compiler/rustc_mir_build/src/thir/print.rs:29 ThirPrinter
export class ThirPrinter {
  constructor(
    public thir: Thir,
    public fmt: string,
  ) {}

  // `impl Write for ThirPrinter`
  // rustc: compiler/rustc_mir_build/src/thir/print.rs:44 write_str
  write_str(s: string): Result<null, never> {
    this.fmt += s;
    return Ok(null);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:51 new
  static new(thir: Thir): ThirPrinter {
    return new ThirPrinter(thir, "");
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:55 indent
  indent(level: number): void {
    for (let i = 0; i < level; i++) {
      this.fmt += INDENT;
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:61 print
  print(body_expr: ExprId): void {
    print_indented(this, "params: [", 0);
    for (const param of this.thir.params) {
      this.print_param(param, 1);
    }
    print_indented(this, "]", 0);

    print_indented(this, "body:", 0);
    this.print_expr(body_expr, 1);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:72 into_buffer
  into_buffer(): string {
    return this.fmt;
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:76 print_list
  print_list<T>(label: string, list: readonly T[], depth_lvl: number, print_fn: (this_: ThirPrinter, item: T, depth_lvl: number) => void): void {
    if (list.length === 0) {
      print_indented(this, `${label}: []`, depth_lvl);
    } else {
      print_indented(this, `${label}: [`, depth_lvl);
      for (const item of list) {
        print_fn(this, item, depth_lvl + 1);
      }
      print_indented(this, "]", depth_lvl);
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:94 print_param
  print_param(param: Param, depth_lvl: number): void {
    const { pat, ty, ty_span, self_kind, hir_id } = param;

    print_indented(this, "Param {", depth_lvl);
    print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `ty_span: ${debug_option(ty_span, PLAIN, debug_Span)}`, depth_lvl + 1);
    print_indented(this, `self_kind: ${debug_option(self_kind, PLAIN, debug_ImplicitSelfKind)}`, depth_lvl + 1);
    print_indented(this, `hir_id: ${debug_option(hir_id, PLAIN, debug_HirId)}`, depth_lvl + 1);

    if (pat !== undefined) {
      print_indented(this, "param: Some( ", depth_lvl + 1);
      this.print_pat(pat, depth_lvl + 2);
      print_indented(this, ")", depth_lvl + 1);
    } else {
      print_indented(this, "param: None", depth_lvl + 1);
    }

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:114 print_block
  print_block(block_id: BlockId, depth_lvl: number): void {
    const { targeted_by_break, span, region_scope, stmts, expr, safety_mode } = this.thir.index_BlockId(block_id);

    print_indented(this, "Block {", depth_lvl);
    print_indented(this, `targeted_by_break: ${targeted_by_break}`, depth_lvl + 1);
    print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `region_scope: ${debug_Scope(region_scope, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `safety_mode: ${debug_BlockSafety(safety_mode, PLAIN)}`, depth_lvl + 1);

    if (stmts.length > 0) {
      print_indented(this, "stmts: [", depth_lvl + 1);
      for (const stmt of stmts) {
        this.print_stmt(stmt, depth_lvl + 2);
      }
      print_indented(this, "]", depth_lvl + 1);
    } else {
      print_indented(this, "stmts: []", depth_lvl + 1);
    }

    if (expr !== undefined) {
      const expr_id = expr;
      print_indented(this, "expr:", depth_lvl + 1);
      this.print_expr(expr_id, depth_lvl + 2);
    } else {
      print_indented(this, "expr: []", depth_lvl + 1);
    }

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:144 print_stmt
  print_stmt(stmt_id: StmtId, depth_lvl: number): void {
    const { kind } = this.thir.index_StmtId(stmt_id);

    print_indented(this, "Stmt {", depth_lvl);

    switch (kind.$) {
      case "Expr": {
        const { scope, expr } = kind;
        print_indented(this, "kind: Expr {", depth_lvl + 1);
        print_indented(this, `scope: ${debug_Scope(scope, PLAIN)}`, depth_lvl + 2);
        print_indented(this, "expr:", depth_lvl + 2);
        this.print_expr(expr, depth_lvl + 3);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Let": {
        const { remainder_scope, init_scope, pattern, initializer, else_block, hir_id, span } = kind;
        print_indented(this, "kind: Let {", depth_lvl + 1);
        print_indented(this, `remainder_scope: ${debug_Scope(remainder_scope, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `init_scope: ${debug_Scope(init_scope, PLAIN)}`, depth_lvl + 2);

        print_indented(this, "pattern: ", depth_lvl + 2);
        this.print_pat(pattern, depth_lvl + 3);
        print_indented(this, ",", depth_lvl + 2);

        if (initializer !== undefined) {
          const init = initializer;
          print_indented(this, "initializer: Some(", depth_lvl + 2);
          this.print_expr(init, depth_lvl + 3);
          print_indented(this, ")", depth_lvl + 2);
        } else {
          print_indented(this, "initializer: None", depth_lvl + 2);
        }

        if (else_block !== undefined) {
          print_indented(this, "else_block: Some(", depth_lvl + 2);
          this.print_block(else_block, depth_lvl + 3);
          print_indented(this, ")", depth_lvl + 2);
        } else {
          print_indented(this, "else_block: None", depth_lvl + 2);
        }

        print_indented(this, `hir_id: ${debug_HirId(hir_id, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
    }

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:203 print_expr
  print_expr(expr: ExprId, depth_lvl: number): void {
    const { ty, temp_scope_id, span, kind } = this.thir.index_ExprId(expr);
    print_indented(this, "Expr {", depth_lvl);
    print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `temp_scope_id: ${debug_ItemLocalId(temp_scope_id, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
    print_indented(this, "kind: ", depth_lvl + 1);
    this.print_expr_kind(kind, depth_lvl + 2);
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:214 print_expr_kind
  print_expr_kind(expr_kind: ExprKind, depth_lvl: number): void {
    // use rustc_middle::thir::ExprKind::*;

    switch (expr_kind.$) {
      case "Scope": {
        const { region_scope, value, hir_id } = expr_kind;
        print_indented(this, "Scope {", depth_lvl);
        print_indented(this, `region_scope: ${debug_Scope(region_scope, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `hir_id: ${debug_HirId(hir_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "value:", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "If": {
        const { if_then_scope, cond, then, else_opt } = expr_kind;
        print_indented(this, "If {", depth_lvl);
        print_indented(this, `if_then_scope: ${debug_Scope(if_then_scope, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "cond:", depth_lvl + 1);
        this.print_expr(cond, depth_lvl + 2);
        print_indented(this, "then:", depth_lvl + 1);
        this.print_expr(then, depth_lvl + 2);

        if (else_opt !== undefined) {
          const else_expr = else_opt;
          print_indented(this, "else:", depth_lvl + 1);
          this.print_expr(else_expr, depth_lvl + 2);
        }

        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Call": {
        const { fun, args, ty, from_hir_call, fn_span } = expr_kind;
        print_indented(this, "Call {", depth_lvl);
        print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `from_hir_call: ${from_hir_call}`, depth_lvl + 1);
        print_indented(this, `fn_span: ${debug_Span(fn_span, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "fun:", depth_lvl + 1);
        this.print_expr(fun, depth_lvl + 2);

        if (args.length > 0) {
          print_indented(this, "args: [", depth_lvl + 1);
          for (const arg of args) {
            this.print_expr(arg, depth_lvl + 2);
          }
          print_indented(this, "]", depth_lvl + 1);
        } else {
          print_indented(this, "args: []", depth_lvl + 1);
        }

        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ByUse": {
        const { expr, span } = expr_kind;
        print_indented(this, "ByUse {", depth_lvl);
        print_indented(this, "expr:", depth_lvl + 1);
        this.print_expr(expr, depth_lvl + 2);
        print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Deref": {
        const { arg } = expr_kind;
        print_indented(this, "Deref {", depth_lvl);
        this.print_expr(arg, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Binary": {
        const { op, lhs, rhs } = expr_kind;
        print_indented(this, "Binary {", depth_lvl);
        print_indented(this, `op: ${debug_BinOp(op, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "rhs:", depth_lvl + 1);
        this.print_expr(rhs, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "LogicalOp": {
        const { op, lhs, rhs } = expr_kind;
        print_indented(this, "LogicalOp {", depth_lvl);
        print_indented(this, `op: ${debug_LogicalOp(op, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "rhs:", depth_lvl + 1);
        this.print_expr(rhs, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Unary": {
        const { op, arg } = expr_kind;
        print_indented(this, "Unary {", depth_lvl);
        print_indented(this, `op: ${debug_UnOp(op, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "arg:", depth_lvl + 1);
        this.print_expr(arg, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Cast": {
        const { source } = expr_kind;
        print_indented(this, "Cast {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ValueExpr": {
        const { source } = expr_kind;
        print_indented(this, "ValueExpr {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "NeverToAny": {
        const { source } = expr_kind;
        print_indented(this, "NeverToAny {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "PointerCoercion": {
        const { cast, is_from_as_cast, source } = expr_kind;
        print_indented(this, "Pointer {", depth_lvl);
        print_indented(this, `cast: ${debug_PointerCoercion(cast, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `is_from_as_cast: ${debug_bool(is_from_as_cast, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Loop": {
        const { body } = expr_kind;
        print_indented(this, "Loop (", depth_lvl);
        print_indented(this, "body:", depth_lvl + 1);
        this.print_expr(body, depth_lvl + 2);
        print_indented(this, ")", depth_lvl);
        break;
      }
      case "LoopMatch": {
        const { state, region_scope, match_data } = expr_kind;
        print_indented(this, "LoopMatch {", depth_lvl);
        print_indented(this, "state:", depth_lvl + 1);
        this.print_expr(state, depth_lvl + 2);
        print_indented(this, `region_scope: ${debug_Scope(region_scope, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "match_data:", depth_lvl + 1);
        print_indented(this, "LoopMatchMatchData {", depth_lvl + 2);
        print_indented(this, `span: ${debug_Span(match_data.span, PLAIN)}`, depth_lvl + 3);
        print_indented(this, "scrutinee:", depth_lvl + 3);
        this.print_expr(match_data.scrutinee, depth_lvl + 4);

        print_indented(this, "arms: [", depth_lvl + 3);
        for (const arm_id of match_data.arms) {
          this.print_arm(arm_id, depth_lvl + 4);
        }
        print_indented(this, "]", depth_lvl + 3);
        print_indented(this, "}", depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Let": {
        const { expr, pat } = expr_kind;
        print_indented(this, "Let {", depth_lvl);
        print_indented(this, "expr:", depth_lvl + 1);
        this.print_expr(expr, depth_lvl + 2);
        print_indented(this, `pat: ${debug_Pat(pat)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Match": {
        const { scrutinee, arms, match_source } = expr_kind;
        print_indented(this, "Match {", depth_lvl);
        print_indented(this, "scrutinee:", depth_lvl + 1);
        this.print_expr(scrutinee, depth_lvl + 2);

        print_indented(this, "arms: [", depth_lvl + 1);
        for (const arm_id of arms) {
          this.print_arm(arm_id, depth_lvl + 2);
        }
        print_indented(this, "]", depth_lvl + 1);
        print_indented(this, `match_source: ${debug_MatchSource(match_source, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Block": {
        const { block } = expr_kind;
        this.print_block(block, depth_lvl);
        break;
      }
      case "Assign": {
        const { lhs, rhs } = expr_kind;
        print_indented(this, "Assign {", depth_lvl);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "rhs:", depth_lvl + 1);
        this.print_expr(rhs, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "AssignOp": {
        const { op, lhs, rhs } = expr_kind;
        print_indented(this, "AssignOp {", depth_lvl);
        print_indented(this, `op: ${debug_AssignOp(op, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "rhs:", depth_lvl + 1);
        this.print_expr(rhs, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Field": {
        const { lhs, variant_index, name } = expr_kind;
        print_indented(this, "Field {", depth_lvl);
        print_indented(this, `variant_index: ${debug_int(variant_index, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `name: ${debug_int(name, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Index": {
        const { lhs, index } = expr_kind;
        print_indented(this, "Index {", depth_lvl);
        print_indented(this, "lhs:", depth_lvl + 1);
        this.print_expr(lhs, depth_lvl + 2);
        print_indented(this, "index:", depth_lvl + 1);
        this.print_expr(index, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "VarRef": {
        const { id } = expr_kind;
        print_indented(this, "VarRef {", depth_lvl);
        print_indented(this, `id: ${debug_LocalVarId(id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "UpvarRef": {
        const { closure_def_id, var_hir_id } = expr_kind;
        print_indented(this, "UpvarRef {", depth_lvl);
        print_indented(this, `closure_def_id: ${debug_DefId(closure_def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `var_hir_id: ${debug_LocalVarId(var_hir_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Borrow": {
        const { borrow_kind, arg } = expr_kind;
        print_indented(this, "Borrow (", depth_lvl);
        print_indented(this, `borrow_kind: ${debug_BorrowKind(borrow_kind, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "arg:", depth_lvl + 1);
        this.print_expr(arg, depth_lvl + 2);
        print_indented(this, ")", depth_lvl);
        break;
      }
      case "RawBorrow": {
        const { mutability, arg } = expr_kind;
        print_indented(this, "RawBorrow {", depth_lvl);
        print_indented(this, `mutability: ${debug_Mutability(mutability, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "arg:", depth_lvl + 1);
        this.print_expr(arg, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Break": {
        const { label, value } = expr_kind;
        print_indented(this, "Break (", depth_lvl);
        print_indented(this, `label: ${debug_Scope(label, PLAIN)}`, depth_lvl + 1);

        if (value !== undefined) {
          print_indented(this, "value:", depth_lvl + 1);
          this.print_expr(value, depth_lvl + 2);
        }

        print_indented(this, ")", depth_lvl);
        break;
      }
      case "Continue": {
        const { label } = expr_kind;
        print_indented(this, "Continue {", depth_lvl);
        print_indented(this, `label: ${debug_Scope(label, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ConstContinue": {
        const { label, value } = expr_kind;
        print_indented(this, "ConstContinue (", depth_lvl);
        print_indented(this, `label: ${debug_Scope(label, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "value:", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, ")", depth_lvl);
        break;
      }
      case "Return": {
        const { value } = expr_kind;
        print_indented(this, "Return {", depth_lvl);
        print_indented(this, "value:", depth_lvl + 1);

        if (value !== undefined) {
          this.print_expr(value, depth_lvl + 2);
        }

        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Become": {
        const { value } = expr_kind;
        print_indented(this, "Become {", depth_lvl);
        print_indented(this, "value:", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ConstBlock": {
        const { did, args } = expr_kind;
        print_indented(this, "ConstBlock {", depth_lvl);
        print_indented(this, `did: ${debug_DefId(did, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `args: ${debug_GenericArgs(args, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Repeat": {
        const { value, count } = expr_kind;
        print_indented(this, "Repeat {", depth_lvl);
        print_indented(this, `count: ${debug_Const(count, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "value:", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Array": {
        const { fields } = expr_kind;
        print_indented(this, "Array {", depth_lvl);
        print_indented(this, "fields: [", depth_lvl + 1);
        for (const field_id of fields) {
          this.print_expr(field_id, depth_lvl + 2);
        }
        print_indented(this, "]", depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Tuple": {
        const { fields } = expr_kind;
        print_indented(this, "Tuple {", depth_lvl);
        print_indented(this, "fields: [", depth_lvl + 1);
        for (const field_id of fields) {
          this.print_expr(field_id, depth_lvl + 2);
        }
        print_indented(this, "]", depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Adt": {
        const adt_expr = expr_kind._0;
        print_indented(this, "Adt {", depth_lvl);
        this.print_adt_expr(adt_expr, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "PlaceTypeAscription": {
        const { source, user_ty, user_ty_span } = expr_kind;
        print_indented(this, "PlaceTypeAscription {", depth_lvl);
        print_indented(this, `user_ty: ${debug_UserTy(user_ty)}`, depth_lvl + 1);
        print_indented(this, `user_ty_span: ${debug_Span(user_ty_span, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ValueTypeAscription": {
        const { source, user_ty, user_ty_span } = expr_kind;
        print_indented(this, "ValueTypeAscription {", depth_lvl);
        print_indented(this, `user_ty: ${debug_UserTy(user_ty)}`, depth_lvl + 1);
        print_indented(this, `user_ty_span: ${debug_Span(user_ty_span, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "PlaceUnwrapUnsafeBinder": {
        const { source } = expr_kind;
        print_indented(this, "PlaceUnwrapUnsafeBinder {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ValueUnwrapUnsafeBinder": {
        const { source } = expr_kind;
        print_indented(this, "ValueUnwrapUnsafeBinder {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "WrapUnsafeBinder": {
        const { source } = expr_kind;
        print_indented(this, "WrapUnsafeBinder {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        this.print_expr(source, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Closure": {
        const closure_expr = expr_kind._0;
        print_indented(this, "Closure {", depth_lvl);
        print_indented(this, "closure_expr:", depth_lvl + 1);
        this.print_closure_expr(closure_expr, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Literal": {
        const { lit, neg } = expr_kind;
        print_indented(this, `Literal( lit: ${debug_Spanned(lit, PLAIN, debug_LitKind)}, neg: ${debug_bool(neg, PLAIN)})\n`, depth_lvl);
        break;
      }
      case "NonHirLiteral": {
        const { lit, user_ty } = expr_kind;
        print_indented(this, "NonHirLiteral {", depth_lvl);
        print_indented(this, `lit: ${debug_ScalarInt(lit, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `user_ty: ${debug_UserTy(user_ty)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ZstLiteral": {
        const { user_ty } = expr_kind;
        print_indented(this, `ZstLiteral(user_ty: ${debug_UserTy(user_ty)})`, depth_lvl);
        break;
      }
      case "NamedConst": {
        const { def_id, args, user_ty } = expr_kind;
        print_indented(this, "NamedConst {", depth_lvl);
        print_indented(this, `def_id: ${debug_DefId(def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `user_ty: ${debug_UserTy(user_ty)}`, depth_lvl + 1);
        print_indented(this, `args: ${debug_GenericArgs(args, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ConstParam": {
        const { param, def_id } = expr_kind;
        print_indented(this, "ConstParam {", depth_lvl);
        print_indented(this, `def_id: ${debug_DefId(def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `param: ${debug_ParamConst(param, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "StaticRef": {
        const { alloc_id, ty, def_id } = expr_kind;
        print_indented(this, "StaticRef {", depth_lvl);
        print_indented(this, `def_id: ${debug_DefId(def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `alloc_id: ${debug_AllocId(alloc_id)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "InlineAsm": {
        const expr = expr_kind._0;
        print_indented(this, "InlineAsm {", depth_lvl);
        print_indented(this, "expr:", depth_lvl + 1);
        this.print_inline_asm_expr(expr, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "ThreadLocalRef": {
        const def_id = expr_kind._0;
        print_indented(this, "ThreadLocalRef {", depth_lvl);
        print_indented(this, `def_id: ${debug_DefId(def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Yield": {
        const { value } = expr_kind;
        print_indented(this, "Yield {", depth_lvl);
        print_indented(this, "value:", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, "}", depth_lvl);
        break;
      }
      case "Reborrow": {
        print_indented(this, "Reborrow {", depth_lvl);
        print_indented(this, "source:", depth_lvl + 1);
        print_indented(this, "mutability:", depth_lvl + 1);
        print_indented(this, "ty:", depth_lvl + 1);
        print_indented(this, "}", depth_lvl);
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:614 print_adt_expr
  print_adt_expr(adt_expr: AdtExpr, depth_lvl: number): void {
    print_indented(this, "adt_def:", depth_lvl);
    this.print_adt_def(adt_expr.adt_def, depth_lvl + 1);
    print_indented(this, `variant_index: ${debug_int(adt_expr.variant_index, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `args: ${debug_GenericArgs(adt_expr.args, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `user_ty: ${debug_UserTy(adt_expr.user_ty)}`, depth_lvl + 1);

    for (const field_expr of adt_expr.fields) {
      print_indented(this, `field ${field_expr.name}:`, depth_lvl + 1);
      this.print_expr(field_expr.expr, depth_lvl + 2);
    }

    switch (adt_expr.base.$) {
      case "Base": {
        const base = adt_expr.base._0;
        print_indented(this, "base:", depth_lvl + 1);
        this.print_fru_info(base, depth_lvl + 2);
        break;
      }
      case "DefaultFields":
        print_indented(this, "base: {{ defaulted fields }}", depth_lvl + 1);
        break;
      case "None":
        print_indented(this, "base: None", depth_lvl + 1);
        break;
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:644 print_adt_def
  print_adt_def(adt_def: AdtDef, depth_lvl: number): void {
    print_indented(this, "AdtDef {", depth_lvl);
    print_indented(this, `did: ${debug_DefId(adt_def.did(), PLAIN)}`, depth_lvl + 1);
    print_indented(this, `variants: ${debug_vec(adt_def.variants(), PLAIN, debug_VariantDef)}`, depth_lvl + 1);
    print_indented(this, `flags: ${debug_AdtFlags(adt_def.flags(), PLAIN)}`, depth_lvl + 1);
    print_indented(this, `repr: ${debug_ReprOptions(adt_def.repr(), PLAIN)}`, depth_lvl + 1);
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:653 print_fru_info
  print_fru_info(fru_info: FruInfo, depth_lvl: number): void {
    print_indented(this, "FruInfo {", depth_lvl);
    print_indented(this, "base: ", depth_lvl + 1);
    this.print_expr(fru_info.base, depth_lvl + 2);
    print_indented(this, "field_types: [", depth_lvl + 1);
    for (const ty of fru_info.field_types) {
      print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 2);
    }
    print_indented(this, "]", depth_lvl + 1);
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:665 print_arm
  print_arm(arm_id: ArmId, depth_lvl: number): void {
    print_indented(this, "Arm {", depth_lvl);

    const arm = this.thir.index_ArmId(arm_id);
    const { pattern, guard, body, hir_id, scope, span } = arm;

    print_indented(this, "pattern: ", depth_lvl + 1);
    this.print_pat(pattern, depth_lvl + 2);

    if (guard !== undefined) {
      print_indented(this, "guard: ", depth_lvl + 1);
      this.print_expr(guard, depth_lvl + 2);
    } else {
      print_indented(this, "guard: None", depth_lvl + 1);
    }

    print_indented(this, "body: ", depth_lvl + 1);
    this.print_expr(body, depth_lvl + 2);
    print_indented(this, `hir_id: ${debug_HirId(hir_id, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `scope: ${debug_Scope(scope, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:689 print_pat
  print_pat(pat: Pat, depth_lvl: number): void {
    const { ty, span, kind, extra } = pat;

    print_indented(this, "Pat {", depth_lvl);
    print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
    this.print_pat_extra(extra, depth_lvl + 1);
    this.print_pat_kind(kind, depth_lvl + 1);
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:700 print_pat_extra
  print_pat_extra(extra_: PatExtra | undefined, depth_lvl: number): void {
    if (extra_ === undefined) {
      // Skip printing in the common case of a pattern node with no extra data.
      return;
    }
    const extra = extra_;

    const { expanded_const, ascriptions } = extra;

    print_indented(this, "extra: PatExtra {", depth_lvl);
    print_indented(this, `expanded_const: ${debug_option(expanded_const, PLAIN, debug_AliasConstKind)}`, depth_lvl + 1);
    this.print_list("ascriptions", ascriptions, depth_lvl + 1, (this_, ascription, depth_lvl) => {
      print_indented(this_, debug_Ascription(ascription, PLAIN), depth_lvl);
    });
    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:721 print_pat_kind
  print_pat_kind(pat_kind: PatKind, depth_lvl: number): void {
    print_indented(this, "kind: PatKind {", depth_lvl);

    switch (pat_kind.$) {
      case "Missing":
        print_indented(this, "Missing", depth_lvl + 1);
        break;
      case "Wild":
        print_indented(this, "Wild", depth_lvl + 1);
        break;
      case "Never":
        print_indented(this, "Never", depth_lvl + 1);
        break;
      case "Binding": {
        const { name, mode, var: var_, ty, subpattern, is_primary, is_shorthand } = pat_kind;
        print_indented(this, "Binding {", depth_lvl + 1);
        print_indented(this, `name: ${debug_Symbol(name, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `mode: ${debug_BindingMode(mode, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `var: ${debug_LocalVarId(var_, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `ty: ${debug_Ty(ty, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `is_primary: ${debug_bool(is_primary, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `is_shorthand: ${debug_bool(is_shorthand, PLAIN)}`, depth_lvl + 2);

        if (subpattern !== undefined) {
          print_indented(this, "subpattern: Some( ", depth_lvl + 2);
          this.print_pat(subpattern, depth_lvl + 3);
          print_indented(this, ")", depth_lvl + 2);
        } else {
          print_indented(this, "subpattern: None", depth_lvl + 2);
        }

        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Variant": {
        const { adt_def, args, variant_index, subpatterns } = pat_kind;
        print_indented(this, "Variant {", depth_lvl + 1);
        print_indented(this, "adt_def: ", depth_lvl + 2);
        this.print_adt_def(adt_def, depth_lvl + 3);
        print_indented(this, `args: ${debug_GenericArgs(args, PLAIN)}`, depth_lvl + 2);
        print_indented(this, `variant_index: ${debug_int(variant_index, PLAIN)}`, depth_lvl + 2);

        if (subpatterns.length > 0) {
          print_indented(this, "subpatterns: [", depth_lvl + 2);
          for (const field_pat of subpatterns) {
            this.print_pat(field_pat.pattern, depth_lvl + 3);
          }
          print_indented(this, "]", depth_lvl + 2);
        } else {
          print_indented(this, "subpatterns: []", depth_lvl + 2);
        }

        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Leaf": {
        const { subpatterns } = pat_kind;
        print_indented(this, "Leaf { ", depth_lvl + 1);
        print_indented(this, "subpatterns: [", depth_lvl + 2);
        for (const field_pat of subpatterns) {
          this.print_pat(field_pat.pattern, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Deref": {
        const { pin, subpattern } = pat_kind;
        print_indented(this, "Deref { ", depth_lvl + 1);
        print_indented(this, `pin: ${debug_Pinnedness(pin, PLAIN)}`, depth_lvl + 2);
        print_indented(this, "subpattern:", depth_lvl + 2);
        this.print_pat(subpattern, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "DerefPattern": {
        const { subpattern } = pat_kind;
        print_indented(this, "DerefPattern { ", depth_lvl + 1);
        print_indented(this, "subpattern:", depth_lvl + 2);
        this.print_pat(subpattern, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Constant": {
        const { value } = pat_kind;
        print_indented(this, "Constant {", depth_lvl + 1);
        print_indented(this, `value: ${display_Value(value)}`, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Range": {
        const pat_range = pat_kind._0;
        print_indented(this, `Range ( ${debug_PatRange(pat_range, PLAIN)} )`, depth_lvl + 1);
        break;
      }
      case "Slice": {
        const { prefix, slice, suffix } = pat_kind;
        print_indented(this, "Slice {", depth_lvl + 1);

        print_indented(this, "prefix: [", depth_lvl + 2);
        for (const prefix_pat of prefix) {
          this.print_pat(prefix_pat, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);

        if (slice !== undefined) {
          print_indented(this, "slice: ", depth_lvl + 2);
          this.print_pat(slice, depth_lvl + 3);
        }

        print_indented(this, "suffix: [", depth_lvl + 2);
        for (const suffix_pat of suffix) {
          this.print_pat(suffix_pat, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);

        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Array": {
        const { prefix, slice, suffix } = pat_kind;
        print_indented(this, "Array {", depth_lvl + 1);

        print_indented(this, "prefix: [", depth_lvl + 2);
        for (const prefix_pat of prefix) {
          this.print_pat(prefix_pat, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);

        if (slice !== undefined) {
          print_indented(this, "slice: ", depth_lvl + 2);
          this.print_pat(slice, depth_lvl + 3);
        }

        print_indented(this, "suffix: [", depth_lvl + 2);
        for (const suffix_pat of suffix) {
          this.print_pat(suffix_pat, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);

        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Or": {
        const { pats } = pat_kind;
        print_indented(this, "Or {", depth_lvl + 1);
        print_indented(this, "pats: [", depth_lvl + 2);
        for (const pat of pats) {
          this.print_pat(pat, depth_lvl + 3);
        }
        print_indented(this, "]", depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Guard": {
        const { subpattern, condition } = pat_kind;
        print_indented(this, "Guard pattern: {", depth_lvl + 1);
        print_indented(this, "subpattern: ", depth_lvl + 2);
        this.print_pat(subpattern, depth_lvl + 3);
        print_indented(this, "guard: ", depth_lvl + 2);
        this.print_expr(condition, depth_lvl + 3);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Error":
        print_indented(this, "Error", depth_lvl + 1);
        break;
    }

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:871 print_closure_expr
  print_closure_expr(expr: ClosureExpr, depth_lvl: number): void {
    const { closure_id, args, upvars, movability, fake_reads } = expr;

    print_indented(this, "ClosureExpr {", depth_lvl);
    print_indented(this, `closure_id: ${debug_LocalDefId(closure_id, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `args: ${debug_UpvarArgs(args, PLAIN)}`, depth_lvl + 1);

    if (upvars.length > 0) {
      print_indented(this, "upvars: [", depth_lvl + 1);
      for (const upvar of upvars) {
        this.print_expr(upvar, depth_lvl + 2);
        print_indented(this, ",", depth_lvl + 1);
      }
      print_indented(this, "]", depth_lvl + 1);
    } else {
      print_indented(this, "upvars: []", depth_lvl + 1);
    }

    print_indented(this, `movability: ${debug_option(movability, PLAIN, debug_Movability)}`, depth_lvl + 1);

    if (fake_reads.length > 0) {
      print_indented(this, "fake_reads: [", depth_lvl + 1);
      for (const [fake_read_expr, cause, hir_id] of fake_reads) {
        print_indented(this, "(", depth_lvl + 2);
        this.print_expr(fake_read_expr, depth_lvl + 3);
        print_indented(this, ",", depth_lvl + 2);
        print_indented(this, `cause: ${debug_FakeReadCause(cause, PLAIN)}`, depth_lvl + 3);
        print_indented(this, ",", depth_lvl + 2);
        print_indented(this, `hir_id: ${debug_HirId(hir_id, PLAIN)}`, depth_lvl + 3);
        print_indented(this, "),", depth_lvl + 2);
      }
      print_indented(this, "]", depth_lvl + 1);
    } else {
      print_indented(this, "fake_reads: []", depth_lvl + 1);
    }

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:910 print_inline_asm_expr
  print_inline_asm_expr(expr: InlineAsmExpr, depth_lvl: number): void {
    const { asm_macro, template, operands, options, line_spans } = expr;

    print_indented(this, "InlineAsmExpr {", depth_lvl);

    print_indented(this, `asm_macro: ${debug_AsmMacro(asm_macro, PLAIN)}`, depth_lvl + 1);

    print_indented(this, "template: [", depth_lvl + 1);
    for (const template_piece of template) {
      print_indented(this, debug_InlineAsmTemplatePiece(template_piece, PLAIN), depth_lvl + 2);
    }
    print_indented(this, "]", depth_lvl + 1);

    print_indented(this, "operands: [", depth_lvl + 1);
    for (const operand of operands) {
      this.print_inline_operand(operand, depth_lvl + 2);
    }
    print_indented(this, "]", depth_lvl + 1);

    print_indented(this, `options: ${debug_InlineAsmOptions(options, PLAIN)}`, depth_lvl + 1);
    print_indented(this, `line_spans: ${debug_vec(line_spans, PLAIN, debug_Span)}`, depth_lvl + 1);

    print_indented(this, "}", depth_lvl);
  }

  // rustc: compiler/rustc_mir_build/src/thir/print.rs:935 print_inline_operand
  print_inline_operand(operand: InlineAsmOperand, depth_lvl: number): void {
    switch (operand.$) {
      case "In": {
        const { reg, expr } = operand;
        print_indented(this, "InlineAsmOperand::In {", depth_lvl);
        print_indented(this, `reg: ${debug_InlineAsmRegOrRegClass(reg, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "expr: ", depth_lvl + 1);
        this.print_expr(expr, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Out": {
        const { reg, late, expr } = operand;
        print_indented(this, "InlineAsmOperand::Out {", depth_lvl);
        print_indented(this, `reg: ${debug_InlineAsmRegOrRegClass(reg, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `late: ${debug_bool(late, PLAIN)}`, depth_lvl + 1);

        if (expr !== undefined) {
          const out = expr;
          print_indented(this, "place: Some( ", depth_lvl + 1);
          this.print_expr(out, depth_lvl + 2);
          print_indented(this, ")", depth_lvl + 1);
        } else {
          print_indented(this, "place: None", depth_lvl + 1);
        }
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "InOut": {
        const { reg, late, expr } = operand;
        print_indented(this, "InlineAsmOperand::InOut {", depth_lvl);
        print_indented(this, `reg: ${debug_InlineAsmRegOrRegClass(reg, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `late: ${debug_bool(late, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "expr: ", depth_lvl + 1);
        this.print_expr(expr, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "SplitInOut": {
        const { reg, late, in_expr, out_expr } = operand;
        print_indented(this, "InlineAsmOperand::SplitInOut {", depth_lvl);
        print_indented(this, `reg: ${debug_InlineAsmRegOrRegClass(reg, PLAIN)}`, depth_lvl + 1);
        print_indented(this, `late: ${debug_bool(late, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "in_expr: ", depth_lvl + 1);
        this.print_expr(in_expr, depth_lvl + 2);

        if (out_expr !== undefined) {
          print_indented(this, "out_expr: Some( ", depth_lvl + 1);
          this.print_expr(out_expr, depth_lvl + 2);
          print_indented(this, ")", depth_lvl + 1);
        } else {
          print_indented(this, "out_expr: None", depth_lvl + 1);
        }

        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Const": {
        const { value, span } = operand;
        print_indented(this, "InlineAsmOperand::Const {", depth_lvl);
        print_indented(this, `value: ${debug_mir_Const(value)}`, depth_lvl + 1);
        print_indented(this, `span: ${debug_Span(span, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "SymFn": {
        const { value } = operand;
        print_indented(this, "InlineAsmOperand::SymFn {", depth_lvl);
        print_indented(this, "value: ", depth_lvl + 1);
        this.print_expr(value, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "SymStatic": {
        const { def_id } = operand;
        print_indented(this, "InlineAsmOperand::SymStatic {", depth_lvl);
        print_indented(this, `def_id: ${debug_DefId(def_id, PLAIN)}`, depth_lvl + 1);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
      case "Label": {
        const { block } = operand;
        print_indented(this, "InlineAsmOperand::Block {", depth_lvl);
        print_indented(this, "block:", depth_lvl + 1);
        this.print_block(block, depth_lvl + 2);
        print_indented(this, "}", depth_lvl + 1);
        break;
      }
    }
  }
}

// ---- Debug of values whose types are pending (module comment; not markers) -----------------------------------------

/** `{:?}` of `thir::UserTy` (`Option<Box<CanonicalUserType>>`). */
function debug_UserTy(v: UserTy): string {
  return debug_option(v, PLAIN, (x, f) => debug_Canonical(x, f, debug_UserType));
}

/** `{:?}` of `thir::Pat` (`#[derive(Debug)]`, thir.gen.ts). */
function debug_Pat(v: Pat): string {
  return debug_Pat_(v, PLAIN);
}

/** `{:?}` of `mir::Const` (mir/consts.rs, not ported). */
function debug_mir_Const(_v: unknown): string {
  return unported("Debug for rustc_middle::mir::Const (mir/consts.rs not ported)");
}
/** `{:?}` of `mir::interpret::AllocId` (not ported). */
function debug_AllocId(_v: unknown): string {
  return unported("Debug for rustc_middle::mir::interpret::AllocId (not ported)");
}
