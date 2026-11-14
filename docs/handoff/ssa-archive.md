# Handoff: ssa-archive (M7b, wave 40q)

**`back/archive.rs`, `back/symbol_edit.rs` and `back/rpath.rs` are ported in full (22/22, 14/14, 6/6, plus the 4 tests of
`rpath/tests.rs`).** `ArArchiveBuilder` writes the oracle's archive bytes for an rlib and eight staticlib builds on the host
(`aarch64-apple-darwin`, darwin archive kind) and on `x86_64-unknown-linux-gnu` (gnu kind): 18 of 18 byte-identical. That
includes `-Zstaticlib-rename-internal-symbols`, which rewrites the objects' string tables, and (since the review fix)
`-Zstaticlib-hide-internal-symbols` on a crate where hide changes the bytes. `get_rpath_linker_args` gives the oracle's
`-Crpath` linker arguments for both targets.

Branch `t3/port-ssa-archive-symbol-rpath`, on `main` at bcbd0c28. Commit 45bf7043 is the port; the second commit fixes review
`docs/reviews/ssa-archive.md` (commit 4ee54255 on `review/ssa-archive`): F1 (a hide fixture), N1 (pathdiff's unit tests) and
N3 (`ImportLibraryItem` is a class). N2 is root's, at integration (see "For root").

## Files

| File | Change |
|---|---|
| `src/rustc_codegen_ssa/back/archive.ts` | the 10 missing fns: `ImportLibraryItem::into_coff_short_export`, `ArchiveBuilderBuilder` (`new_archive_builder` marker, `ArchiveBuilderBuilder_provided` with `create_dylib_metadata_wrapper`, `create_dll_import_lib`, `extract_bundled_libs`), `create_mingw_dll_import_lib`, `find_binutils_dlltool`, the `ArchiveBuilder` trait markers; `ArchiveSymbols`; `build`/`build_inner` take `symbols` and run `collect_internal_names`/`apply_edits` |
| `src/rustc_codegen_ssa/back/symbol_edit.ts` | new, 14/14 |
| `src/rustc_codegen_ssa/back/rpath.ts` | new, 6/6 |
| `src/rustc_codegen_ssa/back/rpath/tests.test.ts` | new: upstream's 4 tests |
| `src/rustc_codegen_ssa/back/archive_oracle.test.ts` | new: archive bytes and `symbol_edit` against oracle fixtures (0.4 s) |
| `src/rustc_codegen_ssa/back/archive_oracle/{nc.rs,nc_pub.rs,regen.ts,fixtures.json}` | new: the two fixture crates, the by-hand regeneration script, the captured oracle files (137 KB, 29 distinct blobs) |
| `src/rustc_codegen_ssa/back/rpath.oracle.test.ts` | new: `-Crpath` link args against the oracle (2 oracle runs, 0.7 s) |
| `src/vendor/pathdiff/lib.ts`, `lib.test.ts` | new vendor crate: pathdiff 0.2.3 `diff_paths` (rpath calls it), its doc examples and its 6 unit tests (`mod tests`, src/lib.rs:170-251) |
| `src/vendor/object/read/elf/symbol.ts` | `Sym_provided.name`, `Sym_provided.is_undefined`; exports `SymValue` |
| `src/vendor/object/read/macho/symbol.ts` | `Nlist_provided.name`, `is_stab`, `is_undefined`; exports `NlistValue` |
| `src/vendor/object/elf.ts` | constants `STB_GLOBAL`, `STB_WEAK`, `STV_HIDDEN` |
| `src/vendor/ar_archive_writer/coff.ts` | `MachineTypes` (as `u16` values, as that file already models it) |
| `src/vendor/ar_archive_writer/coff_import_file.ts` | the `COFFShortExport` struct |

## For root

1. **`harness/scope.json` needs `"pathdiff": "=0.2.3"`** in `vendor` (upstream's Cargo.lock version). Until then
   `bun scripts/coverage.ts --check` rejects a `// crate: pathdiff-0.2.3/...` marker, so `src/vendor/pathdiff/lib.ts:31`
   carries the marker as a `// PORT: vendor marker pending` comment. After adding the crate, replace those two comment lines
   with `// crate: pathdiff-0.2.3/src/lib.rs:43 diff_paths`.
2. `ArchiveBuilder::build(output, symbols?)`: `symbols` is optional so that the current `link.ts` (`.build(out_filename_)`,
   link.ts:349) still type-checks. Once ssa-link-a's `link.ts` passes it everywhere (upstream passes `None` explicitly at
   link.rs:373, :1598, :3762), make it required (review N2): optional, tsc would not catch a ported `link_staticlib` that
   drops it, and the `-Zstaticlib-*` flags would be ignored silently.
3. pathdiff's unit tests (`src/vendor/pathdiff/lib.test.ts`) name their upstream lines as `// crate pathdiff-0.2.3/...`
   comments for the same reason as item 1; they become `// crate: ...` markers with it.

## Exports for link.rs (ssa-link-a; link-b for raw_dylib.rs)

From `back/archive.ts`:
- `ArchiveBuilderBuilder` (interface: `new_archive_builder`), and **`ArchiveBuilderBuilder_provided`** for the provided methods
  (PORTING section 8, `self` first): `create_dylib_metadata_wrapper(abb, sess, metadata, symbol_name)` (link.rs:2688),
  `extract_bundled_libs(abb, rlib, outdir, bundled_lib_file_names: ReadonlySet<Symbol>): Result<null, ExtractBundledLibsError>`
  (link.rs:819, :3383), `create_dll_import_lib(abb, sess, lib_name, items, output_path)` (raw_dylib.rs:101).
- `ArchiveBuilder` (`add_file`, `add_archive`, `build(output, symbols?)`), `ArchiveSymbols` (`{ exported: Set<string>;
  rename_suffix: string | undefined; hide: boolean }`, link.rs:869), `AddArchiveKind`, `ArchiveEntryKind`, `ArArchiveBuilder`,
  `ArArchiveBuilderBuilder`, `ImportLibraryItem` (a class: `new ImportLibraryItem(name, ordinal, symbol_name, is_data)`,
  method `into_coff_short_export(sess)`),
  `type ExtractBundledLibsError` (re-export, as upstream's `pub use`), `DEFAULT_OBJECT_READER`, `type ObjectReader`,
  `try_extract_macho_fat_archive`, `find_binutils_dlltool`, `tempfile_with_suffix` (already exported).

From `back/rpath.ts`: `RPathConfig` (`{ libs: readonly string[]; out_filename: string; is_like_darwin; linker_is_gnu }`) and
`get_rpath_linker_args(config): string[]` (link.rs:2752-2758; pass the result to `cmd.link_args`).

## `symbol_edit.rs` at the pin

Its only caller is `ArArchiveBuilder::build_inner` (archive.rs:582-669), which runs it when `build` gets
`Some(ArchiveSymbols)`. Only `link_staticlib` passes one (link.rs:834-878), and only under
`-Zstaticlib-hide-internal-symbols` or `-Zstaticlib-rename-internal-symbols` for ELF/Mach-O (rename also for COFF). Tested on
the oracle's own objects (below).

## Evidence

**Archive bytes** (`archive_oracle.test.ts`). The oracle builds `archive_oracle/nc.rs`, a `#![no_core]` crate whose
cross-CGU `a::helper` and `a::A_DATA` give the staticlib global symbols that are not exported, with
`--emit=link -Ccodegen-units=2 -Cpanic=abort -Csave-temps`: an rlib and staticlibs with no flag, `-Zstaticlib-hide-internal-symbols`,
`-Zstaticlib-rename-internal-symbols` and both, for each of the two targets. `-Csave-temps` keeps the archive inputs (the CGU
objects before any edit, `lib.rmeta`, `lib.rmeta-link`). The test adds them with `add_file` in the oracle's member order (`.o`
as `RustObj`, the rest `Other`), calls `build` with the `ArchiveSymbols` that `link_staticlib` builds (exported
`{nc_exported, NC_DATA}`, suffix `.rsc989f9563a4cdd83`), and compares the bytes:

| target | rlib | plain | hide | rename | both | pub-plain | pub-hide | pub-rename | pub-both |
|---|---|---|---|---|---|---|---|---|---|
| aarch64-apple-darwin (darwin) | = | = | = | = | = | = | = | = | = |
| x86_64-unknown-linux-gnu (gnu) | = | = | = | = | = | = | = | = | = |

On nc.rs, hide gives the same bytes as plain, for the oracle and the port alike: the internal globals are already hidden
(`STV_HIDDEN`) or private extern (`N_PEXT`), so the patch rewrites the same byte. That left hide unguarded (review F1: a hide
that writes nothing passed). The `pub-*` builds fix that, from the reviewer's crate: `archive_oracle/nc_pub.rs` is nc.rs
plus an unused `#[inline(never)] pub fn root_pub` and `pub static ROOT_DATA`, built with `--crate-type staticlib --crate-type
rlib -Cembed-bitcode=no` and the same four flag sets. The rlib crate type keeps both items global with default visibility,
outside the StaticLib export set, so the oracle's hide archive differs from plain in 2 bytes per target (ELF `st_other`
0 -> 2, Mach-O `n_type` 0x0f -> 0x1f), and both differs from rename. The test asserts those differences as well as port =
oracle. (`-Cembed-bitcode=no` only keeps the embedded bitcode out of the objects, ELF's `.llvmbc` section and Mach-O's
`__LLVM,__bitcode`, to keep the fixture small.)

