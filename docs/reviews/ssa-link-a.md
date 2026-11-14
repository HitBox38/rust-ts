# Review: ssa-link-a (wave 40q), `back/link.rs` up to `exec_linker`

**Verdict: APPROVE WITH NITS**

- Subject: branch `t3/ssa-link-a-linker-prep`, commits `055707d3` and `fd4ed1f2`, on main `bcbd0c28`.
- Handoff: `docs/handoff/ssa-link-a.md`.
- Reviewer branch: `t3/ssa-link-a-review`, on `fd4ed1f2`.
- Upstream: `$RUST_TS_DATA/rust/compiler/rustc_codegen_ssa/src/back/link.rs` at the pin (6f5da406b56c).
- Host: AC power, `--jobs 6` at most, and `.data/tmp/GATE_RUNNING` absent throughout.

I found no fidelity defect. Every new or changed function follows upstream's order, logic and names. Each marker sits on the
line directly above its function and names the line of the `fn` keyword. I found no guessed values, and every stop carries a
name. The nits concern three things: what the handoff says a compile reaches, missing tests for `link_staticlib` and the
native-link path, and one panic-on-missing-key idiom.

## 1. Fidelity

I compared every new or changed function with upstream side by side.

- **`link_binary`** (link.ts:339, link.rs:303)
  - `RmetaLinkCache` is now live.
  - The staticlib and natively arms pass the same arguments in upstream's order. Natively gets `path.as_ref()`; staticlib
    gets the `MaybeTempDir`.
  - The rlib's `.build(&out_filename, None)` goes through `xlane.ArchiveBuilder_build(.., undefined)`, which forwards to
    `ab.build(out)`, so the behaviour is unchanged.
  - The stdout branch (`is_tty` → `BinaryOutputToTty`, else `copy_to_stdout` → `CopyPath`, then the push to
    `tempfiles_for_stdout_output`) matches :428-441.
  - The temp dir drops in `finally` after the stdout copy, as `path`'s scope ends at :442.
  - Cleanup order matches :445-488:
    1. the allocator module;
    2. the stdout temp files;
    3. the `should_link` return;
    4. preserve, then each module.
  - The `sess.prof.enabled()` block was already a `// PORT:` skip before this lane, and the lane left it alone.
- **`link_rlib`'s Windows loop** (link.ts:701, link.rs:686) matches. Its fatal is `AddNativeLibrary`.
- **`link_staticlib`** (link.ts:764, link.rs:754)
  - It calls `relevant_lib` for every native library, in order, after `native_lib_filenames`, as the lazy
    `filter`/`filter_map` chain does.
  - Both `FxIndexSet`s are insertion-ordered `Set`s.
  - The skip closure keeps upstream's three tests in order.
  - `extract_bundled_libs` runs before the `Other` adds.
  - Hide and rename support (Elf/MachO, plus Coff for rename), both warnings, the `ArchiveSymbols` fields and the
    dependency-format loop (`OnlyRmetaFound`/`NotFound`) all match :838-902.
  - `print_native_static_libs` runs once per `NativeStaticLibs` print.
- **`link_dwarf_object` / `ThorinSession`** (link.ts:925, link.rs:914)
  - The order of `Single`/`Split` and the rlib sort match upstream. The sort is `path_cmp`, a component-wise `Ord`.
  - `add_executable(.., Skip)` comes next, then the tail stops by name (thorin is not vendored).
  - All four nested-method markers are correct.
- **`is_msvc_link_exe` .. `is_windows_gnu_clang`** (:1032-1053) match. `LinkerFlavor.Msvc("No")` is interned
  (spec/mod.ts:336), so the `===` is sound.
- **`report_linker_output`** (link.ts:1069, link.rs:1061)
  - `for_each` and `has_lnk_code` (the second `:`, `checked_sub(7)`, `LNK` + 4 digits on bytes) match.
  - The four linker branches keep upstream's line filters and their `\r\n`/`\n` terminators.
  - It strips `warning: ` and then `Warning: `, then replaces `: warning: `.
  - `emit_lint_base` gets `LevelSpec.from_StableLevelSpec(..)`, which is upstream's `impl Into<LevelSpec>`
    (rustc_middle lint.rs:116, :388).
