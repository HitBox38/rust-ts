# Handoff: harness-w48 (wave 40h)

Harness batch: root-w47-check N1-N3 (gate variables reaching the unit steps) and harness-w46 review N1-N3. No suite
definitions, cases, baselines, expectations, `scripts/lib/subject-bin.ts` or `scripts/subject-bin*.ts` touched.

## Files touched

| file | what |
|---|---|
| `scripts/lib/unit-steps.ts` | `UNIT_ENV_REFUSED` (variable -> reason) and `unitEnvRefusal(env)`; the `RUST_TS_SUBJECT=source` comment reworded (N3) |
| `scripts/gate.ts` | `gateRun` refuses with `freezeEnvRefusal() ?? unitEnvRefusal(process.env)`; header line; `crashedLine` (w46 N1); `outputTail` splits on `\r?\n` (w46 N2) |
| `scripts/host-rlib-run.ts` | holds `<case dir>/work.lock` (`withCaseLock`), each compiler `addLockHolder`ed; exports `LOCK_MAX_HOLD_MS`, `workLock` (w46 N3) |
| `scripts/rlib-native-run.ts` | the same, with host-rlib-run's constant and lock path (w46 N3) |
| `scripts/lib/unit-steps.test.ts` | refusal, env-read classification, fixture-writer scan, default-mode agreement |
| `scripts/gate-static-stop.test.ts` | refusal cases `RUST_TS_IMPL=shim`, `REGEN=1`, `TYREPR_WRITE=` ; child env strips the refused variables |
| `scripts/gate-power.test.ts`, `scripts/gate-probes.test.ts` | child env strips the refused variables (as it strips `NODE_ENV`) |
| `scripts/gate-unit.test.ts` | new crash wording, the timed-out wording, CRLF tail and notes |
| `harness/host-rlib.test.ts`, `harness/rlib-native.test.ts` | a SIGKILLed run's orphan compiler keeps the lock |

## Items

### root-w47-check N1: `RUST_TS_IMPL` (decision: the gate refuses to start)
No gate step needs it from the gate's environment: difftest (`scripts/difftest.ts:562`, `:853`), miri-diff (`:166`) and
phase-diff (`:58`) set it for each subject; `ctfe-sample` sets `port`; the subject build check unsets it
(`scripts/lib/subject-bin.ts:385`); frozen lists calls `difftest()` without `impl`, which defaults to `port`. So the refusal was
chosen over pinning it in `unitStepEnv`, as the task preferred. It is refused set to any value (even `port` or `""`), as
`freezeEnvRefusal` does.

### root-w47-check N2: fixture writers (decision: the same refusal)
Variables a test reads that change what it checks: `REGEN` (34 files, incl. the helper `src/rust_ts/typeck_oracle_fixtures.ts`),
`RUST_TS_WRITE_ORACLE`, `TYREPR_WRITE`, `TYPRINT_WRITE`, `TYCONSTS_WRITE` (rewrite fixtures), and `TYREPR_PROBE`, `TYPRINT_PROBE`,
`TYCONSTS_PROBE` (compare with a live probe instead of the checked-in expected.json). No UPDATE/BLESS-style name exists in the
repo. Refusal over unsetting: whoever set one meant something the gate cannot do, and a rewrite would otherwise surface only at
the end of the run ("the tree changed while the gate was running"); it also keeps one rule with `freezeEnvRefusal`.
To keep the list complete, `scripts/lib/unit-steps.test.ts`:
- reads every variable a `*.test.ts` file under the unit-step roots reads by name (`process.env.X`, `process.env["X"]`,
  `var_os("X")`) and requires each to be refused or in `UNIT_ENV_HARMLESS` (in the test, each with a reason);
- requires every fixture-writer-looking name (`REGEN`, `BLESS`, `UPDATE`, `*_WRITE*`, `*_RECORD*`, ...) read anywhere in
  src/tools/scripts/harness to be refused.
Debug-only variables are classified harmless, not refused: `DUMP`, `ANNOTATE_DUMP`, `MTP_DEBUG` (extra output only),
`RUST_TS_X86_TEST_TIMEOUT_MS` (a lower limit can only fail). Not caught by the scan: reads through destructuring or an env copy
(`const { X } = process.env`, `env.X`).

The three tests that run a real `gateRun` in a child now strip `UNIT_ENV_REFUSED` from the env they pass on; without that the
runner step fails whenever its parent holds one (e.g. a reproduction with `RUST_TS_IMPL=shim`).

### root-w47-check N3: comment and code
The comment now says source mode, naming `DEFAULT_SUBJECT_MODE` without importing it. New test: a child imports
`scripts/lib/subject-bin.ts` and prints `DEFAULT_SUBJECT_MODE`; it must equal `unitStepEnv(...).RUST_TS_SUBJECT` (the test
process itself does not load common.ts).

