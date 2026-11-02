// Port of src/tools/miri/src/lib.rs (crate `miri`, plan-m6 D2; lane miri-contract, wave 35): the crate root.
//
// Layout (the contract of every Miri fill lane; docs/handoff/miri-contract.md):
// - `src/tools/miri/src/<path>.rs` -> `src/miri/<path>.ts` (+ `<path>.gen.ts`, tools/codegen set `miri`), markers
//   `// rustc: src/tools/miri/src/<path>.rs:<line> <name>`.
// - Miri's extension traits (`trait EvalContextExt<'tcx>: MiriInterpCxExt<'tcx>` + `impl EvalContextExt for MiriInterpCx`,
//   one per file) are `declare module` augmentations of rustc_const_eval's `InterpCx`, assigned on `InterpCx.prototype` by
//   the file that ports them (PORTING §5 "Methods defined in another file"). The `use crate::X::EvalContextExt as _;`
//   imports of this file are the side-effect imports below: this module loads every module of the crate.
// - `MiriInterpCx` is `InterpCx<MiriMachine>` (machine.ts; `MiriMachine` implements `Machine<MiriMachineTypes>`).
// - The crate-wide prelude (`pub use crate::...::{..}` below) is re-exported by name; `pub use
//   rustc_const_eval::interpret::*` is not (PORT: TS modules import interpreter items from rustc_const_eval /
//   rustc_middle directly; a glob re-export would collide with Miri's own `Pointer`, `Scalar`, `MemoryKind`, ...).
//
// Init order: rustc_const_eval first (its interpret modules assign the `InterpCx` methods Miri builds on), then every
// Miri module (in path order; none of them reads another one's prototype methods at load), then the stub placeholders
// (`install_miri_stubs`, src/rust_ts/miri_stub.ts), which must run after every module has assigned its ported methods.

// The rustc crates we need (`extern crate ..`): their crate roots load their extension modules.
import "../rustc_const_eval/lib.ts";
import { install_miri_stubs } from "../rust_ts/miri_stub.ts";
import type * as interpret from "../rustc_const_eval/interpret/mod.ts";
import type * as mir_interpret from "../rustc_middle/mir/interpret/mod.ts";
import type { Provenance } from "./machine.ts";

