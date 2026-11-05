# fixers-39: real bugs from the wave 38 reviews

## Items

1. **Done (`0036b049`).** `[object Object]` in pointer fragments: `mir/pretty.ts` now uses `debug_provenance`. The upstream case and a new fixture (concrete, wildcard and whole pointers) match the oracle.
2. **Done (`1cbaebc9`).** `Stack_dealloc` crash: `Stack::retain` set `borrows.length` where upstream's `truncate` does nothing past the end, so a provenance GC on a collapsed (empty) stack grew it with a hole. No `usize` near 2^53 or wrapping offset is involved.
3. **Done (`42927bfb`).** MIR validation at `-Copt-level` 2 and 3: `Inline`'s `map_unwind` shared one `cleanup_block` object between edges, and `remove_dead_blocks` renumbered it once per edge. The small pass fix is in.
4. **Done (`4c0c1cfe`).** `type_length` is a `bigint` wrapped to 64 bits. `issue-83150.rs`'s stderr is byte-identical through the collector driver (67 s, so the test uses a one-second variant).
5. **Done, with a changed premise (`ff3cef15`): read "What root should decide".** 13 `miri-pass`, 2 `miri-pass-tb` and 2 `miri-fail` cases move to MATCH.
6. **Done (`a4a99aff`).** `miri.test.ts` `run()` restores the arguments. The regression check is running that file, then `diagnostics.test.ts`: 1 fail before, 18 pass after.

## What root should decide

