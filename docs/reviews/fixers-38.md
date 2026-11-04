# Independent review: fixers-38

Branch `t3/fix-wave-38-miri-issues`, head `82eb1e5f`, base `integ-w38` at `b79919b0`. Tested on a private merge with `integ-w38` at
`688895b6` (no conflicts; never committed to a shared branch). "Before" below means `688895b6` itself. Code read-only.

## Verdict: APPROVE WITH NITS

The stdout and stderr change holds up. I found no difference in bytes, ordering, exit codes or throughput compared with the tree before
it, and no way for it to hang a gate. No protected case was lost in any sample. Two items should be fixed before or soon after the merge,
F1 and F2; neither changes behaviour. F2 is a rule the lane did not follow, and root can also settle it by recording a decision.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | low, test gap | `src/miri/borrow_tracker/tree_borrows/tree_visitor.ts:100` | One traversal-order mutation survives every test |
| F2 | low, rule | `src/miri/shims/unix/socket.ts:281,299` | `send` and `recv` share helpers where PORTING §3 says not to deduplicate |
| F3 | low, not this lane | `src/miri/bin/miri.test.ts:84` | `run()` leaks `set_args_os`, which fails `diagnostics.test.ts:309` in some file orders |
| N1 | nit | `src/std/io.test.ts:72-85` | The guard misses aliases and touches |
| N2 | nit | `src/std/io.ts:351`, `src/miri/shims/files.ts:217,229`, `src/rust_ts/tracing_tree.ts:394`, `src/vendor/anstream/stream.ts:176,187` | `EAGAIN` retries spin at 100% CPU |
| N3 | nit | `docs/handoff/fixers-38.md` | Two statements do not match what I measured or read |
| N4 | nit | `src/miri/shims/foreign_items.ts:145,725`, `src/rust_ts/tracing.ts:564` | A misleading alias and a stale comment |
| N5 | nit | `src/rust_ts/codegen_backend.ts:57` | The CPU table should be generated |
| N6 | nit | `src/miri/intrinsics/x86/x86.test.ts:28` | The 5-minute limit may fail falsely at the highest loads seen |

### F1: `tree_visitor.ts:100`, the order of an ancestor's other children

The handoff reports one survivor, "reversed child pushes", and says `tree_visitor.test.ts` catches it. There are three push sites, and
that holds for only two of them:

| Mutation of `tree_visitor.ts` | `tree_visitor.test.ts` | `oracle_e2e.test.ts` |
|---|---|---|
| `:83` children of the accessed node, forward | killed (4 fail) | killed (`traversal_siblings`) |
| `:100` an ancestor's other children, forward | **survived** | **survived** |
| `:133` `Recurse` pushes, reversed | killed (2 fail) | survived |
| `:110` no `reverse()` | killed (5 fail) | killed (2 fail) |

So the lane's survivor is covered by the unit test, if it meant `:133`, and `:100` is covered by nothing. It is reachable.
`traversal_cousins.rs` puts its cousins at different depths, so it never compares two siblings at one level.

*Failing scenario:* with `:100` iterating forward, this program reports protected tag `<473>` where the oracle reports `<474>`, and every
test stays green:

```rust
// miri-flags: -Zmiri-tree-borrows
use std::ptr;
#[inline(never)]
unsafe fn f(a: &mut u8, b: &mut u8, q: *mut u8) { let _ = (&a, &b); ptr::write(q, 1); }
fn main() { unsafe { let mut x = 0u8; let p: *mut u8 = &mut x; let q: *mut u8 = &mut *p; f(&mut *p, &mut *p, q); } }
```

The unmutated port matches the oracle on it, stdout, stderr and exit. *Fix:* add it to `oracle_e2e/` with `miri_fixture.ts`. It costs
about 2 s.

### F2: `read_send_recv_args` and `finish_send_recv`

Upstream writes this code out twice. PORTING §3 says "Do not simplify, 'improve', reorder or deduplicate", so this is not allowed, and
they should be written out. The handoff lists both under `// PORT:` decisions, but the code has no such comment, only doc comments.