- **`link_natively`** (link.ts:1225, link.rs:1232)
  - The AIX `archive_member` is right: `path_with_extension` gives `with_extension("so")`.
  - `link_env`/`link_env_remove`, the `LinkArgs` print and `abort_if_errors` come before the linker runs.
  - The three retry arms (`-no-pie`; `-fuse-ld=lld` only for `Gnu(Yes, Yes)`; `-static-pie` → `-static` with the CRT
    object swap, `mem::take` and both asserts with their messages) match, as does the jobserver drop.
  - The `Ok` failure path builds `LinkingFailed` and stops in the existing `LinkingFailed_into_diag`.
    `STATUS_STACK_BUFFER_OVERRUN` is `0xc0000409 | 0` (i32), and `find_msvc_tools` stops by name.
  - The `Err` path: `NotFound` → `LinkerNotFound`, else `UnableToExeLinker`, the MSVC notes, then `raise_fatal`.
  - The split-debuginfo guards keep upstream's order. On Apple, `dsymutil` goes through `Command::new` (upstream uses
    `super::command::Command`, link.rs:56). `ProcessingDymutilFailed` stops by name.
  - The Apple `rust-objcopy` strip match, the Solaris strip (from `sess.host`), the AIX strip of `temp_filename`, and the
    final archive build of `should_archive` all match.
  - The argument-length handling (`E2BIG`, `command_line_too_big` :2203) sits in `exec_linker`, which is ssa-link-b's.
    link.rs has no SIGILL/SIGSEGV handling at the pin, so the brief's mention of it does not apply here.
- **`strip_with_external_utility`, `escape_string`, both `escape_linker_output` cfgs and `win::*`** match.
  - `escape_ascii` is core's `escape_default`: lowercase `\xNN`, with `\t \r \n \\ \' \"` escaped.
  - `join_paths` gives unix's `:` error text: `JoinPathsError { inner: JoinPathsError }` is std's derived Debug.
- **`add_sanitizer_libraries` / `link_sanitizer_runtime` / `find_sanitizer_runtime`** match :1713-1837.
  - `CFG_RELEASE_CHANNEL = "nightly"` agrees with the oracle sysroot, which ships
    `lib/rustlib/aarch64-apple-darwin/lib/librustc-nightly_rt.{asan,lsan,rtsan,tsan}.dylib`.
- **`linker_and_flavor` / `infer_from` / `adjust_flavor_to_features`** keep the arm order of :1858-1893. The Llbc
  special case and both `infer_from` calls match, and `LinkerFileStem` is fatal.
- **`print_native_static_libs`** (link.ts:1924, link.rs:1987)
  - Kinds are filtered as upstream does, and the consecutive dedup applies only to the native part, as `.dedup()` does
    before the dylib loop.
  - In the Rust-dylib part, `path_parent("foo.so") === ""`, as Rust's `Some("")` is, so `-L ""` matches. The `lib` prefix
    strip is skipped on Windows, and `.dll.lib` is checked on MSVC.
  - `Real` and `Stdout` match.
- **`get_object_file_path`** matches.
- **Stand-in types and the `xlane` table.** I checked them against the sibling branches:
  - `ArchiveSymbols` is identical to ssa-archive's (`t3/port-ssa-archive-symbol-rpath` 45bf7043, archive.ts:274).
  - ssa-archive's `ArchiveBuilder.build(output, symbols?)` makes `ArchiveBuilder_build` a plain forward.
  - `extract_bundled_libs(self, rlib, outdir, names)` matches ssa-archive's archive.ts:175.
  - `Output` matches ssa-linker's (`t3/port-ssa-linker-command` 2c5d3ed6, command.ts:311).
  - ssa-linker's `ExitStatus` class has `code()`/`success()`.
  - `Command`'s methods exist in command.ts with compatible signatures (`args(Iterable<string>)`).
  - `debug_Command(self)` and `disable_localization(cmd)` are exported.
  - `Linker` has `link_dylib_by_name`/`link_staticlib_by_path` with the same parameters (linker.ts:369, :377).
  - Each stand-in lists only what this range calls.

