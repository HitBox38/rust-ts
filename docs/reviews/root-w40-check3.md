APPROVE WITH NITS: root's conclusions hold when tested, nothing here blocks the full step, and five nits can be queued.

# Independent check of `6f7208d9` (and `40d11aef`), lane `root-w40-check3`

Reviewed on branch `root-w40-check3`, cut from `6f7208d9`. `RUST_TS_REQUIRE_PROBES=1`. No code changed.

**How the trace avoids the problem that spoiled root's attempt.** It is a `bun test --preload` plugin kept in the scratchpad.
It rewrites `set_panic_with_hook` and `install_ice_hook` in memory as modules load, and logs pid and stack. Spawned children do
not load a preload, so they log nothing. Every run logged exactly one pid, including run E below, whose `track_caller.test.ts`
spawns children that call `update_hook`: E logged only the preload line. The same plugin took each change back out in memory,
so each of root's claims was tested by removal. The tree stayed clean throughout.

| Run | Files, with a last file that records the state a later test sees | Result |
|---|---|---|
| A: as committed | `miri.test`, `intern`, `typeck_results`, `expr_a`, `matches_b`, `late_a`, `late_b` | 90 pass, 0 fail, no ICE file |
| B: no `afterAll(take_hook)` | same | 90 pass, 0 fail, **`rustc-ice-*.txt` written** (14,375 bytes, 11 panics), hook still on in the last file |
| C: no `EMIT_BUG_DIAGNOSTIC` restore | same | 88 pass, **exactly the two `typeck_results` tests fail** |
| D: `plain_bug` does nothing | same | 85 pass, **exactly the five wrapped tests fail** |
| E: as committed | `ice_path.oracle`, `track_caller`, `rustc_errors/tests`, `src/rustc_interface/` | 53 pass, 0 fail, none skipped, no hook in the test process |

## Answers

**Q1. `miri.test.ts` is the source, and the only one found.** Reproduced for 13 test files, read for the rest.
- In A, `install_ice_hook` fired 42 times, every time from `main` (`src/miri/bin/miri.ts:579`) called by `miri.test.ts`, and from nothing else. `take_hook` cleared it once.
- B reproduces root's whole claim: the later files' panics reach the hook, and the file lands in the working directory. `.gitignore` does not cover it, so `gate.ts:443` would see a changed tree.
- Read, for the rest of `src` and `tools`:
  - `update_hook` has one non-test caller (`src/rustc_driver_impl/lib.ts:1185`).
  - `install_ice_hook` is called from `lib.ts:1362`, `miri.ts:565` and `:579`, and the five dumps. The dumps run `main` at top level and nothing imports them; tests spawn them.
  - `lib.ts` `main` is reached from `rust_ts/driver.ts` `run_compiler` (no callers; its importers take only `drop_compiler_dcx`), from `rust_ts/main.ts` and `alias_check_oracle/driver.ts` (both spawned), and from `miri.ts:559` (needs `MIRI_BE_RUSTC`, which no test sets in-process).
  - Miri's `main` is called in-process only by `miri.test.ts`; `stack_miri_driver.ts` is spawned.
- Limit: this is a static search plus 13 traced files, not a trace of every file. Computed imports (`src/rustc_infer/contract.test.ts:137-143`, `:232`) were read only.
- Root's original ICE file is gone, so I could not compare its contents. The only other in-process writer is `flush_delayed` (`src/rustc_errors/lib.ts:1363`). I ran the five other test files that call the delayed-bug API directly: no file, and no "delayed bugs were created" note. A test could still reach it indirectly; only the full step can rule that out.

