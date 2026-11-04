# Handoff: lane fixers-38 (the port-side queue from the wave 38 reviews)

Branch `t3/fix-wave-38-miri-issues`, based on `integ-w38` at `b79919b0`. `integ-w38` has moved since (harness-w39). A dry-run
merge with `688895b6` has no conflicts, but nothing was run on that merge.

## Items

| Item | Status |
|---|---|
| 1. `miri-x86-a` O1, stderr order | done, `213ebecb`; tests needed `fdb11690` too |
| 2. `miri-tail-a` O1, `--print sysroot` | done, `eef3a2e0`: it stops; no small real path exists |
| 3. `miri-tail-b` N1, `send` / `recv` | done, `104802c2`, trimmed in `72be54b3` |
| 4. `target-cpu-implies-target-feature.rs` | done, `c01f8f2f`: answer from a committed oracle fixture; other CPUs still stop |
| 5. `miri-tb-b` 1, 2; `miri-tb-a` F2 | done, `2a599aba` |
| 5. `miri-x86-b` 1, negative gather offsets | done, `f8164d61` |
| 5. `miri-tail-b` N3, 5 surviving mutations | done, `104802c2` |
| 5. `miri-x86-a` N4, threaded `pause` | done, `04033b6d` |
| 6. `miri-x86-a` N2, N3, N5, N6 | done, `04033b6d` |
| 6. `miri-x86-a` N1 | code side done, `04033b6d` (`driver.mts` is deleted); `docs/handoff/miri-x86-a.md:99-100` not done, outside `src/` |
| 6. `miri-x86-a` N7 | not done: `docs/handoff/miri-x86-a.md:103-104`, outside `src/` |
| 6. `miri-x86-b` 2 | not done: `docs/handoff/miri-x86-b-probe/e2e.ts:22`, outside `src/`; pass `--timeout-ms 3600000` |
| 6. `miri-x86-b` 3, 4 | not done: `docs/handoff/miri-x86-b.md:18,23,96,98`, outside `src/` |
| 6. `miri-x86-b` 5 | done, `785fc4ff` |
| 6. `miri-tb-a` F3, F4, F5; `miri-tb-b` 4 | done, `785fc4ff` |
| 6. `miri-tail-a` N2, N3, N4 | done, `785fc4ff` |
| 6. `miri-tail-b` N4 | done, `104802c2` |
| 6. `miri-tail-b` N5, N6 | done, `785fc4ff` |
| 6. `followups-37` N1, N2 | done, `785fc4ff` |
| 6. `followups-37` N3 | not done: `docs/handoff/followups-37.md:56`, outside `src/` |

## Item 1: cause, and what it can affect

Reading `process.stderr` or `process.stdout` makes a pipe on that fd non-blocking. `.write` then writes what fits and queues the
rest for the event loop. Measured on Bun 1.4.3, this has three effects, and the review saw only the first:

- **Order:** a later synchronous write overtakes the queue.
- **Loss:** `process.exit` drops the queue. 200,000 bytes arrived as 131,072 through a shell pipe.
- **`EAGAIN`:** a later raw `writeSync(2)` loop throws once the pipe is full.

The threshold depends on the parent: about 64 KiB for a shell pipe, and between 600,000 and 2,000,000 bytes for `Bun.spawn` (what
difftest uses). `spawnSync` did not show it at 164 KB.

Every non-test writer under `src/` now goes through `write_stdout` / `write_stderr` in `src/std/io.ts` (137 sites in 65 files). The raw
fd 2 loops that did not retry `EAGAIN` use them too, and `is_tty` uses `isatty(1)`. A test in `src/std/io.test.ts` keeps
`process.std{out,err}.write` out of non-test code under `src/`.

**Protected cases: none affected.** The allocation dump path appears in 3 cached oracle outputs, all under 3.2 KB and none in a baseline:
`tests/fail/uninit/padding-enum.rs`, `tests/fail/uninit/padding-wide-ptr.rs`, `tests/fail/intrinsics/ptr_metadata_uninit_thin.rs`. This
assumes the cache holds every protected case. The other old writers wrote only a crash message or stdout with nothing after them. I
did not run a full suite.

## For root

- **Same pattern outside `src/`:** 5 files under `scripts/`, `harness/` and `tools/` still use `process.std{out,err}.write`, for example
  `scripts/difftest.ts:1008`. I did not check them for large writes followed by `process.exit`. They need a harness batch.
