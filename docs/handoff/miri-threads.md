# Handoff: miri-threads (plan-m6 wave 36, Miri core)

Branch `t3/port-miri-threads`, on top of main `06fa2c65`. I ported Miri's thread manager, scheduler, sync primitives,
init-once, blocking I/O and the concurrency module root. I also ported genmc/dummy.rs, which is this lane's under C7. All of
it goes into the miri-contract skeleton. The skeleton keeps its shape; the only contract changes are the signature
corrections listed below.

## Files touched

- `src/miri/concurrency/thread.ts`: thread.rs, 1,110 upstream lines.
- `src/miri/concurrency/scheduler.ts`: scheduler.rs, 220 lines.
- `src/miri/concurrency/sync.ts`: sync.rs, 839 lines.
- `src/miri/concurrency/init_once.ts`: init_once.rs, 155 lines.
- `src/miri/concurrency/blocking_io.ts`: blocking_io.rs, 347 lines.
- `src/miri/concurrency/mod.ts`: mod.rs. It has no fns, only re-exports.
- `src/miri/concurrency/genmc/dummy.ts`: genmc/dummy.rs, 233 lines (C7).
- `src/miri/concurrency/threads.test.ts`: new unit tests. Our own code, not a port.
- `docs/handoff/miri-threads.md`: this file.

No other file was edited. No `.gen.ts`, no tools/codegen file, nothing in src/std.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (23356; vendor 5050)`.
- `--missing` reports every file fully ported:
  - thread.rs 74/74
  - scheduler.rs 4/4
  - sync.rs 40/40
  - init_once.rs 11/11
  - blocking_io.rs 13/13
  - mod.rs 0/0
  - genmc/dummy.rs 21/21 (scope.json marks it out of scope; C7 puts it in this lane)
- Codegen set `miri`: `bun tools/codegen/types.ts miri` regenerates with no diff. It reports unknown 0, missing debug 13,
  missing clone 2, the same as the contract.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri`: 26 pass, 0 fail, across 3 files (`contract.test.ts`,
  `machine_contract.test.ts` and the new `concurrency/threads.test.ts`).
- Unit tests in `threads.test.ts`: 14 tests. They run on an `InterpCx` stand-in (a real `ThreadManager`,
  `BlockingIoManager` and vendored `StdRng`, data race off) with a scripted `step()` per thread. The file header explains
  the setup. What they cover:
  - **Thread set:** `ThreadId` canonical instances and `Idx`; main is detached; display names, including lossy UTF-8;
    `Debug` of `Thread` / `ThreadState`; `thread_id_try_from` (in range, out of range, negative).
  - **Spawn / join / yield:**
    - The joiner blocks on `Join(t1)` and wakes when t1 terminates. The return value is written once.
    - The join UB cases ("already joined", "detached", detaching twice) give the right errors.
    - Round-robin order under `fixed_scheduling`.
    - With random scheduling plus a 0.5 preemption rate, the run is deterministic per seed and differs between seeds.
  - **Blocking with a timeout:**
    - The scheduler sleeps the virtual clock to the deadline and runs the `TimedOut` callback.
    - `unblock_expired_deadlines` fires only the expired timeout and returns the smallest remaining wait.
    - A futex wake before the deadline unblocks with `Ready`.
    - A condvar timeout leaves the waiter queue, reacquires the mutex and writes `retval_timeout`.
  - **Deadlock:** a mutex waiter plus a joiner, both with no deadline, stop with `TerminationInfo::GlobalDeadlock`.
  - **Queue order:**
    - Mutex: FIFO hand-over, recursive count, owner-only unlock.
    - RwLock: writers are preferred, and a writer unlock wakes all readers in order.
    - Condvar: signal wakes waiters FIFO, each reacquiring the mutex or queueing on it.
    - Futex: `extract_if(..).take(count)` with a bitset removes only the first `count` matches.
    - InitOnce: complete wakes all waiters in order; fail wakes the first only.
    - `unblock_thread`'s wrong-reason / not-blocked panics, with core's assert text.
- Sample difftest (agent `miri-threads`):
  - `--suite mir --sample 100`: MATCH=100, DIFF=0 (run `20261101-130143-miri-threads-f20i`).
  - `--suite miri-hello`: UNPORTED=1. It stops at `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate`, because the
    Miri driver (miri-driver) is not wired yet (run `20261101-130219-miri-threads-02vf`).
  - Nothing calls into these files from a real run yet.

