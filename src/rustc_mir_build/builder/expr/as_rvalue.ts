// Port of compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs (lane mb-expr-b, plan-m4 wave 22; declared by lane
// builder-contract). Conventions: builder/mod.ts's header and docs/handoff/builder-contract.md.
//! See docs in `build/expr/mod.rs`.
import { FieldIdx } from "../../../rustc_abi/layout.ts";
import { IntTy } from "../../../rustc_ast_ir/lib.ts";
import { type Scope as region_Scope, type TempLifetime } from "../../../rustc_middle/middle/region.ts";
import { Scalar } from "../../../rustc_middle/mir/interpret/value.ts";
import {
  type AggregateKind,
  type AssertMessage,
  type BasicBlock,
  BinOp,
  type BorrowKind,
  CastKind,
  type CoercionSource,
  Const,
  ConstOperand,
  type Local,
  LocalDecl,
  LocalInfo,
  type Mutability,
  Operand,
  type Place,
  Place_from_Local,
  type Rvalue,
  type SourceInfo,
  Statement,
  UnOp,
  UnwindAction,
} from "../../../rustc_middle/mir/mod.ts";
import { type ExprId, type ExprKind } from "../../../rustc_middle/thir.ts";
import { CastTy, mir_cast_kind } from "../../../rustc_middle/ty/cast.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { IntTypeExt } from "../../../rustc_middle/ty/util.ts";
import { debug_LayoutError } from "../../../rustc_middle/ty/layout.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { assert, unreachable, unwrap } from "../../../std/panic.ts";
import { unwrap_result } from "../../../std/result.ts";
import { Category } from "./category.ts";
import { and, BlockAnd, Builder, NeedsTemporary } from "../mod.ts";
import { type PlaceBuilder } from "./as_place.gen.ts";

