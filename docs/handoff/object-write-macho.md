# Handoff: object-write-macho (chained from miri-sysroot, item 1)

**A host rlib with metadata only is byte-identical to the oracle's.** On `aarch64-apple-darwin`, `--crate-type rlib
--emit=dep-info,metadata,link -Zcodegen-backend=dummy` gives the same exit, stdout, stderr, dep-info, `.rmeta` and `.rlib`
as the pinned nightly, for a `#![no_core]` crate and for a crate using std. The rlib is a darwin archive (`__.SYMDEF`, then
`lib.rmeta` and `lib.rmeta-link`, both Mach-O 64-bit wrapper objects), and it matches in full: member bytes, archive
header, symbol table.

Branch `t3/3faba041`, on `main` at 26e61959. One commit: the port, the tests and this file.

## What upstream emits for the host

Checked with the oracle first (`ar t`, `file`, `otool -l`):

- `libX.rlib`: a darwin (BSD) archive: `__.SYMDEF` (16 bytes, an empty symbol table: Darwin always gets one), `lib.rmeta`,
  `lib.rmeta-link`. No object files: the dummy backend codegens nothing.
- Both members are `MH_OBJECT` Mach-O 64-bit (arm64, `CPU_SUBTYPE_ARM64_ALL`), four load commands: `LC_SEGMENT_64` with one
  `__DWARF` section (`.rmeta` / `.rmeta-link`, `S_ATTR_DEBUG`), `LC_BUILD_VERSION` (platform 1, minos 11.0, sdk 0, no tools),
  `LC_SYMTAB` and `LC_DYSYMTAB`, both empty.
- `--emit=link` with the default (LLVM) backend needs codegen, which stops `unported` at `codegen_crate` before reaching any
  of this; that is out of scope (D4). `-Zcodegen-backend=dummy` is upstream's own codegen-free rlib path (rustc_interface
  util.rs `DummyCodegenBackend`), and Miri's `MIRI_BE_RUSTC=target` uses the same backend.

## Results

Compared by a throwaway script (not committed), in a scratch cwd with `RUSTC_ICE=0`:

    rustc +nightly --crate-type rlib --emit=dep-info,metadata,link -Zcodegen-backend=dummy --out-dir o "$@" $src
    bun <repo>/src/rust_ts/main.ts --crate-type rlib --emit=dep-info,metadata,link -Zcodegen-backend=dummy --out-dir s "$@" $src

then `cmp` of exit, stdout, stderr, `lib<c>.rmeta`, `lib<c>.rlib`, and of `<c>.d` with `o/` and `s/` both spelled `X/`.
Both run in the same cwd on the same relative path. "6/6" = all six equal.

| crate / setting | result |
|---|---|
| `#![no_core]` crate (`pub fn f() {}` + the three sizedness lang items), host | 6/6 |
| `pub fn g() -> Vec<u8> { vec![1] }` (std), host, `--sysroot <oracle>` | 6/6 |
| no_core, `MACOSX_DEPLOYMENT_TARGET=13.2` | 6/6 (minos 13.2) |
| no_core, `MACOSX_DEPLOYMENT_TARGET=15.1.3` | 6/6 |
| no_core, `MACOSX_DEPLOYMENT_TARGET=10.9` | 6/6 (the "set to 10.9, but the minimum supported by `rustc` is 10.12" warning on both; minos raised to 11.0) |
| no_core, `MACOSX_DEPLOYMENT_TARGET=abc` | **stops**: exit 70, `std::num::ParseIntError Display (IntoDiagArg)` (see below) |
| no_core, `--target x86_64-apple-darwin` | 6/6 |
| 12 `tests/ui` files (`generics/`, `structs/`, `traits/`, every 23rd), host, std, `--edition 2021` | 12/12 agree: 6 build (6/6), 6 are compile errors (exit 1 on both, stdout, stderr, dep-info equal, no rlib on either side) |
| no_core, `--target` `aarch64-apple-ios`, `-ios-sim`, `-ios-macabi`, `-tvos`, `-visionos-sim`, `x86_64-apple-ios`, `arm64_32-apple-watchos`, `armv7k-apple-watchos`, `arm64e-apple-darwin`, `arm64e-apple-ios`, `i686-apple-darwin` | stop before this lane: `rustc_target::spec::targets::<t>` is not ported (only the two macOS target specs are) |

The writer's other branches are covered by the unit test below against oracle bytes for those targets.

**Tests** (oracle-compared, 0.15 s together):

