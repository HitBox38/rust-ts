# Review: miri-tail-b (`shims/unix/virtual_socket.rs`, `pipe2`, `socketpair`)

Branch `t3/port-miri-virtual-sockets`, head `a3756373`, port commit `98f91b02`, merge base `1d221bff`. Independent and
read-only: no lane code was edited. Upstream is `src/tools/miri/src/shims/unix/virtual_socket.rs` at the pin.

## Verdict: APPROVE WITH NITS

The port is faithful. I found no wrong result and no logic difference from upstream. Every program that gets past the
unported socket shims matches the oracle in stdout, stderr and exit code. The nits are stale text, a scope entry and test
gaps, and none of them changes output.

**Root should read A1 before the next gate.** It is not caused by this lane: the protected case
`tests/ui/moves/move-3-unique.rs` runs over its 60 s limit on both base and head, even with the machine nearly idle.

## Findings

| id | severity | where | finding |
|---|---|---|---|
| N1 | low | `src/miri/shims/unix/socket.ts:10-13`, `:133` | Stale text, and a follow-up root must decide |
| N2 | low | `harness/scope.json:33` | File still excluded, so coverage does not count it (harness batch) |
| N3 | low | `src/miri/shims/unix/virtual_socket.test.ts` | Mutations that no test catches |
| N4 | nit | `src/miri/shims/unix/virtual_socket.test.ts:46-58` | The end-to-end test costs more than the handoff says, and does not check stderr |
| N5 | nit | `src/miri/shims/unix/virtual_socket.ts:88-182` | `VecDeque_u8` is std code living in a shim file |
| N6 | nit | `src/miri/shims/unix/virtual_socket.ts:203` | `new VClock([])` where `VClock.default()` exists |
| A1 | **gate risk, not this lane** | `harness/baseline/run-pass-miri.txt` | A protected case runs over its limit at both commits |

### N1: `socket.ts` is stale, and `send` / `recv` need a decision

**Text.** `socket.ts:133` prints "with isolation on no socket fd exists", which `socketpair` now makes false. `socket.ts:12-13`
says `socketpair` / `pipe2` stop `unported` first, which is also false. It adds "the lane that ports virtual_socket.rs must
port these too". The root decision (`history.jsonl:596`, "pipe2, socketpair; not network") did not include them, so the lane
was right to leave them, but the two statements conflict. Root should record which one holds.

**Scenario.** `UnixStream::pair()` then `write_all` prints the false text and exits 70. This is a **loud stop, not a wrong
result**:

| program | oracle exit | port | stops at |
|---|---|---|---|
| `us_write`, `us_read` | 0 | 70 | `send` |
| `us_read_only` | 0 | 70 | `recv` (`set_nonblocking` works first) |
| `us_addr` | 1 | 70 | `getpeername` |
| `us_shutdown` | 1 | 70 | `shutdown` |
| `us_take_error` | 1 | 70 | `getsockopt` |
| `us_timeout` | 1 | 70 | `setsockopt` |
| `sock_send_pipe` | 0 (`ENOTSOCK`) | 70 | `send` |
| `sock_recv_peek` | 1 | 70 | `recv` |
| `us_nonblock_clone` (pair, FIONBIO, `try_clone`, drop) | 0 | 0, identical | none |
| `us_dgram` (`UnixDatagram::pair`) | 1 | 1, identical | none |

Before the stop, stdout never disagrees: where it differs, the port's is empty or a prefix of the oracle's.

**Why it matters soon.** No `tests/ui` file names `UnixStream`, `UnixDatagram`, `UnixListener`, `os::unix::net` or `socketpair`,
so `run-pass-miri` is not affected. Upstream Miri's own tests are: `pass-dep/libc/libc-pipe.rs`, `libc-socketpair.rs`,
`libc-socketpair-no-blocking.rs` and `pass/shims/unix-socket.rs` all stop here. They will read UNPORTED if `miri-pass`
(harness-m6c, M6b needs >= 80%) includes them.

**Fix.** Correct the text, and queue `send` / `recv` plus the `UnixSocketFileDescription` trait as a small lane if M6b needs
them. `VirtualSocket.send` and `.recv` have no caller until then, and are checked only on the stand-in.

### N2: `harness/scope.json` still excludes the file

**Scenario.** `coverage.ts --missing .../virtual_socket.rs` prints "is out of scope" next to `21/21 ported`, and the Miri
totals leave the file out. Removing line 33 in a scratch copy took the total from `1199/1514 (79.19%)` to `1220/1535 (79.48%)`,
with `--check` unchanged at `markers ok (24416)`. It does not fail anything today, and no test ties `OUT_OF_SCOPE` in the
contract test to `scope.json`, which now disagree.

