// Port of compiler/rustc_hir_pretty/src/lib.rs
//! HIR pretty-printing is layered on top of AST pretty-printing. A number of
//! the definitions in this file have equivalents in `rustc_ast_pretty`.
//
// PORT: the file is filled by two lanes (wave 14). Each region has its own import block; root merges them.

// ==== lane hir-pretty-a: lib.rs:1..1305 ====
// (placeholder: lane hir-pretty-a ports lib.rs lines 1..1305 here: `id_to_string`, `AnnNode`, `Nested`, `PpAnn`,
// `State` and its fields, `print_crate`, `*_to_string`, and the `State` methods up to `print_expr_vec`.)

// ==== lane hir-pretty-b: lib.rs:1306..end ====

import { type ExternAbi, ExternAbi as ExternAbiNs, display_ExternAbi } from "../rustc_abi/extern_abi.ts";
import { ast } from "../rustc_ast/lib.ts";
import { display_LitKind } from "../rustc_ast/util/literal.ts";
import * as parser from "../rustc_ast/util/parser.ts";
import { type ExprPrecedence, ExprPrecedence_discriminant } from "../rustc_ast/util/parser.ts";
import { Mutability, Pinnedness } from "../rustc_ast_ir/lib.ts";
import { pp, pprust } from "../rustc_ast_pretty/lib.ts";
import type { Attribute } from "../rustc_attr_ir/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import type {
  GenericArg,
  GenericBound,
  GenericParam,
  ImplicitSelfKind,
  PatKind,
  PreciseCapturingArg,
  RangeEnd,
  Term,
  TyPatKind,
} from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { assert, panic, unreachable, unwrap } from "../std/panic.ts";
import { slice_from, slice_to } from "../std/slice.ts";

type BoxMarker = pp.BoxMarker;
const Breaks = pp.Breaks;
type Breaks = pp.Breaks;

// ---- stand-ins (PORT: pending hir-pretty-a): lane a's region defines these; root deletes this block at merge ----
// The definitions below exist only so this region type-checks on its own. The trait-method bodies of the stand-in
// `State` are upstream's (lib.rs:254-268); the inherent methods of lane a's region are only declared (interface
// below), so they are absent at runtime until the merge.

export type AnnNode =
  | { readonly $: "Name"; _0: Symbol }
  | { readonly $: "Block"; _0: hir.Block }
  | { readonly $: "Item"; _0: hir.Item }
  | { readonly $: "SubItem"; _0: HirId }
  | { readonly $: "Expr"; _0: hir.Expr }
  | { readonly $: "Pat"; _0: hir.Pat }
  | { readonly $: "TyPat"; _0: hir.TyPat }
  | { readonly $: "Arm"; _0: hir.Arm };

export type Nested =
  | { readonly $: "Item"; _0: hir.ItemId }
  | { readonly $: "TraitItem"; _0: hir.TraitItemId }
  | { readonly $: "ImplItem"; _0: hir.ImplItemId }
  | { readonly $: "ForeignItem"; _0: hir.ForeignItemId }
  | { readonly $: "Body"; _0: hir.BodyId }
  | { readonly $: "BodyParamPat"; _0: hir.BodyId; _1: number };

export class PpAnn {
  nested(_state: State, _nested: Nested): void {}
  pre(_state: State, _node: AnnNode): void {}
  post(_state: State, _node: AnnNode): void {}
}

export class State extends pprust.PrintState {
  constructor(
    public s: pp.Printer,
    public comments_: pprust.Comments | undefined,
    public attrs_: (id: HirId) => readonly Attribute[],
    public ann: PpAnn,
  ) {
    super();
  }
  comments(): pprust.Comments | undefined {
    return this.comments_;
  }
  comments_mut(): pprust.Comments | undefined {
    return this.comments_;
  }
  ann_post(ident: Ident): void {
    this.ann.post(this, { $: "Name", _0: ident.name });
  }
  print_generic_args(_: ast.GenericArgs, _colons_before_params: boolean): void {
    panic("AST generic args printed by HIR pretty-printer");
  }
}

// The `State` methods of lane a's region called from this region (PORT: inherent methods whose names clash with a
// `PrintState` method are suffixed `_`: `bclose_`, `bclose_maybe_open_`; see the handoff).
export interface State {
  attrs(id: HirId): readonly Attribute[];
  precedence(expr: hir.Expr): ExprPrecedence;
  print_attrs(attrs: readonly Attribute[]): void;
  bclose_maybe_open_(span: Span, cb: BoxMarker | undefined): void;
  bclose_(span: Span, cb: BoxMarker): void;
  commasep_cmnt<T>(b: Breaks, elts: readonly T[], op: (s: State, elt: T) => void, get_span: (elt: T) => Span): void;
  commasep_exprs(b: Breaks, exprs: readonly hir.Expr[]): void;
  print_type(ty: hir.Ty): void;
  print_trait_ref(t: hir.TraitRef): void;
  print_formal_generic_params(generic_params: readonly hir.GenericParam[]): void;
  print_poly_trait_ref(t: hir.PolyTraitRef): void;
  print_local(
    super_: boolean,
    init: hir.Expr | undefined,
    els: hir.Block | undefined,
    decl: (this_: State) => void,
  ): void;
  print_block(blk: hir.Block, cb: BoxMarker, ib: BoxMarker): void;
  print_block_unclosed(blk: hir.Block, ib: BoxMarker): void;
  print_if(test: hir.Expr, blk: hir.Expr, elseopt: hir.Expr | undefined): void;
  print_const_arg(const_arg: hir.ConstArg): void;
  print_call_post(args: readonly hir.Expr[]): void;
  print_expr_as_cond(expr: hir.Expr): void;
  print_expr_cond_paren(expr: hir.Expr, needs_par: boolean): void;
  print_let(pat: hir.Pat, ty: hir.Ty | undefined, init: hir.Expr): void;
  print_expr_vec(exprs: readonly hir.Expr[]): void;
  print_generic_arg(generic_arg: GenericArg, elide_lifetimes: boolean): void;
}

export const INDENT_UNIT: number = 4;
// ---- end of stand-ins (PORT: pending hir-pretty-a) ----

// PORT: `ExprPrecedence: PartialOrd` (derived) compares by discriminant.
function lt(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] < ExprPrecedence_discriminant[b];
}
function le(a: ExprPrecedence, b: ExprPrecedence): boolean {
  return ExprPrecedence_discriminant[a] <= ExprPrecedence_discriminant[b];
}