declare module "../mod.ts" {
  interface Builder {
    // as_rvalue.rs:29
    as_local_rvalue(block: BasicBlock, expr_id: ExprId): BlockAnd<Rvalue>;
    // as_rvalue.rs:43
    as_rvalue(block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Rvalue>;
    // as_rvalue.rs:445
    build_binary_op(block: BasicBlock, op: BinOp, span: Span, ty: Ty, lhs: Operand, rhs: Operand): BlockAnd<Rvalue>;
    // as_rvalue.rs:599
    check_constness(kind: ExprKind): boolean;
    // as_rvalue.rs:618
    build_zero_repeat(block: BasicBlock, value: ExprId, scope: TempLifetime, outer_source_info: SourceInfo): BlockAnd<Rvalue>;
    // as_rvalue.rs:656
    limit_capture_mutability(upvar_span: Span, upvar_ty: Ty, temp_lifetime: region_Scope | undefined, block: BasicBlock, arg: ExprId): BlockAnd<Operand>;
    // as_rvalue.rs:738
    neg_1_literal(span: Span, ty: Ty): Operand;
    // as_rvalue.rs:747
    minval_literal(span: Span, ty: Ty): Operand;
  }
}

/// Returns an rvalue suitable for use until the end of the current
/// scope expression.
///
/// The operand returned from this function will *not be valid* after
/// an ExprKind::Scope is passed, so please do *not* return it from
/// functions to avoid bad miscompiles.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:29 as_local_rvalue
Builder.prototype.as_local_rvalue = function (this: Builder, block: BasicBlock, expr_id: ExprId): BlockAnd<Rvalue> {
  const local_scope = this.local_scope();
  return this.as_rvalue(block, { temp_lifetime: local_scope, backwards_incompatible: undefined }, expr_id);
};

/// Compile `expr`, yielding an rvalue.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:43 as_rvalue
Builder.prototype.as_rvalue = function (this: Builder, block: BasicBlock, scope: TempLifetime, expr_id: ExprId): BlockAnd<Rvalue> {
  // let this = self; // See "LET_THIS_SELF".
  const expr = this.thir.index_ExprId(expr_id);
  // debug!("expr_as_rvalue(block={:?}, scope={:?}, expr={:?})", block, scope, expr);

  const expr_span = expr.span;
  const source_info = this.source_info(expr_span);

  const kind: ExprKind = expr.kind;
  switch (kind.$) {
    case "ThreadLocalRef":
      return and(block, { $: "ThreadLocalRef", _0: kind._0 });
    case "Scope": {
      const { region_scope: region_scope_, hir_id, value } = kind;
      const region_scope: [region_Scope, SourceInfo] = [region_scope_, source_info];
      return this.in_scope(region_scope, { $: "Explicit", _0: hir_id }, (this_) => {
        this_.push_coverage_point_for_expr(block, source_info, hir_id);
        return this_.as_rvalue(block, scope, value);
      });
    }
    case "Repeat": {
      const { value, count } = kind;
      if (0n === count.try_to_target_usize(this.tcx)) {
        return this.build_zero_repeat(block, value, scope, source_info);
      } else {
        let value_operand: Operand;
        [block, value_operand] = this.as_operand(block, scope, value, LocalInfo.Boring, NeedsTemporary.No);
        return and(block, { $: "Repeat", _0: value_operand, _1: count });
      }
    }
    case "Binary": {
      const { op } = kind;
      let lhs: Operand;
      [block, lhs] = this.as_operand(block, scope, kind.lhs, LocalInfo.Boring, NeedsTemporary.Maybe);
      let rhs: Operand;
      [block, rhs] = this.as_operand(block, scope, kind.rhs, LocalInfo.Boring, NeedsTemporary.No);
      return this.build_binary_op(block, op, expr_span, expr.ty, lhs, rhs);
    }
    case "Unary": {
      const { op } = kind;
      let arg: Operand;
      [block, arg] = this.as_operand(block, scope, kind.arg, LocalInfo.Boring, NeedsTemporary.No);
      // Check for -MIN on signed integers
      if (this.check_overflow && op === UnOp.Neg && expr.ty.is_signed()) {
        const bool_ty = this.tcx.types.bool;

        const minval = this.minval_literal(expr_span, expr.ty);
        const is_min = this.temp(bool_ty, expr_span);

        this.cfg.push_assign(block, source_info, is_min, { $: "BinaryOp", _0: BinOp.Eq, _1: [Operand.to_copy(arg), minval] });

        block = this.assert(block, { $: "Move", _0: is_min }, false, { $: "OverflowNeg", _0: Operand.to_copy(arg) }, expr_span);
      }
      return and(block, { $: "UnaryOp", _0: op, _1: arg });
    }
    case "Cast": {
      const source_expr = this.thir.index_ExprId(kind.source);

      // Casting an enum to an integer is equivalent to computing the discriminant and casting the
      // discriminant. Previously every backend had to repeat the logic for this operation. Now we
      // create all the steps directly in MIR with operations all backends need to support anyway.
      let source: Operand;
      let ty: Ty;
      const source_kind = source_expr.ty.kind();
      if (source_kind.$ === "Adt" && source_kind._0.is_enum()) {
        const adt_def = source_kind._0;
        const discr_ty = IntTypeExt.to_ty(adt_def.repr().discr_type(), this.tcx);
        let temp: Local;
        [block, temp] = this.as_temp(block, scope, kind.source, "Not");
        const discr = this.temp(discr_ty, source_expr.span);
        this.cfg.push_assign(block, source_info, discr, { $: "Discriminant", _0: Place_from_Local(temp) });
        [source, ty] = [{ $: "Move", _0: discr }, discr_ty];
      } else {
        const ty_ = source_expr.ty;
        let source_: Operand;
        [block, source_] = this.as_operand(block, scope, kind.source, LocalInfo.Boring, NeedsTemporary.No);
        [source, ty] = [source_, ty_];
      }
      const _from_ty = CastTy.from_ty(ty);
      const _cast_ty = CastTy.from_ty(expr.ty);
      // debug!("ExprKind::Cast from_ty={from_ty:?}, cast_ty={:?}/{cast_ty:?}", expr.ty);
      const cast_kind = mir_cast_kind(ty, expr.ty);
      return and(block, { $: "Cast", _0: cast_kind, _1: source, _2: expr.ty });
    }
    case "PointerCoercion": {
      const { cast, is_from_as_cast } = kind;
      let source: Operand;
      [block, source] = this.as_operand(block, scope, kind.source, LocalInfo.Boring, NeedsTemporary.No);
      const origin: CoercionSource = is_from_as_cast ? "AsCast" : "Implicit";
      return and(block, { $: "Cast", _0: { $: "PointerCoercion", _0: cast, _1: origin }, _1: source, _2: expr.ty });
    }
    case "Array": {
      const { fields } = kind;
      // (*) We would (maybe) be closer to codegen if we
      // handled this and other aggregate cases via
      // `into()`, not `as_rvalue` -- in that case, instead
      // of generating
      //
      //     let tmp1 = ...1;
      //     let tmp2 = ...2;
      //     dest = Rvalue::Aggregate(Foo, [tmp1, tmp2])
      //
      // we could just generate
      //
      //     dest.f = ...1;
      //     dest.g = ...2;
      //
      // The problem is that then we would need to:
      //
      // (a) have a more complex mechanism for handling
      //     partial cleanup;
      // (b) distinguish the case where the type `Foo` has a
      //     destructor, in which case creating an instance
      //     as a whole "arms" the destructor, and you can't
      //     write individual fields; and,
      // (c) handle the case where the type Foo has no
      //     fields. We don't want `let x: ();` to compile
      //     to the same MIR as `let x = ();`.

      // first process the set of fields
      const el_ty = expr.ty.sequence_element_type(this.tcx);
      const fields_: Operand[] = fields.map((f) => {
        let op: Operand;
        [block, op] = this.as_operand(block, scope, f, LocalInfo.Boring, NeedsTemporary.Maybe);
        return op;
      });

      return and(block, { $: "Aggregate", _0: { $: "Array", _0: el_ty }, _1: fields_ });
    }
    case "Tuple": {
      const { fields } = kind;
      // see (*) above
      // first process the set of fields
      const fields_: Operand[] = fields.map((f) => {
        let op: Operand;
        [block, op] = this.as_operand(block, scope, f, LocalInfo.Boring, NeedsTemporary.Maybe);
        return op;
      });

      return and(block, { $: "Aggregate", _0: { $: "Tuple" }, _1: fields_ });
    }
    case "Closure": {
      const { closure_id, args, upvars, fake_reads } = kind._0;
      // Convert the closure fake reads, if any, from `ExprRef` to mir `Place`
      // and push the fake reads.
      // This must come before creating the operands. This is required in case
      // there is a fake read and a borrow of the same path, since otherwise the
      // fake read might interfere with the borrow. Consider an example like this
      // one:
      // ```
      // let mut x = 0;
      // let c = || {
      //     &mut x; // mutable borrow of `x`
      //     match x { _ => () } // fake read of `x`
      // };
      // ```
      //
      for (const [thir_place, cause, hir_id] of fake_reads) {
        let place_builder: PlaceBuilder;
        [block, place_builder] = this.as_place_builder(block, thir_place);

        const mir_place = place_builder.try_to_place(this);
        if (mir_place !== undefined) {
          this.cfg.push_fake_read(block, this.source_info(this.tcx.hir_span(hir_id)), cause, mir_place);
        }
      }

      // see (*) above
      const operands: Operand[] = upvars.map((upvar): Operand => {
        const upvar_expr = this.thir.index_ExprId(upvar);
        const category = Category.of(upvar_expr.kind);
        if (category !== undefined && category.$ === "Place") {
          // Use as_place to avoid creating a temporary when
          // moving a variable into a closure, so that
          // borrowck knows which variables to mark as being
          // used as mut. This is OK here because the upvar
          // expressions have no side effects and act on
          // disjoint places.
          // This occurs when capturing by copy/move, while
          // by reference captures use as_operand
          let place: Place;
          [block, place] = this.as_place(block, upvar);
          return this.consume_by_copy_or_move(place);
        } else {
          // Turn mutable borrow captures into unique
          // borrow captures when capturing an immutable
          // variable. This is sound because the mutation
          // that caused the capture will cause an error.
          const upvar_kind = upvar_expr.kind;
          if (upvar_kind.$ === "Borrow" && upvar_kind.borrow_kind.$ === "Mut" && upvar_kind.borrow_kind.kind === "Default") {
            const arg = upvar_kind.arg;
            let op: Operand;
            [block, op] = this.limit_capture_mutability(upvar_expr.span, upvar_expr.ty, scope.temp_lifetime, block, arg);
            return op;
          } else {
            let op: Operand;
            [block, op] = this.as_operand(block, scope, upvar, LocalInfo.Boring, NeedsTemporary.Maybe);
            return op;
          }
        }
      });

      let result: AggregateKind;
      switch (args.$) {
        case "Coroutine":
          result = { $: "Coroutine", _0: LocalDefId.to_def_id(closure_id), _1: args._0 };
          break;
        case "Closure":
          result = { $: "Closure", _0: LocalDefId.to_def_id(closure_id), _1: args._0 };
          break;
        case "CoroutineClosure":
          result = { $: "CoroutineClosure", _0: LocalDefId.to_def_id(closure_id), _1: args._0 };
          break;
      }
      return and(block, { $: "Aggregate", _0: result, _1: operands });
    }
    case "Assign":
    case "AssignOp": {
      block = BlockAnd.into_block(this.stmt_expr(block, expr_id, undefined));
      return and(block, {
        $: "Use",
        _0: { $: "Constant", _0: new ConstOperand(expr_span, undefined, Const.zero_sized(this.tcx.types.unit)) },
        _1: "Yes",
      });
    }

    case "Literal":
    case "NamedConst":
    case "NonHirLiteral":
    case "ZstLiteral":
    case "ConstParam":
    case "ConstBlock":
    case "StaticRef": {
      const constant = this.as_constant(expr);
      return and(block, { $: "Use", _0: { $: "Constant", _0: constant }, _1: "Yes" });
    }

    case "WrapUnsafeBinder": {
      let source: Operand;
      [block, source] = this.as_operand(block, scope, kind.source, LocalInfo.Boring, NeedsTemporary.Maybe);
      return and(block, { $: "WrapUnsafeBinder", _0: source, _1: expr.ty });
    }

    case "Yield":
    case "Block":
    case "Match":
    case "If":
    case "NeverToAny":
    case "ValueExpr":
    case "Borrow":
    case "RawBorrow":
    case "Adt":
    case "Loop":
    case "LoopMatch":
    case "LogicalOp":
    case "Call":
    case "Field":
    case "Let":
    case "Deref":
    case "Index":
    case "VarRef":
    case "UpvarRef":
    case "Break":
    case "Continue":
    case "ConstContinue":
    case "Return":
    case "Become":
    case "InlineAsm":
    case "PlaceTypeAscription":
    case "ValueTypeAscription":
    case "PlaceUnwrapUnsafeBinder":
    case "ValueUnwrapUnsafeBinder": {
      // these do not have corresponding `Rvalue` variants,
      // so make an operand and then return that
      // debug_assert!(!matches!(
      //     Category::of(&expr.kind),
      //     Some(Category::Rvalue(RvalueFunc::AsRvalue) | Category::Constant)
      // ));
      let operand: Operand;
      [block, operand] = this.as_operand(block, scope, expr_id, LocalInfo.Boring, NeedsTemporary.No);
      return and(block, { $: "Use", _0: operand, _1: "Yes" });
    }

    case "ByUse": {
      let operand: Operand;
      [block, operand] = this.as_operand(block, scope, kind.expr, LocalInfo.Boring, NeedsTemporary.No);
      return and(block, { $: "Use", _0: operand, _1: "Yes" });
    }
    case "Reborrow": {
      const { source, mutability, target } = kind;
      let temp: Local;
      [block, temp] = this.as_temp(block, scope, source, mutability);
      return and(block, { $: "Reborrow", _0: target, _1: mutability, _2: Place_from_Local(temp) });
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:445 build_binary_op
Builder.prototype.build_binary_op = function (this: Builder, block: BasicBlock, op: BinOp, span: Span, ty: Ty, lhs: Operand, rhs: Operand): BlockAnd<Rvalue> {
  const source_info = this.source_info(span);
  const bool_ty = this.tcx.types.bool;
  let rvalue: Rvalue;
  if ((op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul) && this.check_overflow && ty.is_integral()) {
    const result_tup = Ty.new_tup(this.tcx, [ty, bool_ty]);
    const result_value = this.temp(result_tup, span);

    const op_with_overflow = unwrap(BinOp.wrapping_to_overflowing(op));

    this.cfg.push_assign(block, source_info, result_value, {
      $: "BinaryOp",
      _0: op_with_overflow,
      _1: [Operand.to_copy(lhs), Operand.to_copy(rhs)],
    });
    const val_fld = FieldIdx.ZERO;
    const of_fld = FieldIdx.from_usize(1);

    const tcx = this.tcx;
    const val = tcx.mk_place_field(result_value, val_fld, ty);
    const of = tcx.mk_place_field(result_value, of_fld, bool_ty);

    const err: AssertMessage = { $: "Overflow", _0: op, _1: lhs, _2: rhs };
    block = this.assert(block, { $: "Move", _0: of }, false, err, span);

    rvalue = { $: "Use", _0: { $: "Move", _0: val }, _1: "Yes" };
  } else if ((op === BinOp.Shl || op === BinOp.Shr) && this.check_overflow && ty.is_integral()) {
    // For an unsigned RHS, the shift is in-range for `rhs < bits`.
    // For a signed RHS, `IntToInt` cast to the equivalent unsigned
    // type and do that same comparison.
    // A negative value will be *at least* 128 after the cast (that's i8::MIN),
    // and 128 is an overflowing shift amount for all our currently existing types,
    // so this cast can never make us miss an overflow.
    const [lhs_size] = ty.int_size_and_signed(this.tcx);
    assert(lhs_size.bits() <= 128, "assertion failed: lhs_size.bits() <= 128");
    const rhs_ty = Operand.ty(rhs, this.local_decls, this.tcx);
    const [rhs_size] = rhs_ty.int_size_and_signed(this.tcx);

    let unsigned_rhs: Operand;
    let unsigned_ty: Ty;
    const rhs_kind = rhs_ty.kind();
    switch (rhs_kind.$) {
      case "Uint":
        [unsigned_rhs, unsigned_ty] = [Operand.to_copy(rhs), rhs_ty];
        break;
      case "Int": {
        const int_width = rhs_kind._0;
        const uint_ty = Ty.new_uint(this.tcx, IntTy.to_unsigned(int_width));
        const rhs_temp = this.temp(uint_ty, span);
        this.cfg.push_assign(block, source_info, rhs_temp, { $: "Cast", _0: CastKind.IntToInt, _1: Operand.to_copy(rhs), _2: uint_ty });
        [unsigned_rhs, unsigned_ty] = [{ $: "Move", _0: rhs_temp }, uint_ty];
        break;
      }
      default:
        return unreachable("internal error: entered unreachable code: only integers are shiftable");
    }

    // This can't overflow because the largest shiftable types are 128-bit,
    // which fits in `u8`, the smallest possible `unsigned_ty`.
    const lhs_bits = Operand.const_from_scalar(this.tcx, unsigned_ty, Scalar.from_uint(BigInt(lhs_size.bits()), rhs_size), span);

    const inbounds = this.temp(bool_ty, span);
    this.cfg.push_assign(block, source_info, inbounds, { $: "BinaryOp", _0: BinOp.Lt, _1: [unsigned_rhs, lhs_bits] });

    const overflow_err: AssertMessage = { $: "Overflow", _0: op, _1: Operand.to_copy(lhs), _2: Operand.to_copy(rhs) };
    block = this.assert(block, { $: "Move", _0: inbounds }, true, overflow_err, span);
    rvalue = { $: "BinaryOp", _0: op, _1: [lhs, rhs] };
  } else if ((op === BinOp.Div || op === BinOp.Rem) && ty.is_integral()) {
    // Checking division and remainder is more complex, since we 1. always check
    // and 2. there are two possible failure cases, divide-by-zero and overflow.

    const zero_err: AssertMessage =
      op === BinOp.Div ? { $: "DivisionByZero", _0: Operand.to_copy(lhs) } : { $: "RemainderByZero", _0: Operand.to_copy(lhs) };
    const overflow_err: AssertMessage = { $: "Overflow", _0: op, _1: Operand.to_copy(lhs), _2: Operand.to_copy(rhs) };

    // Check for / 0
    const is_zero = this.temp(bool_ty, span);
    const zero = this.zero_literal(span, ty);
    this.cfg.push_assign(block, source_info, is_zero, { $: "BinaryOp", _0: BinOp.Eq, _1: [Operand.to_copy(rhs), zero] });

    block = this.assert(block, { $: "Move", _0: is_zero }, false, zero_err, span);

    // We only need to check for the overflow in one case:
    // MIN / -1, and only for signed values.
    if (ty.is_signed()) {
      const neg_1 = this.neg_1_literal(span, ty);
      const min = this.minval_literal(span, ty);

      const is_neg_1 = this.temp(bool_ty, span);
      const is_min = this.temp(bool_ty, span);
      const of = this.temp(bool_ty, span);

      // this does (rhs == -1) & (lhs == MIN). It could short-circuit instead

      this.cfg.push_assign(block, source_info, is_neg_1, { $: "BinaryOp", _0: BinOp.Eq, _1: [Operand.to_copy(rhs), neg_1] });
      this.cfg.push_assign(block, source_info, is_min, { $: "BinaryOp", _0: BinOp.Eq, _1: [Operand.to_copy(lhs), min] });

      const is_neg_1_: Operand = { $: "Move", _0: is_neg_1 };
      const is_min_: Operand = { $: "Move", _0: is_min };
      this.cfg.push_assign(block, source_info, of, { $: "BinaryOp", _0: BinOp.BitAnd, _1: [is_neg_1_, is_min_] });

      block = this.assert(block, { $: "Move", _0: of }, false, overflow_err, span);
    }

    rvalue = { $: "BinaryOp", _0: op, _1: [lhs, rhs] };
  } else {
    rvalue = { $: "BinaryOp", _0: op, _1: [lhs, rhs] };
  }
  return and(block, rvalue);
};

/// Recursively inspect a THIR expression and probe through unsizing
/// operations that can be const-folded today.
// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:599 check_constness
Builder.prototype.check_constness = function (this: Builder, kind: ExprKind): boolean {
  for (;;) {
    // debug!(?kind, "check_constness");
    if (
      kind.$ === "ValueTypeAscription" ||
      kind.$ === "ValueExpr" ||
      (kind.$ === "PointerCoercion" && kind.cast.$ === "Unsize")
    ) {
      kind = this.thir.index_ExprId(kind.source).kind;
    } else if (kind.$ === "Scope") {
      kind = this.thir.index_ExprId(kind.value).kind;
    } else {
      const category = Category.of(kind);
      return category !== undefined && category.$ === "Constant";
    }
  }
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:618 build_zero_repeat
Builder.prototype.build_zero_repeat = function (this: Builder, block: BasicBlock, value: ExprId, scope: TempLifetime, outer_source_info: SourceInfo): BlockAnd<Rvalue> {
  // let this = self; // See "LET_THIS_SELF".
  const value_expr = this.thir.index_ExprId(value);
  const elem_ty = value_expr.ty;
  if (this.check_constness(value_expr.kind)) {
    // Repeating a const does nothing
  } else {
    // For a non-const, we may need to generate an appropriate `Drop`
    let value_operand: Operand;
    [block, value_operand] = this.as_operand(block, scope, value, LocalInfo.Boring, NeedsTemporary.No);
    if (value_operand.$ === "Move") {
      const to_drop = value_operand._0;
      const success = this.cfg.start_new_block();
      this.cfg.terminate(block, outer_source_info, {
        $: "Drop",
        place: to_drop,
        target: success,
        unwind: UnwindAction.Continue,
        replace: false,
        drop: undefined,
      });
      this.diverge_from(block);
      block = success;
    }
    this.record_operands_moved([{ node: value_operand, span: DUMMY_SP }]);
  }
  return and(block, { $: "Aggregate", _0: { $: "Array", _0: elem_ty }, _1: [] });
};

// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:656 limit_capture_mutability
Builder.prototype.limit_capture_mutability = function (this: Builder, upvar_span: Span, upvar_ty: Ty, temp_lifetime: region_Scope | undefined, block: BasicBlock, arg: ExprId): BlockAnd<Operand> {
  // let this = self; // See "LET_THIS_SELF".

  const source_info = this.source_info(upvar_span);
  // `IndexVec::push` returns the index of the new element.
  const temp = (this.local_decls.push(LocalDecl.new(upvar_ty, upvar_span)) - 1) as Local;

  this.cfg.push(block, Statement.new(source_info, { $: "StorageLive", _0: temp }));

  let arg_place_builder: PlaceBuilder;
  [block, arg_place_builder] = this.as_place_builder(block, arg);

  let mutability: Mutability;
  const base = arg_place_builder.base_();
  switch (base.$) {
    // We are capturing a path that starts off a local variable in the parent.
    // The mutability of the current capture is same as the mutability
    // of the local declaration in the parent.
    case "Local":
      mutability = this.local_decls[base._0]!.mutability;
      break;
    // Parent is a closure and we are capturing a path that is captured
    // by the parent itself. The mutability of the current capture
    // is same as that of the capture in the parent closure.
    case "Upvar": {
      const enclosing_upvars_resolved = arg_place_builder.to_place(this);

      const { projection } = enclosing_upvars_resolved.as_ref();
      const p0 = projection[0];
      const p1 = projection[1];
      let upvar_index: FieldIdx;
      if (p0 !== undefined && p0.$ === "Field") {
        upvar_index = p0._0;
      } else if (p0 !== undefined && p0.$ === "Deref" && p1 !== undefined && p1.$ === "Field") {
        upvar_index = p1._0;
      } else {
        return bug("Unexpected capture place");
      }
      // Not in a closure
      // debug_assert!(
      //     local == ty::CAPTURE_STRUCT_LOCAL,
      //     "Expected local to be Local(1), found {local:?}"
      // );
      // Not in a closure
      // debug_assert!(
      //     this.upvars.len() > upvar_index.index(),
      //     "Unexpected capture place, upvars={:#?}, upvar_index={:?}",
      //     this.upvars,
      //     upvar_index
      // );
      mutability = this.upvars.index(FieldIdx.index(upvar_index)).mutability;
      break;
    }
  }

  let borrow_kind: BorrowKind;
  switch (mutability) {
    case "Not":
      borrow_kind = { $: "Mut", kind: "ClosureCapture" };
      break;
    case "Mut":
      borrow_kind = { $: "Mut", kind: "Default" };
      break;
  }

  const arg_place = arg_place_builder.to_place(this);

  this.cfg.push_assign(block, source_info, Place_from_Local(temp), {
    $: "Ref",
    _0: this.tcx.lifetimes.re_erased,
    _1: borrow_kind,
    _2: arg_place,
  });

  // This can be `None` if the expression's temporary scope was extended so that it can be
  // borrowed by a `const` or `static`. In that case, it's never dropped.
  if (temp_lifetime !== undefined) {
    this.schedule_drop_storage(upvar_span, temp_lifetime, temp);
    this.schedule_drop_value(upvar_span, temp_lifetime, temp);
  }

  return and(block, { $: "Move", _0: Place_from_Local(temp) });
};

// Helper to get a `-1` value of the appropriate type
// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:738 neg_1_literal
Builder.prototype.neg_1_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  const typing_env = this.typing_env();
  const size = unwrap_result(this.tcx.layout_of(typing_env.as_query_input(ty)), debug_LayoutError).size;
  const literal = Const.from_bits(this.tcx, size.unsigned_int_max(), typing_env, ty);

  return this.literal_operand(span, literal);
};

// Helper to get the minimum value of the appropriate type
// rustc: compiler/rustc_mir_build/src/builder/expr/as_rvalue.rs:747 minval_literal
Builder.prototype.minval_literal = function (this: Builder, span: Span, ty: Ty): Operand {
  assert(ty.is_signed(), "assertion failed: ty.is_signed()");
  const typing_env = this.typing_env();
  const bits = unwrap_result(this.tcx.layout_of(typing_env.as_query_input(ty)), debug_LayoutError).size.bits();
  // PORT: `1 << (bits - 1)` is a `u128` (the type of `Const::from_bits`'s `bits`): a `bigint`.
  const n = 1n << BigInt(bits - 1);
  const literal = Const.from_bits(this.tcx, n, typing_env, ty);

  return this.literal_operand(span, literal);
};
