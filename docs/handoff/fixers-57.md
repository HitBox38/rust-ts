# Handoff: fixer lane `fixers-57` (M7, wave 40q)

Branch `t3/fix-llvm-handler-nits`. Commits: `672d1984` (items 1–3, fixers-56 N1), `0efe8512` (item 4), `793c662c` (item 6), `2afe2101`
(item 7 text), then this handoff.

## Items

1. **done** (`672d1984`): `LLVMRustDisableSystemDialogsOnCrash` is implemented in `src/rust_ts/llvm/target.ts`, after
   `LLVMRustInstallErrorHandlers`, as RustWrapper.cpp:130 has it. It calls `DisableSystemDialogsOnCrash`, marked
   `// llvm: llvm/lib/Support/Unix/Signals.inc:991` and empty on Unix. On a win32 host it stops by name. `ffi.ts` was
   regenerated with `bun tools/llir/ffi_gen.ts` (now 284 of 381 implemented; `--check` is up to date). `skeleton.test.ts`'s
   backend test has one branch: it drives `init` on fresh LLVM options and asserts completion directly (the two options
   `configure_llvm` always adds, llvm_util.rs:136, :139). This also covers finding 2. The `"llir"` stub count stays at 4: that
   table counts `unported("llir: ...")` in rustc_codegen_llvm's own sources, and this stop was a generated stub in ffi.ts.
