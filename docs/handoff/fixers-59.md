# Handoff: fixer lane `fixers-59` (M7, wave 40s): queued src nits

Branch `t3/fixer-59-queued-src-nits`, on `2bf7435a`. One commit per finding, then this handoff. There is one behaviour change, the one the brief
allows: item 5's dummy-backend `create_dll_import_lib` override (see below). Everything else is comments, tests, a moved test helper, a
generator's error path, or a refactor that changes no value.

## Items

1. **done** (`7058691d`). w40q-audit N2: `ported_backend`'s doc comment (`src/rust_ts/codegen_backend.ts`) no longer says the statistics forwards
   are reached only after `join_codegen`. It now says that `Linker::link` (queries.rs:49) calls them after its check-only branch too, so a
   check-only compile with `-Ztime-llvm-passes` (one CGU) or `-Zprint-codegen-stats(-json)` reaches them without `codegen_crate` having run.
   It also says that today the stand-in's `init` stops those flags first (`non_default_llvm_input`). Checked: `main.ts --emit=metadata
   -Ztime-llvm-passes` and `-Zprint-codegen-stats` both exit 70 with `unported: rustc_codegen_llvm::llvm_util::configure_llvm (-Z ...)`, the
   stand-in's stop, not the model's FFI stub. That matters for the audit: its N2 says such a compile "now ... stops at the model's FFI stub". On
   this tree `init` stops it earlier, so the forwards are reachable only in principle.
2. **done**.
   - N1 (`6a384067`): `codegen_backend.test.ts` has a fifth case, `offload: [{ $: "Device" }]` with `need_explicit_cpu: true`. Mutation: dropping
     the `Device` arm of `mono_collection_head`'s offload check gives 1 fail of 5 (the new case). Reverted.
   - N2 (`ba81ea3b`): `tools.test.ts`'s "R1 end to end" control branch now runs the pinned rustc on the same command, in its own subdirectory,
     and compares the two `opt.ll` at N1 (`normalForm`). A comment says why `opt.bc` is not compared: PORT 8's `EnableSplitLTOUnit` flag,
     pinned by F4. Mutation: appending a global to the oracle's text before the compare gives 1 fail. Reverted. The extra oracle run costs about
     0.3 s.
   - N3 (`cee0436e`): `pathdiff/lib.test.ts`'s `assert_diff_paths` (lib.rs:247) moved last in the `describe`, after `test_current_directory`.
     Only the position changed: it is a hoisted declaration, and its marker stays directly above it.
3. **done** (`693d427c`). mono-run-head N3: one comment line at the top of `rustc_codegen_ssa/base.ts`'s `codegen_crate` body, inside the
   function so the marker stays on the line above the `function`. It points to `rust_ts/codegen_backend.ts` `mono_collection_head`.
4. **done**.
   - N1 (`1786a10a`): `apple.ts` `xcrun_show_sdk_path` decodes stderr and stdout (`:262`, `:278` before the edit) with
     `new TextDecoder("utf-8", { ignoreBOM: true })`, with a `PORT:` note. Not changed: `stdout_to_path` (`apple.ts:306`). The review mentions
     it as having "the same shape", but the brief lists only the two lines, and upstream there is `OsString::from_vec`, which is not a lossy
     decode. **For root:** decide whether `stdout_to_path` also wants `ignoreBOM`. A path that starts with U+FEFF is the only case it would
     change.
   - N3 (`665f42b7`): `apple/tests.test.ts` `lookup_sdk` calls `xcode_select_developer_dir()` unconditionally, as upstream does, inside an
     `if (developer_dir !== undefined)` block. Only the `SDKROOT`-gated `assert!` is left out, with a `PORT:` note (the test may not read
     `SDKROOT`). In `object/write/util.test.ts`, the header and a comment above the LEB128 test now label it as rust-ts's own. It stays in
     place, after the ported `bytes_mut`.
5. **done**.
   - N2 (`2d0942df`):
     - `ArchiveBuilderBuilder` (`back/archive.ts`) gains an optional `create_dll_import_lib?(sess, lib_name, items, output_path)`, documented as an
       implementor's override of the provided method.
     - `raw_dylib.ts` `create_raw_dylib_dll_import_libs` calls the builder's override when it has one, else
       `ArchiveBuilderBuilder_provided.create_dll_import_lib(builder, ...)`.
     - `rustc_interface/util.ts`'s `DummyArchiveBuilderBuilder` has a port of upstream's override,
       `// rustc: compiler/rustc_interface/src/util.rs:499 create_dll_import_lib`:
       `ArArchiveBuilderBuilder.new_archive_builder(sess).build(output_path, undefined)`.
     - Both stale comments are corrected: util.ts's "only `link_natively` reaches it", and raw_dylib.ts's header lines 4-6.
     - A new `raw_dylib.test.ts` case (x86_64-pc-windows-msvc, one raw-dylib import) checks that the override is called with the library
       name, the item names and the output path. Mutation: with dispatch forced to the provided method, the case fails. Reverted.
     - **What it changes:** a dummy-backend compile that reaches `link_rlib` on a Windows target with `#[link(kind = "raw-dylib")]` imports
       now writes an empty archive at the import library's path, as upstream does. Before, it stopped:
       - on MSVC, at `unported("ar_archive_writer::write_import_library ...")`;
       - on windows-gnu, at `create_mingw_dll_import_lib`'s `unported`.
     - Who sees it: the dummy backend is Miri's codegen backend (`miri.ts`). No protected case targets Windows (all suites run the host,
       `aarch64-apple-darwin`). Every other `ArchiveBuilderBuilder` (`ArArchiveBuilderBuilder`, the stand-in's and the port's
       `LlvmArchiveBuilderBuilder`) has no override, so for them nothing changes.
   - N6: **already fixed, no change needed.** The vendor-object-write merge (`11845187`) removed apple.ts's "(not ported)" comments at the old
     lines 68-69 and 104 (and the header's). No stale "reached only from" comment is left in `apple.ts`.
   - The `Object_set_subsections_via_symbols` doc in `link.ts`: **already fixed.** It now reads "`file.set_subsections_via_symbols()` (object
     0.39.1 write/mod.rs:307)" and calls the ported method. No `debug_assert!` claim is left.
