// Fill lane: `miri-shims-d` (plan-m6 wave 37): ported by this lane.
// Port of src/tools/miri/src/intrinsics/mod.rs (crate `miri`, plan-m6 D2).
//
// PORT:
// - `trait EvalContextExt` (impl for `MiriInterpCx`) is a `declare module` augmentation of `InterpCx` (decision C2).
// - `check_intrinsic_arg_count::<N>(args)` takes `N` as a parameter and returns the slice (`&[OpTy; N]`).
// - `mod aarch64` / `mod loongarch` are not ported (D12: unreachable on x86_64-unknown-linux-gnu): their dispatch arms stop
//   `unported`. `mod x86` is a later wave (D12, wave 38): its arm calls `emulate_x86_intrinsic`, the wave-38 placeholder
//   of intrinsics/x86/mod.ts (root decision on the shims-d review L1), which stops `unported` until ported.
// - `EmulateItemResult::jump_to_next_block` is shims/mod.ts's companion fn (`T::default()` is `undefined`).
// - `trace!(..)` stays a comment (docs/handoff/miri-log.md: Miri's `trace!` is compiled out of the release oracle).
import { type ImmTy, type MPlaceTy, type OpTy, type PlaceTy, type Pointer as MiriPointer, type Scalar } from "../lib.ts";
import { type MiriInterpCx, type Provenance } from "../machine.ts";
import { imm_to_scalar } from "../operator.ts";
import { throw_machine_stop } from "../helpers.ts";
import { EmulateItemResult } from "../shims/mod.ts";
import { Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { PlaceTy_from_MPlaceTy } from "../../rustc_const_eval/interpret/place.ts";
import { type CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { Pointer } from "../../rustc_middle/mir/interpret/pointer.ts";
import {
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar as interp_Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { type BasicBlock, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type GenericArgsRef } from "../../rustc_middle/ty/generic_args.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { Arch } from "../../rustc_target/spec/mod.ts";
import { panic, unported } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { StandardUniform_bool } from "../../vendor/rand/distr/other.ts";
import { RngExt } from "../../vendor/rand/rng.ts";

/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`). */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`). */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}

/** `u128::count_ones`. */
function u128_count_ones(v: bigint): number {
  let n = 0;
  while (v !== 0n) {
    v &= v - 1n;
    n++;
  }
  return n;
}

/// Check that the number of args is what we expect.
// rustc: src/tools/miri/src/intrinsics/mod.rs:21 check_intrinsic_arg_count
export function check_intrinsic_arg_count(args: readonly OpTy[], N: number): InterpResult<readonly OpTy[]> {
  if (args.length === N) {
    return interp_ok(args);
  }
  return throw_ub_format(`incorrect number of arguments for intrinsic: got ${args.length}, expected ${N}`);
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- intrinsics/mod.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // intrinsics/mod.rs:39
    call_intrinsic(this: MiriInterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult<Instance | undefined>;
    // intrinsics/mod.rs:82
    emulate_intrinsic_by_name(this: MiriInterpCx, intrinsic_name: string, generic_args: GenericArgsRef, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult<EmulateItemResult>;
    // intrinsics/mod.rs:154
    call_llvm_intrinsic(this: MiriInterpCx, instance: Instance, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined): InterpResult;
  }
}

// rustc: src/tools/miri/src/intrinsics/mod.rs:39 call_intrinsic
InterpCx.prototype.call_intrinsic = function (
  this: MiriInterpCx,
  instance: Instance,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult<Instance | undefined> {
  const this_ = this.eval_context_mut();

  // See if the core engine can handle this intrinsic.
  const handled = this_.eval_intrinsic(instance, args as never, dest as never, ret);
  if (handled.$ === "Err") return handled;
  if (handled._0) {
    return interp_ok(undefined);
  }
  const intrinsic_name_sym = this_.tcx.deref().item_name(Instance.def_id(instance));
  const intrinsic_name = Symbol.as_str(intrinsic_name_sym);

  const res = this_.emulate_intrinsic_by_name(intrinsic_name, instance.args, args, dest, ret);
  if (res.$ === "Err") return res;
  return EmulateItemResult.jump_to_next_block<Instance>(res._0, this_, dest, ret, unwind, (this_) => {
    // We haven't handled the intrinsic, let's see if we can use a fallback body.
    const intrinsic = this_.tcx.deref().intrinsic(Instance.def_id(instance));
    if (intrinsic === undefined) return panic("called `Option::unwrap()` on a `None` value");
    if (intrinsic.must_be_overridden) {
      return throw_unsup_format(`unimplemented intrinsic: \`${intrinsic_name}\``);
    }
    const intrinsic_fallback_is_spec = Symbol.intern("intrinsic_fallback_is_spec");
    const attrs = this_.tcx.deref().get_attrs_by_path(Instance.def_id(instance), [sym.miri, intrinsic_fallback_is_spec]);
    if (attrs[globalThis.Symbol.iterator]().next().done === true) {
      return throw_unsup_format(
        `Miri can only use intrinsic fallback bodies that exactly reflect the specification: they fully check for UB and are as non-deterministic as possible. After verifying that \`${intrinsic_name}\` does so, add the \`#[miri::intrinsic_fallback_is_spec]\` attribute to it; also ping @rust-lang/miri when you do that`,
      );
    }
    return interp_ok<Instance | undefined>({
      def: { $: "Item", _0: Instance.def_id(instance) },
      args: instance.args,
    });
  });
};

/// Emulates a Miri-supported intrinsic (not supported by the core engine).
/// Returns `Ok(true)` if the intrinsic was handled.
// rustc: src/tools/miri/src/intrinsics/mod.rs:82 emulate_intrinsic_by_name
InterpCx.prototype.emulate_intrinsic_by_name = function (
  this: MiriInterpCx,
  intrinsic_name: string,
  generic_args: GenericArgsRef,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();

  if (intrinsic_name.startsWith("simd_")) {
    const name = intrinsic_name.slice("simd_".length);
    return this_.emulate_simd_intrinsic(name, args, dest);
  }

  switch (intrinsic_name) {
    // Basic control flow
    case "abort_immediate": {
      // Note that `abort_immediate` is also hooked separately in CTFE.
      return throw_machine_stop({ $: "Abort", _0: "the program aborted execution" });
    }
    case "catch_unwind": {
      const c = check_intrinsic_arg_count(args, 3);
      if (c.$ === "Err") return c;
      const [try_fn, data, catch_fn] = c._0 as [OpTy, OpTy, OpTy];
      const r = this_.handle_catch_unwind(try_fn, data, catch_fn, dest, ret);
      if (r.$ === "Err") return r;
      // This pushed a stack frame, don't jump to `ret`.
      return interp_ok(EmulateItemResult.AlreadyJumped);
    }

    // Memory model / provenance manipulation
    case "ptr_mask": {
      const c = check_intrinsic_arg_count(args, 2);
      if (c.$ === "Err") return c;
      const [ptr_op, mask_op] = c._0 as [OpTy, OpTy];

      const ptr_r = this_.read_pointer(ptr_op);
      if (ptr_r.$ === "Err") return ptr_r;
      const ptr = ptr_r._0 as MiriPointer;
      const mask_r = this_.read_target_usize(mask_op);
      if (mask_r.$ === "Err") return mask_r;
      const mask = mask_r._0;

      const masked_addr = Size.from_bytes(ptr.addr(this_.machine.Provenance).bytes_u64() & mask);

      const w = this_.write_pointer(Pointer.new(ptr.provenance, masked_addr) as never, dest as never);
      if (w.$ === "Err") return w;
      break;
    }

    // We want to return either `true` or `false` at random, or else something like
    // ```
    // if !is_val_statically_known(0) { unreachable_unchecked(); }
    // ```
    // Would not be considered UB, or the other way around (`is_val_statically_known(0)`).
    case "is_val_statically_known": {
      const c = check_intrinsic_arg_count(args, 1);
      if (c.$ === "Err") return c;
      // FIXME: should we check for validity here? It's tricky because we do not have a
      // place. Codegen does not seem to set any attributes like `noundef` for intrinsic
      // calls, so we don't *have* to do anything.
      const branch: boolean = RngExt.random(this_.machine.rng, StandardUniform_bool);
      const w = this_.write_scalar(interp_Scalar.from_bool<Provenance>(branch) as never, dest as never);
      if (w.$ === "Err") return w;
      break;
    }

    // Other
    case "breakpoint": {
      const c = check_intrinsic_arg_count(args, 0);
      if (c.$ === "Err") return c;
      // normally this would raise a SIGTRAP, which aborts if no debugger is connected
      return throw_machine_stop({ $: "Abort", _0: "trace/breakpoint trap" });
    }

    case "assert_inhabited":
    case "assert_zero_valid":
    case "assert_mem_uninitialized_valid": {
      // Make these a NOP, so we get the better Miri-native error messages.
      break;
    }

    default:
      return this_.emulate_math_intrinsic(intrinsic_name, generic_args, args, dest);
  }

  return interp_ok(EmulateItemResult.NeedsReturn);
};

// rustc: src/tools/miri/src/intrinsics/mod.rs:154 call_llvm_intrinsic
InterpCx.prototype.call_llvm_intrinsic = function (
  this: MiriInterpCx,
  instance: Instance,
  args: readonly OpTy[],
  dest_: PlaceTy,
  ret: BasicBlock | undefined,
): InterpResult {
  const this_ = this.eval_context_mut();

  const attrs = this_.tcx.deref().codegen_fn_attrs(Instance.def_id(instance)) as CodegenFnAttrs;
  const link_name = attrs.symbol_name;
  if (link_name === undefined) return panic("called `Option::unwrap()` on a `None` value");

  // These are anyway mostly vector intrinsics and vectors live in memory.
  const dest_r = this_.force_allocation(dest_ as never);
  if (dest_r.$ === "Err") return dest_r;
  const dest = dest_r._0 as unknown as MPlaceTy;

  const target = this_.tcx.deref().sess.target;
  let res: EmulateItemResult;
  // 'handled: { match link_name.as_str() { .. } EmulateItemResult::NeedsReturn }
  handled: {
    const name = Symbol.as_str(link_name);
    // LLVM intrinsics
    if (name === "llvm.prefetch.p0") {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 4);
      if (c.$ === "Err") return c;
      const [p, rw_op, loc_op, ty_op] = c._0 as [OpTy, OpTy, OpTy, OpTy];

      const p_r = this_.read_pointer(p);
      if (p_r.$ === "Err") return p_r;
      const rw = read_i32(this_, rw_op);
      if (rw.$ === "Err") return rw;
      const loc = read_i32(this_, loc_op);
      if (loc.$ === "Err") return loc;
      const ty = read_i32(this_, ty_op);
      if (ty.$ === "Err") return ty;

      if (ty._0 === 1) {
        // Data cache prefetch.
        // Notably, we do not have to check the pointer, this operation is never UB!

        if (!(rw._0 === 0 || rw._0 === 1)) {
          return throw_unsup_format(`invalid \`rw\` value passed to \`llvm.prefetch\`: ${rw._0}`);
        }
        if (!(loc._0 >= 0 && loc._0 <= 3)) {
          return throw_unsup_format(`invalid \`loc\` value passed to \`llvm.prefetch\`: ${loc._0}`);
        }
      } else {
        return throw_unsup_format(`unsupported \`llvm.prefetch\` type argument: ${ty._0}`);
      }
    }
    // Used to implement the x86 `_mm{,256,512}_popcnt_epi{8,16,32,64}` and wasm
    // `{i,u}8x16_popcnt` functions.
    else if (name.startsWith("llvm.ctpop.v") && target.endian === "Little") {
      const c = this_.check_shim_sig_llvm_intrinsic(link_name, args, 1);
      if (c.$ === "Err") return c;
      const [op_] = c._0 as [OpTy];

      const op_s = this_.project_to_simd(op_ as never);
      if (op_s.$ === "Err") return op_s;
      const [op, op_len] = op_s._0 as unknown as [OpTy, bigint];
      const dest_s = this_.project_to_simd(dest as never);
      if (dest_s.$ === "Err") return dest_s;
      const [dest_simd, dest_len] = dest_s._0 as unknown as [MPlaceTy, bigint];

      assert_eq_len(dest_len, op_len);

      for (let i = 0n; i < dest_len; i++) {
        const op_i = this_.project_index(op as never, i);
        if (op_i.$ === "Err") return op_i;
        const op_imm = this_.read_immediate(op_i._0 as never);
        if (op_imm.$ === "Err") return op_imm;
        const imm = op_imm._0 as unknown as ImmTy;
        // Use `to_uint` to get a zero-extended `u128`. Those
        // extra zeros will not affect `count_ones`.
        const u = interp_Scalar.to_uint(imm_to_scalar(imm), imm.layout.size);
        if (u.$ === "Err") return u;
        const res_ = u128_count_ones(u._0);

        const d_i = this_.project_index(dest_simd as never, i);
        if (d_i.$ === "Err") return d_i;
        const w = this_.write_scalar(interp_Scalar.from_uint(BigInt(res_), imm.layout.size), d_i._0 as never);
        if (w.$ === "Err") return w;
      }
    }

    // Target-specific shims
    else if (name.startsWith("llvm.x86.") && (target.arch.$ === "X86" || target.arch.$ === "X86_64") && target.endian === "Little") {
      // PORT: `x86::EvalContextExt::emulate_x86_intrinsic` is the wave-38 placeholder (intrinsics/x86/mod.ts, lane
      // miri-x86-a; it stops `unported` until ported).
      const r = this_.emulate_x86_intrinsic(link_name, args, dest);
      if (r.$ === "Err") return r;
      res = r._0;
      break handled;
    } else if (name.startsWith("llvm.aarch64.") && target.arch.$ === "AArch64" && target.endian === "Little") {
      // break 'handled aarch64::EvalContextExt::emulate_aarch64_intrinsic(this, link_name, args, &dest)?,
      return unported("miri::intrinsics::aarch64::EvalContextExt::emulate_aarch64_intrinsic (plan-m6 D12: aarch64 intrinsics are unreachable on the target)");
    } else if (name.startsWith("llvm.loongarch.") && (target.arch.$ === "LoongArch32" || target.arch.$ === "LoongArch64") && target.endian === "Little") {
      // break 'handled loongarch::EvalContextExt::emulate_loongarch_intrinsic(this, link_name, args, &dest)?,
      return unported("miri::intrinsics::loongarch::EvalContextExt::emulate_loongarch_intrinsic (plan-m6 D12: loongarch intrinsics are unreachable on the target)");
    } else {
      res = EmulateItemResult.NotSupported;
      break handled;
    }
    res = EmulateItemResult.NeedsReturn;
  }

  // The rest either implements the logic, or falls back to `lookup_exported_symbol`.
  return EmulateItemResult.jump_to_next_block<undefined>(res, this_, PlaceTy_from_MPlaceTy(dest as never) as unknown as PlaceTy, ret, undefined, (this_) => {
    return throw_machine_stop({
      $: "UnsupportedForeignItem",
      _0: `can't call LLVM intrinsic \`${Symbol.as_str(link_name)}\` on architecture \`${Arch.display(this_.tcx.deref().sess.target.arch)}\``,
    });
  });
};

// ---------------------------------------------------------------- private glue of this module ----

/** `this.read_scalar(op)?.to_i32()?`. */
function read_i32(this_: MiriInterpCx, op: OpTy): InterpResult<number> {
  const s = this_.read_scalar(op);
  if (s.$ === "Err") return s;
  return interp_Scalar.to_i32(s._0 as Scalar);
}

/** `assert_eq!(dest_len, op_len)` (a failure is a panic, an ICE, as upstream). */
function assert_eq_len(left: bigint, right: bigint): void {
  if (left !== right) {
    panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
  }
}
