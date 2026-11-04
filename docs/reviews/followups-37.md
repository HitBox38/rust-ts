# Independent review: followups-37

Branch `t3/rustc-wave37-followups`, head `2ba2268e`, against merge base `c9d3c553` (9 commits). Read-only: no lane code
was edited. No gate or full suite was run.

## Verdict: APPROVE WITH NITS

All nine items are fixed as reported. `write_bytes_ptr` follows upstream's check order, and const-eval output is
byte-identical to the oracle. Nothing shows a regression on a protected case. One finding is worth applying at merge (M1,
a two-line change to the test helper). The rest are low severity or nits. None of them points at wrong compiler output on
the root host.

| # | Severity | Where | Finding |
|---|---|---|---|
| M1 | Medium | `src/rust_ts/miri_program.ts:33`, `:25` | The helper skips difftest's environment scrub and sets no `RUSTC_ICE=0`, so a shell variable can fail the gate |
| L1 | Low | `scripts/gate.ts:270` | The new tests take the unit step's margin from about 1.9x to about 1.6x of its 30-minute limit |
| L2 | Low | `src/miri/shims/foreign_items.ts:1181`, `src/rustc_const_eval/interpret/intrinsics.ts:1411` | At 2^53 bytes and above, the port stops `unported` where the oracle reports UB or an ICE; the handoff doesn't say so |
| L3 | Low, not reproduced | `src/rust_ts/host_libm.ts:27`, `:152`, `:170` | Windows: `hypot` / `hypotf` may be missing from `ucrtbase.dll`, which would take `sin` / `cos` / `pow` down with them |
| N1 | Nit | `src/rustc_const_eval/interpret/memory.ts:1709`, `util/check_validity_requirement.ts:65`, `:91` | The PORT comment overstates what the remaining generators are |
| N2 | Nit | `src/rustc_interface/interface.test.ts:33`, `:38` | The temp source is never deleted; the test title claims something it doesn't assert |
| N3 | Nit | `docs/handoff/followups-37.md:56` | The pre-squash commit differs by more than the timeout |

### M1: the helper runs with the caller's environment

`run_miri_program` starts from `process.env` plus `MIRI_CASE_ENV`. Difftest and `phase-diff` use `caseEnv`
(`scripts/lib/env.ts`), which exists to stop a caller's exported variables reaching these processes. They also pass
`RUSTC_ICE=0`, because the cwd must not be written to. The helper's cwd is inside `src/`.

Reproduced on `stops.rs read-oob` through the helper:

| Exported variable | Result |
|---|---|
| `RUSTC_LOG=info` | DIFF: oracle exit 1, port exit 70 (`unported: RUSTC_LOG/MIRI_LOG directive`) |
| `RUSTC_CTFE_BACKTRACE=1` | DIFF: oracle exit 1, port exit 70 |
| `MallocStackLogging=1` | DIFF: exit codes equal, stderr differs |
| `RUST_BACKTRACE=full` | same |
| `CLICOLOR_FORCE=1` | same |

Failing scenario: root starts a gate from a shell with `RUSTC_LOG` exported. The new tests fail in the unit step (I reproduced
one case; the stop is in the driver, so all should), although every difftest suite is immune to that variable. The failure is loud and early, so it costs a restart and not a
wrong result.

Second part: an oracle ICE writes `rustc-ice-*.txt` into the cwd. I saw this happen: my own `memset(p, 0, usize::MAX)`
runs left two of those files in their cwd. Here that would be `src/miri/shims/unix/fd_oracle/` or
`src/miri/float_error_oracle/`, and the name is not in `.gitignore`, so the tree would be dirty during the gate. None of
the 20 current programs ICEs (`git status` stayed clean through two full runs), so this needs a future program or a
changed oracle.

Fix: build the overlay with `caseEnv({ ...MIRI_CASE_ENV, RUSTC_ICE: "0" })` and apply it with `mergeEnv`.

### L1: the unit step's time limit

See question 5 for the numbers. No test is wrong. A gate on a machine more than about 1.6x slower than the recent gates
now fails `ERROR: unit tests`, where before the limit was about 1.9x. Under the load that made a full `bun test` run for
hours, the step fails with or without these tests, so this narrows the margin and doesn't create the risk. Root should
either run gates on a quiet machine, as the steady 908-973 s of the last six gates suggests it does, or raise the limit in
a reviewed harness batch.

Related: `MIRI_PROGRAM_TIMEOUT_MS` is 900 s and the tests' limit is 1,800 s. A single hung port process can therefore use
half of the step's budget, and a hung test all of it. Bun does enforce the limit on a synchronous `spawnSync`: in a small
experiment it killed the child at the test's limit and failed the test.

### L2: counts of 2^53 and above

