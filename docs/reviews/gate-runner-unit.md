APPROVE WITH NITS

# Review: gate-runner-unit (`root/deps-test-env` at 447776b0, on integ-w34 adacaaf3)

Reviewer: independent, read-only on code (this file is the only change).
- **Scope:** `git show 447776b0`. `scripts/gate.ts` `staticChecks` (+19/-9): a new step "runner unit tests" runs
  `bun test scripts harness` in its own process with its own junit report. Both reports go through the skip check and
  are summed into one `SkipReport`. The header comment is updated. `scripts/lib/deps.test.ts` (+5/-1): restores the
  previous `RUST_TS_DATA` in `afterAll`.
- **State:** `bun scripts/state.ts summary`: no open STOP.
- **Build:** `bunx tsc --noEmit -p .` exits 0 with no output.
- **Runner tests under the gate's environment:** `RUST_TS_REQUIRE_PROBES=1 CI=true bun test scripts harness
  --timeout=60000` gives 86 pass, 0 fail, 472 expect() calls, 13 files, exit 0. Re-run with
  `--reporter=junit --reporter-outfile=/tmp/...` and parsed with the gate's own `junitSkips` + `classifySkips`:
  86 testcases, 0 skipped. The parser accepts the report: balanced, and its skipped total matches.
- **Baselines, oracle outputs, suites:** untouched.

## 1. Correctness of the new step and the summed SkipReport (OK)

- The steps run in order and every step runs. A non-zero exit sets `ok = false` and prints the last 15 lines, the same
  as for every other step. The report path is chosen by step name (`gate.ts:256`):
  - "unit tests" → `unit-tests.junit.xml`, as before.
  - "runner unit tests" → `runner-unit-tests.junit.xml`.
  - any other step → no skip check.
- A missing or unreadable report prints `ERROR:` and sets `ok = false`. The `continue` that follows is the last
  statement of the loop body, so it skips nothing else. This behaves as before.
- Summing: `skipped` and `allowed` add up, and `unexpected` is concatenated. With one report the result is identical
  to the old one. `skips` stays `undefined` only when neither report was read, and then `ok` is already false.
- **Consumers of `skips`:** the only one is `gate.ts:381`, which writes it to `gate.json` as `unitTestSkips`.
  `accept` (`gate.ts:398ff`) reads only `pass`, `skipStatic`, `head`, `dirty` and `suites` from gate.json. Nothing in
  `scripts/` or `harness/` reads `unitTestSkips`, assumes a single junit file, or depends on step names. The history
  path does not depend on them either. The field name `unitTestSkips` now covers both processes. That is acceptable,
  and the new comment at `gate.ts:272` says so.
- **Filter overlap:** `bun test` positional arguments are substring path filters, not directories. I checked the
  tracked test files:
  - no `scripts/` or `harness/` test path contains `src` or `tools`;
  - no `src/` or `tools/` test path contains `scripts` or `harness`.

  So the two processes run disjoint sets: 507 files and 13 files. The data dir `.data` is excluded too: Bun skips dot
  directories, and the run reports exactly 13 files.

## 2. The ratchet only gets stricter (OK)

- The "unit tests" command, environment, timeout and skip check are unchanged. The new step can only add `ok = false`.
  `pass` (`gate.ts:380`) still requires `staticOk`. `--skip-static` still makes a run unacceptable.
- `classifySkips` now runs once per report, so in principle an `ALLOWED_SKIPS` entry could be used once per report
  instead of once per run. Entries match on the exact `file`, and the file sets are disjoint (§1). The only entry
  (`src/rustc_span/source_map/tests.test.ts`) can therefore only match in the first report. No skip that failed the
  gate before can pass now.
- The only conditional skip in the runner tests is `describe.skipIf(!existsSync(MOD_RS))` (`scripts/rmeta-run.test.ts:142`).
  It is not allowlisted, so it fails the gate whenever the upstream checkout is missing. That is stricter than before,
  when the test was not gated at all.

## 3. deps.test.ts restore (OK)

`OLD_DATA` is captured before the assignment (`deps.test.ts:11`). `afterAll` deletes the variable when it was unset
before. Assigning `undefined` would have stored the string `"undefined"`, so `delete` is the correct choice. Otherwise
it restores the old value. This runs after the temp dirs are removed, which is fine. A file-level `afterAll` runs once,
after this file's tests.

## Findings

- **N1 (non-blocking): the probe pre-check does not cover the runner tests.** `scripts/gate.ts:89` checks only
  `oracleTestProbes()`, which scans only `src/` and `tools/` (`scripts/probes.ts:191-210`). Under
  `RUST_TS_REQUIRE_PROBES=1`, however, `scripts/gate-probes.test.ts:49` requires the probes of *every* registered
  suite. So `gate.ts run --suites lex` with an unrelated suite's probe unbuilt now fails late, at "runner unit tests".
  It fails with a test assertion instead of the up-front `ERROR: probe '…' not built … run: bun scripts/probes.ts
  build …` line. This is stricter, not weaker, and a full gate run checks every protected suite's probes up front
  anyway. Optional: with `unitTests`, have `checkProbes` also add every suite's probes, or scan `scripts/` in
  `oracleTestProbes`.
- **N2 (non-blocking): the comment at `scripts/lib/deps.test.ts:3-4` overstates what the restore fixes.** It says later
  test files "would otherwise look for their probes under the deleted temp dir". Restoring the variable helps only code
  that reads `process.env.RUST_TS_DATA` at call time. Modules already imported in that process keep the temp path,
  because `scripts/lib/common.ts:37` evaluates `DATA` once at import. That is why the separate process is still
  required. Suggested wording: "hygiene for later readers of the variable; modules that captured it at import keep the
  temp path".
- **N3 (non-blocking, optional): the report path depends on string comparisons of step names** (`gate.ts:256`).
  Carrying an optional junit path in the step tuple would remove the coupling between a step's label and its report.
  As written it is correct.
- **N4 (informational):** if a future test file under `src/` or `tools/` has `scripts` or `harness` in its path, or
  the reverse, it will run in both processes. That only duplicates a run and cannot hide a failure. A path filter such
  as `./src` would make the split exact, if wanted.

## Verdict

APPROVE WITH NITS. The change only adds checks. The summed SkipReport is correct and has a single consumer that does
not care how many reports there are. The restore in deps.test.ts is correct. The runner tests pass under the gate's
environment with 0 skips. There are no blocking findings.
