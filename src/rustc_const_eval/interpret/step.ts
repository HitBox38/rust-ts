// Port of compiler/rustc_const_eval/src/interpret/step.rs (lane interp-step-call; declared by lane interp-contract,
// docs/handoff/interp-contract.md): the `InterpCx` methods for executing a single step of the interpreter
// (interpret/eval_context.ts's header has the representation notes).
//! This module contains the `InterpCx` methods for executing a single step of the interpreter.
//!
//! The main entry point is the `step` method.
import { FIRST_VARIANT, FieldIdx, type VariantIdx } from "../../rustc_abi/lib.ts";
import { Mutability } from "../../rustc_ast_ir/lib.ts";
import { FnArg, fn_abi_ } from "./call.ts";
import { InterpCx } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { RetagMode } from "./machine.gen.ts";
import { type EvaluatedCalleeAndArgs } from "./step.gen.ts";
import { type FnVal } from "./memory.gen.ts";
import { ImmTy, type OpTy } from "./operand.gen.ts";
import { Immediate } from "./operand.ts";
import { MemPlaceMeta } from "./place.ts";
import {
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Pointer_Option_from_Pointer,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import {
  type AggregateKind,
  AssertKind,
  BorrowKind,
  debug_AggregateKind,
  debug_Operand,
  debug_TerminatorKind,
  type Either,
  type Local,
  Location,
  type Operand as mir_Operand,
  Place as mir_Place,
  RawPtrKind,
  type Rvalue,
  type Statement,
  type Terminator,
  UnwindAction,
  WithRetag,
} from "../../rustc_middle/mir/mod.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import { debug_TyAndLayout_Ty, type TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Span, type Spanned } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { FnSig, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { debug_vec, format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { PlaceTy } from "./place.gen.ts";

export * from "./step.gen.ts";

/** Lazy `crate::util` (util/mod.ts, lane ctfe-util; read at call time, init order). */
function util(): typeof import("../util/mod.ts") {
  return require("../util/mod.ts") as typeof import("../util/mod.ts");
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // step.rs:41 (lane interp-step-call)
    step(): InterpResult<boolean>;
    // step.rs:81 (lane interp-step-call)
    eval_statement(stmt: Statement): InterpResult;
    // step.rs:160 (lane interp-step-call)
    eval_rvalue_into_place(rvalue: Rvalue, place: mir_Place): InterpResult;
    // step.rs:306 (lane interp-step-call)
    write_aggregate(kind: AggregateKind, operands: readonly mir_Operand[], dest: PlaceTy): InterpResult;
    // step.rs:365 (lane interp-step-call)
    write_repeat(operand: mir_Operand, dest: PlaceTy): InterpResult;
    // step.rs:403 (lane interp-step-call)
    eval_fn_call_argument(op: mir_Operand, move_definitely_disjoint: boolean): InterpResult<FnArg>;
    // step.rs:438 (lane interp-step-call)
    eval_callee_and_args(terminator: Terminator, func: mir_Operand, args: readonly Spanned<mir_Operand>[], dest: mir_Place): InterpResult<EvaluatedCalleeAndArgs<M>>;
    // step.rs:519 (lane interp-step-call)
    eval_terminator(terminator: Terminator): InterpResult;
  }
}

/** PORT: the derived `PartialEq` of `Either<mir::Location, Span>` (`Location` compares both fields). */
function loc_eq(a: Either<Location, Span>, b: Either<Location, Span>): boolean {
  if (a.$ === "Left" && b.$ === "Left") return a._0.block === b._0.block && a._0.statement_index === b._0.statement_index;
  if (a.$ === "Right" && b.$ === "Right") return a._0 === b._0;
  return false;
}

/** PORT: the derived `PartialEq` of `TyAndLayout` (`Ty` and the interned `Layout` by identity). */
function layout_eq(a: TyAndLayout, b: TyAndLayout): boolean {
  return a.ty === b.ty && a.layout === b.layout;
}

