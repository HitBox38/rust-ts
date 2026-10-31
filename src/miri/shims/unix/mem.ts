// Port of src/tools/miri/src/shims/unix/mem.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-c` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/mem.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/mem.rs:24
    mmap(this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy, flags: OpTy, fd: OpTy, offset: bigint): InterpResult<Scalar>;
    // shims/unix/mem.rs:113
    munmap(this: MiriInterpCx, addr: OpTy, length: OpTy): InterpResult<Scalar>;
    // shims/unix/mem.rs:139
    mprotect(this: MiriInterpCx, addr: OpTy, length: OpTy, prot: OpTy): InterpResult<Scalar>;
    // shims/unix/mem.rs:176
    madvise(this: MiriInterpCx, addr: OpTy, length: OpTy, advice: OpTy): InterpResult<Scalar>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// fn round_up_to_page_size (shims/unix/mem.rs:221)
// fn verify_prot (shims/unix/mem.rs:227)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::mem::EvalContextExt", "src/tools/miri/src/shims/unix/mem.rs", "miri-shims-c", () => InterpCx.prototype, ["mmap", "munmap", "mprotect", "madvise"]);