The order and logic are otherwise right against `socket.rs:418-590`, and the markers are correct. *Failing scenario:* this is a process
failure, not a wrong result. A later upstream change to `recv`'s argument handling has no matching text to diff against, and a fix to one
function silently changes the other.

### F3: `miri.test.ts:84` (not this lane; the same on `688895b6`)

`run()` calls `set_args_os` and never restores it.

*Failing scenario:* `bun test ./src/miri/bin/miri.test.ts ./src/rustc_session/diagnostics.test.ts` fails
`utils: extra_compiler_flags / was_invoked_from_cargo` with `["-Z", "miri-num-cpus=1025"]`, on both trees. It also failed in my 28-crate
run.

**The gate is not affected:** in the order of `bun test ./src ./tools`, `diagnostics.test.ts` is file 136 and `miri.test.ts` is file 256. I
read that from a filtered run on the merged tree. The risk is a false red for lanes running subsets, and any future change in file order.
*Fix:* restore the arguments in `run()`'s `finally`, beside the `set_output_capture(previous)` this lane added.

### N1: the guard (`io.test.ts`)

It is reliable for what it matches. One writer put back was caught, and it reads every non-test `.ts` and `.mts` under `src/`. I found no
legitimate test code it catches, because `*.test.ts` is excluded and the `run.ts` oracle drivers now use the helpers. Two things pass it:

- `const w = process.stdout; w.write(..)` survived.
- `void process.stdout.isTTY` survived. This one matters more: `io.ts`'s own comment says a touch alone makes the pipe non-blocking.

*Suggestion:* match `process\.std(out|err)\b`, with `vendor/termize/platform/unix.ts` allowlisted. That is the only real touch left, and
only after `isatty`.

### N2: the `EAGAIN` retry

With `O_NONBLOCK` set and a stalled reader, the child spins, throwing an exception per try: 6.13 s of CPU in about 6 s, against 0 for Rust
and for the same port with a blocking pipe. The harness cannot reach this, because child fds came up blocking in every parent I tried
(table below). *Suggestion:* a 1 ms `Atomics.wait` in the retry paths. Not needed for this merge.

### N3: the handoff

- "a closed reader with an `EPIPE` turns exit 70 or 101 into an uncaught panic". **Measured, it is exit 1 on both trees:** the old
  `process.stderr.write` also ended in an uncaught `EPIPE`. Nothing changed here.
- The `// PORT:` claim in F2.

### N4: small cleanups

- `foreign_items.ts:145`: `const stderr_write_all = write_stderr` shadows `io.ts`'s function of the same name, which returns a result. It
  forces a `try`/`catch` at `:725`, where `:721` just has `void stdout_write_all(..)`. Upstream treats the two alike. Importing the real one
  and using `void` would mirror upstream.
- `tracing.ts:564`: the comment says errors "are ignored", and the function now panics.

### N5: `ORACLE_TARGET_CPU_FEATURES`

See item 2. The entry is correct, but it is oracle data copied by hand beside a generated table. Extend `tools/codegen/target-config.ts` in
a later batch, and record the decision until then, as the handoff asks.

### N6: `x86.test.ts:28`

The per-test limit went from 20 to 5 minutes. The lane measured 94 s for the longest test at load 45, so by simple scaling a load around 140
would hit it, and loads of 100-300 have been seen with many lanes running. `RUST_TS_X86_TEST_TIMEOUT_MS` exists for that. The limit is fine;
root should remember the variable if a merge's unit step fails here under load.

## 1. stdout and stderr

### Bytes and ordering

Program: 300 KB lines on each stream, partial lines held in `Stdout`'s `LineWriter`, 60 alternating lines, and an unterminated last line,
through the port's real Miri driver against the isolated oracle:

