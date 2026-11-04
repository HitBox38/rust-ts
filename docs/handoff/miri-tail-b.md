# Handoff: miri-tail-b (wave 38: virtual sockets, `pipe2` / `socketpair`)

Branch `t3/port-miri-virtual-sockets`, port commit `98f91b02`, base `1d221bff`.

Scope: `shims/unix/virtual_socket.rs` into `src/miri/shims/unix/virtual_socket.ts`, and the `socketpair` / `pipe` / `pipe2`
arms of `shims/unix/foreign_items.ts`.

Most measurements were taken while load was about 50 to 390 from the other lanes. Timeouts below are not results, so they
are not reported as failures.

## Needs root

1. **One protected case has no difftest MATCH here:** `tests/ui/moves/move-3-unique.rs`. It keeps exceeding the suite's 60 s
   limit under load (port 252 s at load about 65, oracle 16 s). Run with no limit, its exit code, stdout and stderr are
   byte-identical to the oracle's, so I see no divergence. It matched in `gate-20261102-174727-root-kxpt`, and the gate on a
   quiet machine is the check that settles it. The other 16 timed-out sample cases MATCH (see "Sample").
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
   on the oracle and stops at `miri::shims::unix::socket::EvalContextExt::send` on the port. No `tests/ui` `.rs` file
   mentions `UnixStream::pair` or `socketpair`, though indirect use through std was not ruled out. The
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
note from item 2. `coverage.ts --check --offline` on `98f91b02`: `markers ok (24416; vendor 5050; library 584)`.

## The 10 cases

**All 10 MATCH on `98f91b02`**, each run alone with `--jobs 1` (`$RUST_TS_DATA/tmp/miri-tail-b/final.txt`). They also matched
before the last small edits (runs `20261103-224146-miri-tail-b-3fis`, where `--filter tests/ui/process/` gave 30 of 31 MATCH
with `nofile-limit` the other, `20261103-224212-miri-tail-b-64zd` and `20261103-224217-miri-tail-b-ibnu`).

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
  - **6 TIMEOUT again**, rerun the same way at load 52 to 73 (`final.txt`):
    - 5 MATCH: `consts/issue-23833`, `drop/drop-order-comparisons#e2021`, `mir/validate-various-comparison-behavior`,
      `recursion/recursion-tail-cps`, `rfcs/rfc-2091-track-caller/std-panic-locations#default`.
    - `moves/move-3-unique`: no MATCH line (over the 60 s limit a third time). Compared raw with no limit, in the suite's cwd:
      exit 0/0, stdout 0/0 bytes, stderr 295/295 bytes, both identical. This is not difftest's verdict.

So of the 200: 194 MATCH across these runs (178 + 11 + 5), 5 UNPORTED, 1 timing out (`move-3-unique`). This adds runs together
at different loads; it is not one clean run, and the sample's own figure stays 178.

## Other checks

- `bun test src/miri`:
  - First full run, same code as `98f91b02`: **256 pass, 0 fail** (155 s).
  - Second full run, load over 100: 254 pass, 2 fail, both timeouts:
    - `src/miri/math.test.ts` "host float operations (f16)": alone, **7 pass, 0 fail** (187 s).
    - `virtual_socket.test.ts` "the port runs probe.rs": timed out at 600 s, also when rerun alone (11 pass, 1 timed out). Its
      partial stdout agrees with the oracle up to where it was killed. The same program run directly with no time limit took
      430 s and its 66 stdout lines and exit code are **identical to the fixture**.
- `--suite miri-hello`: MATCH 1/1 (run `20261103-225306-miri-tail-b-2uqw`).
- `bunx tsc --noEmit -p .` on `98f91b02`: 0 errors.
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
  changes. The stand-in tests, which ran after those edits, check 12 of those programs' error text against the fixture.
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

