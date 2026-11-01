# Handoff: fixer lane `miri-log-fix` (M6 wave 36)

Branch `t3/2a67790f` (worktree t3-2a67790f). Starting point: `02582140`, then `git merge integ-w36` (0b118d0b) and
`git merge t3/miri-info-log-tracing` (b0cb6ea7). Both merges were clean, with no conflicts. This lane applies root's
decisions for the `miri-log` review (REQUEST CHANGES, `docs/reviews/miri-log.md` in worktree t3-ec465cd0).

## 1. What changed, per decision

### 1. Frame-span leak in `eval_in_interpreter` (fixed, with an oracle regression test)
- Upstream (`eval_queries.rs:437`) creates `let mut ecx = InterpCx::new(..)` as a **local** (`:452`). The local is
  dropped when the function returns, after `result.report_err().map_err(|error| report_eval_error(&ecx, cid, error))`
  (`:467-468`) has used it. `InterpCx` has no `Drop` impl, so its fields drop in declaration order. `machine` comes
  first, and dropping it drops `CompileTimeMachine::stack: Vec<Frame>` front to back. Each `Frame`'s `SpanGuard` exits
  its `frame` span (`impl Drop for SpanGuard`, stack.rs:52). Frames are still pushed only when evaluation failed.
- Port (`src/rustc_const_eval/const_eval/eval_queries.ts`, end of `eval_in_interpreter`): the result is computed
  first, including `report_eval_error`, which still needs the frames for its backtrace. Then
  `for (const frame of ecx.stack()) frame.tracing_span.drop();`, then return. A `// PORT:` comment explains the drop.
- The §5c text in `docs/handoff/miri-log.md` ("takes `ecx` by value") was wrong; I corrected it in place.
- No other site needs this. The only CTFE root that pushes frames is `eval_body_using_ecx`
  (`push_stack_frame_raw`, eval_queries.ts:181), which is reached only from `eval_in_interpreter`. The `DummyMachine`
  users have an empty stack. Miri's ecx lives until the end of the run, and nothing logs after it is dropped.
- Regression test: `src/rustc_const_eval/const_eval/eval_queries.oracle.test.ts` uses the fixture
  `eval_queries_tracing/two_consts.{rs,stdout,stderr,exit}`, which is the reviewer's two-const program.
  - It runs `RUSTC_LOG=rustc_const_eval::interpret=info rustc -Zunpretty=mir --target x86_64-unknown-linux-gnu`
    against the pinned rustc: 70 stderr lines, exit 1.
  - Test 1 checks that the fixture is the live oracle output. It also checks that `A`'s `frame=g` is followed by
    `frame=B` back at depth 1.
  - Test 2 checks that the port gives the fixture byte for byte.
  - Without the fix, test 2 fails (first difference at line 40). With it, both pass. I checked both states.
  - The fixture was written by `REGEN=1` from the oracle, never by hand.
  - The reviewer's 330-line `leak.rs` run used the host target. The fixture uses `x86_64-unknown-linux-gnu`, like the
    suites; the panic expansion is shorter there.

### 2. Loud stop for unconverted INFO targets
- `src/rust_ts/tracing.ts`: `INFO_CONVERTED_TARGETS` is the **single list** of converted targets, with its doc comment
  giving the upstream sites per entry:
  - `rustc_const_eval::interpret`
  - `rustc_middle::mir::interpret` (no INFO sites)
  - `miri::machine`
  - `miri::borrow_tracker`

  `unconverted_info_directive(filter)` returns the first static directive that enables INFO or more verbose for a
  target not within an entry. "Within" means equal to an entry, or starting with `<entry>::`.
- The check is conservative:
  - A bare level (`info`) enables INFO everywhere, so it stops.
  - A string prefix that is not a whole module path (`rustc_const_eval::interp`) stops.
  - A target the compiler does not have (`no_such_target=debug`) stops, because the port cannot tell it has no INFO
    sites.

  A stop is loud, never a partial trace.
- `src/rustc_log/lib.ts` `init_logger_with_additional_layer`: after `EnvFilter::new`, a `// PORT:` (not upstream)
  check stops with `unported("RUSTC_LOG/MIRI_LOG directive `X` enables INFO for a target whose INFO events are not
  converted (live only within: ..)")` (exit 70). It runs after `EnvFilter::new`, so the oracle's "disabled statically"
  warning, if any, has already been printed. Only the filter path is affected; the default (no `RUSTC_LOG`) is
  unchanged.
