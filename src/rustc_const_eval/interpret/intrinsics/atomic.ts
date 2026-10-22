// Port of compiler/rustc_const_eval/src/interpret/intrinsics/atomic.rs (declared by lane interp-contract, ported by lane
// interp-intrinsics, plan-m4 wave 24). docs/handoff/interp-contract.md has the conventions.
import { InterpCx } from "../eval_context.ts";
import { type Machine } from "../machine.ts";
import { Immediate } from "../operand.ts";
import { type AtomicRmwOp } from "../operator.gen.ts";
import { type InterpResult, interp_ok, Scalar } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock } from "../../../rustc_middle/mir/mod.ts";
import { type AtomicOrdering } from "../../../rustc_middle/ty/consts/int.ts";
import { Value } from "../../../rustc_middle/ty/consts/valtree.ts";
import { type GenericArgsRef } from "../../../rustc_middle/ty/generic_args.ts";
import { span_bug } from "../../../rustc_span/macros.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { unreachable } from "../../../std/panic.ts";
import { OpTy } from "../operand.gen.ts";
import { PlaceTy } from "../place.gen.ts";

declare module "../eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // atomic.rs:15
    eval_atomic_intrinsic(intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean>;
  }
}

/// Returns `true` if emulation happened.
/// Here we implement the intrinsics that are common to all CTFE instances; individual machines can add their own
/// intrinsic handling.
// rustc: compiler/rustc_const_eval/src/interpret/intrinsics/atomic.rs:15 eval_atomic_intrinsic
InterpCx.prototype.eval_atomic_intrinsic = function (this: InterpCx, intrinsic_name: Symbol, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<boolean> {
  const get_ord_at = (i: number): AtomicOrdering => {
    const ordering = generic_args.const_at(i).to_value();
    return Value.to_leaf(Value.to_branch(ordering)[0]!.to_value()).to_atomic_ordering();
  };

  switch (intrinsic_name) {
    case sym.atomic_load: {
      const ord = get_ord_at(1);
      const _volatile = generic_args.const_at(2).to_value(); // makes no difference for us
      if (args.length !== 1) {
        return span_bug(this.cur_span(), "invalid `atomic_load` call");
      }
      const ptr = args[0]!;

      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const val = this.machine.atomic_load(this, place._0, ord);
      if (val.$ === "Err") return val;
      const w = this.write_scalar(val._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.atomic_store: {
      const ord = get_ord_at(1);
      const _volatile = generic_args.const_at(2).to_value(); // makes no difference for us
      if (args.length !== 2) {
        return span_bug(this.cur_span(), "invalid `atomic_store` call");
      }
      const [ptr, val_] = [args[0]!, args[1]!];

      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const val = this.read_immediate(val_);
      if (val.$ === "Err") return val;
      const s = this.machine.atomic_store(this, place._0, val._0, ord);
      if (s.$ === "Err") return s;
      break;
    }
    case sym.atomic_or:
    case sym.atomic_xor:
    case sym.atomic_and:
    case sym.atomic_nand:
    case sym.atomic_xadd:
    case sym.atomic_xsub:
    case sym.atomic_min:
    case sym.atomic_umin:
    case sym.atomic_max:
    case sym.atomic_umax:
    case sym.atomic_xchg: {
      let num_ty_generics: number;
      switch (intrinsic_name) {
        case sym.atomic_min:
        case sym.atomic_umin:
        case sym.atomic_max:
        case sym.atomic_umax:
        case sym.atomic_xchg:
          num_ty_generics = 1;
          break;
        default:
          num_ty_generics = 2;
      }
      const ord = get_ord_at(num_ty_generics);
      if (args.length !== 2) {
        return span_bug(this.cur_span(), `invalid \`${Symbol.as_str(intrinsic_name)}\` call`);
      }
      const [ptr, operand_] = [args[0]!, args[1]!];

      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const operand = this.read_immediate(operand_);
      if (operand.$ === "Err") return operand;

      let op: AtomicRmwOp;
      switch (intrinsic_name) {
        case sym.atomic_or:
          op = { $: "MirOp", op: "BitOr", neg: false };
          break;
        case sym.atomic_xor:
          op = { $: "MirOp", op: "BitXor", neg: false };
          break;
        case sym.atomic_and:
          op = { $: "MirOp", op: "BitAnd", neg: false };
          break;
        case sym.atomic_nand:
          op = { $: "MirOp", op: "BitAnd", neg: true };
          break;
        case sym.atomic_xadd:
          op = { $: "MirOp", op: "Add", neg: false };
          break;
        case sym.atomic_xsub:
          op = { $: "MirOp", op: "Sub", neg: false };
          break;
        case sym.atomic_min:
          op = { $: "Min" };
          break;
        case sym.atomic_umin:
          op = { $: "Min" };
          break;
        case sym.atomic_max:
          op = { $: "Max" };
          break;
        case sym.atomic_umax:
          op = { $: "Max" };
          break;
        case sym.atomic_xchg:
          op = { $: "Swap" };
          break;
        default:
          return unreachable();
      }

      const res = this.machine.atomic_rmw(this, place._0, op, operand._0, ord);
      if (res.$ === "Err") return res;
      const w = this.write_scalar(res._0, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.atomic_cxchg:
    case sym.atomic_cxchgweak: {
      const success_ord = get_ord_at(1);
      const failure_ord = get_ord_at(2);
      if (args.length !== 3) {
        return span_bug(this.cur_span(), `invalid \`${Symbol.as_str(intrinsic_name)}\` call`);
      }
      const [ptr, expected_old_, new_] = [args[0]!, args[1]!, args[2]!];

      const place = this.deref_pointer(ptr);
      if (place.$ === "Err") return place;
      const expected_old = this.read_immediate(expected_old_);
      if (expected_old.$ === "Err") return expected_old;
      const new_imm = this.read_immediate(new_);
      if (new_imm.$ === "Err") return new_imm;

      const r = this.machine.atomic_compare_exchange(
        this,
        place._0,
        expected_old._0,
        new_imm._0,
        /* can_fail_spuriously */ intrinsic_name === sym.atomic_cxchgweak,
        success_ord,
        failure_ord,
      );
      if (r.$ === "Err") return r;
      const [actual_old, success] = r._0;
      const res: Immediate = { $: "ScalarPair", _0: actual_old, _1: Scalar.from_bool(success) };
      const w = this.write_immediate(res, dest);
      if (w.$ === "Err") return w;
      break;
    }
    case sym.atomic_fence:
    case sym.atomic_singlethreadfence: {
      const ord = get_ord_at(0);
      if (args.length !== 0) {
        return span_bug(this.cur_span(), `invalid \`${Symbol.as_str(intrinsic_name)}\` call`);
      }

      const f = this.machine.atomic_fence(this, ord, intrinsic_name === sym.atomic_singlethreadfence);
      if (f.$ === "Err") return f;
      break;
    }

    // Unsupported intrinsic: skip the return_to_block below.
    default:
      return interp_ok(false);
  }

  // trace!("{:?}", self.dump_place(&dest));
  const r = this.return_to_block(ret);
  if (r.$ === "Err") return r;
  return interp_ok(true);
};
