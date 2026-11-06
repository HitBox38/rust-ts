verdict: REQUEST CHANGES

Independent review of `harness-w41`: branch `t3/gate-power-safeguards`, head `db9581f5`, merged from `integ-w40` at `11ded631`. Line numbers are at `db9581f5`. I am read-only: this file is my only change to the tree. Patches and plants ran in a scratch worktree, since removed.

**One change is needed, and it is small: a hung reader can hang the gate (M1).** The brief requires that it cannot, and `commandOutput`'s comment says it cannot. A stuck `pmset` that SIGTERM does not end stops a gate for good, and if that happens at the last sample before `gate.json`, a run of about 10 h is lost. A tested 6-line fix follows. Everything else in this batch can land as it is.

**`--preload`, the main question, holds.** I found no Miri output that differs between the two forms. It skips only the parsing the first process threw away.

| id | severity | where | what |
|---|---|---|---|
| M1 | **MEDIUM, blocks** | `scripts/lib/host-state.ts:52-56,74`; `scripts/gate.ts:359,364,395,397,448` | A reader that SIGTERM does not end, or whose stdout stays open, hangs the gate |
| L1 | LOW | `scripts/lib/host-state.ts:127`; `scripts/gate.ts:359-360` | A failed first reading on battery: no refusal, no note, empty `powerLost` |
| N1 | nit | `scripts/gate.ts:453` | A hung read in flight at `process.exit(1)` leaves its process behind |
| N2 | nit, test gap | `src/miri/bin/miri.ts:24` | Nothing I ran notices if plain `miri.ts` loses its first import, and suites no longer use that form |
| N3 | nit, docs | `PORTING.md:150` | "`id` used only for interning" is not so |
| N4 | nit, docs | `src/rustc_middle/ty/context.ts:228` | A third stale comment, not on fixers-42's list |

## M1: a hung reader hangs the gate

`commandOutput` relies on `Bun.spawn`'s `timeout`, which sends SIGTERM, and then awaits both stdout and exit with no limit of its own. `gateRun` awaits a sample before it starts, at each suite's two ends, and before writing `gate.json`.

**`commandOutput` on stub commands, capped by my test at 20 s:**

| Stub | Result |
|---|---|
| Binary missing | `undefined`, 1 ms |
| Exits 1, with output | `undefined` |
| Garbage on stdout | The text; `parsePower` then gives `null` |
| Hung, dies on SIGTERM | `undefined`, 5.0 s. **The real `pmset`'s likely shape: no children** |
| **Ignores SIGTERM** | **Still waiting at 20 s; the test process stayed alive until I killed the stub by pid** |
| **`sh` wrapper, its child holds stdout** | **Still waiting at 20 s** |
| **Exits at once, a background child holds stdout** | **Still waiting at 20 s** |

**A real `gateRun` on a stub suite, with `RUST_TS_DATA` in a temp dir, and the reader being `commandOutput` on the SIGTERM-ignoring stub:**

| When it hangs | Result |
|---|---|
| The first reading | No output, no run. SIGKILLed by my driver at 40 s |
| After three good readings | No suite line, **no `gate.json`.** SIGKILLed at 40 s |

**How likely it is.** I could not hang the real `pmset`, so these are stubs. It has to be a process SIGTERM cannot end, such as one stuck in the kernel. That is rare, but the feature is report-only, so it should add no risk to a gate at all, and the cost of a hit is a whole gate.

**Fix, tested.** A limit on the read itself, plus SIGKILL:

```diff
-    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5_000 });
+    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: 5_000, killSignal: "SIGKILL" });
+    p.unref();
@@ sampleHost's read
+    let timer: ReturnType<typeof setTimeout> | undefined;
     try {
-      return await f();
+      return await Promise.race([f(), new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), 6_000); })]);
     } catch {
       return undefined;
+    } finally {
+      clearTimeout(timer);
     }
```

With this, both stub gates above reach `gate PASS` with `gate.json`, `power: null` for the hung readings, and no stub left alive. A power loss is still noted, and `host-state.test.ts` and `gate-power.test.ts` pass, 17 of 17. A test should be added using the SIGTERM-ignoring and pipe-holding stubs. The current `hostile` fake only throws.

## L1: a failed first reading on battery goes unnoticed

`follow` treats an unknown state as "no move" (`:127`), and the refusal reads only the first sample.

**Scenario, a real `gateRun`:** `pmset` gives nothing readable for the first two readings, then `Battery Power`. The gate runs on battery with no refusal and no `note:`, `powerLost` is `[]`, and `gate PASS` prints. The first reading can be garbage with the same result. Only `host.samples` shows it.

