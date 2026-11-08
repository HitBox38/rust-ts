# Lane `unit-parallel`: every test file loads first in its process; the gate's src/tools unit step runs in parallel

Branch `t3/738babfa`, from `5c884ab9` (main). Three code commits, then this handoff:

| Commit | What | Review |
|---|---|---|
| `35de7226` | Part 1: two import cycles entered from the safe side (`src/`, 2 files) | porting review |
| `b0ad7466` | Part 2: the src/tools unit step runs 4 workers, then 4 heavy files alone (`scripts/`) | **a reviewed batch** (AGENTS.md section 2) |
| `11150a71` | Part 2: a failed unit step names its failed tests from the junit report (`scripts/`) | same batch |

I did not run the gate. No protected suite's oracle key or case list changed (below).

## Part 1: the cycles

Both are the O1 pattern (fixers-43): a module reached first by a test imports a cycle's inner module by value, so the
cycle runs in the order that reads a binding before it exists. Each chain is the import stack of an ESM simulation over
`Bun.Transpiler.scan`, at the module that throws. Bun's real evaluation (a preload that logs each module's body as it starts)
agrees for `link.test.ts`: `spec/json.ts` is the 321st module in both, and the error points into it.

**`Cannot access 'Os' before initialization`** (4 files, one cause):
```
link.test.ts / decoder_a.oracle / root.oracle / rlib_stub.oracle
 -> rustc_codegen_ssa/back/metadata.ts -> back/apple.ts
 -> rustc_target/spec/mod.ts -> rustc_target/lib.ts -> rustc_target/spec/json.ts   (top level: FIELD_TO_JSON reads Os.to_json)
```
`spec/mod.ts` imports `lib.ts`, and `lib.ts` re-exports `spec/json.ts`, which reads `spec/mod.ts`'s `Os` at its top level.
Entered from `lib.ts`, `spec/mod.ts` finishes before `spec/json.ts` runs; entered from `spec/mod.ts`, it does not.
**Fix:** `back/apple.ts` takes `Os`/`Env` through the crate root, `import { spec } from "../../rustc_target/lib.ts"`
(the form 13 other files already use), and keeps `import type { Target }` from `spec/mod.ts`. Use sites are
`spec.Os.desc(..)`, `spec.Env.desc(..)`.

**`Cannot access 'MacroKinds' before initialization`** (`rustc_hir_analysis/contract.test.ts`):
```
contract.test.ts -> collect.ts -> traits/dyn_compatibility.ts -> traits/mod.ts -> traits/outlives_for_liveness.ts
 -> rustc_hir/def.gen.ts -> rustc_hir/hir.ts -> rustc_hir/def.ts   (top level: `...gen.MacroKinds`)
```
**Fix:** `outlives_for_liveness.ts` imports `debug_DefKind` from `def.ts` (which re-exports `def.gen.ts`), not `def.gen.ts`.

### Real module order: unchanged

A preload (`--preload`, or `BUN_OPTIONS=--preload=...` for the real binaries, which re-exec) logged every module of the
repo as its body started. Before the fix against after (and again on the final src commit):

| Entry | Modules | Before vs after |
|---|---|---|
| `main.ts`'s static imports, then `await import(rustc_driver_impl/lib.ts)` | 2,076 | identical |
| `stack.ts`, then `await import(miri/bin/miri.ts)` | 2,262 | identical |
| real `bun src/rust_ts/main.ts --edition 2021 --crate-type bin --sysroot <oracle> --emit=metadata hello.rs` (exit 0; re-exec logs 15 modules twice) | 2,092 lines | identical; the `.rmeta` is byte-identical |
| real `bun src/miri/bin/miri.ts --version` | 2,274 lines | identical |

