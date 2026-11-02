# Handoff: fixer lane `miri-thread-exit` (M6: the port's Miri thread-exit / join bug)

Branch `t3/868575cb` (worktree `t3-868575cb`). At setup it merged `integ-w37` and `t3/miri-codegen-backend`, with no
conflicts. Fix commit: 635b50ec. The handoff commit follows it.

## Root cause (one bug, all three cases)

Thread exit, join and futex/park were not at fault. The bug was **aliasing in the weak-memory store buffer**
(`src/miri/concurrency/weak_memory.ts`).

- **What upstream does.** `VTimestamp` is `Copy`. `StoreBuffer::store_impl` (weak_memory.rs:422) stores
  `store_timestamp: thread_clock[index]`, and `StoreElement::load_impl` (weak_memory.rs:480) inserts
  `clocks.clock[index]` into `load_info.timestamps`. Both are copies.
- **What the port did.** It stored the thread's *live* `VTimestamp` slot object. `increment_clock` mutates that slot
  in place (vector_clock.ts header: every copy into a slot must be `clone_VTimestamp`). So the store's timestamp, and
  the first-load timestamps, moved forward with the thread's clock after the access.
- **Effect.** Repro: `spawn(|| {})` then `join()`.
  - The child's `Arc` decrement in `drop(their_packet)` (`strong` 2 -> 1) was a store at child time 16.
  - Its timestamp drifted to 18, past the termination clock `[0,17]` that `thread_joined` gives the joiner.
  - So the CoWR rule in `fetch_store` no longer cut the search at that store.
  - Main's `strong.load(Acquire)` in `Arc::get_mut` could then read the outdated `2`. Whether it did depended on
    the RNG.
  - `JoinInner::join` then panicked with "threads should not terminate unexpectedly".
- **Clues that led there.** The program passed with `-Zmiri-disable-weak-memory-emulation` and failed depending on
  `-Zmiri-seed`. A trace showed the store logged as `t1@16` but sitting in the buffer as `t1@18`.
- **The other two cases.**
  - `test-thread-nocapture.rs`: the same stale `Arc` read inside the test thread's own join.
  - `terse.rs`: the main thread parked in channel `recv` (`Thread::park`) and was reported as deadlocked. With the
    fix its output equals the oracle's, so a stale atomic read is the likely cause. The exact read was not traced.

## Files touched

| file | change |
|---|---|
| `src/miri/concurrency/weak_memory.ts` | `store_impl`: `clone_VTimestamp(vclock_index(thread_clock, index))`. `load_impl`: `clone_VTimestamp(vclock_index(clocks.clock, index))`. Each has a `// PORT:` note. `clone_VTimestamp` was added to the vector_clock import. |
| `src/miri/concurrency/weak_memory.test.ts` | Regression test "store_impl / load_impl keep a copy of the thread's timestamp, not its live clock slot". It is mutation-checked: it fails with the old `weak_memory.ts` (1 fail) and passes with the fix. |

The other `VTimestamp` copies in `src/miri` were checked:
- data_race.ts already clones at every stored copy;
- `VClock.join` / `clone_from` / `set_at_index` copy by value;
- `find_vector_index_reuse_candidate`'s `target_timestamp` is only read before any mutation.

## Verify

All runs used `RUST_TS_AGENT=miri-thread-exit`. "Before" means the same samples with the pre-fix `weak_memory.ts`
(HEAD~1) restored in the tree.

| check | result |
|---|---|
| `difftest --suite run-pass-miri --filter channel-stack-overflow` | **MATCH 1/1** (was CRASH) |
| `difftest --suite run-fail-miri --filter test-thread-nocapture` | **MATCH 1/1** (was DIFF) (`20261102-152307-miri-thread-exit-omaw`) |
| `difftest --suite run-fail-miri --filter terse` | **TIMEOUT** (was DIFF, a deadlock). The port's output is now **byte-identical** to the oracle's: all 103 tests, the same failures, Miri's virtual `finished in 8.43s`, exit 101, empty stderr (run directly with the case's argv, no timeout). It needs ~179 s (measured with other difftests running), against the suite's 60 s timeout. This is speed, not a semantic bug (`20261102-152318-miri-thread-exit-21bv`). |
| `difftest --suite run-pass-miri --sample 300` | before: MATCH 291, DIFF 2, UNPORTED 3, CRASH 2, TIMEOUT 2 (`mte-before-rp`). After: **MATCH 295, DIFF 0, UNPORTED 3, CRASH 0, TIMEOUT 2** (`mte-after-rp`). No new failures. |
| `difftest --suite run-fail-miri --sample 100` | before: MATCH 95, DIFF 5 (`mte-before-rf`). After: **MATCH 99, DIFF 0, TIMEOUT 1** (terse.rs, see above) (`mte-after-rf`). No new failures. |
| `difftest --suite miri-hello` | MATCH 1/1 (`mte-after-hello`) |
| `difftest --suite mir --sample 200` | MATCH 200/200, unchanged (`mte-after-mir`) |
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24395; vendor 5050; library 584)` |
| `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools` | 6827 pass, 1 skip, 0 fail (567 files, 1103 s; the new regression test is the +1; log `$RUST_TS_DATA/tmp/miri-thread-exit/unit-src.log`) |
| `bun test ./scripts ./harness` | 148 pass, 0 fail |

**Fixed by this lane:** the 2 CRASH + 2 DIFF in run-pass and 4 of the 5 DIFF in run-fail. These were all thread/test-harness
cases:
- `box-of-array-of-drop-2`, `slice-panic-2`;
- `macro-comma-support-rpass#std`, `park-timeout-wakeup-59020`;
- `test-should-panic-bad-message`, `test-should-panic-no-message`;
- `run-unexported-tests`, `test-should-panic-failed-show-span`.

The fifth run-fail DIFF, terse.rs, is now a TIMEOUT.

**Left in the samples:**
- UNPORTED (all three in run-pass):
  - `each_linked_rlib` with `-C lto` (M7), 2 cases;
  - `virtual_socket::pipe2` (sockets), 1 case.
- TIMEOUT (speed): `moves/move-3-unique.rs` and `threads-sendsync/issue-8827.rs` in run-pass (both TIMEOUT before
  too), and `test-attrs/terse.rs` in run-fail.

## Coverage

No functions were added or removed. weak_memory.rs is unchanged: `bun scripts/coverage.ts --missing
src/tools/miri/src/concurrency/weak_memory.rs` gives `16/16 ported`.

## `unported(...)` left

None added and none removed.

## `// PORT:` decisions

- weak_memory.ts `store_impl` / `load_impl`: `VTimestamp` is `Copy`, so the store element and the load-info entry own
  a `clone_VTimestamp` of the thread's slot. This follows the vector_clock.ts header rule.

## For root

- **A speed item for a later lane.** terse.rs, and probably move-3-unique.rs and issue-8827.rs, now need only
  interpreter speed to MATCH.
- **A possible follow-up check.** Other `Copy` objects held by reference in the Miri port could alias the same way.
  For example `VClock` slots in sync objects and `ThreadClockSet` fields: grep for stored `.index(` / `clock[` results
  without a clone. This lane found no other instance in `concurrency/`.
