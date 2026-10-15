// Port of compiler/rustc_mir_build/src/thir/cx/expr.rs (lane thir-cx-print).
// PORT: the `impl ThirBuildCx` block of this file is attached to the prototype (loaded by lib.ts after cx/mod.ts).
//
// PORT: rustc_middle `mir/syntax.rs` is not ported, so its `BorrowKind`, `MutBorrowKind`, `BinOp`, `UnOp` and
// `AssignOp` (the operator / borrow kinds THIR stores) have no TS types yet: `ExprKind` types those fields as
// `Pending<"mir::BinOp">` / `unknown` (thir.gen.ts). The values built here use PORTING §5's representation of those
// enums (fieldless -> the variant name string; `BorrowKind` -> `{ $: "Shared" }` / `{ $: "Mut", kind }`) through the
// local `Mir*` aliases below, so repointing them to the real types when mir/syntax.rs lands is mechanical.
// Likewise rustc_middle `hir/place.rs` is pending (`HirPlace = Pending<..>`): `HirPlaceView` reads its fields with the
// shapes ty/closure.ts already uses (`HirPlaceBase`, `HirProjectionKind`).
import { find_attr, type UnrollAttr } from "../../../rustc_attr_ir/lib.ts";
import { clone_UnrollAttr } from "../../../rustc_attr_ir/lib.ts";
import type { AssignOpKind, BinOpKind } from "../../../rustc_ast/lib.ts";
import type { Movability, Mutability } from "../../../rustc_ast_ir/lib.ts";
import type { Res } from "../../../rustc_hir/def.ts";
import { debug_Res } from "../../../rustc_hir/def.ts";
import {
  type Arm as HirArm,
  debug_Expr as debug_HirExpr,
  display_LoopIdError,
  type Expr as HirExpr,
  type ExprField as HirExprField,
  InlineAsmRegOrRegClass,
  Node,
  type StructTailExpr,
} from "../../../rustc_hir/hir.ts";
import { debug_HirId, type HirId, HirId_eq, type ItemLocalId } from "../../../rustc_hir_id/lib.ts";
import { Scope, ScopeData } from "../../../rustc_middle/middle/region.ts";
import type {
  AdtExpr,
  ArmId,
  Block,
  BlockId,
  Expr,
  ExprId,
  ExprKind,
  FieldExpr,
  InlineAsmOperand,
  UserTy,
} from "../../../rustc_middle/thir.ts";
import type { HirPlaceBase, HirProjectionKind } from "../../../rustc_middle/ty/closure.ts";
import type { CapturedPlace } from "../../../rustc_middle/ty/closure.ts";
import { type Adjustment, OverloadedDeref } from "../../../rustc_middle/ty/adjustment.ts";
import type { AutoBorrowMutability } from "../../../rustc_middle/ty/adjustment.gen.ts";
import { ScalarInt } from "../../../rustc_middle/ty/consts/int.ts";
import type { AdtDef, BinOp, FieldIdx, HirPlace, UnOp, VariantIdx } from "../../../rustc_middle/ty/decls.ts";
import type { CanonicalUserType } from "../../../rustc_middle/ty/typeck_results.ts";
import { fold_GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { debug_Ty, HasAttrs_HirId, Ty } from "../../../rustc_middle/ty/mod.ts";
import { InlineConstArgs, ParamConst, UpvarArgs } from "../../../rustc_middle/ty/sty.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { IntTypeExt } from "../../../rustc_middle/ty/util.ts";
import { Size } from "../../../rustc_abi/lib.ts";
import { debug_DefId, type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { bug, span_bug } from "../../../rustc_span/macros.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import type { SplattedDef } from "../../../rustc_middle/ty/typeck_results.ts";
import { debug_int, debug_struct, debug_tuple, type Fmt, PLAIN } from "../../../std/fmt.ts";
import { assert, assert_matches, panic, unported } from "../../../std/panic.ts";
import { push_idx, ThirBuildCx } from "./mod.ts";

// ---- PORT stand-ins for pending upstream types (see the module comment; not markers) -------------------------------

/** `mir::MutBorrowKind` (mir/syntax.rs), fieldless. */
type MirMutBorrowKind = "Default" | "TwoPhaseBorrow" | "ClosureCapture";
/** `mir::BorrowKind` (mir/syntax.rs); `Fake(FakeBorrowKind)` is never built by THIR. */
type MirBorrowKind = { readonly $: "Shared" } | { readonly $: "Mut"; kind: MirMutBorrowKind };
/** `mir::BinOp` (mir/syntax.rs), fieldless: the variants `bin_op` produces. */
type MirBinOp = "Add" | "Sub" | "Mul" | "Div" | "Rem" | "BitXor" | "BitAnd" | "BitOr" | "Shl" | "Shr" | "Eq" | "Lt" | "Le" | "Ne" | "Ge" | "Gt";
/** `mir::AssignOp` (mir/syntax.rs), fieldless. */
type MirAssignOp = "AddAssign" | "SubAssign" | "MulAssign" | "DivAssign" | "RemAssign" | "BitXorAssign" | "BitAndAssign" | "BitOrAssign" | "ShlAssign" | "ShrAssign";
const as_bin_op = (op: MirBinOp): BinOp => op as unknown as BinOp;
const as_un_op = (op: "Not" | "Neg"): UnOp => op as unknown as UnOp;

/** The members of `hir::place::Place` (hir/place.rs:69) read here (pending; see the module comment). */
interface HirPlaceView {
  readonly base_ty: Ty;
  readonly base: HirPlaceBase;
  readonly projections: readonly { readonly ty: Ty; readonly kind: HirProjectionKind }[];
}

// rustc_abi `FIRST_VARIANT` (`VariantIdx::ZERO`) and `FieldIdx::ZERO`
const FIRST_VARIANT = 0 as VariantIdx;
const FieldIdx_ZERO = 0 as FieldIdx;

/// The receiver of a splatted method, or the expression for a splatted function call.
// rustc-type: compiler/rustc_mir_build/src/thir/cx/expr.rs:32 SplattedFunc
type SplattedFunc =
  /// The expression for a method receiver. Always a FnDef.
  | { readonly $: "FnDefReceiver"; _0: HirExpr }
  /// The expression or path for a function call.
  /// This can be a FnDef or FnPtr.
  | { readonly $: "FnExpression"; _0: HirExpr };
/** `#[derive(Debug)]` of `SplattedFunc` */
function debug_SplattedFunc(v: SplattedFunc): string {
  return `${v.$}(${debug_HirExpr(v._0, PLAIN)})`;
}

const SplattedFunc = {
  // rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:41 has_receiver
  has_receiver(self: SplattedFunc): boolean {
    return self.$ === "FnDefReceiver";
  },

  // rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:45 receiver
  receiver(self: SplattedFunc): HirExpr | undefined {
    switch (self.$) {
      case "FnDefReceiver":
        return self._0;
      case "FnExpression":
        return undefined;
    }
  },

  // rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:52 fn_expression
  fn_expression(self: SplattedFunc): HirExpr | undefined {
    switch (self.$) {
      case "FnDefReceiver":
        return undefined;
      case "FnExpression":
        return self._0;
    }
  },
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:60 filter_loop_hint_attrs
function filter_loop_hint_attrs(id: HirId, tcx: ThirBuildCx["tcx"]): UnrollAttr[] {
  const out: UnrollAttr[] = [];
  for (const attr of HasAttrs_HirId.get_attrs(id, tcx)) {
    if (attr.$ === "Parsed" && attr._0.$ === "Unroll") {
      out.push(clone_UnrollAttr(attr._0._0));
    }
  }
  return out;
}

declare module "./mod.ts" {
  interface ThirBuildCx {
    mirror_exprs(exprs: readonly HirExpr[]): ExprId[];
    mirror_expr(hir_expr: HirExpr): ExprId;
    apply_adjustment(hir_expr: HirExpr, expr: Expr, adjustment: Adjustment, span: Span): Expr;
    mirror_expr_cast(source: HirExpr, temp_scope_id: ItemLocalId, span: Span): ExprKind;
    make_mirror_unadjusted(expr: HirExpr): Expr;
    user_args_applied_to_res(hir_id: HirId, res: Res): UserTy;
    method_callee(expr: HirExpr, span: Span, overloaded_callee: Ty | undefined): Expr;
    convert_splatted_callee(call_expr: HirExpr, fn_span: Span, args: readonly HirExpr[], receiver_or_func: SplattedFunc): ExprKind;
    convert_arm(arm: HirArm): ArmId;
    convert_path_expr(expr: HirExpr, res: Res): ExprKind;
    convert_var(var_hir_id: HirId): ExprKind;
    overloaded_operator(expr: HirExpr, args: ExprId[]): ExprKind;
    overloaded_place(expr: HirExpr, place_ty: Ty, overloaded_callee: Ty | undefined, args: ExprId[], span: Span): ExprKind;
    convert_captured_hir_place(closure_expr: HirExpr, place: HirPlace): Expr;
    capture_upvar(closure_expr: HirExpr, captured_place: CapturedPlace, upvar_ty: Ty): Expr;
    is_upvar(var_hir_id: HirId): boolean;
    field_refs(fields: readonly HirExprField[]): FieldExpr[];
  }
}

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:71 mirror_exprs
ThirBuildCx.prototype.mirror_exprs = function (this: ThirBuildCx, exprs: readonly HirExpr[]): ExprId[] {
  return exprs.map((expr) => this.mirror_expr(expr));
};

/// Create a THIR expression for the given HIR expression. This expands all
/// adjustments and directly adds the type information from the
/// `typeck_results`. See the [dev-guide] for more details.
///
/// (The term "mirror" in this case does not refer to "flipped" or
/// "reversed".)
///
/// [dev-guide]: https://rustc-dev-guide.rust-lang.org/thir.html
// #[instrument(level = "trace", skip(self, hir_expr))]
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:84 mirror_expr
ThirBuildCx.prototype.mirror_expr = function (this: ThirBuildCx, hir_expr: HirExpr): ExprId {
  const expr_scope = new Scope(hir_expr.hir_id.local_id, ScopeData.Node);

  // trace!(?hir_expr.hir_id, ?hir_expr.span);

  let expr = this.make_mirror_unadjusted(hir_expr);

  // trace!(?expr.ty);

  let loop_hint_attrs: UnrollAttr[] = [];

  if (hir_expr.kind.$ === "Loop") {
    const span = hir_expr.kind._3;
    const dk = Span.desugaring_kind(span);
    if (dk !== undefined && dk.$ === "ForLoop") {
      // `for` loop desugaring puts us pretty deep down the HIR tree
      const arm = Node.expect_arm(this.tcx.parent_hir_node(hir_expr.hir_id));
      const expr_ = Node.expect_expr(this.tcx.parent_hir_node(arm.hir_id));
      assert_matches(expr_.kind, expr_.kind.$ === "Match", "hir::ExprKind::Match(..)", () => debug_HirExpr(expr_, PLAIN));
      // ignore async for loops
      const parent = this.tcx.parent_hir_node(expr_.hir_id);
      if (parent.$ === "Expr") {
        const expr__ = parent._0;
        assert_matches(expr__.kind, expr__.kind.$ === "DropTemps", "hir::ExprKind::DropTemps(..)", () => debug_HirExpr(expr__, PLAIN));
        loop_hint_attrs = filter_loop_hint_attrs(expr__.hir_id, this.tcx);
      }
    } else if ((dk !== undefined && dk.$ === "WhileLoop") || dk === undefined) {
      // For loops defined with `loop` and `while`, the expr already has the attrs
      loop_hint_attrs = filter_loop_hint_attrs(hir_expr.hir_id, this.tcx);
    }
  }

  // Now apply adjustments, if any.
  if (this.apply_adjustments) {
    for (const adjustment of this.typeck_results.expr_adjustments(hir_expr)) {
      // trace!(?expr, ?adjustment);
      const span = expr.span;
      expr = this.apply_adjustment(hir_expr, expr, adjustment, span);
    }
  }

  // trace!(?expr.ty, "after adjustments");

  const ty = expr.ty;
  const value = push_idx<ExprId, Expr>(this.thir.exprs, expr);

  if (loop_hint_attrs.length !== 0) {
    this.thir.loop_hint_attrs.set(value, loop_hint_attrs);
  }

  // Finally, wrap this up in the expr's scope.
  //
  // (In addition to marking scope, coverage instrumentation also uses this node
  // to help mark the point in MIR where an expression is about to be evaluated.)
  expr = {
    temp_scope_id: expr_scope.local_id,
    ty,
    span: hir_expr.span,
    kind: { $: "Scope", region_scope: expr_scope, value, hir_id: hir_expr.hir_id },
  };

  // OK, all done!
  return push_idx<ExprId, Expr>(this.thir.exprs, expr);
};

// #[instrument(level = "trace", skip(self, expr, span))]
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:151 apply_adjustment
ThirBuildCx.prototype.apply_adjustment = function (this: ThirBuildCx, hir_expr: HirExpr, expr: Expr, adjustment: Adjustment, span: Span): Expr {
  const { temp_scope_id } = expr;

  // Adjust the span from the block, to the last expression of the
  // block. This is a better span when returning a mutable reference
  // with too short a lifetime. The error message will use the span
  // from the assignment to the return place, which should only point
  // at the returned value, not the entire function body.
  //
  // fn return_short_lived<'a>(x: &'a mut i32) -> &'static mut i32 {
  //      x
  //   // ^ error message points at this expression.
  // }
  const adjust_span = (expr: Expr): void => {
    if (expr.kind.$ === "Block") {
      const last_expr = this.thir.index_BlockId(expr.kind.block).expr;
      if (last_expr !== undefined) {
        span = this.thir.index_ExprId(last_expr).span;
        expr.span = span;
      }
    }
  };

  let kind: ExprKind;
  const adjust = adjustment.kind;
  switch (adjust.$) {
    case "Pointer": {
      const cast = adjust._0;
      if (cast.$ === "Unsize") {
        adjust_span(expr);
      }

      let is_from_as_cast: boolean;
      const parent = this.tcx.parent_hir_node(hir_expr.hir_id);
      if (parent.$ === "Expr" && parent._0.kind.$ === "Cast") {
        // Use the whole span of the `x as T` expression for the coercion.
        span = parent._0.span;
        is_from_as_cast = true;
      } else {
        is_from_as_cast = false;
      }
      kind = {
        $: "PointerCoercion",
        cast,
        source: push_idx<ExprId, Expr>(this.thir.exprs, expr),
        is_from_as_cast,
      };
      break;
    }
    case "NeverToAny": {
      if (adjustment.target.is_never()) return expr;
      kind = { $: "NeverToAny", source: push_idx<ExprId, Expr>(this.thir.exprs, expr) };
      break;
    }
    case "Deref": {
      const dk = adjust._0;
      switch (dk.$) {
        case "Builtin": {
          adjust_span(expr);
          kind = { $: "Deref", arg: push_idx<ExprId, Expr>(this.thir.exprs, expr) };
          break;
        }
        case "Pin": {
          adjust_span(expr);
          // pointer = ($expr).pointer
          const pin_ty = expr.ty.pinned_ty();
          if (pin_ty === undefined) return panic("Deref(Pin) with non-Pin type");
          const pointer_target: ExprKind = {
            $: "Field",
            lhs: push_idx<ExprId, Expr>(this.thir.exprs, expr),
            variant_index: FIRST_VARIANT,
            name: FieldIdx_ZERO,
          };
          const expr_: Expr = { temp_scope_id, ty: pin_ty, span, kind: pointer_target };
          // expr = *pointer
          kind = { $: "Deref", arg: push_idx<ExprId, Expr>(this.thir.exprs, expr_) };
          break;
        }
        case "Overloaded": {
          const deref = dk._0;
          // We don't need to do call adjust_span here since
          // deref coercions always start with a built-in deref.
          const call_def_id = OverloadedDeref.method_call(deref, this.tcx);
          const overloaded_callee = Unnormalized.skip_norm_wip(
            EarlyBinder.instantiate(this.tcx.type_of(call_def_id) as EarlyBinder<Ty>, this.tcx, this.tcx.mk_args([expr.ty]), fold_Ty),
          );

          expr = {
            temp_scope_id,
            ty: Ty.new_ref(this.tcx, this.tcx.lifetimes.re_erased, expr.ty, deref.mutbl),
            span,
            kind: {
              $: "Borrow",
              borrow_kind: Mutability_to_borrow_kind(deref.mutbl),
              arg: push_idx<ExprId, Expr>(this.thir.exprs, expr),
            },
          };

          const expr_ = [push_idx<ExprId, Expr>(this.thir.exprs, expr)];

          kind = this.overloaded_place(hir_expr, adjustment.target, overloaded_callee, expr_, deref.span);
          break;
        }
      }
      break;
    }
    case "Borrow": {
      const ab = adjust._0;
      switch (ab.$) {
        case "Ref":
          kind = {
            $: "Borrow",
            borrow_kind: AutoBorrowMutability_to_borrow_kind(ab._0),
            arg: push_idx<ExprId, Expr>(this.thir.exprs, expr),
          };
          break;
        case "RawPtr":
          kind = { $: "RawBorrow", mutability: ab._0, arg: push_idx<ExprId, Expr>(this.thir.exprs, expr) };
          break;
        case "Pin": {
          const mutbl = ab._0;
          // expr = &pin (mut|const|) arget
          let borrow_kind: MirBorrowKind;
          switch (mutbl) {
            case "Mut":
              borrow_kind = { $: "Mut", kind: "Default" };
              break;
            case "Not":
              borrow_kind = { $: "Shared" };
              break;
          }
          const new_pin_target = Ty.new_ref(this.tcx, this.tcx.lifetimes.re_erased, expr.ty, mutbl);
          const arg = push_idx<ExprId, Expr>(this.thir.exprs, expr);
          const expr_ = push_idx<ExprId, Expr>(this.thir.exprs, {
            temp_scope_id,
            ty: new_pin_target,
            span,
            kind: { $: "Borrow", borrow_kind, arg },
          });

          // kind = Pin { pointer }
          const pin_did = this.tcx.require_lang_item("Pin", span);
          const args = this.tcx.mk_args([new_pin_target]);
          const kind_: ExprKind = {
            $: "Adt",
            _0: {
              adt_def: this.tcx.adt_def(pin_did) as AdtDef,
              variant_index: FIRST_VARIANT,
              args,
              fields: [{ name: FieldIdx_ZERO, expr: expr_ }],
              user_ty: undefined,
              base: { $: "None" },
            },
          };

          // debug!(?kind);
          kind = kind_;
          break;
        }
      }
      break;
    }
    case "GenericReborrow": {
      const mutability = adjust._0;
      const expr_ = push_idx<ExprId, Expr>(this.thir.exprs, expr);
      const kind_: ExprKind = { $: "Reborrow", source: expr_, mutability, target: adjustment.target };

      kind = kind_;
      break;
    }
  }

  return { temp_scope_id, ty: adjustment.target, span, kind };
};

/// Lowers a cast expression.
///
/// Dealing with user type annotations is left to the caller.
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:305 mirror_expr_cast
ThirBuildCx.prototype.mirror_expr_cast = function (this: ThirBuildCx, source: HirExpr, temp_scope_id: ItemLocalId, span: Span): ExprKind {
  const tcx = this.tcx;

  // Check to see if this cast is a "coercion cast", where the cast is actually done
  // using a coercion (or is a no-op).
  if (this.typeck_results.is_coercion_cast(source.hir_id)) {
    // Convert the lexpr to a vexpr.
    return { $: "ValueExpr", source: this.mirror_expr(source) };
  } else if (this.typeck_results.expr_ty(source).is_ref()) {
    // Special cased so that we can type check that the element
    // type of the source matches the pointed to type of the
    // destination.
    return {
      $: "PointerCoercion",
      source: this.mirror_expr(source),
      cast: { $: "ArrayToPointer" },
      is_from_as_cast: true,
    };
  }
  let ctor: { adt_def: AdtDef; variant_ctor_id: DefId } | undefined;
  if (source.kind.$ === "Path") {
    const qpath = source.kind._0;
    const res = this.typeck_results.qpath_res(qpath, source.hir_id);
    const ty = this.typeck_results.node_type(source.hir_id);
    const tk = ty.kind();
    if (tk.$ === "Adt" && res.$ === "Def" && res._0.$ === "Ctor" && res._0._0 === "Variant" && res._0._1 === "Const") {
      ctor = { adt_def: tk._0, variant_ctor_id: res._1 };
    }
  }
  if (ctor !== undefined) {
    const { adt_def, variant_ctor_id } = ctor;
    // Check whether this is casting an enum variant discriminant.
    // To prevent cycles, we refer to the discriminant initializer,
    // which is always an integer and thus doesn't need to know the
    // enum's layout (or its tag type) to compute it during const eval.
    // Example:
    // enum Foo {
    //     A,
    //     B = A as isize + 4,
    // }
    // The correct solution would be to add symbolic computations to miri,
    // so we wouldn't have to compute and store the actual value

    const idx = adt_def.variant_index_with_ctor_id(variant_ctor_id);
    const [discr_did, discr_offset] = adt_def.discriminant_def_for_variant(idx);

    // use rustc_middle::ty::util::IntTypeExt;
    const ty = adt_def.repr().discr_type();
    const discr_ty = IntTypeExt.to_ty(ty, tcx);

    const layout = tcx.layout_of(this.typing_env.as_query_input(discr_ty));
    if (layout.$ === "Err") {
      return panic(`could not compute layout for ${debug_Ty(discr_ty, PLAIN)}: ${String(layout._0)}`);
    }
    // PORT: the `layout_of` query value is `unknown` in queries.gen.ts (`TyAndLayout`, M4); `.size` is its field.
    const size = (layout._0 as { size: Size }).size;

    const [lit, overflowing] = ScalarInt.truncate_from_uint(BigInt(discr_offset), size);
    if (overflowing) {
      // An erroneous enum with too many variants for its repr will emit E0081 and E0370
      this.tcx.dcx().span_delayed_bug(source.span, "overflowing enum wasn't rejected by hir analysis");
    }
    const kind: ExprKind = { $: "NonHirLiteral", lit, user_ty: undefined };
    const offset = push_idx<ExprId, Expr>(this.thir.exprs, { temp_scope_id, ty: discr_ty, span, kind });

    let source_: ExprId;
    if (discr_did !== undefined) {
      // in case we are offsetting from a computed discriminant
      // and not the beginning of discriminants (which is always `0`)
      const did = discr_did;
      const args = this.tcx.mk_args([]);
      this.tcx.debug_assert_args_compatible(did, args);
      const kind: ExprKind = { $: "NamedConst", def_id: did, args, user_ty: undefined };
      const lhs = push_idx<ExprId, Expr>(this.thir.exprs, { temp_scope_id, ty: discr_ty, span, kind });
      const bin: ExprKind = { $: "Binary", op: as_bin_op("Add"), lhs, rhs: offset };
      source_ = push_idx<ExprId, Expr>(this.thir.exprs, { temp_scope_id, ty: discr_ty, span, kind: bin });
    } else {
      source_ = offset;
    }

    return { $: "Cast", source: source_ };
  } else {
    // Default to `ExprKind::Cast` for all explicit casts.
    // MIR building then picks the right MIR casts based on the types.
    return { $: "Cast", source: this.mirror_expr(source) };
  }
};

// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:392 make_mirror_unadjusted
ThirBuildCx.prototype.make_mirror_unadjusted = function (this: ThirBuildCx, expr: HirExpr): Expr {
  const tcx = this.tcx;
  const expr_ty = this.typeck_results.expr_ty(expr);
  const mk_expr = (kind: ExprKind, ty: Ty): Expr => ({ temp_scope_id: expr.hir_id.local_id, span: expr.span, ty, kind });

  let kind: ExprKind;
  const ek = expr.kind;
  switch (ek.$) {
    // Here comes the interesting stuff:
    case "MethodCall": {
      const [segment, receiver, args, fn_span] = [ek._0, ek._1, ek._2, ek._3];
      if (this.typeck_results.is_splatted_call(expr)) {
        // The callee has a splatted tuple argument.
        // rewrite `receiver.f(a, u, v)` into `receiver.f(a, #[rustc_splat] (u, v))`
        kind = this.convert_splatted_callee(expr, fn_span, args, { $: "FnDefReceiver", _0: receiver });
      } else {
        // Rewrite a.b(c) into UFCS form like Trait::b(a, c)
        const expr_ = this.method_callee(expr, segment.ident.span, undefined);
        // info!("Using method span: {:?}", expr.span);

        const args_ = [receiver, ...args].map((expr) => this.mirror_expr(expr));
        kind = {
          $: "Call",
          ty: expr_.ty,
          fun: push_idx<ExprId, Expr>(this.thir.exprs, expr_),
          args: args_,
          from_hir_call: true,
          fn_span,
        };
      }
      break;
    }

    case "Call": {
      const [fun, args] = [ek._0, ek._1];
      if (this.typeck_results.is_method_call(expr)) {
        // The callee is something implementing Fn, FnMut, or FnOnce.
        // Find the actual method implementation being called and
        // build the appropriate UFCS call expression with the
        // callee-object as expr parameter.

        // rewrite f(u, v) into FnOnce::call_once(f, (u, v))

        const method = this.method_callee(expr, fun.span, undefined);

        const arg_tys = args.map((e) => this.typeck_results.expr_ty_adjusted(e));
        const tupled_args_: Expr = {
          ty: Ty.new_tup_from_iter(tcx, arg_tys),
          temp_scope_id: expr.hir_id.local_id,
          span: expr.span,
          kind: { $: "Tuple", fields: this.mirror_exprs(args) },
        };
        const tupled_args = push_idx<ExprId, Expr>(this.thir.exprs, tupled_args_);

        const fun_ = push_idx<ExprId, Expr>(this.thir.exprs, method);
        kind = {
          $: "Call",
          ty: method.ty,
          fun: fun_,
          args: [this.mirror_expr(fun), tupled_args],
          from_hir_call: true,
          fn_span: expr.span,
        };
      } else if (this.typeck_results.is_splatted_call(expr)) {
        // The callee has a splatted tuple argument.
        // rewrite `f(a, u, v)` into `f(a, #[rustc_splat] (u, v))`
        kind = this.convert_splatted_callee(expr, fun.span, args, { $: "FnExpression", _0: fun });
      } else {
        // Tuple-like ADTs are represented as ExprKind::Call. We convert them here.
        let adt_data: [AdtDef, VariantIdx] | undefined;
        const adt_def = fun.kind.$ === "Path" ? expr_ty.ty_adt_def() : undefined;
        if (fun.kind.$ === "Path" && adt_def !== undefined) {
          const qpath = fun.kind._0;
          switch (qpath.$) {
            case "Resolved": {
              const path = qpath._1;
              const res = path.res;
              if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Fn") {
                adt_data = [adt_def, adt_def.variant_index_with_ctor_id(res._1)];
              } else if (res.$ === "SelfCtor") {
                adt_data = [adt_def, FIRST_VARIANT];
              } else {
                adt_data = undefined;
              }
              break;
            }
            case "TypeRelative": {
              const tdd = this.typeck_results.type_dependent_def(fun.hir_id);
              if (tdd !== undefined && tdd[0].$ === "Ctor" && tdd[0]._1 === "Fn") {
                adt_data = [adt_def, adt_def.variant_index_with_ctor_id(tdd[1])];
              } else {
                adt_data = undefined;
              }
              break;
            }
          }
        } else {
          adt_data = undefined;
        }
        if (adt_data !== undefined) {
          const [adt_def, index] = adt_data;
          const node_args = this.typeck_results.node_args(fun.hir_id);
          const user_provided_types = this.typeck_results.user_provided_types();
          const u_ty = user_provided_types.get(fun.hir_id);
          const user_ty: UserTy = u_ty === undefined ? undefined : with_type_of_did(u_ty, adt_def.did());
          // debug!("make_mirror_unadjusted: (call) user_ty={:?}", user_ty);

          const field_refs: FieldExpr[] = args.map((e, idx) => ({
            name: idx as FieldIdx,
            expr: this.mirror_expr(e),
          }));
          kind = {
            $: "Adt",
            _0: {
              adt_def,
              args: node_args,
              variant_index: index,
              fields: field_refs,
              user_ty,
              base: { $: "None" },
            },
          };
        } else {
          const ty = this.typeck_results.node_type(fun.hir_id);
          const fun_ = this.mirror_expr(fun);
          kind = {
            $: "Call",
            ty,
            fun: fun_,
            args: this.mirror_exprs(args),
            from_hir_call: true,
            fn_span: expr.span,
          };
        }
      }
      break;
    }

    case "Use": {
      const [expr_, span] = [ek._0, ek._1];
      kind = { $: "ByUse", expr: this.mirror_expr(expr_), span };
      break;
    }

    case "AddrOf": {
      const [bk, mutbl, arg] = [ek._0, ek._1, ek._2];
      if (bk === "Ref") {
        kind = { $: "Borrow", borrow_kind: Mutability_to_borrow_kind(mutbl), arg: this.mirror_expr(arg) };
      } else if (bk === "Raw") {
        kind = { $: "RawBorrow", mutability: mutbl, arg: this.mirror_expr(arg) };
      } else {
        // Make `&pin mut $expr` and `&pin const $expr` into
        // `Pin { __pointer: &mut { $expr } }` and `Pin { __pointer: &$expr }`.
        const arg_expr = arg;
        const tk = expr_ty.kind();
        if (tk.$ === "Adt" && tcx.is_lang_item(tk._0.did(), "Pin")) {
          const [adt_def, args] = [tk._0, tk._1];
          const ty = args.type_at(0);
          const arg_ty = this.typeck_results.expr_ty(arg_expr);
          let arg_ = this.mirror_expr(arg_expr);
          // For `&pin mut $place` where `$place` is not `Unpin`, move the place
          // `$place` to ensure it will not be used afterwards.
          if (mutbl === "Mut" && !arg_ty.is_unpin(this.tcx, this.typing_env)) {
            const block = push_idx<BlockId, Block>(this.thir.blocks, {
              targeted_by_break: false,
              region_scope: new Scope(arg_expr.hir_id.local_id, ScopeData.Node),
              span: arg_expr.span,
              stmts: [],
              expr: arg_,
              safety_mode: { $: "Safe" },
            });
            arg_ = push_idx<ExprId, Expr>(this.thir.exprs, {
              temp_scope_id: arg_expr.hir_id.local_id,
              ty: arg_ty,
              span: arg_expr.span,
              kind: { $: "Block", block },
            });
          }
          const expr_ = push_idx<ExprId, Expr>(this.thir.exprs, {
            temp_scope_id: expr.hir_id.local_id,
            ty,
            span: expr.span,
            kind: { $: "Borrow", borrow_kind: Mutability_to_borrow_kind(mutbl), arg: arg_ },
          });
          kind = {
            $: "Adt",
            _0: {
              adt_def,
              variant_index: FIRST_VARIANT,
              args,
              fields: [{ name: 0 as FieldIdx, expr: expr_ }],
              user_ty: undefined,
              base: { $: "None" },
            },
          };
        } else {
          return span_bug(expr.span, `unexpected type for pinned borrow: ${debug_Ty(expr_ty, PLAIN)}`);
        }
      }
      break;
    }

    case "Block": {
      const blk = ek._0;
      kind = { $: "Block", block: this.mirror_block(blk) };
      break;
    }

    case "Assign": {
      const [lhs, rhs] = [ek._0, ek._1];
      const lhs_ = this.mirror_expr(lhs);
      kind = { $: "Assign", lhs: lhs_, rhs: this.mirror_expr(rhs) };
      break;
    }

    case "AssignOp": {
      const [op, lhs, rhs] = [ek._0, ek._1, ek._2];
      if (this.typeck_results.is_method_call(expr)) {
        const lhs_ = this.mirror_expr(lhs);
        const rhs_ = this.mirror_expr(rhs);
        kind = this.overloaded_operator(expr, [lhs_, rhs_]);
      } else {
        const op_ = assign_op(op.node);
        const lhs_ = this.mirror_expr(lhs);
        kind = {
          $: "AssignOp",
          op: op_,
          lhs: lhs_,
          rhs: this.mirror_expr(rhs),
        };
      }
      break;
    }

    case "Lit": {
      const lit = ek._0;
      kind = { $: "Literal", lit, neg: false };
      break;
    }

    case "Binary": {
      const [op, lhs, rhs] = [ek._0, ek._1, ek._2];
      if (this.typeck_results.is_method_call(expr)) {
        const lhs_ = this.mirror_expr(lhs);
        const rhs_ = this.mirror_expr(rhs);
        kind = this.overloaded_operator(expr, [lhs_, rhs_]);
      } else {
        switch (op.node) {
          case "And": {
            const lhs_ = this.mirror_expr(lhs);
            kind = { $: "LogicalOp", op: "And", lhs: lhs_, rhs: this.mirror_expr(rhs) };
            break;
          }
          case "Or": {
            const lhs_ = this.mirror_expr(lhs);
            kind = { $: "LogicalOp", op: "Or", lhs: lhs_, rhs: this.mirror_expr(rhs) };
            break;
          }
          default: {
            const op_ = bin_op(op.node);
            const lhs_ = this.mirror_expr(lhs);
            kind = { $: "Binary", op: op_, lhs: lhs_, rhs: this.mirror_expr(rhs) };
          }
        }
      }
      break;
    }

    case "Index": {
      const [lhs, index, brackets_span] = [ek._0, ek._1, ek._2];
      if (this.typeck_results.is_method_call(expr)) {
        const lhs_ = this.mirror_expr(lhs);
        const index_ = this.mirror_expr(index);
        kind = this.overloaded_place(expr, expr_ty, undefined, [lhs_, index_], brackets_span);
      } else {
        const lhs_ = this.mirror_expr(lhs);
        kind = { $: "Index", lhs: lhs_, index: this.mirror_expr(index) };
      }
      break;
    }

    case "Unary": {
      const [op, arg] = [ek._0, ek._1];
      switch (op) {
        case "Deref":
          if (this.typeck_results.is_method_call(expr)) {
            const arg_ = this.mirror_expr(arg);
            kind = this.overloaded_place(expr, expr_ty, undefined, [arg_], expr.span);
          } else {
            kind = { $: "Deref", arg: this.mirror_expr(arg) };
          }
          break;
        case "Not":
          if (this.typeck_results.is_method_call(expr)) {
            const arg_ = this.mirror_expr(arg);
            kind = this.overloaded_operator(expr, [arg_]);
          } else {
            kind = { $: "Unary", op: as_un_op("Not"), arg: this.mirror_expr(arg) };
          }
          break;
        case "Neg":
          if (this.typeck_results.is_method_call(expr)) {
            const arg_ = this.mirror_expr(arg);
            kind = this.overloaded_operator(expr, [arg_]);
          } else if (arg.kind.$ === "Lit") {
            kind = { $: "Literal", lit: arg.kind._0, neg: true };
          } else {
            kind = { $: "Unary", op: as_un_op("Neg"), arg: this.mirror_expr(arg) };
          }
          break;
      }
      break;
    }

    case "Struct": {
      const [qpath, fields, base] = [ek._0, ek._1, ek._2];
      const tk = expr_ty.kind();
      if (tk.$ !== "Adt") {
        return span_bug(expr.span, `unexpected type for struct literal: ${debug_Ty(expr_ty, PLAIN)}`);
      }
      const [adt, args] = [tk._0, tk._1];
      switch (adt.adt_kind()) {
        case "Struct":
        case "Union": {
          const user_provided_types = this.typeck_results.user_provided_types();
          const user_ty: UserTy = user_provided_types.get(expr.hir_id);
          // debug!("make_mirror_unadjusted: (struct/union) user_ty={:?}", user_ty);
          const fields_ = this.field_refs(fields);
          let base_: AdtExpr["base"];
          switch (base.$) {
            case "Base":
              base_ = {
                $: "Base",
                _0: {
                  base: this.mirror_expr(base._0),
                  field_types: this.typeck_results.fru_field_types().index(expr.hir_id).slice(),
                },
              };
              break;
            case "DefaultFields":
              base_ = { $: "DefaultFields", _0: this.typeck_results.fru_field_types().index(expr.hir_id).slice() };
              break;
            case "None":
            case "NoneWithError":
              base_ = { $: "None" };
              break;
          }
          kind = {
            $: "Adt",
            _0: {
              adt_def: adt,
              variant_index: FIRST_VARIANT,
              args,
              user_ty,
              fields: fields_,
              base: base_,
            },
          };
          break;
        }
        case "Enum": {
          const res = this.typeck_results.qpath_res(qpath, expr.hir_id);
          if (res.$ === "Def" && res._0.$ === "Variant") {
            const variant_id = res._1;
            const base0: StructTailExpr = base;
            assert(base.$ === "None" || base.$ === "DefaultFields" || base.$ === "NoneWithError", "assertion failed: matches!(base, hir::StructTailExpr::None | hir::StructTailExpr::DefaultFields(_) |\n        hir::StructTailExpr::NoneWithError(_))");

            const index = adt.variant_index_with_id(variant_id);
            const user_provided_types = this.typeck_results.user_provided_types();
            const user_ty: UserTy = user_provided_types.get(expr.hir_id);
            // debug!("make_mirror_unadjusted: (variant) user_ty={:?}", user_ty);
            const fields_ = this.field_refs(fields);
            let base_: AdtExpr["base"];
            switch (base0.$) {
              case "DefaultFields":
                base_ = { $: "DefaultFields", _0: this.typeck_results.fru_field_types().index(expr.hir_id).slice() };
                break;
              case "Base":
                return span_bug(base0._0.span, `unexpected res: ${debug_Res(res, PLAIN, debug_HirId)}`);
              case "None":
              case "NoneWithError":
                base_ = { $: "None" };
                break;
            }
            kind = {
              $: "Adt",
              _0: {
                adt_def: adt,
                variant_index: index,
                args,
                user_ty,
                fields: fields_,
                base: base_,
              },
            };
          } else {
            return span_bug(expr.span, `unexpected res: ${debug_Res(res, PLAIN, debug_HirId)}`);
          }
          break;
        }
      }
      break;
    }

    case "Closure": {
      const closure_ty = this.typeck_results.expr_ty(expr);
      let def_id_: DefId;
      let args: UpvarArgs;
      let movability: Movability | undefined;
      const ck = closure_ty.kind();
      switch (ck.$) {
        case "Closure":
          [def_id_, args, movability] = [ck._0, { $: "Closure", _0: ck._1 }, undefined];
          break;
        case "Coroutine":
          [def_id_, args, movability] = [ck._0, { $: "Coroutine", _0: ck._1 }, tcx.coroutine_movability(ck._0)];
          break;
        case "CoroutineClosure":
          [def_id_, args, movability] = [ck._0, { $: "CoroutineClosure", _0: ck._1 }, undefined];
          break;
        default:
          return span_bug(expr.span, `closure expr w/o closure type: ${debug_Ty(closure_ty, PLAIN)}`);
      }
      const def_id = def_id_.expect_local();

      const captures = this.tcx.closure_captures(def_id) as readonly CapturedPlace[];
      const upvar_tys = UpvarArgs.upvar_tys(args);
      // `zip_eq` (itertools) panics when the lengths differ.
      if (captures.length !== upvar_tys.length) {
        return panic("itertools: .zip_eq() reached end of one iterator before the other");
      }
      const upvars: ExprId[] = [];
      for (let i = 0; i < captures.length; i++) {
        const upvars_ = this.capture_upvar(expr, captures[i]!, upvar_tys[i]!);
        upvars.push(push_idx<ExprId, Expr>(this.thir.exprs, upvars_));
      }

      // Convert the closure fake reads, if any, from hir `Place` to ExprRef
      const fake_reads_ = this.typeck_results.closure_fake_reads.get(def_id);
      const fake_reads: [ExprId, unknown, HirId][] = [];
      if (fake_reads_ !== undefined) {
        for (const [place, cause, hir_id] of fake_reads_) {
          const expr_ = this.convert_captured_hir_place(expr, place);
          fake_reads.push([push_idx<ExprId, Expr>(this.thir.exprs, expr_), cause, hir_id]);
        }
      }

      kind = {
        $: "Closure",
        _0: {
          closure_id: def_id,
          args,
          upvars,
          movability,
          fake_reads,
        },
      };
      break;
    }

    case "Path": {
      const qpath = ek._0;
      const res = this.typeck_results.qpath_res(qpath, expr.hir_id);
      kind = this.convert_path_expr(expr, res);
      break;
    }

    case "InlineAsm": {
      const asm = ek._0;
      const operands: InlineAsmOperand[] = [];
      for (const [op, _op_sp] of asm.operands) {
        let o: InlineAsmOperand;
        switch (op.$) {
          case "In":
            o = { $: "In", reg: InlineAsmRegOrRegClass.as_target(op.reg), expr: this.mirror_expr(op.expr) };
            break;
          case "Out":
            o = {
              $: "Out",
              reg: InlineAsmRegOrRegClass.as_target(op.reg),
              late: op.late,
              expr: op.expr === undefined ? undefined : this.mirror_expr(op.expr),
            };
            break;
          case "InOut":
            o = {
              $: "InOut",
              reg: InlineAsmRegOrRegClass.as_target(op.reg),
              late: op.late,
              expr: this.mirror_expr(op.expr),
            };
            break;
          case "SplitInOut": {
            const reg = InlineAsmRegOrRegClass.as_target(op.reg);
            const in_expr = this.mirror_expr(op.in_expr);
            o = {
              $: "SplitInOut",
              reg,
              late: op.late,
              in_expr,
              out_expr: op.out_expr === undefined ? undefined : this.mirror_expr(op.out_expr),
            };
            break;
          }
          case "Const": {
            const anon_const = op.anon_const;
            const ty = this.typeck_results.node_type(anon_const.hir_id);
            const did = anon_const.def_id;
            const typeck_root_def_id = tcx.typeck_root_def_id_local(did);
            const parent_args = tcx.erase_and_anonymize_regions(RawList.identity_for_item(tcx, LocalDefId.to_def_id(typeck_root_def_id)), fold_GenericArgs);
            const args = InlineConstArgs.new(tcx, { parent_args, ty }).args;

            void args;
            // `let uneval = mir::UnevaluatedConst::new(did.to_def_id(), args);`
            // `let value = mir::Const::Unevaluated(uneval, ty);`
            return unported("rustc_middle::mir::Const::Unevaluated (mir/consts.rs not ported): asm `const` operand");
          }
          case "SymFn":
            o = { $: "SymFn", value: this.mirror_expr(op.expr) };
            break;
          case "SymStatic":
            o = { $: "SymStatic", def_id: op.def_id };
            break;
          case "Label":
            o = { $: "Label", block: this.mirror_block(op.block) };
            break;
        }
        operands.push(o);
      }
      kind = {
        $: "InlineAsm",
        _0: {
          asm_macro: asm.asm_macro,
          template: asm.template,
          operands,
          options: asm.options,
          line_spans: asm.line_spans,
        },
      };
      break;
    }

    case "OffsetOf": {
      const offset_of_intrinsic = tcx.require_lang_item("OffsetOf", expr.span);
      const mk_u32_kind = (val: number): ExprKind => {
        const lit = ScalarInt.try_from_uint(BigInt(val), Size.from_bits(32));
        if (lit === undefined) return panic("called `Option::unwrap()` on a `None` value");
        return { $: "NonHirLiteral", lit, user_ty: undefined };
      };
      const mk_usize_kind = (val: bigint): ExprKind => {
        const lit = ScalarInt.try_from_target_usize(val, tcx);
        if (lit === undefined) return panic("called `Option::unwrap()` on a `None` value");
        return { $: "NonHirLiteral", lit, user_ty: undefined };
      };
      const mk_call = (thir: ThirBuildCx["thir"], ty: Ty, variant: VariantIdx, field: FieldIdx): ExprKind => {
        const fun_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(offset_of_intrinsic) as EarlyBinder<Ty>, tcx, [ty], fold_Ty));
        const fun = push_idx<ExprId, Expr>(thir.exprs, mk_expr({ $: "ZstLiteral", user_ty: undefined }, fun_ty));
        const variant_ = push_idx<ExprId, Expr>(thir.exprs, mk_expr(mk_u32_kind(variant), tcx.types.u32));
        const field_ = push_idx<ExprId, Expr>(thir.exprs, mk_expr(mk_u32_kind(field), tcx.types.u32));
        const args = [variant_, field_];
        return {
          $: "Call",
          ty: fun_ty,
          fun,
          args,
          from_hir_call: false,
          fn_span: expr.span,
        };
      };

      const indices = this.typeck_results.offset_of_data().get(expr.hir_id);
      if (indices === undefined) return panic("called `Option::unwrap()` on a `None` value");
      let expr_: ExprKind | undefined = undefined;

      for (const [container, variant, field] of indices) {
        const next: ExprKind = mk_call(this.thir, container, variant, field);
        const last: ExprKind | undefined = expr_;
        expr_ = undefined;
        if (last === undefined) {
          expr_ = next;
        } else {
          const last_: ExprId = push_idx<ExprId, Expr>(this.thir.exprs, mk_expr(last, tcx.types.usize));
          const next_: ExprId = push_idx<ExprId, Expr>(this.thir.exprs, mk_expr(next, tcx.types.usize));
          expr_ = { $: "Binary", op: as_bin_op("Add"), lhs: last_, rhs: next_ };
        }
      }

      kind = expr_ ?? mk_usize_kind(0n);
      break;
    }

    case "ConstBlock": {
      const anon_const = ek._0;
      const ty = this.typeck_results.node_type(anon_const.hir_id);
      const did = anon_const.def_id;
      const typeck_root_def_id = tcx.typeck_root_def_id_local(did);
      const parent_args = tcx.erase_and_anonymize_regions(RawList.identity_for_item(tcx, LocalDefId.to_def_id(typeck_root_def_id)), fold_GenericArgs);
      const args = InlineConstArgs.new(tcx, { parent_args, ty }).args;

      kind = { $: "ConstBlock", did: LocalDefId.to_def_id(did), args };
      break;
    }
    // Now comes the rote stuff:
    case "Repeat": {
      const v = ek._0;
      const ty = this.typeck_results.expr_ty(expr);
      const tk = ty.kind();
      if (tk.$ !== "Array") {
        return span_bug(expr.span, `unexpected repeat expr ty: ${debug_Ty(ty, PLAIN)}`);
      }
      const count = tk._1;

      kind = { $: "Repeat", value: this.mirror_expr(v), count };
      break;
    }
    case "Ret": {
      const v = ek._0;
      kind = { $: "Return", value: v === undefined ? undefined : this.mirror_expr(v) };
      break;
    }
    case "Become": {
      const call = ek._0;
      kind = { $: "Become", value: this.mirror_expr(call) };
      break;
    }
    case "Break": {
      const [dest, value] = [ek._0, ek._1];
      if (find_attr(HasAttrs_HirId.get_attrs(expr.hir_id, this.tcx), (k) => (k.$ === "ConstContinue" ? true : undefined)) !== undefined) {
        const target_id = dest.target_id;
        if (target_id.$ === "Ok") {
          if (!(value !== undefined && dest.label !== undefined)) {
            const span = expr.span;
            void span;
            // `self.tcx.dcx().emit_fatal(ConstContinueMissingLabelOrValue { span })`
            return unported("rustc_mir_build::errors::ConstContinueMissingLabelOrValue (diagnostics.rs not ported)");
          }

          kind = {
            $: "ConstContinue",
            label: new Scope(target_id._0.local_id, ScopeData.Node),
            value: this.mirror_expr(value),
          };
        } else {
          return bug(`invalid loop id for break: ${display_LoopIdError(target_id._0)}`);
        }
      } else {
        const target_id = dest.target_id;
        if (target_id.$ === "Ok") {
          kind = {
            $: "Break",
            label: new Scope(target_id._0.local_id, ScopeData.Node),
            value: value === undefined ? undefined : this.mirror_expr(value),
          };
        } else {
          return bug(`invalid loop id for break: ${display_LoopIdError(target_id._0)}`);
        }
      }
      break;
    }
    case "Continue": {
      const dest = ek._0;
      const target_id = dest.target_id;
      if (target_id.$ === "Ok") {
        kind = { $: "Continue", label: new Scope(target_id._0.local_id, ScopeData.Node) };
      } else {
        return bug(`invalid loop id for continue: ${display_LoopIdError(target_id._0)}`);
      }
      break;
    }
    case "Let": {
      const let_expr = ek._0;
      const expr_ = this.mirror_expr(let_expr.init);
      kind = { $: "Let", expr: expr_, pat: this.pattern_from_hir(let_expr.pat) };
      break;
    }
    case "If": {
      const [cond, then, else_opt] = [ek._0, ek._1, ek._2];
      const if_then_scope = new Scope(then.hir_id.local_id, Span.at_least_rust_2024(expr.span) ? ScopeData.IfThenRescope : ScopeData.IfThen);
      const cond_ = this.mirror_expr(cond);
      const then_ = this.mirror_expr(then);
      kind = {
        $: "If",
        if_then_scope,
        cond: cond_,
        then: then_,
        else_opt: else_opt === undefined ? undefined : this.mirror_expr(else_opt),
      };
      break;
    }
    case "Match": {
      const [discr, arms, match_source] = [ek._0, ek._1, ek._2];
      const scrutinee = this.mirror_expr(discr);
      kind = {
        $: "Match",
        scrutinee,
        arms: arms.map((a) => this.convert_arm(a)),
        match_source,
      };
      break;
    }
    case "Loop": {
      const body = ek._0;
      if (find_attr(HasAttrs_HirId.get_attrs(expr.hir_id, this.tcx), (k) => (k.$ === "LoopMatch" ? true : undefined)) !== undefined) {
        // PORT: `dcx.emit_fatal(LoopMatch* { .. })`: the diagnostic structs are in diagnostics.rs (`#[derive(Diagnostic)]`,
        // not generated yet), so each fatal error stops as UNPORTED (`emit_loop_match_fatal` below).
        // const dcx = this.tcx.dcx();

        // Accept either `state = expr` or `state = expr;`.
        let loop_body_expr: HirExpr;
        if (body.stmts.length === 0) {
          if (body.expr !== undefined) {
            loop_body_expr = body.expr;
          } else {
            return emit_loop_match_fatal("LoopMatchMissingAssignment");
          }
        } else if (body.stmts.length === 1 && body.expr === undefined) {
          const single = body.stmts[0]!;
          if (single.kind.$ === "Expr" || single.kind.$ === "Semi") {
            loop_body_expr = single.kind._0;
          } else {
            return emit_loop_match_fatal("LoopMatchMissingAssignment");
          }
        } else {
          // `[first @ last] | [first, .., last]`: `LoopMatchBadStatements { span: first.span.to(last.span) }`
          return emit_loop_match_fatal("LoopMatchBadStatements");
        }

        if (loop_body_expr.kind.$ !== "Assign") {
          return emit_loop_match_fatal("LoopMatchMissingAssignment");
        }
        const [state, rhs_expr] = [loop_body_expr.kind._0, loop_body_expr.kind._1];

        if (rhs_expr.kind.$ !== "Block") {
          return emit_loop_match_fatal("LoopMatchBadRhs");
        }
        const block_body = rhs_expr.kind._0;

        // The labeled block should contain one match expression, but defining items is
        // allowed.
        for (const stmt of block_body.stmts) {
          if (!(stmt.kind.$ === "Item")) {
            return emit_loop_match_fatal("LoopMatchBadStatements");
          }
        }

        const block_body_expr = block_body.expr;
        if (block_body_expr === undefined) {
          return emit_loop_match_fatal("LoopMatchBadRhs");
        }

        if (block_body_expr.kind.$ !== "Match") {
          return emit_loop_match_fatal("LoopMatchBadRhs");
        }
        const [scrutinee, arms] = [block_body_expr.kind._0, block_body_expr.kind._1];

        const scrutinee_hir_id = local(this, scrutinee);
        if (scrutinee_hir_id === undefined) {
          return emit_loop_match_fatal("LoopMatchInvalidMatch");
        }

        const state_local = local(this, state);
        if (!(state_local !== undefined && HirId_eq(state_local, scrutinee_hir_id))) {
          return emit_loop_match_fatal("LoopMatchInvalidUpdate");
        }

        const state_ = this.mirror_expr(state);
        const region_scope = new Scope(block_body.hir_id.local_id, ScopeData.Node);
        const scrutinee_ = this.mirror_expr(scrutinee);
        kind = {
          $: "LoopMatch",
          state: state_,
          region_scope,

          match_data: {
            scrutinee: scrutinee_,
            arms: arms.map((a) => this.convert_arm(a)),
            span: block_body_expr.span,
          },
        };
      } else {
        const block_ty = this.typeck_results.node_type(body.hir_id);
        const block = this.mirror_block(body);
        const body_ = push_idx<ExprId, Expr>(this.thir.exprs, {
          ty: block_ty,
          temp_scope_id: body.hir_id.local_id,
          span: this.thir.index_BlockId(block).span,
          kind: { $: "Block", block },
        });
        kind = { $: "Loop", body: body_ };
      }
      break;
    }
    case "Field": {
      const source = ek._0;
      const lhs = this.mirror_expr(source);
      kind = {
        $: "Field",
        lhs,
        variant_index: FIRST_VARIANT,
        name: this.typeck_results.field_index(expr.hir_id),
      };
      break;
    }
    case "Cast": {
      const [source, cast_ty] = [ek._0, ek._1];
      // Check for a user-given type annotation on this `cast`
      const user_provided_types = this.typeck_results.user_provided_types();
      const user_ty = user_provided_types.get(cast_ty.hir_id);

      // debug!(
      //     "cast({:?}) has ty w/ hir_id {:?} and user provided ty {:?}",
      //     expr, cast_ty.hir_id, user_ty,
      // );

      const cast = this.mirror_expr_cast(source, expr.hir_id.local_id, expr.span);

      if (user_ty !== undefined) {
        // NOTE: Creating a new Expr and wrapping a Cast inside of it may be
        //       inefficient, revisit this when performance becomes an issue.
        const cast_expr = push_idx<ExprId, Expr>(this.thir.exprs, {
          temp_scope_id: expr.hir_id.local_id,
          ty: expr_ty,
          span: expr.span,
          kind: cast,
        });
        // debug!("make_mirror_unadjusted: (cast) user_ty={:?}", user_ty);

        kind = {
          $: "ValueTypeAscription",
          source: cast_expr,
          user_ty,
          user_ty_span: cast_ty.span,
        };
      } else {
        kind = cast;
      }
      break;
    }
    case "Type": {
      const [source, ty] = [ek._0, ek._1];
      const user_provided_types = this.typeck_results.user_provided_types();
      const user_ty: UserTy = user_provided_types.get(ty.hir_id);
      // debug!("make_mirror_unadjusted: (type) user_ty={:?}", user_ty);
      const mirrored = this.mirror_expr(source);
      if (source.is_syntactic_place_expr()) {
        kind = {
          $: "PlaceTypeAscription",
          source: mirrored,
          user_ty,
          user_ty_span: ty.span,
        };
      } else {
        kind = {
          $: "ValueTypeAscription",
          source: mirrored,
          user_ty,
          user_ty_span: ty.span,
        };
      }
      break;
    }

    case "UnsafeBinderCast": {
      const [cast_kind, source] = [ek._0, ek._1];
      if (cast_kind === "Unwrap") {
        // FIXME(unsafe_binders): Take into account the ascribed type, too.
        const mirrored = this.mirror_expr(source);
        if (source.is_syntactic_place_expr()) {
          kind = { $: "PlaceUnwrapUnsafeBinder", source: mirrored };
        } else {
          kind = { $: "ValueUnwrapUnsafeBinder", source: mirrored };
        }
      } else {
        // FIXME(unsafe_binders): Take into account the ascribed type, too.
        const mirrored = this.mirror_expr(source);
        kind = { $: "WrapUnsafeBinder", source: mirrored };
      }
      break;
    }

    case "DropTemps": {
      const source = ek._0;
      kind = { $: "ValueExpr", source: this.mirror_expr(source) };
      break;
    }
    case "Array": {
      const fields = ek._0;
      kind = { $: "Array", fields: this.mirror_exprs(fields) };
      break;
    }
    case "Tup": {
      const fields = ek._0;
      kind = { $: "Tuple", fields: this.mirror_exprs(fields) };
      break;
    }

    case "Yield": {
      const v = ek._0;
      kind = { $: "Yield", value: this.mirror_expr(v) };
      break;
    }
    case "Err":
      return panic("internal error: entered unreachable code: cannot lower a `hir::ExprKind::Err` to THIR");
  }

  return mk_expr(kind, expr_ty);
};