| Mode | Oracle vs merged | Oracle vs before | Bytes |
|---|---|---|---|
| file, `2>&1` | same | same | 606,319 |
| pipe, `2>&1`, reader starts 0.4 s late | same | same | 606,319 |
| stdout and stderr to separate files | same | same | 303,183 / 303,136 |
| stdout to a late pipe, stderr to a file | same | same | 303,183 / 303,136 |
| stderr to a late pipe | same | same | 303,136 |

Also `-Zunpretty=mir` on `saturating-float-casts.rs`: 1,128,500 bytes, the same SHA on the oracle and on the merged tree. `tokdump` on 400
compiler files, 183,547,427 bytes through a pipe: the same SHA before and after.

This program does not separate the trees, because it goes through the Miri shims. I did not reproduce O1's own failure. The lane's
`io.test.ts` tests do catch a dropped tail and a missing `EAGAIN` retry: I mutated both and they were killed.

### Slow or full pipes, and deadlock

| Child's fds 1 and 2 under | `O_NONBLOCK` | After reading `process.std*` |
|---|---|---|
| `Bun.spawn` pipes | no | **yes** |
| `spawnSync` pipes | no | **yes** |
| shell pipe | no | **yes** |
| `Bun.spawn` `inherit`, from a wrapper that touched its own stdout | no | not measured |

- **The harness cannot deadlock on this.** `scripts/lib/common.ts:99-115` `run` reads both streams and the exit together with
  `Promise.all`. A child writing 64 MiB alternately to each stream through `run` finished with both whole, exit 0.
- **A strictly sequential parent** (a Rust parent reading stdout to EOF, then stderr): the port and a real Rust child behave the same. Both
  block after one chunk each, state `S`, 0 CPU, until killed. That deadlock is the program's, as in Rust.
- `scripts/rmeta-run.ts:111` and `scripts/chain-run.ts:48` pass stdio by `inherit` and touch nothing before spawning, so the subject stays
  blocking.

### A closed reader

Exit codes, with the reader gone before the first write:

| Case | Oracle | Merged | Before |
|---|---|---|---|
| `rustc -Zunpretty=mir`, stdout closed | 141 | 101 | 101 |
| `rustc --print target-list`, stdout closed | 141 | 101 | 101 |
| `rustc` with an error, stderr closed | 141 | 1 | 1 |
| Port stop `-Ctarget-cpu=skylake`, stderr closed (70 with stderr open) | not run | 1 | 1 |
| Miri, stdout closed | 141 | 101 | 101 |
| Miri, stderr closed | 141 | 101 | 101 |
| `tokdump`, stdout closed | not run | 1 | 1 |

The oracle dies of `SIGPIPE`. The port never does, and that is not new. **Nothing changed between the trees.** `classify` cannot see this:
`run` holds both pipes to EOF, so a subject only gets `EPIPE` if the harness itself dies. A gap to the oracle does remain, on no protected
path. Miri's closed-stdout panic text also reads `Broken pipe (os error 32) (os error 32)` on both trees. I did not look into that, and the
oracle cannot be compared there because it dies first.

`println-with-broken-pipe.rs` and `sigpipe-should-be-ignored.rs`: MATCH on all 15 suites whose baseline holds them, and on `run-pass-miri`,
where they are cases but not protected.

### Throughput

| Output, by CPU, alternating runs | Before | Merged |
|---|---|---|
| `tokdump`, 183 MB to a pipe, 3 runs, user + sys | 2.93-2.94 s | 2.69-2.78 s |
| `-Zunpretty=mir`, 1.1 MB, 2 runs, user + sys | 10.74-11.38 s | 10.69-11.06 s |
| Miri on the program above, 3 runs, user + sys | 22.0-24.9 s | 20.2-24.7 s |

No measurable change. `mir-core` and `rmeta-core` were not run: both are full suites. By reading, `-Zunpretty=mir` output is one `std_print`
(`OutFileName.overwrite`, `src/rustc_session/config.ts:1405`), which this lane did not change. So the path is the same, and a write per call
does not arise there. The changed dump drivers flush whole buffers.

## 2. `-C target-cpu`

