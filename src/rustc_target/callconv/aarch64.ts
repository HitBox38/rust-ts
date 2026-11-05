// Port of compiler/rustc_target/src/callconv/aarch64.rs (lane abi-vtable, plan-m7 O7).
//
// PORT: `size.bits()` where upstream compares against 128 or the pointer width is the exact `size.bytes_u64() * 8n`
// (`bits_u64` below): `Size::bits` returns a `number` and stops beyond 2^53, while a by-value aggregate can reach
// `obj_size_bound` (tests/ui/abi/too-big-byval-abi-issue-148853.rs), and upstream takes `make_indirect` there. `u64`
// has no overflow to keep: `Size` values here stay below `obj_size_bound` (2^61 bytes).

import { type BackendRepr, Float, type HasDataLayout, type Primitive, Scalar, type Size, Size_cmp } from "../../rustc_abi/lib.ts";
import { Reg, RegKind } from "../../rustc_abi/callconv/reg.ts";
import { HomogeneousAggregate } from "../../rustc_abi/callconv.ts";
import { unreachable, unwrap } from "../../std/panic.ts";
import type { HasTargetSpec, Target } from "../spec/mod.ts";
import { type ArgAbi, type FnAbi, Uniform } from "./mod.ts";

/// Indicates the variant of the AArch64 ABI we are compiling for.
/// Used to accommodate Apple and Microsoft's deviations from the usual AAPCS ABI.
///
/// Corresponds to Clang's `AArch64ABIInfo::ABIKind`.
// #[derive(Copy, Clone, Debug, PartialEq)]
export type AbiKind = "AAPCS" | "DarwinPCS" | "Win64";
export const AbiKind = { AAPCS: "AAPCS", DarwinPCS: "DarwinPCS", Win64: "Win64" } as const;

function bits_u64(size: Size): bigint {
  return size.bytes_u64() * 8n;
}

// #[tracing::instrument(skip(cx), level = "debug")]
// rustc: compiler/rustc_target/src/callconv/aarch64.rs:20 is_homogeneous_aggregate
function is_homogeneous_aggregate<Ty>(cx: HasDataLayout & HasTargetSpec, arg: ArgAbi<Ty>): Uniform | undefined {
  // arg.layout.homogeneous_aggregate(cx).ok().and_then(|ha| ha.unit()).and_then(|unit| { .. })
  const ha = arg.layout.homogeneous_aggregate(cx);
  if (ha.$ === "Err") return undefined;
  const unit = HomogeneousAggregate.unit(ha._0);
  if (unit === undefined) return undefined;

  const size = arg.layout.size;

  // Ensure we have at most four uniquely addressable members.
  if (Size_cmp(size, unwrap(unit.size.checked_mul(4, cx))) > 0) {
    return undefined;
  }

  let valid_unit: boolean;
  switch (unit.kind.$) {
    case "Integer":
      valid_unit = false;
      break;
    case "PpcF128":
      return unreachable("internal error: entered unreachable code");
    // The softfloat ABI treats floats like integers, so they
    // do not get homogeneous aggregate treatment.
    case "Float":
      valid_unit = cx.target_spec().rustc_abi !== "Softfloat";
      break;
    case "Vector":
      valid_unit = unit.size.bits() === 64 || unit.size.bits() === 128;
      break;
  }

  return valid_unit ? Uniform.consecutive(unit, size) : undefined;
}

// rustc: compiler/rustc_target/src/callconv/aarch64.rs:46 softfloat_float_abi
function softfloat_float_abi<Ty>(target: Target, arg: ArgAbi<Ty>): void {
  if (target.rustc_abi !== "Softfloat") {
    return;
  }
  // Do *not* use the float registers for passing arguments, as that would make LLVM pick the ABI
  // and its choice depends on whether `neon` instructions are enabled. Instead, we follow the
  // AAPCS "softfloat" ABI, which specifies that floats should be passed as equivalently-sized
  // integers. Nominally this only exists for "R" profile chips, but sometimes people don't want
  // to use hardfloats even if the hardware supports them, so we do this for all softfloat
  // targets.
  const repr: BackendRepr = arg.layout.backend_repr;
  if (repr.$ === "Scalar" && Scalar.primitive(repr._0).$ === "Float") {
    const f = (Scalar.primitive(repr._0) as Extract<Primitive, { $: "Float" }>)._0;
    arg.cast_to(new Reg(RegKind.Integer, Float.size(f)));
  } else if (repr.$ === "ScalarPair" && (Scalar.primitive(repr.a).$ === "Float" || Scalar.primitive(repr.b).$ === "Float")) {
    // This case can only be reached for the Rust ABI, so we can do whatever we want here as
    // long as it does not depend on target features (i.e., as long as we do not use float
    // registers). So we pass small things in integer registers and large things via pointer
    // indirection. This means we lose the nice "pass it as two arguments" optimization, but we
    // currently just have to way to combine a `PassMode::Cast` with that optimization (and we
    // need a cast since we want to pass the float as an int).
    if (bits_u64(arg.layout.size) <= BigInt(target.pointer_width)) {
      arg.cast_to(new Reg(RegKind.Integer, arg.layout.size));
    } else {
      arg.make_indirect();
    }
  }
}

