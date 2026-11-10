REQUEST CHANGES

# root-w46-check2: commit 2a9930d7 on integ-w46 (subject-bin's tests in a child `bun test`)

Reviewer lane `root-w46-check2`, read-only. I checked root's commit `2a9930d7` ("subject-bin's tests run in a child with a temp
RUST_TS_DATA") against its parent `344a014d`. Root's earlier commits `ea21be65` and `344a014d` belong to `root-w46-check`
and are not reviewed here.

Setup: detached worktrees of `344a014d` ("before") and `2a9930d7` ("after"), each with `.env.local` copied from
`.data/integ-w39`. Every run had `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`, on AC power (`pmset -g batt`:
"AC Power", charged), with no gate running. Bun 1.4.3 (c6da4a4d3). I edited nothing in `.data/integ-w46`. Each mutation
below was made in my own scratch worktree and reverted, and `git status` was clean afterwards.

The diagnosis is right, and the move fixes the failure. The wrapper fails correctly on a failing case, a load error, an
exit, a skip, a todo, a `.only` under the gate's `CI=true`, and a missing file. It does **not** fail when the child runs
zero tests (F1). That is a one-line fix, and with it I would approve.

## Findings

### F1. The wrapper passes when the child runs zero tests (`scripts/subject-bin.test.ts:24`)

`expect(out).toMatch(/\n\s*\d+ pass\n\s*0 fail\n/)` accepts `0 pass`. If `subject-bin.cases.ts` loads cleanly but
registers no tests, Bun 1.4.3 prints

```
 0 pass
 0 fail
Ran 0 tests across 1 file.
```

and exits 0, so the wrapper passes. Mutation check: I replaced the cases file with `import { test } from "bun:test";`.
Result: wrapper `exit=0  1 pass  0 fail`, both with `CLAUDECODE=1` and without it, and with or without `CI=true`.

This is not a regression: a zero-test file loaded in the parent process also passed silently. But the wrapper is now
the only check on these 19 cases. The gate's junit report shows one test where it used to show 19, so nothing else would
notice them vanish. That is the false-green class the project guards against (`scripts/lib/env-local-note.ts`, review
harness-m6c-recheck).

Fix, verified: change the regex to `/\n\s*[1-9]\d* pass\n\s*0 fail\n/`. With that change, the unmutated file passes
(quiet and loud) and the zero-test mutation fails (`exit=1  0 pass  1 fail`, quiet and loud). A stricter option is to
require `Ran 19 tests`, but that has to be edited with every new case. Not required.

## Nits

### N1. The child runs under Bun's 5 s per-test default, not the gate's 60 s (`scripts/subject-bin.test.ts:15`)

The gate passes `--timeout=60000` (`UNIT_TEST_TIMEOUT_MS`, `scripts/lib/unit-steps.ts:50`) because "Bun's 5 s per-test
default flakes under load". Before this commit the 19 cases ran under that timeout. The child gets no `--timeout`, so each
case now has 5 s. Measured (junit, 3 runs each), the slowest case is "a build behaves as `bun <entry>`": 0.82-0.84 s idle,
0.87-0.90 s beside 36 busy processes on 12 cores. The margin is about 6x, against 75x before. That is low risk today, but
it differs from the policy for no reason. Suggested fix: pass ``--timeout=${UNIT_TEST_TIMEOUT_MS}`` in the child's argv.
`unit-steps.ts` has no imports, so the wrapper can import it without loading common.ts.

### N2. Per-case results are gone from the gate's junit report

The parent's `runner-unit-tests.junit.xml` now holds one testcase for the 19 cases. Two effects:

- The gate's slowest-test note and `ALLOWED_SKIPS` no longer see these cases individually.
- Any skip or todo in the child fails the wrapper. Mutations M4 and M5 below confirm this: the summary gets a
  `N skip` / `N todo` line between `pass` and `fail`, so the regex fails. That is stricter than before, not looser, and
  acceptable, since none of these cases is allowed to skip.