## Representations (`// PORT:`; for root to record)

1. **`ThreadId`** stays the generated class `{ _0 }`.
   - Equality is `ThreadId_eq` (derived `PartialEq`).
   - Every `ThreadId` this lane makes is the canonical instance for its id, through `thread_id_of`: `Idx::new` (as
     `ThreadId.new`), `new_unchecked`, `MAIN_THREAD`, and the result of `thread_id_try_from`. So a plain JS `Map` keyed by
     `ThreadId` identity behaves like the Rust map. Examples: `MiriMachine.thread_cpu_affinity` (lane miri-machine) and
     `BlockingIoSource.blocked_threads`.
   - The generated `clone_ThreadId` makes non-canonical copies. Use `ThreadId_eq`, or a by-value map, wherever a value
     might have been cloned.
   - The maps this lane owns are keyed by value anyway.
2. **`ThreadManager.thread_local_allocs`** is an `FxKeyedMap` (`rust_ts/hash_map.ts`).
   - Its key type is `(DefId, ThreadId)`: `DefId_fx_key` then `write_u32`, 12 bytes, align 4. The value layout is
     `StrictPointer` (24 / 8).
   - So `terminate_active_thread`'s `retain` frees TLS statics in hashbrown bucket order, as upstream does. That order is
     observable through deallocation hooks and address reuse.
3. **`std::task::Poll<()>`** is `Poll = "Ready" | "Pending"` in thread.ts; no src/std stand-in exists.
   - `StackEmptyCallback` returns `InterpResult<Poll>`.
   - **miri-shims-a:** `TlsDtorsState::on_stack_empty` must return this `Poll`. For now thread.ts casts the skeleton's
     `Pending<"Poll<()>">`.
4. **Callbacks** (`DynMachineCallback<T>` / `callback!`). A callback is the `MachineCallback` interface of machine.ts: an
   object with `call(ecx, arg)` and `visit_provenance(visit)`.
   - Each `callback!(@capture { a: A, .. } |this, arg: T| body)` is an object literal built inline at its use site.
     `visit_provenance` visits each capture in declaration order; `call` is the body. The captures are the enclosing
     closure's variables, and calling the callback once stands for `self: Box<Self>` being consumed.
   - The expansions carry no `machine.rs:2181/:2189` markers. The macro is miri-machine's to port.
   - `UnblockKind` is the generated string union.
5. **`XRef(Rc<RefCell<X>>)`** (Mutex, RwLock, Condvar, Futex, InitOnce) is the generated class whose `_0` is the shared
   `X`.
   - `borrow`/`borrow_mut` are plain field access. The `drop(guard)` calls are kept as comments.
   - `VecDeque` is an array: `push_back` → `push`, `pop_front` → `shift`.
   - `RwLock.readers` (an `FxHashMap` that is never iterated observably) is a `KeyedMap` keyed by the thread number.
   - `Default` impls are written out: `VClock::default()` is `new VClock([])`.
6. **`dyn SyncObj` / `downcast_ref::<T>()`.** The `Any` test is a trailing type predicate `is_T: SyncObjType<T>`, following
   the precedent of rustc_middle's `MachineStopType_downcast_ref`.
   - `SyncObj_provided` holds the two provided methods.
   - `SyncObj_downcast_ref` and `debug_SyncObj` (`SyncObj { .. }`) are ported.
7. **`blocking_io.rs` and mio** (plan-m6 D5). With isolation on, `poll` is `None`. Every method except `new`, `run_gc`,
   `add/remove_blocked_thread` and `any_thread_blocked_on_host` asserts isolation is off before it reaches mio. So the
   isolation-on paths are exact, and mio calls stop `unported`.
   - `communicate.then_some(Poll::new()?)` evaluates `Poll::new()` eagerly. With isolation on, the host kqueue/epoll it
     creates is dropped unobserved, so the port does not create one.
   - `events` is mio's buffer (`never` in the typemap) and is set to `undefined`.
   - `sources` keys (`FdId`, a lane miri-shims-b class) are compared by `_0`.
