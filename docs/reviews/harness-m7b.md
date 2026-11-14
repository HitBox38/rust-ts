verdict: FAIL

Batch: harness lane `harness-m7b` (wave 40r), branch `t3/add-m7b-report-suites`, commits `965e96be`, `7ba72293`, `106929e3`, `941ed6c4` on main `e80bc814`. Handoff: `docs/handoff/harness-m7b.md`.
I am read-only on the lane: this file is all I wrote to the tree. Line numbers are at `941ed6c4`. AC power throughout; load 3-36, shared with other lanes; `--jobs 6` at most, `RUST_TS_AGENT=review-m7b`. My scripts and outputs are in this session's scratch directory (not in the repo or `$RUST_TS_DATA`).

**The protected side is clean.** All 75 existing suites are identical on main and on the branch, in everything a suite exposes (§1). `mono-ui` gives the same verdict per case. The `m7-suites.test.ts` change corrects a test that was false; it weakens nothing. No baseline, comparison rule or runner behaviour changes.

**What must change is the native suites' determinism and the M7c figure (F1, F2), plus 3 wrong skips (F3).** Every program built with `--test` (libtest; 50 cases) prints output that varies from run to run, and the wrapper neither masks it nor lists it. The two oracle runs catch it only some of the time. In one full oracle pass, run-fail-native was 15 of 289 UNSTABLE. criteria.ts counts UNSTABLE in the denominator, against plan §6, so M7c's `run-fail-native ≥ 95%` cannot be met even with a perfect port. These are report-only suites, so nothing protected is at risk today. The fixes should land before any gate names them with `--suites`.

| # | Severity | Where | Finding |
|---|---|---|---|
| F1 | **must fix** | `scripts/native-run.ts:290`, `harness/suites.ts:2402` | libtest programs (50 cases) are nondeterministic in three ways the wrapper neither masks nor lists; two runs catch it only sometimes, and a lucky pair is cached |
| F2 | **must fix** | `scripts/criteria.ts:49-54` | The M7b/M7c groups count UNSTABLE in the denominator; plan §6 excludes it. As written, M7c's run-fail-native ≥ 95% is unreachable (at most 274/289 = 94.8%) |
| F3 | **must fix** (small) | `harness/suites.ts:2431-2442` | The duplicate-libc skip is wrong for 3 cases: `extern crate libc` is behind `#[cfg(target_os = "linux")]`, and the oracle compiles them on the host |
| N1 | nit | `scripts/native-run.ts:25-26`, `:283-285` | A `setsid()` child escapes the group kill and outlives the wrapper (tested), contrary to the header |
| N2 | nit | `harness/suites.ts:2312`, `scripts/lib/env.ts:31` | The native compile inherits `SDKROOT`, `DEVELOPER_DIR` and `LIBRARY_PATH`, which change the link, and none of them is in the oracle key |
| N3 | nit | `scripts/native-run.ts:139`, `:143` | Two run-pass cases fail on the oracle for harness reasons (localhost denied; no `RUST_TEST_TMPDIR`). They score MATCH while testing nothing |
| N4 | nit | `scripts/native-run.test.ts:148-157` | The timeout test fails every time at load 12-16: a freshly linked binary takes over 1 s to start under the sandbox |
| N5 | nit | `scripts/native-run.ts:180-186` | `should-fail` is not honoured: `compiletest-self-test/revision-bad.rs` reads "not met" on the oracle |
| N6 | nit | `docs/handoff/harness-m7b.md` | Handoff corrections: "UNSTABLE once, then stable" was chance, and the 2 UNSTABLE in the oracle-self sample were not the whole picture |

## 1. Protected suites are untouched

**Every existing suite, independently dumped.** I wrote my own dump (`dump.ts`), which imports `harness/suites.ts` and `scripts/difftest.ts` from the tree. It ran on `e80bc814` and on `941ed6c4`, both checked out in this same worktree, so the repo path in commands and keys is the same. For each suite it hashed:
- the metadata: mode, split, heavy, inputDirs, both timeouts, cwd, probes, `readsOnlyCaseFile`, subsets, miri, irTier, criterion, and which optional hooks exist;
- **every** case (id, file, args, env, mode) and every skip (id, reason);
- the `unstable()` list;
- **every** case's oracle and subject command, case lock, `irArgs` and `blessed`, or the one batch command for batch suites;
- the subsets' membership;
- `oracleKey()`;
- 15 evenly spaced full oracle cache keys per suite, from difftest's own `caseOracleCacheKey`, so the file hashes and `caseDeps` are included.