## 2. Reach

- **On the lane's commit alone, neither crate type reaches `link_binary`.** The registered backend stops first with
  `rust-ts: unported: rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (after collect_and_partition_mono_items;
  codegen; M7)`. I tested `bun src/rust_ts/main.ts --edition 2024 --crate-type staticlib -Cpanic=abort` on a `no_core` crate
  with one `#[unsafe(no_mangle)] extern "C" fn`, and the same for bin.rs.
- **In a scratch merge of `fd4ed1f2` with cg-register (`t3/register-llvm-backend` b52d34f6), not committed:**
  - **Staticlib:** `link_binary` → `link_staticlib` → `xlane.ArchiveBuilder_build` (link.ts:884) → `ArArchiveBuilder.build`
    → `write_archive_to_stream` → `get_llvm_object_symbols` (rustc_codegen_llvm/back/archive.ts:37) stops with
    `llir: LLVMRustGetSymbols` (exit 70). The `.o` is a real arm64 Mach-O. Upstream (rustc_codegen_llvm
    src/back/archive.rs:34) also asks LLVM for every member, so the stop is correct and is not this lane's. **No `.a` is
    written, so there is nothing to compare byte-for-byte with the oracle's `libsl.a` (568 bytes).** See N1.
  - **Executable:** it stops cleanly with `rust-ts: unported: ssa-link-b: self_contained_components` (exit 70), on both
    `aarch64-apple-darwin` and `x86_64-unknown-linux-gnu`. No `rustc*` temp dir is left behind.

## 3. The two mono-ui DIFFs

I ran `bun scripts/difftest.ts --suite mono-ui --filter <name> --jobs 2` with `RUST_TS_AGENT=rev-ssa-link-a`, on main
`bcbd0c28` (a scratch worktree) and on `fd4ed1f2`.

| case | main | lane | first difference (same on both) |
|---|---|---|---|
| `callee_is_track_caller_polymorphic` | DIFF | DIFF | line 14: the oracle's `warning: tail calling a function marked with #[track_caller] has no special effect`; the port prints nothing |
| `def-path-hash-ice-157238` | DIFF | DIFF | line 646: the oracle's `INFO rustc_codegen_ssa::base codegen_instance(std::rt::lang_start::<()>)`; the port's `INFO rustc_interface::passes Post-codegen` |

The diff files are byte-identical between the two runs (`cmp`). Neither case is in `harness/baseline/mono-ui.txt`. The lane
did not change either result.

## 4. Evidence

- `bun test src/rustc_codegen_ssa/back/link.test.ts`: 11 pass, 0 fail.
- `bun src/rustc_codegen_ssa/back/link_oracle/regen.ts` (2.5 s) rewrites `oracle.json`, and the result is byte-identical:
  `git status` is clean afterwards. The fixtures are the pinned nightly's own output, from `--print native-static-libs`
  and `--print link-args`.
- Mutations. Each was reverted with `git checkout`, and the tree was clean afterwards.

| mutation | result |
|---|---|
| `infer_from`: `"ld"` → `"lld"` (link.ts, the `Gnu/Darwin/Unix` arm) | 2 fail |
| `adjust_flavor_to_features`: test `disabled` in place of `enabled` | 1 fail |
| `print_native_static_libs`: drop the verbatim `:` | 1 fail |
| `link_staticlib`: `"StaticlibBase"` → `"Normal"` (link.ts:776) | **0 fail** |
| `link_staticlib`: drop the `rmeta_link.FILENAME` skip (link.ts:803) | **0 fail** |
| `link_staticlib`: drop the `print_native_static_libs` call (link.ts:911) | **0 fail** |