**Fix:** when the first known power reading of a run is on battery and `--allow-battery` was not given, print the `note:` and record it in `powerLost`. This is reporting only, so a status still cannot change.

## Nits

- **N1.** A read still in flight at the `process.exit(1)` of a failing gate (`gate.ts:453`) outlives it, as Bun's timeout dies with the parent. On a stub, `sleep 60` was left with parent 1. The passing path instead waits up to 5 s (4.85 s measured). The M1 patch does not address the orphan; I did not test it for that. A real `pmset` exits in milliseconds, so this only matters together with M1's rare case.
- **N2.** With the `miri_stack_first.ts` import deleted from `miri.ts`, on a scratch copy of head:
  - From a cwd whose `.env` sets `RUST_TS_HOST_TUPLE=bogus-host`, plain fails with `could not find specification for target "bogus-host"`, and the preload form prints `hi`, exit 0.
  - `stack.test.ts`, `contract.test.ts`, `bin/miri.test.ts`, `interface.test.ts`, `miri_program.test.ts` and `environment.oracle.test.ts` all still pass. The last one goes through `stack_miri_driver.ts`, not `miri.ts`.
  - So this is the one way I found for a program to pass with the preload and fail without it. It needs a future edit and a `.env`, and by reading the gap predates this lane, as suites run where no `.env` disagrees.
  - **Fix:** one unit test of plain `miri.ts` from such a cwd.
- **N3.** `PORTING.md:150` now says `id` is "used only for interning". It is also a memo key (`rustc_middle/ty/fold.ts:140`, `ty/layout.ts:1097-1098`) and what `hash_Interned` writes (`rustc_data_structures/intern.ts:96`). The old wording was wrong too. It matters little, except that it invites someone to change `id` freely.
- **N4.** `context.ts:228` says "every set maps the canonical key of the value". The handoff lists only `:1895` and `:2816`, so add it to fixers-42's N4.

## 1. `b3c9f0a6`, `--preload`

**Could a protected Miri case pass with it and fail without it, or the reverse? I found none.** Raw stdout, stderr and exit, with and without, alternating which ran first, `RUST_TS_REQUIRE_PROBES=1`, seed `review-harness-w41`:

| Suite | Pairs | Identical | Exit codes |
|---|---|---|---|
| `miri-hello` | 1 | 1 | 0 |
| `run-fail-miri` | 60 | 60 | 101: 37; 1: 23 |
| `run-pass-miri` | 60 | 60 | 0: 56; 1: 3; 101: 1 |
| `miri-pass` | 60 | 60 | 0: 55; 101: 2; 70: 3 |
| `miri-fail` | 60 | 60 | 1: 60 |
| `run-pass-aux-miri` | 60 | 60 | 0: 51; 1: 8; 101: 1 |

**What it runs, and why it saves so much.** It runs `miri_stack_first.ts`, whose `ensure_stack` re-execs. Bun parses an entry's whole import graph before evaluating, so the preload runs before Bun touches `miri.ts`. Modules fetched by a load plugin confirm it:

| Process | Fetched, plain | Fetched, preload | Evaluated, both |
|---|---|---|---|
| First, the one that re-execs | **2,245** | **11** | 11 |
| Second | 2,245 or more | The same | 2,245 (2,246 with the lazy error text) |

**Nothing that used to run stopped running:** the first process's 11 evaluated modules are the same, in the same order. If a module failed to parse, only the first process's work would move to the second.

**Instructions:** hello, 5 alternating runs, 38.75 G to 26.25 G, 32.2% less, identical output, RSS 642 to 637 MB. The direction agrees with the handoff, 28.75 G to 21.19 G (26.3%). My absolute figures are higher and I did not find out why. I did not repeat its 100-case runs.

**Evaluation order: byte-identical** on all 19 paths below, each module once, using a synchronous plugin. (An async one makes every compile fail with a `require()` error, so an order check with one proves nothing. All compile paths here ran for real, by their exit codes.)

- **Exit 0:** hello, `--version`, `sysroot.rs`, `exported_symbol_weak.rs`, `simple-rlib-import.rs`.
- **Errors:** a panic (`panics.rs`), `diverging-closure.rs`, E0308 under JSON, UB, `alias_through_mutation.rs`, a bad flag, a missing file.
- **ICE:** the real `mir-validation.rs`, exit 101.
- **Unported:** `shims/socket.rs`, `MIRI_BE_RUSTC=target`, program arguments with host `/proc` access.
- **No re-exec, one process (caller set `BUN_JSC_maxPerThreadStackUsage`):** hello and E0308: 2,245 and 2,246 modules.
- **`ice-mir-validation` by file path**, which exits 1 without the suite's flags.