Result: **75 of 75 suites are identical.** The branch adds exactly six: `ir-run-pass` 3,479 (488 skipped), `ir-run-pass-o0` 3,479 (488), `ir-host` 3,412 (555), `native-hello` 1 (0), `run-pass-native` 3,412 (555), `run-fail-native` 289 (37). That matches the handoff.

**`mono-ui`, `--sample 200 --jobs 6`, on each commit, same agent.**
- main (`review-m7b-monoui-main`): 200 MATCH.
- branch (`review-m7b-monoui-branch`): 200 MATCH.
- Per case: the same 200 ids with the same status.
- `scripts/mono-run.test.ts` is also a fair check of N1. It compares mono-run's stdout and stderr with the oracle's on hello world, and fails if any module under `src/rustc_codegen_llvm/` or `src/rust_ts/llvm/` is evaluated.

**`harness/m7-suites.test.ts:109-114`** is a correction, not a weakening. The old test said `ir-hello` has no baseline. That became false at the wave 40q accept (`0da8b38d`), and the test failed from then on. The new test pins the baseline's exact content (`hello -Copt-level=0`, `hello -O`), which is stronger. The new M7b test (`:138-222`) pins that none of the six has a baseline, so none is in the gate's defaults.

**Gate and runner.**
- `scripts/gate.ts` gains only `oracleRuns` for `NATIVE_RUN`, which reads the wrapper's compiler, as for the other wrappers.
- `scripts/lib/unstable.ts` gains one pattern, anchored at line start: `^native-run: unstable: `. Only the new wrapper prints it.
- No suite definition, comparison or baseline changes.

## 2. Suite correctness against compiletest and the plan

**IR argv (plan §6).** I printed the commands for one case, `threads-sendsync/task-comm-6.rs`:
- `ir-run-pass`: `mir-o2`'s compiletest argv, without `-Zunpretty=mir`, plus `-Cno-prepopulate-passes --emit=llvm-ir`, for x86_64-unknown-linux-gnu.
- `ir-run-pass-o0`: the same, then `-Copt-level=0` last.
- `ir-host`: the same as `ir-run-pass`, but `--target=aarch64-apple-darwin`.
- **The override works.** `rustc -O … -Copt-level=0` gives byte-identical IR to `-Copt-level=0` alone, with no warning (checked on the oracle).

**Case sets on the host.** I compared `ir-host` against `ir-run-pass` (one corpus, 3,967 tests, two targets):
- **81 cases are x86_64-only.** Each one's host skip reason is a directive, or the duplicate-libc skip:
  - `only-x86_64`: 20;
  - `only-linux`: 20;
  - libc: 20;
  - `needs-sanitizer-kcfi`: 10;
  - `only-x86_64-unknown-linux-gnu`: 4;
  - `ignore-apple`: 4;
  - `ignore-aarch64`: 2;
  - `ignore-macos`: 1.
- **14 cases are host-only.** All are `only-aarch64`, `only-aarch64-apple-darwin` or `only-apple` tests, or an `[aarch64]` revision.
- `withCompiletestTarget` swaps the only memos that depend on the target (host, conds, current target cfg, needs). The other module memos are target-independent: builtin cfg names, layouts, LLVM components, linker dir. `uiCases`' memo is keyed by dirs, which no host caller uses.

**run-fail's verdict (runtest/ui.rs `run_ui_test`, runtest.rs `check_all_error_patterns`, `get_output` at the pin).** `compiletestVerdict` (`scripts/native-run.ts:180-200`) is faithful on each point:
- **`RunResult`:** Pass on success; Fail on an exit of 1 to 127; Crash otherwise, which includes a signal.
- **run-fail:** may not crash. `can_unwind()` holds on this host.
- **run-crash and run-fail-or-crash:** as upstream.
- **`error-pattern`:** `contains(pattern.trim())`.
- **`regex-error-pattern`:** trimmed before compiling, as upstream.
- **`check-stdout`:** the text checked is stdout followed by stderr.
- `failure-status` (3 run tests) is ignored for run output upstream too.
- `forbid-output` appears in no run-mode test.

