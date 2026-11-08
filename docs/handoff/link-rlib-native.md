# Handoff: link-rlib-native (chained from miri-sysroot, item 2)

**An rlib that bundles native static libraries is byte-identical to the oracle's.** With `-Zcodegen-backend=dummy`, on the
host (`aarch64-apple-darwin`, Mach-O, darwin archives) and on `x86_64-unknown-linux-gnu` (ELF, GNU archives), 59 compilations
were compared with the pinned nightly. All 59 agree on exit, stdout, stderr, the list of files in the out dir, the rlib, the
rmeta and the dep-info. They cover `#[link(kind = "static")]`, `-l static=`, `+bundle`, `-bundle`, `+whole-archive`,
`-Zpacked-bundled-libs`, `#[link(cfg(..))]`, `+verbatim`, the `-L` kinds, a library not found, two libraries with the same
member names, a library named twice, universal (fat), thin, GNU-on-darwin, BSD-on-Linux, empty and corrupt archives, and a
crate using such an rlib through `--extern`.

Branch `t3/2c4f25c1`, on `main` at 5c884ab9. One commit: the port, the test and this file.

## What upstream does (and the port now does)

`link_rlib` (link.rs:545) first calls `find_bundled_library` (:282) for every native library. It returns a file name only for a
bundled static library that is to be **packed**: with `-Zpacked-bundled-libs`, a `cfg`, or `+whole-archive`. Those names go into
the `lib.rmeta-link` record (`native_lib_filenames`). Then, for each static library with `bundle` unset or `+bundle`:

- **packed:** `find_native_static_library(file_name, verbatim = true)`, read the file whole, wrap it in an object file as
  section `.bundled_lib` (`create_wrapper_file`), and add it at the end of the rlib under its own file name (`libfoo.a`);
- **otherwise:** `ArArchiveBuilder::add_archive` (archive.rs:469). It adds every member of the library as an rlib member, in
  order. Members are not renamed or deduplicated: `-l static=foo -l static=baz` with both holding `foo.o` and `bar.o` gives
  `foo.o bar.o foo.o bar.o`. A library already added (the same path) is skipped. On `*-apple-macosx` targets a universal
  file is first narrowed to the target's slice (`try_extract_macho_fat_archive`, :445), which writes that slice to a kept
  temp file in `$TMPDIR`; as that path is new each time, a universal library named twice is added twice (upstream does the
  same; checked). An archive whose format does not suit the target gets the `IncompatibleArchiveFormat` warning.

`find_native_static_library` (:273) walks the `-L` directories of kind `native` or `all`, then `framework` ones (skipped for
static libraries), through `walk_native_lib_search_dirs` (:142). A library not found is the fatal "could not find native
static library", with the "only provide the library name" help for `libfoo.a` without `+verbatim`.

## Results

Compared by a throwaway script (not committed), in a scratch cwd, `RUSTC_ICE=0`, `RUSTUP_AUTO_INSTALL=0`:

    rustc +nightly --emit=dep-info,metadata,link -Zcodegen-backend=dummy --out-dir o <args> <src>
    bun <repo>/src/rust_ts/main.ts --emit=dep-info,metadata,link -Zcodegen-backend=dummy --out-dir s <args> <src>

then `cmp` of exit, stdout, stderr (`o/`, `s/` spelled `X/`), the sorted file names in each out dir, and each file (the
`.d` with the out dir spelled `X/`). "Same" = all equal. Static libraries were built outside the comparison: C compiled by
the host's `clang` (`--target=x86_64-unknown-linux-gnu` for ELF), archived with the host's `ar rcs` (BSD, `__.SYMDEF SORTED`),
the toolchain's `llvm-ar` (`--format=gnu`, `--thin`) and `lipo -create`. `libfoo.a` = `foo.o` (a global, a static fn, a weak
fn) + `bar.o` (an undefined reference); `libbaz.a` = different objects under the same names `foo.o`, `bar.o`.

**Host** (`aarch64-apple-darwin`, `--sysroot <oracle>`, a std crate; `-L .` unless noted). All **same**:

| args | oracle result |
|---|---|
| `#[link(name = "foo", kind = "static")]` | exit 0, members `foo.o bar.o` after `lib.rmeta`, `lib.rmeta-link` |
| `-l static=foo`; `-l static:+bundle=foo` | exit 0, `foo.o bar.o` |
| `-l static:-bundle=foo`; `-l static:-bundle,+whole-archive=foo`; `-l dylib=foo` | exit 0, nothing bundled |
| `-l static:+whole-archive=foo`; `-l static=foo -Zpacked-bundled-libs`; `--crate-type lib` + both | exit 0, packed `libfoo.a` member |
| `-l static=foo -l static=baz` (same member names) | exit 0, `foo.o bar.o foo.o bar.o` |
| the same `-Zpacked-bundled-libs`; `-l static=foo -l static:+whole-archive=baz` | exit 0, packed / mixed |
| `-l static=foo -l static=foo` | exit 0, `foo.o bar.o` once |
| `-l static=nope`; `-l static:+whole-archive=nope` | exit 1, "could not find native static library `nope`" (rmeta and dep-info written) |
| `-l static=libfoo.a` | exit 1, with the "only provide the library name `foo`" help |
| `-l static:+verbatim=libfoo.a` / `-l static:+verbatim=foo` | exit 0 / exit 1 |
| `-L native=.`, `-L all=.`, `-L nonexistent -L .` | exit 0 |
| `-L framework=.`, `-L dependency=.` | exit 1, not found |
| `libbad.a` (text) | exit 1, "failed to add native library ./libbad.a: Unsupported archive identifier" |
| `libfat.a` (x86_64 + arm64); twice | exit 0, the arm64 members; twice: `foo.o bar.o foo.o bar.o` |
| `libthin.a` (`llvm-ar --thin`); `libgnu.a` (`--format=gnu`) | exit 0, members read from disk / from the archive; both warn "was built as GNU format, but the target expects Darwin" |
| `libempty.a` | exit 0, nothing added |
| `#![feature(link_cfg)]`, `#[link(.., cfg(target_os = "macos"))]` foo + plain baz | exit 0, foo packed, baz unpacked |
| `--crate-type rlib --crate-type staticlib` | exit 0, the "dropping unsupported crate type" warning, the rlib bundles |
| a std crate `--target x86_64-apple-darwin` (3 cases) | exit 1 on both: no x86_64-apple-darwin std in the oracle sysroot |

**Other targets** (a `#![no_core]` crate with the three sizedness lang items, `-L .`, no sysroot unless noted). All **same**:

| target | args | oracle result |
|---|---|---|
| x86_64-unknown-linux-gnu | `-l static=foo`, `:-bundle`, `:+whole-archive`, `-Zpacked-bundled-libs`, `foo` + `baz` (and packed), foo twice, `+verbatim=libfoo.a` | exit 0 |
| x86_64-unknown-linux-gnu | `-l static=nope` | exit 1 |
| x86_64-unknown-linux-gnu | `libbsd.a` (host `ar`, BSD) | exit 0, "was built as BSD format, but the target expects GNU" |
| x86_64-unknown-linux-gnu | thin, empty, a member name over 15 bytes (GNU name table), a Mach-O `libfoo.a` | exit 0 |
| x86_64-unknown-linux-gnu | a universal file | exit 1, "Unsupported archive identifier" (no fat extraction off macOS) |
| x86_64-unknown-linux-gnu, `--sysroot <oracle>` | std crate with `#[link]`; plus `-l static=baz --edition 2021` | exit 0 |
| x86_64-apple-darwin | x86_64 `libfoo.a`; universal; universal `-Zpacked-bundled-libs` (packs the whole universal file); an ELF `libfoo.a` | exit 0 |
| aarch64-apple-darwin | universal; ELF `libfoo.a` | exit 0 |

**Consumers** (host, std): a crate using `b` (`-l static=foo`) and `bw` (`+whole-archive`), both oracle-built rlibs, through
`--extern`; with and without its own `-l static=foo`. Both **same**.

Universal-file runs leave `.tmpXXXXXXlibfat.a` files in `$TMPDIR` on both sides, as upstream does; I deleted the ones these
runs left.

**Tests** (oracle-compared, 0.3 s): `src/rustc_codegen_ssa/back/rlib_native.oracle.test.ts`. Fixtures: three oracle rlibs of a
`#![no_core]` crate (host `-l static=foo -l static=baz`; host `-l static:+whole-archive=foo`; x86_64-unknown-linux-gnu `-l
static=foo -l static=baz`) and the input archives (host `ar`, `lipo`, `llvm-ar`; not the port). `ArArchiveBuilder` rebuilds each
rlib byte for byte from the oracle's `lib.rmeta`/`lib.rmeta-link` and the inputs, through `add_archive` (also with a library
added twice, and with the universal file in place of `libfoo.a`); `create_wrapper_file` rebuilds the `.bundled_lib` member and
the `lib.rmeta-link` record of `libfoo.a`; `try_find_native_static_library` gives the oracle's found / not found for each `-L`
kind and `+verbatim`. A mutation check: disabling the duplicate skip, or the `-apple-macosx` test, fails one test each.

**Regression checks** (`RUST_TS_AGENT=link-rlib-native`, on AC, load 25 to 35):

| suite | sample | result |
|---|---|---|
| check-ui | 40 | 40 MATCH |
| rmeta-ui | 40 | 40 MATCH |
| mono-ui | 40 | 40 MATCH |
| pm-ui | 40 | 40 MATCH |
| miri-sysroot-alloc (report, ELF path) | 1 | MATCH (subject 73 s wall under load 30+, 2,845 MB) |

