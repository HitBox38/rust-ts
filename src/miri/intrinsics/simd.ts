// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/intrinsics/simd.rs (crate `miri`, plan-m6 D2).
//
// PORT: `math::sqrt_op::<IeeeFloat<S>>` / `host_unary_float_op::<S>` take the float type's `FloatType` dictionary
// (src/miri/math.ts header). `unimplemented!("f128")` is the macro's panic (an ICE, as upstream).
import { type ImmTy, type OpTy, type PlaceTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { host_unary_float_op, type HostUnaryFloatOp, sqrt_op } from "../math.ts";
import { EmulateItemResult } from "../shims/mod.ts";
import { check_intrinsic_arg_count } from "./mod.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { panic } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { Double, Half, Quad, Single } from "../../vendor/rustc_apfloat/ieee.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/simd.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/simd.rs:13
    emulate_simd_intrinsic(this: MiriInterpCx, intrinsic_name: string, args: readonly OpTy[], dest: PlaceTy): InterpResult<EmulateItemResult>;
  }
}

/// Calls the simd intrinsic `intrinsic`; the `simd_` prefix has already been removed.
/// Returns `Ok(true)` if the intrinsic was handled.
// rustc: src/tools/miri/src/intrinsics/simd.rs:13 emulate_simd_intrinsic
InterpCx.prototype.emulate_simd_intrinsic = function (
  this: MiriInterpCx,
  intrinsic_name: string,
  args: readonly OpTy[],
  dest_: PlaceTy,
): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();
  switch (intrinsic_name) {
    // Operations we can do with soft-floats.
    case "fsqrt": {
      const c = check_intrinsic_arg_count(args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];
      const op_s = this_.project_to_simd(op_ as never);
      if (op_s.$ === "Err") return op_s;
      const [op_v, op_len] = op_s._0 as unknown as [OpTy, bigint];
      const dest_s = this_.project_to_simd(dest_ as never);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0 as unknown as [PlaceTy, bigint];

      assert_eq_len(dest_len, op_len);

      for (let i = 0n; i < dest_len; i++) {
        const op_r = this_.project_index(op_v as never, i);
        if (op_r.$ === "Err") return op_r;
        const op = op_r._0 as unknown as OpTy;
        const dest_r = this_.project_index(dest_v as never, i);
        if (dest_r.$ === "Err") return dest_r;
        const dest = dest_r._0 as unknown as PlaceTy;
        const kind = op.layout.ty.kind();
        if (kind.$ !== "Float") {
          return span_bug(this_.cur_span(), `${intrinsic_name} operand is not a float`);
        }
        const float_ty = kind._0;
        let r: InterpResult;
        switch (float_ty) {
          case "F16":
            r = sqrt_op(this_, op, dest, Half);
            break;
          case "F32":
            r = sqrt_op(this_, op, dest, Single);
            break;
          case "F64":
            r = sqrt_op(this_, op, dest, Double);
            break;
          case "F128":
            r = sqrt_op(this_, op, dest, Quad);
            break;
        }
        if (r.$ === "Err") return r;
      }
      break;
    }

    // Operations that need host floats.
    case "fsin":
    case "fcos":
    case "fexp":
    case "fexp2":
    case "flog":
    case "flog2":
    case "flog10": {
      const c = check_intrinsic_arg_count(args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];
      const op_s = this_.project_to_simd(op_ as never);
      if (op_s.$ === "Err") return op_s;
      const [op_v, op_len] = op_s._0 as unknown as [OpTy, bigint];
      const dest_s = this_.project_to_simd(dest_ as never);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0 as unknown as [PlaceTy, bigint];

      assert_eq_len(dest_len, op_len);

      let host_op: HostUnaryFloatOp;
      switch (intrinsic_name) {
        case "fsin":
          host_op = "Sin";
          break;
        case "fcos":
          host_op = "Cos";
          break;
        case "fexp":
          host_op = "Exp";
          break;
        case "fexp2":
          host_op = "Exp2";
          break;
        case "flog":
          host_op = "Log";
          break;
        case "flog2":
          host_op = "Log2";
          break;
        case "flog10":
          host_op = "Log10";
          break;
        default:
          return bug("impossible case reached");
      }

      for (let i = 0n; i < dest_len; i++) {
        const op_r = this_.project_index(op_v as never, i);
        if (op_r.$ === "Err") return op_r;
        const op = op_r._0 as unknown as OpTy;
        const dest_r = this_.project_index(dest_v as never, i);
        if (dest_r.$ === "Err") return dest_r;
        const dest = dest_r._0 as unknown as PlaceTy;
        const kind = op.layout.ty.kind();
        if (kind.$ !== "Float") {
          return span_bug(this_.cur_span(), `${intrinsic_name} operand is not a float`);
        }
        const float_ty = kind._0;
        // Using host floats except for sqrt (but it's fine, these operations do not
        // have guaranteed precision).
        let r: InterpResult;
        switch (float_ty) {
          case "F16":
            r = host_unary_float_op(this_, op, host_op, dest, Half);
            break;
          case "F32":
            r = host_unary_float_op(this_, op, host_op, dest, Single);
            break;
          case "F64":
            r = host_unary_float_op(this_, op, host_op, dest, Double);
            break;
          case "F128":
            return panic("not implemented: f128"); // FIXME(f128)
        }
        if (r.$ === "Err") return r;
      }
      break;
    }
    case "expose_provenance": {
      const c = check_intrinsic_arg_count(args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];
      const op_s = this_.project_to_simd(op_ as never);
      if (op_s.$ === "Err") return op_s;
      const [op_v, op_len] = op_s._0 as unknown as [OpTy, bigint];
      const dest_s = this_.project_to_simd(dest_ as never);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_v, dest_len] = dest_s._0 as unknown as [PlaceTy, bigint];

      assert_eq_len(dest_len, op_len);

      for (let i = 0n; i < dest_len; i++) {
        const op_r = this_.project_index(op_v as never, i);
        if (op_r.$ === "Err") return op_r;
        const op_i = this_.read_immediate(op_r._0 as never);
        if (op_i.$ === "Err") return op_i;
        const op = op_i._0 as unknown as ImmTy;
        const dest_r = this_.project_index(dest_v as never, i);
        if (dest_r.$ === "Err") return dest_r;
        const dest = dest_r._0 as unknown as PlaceTy;

        const from = op.layout.ty.kind();
        const to = dest.layout.ty.kind();
        let val: ImmTy;
        // Ptr/Int casts
        if (from.$ === "RawPtr" && (to.$ === "Int" || to.$ === "Uint")) {
          const v = this_.pointer_expose_provenance_cast(op as never, dest.layout);
          if (v.$ === "Err") return v;
          val = v._0 as unknown as ImmTy;
        }
        // Error otherwise
        else {
          return throw_unsup_format(
            `Unsupported \`simd_expose_provenance\` from element type ${display_Ty(op.layout.ty)} to ${display_Ty(dest.layout.ty)}`,
          );
        }
        const w = this_.write_immediate(val.imm as never, dest as never);
        if (w.$ === "Err") return w;
      }
      break;
    }

    default:
      return interp_ok(EmulateItemResult.NotSupported);
  }
  return interp_ok(EmulateItemResult.NeedsReturn);
};

/** `assert_eq!(dest_len, op_len)` (a failure is a panic, an ICE, as upstream). */
function assert_eq_len(left: bigint, right: bigint): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
  }
}

