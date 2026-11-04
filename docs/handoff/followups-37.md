# Handoff: followups-37 (port-side small queue from the wave 37 reviews)

Branch `t3/rustc-wave37-followups`, based on `c9d3c553`.

## Items

1. miri-shims-a M1 `write_bytes_ptr`: done (ab852dc2).
2. miri-shims-d M1, M2: done (a28bc0d1). Limited to what the port can reach; see "Gaps".
3. miri-shims-c L2, L4, L5, L6: done (669d5240). M1 already fixed by miri-wire-37 (typed calls; `drop_fd` is gone).
4. TLS `visit` test: done (743d6afa).
5. `clone_LoadInfo` Map keying: done (2db41c0b). It was keyed by object identity.
6. FFI tables: done (6f1a3556), keeping `lgamma_r` / `lgammaf_r` in their own `dlopen` group.
7. m6a-backend L2 stub-backend test: done (7c903295).
8. miri-thread-exit L2: the same finding as item 5, fixed by 2db41c0b.
9. Test comments naming old probe directories: done (f791df05).

## Files outside the ones the items name

Each was needed for the item:

- Item 1: `src/rustc_const_eval/interpret/intrinsics.ts` and `src/miri/shims/foreign_items.ts`. A generator has no
  `size_hint`, so the two program-controlled callers use `repeat_n` from `memory.ts` (it replaces their private copies).
- Item 2: new `src/rust_ts/miri_program.ts`, the helper that runs one program under both Miris.
- Item 5: `src/rust_ts/hash_map.ts`. `clone_LoadInfo` is generated, so `clone_HashMap` now keeps a `KeyedMap` keyed by
  value. The generated file is unchanged.
- Item 6: the table was in `src/miri/shims/math.ts`, not `src/miri/math.ts`, and it moved to `src/rust_ts/host_libm.ts`.
  `src/miri/math.ts` is unchanged.

## Verification

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- Coverage: `interpret/memory.rs` 73/73, `shims/readiness.rs` 23/23, `shims/math.rs` 1/1.
- `bun test src/miri src/rustc_const_eval src/rustc_interface`: 311 pass, 10 fail, at machine load above 100 (other
  lanes). All 10 were timeouts:
  - The 7 `const-check oracle` cases hit the 20 s limit I passed. `check.oracle.test.ts` rerun alone: 16 pass.
  - The 3 full-program oracle tests hit the helper's 240 s limit, now 900 s. Both new oracle test files rerun alone: 20
    pass. The other 301 of those 321 tests were not rerun after that limit change, which touched only the helper.
- Mutation checks, each making the test fail and each reverted:
  - changing a float error scale from 4 to 16, at each of five sites;
  - making `drop_fd_ref` a no-op (the `fd_ops` leak check);
  - removing the machine's `tls.visit_provenance` call.
- Oracle comparisons on one-off programs, port and isolated Miri byte-identical (not committed): `memset` and
  `ptr::write_bytes` of `1 << 33` bytes on 16 bytes; every libm group in f32 and f64; a pointer held only in TLS under
  `-Zmiri-provenance-gc=1`.

## Sample difftests

| Run | Commit | Result |
|---|---|---|
| `mir --sample 200` (`20261103-223614-followups-37-yc3u`) | ab852dc2 | MATCH 200/200 |
| `run-pass-miri --sample 200` (`20261103-223715-followups-37-o9eg`) | ab852dc2 | MATCH 196, UNPORTED 4, DIFF 0 |
| `mir --sample 200` (`20261103-230523-followups-37-head-6n5w`) | all items | MATCH 200/200 |
| `run-pass-miri --sample 200` (`20261103-231806-followups-37-head-b1rx`) | all items | MATCH 164, TIMEOUT 34, UNPORTED 2, DIFF 0 |
| `miri-hello` (`20261103-235559-followups-37-head-ttlr`) | all items | MATCH 1/1 |

The "all items" runs used the pre-squash commit 2f420672. It differs from the branch head only in the test helper's
timeout, which no subject run loads.

The 34 timeouts came from machine load, not this lane:

- Rerun alone, 26 match and 8 time out again (load 70-100).
- I ran those 8 at base `c9d3c553` and at the lane's head side by side with no limit. All 8 give identical output at
  both, with wall times within about 10% (for example 282 s against 278 s).
- Two of them took longer than the suite's 120 s limit at load 60 on both commits, and both are protected:
  `macro-comma-support-rpass.rs#core` (about 280 s) and `nested_panic_caught.rs` (about 197 s). They could time out in a
  gate run on a busy machine, whichever commit it tests.

None of the 6 UNPORTED cases across the two samples is in the protected set.

## `unported(...)` and `// PORT:`

- No new `unported(...)`. `src/miri/shims/math.ts` lost its own `dlopen` failure stop; `host_libm.ts` has it.
- `// PORT:` in `memory.ts`: `SizedIterator` and `repeat_n` stand in for `size_hint`. Any other iterator is still
  collected first, because it walks bytes already in memory or a small fixed count.
- `// PORT:` in `readiness.ts`: `Rc_drop_ReadinessWatcher` asserts against a double drop, which Rust's ownership rules
  out.

## Gaps and notes for root

- Item 2 cannot test pipes or socketpairs (`virtual_socket::pipe2` stops `unported`, plan-m6 D2) or host files
  (isolation off stops at `mio::Poll::new`, D14). So:
  - `fd_oracle/` uses eventfds and the standard streams.
  - flock's lock path and F_GETFL / F_SETFL's success path are tested on a stand-in description in `fd.test.ts`. Their
    libc constants were read from the oracle; their behavior was not compared with it.
  - The `pread` / `pwrite` / `preadv` / `pwritev` offset paths past the EBADF check have no test beyond the eventfd stops.
- The new oracle tests compare live against the isolated Miri, with no fixtures. They skip with a printed reason if Miri
  is missing, which the gate's skip allowlist rejects, as intended on the root host.
- They add unit-step time: about 3 minutes for `fd_ops.oracle.test.ts` at load about 65, and 25 minutes for both new files
  at load above 100.
- `clone_HashSet` has the same pattern as item 5's `clone_HashMap` for `KeyedSet`. I left it, since it wasn't reported and
  I did not check whether any caller passes one.
- Oracle behavior worth knowing:
  - `fcntl(fd, F_DUPFD, -1)` puts the duplicate at fd -1 and returns -1 with errno untouched; the port matches.
  - `writev` with `iovcnt` -1 ICEs the oracle (`fd.rs:596`), so the tests leave it out.
- The miri-shims-d and miri-shims-e probe directories under `docs/handoff/` are not registered probes, so the comments
  naming them stay.