On a failure, the `failed` array in the assertion still names the failing `(fail)` lines. It would help to say this in
the file's header comment, or to pass the child its own `--reporter=junit` if per-case timings are wanted later.

### N3. A stale self-reference (`scripts/subject-bin.cases.ts:115`)

`buildSpec("scripts/subject-bin.test.ts")` uses the old file name as an arbitrary entry for the cache-key tests. It is
harmless, since only the key's sensitivity is tested, but it now names the wrapper rather than the file it sits in.

## The six checks

### 1. Diagnosis: confirmed

- At `344a014d`, `bun test ./scripts/subject-bin.test.ts ./scripts/lib/deps.test.ts` gives `(fail) cache key > uses a temp
  oracle cache`, 30 pass, 1 fail. At `2a9930d7` it gives 13 pass, 0 fail.
- The full runner step (built as in check 6) gives `442 pass, 1 fail, Ran 443 tests across 43 files` at `344a014d`, and
  `425 pass, 0 fail, Ran 425 tests across 43 files` at `2a9930d7`. That matches the commit message: 443 − 19 cases + 1
  wrapper = 425.
- To trace the cause, I passed a preload (`--preload`, a `Bun.plugin` `onLoad` on `scripts/lib/common.ts`) to the full
  runner step. It prints a line, with the current `RUST_TS_DATA`, when the module loads.
  - At `344a014d` the first (and only) load comes right after `scripts/subject-bin.test.ts:`, with
    `RUST_TS_DATA=/Users/tomernorman/Documents/personal/rust-ts/.data`.
  - At `2a9930d7` it comes right after `scripts/lib/deps.test.ts:`, with
    `RUST_TS_DATA=/var/folders/.../T/rust-ts-deps-data-t1NXzM`, deps.test's temp dir.

### 2. The wrapper: mutation checks

I ran the wrapper (`bun test ./scripts/subject-bin.test.ts`) with the cases file mutated, once with `CLAUDECODE=1` and
once without. Both modes gave the same result in every row.

| Mutation | Result |
|---|---|
| M0: unmutated | pass (wrapper 1 pass) |
| M1: one `expect` fails | **fail** |
| M2: `throw` at top level (load error) | **fail** |
| M3: no tests at all | pass, **wrong** (F1) |
| M3b: one `test.skip` only | **fail** |
| M4: one test turned into `test.skip` | **fail** (N2) |
| M5: a `test.todo` added | **fail** (N2) |
| M5b: a `test.failing` that throws | pass (correct: Bun counts it as a pass) |
| M6: `process.exit(0)` inside a test | **fail** (no summary) |
| M7: `throw` in a `describe` body | **fail** |
| M8: unhandled async throw at load | **fail** |
| M9: cases file missing | **fail** |
| M10: `test.only` added, no `CI` | pass, other tests dropped |
| M10: `test.only` added, `CI=true` | **fail** |

On M10: the gate sets `CI=true` (`unitStepEnv`), and the wrapper passes `process.env` through, so the gate catches a
leftover `.only`. Outside the gate it does not, which is the same as for any other test file.

Summary format: without skips or todos, Bun 1.4.3 prints ` N pass\n 0 fail\n M expect() calls\nRan …`, quiet or loud.
With them it prints ` 1 pass\n 1 skip\n 1 todo\n 0 fail`, which the regex rejects (N2). The env-local-note warning
prints before the summary, so it cannot break the match. Apart from F1, the regex is robust.

### 3. Directory scans, tsc, tools

- **Test discovery.** Bun's test patterns are `*.test`, `_test`, `.spec` and `_spec` (`BUN_TEST_PATTERNS`,
  `scripts/lib/unit-steps.test.ts`), and `.cases.ts` matches none of them.
  - The full runner step lists 43 files and `subject-bin.cases.ts` is not among them.
  - The src/tools step and its `--isolate` alone step cover only `src`, `tools` and the four named `alone` files.
  - Only the wrapper runs the cases file.
