**Verdict: APPROVE WITH NITS.** All four commits do what they claim, the merges lost nothing, no protected key moved, and `run-pass-aux-miri` is ready for the gate. One thing to watch: Bun segfaulted once at start-up, not from this branch's logic as far as I can tell, and such a crash on a protected case would read as a loss (N1).

# Independent check of root's commits on `integ-w41`

Head `e7882a14`, against `main` at `9e11cc8b`. Lane `root-w41-check`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`. The host was **on battery throughout**, at load 2 to 39 (most of it my own runs). So timings are not gate timings. Mutations and plants ran in a scratch copy made with `git archive`, restored and removed. No gate and no full `bun test ./src`. The only suite run in full is the one item 7 asks for, plus the three one-case `miri-sysroot-*`.

## Findings

| # | Severity | Where | Scenario | Evidence |
|---|---|---|---|---|
| N1 | Watch | `src/miri/bin/miri.ts` under Bun 1.4.3; `scripts/difftest.ts:630` | One `miri-sysroot-core` subject crashed at 622 ms: `panic: Segmentation fault at address 0x0`, exit 128, status DIFF. No retry exists for this, so on a protected case it is a false loss | **Seen once, not reproduced** (below) |
| N2 | Nit, test gap | `src/rustc_target/callconv/x86_win64.ts:20-27`, `aarch64_oracle/sizes.rs` | The `case 8n`, `16n`, `32n` arms are not pinned: changing each to `9n`, `17n`, `33n` passes the ABI test, because `sizes.rs` has no 1, 2 or 4-byte type. The code is right today | **Mutations survived**; oracle-identical on my own program |
| N3 | Nit, residual | `scripts/ir-run.ts:100`, `scripts/lib/case-lock.ts:56` | Two difftests on one IR case at once still wait inside their limits, so `case-lock.ts`'s "never counts against the limits" is false for this caller. The second of two overlapping stub runs re-ran 4 of 12 subjects. Final status MATCH | **Reproduced**; the gate alone cannot hit it |
| N4 | Nit | `scripts/lib/miri.ts:88` | With `RUST_TS_HOST_TUPLE` unset and no `.env.local`, a hand-run shim under the isolated home still calls `rustc +nightly -vV` there, which without `RUSTUP_AUTO_INSTALL=0` would install. difftest dies first with an `ERROR:` line, so no harness path reaches it | **Reproduced** through a logging `rustc` |
| N5 | Nit, older than this branch | `src/rustc_metadata/fs.ts:302` | Bun's `mkdtempSync` silently truncates a prefix of 1,018 to 1,023 bytes to 1,017, and makes a directory with another name. At cwd 1,010 with `--out-dir out`, the oracle says `couldn't create a temp dir`, and the port `failed to create file encoder`. Exit 1 on both | **Reproduced**; "older" by reading: `main` uses the same call |
| N6 | Nit, not reachable | `src/rustc_metadata/fs.ts:305` | If the suffix rename fails, `.tmpXXXXXX` stays behind, where `tempfile` would have made nothing. A compile fails earlier: `<dir>/rmetaXXXXXX/full.rmeta` is about as long. There is also no committed test of the suffix path | **Reproduced on `TempDirBuilder` directly**; through the driver, 0 differences |
| N7 | Nit, docs | Commit `48454843`'s message | "Line numbers move" understates it: each fixture also changes 18 snippet lines and the error count. See item 2 | Measured |
| N8 | Nit, docs | `harness/scope.json:2`, `PORTING.md` §5b | The comment says changes need the owner's approval, and §5b tells lanes to record vendor crates there. See item 3 | Read |
| N9 | Note for root | `scripts/gate.ts:527-529`, `:497` | `--suites` replaces the defaults, and a missing protected suite is refused only at accept. So `--suites run-pass-aux-miri` alone would cost the whole run | Read, not run |

### N1: the Bun segfault

The run is `20261106-214512-root-w41-check-7b30`: `RSS: 0.24 GB`, `Elapsed: 622ms`, then `panic: Segmentation fault at address 0x0`. That is about when the module graph has finished loading, long before any metadata work. The core's own reruns gave MATCH twice (87 s, 9.7 and 10.7 GB).