- `src/rustc_codegen_ssa/back/rlib_macho.oracle.test.ts`: fixtures from the oracle for the no_core crate. The whole host rlib
  (2,576 bytes): `create_wrapper_file` rebuilds both members and `write_archive_to_stream(.., "Darwin", ..)` the whole archive.
  And the `lib.rmeta-link` member for x86_64-apple-darwin (CPU type, minos 10.12), arm64_32-apple-watchos (a 32-bit Mach-O,
  `CPU_TYPE_ARM64_32`/`V8`, platform watchOS, minos 5.0, darwin member padding), arm64e-apple-ios (`CPU_SUBTYPE_ARM64E |
  CPU_SUBTYPE_PTRAUTH_ABI`, platform iOS 14.0), aarch64-apple-ios-macabi (platform Mac Catalyst). The session there is a
  stand-in giving each target's `object_architecture` pair; its deployment target is `OSVersion::minimum_deployment_target`,
  as the session's is with no variable set.
- `src/rustc_codegen_ssa/back/apple/tests.test.ts`: upstream's `test_add_version_to_llvm_target`.

**Regression checks** (`RUST_TS_AGENT=object-write-macho`, on AC, load 5 to 15):

| suite | sample | result |
|---|---|---|
| check-ui | 40 | 40 MATCH |
| rmeta-ui | 40 | 40 MATCH |
| mono-ui | 40 | 40 MATCH |
| miri-sysroot-alloc (report, ELF path) | 1 | MATCH (subject 23.9 s, 3,019 MB) |

Unit tests of `src/vendor/object`, `src/vendor/ar_archive_writer`, `src/rustc_codegen_ssa`, `src/rustc_session`,
`src/rustc_target`: 170 pass. `bunx tsc --noEmit -p .` passes; `bun scripts/coverage.ts --check`: `markers ok`. No case of
the last accepted gate run (gate-20261106-224720-root-i68w) printed the old `create_object_file (Mach-O object files)` stop,
so no protected case can change path. **The gate was not run**; that is root's.

## Files

| file | what |
|---|---|
| `src/vendor/object/write/macho.ts` | new: all of write/macho.rs |
| `src/vendor/object/write/mod.ts` | the Mach-O fields of `Object` (`tlv_bootstrap`, `macho_cpu_subtype`, `macho_build_version`, `macho_subsections_via_symbols`), the Mach-O arms of the format dispatches, `Section::segment` |
| `src/vendor/object/write/util.ts` | `align_u64` |
| `src/vendor/object/common.ts` | `AddressSize::bytes` |
| `src/vendor/object/macho.ts` | the constants the writer needs, `cpu_subtype_intel`, `DysymtabCommand`, `BuildVersionCommand` |
| `src/vendor/object/read/macho/symbol.ts` | `MachOSymbolIterator`, `MachOSymbol` (`new`, and `ObjectSymbol` up to `is_local`): ar_archive_writer reads every member's symbols for the darwin symbol table |
| `src/vendor/object/read/any.ts` | `File::symbols` for Mach-O |
| `src/vendor/object/read/mod.ts` | `SymbolSection::index` |
| `src/rustc_codegen_ssa/back/apple.ts` | new: back/apple.rs |
| `src/rustc_codegen_ssa/back/metadata.ts` | the darwin branch of `create_object_file`, `macho_object_build_version_for_target`, `pack_version` |
| `src/rustc_session/session.ts` | `EarlySession::apple_deployment_target` (was a stand-in without a marker), its `Session` forwarder |
| tests | `back/rlib_macho.oracle.test.ts`, `back/apple/tests.test.ts` |

`rustc_session/session.ts`, the read side of `object` and `object/common.ts` are outside the lane's list; each change is what
the host path needed, and small. No `harness/`, `scripts/`, `harness/scope.json` or `PLAN.md` change.

## Coverage

| upstream file | ported |
|---|---|
| object-0.39.1 write/macho.rs | 37/37 markers; 5 of them stop `unported` (below) |
| object-0.39.1 write/mod.rs | 36/70 (was 35) |
| object-0.39.1 write/util.rs | 7/29 (was 6) |
| object-0.39.1 macho.rs | 1/24 |
| object-0.39.1 read/macho/symbol.rs | 20/53 |
| object-0.39.1 read/any.rs | 19/93 |
| object-0.39.1 read/mod.rs | 9/34 |
| object-0.39.1 common.rs | 2/14 |
| back/apple.rs | 8/8; 4 stop `unported` (below) |
| back/apple/tests.rs | 1/5 |
| back/metadata.rs | 16/16 |
| rustc_session session.rs | 85/104 |

## `unported(...)` left

- **Mach-O relocations and TLS symbols** (write/macho.ts): `macho_tlv_bootstrap`, `macho_add_thread_var`,
  `macho_translate_relocation`, `macho_adjust_addend`, `macho_relocation_size`, and `macho_write` on a section with
  relocations. Their callers (`add_symbol`, `set_symbol_data`, `add_relocation`, `write_relocation_addend` in write/mod.rs)
  are not ported, so `Section.relocations` stays empty and no symbol is TLS. The symbol half of `macho_write` is ported in
  full; rustc's wrapper files add no symbols.
