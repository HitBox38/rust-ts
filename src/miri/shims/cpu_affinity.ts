// Port of src/tools/miri/src/shims/cpu_affinity.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into cpu_affinity.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { CpuAffinityMask } from "./cpu_affinity.gen.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./cpu_affinity.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/cpu_affinity.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/cpu_affinity.rs:96
    sched_getaffinity(this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult;
    // shims/cpu_affinity.rs:151
    sched_setaffinity(this: MiriInterpCx, pid: OpTy, cpusetsize: OpTy, mask: OpTy, dest: MPlaceTy): InterpResult;
  }
}

declare module "./cpu_affinity.gen.ts" {
  interface CpuAffinityMask {
    // shims/cpu_affinity.rs:42
    set(cx: Pending<"impl LayoutOf<'tcx>">, cpu: number): void;
    // shims/cpu_affinity.rs:76
    as_slice(): Uint8Array;
  }
  namespace CpuAffinityMask {
    // shims/cpu_affinity.rs:25
    function new_(cx: Pending<"impl LayoutOf<'tcx>">, cpu_count: number): CpuAffinityMask;
    export { new_ as new };
    // shims/cpu_affinity.rs:36
    export let chunk_size: (cx: Pending<"impl LayoutOf<'tcx>">) => bigint;
    // shims/cpu_affinity.rs:80
    export let from_array: (cx: Pending<"impl LayoutOf<'tcx>">, cpu_count: number, bytes: Uint8Array) => CpuAffinityMask | undefined;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::cpu_affinity::EvalContextExt", "src/tools/miri/src/shims/cpu_affinity.rs", "miri-shims-b", () => InterpCx.prototype, ["sched_getaffinity", "sched_setaffinity"]);
stub_methods("miri::shims::cpu_affinity::CpuAffinityMask", "src/tools/miri/src/shims/cpu_affinity.rs", "miri-shims-b", () => CpuAffinityMask.prototype, ["set", "as_slice"]);
stub_statics("miri::shims::cpu_affinity::CpuAffinityMask", "src/tools/miri/src/shims/cpu_affinity.rs", "miri-shims-b", () => CpuAffinityMask, ["new", "chunk_size", "from_array"]);
