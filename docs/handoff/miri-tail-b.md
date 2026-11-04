# Handoff: miri-tail-b (wave 38: virtual sockets, `pipe2` / `socketpair`)

Branch `t3/port-miri-virtual-sockets`, port commit `98f91b02`, base `1d221bff`.

Scope: `shims/unix/virtual_socket.rs` into `src/miri/shims/unix/virtual_socket.ts`, and the `socketpair` / `pipe` / `pipe2`
arms of `shims/unix/foreign_items.ts`.

All measurements were taken while load was 60 to 390 from the other lanes. Timeouts below are not results, so they are
reported as undetermined, not as failures.

## Needs root

1. **Protected cases not confirmed.** See "Sample" below: 6 protected cases timed out in the sample and again when rerun
   alone. They matched in `gate-20261102-174727-root-kxpt`. Results of the last pass are in "Final pass".
2. **`harness/scope.json`** still lists `shims/unix/virtual_socket.rs` under `miri.excluded`. Not edited (brief). Until it
   is removed, `coverage.ts --missing` prints an out-of-scope note, though it reports 21/21, and the file is presumably not
   counted in the Miri totals (not checked).
3. **Two edits outside the assigned files**, both needed for the task. Please review them:
   - `src/miri/lib.ts`: one import line, to load the module.
   - `src/miri/contract.test.ts`: `virtual_socket` removed from `OUT_OF_SCOPE`, `IN_SCOPE` 101 → 102, lane `miri-tail-b`
     added. Without this the contract test fails, because a module mirrors an excluded file. It only reflects your recorded
     scope decision, but it is a test expectation that I changed.
4. **`socket.ts` is now wrong, and I did not edit it (not assigned).** Its header and `socket_out_of_scope` text say "with
   isolation on no socket fd exists", which `socketpair` makes false. `send` and `recv` (socket.rs:418, :497) are now
   reachable. The port stops `unported` where the oracle succeeds: `UnixStream::pair()` then `write_all` prints `[104, 105]`
   on the oracle and stops at `miri::shims::unix::socket::EvalContextExt::send` on the port. No `tests/ui` file mentions
   `UnixStream::pair` or `socketpair` outside a sanitizer list, so this should not move a suite. The
   `UnixSocketFileDescription` trait's provided methods are also unported.
5. **The brief's case list differs from the gate's rows.** `tests/ui/process/nofile-limit.rs` is not a `pipe2` row: it stops
   at `rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)`, as it did in the gate, so this lane does not
   affect it. The 10 `pipe2` rows are listed under "The 10 cases".
6. **`docs/handoff/miri-contract.md`** "Scope" still lists `virtual_socket`. Not edited.

## Files touched

- New: `src/miri/shims/unix/virtual_socket.ts`, `virtual_socket.test.ts`, `virtual_socket.oracle.txt` (fixture).
- New: `docs/handoff/miri-tail-b-probe/` (`probe.rs`, `metadata.rs`, 24 `err_*.rs`, `run.sh`, which regenerates the fixture
  with the isolated Miri).
- Edited: `src/miri/shims/unix/foreign_items.ts` (three arms, header note), `src/miri/lib.ts`, `src/miri/contract.test.ts`.

## Coverage

`bun scripts/coverage.ts --missing src/tools/miri/src/shims/unix/virtual_socket.rs`: **21/21 ported**, with the out-of-scope
note from item 2. `coverage.ts --check --offline` before the last small edits: `markers ok (24416; vendor 5050; library 584)`.

## The 10 cases

Before the last small edits (see "Not covered"): all 10 MATCH. Runs `20261103-224146-miri-tail-b-3fis` (`--filter
tests/ui/process/`: 30 of 31 MATCH, the other is `nofile-limit`), `...-64zd` (backtrace), `...-ibnu` (abort-on-panic).
`issue-14456` also matched in the sample on the commit. The rerun on the commit is in "Final pass".

Cases: `tests/ui/backtrace/backtrace.rs`, `tests/ui/panics/abort-on-panic.rs#current`, `#next`, and under
`tests/ui/process/`: `core-run-destroy`, `issue-13304`, `issue-14456`, `issue-30490`, `println-with-broken-pipe`,
`process-status-inherits-stdin`, `sigpipe-should-be-ignored`.

No new stops on these cases.

## Sample (`--suite run-pass-miri --sample 200`, on `98f91b02`)

Run `20261103-233411-miri-tail-b-c0y3`, detached, load about 120 to 230: **MATCH 178, UNPORTED 5, TIMEOUT 17, DIFF 0, CRASH
0.** The printed 89% is not a measure of the port, because of the timeouts.

- UNPORTED 5, none of them a MATCH in the gate: `each_linked_rlib` (2), `configure_llvm` (2), `getaddrinfo` (1, which keeps its
  `unported` by the brief).
- Compared with the gate: gained `tests/ui/process/issue-14456.rs`. No case lost other than the 17 timeouts below.
- TIMEOUT 17, all MATCH in the gate. difftest's own alone-rerun timed out too. Rerun one at a time with `--jobs 1` (60 s limit,
  load 68 to 390, `$RUST_TS_DATA/tmp/miri-tail-b/alone.txt`):
  - **11 MATCH**: `for-loop-while/break`, `for-loop-while/while-with-break`, `generic-associated-types/collections`,
    `generic-associated-types/iterable`, `generics/autobind`, `higher-ranked/trait-bounds/issue-39292`,
    `impl-trait/type-alias-generic-param`, `intrinsics/const-eval-select-x86_64`, `intrinsics/volatile-composite-types`,
    `iterators/rangefrom-overflow-overflow-checks`, `let-else/let-else-non-copy`.
  - **6 undetermined, TIMEOUT again**: `consts/issue-23833`, `drop/drop-order-comparisons#e2021`,
    `mir/validate-various-comparison-behavior`, `moves/move-3-unique`, `recursion/recursion-tail-cps`,
    `rfcs/rfc-2091-track-caller/std-panic-locations#default`.

