# Handoff: miri-shims-e (M6 wave 37: Miri shims → gate M6a)

Branch `t3/port-miri-unix-shims` (worktree t3-5b5c28db), based on main `ccf5dc4a`.

Scope: Miri's `shims/unix/sync.rs` (pthread mutex, rwlock and condvar) and `shims/unix/linux_like/{epoll,eventfd,mod,sync,syscall,thread}.rs`
(epoll, eventfd, futex, `syscall` dispatch, `prctl`). These map to `src/miri/shims/unix/sync.ts` and
`src/miri/shims/unix/linux_like/*.ts`.

## Files touched

- `src/miri/shims/unix/sync.ts`: ported (stub list deleted).
- `src/miri/shims/unix/linux_like/{epoll,eventfd,sync,syscall,thread}.ts`: ported (stub lists deleted).
- `src/miri/shims/unix/linux_like/mod.ts`: the module has no fns. It holds the **pending cross-lane contract
  declarations** (see "Contracts" below).
- New: `src/miri/shims/unix/shims_e.test.ts` (11 tests) and `src/miri/shims/unix/sync.oracle.txt` (the oracle fixture).
- New: `docs/handoff/miri-shims-e-probe/{probe.rs,ub.sh}`, the oracle programs behind the fixture.
- No other file was edited. `tools/`, `src/std/`, generated files and other lanes' files are untouched.

## Verification

- `bunx tsc --noEmit -p .`: 0 errors.
- `bun scripts/coverage.ts --check --offline`: `markers ok (24023; vendor 5050; library 506)`.
- `--missing`, each file fully ported:

  | file | fns |
  |---|---|
  | unix/sync.rs | 47/47 |
  | linux_like/epoll.rs | 9/9 |
  | linux_like/eventfd.rs | 10/10 |
  | linux_like/mod.rs | 0/0 |
  | linux_like/sync.rs | 1/1 |
  | linux_like/syscall.rs | 1/1 |
  | linux_like/thread.rs | 1/1 |

- Codegen set `miri`: `bun tools/codegen/types.ts miri` regenerates with no diff.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src ./tools`: 6742 pass, 1 fail, 554 files.
  - The failure was `src/vendor/odht/odht.oracle.test.ts` "build: insert results…". Its probe binary exited non-zero
    with empty stderr while several wave-37 lanes were running test suites on this machine.
  - Rerun alone (`RUST_TS_REQUIRE_PROBES=1 bun test ./src/vendor/odht`): 140 pass, 0 fail. It is unrelated to this
    lane, which does not touch vendor/odht.
  - `bun test ./src/miri` after the last edit: 162 pass, 0 fail.
- `bun test ./scripts ./harness`: 136 pass, 0 fail.
- `RUST_TS_AGENT=miri-shims-e bun scripts/difftest.ts --suite mir --sample 100`: MATCH=100, DIFF=0. Run
  `20261102-115114-miri-shims-e-hgqa`.

## Unit tests (`src/miri/shims/unix/shims_e.test.ts`)

The expected values come from the pinned Miri oracle, not from upstream reading.

The oracle is `docs/handoff/miri-shims-e-probe/probe.rs` and `ub.sh`, run with the isolated Miri
(`$RUST_TS_DATA/rustup-miri`, `--target x86_64-unknown-linux-gnu --sysroot $RUST_TS_DATA/miri-sysroot`) using
`#![feature(rustc_private)] extern crate libc`. No toolchain component was touched. The output is
`src/miri/shims/unix/sync.oracle.txt`. It holds:

- the bytes of libc's pthread static initializers;
- the libc constants;
- the return codes of the mutex kinds, rwlock, condattr, `cond_timedwait` and futex calls;
- the first error line of 10 one-line UB/deadlock programs.

The `MiriInterpCx` is a stand-in, following the threads.test.ts precedent:

- a byte memory: allocations with an init mask and a real `AllocExtra.sync_objs`;
- the real `ThreadManager`, scheduler and virtual `MonotonicClock`;
- the real concurrency/sync.ts machinery: `get_immovable_sync_with_static_init`, `init_immovable_sync`, `get_sync_or_init`,
  mutex, rwlock, condvar and futex;
- minimal stand-ins for other wave-37 lanes, named in each test: `read_timespec`, `parse_clockid`,
  `set_errno_and_return_neg1`, `check_varargs`, the fd table and readiness.

The tests:

1. **Static-initializer layout.** All six initializers have `PTHREAD_UNINIT` at init offset 0, and
   `pthread_mutex_t` is 40 bytes. The `__kind` byte at offset 16 is 1 (RECURSIVE_NP) or 2 (ERRORCHECK_NP).
   Lock/lock/unlock/unlock on copies of the recursive and errorcheck initializers equals the oracle (`0 0 0 0` /
   `0 35 0 1`). The sanity check runs once. ADAPTIVE_NP passes the sanity check but is rejected with the oracle's UB text.
