# Handoff: harness-w35 (harness batch: scripts/, harness/, plus the pin in UPSTREAM.json; needs an independent review)

Branch `t3/f1a16ade`, on main `2c5444fc`. No ported code was touched, so there are no `unported(...)`, `// PORT:` or
coverage changes. No baselines, oracle outputs, suite case lists or oracle cache keys were changed.

## Files touched

| file | change |
|---|---|
| `UPSTREAM.json` | `rust.components`: the oracle toolchain's pinned component list (task 1) |
| `scripts/lib/toolchain.ts` (new) | `installedComponents`, `pinnedComponents`, `oracleToolchainError` (pure, no `common.ts` import) |
| `scripts/lib/toolchain.test.ts` (new) | fake-sysroot tests, plus the pin against the real oracle toolchain |
| `scripts/lib/oracle.ts` | `verifyOraclePin` also runs `verifyOracleToolchain` (new, sync, memoized) |
| `scripts/lib/common.ts` | `UpstreamPin.components` |
| `harness/suites.ts`, `harness/library.ts`, `harness/compiletest.ts` | the three oracle aux builders call `verifyOracleToolchain()` right before they build |
| `scripts/gate.ts` | `verifyOraclePin()` at the start of `gate run`; unit steps from `UNIT_STEPS` (junit path in the step, `./<root>` arguments); `checkProbes` pre-checks every probe the runner tests need (N1, N3, N4) |
| `scripts/lib/unit-steps.ts`, `.test.ts` (new) | `UNIT_STEPS` and `unitStepsOf`; the test checks that every `*.test.ts` in the repo runs in exactly one unit process |
| `scripts/probes.ts` | `oracleTestProbes(roots)` (default: src, tools, as before); it also matches `probeBinary("…")` |
| `scripts/gate-probes.test.ts` | two checks of the unit-test probe pre-check (one positive, one negative) |
| `scripts/chain-run.ts` | the first command's stdout/stderr go to `first.stdout`/`first.stderr`, and are replayed only if it fails (task 3) |
| `scripts/chain-run.test.ts` | `bun -e` children instead of `/bin/sh`; new output tests (task 4) |
| `harness/library.ts`, `harness/library.test.ts` | `pruneStaleAux` / `AUX_STALE_MS`: stale `m5-<crate>-<key>` dirs are removed (task 4) |

## 1. Oracle toolchain check

- **Pin**: `UPSTREAM.json` `rust.components` = `cargo-{host}`, `llvm-tools-preview-{host}`, `rust-std-{host}`,
  `rust-std-x86_64-unknown-linux-gnu`, `rustc-{host}`, `rustc-dev-{host}`.
  - The names are the ones in `<sysroot>/lib/rustlib/components`, the file the check reads. `rustup component list
    --installed` reports the same six, but prints `llvm-tools-preview` as `llvm-tools`.
  - `{host}` is the oracle's host tuple, taken from `rustc -vV`. On this Mac that is aarch64-apple-darwin. On the
    Windows host it would be `x86_64-pc-windows-msvc`. **Open question for root:** that host's toolchain must have
    the same six. If it does not, the check fails there and the pin needs a per-host list.
- **Check** (`oracleToolchainError`): the set of installed components must equal the pinned set (order does not
  matter), and `<sysroot>/lib/rustlib/src` must not exist. On any mismatch it gives one line that names `extra [...]`,
  `missing [...]` and/or the src dir, plus the toolchain's rustup name and the RUSTUP_HOME advice. An unreadable
  component file also counts as a mismatch, never as a pass.
- **Cost**: one file read plus one `existsSync`, memoized per process. It reuses `--print sysroot` and the `rustc -vV`
  that `verifyOraclePin` already runs.
- **Where it runs**: everything that produces or caches oracle output runs it first:
  - `verifyOraclePin`, which covers difftest (called before `s.cases()`, and so before any aux build or oracle run)
    and phase-diff;
  - `gate run`, right after provenance and before the probe check, the static checks or any suite;
  - the three aux builders. They cache oracle-built rmetas under `$RUST_TS_DATA/aux` and can be reached outside
    difftest, for example from a test that makes a suite's cases.
- **Verified**:
  - `bun scripts/difftest.ts --suite lex --sample 50` (agent harness-w35): MATCH 50/50, with the check passing on the
    clean oracle. Run `20261031-221642-harness-w35-zadu`.
  - Negative test: in a `bun -e` process I removed `rustc-dev-{host}` from `PIN.components` in memory, then called
    `verifyOraclePin()`. It printed `ERROR: the oracle toolchain nightly-2026-10-11-aarch64-apple-darwin differs from
    its pinned components (UPSTREAM.json rust.components): extra [rustc-dev-aarch64-apple-darwin]; …` and exited 1.
  - The toolchain itself was not touched. The unit tests use fake sysroots, including the 2026-10-31 case: `rust-src`
    plus `miri-preview` gives `extra [miri-preview-aarch64-apple-darwin, rust-src]`.

## 2. gate-runner-unit nits

