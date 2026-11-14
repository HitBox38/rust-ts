# Handoff: ssa-link-a (M7b, wave 40q): `back/link.rs` up to `exec_linker`

Every function of `compiler/rustc_codegen_ssa/src/back/link.rs` before `exec_linker` (:2105) is now in
`src/rustc_codegen_ssa/back/link.ts`, in upstream order, each with its marker. Calls into code that other lanes own go through
one exported stub table, `xlane` (the convention of `rustc_codegen_ssa/mir/mod.ts`). Each stub stops with
`unported("<lane>: <fn>")`, so root can wire it at integration and tests can replace it.

Branch `t3/8973fabc`, on `main` at bcbd0c28.

## Files touched

- `src/rustc_codegen_ssa/back/link.ts`: the port, the stub table, and stand-in interfaces for other lanes' types.
- `src/rustc_codegen_ssa/back/link.test.ts`: 6 new tests (11 in the file). They take about 0.25 s.
- `src/rustc_codegen_ssa/back/link_oracle/`: `nsl.rs` and `bin.rs` (inputs), `oracle.json` (the oracle's output) and
  `regen.ts` (by hand only: `bun src/rustc_codegen_ssa/back/link_oracle/regen.ts`, about 3 s; no test runs it).
- `docs/handoff/ssa-link-a.md` (this file).

## Coverage

`bun scripts/coverage.ts --missing compiler/rustc_codegen_ssa/src/back/link.rs`: **43/87 ported** (was 15/87). Every function
before :2105 is covered: 28 new markers, including the nested `for_each`, `has_lnk_code`, `infer_from`,
`adjust_flavor_to_features`, `find_sanitizer_runtime`, the four `ThorinSession` methods, both `escape_linker_output` cfgs and
`win::{oem_code_page, locale_byte_str_to_string}`. The first missing function is `exec_linker` (:2105), which is ssa-link-b's.
`bun scripts/coverage.ts --check`: markers ok. `bun src/rust_ts/info_sites_check.ts`: every INFO site in the new functions is
live (`tracing.info`/`tracing.warn` with upstream's message).

## Functions that existed and changed

- `link_binary`: now has the `RmetaLinkCache`. It calls `link_staticlib` and `link_natively` where it used to stop with
  `unported`. The stdout branch (`BinaryOutputToTty`, `copy_to_stdout`, `CopyPath`) is ported. The rlib's `.build(out, None)`
  goes through `xlane.ArchiveBuilder_build` (with `None` it forwards to `ab.build(out)`, as before).
- `link_rlib`: the Windows `raw_dylib::create_raw_dylib_dll_import_libs` loop is ported. The call itself is a stub (ssa-link-b).
- `link_rlib`, `preserve_objects_for_their_debuginfo` and `RlibFlavor` are now exported, for the tests.

What a compile now reaches:
- A **staticlib** runs `link_staticlib`. With no upstream rlibs and no `-Zstaticlib-{hide,rename}-internal-symbols` it
  completes. With upstream crates it stops at `ssa-archive: extract_bundled_libs`. With native libraries and
  `--print native-static-libs` it stops at `ssa-link-b: relevant_lib`.
- An **executable or dylib** runs `link_natively`. After `linker_and_flavor`, it stops at
  `ssa-link-b: self_contained_components`.

## Stubs for root's wiring (`xlane` in link.ts)

| entry | upstream | owner |
|---|---|---|
| `exec_linker(sess, cmd, out_filename, flavor, tmpdir)` | link.rs:2105 | ssa-link-b |
| `self_contained_components(sess, crate_type, linker)` | link.rs:2312 | ssa-link-b |
| `linker_with_args(..)` → `[Command, JobserverAcquired[]]` | link.rs:2870 | ssa-link-b |
| `relevant_lib(sess, lib)` | link.rs:3773 | ssa-link-b |
| `create_raw_dylib_dll_import_libs(sess, abb, used_libraries, tmpdir, is_direct_dependency)` | link/raw_dylib.rs:63 | ssa-link-b |
| `disable_localization(cmd)` | linker.rs:39 | ssa-linker |
| `Command_new(program)` | command.rs `Command::new` | ssa-linker |
| `debug_Command(cmd)` (`{cmd:?}`) | command.rs:209 | ssa-linker |
| `Linker_link_args(linker, args)` | linker.rs `generate_arg_methods!` for `dyn Linker` → `link_args` (:214) | ssa-linker |
| `Linker_link_arg(linker, arg)` | same, `link_arg` | ssa-linker |
| `extract_bundled_libs(abb, rlib, outdir, names)` | archive.rs:153 | ssa-archive |
| `ArchiveBuilder_build(ab, output, symbols)` | archive.rs:554 `build(output, symbols)` | ssa-archive (forwards with `None`; `Some` stops) |
| `get_tools_search_paths(sess, self_contained)` | rustc_session/src/session.rs:825 | no lane: `Session::get_tools_search_paths` is not ported |

Stand-in types next to the table, for root to replace with the owners' exports:
- `Command` and `Linker` (ssa-linker). `Linker` lists only the two trait methods this range calls: `link_dylib_by_name` and
  `link_staticlib_by_path`.
- `ArchiveSymbols` (ssa-archive).
- `JobserverAcquired` (`{ drop(): void }`; whatever `linker_with_args` returns).
- `Output` / `ExitStatus` (`std::process`).
- `LinkingFailed` (the fields of `diagnostics::LinkingFailed`).

Also for root:
- `ArchiveBuilder.build` in `archive.ts` takes no `symbols`, and `ArchiveBuilderBuilder` has no `extract_bundled_libs`. Once
  ssa-archive adds them, `ArchiveBuilder_build` becomes `ab.build(output, symbols)`.

## Every `unported(...)` left (besides the stubs)

- `find_msvc_tools::find_vs_version` / `find_tool` (link_natively: an MSVC `link.exe` failure). The crate is not vendored.
- `rustc_codegen_ssa::diagnostics::ProcessingDymutilFailed` (dsymutil failed) and `StrippingDebugInfoFailed` (strip failed).
  The codegen set skips them because of their `ExitStatus` field. Emitting `LinkingFailed` goes through the existing
  `LinkingFailed_into_diag`, which also stops.
- `ThorinErrorWrapper_into_diag` (existing) and `thorin::DwarfPackage::new` / `finish`: the `thorin-dwp` crate is not
  vendored. This is `-Csplit-debuginfo=packed` on non-Apple, non-Windows targets.
- `win::oem_code_page`, `win::locale_byte_str_to_string`, `fix_windows_verbatim_for_gcc` and `env::join_paths`: Windows host
  only.
- Unchanged from before: `ensure_removed`'s io::Error Display, and `warn_if_linked_with_gold` (:4153, ssa-link-b's range).

## `// PORT:` decisions

- `Regex::new(r"(unknown|unrecognized) (command line )?(option|argument)")` is a JS RegExp. The pattern is ASCII
  alternation, and `is_match` ≡ `RegExp.test` (unanchored, no flags). The `regex` crate is not vendored.
- `String::from_utf8_lossy` is `TextDecoder("utf-8", { ignoreBOM: true })`. WHATWG and std both replace each maximal invalid
  subpart with U+FFFD.
- `#[cfg(windows)]` / `#[cfg(not(windows))]` `escape_linker_output` are both ported. The one used is picked by
  `process.platform` (as `desc` is in write.ts). `cfg!(windows)` and `cfg!(solaris|illumos)` in `infer_from` work the same way.
- `option_env!("CFG_RELEASE_CHANNEL")` is `"nightly"` (as in rustc_ast_passes/feature_gate.ts).
- `ThorinSession`'s `TypedArena`s are arrays. `into_sorted_stable_ord()` of the input rlibs sorts by a local `path_cmp`: the
  derived `Ord` of `Component` (variant order, then bytes). Nothing reaches this sort yet, because `DwarfPackage::new` stops
  first.
- Small helpers not in `std/` (`path_with_extension`, `escape_ascii`, `concat_bytes`, `join_paths`) are local to link.ts,
  marked "not upstream". They could move to `src/std/` (not this lane's files).
- `strip_with_external_utility` turns `PATH` into strings with `to_string_lossy` (paths are UTF-8 strings in the port).
- `crate_info.native_libraries[&cnum]` is `crate_info_native_libraries`, which panics on a missing key, like the
  `IndexMap` index.

## Evidence

- `bun test src/rustc_codegen_ssa/back/link.test.ts`: 11 pass.
  - `linker_and_flavor` against the oracle: 16 cases, `aarch64-apple-darwin` (host) and `x86_64-unknown-linux-gnu`, each
    with these options: none, `-Clinker=fake-ld.sh`, `-Clinker=mycc`, `-Clinker=rust-lld`, `-Clinker-flavor=gcc`,
    `-Clinker-flavor=ld`, `-Clinker-features=+lld` and `-Clinker-features=-lld`.
    - **Program:** the port's linker program equals the program in the oracle's `--print link-args`.
    - **cc:** the port's flavor has `Cc::Yes` exactly when the oracle passes `-Wl,` arguments.
    - **cc + lld:** the flavor has `Cc::Yes` and `Lld::Yes` exactly when the oracle passes `-fuse-ld=lld`.
  - `infer_from`'s default linker for each flavor, checked arm by arm against link.rs:1858-1893. Also the second
    `infer_from`, which uses the target's own `linker`.
  - `print_native_static_libs` against the oracle's `note: native-static-libs:` line for nsl.rs, on both targets: Darwin
    gives `-ld.so`, ELF gives `-l:d.so`. This also covers consecutive dedup, `-bundle` static, dylib, verbatim, and link-arg
    being left out. The Rust-dylib arguments are checked against :2031-2066.
  - `preserve_objects_for_their_debuginfo`: the whole decision table (:1958).
  - `link_rlib`'s members, in order, for both flavors, on ELF (:545-685).
  - `escape_string`.
  - The existing `each_linked_rlib` and `ignored_for_lto` tests are unchanged and still pass.
- Mutation check: changing the dedup, or `cc` to `gcc`, fails these tests.
- `bunx tsc --noEmit -p .` is clean.
- `bun test ./src/rustc_codegen_ssa/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts`: 163 pass, 0 fail.
- Sample difftests, `--sample 200 --jobs 6`, `RUST_TS_AGENT=ssa-link-a`:
  - check-ui: 200/200 MATCH.
  - rmeta-ui: 200/200 MATCH.
  - mono-ui: 198/200 MATCH. The 2 DIFFs (`explicit-tail-calls/callee_is_track_caller_polymorphic.rs`, a missing
    track_caller warning; `rustc-env/def-path-hash-ice-157238.rs`, codegen INFO logs) are not in the protected baseline.
    Both diverge before linking.
