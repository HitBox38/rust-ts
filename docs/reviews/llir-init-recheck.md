# Re-check: llir-init fixes (wave 40p)

Reviewer: independent, read-only on code. I reviewed `git diff 2b54c738..e9e7a89d` on `t3/implement-llvm-init-target-machine`:
- `76cee423`: F1, F2, N1-N7;
- `c8890402`: N8;
- `e9e7a89d`: handoff.

I merged `e9e7a89d` into `t3/review-llir-init-recheck` to run it. The first review is `docs/reviews/llir-init.md` at `0c7205a4` (FAIL:
F1, F2, N1-N9).

Sources:
- LLVM at `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019`: the handoff's 18 manifest-addition files, fetched from `rust-lang/llvm-project` at
  that commit into my scratchpad (not `llvm-src/`). I also fetched `TargetOptions.h`, `CommandFlags.cpp` and `Support/Unix/Signals.inc`
  to check single claims.
- rustc at the pin: `llvm_util.rs`, `RustWrapper.cpp`.

**Verdict: PASS WITH NOTES.**
- F1 and F2 are fixed. Each new test is real and fails on the old code.
- N1-N9 are addressed.
- All 88 markers resolve, and nothing outside the findings changed.
- The four notes below are nits. None of them changes an output or weakens a check that existed before.

## Environment and commands

AC power. `.env.local` from integ-w39; `RUST_TS_REQUIRE_PROBES=1 RUSTUP_AUTO_INSTALL=0 RUSTC_ICE=0`; `bun install --frozen-lockfile`.
No samples were taken. I did not touch the oracle toolchain or `llvm-src/`. Each mutation below was made in the worktree, run, and
reverted with `git checkout -- <file>`; `git status` was clean after each.

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | **264 pass, 0 fail, 0 skip** (23 files), `CI` unset |
| `CI=true bun test ./src/rustc_codegen_llvm/skeleton.test.ts` | 15 pass, 0 fail |
| `PATH=/bin:/usr/bin bun test ./src/rust_ts/llvm/target.oracle.test.ts` (REQUIRE=1, no rustc) | 11 pass, 7 fail, each with exactly one `error: ERROR: the oracle's libLLVM.dylib is unavailable (…)` |
| `bun scripts/coverage.ts --check --offline` | exit 1, 84 `ERROR:` lines, all "names no file of harness/llvm-manifest.json"; nothing else |

## Checks