**Fix.** Delete `"shims/unix/virtual_socket.rs"` from `miri.excluded`. This **belongs in a harness batch** (AGENTS section 2:
changes to `harness/` need their own reviewed batch), not in this lane. `docs/handoff/miri-contract.md:73` lists the file too
and should change with it.

### N3: mutations no test catches

I ran 28 mutations of `virtual_socket.ts` against the stand-in tests, then ran the survivors through `probe.rs` end to end.
The stand-in tests caught 20. The other 8:

| mutation | line | stand-in | `probe.rs` |
|---|---|---|---|
| minimum capacity 8 → 4 | `:114` | survived | **survived** |
| `blocked_read_tid` not cleared | `:692` | survived | **survived** |
| `blocked_write_tid` not cleared | `:827` | survived | **survived** |
| non-blocking read at EOF returns EAGAIN | `:754` | survived | **survived** |
| handle leak on the EOF path | `:758` | survived | **survived** |
| `release_clock` does not join | `:669` | survived | caught (data race reported) |
| sticky `is_nonblock` in `set_flags` | `:462` | survived | caught (stdout differs) |
| `send` ignores `is_non_block` | `:545` | survived | not run: `send` is unreachable end to end (N1) |

**The code is correct today** on all of these: my `mincap`, `nb_eof`, `th_two_readers`, `th_two_writers` and handle tests pass.
These are gaps in regression protection, not bugs.

**Fix.** Add a small first write, a non-blocking read at EOF, and a second write after a woken reader to `probe.rs`, and add a
handle-release check. shims-d's tests already do this ("no handle leaks"). A ready version is in
`$RUST_TS_DATA/tmp/review-miri-tail-b/t/zz_review_handles.test.ts`. It catches the injected leak.

### N4: the end-to-end test in the gate's unit step

**Measured.** `probe.rs` on the port, with the same stdout and stderr as the oracle each time:

| load | CPU | wall | peak RSS |
|---|---|---|---|
| 6 to 9 (3 runs) | 61 to 73 s | 44 to 61 s | 1.4 GB |
| 20 to 30 | 75 s | 121 s | 1.4 GB |

The whole test file took 42 s at load about 4. **My estimate for an idle machine is 60 to 70 s of CPU and about 40 s of wall
time**, against the handoff's 23 s. CPU exceeds wall because Bun's GC and JIT threads count too.

**Is it appropriate? Yes, for now.** The last gate's unit step took 934 s against its 1800 s limit (`gate.ts:270`), and its
largest test file took 71 s, so this adds about 5%. The 600 s limit is only reached under load the gate does not run under. It
is the only coverage of this file through the real machine, and upstream's own tests stop at `send`. It is also the first test
under `src/` to run the whole Miri driver: the other spawning tests run `bun -e`.

**Suggested.** Lanes running `bun test src/miri` under load get false failures, as this lane did twice. Consider running it only
under `RUST_TS_REQUIRE_PROBES=1`, or moving it to a harness suite once `miri-pass` covers the same ground. Also assert stderr
(`:56-57` check only stdout and the exit code): the oracle's is empty, so a stray warning goes unnoticed.

### N5: `VecDeque_u8` lives in a shim file

The model is correct (see "2" below), but it is std code, which PORTING section 2 puts under `src/std/`, and it has no markers.
The lane could not edit `src/std/` and said so. Root may want to move it.

### N6: `new VClock([])`

Upstream calls `VClock::default()`, which exists at `vector_clock.ts:259` and does the same thing. Cosmetic.

### A1: `move-3-unique` is over its limit at both commits

**The lane is not responsible.** The test is a 10,000-iteration loop with no threads or pipes, so it never reaches this code.
`git diff ef00b86a 1d221bff -- src scripts harness tools` shows 3 files with 3,701 insertions, the size of the baseline growth,
so base has the gate's code. Alternating runs at load 3.5 to 10:

| run | head CPU / wall | base CPU / wall |
|---|---|---|
| 1 | 91.2 / 87.6 s | 85.2 / 77.1 s |
| 2 | 73.8 / 66.6 s | 82.7 / 75.2 s |
| 3 | 86.8 / 78.6 s | 83.6 / 76.2 s |
| mean CPU | **83.9 s** | **83.8 s** |

Control at the gate's own commit `ef00b86a`, load 3 to 5: 72.4 s CPU, 65.5 s wall. The oracle: 3.6 s CPU. Every completed run on
both sides is byte-identical to the oracle. Earlier runs at load 7 to 25 read 150 to 215 s CPU, with base no faster than head,
so CPU time inflates under load too.

