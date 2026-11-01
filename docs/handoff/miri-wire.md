# Handoff: lane `miri-wire` (M6 wave 36: wire the landed Miri lanes together)

Branch `t3/4fa77b31` (worktree `t3-4fa77b31`), on top of `integ-w36` at `b41be54c` (merged twice: at setup, then again
after harness-w36 landed on integ-w36; both merges clean). Commits: 5dca9466 (1), the item-2 commit, 3-4, 5-6, 7, 8.

## Items (one line each)

1. **Typecheck / typemap retyping — done.** `std::time::{Duration, Instant, SystemTime}` map to src/std/time.ts
   (`Instant` imported as `std_Instant`; clock.rs has its own `Instant`). `Poll<()>` is src/std/task.ts `Poll<null>`
   everywhere (thread.ts's own `"Ready" | "Pending"` type is gone; it re-exports src/std's). The casts / `poll_of` /
   `pending_poll` / `host_instant` etc. are gone from eval.ts, clock.ts, scheduler.ts, thread.ts, blocking_io.ts and
   shims/{tls,time,global_ctor}.ts. `PENDING_FOR_TESTS`, `pending()` and `Duration_` are deleted from thread.ts.
   threads.test.ts now runs on a real virtual `MonotonicClock`, virtual `Instant` deadlines and real `Duration`s.
   `unblock_expired_deadlines`'s `RealTime` arm is now ported (`time.duration_since(SystemTime::now()).unwrap_or(ZERO)`).
2. **Machine-stop stand-ins — done.** All 4 (data_race.ts, machine.ts, stacked_borrows/diagnostics.ts,
   alloc_addresses/mod.ts) use miri-driver's `TerminationInfo_into_machine_stop`. data_race.test.ts: the race report is
   asserted as `Err(MachineStop(TerminationInfoStop(DataRace)))`, with both ops' action, thread and span (distinct
   per-thread spans) and the exact upstream Display text (diagnostics.rs:92, `Pointer<AllocId>` Debug from
   pointer.rs:202). stack.test.ts: SB error paths assert `Err(MachineStop(StackedBorrowsUb))` and their messages,
   instead of `Unported`.
3. **provenance_gc — done.** It calls `AllocState.remove_unreachable_tags` (borrow_tracker/mod.ts); the stand-in and
   the stale miri-machine PORT note are deleted.
4. **`callback!` API — done.** `callback(captures, body)`: `captures` is one list,
   `{ name: [value, <VisitProvenance impl>] , .. }` in capture order. `visit_provenance` and the body's values both come
   from it. `call` consumes the callback; a second call panics (`unreachable`). Its 6 users are converted: thread.ts
   join, and sync.ts mutex, rwlock reader, rwlock writer, condvar and futex. (init_once has no `callback!`.) sync.ts
   imports it as `callback_`, because `futex_wait`'s parameter `callback` shadows it. Tests: machine.test.ts covers
   visit order, values and consumption. A new threads.test.ts test checks that every site's blocked callback visits
   all captured provenance, including `Option<(Scalar, MPlaceTy)>` and the futex's inner callback.
5. **`adjust_alloc_root_pointer` — done.** The interface and the abstract class take `ptr: Pointer<CtfeProvenance>`
   (interpret/machine.rs:442). The cast in Miri's machine.ts is gone. CTFE samples are unchanged (below).
6. **`info!` — done.** eval.rs:571 (`miri::eval`) and thread.rs:516 (`miri::concurrency::thread`, behind
   `INFO_ENABLED`) are live. The thread.rs format string was checked byte for byte against upstream. A new
   threads.test.ts test drives it through the `MIRI_LOG=info` filter and tracing-tree. **Every Miri `info!` site is now
   live** except scheduler.rs:65, which is GenMC only (the arm stops `unported("genmc")`; genmc/run.rs is excluded,
   D2). `INFO_CONVERTED_TARGETS` was NOT widened (root decision: that needs the Miri oracle test first).
