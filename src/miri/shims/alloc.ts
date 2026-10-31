// Port of src/tools/miri/src/shims/alloc.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type PlaceTy, type Pointer, type Scalar } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { type Align } from "../../rustc_abi/lib.ts";
import { type SpecialAllocatorMethod } from "../../rustc_ast/expand/allocator.gen.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type AllocInit } from "../../rustc_middle/mir/interpret/allocation.gen.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/alloc.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/alloc.rs:13
    malloc_align(this: MiriInterpCx, size: bigint): Align;
    // shims/alloc.rs:89
    check_rust_alloc_request(this: MiriInterpCx, size: bigint, align: bigint): InterpResult;
    // shims/alloc.rs:114
    rust_special_allocator_method(this: MiriInterpCx, method: SpecialAllocatorMethod, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy): InterpResult;
    // shims/alloc.rs:191
    malloc(this: MiriInterpCx, size: bigint, init: AllocInit): InterpResult<Pointer>;
    // shims/alloc.rs:199
    posix_memalign(this: MiriInterpCx, memptr: OpTy, align: OpTy, size: OpTy): InterpResult<Scalar>;
    // shims/alloc.rs:226
    free(this: MiriInterpCx, ptr: Pointer): InterpResult;
    // shims/alloc.rs:234
    realloc(this: MiriInterpCx, old_ptr: Pointer, new_size: bigint): InterpResult<Pointer>;
    // shims/alloc.rs:259
    aligned_alloc(this: MiriInterpCx, align: OpTy, size: OpTy): InterpResult<Pointer>;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::alloc::EvalContextExt", "src/tools/miri/src/shims/alloc.rs", "miri-shims-a", () => InterpCx.prototype, ["malloc_align", "check_rust_alloc_request", "rust_special_allocator_method", "malloc", "posix_memalign", "free", "realloc", "aligned_alloc"]);