- **`MIRI_LOG=<level>` stops for now.** Its filter includes `miri=<level>`, and `miri::eval` (`eval.rs:571`) and
  `miri::concurrency::thread` (`thread.rs:516`) are still comments; their files belong to the parallel lanes (§3).
  When both are converted, replace `miri::machine` and `miri::borrow_tracker` with `miri` in the list.
  `concurrency/scheduler.rs:65` and `genmc/run.rs` are GenMC only, which is out of scope (D2).
- One fixture variant changed. `filter_static_max` was `no_such_target=debug,rustc_infer=warn`, which now stops. It
  became `rustc_const_eval::interpret::no_such_module=debug,rustc_infer=warn` (`src/rustc_log/tracing_oracle/gen.ts`),
  which keeps the "disabled statically" warning coverage. I regenerated `expected.json` with `gen.ts` from the live
  `tydump` probe. `git diff` shows exactly one changed line: that variant's `stderr`, whose warning now names the new
  target. The other 15 entries are byte-identical. **For root to record**: this changes a variant the unaccepted
  miri-log batch added, by regenerating from the probe, not by editing an expected output.
- Tests (`src/rustc_log/lib.test.ts`, new test):
  - These stop: `rustc_infer=info`, `info`, `warn,rustc_infer::infer=info`, `no_such_target=info`,
    `rustc_const_eval::interp=info`, `rustc_const_eval=info`, and the `MIRI_LOG=info` filter string.
  - These run: `rustc_const_eval::interpret=info`, `..::step=info,rustc_infer=warn`, the four converted targets at
    `info`, `rustc_infer=warn,error`, and `off,rustc_infer=off`.
  - The list itself is pinned.
- End to end through `main.ts`: `rustc_infer=info`, `info`, `no_such_target=debug,..` and `rustc_const_eval::interp=info`
  exit 70 with the message. `rustc_const_eval::interpret=info`, `..::step=debug,warn` and `rustc_infer=warn` run.

### 3. Driver wiring (`src/miri/bin/miri.ts`)
- miri-driver had already wired the loggers where upstream does: `init_early_loggers(early_dcx)` in `main` after
  `install_ice_hook` (miri.rs:446), `init_late_loggers(EarlyDiagCtxt::new(..), tcx)` in `after_analysis` after
  `flush_delayed` (miri.rs:151), and `deinit_loggers()` in `exit` (miri.rs:341). I checked each against upstream, and
  nothing needed to change.
- `MIRI_TRACING`: `fatal_error_` / `fatal_error` are now `export`ed from `miri.ts` (the only edit there). In
  `src/miri/bin/log/setup.ts`, the `unported` is replaced by
  `fatal_error('Cannot enable MIRI_TRACING since Miri was not built with the "tracing" feature')`, as upstream's
  `#[cfg(not(feature = "tracing"))]` branch does. The import is a module cycle; `// PORT:` explains why it is safe.
- Oracle check (isolated Miri, hello.rs, `MIRI_TRACING=1 RUSTC_LOG=warn`, so the early init path): the port and the
  oracle are byte-identical (`fatal error: ..`, exit 1).
- Without `RUSTC_LOG` the late path is not reached yet. The port stops earlier at
  `unported: miri::eval::MiriConfig::default` (lane miri-eval).

### 4. Miri's own `info!` sites
| site | file (owner, on integ-w36) | status |
|---|---|---|
| machine.rs:1994 `Leaving {}` | `src/miri/machine.ts` (`before_stack_pop`) | **live** |
| machine.rs:2017 `Continuing in {}` | `src/miri/machine.ts` (`after_stack_pop`) | **live** |
| machine.rs:2004 drop of `frame` at the end of the sub-scope | `src/miri/machine.ts` | **`frame.tracing_span.drop()`** at the end of the inner block, after the profiler branch and before `Continuing in` |
| borrow_tracker/mod.rs:282 `retag_ptr_value: type={ty}, mode={retag_mode:?}, val={:?}` | `src/miri/borrow_tracker/mod.ts` | **live** (`display_Ty`, `debug_RetagMode`, `debug_Immediate(val.imm, .., debug_Provenance)`) |
| eval.rs:571 `Additional static roots: {:?}` | miri-eval (fixer lane in parallel) | **not touched**: convert with the recipe in `docs/handoff/miri-log.md` §5a, target `miri::eval` |
| concurrency/thread.rs:516 `---------- Now executing on thread ..` | miri-threads (fixer lane in parallel) | **not touched**: same recipe, target `miri::concurrency::thread` |
| concurrency/scheduler.rs:65, genmc/run.rs:66 | GenMC (D2, out of scope) | none |