## Other checks

- `bun test src/miri`:
  - First full run, same code as `98f91b02`: **256 pass, 0 fail** (155 s).
  - Second full run, load over 100: 254 pass, 2 fail, both timeouts:
    - `src/miri/math.test.ts` "host float operations (f16)": alone, **7 pass, 0 fail** (187 s).
    - `virtual_socket.test.ts` "the port runs probe.rs": timed out at 600 s, also when rerun alone (11 pass, 1 timed out). Its
      partial stdout agrees with the oracle up to where it was killed. The same program run directly with no time limit took
      430 s and its 66 stdout lines and exit code are **identical to the fixture**.
- `--suite miri-hello`: MATCH 1/1 (run `20261103-225306-miri-tail-b-2uqw`).
- `bunx tsc --noEmit -p .`: 0 errors, after the last small edits.
- Oracle comparison, port against the fixture, whole programs:
  - `probe.rs`: identical (above). Covers fd numbers, flags, both directions, close, EOF, EPIPE, EBADF, EAGAIN, partial writes,
    blocking across threads, the data-race clock, `FIONBIO`, epoll (level and edge), `EPOLLERR` from lost data, `poll`, `dup`.
  - The 24 `err_*.rs`: exit code and first error line identical, including the data-race and deadlock programs.
- Mutation checks, each reverted and each failing the named test: reading the whole buffer instead of the front slice, no head
  reset, `handle_capacity_increase` case B removed, EBADF for EPIPE, no `peer_lost_data`.

## Not covered

- **`metadata` on the port end to end.** `fstat` needs isolation off, and the port stops there at `mio::Poll::new (host I/O,
  isolation off; plan-m6 D5)`. The oracle's modes are in the fixture and are checked only on the stand-in machine.
- **Trace-level comparison.** `bun scripts/miri-diff.ts docs/handoff/miri-tail-b-probe/probe.rs` died with `RangeError: Out of
  memory` in `writeTrace` (`JSON.stringify`, scripts/miri-diff.ts:106), writing the oracle's `MIRI_LOG=info` trace. Scripts are
  not mine to edit. Only stdout, exit code and first error line were compared.
- **The 24 `err_*.rs` were compared before the last small edits** and not rerun: `else if (n !== 0)` → `else` in
  `VecDeque_u8.read` (`n` is at least 1 whenever the deque is non-empty and `len > 0`), `flags` → `flags!`, and type-only
  changes. The stand-in tests, which ran after those edits, check the error text of the 13 unsupported-operation paths.
- **`debug_VirtualSocket` / `debug_Buffer`**: hand-written in the generated shape, no caller and no oracle check. A `peer_fd` value
  stops at `debug_WeakFileDescriptionRef`'s existing `unported_debug`.
- **Gate:** not run (root only).

## A test cost to know about

The end-to-end test takes about 23 s on a calm machine (probe run alone), 82 s with the suite under moderate load and 430 s at
load about 90. Its limit is 600 s, so it can time out when the machine is this busy, as it did twice. It skips with a printed
reason if the Miri sysroot is missing and fails instead under `RUST_TS_REQUIRE_PROBES=1`.

## Upstream behavior worth knowing

The oracle deadlocks when a blocked `read` or `write` waits on a peer that then closes (`err_pipe_read_peer_close`,
`err_pipe_write_peer_close`). `Drop for VirtualSocket` only queues a readiness update and does not touch `blocked_*_tid`,
despite its comment. The port does the same.

## `unported(...)` left

None in `virtual_socket.ts`. In `foreign_items.ts`, `getaddrinfo` / `freeaddrinfo` keep theirs (brief).

## `// PORT:` decisions

- **`VecDeque_u8`**: a model of the real ring buffer. `Read for VecDeque<u8>` reads only the front slice, so a wrapped buffer
  gives a short read that the program sees (oracle: `wrap short read` returns 4 of 7 bytes). The result depends on growth (`max(8,
  2 * cap, needed)`), `handle_capacity_increase` and `drain` resetting the head. It lives in this file with plain comments and no
  `rustc:` markers, since `src/std` is not mine to edit; root may want to move it.
- **Hand types.** `VirtualSocket` / `Buffer` / `VirtualSocketType` are hand-written because the file is not in codegen set `miri`.
  Trait impls go through `port_methods` (eventfd precedent), with the `_provided` tables for what is not overridden.
- **`peer_fd()` is `peer_fd_()`**, because the field `peer_fd` exists.
- **Handles** are dropped where Rust drops them: after the return expression, locals before parameters, moved into
  `update_fd_readiness`, callbacks, recursive calls and `delayed_readiness_updates.add`. `as_socket` on a pipe drops its handle.
- **`drop_glue()`** is `Drop::drop` then `watched.drop()`, the only field whose drop is observable.
- **`OnceCell::set(..).unwrap()`** on fresh cells is a plain assignment; it cannot fail.
- **`Scalar == Scalar` in `ioctl`** compares against an `eval_libc` integer, so a pointer operand is simply unequal.
- **`Rc<DelayedReadinessUpdates>`** is the machine's object; its count is not observable.

## Setup in this worktree

Copied `.env.local` from the main checkout (gitignored) and ran `bun install --frozen-lockfile`. Oracle toolchain untouched; the
probes use the isolated Miri. Scratch and logs: `$RUST_TS_DATA/tmp/miri-tail-b/`.

## Final pass

Pending: 10 cases, the 6 undetermined cases, `tsc` and markers on the commit. Log: `$RUST_TS_DATA/tmp/miri-tail-b/final.txt`.