// #[tracing::instrument(skip(cx), level = "debug")]
// rustc: compiler/rustc_target/src/callconv/aarch64.rs:79 classify_ret
function classify_ret<Ty>(cx: HasDataLayout & HasTargetSpec, ret: ArgAbi<Ty>, kind: AbiKind): void {
  if (!ret.layout.is_sized() || ret.layout.is_scalable_vector()) {
    // Not touching this...
    return;
  }
  if (!ret.layout.is_aggregate()) {
    if (kind === "DarwinPCS") {
      // On Darwin, when returning an i8/i16, it must be sign-extended to 32 bits,
      // and likewise a u8/u16 must be zero-extended to 32-bits.
      // See also: <https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms#Pass-Arguments-to-Functions-Correctly>
      ret.extend_integer_width_to(32);
    }
    softfloat_float_abi(cx.target_spec(), ret);
    return;
  }
  const uniform = is_homogeneous_aggregate(cx, ret);
  if (uniform !== undefined) {
    ret.cast_to(uniform);
    return;
  }
  const size = ret.layout.size;
  const bits = bits_u64(size);
  if (bits <= 128n) {
    ret.cast_to(Uniform.new(Reg.i64(), size));
    return;
  }
  ret.make_indirect();
}

// #[tracing::instrument(skip(cx), level = "debug")]
// rustc: compiler/rustc_target/src/callconv/aarch64.rs:112 classify_arg
function classify_arg<Ty>(cx: HasDataLayout & HasTargetSpec, arg: ArgAbi<Ty>, kind: AbiKind): void {
  if (!arg.layout.is_sized() || arg.layout.is_scalable_vector()) {
    // Not touching this...
    return;
  }
  if (arg.layout.pass_indirectly_in_non_rustic_abis(cx)) {
    arg.make_indirect();
    return;
  }
  if (!arg.layout.is_aggregate()) {
    if (kind === "DarwinPCS") {
      // On Darwin, when passing an i8/i16, it must be sign-extended to 32 bits,
      // and likewise a u8/u16 must be zero-extended to 32-bits.
      // See also: <https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms#Pass-Arguments-to-Functions-Correctly>
      arg.extend_integer_width_to(32);
    }
    softfloat_float_abi(cx.target_spec(), arg);

    return;
  }
  const uniform = is_homogeneous_aggregate(cx, arg);
  if (uniform !== undefined) {
    arg.cast_to(uniform);
    return;
  }
  const size = arg.layout.size;
  let align;
  if (kind === "AAPCS") {
    // When passing small aggregates by value, the AAPCS ABI mandates using the unadjusted
    // alignment of the type (not including `repr(align)`).
    // This matches behavior of `AArch64ABIInfo::classifyArgumentType` in Clang.
    // See: <https://github.com/llvm/llvm-project/blob/5e691a1c9b0ad22689d4a434ddf4fed940e58dec/clang/lib/CodeGen/TargetInfo.cpp#L5816-L5823>
    align = arg.layout.unadjusted_abi_align;
  } else {
    align = arg.layout.align.abi;
  }
  if (bits_u64(size) <= 128n) {
    if (align.bits() === 128) {
      arg.cast_to(Uniform.new(Reg.i128(), size));
    } else {
      arg.cast_to(Uniform.new(Reg.i64(), size));
    }
    return;
  }
  arg.make_indirect();
}

// rustc: compiler/rustc_target/src/callconv/aarch64.rs:161 compute_abi_info
export function compute_abi_info<Ty>(cx: HasDataLayout & HasTargetSpec, fn_abi: FnAbi<Ty>, kind: AbiKind): void {
  if (!fn_abi.ret.is_ignore()) {
    classify_ret(cx, fn_abi.ret, kind);
  }

  // On Arm64EC the variadic portion of a c-variadic call follows the MS x64 ABI:
  // "Any argument that doesn't fit in 8 bytes, or is not 1, 2, 4, or 8 bytes, must
  // be passed by reference".
  const c_variadic = fn_abi.c_variadic;
  const fixed_count = fn_abi.fixed_count;
  const is_arm64ec = cx.target_spec().arch.$ === "Arm64EC";

  for (let idx = 0; idx < fn_abi.args.length; idx++) {
    const arg = fn_abi.args[idx]!;
    if (arg.is_ignore()) {
      continue;
    }

    if (is_arm64ec && c_variadic && idx >= fixed_count) {
      const size = arg.layout.size.bytes_u64();
      // `!size.is_power_of_two()`: false for 0, as `u64::is_power_of_two`.
      if (size > 8n || size === 0n || (size & (size - 1n)) !== 0n) {
        arg.make_indirect();
        continue;
      }
    }

    classify_arg(cx, arg, kind);
  }
}

// rustc: compiler/rustc_target/src/callconv/aarch64.rs:194 compute_rust_abi_info
export function compute_rust_abi_info<Ty>(cx: HasDataLayout & HasTargetSpec, fn_abi: FnAbi<Ty>): void {
  for (const arg of [...fn_abi.args, fn_abi.ret]) {
    softfloat_float_abi(cx.target_spec(), arg);
  }
}