7. **Small fixes — done.**
   - miri-sb: `Stack.new` and `AllocHistory.new` clone the `Item`. A test mutates the caller's item; it is mutant-checked
     (it fails without the clone).
   - miri-driver: the `-Zmiri-num-cpus` test is split out as PENDING wave 37. It asserts the exact `Unported` stop
     (`miri::shims::cpu_affinity::MAX_CPUS ...`), and a `test.todo` holds the oracle expectation
     (`must be in the range 1..=1024`, exit 1). New object-valued `DedupRangeMap` test: split halves don't share the
     value, and structurally equal neighbours merge again.
   - miri-race: report tests made stronger (item 2). Mutants killed: branch order (NaWrite check moved first), op1 span
     taken from the active clocks, op2 span taken from the other clock.
   - miri-eval L1: helpers.ts `no field named .. in type {}` and `write_int on non-scalar type {}` print `display_Ty`.
     operator.ts `assert_eq!(right.layout.ty, usize)` prints `debug_Ty`. `assert_target_os` prints the derived Debug
     (`MacOs`; `debug_target_spec_other`). The hand-written unwraps are now `unwrap_result` with the error's Debug:
     eval.ts `layout_of` (`debug_InterpErrorKind`), helpers.ts `libc_array_ty_layout` (`debug_InterpErrorKind`),
     `mark_immutable` (`debug_Size` for `into_pointer_or_addr`, `debug_InterpErrorInfo` for `alloc_mark_immutable`).
8. **Remaining `PORT(contract)` / pending stand-ins** (see the table below). Also replaced in this item, because their
   owners have landed:
   - eval.ts `MAIN_THREAD` and data_race.ts `main_thread` / `thread_idx` made non-canonical `new ThreadId(0)` objects
     (a latent bug for identity-keyed maps). They now use `ThreadId.MAIN_THREAD` / `.index()`.
   - diagnostics.ts `display_AccessKind` stand-in: now borrow_tracker's.
   - Casts removed: the rng casts (data_race.ts, alloc_addresses), the `borrow_tracker_sb` cast in SB mod.ts, and the
     `non_atomic_write` cast in machine.ts.
   - alloc_addresses / SB now call the `as_genmc_ref` / `as_vclocks_ref` companions.
   - machine.ts: the `pending()` lookups for miri-race / miri-alloc are now direct namespace reads at call time.
   - **data_race_handler.ts: `AllocDataRaceHandler` visit stopped `unported` whenever weak memory was on, although
     `StoreBufferAlloc::visit_provenance` is ported. It now calls it.** Same for weak_memory.ts's
     `VisitProvenance_Scalar` lookup.

Extra (not on the list; it was blocking `bun test ./src`): on integ-w36, `src/miri/contract.test.ts` "every module loads
as a fresh entry point" failed with 23 modules. The cause was a TDZ: clock.ts assigned `MiriMachine.prototype.timeout`
at load time. It is now registered through `port_methods`, which is the recorded C10 mechanism.

## Verify

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | markers ok (23954; vendor 5050; library 505) |
| codegen set `miri` (`bun tools/codegen/types.ts miri`) | regenerates with no diff; report counts unchanged (unknown 0, missing debug 14, missing clone 2) |
| gen diff made by the typemap change | only clock.gen.ts (`Host` fields → `std_Instant`, `RealTime` → `SystemTime`), scheduler.gen.ts (`SleepAndWaitForIo._0` → `Duration`), shims/unix/fs.gen.ts (`TimeUpdate::Set` → `SystemTime`), plus their imports (the unused `Pending` import dropped in two of them) |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools` | 6732 pass, 1 skip, 1 todo (the num-cpus oracle todo), 0 fail (553 files) |
| `bun test ./scripts ./harness` | 136 pass, 0 fail |
| `difftest --suite mir --sample 300` (agent miri-wire) | 300/300 MATCH (run 20261101-150446-miri-wire-7njh) |
| `difftest --suite mir-core --sample 200` | 200/200 MATCH (run 20261101-150532-miri-wire-0li4) |

Coverage (`--missing`) of touched upstream files: all full. clock 10/10, eval 9/9, helpers 71/71, machine 87/87,
operator 4/4, provenance_gc 30/30, diagnostics 12/12, concurrency/{thread 74/74, scheduler 4/4, sync 40/40,
data_race 78/78, data_race_handler 10/10, weak_memory 16/16, blocking_io 13/13}, alloc_addresses/mod 14/14,
borrow_tracker/mod 36/36, stacked_borrows/{mod 23/23, stack 16/16, diagnostics 25/25},
rustc_const_eval interpret/machine.rs 83/83.

## `unported(...)` added: none

Removed stops:
- the 4 machine-stop stand-ins;
- the provenance_gc `AllocState` stand-in;
- the SB `display_AccessKind` and diagnostics.ts `display_AccessKind` stand-ins;
- the `StoreBufferAlloc` visit stand-in;
- the weak_memory `VisitProvenance_Scalar` lookup stop;
- the `RealTime` deadline stop in `unblock_expired_deadlines`;
- the `Duration` pending stop.

## `// PORT:` decisions