My full oracle pass checks the logic in practice: every one of the 289 run-fail-native cases reads `met` with every pattern `found`, except the two revisions of a `should-fail` self-test (N5).

## 3. Safety and determinism of `native-run.ts`

**The sandbox.** I compiled a hostile program with the oracle and ran it through the wrapper. It tried:
- writing to the scratch directory, `/tmp` and the user's home: EPERM;
- writing inside its own `HOME`: allowed;
- TCP to 1.1.1.1, TCP to 127.0.0.1, binding 127.0.0.1, sending UDP: all EPERM;
- binding a unix socket in its `TMPDIR`: EPERM (N3);
- `/bin/sh` writing outside: "Operation not permitted". Children inherit the sandbox.

No file appeared outside the case directory.

**The fixed environment.** The program saw exactly `DYLD_LIBRARY_PATH`, `HOME`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `TMPDIR` and its `exec-env`. I had set `RUST_BACKTRACE=1` and a dummy variable in the caller, and neither reached it.

Against compiletest: compiletest's program inherits compiletest's environment plus `exec-env`, then loses `unset-exec-env`. `RUST_BACKTRACE` is unset in CI, which matches. `RUST_TEST_THREADS` and `RUST_TEST_NOCAPTURE` reach the program only if they are set in compiletest's own environment (directives.rs:400-406). Bootstrap is outside the sparse checkout, so whether it sets them is unchecked. The wrapper sets neither, so libtest runs tests on every core (F1(b)).

**Processes left behind.**
- The group kill works for ordinary children.
- A child that calls `setsid()` and closes its stdio survives (N1).
- A child that keeps the pipes open makes the wrapper wait past `--run-timeout`, up to difftest's timeout. compiletest's `read2` waits for EOF too.

**Two oracle runs, and `test-panic-abort-nocapture.rs`.** Two runs are enough only for nondeterminism that shows up nearly every time, such as ASLR addresses. They are not enough for this case:
- In 6 back-to-back oracle invocations, 4 were UNSTABLE and 2 agreed.
- The only varying line is libtest's `test result: … finished in 0.0Xs`, where X is 1, 2 or 3.
- So the lane's "UNSTABLE once, then stable and cached" was a lucky pair, and that cached entry now holds one timing value.

**The convention.** `Suite.unstable` (`harness/suites.ts:118-125`) lists, by hand and with a diagnosed reason, cases that two oracle runs showed to be irreproducible. `MIRI_PASS_UNSTABLE` (`:1952`) is the example, with a reason given per case. A difference the harness causes is fixed in the case definition instead. Thread ids in tydump-ui became a mask (`:865-867`).

So yes: this case belongs either in the list with its reason or under a mask. So do the other libtest cases (F1). The cause is now diagnosed.

## 4. Oracle cache key

The key covers:
- the compiler argv, run options and helpers' path, through `c.args`;
- the compile's environment, through `c.env`;
- the test file and what it includes, through difftest's file hash and `caseDeps`;
- Bun, through `oracleVersion`'s first word;
- the oracle build, through `rustcDriverHash`. std's rlibs and dylib come from the same install;
- the wrapper and masks, through hashes of `native-run.ts` and `lib/unstable.ts`. Its other import, `case-lock.ts`, does not change output;
- the link and run on this machine: `cc -v`, `ld -v`, `xcrun --show-sdk-version` and `sw_vers` (OS version and build);
- the case directory's root, `$RUST_TS_DATA/native`;
- the sysroot path, through `--sysroot` and `--lib-path` in `c.args`, so `-Crpath` is covered;
- `rust_test_helpers`: its directory name hashes its source, `cc -v` and its flags.

**Gaps:**
- The caller's `SDKROOT`, `DEVELOPER_DIR` and `LIBRARY_PATH` reach the link and are not in the key (N2).
- The sysroot's file set is not in the key: adding or removing `rustc-dev` decides E0464. The cases it affects are skipped, so this is harmless today.

A stale result after a change in what is covered: no.

## 5. The duplicate-libc skip

