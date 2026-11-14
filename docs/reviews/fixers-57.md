APPROVE WITH NITS

# Review: fixer lane fixers-57 (M7, wave 40q)

- **Reviewed:** `git diff bcbd0c28..641302f0` on `t3/fix-llvm-handler-nits`: commits `672d1984`, `0efe8512`, `793c662c`,
  `2afe2101` and `641302f0` (handoff). This review branch is `641302f0` plus this file. The handoff is
  `docs/handoff/fixers-57.md`.
- **Reviewer:** independent, read-only on code. Upstream was read from `$RUST_TS_DATA/rust`, and LLVM from
  `$RUST_TS_DATA/llvm-src/aab11ee0…/` (`harness/llvm-manifest.json` pins `ErrorHandling.cpp` and `Unix/Signals.inc`).
- **Result:** every addressed finding is fixed as claimed. The only behaviour changes are the two in scope:
  - `LLVMRustDisableSystemDialogsOnCrash` is now a no-op on Unix;
  - the LLVM handlers write fd 2 directly.

  Each of the five key lines I mutated made a test fail. There are no F findings and two nits.

## Evidence (AC power, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`, Bun 1.4.4)

| Command | Result |
|---|---|
| `bunx tsc` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (26858, 73 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 524)` |
| `bun tools/llir/ffi_gen.ts --check`, then `bun tools/llir/ffi_gen.ts` (regenerate) | `contract up to date`; the regenerated `ffi.ts`/`ffi_types.ts` give an empty `git diff` |
| `CI=1 bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/mir/ ./src/std/ ./scripts/lib/unit-steps.test.ts` | run 1: 436 pass, **1 fail** (see below); run 2: 437 pass, 0 fail, 18842 `expect()`, 49 files, 0 skips |
| The same with `CI` unset | 437 pass, 0 fail, 18842 `expect()`, 0 skips |
| `difftest --suite mono-ui --sample 200 --jobs 6` (`RUST_TS_AGENT=review-fixers-57-qz`) | 199 MATCH, 1 DIFF; run `20261114-061727-review-fixers-57-qz-873a` |

- **The first `CI=1` run's failure** was `src/std/fmt.test.ts:553`, "format_debug of a deep chain is linear in the output
  size", a wall-clock ratio test (7.25 against a bound of 3). The load average was 89 from other lanes. This lane does not
  touch that file or `std/fmt.ts`. The test passed alone three times, in the run without `CI`, and in the second `CI=1` run.
- **The mono-ui DIFF**, `tests/ui/explicit-tail-calls/callee_is_track_caller.rs`, is not in `harness/baseline/mono-ui.txt`.
  It misses the `tail_call_track_caller` warning, which comes from codegen. It is the same DIFF on base `bcbd0c28` (filtered
  runs `…-review-fixers-57-base-4jwi` and `…-head-c1kl`), so this lane did not cause it.

## 1. `LLVMRustDisableSystemDialogsOnCrash`

- **Upstream:** `RustWrapper.cpp:130` is `extern "C" void LLVMRustDisableSystemDialogsOnCrash() {
  sys::DisableSystemDialogsOnCrash(); }`. `Unix/Signals.inc:991` is `void llvm::sys::DisableSystemDialogsOnCrash() {}`.
  - The port matches: `src/rust_ts/llvm/target.ts:133-144`.
  - The `// rustc:` and `// llvm:` markers each sit on the line directly above the function. Each names the definition's
    line and name, and `coverage --check` accepts both.
- **Win32 stop:** `target.ts:143` stops by name only when `process.platform === "win32"`. That is correct.
  `Windows/Signals.inc` does real work there (error-mode and abort-behaviour changes) and is not pinned. Only Unix and Windows
  `Signals.inc` exist, so no other host is left out.
- **`ffi.ts`:**
  - The one change from stub to `bind(…, impl3…)` and the count `284 of 381` are exactly what the generator writes.
    Regenerating left the tree clean.
  - `llvm_util.ts:10-12` now lists the `LLVMDisposeMessage` after `LLVMGetHostCPUFeatures`, still a stub at `ffi.ts:936`.
    It also says the new function is a no-op on Unix.
- **`init` with `CI=1`:**
  - `configure_llvm` (`llvm_util.ts:104-105`, upstream `llvm_util.rs:79-81`) now passes the call. It goes on to
    `initialize_available_targets` (`:188`) and `LLVMRustSetLLVMOptions` (`:190`, upstream `:166`, `:168`).
  - `skeleton.test.ts:361-370` checks this, and the check is real:
    - It asserts that the options contain `-preserve-alignment-assumptions-during-inlining=false` and
      `-import-cold-multiplier=0.1`. Upstream adds both unconditionally (`llvm_util.rs:136`, `:139`), and only
      `LLVMRustSetLLVMOptions` stores them, after `initialize_available_targets`.
    - It then checks that `print` gets past `require_inited`.
  - The test file inherits the environment, so the `CI=1` run takes the `CI` branch.
  - With the no-op mutated into an unconditional stop (mutation M2), the test fails under `CI=1` and passes without `CI`, as
    it should.