8. **Scheduler `threads_iter`** is a `RustIterator` (vendored rand) over the rotated thread list. Its size hint is core's
   for `Filter<Chain<Skip, Take>>`: `(0, Some(remaining))`. So `IteratorRandom::choose` draws exactly the RNG words
   upstream draws. Preemption is `RngExt.random_bool(rng, preemption_rate)`.
9. **`MiriMachine.rng`** is still `Pending<"rand::rngs::StdRng">` in the typemap. `machine_rng(ecx)` casts it to the
   vendored `StdRng`; a root typemap item should retype it.
10. **GenMC.** Following the lane brief, the GenMC arms of thread.rs and scheduler.rs stop with `unported("genmc")`.
    genmc/dummy.rs itself is ported as written: every fn is `unreachable!()`, a panic. `parse_arg` takes the `cfg!(feature
    = "genmc") == false` branch ("GenMC is not supported on this target"), and `validate` returns `Ok`.
11. **Thread names** are `number[]` (`Vec<u8>`, as the generated field is). Display uses `String::from_utf8_lossy`
    (`TextDecoder`, WHATWG replacement, the same as std).
12. **`Debug for Thread`** is `write!(f, "{}({:?}, {:?})", ..)`. The inner `{:?}` are formatted plain, not with `f`'s flags.

## Contract signature changes (from the skeleton's mechanical declarations)

Other lanes call these:

- thread.ts:
  - `thread_id_try_from(id: number | bigint)`: `impl TryInto<u32>`.
  - `set_thread_name(.., number[])`, `get_thread_name(..): readonly number[] | undefined` and `Thread.thread_name_()`:
    these were `Uint8Array`, which does not match the generated field.
  - `all_threads()` and `all_blocked_stacks()` return arrays.
  - New: `ThreadId.new` / `.index()` (`Idx`), `ThreadId.MAIN_THREAD`, `ThreadId_eq`, `u64_from_ThreadId`, `BlockReason_eq`,
    and the `ThreadState` companion methods with `debug_ThreadState`.
  - New `visit_provenance` methods on `Thread` and `ThreadManager`, plus the `VisitProvenance_Frame` table.
  - Glue exports: `assert_eq_UnblockKind`, `machine_rng`, `Poll`.
- scheduler.ts:
  - `run_on_stack_empty(): InterpResult<Poll>`.
  - `machine_stop(info)` (`throw_machine_stop!`).
- sync.ts:
  - `get_sync(offset, is_T)`, `get_sync_or_init(ptr, is_T, new_)`.
  - `get_immovable_sync_with_static_init(obj, init_offset, uninit_val, init_val, is_T, new_meta_obj)`.
  - `init_immovable_sync(obj, init_offset, init_val, is_T, new_meta_obj)`.
  - New: `SyncObjType<T>`, `SyncObj_provided`, `SyncObj_downcast_ref`, `debug_SyncObj`, `display_AccessKind`, and
    `visit_provenance` on the four `XRef`s.
- init_once.ts: `InitOnceRef.visit_provenance`.
- blocking_io.ts:
  - `SourceFileDescription extends FileDescription` (it is a supertrait upstream).
  - `get_readiness_mut(): Readiness` (`RefMut`).
  - New: the `BlockingIoInterest.is_fulfilled_by` companion method and `Readiness_from_Event`.
- genmc/dummy.ts:
  - `GenmcConfig.parse_arg(MutRef<GenmcConfig | undefined>, ..)`.
  - `genmc_intercept_function(.., readonly FnArg[], ..)`.
  - `run_genmc_mode`'s `NonZeroI32` is a `number`.
  - New: `GenmcCtx.visit_provenance`.

## Pending pieces of other lanes (missing signatures)

Each is declared locally with `PORT(contract): pending <lane>` (contract rule 6). Values are read through namespace imports
via `pending(..)` in thread.ts: a missing export is `undefined`, not an ESM link error, and stops `unported("<what>
(pending; docs/handoff/miri-threads.md)")`. When the owning lane lands, delete the local declaration. If that lane chose a
different name, adjust the call sites; tsc flags a conflicting re-declaration.

- **miri-eval** (clock.rs; `Duration` is `Pending<"Duration">`):
  - `clock.Duration` = `{ ZERO, MAX, is_zero(d), min(a, b) }`, used in thread.ts `unblock_expired_deadlines` and in
    scheduler.ts (`Duration::ZERO` for `poll_and_unblock`).
  - Brand mismatch: scheduler.gen.ts's `SleepAndWaitForIo` carries `Pending<"std::time::Duration">` and clock.ts uses
    `Pending<"Duration">`. scheduler.ts casts between them; unify when the stand-in lands (typemap).
