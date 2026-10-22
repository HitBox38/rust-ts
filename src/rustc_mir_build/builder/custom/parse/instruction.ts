// Port of compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs (lane mb-custom-tail; declared by lane
// builder-contract). `parse_by_kind!` is expanded at each use (see parse.ts).
import { FieldIdx, VariantIdx } from "../../../../rustc_abi/layout.ts";
import { type Safety } from "../../../../rustc_hir/hir.ts";
import { Scalar } from "../../../../rustc_middle/mir/interpret/value.ts";
import { Pointer_from_AllocId } from "../../../../rustc_middle/mir/interpret/pointer.ts";
import {
  type BasicBlock,
  BinOp,
  type CastKind,
  Const,
  ConstOperand,
  debug_Local,
  type Local,
  Operand,
  type Place,
  type PlaceElem,
  Place_from_Local,
  PlaceTy,
  RawPtrKind_from_Mutability,
  type Rvalue,
  type StatementKind,
  SwitchTargets,
  TerminatorKind,
  type UnwindAction,
  type UnwindTerminateReason,
} from "../../../../rustc_middle/mir/mod.ts";
import { debug_PatKind, type ArmId, type ExprId } from "../../../../rustc_middle/thir.ts";
import { type PointerCoercion } from "../../../../rustc_middle/ty/adjustment.ts";
import { mir_cast_kind } from "../../../../rustc_middle/ty/cast.ts";
import { Value } from "../../../../rustc_middle/ty/consts/valtree.ts";
import { type Span, type Spanned } from "../../../../rustc_span/lib.ts";
import { sym } from "../../../../rustc_span/symbol.ts";
import { Unnormalized } from "../../../../rustc_type_ir/unnormalized.ts";
import { format_debug, PLAIN } from "../../../../std/fmt.ts";
import { unreachable, unwrap } from "../../../../std/panic.ts";
import { Err, Ok, type Result } from "../../../../std/result.ts";
import { as_constant_inner } from "../../expr/as_constant.ts";
import { ParseCtxt, type PResult } from "../mod.gen.ts";
import { parse_by_kind_call, parse_by_kind_variant } from "../parse.ts";