The original finding (`memset(p, 0, 1 << 33)` on 16 bytes) is fixed, and so is everything up to 2^53 - 1. Above that the
port stops, which PORTING §3 allows and `base` does too, so this is not a regression. The handoff says "no new
`unported(...)`", which is true but doesn't mention this limit. All 9 DIFFs in the table under question 2 are this case.

Failing scenario: `memset(p, 0, 1 << 53)` gives oracle exit 1 with "attempting to access 9007199254740992 bytes" and port
exit 70. `memset(p, 0, usize::MAX)` gives oracle exit 101 (ICE at `i64::try_from(size.bytes()).unwrap()`, `memory.rs:861`)
and port exit 70.

Fix: note the limit in the handoff or a `// PORT:` comment. No code change is needed unless a suite case reaches it.

### L3: `hypot` on Windows (not reproduced, no Windows host)

Commit `6f1a3556` keeps `lgamma_r` / `lgammaf_r` separate so that a missing symbol can't take down `sin` / `cos` / `pow`.
The header says only those two are missing from `ucrtbase.dll`. But upstream links `hypot` and `hypotf` as `_hypot` and
`_hypotf` on MSVC (`library/std/src/sys/cmath.rs:15-18`), and Miri's shim has an "underscore case for windows". That
suggests the unprefixed names may not be exported either.

Failing scenario, if so: on Windows `dlopen` of the merged table fails, and `f64::sin` under the port's Miri stops
`unported`, where at base only the shim table failed. AGENTS.md §5 keeps Windows unchecked, hence low severity.

Fix: check the exports on a Windows host, or give `hypot` / `hypotf` their own group.

### N1: the PORT comment on the remaining generators

The comment says any other iterator "walks bytes that are already in memory or a small fixed count".
`check_validity_requirement.ts:91` keeps a third private `repeat_n` generator whose length is the type's size. It runs
after a successful allocation, so the bounds order isn't affected, but it collects a type-sized array under
`-Zstrict-init-checks`. Read only: I did not run a multi-GB type on a shared machine. The other two generators,
`concurrency/sync.ts:410` and `interpret/call.ts:834`, have fixed small layouts.

### N2: `interface.test.ts`

Each run leaves `$RUST_TS_DATA/tmp/interface-test/<pid>.rs`. The first test's title says it "does not ask for the default
backend", but the stub itself calls `get_codegen_backend`, and an extra call from `run_compiler` would not be detected.
What the test does prove is that the stub is used and the calls run in the order `make`, `init`, `target_config`, which
matches `interface.rs:424-437`.

### N3: the handoff's pre-squash note

The handoff says `2f420672` differs from head "only in the test helper's timeout". It also differs by the
`r.error` throw at `miri_program.ts:26`. No subject loads that file, so the sample evidence stands.

## The questions asked

### 1. Each item against the original wording

| Item | Original finding | Result |
|---|---|---|
| 1 | shims-a M1: bounds check must come before producing bytes | Fixed, for counts below 2^53 (L2) |
| 2 | shims-d M1: 4-ULP error untested | Fixed. I reran one mutation: `intrinsics/math.ts:147` 4 to 16 fails the test |
| 2 | shims-d M2: no tests for read, write, readv, writev, fcntl, ioctl, flock, poll | Fixed where reachable. Narrower for flock and F_GETFL / F_SETFL (question 6) and pread / pwrite past EBADF; the handoff says so |
| 3 | shims-c M1 | Already fixed: no `drop_fd` left in `readiness.ts`, `epoll.ts` or `eventfd.ts` |
| 3 | shims-c L2, L4, L5, L6 | Fixed. The key compare, string key and sorted array are correct; `forEach` and `retain` still go through the order |
| 4 | shims-a N2: TLS visit test stores only integers | Fixed; a second test covers the machine's `visit_provenance` |
| 5, 8 | thread-exit L2: `clone_LoadInfo` keying | Fixed (question 3) |
| 6 | shims-b N2: merge FFI tables | Fixed (question 4; see L3) |
| 7 | m6a-backend L2: stub-backend test | Fixed (see N2) |
| 9 | harness-w37: comments name old probe dirs | Fixed; `mirimath`, `miriaddr`, `mirisched`, `randstream` exist in `tools/probes` and `probes.ts fixture` is a real command. The `miri-shims-d` and `-e` comments stay, correctly |

Tests passed when rerun: the 59 tests of hash_map, memory, weak_memory, fd, tls, shims_c, interface and probe fixtures;
`math.test.ts` 7 of 7; both oracle files 20 of 20, twice. `tsc` exit 0, markers ok, and coverage 73/73, 23/23, 1/1 as the
handoff states.

### 2. `write_bytes_ptr`

The order now matches `memory.rs:1445`: size hint, assert, bounds check through `get_ptr_alloc_mut`, zero-size branch,
write, final assert. Sources without a size hint are collected first. That is unobservable, because they are pure and
their length is already in memory or fixed.