- **tsc.** `tsconfig.json` includes `scripts`. An injected `const __typeErr: number = "x";` was reported as
  `scripts/subject-bin.cases.ts(238,7): error TS2322`. The clean tree passes `bunx tsc --noEmit -p .` (7.3 s).
- **Other tools.**
  - Markers: `coverage.ts --check` scans anchors in `src/` only, and the cases file has no markers.
  - Probes: `oracleTestProbes` reads `*.test.ts` only, and the cases file uses no probe.
  - `ALLOWED_SKIPS` has no subject-bin entry.
  - Junit: one testcase now (N2).
  - Searching `scripts harness src tools` for `subject-bin.test`, `subject-bin.cases` and `.cases.ts` finds only the two
    files themselves. Nothing relies on the old file name or test count.

### 4. The child's environment

- **Grandchildren.** The concurrent-build test spawns `bun -e` grandchildren (`scripts/subject-bin.cases.ts:181`) with no
  `env`, so they inherit the child's environment and import common.ts with the temp `RUST_TS_DATA`. Every builder call
  passes `root` explicitly, so the data dir is never used for the cache. The test passes and leaves no `.tmp-*`.
- **`NODE_ENV`.** The fixture sets it explicitly both ways (`{ ...process.env, ...env, NODE_ENV: undefined, ...env }`), so
  an inherited `NODE_ENV=test` from the parent `bun test` cannot change its assertions. The test passes in every run.
- **`BUN_JSC_*`.** These pass through unchanged, as before. With `BUN_JSC_useTailCalls=0`, before gives 19 pass, 0 fail
  and after gives a passing wrapper. The refusal tests use explicit env objects, not `process.env`.
- **`CLAUDECODE` / `AGENT` / `REPL_ID`.** The gate's runner step clears them (`oneProcessEnv`), so the child is loud. From
  an agent's shell the child is quiet. Both modes print the summary and the `(fail)` lines the wrapper reads, and every
  mutation gave the same result in both.
- **Other variables.** The only intended change is `RUST_TS_DATA`. `CI=true`, `RUST_TS_REQUIRE_PROBES` and
  `RUST_TS_HOST_TUPLE` reach the child as they reached the in-process cases.

### 5. Other runner files that load common.ts before deps.test.ts: none

Bun's order for the runner step (loud output) puts `scripts/lib/deps.test.ts` 33rd of 43. The 32 files before it include
`scripts/lib/common.test.ts` (30th), `gate-unit.test.ts`, `gate-probes.test.ts`, `frozen-lists.test.ts` and
`unstable.test.ts`. In the traced run at `2a9930d7`, none of the 32 loads common.ts, statically or dynamically: the
module's first and only load is in deps.test.ts, with deps.test's temp dir (check 1).

A caution, not a defect of this commit: Bun's order here is directory order, not alphabetical (`sysroot-key`,
`retry-times`, `rmeta-split`, …). A new file that loads common.ts can land before deps.test.ts. deps.test's "uses a temp
oracle cache" check is what catches that, as it did here.

### 6. The full runner step, as the gate runs it

I called `unitStaticSteps(UNIT_STEPS["runner unit tests"], dir)` from `scripts/gate.ts` and ran its command with common.ts
`run`, which merges the parent environment, from the worktree root. Command:
`bun test ./scripts ./harness --timeout=60000 --reporter=junit --reporter-outfile=…`. Env:
`{RUST_TS_REQUIRE_PROBES:"1", CI:"true", RUST_TS_DATA:<.data>, RUST_TS_HOST_TUPLE:"aarch64-apple-darwin", CLAUDECODE:null, AGENT:null, REPL_ID:null}`.

| Commit | Exit | Result | Time |
|---|---|---|---|
| `2a9930d7` | 0 | 425 pass, 0 fail, 43 files, 0 skipped in junit | 57.7 s wall (55.8 s traced) |
| `344a014d` | 1 | 442 pass, 1 fail (`cache key > uses a temp oracle cache`) | 58.0 s |

Load average was 2-4 during the runs. The child itself takes about 1.4 s.