6. **done**.
   - Note 1 (`5f3f860e`): the `simd_stop.rs` test is in `src/rustc_codegen_llvm/simd_intrinsic.test.ts`, not `intrinsic.test.ts`, so there is no
     overlap with cg-intrinsic-b. It now asserts `expect(r.stderr).toBe("rust-ts: unported: cg-intrinsic-b: ... simd_fsqrt\n")`. The test passes,
     6/6.
   - Note 2 (`67dbe773`): when the table differs, `gen_intrinsics_x86.ts --check` writes one `ERROR: intrinsics_x86.ts differs from what
     gen_intrinsics_x86.ts writes` line through `std/io.ts` `write_stderr` and sets `process.exitCode = 1`, with no throw. On this tree:
     exit 0, no output. Mutation (an extra newline appended to `intrinsics_x86.ts`, then restored byte for byte): the one `ERROR:` line, exit 1,
     no stack.
7. **done**.
   - Note 1 (`5a67fe6e`):
     - `src/rust_ts/oracle_sysroot_env.ts` now holds the whole spawn: `oracle_toolchain()` reads `UPSTREAM.json`, and
       `spawn_print_sysroot(toolchain)` runs `rustc +<toolchain> --print sysroot` with `oracle_sysroot_env()`, `stdin: "ignore"` and both
       streams piped. It returns the exit code and the decoded stdout/stderr, with stdout untrimmed.
     - `default_sysroot` and `oracle_sysroot` both call it. Each keeps its own error handling: `default_sysroot` catches the spawn's throw and
       stops with `unported`, and `oracle_sysroot` panics on a non-zero exit. Each also keeps its own reading of stdout: `default_sysroot`
       removes the final `\n`, `oracle_sysroot` uses `.trim()`. I kept both because `trim` also strips leading or trailing whitespace, so the
       two would part on a path that starts or ends in a space. A comment in tools.ts says so.
     - **stdin:** the recheck says `oracle_sysroot` "inherits stdin". In fact Bun's `spawnSync` default is `/dev/null`: a child's fd 0 was
       the null device even with a pipe on the parent's stdin. So making `"ignore"` explicit changes nothing for tools.ts.
     - **Values checked against `2bf7435a`:** `default_sysroot()` and `oracle_sysroot()` give identical results in four situations:
       - success, giving the same path;
       - `rustc` missing from `PATH` (`env -i`), giving the same `Unported` text and the same thrown `Error`;
       - a fake `rustc` that exits 1, giving the same `Unported` and `Panic` texts;
       - a fake `rustc` that prints `"  /odd path \n"`, where the newline-strip and `trim` results are the same as before.
     - `filesearch.ts` lost its now-unused `readFileSync`/`join` imports and its `REPO`. `config_sysroot.test.ts` passes, 3/3.
     - In tools.ts, only `oracle_sysroot`'s body and its import line changed, as the brief's exception for ir-fix-b's directory allows.
   - Note 2 (`8b10c49f`): `driver.oracle.test.ts` compares the linked executables with a local `compare_bytes(name, got, want)`, which returns
     `"equal"` or `"<out>: port N bytes, oracle M bytes, first difference at offset K"`, and the test asserts `toBe("equal")`. Mutation (byte
     100 of the oracle's buffer flipped): `Received: "x: port 467936 bytes, oracle 467936 bytes, first difference at offset 100"`. Reverted.
     Both cases pass, with 4 expects each.

## Evidence (at `8b10c49f`, AC power, no `GATE_RUNNING`)

- `bunx tsc`: clean, before every commit.
- `bun scripts/coverage.ts --check`: `markers ok (27221, 75 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5392; library 745; llvm 527)`.
- Coverage of the touched upstream files (`--missing`):
  - `rustc_interface/src/util.rs`: 18/21, one more than before (the dummy's `create_dll_import_lib`). Left: `load_backend_from_dylib`,
    `rustc_path`, `get_codegen_sysroot`, as before.
  - `back/link/raw_dylib.rs`: 5/5.
  - `back/archive.rs`: 22/22.
  - `back/apple.rs`: 8/8.
- `bun test ./src/rust_ts/ ./src/rustc_codegen_ssa/ ./src/rustc_codegen_llvm/ ./src/rustc_session/ ./src/rustc_driver_impl/ ./src/rustc_interface/
  ./src/vendor/ ./scripts/lib/unit-steps.test.ts`:
  - with `CI=1`: **1898 pass, 0 fail**, no skips, 210 files (328 s; 1-minute load about 4).
  - without `CI`: **1897 pass, 1 fail** (527 s). The failure is `src/vendor/odht/odht.oracle.test.ts` "build: insert results, len and raw bytes
    match the oracle's odht", which hit Bun's default 5 s test timeout (5087 ms). Bun then kills the probe child, hence `probe failed:` with
    empty stderr and "killed 1 dangling process". Another lane's `ir-host` run had the 1-minute load at 50-60.
    - This lane did not cause it. The file has not changed since `f7e6d8d9`, and it imports none of the files changed here. The probe binary
      (built Oct 15) answers normally when run directly.
    - Alone, it failed 4 times in 6 runs at load 50-57 (5008-6020 ms), passed in the other 2, and passed in the `CI=1` run at load about 4.
    - **For root:** the test has no explicit timeout, and at 3000 operations it sits at the 5 s default on a loaded host. Giving it a timeout
      (as tools.test.ts does with `60_000`) is a one-line fix; `src/vendor/odht/` belongs to no lane in this wave.
- `RUST_TS_AGENT=fixers-59 bun scripts/difftest.ts --sample 200 --jobs 6`:
  - `mono-ui`: **200/200 MATCH**, no DIFF, UNPORTED, CRASH or TIMEOUT. Run `20261115-003538-fixers-59-qut0`.
  - `run-pass-native`: **191/200 MATCH**, 9 UNPORTED, 0 DIFF/CRASH/TIMEOUT. Run `20261115-003658-fixers-59-novd`. **None of the 9 is in
    `harness/baseline/run-pass-native.txt`**: `backtrace/std-backtrace.rs`, `closures/debug-info-for-closure-capture.rs`,
    `codegen/bool-negation-with-debug-info.rs`, `codegen/issue-82833-slice-miscompile.rs`,
    `extern/issue-64655-allow-unwind-when-calling-panic-directly.rs#thin`, `lto/fat-lto.rs`, `move-expr/async-gen-blocks.rs`,
    `simd/issue-85915-simd-ptrs.rs`, `threads-sendsync/spawn-types.rs`.

## `unported(...)` left

None added. Item 5 makes two existing stops (`ar_archive_writer::write_import_library` and `create_mingw_dll_import_lib`) unreachable through the
dummy backend. Both are still reached through `ArArchiveBuilderBuilder` and the LLVM builders.

## `// PORT:` decisions

- `back/archive.ts`: the interface's optional `create_dll_import_lib` stands for an overridable provided trait method. Callers use the
  override when present.
- `rustc_interface/util.ts`: `DummyArchiveBuilderBuilder` overrides through that member. `link_rlib` reaches it on Windows targets.
- `back/apple.ts`: `ignoreBOM`, as `from_utf8_lossy_owned` keeps a leading U+FEFF.
- `back/apple/tests.test.ts`: only the `SDKROOT`-gated assertion of `lookup_sdk` is left out. The `xcode-select` call is kept.
- `rustc_codegen_ssa/base.ts`: the cross-reference to `mono_collection_head` (drift).

## Files touched

`src/rust_ts/codegen_backend.ts`, `src/rust_ts/codegen_backend.test.ts`, `src/rust_ts/llvm/tools.test.ts`, `src/rust_ts/llvm/tools.ts`
(`oracle_sysroot` only), `src/rust_ts/llvm/gen_intrinsics_x86.ts`, `src/rust_ts/oracle_sysroot_env.ts`, `src/vendor/pathdiff/lib.test.ts`,
`src/vendor/object/write/util.test.ts`, `src/rustc_codegen_ssa/base.ts`, `src/rustc_codegen_ssa/back/apple.ts`,
`src/rustc_codegen_ssa/back/apple/tests.test.ts`, `src/rustc_codegen_ssa/back/archive.ts`, `src/rustc_codegen_ssa/back/link/raw_dylib.ts`,
`src/rustc_codegen_ssa/back/link/raw_dylib.test.ts`, `src/rustc_interface/util.ts`, `src/rustc_session/filesearch.ts`,
`src/rustc_codegen_llvm/simd_intrinsic.test.ts`, `src/rustc_driver_impl/driver.oracle.test.ts`, and this file. Nothing under `harness/`,
`scripts/` or `tools/`, and no baseline, oracle output or suite.