- **How rare:** about 1,500 Miri subject processes ran in this review, and this was the only crash. The last 400 run directories hold no other `Bun has crashed` in a diff file. That search sees only non-MATCH cases that wrote a diff.
- **Cause:** unknown. I did not send the crash report to `bun.report`, and a stress loop was out of scope. I have no evidence tying it to `bun:ffi` or to this branch.
- **What it means for the gate:** difftest has no retry for it. A protected case hit by it fails accept. If a gate shows a single lost case, grep its diff for `Bun has crashed` before treating it as a regression.
- **Small related point:** the wrappers' `SIGNALS` tables (`miri-sysroot-run.ts:73`, `ir-run.ts:72`, `rmeta-run.ts:107`, `chain-run.ts:38`) have no SIGSEGV, so the exit reads 128. Harmless, since it is a DIFF either way. Editing a wrapper that an oracle key hashes would re-key its suites, so leave them.

## What was asked

### 1. `378f66f8`: an IR suite's sides in turn. Holds

- **The mechanism is fixed.** Same stub scenario as the review: real `ir-run.ts`, stub compilers of 0.7 s and 1.6 s, limits 1 s and 2 s, 12 uncached cases, `jobs: 4`.

  | Sides | Subject processes | Wall |
  |---|---|---|
  | In turn (head) | 12, none re-run | 7.2 s |
  | Together (mutant) | 19, 7 re-run | 18.6 s |

- **The test bites.** `ir-sides.test.ts` fails with the sides together and with every suite in turn, as root saw.
- **The retry path needs nothing.** It runs after the pool and alone, and `runOracle`'s own retry is now inside the oracle's turn.
- **`runSplit` needs nothing.** `irSuite` hard-codes `mode: "single"` (`harness/suites.ts:2099`), and `irTier` is set nowhere else, so `difftest.ts:776` cannot see an IR suite.
- **`scripts/ir-diff.ts` needs nothing:** its sides are two awaits in order.
- **A non-IR suite's path is unchanged:** the same `Promise.all`, behind a falsy `s.irTier`. The test holds that too.
- **`ir-run.ts` is left right, apart from N3.** The lock still guards a second difftest, and the file is unchanged by this commit.

### 2. `48454843`: x86_win64, V64, the fixtures. Holds

- **Against upstream:** `match a.layout.size.bits()` has arms 8, 16, 32, 64 and a default; the port has the same order and the same default. `bytes_u64() * 8n` is exact up to `obj_size_bound` and cannot hit the `bits()` overflow panic, as 2^61 × 8 fits a `u64`.
- **The fixtures are genuine.** `regen.ts` in the scratch copy reproduced all six oracle files byte for byte.
- **The msvc run needs no target.** The oracle toolchain has `rust-std` only for darwin and x86_64-linux, and `sizes.rs` is `#![no_core]`, so regen works.
- **V64 pins what F1 asked.** `n >= MAX` is now killed by the ABI test, and `CV64` shows `mode: Direct` in the x86_64 fixture.
- **Also killed:** win64 back to `bits()`, `case 64n` changed, and `* 4n`. N2's three arms survive.
- **Beyond the fixture.** I compared 42 signatures with `extern "C"` and `extern "win64"`: 1 to 16-byte arrays, `ScalarPair`s of 2 to 16 bytes, and 2^49 + 8 up to 2^61 − 1. Targets msvc and x86_64-linux, with and without `-O`: **stderr and exit identical**. Mutating `32n` makes this program differ, so it does reach those arms.
- **The 489 deleted lines: root's belief is nearly right.** With line numbers masked, each of the three fixtures differs by exactly:
  - one new 224-line block (`RustV64`, `CV64`);
  - 18 snippet lines, from `Rust16 C16: B16;` to `RustV64 CV64: V64;`, because the macro invocation's visible window moved;
  - `aborting due to 18` to `20`.

  Every location moves by exactly +2, and the other 18 FnAbi bodies are unchanged.

### 3. `c62ed969`: miri-sysroot F3, F4, F5, F7. Holds

