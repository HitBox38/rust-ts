// Port of src/tools/miri/src/concurrency/blocking_io.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-threads` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into blocking_io.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Deadline } from "../clock.ts";
import { type BlockingIoInterest, BlockingIoManager } from "./blocking_io.gen.ts";
import { type DynUnblockCallback, type ThreadId } from "./thread.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type FdId, type FileDescriptionRef } from "../shims/files.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../std/io.ts";
import { type Result } from "../../std/result.ts";
export * from "./blocking_io.gen.ts";

/** `trait SourceFileDescription` (src/tools/miri/src/concurrency/blocking_io.rs): implemented by the file description / sync object types; `(provided)`
 * members are the trait's default methods (PORTING §8: a `<Trait>_provided` helper holds them once ported). */
export interface SourceFileDescription {
  // concurrency/blocking_io.rs:20
  with_source(f: ((_0: Pending<"dyn Source">) => Result<null, io_Error>)): Result<null, io_Error>;
  // concurrency/blocking_io.rs:23
  get_readiness_mut(): Pending<"RefMut<'_, Readiness>">;
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- concurrency/blocking_io.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // concurrency/blocking_io.rs:288
    block_thread_for_io(this: MiriInterpCx, source_fd: FileDescriptionRef<SourceFileDescription>, interest: BlockingIoInterest, deadline: Deadline | undefined, callback: DynUnblockCallback): InterpResult;
    // concurrency/blocking_io.rs:322
    poll_and_unblock(this: MiriInterpCx, timeout: Pending<"Duration"> | undefined): InterpResult;
    // concurrency/blocking_io.rs:336
    any_thread_blocked_on_host(this: MiriInterpCx): boolean;
  }
}

declare module "./blocking_io.gen.ts" {
  interface BlockingIoManager {
    // concurrency/blocking_io.rs:195
    register(source_fd: FileDescriptionRef<SourceFileDescription>): void;
    // concurrency/blocking_io.rs:231
    add_blocked_thread(source_id: FdId, thread_id: ThreadId, interest: BlockingIoInterest): void;
    // concurrency/blocking_io.rs:250
    remove_blocked_thread(source_id: FdId, thread_id: ThreadId): void;
    // concurrency/blocking_io.rs:257
    run_gc(): void;
  }
  namespace BlockingIoManager {
    // concurrency/blocking_io.rs:106
    function new_(communicate: boolean): Result<BlockingIoManager, io_Error>;
    export { new_ as new };
    // concurrency/blocking_io.rs:118
    export let poll: (ecx: MiriInterpCx, timeout: Pending<"Duration"> | undefined) => InterpResult<Result<null, io_Error>>;
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl BlockingIoInterest (concurrency/blocking_io.rs:39) [BlockingIoInterest is not a generated class: companion fns / hand type, lane decides]: is_fulfilled_by (:43)
// impl From<&mio::event::Event> for Readiness (concurrency/blocking_io.rs:53): from (:54)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::concurrency::blocking_io::EvalContextExt", "src/tools/miri/src/concurrency/blocking_io.rs", "miri-threads", () => InterpCx.prototype, ["block_thread_for_io", "poll_and_unblock", "any_thread_blocked_on_host"]);
stub_methods("miri::concurrency::blocking_io::BlockingIoManager", "src/tools/miri/src/concurrency/blocking_io.rs", "miri-threads", () => BlockingIoManager.prototype, ["register", "add_blocked_thread", "remove_blocked_thread", "run_gc"]);
stub_statics("miri::concurrency::blocking_io::BlockingIoManager", "src/tools/miri/src/concurrency/blocking_io.rs", "miri-threads", () => BlockingIoManager, ["new", "poll"]);