**Q2. The restore changes nothing in a real run, and the changed comment is true except for one omission (N3).** Reproduced.
- A scratch script ran a real compile in-process under the real ICE hook, then called `bug!`. It covered a compile that returned (no-core lib), and a compile that panicked out of `run_compiler` (`-Ztreat-err-as-bug=1`). With and without the restore, stderr was byte-identical after masking pid and time. In all four runs `bug!` threw a `Panic` carrying its message.
- Limit: the `bug!` was called from the scratch file, so the hook refused its location in both modes. That compares the emit path, not a full printed report after the run.
- Why it holds: `TLV` is written only in `enter_context`, and its `finally` restores it (`src/rustc_middle/ty/context/tls.ts:50-58`), so no `tcx` survives to the `finally` at `interface.ts:549`. The hook itself runs at the panic, before unwinding, so its view is unchanged.
- ICE output: `ice_path.oracle.test.ts` passes, and six cases MATCH the oracle at this commit (`pm-ui` 2, `mirdump-ui` 1, `mir` 2, `resdump` 1; run ids `root-w40-check3-*`). None of ice-report's 118 cases is in `harness/baseline` yet, so these are oracle comparisons and not protected cases. I did not look for other protected cases that exit 101.

**Q3. `plain_bug` keeps the tests meaningful, and nothing is weakened against how they worked before the ICE report.** Reproduced.
- D shows all five sites really reach `bug_impl`. If one were a plain `panic(msg)`, removing `plain_bug` would not have failed its test.
- The four strings the tests assert match upstream: `intern.rs:352`, `scope.rs:1471`, `late.rs:918`, `late.rs:3315`. The fifth site's message is `matches/mod.rs:2763`, but that test does not assert it (N2).
- D's `matches_b` failure ends in "aborting due to 1 previous error", which fits root's `abort_if_errors` reading.
- A better way at the same cost? Not for reading the message. Putting it on `ExplicitBug` still emits, so `abort_if_errors` still fires, and it would change the banner in `report_uncaught`. Reading the emitted diagnostic needs a capturing emitter in each test. A three-line strengthening is available (N2).

**Q4. The marker is right and the check accepts it; the dropped panic does not matter today but belongs there.** See N4.
- `take_hook` is at `panicking.rs:179`. `coverage.ts --check --offline` prints `markers ok (24848; vendor 5086; library 602)` with no invalid markers. `--missing library/std/src/panicking.rs` reports 4/49.
- The dropped panic: the only caller is `afterAll`, and `panic_count` is above zero only inside the synchronous `while_unwinding`, so it cannot fire (read; the probe saw `panicking()` false).

**Q5. `afterAll(take_hook)` is enough for today's tests.** Other state does stay behind, and nothing reads it. Reproduced by comparing the last file's view alone and after `miri.test.ts`.
- `afterAll` is scoped to the file: in A the later files saw no hook.
- It stays behind:
  - `BACKTRACE_STYLE` is `Full` instead of `Off`. The only reader is `default_hook`, which needs a hook.
  - `TRACK_FEATURE` stays `track_feature` (N3); any `run_compiler` does this.
  - `MiriConfig.default` stays a spy, and `./log/setup.ts` stays a no-op mock. The only importer is `miri.ts`, and no later file calls its `main`.
  - `ICE_PATH` stays cached; any in-process compile does this.
- Back to its starting value: the panic hook, `EMIT_BUG_DIAGNOSTIC`, `DEF_ID_DEBUG`, args, output capture, thread name, `USING_INTERNAL_FEATURES`, `panicking()`, and the environment (no differences).
- Within `miri.test.ts` the hook stays on, so a real panic there would write an ICE file. A wrote none. This needs no change.
- A later test would see leftovers only if it installed a hook in-process with `RUST_BACKTRACE` set. None does.

**Q6. I expect no new failure in the full step, but five assertions lean on a refused location (N1).** Not run: the full step itself. Root's seven are all accounted for by C and D. A load-order failure already exists (O1).

## Findings

**N1. Five assertions outside `plain_bug` keep their message only because the location is refused.** Reproduced.
- `src/rustc_mir_build/builder/expr/expr_a.test.ts:141`, `:155`; `src/rustc_mir_build/builder/matches/matches_b.test.ts:202`; `src/rustc_resolve/late_a.test.ts:730`; `src/rustc_resolve/late_b.test.ts:790`.
- These are `bug!`s with a live `tcx`. `emit_bug_diagnostic` returns false on a refused location (`src/rustc_interface/callbacks.ts:65`), so `bug_impl` keeps the message. With that line changed in memory to act as if the location resolved, these five tests fail with `Received message: "ExplicitBug"`.
- Scenario: someone improves the resolver so these locations resolve, and five unrelated tests fail. The refusal is not caused by test shape: removing tail calls from the test arrows, adding frames, and dropping the `return` at `matches/test.ts:69` all still passed. So it should not flip in the full step.
- Fix when convenient: wrap these in `plain_bug`, which is one wrapper at each of the five sites.