- **`harness/scope.json`:** `miri.partial` for `shims/unix/socket.rs` should list `send` and `recv`, and its reason ("with isolation on no
  socket fd exists") is now false. Until then `--missing` says `1/1` and does not count them. Same batch as `miri-tail-b` N2.
- **Decision to record:** `ORACLE_TARGET_CPU_FEATURES` (`src/rust_ts/codegen_backend.ts`) is oracle data held per target and CPU, with one
  entry, `x86_64-unknown-linux-gnu` + `x86-64-v4`, written by hand from the probe's output. The generator is under `tools/`, so a later
  batch could own it. `--print cfg` (alone and with `-C target-feature`) checks it against the live oracle, and a test checks it is closed
  under `implied_target_features`.
- **Upstream tests under `pass-dep`:** no suite runs them, so `libc-pipe`, `libc-socketpair` and `libc-socketpair-no-blocking` are not
  regression-protected. `tests/fail` has no socket cases in `miri-fail`.
- **`tests/ui/test-attrs/terse.rs`:** TIMEOUT in my `run-fail-miri` sample and alone at load about 5. Not protected, and the `miri-tail-a`
  review already measured it at 173-194 s CPU.
- **`x86.test.ts` under load:** the per-test limit is now 5 minutes. Lanes at high load can set `RUST_TS_X86_TEST_TIMEOUT_MS`.
- **Merge note:** `miri-perf` was to change interpreter hot paths; my edits in `src/miri` outside tests are small, but I did not merge with it.

## Evidence

Oracle comparisons of upstream's tests, stdout, stderr and exit, oracle exit first:

| Test | Result |
|---|---|
| `pass/shims/unix-socket.rs` | exit 0, MATCH |
| `pass-dep/libc/libc-pipe.rs`, `libc-socketpair.rs`, `libc-socketpair-no-blocking.rs` | exit 0, MATCH |
| `pass/shims/pipe.rs` | exit 0, MATCH |
| `fail-dep/libc/socketpair-data-race.rs`, `socketpair_block_read_twice.rs`, `socketpair_block_write_twice.rs` | exit 1, MATCH |
| `pass/target-cpu-implies-target-feature.rs` (`--suite miri-pass`) | MATCH |

The `-dep` tests ran with `--extern libc=<sysroot>/liblibc-*.rmeta -Zcrate-attr=feature(rustc_private)`, not ui.rs's full argv. A first run
with the `.rlib` made both sides fail to compile and "match"; those results were discarded.

Mutations, each killed by the new tests: the review's 5 for `virtual_socket.ts`; `send` and `recv` ignoring `is_non_block`; `send`'s `EBADF`;
two flag masks; `tree.ts` `perm.accessed`; the children sort; `reverse()` in the traversal; `to_uint` at the gather offset; removing `pause`'s
yield; each writer back to `process.std*.write`. **One survivor:** reversed child pushes in `tree_visitor.ts` pass programs A and B; the
review says `tree_visitor.test.ts` catches that, and I did not rerun it.

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | `markers ok (24709; vendor 5076; library 590)` |
| `bun test src/miri src/std` on `fdb11690`, `RUST_TS_REQUIRE_PROBES=1` | 478 pass, 0 fail, 215 s |
| `bun test` of all 30 touched crates on `785fc4ff` | 4,062 pass, 1 skip, 3 fail |
| those 3 failures | all `src/miri/bin/miri.test.ts`, from item 1; fixed in `fdb11690`, 13 pass with `src/std/io.test.ts` |
| `miri-hello` | MATCH 1/1 (`20261104-114050-fixers-38-ifm0`) |
| `check-ui --sample 100` | MATCH 100/100 (`20261104-114053-fixers-38-9skg`) |
| `mir --sample 100` | MATCH 100/100 (`20261104-114111-fixers-38-47xu`) |
| `run-pass-miri --sample 100` | MATCH 100/100 (`20261104-114132-fixers-38-jyd5`) |
| `run-fail-miri --sample 60` (extra) | MATCH 59, TIMEOUT 1, `terse.rs` above (`20261104-114338-fixers-38-2iri`) |
| `lex`, `symbols` samples (extra, on `213ebecb`) | MATCH 30/30, 10/10 |

I did not rerun the other 28 crates after `fdb11690`, which changes only `src/std/io.ts` (a capture check in the two writers) and
`miri.test.ts`. I did not identify the 1 skip by name; root's run at `df0180bc` also had 1. The AVX fixtures were not rerun end to end through
`e2e.ts`: only the 16 new gather lines ran through the real driver, and they match.

**Test CPU added:** about 48 s user and 11 s sys, measured at load 7-14, slightly overstated because it includes `io.test.ts`'s older tests. That
is about the one-minute limit. `socket_ops.rs` is the largest at about 25 s. It needs the 212,992-byte buffer fill and many `println!`s.

## Coverage

`--missing src/tools/miri/src/shims/unix/socket.rs` says `1/1 ported`, because only `socket` is in scope in `harness/scope.json` (above).
`send` and `recv` carry markers at `socket.rs:418` and `:497`, which `--check` accepts. `VecDeque_u8` has 5 new `// std:` markers.

## `unported(...)` left or added

- `socket.ts`: `TcpSocket::new`, and `bind`, `listen`, `accept4`, `connect`, `setsockopt`, `getsockopt`, `getsockname`, `getpeername`, `shutdown`.
- `socket.ts` (new): `send` / `recv` with a length of 2^53 bytes or more.
- `filesearch.ts` (new): `--print sysroot` and `target-libdir` without `--sysroot`.
- `codegen_backend.ts`: `-C target-cpu` for any CPU and target outside the table. `--emit=metadata` with `-C target-cpu=x86-64-v4` stops at
  `Encodable for TargetModifier`, because `target_cpu` is a target modifier.

## `// PORT:` decisions

- `stdio_write_all` retries `EAGAIN`, because Bun can leave these pipes non-blocking.
- `write_stderr` and `write_stdout` panic like `print_to` when a write fails, which includes driver crash reports: a closed reader with an
  `EPIPE` turns exit 70 or 101 into an uncaught panic. Nobody is reading stderr in that case.
- `set_output_capture` (`stdio.rs:1158`) is ported with an array of chunks as the sink, so tests can read an in-process `eprintln!`.
- `displayed_sysroot_path`: a path under the stand-in stops rather than being printed.
- `oracle_target_cpu_features`: see "Decision to record".
- `read_send_recv_args` and `finish_send_recv` factor out the common part of `send` and `recv`, which upstream writes out twice.
- `tree/tests.test.ts`: upstream's second `impl LocStateProtPair` is on the prototype, so markers run in upstream order.