2. **Mutex kinds through `pthread_mutexattr`.** Errorcheck, recursive and normal: settype, lock, relock, trylock and
   unlock codes equal the oracle. A normal-mutex unlock when not locked is UB (oracle text). A normal relock gives
   `LocalDeadlock` (the oracle's "a thread deadlocked"). An invalid settype gives EINVAL.
3. **Default-mutex UB and destroy.** Relock, unlock-not-owner and destroy-locked give the oracle's texts. A double
   destroy is UB: the write hook deletes the sync object, and the second destroy reads uninit memory. A byte-copied
   ("moved") mutex is detected with the oracle's text.
4. **Waiters.** A blocked mutex waiter makes `on_access` UB, and the stored sync object is the exact `PthreadMutex` class.
5. **rwlock.** The rd/tryrd/trywr/unlock sequence equals the oracle, and unlocking an unlocked rwlock gives the oracle's UB.
6. **condattr and condvar timeout.** The condattr clock default, set and invalid cases equal the oracle.
   `pthread_cond_timedwait` with CLOCK_MONOTONIC times out at exactly +1 ms on the virtual clock (110), and an invalid
   timespec gives EINVAL (22).
7. **futex.** Mismatch returns -1/EAGAIN, a wake with no waiters returns 0, and a relative 2 µs timeout returns
   -1/ETIMEDOUT with the virtual clock at 2000 ns. A bitset of 0 returns -1/EINVAL; all of these equal the oracle.
   A non-null `uaddr2` and an unknown op give the oracle's texts.
8. **futex wake from another thread.** A `FUTEX_WAKE|PRIVATE` from another thread before the 1 s deadline wakes the
   waiter with 0, `FUTEX_WAKE` returns 1, and the clock does not move.
9. **epoll bitflags and ready order.** Readiness ↔ bitflag uses the oracle's constants, and `EPOLLET` (bit 31) stays
   unsigned. `return_ready_list` fills the array slots in the watcher's ready order with `{events, u64}`, and writes
   the count.
10. **epoll_ctl.** `EPOLLET` is stripped and sets edge-triggered. `EPOLLHUP|EPOLLERR` are always added. An unknown
    flag (`EPOLLPRI`) is unsupported with the upstream text. EBADF works. A non-epoll epfd is unsupported, and every fd
    handle is dropped exactly once in reverse declaration order (fd, then epfd).
11. **eventfd.** Writes add to the counter and a read returns and clears it; readiness readable/writable track the
    counter. `update_fd_readiness` gets `FORCE_EDGE` and takes the handle. A blocked read is woken by another thread's
    write: the reader's callback runs inside the write, before the write's `finish`. The handle count is balanced.

## Contracts with the parallel wave-37 lanes (agreed by message, 2026-11-02)

The skeleton could not express several things these files need. I agreed the following with miri-shims-b (files.rs,
sig.rs, io_error.rs), miri-shims-c (readiness.rs) and miri-shims-d (unix/fd.rs), and each of them said they would
implement it. Until those lanes merge, `linux_like/mod.ts` declares the missing names with
`// PORT(contract): pending <lane>` blocks. **On integration, delete each block once the owning lane exports the name.**
tsc will report "Cannot redeclare" for the `export const` declarations. The method overloads are harmless.

At runtime, every such name is reached through a module namespace (`files.X`, `readiness.X`, `sig.X`) or a prototype
method, at call time. So nothing fails at load while the other lanes are unmerged.

- **shims-b, files.rs:**
  - A `FileDescriptionRef` is one owned strong handle: `clone()` adds one, `drop()` releases one, `deref()` gives the
    inner description, and the inner's optional `drop_glue()` runs at strong == 0.
  - `downcast(is_T)` takes a trailing exact `instanceof` type test. It takes over the handle and releases it on failure.
  - `self: FileDescriptionRef<Self>` trait methods (`read`, `write`, `as_unix`) take a leading `self_`.
  - `FileDescription_provided` holds the defaults.
  - `insert_new(fd)` returns an `FdNum`. I cast its `Pending<"impl FileDescription">` parameter.
  - `metadata()` returns `Either` from rustc_middle/mir/mod.ts.
- **shims-b, io_error.rs:** `IoError_from_ErrorKind(kind)`, the `From<io::ErrorKind>` at io_error.rs:46. shims-b
  reports that src/std/io.ts has no `ErrorData::Simple`. Until root adds it, they build `SimpleMessage`. The errno is
  the same; only an `io::Error` Debug would differ. That is a root `src/std` item.
- **shims-b, sig.rs:**
  - `shim_sig(abi, args, ret)` / `shim_varargs(...tys)` take string type specs that follow the macro's rules
    (`"*libc::timespec"`, `"..."`, …).
  - `check_shim_sig_variadic` / `check_varargs` take those closures. My call sites wrap them so the helper is looked
    up only when the `check_*` fn evaluates the closure.
- **shims-c, readiness.rs:**
  - `Readiness_EMPTY`, `ReadinessWatched_default()`, and the method `watched.drop()`, the `Drop` at readiness.rs:380.
  - The `Rc<ReadinessWatcher>` protocol: `Rc_new_ReadinessWatcher()`, `Rc_clone_ReadinessWatcher(w)` and
    `Rc_drop_ReadinessWatcher(w)`, which runs `Drop` at 0.
  - The declared methods are used as declared, including `active_()`.
- **shims-d, unix/fd.rs:** `UnixFileDescription_provided`. Its `as_socket` takes a leading `self_`.

## PORT decisions

1. **Sync objects are hand classes.** `PthreadMutex`, `PthreadRwLock`, `PthreadCondvar` (unix/sync.ts) and
   `LinuxFutex` (linux_like/sync.ts) need the exact `instanceof` type test (the decision after the miri-threads
   review). The generated types are interfaces, because they have no inherent impl and so no auto class. Each is a hand
   class here that implements the generated interface and shadows its `export *` name.
   - The derived `Clone` (`clone_PthreadMutex`, …) is redefined to build the class, because the clone is what
     `init_immovable_sync` stores. The generated `debug_*` still apply.
   - `impl SyncObj for LinuxFutex {}` copies `SyncObj_provided`.
   - The cleaner alternative is for root to add these four types (and `Epoll`, `EventFd`) to the `class` list of set
     `miri` in `tools/codegen/types.sets.json`. That is a tools edit outside this lane.
2. **`Epoll` / `EventFd` are hand classes too**, for the exact downcast.
   - Their non-overridden `FileDescription` / `UnixFileDescription` methods delegate at call time to the `_provided`
     tables.
   - They do not say `implements FileDescription`, because the skeleton's interface has no `self_` yet. Add it after
     shims-b's interface fix.
   - `drop_glue()` is the field drop glue: `EventFd.watched` runs `watched.drop()`, and `Epoll.watcher` runs
     `Rc_drop_ReadinessWatcher`.
3. **Rc fidelity.** Every `FileDescriptionRef` is `drop()`ped exactly where Rust drops it: every exit of the owning fn,
   in reverse declaration order (`try`/`finally` in epoll), and after `finish.call(..)` returns, as Rust drops locals
   after the return expression. A handle is moved, not dropped, into `update_fd_readiness`, a `callback!` capture, a
   recursive `eventfd_read` / `eventfd_write`, or `downcast`. The epoll_wait callback drops its `epfd` capture when its
   body ends.
4. **Each `callback!` is built from one capture list** (miri-wire API), with upstream's exact captures:
   - futex: `dest`;
   - epoll_wait: `epfd, dest, event`;
   - eventfd_write: `num, buf_place, finish, eventfd`;
   - eventfd_read: `buf_place, finish, eventfd`.

   `u64` uses `VisitProvenance_no_provenance`, `MPlaceTy` uses `VisitProvenance_MPlaceTy`, `DynMachineCallback` uses
   `VisitProvenance_object`, and `FileDescriptionRef` uses its `visit_provenance` (files.rs:101, a no-op).
5. **u32 bit operations** in epoll are kept unsigned with `>>> 0`, because `EPOLLET` is `0x80000000`. `{:#x}` of an
   `i32` prints two's complement, like Rust's `LowerHex`.
6. **Type mapping.**
   - The eventfd counter `Cell<u64>` is a `bigint`. `MAX_COUNTER` is `2^64 - 2`, and `checked_add` is a range check.
   - `ecx.tcx.sess.target.os` is `this.tcx.deref().sess.target.os`, following the helpers.ts precedent.
   - `Cell<bool>::replace(true)` on the machine's `pthread_*_sanity` flags is read-then-set.
7. **`ArrayIterator::next` is called with `this_ as never`**, the helpers.ts precedent: it is declared over the CTFE
   `InterpCx`.
8. **The `throw_ub_format!` / `throw_unsup_format!` helpers are file-local**, as in sync.ts and helpers.ts.
   `throw_machine_stop` comes from helpers.ts (`TerminationInfo_into_machine_stop`). The `assert_eq!` / `assert_ne!`
   panics use Rust's message shape.

## `unported(...)` left

None in these files. Upstream paths that need other lanes go through those lanes' declared or agreed APIs:
`accept4` (socket.rs, shims-d A3), `unix_gettid` (unix/env.rs, shims-c), `pthread_self` / `pthread_setname_np` /
`pthread_getname_np` (unix/thread.rs, shims-c) and `gen_random` (helpers.rs).

## Signatures others call (unchanged from the skeleton)

`futex(ecx, varargs, dest)`, `syscall(ecx, link_name, abi, args, dest)`, `prctl(ecx, link_name, abi, args, dest)`, and
the `InterpCx` methods as declared. New exports: the classes `PthreadMutex`, `PthreadRwLock`, `PthreadCondvar`,
`LinuxFutex`, `Epoll` and `EventFd`, plus `is_Epoll` and `is_EventFd` (the downcast type tests, for unix/fd.ts or
poll.rs users).

## For root

- Integration order: merge shims-b, shims-c and shims-d first, then delete the matching blocks in
  `linux_like/mod.ts`, then run tsc.
- Possible codegen follow-up: the `class` list (PORT decision 1).
- `src/std/io.ts` needs `ErrorData::Simple(kind)` (raised by shims-b).
