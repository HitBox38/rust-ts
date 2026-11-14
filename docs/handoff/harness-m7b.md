# Handoff: harness-m7b (harness batch, plan-m7 wave 40r)

Branch `t3/add-m7b-report-suites`, from `e80bc814`. No port code: nothing under `src/` or `harness/baseline/` changes (`git diff e80bc814 HEAD -- src harness/baseline` is empty).

## Result

| Item | State |
|---|---|
| `ir-run-pass` | Done. 3,479 cases. Criterion 70% (M7b), with M7c's 95% in `criteria.ts` |
| `ir-run-pass-o0` | Done. 3,479 cases. Report |
| `ir-host` | Done. 3,415 cases, compiletest's own case set for the host, less 17 duplicate-libc cases. Report |
| `native-hello` | Done. 1 case. Criterion 100% (M7b) |
| `run-pass-native` | Done. 3,414 cases (17 duplicate-libc cases and 1 harness case skipped, 18 listed UNSTABLE). Criterion 80% (M7b), with M7c's 98% in `criteria.ts`. **Heavy split not done:** see "Heavy" |
| `run-fail-native` | Done. 289 cases, with compiletest's run verdict. Criterion 95% (M7c) |
| mono-run N1, N2, N4 | Done |

All six are report only. None has a baseline, so none is in the gate's defaults (a test pins this). Each needs `gate.ts run --suites` to count toward a milestone, as `ir-hello` did.

**Not asked for, added:**
- `scripts/oracle-self.ts`, to check the suites oracle against oracle (below).
- A fix to a test that was failing at `e80bc814` (below).

Say if either should go.

## For root

1. **`harness/m7-suites.test.ts` was failing at `e80bc814`.** Its test "ir-hello is not protected" broke when the wave 40q accept (`0da8b38d`) wrote `harness/baseline/ir-hello.txt`. The gate that made that accept ran before the baseline existed, so it could not see the failure. The next gate's unit step would have failed on it. The test now pins the two protected ids.
2. **The host sysroot has two `libc` candidates: done, per root's decision (2026-11-14T13:56).** `lib/rustlib/aarch64-apple-darwin/lib` holds `liblibc-36b36a684e611815.rlib` and `liblibc-ced695bcfa8f795f.rmeta`, the second from `rustc-dev`. So a host compile of `extern crate libc` fails with E0464 on both sides. Those cases are now skipped with `DUPLICATE_LIBC_REASON`; see "Duplicate libc" below.
3. **Merge order:** none. The native suites score UNPORTED until ssa-link-b and default-sysroot land, which is expected.
4. **Disk:** 5.2 GiB free at the end, down from 7.2 GiB at the start. Most of that went to other lanes; my additions are below.

## The suites

| Suite | Mode | Cases (skipped) | Target | Subject | Criterion |
|---|---|---:|---|---|---|
| `ir-run-pass` | IR N1 (`irSuite`) | 3,479 (488) | x86_64-unknown-linux-gnu | `main.ts` | M7b ≥ 70%; M7c ≥ 95% in `criteria.ts` |
| `ir-run-pass-o0` | IR N1 | 3,479 (488) | x86_64-unknown-linux-gnu | `main.ts` | report until M7c |
| `ir-host` | IR N1 | 3,415 (552) | aarch64-apple-darwin | `main.ts` | report |
| `native-hello` | native | 1 | host | `main.ts` | M7b MATCH (100%, every case) |
| `run-pass-native` | native | 3,414 (553) | host | `main.ts` | M7b ≥ 80%; M7c ≥ 98% |
| `run-fail-native` | native | 289 (37) | host | `main.ts` | M7c ≥ 95% |

The plan counts 3,478 for `ir-run-pass`; it is 3,479, as harness-m7a found for `mir-o2`. The plan's 294 for `run-fail-native` is the x86_64 count (`run-fail-miri`). On the host compiletest's `only-*`, `ignore-*` and `needs-*` leave 289.

`scripts/criteria.ts` gets six groups:
- **M7b:** `native-hello` 100% with every case counted (as `ir-hello`); `run-pass-native` 80%; `ir-run-pass` 70%.
- **M7c:** `run-pass-native` 98%; `run-fail-native` 95%; `ir-run-pass` 95%.