// PORT: `fn local` is nested in `make_mirror_unadjusted`'s `#[loop_match]` arm upstream; hoisted to module level.
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1068 local
function local(cx: ThirBuildCx, expr: HirExpr): HirId | undefined {
  if (expr.kind.$ === "Path" && expr.kind._0.$ === "Resolved") {
    const path = expr.kind._0._1;
    const res = path.res;
    if (res.$ === "Local" && !cx.is_upvar(res._0)) {
      return res._0;
    }
  }

  return undefined;
}

/** `self.tcx.dcx().emit_fatal(<name> { .. })` for the `LoopMatch*` diagnostics of diagnostics.rs (not ported). */
function emit_loop_match_fatal(name: string): never {
  return unported(`rustc_mir_build::errors::${name} (diagnostics.rs not ported)`);
}

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1203 user_args_applied_to_res
ThirBuildCx.prototype.user_args_applied_to_res = function (this: ThirBuildCx, hir_id: HirId, res: Res): UserTy {
  // debug!("user_args_applied_to_res: res={:?}", res);
  let user_provided_type: UserTy;
  if (
    res.$ === "Def" &&
    (res._0.$ === "Fn" || res._0.$ === "AssocFn" || (res._0.$ === "Ctor" && res._0._1 === "Fn") || res._0.$ === "Const" || res._0.$ === "AssocConst")
  ) {
    // A reference to something callable -- e.g., a fn, method, or
    // a tuple-struct or tuple-variant. This has the type of a
    // `Fn` but with the user-given generic parameters.
    user_provided_type = this.typeck_results.user_provided_types().get(hir_id);
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Const") {
    // A unit struct/variant which is used as a value (e.g.,
    // `None`). This has the type of the enum/struct that defines
    // this variant -- but with the generic parameters given by the
    // user.
    user_provided_type = this.user_args_applied_to_ty_of_hir_id(hir_id);
  } else if (res.$ === "SelfCtor") {
    // `Self` is used in expression as a tuple struct constructor or a unit struct constructor
    user_provided_type = this.user_args_applied_to_ty_of_hir_id(hir_id);
  } else {
    return bug(`user_args_applied_to_res: unexpected res ${debug_Res(res, PLAIN, debug_HirId)} at ${debug_HirId(hir_id, PLAIN)}`);
  }
  // debug!("user_args_applied_to_res: user_provided_type={:?}", user_provided_type);
  return user_provided_type;
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1238 method_callee
ThirBuildCx.prototype.method_callee = function (this: ThirBuildCx, expr: HirExpr, span: Span, overloaded_callee: Ty | undefined): Expr {
  let ty: Ty;
  let user_ty: UserTy;
  if (overloaded_callee !== undefined) {
    [ty, user_ty] = [overloaded_callee, undefined];
  } else {
    const tdd = this.typeck_results.type_dependent_def(expr.hir_id);
    if (tdd === undefined) {
      return span_bug(expr.span, "no type-dependent def for method callee");
    }
    const [kind, def_id] = tdd;
    user_ty = this.user_args_applied_to_res(expr.hir_id, { $: "Def", _0: kind, _1: def_id });
    // debug!("method_callee: user_ty={:?}", user_ty);
    ty = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, this.typeck_results.node_args(expr.hir_id), fold_Ty),
    );
  }
  return {
    temp_scope_id: expr.hir_id.local_id,
    ty,
    span,
    kind: { $: "ZstLiteral", user_ty },
  };
};

