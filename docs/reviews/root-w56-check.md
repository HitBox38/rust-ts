# Independent check of root's integration commits on `integ-w56` (wave 40p)

Reviewer: independent, read-only on code. Tree: this worktree merged with `integ-w56` at `447af127`
(`git merge --no-edit integ-w56`). Scope: root's own changes only, which are `75dce129` (LLVM manifest, 18 files), `266f24b6`
(wire llir-init) and the 13 first-parent merges in `7b71d658..447af127`. The merges were read with `git show --remerge-diff`.
Upstream was read under `$RUST_TS_DATA/rust`, and LLVM at `aab11ee0ea5e` by fresh fetch.

## Verdict: **APPROVE WITH NITS**

- The `initialize_available_targets()` call sits exactly where upstream's is.
- The test-only reset is justified, has one caller (a test), and does not weaken the "first call wins" check.
- All 18 manifest hashes are right, and the two fetched fresh match.
- All 13 merges are clean, and `ffi.ts` is what the generator writes.
- Load order is clean.
- tsc, the coverage check and the tests pass, with `CI=true` and with `CI` unset.

The findings are about test strength and comments. None of them changes behaviour. Finding 1 is the one worth acting on: in
the gate, the new call site is never reached.

## Findings

1. **minor: in the gate, the new wiring is never run, and one kind of regression passes**
   (`src/rustc_codegen_llvm/skeleton.test.ts:360-373`).
   - **The gap.** The gate's unit step always sets `CI=true` (`scripts/lib/unit-steps.ts:95`). So `configure_llvm` always
     stops at `LLVMRustDisableSystemDialogsOnCrash` (`src/rustc_codegen_llvm/llvm_util.ts:102-104`). That stop comes
     before `initialize_available_targets()` (`:186`) and `LLVMRustSetLLVMOptions` (`:188`). No gate test reaches those
     two calls. `target.oracle.test.ts` calls the model's function directly, not through `llvm_util.ts`.
   - **What it hides.** Suppose `llvm_util.ts:102-104` is deleted, or its condition breaks. With `CI=true`, the test then
     takes the "no stop" branch and still passes.
   - **Not new.** This is not a weakening by root: before `266f24b6`, the regex
     `(rustc_llvm::initialize_available_targets|LLVMRustDisableSystemDialogsOnCrash)` also accepted either outcome.
   - **Stronger forms**, best first:
     - (a) **Implement the stop in the IR model.** Upstream's `LLVMRustDisableSystemDialogsOnCrash`
       (`compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:130`) only calls `sys::DisableSystemDialogsOnCrash()`. At
       `aab11ee0ea5e` that function is empty on Unix: `llvm/lib/Support/Unix/Signals.inc:991` reads
       `void llvm::sys::DisableSystemDialogsOnCrash() {}` (checked by fresh fetch). The work is: pin `Unix/Signals.inc`,
       implement the function as a no-op with its markers, and make Windows stop. After that, `init` has one outcome on
       the root host. The test then asserts completion with no branch, and the gate runs lines 186 and 188.
     - (b) **Pin both states in the test.** Set the variable inside the test with `src/std/env.ts`'s `set_var`/`remove_var`,
       saving and restoring it, the way `src/std/env.test.ts` handles its own variable. First set `CI` and expect the stop,
       with `print` still reporting "LLVM is not initialized" (`INIT` stays incomplete after a stop). Then remove `CI` and
       run `drive_init` on a fresh backend, expecting it to complete. Both branches would then run on every run, gate
       included.
   - **A correction to the brief.** `scripts/lib/unit-steps.test.ts:199` already lists `CI` in `UNIT_ENV_HARMLESS`. So the
     scan does not forbid reading `CI` by name. It does require each named read to be listed with a reason. Branching on a
     value the gate fixes adds nothing, though, so (a) or (b) is the right fix either way.

2. **nit: the no-`CI` branch's check is implicit** (`src/rustc_codegen_llvm/skeleton.test.ts:372`).
   - `.not.toThrow(/LLVM is not initialized/)` passes whenever `print` throws anything else. With `sess` passed as
     `undefined`, it does throw something else, past `require_inited`.
   - The check still means something: it proves that `require_inited` passed. That needs `INIT.completed`
     (`llvm_util.ts:52-55`), which is set only once `configure_llvm` has returned through both new calls.
   - Suggestion: say so in the comment. Or assert the completion directly, for example that a second `drive_init` on a
     new backend does not stop.

3. **nit: the reset runs before the test but not after** (`src/rust_ts/llvm/target.oracle.test.ts:206`).
   - After this test, the process keeps `Initialized = true` and `CL_ARGS` set to the test's four arguments, for every
     later test file. I confirmed with two scratch test files that `bun test` shares this module state across files.
   - `tools.ts:265` forwards `llvm_cl_args()` to every opt/llc run that has no `with_cl_args`. Every such call in a test
     today is wrapped (`tools.test.ts:68,211,240,309`, `back/write.test.ts:530`), so nothing is affected now. It is a
     latent dependency on file order.
   - Suggestion: also reset in an `afterAll`, or wrap the test in try/finally. See the Q2 answer for a cleaner form.

4. **nit: the header's stop list omits the stop the gate now reaches** (`src/rustc_codegen_llvm/llvm_util.ts:7-10`).
   - Root rewrote this list. It still leaves out `LLVMRustDisableSystemDialogsOnCrash`, which is now the first and only
     stop `init` reaches with `CI` set. The omission predates root's change.
   - Related, not root's file: `docs/handoff/llir-init.md:300` still describes the old assertion, which accepted the
     `rustc_llvm::initialize_available_targets` stop.