## 2. The handlers (`src/rust_ts/llvm/target.ts`)

- **Text and exits:**
  - `FatalErrorHandler` (`:87`, upstream `RustWrapper.cpp:87`) writes `rustc-LLVM ERROR: <Reason>\n` and exits 101. That is
    `std::cerr << … << std::endl`, which writes the same bytes. The restored comment block (`:99-106`) is upstream's text
    verbatim.
  - `BadAllocErrorHandler` (`:115`) writes the three pieces as upstream's three `::write(2, …)` calls do, then
    `process.abort()`.
  - `report_fatal_error` (`ErrorHandling.cpp:103`) calls the handler, or writes `LLVM ERROR: <Reason>\n`. It then aborts on
    `GenCrashDiag`, or exits 1 (`ErrorHandling.cpp:134-137`).
- **The fd 2 bypass:** `writeStderr` (`:79`) now calls `stderr_write_all` (`std/io.ts:378`), which never consults
  `OUTPUT_CAPTURE`, and drops the result with `void`.
  - The C++ writes ignore failure as well. `std::cerr` sets `badbit`, `(void)!::write` discards the result, and
    `write_retry` gives up quietly.
  - `handle_ebadf` turns a closed fd 2 into `Ok`, as upstream does.
- **The child-process test** (`target.oracle.test.ts:213`):
  - Both cases assert stderr, stdout and the exit code exactly.
  - The fatal case runs under `set_output_capture([])`, so it fails on the old `write_stderr` path (mutation M3) and with
    exit 1 (mutation M1).
  - It reads no environment variable by name. The children inherit the environment through `Bun.spawnSync`'s default,
    which `unit-steps.test.ts`'s scan treats as no read.
  - Wall time: the file filtered to this test runs in 69 ms in all, imports included.
  - The bad-alloc path is not run, rightly (crash reports). I did not run it either.

## 3. The test-only reset

`with_fresh_llvm_options_for_tests` (`target.ts:204`) saves `[Initialized, CL_ARGS]` and clears them. It runs `f` and
restores them in a `finally`. That is sound, and since `CL_ARGS` is replaced and never mutated, the saved reference stays
valid.
- `target.oracle.test.ts:225-252` checks the restore by identity (`toBe(before)`), after a normal return and after an
  `Unported` thrown inside.
- With the `finally` replaced by a plain restore after `f` (mutation M4), the test fails. See N2 for the one piece of state
  the wrapper does not cover.

## 4. llir-tools notes 1 and 4

- **`-split-dwarf-file=` (`tools.test.ts:149`): correct.**
  - `write.rs:249-260`: `path_to_cstring_helper(config.split_dwarf_file)` turns `None` into an empty path, so rustc always
    passes a non-null `SplitDwarfFile`.
  - `PassWrapper.cpp:383-384`: `if (SplitDwarfFile) Options.MCOptions.SplitDwarfFile = SplitDwarfFile;` therefore assigns
    `""`.
  - The oracle's recorded call agrees: field 18 of both lines of `write_oracle/x86_64-unknown-linux-gnu.tm` is `""`.
  - So rustc's target machine gets `SplitDwarfFile = ""`. In LLVM, that is the same state as unset, since
    `MCTargetOptions::SplitDwarfFile` is a `std::string` defaulting to empty. The flag is therefore a no-op for `llc`. I
    checked that the pinned `llc -O2 -filetype=obj` writes byte-identical x86_64 objects with and without
    `-split-dwarf-file=`, on a module with full debug info. The model's `undefined`/`""` split (`target.ts:680`,
    `tools.ts:604`) is finer than LLVM's but harmless.
- **The real machine:** `recordedTm` now builds one through `initialize_available_targets` and `LLVMRustCreateTargetMachine`,
  replacing only the level (`args[6]`) and the features (`args[2]`). The `as never`/`as unknown as TargetMachine` casts are
  gone.
- **Note 1 (`tools.test.ts:390-394`):** the test now pins `[134, "SIGABRT"]`, the verifier's message and the flag. Good.
- **Notes 2 and 3 left: agreed.**
  - Note 2 cannot be reached until the driver gets past `codegen_crate`. That needs cg-register, and the handoff queues it
    after cg-register.
  - On note 3, the reviewer said that no action was needed, and there is no seam that does not require opt to die by a signal
    mid-print.

## 5. cg-di-a N1, N3, N6 and cg-lto-diag N1, N3, N4, N5

- **cg-di-a N1:**
  - `mod.test.ts:394` checks three things on IR-model values: an unnamed global stays unnamed, an argument and an instruction
    are named, and an existing name is kept.
  - With the guard disabled (`if (false && !param_or_inst)`, mutation M5), the test fails.
  - The port matches upstream `debuginfo/mod.rs:593-612`.