- **`harness/scope.json`:** one line changes, `"ar_archive_writer": "=0.5.3"`, in `vendor`. 0.5.3 is the only version in upstream's `Cargo.lock`, and it is what §5b says to record. `e95d1def` added `jobserver` the same way. The owner-approval comment (N8) is about which compiler crates are in scope, so I read this as within §5b; if the owner wants otherwise, that is theirs to say.
- **Markers:** no `crate-pending` is left under `src`. `coverage.ts --check --offline` gives `markers ok (24872; vendor 5231; library 605)`, the 38 added to the earlier 5,193. `--missing` gives 27/27, 2/2, 1/1, with one left in `object_reader.rs` and 5 in `coff.rs`, as the handoff says. Its section on `crate-pending` is now history, and only its table's labels are stale.
- **`read_u8`:**
  - Upstream's encoder writes `emit_u8` (`serialize.rs:384-386`), and its decoder reads `read_u8` (`:395`).
  - The port decodes real rlibs: alloc, core and std from the Miri sysroot, and an oracle-built rlib with `-Zpacked-bundled-libs` giving `["libnat1.a", null, "libnat2.a"]`, so both tags.
  - F5's corrupt `80 00` now panics with upstream's message.
  - `miri-sysroot-alloc` is MATCH, but `decode` is not on its path (it writes, as the sysroot review said), which is why I decoded directly.
- **`files:`:** the two sides list the same names on alloc, std and core. **The plant is a DIFF:** a port writing `stray-file.o` differs at line 6, with `files:` listing it only on the subject side.
- **The key:** adding a line to `harness/miri-sysroot.ts` changes `miri-sysroot-alloc`'s key and leaves `miri-hello`'s and `run-pass-aux-miri`'s alone. Item 6 covers every suite.
- **`scripts/miri.test.ts`:** legitimate. The list grows by exactly the three suites this batch registers, nothing is removed, and the test also requires them to be milestone M6, with a usable oracle and no undeclared program.

### 4. `e7882a14`: host lookup. Holds, with N4

**The trace.** A logging `rustc` and `rustup` first on `PATH`, on a fresh data root with an empty oracle cache and aux directory, the Miri homes linked in. Under the isolated home the logger dropped `RUSTUP_HOME`, so nothing could install.

| Path | Calls naming the Miri home |
|---|---|
| `--impl shim`: `miri-hello`, `miri-sysroot-alloc`, `run-pass-miri` (5, and 19 by `--filter env`), `run-fail-miri` (5), `miri-pass` (5), `miri-fail` (5), `miri-pass-tb` (3), `run-pass-aux-miri` (15) | **0** |
| `--impl stub`: `miri-hello` | **0** |
| Default: `miri-hello`, `miri-sysroot-alloc`, `run-pass-miri`, `run-fail-miri`, `miri-pass`, `miri-fail` (8 each), `run-pass-aux-miri` (all, with fresh oracle and aux) | **0** |
| Direct shim, tuple unset, no `.env.local` | **1**, `rustc +nightly -vV` (N4) |

Every other `rustc` call in those runs has `RUSTUP_HOME` unset, from difftest itself and the proc-macro and helper builds. This includes the fresh aux builds.

- **What the logger cannot see:** a case with a pinned `PATH` bypasses it, as its `rustc` is the proxy directly. There are 2 such cases, both in `run-pass-miri`. By reading they reach no `rustc` either, since the tuple is in the inherited environment.
- **Can the two disagree?** Only with a wrong tuple, and that is caught where it matters:
  - `verifyOraclePin` is the first step of difftest (`:937`), the gate (`:385`), `miri-diff` (`:144`) and `miri.ts time` (`:171`). Unset and wrong each die with one `ERROR:` line, reproduced before any case ran.
  - `miri.ts status` does not run it, and reports the isolated toolchain as not installed, reproduced.
  - `miri.ts setup` does not run it either. By reading it installs `nightly-2026-10-11` for the real host, which is a no-op here, then dies on `miriOracleProblem`.
  - A cwd `.env` with a bogus tuple does not reach the shim: 0 calls and the right binary, reproduced.
- **The new test bites:** undoing the fix fails it. It tests `miriBinary()` rather than a whole shim run, and the trace above covers that.
- **The home is as it should be:**
  - `toolchains/` and `update-hashes/` hold only `nightly-2026-10-11-aarch64-apple-darwin`, both dated Nov 1, as is `settings.toml`, whose default is the pin.
  - `downloads/` and `tmp/` are empty.
  - `rustup toolchain list` under that home names the pin alone, and `miri.ts status` is `ok`.
- **`miriOracleKey`:** `4b7f6cc5967f...` on every suite that takes it. Every Miri suite's `oracleKey()` equals `main`'s (item 6).

### 5. Merges. Hold