- **Reproducible:** I built `tools/codegen/target-config/probe.rs` and ran it with `--target x86_64-unknown-linux-gnu -C target-cpu=x86-64-v4`.
  Its `internal_target_features` line equals the table entry exactly.
- `--print cfg` on that CPU is identical to the oracle, stdout and stderr.
- **Every other input is a loud stop, exit 70:** `x86-64-v3`, `native`, `x86-64`, `generic`, `x86-64-V4`, and `x86-64-v4` on the host target,
  where the oracle only warns. `-musl` and `i686` stop earlier, at the missing target. `help` stops at `--print TargetCPUs`.
- It should be generated (N5).

## 3. `--print sysroot` and `target-libdir`

No protected case passes through this. I enumerated the argv of all 58 suites, 364,386 cases: **none** has `--print sysroot` or
`--print target-libdir`. `tests/ui/print-request/stability.rs` has a `target_libdir` revision, but no suite runs it with that flag. The scripts
I found that ask for the sysroot (`scripts/lib/oracle.ts:92`) ask the oracle's `rustc`.

## 4. `send` and `recv`

Order, logic and markers match `socket.rs:418` and `:497`; see F2 for the helpers. My own programs against the isolated oracle, via raw
symbols, not `libc`:

| Program | Oracle exit | Result |
|---|---|---|
| Flags (`NOSIGNAL`, `DONTWAIT`, `CMSG_CLOEXEC`), zero length, `EBADF`, `ENOTSOCK` on stdout, stdin and a pipe, `EOF`, `EPIPE`, closed fd; the pipe still reaches EOF after a failed `send`, so no handle leaks | 0 | MATCH |
| `MSG_PEEK`: "virtual sockets don't support peeking" | 1 | MATCH |
| Bad flag on `send` and `recv`, `0x1000` and `-1` (`0xbfffffbd` on `recv`) | 1 | MATCH |
| Blocking `recv` with nothing to read: deadlock report | 1 | MATCH |
| Null or out-of-bounds buffers | 1 | MATCH |
| `UnixStream::pair` across threads, non-blocking, after close | 0 | MATCH |
| `TcpListener`, `TcpStream`, `UdpSocket` with isolation on | 1 | MATCH |

**Real network paths still stop:** with `-Zmiri-disable-isolation` the port exits 70, `mio::Poll::new`, where the oracle binds and connects.
`getsockname` and `shutdown` on a socketpair also exit 70, where the oracle exits 1 with "unsupported operation: cannot get socket name for
socketpair" and "cannot shut down socketpair". Those are loud stops, not wrong results.

## 5. Test gaps

**Fixtures:** I regenerated every new one from the isolated oracle: the 4 under `oracle_e2e/`, the 4 under `virtual_socket_oracle/`,
`pause_threads`, and the avx2 lines. All are byte-identical. Their sources are committed. `avx2.oracle.txt` has 3 header lines of its own on
top of the program's output, and adds nothing else.

| Mutation | Test | Result |
|---|---|---|
| `tree.ts` `perm.accessed` dropped | `oracle_e2e` | killed (`dealloc_unaccessed_protected`) |
| Children not sorted | `oracle_e2e` | killed (`gc_children_sorted`) |
| `send` / `recv` ignore `DONTWAIT` | `virtual_socket` | killed (2) |
| `recv` ignores `PEEK` | `virtual_socket` | killed (`recv_peek`) |
| `CMSG_CLOEXEC`, `NOSIGNAL` masks | `virtual_socket` | killed (2) |
| `EBADF` to `ENOTSOCK` | `virtual_socket` | killed |
| Capacity 8 to 4 | `virtual_socket` | killed |
| Non-blocking read at EOF gives `EAGAIN` | `virtual_socket` | killed |
| Handle leak at EOF | `virtual_socket` | killed (stand-in tests) |
| `blocked_read_tid`, `blocked_write_tid` not cleared | `virtual_socket` | killed, **but only by the 600 s limit: the program hangs** |
| `pause` does not yield | `x86` | killed (`pause_threads`) |
| Gather `to_int` to `to_uint` | `x86b` | killed |
| A writer back to `process.stdout.write` | `io` | killed |

