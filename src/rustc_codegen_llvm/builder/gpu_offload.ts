// compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs: out of M7 (harness/scope.json; plan-m7 D18, `-Zoffload`). Lane
// cg-contract placed here the types `FullCx` names and the fns other fill lanes call (review F2), as stubs.
import type { OperandRef } from "../../rustc_codegen_ssa/mir/operand.ts";
import { unported } from "../../std/panic.ts";
import type { Builder } from "../builder.ts";
import type { CodegenCx } from "../context.ts";
import type { Type, Value } from "../llvm/mod.ts";

/** PORT (cg-contract): `rustc_middle::ty::offload_meta::OffloadMetadata` is not ported (out of M7): never constructed. */
export type OffloadMetadata = never;

/** `pub(crate) struct OffloadGlobals<'ll>` (gpu_offload.rs:18): never constructed in M7. */
export class OffloadGlobals {
  private constructor() {}

  // Stub (cg-contract): declare (builder/gpu_offload.rs:37)
  static declare(_cx: CodegenCx): OffloadGlobals {
    return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs declare");
  }
}

/** `pub(crate) struct OffloadKernelDims<'ll>`: never constructed in M7. */
export class OffloadKernelDims {
  private constructor() {}

  // Stub (cg-contract): from_operands (builder/gpu_offload.rs:69)
  static from_operands(_builder: Builder, _workgroup_op: OperandRef<Value>, _thread_op: OperandRef<Value>): OffloadKernelDims {
    return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs from_operands");
  }
}

// Stub (cg-contract): declare_omp_get_num_devices (builder/gpu_offload.rs:129)
export function declare_omp_get_num_devices(_cx: CodegenCx): [Value, Type] {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs declare_omp_get_num_devices");
}

/** `pub(crate) struct OffloadKernelGlobals<'ll>`: never constructed in M7. */
export class OffloadKernelGlobals {
  private constructor() {}
}

// Stub (cg-contract): gen_define_handling (builder/gpu_offload.rs:359)
export function gen_define_handling(_cx: CodegenCx, _metadata: readonly OffloadMetadata[], _symbol: string, _offload_globals: OffloadGlobals): OffloadKernelGlobals {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs gen_define_handling");
}

// Stub (cg-contract): gen_call_handling (builder/gpu_offload.rs:526)
export function gen_call_handling(_builder: Builder, _offload_data: OffloadKernelGlobals, _args: readonly Value[], _types: readonly Type[], _metadata: readonly OffloadMetadata[], _offload_globals: OffloadGlobals, _offload_dims: OffloadKernelDims, _dyn_cache: Value, _device_id: Value): void {
  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/builder/gpu_offload.rs gen_call_handling");
}