- **Linking for Apple targets** (back/apple.ts): `add_data_and_relocation` (needs relocations), `get_sdk_root`,
  `xcrun_show_sdk_path`, `xcode_select_developer_dir` (reached from `link_natively`, not ported). Their upstream tests
  (`lookup_developer_dir`, `lookup_sdk`, `lookup_sdk_verbose`, `try_lookup_invalid_sdk`) are not ported.
- **An invalid deployment target** (`MACOSX_DEPLOYMENT_TARGET=abc`): `apple_deployment_target` emits
  `AppleDeploymentTarget::Invalid` as upstream, and the diagnostic stops at `ParseIntError_into_diag_arg` in
  `rustc_session/diagnostics.ts` (a stand-in, not this lane's file). Fix for root or the session owner: make the stand-in
  type `rustc_abi`'s `ParseIntError` (the kind, which `OSVersion::from_str` already returns) and display it with
  `display_ParseIntError`; then drop the cast in `session.ts`.
- **Other Apple targets**: their `rustc_target::spec::targets::*` files are not ported (only `aarch64_apple_darwin`,
  `x86_64_apple_darwin`).
- Unchanged from miri-sysroot: COFF and XCOFF (`coff_*`, `xcoff_*`, `create_object_file` COFF, `create_wrapper_file` XCOFF),
  `elf_symbol_flags`, `elf_e_flags` arms. No target tested here needs COFF or XCOFF.

## `// PORT:` decisions

- write/macho.ts follows elf/object.ts: `impl Object` methods are functions taking the object, and so are the public setters
  (`set_macho_cpu_subtype(file, ..)`, `set_macho_build_version(file, ..)`): mod.ts must load before it.
- `buffer.write(&pod)` of the `repr(C)` Mach-O structs writes their fields in order (`FieldWriter`); their sizes are the
  `POD.size` of ../macho.ts's structs. `u64`s are `number`s (a wrapper's offsets and sizes stay far below 2^53);
  `MachO32`'s `as u32` truncations are `% 2^32`. `align_u64` uses remainders, as `align` does.
- `section.align.trailing_zeros()` counts halvings of a power of two. `sort_by_key` on the name bytes is a stable
  `Array.prototype.sort` with a byte comparator.
- `buffer.reserve(offset)` cannot fail on `VecBuffer`, so the `Cannot allocate buffer` error is not reachable.
- read side: `MachOFile::symbols` (file.rs:391) is spelled out in `File::symbols` as `MachOSymbolIterator.new(file)`: the
  class's `symbols` field has that name. The `Nlist` trait's field reads are inlined, as ELF's `Sym` reads are.
- `apple_deployment_target`: `version < os_min` and `version.max(min)` use the derived `Ord` of `OSVersion`
  (`cmp_OSVersion`); the `Invalid` arm casts `OSVersion::from_str`'s error kind to the diagnostic's stand-in type (above).
- back/apple.ts `stdout_to_path`: `OsString::from_vec` is read as UTF-8 (paths are strings here). Unused on this path.

## Proposed report suite: `host-rlib`

Report only, `Suite.mode` like the rmeta byte suites: each case compiles one file as a host rlib with
`--crate-type rlib --emit=dep-info,metadata,link -Zcodegen-backend=dummy --sysroot <oracle sysroot>` (std) or with no
sysroot (`#![no_core]` files), and prints exit, stdout, stderr, dep-info (out dir spelled `$OUT`), and the rmeta and rlib
as `<size> bytes, sha256 <hex>`, like `scripts/miri-sysroot-run.ts`. Cases:

1. a `#![no_core]` crate with the sizedness lang items and one fn;
2. a std crate (`Vec`, a generic fn, a trait impl);
3. the same, `MACOSX_DEPLOYMENT_TARGET=13.2`, `15.1.3` and `10.9` (warning);
4. `--target x86_64-apple-darwin` on the no_core crate;
5. the `tests/ui` files that check-ui already matches, compiled this way (the 12 sampled here all agreed).

## For root

1. The ParseIntError stand-in in `rustc_session/diagnostics.ts` (above), if `MACOSX_DEPLOYMENT_TARGET=<garbage>` should
   match.
2. Chained lanes: `object-write-reloc` (write/mod.rs `add_symbol`, `add_relocation*`, `section_symbol`, `set_symbol_data`
   and the five Mach-O methods that stop here; needed by `create_compressed_metadata_file` for dylibs and by
   `add_linked_symbol_object`), and the Apple target specs in `rustc_target` if other Apple targets are wanted.