- **cg-di-a N3:** this is comment and handoff only, and correct. Upstream has no explicit drop call, and the box drops with
  `cx` at the end of `module_codegen`'s block.
- **cg-di-a N6 (`gdb.ts:66`):** `visualizer.src` is a `Uint8Array` (`middle/debugger_visualizer.ts:14`). The `for…of` loop
  pushes every byte in order, so it keeps exactly the bytes the spread did, without the argument-count limit.
- **cg-lto-diag N1, N3, N5:** comments only.
  - N3's citation of `into_diag_arg` at `diagnostic_impls.rs:143` and `:149` is right.
  - N5's `globalThis.Buffer` is the same object as the old `Buffer` value: `lto.ts:684`'s alias is type-only, so the call
    does not change.
- **cg-lto-diag N4 (`lto.test.ts:236`): sound.**
  - The `spyOn` on the `lto` and `write` namespaces does reach the internal calls. The test asserts that `passes` and
    `codegened` each got exactly one entry, so a spy that missed would fail it.
  - The real `run_pass_manager` runs, and the fold to `add i32 %x, 2` shows that opt's pipeline ran.
  - The control (`lto: "Thin"` with an index) stops at the first `LLVMRustPrepareThinLTO*` stub.
  - I set `thin_local_no_op` to `false` (mutation M6): the test fails.
- **Left items:**
  - N6 (deferred to D11 by its own review) and N7 (a note for the llir lane's brief): agreed.
  - N2: see N1 below.

## 6. Behaviour scan of the full diff

Beyond item 1 and the handlers, the diff changes:
- comments, PORT notes and handoff text: `llvm_util.ts`, `lto.ts`, `di_builder.ts`, `analyze_oracle/driver.ts`,
  `diagnostics.test.ts` and four handoffs;
- the equivalent loop in `gdb.ts`;
- `cmp_cstr`'s spelling of `Buffer`, which is the same object;
- tests.

The test-only `reset_llvm_options_for_tests` became `with_fresh_llvm_options_for_tests`. Its only callers are the two test
files above. Nothing else changes behaviour.

**Integration with cg-register (`t3/register-llvm-backend`):** I merged it onto `641302f0` in a throwaway worktree. It
auto-merged, `skeleton.test.ts` included. cg-register's two tests that name this stop already branch on
`IMPLEMENTED.has("LLVMRustDisableSystemDialogsOnCrash")`: `wire.test.ts:45` and `compare_impl_item.oracle.test.ts:54`.
`bun test wire.test.ts skeleton.test.ts` passes with `CI=1` and without it: 18 pass, 0 fail.

## Mutations (each reverted with `git checkout -- <file>`; the tree was clean afterwards)

| # | Change | Result |
|---|---|---|
| M1 | `FatalErrorHandler`: `process.exit(101)` → `process.exit(1)` | the child-process test fails |
| M2 | `DisableSystemDialogsOnCrash` stops on every host | the target.oracle error-handler test fails; with `CI=1` the skeleton backend test fails too, and without `CI` it passes |
| M3 | `writeStderr` back to `write_stderr` | the child-process test fails |
| M4 | the wrapper restores without a `finally` | the `LLVMRustSetLLVMOptions` test fails |
| M5 | `set_var_name`'s argument-or-instruction guard disabled | `mod.test.ts` `set_var_name` test fails |
| M6 | `thin_local_no_op = false` | the N4 ThinLocal test fails |

## Findings

- **N1.** cg-lto-diag N2 was left, but its fix is a one-line handoff correction. `docs/handoff/cg-lto-diag.md:50` still says
  "No-op on Mach-O" for rename. Per `docs/reviews/cg-lto-diag.md:194-197`, only the clearing of `dso_local` is ELF-only,
  while setting it happens on every object format. The brief listed N1–N7. This lane corrected `cg-di-a.md`, `fixers-56.md`
  and `llir-init.md` in the same way, so "handoff wording only, not code" is no reason to skip this one. Fix the sentence
  (root may do it at integration).
- **N2.** `with_fresh_llvm_options_for_tests` (`src/rust_ts/llvm/target.ts:204`) resets the target options but not
  llvm_util's `INIT` (`src/rustc_codegen_llvm/llvm_util.ts:44`).
  - So `skeleton.test.ts:361-370` holds only if no earlier test file in the same `bun test` process completed `init` in
    process.
  - If one did, `configure_llvm` would be skipped and `llvm_cl_args()` inside the wrapper would be `[]`. The test would then
    fail on `toContain("-preserve-alignment…")`, which hides the real cause.
  - This holds today, and still holds with cg-register merged. I instrumented a scratch merge and saw `wire.test.ts` drive
    `configure_llvm` in a child `rustc-ts` process, not in the test process.
  - Before it can turn into a puzzling failure, have the test assert that `INIT` has not run yet (an exported test-only
    query), or note the assumption in its comment.