**C10 holds.** `port_methods` and `declare module` run at module evaluation, and that order is identical. `ENSURED` and the module are one instance each: nothing evaluates twice, in either process.

**What code can see:**

| Thing | Result |
|---|---|
| `process.argv`, `Bun.main`, `Bun.argv`, `import.meta.main`, `process.argv0`, title | The same on a scratch probe, with `--preload` also in the arguments |
| `process.execArgv` | Holds the flag. Nothing in `src`, `scripts`, `harness` or `tools` reads it |
| Raw argv | `args_os` takes the tail by count (`src/std/env.ts:87`), so the flag cannot reach it. The re-exec passes it on, which is why the second process preloads too |
| `/proc/self/cmdline` | Not on this host. On Linux it reads through the same path. **Not run** |
| A symlinked repo path | Works |

**Miri's own `std::env::args()`:** a program printing raw arguments and sorted `vars_os`, on the oracle and both forms: **byte-identical on all 5 runs**: isolation off with `--preload` and the script paths as program arguments; isolated; odd environment names; `-Zmiri-env-forward`; no re-exec. Two of those are the oracle's own exit 1. A non-UTF-8 program argument matches between plain and preload (not compared with the oracle). An earlier version of the program that also read `/proc/self/cmdline` stops `unported` on the port under isolation off, identically in both forms.

**Proc macros: Miri suites run none, confirmed.**

- `run-pass-aux-miri`'s description and `AUX_DIRECTIVE` filter leave them out. A scan of the 5,231 cases' sources and argv finds no `proc-macro:` directive and no dylib argument.
- The 10 files that mention `proc_macro` or an aux crate ran under `DYLD_PRINT_LIBRARIES`: 8 from tests/ui, plus `sysroot.rs` and `exported_symbol_weak.rs`. **The only non-system image in any of them is `bun`.**

**A failing preload is loud.** Missing: `error: preload not found`, exit 1. Throwing or a syntax error: Bun's error, exit 1. Each is a DIFF on every Miri case, so a protected case is a loss. `miri.test.ts` also checks that the file exists.

**Oracle keys do not change.** `oracleCacheKey` (`scripts/difftest.ts:363`) has no subject in it, and the dump below confirms it.

**Applied only to Miri: yes, and that is right.** 5,231 subjects have the flag, and no other does. `main.ts` already uses a dynamic import after `ensure_stack`, so it has nothing to save.

**Do suites still test what a user runs?** Not directly any more. Plain `miri.ts` is still compared with the oracle in the gate's unit step, through `src/rust_ts/miri_program.ts:43` and the tests that use it, so its normal paths stay covered; N2 is the gap. **An option for root, not required:** a `src` lane could give `miri.ts` `main.ts`'s shape, a thin entry with a dynamic import. Users would then get the saving as well, and the flag could go.

**Stack depth: no shift found, but a noisy limit.** A parenthesis-nesting program hits `RangeError` around depth 10,200 in both forms. Binary search first gave 10,193 and 10,188, but a repeat showed that is noise, as one form both passed and failed near that depth:

| Depth | Plain fails | Preload fails |
|---|---|---|
| 10,150 and below | 0/6 | 0/6 |
| 10,200 | 6/6 | 5/6 |
| 10,250 | 6/6 | 5/6 |
| 10,300 and above | 6/6 | 6/6 |

A recursion counter under `BUN_JSC_useJIT=0` gives exactly 45,607 frames with and without a preload, three times each. The sample is too small to rule out a tiny shift, but one would not matter, given the noise. The noise predates this lane, and I did not find its cause. **Worth knowing for root:** a case right at this limit can flip on its own.

## 2. `71c5f70c`, gate and power

**Parsing and verdicts**, a real `gateRun` on a stub suite with fake readers:

| Reader | Result |
|---|---|
| Unparseable | `power: null`, nothing refused or noted, PASS |
| Desktop, `AC Power`, no battery line | `percent: null`, PASS |
| UPS | `onBattery: false`, PASS. A desktop on a UPS, fine |
| AC, battery, AC | Both `note:`s at the time, one closing note, `powerLost` has one entry, PASS |
| Failed or garbage first reading, then battery | **L1** |
| Hung | **M1** |