declare module "../mod.gen.ts" {
  interface ParseCtxt {
    // instruction.rs:16 (lane mb-custom-tail)
    parse_statement(expr_id: ExprId): PResult<StatementKind>;
    // instruction.rs:44 (lane mb-custom-tail)
    parse_terminator(expr_id: ExprId): PResult<TerminatorKind>;
    // instruction.rs:83 (lane mb-custom-tail)
    parse_unwind_terminate_reason(expr_id: ExprId): PResult<UnwindTerminateReason>;
    // instruction.rs:94 (lane mb-custom-tail)
    parse_unwind_action(expr_id: ExprId): PResult<UnwindAction>;
    // instruction.rs:111 (lane mb-custom-tail)
    parse_return_to(expr_id: ExprId): PResult<BasicBlock>;
    // instruction.rs:119 (lane mb-custom-tail)
    parse_match(arms: readonly ArmId[], span: Span): PResult<SwitchTargets>;
    // instruction.rs:159 (lane mb-custom-tail)
    parse_call(args: readonly ExprId[]): PResult<TerminatorKind>;
    // instruction.rs:191 (lane mb-custom-tail)
    parse_tail_call(args: readonly ExprId[]): PResult<TerminatorKind>;
    // instruction.rs:210 (lane mb-custom-tail)
    parse_cast_fn_ptr_safety(expr_id: ExprId): PResult<Safety>;
    // instruction.rs:221 (lane mb-custom-tail)
    parse_cast_pointer_coercion(expr_id: ExprId): PResult<PointerCoercion>;
    // instruction.rs:254 (lane mb-custom-tail)
    parse_cast_kind(expr_id: ExprId): PResult<CastKind>;
    // instruction.rs:301 (lane mb-custom-tail)
    parse_rvalue(expr_id: ExprId): PResult<Rvalue>;
    // instruction.rs:387 (lane mb-custom-tail)
    parse_operand(expr_id: ExprId): PResult<Operand>;
    // instruction.rs:406 (lane mb-custom-tail)
    parse_place(expr_id: ExprId): PResult<Place>;
    // instruction.rs:410 (lane mb-custom-tail)
    parse_place_inner(expr_id: ExprId): PResult<[Place, PlaceTy]>;
    // instruction.rs:446 (lane mb-custom-tail)
    parse_local(expr_id: ExprId): PResult<Local>;
    // instruction.rs:452 (lane mb-custom-tail)
    parse_block(expr_id: ExprId): PResult<BasicBlock>;
    // instruction.rs:458 (lane mb-custom-tail)
    parse_static(expr_id: ExprId): PResult<Operand>;
    // instruction.rs:478 (lane mb-custom-tail)
    parse_integer_literal(expr_id: ExprId): PResult<bigint>;
  }
}

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:16 parse_statement
ParseCtxt.prototype.parse_statement = function (this: ParseCtxt, expr_id_: ExprId): PResult<StatementKind> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "statement");
  let args: readonly ExprId[] | undefined;
  if ((args = parse_by_kind_call(this, expr.kind, sym.mir_storage_live)) !== undefined) {
    const l = this.parse_local(args[0]!);
    if (l.$ === "Err") return l;
    return Ok({ $: "StorageLive", _0: l._0 });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_storage_dead)) !== undefined) {
    const l = this.parse_local(args[0]!);
    if (l.$ === "Err") return l;
    return Ok({ $: "StorageDead", _0: l._0 });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_assume)) !== undefined) {
    const op = this.parse_operand(args[0]!);
    if (op.$ === "Err") return op;
    return Ok({ $: "Intrinsic", _0: { $: "Assume", _0: op._0 } });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_set_discriminant)) !== undefined) {
    const place = this.parse_place(args[0]!);
    if (place.$ === "Err") return place;
    const var_ = this.parse_integer_literal(args[1]!);
    if (var_.$ === "Err") return var_;
    return Ok({
      $: "SetDiscriminant",
      place: place._0,
      // PORT: `as u32` truncates.
      variant_index: VariantIdx.from_u32(Number(BigInt.asUintN(32, var_._0))),
    });
  } else if (expr.kind.$ === "Assign") {
    const lhs = this.parse_place(expr.kind.lhs);
    if (lhs.$ === "Err") return lhs;
    const rhs = this.parse_rvalue(expr.kind.rhs);
    if (rhs.$ === "Err") return rhs;
    return Ok({ $: "Assign", _0: [lhs._0, rhs._0] });
  }
  return Err(this.expr_error(expr_id, "statement"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:44 parse_terminator
ParseCtxt.prototype.parse_terminator = function (this: ParseCtxt, expr_id_: ExprId): PResult<TerminatorKind> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "terminator");
  let args: readonly ExprId[] | undefined;
  if (parse_by_kind_call(this, expr.kind, sym.mir_return) !== undefined) {
    return Ok(TerminatorKind.Return);
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_goto)) !== undefined) {
    const b = this.parse_block(args[0]!);
    if (b.$ === "Err") return b;
    return Ok(TerminatorKind.goto(b._0));
  } else if (parse_by_kind_call(this, expr.kind, sym.mir_unreachable) !== undefined) {
    return Ok(TerminatorKind.Unreachable);
  } else if (parse_by_kind_call(this, expr.kind, sym.mir_unwind_resume) !== undefined) {
    return Ok(TerminatorKind.UnwindResume);
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_unwind_terminate)) !== undefined) {
    const r = this.parse_unwind_terminate_reason(args[0]!);
    if (r.$ === "Err") return r;
    return Ok({ $: "UnwindTerminate", _0: r._0 });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_drop)) !== undefined) {
    const place = this.parse_place(args[0]!);
    if (place.$ === "Err") return place;
    const target = this.parse_return_to(args[1]!);
    if (target.$ === "Err") return target;
    const unwind = this.parse_unwind_action(args[2]!);
    if (unwind.$ === "Err") return unwind;
    return Ok({
      $: "Drop",
      place: place._0,
      target: target._0,
      unwind: unwind._0,
      replace: false,
      drop: undefined,
    });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_call)) !== undefined) {
    return this.parse_call(args);
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_tail_call)) !== undefined) {
    return this.parse_tail_call(args);
  } else if (expr.kind.$ === "Match") {
    const discr = this.parse_operand(expr.kind.scrutinee);
    if (discr.$ === "Err") return discr;
    const t = this.parse_match(expr.kind.arms, expr.span);
    return t.$ === "Ok" ? Ok({ $: "SwitchInt", discr: discr._0, targets: t._0 }) : t;
  }
  return Err(this.expr_error(expr_id, "terminator"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:83 parse_unwind_terminate_reason
ParseCtxt.prototype.parse_unwind_terminate_reason = function (this: ParseCtxt, expr_id_: ExprId): PResult<UnwindTerminateReason> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "unwind terminate reason");
  if (parse_by_kind_variant(this, expr.kind, sym.mir_unwind_terminate_reason, sym.Abi) !== undefined) {
    return Ok("Abi");
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_unwind_terminate_reason, sym.InCleanup) !== undefined) {
    return Ok("InCleanup");
  }
  return Err(this.expr_error(expr_id, "unwind terminate reason"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:94 parse_unwind_action
ParseCtxt.prototype.parse_unwind_action = function (this: ParseCtxt, expr_id_: ExprId): PResult<UnwindAction> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "unwind action");
  let args: readonly ExprId[] | undefined;
  if (parse_by_kind_call(this, expr.kind, sym.mir_unwind_continue) !== undefined) {
    return Ok({ $: "Continue" });
  } else if (parse_by_kind_call(this, expr.kind, sym.mir_unwind_unreachable) !== undefined) {
    return Ok({ $: "Unreachable" });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_unwind_terminate)) !== undefined) {
    const r = this.parse_unwind_terminate_reason(args[0]!);
    if (r.$ === "Err") return r;
    return Ok({ $: "Terminate", _0: r._0 });
  } else if ((args = parse_by_kind_call(this, expr.kind, sym.mir_unwind_cleanup)) !== undefined) {
    const b = this.parse_block(args[0]!);
    if (b.$ === "Err") return b;
    return Ok({ $: "Cleanup", _0: b._0 });
  }
  return Err(this.expr_error(expr_id, "unwind action"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:111 parse_return_to
ParseCtxt.prototype.parse_return_to = function (this: ParseCtxt, expr_id_: ExprId): PResult<BasicBlock> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "return block");
  let args: readonly ExprId[] | undefined;
  if ((args = parse_by_kind_call(this, expr.kind, sym.mir_return_to)) !== undefined) {
    return this.parse_block(args[0]!);
  }
  return Err(this.expr_error(expr_id, "return block"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:119 parse_match
ParseCtxt.prototype.parse_match = function (this: ParseCtxt, arms: readonly ArmId[], span: Span): PResult<SwitchTargets> {
  if (arms.length === 0) {
    return Err({
      span,
      item_description: "no arms",
      expected: "at least one arm",
    });
  }
  const [otherwise_, rest] = [arms[arms.length - 1]!, arms.slice(0, -1)];

  const otherwise_arm = this.thir.index_ArmId(otherwise_);
  if (otherwise_arm.pattern.kind.$ !== "Wild") {
    return Err({
      span: otherwise_arm.span,
      item_description: format_debug(otherwise_arm.pattern.kind, debug_PatKind, PLAIN),
      expected: "wildcard pattern",
    });
  }
  const otherwise = this.parse_block(otherwise_arm.body);
  if (otherwise.$ === "Err") return otherwise;

  const values: bigint[] = [];
  const targets: BasicBlock[] = [];
  for (const arm_ of rest) {
    const arm = this.thir.index_ArmId(arm_);
    const kind = arm.pattern.kind;
    let value;
    switch (kind.$) {
      case "Constant":
        value = kind.value;
        break;
      default: {
        return Err({
          span: arm.pattern.span,
          item_description: format_debug(kind, debug_PatKind, PLAIN),
          expected: "constant pattern",
        });
      }
    }
    values.push(Value.to_leaf(value).to_bits_unchecked());
    const t = this.parse_block(arm.body);
    if (t.$ === "Err") return t;
    targets.push(t._0);
  }

  return Ok(SwitchTargets.new(values.map((v, i) => [v, targets[i]!] as [bigint, BasicBlock]), otherwise._0));
};

/** `args.iter().map(|arg| Ok(Spanned { node: self.parse_operand(*arg)?, span: self.thir.exprs[*arg].span })).collect::<PResult<Box<[_]>>>()`
 *  of `parse_call` / `parse_tail_call` (the first `Err` stops the collection). */
function parse_spanned_operands(pctxt: ParseCtxt, args: readonly ExprId[]): PResult<Spanned<Operand>[]> {
  const out: Spanned<Operand>[] = [];
  for (const arg of args) {
    const node = pctxt.parse_operand(arg);
    if (node.$ === "Err") return node;
    out.push({ node: node._0, span: pctxt.thir.index_ExprId(arg).span });
  }
  return Ok(out);
}

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:159 parse_call
ParseCtxt.prototype.parse_call = function (this: ParseCtxt, args: readonly ExprId[]): PResult<TerminatorKind> {
  let destination_: ExprId;
  let call: ExprId;
  {
    const expr_id = this.preparse(args[0]!);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "function call");
    if (expr.kind.$ === "Assign") {
      [destination_, call] = [expr.kind.lhs, expr.kind.rhs];
    } else {
      return Err(this.expr_error(expr_id, "function call"));
    }
  }
  const destination = this.parse_place(destination_);
  if (destination.$ === "Err") return destination;
  const target = this.parse_return_to(args[1]!);
  if (target.$ === "Err") return target;
  const unwind = this.parse_unwind_action(args[2]!);
  if (unwind.$ === "Err") return unwind;

  const expr_id = this.preparse(call);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "function call");
  if (expr.kind.$ === "Call") {
    const { fun, args, from_hir_call, fn_span } = expr.kind;
    const fun_ = this.parse_operand(fun);
    if (fun_.$ === "Err") return fun_;
    const args_ = parse_spanned_operands(this, args);
    if (args_.$ === "Err") return args_;
    return Ok({
      $: "Call",
      func: fun_._0,
      args: args_._0,
      destination: destination._0,
      target: target._0,
      unwind: unwind._0,
      call_source: from_hir_call ? "Normal" : "OverloadedOperator",
      fn_span: fn_span,
    });
  }
  return Err(this.expr_error(expr_id, "function call"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:191 parse_tail_call
ParseCtxt.prototype.parse_tail_call = function (this: ParseCtxt, args_: readonly ExprId[]): PResult<TerminatorKind> {
  const expr_id = this.preparse(args_[0]!);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "tail call");
  if (expr.kind.$ === "Call") {
    const { fun, args, fn_span } = expr.kind;
    const fun_ = this.parse_operand(fun);
    if (fun_.$ === "Err") return fun_;
    const args__ = parse_spanned_operands(this, args);
    if (args__.$ === "Err") return args__;
    return Ok({
      $: "TailCall",
      func: fun_._0,
      args: args__._0,
      fn_span: fn_span,
    });
  }
  return Err(this.expr_error(expr_id, "tail call"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:210 parse_cast_fn_ptr_safety
ParseCtxt.prototype.parse_cast_fn_ptr_safety = function (this: ParseCtxt, expr_id_: ExprId): PResult<Safety> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "function pointer safety");
  if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_fn_ptr_safety, sym.Safe) !== undefined) {
    return Ok("Safe");
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_fn_ptr_safety, sym.Unsafe) !== undefined) {
    return Ok("Unsafe");
  }
  return Err(this.expr_error(expr_id, "function pointer safety"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:221 parse_cast_pointer_coercion
ParseCtxt.prototype.parse_cast_pointer_coercion = function (this: ParseCtxt, expr_id_: ExprId): PResult<PointerCoercion> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "pointer coercion kind");
  if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.ReifyFnPointer) !== undefined) {
    if (expr.kind.$ !== "Adt") {
      return unreachable("already matched");
    }
    const { fields } = expr.kind._0;
    const s = this.parse_cast_fn_ptr_safety(fields[0]!.expr);
    if (s.$ === "Err") return s;
    return Ok({ $: "ReifyFnPointer", _0: s._0 });
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.UnsafeFnPointer) !== undefined) {
    return Ok({ $: "UnsafeFnPointer" });
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.ClosureFnPointer) !== undefined) {
    if (expr.kind.$ !== "Adt") {
      return unreachable("already matched");
    }
    const { fields } = expr.kind._0;
    const s = this.parse_cast_fn_ptr_safety(fields[0]!.expr);
    if (s.$ === "Err") return s;
    return Ok({ $: "ClosureFnPointer", _0: s._0 });
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.MutToConstPointer) !== undefined) {
    return Ok({ $: "MutToConstPointer" });
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.ArrayToPointer) !== undefined) {
    return Ok({ $: "ArrayToPointer" });
  } else if (parse_by_kind_variant(this, expr.kind, sym.mir_cast_ptr_coercion, sym.UnsizePointee) !== undefined) {
    return Ok({ $: "Unsize" });
  }
  return Err(this.expr_error(expr_id, "pointer coercion kind"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:254 parse_cast_kind
ParseCtxt.prototype.parse_cast_kind = function (this: ParseCtxt, expr_id_: ExprId): PResult<CastKind> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "cast kind");
  const v = (variant: typeof sym.Abi) => parse_by_kind_variant(this, expr.kind, sym.mir_cast_kind, variant) !== undefined;
  if (v(sym.PointerExposeProvenance)) {
    return Ok({ $: "PointerExposeProvenance" });
  } else if (v(sym.PointerWithExposedProvenance)) {
    return Ok({ $: "PointerWithExposedProvenance" });
  } else if (v(sym.IntToInt)) {
    return Ok({ $: "IntToInt" });
  } else if (v(sym.FloatToInt)) {
    return Ok({ $: "FloatToInt" });
  } else if (v(sym.FloatToFloat)) {
    return Ok({ $: "FloatToFloat" });
  } else if (v(sym.IntToFloat)) {
    return Ok({ $: "IntToFloat" });
  } else if (v(sym.PtrToPtr)) {
    return Ok({ $: "PtrToPtr" });
  } else if (v(sym.FnPtrToPtr)) {
    return Ok({ $: "FnPtrToPtr" });
  } else if (v(sym.Transmute)) {
    return Ok({ $: "Transmute" });
  } else if (v(sym.BoxDerefTransmute)) {
    return Ok({ $: "BoxDerefTransmute" });
  } else if (v(sym.Subtype)) {
    return Ok({ $: "Subtype" });
  } else if (v(sym.PointerCoercion)) {
    if (expr.kind.$ !== "Adt") {
      return unreachable("already matched");
    }
    const { fields } = expr.kind._0;
    const c = this.parse_cast_pointer_coercion(fields[0]!.expr);
    if (c.$ === "Err") return c;
    return Ok({ $: "PointerCoercion", _0: c._0, _1: "AsCast" });
  }
  return Err(this.expr_error(expr_id, "cast kind"));
};