**Mutation check (review F1)**, each applied to `symbol_edit.ts` and reverted (file byte-identical afterwards):

| mutant | before the fix | now |
|---|---|---|
| M2 Mach-O hide writes `nlist.n_type` without `N_PEXT` (:450) | 0 fail | 2 fail (aarch64 pub-hide, pub-both) |
| M3 ELF hide patch writes the old `sym.st_other` (:270) | 0 fail | 2 fail (x86_64 pub-hide, pub-both) |

Rename changes the bytes (string table rebuilt and appended, `e_shoff` moved on ELF), and the port matches.
`symbol_edit` is also checked directly: `collect_internal_names` on the plain objects finds exactly the two mangled internal
names on both targets (Mach-O's leading `_` stripped), and `apply_edits` with nothing to do returns its input (`Cow::Borrowed`).

**pathdiff**: `src/vendor/pathdiff/lib.test.ts` has the doc examples and the crate's 6 unit tests (review N1; Unix variant
of `test_absolute`; results compared by components, as `PathBuf ==` does, through `path_eq`): 8 pass.

**rpath**: `rpath/tests.test.ts` (upstream's 4 tests) pass. `rpath.oracle.test.ts` builds `fn main() {}` with
`-Crpath -Cprefer-dynamic --print link-args` and a stub linker named `fake-gcc` (the `Gcc` flavor, as with `cc`) for both
targets. The oracle's single `-Wl,-rpath,...` argument equals `-Wl,` + `get_rpath_linker_args(..).join(",")` with the
target's std dylib as the lib: `@loader_path/../..../lib/rustlib/aarch64-apple-darwin/lib` on the host,
`$ORIGIN/.../lib/rustlib/x86_64-unknown-linux-gnu/lib,--enable-new-dtags,-z,origin` for Linux.

**Coverage** (`bun scripts/coverage.ts --missing`): archive.rs 22/22, symbol_edit.rs 14/14, rpath.rs 6/6,
rpath/tests.rs 4/4. `--check`: markers ok.

**Checks**: `bunx tsc --noEmit -p .` clean. `bun test ./src/rustc_codegen_ssa/ ./src/vendor/ar_archive_writer/
./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts ./src/vendor/pathdiff/ ./src/vendor/object/`: 197 pass, 0 fail
(added tests: about 1.1 s). `bun test src/rustc_codegen_llvm/back/`: 14 pass. After the review fix:
`bun test ./src/rustc_codegen_ssa/ ./src/vendor/ar_archive_writer/ ./src/std/result.test.ts ./scripts/lib/unit-steps.test.ts
./src/vendor/pathdiff/`: 200 pass, 0 fail; tsc clean; markers ok.
`difftest --sample 200 --jobs 6`: rmeta-ui 200/200 MATCH (run 20261114-060117-root-106q), check-ui 200/200 MATCH
(run 20261114-060240-root-pnt3).

**Regenerating the fixtures**: `bun src/rustc_codegen_ssa/back/archive_oracle/regen.ts` (by hand, on the root host; it runs
the oracle in a temp dir under `$RUST_TS_DATA/tmp` and rewrites `fixtures.json`). With the `pub-*` builds added, it
reproduced every earlier blob unchanged.

## `unported(...)` left

- `rustc_codegen_ssa::back::archive::create_mingw_dll_import_lib (dlltool: raw-dylib on windows-gnu)`: whole function (it
  writes a `.def` file and runs binutils' `dlltool`; src/ has no `std::process::Command`).
- `ar_archive_writer::write_import_library (COFF import libraries: raw-dylib on Windows targets)`, in `create_dll_import_lib`'s
  non-dlltool branch, after the output file is created (and closed) and the machine is chosen, as upstream orders it.
- `object::read::coff::ImageSymbol::derived_type` (`coff_symbol_kind`), `object::read::coff::CoffHeader::symbols`
  (`coff_collect_impl`), `object::read::coff::CoffHeader::pointer_to_symbol_table` (`coff_edit_impl`, after its
  `assert!(!hide)`): `object`'s COFF reader is not vendored. Not reachable today: `object::File::parse` already stops at
  `unported` for COFF data, so `apply_edits`/`collect_internal_names` never see a `Coff` file (their `Coff`/`CoffBig` arms
  are comments).
- `create_compressed_metadata_file` (metadata.ts, not this lane) is still a stop; `create_dylib_metadata_wrapper` calls it.

## Vendor functions

Ported (small, on the host path): object 0.39.1 `Sym::name` (read/elf/symbol.rs:507), `Sym::is_undefined` (:519),
`Nlist::name` (read/macho/symbol.rs:477), `Nlist::is_stab` (:490), `Nlist::is_undefined` (:495); constants `STB_GLOBAL`,
`STB_WEAK`, `STV_HIDDEN`; ar_archive_writer 0.5.3 `MachineTypes` and `COFFShortExport` (types/values only); pathdiff 0.2.3
`diff_paths` (new crate, see "For root").

Left: ar_archive_writer `write_import_library` (and the rest of coff_import_file.rs) and `mangler.rs`; object's COFF reader.

## `// PORT:` decisions

- archive.ts: `build`'s `symbols` is optional (see "For root"). `OsString`/`PathBuf` are strings; `split_paths` entries are
  decoded lossily. `create_dll_import_lib` closes the file it created before stopping at `write_import_library`.
  `find_binutils_dlltool` is exported for tests; `Path::is_file` is `fs::metadata(..).is_file()`, `false` on error.
- symbol_edit.ts: a symbol's address minus the data's address is the `PodSlice` view's `byteOffset` minus `data`'s plus
  index times entry size (loops walk the slice by index); `mem::offset_of!` values are spelled out as field-size sums
  (`#[repr(C)]` structs of byte-array endian types, no padding); `size_of::<Elf::Word>() == 8` is `is_type_64_sized()`;
  `Cow` is the `Uint8Array` itself (borrowed) or a new one (owned); names sort with `str_cmp` (rustc_session/options.ts,
  byte order); the slice-range panics of `write_u32_at`/`write_u64_at` are spelled out.
- rpath.ts: strings for paths and linker args; `debug!` traces kept as comments; two fns exported for the tests.
- pathdiff: `Component`'s `PartialEq` and `as_os_str` are repeated locally (src/std/path.ts keeps them private); a `Prefix`
  component (Windows only, unchecked) compares by its text, where std compares the parsed prefix.