**The risk.** The suite's limit is 60 s, and difftest's retry reruns the case alone with that same limit. On head at load about
4, difftest reports TIMEOUT, retry included (run `20261104-101423-review-miri-tail-b-jtgs`). The gate recorded MATCH only through
that retry. So the handoff's "the gate on a quiet machine settles it" is too hopeful: **the case may time out at the next gate
whichever revisions go in, and losing a protected case blocks acceptance.**

**Suggested.** Root and miri-perf should settle it before the gate, through a speedup or `MIRI_HEAVY` (a harness batch). The other
protected cases near 60 s may have the same problem; I did not survey them.

## What the brief asked

**1. The 21 fns.** All 21 are present, in upstream order, with correct names and markers (I checked each `fn` line);
`coverage.ts` reports 21/21 and `markers ok`. I read every path against upstream:

- **Handles.** Moved or released on every path, locals before parameters. A scratch test drove every read and write path including
  injected errors from `acquire_clock`, `release_clock`, `read_bytes`, `write_bytes`, `unblock_thread` and `update_fd_readiness`,
  closed both ends, and checked both descriptions were released: no leak, no double drop. The test does fail on an injected leak.
- **Exact class checks.** Upstream has no downcast to `VirtualSocket` (outside this file it appears only as
  `BlockReason::VirtualSocket`). `as_unix` and `as_socket` are casts of the same handle, so no `is_T` test applies. The `downcast`
  sites for `FileHandle`, `DirHandle` and `Epoll` take exact tests, and a `VirtualSocket` fails them.
- **Copy values.** Only primitives, `ThreadId` and `Pointer` are stored. Neither object is mutated in place (`active_thread` is
  reassigned, `thread.ts:547`). A pointer held only by a blocked read's callback survives the provenance GC (`th_gc`).
- **Clocks.** Release before the write and acquire before the read, as upstream. An EOF read does not synchronize
  (`th_race_after_read_empty` reports the race). `th_sync_clock` and upstream's `socketpair-data-race` and `libc-epoll-data-race`
  are identical.
- **Readiness.** The same points and flags as upstream, checked by reading and by `f_epoll_edge2`: edge-triggered epoll through
  writes, partial and full reads, full buffer, one-byte read, close and lost data.

**2. The ring buffer is the real model, not a fit.** I drove a verbatim copy of `VecDeque_u8` and native `std::collections::VecDeque<u8>`
from the pinned nightly with the same random stream: **884,895 operations, 400 seeds, sizes up to 250,000, 7,454 short reads, 1,383
distinct capacities, digest of every return value, byte, capacity and length: identical.** End to end, `growth.rs` covers growth
above doubling, cases A, B and C at larger capacities, a wrap at exactly 0x34000 (write 212992, read 10, write clamped to 10, short
read 212982, then 10), and doubling past the maximum. All 394 stdout lines and the exit code are identical. So is `mincap.rs`, with
first writes of 1 to 7 bytes.

**3. Peer close: the lane is right.** With the blocked thread confirmed blocked (a deadlock report requires it):

| program | oracle and port |
|---|---|
| `pc2_read_pipe`, `pc2_read_sp`, `pc2_write_pipe`, `pc2_write_sp` | exit 1, "the evaluated program deadlocked", identical |
| lane's `err_pipe_read_peer_close`, `err_pipe_write_peer_close` | same, identical |
| `pc2_read_then_more` (a `dup` of the write end still writes) | wakes, exit 0, identical |

With only a few yields, the other thread may not have blocked yet and gets EOF or EPIPE instead (`pc_read_sp`, `pc_write_pipe`,
`pc_write_sp`). That is timing, not a contradiction, and the port matches it too. Upstream's "can unblock reads and writes" comment
is not borne out for threads blocked in `read` / `write`: `Drop` only queues a readiness update. Upstream's
`test_unblock_after_socket_close` is a different case (a thread closes the fd main is blocked on, and a write wakes main), and it passes.

**4. foreign_items.** `socketpair`, `pipe` and `pipe2` have upstream's order, arguments, signatures and `check_target_os`; `pipe`
passes `None` for flags. Flag errors, null and short buffers, an uninit flag argument and every `socketpair` error text are
identical. `getaddrinfo` and `freeaddrinfo` still check the signature and then stop `unported`: `ga.rs` exits 70 on the port, 0 on
the oracle.

**5. `socket.ts`.** A loud stop, not a wrong result. See N1.