The lane's tests cover refusal, `--allow-battery`, and statuses being the same with and without a power loss. Refusal comes before `provenance` and the run directory. The real readers gave `AC Power`, load and swap in 18 ms.

**No status reads it.** In `gateRun`, `pass` is computed from what it was before. The `host` fields go only into `gate.json`, and `gateAccept` and `criteria.ts` read none of them.

**Nothing lands in the tree mid-run.** `host-state.ts` imports only `existsSync` and `loadavg`. Samples stay in memory until `gate.json`, which goes under `RUNS`. My tree stayed clean after the stub gates.

**`accept` of an old `gate.json`:** on a scratch copy of head, I took the real gate of 2026-11-05, which has no `host` or times, setting only its `head`, `dirty`, `pass` and `skipStatic`. Exit 0 across 59 suites. Only `docs/state/` changed, in that scratch copy.

**`docs/reviews/perf-near-limit.md` question (c):** power, charge, suite times, load and swap are all recorded, and the gate refuses on battery. Retry times came from harness-w40. The optional cases/s curve is not done, as the handoff says.

## 3. `97d34408`, `parse` skips

- **Exactly 3, none protected:** 0 of 3 in `harness/baseline/parse.txt` (21,523 lines), and the dump shows nothing else moved. `mir` and the other suites are untouched.
- **Own text:** correct flag, no `expanded`. "~13 GB" is attributed to `NOCORE_SKIPPED`.
- **The rule:** ORACLE_TIMEOUT for all 3 in each of the last 3 gates' `parse.jsonl` (2026-11-02, -04, -05). 300 s + 4 x 300 s is the 1,500 s stated. A12's rule is the oracle's cost, not the port's, and the subject's results (exit 0, exit 0, ICE) play no part. **I did not rerun these oracles**, as one writes about 13 GB and the disk has about 17 GB free. The measurement is the three gates.

## 4. `61448ce9`, L2 and N1-N5

**All cached Miri entries mask as before, by my own scan with both versions of `unstable.ts`:** 5,231 cases, 5,230 cached (the other is `panic1.rs`, listed unstable). 334 have a thread line, 1 ICE both before and after (`mir-validation.rs`, thread `rustc`), and **0 differ**, in `stderrMask` or `maskedTexts`.

**Plants on `mir-validation.rs`'s real cached output, through `compared` and `classify`:**

| Plant | Status |
|---|---|
| `rustc` id differs | MATCH |
| `rustc` becomes `rustc2`, or `main` with the same digits | DIFF |
| An extra `thread 'main' (1000) panicked` before it | DIFF |
| One stderr byte | DIFF |

**The changed expectation is right.** `stderrMask(true, ICE)` masking `thread 'main'` was the bug itself, and the commit says so. No other expectation weakened: the rest of that diff only adds tests.

**Anchoring the first marker loses nothing real.** 1,104 Miri cases use `--error-format=json`, but `report_ice` uses its own human-readable emitter, so the marker still starts a line. Anything else fails safe, as a false DIFF.

**A program naming its thread `rustc` and printing a marker at a line's start: accepted.** It needs both, no case does it, and it hides only that line's digits.

**N1-N5:**

| Item | Check |
|---|---|
| N1 | Correction appended, not rewritten. I did not rerun the 44 cases |
| N2 | `difftest.ts`'s header matches `:798-801` and `:854-857` |
| N3 | Tests plant the spacings; `coverage.ts --check --offline` gives `markers ok (24848; ...)` on the real tree, so the wider pattern hits no prose |
| N4 | Matches `runtest.rs`'s regex. 9 cases use `-Z mir-opt-level`, and the levels are 4: 346, 3: 2, 2: 21, 1: 8, 0: 29, so 60 of 406 |
| N5 | `mir` is 21,525 plus `mir-heavy`'s 1 |

## 5. `ff932780` and `3252743f`

**H8.** The pins for `opt`, `llc` and `llvm-as` equal `shasum` of the real files. A sysroot of symlinks to the real tools gives the same `ir-hello` key as the real one, so `libLLVM` matches too. With a fake sysroot through `PATH`:

| Sysroot | `suite("ir-hello").oracleKey()` |
|---|---|
| All real | The key |
| `opt` changed | One `ERROR:` line, exit 1 |
| `llc` missing | One `ERROR:` line, exit 1 |

No oracle ran with that `PATH`. The header states trust on first use, as H8 asked.