## Answers

**Q1, `initialize_available_targets`: yes.** Upstream `llvm_util.rs:162-168` runs the `llvm_time_trace` →
`LLVMRustTimeTraceProfilerInitialize` block, then `rustc_llvm::initialize_available_targets()`, then
`LLVMRustSetLLVMOptions(..)`. `llvm_util.ts:179-188` has the same three, in the same order, with nothing in between. (The
`void llvm_c_strs;` line after `LLVMRustSetLLVMOptions` predates root's change.) The decision that the function lives in
the model is `docs/state/history.jsonl:700`. The model's function carries
`// rustc: compiler/rustc_llvm/src/lib.rs:73 initialize_available_targets` (`src/rust_ts/llvm/target.ts:527`). The stop it
replaces is gone, and the `llir` count of 5 → 4 (`skeleton.test.ts:145`) passes.

**Q2, the test-only reset.**
- **Justified: yes.** `LLVMRustSetLLVMOptions`'s `static bool Initialized` is process-wide, and so is the model's
  (`target.ts:163`). Since `266f24b6`, a run without `CI` has `drive_init` reach `LLVMRustSetLLVMOptions`. Whichever file
  runs first would then fix the options for the other. With `CI=true` the reset happens to do nothing: `init` stops first.
  A helper of the same kind already exists (`src/rust_ts/tracing.ts:212`, `reset_global_default_for_tests`).
- **Confined to tests: yes.** Its only caller, across `src/`, `scripts/` and `tools/`, is
  `target.oracle.test.ts:26,206`. Its doc comment marks it "Tests only, not upstream".
- **Does not weaken "first call wins": correct.** After the reset, the test still checks three things: the first
  `LLVMRustSetLLVMOptions` sets the arguments, a second call with an argument the model rejects (`-time-passes`) neither
  stops nor changes them, and the parser's own stops still fire. Without the reset, the `toEqual([])` precondition would
  fail in a run without `CI`. The test was not loosened to get around that.
- **Cleaner alternative:** a save-and-restore wrapper in `target.ts`, for example
  `with_fresh_llvm_options_for_tests(f)`. It would save `Initialized` and `CL_ARGS`, clear them, run `f`, and restore them in
  a `finally`, so the test leaves the process as it found it (finding 3). `tools.ts`'s `with_cl_args` already works this way.

**Q3, the skeleton test's two branches.**
- **Still meaningful: yes, partly.** Each branch checks its own outcome: the exact stop name in one, the `INIT` state in
  the other. A stop anywhere else fails the test: a different `Unported` fails `toBe`, and any other error is rethrown.
- **But it is weak in the gate.** Accepting both outcomes means the gate cannot tell "stops at the dialog stop" apart
  from "completes". That hides the regression described in finding 1.
- **Stronger form without branching on `CI`:** (a) implement the no-op stop, or (b) pin both states inside the test. See
  finding 1.

**Q4, the 18 manifest entries: correct.**
- `75dce129` adds exactly 18 paths. The 19th changed line is `TargetMachineC.cpp`, which only gains a trailing comma.
- `bun scripts/llvm-src.ts check` prints `llvm-src ok: 93 files at aab11ee0ea5e (the checkout's gitlink)`. The rust
  checkout's `src/llvm-project` gitlink is `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`, the manifest's `commit`.
- I fetched two files fresh from `raw.githubusercontent.com/rust-lang/llvm-project/aab11ee0…`, and both match the
  manifest:

| File | SHA-256 |
|---|---|
| `llvm/lib/MC/TargetRegistry.cpp` | `3d81758c…c10b` |
| `llvm/lib/Target/X86/X86TargetMachine.cpp` | `6efb2a39…6d72` |

**Q5, the merges: all clean.**
- `git show --remerge-diff` prints nothing for each of the 13 merges: `447af127 8f726364 832ea24f 9a7adb47 57c50f69
  569006df 5f73f6ff 4486a894 b6f5080f 05640697 ee89677f 4b2286bd fbf542b3`.
- Each second parent is a lane commit, a review commit, or `main`'s decision record. The last merge of each lane brings
  in its final review, which reads PASS WITH NOTES: fixers-56, cg-di-a, cg-lto-diag, llir-init-recheck and
  llir-tools-recheck-2.
- `bun tools/llir/ffi_gen.ts --check` prints `contract up to date: 381 fns, 33 enums, 4 bitflags`. A full regeneration
  (`bun tools/llir/ffi_gen.ts`) left `git status` clean.

**Q6, load order: clean.** In a fresh `bun -e "await import(...)"`, each of these loads first with no error:
- `rustc_codegen_llvm/lib.ts`, `llvm_util.ts`, `context.ts`, `back/write.ts`, `back/llvm_backend.ts`
- `rust_ts/llvm/target.ts`, `tools.ts`, `ffi.ts`

**Q7, commands.** Run with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`.

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check --offline` | `markers ok (26857, …; llvm 523)` |
| `CI=true bun test ./src/rustc_codegen_llvm/ ./src/rust_ts/llvm/ ./src/rustc_codegen_ssa/ ./src/rustc_error_messages/ ./scripts/lib/unit-steps.test.ts` | 459 pass, 0 fail, 16085 `expect()` calls, 47 files, no skips |
| The same, with `CI` unset (`env -u CI`) | 459 pass, 0 fail, 16084 `expect()` calls, no skips |

The difference of one `expect()` is the skeleton test's branch: two checks with `CI` set, one without.