/// The callee has a splatted tuple argument.
/// Rewrite a splatted call `receiver.f(a, u, v)` into `receiver.f(a, #[rustc_splat] (u, v))`.
/// The receiver is optional.
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1273 convert_splatted_callee
ThirBuildCx.prototype.convert_splatted_callee = function (
  this: ThirBuildCx,
  call_expr: HirExpr,
  fn_span: Span,
  args: readonly HirExpr[],
  receiver_or_func: SplattedFunc,
): ExprKind {
  const tcx = this.tcx;

  // Look up the typeck results
  const splatted_def = this.typeck_results.splatted_def(call_expr.hir_id);
  if (splatted_def === undefined) {
    return span_bug(call_expr.span, "no splatted def for function or method callee");
  }

  const tupled_arg_index = splatted_def.arg_index;
  const tupled_args_count = splatted_def.arg_count;

  // Splatting an empty tuple is permitted: `a.f() -> Trait::f(a, #[rustc_splat] ())`.
  // In that case, the tupled arg index is one past the end of the args.
  if (tupled_arg_index + tupled_args_count > args.length) {
    return span_bug(
      call_expr.span,
      `splatted arg index out of bounds of function args: ${tupled_arg_index} + ${tupled_args_count} > ${args.length} for function call: ${debug_SplattedFunc(receiver_or_func)}, args [${args.map((a) => debug_HirExpr(a, PLAIN)).join(", ")}]`,
    );
  }

  // debug!("Using splatted function span: {:?}", fn_span);

  // Split into non-tupled and tupled arguments
  const initial_non_tupled_args = args.slice(0, tupled_arg_index).map((e) => this.mirror_expr(e));
  let tupled_args_: readonly HirExpr[];
  if (tupled_arg_index === args.length || tupled_args_count === 0) {
    // Splatting an empty tuple, in the ABI this gets ignored
    tupled_args_ = [];
  } else {
    tupled_args_ = args.slice(tupled_arg_index, tupled_arg_index + tupled_args_count);
  }
  const final_non_tupled_args = args.slice(tupled_arg_index + tupled_args_count).map((e) => this.mirror_expr(e));

  const tupled_arg_tys = tupled_args_.map((e) => this.typeck_results.expr_ty_adjusted(e));

  // We need the tupled arguments in HIR/MIR for type checking
  // FIXME(splat): de-tuple args in codegen for performance
  const tupled_args__: Expr = {
    ty: Ty.new_tup_from_iter(tcx, tupled_arg_tys),
    temp_scope_id: call_expr.hir_id.local_id,
    span: call_expr.span,
    kind: { $: "Tuple", fields: this.mirror_exprs(tupled_args_) },
  };

  const tupled_args = push_idx<ExprId, Expr>(this.thir.exprs, tupled_args__);

  // Handle the receiver as the first arg, if present
  const args_: ExprId[] = [];
  const receiver = SplattedFunc.receiver(receiver_or_func);
  if (receiver !== undefined) {
    args_.push(this.mirror_expr(receiver));
  }
  args_.push(...initial_non_tupled_args);
  args_.push(tupled_args);
  args_.push(...final_non_tupled_args);

  const fn_span_ = SplattedFunc.has_receiver(receiver_or_func) ? fn_span : call_expr.span;

  let fn_ty: Ty;
  let fun_expr: ExprId;
  const fn_expression = SplattedFunc.fn_expression(receiver_or_func);
  if (splatted_def.$ === "FnDef") {
    // Create a FnDef shim for user-provided types
    const { def_id } = splatted_def;
    // We're calling a function via a FnDef, and its possibly generic type
    // This is effectively `self.method_callee(call_expr, fn_span, None)`,
    // applied to `splatted_def` instead of `type_dependent_def`.
    const def_kind = this.tcx.def_kind(def_id);
    const user_ty = this.user_args_applied_to_res(call_expr.hir_id, { $: "Def", _0: def_kind, _1: def_id });
    // debug!(
    //     "splatted_callee FnDef: user_ty={:?} def_kind={:?} def_id={:?} arg_index={:?} arg_count={:?}",
    //     user_ty, def_kind, def_id, arg_index, arg_count,
    // );

    // Create a new FnDef expression with user-provided type applied
    const callee_expr: Expr = {
      temp_scope_id: call_expr.hir_id.local_id,
      ty: Unnormalized.skip_norm_wip(
        EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, this.typeck_results.node_args(call_expr.hir_id), fold_Ty),
      ),
      span: fn_span_,
      kind: { $: "ZstLiteral", user_ty },
    };
    [fn_ty, fun_expr] = [callee_expr.ty, push_idx<ExprId, Expr>(this.thir.exprs, callee_expr)];
  } else if (fn_expression !== undefined) {
    // We're calling a function via a FnPtr and its type
    // FIXME(splat): do we need to populate and apply user_provided_types() ?
    const { fn_ptr_type } = splatted_def;
    // debug!(
    //     "splatted_callee FnPtr: fn_ty={:?} arg_index={:?} arg_count={:?}",
    //     fn_ptr_type, arg_index, arg_count,
    // );

    if (!fn_ptr_type.is_fn()) {
      return span_bug(
        call_expr.span,
        `splatted FnPtr side-tables were not populated correctly, non-fn type received: ${debug_Ty(fn_ptr_type, PLAIN)}`,
      );
    }

    // Pass through the FnPtr type and the mirrored function path
    [fn_ty, fun_expr] = [fn_ptr_type, this.mirror_expr(fn_expression)];
  } else {
    // FnPtrs must have a function expression (and they never have method receivers)
    return span_bug(
      call_expr.span,
      `convert_splatted_callee: FnPtr without fn expression (or with receiver) is invalid: splatted_def=${debug_SplattedDef(splatted_def, PLAIN)}, receiver_or_func=${debug_SplattedFunc(receiver_or_func)}`,
    );
  }

  return {
    $: "Call",
    ty: fn_ty,
    fun: fun_expr,
    args: args_,
    from_hir_call: true,
    fn_span: fn_span_,
  };
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1418 convert_arm
ThirBuildCx.prototype.convert_arm = function (this: ThirBuildCx, arm: HirArm): ArmId {
  const pattern = this.pattern_from_hir(arm.pat);
  const guard = arm.guard === undefined ? undefined : this.mirror_expr(arm.guard);
  const arm_ = {
    pattern,
    guard,
    body: this.mirror_expr(arm.body),
    hir_id: arm.hir_id,
    scope: new Scope(arm.hir_id.local_id, ScopeData.Node),
    span: arm.span,
  };
  return push_idx<ArmId, typeof arm_>(this.thir.arms, arm_);
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1430 convert_path_expr
ThirBuildCx.prototype.convert_path_expr = function (this: ThirBuildCx, expr: HirExpr, res: Res): ExprKind {
  const args = this.typeck_results.node_args(expr.hir_id);
  if (res.$ === "Def" && (res._0.$ === "Fn" || res._0.$ === "AssocFn" || (res._0.$ === "Ctor" && res._0._1 === "Fn"))) {
    // A regular function, constructor function or a constant.
    const user_ty = this.user_args_applied_to_res(expr.hir_id, res);
    return { $: "ZstLiteral", user_ty };
  } else if (res.$ === "SelfCtor") {
    const user_ty = this.user_args_applied_to_res(expr.hir_id, res);
    return { $: "ZstLiteral", user_ty };
  } else if (res.$ === "Def" && res._0.$ === "ConstParam") {
    const def_id = res._1;
    const hir_id = this.tcx.local_def_id_to_hir_id(def_id.expect_local());
    const generics = this.tcx.generics_of(hir_id.owner) as Generics;
    const index = generics.param_def_id_to_index.get(def_id);
    if (index === undefined) {
      return span_bug(expr.span, `Should have already errored about late bound consts: ${debug_DefId(def_id, PLAIN)}`);
    }
    const name = this.tcx.hir_name(hir_id);
    const param = ParamConst.new(index, name);

    return { $: "ConstParam", param, def_id };
  } else if (res.$ === "Def" && (res._0.$ === "Const" || res._0.$ === "AssocConst")) {
    const def_id = res._1;
    const user_ty = this.user_args_applied_to_res(expr.hir_id, res);
    return { $: "NamedConst", def_id, args, user_ty };
  } else if (res.$ === "Def" && res._0.$ === "Ctor" && res._0._1 === "Const") {
    const def_id = res._1;
    const user_provided_types = this.typeck_results.user_provided_types();
    const user_ty: UserTy = user_provided_types.get(expr.hir_id);
    // debug!("convert_path_expr: user_ty={:?}", user_ty);
    const ty = this.typeck_results.node_type(expr.hir_id);
    const tk = ty.kind();
    if (tk.$ === "Adt") {
      // A unit struct/variant which is used as a value.
      // We return a completely different ExprKind here to account for this special case.
      const [adt_def, args] = [tk._0, tk._1];
      return {
        $: "Adt",
        _0: {
          adt_def,
          variant_index: adt_def.variant_index_with_ctor_id(def_id),
          args,
          user_ty,
          fields: [],
          base: { $: "None" },
        },
      };
    } else {
      return bug(`unexpected ty: ${debug_Ty(ty, PLAIN)}`);
    }
  } else if (res.$ === "Def" && res._0.$ === "Static") {
    // A source Rust `path::to::STATIC` is a place expr like *&ident is.
    // In THIR, we make them exactly equivalent by inserting the implied *& or *&raw,
    // but distinguish between &STATIC and &THREAD_LOCAL as they have different semantics
    const id = res._1;
    // this is &raw for extern static or static mut, and & for other statics
    const ty = this.tcx.static_ptr_ty(id, this.typing_env);
    let kind: ExprKind;
    if (this.tcx.is_thread_local_static(id)) {
      kind = { $: "ThreadLocalRef", _0: id };
    } else {
      // `let alloc_id = self.tcx.reserve_and_set_static_alloc(id);`
      // `ExprKind::StaticRef { alloc_id, ty, def_id: id }`
      return unported("rustc_middle::ty::TyCtxt::reserve_and_set_static_alloc (mir/interpret, M4)");
    }
    return {
      $: "Deref",
      arg: push_idx<ExprId, Expr>(this.thir.exprs, {
        ty,
        temp_scope_id: expr.hir_id.local_id,
        span: expr.span,
        kind,
      }),
    };
  } else if (res.$ === "Local") {
    const var_hir_id = res._0;
    return this.convert_var(var_hir_id);
  } else {
    return span_bug(expr.span, `res \`${debug_Res(res, PLAIN, debug_HirId)}\` not yet implemented`);
  }
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1510 convert_var
ThirBuildCx.prototype.convert_var = function (this: ThirBuildCx, var_hir_id: HirId): ExprKind {
  // We want upvars here not captures.
  // Captures will be handled in MIR.
  const is_upvar = this.is_upvar(var_hir_id);

  // debug!(
  //     "convert_var({:?}): is_upvar={}, body_owner={:?}",
  //     var_hir_id, is_upvar, self.body_owner
  // );

  if (is_upvar) {
    return {
      $: "UpvarRef",
      closure_def_id: this.body_owner,
      var_hir_id: { _0: var_hir_id },
    };
  } else {
    return { $: "VarRef", id: { _0: var_hir_id } };
  }
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1530 overloaded_operator
ThirBuildCx.prototype.overloaded_operator = function (this: ThirBuildCx, expr: HirExpr, args: ExprId[]): ExprKind {
  const fun_ = this.method_callee(expr, expr.span, undefined);
  const fun = push_idx<ExprId, Expr>(this.thir.exprs, fun_);
  return {
    $: "Call",
    ty: this.thir.index_ExprId(fun).ty,
    fun,
    args,
    from_hir_call: false,
    fn_span: expr.span,
  };
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1546 overloaded_place
ThirBuildCx.prototype.overloaded_place = function (
  this: ThirBuildCx,
  expr: HirExpr,
  place_ty: Ty,
  overloaded_callee: Ty | undefined,
  args: ExprId[],
  span: Span,
): ExprKind {
  // For an overloaded *x or x[y] expression of type T, the method
  // call returns an &T and we must add the deref so that the types
  // line up (this is because `*x` and `x[y]` represent places):

  // Reconstruct the output assuming it's a reference with the
  // same region and mutability as the receiver. This holds for
  // `Deref(Mut)::deref(_mut)` and `Index(Mut)::index(_mut)`.
  const rk = this.thir.index_ExprId(args[0]!).ty.kind();
  if (rk.$ !== "Ref") {
    return span_bug(span, "overloaded_place: receiver is not a reference");
  }
  const [region, mutbl] = [rk._0, rk._2];
  const ref_ty = Ty.new_ref(this.tcx, region, place_ty, mutbl);

  // construct the complete expression `foo()` for the overloaded call,
  // which will yield the &T type
  const fun_ = this.method_callee(expr, span, overloaded_callee);
  const fun = push_idx<ExprId, Expr>(this.thir.exprs, fun_);
  const fun_ty = this.thir.index_ExprId(fun).ty;
  const ref_expr = push_idx<ExprId, Expr>(this.thir.exprs, {
    temp_scope_id: expr.hir_id.local_id,
    ty: ref_ty,
    span,
    kind: { $: "Call", ty: fun_ty, fun, args, from_hir_call: false, fn_span: span },
  });

  // construct and return a deref wrapper `*foo()`
  return { $: "Deref", arg: ref_expr };
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1582 convert_captured_hir_place
ThirBuildCx.prototype.convert_captured_hir_place = function (this: ThirBuildCx, closure_expr: HirExpr, place_: HirPlace): Expr {
  const place = place_ as unknown as HirPlaceView;
  const temp_scope_id = closure_expr.hir_id.local_id;
  const var_ty = place.base_ty;

  // The result of capture analysis in `rustc_hir_typeck/src/upvar.rs` represents a captured path
  // as it's seen for use within the closure and not at the time of closure creation.
  //
  // That is we see expect to see it start from a captured upvar and not something that is local
  // to the closure's parent.
  let var_hir_id: HirId;
  if (place.base.$ === "Upvar") {
    var_hir_id = place.base._0.var_path.hir_id;
  } else {
    return bug(`Expected an upvar, found ${debug_HirPlaceBase(place.base, PLAIN)}`);
  }

  let captured_place_expr: Expr = {
    temp_scope_id,
    ty: var_ty,
    span: closure_expr.span,
    kind: this.convert_var(var_hir_id),
  };

  for (const proj of place.projections) {
    let kind: ExprKind;
    switch (proj.kind.$) {
      case "Deref":
        kind = { $: "Deref", arg: push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr) };
        break;
      case "Field": {
        const [field, variant_index] = [proj.kind._0, proj.kind._1];
        kind = {
          $: "Field",
          lhs: push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr),
          variant_index,
          name: field,
        };
        break;
      }
      case "OpaqueCast":
        kind = { $: "ValueExpr", source: push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr) };
        break;
      case "UnwrapUnsafeBinder":
        kind = {
          $: "PlaceUnwrapUnsafeBinder",
          source: push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr),
        };
        break;
      case "Index":
      case "Subslice":
        // We don't capture these projections, so we can ignore them here
        continue;
    }

    captured_place_expr = { temp_scope_id, ty: proj.ty, span: closure_expr.span, kind };
  }

  return captured_place_expr;
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1636 capture_upvar
ThirBuildCx.prototype.capture_upvar = function (this: ThirBuildCx, closure_expr: HirExpr, captured_place: CapturedPlace, upvar_ty: Ty): Expr {
  const upvar_capture = captured_place.info.capture_kind;
  const captured_place_expr = this.convert_captured_hir_place(closure_expr, captured_place.place);
  const temp_scope_id = closure_expr.hir_id.local_id;

  switch (upvar_capture.$) {
    case "ByValue":
      return captured_place_expr;
    case "ByUse": {
      const span = captured_place_expr.span;
      const expr_id = push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr);

      return {
        temp_scope_id,
        ty: upvar_ty,
        span: closure_expr.span,
        kind: { $: "ByUse", expr: expr_id, span },
      };
    }
    case "ByRef": {
      const upvar_borrow = upvar_capture._0;
      let borrow_kind: MirBorrowKind;
      switch (upvar_borrow) {
        case "Immutable":
          borrow_kind = { $: "Shared" };
          break;
        case "UniqueImmutable":
          borrow_kind = { $: "Mut", kind: "ClosureCapture" };
          break;
        case "Mutable":
          borrow_kind = { $: "Mut", kind: "Default" };
          break;
      }
      return {
        temp_scope_id,
        ty: upvar_ty,
        span: closure_expr.span,
        kind: {
          $: "Borrow",
          borrow_kind,
          arg: push_idx<ExprId, Expr>(this.thir.exprs, captured_place_expr),
        },
      };
    }
  }
};

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1683 is_upvar
ThirBuildCx.prototype.is_upvar = function (this: ThirBuildCx, var_hir_id: HirId): boolean {
  const upvars = this.tcx.upvars_mentioned(this.body_owner);
  // PORT: `contains_key` on the query's `FxIndexMap<HirId, hir::Upvar>` (its TS value type is `Map<HirId, unknown>`
  // in queries.gen.ts; the provider, rustc_passes upvars.rs, is not ported).
  return upvars !== undefined && upvars.has(var_hir_id);
};

/// Converts a list of named fields (i.e., for struct-like struct/enum ADTs) into FieldExpr.
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1690 field_refs
ThirBuildCx.prototype.field_refs = function (this: ThirBuildCx, fields: readonly HirExprField[]): FieldExpr[] {
  return fields.map((field) => ({
    name: this.typeck_results.field_index(field.hir_id),
    expr: this.mirror_expr(field.expr),
  }));
};

// PORT: `trait ToBorrowKind` (expr.rs:1701) with its two impls: the trait's one method is declared here, the impls
// are functions over the implementing type.
// rustc-trait: compiler/rustc_mir_build/src/thir/cx/expr.rs:1701 ToBorrowKind
interface ToBorrowKind {
  // rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1702 to_borrow_kind
  to_borrow_kind(): MirBorrowKind;
}
export type { ToBorrowKind };

// `impl ToBorrowKind for AutoBorrowMutability`
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1706 to_borrow_kind
function AutoBorrowMutability_to_borrow_kind(self: AutoBorrowMutability): MirBorrowKind {
  // use rustc_middle::ty::adjustment::AllowTwoPhase;
  switch (self.$) {
    case "Mut": {
      let kind: MirMutBorrowKind;
      switch (self.allow_two_phase_borrow) {
        case "Yes":
          kind = "TwoPhaseBorrow";
          break;
        case "No":
          kind = "Default";
          break;
      }
      return { $: "Mut", kind };
    }
    case "Not":
      return { $: "Shared" };
  }
}

// `impl ToBorrowKind for hir::Mutability`
// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1721 to_borrow_kind
function Mutability_to_borrow_kind(self: Mutability): MirBorrowKind {
  switch (self) {
    case "Mut":
      return { $: "Mut", kind: "Default" };
    case "Not":
      return { $: "Shared" };
  }
}

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1729 bin_op
function bin_op(op: BinOpKind): BinOp {
  switch (op) {
    case "Add":
      return as_bin_op("Add");
    case "Sub":
      return as_bin_op("Sub");
    case "Mul":
      return as_bin_op("Mul");
    case "Div":
      return as_bin_op("Div");
    case "Rem":
      return as_bin_op("Rem");
    case "BitXor":
      return as_bin_op("BitXor");
    case "BitAnd":
      return as_bin_op("BitAnd");
    case "BitOr":
      return as_bin_op("BitOr");
    case "Shl":
      return as_bin_op("Shl");
    case "Shr":
      return as_bin_op("Shr");
    case "Eq":
      return as_bin_op("Eq");
    case "Lt":
      return as_bin_op("Lt");
    case "Le":
      return as_bin_op("Le");
    case "Ne":
      return as_bin_op("Ne");
    case "Ge":
      return as_bin_op("Ge");
    case "Gt":
      return as_bin_op("Gt");
    default:
      return bug(`no equivalent for ast binop ${op}`);
  }
}

// rustc: compiler/rustc_mir_build/src/thir/cx/expr.rs:1751 assign_op
function assign_op(op: AssignOpKind): MirAssignOp {
  switch (op) {
    case "AddAssign":
      return "AddAssign";
    case "SubAssign":
      return "SubAssign";
    case "MulAssign":
      return "MulAssign";
    case "DivAssign":
      return "DivAssign";
    case "RemAssign":
      return "RemAssign";
    case "BitXorAssign":
      return "BitXorAssign";
    case "BitAndAssign":
      return "BitAndAssign";
    case "BitOrAssign":
      return "BitOrAssign";
    case "ShlAssign":
      return "ShlAssign";
    case "ShrAssign":
      return "ShrAssign";
  }
}

// ---- helpers (not markers) -----------------------------------------------------------------------------------------

/** `user_provided_types.get(fun.hir_id).copied().map(|mut u_ty| { if let TypeOf(did, _) = &mut u_ty.value.kind { *did =
 *  adt_def.did() } u_ty })`: the copy with the `TypeOf` def id replaced. */
function with_type_of_did(u_ty: CanonicalUserType, did: DefId): CanonicalUserType {
  const k = u_ty.value.kind;
  if (k.$ === "TypeOf") {
    return { ...u_ty, value: { ...u_ty.value, kind: { $: "TypeOf", _0: did, _1: k._1 } } };
  }
  return u_ty;
}

/** `#[derive(Debug)]` of `hir::place::PlaceBase` (hir/place.rs:9; pending, see the module comment). */
function debug_HirPlaceBase(v: HirPlaceBase, f: Fmt): string {
  switch (v.$) {
    case "Rvalue":
    case "StaticItem":
      return v.$;
    case "Local":
      return debug_tuple(f, "Local", [debug_HirId(v._0, f)]);
    case "Upvar":
      // PORT: `UpvarId` has a manual Debug impl (ty/structural_impls.rs, reads the tcx) that is not ported.
      return unported("Debug for ty::UpvarId (manual impl, not ported)");
  }
}

/** `#[derive(Debug)]` of `ty::SplattedDef` (ty/typeck_results.rs:602). */
function debug_SplattedDef(v: SplattedDef, f: Fmt): string {
  switch (v.$) {
    case "FnDef":
      return debug_struct(f, "FnDef", [
        ["def_id", debug_DefId(v.def_id, f)],
        ["arg_index", debug_int(v.arg_index, f)],
        ["arg_count", debug_int(v.arg_count, f)],
      ]);
    case "FnPtr":
      return debug_struct(f, "FnPtr", [
        ["fn_ptr_type", debug_Ty(v.fn_ptr_type, f)],
        ["arg_index", debug_int(v.arg_index, f)],
        ["arg_count", debug_int(v.arg_count, f)],
      ]);
  }
}
