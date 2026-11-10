APPROVE WITH NITS

# root-w47-check: independent check of root commit 9bd994f1 (branch integ-w47)

Commit: `9bd994f1` "integ-w47: the unit steps run with RUST_TS_SUBJECT=source whatever the gate's mode", parent `a37f0d84`.
Changes `scripts/lib/unit-steps.ts` (`unitStepEnv` adds `RUST_TS_SUBJECT: "source"`), `scripts/lib/unit-steps.test.ts` and
`scripts/gate-unit.test.ts` (both expect the new entry). Checked read-only from a detached worktree of `9bd994f1` and this
branch (at `a37f0d84`); root's `.data/integ-w47` worktree was not touched. All runs on AC power (`pmset -g batt`: "Now drawing
from 'AC Power'" before each step), with no `.data/tmp/GATE_RUNNING`.

No findings. Three nits.

## 1. Is forcing `source` in the unit steps right?

Yes.

- The 4 failures of gate-20261110-013859-root-j9yr (from its `runner-unit-tests.junit.xml`: 425 tests, 4 failures) are all
  tests that read a suite's subject command and expect the source form: `harness/m7-suites.test.ts:76` (`subject.mirO2`
  to end with `src/rust_ts/main.ts`, received `x.rs`: the binary command has no entry path before the args),
  `harness/library.test.ts:165` (`/src\/rust_ts\/main\.ts$/`, received `.data/subject-bin/2e56dd07.../rts`),
  `harness/miri-sysroot.test.ts:47` (`f.subject.endsWith("src/miri/bin/miri.ts")`, line 78) and `scripts/miri.test.ts:231`.
  They test the suite definitions' shape, and pin the source form on purpose; none means "the gate's mode".
- Searched every `*.test.ts` and `*.cases.ts` that imports `harness/suites.ts`, `scripts/lib/subject-bin.ts`,
  `scripts/difftest.ts` or `scripts/phase-diff.ts` (26 files). The only ones that read the mode from the environment are
  the four above and `src/miri/shims/unix/virtual_socket.test.ts:57`, which runs `miriSubject(c.args)` end to end against
  the oracle's stdout. Its header (line 4) says it tests "the real port on probe.rs"; under a binary gate it ran the Miri
  binary (the gate's `unit-tests.alone.junit.xml`: 39 pass, 0 fail), now it runs the source. Either is the port; the
  binary's fidelity is the suites' job (they now run in binary mode, see 2) and `scripts/subject-bin-compare.ts`'s.
  `src/rust_ts/intern_key.test.ts` and `src/rustc_session/dep_tracking.oracle.test.ts` name harness/suites.ts in comments only.
- Binary mode stays covered independently of the variable: `scripts/subject-bin.cases.ts` passes the mode explicitly
  everywhere it matters (`subjectModeOf({...})` lines 35-39, `usesBinary(..., "binary")` lines 54-60,
  `subjectCmd(..., { mode: "source" | "binary" })` lines 63-76, the builder on a fixture tree from line 148), so it tests
  the same thing whether the step passes `source` or `binary`. It runs in a child of `scripts/subject-bin.test.ts`, which
  spreads `process.env` (so it now sees `source`), and passed in the runs below.
- Forcing it also makes the unit steps deterministic: before the fix the same commit's unit tests gave 421/4 or 425/0
  depending on how the gate was started, which the ratchet should never allow.

## 2. Does `source` reach every unit-step process, and nothing else?

Yes to both.

- `scripts/gate.ts:384` `unitStaticSteps` builds `env = unitStepEnv(DATA, ...)`; the src/tools step (workers) gets `env`,
  the alone pass and the runner step get `oneProcessEnv(env)` (`scripts/lib/unit-steps.ts:111`, a spread of `env`).
  `runStaticStep` -> `run` (`scripts/lib/common.ts:102`) is `mergeEnv(process.env, step.env)`: the step's entry wins over
  the gate's own `RUST_TS_SUBJECT=binary`.
- Measured, with `RUST_TS_SUBJECT=binary` in the parent and the env built from each commit's `unitStepEnv` /
  `oneProcessEnv` merged as the gate does, on 8 scratch test files that print `process.env.RUST_TS_SUBJECT`:
  at `9bd994f1` `--parallel=2` (2 worker pids), `--isolate` and one process all print `source`; at `a37f0d84` all print
  `binary`.
- Nothing later gets `source` by mistake: `unitStepEnv` is called only from `unitStaticSteps`. The frozen-lists step has
  its own env (`scripts/gate.ts:537`, `{ RUST_TS_FREEZE_LISTS: "1" }`), so it inherits the gate's `binary`;
  `scripts/frozen-lists.ts:163` calls `difftest()` in-process, whose subjects resolve the mode from `process.env`
  (`scripts/lib/subject-bin.ts:531`). The failed gate's frozen-lists run (`gate-20261110-013859-root-j9yr-frozen-lists`)
  recorded `subject.mode: "binary"` in all three summaries (mir, check-ui, mir-o2), with the gate's build hashes. The suites
  run in the gate process itself (`prepareSubject()` at `scripts/gate.ts:596`, mode from the gate's environment), which the
  commit does not touch; nothing in gate.ts writes `process.env.RUST_TS_SUBJECT`.

## 3. Other variables of the same kind

See N1 and N2. `RUST_TS_FREEZE_LISTS` and `NODE_ENV` are refused at the gate's start (`freezeEnvRefusal`,
`scripts/gate.ts:133`). `BUN_JSC_*` cannot reach a binary-mode gate's unit steps: `prepareSubject` (gate.ts:596, before the
static steps) calls `binaryModeRefusal` (`scripts/lib/subject-bin.ts:501`), which refuses any `BUN_JSC_*`; in a source-mode
gate it would pass through to the unit steps and the subjects alike, but gates now stay in binary mode (decision 2026-11-10T01:38).
`RUST_TS_AGENT` only names work dirs in the unit tests (e.g. `src/rustc_borrowck/bck_core.test.ts:85`); `difftest`'s
sample seed reads it but frozen-lists passes its own fixed seed.