I ran 33 cases under the port and the isolated Miri (exit code, stdout and stderr compared):

| Group | Cases | Result |
|---|---|---|
| Out of bounds: past the end, offset, freed, up to 2^53 - 1 | 10 | same |
| Zero size: null, dangling, one-past-end, freed; `memset` null and dangling fail, `write_bytes` passes | 7 | same |
| Overflow in `compute_size_in_bytes`, ZST with `usize::MAX`, success paths | 7 | same |
| 2^53 and above | 9 | DIFF, all exit 70 (L2) |

Const-eval, which is the path protected suites run through: one file with 9 failing and 6 passing consts (out of bounds,
overflow, read-only, null, zero size, ZST). Port and oracle stderr are byte-identical at head. `base` on the same file ran
past the rest of a 500 s limit on the `1 << 33` and `1 << 40` consts, and I stopped it, since it could exhaust memory on a
shared machine. So I did not see it finish.

`intrinsics.ts` and `foreign_items.ts`: needed, and correct. A generator has no size hint, so both needed a sized
iterator, and each call now reads as upstream's does (`intrinsics.rs:1165`, `foreign_items.rs:901`). The `va_copy` arm at
`intrinsics.ts:953` didn't strictly need it (a small fixed layout) but is the same expression as upstream. Importing
`memory.ts` from `intrinsics.ts` is safe: `call.ts`, `place.ts` and `intern.ts` already do.

No slowdown from the per-byte `next()`: a program doing `memset` and `write_bytes` of 4 MiB used 5.92 s user at head and
6.05 s at base.

### 3. `clone_LoadInfo` and `clone_HashSet`

The `clone_HashMap` fix is correct. `clone_VectorIdx` gives a fresh object with the same `_0`, so lookups by value now
work on a clone. No generated code changed.

Iteration order is unchanged. The `FxHashMap` branch still comes first, including `FxKeyedMap`. A `KeyedMap` clone has the
same insertion order as the plain `Map` it used to become. The only field reaching the new branch is `LoadInfo.timestamps`,
which is only probed and scanned with `any`. `clone_StoreBufferAlloc`, `clone_StoreBuffer` and `clone_StoreElement` have no
caller outside generated code and the new test, so no production path runs this at all.

`clone_HashSet` has no affected caller. All five sites:

| Site | Set |
|---|---|
| `Stacks.exposed_tags` | plain `new Set()` of numeric `BorTag` (`stacked_borrows/mod.ts:472`) |
| `GlobalState.reuse_candidates` | `FxHashSet` (`data_race.ts:1826`) |
| `tracked_pointer_tags`, `tracked_alloc_ids` | `FxHashSet` (`eval.ts:136-137`) |
| `LiveRegions::InBody` | plain `new Set<RegionVid>()` (`region_infer/values.ts:127`) |

Leaving it was right, and no fix is needed now. The same shape does exist outside that function: generated
`clone_PlaceholderIndices` turns a `KeyedSet` into a plain `Set` (`values.gen.ts:103`), on a live path (`nll.ts:93`). The
port's lookups for that field scan by value on purpose (`values.ts:284-287`), so it is safe today. I did not audit other
generated `new Set([...])` clones, such as `auto_trait.gen.ts:43`.

`KeyedMap` subclasses (`DefIdMap`, `HirIdMap`, `InterestMap`) would come back as a bare `KeyedMap`, but none reaches this
function.

### 4. Merged FFI tables

- `math.test.ts`, the `mirimath` fixture check: 7 of 7 pass at head. The fixture covers the original host float
  operations, not the merged symbols, so it can't confirm item 6 by itself.
- So I compared head's `host_libm()` and `host_libm_lgamma()` with a fresh `dlopen` of base's own table: 38 symbols, about
  3.04 million calls over specials, raw bit patterns and ordinary values. 0 differences in raw bits, NaN payloads and the
  `lgamma` sign included.
- `lgamma_r` and `lgammaf_r` are absent from the main table and in their own group.
- `float_error.oracle.test.ts` also reaches `tan`, `gamma` and `ln_gamma` against the live oracle.

### 5. The live oracle tests

**Keep them in the unit step, and keep them live.** Fixtures would save almost nothing.

| Measure | Value |
|---|---|
| CPU, both files, near idle (load 4 rising to 40) | 194 s (160 user, 34 sys), 381 s wall |
| CPU at load 40-130 | 222 s, 728 s wall |
| Idle wall estimate | about 3.2 minutes |
| Unit step in the last six gates | 908-973 s, against a 1,800 s limit |
| Step with these tests | about 1,130 s, so the margin goes from about 1.9x to about 1.6x |

- **Fixtures:** the oracle costs 0.04-0.10 s user per run and the port 5.6-10 s. The port has to run live either way, so a
  fixture would save about 1% and would add host gating for the float results. The sources are already committed.