/// Returns `true` as long as there are more things to do.
///
/// This is used by [priroda](https://github.com/oli-obk/priroda)
///
/// This is marked `#inline(always)` to work around adversarial codegen when `opt-level = 3`
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:41 step
InterpCx.prototype.step = function (this: InterpCx): InterpResult<boolean> {
  if (this.stack().length === 0) {
    return interp_ok(false);
  }

  const frame_loc = this.frame().loc;
  if (frame_loc.$ !== "Left") {
    // We are unwinding and this fn has no cleanup code.
    // Just go on unwinding.
    // trace!("unwinding: skipping frame");
    const r = this.return_from_current_stack_frame(/* unwinding */ true);
    if (r.$ === "Err") return r;
    return interp_ok(true);
  }
  const loc = frame_loc._0;
  const basic_block = unwrap(this.body().basic_blocks.deref()[loc.block]);

  const stmt = basic_block.statements[loc.statement_index];
  if (stmt !== undefined) {
    const old_frames = this.frame_idx();
    const r = this.eval_statement(stmt);
    if (r.$ === "Err") return r;
    // Make sure we are not updating `statement_index` of the wrong frame.
    assert_eq(old_frames, this.frame_idx(), (v) => `${v}`);
    // Advance the program counter.
    // PORT: `loc.as_mut().left().unwrap().statement_index += 1`: `Location` values are shared (e.g. `Location::START`),
    // so the frame gets a new one.
    const frame = this.frame_mut();
    const cur = unwrap(frame.loc.$ === "Left" ? frame.loc._0 : undefined);
    frame.loc = { $: "Left", _0: new Location(cur.block, cur.statement_index + 1) };
    return interp_ok(true);
  }

  const r = this.machine.before_terminator(this);
  if (r.$ === "Err") return r;

  const terminator = basic_block.terminator_();
  const r2 = this.eval_terminator(terminator);
  if (r2.$ === "Err") return r2;
  if (!(this.stack().length === 0)) {
    // if let Either::Left(loc) = self.frame().loc { info!("// executing {:?}", loc.block); }
  }
  return interp_ok(true);
};

/// Runs the interpretation logic for the given `mir::Statement` at the current frame and
/// statement counter.
///
/// This does NOT move the statement counter forward, the caller has to do that!
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:81 eval_statement
InterpCx.prototype.eval_statement = function (this: InterpCx, stmt: Statement): InterpResult {
  // let _trace = enter_trace_span!(
  //     M,
  //     step::eval_statement,
  //     stmt = ?stmt.kind,
  //     span = ?stmt.source_info.span,
  //     tracing_separate_thread = Empty,
  // )
  // .or_if_tracing_disabled(|| info!("{:?}", stmt.kind));

  // use rustc_middle::mir::StatementKind::*;

  const kind = stmt.kind;
  switch (kind.$) {
    case "Assign": {
      const [place, rvalue] = kind._0;
      const r = this.eval_rvalue_into_place(rvalue, place);
      if (r.$ === "Err") return r;
      break;
    }

    case "SetDiscriminant": {
      const { place, variant_index } = kind;
      const dest = this.eval_place(place, /* skip_validity_for_simple_deref */ false);
      if (dest.$ === "Err") return dest;
      const r = this.write_discriminant(variant_index, dest._0);
      if (r.$ === "Err") return r;
      break;
    }

    // Mark locals as alive
    case "StorageLive": {
      const r = this.storage_live(kind._0);
      if (r.$ === "Err") return r;
      break;
    }

    // Mark locals as dead
    case "StorageDead": {
      const r = this.storage_dead(kind._0);
      if (r.$ === "Err") return r;
      break;
    }

    // No dynamic semantics attached to `FakeRead`; MIR
    // interpreter is solely intended for borrowck'ed code.
    case "FakeRead":
      break;

    case "Intrinsic": {
      const r = this.eval_nondiverging_intrinsic(kind._0);
      if (r.$ === "Err") return r;
      break;
    }

    // Evaluate the place expression, without reading from it.
    case "PlaceMention": {
      const r = this.eval_place(kind._0, /* skip_validity_for_simple_deref */ false);
      if (r.$ === "Err") return r;
      break;
    }

    // This exists purely to guide borrowck lifetime inference, and does not have
    // an operational effect.
    case "AscribeUserType":
      break;

    // Currently, Miri discards Coverage statements. Coverage statements are only injected
    // via an optional compile time MIR pass and have no side effects. Since Coverage
    // statements don't exist at the source level, it is safe for Miri to ignore them, even
    // for undefined behavior (UB) checks.
    //
    // A coverage counter inside a const expression (for example, a counter injected in a
    // const function) is discarded when the const is evaluated at compile time. Whether
    // this should change, and/or how to implement a const eval counter, is a subject of the
    // following issue:
    //
    // FIXME(#73156): Handle source code coverage in const eval
    case "Coverage":
      break;

    case "ConstEvalCounter": {
      const r = this.machine.increment_const_eval_counter(this);
      if (r.$ === "Err") return r;
      break;
    }

    // Defined to do nothing. These are added by optimization passes, to avoid changing the
    // size of MIR constantly.
    case "Nop":
      break;

    // Only used for temporary lifetime lints
    case "BackwardIncompatibleDropHint":
      break;
  }

  return interp_ok(undefined);
};

