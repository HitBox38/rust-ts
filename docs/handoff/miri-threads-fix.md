# Handoff: miri-threads-fix (M6 wave 36, fixer lane for miri-threads)

Branch `t3/763ecea0`. Merged `integ-w36` (0b118d0b), then `t3/port-miri-threads` (588289a5). There were no textual
conflicts. The fixes for review `docs/reviews/miri-threads.md` (worktree t3-211094dc) are on top.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors (exit 0).
- `bun scripts/coverage.ts --check --offline`: `markers ok (23809; vendor 5050)`.
- Codegen set `miri`: `bun tools/codegen/types.ts miri` regenerates with no diff beyond the three intended field retypes
  (item 2). A second regeneration is byte-identical.
  - Report: unknown 0, missing clone 2, missing debug 14 (was 13).
  - The +1 is a re-bucketing, not a new gap. `AllocExtra.sync_objs` (machine.rs:382) was listed under
    `std::collections::BTreeMap`; it is now listed under its own entry `rust_ts::miri_BTreeMap_Size_SyncObj`. It is the same
    field with the same `unported_debug`, checked by regenerating with the HEAD typemap.
- `RUST_TS_REQUIRE_PROBES=1 bun test src/miri src/rust_ts`: 152 pass, 0 fail, 23 files.
- `RUST_TS_AGENT=miri-threads-fix bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100, DIFF=0 (run
  `20261101-140350-miri-threads-fix-az9d`).
- Coverage (`--missing`): thread.rs 74/74, scheduler.rs 4/4, sync.rs 40/40, init_once.rs 11/11, blocking_io.rs 13/13,
  mod.rs 0/0. genmc/dummy.rs is out of scope (C7, 21/21 per miri-threads).

## Must-fix 1: scheduler pinned against the oracle

- **Probe:** `docs/handoff/miri-threads-probe/{Cargo.toml,Cargo.lock,main.rs}`. The build copy is in
  `$RUST_TS_DATA/tmp/miri-threads/probe`, built with `cargo +nightly-2026-10-11 build --release --offline`. No toolchain
  components were touched. The probe contains:
  - `schedule` (scheduler.rs:52, the non-GenMC path), `yield_active_thread` (thread.rs:1094) and
    `maybe_preempt_active_thread` (thread.rs:1102), transcribed verbatim.
  - `all_threads()` as `IndexVec::iter_enumerated`, so the same `skip().chain(take()).filter()` chain goes into the real
    rand 0.10.1 `IteratorRandom::choose` and `random_bool`.
  - The rng seeded as machine.rs:721 does: `StdRng::seed_from_u64(seed)`. `Cargo.lock` is upstream's resolution, the same
    one as miri-alloc's probe: rand 0.10.1, rand_core 0.10.1, chacha20 0.10.0.
  - Left out because they draw nothing: `DelayedReadinessUpdates::process` (no updates), `poll_and_unblock` (isolation
    on) and `unblock_expired_deadlines` (the scripts block without deadlines).
- **Scripts:** an LCG (never the rng) decides what each step of the active thread does: spawn, block self, unblock a
  blocked thread, yield, terminate (never main), or nothing. The preemption point comes before the terminator's effect,
  as in `before_terminator`. Every `schedule` result, every preemption outcome, every event and the final `tail=<next_u32>`
  are printed.
- **Fixture:** `src/miri/concurrency/scheduler.oracle.txt` (17,709 lines). It holds 7 scenarios:

  | Scenario | Seed | Rate | Schedules | Notes |
  |---|---|---|---|---|
  | default | 0 | 0.01 | 1,500 | Miri's defaults |
  | preempt-half | 1 | 0.5 | 1,500 | |
  | seed42 | 42 | 0.2 | 1,000 | |
  | always | 5 | 1.0 | 600 | `random_bool(1.0)` draws nothing |
  | never | 9 | 0.0 | 600 | still draws |
  | fixed | 3 | — | 600 | fixed scheduling, no draws |
  | deadlock | 21 | 0.3 | — | ends in `GlobalDeadlock` |

  The scenarios have up to 8 threads and 26 to 82 thread switches each.
- **Test:** `src/miri/concurrency/scheduler.oracle.test.ts`. It replays each script through the ported `schedule`,
  `maybe_preempt_active_thread`, `create_thread`, `block_thread`, `unblock_thread`, `yield_active_thread` and
  `terminate_active_thread`, using the vendored `StdRng`. It asserts every decision line and the tail. All 7 scenarios
  matched on the first run; the port was not changed to make them match.
- **Mutation check:** I ran three scratch `--preload` patches, not committed:
  - **Skip the first preemption draw of each run:** 6 of 7 scenarios fail. `fixed` makes no draws, so it cannot fail.
  - **One extra rng word in the first non-trivial `schedule`:** all 7 fail.
  - **Replace one random `choose` with a fixed pick:** 5 of 7 fail. `default` and `fixed` pass: when only one thread is
    enabled, `choose` draws nothing.

  The old 14 tests missed the first and third mutations and caught only the second.
- **Optional real-Miri comparison:** not done. The isolated Miri oracle works: `bun scripts/miri.ts status` is ok. But a
  real program interleaves other rng draws (address generation, float nondeterminism, weak memory), so its schedule cannot
  be predicted from this model alone. It becomes meaningful once the port runs Miri end to end.

## Must-fix 2: value-keyed `ThreadId` maps

- `tools/codegen/miri.typemap.json` `fields` retypes `RwLock.readers` and `BlockingIoSource.blocked_threads`. It also adds
  new `rust_ts::miri_*` type entries and `helpers` for `FxKeyedMap`, `KeyedMap` and `debug_HashMap`. This is the existing
  per-field override mechanism, the same one as C5's `miri_u64_number`.
- `RwLock.readers: FxHashMap<ThreadId, usize>` is now `FxKeyedMap<ThreadId, number>`.
  - It is built in sync.ts `RwLock_default` with `ThreadId_key` (`write_u32`, 4/4), `LAYOUT_USIZE` and
    `ThreadId_value_key`.
  - It is value-keyed and iterates in hashbrown order, so the derived `Debug` is exact.
  - The review called this field already value-keyed. Its construction was a `KeyedMap`, but the generated type was a plain
    `Map`; now the type enforces it.
- `BlockingIoSource.blocked_threads: BTreeMap<ThreadId, _>` is now `KeyedMap<ThreadId, BlockingIoInterest>`.
  - The constructor is `new_blocked_threads()` (blocking_io.ts). The porter of `register` (mio, unported) must use it.
  - BTreeMap order matters only in `poll` (unported, mio). A `PORT` note there says to iterate sorted by `_0`.
- New in thread.ts: `ThreadId_key` and `ThreadId_value_key`. The header and the predecessor handoff's Representation 1 are
  corrected (finding 3).
- Tests:
  - `readers.get(new ThreadId(3))` finds the entry.
  - `add_blocked_thread` / `remove_blocked_thread` with non-canonical ids work, and a double block panics.
  - The rwlock test now compares the reader set without order, since the order is hashbrown's.

## Must-fix 3: `AllocExtra.sync_objs`

- The typemap `fields` override makes it `KeyedMap<Size, SyncObj>`.
- machine.ts `new_sync_objs()` builds it with `Size_value_key` (`small`, or `big` as a string, one representation per
  value). `init_allocation` (machine.ts:924, was `new Map()`) uses it.
- BTreeMap order was already applied at iteration by miri-machine's `btree_range`, which sorts by `Size_cmp`; its comment
  is updated.
- Test: `get_sync` finds an object through a fresh `Size` of the same offset, and a second `set` does not duplicate it.
  This test fails with the old `Map`.

## Must-fix 4 (low): `PENDING_FOR_TESTS`

The landed stand-ins were deleted, and the code now calls the real functions:

- `VisitProvenance_*` from provenance_gc.ts (miri-driver). This also fixed the integration tsc redeclaration errors.
- `VisitProvenance_FrameExtra` from machine.ts (miri-machine).
- `throw_machine_stop!` through diagnostics.ts `TerminationInfo_into_machine_stop` (miri-driver).
- `VClock.clone_from` called directly (miri-race), in sync.ts and init_once.ts.
- `machine_rng` no longer casts, since miri-machine typed `MiriMachine.rng` as `StdRng`.

The hook stays only for miri-eval's `Duration`, which is not on integ-w36. `threads.test.ts` sets that key alone and
deletes only that key. It now stops through the real `TerminationInfo`, with no `MachineStopType` or `VClock` stand-in.
Remove the hook, `Duration_` and the test stand-in when clock.ts exports `Duration`.

## Integration fixes outside the assigned files (for root to check)

- **genmc/dummy.ts `run_genmc_mode`** now takes and returns `Result<null, Pending<"NonZeroI32">>`. That is the contract
  type `eval_entry` declares (eval.ts), and it fixes the tsc error at bin/miri.ts:180.
- **bin/miri.ts (lane miri-driver):** `-Zmiri-genmc` now passes `&mut miri_config.genmc_config` as a `MutRef`, which
  dummy.ts's `parse_arg` takes (PORTING §8), and writes it back. This fixes the tsc error at bin/miri.ts:732.
- **bin/miri.test.ts:**
  - `-Zmiri-genmc` was asserted to throw "genmc" (pending). It is now an `ORACLE` case with
    `fatal error: GenMC is not supported on this target`, exit 1.
  - I checked that text against the real Miri oracle:
    `$RUST_TS_DATA/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri -Zmiri-genmc`, in a clean
    environment with that `RUSTUP_HOME`. It printed exactly this line and exited 1.
- **machine_contract.test.ts:** `m.stack_` was asserted to stop `unported` at `active_thread_stack`. That function is now
  ported, so the test asserts that `stack_` returns the `ThreadManager`'s active stack instead.
- **machine.ts / machine.test.ts:** `new_sync_objs` (item 3), and the before-memory-access test builds its map with it.

## `unported(...)` left

These are unchanged from miri-threads, minus the pending stops that landed:

- `genmc` ×6.
- `SystemTime::now()` (RealTime deadlines).
- mio, 4 sites: `Poll::new`, `poll`, `register`, `Readiness_from_Event`.
- `usize::strict_add` above 2^53.
- `pending(clock.Duration)` (lane miri-eval).

## `// PORT:` decisions added