Every live site is behind `if (tracing.INFO_ENABLED)`. These Miri events cannot be checked end to end yet, because the
port's Miri stops at `MiriConfig::default`. They follow upstream's format strings and targets, and the oracle line
shapes (`retag_ptr_value: type=&.., mode=Default, val=Scalar(0x..[allocN]<tag>)`) come from the saved
`$RUST_TS_DATA/tmp/miri-log/info.stderr`. **Once miri-eval and miri-threads convert theirs, change
`INFO_CONVERTED_TARGETS` to `miri` (§2).**

### 5. Evidence: CTFE trace sample, per-reason breakdown
Script (outside the repo): `$RUST_TS_DATA/tmp/miri-log-fix/scripts/ctfe-sample.ts <worktree> <N|all> <filter> [jobs]`.
- It runs the pinned rustc and the port with `--edition <from //@ edition> --target x86_64-unknown-linux-gnu --sysroot
  <oracle> -Zunpretty=mir -Zwrite-long-types-to-disk=no <file>` under `RUSTC_LOG=<filter>`, and classifies each file:
  - `matched`: stdout, stderr and exit are all identical.
  - `differed`
  - `crashed`: port exit 101 where the oracle did not ICE. **This counts as a failure.**
  - `port-timeout`: a failure.
  - `port-unported`: exit 70.
  - `oracle-skip`: the oracle's stderr exceeded 5 MB or the oracle timed out.
- It streams and kills at the cap, so no large file is written. Crash messages are grouped with their top stack-frame
  files.
- **Proposal (harness batch, not done here):** move it to `scripts/` as e.g. `scripts/ctfe-log-sample.ts`.

`RUSTC_LOG=rustc_const_eval::interpret=info`:

| run | files | matched (with INFO lines) | differed | crashed | port-timeout | port-unported | oracle-skip |
|---|---|---|---|---|---|---|---|
| 150-file sample (the miri-log lane's selection) | 150 | **147** (97) | 0 | **0** | 0 | 0 | 3 |
| all of `tests/ui/consts` | 793 | **784** (532) | 1 | **0** | 0 | 0 | 8 |
| all, with the §1 fix disabled (control) | 793 | 729 (477) | 56 | 0 | 0 | 0 | 8 |

- The 1 `differed` is `tests/ui/consts/const-eval/do_not_const_check.rs`. It is pre-existing and unrelated to logging:
  with `RUSTC_LOG` unset it also differs. The oracle ICEs at `const_eval/machine.rs:460` ("calling non-const function")
  and the port does not; the mir suite skips it already (`harness/suites.ts:1093`).
- The 8 `oracle-skip` files have an oracle trace over 5 MB (long or infinite CTFE loops), so they are **not checked**:
  `const_in_pattern/cyclic-const-long-chain-issue-144719.rs`, `const-eval/field-access-after-const-eval-fail-in-ty.rs`,
  `const-eval/infinite_loop.rs`, `const-eval/issue-52475.rs`, `const-eval/issue-70723.rs`,
  `do-not-ice-on-field-access-of-err-type.rs`, `long-constant-evaluation-cause-dead-code.rs`,
  `long-constant-evaluation-cause-ice-in-sty.rs`.
- No file crashed, so no ICE comes from `tracing*.ts`, `stack.ts`, `step.ts` or `call.ts`. No file was unported.
- The miri-log lane's "116 skipped" is not reproduced on this tree. My run started from integ-w36 plus later ports, and
  its script counted every exit 70 or 101 as a skip. The control row shows the fix changes 55 files with a failing
  constant (a superset of the 4 the miri-log lane saw).
- Per-file results: `$RUST_TS_DATA/tmp/miri-log-fix/{sample150,sample-all,sample-all-nofix}/results.jsonl`.

### 6. Scratch file
`$RUST_TS_DATA/tmp/miri-log/ctfe/s.o.err` (2.36 GB) was written by the miri-log lane's own `ctfe-sample.ts` (its
`${T}.o.err`, with `T = $RUST_TS_DATA/tmp/miri-log/ctfe/s`), so it was this lane's predecessor's file. **Deleted.**