/// Evaluate an assignment statement.
///
/// There is no separate `eval_rvalue` function. Instead, the code for handling each rvalue
/// type writes its results directly into the memory specified by the place.
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:160 eval_rvalue_into_place
InterpCx.prototype.eval_rvalue_into_place = function (this: InterpCx, rvalue: Rvalue, place: mir_Place): InterpResult {
  // We can skip validity because we'll write to the place which checks everything we care
  // about for references, and the pointee must be sized so there's nothing to check for raw
  // pointers.
  const dest_r = this.eval_place(place, /* skip_validity_for_simple_deref */ true);
  if (dest_r.$ === "Err") return dest_r;
  const dest = dest_r._0;
  // FIXME: ensure some kind of non-aliasing between LHS and RHS?
  // Also see https://github.com/rust-lang/rust/issues/68364.

  // use rustc_middle::mir::Rvalue::*;
  switch (rvalue.$) {
    case "ThreadLocalRef": {
      const did = rvalue._0;
      const ptr = this.machine.thread_local_static_pointer(this, did);
      if (ptr.$ === "Err") return ptr;
      const r = this.write_pointer(Pointer_Option_from_Pointer(ptr._0), dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Use": {
      const operand = rvalue._0;
      const with_retag = rvalue._1;
      // Avoid recomputing the layout
      const op = this.eval_operand(operand, dest.layout);
      if (op.$ === "Err") return op;
      const mode = WithRetag.yes(with_retag) ? RetagMode.Default : RetagMode.None;
      const r = this.machine.with_retag_mode(this, mode, (ecx) => ecx.copy_op(op._0, dest));
      if (r.$ === "Err") return r;
      break;
    }

    case "CopyForDeref":
      return bug("`CopyForDeref` in runtime MIR");

    case "BinaryOp": {
      const bin_op = rvalue._0;
      const [left_op, right_op] = rvalue._1;
      const layout = util().binop_left_homogeneous(bin_op) ? dest.layout : undefined;
      const left_o = this.eval_operand(left_op, layout);
      if (left_o.$ === "Err") return left_o;
      const left = this.read_immediate(left_o._0);
      if (left.$ === "Err") return left;
      const layout2 = util().binop_right_homogeneous(bin_op) ? left._0.layout : undefined;
      const right_o = this.eval_operand(right_op, layout2);
      if (right_o.$ === "Err") return right_o;
      const right = this.read_immediate(right_o._0);
      if (right.$ === "Err") return right;
      const result = this.binary_op(bin_op, left._0, right._0);
      if (result.$ === "Err") return result;
      if (!layout_eq(result._0.layout, dest.layout)) {
        panic(
          `assertion \`left == right\` failed: layout mismatch for result of ${bin_op}\n  left: ${debug_TyAndLayout_Ty(result._0.layout, PLAIN)}\n right: ${debug_TyAndLayout_Ty(dest.layout, PLAIN)}`,
        );
      }
      const r = this.write_immediate(result._0.imm, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "UnaryOp": {
      const un_op = rvalue._0;
      const operand = rvalue._1;
      const layout = util().unop_homogeneous(un_op) ? dest.layout : undefined;
      const val_o = this.eval_operand(operand, layout);
      if (val_o.$ === "Err") return val_o;
      const val = this.read_immediate(val_o._0);
      if (val.$ === "Err") return val;
      const result = this.unary_op(un_op, val._0);
      if (result.$ === "Err") return result;
      if (!layout_eq(result._0.layout, dest.layout)) {
        panic(
          `assertion \`left == right\` failed: layout mismatch for result of ${un_op}\n  left: ${debug_TyAndLayout_Ty(result._0.layout, PLAIN)}\n right: ${debug_TyAndLayout_Ty(dest.layout, PLAIN)}`,
        );
      }
      const r = this.write_immediate(result._0.imm, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Aggregate": {
      const r = this.write_aggregate(rvalue._0, rvalue._1, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Repeat": {
      const r = this.write_repeat(rvalue._0, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Ref": {
      const borrow_kind = rvalue._1;
      const place = rvalue._2;
      // `x = &*ptr` does not need a validity check on `ptr` because we will already
      // check `x` below.
      const src = this.eval_place(place, /* skip_validity_for_simple_deref */ true);
      if (src.$ === "Err") return src;
      const place_ = this.force_allocation(src._0);
      if (place_.$ === "Err") return place_;
      let val = ImmTy.from_immediate(place_._0.to_ref(this), dest.layout);
      // A fresh reference was created, make sure it gets retagged with the right mode.
      const mode = BorrowKind.is_two_phase_borrow(borrow_kind) ? RetagMode.TwoPhase : RetagMode.Default;
      const r = this.machine.with_retag_mode(this, mode, (ecx) => {
        // If validation is disabled, we still want to do this retag. This is because
        // const-eval disables validation for performance reasons but wants to retag
        // shared references. So we add a bit of a hack here to do the retag manually
        // if the write would not incur validation.
        if (!ecx.machine.enforce_validity(ecx, val.layout)) {
          const new_val = ecx.machine.retag_ptr_value(ecx, val, val.layout.ty);
          if (new_val.$ === "Err") return new_val;
          if (new_val._0 !== undefined) {
            val = new_val._0;
          }
        }
        // Now do the actual write.
        return ecx.write_immediate(val.imm, dest);
      });
      if (r.$ === "Err") return r;
      break;
    }

    case "Reborrow": {
      const mutability = rvalue._1;
      const place = rvalue._2;
      const op = this.eval_place_to_op(place, undefined);
      if (op.$ === "Err") return op;
      if (Mutability.is_not(mutability)) {
        // Shared generic reborrows use `CoerceShared`: a bitwise copy into a
        // distinct same-layout target ADT.
        const r = this.copy_op_allow_transmute(op._0, dest);
        if (r.$ === "Err") return r;
      } else {
        const r = this.copy_op(op._0, dest);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "RawPtr": {
      const kind = rvalue._0;
      const place = rvalue._1;
      // Figure out whether this is an addr_of of an already raw place.
      let place_base_raw: boolean;
      if (place.is_indirect_first_projection()) {
        const ty = unwrap(this.frame().body.local_decls[place.local]).ty;
        place_base_raw = ty.is_raw_ptr();
      } else {
        // Not a deref, and thus not raw.
        place_base_raw = false;
      }

      const src = this.eval_place(place, /* skip_validity_for_simple_deref */ false);
      if (src.$ === "Err") return src;
      const place_ = this.force_allocation(src._0);
      if (place_.$ === "Err") return place_;
      let val = ImmTy.from_immediate(place_._0.to_ref(this), dest.layout);
      if (!place_base_raw && !RawPtrKind.is_fake(kind)) {
        // If this was not already raw, it needs retagging -- except for "fake"
        // raw borrows whose defining property is that they do not get retagged.
        const val_r = this.machine.with_retag_mode(this, RetagMode.Raw, (ecx) => {
          const r = ecx.machine.retag_ptr_value(ecx, val, val.layout.ty);
          if (r.$ === "Err") return r;
          return interp_ok(r._0 !== undefined ? r._0 : val);
        });
        if (val_r.$ === "Err") return val_r;
        val = val_r._0;
      }
      // This writes a raw pointer so it will not do any retags.
      const r = this.write_immediate(val.imm, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Cast": {
      const cast_kind = rvalue._0;
      const operand = rvalue._1;
      const src = this.eval_operand(operand, undefined);
      if (src.$ === "Err") return src;
      const cast_ty = this.instantiate_from_current_frame_and_normalize_erasing_regions(rvalue._2, fold_Ty);
      if (cast_ty.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(cast_ty._0));
      const r = this.cast(src._0, cast_kind, cast_ty._0, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "Discriminant": {
      const place = rvalue._0;
      const op = this.eval_place_to_op(place, undefined);
      if (op.$ === "Err") return op;
      const variant = this.read_discriminant(op._0);
      if (variant.$ === "Err") return variant;
      const discr = this.discriminant_for_variant(op._0.layout.ty, variant._0);
      if (discr.$ === "Err") return discr;
      const r = this.write_immediate(discr._0.imm, dest);
      if (r.$ === "Err") return r;
      break;
    }

    case "WrapUnsafeBinder": {
      // Constructing an unsafe binder acts like a transmute
      // since the operand's layout does not change.
      const op = this.eval_operand(rvalue._0, undefined);
      if (op.$ === "Err") return op;
      const r = this.copy_op_allow_transmute(op._0, dest);
      if (r.$ === "Err") return r;
      break;
    }
  }

  // trace!("{:?}", self.dump_place(&dest));

  return interp_ok(undefined);
};

/// Writes the aggregate to the destination.
// #[instrument(skip(self), level = "trace")]
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:306 write_aggregate
InterpCx.prototype.write_aggregate = function (this: InterpCx, kind: AggregateKind, operands: readonly mir_Operand[], dest: PlaceTy): InterpResult {
  let variant_index: VariantIdx;
  let variant_dest: PlaceTy;
  let active_field_index: FieldIdx | undefined;
  switch (kind.$) {
    case "Adt": {
      variant_index = kind._1;
      const r = this.project_downcast(dest, variant_index);
      if (r.$ === "Err") return r;
      variant_dest = r._0;
      active_field_index = kind._4;
      break;
    }
    case "RawPtr": {
      // Pointers don't have "fields" in the normal sense, so the
      // projection-based code below would either fail in projection
      // or in type mismatches. Instead, build an `Immediate` from
      // the parts and write that to the destination.
      if (operands.length !== 2) {
        return bug(`${debug_AggregateKind(kind, PLAIN)} should have 2 operands, had ${debug_vec(operands, PLAIN, debug_Operand)}`);
      }
      const data_op = operands[0]!;
      const meta_op = operands[1]!;
      const data_o = this.eval_operand(data_op, undefined);
      if (data_o.$ === "Err") return data_o;
      const data = this.read_pointer(data_o._0);
      if (data.$ === "Err") return data;
      const meta_o = this.eval_operand(meta_op, undefined);
      if (meta_o.$ === "Err") return meta_o;
      let meta: MemPlaceMeta;
      if (meta_o._0.layout.is_zst()) {
        meta = MemPlaceMeta.None;
      } else {
        const s = this.read_scalar(meta_o._0);
        if (s.$ === "Err") return s;
        meta = { $: "Meta", _0: s._0 };
      }
      const ptr_imm = Immediate.new_pointer_with_meta(data._0, meta, this);
      const ptr = ImmTy.from_immediate(ptr_imm, dest.layout);
      const r = this.copy_op(ptr, dest);
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }
    default:
      variant_index = FIRST_VARIANT;
      variant_dest = dest;
      active_field_index = undefined;
      break;
  }
  if (active_field_index !== undefined) {
    assert_eq(operands.length, 1, (v) => `${v}`);
  }
  for (let i = 0; i < operands.length; i++) {
    const operand = operands[i]!;
    const field_index = active_field_index !== undefined ? active_field_index : FieldIdx.from_usize(i);
    const field_dest = this.project_field(variant_dest, field_index);
    if (field_dest.$ === "Err") return field_dest;
    const op = this.eval_operand(operand, field_dest._0.layout);
    if (op.$ === "Err") return op;
    // We validate manually below so we don't have to do it here.
    const r = this.copy_op_no_validate(op._0, field_dest._0, /*allow_transmute*/ false);
    if (r.$ === "Err") return r;
  }
  const r = this.write_discriminant(variant_index, dest);
  if (r.$ === "Err") return r;
  // Validate that the entire thing is valid, and reset padding that might be in between the
  // fields.
  if (this.machine.enforce_validity(this, dest.layout_())) {
    const r = this.validate_place(dest, this.machine.enforce_validity_recursively(this, dest.layout_()), /*reset_provenance_and_padding*/ true);
    if (r.$ === "Err") return r;
  }
  return interp_ok(undefined);
};

/// Repeats `operand` into the destination. `dest` must have array type, and that type
/// determines how often `operand` is repeated.
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:365 write_repeat
InterpCx.prototype.write_repeat = function (this: InterpCx, operand: mir_Operand, dest: PlaceTy): InterpResult {
  const src_r = this.eval_operand(operand, undefined);
  if (src_r.$ === "Err") return src_r;
  const src = src_r._0;
  assert(src.layout.is_sized(), "assertion failed: src.layout.is_sized()");
  const dest_r = this.force_allocation(dest);
  if (dest_r.$ === "Err") return dest_r;
  const dest_ = dest_r._0;
  const length_r = dest_.len(this);
  if (length_r.$ === "Err") return length_r;
  const length = length_r._0;

  if (length === 0n) {
    // Nothing to copy... but let's still make sure that `dest` as a place is valid.
    const r = this.get_place_alloc_mut(dest_);
    if (r.$ === "Err") return r;
  } else {
    // Write the src to the first element.
    const first_r = this.project_index(dest_, 0n);
    if (first_r.$ === "Err") return first_r;
    const first = first_r._0;
    const r = this.copy_op(src, first);
    if (r.$ === "Err") return r;

    // This is performance-sensitive code for big static/const arrays! So we
    // avoid writing each operand individually and instead just make many copies
    // of the first element.
    const elem_size = first.layout.size;
    const first_ptr = first.ptr();
    const rest_ptr = first_ptr.wrapping_offset(elem_size, this);
    // No alignment requirement since `copy_op` above already checked it.
    const r2 = this.mem_copy_repeatedly(first_ptr, rest_ptr, elem_size, length - 1n, /*nonoverlapping:*/ true);
    if (r2.$ === "Err") return r2;
  }

  return interp_ok(undefined);
};

/// Evaluate the arguments of a function call
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:403 eval_fn_call_argument
InterpCx.prototype.eval_fn_call_argument = function (this: InterpCx, op: mir_Operand, move_definitely_disjoint: boolean): InterpResult<FnArg> {
  switch (op.$) {
    case "Copy":
    case "Constant":
    case "RuntimeChecks": {
      // Make a regular copy.
      const op_ = this.eval_operand(op, undefined);
      if (op_.$ === "Err") return op_;
      return interp_ok<FnArg>({ $: "Copy", _0: op_._0 });
    }
    case "Move": {
      const place_ = op._0;
      // We will read from this place, which checks everything there is to check,
      // so we can skip the extra validity check here.
      const place = this.eval_place(place_, /* skip_validity_for_simple_deref */ true);
      if (place.$ === "Err") return place;
      if (move_definitely_disjoint) {
        // We still have to ensure that no *other* pointers are used to access this place,
        // so *if* it is in memory then we have to treat it as `InPlace`.
        // Use `place_to_op` to guarantee that we notice it being in memory.
        const op_ = this.place_to_op(place._0);
        if (op_.$ === "Err") return op_;
        const e = op_._0.as_mplace_or_imm();
        switch (e.$) {
          case "Left":
            return interp_ok<FnArg>({ $: "InPlace", _0: e._0 });
          case "Right":
            return interp_ok<FnArg>({ $: "Copy", _0: op_._0 });
        }
      } else {
        // We have to force this into memory to detect aliasing among `Move` arguments.
        const mplace = this.force_allocation(place._0);
        if (mplace.$ === "Err") return mplace;
        return interp_ok<FnArg>({ $: "InPlace", _0: mplace._0 });
      }
    }
  }
};

/// Shared part of `Call` and `TailCall` implementation — finding and evaluating all the
/// necessary information about callee and arguments to make a call.
// rustc: compiler/rustc_const_eval/src/interpret/step.rs:438 eval_callee_and_args
InterpCx.prototype.eval_callee_and_args = function (
  this: InterpCx,
  terminator: Terminator,
  func_op: mir_Operand,
  args_ops: readonly Spanned<mir_Operand>[],
  dest: mir_Place,
): InterpResult<EvaluatedCalleeAndArgs<Machine>> {
  const func_r = this.eval_operand(func_op, undefined);
  if (func_r.$ === "Err") return func_r;
  const func: OpTy = func_r._0;

  // Evaluating function call arguments. The tricky part here is dealing with `Move`
  // arguments: we have to ensure no two such arguments alias. This would be most easily done
  // by just forcing them all into memory and then doing the usual in-place argument
  // protection, but then we'd force *a lot* of arguments into memory. So we do some syntactic
  // pre-processing here where if all `move` arguments are syntactically distinct local
  // variables (and none is indirect), we can skip the in-memory forcing.
  // We have to include `dest` in that list so that we can detect aliasing of an in-place
  // argument with the return place.
  let move_definitely_disjoint: boolean;
  move_definitely_disjoint: {
    const previous_locals = new Set<Local>();
    const places: mir_Place[] = [];
    for (const a of args_ops) {
      // We only have to care about `Move` arguments.
      if (a.node.$ === "Move") places.push(a.node._0);
    }
    places.push(dest);
    for (const place of places) {
      if (place.is_indirect_first_projection()) {
        // An indirect in-place argument could alias with anything else...
        move_definitely_disjoint = false;
        break move_definitely_disjoint;
      }
      if (previous_locals.has(place.local)) {
        // This local is the base for two arguments! They might overlap.
        move_definitely_disjoint = false;
        break move_definitely_disjoint;
      }
      previous_locals.add(place.local);
    }
    // We found no violation so they are all definitely disjoint.
    move_definitely_disjoint = true;
  }
  const args: FnArg[] = [];
  for (const arg of args_ops) {
    const r = this.eval_fn_call_argument(arg.node, move_definitely_disjoint);
    if (r.$ === "Err") return r;
    args.push(r._0);
  }

  // let _trace = enter_trace_span!(M, "fn_sig", ty = ?func.layout.ty.kind());
  const fn_sig_binder = func.layout.ty.fn_sig(this.tcx.deref());
  const fn_sig = this.tcx.deref().normalize_erasing_late_bound_regions(this.typing_env, fn_sig_binder, fold_FnSig);
  const n_inputs = FnSig.inputs(fn_sig).length;
  if (n_inputs > args.length) panic(`range start index ${n_inputs} out of range for slice of length ${args.length}`);
  const extra_args_ = args.slice(n_inputs);
  const extra_args = this.tcx.deref().mk_type_list_from_iter(extra_args_.map((arg) => FnArg.layout(arg).ty));

  let callee: FnVal<never>;
  let fn_abi: FnAbi<Ty> | undefined;
  let with_caller_location: boolean;
  const kind = func.layout.ty.kind();
  switch (kind.$) {
    case "FnPtr": {
      const fn_ptr = this.read_pointer(func);
      if (fn_ptr.$ === "Err") return fn_ptr;
      const fn_val = this.get_ptr_fn(fn_ptr._0);
      if (fn_val.$ === "Err") return fn_val;
      const abi = this.fn_abi_of_fn_ptr(fn_sig_binder, extra_args);
      if (abi.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(abi._0));
      callee = fn_val._0;
      fn_abi = abi._0;
      with_caller_location = false;
      break;
    }
    case "FnDef": {
      const def_id = kind._0;
      const instance_r = this.resolve(def_id, unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs)));
      if (instance_r.$ === "Err") return instance_r;
      const instance = instance_r._0;
      // Don't compute FnAbi for LLVM intrinsics. Trying to do that would panic.
      // Rust intrinsics however *do* need a FnAbi as we may invoke the
      // fallback body like a regular function.
      const has_fn_abi = !(instance.def.$ === "LlvmIntrinsic");
      callee = { $: "Instance", _0: instance };
      if (has_fn_abi) {
        const abi = this.fn_abi_of_instance_no_deduced_attrs(instance, extra_args);
        if (abi.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(abi._0));
        fn_abi = abi._0;
      } else {
        fn_abi = undefined;
      }
      with_caller_location = InstanceKind.requires_caller_location(instance.def, this.tcx.deref());
      break;
    }
    default:
      return span_bug(terminator.source_info.span, `invalid callee of type ${func.layout.ty.toString()}`);
  }

  return interp_ok({ callee, args, fn_sig, fn_abi, with_caller_location });
};

// rustc: compiler/rustc_const_eval/src/interpret/step.rs:519 eval_terminator
InterpCx.prototype.eval_terminator = function (this: InterpCx, terminator: Terminator): InterpResult {
  // let _trace = enter_trace_span!(
  //     M,
  //     step::eval_terminator,
  //     terminator = ?terminator.kind,
  //     span = ?terminator.source_info.span,
  //     tracing_separate_thread = Empty,
  // )
  // .or_if_tracing_disabled(|| info!("{:?}", terminator.kind));

  // use rustc_middle::mir::TerminatorKind::*;
  const kind = terminator.kind;
  switch (kind.$) {
    case "Return": {
      const r = this.return_from_current_stack_frame(/* unwinding */ false);
      if (r.$ === "Err") return r;
      break;
    }

    case "Goto":
      this.go_to_block(kind.target);
      break;

    case "SwitchInt": {
      const discr_o = this.eval_operand(kind.discr, undefined);
      if (discr_o.$ === "Err") return discr_o;
      const discr_r = this.read_immediate(discr_o._0);
      if (discr_r.$ === "Err") return discr_r;
      const discr = discr_r._0;
      // trace!("SwitchInt({:?})", *discr);

      // Branch to the `otherwise` case by default, if no match is found.
      let target_block = kind.targets.otherwise();

      for (const [const_int, target] of kind.targets.iter()) {
        // Compare using MIR BinOp::Eq, to also support pointer values.
        // (Avoiding `self.binary_op` as that does some redundant layout computation.)
        const res = this.binary_op("Eq", discr, ImmTy.from_uint(const_int, discr.layout));
        if (res.$ === "Err") return res;
        const b = Scalar.to_bool(Immediate.to_scalar(res._0.imm));
        if (b.$ === "Err") return b;
        if (b._0) {
          target_block = target;
          break;
        }
      }

      this.go_to_block(target_block);
      break;
    }

    case "Call": {
      const { func, args: args_ops, destination, target, unwind } = kind;
      const old_stack = this.frame_idx();
      const old_loc = this.frame().loc;

      // Evaluation order consistent with assignment: destination first.
      const dest_place = this.eval_place(destination, /* skip_validity_for_simple_deref */ false);
      if (dest_place.$ === "Err") return dest_place;
      const r = this.eval_callee_and_args(terminator, func, args_ops, destination);
      if (r.$ === "Err") return r;
      const { callee, args, fn_sig, fn_abi, with_caller_location } = r._0;

      const r2 = this.init_fn_call(
        callee,
        [FnSig.abi(fn_sig), fn_abi],
        args,
        with_caller_location,
        dest_place._0,
        target,
        fn_abi !== undefined && fn_abi_(fn_abi).can_unwind ? unwind : UnwindAction.Unreachable,
      );
      if (r2.$ === "Err") return r2;

      // Sanity-check that `eval_fn_call` either pushed a new frame or
      // did a jump to another block. We disable the sanity check for functions that
      // can't return, since Miri sometimes does have to keep the location the same
      // for those (which is fine since execution will continue on a different thread).
      if (target !== undefined && this.frame_idx() === old_stack && loc_eq(this.frame().loc, old_loc)) {
        return span_bug(terminator.source_info.span, "evaluating this call made no progress");
      }
      break;
    }

    case "TailCall": {
      const { func, args: args_ops } = kind;
      const old_frame_idx = this.frame_idx();

      const r = this.eval_callee_and_args(terminator, func, args_ops, mir_Place.return_place());
      if (r.$ === "Err") return r;
      const { callee, args, fn_sig, fn_abi, with_caller_location } = r._0;

      const r2 = this.init_fn_tail_call(callee, [FnSig.abi(fn_sig), fn_abi], args, with_caller_location);
      if (r2.$ === "Err") return r2;

      if (this.frame_idx() !== old_frame_idx) {
        return span_bug(terminator.source_info.span, "evaluating this tail call pushed a new stack frame");
      }
      break;
    }

    case "Drop": {
      const { target, unwind, drop } = kind;
      assert(drop === undefined, "Async Drop must be expanded or reset to sync in runtime MIR");
      const place = this.eval_place(kind.place, /* skip_validity_for_simple_deref */ false);
      if (place.$ === "Err") return place;
      // let _trace = enter_trace_span!(M, resolve::resolve_drop_glue, ty = ?place.layout.ty);
      const instance = Instance.resolve_drop_glue(this.tcx.deref(), place._0.layout.ty);
      if (instance.def.$ === "Shim" && instance.def._0.$ === "DropGlue" && instance.def._0._1 === undefined) {
        // This is the branch we enter if and only if the dropped type has no drop glue
        // whatsoever. This can happen as a result of monomorphizing a drop of a
        // generic. In order to make sure that generic and non-generic code behaves
        // roughly the same (and in keeping with Mir semantics) we do nothing here.
        this.go_to_block(target);
        return interp_ok(undefined);
      }
      // trace!("TerminatorKind::drop: {:?}, type {}", place, place.layout.ty);
      const r = this.init_drop_in_place_call(place._0, instance, target, unwind);
      if (r.$ === "Err") return r;
      break;
    }

    case "Assert": {
      const { cond, expected, msg, target, unwind } = kind;
      const ignored = this.machine.ignore_optional_overflow_checks(this) && AssertKind.is_optional_overflow_check(msg);
      const cond_o = this.eval_operand(cond, undefined);
      if (cond_o.$ === "Err") return cond_o;
      const cond_s = this.read_scalar(cond_o._0);
      if (cond_s.$ === "Err") return cond_s;
      const cond_val = Scalar.to_bool(cond_s._0);
      if (cond_val.$ === "Err") return cond_val;
      if (ignored || expected === cond_val._0) {
        this.go_to_block(target);
      } else {
        const r = this.machine.assert_panic(this, msg, unwind);
        if (r.$ === "Err") return r;
      }
      break;
    }

    case "UnwindTerminate": {
      const r = this.machine.unwind_terminate(this, kind._0);
      if (r.$ === "Err") return r;
      break;
    }

    // When we encounter Resume, we've finished unwinding
    // cleanup for the current stack frame. We pop it in order
    // to continue unwinding the next frame
    case "UnwindResume": {
      // trace!("unwinding: resuming from cleanup");
      // By definition, a Resume terminator means
      // that we're unwinding
      const r = this.return_from_current_stack_frame(/* unwinding */ true);
      if (r.$ === "Err") return r;
      return interp_ok(undefined);
    }

    // It is UB to ever encounter this.
    case "Unreachable":
      // throw_ub!(Unreachable)
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Unreachable" } }));

    // These should never occur for MIR we actually run.
    case "FalseEdge":
    case "FalseUnwind":
    case "Yield":
    case "CoroutineDrop":
      return span_bug(
        terminator.source_info.span,
        `${format_debug(kind, debug_TerminatorKind, PRETTY)} should have been eliminated by MIR pass`,
      );

    case "InlineAsm":
      // throw_unsup_format!("inline assembly is not supported")
      return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: "inline assembly is not supported" } }));
  }

  return interp_ok(undefined);
};
