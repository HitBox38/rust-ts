# Handoff: harness-w45 (queued harness findings)

A reviewed batch of changes to `scripts/` and `harness/` (AGENTS.md section 2), plus `src/rust_ts/info_sites_check.ts` (item 5,
N3). Branch `t3/e0c25e65`, based on `main` at `519e6360`.

**No protected suite's cases, baselines or oracle keys change.** I dumped, for all 60 protected suites, `oracleKey()`, a hash of
the case list (id, file, args, env, cwd, in order) and every case's `caseOracleCacheKey`, from `git archive` trees of `main` and of
head (`2f2c3f0d`). The two dumps are **byte-identical**: 60 suites, 370,160 cases, 19 suites with an `oracleKey()`, 0 key errors.
`git diff main HEAD -- harness/baseline UPSTREAM.json harness/scope.json harness/suites.ts tools` is empty.

## Commits

| Commit | Item | Files |
|---|---|---|
| `4b9dbdbf` | 1 | `scripts/frozen-lists.ts`, `scripts/frozen-lists.test.ts` (new) |
| `0df375ad` | 2, 3, 4, 5 (N2) | `scripts/difftest.ts`, `scripts/gate.ts`, `scripts/retry-times.test.ts`, `scripts/gate-unit.test.ts`, `scripts/gate-static-stop.test.ts` |
| `f4c22baa` | 5 (N3) | `src/rust_ts/info_sites_check.ts`, `src/rust_ts/info_sites_check.test.ts` |
| `b52a42df` | 6 | `scripts/miri-sysroot-run.ts`, `harness/miri-sysroot.test.ts` |
| `2f2c3f0d` | 7 | `scripts/mono-run.ts` |

`info_sites_check.test.ts` is the assigned file's own test, so I added the N3 test there. No other file in `src/` changed.

`bunx tsc --noEmit -p .` is clean, and `bun test ./scripts ./harness` passes (417 tests, 0 failures, 62.6 s). So does
`src/rust_ts/info_sites_check.test.ts` (7 tests).

**Each fix's test fails without it.** I checked each one by reverting the source change, or by planting a mutant of the fix, then
restoring it:

| Item | Mutant | Test that fails |
|---|---|---|
| 1 | `frozenSample` ignores `exclude` | `frozen-lists.test.ts`: 717 excluded picks where 0 are expected |
| 2 | `difftest.ts` as on `main` | `retry-times.test.ts` (no `load1`) |
| 3 (a) | no file is named from the output | `gate-unit.test.ts`: the `src/bad.test.ts` load-error line is missing |
| 3 (b) | `ok` printed straight after the exit code, as before | `gate-unit.test.ts`: the alone exit(0) case prints 2 lines, not 1 |
| 4 | `gate.ts` as on `main` | `gate-unit.test.ts`: no `slowest:` line |
| 5 N2 | `upstreamOk: true`, and no `frozenLists` | `gate-static-stop.test.ts`: 4 tests |
| 5 N3 | `info_sites_check.ts` as on `main` | `info_sites_check.test.ts`: the namesake test |
| 6 | cleanup ignores the namespace tag | `miri-sysroot.test.ts`: the other namespace's and the old-format directories are removed |

## Items

### 1. Frozen lists never sample a case near its limit (w40d-audit N2)

- **Header corrected.** It now names `mir`'s three near-limit cases (`recursive-drop-elaboration.rs`, `-2.rs`,
  `error-tainting-issue-122904.rs`: 46-48 s of 60 alone, and a timeout frozen even alone). It also says their margin depends on
  lists staying unfrozen (`0d4092c4`).
- **The rule** (`nearLimitCases`): a case is left out if it appears in the `retryTimes` of any accepted gate run. Those runs come from
  `docs/state/history.jsonl` `accept` records, read from `<run>/gate.json`. Such a case's subject timed out in a gate's pool, at its
  limit, so its recorded time is at its limit.
  - The cases are left out **before** sampling (`frozenSample(ids, n, exclude, seed)`), so no seed and no size can pick one.
  - `sample` takes the first `n` hash ranks, so the picks are the same as before unless one of them is excluded.
  - The latest accepted run's `gate.json` must be readable and list every sampled suite with a `retryTimes` array. If not, the step
    fails with one `ERROR:` line.
  - Accepted runs whose directory is gone add nothing. Today that is the first three, from before `retryTimes` existed. 36 runs are read.
- **Why `retryTimes` and not a hand list:** it is simpler to keep sound. A future near-limit case is excluded once an accepted gate has
  had to retry it, with no edit to `frozen-lists.ts`.
- **What it cannot see:** a case the gate never retried has no recorded time, but it finished inside its limit in the gate's 12-job
  pool every time. The TIMEOUT error line now says that, and still names the remedy.