**N2. `matches_b` does not read the message that `plain_bug` now gives it.** Read. The hook's report in run B shows this site is reached today.
- `src/rustc_mir_build/builder/matches/matches_b.test.ts:194-199` catches the error and asserts only `toBeInstanceOf(Error)` and not `Unported`. Scenario: a `TypeError` from the `undefined as never` argument passes this test without reaching the `bug!`.
- Fix: `expect(() => plain_bug(...)).toThrow("expect type \`Pin\` for a pinned binding")`.
- Optional, for all sites: have `src/rust_ts/test_bug.ts:7` record that the hook ran and rethrow only if it did, so a plain `panic(msg)` with the same text cannot pass. About three lines.

**N3. The changed comment leaves out `TRACK_FEATURE`, and that hook stays installed.** Reproduced: the probe sees `track_feature` after `run_compiler`.
- `src/rustc_interface/interface.ts:396-398` says `run_compiler` installs `DEF_ID_DEBUG` and `EMIT_BUG_DIAGNOSTIC` and that "the previous hooks are restored". `setup_callbacks` also swaps `TRACK_FEATURE` (`callbacks.ts:91`), and it is not restored.
- Scenario, read only: a test that enters a fake `tcx` after an earlier compiler and reaches `features().enabled` hits `track_feature` on `tcx.query_system`. This is the same class of failure as `typeck_results`. No such test failed in root's full step.
- Fix: restore it the same way (one line each way), or name it in the comment.

**N4. `take_hook` departs from the porting contract in small ways.** Read. `src/std/panicking.ts:48-60`.
- Order: `take_hook` (179) sits after `update_hook` (219); PORTING section 3 wants upstream order. `coverage.ts` does not check order.
- Marker: the `// PORT:` lines separate the marker from the `fn`; section 3 wants it directly above. `coverage.ts` accepts this. Move the `PORT` lines above the marker.
- The upstream `thread::panicking()` panic is dropped without a word; the `PORT` comment covers only the return value. The pre-existing `update_hook` drops it too. Both should have it: `panicking` and `panic` are in `./panic.ts`, which this file already imports.
- Semantics: upstream resets to `Hook::Default`, which still prints at the panic. The port resets to "no hook", which reports at top level. That is fine for its only caller, but the `PORT` comment should say so.
- `panicking.ts:2` says only a driver loads this module; a test now does too.

**N5. Leftover state after `miri.test.ts` (Q5).** Reproduced. No action needed today. If a test ever installs a hook in-process, `BACKTRACE_STYLE` is the one to deal with.

**O1. Outside this commit: `src/rustc_hir_typeck/typeck_impl.test.ts` fails when it is the first file in its process.** Reproduced.
- It stops with `ReferenceError: Cannot access 'InlineAttr' before initialization` (`src/rustc_attr_ir/data_structures.ts:53`).
- It fails the same way alone on `40d11aef`, and passes (21 with `miri.test.ts`) when another file loads first. So this is not from this commit, but its result depends on file order. The five files listed with it failed together when it ran first.

## `40d11aef`

Test-only, read. The C1 test (`scripts/gate-power.test.ts:113`) and the C2 change (`scripts/lib/host-state.test.ts:74-76`) do what the commit message says. I did not run them or mutate them.

## Not checked

- The full unit step, the gate, or any stress loop, as instructed.
- Typecheck: not established. This worktree has no `node_modules`. `bunx tsc` with the root checkout's `@types` reported 241 errors, none in the nine changed files. I did not work out why (a tool or types mismatch is my guess). Rely on the gate's typecheck step.
- Windows, and any ICE report beyond the six cases above.