`back/apple.ts` (#1406 / #1289) and `outlives_for_liveness.ts` (#983 / #827) are evaluated long after `rustc_target/lib.ts`
(#345 / #784) and `rustc_hir/def.ts` (#473 / #425) in both entries, so their imports were already no-ops there.

### Every other test file, in isolation

`bun test ./src ./tools --parallel=4` (each file with fresh modules), with `RUST_TS_DATA`, `RUST_TS_HOST_TUPLE`,
`RUST_TS_REQUIRE_PROBES=1`, `CI=true`: **7,388 tests over 625 files, 7,387 pass, 0 fail, 1 skip** (the allowlisted
Linux-only test). No other file fails. The same held in every run below.

**Hazards left (not changed):** other modules import a cycle's inner module by value and would fail the same way if a test
ever reached them first: `rustc_hir/def.gen.ts` from `fn_queries.ts`, `eval_queries.ts`, `ty/inhabitedness/mod.ts`,
`mir/pretty.ts`, `check/check.ts`, `check/wfcheck.ts`, `conflict_errors.ts`, `borrowck/type_check/mod.ts` (and the test
`late/diagnostics_b.test.ts`); `rustc_target/spec/mod.ts` from 22 files. None is reached first today. The gate now catches
one that is: the step runs every file isolated.

## Part 2: the gate's unit step

**What runs now** (`scripts/lib/unit-steps.ts`, `scripts/gate.ts`):
1. `unit tests`: `bun test ./src ./tools --parallel=4 --path-ignore-patterns=<each alone file> --timeout=60000 --reporter=junit --reporter-outfile=<run>/unit-tests.junit.xml`
2. `unit tests (alone)`: `bun test ./<alone files> --timeout=60000 --reporter=junit --reporter-outfile=<run>/unit-tests.alone.junit.xml`, one process, one file after another
3. `runner unit tests`: unchanged, one process (I did not audit scripts/harness for `--isolate`; review harness-w43 section 8 says not to extend it without one)

Each step's env adds `RUST_TS_REQUIRE_PROBES=1`, `CI=true`, `RUST_TS_DATA=<DATA>` and `RUST_TS_HOST_TUPLE` (if the gate has
one) by name (`unitStepEnv`). They were already inherited through `common.ts`'s `.env.local` load; now they do not depend
on that. Both reports go through the `ALLOWED_SKIPS` check (`runStaticStep`, the old loop body). The 1,800 s limit is
unchanged, per process. `--path-ignore-patterns` matches a whole path (checked: `src/a.test.ts` does not drop
`src/d/a.test.ts`), and repeated flags add up (a comma list does not work).

**New in the output:** a failed junit step lists up to 20 `  failed: <file>: <describe > test>` lines from its report.
Under `--parallel` a failing test prints wherever its worker's output lands, and in the planted-failure run below the
15-line tail did not show it. A `.only` refusal is not a junit failure (Bun reports it as an error), so it shows only in
the tail and the exit code.

### Which files run alone, and why

Measured on this host (12 cores, 8 performance, 24 GB), slowest single test of each run:

| Run | Load (1-min) | Wall | Slowest test | 2nd |
|---|---|---|---|---|
| serial gate junit, `gate-20261107-141645-root-lspa` | (gate) | 1,226 s | 18.4 `miri/contract` | 15.0 `ast_passes` ui |
| `--parallel=4`, all files, quiet | 1.4 at start, one sample of 108 while macOS `mobileassetd` ran at 165% CPU | 423 s | 25.3 `ast_passes` ui | 24.7 `miri/contract` |
| `--parallel=4`, all files, **12 CPU-bound burners** | 30-36 | 890 s | **46.0** `ast_passes` ui | **41.5** `virtual_socket` probe.rs |
| the 5 heaviest files alone, same 12 burners | 25-33 | 263 s | 36.5 `ast_passes` ui | 25.0 `miri/contract` |

Alone under the same load: `ast_passes` 46.0 to 36.5 s, `virtual_socket` 41.5 to 22.8 s, `inputs.oracle` 30.2 to 24.9 s,
`miri/contract` 29.2 to 25.0 s, `collector`'s `type_length_wraps` 25.0 to 15.3 s. 46 s of 60 is too close for a gate, so
the four files with a test of 29 s or more among the workers run alone: `rustc_ast_passes/oracle.test.ts` (about 9
processes at once), `miri/shims/unix/virtual_socket.test.ts`, `rustc_driver_impl/inputs.oracle.test.ts`,
`miri/contract.test.ts`. I left `collector.oracle` among the workers: it is the second-longest file (58-65 s), and its
worst test reached 25 s under burners and 28.7 s at load 90 (run 2 below).

Two things to know:
- **Under load 30 the old serial step would not fit.** At a 2.5-3x slowdown, 1,226 s becomes 3,000 s or more, past the
  1,800 s limit. The parallel step took 890 s there.
- **`ast_passes` alone still reached 36.5 s under burners, and 33.7 s in run 3.** That is the file itself: serial runs see
  the same. If a gate under heavy lanes flakes there, the file is the place to cut, not the step.

### The timed runs

Each ran the step exactly as the gate does: `unitStaticSteps(UNIT_STEPS[0])` then `runStaticStep` for each, from a
script that imports `scripts/gate.ts`, with no `RUST_TS_*` or `CI` in the shell (so the env came only from `.env.local`
through `common.ts` and from `unitStepEnv`). Tree state is `git status --porcelain` + `HEAD` before and after.

Load figures are 1-minute averages, sampled every 20 s.

**The three runs root asked for: final head `11150a71`, back to back, quiet** (no other lane's processes; the load is
mostly the run itself):

| Run | Load (1-min) | Workers | Alone | **Step** | Tests | Pass | Fail | Skip | Slowest test (workers / alone) | Tree unchanged |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3.3-11.7 | 346.7 s | 94.3 s | **440.9 s** | 7,388 | 7,387 | 0 | 1 (allowlisted) | 9.5 / 19.5 s | yes |
| 2 | 6.1-12.9 | 353.3 s | 95.5 s | **448.8 s** | 7,388 | 7,387 | 0 | 1 (allowlisted) | 9.6 / 20.2 s | yes |
| 3 | 5.9-14.4 | 353.2 s | 96.5 s | **449.6 s** | 7,388 | 7,387 | 0 | 1 (allowlisted) | 9.6 / 19.5 s | yes |

Serial: 1,226 s. So the step takes 37% of its old time and 25% of its limit.

**Earlier runs of the same step on `b0ad7466`, with other lanes running** (identical except for the failed-test listing):

| Run | Load (1-min) | Workers | Alone | Step | Pass / fail / skip | Slowest (workers / alone) | Tree unchanged |
|---|---|---|---|---|---|---|---|
| lane `t3-916330c7` busy | 8.6-32 | 456.7 s | 108.3 s | 565.0 s | 7,387 / 0 / 1 | 10.6 / 23.9 s | yes |
| A, lane `t3-acf02447` busy | 6.6-26 | 449.7 s | 158.2 s | 607.9 s | 7,387 / 0 / 1 | 12.6 / 32.0 s | yes |
| B, same | 16-90 | 619.4 s | 108.6 s | 728.0 s | 7,387 / 0 / 1 | 28.7 / 23.4 s | yes |
| C, same | 9.6-33.5 | 445.2 s | 121.2 s | 566.4 s | 7,387 / 0 / 1 | 9.8 / 33.7 s | yes |

**Negative checks** (on `b0ad7466`, full step, file planted at `src/rust_ts/zz_planted.test.ts`, removed after):

| Planted | Result |
|---|---|
| `test("planted failure", () => expect(1).toBe(2))` | `ERROR: unit tests`; 7,350 tests, 7,348 pass, **1 fail**, 1 skip; step **FAIL** (462 s, load 5-11) |
| `test.only(...)` + `test(...)` | `ERROR: unit tests`; Bun `1 fail, 1 error` (".only is disabled in CI environments"); junit has 0 failures, so the exit code is what fails it; step **FAIL** (449 s, load 5-11) |

`11150a71` came after these. It only adds output lines when tests fail; the three final runs are on it.

### Tests

`scripts/gate-unit.test.ts` (new) runs `unitStaticSteps` + `runStaticStep` on fixture trees in a temp dir, with
`parallel: 3` and two alone files:
- the workers see `RUST_TS_REQUIRE_PROBES=1`, `CI=true`, `RUST_TS_DATA`, `RUST_TS_HOST_TUPLE`, with the child's own copies deleted, so only the step's env can supply them;
- more than one worker pid; the alone files run once each, in one process, only in the second report;
- the allowlisted skip is allowed, and an unlisted skip fails by name;
- a failing test fails the step, among the workers or alone, and is named;
- `.only` fails under `CI=true` and passes without it;
- a test over the per-test timeout fails, and passes with time enough;
- nothing is written beside the tests;
- the real `UNIT_STEPS` commands and env.

`scripts/lib/unit-steps.test.ts`: argument and env shapes; every alone file exists, is a `.test.ts` under its step's
roots, and has no glob character; the second report's name collides with no step's.

**Mutations, all killed:** no `RUST_TS_DATA`, no host tuple, no `CI`, no `RUST_TS_REQUIRE_PROBES`, no `--parallel`, no
`--path-ignore-patterns`, no alone pass, no `--timeout`, unexpected skips ignored, exit code ignored.

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean |
| `bun test ./scripts ./harness --timeout=60000` | 397 pass, 0 fail |

## Oracle keys: `main` (`5c884ab9`) against this branch

A detached worktree of `main` in my scratchpad, and this tree, same `.env.local`. For all **60 protected suites**
(`harness/baseline/*.txt`):
- `oracleKey()`: identical (19 suites define one; 41 have none on either side);
- the case list (id, args, env, file; repo path masked) of all **370,160 cases**: identical;
- `caseOracleCacheKey` of every 100th case, **3,742 keys**: identical.

## Coverage, `unported`, `PORT`

Only imports changed, no function. `bun scripts/coverage.ts --missing`: `compiler/rustc_codegen_ssa/src/back/apple.rs`
8/8 ported, `compiler/rustc_trait_selection/src/traits/outlives_for_liveness.rs` 8/8 ported.
No `unported(...)` added or removed. No new `// PORT:`; the two imports carry `// Load order:` comments naming the cycle.

## Things root should know

- **Step time.** About 7.5 minutes quiet, up to 12 minutes at load 90, against 20.4 minutes serial. The alone pass is 94 to 158 s of that.
- **Two junit reports** for src/tools now: `unit-tests.junit.xml` and `unit-tests.alone.junit.xml`. `gate.json`'s
  `unitTestSkips` sums all three reports, as it summed two.
- **`--timings`** (slowest files first) would need a timings file kept up to date somewhere. I did not use it: the tail
  is short here, since the slowest worker file takes 60-105 s of a 450 s pass.
- **Memory** under 4 workers: not measured.
- The two `.test.ts` steps share `UNIT_TEST_TIMEOUT_MS` (60 s), now a named constant.

## Housekeeping

- `.env.local` copied from `integ-w39` with `RUST_TS_REQUIRE_PROBES=1` (gitignored). `node_modules` from `bun install --frozen-lockfile`.
- `RUSTUP_AUTO_INSTALL=0` in every shell; no `+nightly` under the Miri home (I never set `RUSTUP_HOME`). `rustc +nightly --print sysroot` once, under the default home.
- I killed only PIDs I started: the CPU burners and load samplers of my own scripts, by recorded PID. No `pkill`/`killall`.
- Scratch: the `main` worktree for the key comparison, removed (`git worktree remove`, `prune`). Fixture trees in temp dirs, removed by the tests.
- `$RUST_TS_DATA`: only read (oracle caches by tests, as usual).