- **On real data** (`$SCRATCH/fl-check.ts`, the real baselines and runs):
  - 4 protected `mir` cases are left out: the three TAIT cases, and `hkl_forbidden.rs` (19.9 s alone, retried in 3 runs).
  - `mir-o2` and `check-ui` lose none.
  - **All three suites' 16 picks are identical to before** (the 48 cases the w40d audit checked).
  - Over 200 seeds × sizes 1, 16, 100, 2,000 and the whole baseline: 0 excluded picks, in 4.7 M picks for `mir`. Without the
    exclusion, size 2,000 picks them 92 times.
- **Shown for other seeds and sizes:** `frozen-lists.test.ts` covers 50 seeds × 4 sizes on synthetic ids, and the stay-put property.
  There is a new `--seed S` flag for trying another seed. The gate passes none.
- **End to end:** `bun scripts/frozen-lists.ts --per-suite 2` gave 6/6 MATCH frozen. It printed
  `left out 4 protected case(s) near their limit (in the retryTimes of 36 accepted gate run(s)): …` (run `w45-frozen-lists-2`).

### 2. Load at a retry (w40d-audit N1; reporting only)

`CaseResult.attempts.load1` = `{ pool, aloneStart, aloneEnd }`. These are the 1-minute `os.loadavg()` values, rounded to 0.01, sampled at
three points:
- when the pool's TIMEOUT was seen;
- at the start of the alone re-run (inside its case lock, so a wait for another difftest is not counted);
- at its end.

Past the retry cap, only `pool` is recorded. The value reaches `gate.json`'s `retryTimes` unchanged (`SuiteGate.retryTimes` type
updated). No status reads it. On Windows the values are always 0.

### 3. Unit steps name what failed, and say `ok` honestly (unit-parallel N3)

- **(a)** `errorsOutsideTests` reads Bun's output. A file with an error outside any test is printed as its path alone on a line
  (`src/x.test.ts:`), followed by `# Unhandled error between tests`. Each such file now gets a line:
  `failed: <file>: an error outside any test (it threw at load, a bad import or a throwing describe: the file is not in the junit report)`.
  - This works among the workers, alone, and when no report was written at all: a lone alone file that fails to load leaves none.
  - A `.only` under `CI=true` is reported the same way, so it is named too.
  - A failed step that names nothing prints
    `ERROR: <step>: bun test exited N, but its junit report names no failed test and its output no file: …`.
- **(b)** A step that writes a report prints `ok` only after the report is read. An `exit(0)` in the alone pass now prints only
  `ERROR: unit tests (alone) wrote no junit report (…); cannot check for skipped tests (bun test exited 0: a test that called process.exit?)`.
- Tested with real `bun test` fixture trees: a top-level throw and a missing import, among the workers and alone; `exit(0)` alone;
  a stub step for the "names nothing" line.

### 4. Slowest test per unit report (unit-parallel N4; reporting only)

`junitTests` also returns the report's files and its slowest `<testcase time>`. After the skips line, `runStaticStep` prints
`  slowest: <file>: <path> (<t> s)`. Over `SLOW_TEST_NOTE_S` (30 s), it adds a `note:`:
- among the workers: "can reach the 60 s per-test limit under load: consider adding its file to the step's alone list";
- in the alone pass: "even alone, …".

No file is moved. The last gate's slowest tests were 9.4 s among the workers and 18.4 s alone, so neither would print a note today.

### 5. harness-w44 N2, N3, N4

- **N2:**
  - The stopped `gate.json` now runs `upstreamStatus(UPSTREAM)` instead of writing `upstreamOk: true`. If the check is dirty it adds
    `upstreamChanges` and prints one `ERROR:` line.
  - Both `gate.json`s gain `frozenLists: { runId, dir }`: the `<run>-frozen-lists` directory, or `null` if the step wrote none.
  - I did not add an upstream check after the static steps on the *passing* path. That would make a passing gate stricter, and
    nothing shows that the unit tests leave the checkout clean. That needs measuring first; the stopped path cannot pass anyway.
- **N3:** `check()` takes the upstream file's lines (`main()` reads them from the checkout).
  - A marker of the same name at another line no longer counts as "disagree" if its own upstream line declares `fn <name>`. That
    marker belongs to a namesake, a different fn (`coerce` at 242, 1134 and 1609), so the fn at the scanner's line is "not ported".
  - A marker at a line that declares no such fn still disagrees.
  - An unreadable file falls back to the old rule.
  - At this pin the step's report is **byte-identical** to `main`'s: 136 sites, 3 skipped, 83 in ported fns, 18 fns not ported.
- **N4, not changed.** The sysroot hash is `hash([root, sorted "<path> <size>" list])`. Any change to the file set it covers changes
  the hash, so it would re-key the 4 `RUSTC_LOG` cases: it cannot be done without changing a key. Its breadth can also never matter
  in a gate: `verifyOraclePin` refuses to start unless the oracle's components are exactly the pinned ones, so rustc-dev cannot
  change, and no target can be added, between gates. Not worth 4 oracle re-runs.

### 6. miri-sysroot-run's cleanup across pid namespaces (root-w42-check N6)