- **If the time matters later:** the 17 `stops` cases cost 7.5-13.5 s each, and each needs its own process. A difftest
  suite would suit them, with oracle cache, ratchet and TIMEOUT handling, in a reviewed harness batch.
- **Isolated Miri:** yes, always. The binary is by absolute path under `rustup-miri`, `RUSTUP_HOME` and `CARGO_HOME` are
  isolated, and `--sysroot` is `miri-sysroot`. `src/miri/bin/miri.ts` spawns nothing. `miriOracleProblem` also checks components,
  commit and driver hash.
- **Silent skip:** no. With `RUST_TS_DATA=/nonexistent` the test skips and prints the reason, and `ALLOWED_SKIPS`
  (`gate.ts:155`) has no entry for it, so the gate rejects it. I read that rule and did not run a gate. A plain `bun test`
  outside the gate does skip, by design.
- **Spurious failure:** the environment (M1) and the step limit (L1). I found nothing else: all 20 passed in both full runs, both
  sides get the same stdin, and the clock is virtual under isolation.

### 6. The stand-in tests in `fd.test.ts`

Partly from the oracle.

- **From the oracle:** the libc constants. I reran them under the isolated Miri and got exactly the values at
  `fd.test.ts:196` (1 2 4 8 3 4 2048 0 1 2 64 128 256 512). Also the text `unsupported flags 0x3`, which the oracle prints
  for the same call.
- **Not from the oracle:** the parsed `FlockOp` values, the `[O_NONBLOCK]` passed to `set_flags`, and the `-1` error path.
  These come from reading upstream, and they do match `fd.rs:179-191` and `:296-307`.
- **Stand-in passthrough:** `F_GETFL` returning `O_RDWR` (`fd.test.ts:273`) is the stand-in's own value, so that assertion
  proves dispatch and handle release only.

The handoff states this limit accurately. The oracle can't be compared here because the port stops at `mio::Poll::new`
with isolation off, and pipes stop at `pipe2`. The real `FileHandle` flock and flags paths remain untested.

### 7. The 34 TIMEOUTs

**The conclusion is sound, and CPU time supports it better than the wall times did.** Base and head ran side by side:

| Case | Base user / sys | Head user / sys | Wall (both) | Base vs head output | Head vs oracle |
|---|---|---|---|---|---|
| `nested_panic_caught.rs` | 53.79 / 10.03 s | 54.92 / 10.32 s | 238-241 s, load 77 | identical | identical |
| `macro-comma-support-rpass.rs#core` | 94.63 / 53.34 s | 94.42 / 53.41 s | 424-425 s, load 40 | identical | identical |

Those are about 2% and 0.2% apart in user CPU. For `nested_panic_caught.rs`, my comparison script dropped one trailing newline,
which accounts for the single-byte difference from the oracle.

My own samples at head, with `--jobs 3` at load 40-54:

- `mir --sample 60`: MATCH 60.
- `run-pass-miri --sample 40`: MATCH 39, UNPORTED 1 (`library-override.rs`, not protected), DIFF 0, **TIMEOUT 0**.

Those samples differ from the lane's. Zero timeouts at moderate load is direct evidence that the 34 came from load.

Two refinements to the handoff:

- Its caveat about these two cases is understated. Both were already `retried: true` in the last accepted gate
  (`gate-20261102-174727-root-kxpt`), so they timed out once there and passed only on the retry. `macro-comma` uses about
  148 s of CPU against a 120 s suite limit. This is not from this lane, but root should expect it.
- "Identical on base and head" alone doesn't show a MATCH. For these two I also compared with the oracle, as above.

## What I did not check

- Any gate or full suite, or these tests under the gate's exact environment (`CI=true`, `RUST_TS_REQUIRE_PROBES=1`).
- The other 6 of the 8 slow cases, which the handoff does not name, and the 26 "matched alone" case by case. My 40-case
  sample is independent evidence, not a rerun of those. I did not finish `float-math-pass.rs` either; two restarts
  interrupted it.
- The lane's other mutations: the four other float sites, `drop_fd_ref`, and the TLS `visit_provenance` removal. For my one
  mutation the test failed at 542 s, before any limit, but I did not keep the message.
- Windows (L3), and a multi-GB type under `-Zstrict-init-checks` (N1).
- The real flock and `F_GETFL` / `F_SETFL` paths on a host file, which the port can't reach yet.
- Line-by-line review of the new test programs against every upstream shim path. I relied on the live comparison for
  those.

Evidence note: the machine rebooted during this review and cleared my scratch space, so the raw outputs for the
`write_bytes` cases, the libm comparison and the environment runs are gone. Their results are recorded above as I read
them at the time. The `mir` and `run-pass-miri` samples remain in `$RUST_TS_DATA/runs/rv-followups-37-{mir,rpm}`.