- **The detection.** It matches the test file, the files `caseDeps` finds (`mod`, `#[path]`, the include macros) and aux files. It drops `//` comments.
- **Checked on the oracle.** I compiled all 20 skipped cases with the host argv (`withCompiletestTarget` + `uiFileCases`, `-o` to scratch):
  - **17 fail with E0464** (`error[E0464]: multiple candidates for rlib dependency libc`). Two examples: `process/fds-are-cloexec.rs` and `runtime/out-of-stack.rs`.
  - **3 compile and link, exit 0** (F3).

## 6. Evidence

| Run | Result |
|---|---|
| `ir-run-pass --sample 100 --jobs 6` (`review-m7b-irrp`) | 91 MATCH, 0 DIFF, 9 UNPORTED; 35 s wall |
| `native-hello` (`review-m7b-hello`) | 1 UNPORTED (`ssa-link-b: self_contained_components`), as expected before ssa-link-b |
| `oracle-self --suite run-pass-native --sample 30 --jobs 3` | 30 equal, 0 unstable, 0 differ; 48 s |
| My full oracle pass of the native suites (every case's oracle command once, `--runs 2`, nothing cached) | 21.6 min wall at 6 jobs, load 3-16. `native-hello`: stable, exit 0. `run-fail-native`: 289 compile; **15 UNSTABLE**; every verdict met but N5. `run-pass-native`: 3,411 of 3,412 compile (`layout/randomize.rs#randomize-layout` fails E0080 on the oracle, as it would in every run suite); **23 UNSTABLE**; 2 verdicts not met for harness reasons (N3). No timeout. Oracle wall per case (compile + 2 runs): run-pass p50 1.8 s, p99 4.9 s, max 12.5 s (`closures/2229_closure_analysis/run_pass/multilevel-path-2.rs`); run-fail p50 3.1 s, max 7.2 s |
| Oracle runs of the 50 libtest cases | 18 UNSTABLE in one pass (F1) |

The 9 UNPORTED in `ir-run-pass`:
- 5 `cg-intrinsic-b generic_simd_intrinsic`;
- 1 `cg-asm codegen_inline_asm`;
- 1 `-Clto=thin` (D8);
- 1 `rustc_sanitizers` CFI;
- 1 for the x86 intrinsic table.

**Disk:** my runs added about 0.9 MiB of oracle cache (96 entries newer than my first run, which may include other lanes' entries), 0.3 MiB of run directories, and nothing lasting under `$RUST_TS_DATA/native` (24 KiB, the test helpers, as before; my probe case directory is removed) or `$RUST_TS_DATA/ir` (0). The full oracle pass and the libtest and libc checks wrote no cache. Free space went from 5.0 GiB to 10 GiB in that time, through other lanes.

## 7. Commands

- `bunx tsc --noEmit -p .`: clean.
- `bun test ./harness/ ./scripts/`: **572 pass, 0 fail**, 86 s, at load 2. An earlier run at load about 10, during my full oracle pass, had 6 failures: four 5 s timeouts in the untouched `gate-bun.test.ts`, and two in `native-run.test.ts` (N4).

## Findings

### F1. libtest programs are nondeterministic, and the wrapper neither masks nor lists them (`scripts/native-run.ts:290`, `harness/suites.ts:2402`)

50 native cases compile with `--test`: 37 in `run-pass-native` and 13 in `run-fail-native`. Their stdout varies from run to run in three ways:

- **(a) Timing.** libtest's summary line ends `finished in N.NNs`. Seen in `test-panic-abort-nocapture.rs`, `test-panic-abort.rs` and `mpsc_stress.rs` (0.33-0.49 s).
- **(b) Test order.** With `RUST_TEST_THREADS` unset, libtest runs the tests in parallel, and the `test x ... ok` lines come out in completion order. Seen in `coroutine/smoke.rs`, `macros/stringify.rs` and `macro-comma-*`.
- **(c) Thread ids on stdout.** libtest prints a captured panic, `thread 'test_foo' (<tid>) panicked`, on **stdout**. difftest's thread-id mask applies to stderr only, so it misses this. `runsDiffer` does not mask stdout either. Seen in `panics/test-panic.rs` and 7 more run-fail cases, which are UNSTABLE on every run.

In one oracle pass of the 50, 18 were UNSTABLE. The ones that came out stable by chance get cached. A later port result on them is then MATCH or DIFF by chance, which becomes a false loss once the suite is protected.

**Fix: root's choice, recorded as a decision.** Plan §1g names only the thread-id mask and the backtrace cut, so new masks need one.
- (i) Mask (a) and (c) in the native suites: libtest's `finished in \d+\.\d+s`, as compiletest's own tests do with `normalize-stdout` (e.g. `test-panic-abort-nocapture.rs:7`), and the thread id in libtest's captured stdout. List the order-dependent (b) cases in `Suite.unstable` with that reason. Setting `RUST_TEST_THREADS=1` in the program's environment would also fix (b), but it is not compiletest's environment as far as the pin shows.
- (ii) Alternatively, list all 50 in `Suite.unstable`. That costs about 1.1 points of `run-pass-native` and 4.5 of `run-fail-native` under F2.

Either way, the lane's cached oracle entry for `test-panic-abort-nocapture.rs` goes stale by itself: a change to `native-run.ts` changes its hash, which is in the key.

**The other UNSTABLE cases belong in `Suite.unstable` too.** Beyond libtest, the full pass flagged 15 `run-pass-native` and 7 `run-fail-native` cases. Their output looks genuinely nondeterministic, but I diagnosed only 2 of them, both `run-fail-native` (`mir/alignment/misaligned_lhs.rs` and `array-slice-vec/vec-index-bounds-check-overflow.rs`: an address that ASLR changes). Judging from their names, the rest are:
- addresses: `cast/cast-region-to-uint.rs`, the three `codegen/equal-pointers-unequal/*/segfault.rs`, the other five `mir/alignment/*`;
- a hash seed: `collections/hashmap/hashmap-debug-format.rs`;
- thread interleaving: `threads-sendsync/spawn-fn.rs`, `task-comm-3.rs`, `task-comm-14.rs`, `yield.rs`, `std/park-timeout-wakeup-59020.rs`;
- the rest: `abi/stack-probes.rs#aarch64`, `abi/stack-probes-lto.rs#aarch64`, `binop/binops.rs`, `runtime/rt-explody-panic-payloads.rs`, `runtime/running-with-no-runtime.rs`.

Address cases differ on every run, so two runs always catch them. Interleaving cases can agree by chance and get cached, as `test-panic-abort-nocapture.rs` did. The convention is to list them by hand with a diagnosed reason, as `MIRI_PASS_UNSTABLE` does. The full list is per case in `fullnative.jsonl` in my scratch directory; a re-run of `oracle-self` over the whole suite would reproduce it.

### F2. The M7b/M7c groups count UNSTABLE in the denominator (`scripts/criteria.ts:49-54`)

Plan §6: "Denominators exclude ORACLE_TIMEOUT and oracle-unstable cases". `criteria.ts` excludes only ORACLE_TIMEOUT (`:2`, `:27`), as plan-m6 A9 did for M6.

My full oracle pass found `run-fail-native` 15 of 289 UNSTABLE:
- 8 are libtest (F1).
- 7 are genuinely nondeterministic: a misaligned or overflowing address that ASLR changes on every run, in `mir/alignment/*` (6) and `array-slice-vec/vec-index-bounds-check-overflow.rs`.

So the most `run-fail-native` can reach is 274/289 = **94.8%, under M7c's 95%** even with a perfect port. Fixing F1 alone raises that ceiling to 282/289 = 97.6%. That is still below the plan's definition, which leaves those 7 out.

For `run-pass-native`, the full pass found 23 of 3,412 UNSTABLE (8 libtest, 15 others), so the ceiling is 99.3%. That clears 98%, but it is still a denominator the plan says not to count.

**Fix:** have the M7 groups leave out UNSTABLE as plan §6 says, with a test. Or, if root prefers A9's rule, record that decision and amend the plan's figures.

### F3. The duplicate-libc skip is wrong for 3 cases (`harness/suites.ts:2431-2442`)

These three gate `extern crate libc` behind `#[cfg(target_os = "linux")]`, so on this host the crate is never loaded:
- `tests/ui/intrinsics/panic-uninitialized-zeroed.rs#default` and `#strict` (line 17-18);
- `tests/ui/process/env-null-vars.rs` (line 8-10).

On the oracle, all three compile and link for the host with exit 0 (§5). `DUPLICATE_LIBC_REASON` says "both sides fail with E0464" for them, which is false. The cases are lost from `run-pass-native` and `ir-host`.

The other 17 hit E0464 as stated.

**Fix:** keep deciding from the source. Either treat an `extern crate libc` whose own `#[cfg(...)]` attribute is false on the host as not loading it, or name these three as exceptions. Then pin them in `m7-suites.test.ts`.

### N1. A `setsid()` child outlives the wrapper (`scripts/native-run.ts:25-26`, `:283-285`)

The header says a timeout "kills what it started too". That holds only for the process group. My test program forked a child that called `setsid()`, closed fds 0-2 and slept 12 s. The wrapper returned in 0.8 s; the child was still running afterwards, and 12 s later it wrote a file in the case directory.

It stays sandboxed, so it has no network and can write only under `<case dir>`. But it can write there while the other side's run is using the directory.

No run-mode test calls `setsid`, `setpgid`, `process_group` or `daemon` (grep of tests/ui at the pin). So this is a nit: correct the claim, or after each run kill every process whose executable is under `<dir>/work`.

### N2. The native compile inherits link-affecting variables the key does not cover (`harness/suites.ts:2312`, `scripts/lib/env.ts:31`)

`env.ts` leaves `SDKROOT` unscrubbed because it is "read only for linking". These are the first suites that link. `SDKROOT`, `DEVELOPER_DIR` (read by `xcrun`) and `LIBRARY_PATH` (read by `cc`/`ld`) all reach the compile and change the link, and none of them is in the oracle key.

Pin or remove them in `nativeCompileEnv`. Then they are in `c.env`, and so in the key.

### N3. Two run-pass cases fail on the oracle for harness reasons, and unix sockets in the case directory are denied too (`scripts/native-run.ts:139`, `:143`)

In the full pass, two run-pass cases fail on the oracle: exit 101, verdict "not met". Each fails the same way on both sides, so a MATCH there tests nothing:
- `tests/ui/process-termination/process-termination-blocking-io.rs`: `TcpListener::bind("127.0.0.1:0")` gets EPERM from the sandbox. This is the localhost case the handoff predicted, and it is the only one.
- `tests/ui/std/stdio-from.rs`: it reads `RUST_TEST_TMPDIR`, which bootstrap sets for compiletest and the fixed environment lacks. It is the only run test that reads it.

`(deny network*)` also covers binding a unix socket in the program's own `TMPDIR` (tested: EPERM). No run-mode test does that today.

Either give the program `RUST_TEST_TMPDIR=<case dir>/tmp` and allow localhost (and unix sockets under the case directory), or skip these two with a reason.

### N4. `native-run.test.ts`'s timeout test is load-sensitive (`scripts/native-run.test.ts:148-157`)

With `--run-timeout 1000`, the program had not printed `child=` before it was killed:
- in the full `bun test` run;
- in 2 of 2 runs of the file alone, at load 12-16 (my full oracle pass was running).

By hand, the same program with a 1 s limit printed nothing, with 2.7 s of wall. With 3 s it printed. A freshly written binary at a new path takes over a second to start here, which is probably the system's first-exec check of new code.

The "two runs differ" test also hit Bun's 5 s default once. These tests are in the gate's unit step. Give them a few seconds of headroom.

### N5. `should-fail` is not honoured (`scripts/native-run.ts:180-186`)

`tests/ui/compiletest-self-test/revision-bad.rs` (`//@ should-fail`, revisions `foo` and `bar`) reads "error-pattern … not found" on the oracle, which is what compiletest expects there. Both sides print the same line, so nothing is scored wrongly; only the verdict line misleads. Skip the test with a reason, or invert the verdict as compiletest does.

### N6. Handoff corrections

- "Two runs catch most nondeterminism" and the stable-then-cached `test-panic-abort-nocapture.rs`: see F1.
- The oracle-self sample's "48 equal, 2 UNSTABLE" for run-fail-native understates it. The full pass finds 15 of 289 (§6).
- The heavy split (M7c "+ heavy"): the full pass answers the handoff's follow-up. The slowest oracle case took 12.5 s (compile plus two runs), at load up to 16. Nothing comes near the 30 s run limit or the 180 s oracle limit, so on the oracle side there is no heavy set. A heavy set, if any, would come from the port's compile times.