- **N1**: with unit tests on, `checkProbes` now also needs:
  - the probes named in scripts/ and harness/ test files (`oracleTestProbes` over all four roots);
  - every registered suite's probes, which scripts/gate-probes.test.ts reads. They are labelled `runner unit tests
    (scripts/gate-probes.test.ts)`.

  A missing probe now fails up front with the build hint. Two tests cover this in gate-probes.test.ts. The negative one
  runs with an empty `RUST_TS_DATA` and expects `ERROR: probe 'rmetadump' not built (needed by unit tests, runner unit
  tests (scripts/gate-probes.test.ts)); run: bun scripts/probes.ts build rmetadump`. Today every probe is built, and
  `checkProbes([], true)` returns true.
- **N3**: steps are now `{ name, cmd, env, junit? }` objects. The skip check runs for any step that has a `junit`. The
  junit file names did not change (`unit-tests.junit.xml`, `runner-unit-tests.junit.xml`), and neither did the output
  lines.
- **N4**: roots are passed as `./src ./tools` and `./scripts ./harness`. Checked with bun 1.4.3: `bun test src` also
  runs `a/xsrc/x.test.ts`, while `bun test ./src` does not. `unit-steps.test.ts` asserts three things: the roots are
  disjoint and none is nested in another; the junit names are distinct; and every `*.test.ts` from `git ls-files
  --cached --others --exclude-standard` belongs to exactly one step. That last check also catches a test file outside
  every root, which would never run in the gate. Today it finds 492 + 14 + 13 + 2 files and 0 bad ones. Not checked:
  how `./<root>` behaves on Windows. It is a relative path there too, so it should work.
- **N2** (a comment in scripts/lib/deps.test.ts) had already been fixed at this base: its header now says that modules
  that were already loaded keep the temp path. I made no change.

## 3. check-chain stderr order: the cause is in the runner, and it is fixed there

- **Diagnosis**: there is only one check-chain run under `$RUST_TS_DATA/runs` (`20261031-081238-root-f5de-8b9y`), and
  it is MATCH 1/1. No DIFF has happened yet. The problem is structural, as harness-m5c's follow-up says:
  - `chain-run.ts` ran both commands with inherited stdio, so the subject's stderr was core's stderr followed by
    alloc's.
  - The oracle side (check-alloc's command) prints only alloc's stderr.
  - So any diagnostic from the port's core would come out ahead of alloc's and give a false DIFF. It would do so even
    when check-core matches the oracle, because the oracle's core would warn the same way.

  This is a merge of two processes' output in the runner, not a port problem.
- **Fix** (`chain-run.ts`): the first command's stdout and stderr are written to `<port-core dir>/first.stdout` and
  `first.stderr`, which are recreated on every run.
  - If core succeeds, they are not printed. The compared output is then alloc's alone, as on the oracle side. Core's
    own diagnostics are already compared by check-core.
  - If core fails, they are replayed to stdout/stderr and the run exits with core's code (70 → UNPORTED). The diff file
    therefore shows why core failed, as it did before.
- The oracle cache is unaffected: the subject is not cached, and the oracle key hashes `rmeta-run.ts`, not
  `chain-run.ts`. The suite comment in harness/suites.ts is updated.
- Tests: two new tests run chain-run.ts as its own process. The first checks that a successful first command's output
  is set aside, so only the second's is seen, and that the files are recreated on each run. The second checks that a
  failing first command's output and exit code become the run's.
- **check-chain re-run**: MATCH (§5).

## 4. Small queued items

- **chain-run.test.ts and `/bin/sh`**: the children are now `bun -e` scripts that use `node:fs`, so no shell is
  needed. Nothing else in scripts/ or harness/ uses `/bin/sh`.
- **Aux dir cleanup** (`harness/library.ts`):
  - Every process that uses a crate's `m5-<crate>-<key>` directory touches it, once per process because of the memo.
  - A new build of a crate, which only happens when its key changes, removes that crate's other key dirs and leftover
    `.tmp-<pid>` dirs once they have gone unused for `AUX_STALE_MS` = 3 days. The match is exact,
    `^m5-<crate>-<16 hex>(\.tmp-\d+)?$`, so `m5-std` never matches `m5-std_detect-…`, and `m5-empty-sysroot` and
    `mini_core-…` are never touched.
  - It does not delete immediately, because a concurrent run in another worktree with another key may be using that
    directory. Deleting it mid-run could make an oracle fail, and that failure could be cached as oracle output.
  - Tested on a temp aux dir in library.test.ts.
  - Not covered: `aux/mini_core-<key>` (harness/suites.ts `oracleAuxRmeta`) and `aux/ui/<key>` (compiletest). Neither
    is big. compiletest already cleans up its dead temp dirs.
  - `rmeta/check-chain/<h>/port-core/` (the 54 MB core) does not grow: it is per case and replaced on each run, so I
    left it alone.

## 5. Verification

- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 CI=true bun test ./scripts ./harness --timeout=60000`: 101 pass, 0 fail, 15 files.
- `staticChecks` end to end, into `$RUST_TS_DATA/tmp/harness-w35-static`: `{"ok":true,"skips":{"skipped":1,"allowed":1,"unexpected":[]}}`.
  - Every step passed: typecheck, unit tests, runner unit tests and markers.
  - Unit tests: 6,439 tests, 1 skipped, the allowlisted Linux-only one.
  - Runner unit tests: 101 tests, 0 skipped.
- `bun scripts/difftest.ts --suite check-chain` with the new chain-run: **MATCH 1/1**, run `20261031-223409-harness-w35-ksao`.
  - Subject: 157.1 s wall, 6,271 MB max RSS. The oracle output came from the cache.
  - The port core's `first.stdout` and `first.stderr` are empty, so the old ordering would have matched today too.
    The fix only matters once core prints something.

## For root

1. Record the pin and the check as a decision if you want it in history (the 2026-10-31 decision already says "a
   harness check … pinned list").
2. Windows host: confirm that its oracle has the six pinned components (§1).
3. Whether `AUX_STALE_MS` (3 days) is right, and whether to extend the pruning to `mini_core-*` / `ui/*`.