// mod alloc; mod alloc_addresses; mod borrow_tracker; mod clock; mod concurrency; mod data_structures; mod diagnostics;
// mod eval; mod helpers; mod intrinsics; mod machine; mod math; mod operator; mod provenance_gc; mod shims; pub mod sym;
// PORT: every module of the crate (each `mod.rs` declares its children; their `EvalContextExt` traits are imported
// `as _` by the prelude below), loaded here for their prototype assignments.
import "./alloc/alloc_bytes.ts";
import "./alloc/mod.ts";
import "./alloc_addresses/address_generator.ts";
import "./alloc_addresses/mod.ts";
import "./alloc_addresses/reuse_pool.ts";
import "./borrow_tracker/mod.ts";
import "./borrow_tracker/stacked_borrows/diagnostics.ts";
import "./borrow_tracker/stacked_borrows/item.ts";
import "./borrow_tracker/stacked_borrows/mod.ts";
import "./borrow_tracker/stacked_borrows/stack.ts";
import "./borrow_tracker/tree_borrows/diagnostics.ts";
import "./borrow_tracker/tree_borrows/exhaustive.ts";
import "./borrow_tracker/tree_borrows/foreign_access_skipping.ts";
import "./borrow_tracker/tree_borrows/mod.ts";
import "./borrow_tracker/tree_borrows/perms.ts";
import "./borrow_tracker/tree_borrows/tree.ts";
import "./borrow_tracker/tree_borrows/tree_visitor.ts";
import "./borrow_tracker/tree_borrows/unimap.ts";
import "./borrow_tracker/tree_borrows/wildcard.ts";
import "./clock.ts";
import "./concurrency/blocking_io.ts";
import "./concurrency/data_race.ts";
import "./concurrency/data_race_handler.ts";
import "./concurrency/genmc/dummy.ts";
import "./concurrency/init_once.ts";
import "./concurrency/mod.ts";
import "./concurrency/scheduler.ts";
import "./concurrency/sync.ts";
import "./concurrency/thread.ts";
import "./concurrency/vector_clock.ts";
import "./concurrency/weak_memory.ts";
import "./data_structures/dedup_range_map.ts";
import "./data_structures/mod.ts";
import "./data_structures/mono_hash_map.ts";
import "./data_structures/range_object_map.ts";
import "./diagnostics.ts";
import "./eval.ts";
import "./helpers.ts";
import "./intrinsics/math.ts";
import "./intrinsics/mod.ts";
import "./intrinsics/simd.ts";
import "./intrinsics/x86/aesni.ts";
import "./intrinsics/x86/avx.ts";
import "./intrinsics/x86/avx2.ts";
import "./intrinsics/x86/avx512.ts";
import "./intrinsics/x86/bmi.ts";
import "./intrinsics/x86/gfni.ts";
import "./intrinsics/x86/mod.ts";
import "./intrinsics/x86/sha.ts";
import "./intrinsics/x86/sse.ts";
import "./intrinsics/x86/sse2.ts";
import "./intrinsics/x86/sse3.ts";
import "./intrinsics/x86/sse41.ts";
import "./intrinsics/x86/sse42.ts";
import "./intrinsics/x86/ssse3.ts";
import "./machine.ts";
import "./math.ts";
import "./operator.ts";
import "./provenance_gc.ts";
import "./shims/alloc.ts";
import "./shims/backtrace.ts";
import "./shims/cpu_affinity.ts";
import "./shims/env.ts";
import "./shims/extern_static.ts";
import "./shims/files.ts";
import "./shims/foreign_items.ts";
import "./shims/global_ctor.ts";
import "./shims/io_error.ts";
import "./shims/math.ts";
import "./shims/mod.ts";
import "./shims/os_str.ts";
import "./shims/panic.ts";
import "./shims/readiness.ts";
import "./shims/sig.ts";
import "./shims/time.ts";
import "./shims/tls.ts";
import "./shims/unix/env.ts";
import "./shims/unix/fd.ts";
import "./shims/unix/foreign_items.ts";
import "./shims/unix/fs.ts";
import "./shims/unix/linux/foreign_items.ts";
import "./shims/unix/linux/mem.ts";
import "./shims/unix/linux/mod.ts";
import "./shims/unix/linux_like/epoll.ts";
import "./shims/unix/linux_like/eventfd.ts";
import "./shims/unix/linux_like/mod.ts";
import "./shims/unix/linux_like/sync.ts";
import "./shims/unix/linux_like/syscall.ts";
import "./shims/unix/linux_like/thread.ts";
import "./shims/unix/mem.ts";
import "./shims/unix/mod.ts";
import "./shims/unix/poll.ts";
import "./shims/unix/socket.ts";
import "./shims/unix/sync.ts";
import "./shims/unix/thread.ts";
import "./shims/unwind.ts";
import "./sym.ts";

// Establish a "crate-wide prelude": we often import `crate::*`.
// Make all those symbols available in the same place as our own.
// #[doc(no_inline)] pub use rustc_const_eval::interpret::*;  (PORT: not re-exported, header)
// Resolve ambiguity.
// #[doc(no_inline)] pub use rustc_const_eval::interpret::{self, AllocMap, Provenance as _};
export type { AllocMap } from "../rustc_const_eval/interpret/machine.ts";
export type { Either } from "../rustc_middle/mir/mod.ts";
// pub use rustc_log::tracing::{self, info, trace, warn};  (PORT: tracing is not ported; src/rust_ts/tracing.ts, D10)
export { bug, span_bug } from "../rustc_span/macros.ts";

// #[cfg(all(feature = "native-lib", unix))] pub mod native_lib { .. }  (PORT: built without `native-lib`, decision C6)

// Type aliases that set the provenance parameter.
// rustc-type: src/tools/miri/src/lib.rs:118 Pointer
export type Pointer = mir_interpret.Pointer<Provenance | undefined>;
// rustc-type: src/tools/miri/src/lib.rs:119 StrictPointer
export type StrictPointer = mir_interpret.Pointer<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:120 Scalar
export type Scalar = mir_interpret.Scalar<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:121 ImmTy
export type ImmTy = interpret.ImmTy<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:122 OpTy
export type OpTy = interpret.OpTy<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:123 FnArg
export type FnArg = interpret.FnArg<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:124 PlaceTy
export type PlaceTy = interpret.PlaceTy<Provenance>;
// rustc-type: src/tools/miri/src/lib.rs:125 MPlaceTy
export type MPlaceTy = interpret.MPlaceTy<Provenance>;