**Item 5: the premise did not hold.** Upstream does not only create the poller at startup. With isolation off it polls with a zero timeout before every foreign item
(`foreign_items.rs:127`) and on every scheduler tick (`scheduler.rs:107`), and with a timeout when all threads sleep (`scheduler.rs:209`). So these programs do reach
`Poll::poll`, on a poller with nothing registered. I went beyond "creation only" and ported that case: nothing can be registered (`register` still stops), and mio's
`select` on an empty poller returns no event once the timeout passes (read in mio-1.1.1's kqueue selector; I did not read `epoll.rs` closely). A zero timeout does nothing and a longer one
sleeps through the host clock, as `MonotonicClock::sleep` does. A poll with a source, a poll with no timeout, and `register` still stop `unported`. If root reads "any real poll" more
strictly, `ff3cef15` reverts on its own. It needs root's recorded decision; I did not record it (this lane edits only `src/` and this file).

**`tests/pass/shims/time.rs` should not be protected as it stands.** It matches the oracle when the host is quiet, and is stable over three oracle and three port runs at load 4. But `shims/time.rs:9`
asserts `diff.as_millis() < 1000` on the real clock, and the port is about 10 times slower than the oracle (a similar program: 40 ms against 412 ms). **With 16 port runs at once, 8 of 16 failed that
assert.** `MIRI_PASS_UNSTABLE` is defined by oracle differences, so this may fit the heavy class (serial) better; that is root's call, and I did not edit `harness/suites.ts`.

`tests/pass/concurrency/sync.rs` (`#stack`, `#tree`, `#tree_implicit_writes`) has the same kind of bound at 4,000 ms. `#stack` passed 16 of 16 at once, slowest run 25 s. It is lower risk, not no risk.

**Isolation-off stability.** All 17 newly matching cases gave identical results across three oracle runs (one with a changed `HOME`, `PATH` and `USER`) and three port runs. None needs `MIRI_PASS_UNSTABLE` for an oracle
difference. Those runs were at low load, and on this host only.

## Item 3: can protected suites be affected?

- **`mir` runs no case at these levels:** 0 of 21,526 cases have an opt-level flag. `ForceInline` still runs at the default level; the 13 `force-inlin` cases MATCH.
- **`run-pass-miri` does run `Inline`:** Miri passes `-Zmir-opt-level=0` itself, so the suite's 3,351 `-O` cases don't enable it, but 36 cases have `-Zmir-opt-level` >= 2 or `-Zinline-mir` on. All 36 MATCH after the fix.
- **No protected case should change.** A case that hit the bug would ICE or print wrong block numbers, so it could not be a protected MATCH, and the fix only adds copies. This is reasoning plus the samples below, not a gate.
- **Sweeps of `-Zunpretty=mir` on `mir` programs, against the oracle:** 40 at `-Copt-level=2`, 200 at `-Copt-level=3`, 100 at `-Zmir-opt-level=4`: all MATCH. The review's program also matches at levels 1, 2, 3, `s`, `-O` and `-Copt-level=1 -Zmir-opt-level=3`.
- **Sharing check (temporary patch, not committed):** it looked for terminators sharing a `Cleanup` object at `remove_dead_blocks`. It fired on 1 of the 200 programs with the fix reverted (still MATCH, the block did not move) and on none with it. These samples are small next to M7's scope, so expect other bugs there.
- **Seeing which pass broke MIR:** `-Zvalidate-mir` names the pass, and `-Zdump-mir='Inline&main'` with `-Zunpretty=mir` avoids the `rustc_graphviz::render` stop. I did not port `render` or find which dump calls it.

## Item 1: other `[object Object]` paths

None found. Across every retained `mir`, `miri-fail`, `miri-pass`, `run-fail-miri` and `run-pass-miri` diff, the text appears only in the known case. I read the interpolations of likely objects in `mir/pretty.ts`, `src/miri`,
`rustc_const_eval/interpret` and `mir/interpret`, and ran `-Zmiri-track-pointer-tag` against the oracle. That grep is by hand, not a type-based check, so it does not rule the class out.

## Details

- **Files:** `src/rustc_middle/mir/pretty.ts`, `src/rustc_middle/ty/instance.ts`, `src/rustc_structures/limit.ts`, `src/rustc_mir_transform/inline.ts`, `src/miri/borrow_tracker/stacked_borrows/stack.ts`, `src/miri/concurrency/blocking_io.ts`, `src/miri/bin/miri.test.ts`, `src/miri/diagnostics.oracle.test.ts`, `src/miri/borrow_tracker/stacked_borrows/stack.test.ts`.
- **New:** `src/rustc_mir_transform/inline.oracle.test.ts` and `inline_oracle/`, `src/miri/concurrency/blocking_io.test.ts` and `blocking_io_oracle/`, `src/miri/borrow_tracker/stacked_borrows/oracle_e2e.test.ts` and `oracle_e2e/`, `src/miri/diagnostics_oracle/ptr_fragment_dump.rs`, `src/rustc_monomorphize/collector_oracle/{programs,oracle}/type_length_wraps.*`.
- **Regression tests:** each fix's new test was run against the old code and failed there, except item 5 (the old code stops at `Poll::new`) and item 6 (see above). Items 2, 4 and 5 compare with fixtures generated from the oracle; items 1 and 3 run the oracle live. They add about 25 s of unit time.
- **Coverage (`--missing`):** `inline.rs` 65/65, `instance.rs` 34/34, `pretty.rs` 59/59, `limit.rs` 8/8, `stack.rs` 16/16, `blocking_io.rs` 13/13. `coverage.ts --check --offline`: markers ok.
- **Checks:** `tsc` clean. `bun test` on the touched directories: 269 pass, then `rustc_mir_transform` + `rustc_monomorphize` 210 pass, 0 fail. I did not run the full unit suite.
- **Samples:** `miri-hello` 1/1. `--sample 100`: `mir` 100 MATCH, `check-ui` 100 MATCH, `run-pass-miri` 100 MATCH, `miri-pass` 97 MATCH, 2 UNSTABLE (the listed two), 1 UNPORTED (`socket-address.rs`, sockets out of M6). No DIFF, CRASH or TIMEOUT.
- **`unported` left:** no new paths. `mio::Poll::poll` now applies only with a source or no timeout; `mio::Registry::register`, `mio::event::Event` and `add_blocked_thread`'s panic text are as before. Isolation-off cases still stopping: 4 in `miri-pass` (`open_a_file_in_proc`, `socket`, `socket-address`, `socket-no-blocking`), all 3 in `miri-pass-heavy` (`std::fs`), 2 in `miri-fail` (`open_file_or_dir`).
- **`// PORT:` decisions:** `TypeLengthVisitor`'s `bigint`; `type_length_ as unknown as number` into the generated diagnostic; `value_within_limit` takes a `bigint` and treats the `USIZE_MAX` sentinel as unlimited; `map_unwind`'s copy; `retain`'s truncate; the empty poller (`blocking_io.ts` header).

## For tools (not this lane)

- `tools/codegen` should emit `TypeLengthLimit.type_length` as `bigint`, so that `as unknown as number` can go.
- `usize_from_str` returns a `Number`, so a `#![type_length_limit]` above 2^53 loses precision (`rustc_session/options.ts:155`). I did not fix it; it matters only when a value differs from the limit in those low bits.