/** `iter.map(|e| self.parse_operand(*e)).collect::<Result<_, _>>()` of `parse_rvalue`'s aggregates. */
function parse_operands(pctxt: ParseCtxt, exprs: readonly ExprId[]): PResult<Operand[]> {
  const out: Operand[] = [];
  for (const e of exprs) {
    const op = pctxt.parse_operand(e);
    if (op.$ === "Err") return op;
    out.push(op._0);
  }
  return Ok(out);
}

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:301 parse_rvalue
ParseCtxt.prototype.parse_rvalue = function (this: ParseCtxt, expr_id_: ExprId): PResult<Rvalue> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "rvalue");
  const k = expr.kind;
  let args: readonly ExprId[] | undefined;
  if ((args = parse_by_kind_call(this, k, sym.mir_discriminant)) !== undefined) {
    const p = this.parse_place(args[0]!);
    return p.$ === "Ok" ? Ok({ $: "Discriminant", _0: p._0 }) : p;
  } else if ((args = parse_by_kind_call(this, k, sym.mir_cast_transmute)) !== undefined) {
    const source = this.parse_operand(args[0]!);
    if (source.$ === "Err") return source;
    return Ok({ $: "Cast", _0: { $: "Transmute" }, _1: source._0, _2: expr.ty });
  } else if ((args = parse_by_kind_call(this, k, sym.mir_cast_ptr_to_ptr)) !== undefined) {
    const source = this.parse_operand(args[0]!);
    if (source.$ === "Err") return source;
    return Ok({ $: "Cast", _0: { $: "PtrToPtr" }, _1: source._0, _2: expr.ty });
  } else if ((args = parse_by_kind_call(this, k, sym.mir_cast_unsize)) !== undefined) {
    const source = this.parse_operand(args[0]!);
    if (source.$ === "Err") return source;
    const kind: CastKind = { $: "PointerCoercion", _0: { $: "Unsize" }, _1: "AsCast" };
    return Ok({ $: "Cast", _0: kind, _1: source._0, _2: expr.ty });
  } else if ((args = parse_by_kind_call(this, k, sym.mir_cast)) !== undefined) {
    const source = this.parse_operand(args[0]!);
    if (source.$ === "Err") return source;
    const kind = this.parse_cast_kind(args[1]!);
    if (kind.$ === "Err") return kind;
    return Ok({ $: "Cast", _0: kind._0, _1: source._0, _2: expr.ty });
  } else if ((args = parse_by_kind_call(this, k, sym.mir_checked)) !== undefined) {
    const expr_id2 = this.preparse(args[0]!);
    const expr2 = this.thir.index_ExprId(expr_id2);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "binary op");
    if (expr2.kind.$ === "Binary") {
      const { op, lhs, rhs } = expr2.kind;
      const op_with_overflow = BinOp.wrapping_to_overflowing(op);
      if (op_with_overflow !== undefined) {
        const l = this.parse_operand(lhs);
        if (l.$ === "Err") return l;
        const r = this.parse_operand(rhs);
        if (r.$ === "Err") return r;
        return Ok({ $: "BinaryOp", _0: op_with_overflow, _1: [l._0, r._0] });
      } else {
        // PORT: `expr_id` here is the fn's parameter (macro hygiene: `parse_by_kind!`'s own `expr_id` is not visible in
        // its arms), not the preparsed id.
        return Err(this.expr_error(expr_id_, "No WithOverflow form of this operator"));
      }
    }
    return Err(this.expr_error(expr_id2, "binary op"));
  } else if ((args = parse_by_kind_call(this, k, sym.mir_offset)) !== undefined) {
    const ptr = this.parse_operand(args[0]!);
    if (ptr.$ === "Err") return ptr;
    const offset = this.parse_operand(args[1]!);
    if (offset.$ === "Err") return offset;
    return Ok({ $: "BinaryOp", _0: "Offset", _1: [ptr._0, offset._0] });
  } else if ((args = parse_by_kind_call(this, k, sym.mir_ptr_metadata)) !== undefined) {
    const op = this.parse_operand(args[0]!);
    if (op.$ === "Err") return op;
    return Ok({ $: "UnaryOp", _0: "PtrMetadata", _1: op._0 });
  } else if (k.$ === "Borrow") {
    const p = this.parse_place(k.arg);
    if (p.$ === "Err") return p;
    return Ok({ $: "Ref", _0: this.tcx.lifetimes.re_erased, _1: k.borrow_kind, _2: p._0 });
  } else if (k.$ === "RawBorrow") {
    const p = this.parse_place(k.arg);
    if (p.$ === "Err") return p;
    return Ok({ $: "RawPtr", _0: RawPtrKind_from_Mutability(k.mutability), _1: p._0 });
  } else if (k.$ === "Binary") {
    const l = this.parse_operand(k.lhs);
    if (l.$ === "Err") return l;
    const r = this.parse_operand(k.rhs);
    if (r.$ === "Err") return r;
    return Ok({ $: "BinaryOp", _0: k.op, _1: [l._0, r._0] });
  } else if (k.$ === "Unary") {
    const a = this.parse_operand(k.arg);
    if (a.$ === "Err") return a;
    return Ok({ $: "UnaryOp", _0: k.op, _1: a._0 });
  } else if (k.$ === "Repeat") {
    const v = this.parse_operand(k.value);
    if (v.$ === "Err") return v;
    return Ok({ $: "Repeat", _0: v._0, _1: k.count });
  } else if (k.$ === "Cast") {
    const source = this.parse_operand(k.source);
    if (source.$ === "Err") return source;
    const source_ty = Operand.ty(source._0, this.body.local_decls_(), this.tcx);
    const cast_kind = mir_cast_kind(source_ty, expr.ty);
    return Ok({ $: "Cast", _0: cast_kind, _1: source._0, _2: expr.ty });
  } else if (k.$ === "Tuple") {
    const ops = parse_operands(this, k.fields);
    if (ops.$ === "Err") return ops;
    return Ok({ $: "Aggregate", _0: { $: "Tuple" }, _1: ops._0 });
  } else if (k.$ === "Array") {
    const elem_ty = unwrap(expr.ty.builtin_index(), "ty must be an array");
    const ops = parse_operands(this, k.fields);
    if (ops.$ === "Err") return ops;
    return Ok({ $: "Aggregate", _0: { $: "Array", _0: elem_ty }, _1: ops._0 });
  } else if (k.$ === "Adt") {
    const { adt_def, variant_index, args, fields } = k._0;
    const is_union = adt_def.is_union();
    const active_field_index = is_union ? fields[0]!.name : undefined;

    const ops = parse_operands(
      this,
      fields.map((f) => f.expr),
    );
    if (ops.$ === "Err") return ops;
    return Ok({ $: "Aggregate", _0: { $: "Adt", _0: adt_def.did(), _1: variant_index, _2: args, _3: undefined, _4: active_field_index }, _1: ops._0 });
  } else {
    const op = this.parse_operand(expr_id_);
    return op.$ === "Ok" ? Ok({ $: "Use", _0: op._0, _1: "Yes" }) : op;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:387 parse_operand
ParseCtxt.prototype.parse_operand = function (this: ParseCtxt, expr_id_: ExprId): PResult<Operand> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "operand");
  const k = expr.kind;
  let args: readonly ExprId[] | undefined;
  if ((args = parse_by_kind_call(this, k, sym.mir_move)) !== undefined) {
    const p = this.parse_place(args[0]!);
    return p.$ === "Ok" ? Ok({ $: "Move", _0: p._0 }) : p;
  } else if ((args = parse_by_kind_call(this, k, sym.mir_static)) !== undefined) {
    return this.parse_static(args[0]!);
  } else if ((args = parse_by_kind_call(this, k, sym.mir_static_mut)) !== undefined) {
    return this.parse_static(args[0]!);
  } else if (k.$ === "Literal" || k.$ === "NamedConst" || k.$ === "NonHirLiteral" || k.$ === "ZstLiteral" || k.$ === "ConstParam" || k.$ === "ConstBlock") {
    return Ok({ $: "Constant", _0: as_constant_inner(expr, (_) => undefined, this.tcx) });
  } else {
    const p = this.parse_place(expr_id_);
    return p.$ === "Ok" ? Ok({ $: "Copy", _0: p._0 }) : p;
  }
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:406 parse_place
ParseCtxt.prototype.parse_place = function (this: ParseCtxt, expr_id: ExprId): PResult<Place> {
  const r = this.parse_place_inner(expr_id);
  return r.$ === "Ok" ? Ok(r._0[0]) : r;
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:410 parse_place_inner
ParseCtxt.prototype.parse_place_inner = function (this: ParseCtxt, expr_id_: ExprId): PResult<[Place, PlaceTy]> {
  let parent: ExprId;
  let proj: PlaceElem;
  {
    const expr_id = this.preparse(expr_id_);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "place");
    const k = expr.kind;
    let args: readonly ExprId[] | undefined;
    if ((args = parse_by_kind_call(this, k, sym.mir_field)) !== undefined) {
      const pi = this.parse_place_inner(args[0]!);
      if (pi.$ === "Err") return pi;
      const [parent_, place_ty] = pi._0;
      const n = this.parse_integer_literal(args[1]!);
      if (n.$ === "Err") return n;
      // PORT: `as u32` truncates.
      const field = FieldIdx.from_u32(Number(BigInt.asUintN(32, n._0)));
      const field_ty = Unnormalized.skip_norm_wip(PlaceTy.field_ty(this.tcx, place_ty.ty, place_ty.variant_index, field));
      const proj_: PlaceElem = { $: "Field", _0: field, _1: field_ty };
      const place = parent_.project_deeper([proj_], this.tcx);
      return Ok([place, PlaceTy.from_ty(field_ty)]);
    } else if ((args = parse_by_kind_call(this, k, sym.mir_variant)) !== undefined) {
      const n = this.parse_integer_literal(args[1]!);
      if (n.$ === "Err") return n;
      [parent, proj] = [args[0]!, { $: "Downcast", _0: undefined, _1: VariantIdx.from_u32(Number(BigInt.asUintN(32, n._0))) }];
    } else if (k.$ === "Deref") {
      const arg = k.arg;
      const expr_id2 = this.preparse(arg);
      const expr2 = this.thir.index_ExprId(expr_id2);
      // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "does not matter");
      let args2: readonly ExprId[] | undefined;
      if ((args2 = parse_by_kind_call(this, expr2.kind, sym.mir_make_place)) !== undefined) {
        return this.parse_place_inner(args2[0]!);
      } else {
        [parent, proj] = [arg, { $: "Deref" }];
      }
    } else if (k.$ === "Index") {
      const l = this.parse_local(k.index);
      if (l.$ === "Err") return l;
      [parent, proj] = [k.lhs, { $: "Index", _0: l._0 }];
    } else if (k.$ === "Field") {
      [parent, proj] = [k.lhs, { $: "Field", _0: k.name, _1: expr.ty }];
    } else {
      const l = this.parse_local(expr_id_);
      if (l.$ === "Err") return l;
      const place = Place_from_Local(l._0);
      return Ok([place, PlaceTy.from_ty(expr.ty)]);
    }
  }
  const pi = this.parse_place_inner(parent);
  if (pi.$ === "Err") return pi;
  const [parent_, ty_] = pi._0;
  const place = parent_.project_deeper([proj], this.tcx);
  const ty = ty_.projection_ty(this.tcx, proj, debug_Local);
  return Ok([place, ty]);
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:446 parse_local
ParseCtxt.prototype.parse_local = function (this: ParseCtxt, expr_id_: ExprId): PResult<Local> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "local");
  if (expr.kind.$ === "VarRef") {
    // PORT: `HashMap` indexing panics on a missing key.
    return Ok(unwrap(this.local_map.get(expr.kind.id)));
  }
  return Err(this.expr_error(expr_id, "local"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:452 parse_block
ParseCtxt.prototype.parse_block = function (this: ParseCtxt, expr_id_: ExprId): PResult<BasicBlock> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "basic block");
  if (expr.kind.$ === "VarRef") {
    // PORT: `HashMap` indexing panics on a missing key.
    return Ok(unwrap(this.block_map.get(expr.kind.id)));
  }
  return Err(this.expr_error(expr_id, "basic block"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:458 parse_static
ParseCtxt.prototype.parse_static = function (this: ParseCtxt, expr_id_: ExprId): PResult<Operand> {
  let expr_id2: ExprId;
  {
    const expr_id = this.preparse(expr_id_);
    const expr = this.thir.index_ExprId(expr_id);
    // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "static");
    if (expr.kind.$ === "Deref") {
      expr_id2 = expr.kind.arg;
    } else {
      return Err(this.expr_error(expr_id, "static"));
    }
  }

  const expr_id = this.preparse(expr_id2);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "static");
  if (expr.kind.$ === "StaticRef") {
    const const_val = { $: "Scalar" as const, _0: Scalar.from_pointer(Pointer_from_AllocId(expr.kind.alloc_id), this.tcx) };
    const const_: Const = { $: "Val", _0: const_val, _1: expr.kind.ty };

    return Ok({ $: "Constant", _0: new ConstOperand(expr.span, undefined, const_) });
  }
  return Err(this.expr_error(expr_id, "static"));
};

// rustc: compiler/rustc_mir_build/src/builder/custom/parse/instruction.rs:478 parse_integer_literal
ParseCtxt.prototype.parse_integer_literal = function (this: ParseCtxt, expr_id_: ExprId): PResult<bigint> {
  const expr_id = this.preparse(expr_id_);
  const expr = this.thir.index_ExprId(expr_id);
  // tracing::debug!("Trying to parse {:?} as {}", expr.kind, "constant");
  const k = expr.kind;
  if (k.$ === "Literal" || k.$ === "NamedConst" || k.$ === "NonHirLiteral" || k.$ === "ConstBlock") {
    const value = as_constant_inner(expr, (_) => undefined, this.tcx);
    return Ok(Const.eval_bits(value.const_, this.tcx, this.typing_env));
  }
  return Err(this.expr_error(expr_id, "constant"));
};