## 2. Verification

| check | result |
|---|---|
| `bunx tsc --noEmit -p .` | 0 errors |
| `bun scripts/coverage.ts --check --offline` | markers ok (23652; vendor 5050) |
| `RUST_TS_REQUIRE_PROBES=1 bun test src/rust_ts src/rustc_log src/rustc_const_eval src/miri` | 200 pass, 0 fail (37 files) |
| `bun scripts/difftest.ts --suite mir --sample 300` (logging off) | 300/300 MATCH (run `20261101-140229-root-ngor`) |
| `bun scripts/difftest.ts --suite mir-core --sample 200` (logging off) | 200/200 MATCH (run `20261101-140410-root-3gxg`) |
| two-const oracle regression test | passes; fails with the fix disabled |

`RUST_TS_AGENT` was unset, so the samples are the default (`root`) selection.

## 3. Files touched
- `src/rustc_const_eval/const_eval/eval_queries.ts`: the frame drop (§1).
- `src/rustc_const_eval/const_eval/eval_queries.oracle.test.ts` and `eval_queries_tracing/two_consts.*`: new (§1).
- `src/rust_ts/tracing.ts`: `INFO_CONVERTED_TARGETS` and `unconverted_info_directive` (§2).
- `src/rustc_log/lib.ts`: the stop and the header (§2).
- `src/rustc_log/lib.test.ts`: the new test and the header (§2).
- `src/rustc_log/tracing_oracle/gen.ts` and `expected.json`: the `filter_static_max` variant (§2).
- `src/miri/bin/miri.ts`: `export` on `fatal_error_` / `fatal_error` (§3).
- `src/miri/bin/log/setup.ts`: `MIRI_TRACING` → `fatal_error` (§3).
- `src/miri/machine.ts`: two `info!` sites and `frame.tracing_span.drop()` (§4).
- `src/miri/borrow_tracker/mod.ts`: the `retag_ptr_value` `info!` and the header (§4).
- `docs/handoff/miri-log.md`: §5c corrected.

Coverage: no markers added or removed. `--missing`: `bin/log/setup.rs` 6/6, `const_eval/eval_queries.rs` 18/18.

## 4. `unported(...)` left / `// PORT:` decisions
- New `unported`: `rustc_log/lib.ts`, a `RUSTC_LOG`/`MIRI_LOG` directive that enables INFO outside
  `INFO_CONVERTED_TARGETS` (§2).
- Removed `unported`: `miri/bin/log/setup.ts` `MIRI_TRACING` (now `fatal_error`).
- The miri-log lane's other `unported`s are unchanged: field filters, span-name/dynamic directives, `write_retrace_span`,
  `span_modes`, thread ids, JSON, and backtrace output.
- New `// PORT:`s:
  - eval_queries.ts: the drop of `ecx`'s frames.
  - rustc_log/lib.ts: the converted-target check (not upstream).
  - setup.ts: the `miri.ts` import cycle.
  - machine.ts: the end-of-scope drop of `frame`.

## 5. Open, for other owners
- **miri-eval / miri-threads**: convert `eval.rs:571` and `thread.rs:516` (§4), then root (or the next lane) replaces
  `miri::machine` and `miri::borrow_tracker` with `miri` in `INFO_CONVERTED_TARGETS`. Until then, `MIRI_LOG=<level>`
  stops with `unported`.
- **Harness batch**: the sample script proposal (§1.5). `miri-diff` must mask `Scalar(0x…)` addresses in
  `retag_ptr_value` lines (review finding 6).
- Review findings 4 (the perf framing: there is no measurable overhead, and the "1.1% → 0.5%" is noise) and 5 (the
  composed unit test in `tracing.test.ts`) are notes. I did not change them; the new two-const test is a real oracle
  comparison of the interpreter's event order.