## 4. Reproduction

Each step was built as the gate builds it: the commit's `UNIT_STEPS`, `unitStepArgs` / `aloneStepArgs`, `unitStepEnv(DATA,
"aarch64-apple-darwin")` and `oneProcessEnv`, merged over the parent with that commit's `mergeEnv`, the parent having
`RUST_TS_SUBJECT=binary RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`. Counts from the junit reports.

| step | commit | child's RUST_TS_SUBJECT | tests | pass | fail | skipped | time |
|---|---|---|---|---|---|---|---|
| runner unit tests | 9bd994f1 | source | 425 | 425 | 0 | 0 | 57 s |
| runner unit tests | a37f0d84 | binary | 425 | 419 | 6 | 0 | 247 s |
| unit tests (src/tools, 4 workers) | 9bd994f1 | source | 7396 | 7395 | 0 | 1 | 369 s |
| unit tests (alone, `--isolate`) | 9bd994f1 | source | 39 | 39 | 0 | 0 | 97 s |

- Root's 425/0 with the fix is reproduced exactly. The src/tools skip is the allowlisted
  `src/rustc_span/source_map/tests.test.ts` `read_binary_file_handles_lying_stat`, as in the failed gate (7396 tests,
  1 skip, 0 fail; alone 39/0).
- Without the fix I get 419/6, not root's 421/4. The 4 are root's 4 (section 1). The other 2 are
  `scripts/gate-power.test.ts:125` and `:144`, and they come from my setup, not from the commit: those tests run a real
  `gateRun` in a child with a temp `RUST_TS_DATA` (`scripts/gate-power.test.ts:54`, `{ ...inherited, RUST_TS_DATA: data }`), so in
  binary mode each child builds both subject binaries from nothing. Here the disk had about 2.6 GiB free, and one build
  failed with "BuildMessage: failed to write compiled executable rts". In root's gate the same tests passed but the step
  took 228 s; with the fix it takes 57 s. So the fix also stops the runner step from building full subject binaries
  (about 160-250 MB each) into temp dirs. Without the fix the result therefore depends on the disk as well as on the mode.
- My run at `a37f0d84` also left two builds for this worktree's path in `$RUST_TS_DATA/subject-bin`
  (`d157bf28...`, `d88e186b...`, made at 04:03 by the runner tests that resolve a subject command). I removed them afterwards: only
  my own run had used them.

## 5. tsc and the changed tests

- `bunx tsc --noEmit -p .` at `9bd994f1`: exit 0, no output.
- `bun test ./scripts/lib/unit-steps.test.ts ./scripts/gate-unit.test.ts` at `9bd994f1`: 6 pass, 0 fail. With only
  `scripts/lib/unit-steps.ts` put back to `a37f0d84`: 4 pass, 2 fail, and the 2 are the changed tests ("unitStepArgs: ...
  unitStepEnv: an unset host tuple stays unset" and "the unit-test step under --parallel: ... and the workers' env"). The
  file was restored and the tree is clean.
- The tests compare each step's env record, not a child's merged env. That is enough because `mergeEnv`'s rule that the
  overlay wins is tested in `scripts/lib/env.test.ts`, and section 2 measured the merged result.

## Nits

**N1. `RUST_TS_IMPL` from the gate's environment reaches the unit steps and can stop a port test from testing the port.**
`src/rust_ts/main.ts:19` reads it (`selected_impl`, `src/rust_ts/stack.ts:289`; `shim` forwards to the oracle rustc,
line 20). It is not scrubbed (`scripts/lib/env.ts` keeps `RUST_TS_*`), the gate does not refuse it (`freezeEnvRefusal`
names only `RUST_TS_FREEZE_LISTS` and `NODE_ENV`) and `unitStepEnv` does not set it. Unit tests that start main.ts with a
copy of `process.env` pass it on, for example `src/rustc_const_eval/const_eval/eval_queries.oracle.test.ts:22` (copy) and
`:80` (main.ts). Measured on that file at `9bd994f1`: unset, 2 pass; `RUST_TS_IMPL=stub`, 1 fail ("the port's stdout,
stderr and exit equal the oracle's"); `RUST_TS_IMPL=shim`, 2 pass, with the oracle compared to itself and the port never
run. The suites are safe: difftest sets `RUST_TS_IMPL` per case (`scripts/difftest.ts:853`). Suggest: `unitStepEnv`
pins it to `port` as this commit pins the subject, or `freezeEnvRefusal` refuses it. Not fixed here.

**N2. `REGEN=1` (and the fixture writers `*_WRITE`, `RUST_TS_WRITE_ORACLE`) also reach the unit steps.** 34 files under
src/ read `process.env.REGEN` (e.g. `src/rustc_hir/hir.oracle.test.ts:21`, `:65`). They rewrite their fixtures from the
oracle (`hir.oracle.test.ts` at load), which makes each "fixture is the current oracle output" test pass by construction. The gate catches a
fixture that actually changes ("the tree changed while the gate was running", `scripts/gate.ts:683`), so this costs
time and can fail a gate but cannot hide a loss. Low; worth adding to the same refusal or pin as N1.

**N3. The comment and the value differ.** `scripts/lib/unit-steps.ts:82` says the unit tests run the harness "in its
default mode", but line 92 pins the literal `"source"` (unit-steps.ts may not import `scripts/lib/subject-bin.ts`, see
its header). If `DEFAULT_SUBJECT_MODE` ever changes, the comment becomes wrong silently. Say "in source mode (the
default, `DEFAULT_SUBJECT_MODE`)", or add a check in `scripts/subject-bin.cases.ts` that
`unitStepEnv(...).RUST_TS_SUBJECT === DEFAULT_SUBJECT_MODE`.

**Note for root (not about this commit): the data volume is full.** `df` showed 2.6 GiB free (100%) during this check, and
`$RUST_TS_DATA/subject-bin` holds 17 builds, 3.9 GB. A binary-mode gate builds about 0.4-0.5 GB of binaries up front; a
full disk would fail it, as it failed the build in section 4. `bun scripts/subject-bin.ts prune` removes builds unused for 3
days (`PRUNE_AFTER_MS`). Free space before the next gate.