Tree visitor: see F1. The reversed pushes at `:133` are covered only by `tree_visitor.test.ts`.

## 6. x86 tests and cleanups

**Coverage is preserved, and better.** Every case in the old table is still there with the same fixture. The stand-in features are replaced
by the real flags, which equal `regen.sh`'s argv line by line, and `wide` no longer has a skip guard. Nothing under `src`, `scripts`, `harness`
or `tools` references `driver.mts`. Running `e2e.ts` for `avx2` and `bmi` through the real driver: both MATCH.

**The cleanups I read change no behaviour,** with one correct exception: `shims/unix/fd.ts`'s default `as_socket` now drops its handle, as
upstream's `self` does. Others: `LocationState_eq` moved, `AccessRelatedness.is_foreign` used in place of an inlined check, `VecDeque_u8` moved, comments. `tsc` is
clean and `coverage --check --offline` says `markers ok (24709; vendor 5076; library 590)`.

## 7. Cost

Fine. Measured with `RUST_TS_REQUIRE_PROBES=1`, user + sys, at load 5-10:

| Test | CPU |
|---|---|
| `oracle_e2e.test.ts` (new) | 13.9 s |
| `virtual_socket.test.ts` | 57-80 s, against 43 s before; noisy |
| `pause_threads` | 5.4 s |
| `io.test.ts` | 0.8 s |

That is 34-57 s added, in line with the lane's 59 s. The step's limit is 30 minutes (`scripts/gate.ts:270`). I did not measure the "about 20
minutes": the last gate with a report took 934 s, at `ef00b86a`, before wave 38.

## 8. Samples and tests, merged tree

| Suite | Sample | Result |
|---|---|---|
| `miri-hello` | 1 | MATCH 1 |
| `run-pass-miri` | 200 | MATCH 200 |
| `mir` | 200 | MATCH 200 |
| `check-ui` | 200 | MATCH 200 |
| `tokens` | 200 | MATCH 200 |
| `pm-ui` | 200 | MATCH 198, UNPORTED 1, UNSTABLE 1 |
| extra, drivers whose writer changed: `lex`, `emit`, `fluent-format`, `escape` | 100 each | MATCH all |
| extra: `symbols`, `escape-synthetic` | 10, 11 | MATCH all |

`pm-ui`: `proc-macro/expand-expr.rs` is UNPORTED (cross-thread proc macro) and not in the baseline. `proc_macro_generated_packed.rs` is listed
as unstable.

**`bun test` on the 28 crates the lane touched, `RUST_TS_REQUIRE_PROBES=1`, `CI=true`:** 4,007 tests, 4,005 pass, 1 fail, 1 skip, 1,292 s.

- **The fail** is F3, not from this lane.
- **The skip** is `read_binary_file_handles_lying_stat` in `src/rustc_span/source_map/tests.test.ts:651`, which is the one entry in
  `ALLOWED_SKIPS` (`scripts/gate.ts:155`).

## Not checked

- The gate, `bun test` on crates the lane did not touch, full suites, `mir-core`, `rmeta-core`.
- O1's original symptom on the old code (see item 1).
- The other AVX fixtures through `e2e.ts`: only `avx2` and `bmi` ran.
- `pass-dep` upstream tests with `libc`: the handoff's results, not reproduced. My own socket programs cover the same shims.
- `tests/ui/test-attrs/terse.rs`, and `run-fail-miri`.
- A real terminal, including what `vendor/termize` does to a tty's flags.
- Windows.
- A merge with `miri-perf` (the handoff's merge note): I did not try one.

## Note on my own run

A quoting slip in my script dropped `--sample`, so a **full `run-pass-miri` ran for about 51 minutes** at `--jobs 4` on my private merge,
while other lanes shared the machine, before I noticed and killed it. It touched no shared tree or baseline, and I deleted its run directory
without reading results from it. The figures above are from the rerun with `--sample 200`.