- **New name:** run directories are now `<side>.run-<ns>-<pid>`. `<ns>` (`pidNamespace()`) is 12 hex digits of a hash of the host name
  plus, on Linux, `/proc/sys/kernel/random/boot_id` and the `/proc/self/ns/pid` link. A VM differs from the host by boot id; a
  container differs by its namespace inode.
- **What is removed:** a run removes only directories of its own side and namespace whose pid is gone (`staleRunDirs`; the pid must
  be a plain positive integer).
- **What is never removed:** another namespace's directories, and old-format `<side>.run-<pid>` ones. Both stay until removed by
  hand: a leak, never a loss.
  - There are no old-format leftovers today. The four crate directories under `$RUST_TS_DATA/rmeta/miri-sysroot/` are empty.
  - A macOS host name that changes (from DHCP) only leaks the older directories.
- **Scope:** the `miri-sysroot-*` suites are report-only, and the out dir is spelled `$OUT` in their output.
- **Test:** the stale-directory test now also plants these, all of which must be kept:
  - another namespace's directory with a dead pid;
  - an old-format directory with a dead pid;
  - a `0x1` name.

### 7. mono-run starts the logger

`scripts/mono-run.ts` calls `init_rustc_env_logger(early_dcx)` after `EarlyDiagCtxt.new`, as `rustc_driver_impl::main` and
`src/rust_ts/mirdump.ts` do. A bad `RUSTC_LOG_*` value is an `early_fatal`, which the existing `FatalErrorMarker` branch turns into
exit 101.

- **No protected case sets a log variable**, checked over all 3,479 `mono-ui` cases (`$SCRATCH/mono-env.ts`).
  - All 3,475 protected cases carry only `RUSTC_LOG_COLOR: null`, compiletest's `unsetRustcEnv` (an unset).
  - The harness also scrubs inherited `RUSTC_LOG*` (`SCRUBBED_ENV_PREFIXES`).
  - The only cases that set one to a value are unprotected: `attributes/log-backtrace.rs` (`RUSTC_LOG=info`,
    `RUSTC_LOG_BACKTRACE`) and `rustc-env/def-path-hash-ice-157238.rs` (`RUSTC_LOG=trace`).
  - So for protected cases the logger runs with `RUSTC_LOG` unset. Its default filter passes WARN and ERROR events. The port has 9
    such call sites (`tracing.warn`/`tracing.error`), none in `rustc_monomorphize` or the backend.
- **The logger now runs** (difftest, `--filter`, cached oracles):
  - `log-backtrace.rs`: was DIFF at line 11 (the oracle's `INFO rustc_metadata::creader resolving crate std`, nothing in the
    subject). Now it is an honest UNPORTED, `rustc_log::BacktraceFormatter`.
  - `def-path-hash-ice-157238.rs`: was DIFF at line 11 (the subject printed nothing at all). Now it first differs at line 646, at
    `INFO rustc_codegen_ssa::base codegen_instance(...)`: codegen after partitioning, which mono-ui does not compare.
  - Both stay unprotected.
- **Every protected case still matches.** A full `mono-ui` difftest on head ran at `--jobs 4` (run `w45-mono-ui-full`, cached
  oracles), with the host on AC power at a load of about 2-15 from other lanes.
  - Results: 3,479 cases, 3,475 MATCH, 3 DIFF, 1 UNPORTED. **3,475 of 3,475 protected cases MATCH**, none needed a retry, and
    nothing was lost.
  - The four non-MATCH cases are the four unprotected ones: the two log cases above and the two
    `explicit-tail-calls/callee_is_track_caller*.rs`.

The ICE hook (`install_ice_hook`) is still not installed in `mono-run.ts`, unlike upstream's `main`. The item asked only for the
logger. A protected case matches the oracle, so none ICEs. Root may want it installed, in a lane of its own.

## Left, and why

- Item 5 N4 (sysroot hash): not changed (above).
- Item 5 N2: no upstream check after the static steps on the passing path (above).
- Item 1: a case the gate never retried is never excluded. It has no recorded time (above). If the latest accepted run's directory is
  deleted, the step fails rather than guess.
- Item 6: other namespaces' and old-format directories are left in place, by design.
- No `unported(...)` was added or left, and there is no `// PORT:` decision: nothing here is a port.
- Coverage: no upstream-mirrored file changed (`info_sites_check.ts` is a rust-ts tool with no markers), so no coverage number moved.

## For root

- `retryTimes` is now read by `scripts/frozen-lists.ts`, to choose its sample. No status reads it.
- The gate log gains one `slowest:` line per unit report, and one more `frozen lists: left out …` line.
- Scratch output:
  - run directories `w45-monolog-log-backtrace`, `w45-monolog-def-path-hash-ice-157238`, `w45-mono-ui-full` and
    `w45-frozen-lists-2` under `$RUST_TS_DATA/runs`;
  - the key dumps, `fl-check.ts` and `mono-env.ts` in my scratchpad;
  - no oracle cache entry was written: every oracle used was cached.
