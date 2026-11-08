**Verdict: APPROVE WITH NITS.** Nothing blocks the merge. I found no defect that loses a protected case, changes an oracle key or lets a bad run be accepted. The nits are about messages and margins.

# Review: lane `harness-w44` (gate checks, frozen-lists sample, re-landing `0d4092c4`)

- Batch: branch `t3/harness-gate-checks`, head `2ff85538`, against `main` `5c884ab9`. Handoff: `docs/handoff/harness-w44.md`.
- Reviewer: independent and read-only on code. I ran nothing in the tree under review: everything ran in scratch worktrees under my scratchpad (head `2ff85538`; head merged with fixers-47 `760e57f7`; the `git merge-tree` result with unit-parallel `b0ad7466`).
- Host: root Mac, AC power, load 8 to 25 from other lanes. Settings: `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, `RUST_TS_AGENT=rev-w44`.
- I ran no gate and no full suite. Run directories: `$RUST_TS_DATA/runs/rev-w44-*`.
- `$SCRATCH` below is my session's scratchpad. Its scripts and logs are temporary and not kept.

## 1. The `frozen lists` step (`scripts/frozen-lists.ts`)

**It catches the bug perf-heavy F1 described. Reproduced.** I planted the review's write in `TyCtxt.slice_intern`: `(r as T[])[0] = r[0]!` after `intern_slice`.

| run | result |
|---|---|
| `bun scripts/frozen-lists.ts`, clean head | 48/48 MATCH, exit 0, 22 s at load 16 |
| the same, write planted | **3/48 MATCH**, 45 CRASH (`TypeError: Attempted to assign to readonly property.`), **exit 1**, 18 to 19 s |
| `difftest --suite mir --sample 10`, write planted, lists unfrozen | 10/10 MATCH: the ordinary suites miss the write |
| a stub `gateRun` whose `staticChecks` hook runs the real `frozen-lists.ts`, write planted | `ERROR: frozen lists`, then `ERROR: a static check failed; the 1 suite(s) are not run`, then `gate FAIL`; no suite ran |

I reverted the plant, and `git status` was clean afterwards.

**Margin. Measured.** I ran each of the 48 sampled cases alone, unfrozen and then frozen (`$SCRATCH/time-sample.txt`):
- The slowest frozen case is `mir` `tests/ui/const-generics/early/const_arg_trivial_macro_expansion-1.rs`: **2.4 s against a 60 s limit**.
- The slowest `mir-o2` case is `process/process-spawn-failure.rs`: 2.2 s against 240 s. The slowest `check-ui` case is `cross-crate/auxiliary/cci_no_inline_lib.rs`: 1.7 s against 60 s.
- Frozen and unfrozen times match to ±0.2 s on every one of these small cases.
- Inside a gate the step runs alone: static steps run one at a time. Even ten-fold contention would leave it far under its limits. The step also keeps difftest's solo re-run of a pool TIMEOUT.

**Is the sample stable as baselines grow? Yes. Read and measured.**
- `sample()` (`difftest.ts:684`) ranks ids by `hash(seed + "\0" + id)` and takes the first 16. Adding ids can push existing ones out. It can never pull in an existing id that was outside the 16.
- So only a **newly protected** case can enter the sample, with a chance of about 16/N each: `mir` 0.07%, `mir-o2` 0.46%, `check-ui` 2.2%.
- Measured against older baselines on `main`: `mir` at 20,968 protected gives the same 16 cases as today's 21,522. `mir-o2` and `check-ui` give the same 16 too.
- See N1 for the one way this can stop a gate for the wrong reason.

**Oracle cache. Read.**
- The step calls the same `difftest()` with the same `oracleCacheKey`, so it can be no staler than the gate's own suites.
- A cold entry, for example after a change to the rustc_driver build, only costs time: 48 oracle runs of about a second each.
- It writes to `runs/<gate run>-frozen-lists/`. No script picks run directories by a `gate-` prefix; I grepped `scripts/` and `harness/`. So nothing mistakes that directory for a gate run, and `accept --run` on it fails with "no gate result".

**Cost at gate load.** Measured 14 to 22 s at load 12 to 25. For a gate of about 10 h, that is right.

**`0d4092c4` is in unchanged. Read.**
- `git show 0d4092c4` and `git show 8f2586ca` give identical patches once the `index` lines are dropped.
- `9a323212` changes only comment lines in `list.ts`. No later commit touches `src/` apart from `info_sites_check.ts`.
- `interning.test.ts` passes, 18/18.

**The refusal while `RUST_TS_FREEZE_LISTS` or `NODE_ENV` is set. Reproduced.**
- `NODE_ENV=production bun scripts/gate.ts run --suites lex` prints one `ERROR: NODE_ENV=production set: ...` line and exits. No run directory is made.
- `NODE_ENV=production bun test interning.test.ts` gives 2 failures: the F2 tripwire and `slice interning`.
- So a shell with `NODE_ENV=production` now gets a refusal at once, with the fix in the message. Before, its unit step would have failed, and with F7 the gate would stop about 15 minutes in.
- `NODE_ENV=test` would freeze every subject (perf-heavy F3). Refusing any `NODE_ENV` is therefore right.
- Neither variable is set on the root host. `bun` sets no `NODE_ENV` for `bun run`.
- Removing the refusal fails both refusal tests in `gate-static-stop.test.ts`. The test hook (`GateHost.staticChecks`) changes nothing on the real path: `checkProbes(..., !skipStatic && gateHost.staticChecks === undefined)` is the old call when no hook is given.

## 2. The early stop on a failed static step

**Is a stopped `gate.json` safe for its readers? Reproduced.** It holds `pass: false`, `staticOk: false`, `suites: []`, and every suite in `notRun` with the reason `a static check failed`.
- `gate.ts accept --run <it>` refuses: `ERROR: gate run ... did not pass; nothing accepted`. It writes no baseline: `pass` is checked first, at `gate.ts:530`.
- `criteria.ts --run <it>` prints every figure as `not met (the gate did not pass; the gate's static steps did not run clean; ...; 60 protected suite(s) not run)`. It neither throws nor shows a false figure. Its shape check (`criteria.ts:84-87`) accepts an empty `suites`.
- No other script reads `gate.json`. I grepped: `ir-normal.ts` mentions it only in a comment.

**The trade-off is right. Read.**
- `pass` already required `staticOk` (`gate.ts:501`). A run with a failed static step could never be accepted, before this batch or after it.
- What the stop gives up is only the suites' results as diagnosis, and a warmed oracle cache. What it saves is about 10 h of a run that could not be accepted.
- A flaky static step now costs one restart within about 15 minutes, where before it cost a whole gate. The static steps all still run, so one run reports every failure.

**Tested with a plant. Reproduced.**
- With the stop removed (`if (false && !staticOk)`), `gate-static-stop.test.ts` "a failed static check stops the gate" fails.
- With the stop in place, the end-to-end plant in section 1 stops a stub gate before its suite.

## 3. `info sites`

| tree | result | time |
|---|---|---|
| head | `upstream INFO sites 136 (skipped 3); in ported fns 83; fns not ported 18`, exit 0 | 0.52 to 0.81 s at load 12 to 14 |
| head merged with fixers-47 (`t3/fixers-47-queued-ports` `760e57f7`, the `t3-916330c7` worktree; auto-merge clean) | the same counts, the same report, exit 0 | **0.46 s** |

The 0.45 s figure holds at low load; at gate load it is about 0.8 s.

**Caveat:** fixers-47 at `760e57f7` changes no `tracing.` call. Its diff changes one `// rustc:` marker line. So that merge is weak evidence about log sites. If fixers-47 grows later, re-run the step on the merge.

**False failures. Read and measured.** The new "the scanner and the marker disagree" error matches on upstream file and fn name only (`info_sites_check.ts:194-199`). It could misfire when an INFO site's fn shares its name with another fn in the same file. At this pin there are 3 such fns, and every namesake of each is marked, so it cannot misfire today:
- `coercion.rs` `coerce` at 242, 1134 and 1609;
- `interpret/util.rs` `or_if_tracing_disabled` at 106, 109 and 115;
- `rustc_peek.rs` `peek_at` at 196, 210 and 234.

The upstream sites are pinned, so only a marker change could make one appear. See N3.

## 4. Per-case cache keys for rustc cases with `RUSTC_LOG` (`c8ca9c27`)

**Measured with my own dump script** (`$SCRATCH/tools/keydump.ts`, run on `main` and on head). For each suite it records `oracleKey()`, a hash of the case list, and every case's `caseOracleCacheKey`.
- **No suite's `oracleKey()` changes.**
- **Exactly 4 per-case keys change:** `log-backtrace.rs` and `def-path-hash-ice-157238.rs`, in `mir-o2` and in `mono-ui`.
- The miri suites' `RUSTC_LOG` cases keep their keys: 3 cases in `run-pass-miri` and `run-pass-aux-miri`. `logsSysrootPaths` asks for a `rustc` oracle.
- No case key failed to compute.

**Cheap and deterministic. Measured and read.**
- The oracle sysroot (`nightly-2026-10-11-aarch64-apple-darwin`) has 3,403 files under its `lib/rustlib/<target>/lib` directories.
- `sysrootFilesHash` takes 49 to 85 ms the first time in a process and 0 ms after (it is memoized). It runs only when a `RUSTC_LOG` rustc case is keyed.
- The list is relative paths plus sizes, sorted with `files.sort()`, plus the absolute sysroot path. No mtime is included. Two runs gave the same key.

**My read: keep it.** It costs 4 oracle re-runs once. It protects the one protected case (`mir-o2` `def-path-hash-ice-157238.rs`) against a false loss if the rustup home or the `rust-std` file set ever changes. Hashing the sysroot into `mir-o2`'s `oracleKey()` instead would re-run about 3,479 oracles for the same protection. See N4 for how broad the hash is.

## 5. The `host-rlib` report suite

- **Report-only. Read.** There is no `harness/baseline/host-rlib.txt`, and the gate's default set is the baseline files (`protectedSuites()`). `oracleRuns` knows `HOST_RLIB_RUN`.
- **One fixed directory under the case lock. Read.**
  - Both sides run `scripts/host-rlib-run.ts --dir $RUST_TS_DATA/host-rlib/<hash(id)[0:16]>`, one after the other inside `withSuiteCaseLock`: the `s.irTier || s.caseLock` branch at `difftest.ts:1077`.
  - The solo TIMEOUT re-run (`difftest.ts:1114`) is under the lock too.
  - The lock file lives in the shared data root, so difftests from different worktrees also wait for each other.
  - `caseDirRefusal` refuses any directory that is not an absolute `.../host-rlib/<16 hex>` before anything is removed.
  - The suite is single-mode, so no oracle re-run for diff files touches the directory.
- **The scrub of the five `*_DEPLOYMENT_TARGET` variables is safe. Measured and read.**
  - No `Case.env` of any of the 60 protected suites sets one. My dump scanned all 370,160 cases and found only the 7 `RUSTC_LOG` cases.
  - This host's environment has none of them, and no `SDKROOT`.
  - Keys never read the process environment.
  - With `MACOSX_DEPLOYMENT_TARGET=10.9` exported: `run-pass-aux-miri` sample 12 gives 12 MATCH, and `host-rlib --filter nocore` gives 6/6 MATCH, `IPHONEOS_DEPLOYMENT_TARGET=1.0` also set.
  - The scrub also complements fixers-47's `edb8e464`, which makes the subject read `MACOSX_DEPLOYMENT_TARGET`. On the merged tree, `host-rlib --filter nocore` gives 6/6 MATCH and `frozen-lists` 48/48.
- **Reproduced:**
  - `--sample 30` (seed `rev-w44`): 30/30 MATCH. `--filter nocore`: 6/6. `std`: 1/1. `extern`: 2/2. `staticlib`: 1/1. These used cached oracles.
  - **With fresh oracles** (`$SCRATCH/tools/fresh-hostrlib.ts`: no cache, both sides under the case lock), 10 cases gave byte-identical stdout, stderr and exit codes:
    - `nocore@x86_64-apple-darwin`;
    - `nocore@MACOSX_DEPLOYMENT_TARGET=10.9` (the minimum-version warning);
    - `...=abc` (the parse error, exit 1);
    - `std`, `extern`, `rlib+staticlib` (the dummy backend's staticlib warning);
    - 4 `ui.txt` files: lines 20, 80, 150 and 210.

## 6. Oracle keys, case lists and unit tests

- **All 60 protected suites keep their `oracleKey()` and case lists against `main`. Measured independently with my own script, not the lane's.** Both sides have 370,160 cases. The only per-case key differences are item 4's four.
- **`bun test ./scripts ./harness`:** head 411 pass, 0 fail, 60.4 s; `main` 394 pass, 64.6 s, at similar load. On their own, per file:
  - `case-lock.test.ts`: +9.7 s (4.7 to 14.3 s);
  - `ir-normal.test.ts`: −6.5 s (10.2 to 3.6 s);
  - the new files: under 1.3 s together.
  - Net, about +4 s of unit time per gate.
- **`bunx tsc --noEmit -p .`:** clean on head, and clean on the merge with unit-parallel.

## 7. The merge with `unit-parallel`

`t3/parallel-unit-tests` is still at `b0ad7466`, so it is not ahead. I checked anyway:
- `git merge-tree --write-tree 2ff85538 b0ad7466` is clean (tree `61ea96ee`).
- In that tree, `staticChecks` keeps unit-parallel's `unitStaticSteps` and `runStaticStep`, with `info sites` and `frozen lists` appended after `marker order`. The refusal and the early stop are both in `gateRun`.
- The merged tree type-checks.
- `gate-static-stop`, `gate-unit`, `unit-steps`, `gate-power` and `gate-probes` pass: 22 tests.

## Findings (all nits)

- **N1, `scripts/frozen-lists.ts:15-18` and `:56-57`. Read and measured; the scenario is not reproduced.**
  - The header says `mir` is safe because its cases are "ordinary tests/ui files". Nothing in the step guards against a slow case.
  - Scenario: root later protects a heavy next-solver case, such as one of perf-heavy F5's TAIT cases (46 s unfrozen, 62 s frozen, limit 60). With chance 16/21,522 it enters the `mir` sample. Its frozen run TIMEOUTs, and with F7 that stops the gate before the suites.
  - The cost is one restart, not a false loss, and the odds are small.
  - The ERROR line says only `TIMEOUT`. Suggest that a TIMEOUT line in this step name the remedy given in the handoff (change `SEED`, or exclude the case), so root does not take it for a regression.
- **N2, `scripts/gate.ts:441`. Read.**
  - The stopped `gate.json` sets `upstreamOk: true` without a check. That is harmless: no suite ran, and a dirty checkout already stopped the run at `gate.ts:420`.
  - Neither the stopped `gate.json` nor a passing one names the `<run>-frozen-lists` directory. Recording that path in `gate.json` would save a search when the step fails.
- **N3, `src/rust_ts/info_sites_check.ts:194-199`. Read and measured.**
  - The "disagree" rule matches on file and fn name, not on the fn.
  - It cannot misfire at this pin (section 3). But if a marker of `coerce`, `or_if_tracing_disabled` or `peek_at` were removed, it would report "disagree" rather than "not ported". Either way the step fails, but the message would point the wrong way.
  - Worth one line in the header.
- **N4, `scripts/difftest.ts:397-410`. Read.**
  - The sysroot hash covers every `<target>/lib` file, including rustc-dev's ~3,000 rlibs. So `rustup target add` or a change to rustc-dev would re-key the 4 cases without changing their output.
  - It uses sizes, not contents. That is fine, because the output prints names.
  - Over-broad and harmless. No change is needed.

## What I did not check

- I ran no full gate and no full suite: only the samples above, the 48-case step four times, and 39 `host-rlib` cases.
- I did not repeat the lane's mutants in `marker-check.test.ts`, `miri-sysroot.test.ts`, `case-lock.test.ts`, `ir-normal.test.ts`, `env.test.ts` or `sysroot-key.test.ts`. I ran those tests and they pass.
- I did not run `check-ui` with the deployment-target variables exported. I did run `run-pass-aux-miri` and `host-rlib` that way.
- I did not run the whole `host-rlib` suite (222 cases) with fresh oracles, nor `bun test ./src`. I ran `interning.test.ts` and `info_sites_check.test.ts`.
- I did not time a gate's whole static phase. The step and checker times above are separate runs.
- I did not look for the slowest protected `mir` case that could enter the sample in future: no per-case times are recorded. N1's odds rest on how the sampling works.
