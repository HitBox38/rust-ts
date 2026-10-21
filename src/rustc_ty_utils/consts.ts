// Port of compiler/rustc_ty_utils/src/consts.rs (lane small-gaps-21).
//
// PORT: `Result<!, ErrorGuaranteed>` (`error` / `maybe_supported_error`) is `Result<never, ErrorGuaranteed>`; their
// `?` in `recurse_build` returns the `Err`. `thir_body`'s value is typed loosely by queries.gen.ts (`Steal<unknown>`,
// `unknown`): it is `(Steal<Thir>, ExprId)` (rustc_mir_build thir/cx/mod.ts). `#[instrument]` (tracing) is dropped.
import { DefKind } from "../rustc_hir/def.ts";
import type { Steal } from "../rustc_data_structures/steal.ts";
import type { BinOp, UnOp } from "../rustc_middle/mir/syntax.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { type Expr, type ExprId, type Pat, type Thir, visit_with_PatRangeBoundary } from "../rustc_middle/thir.ts";
import { Visitor, walk_expr, walk_pat } from "../rustc_middle/thir/visit.ts";
import type { CastKind } from "../rustc_middle/ty/abstract_const.ts";
import { Expr as TyExpr, ValTree, visit_with_Value, type Value } from "../rustc_middle/ty/consts.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { AliasConst } from "../rustc_type_ir/const_kind.ts";
import type { AliasConstKind } from "../rustc_type_ir/const_kind.gen.ts";
import { Const, fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { debug_DefKind } from "../rustc_hir/def.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { GenericConstantTooComplex_diagnostic, type GenericConstantTooComplexSub } from "./diagnostics.ts";

/// We do not allow all binary operations in abstract consts, so filter disallowed ones.
// rustc: compiler/rustc_ty_utils/src/consts.rs:17 check_binop
function check_binop(op: BinOp): boolean {
  switch (op) {
    case "Add":
    case "AddUnchecked":
    case "AddWithOverflow":
    case "Sub":
    case "SubUnchecked":
    case "SubWithOverflow":
    case "Mul":
    case "MulUnchecked":
    case "MulWithOverflow":
    case "Div":
    case "Rem":
    case "BitXor":
    case "BitAnd":
    case "BitOr":
    case "Shl":
    case "ShlUnchecked":
    case "Shr":
    case "ShrUnchecked":
    case "Eq":
    case "Lt":
    case "Le":
    case "Ne":
    case "Ge":
    case "Gt":
    case "Cmp":
      return true;
    case "Offset":
      return false;
  }
}

/// While we currently allow all unary operations, we still want to explicitly guard against
/// future changes here.
// rustc: compiler/rustc_ty_utils/src/consts.rs:29 check_unop
function check_unop(op: UnOp): boolean {
  switch (op) {
    case "Not":
    case "Neg":
    case "PtrMetadata":
      return true;
  }
}

// rustc: compiler/rustc_ty_utils/src/consts.rs:36 recurse_build
function recurse_build(tcx: TyCtxt, body: Thir, node_: ExprId, root_span: Span): Result<Const, ErrorGuaranteed> {
  const node = body.index_ExprId(node_);

  const maybe_supported_error_ = (a: GenericConstantTooComplexSub) => maybe_supported_error(tcx, a, root_span);
  const error_ = (a: GenericConstantTooComplexSub) => error(tcx, a, root_span);

  const kind = node.kind;
  let r: Result<Const, ErrorGuaranteed>;
  // PORT: the `match` arms in upstream order; each arm's `?` returns the `Err`, its value is `Ok`-wrapped at the end.
  switch (kind.$) {
    // I dont know if handling of these 3 is correct
    case "Scope":
      r = recurse_build(tcx, body, kind.value, root_span);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    case "PlaceTypeAscription":
    case "ValueTypeAscription":
      r = recurse_build(tcx, body, kind.source, root_span);
      if (r.$ === "Err") return r;
      return Ok(r._0);
    case "PlaceUnwrapUnsafeBinder":
    case "ValueUnwrapUnsafeBinder":
    case "WrapUnsafeBinder":
      return panic("not implemented: FIXME(unsafe_binders)");
    case "Literal": {
      const { lit, neg } = kind;
      const sp = node.span;
      const value = tcx.at(sp).lit_to_const({ lit: lit.node, ty: node.ty, neg }) as Value | undefined;
      if (value !== undefined) {
        return Ok(Const.new_value(tcx, value.valtree, value.ty));
      } else {
        return Ok(Const.new_misc_error(tcx));
      }
    }
    case "NonHirLiteral": {
      const val = ValTree.from_scalar_int(tcx, kind.lit);
      return Ok(Const.new_value(tcx, val, node.ty));
    }
    case "ZstLiteral":
      return Ok(Const.zero_sized(tcx, node.ty));
    case "NamedConst": {
      const { def_id, args } = kind;
      let ak: AliasConstKind;
      const dk = tcx.def_kind(def_id);
      if (dk.$ === "AssocConst") {
        const pk = tcx.def_kind(tcx.parent(def_id));
        if (pk.$ === "Impl" && pk.of_trait === false) {
          ak = { $: "InherentImpl", def_id };
        } else {
          ak = { $: "Projection", def_id };
        }
      } else if (dk.$ === "Const") {
        ak = { $: "Free", def_id };
      } else if (dk.$ === "AnonConst") {
        ak = { $: "Anon", def_id };
      } else {
        return bug(`unexpected DefKind in THIR ExprKind::NamedConst: ${debug_DefKind(dk, PLAIN)}`);
      }

      const alias = AliasConst.new(tcx, ak, args);
      return Ok(Const.new_alias(tcx, "No", alias));
    }
    case "ConstParam":
      return Ok(Const.new_param(tcx, kind.param));

    case "Call": {
      const fun_ty = body.index_ExprId(kind.fun).ty;
      const fun = recurse_build(tcx, body, kind.fun, root_span);
      if (fun.$ === "Err") return fun;

      const new_args: Const[] = [];
      for (const id of kind.args) {
        const a = recurse_build(tcx, body, id, root_span);
        if (a.$ === "Err") return a;
        new_args.push(a._0);
      }
      return Ok(Const.new_expr(tcx, TyExpr.new_call(tcx, fun_ty, fun._0, new_args)));
    }
    default:
      break;
  }
  if (kind.$ === "Binary" && check_binop(kind.op)) {
    const { op, lhs: lhs_id, rhs: rhs_id } = kind;
    const lhs_ty = body.index_ExprId(lhs_id).ty;
    const lhs = recurse_build(tcx, body, lhs_id, root_span);
    if (lhs.$ === "Err") return lhs;
    const rhs_ty = body.index_ExprId(rhs_id).ty;
    const rhs = recurse_build(tcx, body, rhs_id, root_span);
    if (rhs.$ === "Err") return rhs;
    return Ok(Const.new_expr(tcx, TyExpr.new_binop(tcx, op, lhs_ty, rhs_ty, lhs._0, rhs._0)));
  }
  if (kind.$ === "Unary" && check_unop(kind.op)) {
    const { op, arg: arg_id } = kind;
    const arg_ty = body.index_ExprId(arg_id).ty;
    const arg = recurse_build(tcx, body, arg_id, root_span);
    if (arg.$ === "Err") return arg;
    return Ok(Const.new_expr(tcx, TyExpr.new_unop(tcx, op, arg_ty, arg._0)));
  }
  switch (kind.$) {
    // This is necessary so that the following compiles:
    //
    // ```
    // fn foo<const N: usize>(a: [(); N + 1]) {
    //     bar::<{ N + 1 }>();
    // }
    // ```
    case "Block": {
      const block = body.index_BlockId(kind.block);
      if (block.stmts.length === 0 && block.expr !== undefined) {
        r = recurse_build(tcx, body, block.expr, root_span);
        if (r.$ === "Err") return r;
        return Ok(r._0);
      } else {
        return maybe_supported_error_({ $: "BlockNotSupported", _0: node.span });
      }
    }
    // `ExprKind::ValueExpr` happens when a `hir::ExprKind::Cast` is a
    // "coercion cast" i.e. using a coercion or is a no-op.
    // This is important so that `N as usize as usize` doesn't unify with `N as usize`. (untested)
    case "ValueExpr": {
      const { source } = kind;
      const value_ty = body.index_ExprId(source).ty;
      const value = recurse_build(tcx, body, source, root_span);
      if (value.$ === "Err") return value;
      return Ok(Const.new_expr(tcx, TyExpr.new_cast(tcx, "Use" satisfies CastKind, value_ty, value._0, node.ty)));
    }
    case "Cast": {
      const { source } = kind;
      const value_ty = body.index_ExprId(source).ty;
      const value = recurse_build(tcx, body, source, root_span);
      if (value.$ === "Err") return value;
      return Ok(Const.new_expr(tcx, TyExpr.new_cast(tcx, "As" satisfies CastKind, value_ty, value._0, node.ty)));
    }
    case "Borrow": {
      const arg_node = body.index_ExprId(kind.arg);

      // Skip reborrows for now until we allow Deref/Borrow/RawBorrow
      // expressions.
      // FIXME(generic_const_exprs): Verify/explain why this is sound
      if (arg_node.kind.$ === "Deref") {
        r = recurse_build(tcx, body, arg_node.kind.arg, root_span);
        if (r.$ === "Err") return r;
        return Ok(r._0);
      } else {
        return maybe_supported_error_({ $: "BorrowNotSupported", _0: node.span });
      }
    }
    // FIXME(generic_const_exprs): We may want to support these.
    case "RawBorrow":
    case "Deref":
      return maybe_supported_error_({ $: "AddressAndDerefNotSupported", _0: node.span });
    case "Repeat":
    case "Array":
      return maybe_supported_error_({ $: "ArrayNotSupported", _0: node.span });
    case "NeverToAny":
      return maybe_supported_error_({ $: "NeverToAnyNotSupported", _0: node.span });
    case "Tuple":
      return maybe_supported_error_({ $: "TupleNotSupported", _0: node.span });
    case "Index":
      return maybe_supported_error_({ $: "IndexNotSupported", _0: node.span });
    case "Field":
      return maybe_supported_error_({ $: "FieldNotSupported", _0: node.span });
    case "ConstBlock":
      return maybe_supported_error_({ $: "ConstBlockNotSupported", _0: node.span });
    case "Adt":
      return maybe_supported_error_({ $: "AdtNotSupported", _0: node.span });
    // dont know if this is correct
    case "PointerCoercion":
      return error_({ $: "PointerNotSupported", _0: node.span });
    case "Yield":
      return error_({ $: "YieldNotSupported", _0: node.span });
    case "Continue":
    case "ConstContinue":
    case "Break":
    case "Loop":
    case "LoopMatch":
      return error_({ $: "LoopNotSupported", _0: node.span });
    case "ByUse":
      return error_({ $: "ByUseNotSupported", _0: node.span });
    case "Unary":
      return unreachable();
    // we handle valid unary/binary ops above
    case "Binary":
      return error_({ $: "BinaryNotSupported", _0: node.span });
    case "LogicalOp":
      return error_({ $: "LogicalOpNotSupported", _0: node.span });
    case "Assign":
    case "AssignOp":
      return error_({ $: "AssignNotSupported", _0: node.span });
    // FIXME(explicit_tail_calls): maybe get `become` a new error
    case "Closure":
    case "Return":
    case "Become":
      return error_({ $: "ClosureAndReturnNotSupported", _0: node.span });
    // let expressions imply control flow
    case "Match":
    case "If":
    case "Let":
      return error_({ $: "ControlFlowNotSupported", _0: node.span });
    case "InlineAsm":
      return error_({ $: "InlineAsmNotSupported", _0: node.span });

    // we dont permit let stmts so `VarRef` and `UpvarRef` cant happen
    case "VarRef":
    case "UpvarRef":
    case "StaticRef":
    case "ThreadLocalRef":
      return error_({ $: "OperationNotSupported", _0: node.span });
    case "Reborrow":
      return panic("not implemented");
  }
  // PORT: the arms handled by the first `switch` (and the guarded `Binary`/`Unary` arms) have returned.
  return unreachable();
}

// rustc-type: compiler/rustc_ty_utils/src/consts.rs:231 IsThirPolymorphic
class IsThirPolymorphic extends Visitor {
  constructor(
    public is_poly: boolean,
    // PORT: the field `thir` is `thir_` (the `Visitor::thir()` method has the same name).
    public thir_: Thir,
  ) {
    super();
  }

  // rustc: compiler/rustc_ty_utils/src/consts.rs:265 expr_is_poly
  expr_is_poly(expr: Expr): boolean {
    if (TypeVisitableExt.has_non_region_param(expr.ty, fold_Ty)) {
      return true;
    }

    const kind = expr.kind;
    switch (kind.$) {
      case "NamedConst":
      case "ConstBlock":
        return TypeVisitableExt.has_non_region_param(kind.args, fold_GenericArgs);
      case "ConstParam":
        return true;
      case "Repeat": {
        const { value, count } = kind;
        this.visit_expr(this.thir().index_ExprId(value));
        return TypeVisitableExt.has_non_region_param(count, fold_Const);
      }
      case "Scope":
      case "If":
      case "Call":
      case "ByUse":
      case "Deref":
      case "Binary":
      case "LogicalOp":
      case "Unary":
      case "Cast":
      case "ValueExpr":
      case "NeverToAny":
      case "PointerCoercion":
      case "Loop":
      case "LoopMatch":
      case "Let":
      case "Match":
      case "Block":
      case "Assign":
      case "AssignOp":
      case "Field":
      case "Index":
      case "VarRef":
      case "UpvarRef":
      case "Borrow":
      case "RawBorrow":
      case "Break":
      case "Continue":
      case "ConstContinue":
      case "Return":
      case "Become":
      case "Array":
      case "Tuple":
      case "Adt":
      case "PlaceTypeAscription":
      case "ValueTypeAscription":
      case "PlaceUnwrapUnsafeBinder":
      case "ValueUnwrapUnsafeBinder":
      case "WrapUnsafeBinder":
      case "Closure":
      case "Literal":
      case "NonHirLiteral":
      case "ZstLiteral":
      case "StaticRef":
      case "InlineAsm":
      case "ThreadLocalRef":
      case "Yield":
        return false;
      case "Reborrow":
        return panic("not implemented");
    }
  }

  // rustc: compiler/rustc_ty_utils/src/consts.rs:330 pat_is_poly
  pat_is_poly(pat: Pat): boolean {
    if (TypeVisitableExt.has_non_region_param(pat.ty, fold_Ty)) {
      return true;
    }

    const kind = pat.kind;
    switch (kind.$) {
      case "Constant":
        return TypeVisitableExt.has_non_region_param(kind.value, { visit_with: visit_with_Value });
      case "Range": {
        const { lo, hi } = kind._0;
        return (
          TypeVisitableExt.has_non_region_param(lo, { visit_with: visit_with_PatRangeBoundary }) ||
          TypeVisitableExt.has_non_region_param(hi, { visit_with: visit_with_PatRangeBoundary })
        );
      }
      default:
        return false;
    }
  }

  // ---- impl<'a, 'tcx> visit::Visitor<'a, 'tcx> for IsThirPolymorphic<'a, 'tcx> ----

  // rustc: compiler/rustc_ty_utils/src/consts.rs:347 thir
  thir(): Thir {
    return this.thir_;
  }

  // rustc: compiler/rustc_ty_utils/src/consts.rs:352 visit_expr
  override visit_expr(expr: Expr): void {
    this.is_poly ||= this.expr_is_poly(expr);
    if (!this.is_poly) {
      walk_expr(this, expr);
    }
  }

  // rustc: compiler/rustc_ty_utils/src/consts.rs:360 visit_pat
  override visit_pat(pat: Pat): void {
    this.is_poly ||= this.pat_is_poly(pat);
    if (!this.is_poly) {
      walk_pat(this, pat);
    }
  }
}

// rustc: compiler/rustc_ty_utils/src/consts.rs:236 error
function error(tcx: TyCtxt, sub: GenericConstantTooComplexSub, root_span: Span): Result<never, ErrorGuaranteed> {
  const reported = tcx.dcx().emit_err(
    GenericConstantTooComplex_diagnostic({
      span: root_span,
      maybe_supported: false,
      sub,
    }),
  );

  return Err(reported);
}

// rustc: compiler/rustc_ty_utils/src/consts.rs:250 maybe_supported_error
function maybe_supported_error(tcx: TyCtxt, sub: GenericConstantTooComplexSub, root_span: Span): Result<never, ErrorGuaranteed> {
  const reported = tcx.dcx().emit_err(
    GenericConstantTooComplex_diagnostic({
      span: root_span,
      maybe_supported: true,
      sub,
    }),
  );

  return Err(reported);
}

/// Builds an abstract const, do not use this directly, but use `AbstractConst::new` instead.
// rustc: compiler/rustc_ty_utils/src/consts.rs:369 thir_abstract_const
function thir_abstract_const(tcx: TyCtxt, def: LocalDefId): Result<EarlyBinder<Const> | undefined, ErrorGuaranteed> {
  if (!tcx.features().generic_const_exprs()) {
    return Ok(undefined);
  }

  const dk = tcx.def_kind(def);
  if (dk.$ === "AnonConst") {
    // FIXME(generic_const_exprs): We currently only do this for anonymous constants,
    // meaning that we do not look into associated constants. I(@lcnr) am not yet sure whether
    // we want to look into them or treat them as opaque projections.
    //
    // Right now we do neither of that and simply always fail to unify them.
  } else {
    return Ok(undefined);
  }

  const r = tcx.thir_body(def) as Result<[Steal<Thir>, ExprId], ErrorGuaranteed>;
  if (r.$ === "Err") return r;
  const [body, body_id] = [r._0[0].borrow(), r._0[1]];

  const is_poly_vis = new IsThirPolymorphic(false, body);
  walk_expr(is_poly_vis, body.index_ExprId(body_id));
  if (!is_poly_vis.is_poly) {
    return Ok(undefined);
  }

  const root_span = body.index_ExprId(body_id).span;

  const c = recurse_build(tcx, body, body_id, root_span);
  if (c.$ === "Err") return c;
  return Ok(EarlyBinder.bind(tcx, c._0, fold_Const));
}

// rustc: compiler/rustc_ty_utils/src/consts.rs:401 provide
export function provide(providers: Providers): void {
  providers.thir_abstract_const = thir_abstract_const;
}