- **`tempdir_in`: both sides kept.** Rlib builds under `MIRI_BE_RUSTC=target` against the isolated Miri, with the cwd at 20 lengths from 300 to 1,219 bytes, and output in the cwd, in a relative `--out-dir` and in an absolute one. I compared exit, stderr and the files left, not the rlib's bytes.
  - Identical at every length up to 1,005, including the failures in between.
  - From 1,010 up, the differences are N5 and the known missing ` at path "..."`, queued in `docs/next.md`.
  - An absolute `--out-dir` from cwds of 1,023, 1,024 and 1,219 succeeds on both sides, so the suffix path works from a long cwd.
- **A committed test of the suffix path with a long cwd: there is none** (N6).
- **`scripts/gate.ts`'s imports:** all four new names are there, and `tsc` is clean in the scratch copy, which I gave the main checkout's `node_modules`.
- **Silent drops: none.** All 8 merges on the branch: no file touched by one side differs from that side's version. Conflicts are in `miri.ts`, `fs.ts` and `gate.ts` only, each with both sides' lines. `harness/suites.ts` and `session.ts` merged cleanly.
- **Each lane against head:** of every line each lane added, those missing at head are root's named corrections and nothing else:
  - the `crate-pending` markers;
  - the fixture lines of item 2;
  - `read_usize`;
  - the old key line and the handoff sentences.

### 6. Whole branch. Holds

- `git diff main..integ-w41 -- harness/baseline` is empty.
- At one path, using `main`'s tree and then head's, I dumped `oracleKey()`, case ids, args, env, file, and **the full cache key of every case**.
- **66 of 67 suites are identical, 371,896 cases.** `ir-hello` alone differs (`a7e1e141...` to `3fdbf326...`), with the same ids, args, env and file.
- Head adds only `miri-sysroot-core`, `-alloc` and `-std`.
- I did not re-dump limits and modes, which `docs/reviews/harness-w42.md` checked at that lane's head. `git diff` shows the only `harness/suites.ts` changes since then are the new suites, a comment and their key.

### 7. `run-pass-aux-miri`. Ready

| Run | Result | Wall | User CPU |
|---|---|---|---|
| Default jobs | 355 of 356 | 109 s | 1,041 s |
| Default jobs | 355 of 356 | 109 s | 1,075 s |
| `--jobs 3` | 355 of 356 | 156 s | 859 s |
| Default jobs, fresh oracle and aux at another data path | 355 of 356 | 112 s | not noted |

- **Per case:** in the first three, all 356 statuses are the same. The one left is `tests/ui/rustc-env/rust-log.rs`, UNPORTED each time. The fourth gives the same totals; I did not compare it case by case. The 16 EII cases are among the MATCHes.
- **Concurrency:** none seen across jobs and load. No run re-ran a subject for a timeout. By reading, no case has a `MIRI_TEMP`, and each aux directory is per case and read-only by then.
- **Tree and upstream:** the upstream checkout is clean afterwards.
- **For the gate:** it adds about 2 to 3 minutes. Pass the full list (N9).

### Focused tests

`ir-sides`, `miri`, the ABI oracle test, `ar_archive_writer`, `toolchain`, `miri-sysroot`, `gate-probes`, `case-lock`, `unit-steps`, `miri-ui`, `rustc_codegen_ssa/back`, `std/env`, `src/miri/bin`: 32 and 63 pass over two invocations, 0 fail.

## What I did not check

- The gate, the full unit step, or any protected suite in full.
- AC power: every timing here is on battery.
- Per-case time for `run-pass-aux-miri`: the run files do not record it, so the margin to its 60 s limit rests on no timeout retries.
- The cause of N1, or how often it occurs.
- The two pinned-`PATH` cases under the logger, by reading only.
- A fresh install under the Miri home: I did not repeat the F1 download.
- `miri.ts setup` with a wrong tuple, by reading only.
- `miri-pass-heavy` and `run-pass-miri-heavy` under the trace.
- Linux and Windows.

## Housekeeping

- **In `$RUST_TS_DATA/runs`,** `20261106-214649-root-w41-check-uu90` is **deliberately bad** (the stray-file plant). `-7b30` is the Bun crash. The other `root-w41-check` runs are this head unmodified.
- **Oracle cache:** I added the real entries for `miri-sysroot-std` and `-core` under head's key.
- **Disk:** 13 GiB free, 97% used.