export { MiriAllocBytes } from "./alloc/alloc_bytes.ts";
export { ProvenanceMode } from "./alloc_addresses/mod.ts";
export { Item, Permission } from "./borrow_tracker/stacked_borrows/item.ts";
export { Stack } from "./borrow_tracker/stacked_borrows/stack.ts";
export { Stacks } from "./borrow_tracker/stacked_borrows/mod.ts";
export { Tree } from "./borrow_tracker/tree_borrows/tree.ts";
export { BorTag, BorrowTrackerMethod, type TreeBorrowsParams } from "./borrow_tracker/mod.ts";
export { type Deadline, Instant, MonotonicClock, TimeoutClock, TimeoutStyle } from "./clock.ts";
export { BlockingIoInterest, BlockingIoManager, type SourceFileDescription } from "./concurrency/blocking_io.ts";
export { AtomicFenceOrd, AtomicReadOrd, AtomicRwOrd, AtomicWriteOrd } from "./concurrency/data_race.ts";
export { InitOnceRef } from "./concurrency/init_once.ts";
export { CondvarRef, MutexRef, RwLockRef } from "./concurrency/sync.ts";
export { BlockReason, type DynUnblockCallback, type StackEmptyCallback, ThreadId, ThreadManager, TlsAllocAction, UnblockKind } from "./concurrency/thread.ts";
export { GenmcConfig, GenmcCtx, run_genmc_mode } from "./concurrency/genmc/dummy.ts";
export { DedupRangeMap } from "./data_structures/dedup_range_map.ts";
export { MonoHashMap } from "./data_structures/mono_hash_map.ts";
export { NonHaltingDiagnostic, TerminationInfo, report_result } from "./diagnostics.ts";
export { type MiriConfig, MiriEntryFnType, create_ecx, entry_fn, eval_entry } from "./eval.ts";
// pub use crate::helpers::{EvalContextExt as _, ToU64 as _, ToUsize as _};  (side-effect import above)
export {
  AlignmentCheck,
  AllocExtra,
  BacktraceStyle,
  type DynMachineCallback,
  FloatRoundingErrorMode,
  type FrameExtra,
  IsolatedOp,
  type MachineCallback,
  type MemoryKind,
  type MiriInterpCx,
  type MiriInterpCxExt,
  MiriMachine,
  MiriMemoryKind,
  PrimitiveLayouts,
  Provenance,
  ProvenanceExtra,
  RejectOpWith,
  ValidationMode,
} from "./machine.ts";
export { LiveAllocs, type VisitProvenance, type VisitWith } from "./provenance_gc.ts";
export { EmulateItemResult } from "./shims/mod.ts";
export { MAX_CPUS } from "./shims/cpu_affinity.ts";
export { EnvVars } from "./shims/env.ts";
export { DynSym } from "./shims/foreign_items.ts";
// pub use crate::shims::io_error::{EvalContextExt as _, IoError, LibcError};  (`LibcError` is the variant constructor
// io_error.rs exports through `pub use self::IoError::*`; the other variants are reached as `IoError::X`, i.e. the
// companion `IoError.X`, as upstream's crate root re-exports only `LibcError`)
export { IoError, LibcError } from "./shims/io_error.ts";
export { type Readiness, ReadinessInterest, ReadinessUpdateFlags, ReadinessWatched, ReadinessWatcher } from "./shims/readiness.ts";
export { TlsData } from "./shims/tls.ts";
export type { CatchUnwindData } from "./shims/unwind.ts";

/// Insert rustc arguments at the beginning of the argument list that Miri wants to be
/// set per default, for maximal validation power.
/// Also disable the MIR pass that inserts an alignment check on every pointer dereference. Miri
/// does that too, and with a better error message.
export const MIRI_DEFAULT_ARGS: readonly string[] = [
  "--cfg=miri",
  "-Zalways-encode-mir",
  "-Zextra-const-ub-checks",
  "-Zmir-preserve-ub",
  "-Zmir-opt-level=0",
  // Disable passes that add checks for language UB -- we get better diagnostics if
  // we let Miri do these checks.
  "-Zmir-enable-passes=-CheckAlignment,-CheckNull,-CheckEnums",
  // FIXME: Disable some passes to make higher opt levels also work.
  // - ReferencePropagation is incompatible with SB's ref-to-raw castb behavior.
  //   The fix here is to ditch SB and use TB instead but we're not yet ready for that.
  // - GVN is not yet adjusted for implicit retags during assignments.
  "-Zmir-enable-passes=-ReferencePropagation,-GVN",
  // Deduplicating diagnostics means we miss events when tracking what happens during an
  // execution. Let's not do that.
  "-Zdeduplicate-diagnostics=no",
];

// PORT: the stub placeholders of every not-yet-ported method (src/rust_ts/miri_stub.ts), after all modules loaded.
install_miri_stubs();