- **miri-driver** (provenance_gc.rs; values that are not objects get tables, per the contract): `VisitProvenance_ImmTy`,
  `_MPlaceTy`, `_PlaceTy`, `_Pointer`, `_StrictPointer`, `_Scalar`, `_Immediate`, `_MemPlaceMeta`.
- **miri-driver** (diagnostics.rs:113): `MachineStopType_from_TerminationInfo(info): MachineStopType`. This is the
  `Box<dyn MachineStopType>` that `throw_machine_stop!(TerminationInfo::X)` builds; `GlobalDeadlock` and `Interrupted`
  are raised here.
- **miri-machine:**
  - `VisitProvenance_FrameExtra` (machine.rs:169; `FrameExtra` is an interface, so it gets a table).
  - **`AllocExtra.sync_objs` must compare `Size` keys by value.** It is a `BTreeMap<Size, Box<dyn SyncObj>>` built in
    `init_allocation`, and sync.ts uses `get` / `set` on it.
  - `MiriMachine.new` must build `threads` with `ThreadManager.new(config)` and `blocking_io` with
    `BlockingIoManager.new(communicate)`.
- **miri-race:**
  - `VClock.prototype.clone_from(source)` (vector_clock.rs:249). sync.ts calls it through `VClock_clone_from`.
  - `rwlock_reader_unlock` calls it **unconditionally**, even with the data race detector off.
- **miri-shims-a:** `TlsDtorsState::on_stack_empty` should return thread.ts's `Poll` (Representation 3).
- **Root / typemap / rustc_const_eval** (not these lanes' declarations; the call sites cast, each with a `PORT(contract)`
  note):
  - `MiriMachine.rng` → `StdRng`.
  - `InterpCx.global_root_pointer` takes a `Pointer<CtfeProvenance>` upstream; the TS declaration says
    `Pointer<ProvOf<M>>`.
  - `InterpCx.insert_allocation` takes `Allocation<M::Provenance, (), M::Bytes>` upstream; the TS declaration says
    `MachineAllocation` (with `AllocExtra`).
  - `ImmTy.from_scalar` is declared on CTFE's `ImmTy`.

## `unported(...)` left

- `"genmc"` ×6:
  - `start_regular_thread`, `terminate_active_thread`, `block_thread` (deadline in GenMC mode)
  - `join_thread` ×2 (`after_join`, and before blocking)
  - `schedule`
- `unblock_expired_deadlines`, `Deadline::RealTime`: `SystemTime::now()` (host real time; isolation off only; D14).
- mio, isolation off only (D5): `BlockingIoManager::new(communicate = true)` (`Poll::new`), `BlockingIoManager::poll`,
  `register`, and `Readiness_from_Event`.
- `usize::strict_add` above 2^53 (lock counts; unreachable in practice).
- The pending stops above: `pending(..)` and `VClock_clone_from`.

## `// PORT:` comments

Representations 1–12 above appear in the file headers of thread.ts, scheduler.ts, sync.ts, init_once.ts, blocking_io.ts and
genmc/dummy.ts. There are also inline notes on:

- the `PORT(contract)` casts and pending declarations
- `thread_id_try_from` (`impl TryInto<u32>`)
- `all_threads` (collected)
- `String_from_utf8_lossy`
- the canonical `ThreadId`s
- the `FxKeyedMap` key layout
- `Debug for Thread` flags
- `futex_wake`'s lazy `extract_if`

The `info!` / `trace!` lines are kept verbatim as comments for lane miri-log: thread.rs:516 `set_active_thread`, the GenMC
`info!` in `schedule`, and the `trace!`s in thread.rs and sync.rs.

## For root

- Record Representations 1–12 as decisions if you agree, especially 1 (canonical `ThreadId`s), 3 (`Poll`), 4 (the
  callback shape every shim lane will build), and 6 (`is_T` on the sync-object API that wave 37's unix/sync shims call).
- `PENDING_FOR_TESTS` (thread.ts) lets `threads.test.ts` provide stand-ins for the pending `Duration` and `MachineStopType`
  pieces. It goes away with the pending items.