## 5. Regressions

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok. `--missing compiler/rustc_codegen_ssa/src/back/link.rs` gives 43/87; the
  first missing function is `exec_linker` :2105.
- `bun test ./src/rustc_codegen_ssa/ ./scripts/lib/unit-steps.test.ts`: 160 pass, 0 fail.
- `bun src/rust_ts/info_sites_check.ts`: every new function is `ok`. `link_natively` has 10/10 sites, `report_linker_output`
  and its nested functions 7/7, `link_staticlib` 1/1.
- `--sample 200 --jobs 6` with `RUST_TS_AGENT=rev-ssa-link-a`:
  - check-ui: 200/200 MATCH (run `rev-ssa-link-a-checkui`).
  - rmeta-ui: 200/200 MATCH (run `rev-ssa-link-a-rmetaui`).
- The new tests read no environment variables (`process.env`/`Bun.env`); `os.tmpdir()` is the common pattern, used in
  42 test files. Nothing new under `src/` writes to `process.stdout`/`process.stderr`.

## Findings

No F findings.

**N1. The handoff overstates what a compile reaches.** The text is at `docs/handoff/ssa-link-a.md:35-40`.
- "With no upstream rlibs ... it completes" does not hold for a real compile.
  - On `fd4ed1f2` the driver stops at `LlvmCodegenBackend::codegen_crate` before linking.
  - Even with cg-register merged, a staticlib stops in archive writing at `llir: LLVMRustGetSymbols`
    (rustc_codegen_llvm/back/archive.ts:37; upstream rustc_codegen_llvm/src/back/archive.rs:34), after
    `link_staticlib` → `ArchiveBuilder::build` (link.ts:884, link.rs:878).
  - No `.a` is produced, so byte-identity with the oracle is unverified.
- "With upstream crates it stops at `ssa-archive: extract_bundled_libs`" holds only when no upstream crate has native
  libraries. Otherwise `xlane.relevant_lib` (link.ts:787, link.rs:786) stops first with `ssa-link-b: relevant_lib`.
- Root should record the reach as: "`link_staticlib` runs to `ArchiveBuilder::build`, then stops at `LLVMRustGetSymbols`
  (needs cg-register merged)".

**N2. No test covers `link_staticlib`, and the native-link path has none either.**
- Three mutations of `link_staticlib` survive: link.ts:776 (`RlibFlavor::StaticlibBase`, link.rs:771), link.ts:803 (the
  rmeta-link skip, link.rs:799) and link.ts:911 (the `print_native_static_libs` call, link.rs:907).
- No test or driver run executes `link_natively` (link.rs:1232), `report_linker_output` with `has_lnk_code` (link.rs:1061,
  :1086), `add_sanitizer_libraries`/`link_sanitizer_runtime` (link.rs:1713, :1787) or `strip_with_external_utility`
  (link.rs:1602).
- I read them line by line and found them faithful. Still, a test that swaps the `xlane` entries (as the
  `print_native_static_libs` test already does for `relevant_lib`) and passes a recording `ArchiveBuilder`/`Linker` would
  pin the archive members, the skip closure, the retry arms and the line filters.
- Linked nit: the test title "escape_string and report_linker_output's line filters" (link.test.ts:302) covers only
  `escape_string`. Rename it, or add the filter cases.

**N3. `crate_info.crate_name.get(cnum)!` and `crate_info.used_crate_source.get(cnum)!` (link.ts:896-897, link.rs:892-893)
do not panic on a missing key, as the `IndexMap`/`UnordMap` index does.**
- They would carry `undefined` into `LinkRlibError` or into `.dylib`.
- The lane added `crate_info_native_libraries` for exactly this idiom (link.ts:916) but did not use it here.
- The same `!` already appears in the pre-existing `each_linked_rlib` (link.ts:538-539), so this follows precedent. It is
  unreachable unless an upstream invariant is already broken.