- thread.ts `Duration_is_zero` (core time.rs:566) and `Duration_min` (derived `Ord`, fields `secs` then `nanos`;
  `min_by` returns `self` unless `other < self`). src/std/time.ts `Duration` has neither, and src/std is not this
  lane's. **Root: move them into src/std/time.ts as `is_zero()` / an `Ord` cmp** (one-line change at both call sites).
- `callback` (machine.ts): the API described in item 4. A second `call` panics with
  `internal error: entered unreachable code: a \`callback!\` was called after it was consumed (\`self: Box<Self>\`)`.
  Upstream this is a compile error, so the text can never be observed against the oracle.
- sync.ts `VisitProvenance_Option_Scalar_MPlaceTy`: the `Option<(Scalar, MPlaceTy)>` impl, composed from
  provenance_gc's `VisitProvenance_Option` and `VisitProvenance_tuple2`.

## Remaining `PORT(contract)` / pending stand-ins in `src/miri/**`

| site | what | owner |
|---|---|---|
| machine.ts `pending()`: `EnvVars.init`, `TlsData.default` | not ported yet | miri-shims-a (wave 37) |
| machine.ts `pending()`: `DirTable.default` | not ported yet | miri-fs (wave 37) |
| machine.ts `visit_table`: `VisitProvenance_CatchUnwindData`, `VisitProvenance_EnvVars` | not exported yet (the miri-alloc / miri-race / miri-driver tables resolve) | miri-shims-a (wave 37) |
| machine.ts:648 | cpu_affinity.ts types `cx` as `Pending<impl LayoutOf>` (cast) | miri-shims-b (wave 37) |
| machine.ts:1216, genmc/dummy.ts:34, bin/miri.ts:208 | `Pending<FnArg>[]` / `Pending<"NonZeroI32">` in the GenMC dummy signatures | GenMC dummy (never called without genmc); fix with the GenMC typing |
| bin/miri.ts:532 `MAX_CPUS` | unported | miri-shims-b (wave 37); test is marked pending |
| bin/miri.ts:105 | rustc_interface ignores Miri's codegen backend (root-side fix queued by miri-driver) | root / rustc_interface |
| borrow_tracker/mod.ts:184 `Tree.visit_provenance` | declared, stub | miri-tb-b (wave 37) |
| data_race.ts:328 `imm_to_scalar`, data_race.ts:972 `ghost_run` closure, thread.ts:720 `global_root_pointer`, thread.ts:729 `insert_allocation`, sync.ts:363 `ImmTy.from_scalar` | CTFE-typed rustc_const_eval declarations; casts at call sites | root / interp-generic (shared interface typing, like item 5) |
| alloc/alloc_bytes.ts:78, :187; SB mod.ts:6; weak_memory.ts:15 | standing design notes (Machine::Bytes; module-function Stack ops for C10; bodies of undeclared trait impls) | none: permanent, no stand-in |
| src/miri/** stub placeholders (`stub_methods`, 51 files) | wave-37 shims | wave 37 lanes |

## For root

- The src/std/time.ts additions (`Duration::is_zero`, `Ord`) are described under PORT decisions.
- integ-w36 at `b41be54c` is merged in. No conflicts.