**H10.** The text matches the review, including 7 of 229 and "at most 37" (37 `lto` cases in `mir-o2` and in `mono-ui`, by the dump). I did not rerun the `!guid` removal.

**`PORTING.md`, against the code on head, which holds `integ-w40`'s `src/`:**

- **Hot interners:** type, const, predicate, region, external-constraint and canonical-input use `intern_value`; clauses and every list use `intern_slice`.
- **The others:** `ValTree`, `Pattern`, `Layout` use `intern_key`; `ConstAllocation` uses `key_Allocation`; `AdtDef` its own `hash()`.
- **"One or the other, never both":** holds, including the second `valtree` and `region` call sites (`context.ts:533,574`).
- `value_hash` and `value_eq` are where it says.
- Only `id` (N3) and the stale comments (N4) are off. The handoff asks root to record the decision that perf-near-limit N4 asks for, which is right.

## 6. Case lists, keys and runs

**Base `11ded631` against head, every suite, my own dump:**

| What | Result |
|---|---|
| Cases | 371,901 to 371,898. Gone: `parse`'s 3. Added: 0 |
| Skips | `parse`'s 3 added, none gone |
| Subject argv | Changes on 5,231 cases, in the 9 Miri suites, **only** by `--preload <path>`. Removing it gives the base's, for all 5,231. No non-Miri subject has it |
| Oracle keys | Only `ir-hello`'s 2 |
| Args, env, oracle argv, unstable, mode | No change |

**Is hashing a comment a defect? No.** `ir-normal.ts` shapes what the IR suites cache, so its text must be in the key, and a miss costs only an oracle re-run, with no baseline involved. Telling comments from code needs a parser, and a hand-kept version number can go stale and hide a difference. Keep it. It costs 2 oracle runs today. If `llir-*` uses the same key over thousands of cases, a comment edit gets expensive, and that is the time to reconsider.

| Check, `RUST_TS_REQUIRE_PROBES=1`, on AC | Result |
|---|---|
| `bun test ./scripts ./harness` | 351 pass, 0 fail |
| `bun test ./tools` | 72 pass, 0 fail |
| `bunx tsc --noEmit -p .` | Clean. My first run failed on `@types/bun` as this worktree had no `node_modules`; with the main checkout's linked, exit 0 |
| Upstream checkout, `git status --short --ignored` | Only `!! build/` |

**`--sample 200`, `RUST_TS_AGENT=review-harness-w41`, `--jobs 4`:**

| Suite | MATCH | Other, none protected |
|---|---|---|
| `parse` | 200 | |
| `mir` | 200 | |
| `run-pass-miri` | 200 | |
| `run-fail-miri` | 200 | |
| `miri-pass` | 195 | DIFF `mir-validation.rs` (frames); UNPORTED `open_a_file_in_proc.rs`, `shims/socket.rs`, `shims/socket-no-blocking.rs`, `intrinsics-x86-aes-vaes.rs` |
| `miri-fail` | 200 | No baseline for this suite |

No TIMEOUT, CRASH or ORACLE_TIMEOUT, under load 6-26 with another review running.

## What I did not check

- The gate, and any full suite.
- **A real battery or a really hung `pmset`.** Power is by fake readers, hangs are by stubs.
- Linux, `/proc/self/cmdline` and Windows.
- `run-pass-miri-heavy`, `miri-pass-heavy` and `miri-pass-tb` with and without the preload. They are 148 of the 5,231 and share the same code path. The paired samples are 301 of the 5,231, and the module order covers 19 paths.
- `--compile` bundles, which take no flag and have no code change here.
- `mirdump.ts` and `resdump.ts`'s possible saving, which the handoff also left.
- `ir-hello`'s oracle re-run.
- The lane's 100-case instruction totals.

## Housekeeping

- **Oracles:** none ran with a changed `HOME`. Every run kept the real `RUSTUP_HOME` and `CARGO_HOME`, and Miri's cases set their own.
- **Stubs:** my M1 tests left SIGTERM-ignoring stubs running, as they were built to. I killed each by pid, used no `pkill` or `killall`, and none remains. The `sleep 60` from N1 exited by itself.
- **`.env.local`** was copied into this worktree as the brief says, and is gitignored.
- **Scripts and outputs:** `/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-c6faf04c/ef1fdc2e-34c6-4be1-b7a2-8ef5b32569a5/scratchpad/`: `both.ts`, `cmp.ts`, `dump.ts`, `lo/`, `gh/`, `hs/`, `h8/`, `args/`, `st/`, and `out/fix-M1.patch`.
