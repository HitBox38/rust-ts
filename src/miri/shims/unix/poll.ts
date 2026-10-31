// Port of src/tools/miri/src/shims/unix/poll.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-d` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into poll.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type FdNum } from "../files.ts";
import { type Readiness, type ReadinessWatcher } from "../readiness.ts";
import { type PollInterest } from "./poll.gen.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
export * from "./poll.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/poll.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/poll.rs:26
    poll(this: MiriInterpCx, fds: OpTy, nfds: OpTy, timeout: OpTy, dest: MPlaceTy): InterpResult;
    // ---- shims/unix/poll.rs: `trait EvalContextPrivExt` (impl for `MiriInterpCx`) ----
    // shims/unix/poll.rs:152
    write_ready_events(this: MiriInterpCx, watcher: ReadinessWatcher, interests: Map<FdNum, PollInterest>): InterpResult<number>;
    // shims/unix/poll.rs:179
    readiness_to_poll_bitflag(this: MiriInterpCx, readiness: Readiness): number;
    // shims/unix/poll.rs:216
    poll_bitflag_to_readiness(this: MiriInterpCx, bitflag: number): InterpResult<Readiness>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for PollInterest<'_> (shims/unix/poll.rs:18): visit_provenance (:19)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::poll::EvalContextExt", "src/tools/miri/src/shims/unix/poll.rs", "miri-shims-d", () => InterpCx.prototype, ["poll"]);
stub_methods("miri::shims::unix::poll::EvalContextPrivExt", "src/tools/miri/src/shims/unix/poll.rs", "miri-shims-d", () => InterpCx.prototype, ["write_ready_events", "readiness_to_poll_bitflag", "poll_bitflag_to_readiness"]);