**6. Edits outside the assigned files: both legitimate; the contract test is not weakened.**

- `lib.ts`: one import line, as PORTING section 5 requires for extension modules. Every module still loads as a fresh entry point.
- `contract.test.ts`: the root decision narrowing D2 (`history.jsonl:596`) predates the lane, so this follows a recorded decision.
  It got stricter: the count stays pinned exactly (102), and the new file must exist, name its lane, have valid markers and load
  alone. Removing an exclusion only widens what is checked. It passes 8/8 on head.
- The lane disclosed both. Root should treat them as accepted exceptions to "edit only the files you were assigned".
- `scope.json`: see N2.

**7. Test quality.**

- The fixture comes from the isolated Miri: re-running `run.sh`'s logic in scratch gave a **byte-identical** fixture, and
  `~/.rustup/toolchains/nightly-2026-10-11-*/bin` has no `miri`, so the oracle toolchain is untouched.
- Tests assert fixture values. The exceptions are `c.updates`, `c.clocks` and the blocked lists, which the oracle cannot observe.
- **The handoff's open items are closed.** All **24 `err_*` programs on the final commit match in full stdout, stderr and exit
  code**, a stricter check than the lane's first error line.
- **`metadata` end to end matches.** Isolation off stops at `mio`, so I stubbed `Poll::new` and `Poll::poll` in a throwaway copy of
  `blocking_io.ts` that was never committed. The lane's `metadata.rs` and my `metadata2.rs` (every `fstat` field, closed and invalid
  fds, `statx`) are identical to the oracle.
- On head, the test file passes 12/12, `tsc` reports 0 errors, and `coverage.ts --check` is clean.
- The test's cost is in N4, its gaps in N3.

**8. The `pipe2` cases.** **All 10** are byte-identical to the oracle on head in stdout, stderr and exit code, each about 5 to 15 s
of CPU (raw comparison, not difftest's verdict). `tests/ui/process/nofile-limit.rs` is not one of them: it stops at
`configure_llvm`, as the handoff says. `move-3-unique`: nothing in this lane is responsible. See A1.

**Upstream Miri's own tests** (not in the brief, and the strongest independent check), compared in full:

| test | result |
|---|---|
| `libc-epoll-no-blocking`, `libc-epoll-blocking`, `libc-poll`, `pass/shims/pipe` | identical, exit 0 |
| `socketpair-data-race`, `libc-epoll-data-race`, `socketpair_block_read_twice`, `socketpair_block_write_twice`, `fcntl_fsetfl_while_blocking` | identical, exit 1 |
| `libc-pipe`, `libc-socketpair` | stop at `send`; with `send`/`recv` replaced by `write`/`read` in a scratch copy: **identical, exit 0** |
| `libc-socketpair-no-blocking` | stops at `recv`; the scratch copy still stops at a `recv` with `MSG_DONTWAIT` |
| `pass/shims/unix-socket` | stops at `send` |

## What I did not check

- **The gate and full suites**, per the brief. I did not rerun the `--sample 200`.
- **Trace-level comparison.** `miri-diff.ts` on `err_pipe_read_peer_close.rs` stops at 0 of the oracle's 42,204 records, because the
  port rejects the `miri=info` directive. That limitation is not this lane's. So only stdout, stderr and exit code were compared.
- **`send` and `recv` through the machine**, and their `MSG_DONTWAIT` paths: unreachable until N1, stand-in only.
- **`debug_VirtualSocket` and `debug_Buffer`.** No caller. I read them against the std formats only.
- **Non-Linux arms** (the `Os` checks for other targets): read only.
- **Other lanes' code** this relies on (`fd.ts`, `poll.ts`, `readiness.ts`, `epoll.ts`): exercised, not reviewed.
- **`libc-fstat-non-file.rs`** (needs isolation off), though `metadata2.rs` covers similar ground.
- **Idle-machine timing.** Load was never below about 3, so the figures for N4 and A1 are near-idle, and N4's idle value is an estimate.

**Interruptions.** The host rebooted once and T3 restarted twice during this review, wiping `/tmp`. These ran on `a3756373` before
the reboot and their outputs were lost, so the results above are as I recorded them then: the `VecDeque` differential, the fixture
regeneration, `metadata`, and the memory-error programs (out-of-bounds read, dangling and uninit writes, pointer bytes through a
pipe, short buffers). The `err_*` programs were rerun afterwards. The later programs and outputs are in
`$RUST_TS_DATA/tmp/review-miri-tail-b/`. No oracle output, baseline, suite or script was changed.