- thread.ts header: maps keyed by `ThreadId` are value-keyed (`ThreadId_key` / `ThreadId_value_key`). Plain-`Map` users
  in other lanes (`MiriMachine.thread_cpu_affinity`) still rely on canonical instances (review nit 6, not changed).
- sync.ts header: `readers` is an `FxKeyedMap` (hashbrown order).
- blocking_io.ts header and `poll`: `blocked_threads` is a `KeyedMap`; iteration must sort by `_0`.
- machine.ts `new_sync_objs`: value key of `Size`.
- genmc/dummy.ts `run_genmc_mode`: `NonZeroI32` is `Pending<"NonZeroI32">`, following `eval_entry`'s contract.

## For root

- **Harness item:** register `docs/handoff/miri-threads-probe` under `tools/probes` so that it regenerates
  `scheduler.oracle.txt`. Until then the fixture is committed, like `addresses.oracle.txt` and `stdrng.oracle.txt`.
- The callback objects in thread.ts and sync.ts are still inline object literals. machine.ts now exports a `callback`
  helper, but the review queued an API fix for it (captures and visits derived from one list), so I did not convert them.
- Review nits 5 (`Duration` brand casts) and 6 (canonical `ThreadId` invariant) are not addressed. Nit 5 goes away with
  miri-eval's `Duration`.