M7c's "+ heavy" is `run-pass-native` alone until a heavy sibling exists.

### How each extends the existing structure

- **IR suites:** `irSuite` as `ir-hello`. It gains an optional `skipped`, and `ir-hello` sets none, so it is unchanged.
  - `ir-run-pass` is `runPassCompiles()` (mir-o2's cases) plus `-Cno-prepopulate-passes --emit=llvm-ir`.
  - `ir-run-pass-o0` appends `-Copt-level=0` last. I checked on the oracle that the last opt level wins, so this overrides compiletest's `-O` and any level a test sets. `-O -Copt-level=0` gave byte-identical IR to `-Copt-level=0`.
  - The oracle key is `irOracleKey` as before.
- **`ir-host` and the native suites:** these use compiletest's case set and argv for the host. `harness/compiletest.ts` gets `withCompiletestTarget(target, f)`: host = target = `target` for `ignore-*`/`only-*`, `needs-*`, `--target=` and the output directory. It swaps the target's memos in, then puts COMPILETEST_TARGET's back.
  - A test runs one x86_64-only file and one Linux-only file before, inside and after the swap.
  - **Every existing suite is unchanged.** I dumped all 75 existing suites before any edit and at the head: cases, skips, descriptions, the first case's commands, and 15 sampled oracle keys each. The dumps are identical; only the six new suites are added.
- **`RunProps`** gains `errorPatterns`, `regexErrorPatterns` and `checkStdout`. They are parsed only with `run: true`, so only the run suites read them. `run-pass-miri` and `run-fail-miri` keep identical case lists and keys (same dump).
- **The native suites:** `nativeSuite` builds them on the new wrapper `scripts/native-run.ts` (plan D12's name).
  - A case's `args` are the wrapper's run options, `--`, then the compiler argv. So the oracle cache key covers both through difftest's own `c.args`.
  - `gate.ts` `oracleRuns` reads the wrapper's compiler, as for the other wrappers.

### `scripts/native-run.ts`: the native run mode

Its header is the full statement. In short:

- **One case directory, both sides in turn, under a lock**, as `ir-run.ts` does. The path is part of the program: `-Crpath` writes the way to the sysroot, and a panic names `argv[0]`.
  - The directory is `$RUST_TS_DATA/native/<suite>/<16 hex>`. Any other path is refused (`nativeDirRefusal`), since `work`, `tmp` and `home` are emptied.
  - difftest holds the suite's case lock around both sides.
- **The compile.** The side's compiler runs with `-o <dir>/work/a` appended (compiletest's `make_exe_name`). Its stdout, stderr and exit pass through. A failing compile ends the case with its exit code, so the port's 70 is UNPORTED.
- **The run follows compiletest** (`exec_compiled_test_general`, `compose_and_run`):
  - argv is the program and its `run-flags`; cwd is `work`; stdin is empty.
  - The dylib path is the sysroot's target lib directory, then `work/auxiliary`.
  - `exec-env` is set, then `unset-exec-env` removed, in that order.
- **What makes it safe:**
  - **The environment is not inherited.** It is `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, plus `HOME` and `TMPDIR` in the case directory. So the caller's `RUST_BACKTRACE` and other variables never reach the program (tested).
  - **`sandbox-exec`** with `(deny network*)`, localhost included, and no file writes outside the case directory and `/dev` (tested: connect and an outside write both fail with EPERM).
  - **Its own process group** (`perl` `setpgrp`, then `exec`). A timeout kills the whole group, and the group is killed after every run, so nothing it forked survives (tested).
  - **30 s per run.**
- **SIP strips the dylib path.** macOS removes `DYLD_*` variables when it starts a protected binary, and `perl`, `sandbox-exec` and `/usr/bin/env` are all protected. Checked: the variable did not arrive. So `/usr/bin/env` sets the `DYLD_*` variables last, inside the sandbox, and its exec of the program keeps them (tested).
- **Output.**
  - On stdout: `native-run: exit N` (or `signal S`, or `timed out after N ms`), compiletest's verdict, a header, then the program's stdout byte for byte.
  - On stderr: a header, then the program's stderr with each `stack backtrace:` block cut (plan §1g).
  - difftest's existing mask hides the thread id, since this is stderr.
- **The oracle runs the program twice (D12).** If the two runs differ after masking, or one times out, it prints `native-run: unstable: <why>` last on stderr. A new `UNSTABLE_ORACLE_PATTERNS` entry, anchored at a line's start, makes that case UNSTABLE: never cached, never MATCH. Only this wrapper prints the line.
- **compiletest's run rules, as a verdict line, with `--expect <mode>`** (runtest/ui.rs `run_ui_test`):
  - `RunResult`: Pass on success, Fail on an exit of 1 to 127, Crash otherwise. It is checked against the mode; `run-fail` may not crash, since this target unwinds.
  - Then each `error-pattern` and `regex-error-pattern` (both trimmed, as compiletest trims) is looked for in stderr, or in stdout then stderr with `check-stdout`.
  - A regex JS cannot compile is printed as "unchecked", never guessed.
  - The verdict is compared like any output.
  - `check-run-results` files are not used: the oracle's program is the expectation, as plan §1g says.
- **`rust_test_helpers`:** built once with `cc` and `ar` into `$RUST_TS_DATA/native/rust-test-helpers/<hash of source, cc -v, flags>`. `-Lnative=<it>` is put back in the native argv, after `-Crpath` and its `-Cdebuginfo=0`, where bootstrap puts its target-rustcflags. Every other suite still drops it. Flags: `-O0 -ffunction-sections -fdata-sections -fPIC -mmacosx-version-min=11.0` (bootstrap: opt level 0, no debug; 11.0 is rustc's deployment target for this host).
- **The compile's `PATH`:** the oracle's pinned `PATH` plus `cc`'s directory, set in the case's `env`, so it is in the key.

### Oracle cache key (`nativeOracleKey` plus the case)

| What changes the oracle's result | Where it is in the key |
|---|---|
| The compiler argv, the run options (args, env, expect, patterns, lib path), the test helpers' path | `c.args` |
| The compile's environment (the case env, the pinned `PATH`) | `c.env` |
| The test file and what it may read | difftest's file hash and `caseDeps` |
| The oracle rustc build, and so its std | `rustcDriverHash()` |
| The wrapper, the environment policy, the sandbox profile, the masks | hashes of `native-run.ts` and `lib/unstable.ts` |
| The link and the run on this machine | `cc -v`, `ld -v`, `xcrun --show-sdk-version`, `sw_vers` |
| The case directories' root (`argv[0]`, rpath) | `$RUST_TS_DATA/native` |
| The `rust_test_helpers` build | its directory name hashes its source, `cc -v` and flags, and that path is in `c.args` |

## Evidence

All runs used `RUST_TS_AGENT=harness-m7b`, `--jobs 6`, on AC power, with load 25 to 88 from other lanes. Run directories are under `$RUST_TS_DATA/runs/harness-m7b-*` and `oracle-self-*`.

### Oracle against oracle (`scripts/oracle-self.ts`)

Each sampled case's oracle command, then the same command as the subject side (`--side subject`, one run) still with the oracle's compiler, compared with difftest's masks.

| Suite | Cases | Equal | UNSTABLE | Differ |
|---|---:|---:|---:|---:|
| `native-hello` | 1 | 1 | 0 | 0 |
| `run-pass-native` | 50 | 50 | 0 | 0 |
| `run-fail-native` | 50 | 48 | 2 | 0 |
| `ir-run-pass` | 50 | 50 | 0 | 0 |

**Corrected after review harness-m7b (N6):** a sample of 50 understated it. The review's full oracle pass found 15 of 289 `run-fail-native` and 23 of 3,412 `run-pass-native` cases UNSTABLE. Most of them were libtest output and interleaving, which two runs catch only some of the time. See "Review harness-m7b: fixes".

The two UNSTABLE cases are real nondeterminism, caught by the two runs:
- `mir/alignment/borrow_misaligned_field_projection.rs`: the misaligned address in its abort message.
- `test-attrs/test-panic-abort-nocapture.rs`: the test harness's stdout.

Other oracle-side facts from the run-fail sample:
- **Every compiletest verdict is met** (`run-fail` and the others).
- **Every `error-pattern` is found.** Before I trimmed regex patterns as compiletest does, 6 cases said "not found": the directive's value starts with a space.

Oracle wall per native case, compile plus two runs, at load about 50: p50 1.8 s, max 3.0 s.

### The suites as difftest scores them (port side)

| Run | MATCH | DIFF | UNPORTED | UNSTABLE |
|---|---:|---:|---:|---:|
| `ir-run-pass --sample 200` | **185 (92.5%)** | 1 | 14 | 0 |
| `ir-run-pass-o0 --sample 50` | 45 | 1 | 4 | 0 |
| `ir-host --sample 50` | 47 | 1 | 2 | 0 |
| `native-hello` | 0 | 0 | 1 | 0 |
| `run-pass-native --sample 50` | 2 | 0 | 48 | 0 |
| `run-fail-native --sample 50` | 0 | 0 | 48 | 2 |

`native-hello` and `run-pass-native` were run again at the head commit, with the same results.

**`ir-run-pass`: the top first-difference and stop categories in the 200.**

| Count | Category |
|---:|---|
| 5 | UNPORTED `cg-intrinsic-b: intrinsic.rs generic_simd_intrinsic` |
| 3 | UNPORTED `llir: the x86 intrinsic table ("llvm.x86.sse2.pause"; target intrinsics are not in the IR model)` |
| 1 each | UNPORTED `va_arg.rs emit_va_arg`, `asm.rs codegen_inline_asm`, `asm.rs codegen_global_asm`, `llir: LLVMRustCreateMemoryEffectsAttr`, `llir: LLVMCreateDIBuilder` (debug info, D9), `rustc_sanitizers::cfi::typeid_for_instance` (out of scope) |
| 1 | DIFF `lto/thin-lto-global-allocator.rs` (`-Clto=thin`), line 8 |

On that DIFF:
- The oracle's pre-pass IR already has ThinLTO's promotion: `define hidden ... @..alloc_impl.llvm.6083437085335926002` where the port has `define internal ... @..alloc_impl`.
- Plan D8 makes ThinLTO a no-op in the port, so this case can never match as the suite stands.
- The same case is the one DIFF in `ir-run-pass-o0` and `ir-host`.
- It belongs on M7c's list of named cases.

**`ir-host`:** the other stops are `LLVMCreateDIBuilder` and `the aarch64 intrinsic table ("llvm.aarch64.isb")`.

**The native suites:**
- **Every UNPORTED case reaches the link.** 46 of `run-pass-native`'s 48, all 48 of `run-fail-native`'s, and `native-hello` stop at `ssa-link-b: self_contained_components`.
- The other two `run-pass-native` stops are `llir: LLVMCreateDIBuilder` and the aarch64 intrinsic table.
- The 2 MATCH were the `libc` E0464 cases (For root, item 2), now skipped: see "Duplicate libc" for the re-run.

### Protected suites (`--sample 200`)

| Suite | Result |
|---|---|
| `ir-hello` | 2/2 MATCH |
| `mir-o2` | 200/200 MATCH |
| `mono-ui` | 199/200 MATCH. The DIFF is `explicit-tail-calls/callee_is_track_caller.rs`, **not protected**: the codegen-time `track_caller` lint `mono-ui` leaves out, the same class as the mono-run-head review's DIFF |

The case lists and sampled keys of every existing suite are unchanged (dump above). No port code changed, so nothing protected can change.

### Checks

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/ ./scripts/` at load 6 (first commit) | 572 pass, 0 fail, 99.8 s |
| The same at the head, at load 36-45 | 570 pass, 2 fail |
| `scripts/gate-bun.test.ts`, `scripts/gate-unit.test.ts` alone, right after | 30 pass, 0 fail |

The two failures at the head were `gate-bun.test.ts` (its 5 s limit) and `gate-unit.test.ts`. Both are untouched, and both pass alone at the same load.

**Unit-step budget.** About 3.8 s of wall and under 2 s of CPU:

| Test | Wall | CPU |
|---|---:|---:|
| `native-run.test.ts` | 2.5 s | 0.4 s; mostly the 1 s timeout case and the program starts |
| `mono-run.test.ts` | 0.9 s | |
| the new M7b test in `m7-suites.test.ts` | 0.4 s | |
| `criteria.test.ts` addition | negligible | |

### Cache and disk

Oracle cache added by these samples is about 4.2 MiB, gzipped by difftest (D12):

| Suite | Cases sampled | Size | Per case |
|---|---:|---:|---:|
| `ir-run-pass` | 200 | 2.3 MiB | 11.6 KiB |
| `ir-run-pass-o0` | 50 | 1.0 MiB | 19.8 KiB |
| `ir-host` | 50 | 0.9 MiB | 17.4 KiB |
| native suites | 100 | 42 KiB | under 1 KiB |

Also written:
- `$RUST_TS_DATA/native/` holds 24 KiB (the test helpers; case directories are emptied after each run).
- About 15 KiB of entries orphaned by the key changes during the work.

**Full runs would add about 40 MiB (`ir-run-pass`), 67 MiB (`-o0`), 58 MiB (`ir-host`) and 3 MiB (native): about 170 MiB.**

## Duplicate libc (root's decision, follow-up commit)

**What is skipped, and why.** Every host-target case that names the `libc` crate is skipped with `DUPLICATE_LIBC_REASON` (harness/suites.ts):
- "skipped on the host: it has `extern crate libc`, and the oracle's host sysroot holds two libc candidates (std's rlib and rustc-dev's rmeta, which compiletest's stage sysroot lacks), so both sides fail with E0464 and the case would test nothing (root's decision 2026-11-14)".

**How the cases are found: from the source, never by running a compiler** (`hostLibcConflict`). A case qualifies if any of these has `extern crate libc` (an `as` rename included) outside a `//` comment:
- the test file;
- a file it may read through `mod`, `#[path]` or the include macros (`caseDeps`);
- an aux file it is given.

`#![feature(rustc_private)]` alone does not load the crate, so it does not count, but it always comes with the `extern crate` line in these tests. Block comments are not stripped: an over-approximation. None of the 25 run-mode files that match has the line in a comment. The native suites build no aux crates, so the aux files are empty there today; the parameter is for the aux suites to come.

**Which suites.**

| Suite | Same failure on the oracle? | Applied |
|---|---|---|
| `run-pass-native`, `run-fail-native` | yes (the cause) | yes |
| `native-hello` | does not apply: hello.rs has no `extern crate libc` (a test pins it) | nothing to skip |
| `ir-host` | **yes**: `tests/ui/process/fds-are-cloexec.rs` exits 1 with `error[E0464]: multiple candidates for \`rlib\` dependency \`libc\` found` | yes |
| `ir-run-pass`, `ir-run-pass-o0` | **no**: the same case compiles and writes `fds-are-cloexec.ll` (exit 0). The x86_64-unknown-linux-gnu sysroot has only std's `libc` | no |

**New counts.**

| Suite | Cases (skipped), before | After | Duplicate-libc skips |
|---|---|---|---:|
| `run-pass-native` | 3,432 (535) | **3,412 (555)** | 20 |
| `run-fail-native` | 289 (37) | **289 (37)** | 0: the one run-fail test with `extern crate libc` is already skipped (`needs-sanitizer-support`) |
| `ir-host` | 3,432 (535) | **3,412 (555)** | 20 |
| `native-hello` | 1 (0) | **1 (0)** | 0 |
| `ir-run-pass`, `ir-run-pass-o0` | 3,479 (488) | **3,479 (488)** | 0 |

The 75 existing suites are still identical to the dump taken before this lane's first edit.

**Re-run after the change.**
| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/ ./scripts/` | 572 pass, 0 fail, 95 s, at load about 5 |
| `run-pass-native --sample 50` | 0 MATCH, 0 DIFF, 50 UNPORTED (48 `ssa-link-b: self_contained_components`, 1 `LLVMCreateDIBuilder`, 1 aarch64 intrinsic table), 555 skipped |
| `run-fail-native --sample 50` | 0 MATCH, 0 DIFF, 49 UNPORTED (all `ssa-link-b`), 1 UNSTABLE, 37 skipped. Same sample as before, as its case set did not change |
| `oracle-self --suite run-pass-native --sample 50` | 50 equal, 0 unstable, 0 differ. Every oracle compile exits 0, so no duplicate-libc case is left in the sample |

The two earlier `run-pass-native` MATCHes, both E0464, are gone: the sample now holds no case the oracle fails to compile.

**Corrected after review harness-m7b (N6).** I first wrote that this re-run showed `test-panic-abort-nocapture.rs` "UNSTABLE once, then stable", and that two runs catch most nondeterminism. Both were wrong:
- That pair agreed by chance. The review saw 4 of 6 oracle invocations UNSTABLE, and the only varying line was libtest's `finished in 0.0Xs`. It is now masked (F1), and its old cache entry is stale through the wrapper's hash in the key.
- Two runs catch an address every time, but interleaving only some of the time. The full pass below needed a third run to catch 4 cases. Every case found unstable is now listed in `Suite.unstable` with its cause.

## Heavy (M7c's "+ heavy"): answered, none on the oracle side

The full oracle pass answers this (review N6).
- **Mine:** run-pass-native p50 1.6 s, p99 2.0 s, max 3.4 s per case (compile, then three runs), at load 2-28.
- **The review's:** max 12.5 s at load up to 16.

Nothing comes near the 30 s run limit or the 180 s oracle limit, so the oracle side needs no heavy set. A heavy set, if any, will come from the port's compile times once it links. M7c's group stays `run-pass-native` alone.

## Review harness-m7b: fixes

The review (`docs/reviews/harness-m7b.md` at `99a5229d`) was FAIL on F1-F3. Root's decision for F1 and F2 is `docs/state/history.jsonl`, 2026-11-14T14:53, "harness-m7b (review F1, F2)".

| # | Fix |
|---|---|
| F1 | **libtest programs made deterministic, per the decision.** |
| | - **`RUST_TEST_THREADS=1`:** the suite passes the wrapper `--libtest` when the compiler argv has `--test`, and the wrapper sets the variable before `exec-env`, so a test's own value still wins (tested). |
| | - **Masks in the harness's existing mechanism:** `scripts/lib/unstable.ts` gets `maskLibtestTime` and `maskProgramOutput`. The latter is the thread-id mask plus libtest's `finished in N.NNs`, which is anchored to libtest's `test result:` line, so a program's own "finished in" text still compares. |
| | - **Applied to stdout and stderr:** `maskedTexts` takes an optional output mask, and difftest's `compared` passes `maskProgramOutput` for suites with the new `Suite.maskProgramOutput`, which only the three native suites set. The cache keeps raw text, as before. |
| | - **The wrapper agrees with difftest:** its two-run check (`runsDiffer`) uses the same mask. |
| | - **The oracle key covers it:** `native-run.ts` (the environment) and `lib/unstable.ts` (the masks) are both hashed into it. |
| | - Then every native case's oracle ran twice, plus a third run (below). Each case still UNSTABLE is diagnosed and listed in `NATIVE_UNSTABLE`, so in `Suite.unstable`, with its reason. |
| F2 | **UNSTABLE leaves the M7 denominators.** `criteria.ts` gets `excludeUnstable`, set on every M7 percent group: `mir-o2`, `mono-ui`, `run-pass-native` (M7b and M7c), `ir-run-pass` (M7b and M7c) and `run-fail-native`. It reads gate.json's per-suite `unstable` list, and a gate.json without one is a problem, not a silent pass. |
| | - **Unchanged on purpose:** `allCases` groups (`ir-hello`, `native-hello`) still count every case, so an UNSTABLE hello is not met. The M6 groups are untouched: their output on the last accepted gate (`gate-20261114-065555-root-0e2v`) is byte-identical before and after. |
| | - **M7a on that gate reads as recorded:** `mir-o2` and `mono-ui` 3475/3479 with 0 unstable. |
| | - **Tests:** the review's 274/289 case now reads 274/274, and an M6 group still counts its UNSTABLE cases. |
| F3 | **cfg-gated `extern crate libc`.** `libcLoadedOn` blanks comments and string and char literals, then looks for `#[cfg(...)]` gates on the `extern crate` item and on every enclosing item or block. It evaluates them against the host's `--print=cfg` facts (all, any, not, name, `name = "value"`). A gate that does not parse counts as true, so a doubtful case is still skipped. The test is read from source; no test is compiled. |
| | - **Result:** the review's 3 cases are kept (`panic-uninitialized-zeroed.rs#default`, `#strict`, `env-null-vars.rs`), and the 17 that do hit E0464 stay skipped. |
| | - **Tests:** synthetic gates (own, enclosing fn, sibling item, `not`, `any`, unknown, in a string, in a comment) and the real files. |
| N1 | After each run the wrapper also kills every process whose environment holds this case's `HOME=<case dir>/home` (`ps -axwwE`, about 30 ms), which is unique per case and inherited by every descendant. A `setsid()` child is killed (tested). **Limit, documented in the header:** a descendant that leaves the group and clears or changes its environment survives, still sandboxed. |
| N2 | `SDKROOT`, `DEVELOPER_DIR` and `LIBRARY_PATH` (`NATIVE_LINK_ENV`) are in `nativeOracleKey`. |
| N3 | `RUST_TEST_TMPDIR=<case dir>/tmp` for every program, as bootstrap gives compiletest. `stdio-from.rs` now passes on the oracle. `process-termination-blocking-io.rs` is skipped with a reason (`NATIVE_HARNESS_SKIPS`), because the sandbox denies localhost by design. The full pass found no other case whose verdict is "not met". |
| N4 | The timeout test uses 4 s, which leaves room for a freshly written binary's first start. The other tests that spawn get 20-30 s Bun limits. |
| N5 | `should-fail` is parsed in run mode (`RunProps.shouldFail`, passed as `--should-fail`). The verdict adds `native-run: compiletest should-fail: met (a check failed)` or `not met (every check passed)`, as compiletest's `ShouldPanic::Yes`. The check lines stay as they were. |
| N6 | The corrections above, in "Oracle against oracle" and "Heavy". |

### UNSTABLE, before and after

| Suite | Before: the review's full pass | After the F1 fixes (full pass, three runs per case) | Listed in `Suite.unstable` |
|---|---:|---:|---:|
| `run-pass-native` | 23 of 3,412 | 17 of 3,414: 13 by the two runs, 4 more by the third run | 18: those 17, and `threads-sendsync/yield.rs`, which the review saw |
| `run-fail-native` | 15 of 289 | **7** of 289 | 7 |
| `native-hello` | 0 | 0 | 0 |

**What each listed case is:**
- **Addresses:**
  - `binops.rs`, `cast-region-to-uint.rs` and the 3 `equal-pointers-unequal/*/segfault.rs` (run-pass);
  - the 6 `mir/alignment/*` and `vec-index-bounds-check-overflow.rs` (run-fail).
- **Thread interleaving:** `panic-handler-flail-wildly.rs`, `park-timeout-wakeup-59020.rs`, `spawn-fn.rs`, `task-comm-14.rs`, `task-comm-3.rs`, `yield.rs`.
- **A hash seed:** `hashmap-debug-format.rs`.
- **A thread id the line-anchored mask cannot reach:**
  - in std's stack-overflow message: `stack-probes.rs#aarch64`, `stack-probes-lto.rs#aarch64`;
  - inside a `{:?}`-printed child stderr: `rt-explody-panic-payloads.rs`, `running-with-no-runtime.rs`.
- **rustc's own `RUSTC_LOG=info` naming its random link temp directory** (`work/rustc<6 random>/symbols.o`): `log-backtrace.rs`, `def-path-hash-ice-157238.rs`.

The reason for each is in `NATIVE_UNSTABLE`. **No libtest case is unstable after the fixes:** all 50 now give equal output across three runs.

**Full pass:** `bun scripts/oracle-self.ts --suite <s> --jobs 6`. run-fail-native took 129 s, run-pass-native 1,623 s.
- One run-pass case fails to compile on the oracle: `layout/randomize.rs#randomize-layout`, E0080, as in every run suite.
- No compiletest verdict reads "not met".

### Counts now

| Suite | Cases (skipped) |
|---|---|
| `run-pass-native` | 3,414 (553) |
| `ir-host` | 3,415 (552) |
| `run-fail-native` | 289 (37) |
| `native-hello` | 1 |
| `ir-run-pass`, `ir-run-pass-o0` | 3,479 (488) |

### Checks for this fix

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./harness/ ./scripts/` | 575 pass, 0 fail, 92 s, at load 3-5 |
| `oracle-self --suite run-pass-native --sample 100` | 100 equal, 0 unstable, 0 differ |
| `oracle-self --suite run-fail-native --sample 50` | 49 equal, 1 unstable: `borrow_misaligned_field_projection.rs`, which is listed, and `oracle-self` does not read the list |
| `run-fail-native --sample 50` (difftest) | 49 UNPORTED (`ssa-link-b`), 1 UNSTABLE: that listed case, scored by the list's reason |
| `ir-hello` | 2/2 MATCH |
| `mir-o2 --sample 200` | 200/200 MATCH |
| `mono-ui --sample 200` | 199 MATCH, 1 DIFF: `explicit-tail-calls/callee_is_track_caller.rs`, not protected, the same as the first round |
| The 75 existing suites | identical to the dump taken before this lane's first edit |
| criteria.ts on `gate-20261114-065555-root-0e2v` | M6 output byte-identical to the old criteria.ts. M7a: `mir-o2` and `mono-ui` 3475/3479, as recorded |

**`scripts/unstable.test.ts` updated:** it pins which suites have an `unstable` list, and the two native suites now have one.

**Unit-step wall of this lane's tests:**
- `native-run.test.ts`: 7.5 s, mostly the 4 s timeout case (N4);
- `mono-run.test.ts`: 0.9 s;
- the M7b test: under 1 s.

**Disk:** 9.6 GiB free at the end. The full passes write no oracle cache (`oracle-self` never does). This round added only the difftest samples' entries, under 1 MiB, and `$RUST_TS_DATA/native` is 32 KiB (the test helpers; case directories are emptied after each run).

## Review mono-run-head nits

| Nit | Result |
|---|---|
| N1 | `scripts/mono-run.test.ts`. It runs mono-run on a hello world with mono-ui's flags and checks exit 0, the `MONO_ITEM` lines (stdout and stderr equal to the oracle's), the collector and driver evaluated, and no module under `src/rustc_codegen_llvm/` or `src/rust_ts/llvm/` (the preload trick of wire.test.ts). **Checked against a mutant** with `codegen_crate`'s override removed: exit 70, fails |
| N2 | `print_pass_timings`, `print_statistics` and `print_statistics_json` overridden to throw `Unported`, with the reason in a comment. `join_codegen` too, which is never reached but would forward. I used `new Unported(...)` from the existing import, so mono-run's `src` imports are unchanged |
| N4 | The header now says main.ts forwards codegen since cg-register (`b52d34f6`), which is true at this base, and that nothing in mono-run loads the ported backend |

## Not done, not checked

- **The gate, and any full run.** Everything above is samples.
- **The heavy split** (above).
- **Native runs on anything but this host.** The wrapper needs `sandbox-exec` and refuses other platforms with a message.
- **`run-pass-aux-native` and the 52 proc-macro-aux cases.** Those belong to harness-m7c (harness-m7a's item 8).
- **Sanitizers, CFI and the plan's other named stops** are compiled and run like any case. The 17 run-fail tests that need `RUSTC_SANITIZER_*` configuration are skipped by the existing rule.
- **Localhost networking is denied too.** A test that binds 127.0.0.1 fails the same way on both sides. None was in the samples.
- **`ir-run-pass-o0` and `ir-host`'s first differences** beyond the 50 sampled each.

## `unported(...)` and `// PORT:`

None: no port code. (`mono-run.ts`'s new `Unported` throws are harness stops, listed under N2.)

## Commits

- `965e96be`: the suites, the wrapper, compiletest's target override, criteria groups, gate's `oracleRuns`, the mono-run nits, the tests, and the `ir-hello` test fix.
- `7ba72293`: the native key covers the case directories' root; `scripts/oracle-self.ts`.
- `106929e3`: this handoff.
- `941ed6c4`: the duplicate-libc follow-up: skips, tests, its section.
- The review harness-m7b fixes (F1-F3, N1-N6): its section.

## Files

- **Added:** `scripts/native-run.ts`, `scripts/native-run.test.ts`, `scripts/mono-run.test.ts`, `scripts/oracle-self.ts`, `docs/handoff/harness-m7b.md`.
- **Changed:** `harness/suites.ts`, `harness/compiletest.ts`, `harness/m7-suites.test.ts`, `scripts/criteria.ts`, `scripts/criteria.test.ts`, `scripts/gate.ts`, `scripts/lib/unstable.ts`, `scripts/mono-run.ts`.
- **New under `$RUST_TS_DATA`:** `native/` (the test helpers, and the per-case directories, emptied after each run).
- **Runs:** `runs/harness-m7b-*`, `runs/oracle-self-*`.