// impl<'a> State<'a> (continued: lib.rs:1306..2689)
// PORT: inherent methods whose names clash with a `PrintState` method (which `PrintState`'s own methods call on
// `self`) are suffixed `_`: `print_path_`, `print_path_segment_`, `print_generic_args_`. Upstream's
// `self.print_path(..)` resolves to the inherent method; `PrintState::print_path(self, ..)` is the trait's.
export interface State {
  print_inline_const(constant: hir.ConstBlock): void;
  print_expr_repeat(element: hir.Expr, count: hir.ConstArg): void;
  print_expr_struct(qpath: hir.QPath, fields: readonly hir.ExprField[], wth: hir.StructTailExpr): void;
  print_expr_field(field: hir.ExprField): void;
  print_expr_tup(exprs: readonly hir.Expr[]): void;
  print_expr_call(func: hir.Expr, args: readonly hir.Expr[]): void;
  print_expr_method_call(segment: hir.PathSegment, receiver: hir.Expr, args: readonly hir.Expr[]): void;
  print_expr_binary(op: ast.BinOpKind, lhs: hir.Expr, rhs: hir.Expr): void;
  print_expr_unary(op: ast.UnOp, expr: hir.Expr): void;
  print_expr_addr_of(kind: ast.BorrowKind, mutability: Mutability, expr: hir.Expr): void;
  print_literal(lit: hir.Lit): void;
  print_inline_asm(asm: hir.InlineAsm): void;
  print_expr(expr: hir.Expr): void;
  print_local_decl(loc: hir.LetStmt): void;
  print_name(name: Symbol): void;
  print_path_<R>(path: hir.Path<R>, colons_before_params: boolean): void;
  print_path_segment_(segment: hir.PathSegment): void;
  print_qpath(qpath: hir.QPath, colons_before_params: boolean): void;
  print_generic_args_(generic_args: hir.GenericArgs, colons_before_params: boolean): void;
  print_assoc_item_constraint(constraint: hir.AssocItemConstraint): void;
  print_pat_expr(expr: hir.PatExpr): void;
  print_ty_pat(pat: hir.TyPat): void;
  print_pat(pat: hir.Pat): void;
  print_patfield(field: hir.PatField): void;
  print_param(arg: hir.Param): void;
  print_implicit_self(implicit_self_kind: ImplicitSelfKind): void;
  print_arm(arm: hir.Arm): void;
  print_fn(
    header: hir.FnHeader,
    name: Symbol | undefined,
    generics: hir.Generics,
    decl: hir.FnDecl,
    arg_idents: readonly (Ident | undefined)[],
    body_id: hir.BodyId | undefined,
  ): void;
  print_closure_params(decl: hir.FnDecl, body_id: hir.BodyId): void;
  print_capture_clause(capture_clause: ast.CaptureBy): void;
  print_closure_binder(binder: hir.ClosureBinder, generic_params: readonly GenericParam[]): void;
  print_bounds(prefix: string, bounds: Iterable<GenericBound>): void;
  print_precise_capturing_arg(arg: PreciseCapturingArg): void;
  print_generic_params(generic_params: readonly GenericParam[]): void;
  print_generic_param(param: GenericParam): void;
  print_lifetime(lifetime: hir.Lifetime): void;
  print_where_clause(generics: hir.Generics): void;
  print_where_predicate(predicate: hir.WherePredicate): void;
  print_mutability(mutbl: Mutability, print_const: boolean): void;
  print_fn_output(decl: hir.FnDecl): void;
  print_ty_fn(
    abi: ExternAbi,
    safety: hir.Safety,
    decl: hir.FnDecl,
    name: Symbol | undefined,
    generic_params: readonly hir.GenericParam[],
    arg_idents: readonly (Ident | undefined)[],
  ): void;
  print_fn_header_info(header: hir.FnHeader): void;
  print_constness(s: hir.Constness): void;
  print_safety(s: hir.Safety): void;
  print_is_auto(s: ast.IsAuto): void;
  print_restriction(k: hir.RestrictionKind, prefix: string): void;
  print_mut_restriction(r: hir.MutRestriction): void;
  print_impl_restriction(r: hir.ImplRestriction): void;
}

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1306 print_inline_const
State.prototype.print_inline_const = function (this: State, constant: hir.ConstBlock): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word_space("const");
  this.ann.nested(this, { $: "Body", _0: constant.body });
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1313 print_expr_repeat
State.prototype.print_expr_repeat = function (this: State, element: hir.Expr, count: hir.ConstArg): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.s.word("[");
  this.print_expr(element);
  this.s.word_space(";");
  this.print_const_arg(count);
  this.s.word("]");
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1323 print_expr_struct
State.prototype.print_expr_struct = function (
  this: State,
  qpath: hir.QPath,
  fields: readonly hir.ExprField[],
  wth: hir.StructTailExpr,
): void {
  this.print_qpath(qpath, true);
  this.s.nbsp();
  this.s.word_space("{");
  this.commasep_cmnt(
    Breaks.Consistent,
    fields,
    (s, field) => s.print_expr_field(field),
    (f) => f.span,
  );
  switch (wth.$) {
    case "Base": {
      const expr = wth._0;
      const ib = this.s.ibox(INDENT_UNIT);
      if (fields.length !== 0) {
        this.s.word(",");
        this.s.space();
      }
      this.s.word("..");
      this.print_expr(expr);
      this.s.end(ib);
      break;
    }
    case "DefaultFields": {
      const ib = this.s.ibox(INDENT_UNIT);
      if (fields.length !== 0) {
        this.s.word(",");
        this.s.space();
      }
      this.s.word("..");
      this.s.end(ib);
      break;
    }
    case "None":
      break;
    case "NoneWithError":
      break;
  }
  this.s.space();
  this.s.word("}");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1360 print_expr_field
State.prototype.print_expr_field = function (this: State, field: hir.ExprField): void {
  const cb = this.s.cbox(INDENT_UNIT);
  this.print_attrs(this.attrs(field.hir_id));
  if (!field.is_shorthand) {
    this.print_ident(field.ident);
    this.s.word_space(":");
  }
  this.print_expr(field.expr);
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1371 print_expr_tup
State.prototype.print_expr_tup = function (this: State, exprs: readonly hir.Expr[]): void {
  this.s.popen();
  this.commasep_exprs(Breaks.Inconsistent, exprs);
  if (exprs.length === 1) {
    this.s.word(",");
  }
  this.s.pclose();
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1380 print_expr_call
State.prototype.print_expr_call = function (this: State, func: hir.Expr, args: readonly hir.Expr[]): void {
  let needs_paren: boolean;
  switch (func.kind.$) {
    case "Field":
      needs_paren = true;
      break;
    default:
      needs_paren = lt(this.precedence(func), "Unambiguous");
      break;
  }

  this.print_expr_cond_paren(func, needs_paren);
  this.print_call_post(args);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1390 print_expr_method_call
State.prototype.print_expr_method_call = function (
  this: State,
  segment: hir.PathSegment,
  receiver: hir.Expr,
  args: readonly hir.Expr[],
): void {
  const base_args = args;
  this.print_expr_cond_paren(receiver, lt(this.precedence(receiver), "Unambiguous"));
  this.s.word(".");
  this.print_ident(segment.ident);

  const generic_args = segment.args_();
  if (generic_args.args.length !== 0 || generic_args.constraints.length !== 0) {
    this.print_generic_args_(generic_args, true);
  }

  this.print_call_post(base_args);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1412 print_expr_binary
State.prototype.print_expr_binary = function (this: State, op: ast.BinOpKind, lhs: hir.Expr, rhs: hir.Expr): void {
  const binop_prec = ast.BinOpKind.precedence(op);
  const left_prec = this.precedence(lhs);
  const right_prec = this.precedence(rhs);

  let left_needs_paren: boolean;
  let right_needs_paren: boolean;
  switch (ast.BinOpKind.fixity(op)) {
    case "Left":
      [left_needs_paren, right_needs_paren] = [lt(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
    case "Right":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), lt(right_prec, binop_prec)];
      break;
    case "None":
      [left_needs_paren, right_needs_paren] = [le(left_prec, binop_prec), le(right_prec, binop_prec)];
      break;
  }

  // These cases need parens: `x as i32 < y` has the parser thinking that `i32 < y` is
  // the beginning of a path type. It starts trying to parse `x as (i32 < y ...` instead
  // of `(x as i32) < ...`. We need to convince it _not_ to do that.
  if (lhs.kind.$ === "Cast" && (op === "Lt" || op === "Shl")) {
    left_needs_paren = true;
  } else if (lhs.kind.$ === "Let" && !parser.needs_par_as_let_scrutinee(binop_prec)) {
    left_needs_paren = true;
  }

  this.print_expr_cond_paren(lhs, left_needs_paren);
  this.s.space();
  this.s.word_space(ast.BinOpKind.as_str(op));
  this.print_expr_cond_paren(rhs, right_needs_paren);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1442 print_expr_unary
State.prototype.print_expr_unary = function (this: State, op: ast.UnOp, expr: hir.Expr): void {
  this.s.word(ast.UnOp.as_str(op));
  this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Prefix"));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1447 print_expr_addr_of
State.prototype.print_expr_addr_of = function (
  this: State,
  kind: ast.BorrowKind,
  mutability: Mutability,
  expr: hir.Expr,
): void {
  this.s.word("&");
  switch (kind) {
    case "Ref":
      this.print_mutability(mutability, false);
      break;
    case "Raw":
      this.s.word_nbsp("raw");
      this.print_mutability(mutability, true);
      break;
    case "Pin":
      this.s.word_nbsp("pin");
      this.print_mutability(mutability, true);
      break;
  }
  this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Prefix"));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1468 print_literal
State.prototype.print_literal = function (this: State, lit: hir.Lit): void {
  this.maybe_print_comment(Span.lo(lit.span));
  this.s.word(display_LitKind(lit.node));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1473 print_inline_asm
State.prototype.print_inline_asm = function (this: State, asm: hir.InlineAsm): void {
  type AsmArg =
    | { readonly $: "Template"; _0: string }
    | { readonly $: "Operand"; _0: hir.InlineAsmOperand }
    | { readonly $: "Options"; _0: ast.InlineAsmOptions };

  const args: AsmArg[] = [{ $: "Template", _0: ast.InlineAsmTemplatePiece.to_string(asm.template) }];
  for (const [o, _] of asm.operands) args.push({ $: "Operand", _0: o });
  if (!ast.InlineAsmOptions.is_empty(asm.options)) {
    args.push({ $: "Options", _0: asm.options });
  }

  this.s.popen();
  this.commasep(Breaks.Consistent, args, (s, arg) => {
    switch (arg.$) {
      case "Template": {
        const template = arg._0;
        s.print_string(template, ast.StrStyle.Cooked);
        break;
      }
      case "Operand": {
        const op = arg._0;
        switch (op.$) {
          case "In": {
            const { reg, expr } = op;
            s.s.word("in");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "Out": {
            const { reg, late, expr } = op;
            s.s.word(late ? "lateout" : "out");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            if (expr !== undefined) {
              s.print_expr(expr);
            } else {
              s.s.word("_");
            }
            break;
          }
          case "InOut": {
            const { reg, late, expr } = op;
            s.s.word(late ? "inlateout" : "inout");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "SplitInOut": {
            const { reg, late, in_expr, out_expr } = op;
            s.s.word(late ? "inlateout" : "inout");
            s.s.popen();
            s.s.word(hir.display_InlineAsmRegOrRegClass(reg));
            s.s.pclose();
            s.s.space();
            s.print_expr(in_expr);
            s.s.space();
            s.s.word_space("=>");
            if (out_expr !== undefined) {
              s.print_expr(out_expr);
            } else {
              s.s.word("_");
            }
            break;
          }
          case "Const": {
            const { anon_const } = op;
            s.s.word("const");
            s.s.space();
            // Not using `print_inline_const` to avoid additional `const { ... }`
            s.ann.nested(s, { $: "Body", _0: anon_const.body });
            break;
          }
          case "SymFn": {
            const { expr } = op;
            s.s.word("sym_fn");
            s.s.space();
            s.print_expr(expr);
            break;
          }
          case "SymStatic": {
            const { path } = op;
            s.s.word("sym_static");
            s.s.space();
            s.print_qpath(path, true);
            break;
          }
          case "Label": {
            const { block } = op;
            const [cb, ib] = s.head("label");
            s.print_block(block, cb, ib);
            break;
          }
        }
        break;
      }
      case "Options": {
        const opts = arg._0;
        s.s.word("options");
        s.s.popen();
        s.commasep(Breaks.Inconsistent, ast.InlineAsmOptions.human_readable_names(opts), (s, opt) => {
          s.s.word(opt);
        });
        s.s.pclose();
        break;
      }
    }
  });
  this.s.pclose();
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1564 print_expr
State.prototype.print_expr = function (this: State, expr: hir.Expr): void {
  this.maybe_print_comment(Span.lo(expr.span));
  this.print_attrs(this.attrs(expr.hir_id));
  const ib = this.s.ibox(INDENT_UNIT);
  this.ann.pre(this, { $: "Expr", _0: expr });
  const kind = expr.kind;
  switch (kind.$) {
    case "Array": {
      const exprs = kind._0;
      this.print_expr_vec(exprs);
      break;
    }
    case "ConstBlock": {
      const anon_const = kind._0;
      this.print_inline_const(anon_const);
      break;
    }
    case "Repeat": {
      const element = kind._0;
      const count = kind._1;
      this.print_expr_repeat(element, count);
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      const wth = kind._2;
      this.print_expr_struct(qpath, fields, wth);
      break;
    }
    case "Tup": {
      const exprs = kind._0;
      this.print_expr_tup(exprs);
      break;
    }
    case "Call": {
      const func = kind._0;
      const args = kind._1;
      this.print_expr_call(func, args);
      break;
    }
    case "MethodCall": {
      const segment = kind._0;
      const receiver = kind._1;
      const args = kind._2;
      this.print_expr_method_call(segment, receiver, args);
      break;
    }
    case "Use": {
      const expr = kind._0;
      this.print_expr(expr);
      this.s.word(".use");
      break;
    }
    case "Binary": {
      const op = kind._0;
      const lhs = kind._1;
      const rhs = kind._2;
      this.print_expr_binary(op.node, lhs, rhs);
      break;
    }
    case "Unary": {
      const op = kind._0;
      const expr = kind._1;
      this.print_expr_unary(op, expr);
      break;
    }
    case "AddrOf": {
      const k = kind._0;
      const m = kind._1;
      const expr = kind._2;
      this.print_expr_addr_of(k, m, expr);
      break;
    }
    case "Lit": {
      const lit = kind._0;
      this.print_literal(lit);
      break;
    }
    case "Cast": {
      const expr = kind._0;
      const ty = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Cast"));
      this.s.space();
      this.s.word_space("as");
      this.print_type(ty);
      break;
    }
    case "Type": {
      const expr = kind._0;
      const ty = kind._1;
      this.s.word("type_ascribe!(");
      const ib = this.s.ibox(0);
      this.print_expr(expr);

      this.s.word(",");
      this.s.space_if_not_bol();
      this.print_type(ty);

      this.s.end(ib);
      this.s.word(")");
      break;
    }
    case "DropTemps": {
      const init = kind._0;
      // Print `{`:
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.bopen(ib);

      // Print `let _t = $init;`:
      const temp = Ident.with_dummy_span(sym._t);
      this.print_local(false, init, undefined, (this_) => this_.print_ident(temp));
      this.s.word(";");

      // Print `_t`:
      this.s.space_if_not_bol();
      this.print_ident(temp);

      // Print `}`:
      this.bclose_maybe_open_(expr.span, cb);
      break;
    }
    case "Let": {
      const { pat, ty, init } = kind._0;
      this.print_let(pat, ty, init);
      break;
    }
    case "If": {
      const test = kind._0;
      const blk = kind._1;
      const elseopt = kind._2;
      this.print_if(test, blk, elseopt);
      break;
    }
    case "Loop": {
      const blk = kind._0;
      const opt_label = kind._1;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      this.s.word_nbsp("loop");
      this.print_block(blk, cb, ib);
      break;
    }
    case "Match": {
      const expr = kind._0;
      const arms = kind._1;
      const cb = this.s.cbox(0);
      const ib = this.s.ibox(0);
      this.s.word_nbsp("match");
      this.print_expr_as_cond(expr);
      this.s.space();
      this.bopen(ib);
      for (const arm of arms) {
        this.print_arm(arm);
      }
      this.bclose_(expr.span, cb);
      break;
    }
    case "Closure": {
      const {
        binder,
        constness,
        capture_clause,
        bound_generic_params,
        fn_decl,
        body,
        fn_decl_span: _fn_decl_span,
        fn_arg_span: _fn_arg_span,
        kind: _kind,
        def_id: _def_id,
        explicit_captures: _explicit_captures,
      } = kind._0;
      this.print_closure_binder(binder, bound_generic_params);
      this.print_constness(constness);
      this.print_capture_clause(capture_clause);

      this.print_closure_params(fn_decl, body);
      this.s.space();

      // This is a bare expression.
      this.ann.nested(this, { $: "Body", _0: body });
      break;
    }
    case "Block": {
      const blk = kind._0;
      const opt_label = kind._1;
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      // containing cbox, will be closed by print-block at `}`
      const cb = this.s.cbox(0);
      // head-box, will be closed by print-block after `{`
      const ib = this.s.ibox(0);
      this.print_block(blk, cb, ib);
      break;
    }
    case "Assign": {
      const lhs = kind._0;
      const rhs = kind._1;
      this.print_expr_cond_paren(lhs, le(this.precedence(lhs), "Assign"));
      this.s.space();
      this.s.word_space("=");
      this.print_expr_cond_paren(rhs, lt(this.precedence(rhs), "Assign"));
      break;
    }
    case "AssignOp": {
      const op = kind._0;
      const lhs = kind._1;
      const rhs = kind._2;
      this.print_expr_cond_paren(lhs, le(this.precedence(lhs), "Assign"));
      this.s.space();
      this.s.word_space(ast.AssignOpKind.as_str(op.node));
      this.print_expr_cond_paren(rhs, lt(this.precedence(rhs), "Assign"));
      break;
    }
    case "Field": {
      const expr = kind._0;
      const ident = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Unambiguous"));
      this.s.word(".");
      this.print_ident(ident);
      break;
    }
    case "Index": {
      const expr = kind._0;
      const index = kind._1;
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Unambiguous"));
      this.s.word("[");
      this.print_expr(index);
      this.s.word("]");
      break;
    }
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, true);
      break;
    }
    case "Break": {
      const destination = kind._0;
      const opt_expr = kind._1;
      this.s.word("break");
      const label = destination.label;
      if (label !== undefined) {
        this.s.space();
        this.print_ident(label.ident);
      }
      if (opt_expr !== undefined) {
        const expr = opt_expr;
        this.s.space();
        this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      }
      break;
    }
    case "Continue": {
      const destination = kind._0;
      this.s.word("continue");
      const label = destination.label;
      if (label !== undefined) {
        this.s.space();
        this.print_ident(label.ident);
      }
      break;
    }
    case "Ret": {
      const result = kind._0;
      this.s.word("return");
      if (result !== undefined) {
        const expr = result;
        this.s.word(" ");
        this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      }
      break;
    }
    case "Become": {
      const result = kind._0;
      this.s.word("become");
      this.s.word(" ");
      this.print_expr_cond_paren(result, lt(this.precedence(result), "Jump"));
      break;
    }
    case "InlineAsm": {
      const asm = kind._0;
      this.s.word(`${ast.AsmMacro.macro_name(asm.asm_macro)}!`);
      this.print_inline_asm(asm);
      break;
    }
    case "OffsetOf": {
      const container = kind._0;
      const fields = kind._1;
      this.s.word("offset_of!(");
      this.print_type(container);
      this.s.word(",");
      this.s.space();

      if (fields.length !== 0) {
        const first = fields[0]!;
        const rest = fields.slice(1);
        this.print_ident(first);

        for (const field of rest) {
          this.s.word(".");
          this.print_ident(field);
        }
      }

      this.s.word(")");
      break;
    }
    case "UnsafeBinderCast": {
      const k = kind._0;
      const expr = kind._1;
      const ty = kind._2;
      switch (k) {
        case "Wrap":
          this.s.word("wrap_binder!(");
          break;
        case "Unwrap":
          this.s.word("unwrap_binder!(");
          break;
      }
      this.print_expr(expr);
      if (ty !== undefined) {
        this.s.word(",");
        this.s.space();
        this.print_type(ty);
      }
      this.s.word(")");
      break;
    }
    case "Yield": {
      const expr = kind._0;
      this.s.word_space("yield");
      this.print_expr_cond_paren(expr, lt(this.precedence(expr), "Jump"));
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "Expr", _0: expr });
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1813 print_local_decl
State.prototype.print_local_decl = function (this: State, loc: hir.LetStmt): void {
  this.print_pat(loc.pat);
  const ty = loc.ty;
  if (ty !== undefined) {
    this.s.word_space(":");
    this.print_type(ty);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1821 print_name
State.prototype.print_name = function (this: State, name: Symbol): void {
  this.print_ident(Ident.with_dummy_span(name));
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1825 print_path
State.prototype.print_path_ = function <R>(this: State, path: hir.Path<R>, colons_before_params: boolean): void {
  this.maybe_print_comment(Span.lo(path.span));

  for (let i = 0; i < path.segments.length; i++) {
    const segment = path.segments[i]!;
    if (i > 0) {
      this.s.word("::");
    }
    if (segment.ident.name !== kw.PathRoot) {
      this.print_ident(segment.ident);
      this.print_generic_args_(segment.args_(), colons_before_params);
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1839 print_path_segment
State.prototype.print_path_segment_ = function (this: State, segment: hir.PathSegment): void {
  if (segment.ident.name !== kw.PathRoot) {
    this.print_ident(segment.ident);
    this.print_generic_args_(segment.args_(), false);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1846 print_qpath
State.prototype.print_qpath = function (this: State, qpath: hir.QPath, colons_before_params: boolean): void {
  switch (qpath.$) {
    case "Resolved": {
      const path = qpath._1;
      if (qpath._0 === undefined) {
        this.print_path_(path, colons_before_params);
        break;
      }
      const qself = qpath._0;
      this.s.word("<");
      this.print_type(qself);
      this.s.space();
      this.s.word_space("as");

      const segments = slice_to(path.segments, path.segments.length - 1);
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        if (i > 0) {
          this.s.word("::");
        }
        if (segment.ident.name !== kw.PathRoot) {
          this.print_ident(segment.ident);
          this.print_generic_args_(segment.args_(), colons_before_params);
        }
      }

      this.s.word(">");
      this.s.word("::");
      const item_segment = unwrap(path.segments[path.segments.length - 1]);
      this.print_ident(item_segment.ident);
      this.print_generic_args_(item_segment.args_(), colons_before_params);
      break;
    }
    case "TypeRelative": {
      const qself = qpath._0;
      const item_segment = qpath._1;
      // If we've got a compound-qualified-path, let's push an additional pair of angle
      // brackets, so that we pretty-print `<<A::B>::C>` as `<A::B>::C`, instead of just
      // `A::B::C` (since the latter could be ambiguous to the user)
      if (qself.kind.$ === "Path" && qself.kind._0.$ === "Resolved" && qself.kind._0._0 === undefined) {
        this.print_type(qself);
      } else {
        this.s.word("<");
        this.print_type(qself);
        this.s.word(">");
      }

      this.s.word("::");
      this.print_ident(item_segment.ident);
      this.print_generic_args_(item_segment.args_(), colons_before_params);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1890 print_generic_args
State.prototype.print_generic_args_ = function (
  this: State,
  generic_args: hir.GenericArgs,
  colons_before_params: boolean,
): void {
  switch (generic_args.parenthesized) {
    case "No": {
      const start = colons_before_params ? "::<" : "<";
      // PORT: `Cell<bool>` -> a captured `let`.
      let empty = true;
      const start_or_comma = (this_: State): void => {
        if (empty) {
          empty = false;
          this_.s.word(start);
        } else {
          this_.s.word_space(",");
        }
      };

      let nonelided_generic_args: boolean = false;
      // PORT: `Iterator::all` stops at the first `false`; the closure's side effect on `nonelided_generic_args`
      // happens only up to there.
      let elide_lifetimes = true;
      for (const arg of generic_args.args) {
        let r: boolean;
        if (arg.$ === "Lifetime" && arg._0.is_elided()) {
          r = true;
        } else if (arg.$ === "Lifetime") {
          nonelided_generic_args = true;
          r = false;
        } else {
          nonelided_generic_args = true;
          r = true;
        }
        if (!r) {
          elide_lifetimes = false;
          break;
        }
      }

      if (nonelided_generic_args) {
        start_or_comma(this);
        this.commasep(Breaks.Inconsistent, generic_args.args, (s, generic_arg) =>
          s.print_generic_arg(generic_arg, elide_lifetimes),
        );
      }

      for (const constraint of generic_args.constraints) {
        start_or_comma(this);
        this.print_assoc_item_constraint(constraint);
      }

      if (!empty) {
        this.s.word(">");
      }
      break;
    }
    case "ParenSugar": {
      const [inputs, output] = unwrap(generic_args.paren_sugar_inputs_output());

      this.s.word("(");
      this.commasep(Breaks.Inconsistent, inputs, (s, ty) => s.print_type(ty));
      this.s.word(")");

      this.s.space_if_not_bol();
      this.s.word_space("->");
      this.print_type(output);
      break;
    }
    case "ReturnTypeNotation": {
      this.s.word("(..)");
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1954 print_assoc_item_constraint
State.prototype.print_assoc_item_constraint = function (this: State, constraint: hir.AssocItemConstraint): void {
  this.print_ident(constraint.ident);
  this.print_generic_args_(constraint.gen_args, false);
  this.s.space();
  const kind = constraint.kind;
  switch (kind.$) {
    case "Equality": {
      const term: Term = kind.term;
      this.s.word_space("=");
      switch (term.$) {
        case "Ty":
          this.print_type(term._0);
          break;
        case "Const":
          this.print_const_arg(term._0);
          break;
      }
      break;
    }
    case "Bound": {
      const bounds = kind.bounds;
      this.print_bounds(":", bounds);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1972 print_pat_expr
State.prototype.print_pat_expr = function (this: State, expr: hir.PatExpr): void {
  const kind = expr.kind;
  switch (kind.$) {
    case "Lit": {
      const { lit, negated } = kind;
      if (negated) {
        this.s.word("-");
      }
      this.print_literal(lit);
      break;
    }
    case "Path": {
      const qpath = kind._0;
      this.print_qpath(qpath, true);
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:1984 print_ty_pat
State.prototype.print_ty_pat = function (this: State, pat: hir.TyPat): void {
  this.maybe_print_comment(Span.lo(pat.span));
  this.ann.pre(this, { $: "TyPat", _0: pat });
  // Pat isn't normalized, but the beauty of it
  // is that it doesn't matter
  const kind: TyPatKind = pat.kind;
  switch (kind.$) {
    case "Range": {
      const begin = kind._0;
      const end = kind._1;
      this.print_const_arg(begin);
      this.s.word("..=");
      this.print_const_arg(end);
      break;
    }
    case "NotNull": {
      this.s.word_space("not");
      this.s.word("null");
      break;
    }
    case "Or": {
      const patterns = kind._0;
      this.s.popen();
      let first = true;
      for (const pat of patterns) {
        if (first) {
          first = false;
        } else {
          this.s.word(" | ");
        }
        this.print_ty_pat(pat);
      }
      this.s.pclose();
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "TyPat", _0: pat });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2021 print_pat
State.prototype.print_pat = function (this: State, pat: hir.Pat): void {
  this.maybe_print_comment(Span.lo(pat.span));
  this.ann.pre(this, { $: "Pat", _0: pat });
  // Pat isn't normalized, but the beauty of it is that it doesn't matter.
  const kind: PatKind = pat.kind;
  switch (kind.$) {
    // Printing `_` isn't ideal for a missing pattern, but it's easy and good enough.
    // E.g. `fn(u32)` gets printed as `fn(_: u32)`.
    case "Missing":
      this.s.word("_");
      break;
    case "Wild":
      this.s.word("_");
      break;
    case "Never":
      this.s.word("!");
      break;
    case "Binding": {
      const by_ref = kind._0._0;
      const mutbl = kind._0._1;
      const ident = kind._2;
      const sub = kind._3;
      if (Mutability.is_mut(mutbl)) {
        this.s.word_nbsp("mut");
      }
      if (by_ref.$ === "Yes") {
        const pinnedness = by_ref._0;
        const rmutbl = by_ref._1;
        this.s.word_nbsp("ref");
        if (Pinnedness.is_pinned(pinnedness)) {
          this.s.word_nbsp("pin");
        }
        if (Mutability.is_mut(rmutbl)) {
          this.s.word_nbsp("mut");
        } else if (Pinnedness.is_pinned(pinnedness)) {
          this.s.word_nbsp("const");
        }
      }
      this.print_ident(ident);
      if (sub !== undefined) {
        const p = sub;
        this.s.word("@");
        this.print_pat(p);
      }
      break;
    }
    case "TupleStruct": {
      const qpath = kind._0;
      const elts = kind._1;
      const ddpos_ = kind._2;
      this.print_qpath(qpath, true);
      this.s.popen();
      const ddpos = ddpos_.as_opt_usize();
      if (ddpos !== undefined) {
        this.commasep(Breaks.Inconsistent, slice_to(elts, ddpos), (s, p) => s.print_pat(p));
        if (ddpos !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
        if (ddpos !== elts.length) {
          this.s.word(",");
          this.commasep(Breaks.Inconsistent, slice_from(elts, ddpos), (s, p) => s.print_pat(p));
        }
      } else {
        this.commasep(Breaks.Inconsistent, elts, (s, p) => s.print_pat(p));
      }
      this.s.pclose();
      break;
    }
    case "Struct": {
      const qpath = kind._0;
      const fields = kind._1;
      const etc = kind._2;
      this.print_qpath(qpath, true);
      this.s.nbsp();
      this.s.word("{");
      const empty = fields.length === 0 && etc === undefined;
      if (!empty) {
        this.s.space();
      }
      this.commasep_cmnt(
        Breaks.Consistent,
        fields,
        (s, f) => s.print_patfield(f),
        (f) => f.pat.span,
      );
      if (etc !== undefined) {
        if (fields.length !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
      }
      if (!empty) {
        this.s.space();
      }
      this.s.word("}");
      break;
    }
    case "Or": {
      const pats = kind._0;
      this.strsep("|", true, Breaks.Inconsistent, pats, (s, p) => s.print_pat(p));
      break;
    }
    case "Tuple": {
      const elts = kind._0;
      const ddpos_ = kind._1;
      this.s.popen();
      const ddpos = ddpos_.as_opt_usize();
      if (ddpos !== undefined) {
        this.commasep(Breaks.Inconsistent, slice_to(elts, ddpos), (s, p) => s.print_pat(p));
        if (ddpos !== 0) {
          this.s.word_space(",");
        }
        this.s.word("..");
        if (ddpos !== elts.length) {
          this.s.word(",");
          this.commasep(Breaks.Inconsistent, slice_from(elts, ddpos), (s, p) => s.print_pat(p));
        }
      } else {
        this.commasep(Breaks.Inconsistent, elts, (s, p) => s.print_pat(p));
        if (elts.length === 1) {
          this.s.word(",");
        }
      }
      this.s.pclose();
      break;
    }
    case "Deref": {
      const inner = kind._0;
      this.s.word("deref!");
      this.s.popen();
      this.print_pat(inner);
      this.s.pclose();
      break;
    }
    case "Ref": {
      const inner = kind._0;
      const pinned = kind._1;
      const mutbl = kind._2;
      const is_range_inner = inner.kind.$ === "Range";
      this.s.word("&");
      if (Pinnedness.is_pinned(pinned)) {
        this.s.word("pin ");
        if (Mutability.is_not(mutbl)) {
          this.s.word("const ");
        }
      }
      this.s.word(Mutability.prefix_str(mutbl));
      if (is_range_inner) {
        this.s.popen();
      }
      this.print_pat(inner);
      if (is_range_inner) {
        this.s.pclose();
      }
      break;
    }
    case "Expr": {
      const e = kind._0;
      this.print_pat_expr(e);
      break;
    }
    case "Range": {
      const begin = kind._0;
      const end = kind._1;
      const end_kind: RangeEnd = kind._2;
      if (begin !== undefined) {
        const expr = begin;
        this.print_pat_expr(expr);
      }
      switch (end_kind) {
        case "Included":
          this.s.word("...");
          break;
        case "Excluded":
          this.s.word("..");
          break;
      }
      if (end !== undefined) {
        const expr = end;
        this.print_pat_expr(expr);
      }
      break;
    }
    case "Slice": {
      const before = kind._0;
      const slice = kind._1;
      const after = kind._2;
      this.s.word("[");
      this.commasep(Breaks.Inconsistent, before, (s, p) => s.print_pat(p));
      if (slice !== undefined) {
        const p = slice;
        if (before.length !== 0) {
          this.s.word_space(",");
        }
        if (p.kind.$ === "Wild") {
          // Print nothing.
        } else {
          this.print_pat(p);
        }
        this.s.word("..");
        if (after.length !== 0) {
          this.s.word_space(",");
        }
      }
      this.commasep(Breaks.Inconsistent, after, (s, p) => s.print_pat(p));
      this.s.word("]");
      break;
    }
    case "Guard": {
      const inner = kind._0;
      const cond = kind._1;
      this.print_pat(inner);
      this.s.space();
      this.s.word_space("if");
      this.print_expr(cond);
      break;
    }
    case "Err": {
      this.s.popen();
      this.s.word("/*ERROR*/");
      this.s.pclose();
      break;
    }
  }
  this.ann.post(this, { $: "Pat", _0: pat });
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2185 print_patfield
State.prototype.print_patfield = function (this: State, field: hir.PatField): void {
  if (this.attrs(field.hir_id).length === 0) {
    this.s.space();
  }
  const cb = this.s.cbox(INDENT_UNIT);
  this.print_attrs(this.attrs(field.hir_id));
  if (!field.is_shorthand) {
    this.print_ident(field.ident);
    this.s.word_nbsp(":");
  }
  this.print_pat(field.pat);
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2199 print_param
State.prototype.print_param = function (this: State, arg: hir.Param): void {
  this.print_attrs(this.attrs(arg.hir_id));
  this.print_pat(arg.pat);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2204 print_implicit_self
State.prototype.print_implicit_self = function (this: State, implicit_self_kind: ImplicitSelfKind): void {
  switch (implicit_self_kind) {
    case "Imm": {
      this.s.word("self");
      break;
    }
    case "Mut": {
      this.print_mutability("Mut", false);
      this.s.word("self");
      break;
    }
    case "RefImm": {
      this.s.word("&");
      this.s.word("self");
      break;
    }
    case "RefMut": {
      this.s.word("&");
      this.print_mutability("Mut", false);
      this.s.word("self");
      break;
    }
    case "None":
      unreachable();
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2226 print_arm
State.prototype.print_arm = function (this: State, arm: hir.Arm): void {
  // I have no idea why this check is necessary, but here it
  // is :(
  if (this.attrs(arm.hir_id).length === 0) {
    this.s.space();
  }
  const cb = this.s.cbox(INDENT_UNIT);
  this.ann.pre(this, { $: "Arm", _0: arm });
  const ib = this.s.ibox(0);
  this.print_attrs(this.attrs(arm.hir_id));
  this.print_pat(arm.pat);
  this.s.space();
  if (arm.guard !== undefined) {
    const g = arm.guard;
    this.s.word_space("if");
    this.print_expr(g);
    this.s.space();
  }
  this.s.word_space("=>");

  const body_kind = arm.body.kind;
  switch (body_kind.$) {
    case "Block": {
      const blk = body_kind._0;
      const opt_label = body_kind._1;
      if (opt_label !== undefined) {
        const label = opt_label;
        this.print_ident(label.ident);
        this.s.word_space(":");
      }
      this.print_block_unclosed(blk, ib);

      // If it is a user-provided unsafe block, print a comma after it
      if (blk.rules.$ === "UnsafeBlock" && blk.rules._0 === "UserProvided") {
        this.s.word(",");
      }
      break;
    }
    default: {
      this.s.end(ib);
      this.print_expr(arm.body);
      this.s.word(",");
      break;
    }
  }
  this.ann.post(this, { $: "Arm", _0: arm });
  this.s.end(cb);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2269 print_fn
State.prototype.print_fn = function (
  this: State,
  header: hir.FnHeader,
  name: Symbol | undefined,
  generics: hir.Generics,
  decl: hir.FnDecl,
  arg_idents: readonly (Ident | undefined)[],
  body_id: hir.BodyId | undefined,
): void {
  this.print_fn_header_info(header);

  if (name !== undefined) {
    this.s.nbsp();
    this.print_name(name);
  }
  this.print_generic_params(generics.params);

  this.s.popen();
  // Make sure we aren't supplied *both* `arg_idents` and `body_id`.
  assert(arg_idents.length === 0 || body_id === undefined, "assertion failed: arg_idents.is_empty() || body_id.is_none()");
  let i = 0;
  const print_arg = (s: State, ty: hir.Ty | undefined): void => {
    if (i === decl.splatted()) {
      s.s.word("#[rustc_splat]");
    }
    if (i === 0 && hir.ImplicitSelfKind.has_implicit_self(decl.implicit_self())) {
      s.print_implicit_self(decl.implicit_self());
    } else {
      // PORT: `arg_idents.get(i)` is `Option<&Option<Ident>>`: the bounds check, then the inner `Option`.
      if (i < arg_idents.length) {
        const arg_ident = arg_idents[i];
        if (arg_ident !== undefined) {
          s.s.word(display_Ident(arg_ident));
          s.s.word(":");
          s.s.space();
        }
      } else if (body_id !== undefined) {
        s.ann.nested(s, { $: "BodyParamPat", _0: body_id, _1: i });
        s.s.word(":");
        s.s.space();
      }
      if (ty !== undefined) {
        s.print_type(ty);
      }
    }
    i += 1;
  };
  this.commasep(Breaks.Inconsistent, decl.inputs, (s, ty) => {
    const ib = s.s.ibox(INDENT_UNIT);
    print_arg(s, ty);
    s.s.end(ib);
  });
  if (decl.c_variadic()) {
    if (decl.inputs.length !== 0) {
      this.s.word(", ");
    }
    print_arg(this, undefined);
    this.s.word("...");
  }
  this.s.pclose();

  this.print_fn_output(decl);
  this.print_where_clause(generics);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2332 print_closure_params
State.prototype.print_closure_params = function (this: State, decl: hir.FnDecl, body_id: hir.BodyId): void {
  this.s.word("|");
  let i = 0;
  this.commasep(Breaks.Inconsistent, decl.inputs, (s, ty) => {
    const ib = s.s.ibox(INDENT_UNIT);

    s.ann.nested(s, { $: "BodyParamPat", _0: body_id, _1: i });
    i += 1;

    if (ty.kind.$ === "Infer") {
      // Print nothing.
    } else {
      s.s.word(":");
      s.s.space();
      s.print_type(ty);
    }
    s.s.end(ib);
  });
  this.s.word("|");

  const output = decl.output;
  switch (output.$) {
    case "Return": {
      const ty = output._0;
      this.s.space_if_not_bol();
      this.s.word_space("->");
      this.print_type(ty);
      this.maybe_print_comment(Span.lo(ty.span));
      break;
    }
    case "DefaultReturn":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2363 print_capture_clause
State.prototype.print_capture_clause = function (this: State, capture_clause: ast.CaptureBy): void {
  switch (capture_clause.$) {
    case "Value":
      this.s.word_space("move");
      break;
    case "Use":
      this.s.word_space("use");
      break;
    case "Ref":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2371 print_closure_binder
State.prototype.print_closure_binder = function (
  this: State,
  binder: hir.ClosureBinder,
  generic_params_: readonly GenericParam[],
): void {
  const generic_params = generic_params_.filter(
    (p) => p.kind.$ === "Lifetime" && p.kind.kind.$ === "Explicit",
  );

  switch (binder.$) {
    case "Default":
      break;
    // We need to distinguish `|...| {}` from `for<> |...| {}` as `for<>` adds additional
    // restrictions.
    case "For": {
      if (generic_params.length === 0) {
        this.s.word("for<>");
        break;
      }
      this.s.word("for");
      this.s.word("<");

      this.commasep(Breaks.Inconsistent, generic_params, (s, param) => s.print_generic_param(param));

      this.s.word(">");
      this.s.nbsp();
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2408 print_bounds
State.prototype.print_bounds = function (this: State, prefix: string, bounds: Iterable<GenericBound>): void {
  let first = true;
  for (const bound of bounds) {
    if (first) {
      this.s.word(prefix);
    }
    if (!(first && prefix === "")) {
      this.s.nbsp();
    }
    if (first) {
      first = false;
    } else {
      this.s.word_space("+");
    }

    switch (bound.$) {
      case "Trait": {
        const tref = bound._0;
        this.print_poly_trait_ref(tref);
        break;
      }
      case "Outlives": {
        const lt = bound._0;
        this.print_lifetime(lt);
        break;
      }
      case "Use": {
        const args = bound._0;
        this.s.word("use <");

        this.commasep(Breaks.Inconsistent, args, (s, arg) => s.print_precise_capturing_arg(arg));

        this.s.word(">");
        break;
      }
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2447 print_precise_capturing_arg
State.prototype.print_precise_capturing_arg = function (this: State, arg: PreciseCapturingArg): void {
  switch (arg.$) {
    case "Lifetime":
      this.print_lifetime(arg._0);
      break;
    case "Param":
      this.print_ident(arg._0.ident);
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2454 print_generic_params
State.prototype.print_generic_params = function (this: State, generic_params: readonly GenericParam[]): void {
  const is_lifetime_elided = (generic_param: GenericParam): boolean =>
    generic_param.kind.$ === "Lifetime" && generic_param.kind.kind.$ === "Elided";

  // We don't want to show elided lifetimes as they are compiler-inserted and not
  // expressible in surface level Rust.
  if (generic_params.length !== 0 && !generic_params.every(is_lifetime_elided)) {
    this.s.word("<");

    this.commasep(
      Breaks.Inconsistent,
      generic_params.filter((gp) => !is_lifetime_elided(gp)),
      (s, param) => s.print_generic_param(param),
    );

    this.s.word(">");
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2477 print_generic_param
State.prototype.print_generic_param = function (this: State, param: GenericParam): void {
  if (param.kind.$ === "Const") {
    this.s.word_space("const");
  }

  this.print_ident(hir.ParamName.ident(param.name));

  const kind = param.kind;
  switch (kind.$) {
    case "Lifetime":
      break;
    case "Type": {
      const default_ = kind.default;
      if (default_ !== undefined) {
        this.s.space();
        this.s.word_space("=");
        this.print_type(default_);
      }
      break;
    }
    case "Const": {
      const ty = kind.ty;
      const default_ = kind.default;
      this.s.word_space(":");
      this.print_type(ty);
      if (default_ !== undefined) {
        this.s.space();
        this.s.word_space("=");
        this.print_const_arg(default_);
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2505 print_lifetime
State.prototype.print_lifetime = function (this: State, lifetime: hir.Lifetime): void {
  this.print_ident(lifetime.ident);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2509 print_where_clause
State.prototype.print_where_clause = function (this: State, generics: hir.Generics): void {
  if (generics.predicates.length === 0) {
    return;
  }

  this.s.space();
  this.s.word_space("where");

  for (let i = 0; i < generics.predicates.length; i++) {
    const predicate = generics.predicates[i]!;
    if (i !== 0) {
      this.s.word_space(",");
    }
    this.print_where_predicate(predicate);
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2525 print_where_predicate
State.prototype.print_where_predicate = function (this: State, predicate: hir.WherePredicate): void {
  this.print_attrs(this.attrs(predicate.hir_id));
  const kind = predicate.kind;
  switch (kind.$) {
    case "BoundPredicate": {
      const { bound_generic_params, bounded_ty, bounds } = kind._0;
      this.print_formal_generic_params(bound_generic_params);
      this.print_type(bounded_ty);
      this.print_bounds(":", bounds);
      break;
    }
    case "RegionPredicate": {
      const { lifetime, bounds } = kind._0;
      this.print_lifetime(lifetime);
      this.s.word(":");

      for (let i = 0; i < bounds.length; i++) {
        const bound = bounds[i]!;
        switch (bound.$) {
          case "Outlives": {
            const lt = bound._0;
            this.print_lifetime(lt);
            break;
          }
          default:
            panic(`unexpected bound on lifetime param: ${format_debug(bound, hir.debug_GenericBound, PLAIN)}`);
        }

        if (i !== 0) {
          this.s.word(":");
        }
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2562 print_mutability
State.prototype.print_mutability = function (this: State, mutbl: Mutability, print_const: boolean): void {
  switch (mutbl) {
    case "Mut":
      this.s.word_nbsp("mut");
      break;
    case "Not": {
      if (print_const) {
        this.s.word_nbsp("const");
      }
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2573 print_fn_output
State.prototype.print_fn_output = function (this: State, decl: hir.FnDecl): void {
  const output = decl.output;
  switch (output.$) {
    case "Return": {
      const ty = output._0;
      this.s.space_if_not_bol();
      const ib = this.s.ibox(INDENT_UNIT);
      this.s.word_space("->");
      this.print_type(ty);
      this.s.end(ib);

      if (decl.output.$ === "Return") {
        const output = decl.output._0;
        this.maybe_print_comment(Span.lo(output.span));
      }
      break;
    }
    case "DefaultReturn":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2590 print_ty_fn
State.prototype.print_ty_fn = function (
  this: State,
  abi: ExternAbi,
  safety: hir.Safety,
  decl: hir.FnDecl,
  name: Symbol | undefined,
  generic_params: readonly hir.GenericParam[],
  arg_idents: readonly (Ident | undefined)[],
): void {
  const ib = this.s.ibox(INDENT_UNIT);
  this.print_formal_generic_params(generic_params);
  const generics = hir.Generics.empty();
  this.print_fn(
    new hir.FnHeader(hir.HeaderSafety.from(safety), hir.Constness.NotConst, hir.IsAsync.NotAsync, abi),
    name,
    generics,
    decl,
    arg_idents,
    undefined,
  );
  this.s.end(ib);
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2618 print_fn_header_info
State.prototype.print_fn_header_info = function (this: State, header: hir.FnHeader): void {
  this.print_constness(header.constness);

  let safety: hir.Safety;
  switch (header.safety.$) {
    case "SafeTargetFeatures":
      this.s.word_nbsp("#[target_feature]");
      safety = "Safe";
      break;
    case "Normal":
      safety = header.safety._0;
      break;
  }

  switch (header.asyncness.$) {
    case "NotAsync":
      break;
    case "Async":
      this.s.word_nbsp("async");
      break;
  }

  this.print_safety(safety);

  if (!ExternAbiNs.eq(header.abi, ExternAbiNs.Rust)) {
    this.s.word_nbsp("extern");
    this.s.word_nbsp(display_ExternAbi(header.abi));
  }

  this.s.word("fn");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2644 print_constness
State.prototype.print_constness = function (this: State, s: hir.Constness): void {
  switch (s.$) {
    case "NotConst":
      break;
    case "Const":
      if (!s.always) {
        this.s.word_nbsp("const");
      } else {
        /* printed as an attribute */
      }
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2652 print_safety
State.prototype.print_safety = function (this: State, s: hir.Safety): void {
  switch (s) {
    case "Safe":
      break;
    case "Unsafe":
      this.s.word_nbsp("unsafe");
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2659 print_is_auto
State.prototype.print_is_auto = function (this: State, s: ast.IsAuto): void {
  switch (s) {
    case "Yes":
      this.s.word_nbsp("auto");
      break;
    case "No":
      break;
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2666 print_restriction
State.prototype.print_restriction = function (this: State, k: hir.RestrictionKind, prefix: string): void {
  switch (k.$) {
    case "Unrestricted":
      break;
    case "Restricted": {
      const path = k._0;
      this.s.word(prefix);
      this.s.word_nbsp("(in");
      this.print_path_(path, false);
      this.s.word_nbsp(")");
      break;
    }
  }
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2682 print_mut_restriction
State.prototype.print_mut_restriction = function (this: State, r: hir.MutRestriction): void {
  this.print_restriction(r.kind, "mut");
};

// rustc: compiler/rustc_hir_pretty/src/lib.rs:2686 print_impl_restriction
State.prototype.print_impl_restriction = function (this: State, r: hir.ImplRestriction): void {
  this.print_restriction(r.kind, "impl");
};

/// Does this expression require a semicolon to be treated
/// as a statement? The negation of this: 'can this expression
/// be used as a statement without a semicolon' -- is used
/// as an early-bail-out in the parser so that, for instance,
///     if true {...} else {...}
///      |x| 5
/// isn't parsed as (if true {...} else {...} | x) | 5
//
// Duplicated from `parse::classify`, but adapted for the HIR.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2700 expr_requires_semi_to_be_stmt
export function expr_requires_semi_to_be_stmt(e: hir.Expr): boolean {
  return !(e.kind.$ === "If" || e.kind.$ === "Match" || e.kind.$ === "Block" || e.kind.$ === "Loop");
}

/// This statement requires a semicolon after it.
/// note that in one case (stmt_semi), we've already
/// seen the semicolon, and thus don't need another.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2713 stmt_ends_with_semi
export function stmt_ends_with_semi(stmt: hir.StmtKind): boolean {
  switch (stmt.$) {
    case "Let":
      return true;
    case "Item":
      return false;
    case "Expr":
      return expr_requires_semi_to_be_stmt(stmt._0);
    case "Semi":
      return false;
  }
}

/// Expressions that syntactically contain an "exterior" struct literal, i.e., not surrounded by any
/// parens or other delimiters, e.g., `X { y: 1 }`, `X { y: 1 }.method()`, `foo == X { y: 1 }` and
/// `X { y: 1 } == foo` all do, but `(X { y: 1 }) == foo` does not.
// rustc: compiler/rustc_hir_pretty/src/lib.rs:2725 contains_exterior_struct_lit
export function contains_exterior_struct_lit(value: hir.Expr): boolean {
  const kind = value.kind;
  switch (kind.$) {
    case "Struct":
      return true;

    case "Assign":
    case "AssignOp":
    case "Binary": {
      const lhs = kind.$ === "AssignOp" || kind.$ === "Binary" ? kind._1 : kind._0;
      const rhs = kind.$ === "AssignOp" || kind.$ === "Binary" ? kind._2 : kind._1;
      // `X { y: 1 } + X { y: 2 }`
      return contains_exterior_struct_lit(lhs) || contains_exterior_struct_lit(rhs);
    }
    case "Unary":
    case "Cast":
    case "Type":
    case "Field":
    case "Index": {
      const x = kind.$ === "Unary" ? kind._1 : kind._0;
      // `&X { y: 1 }, X { y: 1 }.y`
      return contains_exterior_struct_lit(x);
    }

    case "MethodCall": {
      const receiver = kind._1;
      // `X { y: 1 }.bar(...)`
      return contains_exterior_struct_lit(receiver);
    }

    default:
      return false;
  }
}
