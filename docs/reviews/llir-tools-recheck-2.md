# Re-check 2: lane `llir-tools`, fix for R1 (wave 40p): **PASS WITH NOTES**

Independent reviewer, read-only on code. I reviewed `git diff d1eb362a..1208707b` on `t3/implement-llir-tools`. It holds one commit,
`1208707b` ("llir-tools: recheck fixes R1, N1, N2"). It touches `tools.ts`, `tools.test.ts` and the handoff. The first re-check is
`docs/reviews/llir-tools-recheck.md` at `9e868027` (FAIL on R1, with nits N1-N3).

I merged `1208707b` into this worktree. I fetched `llvm/tools/opt/optdriver.cpp` at `aab11ee0ea5ea9a1d462ad0bc1fae9d9bb643019` (the
manifest's repo and commit) into my scratchpad. Nothing was written under `$RUST_TS_DATA/llvm-src/`. Every run used AC power,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0` and `RUSTC_ICE=0`.

R1, N1 and N2 are fixed as asked. Nothing else changed.

## Commands

| Command | Result |
|---|---|
| `bunx tsc --noEmit -p .` | clean (exit 0) |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts` | **304 pass, 0 fail**, 24 files, no skips. This matches the handoff: 303 before, plus the R1 test. |
| `bun scripts/coverage.ts --check --offline` | 84 `ERROR:` lines: 39 in `target.ts` and 45 in `triple.ts`. All say "names no file of harness/llvm-manifest.json". These are the same llir-init errors as before, and none is in this lane's files. |

## The checklist

1. **R1: fixed.**
   - **Upstream.** At the pin, `optdriver.cpp:723-727` has `if (OutputThinLTOBC) { M->addModuleFlag(Module::Error,
     "EnableSplitLTOUnit", SplitLTOUnit); ... }` with no `getModuleFlag` check, so the cited `:724` is the `addModuleFlag` line. The
     same block adds `UnifiedLTO` only under `-unified-lto`, which the port never passes.
   - **The stop.** `tools.ts:709` defines `SPLIT_LTO_UNIT_FLAG`. `tools.ts:720-722` tests the module text against it after the
     fat-LTO stop and before the `assign-guid` run. A match stops by name with `unported(...)` (exit 70). The regex accepts any
     behavior and any value. That is right: the verifier rejects any duplicate module flag name that is not of type `require`, so a
     flag of 0 would break the module too.
   - **The PORT.**
     - `tools.ts:717-719` and `:729-732` now say that opt *always* adds the flag and that a module which already has one stopped
       above.
     - The rustc cite (`context.rs:297-303`) matches the pinned source. That code ports to `context.ts:513-514`.
     - Handoff PORT 8 (`docs/handoff/llir-tools.md:221-224`) says the same, and the new stop is listed among the `unported` stops
       (`:183`).
     - PORT 8 is now accurate.
   - **The test** (`tools.test.ts:368-384`) is not vacuous. I checked its two key assertions separately:
     - opt `--thinlto-bc` on the test's text exits with SIGABRT/134, `module flag identifiers must be unique (or of 'require' type)`.
       The test asserts only `status !== 0` (see note 1).
     - `-passes=assign-guid -S` on the same text does add `!guid !1` to `@f`. So `not.toContain("!guid")` really shows that the
       wrapper stopped before any opt run.
   - **The reviewer's case.** The pinned rustc compiled `tools_oracle/opt.rs` with `--target x86_64-unknown-linux-gnu -Copt-level=2
     -Ccodegen-units=1 -Zsplit-lto-unit -Clinker-plugin-lto --emit=llvm-bc,llvm-ir`. It exited 0 and wrote `opt.bc` (4160 bytes).
     The `.ll` has `!2 = !{i32 4, !"EnableSplitLTOUnit", i32 1}`. I loaded that `.ll` into a `Module` and called
     `LLVMRustModuleSerialize(M, true)`:
     - raw opt on that text gives status 134, SIGABRT, `module flag identifiers must be unique ...`. This is the earlier ICE cause.
     - the wrapper now throws `Unported: llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag (-Zsplit-lto-unit or
       CFI): opt --thinlto-bc always adds another (optdriver.cpp:724); review llir-tools-recheck R1`, and the module text is
       unchanged.
   - **Control: the same build without `-Zsplit-lto-unit`.** That `.ll` has no such flag, and the wrapper still serializes
     (4276 bytes). The stop does not catch ordinary modules.
   - **A model-built module.** I added the flag through `Module.addModuleFlag` (the path `LLVMRustAddModuleFlagU32` takes). The
     printer writes `!0 = !{i32 4, !"EnableSplitLTOUnit", i32 1}`, the regex matches, and the wrapper stops. So the check also fires
     on modules that rustc's codegen builds, not only on text loaded from a file.
   - **End to end** (see note 2). `rustc-ts` with the same flags and `--sysroot` stops at
     `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate` (exit 70), with or without `-Zsplit-lto-unit`. The driver does not
     reach the wrapper yet, so I could only reproduce the case at the wrapper level, as the first re-check did.
2. **N1: fixed.**
   - The F4 test name (`tools.test.ts:348`), the PORT (`tools.ts:731`) and handoff PORT 8 (`:225`) all say "the only difference in
     the disassembly".
   - They also say that llvm-dis prints no use lists, so the use-list part rests on the separate bytes check (`tools.test.ts:354-356`,
     `:357-358`; `tools.ts:732`).
3. **N2: fixed.**
   - The guard is at `tools.ts:449`, with its comment at `:448`:
     `r.status !== 0 && r.signal === undefined && line.startsWith("opt: ")`.
   - `run_pinned_tool` sets `signal: undefined` exactly when `exitCode !== null` (`tools.ts:117`). A death by signal therefore falls
     through to the `panic` at `:450`, which is ICE-class.
4. **Regressions: none.**
   - The diff touches only `tools.ts` (the N2 guard, the R1 regex and stop, and comments), `tools.test.ts` (the F4 test's name and
     comment, and one new test) and the handoff.
   - No assertion was removed or loosened.
   - Nothing under `scripts/`, `harness/`, `tools/`, `package.json` or `tsconfig.json` changed.
   - The F4 test still passes.
5. **Commands:** see the table.

## Notes

1. **The R1 test asserts only that opt fails, not why.** `src/rust_ts/llvm/tools.test.ts:373`. The check is
   `expect(run_pinned_tool(...).status).not.toBe(0)`. Today opt fails for the right reason (SIGABRT, `module flag identifiers must
   be unique`). If the test text were malformed, though, the assertion would still pass. Matching `/module flag identifiers must be
   unique/` on `stderr`, or `signal === "SIGABRT"`, would pin it down. This is optional.
2. **The reviewer's case is reproduced at the wrapper level only.** `src/rust_ts/llvm/tools.ts:720`. The driver stops at
   `codegen_crate` before `write.rs`'s `ModuleBuffer::new`. Once codegen lands, the `-Zsplit-lto-unit -Clinker-plugin-lto
   --emit=llvm-bc` command should exit 70 with this stop's text. That makes it worth a codegen-llvm or ui case when the driver gets
   there. This is not a defect in this lane.
3. **The N2 guard has no test.** `src/rust_ts/llvm/tools.ts:449`. Testing it would need opt to die by a signal during
   `-print-pipeline-passes`, which is hard to arrange. The logic is a single condition and reads correctly. No action needed.
4. **N3 from the first re-check is not done:** the tests still use a structural target machine. `src/rust_ts/llvm/tools.test.ts:58`.
   The handoff says so (`docs/handoff/llir-tools.md:325`). That re-check already found the real machine byte-identical on two
   targets. This is optional.

## Verdict

**PASS WITH NOTES.** R1 is fixed: a module that already has `EnableSplitLTOUnit` now stops by name before any opt run. The PORT
matches `optdriver.cpp:724`. The new test shows that opt fails on such a module and that the wrapper stops first, and the
reviewer's case now hits a named stop instead of an ICE. N1 and N2 are fixed. Nothing else changed. The notes are optional.
