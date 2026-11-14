# Handoff: fixer lane `fixers-58` (M7, wave 40r): queued nits

Branch `t3/fixers-58-queued-nits`. Commits: `b2015af3` (item 1), `64ac80a1` (item 3), `3149b5cc` (item 4), `12fd90b7` (item 6),
`3e9913bd` (item 5), `bc48b759` (item 2), then this handoff. No behaviour change. Every change is a test, a comment, a marker,
handoff text, a moved method, or a test-only helper.

## Items

1. **done** (`b2015af3`).
   - N1: `docs/handoff/cg-lto-diag.md` now says that only the clearing of `dso_local` is ELF-only, while the setting happens on
     every object format, Mach-O included.
   - N2: I took the reset, which is closer to the existing pattern. `llvm_util.ts` has a test-only
     `with_fresh_llvm_init_for_tests(f)`, placed next to `INIT`. It saves `INIT`, clears it, runs `f` inside target.ts's
     `with_fresh_llvm_options_for_tests`, and puts both back in a `finally`. It lives in llvm_util.ts, not target.ts, because
     `INIT` is private there, and llvm_util.ts already imports target.ts (the reverse import would be a cycle). target.ts's doc
     comment points to it.
   - `skeleton.test.ts` uses the new helper. The `require_inited` checks moved inside the wrapper, since `INIT` is restored
     after it. The test also checks:
     - that `INIT` starts out reset (`print` throws "LLVM is not initialized");
     - that a nested call resets a completed `INIT` and fresh options, then restores them.
   - Mutation: with the `INIT.completed = false` line removed, the test fails (1 fail). I reverted the mutation.
2. **done** (`bc48b759`). The case is now reachable through the driver.
   - The command: `rustc-ts tools_oracle/opt.rs --sysroot <oracle> --target x86_64-unknown-linux-gnu -Copt-level=2
     -Ccodegen-units=1 -Zsplit-lto-unit -Clinker-plugin-lto --emit=llvm-bc,llvm-ir`.
   - Result: exit 70, with stderr exactly
     `rust-ts: unported: llir: LLVMRustModuleSerialize of a module with an EnableSplitLTOUnit flag ... review llir-tools-recheck R1`.
     No `opt.bc` is written.
   - Without `-Zsplit-lto-unit`, the same command exits 0, with empty stderr, and writes `opt.bc` (4276 bytes, the size the
     reviewer saw at the wrapper level).
   - The new test is in `tools.test.ts`, inside the oracle `describe`. Each run takes about 1 s in a subdirectory of
     `llvm_tmp_dir()`; the timeout is 60 s.
3. **done** (`64ac80a1`).
   - R1: `isPS4`, `isPS5` and `isPS` (Triple.h:894/900/906) now sit between `isOSBinFormatXCOFF` (:880) and `isOSFirmware`
     (:954).
   - R3: `target.oracle.test.ts` asserts `TLSSize` 24 on the AArch64 machine (AArch64TargetMachine.cpp:391-392) and `undefined`
     on the X86 one.
   - R4: `libLLVM()`'s `ERROR:` line now names the step that failed. Checked with rustc off `PATH`:
     ``ERROR: `rustc +nightly --print sysroot` failed, so the oracle's libLLVM.dylib cannot be found; the pinned toolchain on
     aarch64 macOS is needed``. Other cases name the missing dylib path or the host.
4. **done** (`3149b5cc`).
   - `// crate: pathdiff-0.2.3/src/lib.rs:247 assert_diff_paths` and `...:177 abs` markers sit above the helpers in
     `lib.test.ts`.
   - `// crate-skip: pathdiff-0.2.3/src/lib.rs:121 diff_utf8_paths cfg(feature = "camino") is off` sits after `diff_paths`,
     in place of the header's PORT note.
   - Coverage reads **10/10 (1 skipped)**: `pathdiff-0.2.3 10/10 100.0% (1 skipped)`.
5. **done** (`3e9913bd`).
   - A `PORT (drift, review mono-run-head N3)` note on `mono_collection_head` names what it copies: upstream
     `back/llvm_backend.rs:336-357` (the offload check, whose stop text differs) and `base.rs:723-739` (ported in
     `rustc_codegen_ssa/base.ts` `codegen_crate`).
   - New `src/rust_ts/codegen_backend.test.ts`. It runs the copy and the ported `LlvmCodegenBackend.codegen_crate` on a stub
     `tcx`, with a real `DiagCtxt` and emitter. There is one case per path: the collector (stopped at the stub with its key
     `null`), `CpuRequired`, `CpuUnsupported` and `-Zoffload`. For each case it compares where the run stops and the stderr.
   - Mutations: swapping the copy's `CpuUnsupported` for `CpuRequired` fails the test, and so does changing its collector key.
     Both mutations are reverted.
   - Not done: the reviewer's optional cross-reference in base.ts's `codegen_crate` (base.ts belongs to ir-fix-a). Root may
     add it.
6. **done** (`12fd90b7`): `regen.ts:13` and `docs/handoff/ssa-archive.md:91` now say the embedded bitcode is "ELF's `.llvmbc`
   section, Mach-O's `__LLVM,__bitcode`".

## Files touched

- `src/rustc_codegen_llvm/llvm_util.ts`, `skeleton.test.ts`
- `src/rust_ts/llvm/target.ts` (comment only), `triple.ts`, `target.oracle.test.ts`, `tools.test.ts`
- `src/vendor/pathdiff/lib.ts`, `lib.test.ts`
- `src/rust_ts/codegen_backend.ts` (comment only), and the new `src/rust_ts/codegen_backend.test.ts`. The test file is not on
  the brief's list, but it tests only that file.
- `src/rustc_codegen_ssa/back/archive_oracle/regen.ts` (comment only)
- `docs/handoff/cg-lto-diag.md`, `docs/handoff/ssa-archive.md`, and this file

## Evidence

| Check | Result |
|---|---|
| `bunx tsc` | exit 0 |
| `bun scripts/coverage.ts --check` | `markers ok (27154, 74 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5326; library 745; llvm 524)` |
| `bun test ./src/rust_ts/llvm/ ./src/rustc_codegen_llvm/ ./src/vendor/pathdiff/ ./src/rust_ts/ ./scripts/lib/unit-steps.test.ts`, `CI=1` | 430 pass, 0 fail, 42 files |
| the same, `CI` unset | 430 pass, 0 fail, 42 files |
| `difftest --suite mono-ui --sample 200 --jobs 6` (`RUST_TS_AGENT=fixers-58`) | MATCH 200/200, 488 skipped (run `20261114-132234-fixers-58-m6ca`) |

Setup: `.env.local` copied from `integ-w39`, plus `RUST_TS_REQUIRE_PROBES=1` and `RUSTUP_AUTO_INSTALL=0`;
`bun install --frozen-lockfile`. The machine was on AC power, and no `GATE_RUNNING` file existed.

## unported / PORT

- No new `unported(...)`.
- New `PORT` note: `mono_collection_head`'s drift note (item 5).
- One PORT note was removed: pathdiff's camino note, now the `crate-skip:` line (item 4).