### harness-w46 N1: crash line
`crashedLine(file, timedOut)`: "the test file bun test was running when its process ended with no report (process.exit, an abort
or a crash, at load or in a test there; or async work an earlier file left running, such as a timer)"; on a timeout, "... when the
gate's limit killed it (a test there hung, or work an earlier file left running kept it busy)". The step still fails either way.

### harness-w46 N2: `\r\n`
`outputTail` splits on `/\r?\n/`, as the notes and `crashedIn` do. Tested with CRLF output: a note in the tail prints once, and
CRLF file-name lines are dropped like LF ones. (Display only; Windows is unchecked.)

### harness-w46 N3: lock holders
Both wrappers now hold `<case dir>/work.lock` around the whole run (no note on waiting: stderr is compared) and register each
compiler as a holder, as `ir-run` does. difftest's `<case dir>.case.lock` is still taken first, so in a normal run the wait is
zero. Both suites' oracle keys include the wrapper sources (harness/suites.ts ~2379), so their oracle caches miss once; their
output is unchanged. Report-only suites, no baselines.

## Mutation checks (each: the fix reverted, the named test file run)

| mutation | result |
|---|---|
| host-rlib-run: no `addLockHolder` | host-rlib orphan test fails |
| rlib-native-run: no `addLockHolder` | rlib-native orphan test fails |
| rlib-native-run: no `withCaseLock` | rlib-native orphan test fails |
| gate.ts: no `unitEnvRefusal` call | gate-static-stop: 3 refusal tests fail |
| unit-steps.ts: `REGEN` removed from the list | unit-steps.test: 3 tests fail |
| subject-bin.ts `DEFAULT_SUBJECT_MODE = "binary"` (temporary, restored) | unit-steps.test: the agreement test fails |
| gate.ts `outputTail` back to `split("\n")` | gate-unit fails at the CRLF notes assertion |
| gate.ts `crashedLine` ignores `timedOut` | gate-unit fails |
| gate.ts old crash wording | gate-unit fails |

## Test runs

Touched files: unit-steps 9/9, gate-static-stop 9/9, gate-unit 1/1, gate-power 7/7, gate-probes 5/5, host-rlib + rlib-native
12/12.

The gate's unit steps, built by `unitStaticSteps` and run by `runStaticStep` from scripts/gate.ts (so `unitStepEnv` merged over
the parent, the parent also having `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`), one at a time:

| parent | step | tests | fail | skipped | time |
|---|---|---|---|---|---|
| `RUST_TS_SUBJECT=binary` | runner unit tests | 434 | 0 | 0 | 64 s |
| `RUST_TS_SUBJECT=binary` | unit tests (src/tools, 4 workers) | 7396 | 0 | 1 (allowlisted) | 386 s |
| `RUST_TS_SUBJECT=binary` | unit tests (alone) | 39 | 0 | 0 | 96 s |
| `RUST_TS_IMPL=shim` | runner unit tests | 434 | 0 | 0 | 65 s |
| `RUST_TS_IMPL=shim` | unit tests (src/tools, 4 workers) | 7396 | 8 | 1 (allowlisted) | 232 s |
| `RUST_TS_IMPL=shim` | unit tests (alone) | 39 | 3 | 0 | 59 s |

The `shim` failures are N1's hazard, not regressions: tests that expect the port's own stops or behavior got the oracle
(track_caller, print.oracle x2, json.oracle -Ztrack-diagnostics, compare_impl_item refine_rpitit, metadata_temp_dir,
monomorphize wire x2, inputs.oracle x3). eval_queries.oracle passes under `shim`, comparing the oracle with itself. Unit steps are
deliberately not made immune by pinning; the gate now refuses to start with `RUST_TS_IMPL` set, so they never see it
(gate-static-stop "RUST_TS_IMPL set: refused before anything runs"). If root wants both, adding `RUST_TS_IMPL: null` to
`unitStepEnv` would need its return type widened to allow `null`.

`bunx tsc --noEmit -p .`: clean. (The worktree had no `node_modules`; `bun install --frozen-lockfile` installed 6 packages.)

## Not applicable
Coverage, `unported(...)` and `// PORT:`: none (no ported code touched). No difftest samples run (no compiler change).

## Note for root
The `RUST_TS_IMPL=shim` run left `src/rustc_hir_analysis/check/compare_impl_item_oracle/cases/librefine_rpitit.rlib` (untracked):
under `shim` the oracle, not the port, ran in that test's end-to-end case and wrote its rlib next to the source. I removed it. A
gate would have caught this as "the tree changed while the gate was running"; with the refusal it can no longer happen in a gate.