1. **F1: fixed.**
   - `triple.ts:426` now returns TargetDataLayout.cpp:566-568's string, `i32:32:32-` included.
   - **The 19-arm check is real.** I wrote my own script rather than reuse the lane's:
     - it parses `Triple::computeDataLayout`'s switch from the pinned TargetDataLayout.cpp;
     - for every `case` group that returns string literals, it joins the literals;
     - it sets each case's `Arch` on a model `Triple` and compares `computeDataLayout("")`.

     The result is **19 literal arms, 0 differences**: arc, avr, dxil, hexagon, msp430, tce, tcele, tcele64, xcore, xtensa, and the
     nine `""` arms (amdil, amdil64, hsail, hsail64, kalimba, shave, renderscript32, renderscript64, UnknownArch). I also re-read the
     arc, hexagon, tce, tcele64 and xtensa arms by hand against the C++.
   - **The libLLVM test for AVR, Hexagon, MSP430 and Xtensa is real** (`target.oracle.test.ts:431`).
     - `oracleTm` now initialises those back ends, and `oracleDataLayout` goes through `LLVMCreateTargetMachine` →
       `LLVMCreateTargetDataLayout` → `LLVMCopyStringRepOfTargetData`.
     - It passed under REQUIRE=1 with no skip.
     - It bites: when I dropped `-S16` from the model's msp430 string, the test failed.
     - ARC, DXIL, TCE and XCore have no back end in the oracle's libLLVM, as the test's comment says (lib.rs's 19 components; the first
       review's components test).
2. **F2: fixed.**
   - `triple.ts:337/:342/:347`: `isPS4` and `isPS5` test `x86_64 && SCEI && PS4` and `x86_64 && SCEI && PS5`, and `isPS` is
     `isPS4() || isPS5()`. That equals Triple.h:894, :900 and :906 at the pin.
   - `target.ts:364`: `if (TT.isPS() || TT.isOSBinFormatMachO())` equals X86TargetMachine.cpp:202, and the body is unchanged.
   - **The observable is sound.** libLLVM has no C getter for `TrapUnreachable`, so the test compiles
     `define void @f() { unreachable }` with `LLVMTargetMachineEmitToMemoryBuffer` (assembly) and looks for `ud2`.
     - With `TrapUnreachable` false, x86 emits nothing for `unreachable`. With it true and no noreturn call before it,
       `NoTrapAfterNoreturn` is irrelevant and a `ud2` is emitted.
     - `keep[0]` is the triple buffer, so `LLVMSetTarget` sets the same triple as the machine.
     - The model side calls the target's `createTargetMachine` directly, with `TrapUnreachable` unset. That matches what
       `LLVMRustCreateTargetMachine` passes before the constructor overrides it.
     - The seven triples cover both answers, non-SCEI vendors, i686 and `sie` → SCEI.
   - **The test fails on the old OS-only check.** With line 364 put back to `getOS() === "PS4" || getOS() === "PS5"`, the test
     fails: `x86_64-unknown-ps4`, `x86_64-unknown-ps5` and `i686-scei-ps4` become `true` where libLLVM gives `false`.
3. **N1-N9.**
   - **N1**: the spread is gone, and the test asserts 27 entries, all distinct, with both `NORMAL_TRIPLES` among them.
   - **N2**: both markers were added. `AArch64TargetMachine.cpp:572 AArch64beTargetMachine` and `TargetMachine.h:277
     setLargeDataThreshold` resolve.
   - **N3**: `TLSSize` was added to `TargetOptions`.
     - `target.ts:472-474` sets 24 when the size is 0. That is upstream's default: TargetOptions.h:130 `TLSSize(0)`, and
       CommandFlags.cpp:384 `-tls-size` has `cl::init(0)`, which `InitTargetOptionsFromCodeGenFlags` copies at :609. The model
       accepts no `-tls-size`.
     - The clamps (AArch64TargetMachine.cpp:393-399) stop on `TLSSize > 24` (`target.ts:477`). The small/kernel clamp needs >32 and
       the tiny clamp >24, so at 24 neither fires and the stop is not reached.
     - The stop is also conservative for 25-32 under the small model, where upstream changes nothing. The order is right: the
       Windows-CFI stop comes first, as upstream does. See R3.
   - **N4**: `drive_init` (`skeleton.test.ts:295`) runs the real driver, `compiler_entrypoint` → `Config` → `run_compiler`, with
     `make_codegen_backend` returning the backend. So `init(early_sess)` runs as for any backend, `LLVMIsMultithreaded` included
     (`llvm_util.ts:48` `bug!`s otherwise).
     - The test does **not** read `CI`. The ported `configure_llvm` reads it (`llvm_util.ts:102`, as llvm_util.rs:79).
     - `unit-steps.test.ts` passes, and `CI` is in `UNIT_ENV_HARMLESS` anyway (`unit-steps.test.ts:199`).
     - Accepting both stops is needed, because the gate's unit step sets `CI=true` (`scripts/lib/unit-steps.ts:95`).
     - It hides no wrong output, but it is weaker than it need be. See R2.
   - **N5**: the PORT at `target.ts:184-187` is now accurate. I checked on the oracle: `-generate-arange-section`,
     `-enable-tail-merge=0`, `--inline-threshold=0`, `-mergefunc-use-aliases` (aarch64-apple-darwin) and
     `-enable-machine-outliner=never`, each given twice, exit 0 with no stderr. The stop stays conservative.
   - **N6**: `copyTargetOptions` copies `MCOptions` (`target.ts:679`). Every other `TargetOptions` field, and every `MCOptions`
     field, is a primitive, so this is a full copy.
   - **N7**: every libLLVM test calls `libLLVM()` first. Without rustc on `PATH`, each of the 7 fails with exactly one `ERROR:` line,
     and the 11 model tests pass. See R4 for a cosmetic point.
   - **N8: fixed and tested.**
     - `record.ts:157/:167/:237/:300`: a context enters `livectx` at `LLVMContextCreate` and leaves it at the end of `retire`, and
       `id()` tags a new handle 0 when its thread's current context is not live.
     - The `LLVMContextDispose` scan and `dsoscan` run before `retire`, so the disposing context is still live while its last
       handles are tagged.
     - All `livectx` accesses happen under `mu`.
     - `record.oracle.test.ts` adds a stale-context case, expecting `stale 5 5`. With the `livectx` check removed it fails
       (`stale 5 0`), so the test covers the fix.
     - rustc creates contexts only through `LLVMContextCreate` at the pin (there is no `LLVMRustContextCreate` in RustWrapper.cpp), so
       no context escapes `livectx`.
   - **N9**: recorded as handoff PORT 13.
4. **Markers.** I ran `llvmMarkerErrors` over `target.ts` and `triple.ts`, using a temporary manifest of the 18 fetched files
   (SHA-256 of my copies) for the 84 markers into them, and the real manifest and `llvm-src/` for the 4 others:
   - **88 markers, 0 errors, 0 malformed**;
   - `TripleName.def` is the only one of the 18 files without a marker, by design;
   - the markers of the other IR-model files into manifest files: 0 errors.

   `coverage.ts --check --offline` gives exactly the 84 missing-manifest lines (79 + `isPS4`, `isPS5`, `isPS`,
   `AArch64beTargetMachine`, `setLargeDataThreshold`).
5. **Regressions.**
   - The diff touches 7 files: target.ts, triple.ts, record.ts, their two oracle tests, skeleton.test.ts and the handoff.
   - No committed `.script`, fixture, baseline, suite or `scripts/` file changed.
   - No check was weakened:
     - `DL_TRIPLES` lost only duplicates, and the test now asserts the M7 two are present;
     - the skeleton test's removed `LLVMIsMultithreaded` assertion is implied by driving `init`;
     - the recorder test only gained a case;
     - the `{ ...Options }` → `copyTargetOptions` change copies more, never less.
   - **The 19 proof scripts re-record byte for byte** with the changed recorder. In the 264-test run, with REQUIRE=1 and nothing
     skipped:
     - proof.oracle.test.ts re-records the 15 proof cases and the 2 empty ones;
     - context.test.ts re-records its 2 `context_oracle` scripts.

     Each recording is compared to the committed script (`proof.oracle.test.ts:116`, `:176`), along with the 2 committed empty
     replays.
6. **Commands**: see the table.

## Findings

No must-fix findings.

### R (nits)

- **R1** `src/rust_ts/llvm/triple.ts:335-349`: `isPS4`, `isPS5` and `isPS` (Triple.h:894-906) sit after `isX86_64` (Triple.h:1204),
  out of header order. They belong between `isOSBinFormatXCOFF` (:880) and `isOSFirmware` (:954). The other 30 Triple.h markers in
  the class follow header order.
- **R2** `src/rustc_codegen_llvm/skeleton.test.ts:349`: the regex accepts either stop whatever the environment.
  - The gate's unit step always sets `CI=true` (`scripts/lib/unit-steps.ts:95`). So the gate asserts only the
    `LLVMRustDisableSystemDialogsOnCrash` stop, and only local runs reach `initialize_available_targets`.
  - A regression that dropped `configure_llvm`'s `var_os("CI")` condition would pass everywhere.
  - Reading `CI` is allowed in test files (`UNIT_ENV_HARMLESS`, `unit-steps.test.ts:199`), so the test can expect exactly one stop:
    `process.env.CI !== undefined ? Disable… : initialize_available_targets`.
  - It hides no wrong output today.
- **R3** `src/rust_ts/llvm/target.ts:472-477`: `TLSSize = 24` has no test and no reader in the model (`llc` recomputes it). It is
  harmless, and a one-line assertion on an AArch64 machine would pin it.
- **R4** `src/rust_ts/llvm/target.oracle.test.ts:270`: without rustc, the `ERROR:` line prints `(lib/libLLVM.dylib)` and
  `toolchain (nightly)`, because `SYSROOT` is empty and `UPSTREAM.json`'s `toolchain` field is the literal `"nightly"`. It is still
  one line per test, as N7 asked, but naming `rustc +nightly --print sysroot` as the failing step would say more. This is cosmetic.

## For root

- Add the 18 manifest files (handoff § Manifest additions). `coverage.ts --check` should then pass: I resolved all 84 against
  copies of exactly those files at the pinned commit.
- **Not this lane's code, but found here:** `LLVMRustDisableSystemDialogsOnCrash` is still a stub (`src/rust_ts/llvm/ffi.ts:1054`).
  - Upstream it calls `sys::DisableSystemDialogsOnCrash()`, which is empty on Unix (Support/Unix/Signals.inc:991).
  - So any rust-ts run with `CI` set, such as the gate's unit step, stops there before `initialize_available_targets`. Once root
    ports the `llvm_util.ts` one-liner, that is the next stop to remove. R2's test would then follow.
- `src/rustc_codegen_llvm/llvm_util.ts:8`'s header still lists `LLVMIsMultithreaded` as a stop. It is stale since this lane, and it
  is outside the lane's files.