2. **done** (`672d1984`):
   - Finding 3: `reset_llvm_options_for_tests` became `with_fresh_llvm_options_for_tests(f)`, which saves the options, clears
     them, runs `f`, and puts them back in a `finally` (the reviewer's Q2 form). The test checks the restore, also after a stop.
   - Finding 4: `llvm_util.ts`'s header stop list now adds the `LLVMDisposeMessage` after `LLVMGetHostCPUFeatures`, and says
     `LLVMRustDisableSystemDialogsOnCrash` stops only on a Windows host.
   - The related stale note in `docs/handoff/llir-init.md:300` is updated (`2afe2101`).
3. **done** (`672d1984`): `target.ts`'s `writeStderr` writes UTF-8 through `stderr_write_all`, straight to fd 2 with no
   `OUTPUT_CAPTURE`, and drops the result (nits 1–2). The comment dropped above `sys::RunInterruptHandlers()`
   (RustWrapper.cpp:99-105) is restored (nit 4). A new test in `target.oracle.test.ts` (nit 3) runs two child processes:
   - `FatalErrorHandler` under `set_output_capture([])` gives stderr exactly `rustc-LLVM ERROR: boom\n` and exit code 101.
   - `report_fatal_error("boom", false)` with no handler gives `LLVM ERROR: boom\n` and exit code 1.

   Each takes about 15 ms and reads no environment variable. The test fails with the old `write_stderr` path (checked).
   `BadAllocErrorHandler` is not run: it ends in `abort()`, and on macOS every abort writes a crash report under
   `~/Library/Logs/DiagnosticReports`. My one probe of it left `bun-2026-11-14-074907.ips` there.
4. **partly done** (`0efe8512`):
   - Note 1, done: the R1 test asserts opt's `[134, "SIGABRT"]`, the verifier's
     `module flag identifiers must be unique (or of 'require' type)`, and `!"EnableSplitLTOUnit"` in stderr.
   - Note 2, not reachable: `rustc-ts` with the reviewer's flags stops at
     `rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate` (exit 70), with or without `-Zsplit-lto-unit`. Checked on this
     tree. It becomes reachable once cg-register's forwarding lands, so queue it after cg-register.
   - Note 3, not done: there is no cheap seam. `canonical_extra_passes` calls `run_pinned_tool` inside its own module, and
     for the guard to fire, the real opt would have to die by a signal while `-print-pipeline-passes` prints an `opt: `
     parser message. The reviewer also said no action is needed.
   - Note 4 (N3), done: `recordedTm` builds a real machine with `initialize_available_targets()` and
     `LLVMRustCreateTargetMachine(...tmArgs(line))`, with the level and features replaced; the F1/F2 test uses it too.
     `opt_plan`'s no-tool tests keep their small `{Reloc, Model, Level}` objects, which opt_plan's own parameter type accepts
     without a cast.
   - **One visible change in the expected llc flags:** a real machine carries `SplitDwarfFile = ""`, because rustc always
     passes a name (write.rs:249-259 `path_to_cstring_helper`). So `llc_target_flags` gives `-split-dwarf-file=`; the old
     structural view had mapped `""` to unset. tools.ts is unchanged. I checked that the pinned llc writes byte-identical
     objects with and without the empty flag (`opt.O0.ll`, `opt.O2.ll`, x86_64 -O2), and llir-tools-recheck N3 had found
     the real-machine objects byte-identical to the oracle's.
5. **nothing open**: `docs/reviews/llir-init-recheck.md` §3 marks every one of N1–N9 fixed or addressed. Its R2 is covered by
   item 1. R1, R3 and R4 (`triple.ts` order of `isPS*`, a `TLSSize` assertion, the `ERROR:` text) were not in this brief, so
   I left them for root to queue.
6. **done for N1, N3, N6 of cg-di-a and N1, N3, N4, N5 of cg-lto-diag** (`793c662c`):
   - cg-di-a N1: `debuginfo/mod.test.ts` adds a direct test of `set_var_name` on IR-model values. An unnamed global stays
     unnamed; an argument and an instruction get their names; an existing name is kept. With the guard removed, the test
     fails (checked).
   - cg-di-a N3: a PORT on `DIBuilderBox::drop` says upstream drops it implicitly at base.rs:216, and that base.ts's call
     belongs with llir-di. `docs/handoff/cg-di-a.md` is corrected. base.ts was not changed, as the review asked.
   - cg-di-a N6: `gdb.ts` copies `visualizer.src` with a loop instead of a spread (PORT).
   - cg-lto-diag N1: the resolve-weak PORT in `back/lto.ts` now gives the full effect (every prevailing linkonce becomes
     weak, autohide, GlobalDCE), plus §3's `-Clto=off` argument for why no link can fail.
   - cg-lto-diag N3: `diagnostics.test.ts`'s comment credits cg-lto-diag under root's exception and cites the fn lines 143
     and 149.
   - cg-lto-diag N4: a new `lto.test.ts` test runs the real `optimize_and_codegen_thin_module` under ThinLocal. It parses the
     thin buffer back, calls none of the four `LLVMRustPrepareThinLTO*` stubs, runs `run_pass_manager(thin = true)` through
     the real opt (the two adds fold to `add i32 %x, 2`), and has `codegen` replaced by a recorder. The control, with an
     index and `lto: "Thin"`, stops at `llir: LLVMRustPrepareThinLTORename`. The test skips without the pinned opt unless
     `RUST_TS_REQUIRE_PROBES=1`.
   - cg-lto-diag N5: `cmp_cstr` uses `globalThis.Buffer.compare`, with a comment.
   - Left as they are: cg-lto-diag N2 (handoff wording only, not code), N6 (a behaviour change in the `-C incremental` path,
     which the review defers to D11), and N7 (a note for the llir lane about `llvm/diagnostic.ts`, outside the listed files).
7. **done**:
   - The 201-column line at `llvm_util.ts:404` is rewrapped (`672d1984`).
   - The fixers-56 handoff's sentence about `context.ts` is corrected (`2afe2101`).
   - `analyze_oracle/driver.ts` now says "forwarders", not "stubs" (`2afe2101`).

## Files touched
`src/rust_ts/llvm/{target.ts, ffi.ts (generated), target.oracle.test.ts, tools.test.ts}`,
`src/rustc_codegen_llvm/{llvm_util.ts, skeleton.test.ts, diagnostics.test.ts}`,
`src/rustc_codegen_llvm/back/{lto.ts, lto.test.ts}`,
`src/rustc_codegen_llvm/debuginfo/{mod.test.ts, di_builder.ts, gdb.ts}`,
`src/rustc_codegen_ssa/mir/analyze_oracle/driver.ts`,
`docs/handoff/{cg-di-a.md, fixers-56.md, llir-init.md, fixers-57.md}`.

None of cg-register's, ssa-linker's, ssa-link-a's or ssa-archive's files was touched. `skeleton.test.ts` changed only in
the backend test and one import, not in the stub-count table.

## `unported(...)` left
- New: `llir: sys::DisableSystemDialogsOnCrash on a Windows host (llvm/lib/Support/Windows/Signals.inc is not pinned)`.
- The stub `llir: LLVMRustDisableSystemDialogsOnCrash` is gone.

## `// PORT:` decisions
- `target.ts` `DisableSystemDialogsOnCrash`: empty on a Unix host; a Windows host stops.
- `target.ts` `writeStderr` (doc comment): writes fd 2 directly and ignores the result, like `std::cerr`, `(void)!::write`
  and `write_retry`.
- `debuginfo/di_builder.ts` `drop`: no call site until llir-di (base.rs:216).
- `debuginfo/gdb.ts`: `extend_from_slice` as a loop.

## Evidence
All runs on AC power, with `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0` (`.env.local`).

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p .` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (26858, 73 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 745; llvm 524)` |
| `bun tools/llir/ffi_gen.ts --check` | `contract up to date: 381 fns, 33 enums, 4 bitflags` |
| Coverage | `llvm_util.rs` 26/26, `back/lto.rs` 19/19, `debuginfo/mod.rs` 24/24, `gdb.rs` 3/3, `di_builder.rs` 7/7; llvm-wrapper 73/197 |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/rustc_codegen_ssa/mir/ ./src/std/ ./scripts/lib/unit-steps.test.ts` with `CI=1` | 437 pass, 0 fail, 18842 `expect()`, 49 files, no skips |
| The same, with `CI` unset | 437 pass, 0 fail, 18842 `expect()`, no skips |
| `difftest --suite mono-ui --sample 200 --jobs 6` | 200/200 MATCH, run `20261114-060352-fixers-57-cyme` |
| `difftest --suite mir --sample 200 --jobs 6` | 200/200 MATCH, run `20261114-060529-fixers-57-bixi` |