`bunx tsc --noEmit -p .` passes; `bun scripts/coverage.ts --check`: `markers ok`. Unit tests of `src/rustc_codegen_ssa`,
`src/vendor/object`, `src/vendor/ar_archive_writer`, `src/rustc_session`: 162 pass, 0 fail. The gate was not run (root's).

## Files

| file | what |
|---|---|
| `src/rustc_codegen_ssa/back/link.ts` | `NativeLibSearchFallback`, `walk_native_lib_search_dirs`, `try_find_native_static_library`, `try_find_native_dynamic_library`, `find_native_static_library`; `find_bundled_library` and the bundling loop of `link_rlib` |
| `src/rustc_codegen_ssa/back/archive.ts` | `target_archive_format_to_object_kind`, `archive_kinds_compatible`, `archive_kind_display_name`, `try_filter_fat_archs`, `try_extract_macho_fat_archive`, `ArArchiveBuilder::add_archive`, `src_archives`, `ArchiveEntrySource::Archive` in `build_inner` |
| `src/vendor/object/read/macho/fat.ts` | new: object 0.39.1 `read/macho/fat.rs` |
| `src/vendor/object/macho.ts` | `FatHeader`, `FatArch32`, `FatArch64`, `FAT_MAGIC*`, `FAT_CIGAM*`, `CPU_TYPE_MIPS` |
| `src/vendor/object/read/macho/mod.ts` | exports `fat.ts` |
| `src/rustc_codegen_ssa/back/rlib_native.oracle.test.ts` | new: the test above |

All are in the lane's area; nothing in `harness/`, `scripts/`, `harness/scope.json` or `PLAN.md` changed.

## Coverage

| upstream file | ported |
|---|---|
| back/link.rs | 15/87 (was 11) |
| back/archive.rs | 12/22 (was 6); the 10 left: Windows import libraries, `extract_bundled_libs`, `create_dylib_metadata_wrapper`, `find_binutils_dlltool`, and the bodiless `ArchiveBuilder`/`ArchiveBuilderBuilder` trait declarations |
| object-0.39.1 read/macho/fat.rs | 16/21; the 5 left are the bodiless `FatArch` trait declarations (`cputype` .. `align`), which the coverage tool counts, as it does `FileHeader`'s |

## `unported(...)` left

None added. The two this lane was for are gone: `find_native_static_library` (in `find_bundled_library`) and `link_rlib
(bundled native library ..)` / `ArArchiveBuilder::add_archive`. Still stopping on paths next to this one:

- `create_raw_dylib_dll_import_libs` in `link_rlib` (Windows targets).
- `ArchiveSymbols` and its `apply_edits` / `collect_internal_names` (`build_inner` with symbols): only `link_staticlib` passes them.
- `link_staticlib`, `link_natively` (linking proper, M7), and `walk_native_lib_search_dirs`'s fallback (ported, but only a
  linker passes one).

Not exercised end to end (no input reaches them): an archive member past the end of the archive ("invalid archive member"),
a member name that is not UTF-8, a universal file with no slice for the target (it then stays as is and fails to parse as an
archive, as on Linux), `IncompatibleArchiveFormat` for `coff`/`aix_big` targets.

## `// PORT:` decisions

- `io::Error::new(kind, err)` of an `object::read::Error` or a `FromUtf8Error` is a `Custom` io error holding the error's
  `Display`, which is all the diagnostics print (`io_error_new` in archive.ts).
- `tempfile::Builder::new().suffix(..).tempfile()?.keep()` is `tempfile_with_suffix`: `.tmp` + 6 random alphanumerics + the
  suffix in `$TMPDIR` (else `os.tmpdir()`), opened `O_EXCL` with mode 0o600, retried on `EEXIST`, never removed. The random
  name differs from tempfile's but only shows in a diagnostic's path.
- `try_filter_fat_archs` / `try_extract_macho_fat_archive` sit before the `ArArchiveBuilder` class, whose body holds both
  `impl` blocks (upstream has them between `new` and the `ArchiveBuilder` impl).
- `src_archives` holds the mapped bytes, not an `Mmap`; dropping them before the rename (for Windows) has nothing to do.
- `Path::exists` is `statSync` succeeding (`path_exists` in link.ts); `ControlFlow` is `rustc_ast_ir/visit.ts`'s.
- `find_bundled_library`: `.file_name().and_then(|s| s.to_str())` is `path_file_name` (paths are strings).
- object `FatArch` is a dictionary (`FatArch32_impl`, `FatArch64_impl`) with `FatArch_provided`, as `FileHeader` is in
  read/elf/file.ts; `Word` is a `number`.

## Proposed report suite: `rlib-native`

Report only, like `host-rlib` (object-write-macho's proposal), on the root host. Each case builds one crate as an rlib with
`--crate-type rlib --emit=dep-info,metadata,link -Zcodegen-backend=dummy -L <fixture dir>` and prints exit, stdout, stderr, the
sorted out-dir file names, dep-info (out dir as `$OUT`) and the rlib and rmeta as `<size> bytes, sha256 <hex>`. The static
libraries are fixtures checked into `harness/corpus/rlib-native/` (built once with the host tools as above, never by the port),
so the oracle cache key covers them. Cases: the host and ELF tables above, minus the three std cases for x86_64-apple-darwin.
The universal-file cases leave temp files in `$TMPDIR` on both sides; the runner should give each case its own `TMPDIR`.

## For root

Nothing blocks. The handoff of object-write-macho's ParseIntError note still stands, unrelated to this lane.
