# Handoff: object-read (wave 11; vendor `object` read subset + `DefaultMetadataLoader`)

`rustc_codegen_ssa::back::metadata::DefaultMetadataLoader` is real. It reads rlibs (the `lib.rmeta`
member of the ar archive, unwrapped from its ELF/Mach-O/Wasm object) and dylibs (the `.rustc`
section) exactly as the oracle does. On every file of the oracle sysroot's
`x86_64-unknown-linux-gnu/lib`, on the host's rlibs, and on oracle-built rlibs for 8 targets, it
returns byte-identical results, error messages included.
The driver's `CodegenBackend::metadata_loader()` now returns it. Nothing calls it yet: crate
loading still stops at `CrateLocator::new` (locator lane).

## Files
New:
- `src/vendor/object/` (object **0.39.1**, the version in Cargo.lock that rustc_codegen_ssa uses, with its features
  `read_core elf macho pe xcoff unaligned archive write wasm`):
  - `endian.ts`, `pod.ts`, `archive.ts`, `elf.ts`, `macho.ts`, `common.ts`: definitions (only the reached structs/consts).
  - `read/mod.ts` (Error, ReadError, FileKind, SectionIndex/SymbolIndex, SymbolSection), `read/read_ref.ts`,
    `read/util.ts` (Bytes, StringTable), `read/traits.ts` (Object/ObjectSection subset), `read/any.ts` (File, Section),
    `read/archive.ts` (all of it: GNU/GNU64/BSD/BSD64/COFF/AIX big, thin, symbol iterator).
  - `read/elf/{mod,file,section,symbol,relocation}.ts`: ElfFile::parse (header, program/section headers, shstrtab,
    symtab/dynsym tables, relocation map), section lookup and data.
  - `read/macho/{mod,file,load_command,segment,section,symbol}.ts`: MachOFile::parse (load commands, segments,
    sections, symtab), section lookup (incl. the `__`/`__zdebug_` name matching) and data.
  - `read/wasm.ts`: WasmFile::parse and sections (see unported below).
  - `lib.ts`, `read/lib.ts`: re-export roots (read/lib.ts is not an upstream file; it avoids import cycles).
  - Tests: `pod.test.ts`, `read/util.test.ts`, `read/archive.test.ts`, `read/macho/load_command.test.ts`
    (the crate's unit tests for ported code; `tests/` needs testfiles that are not in the package, plus unported APIs).
- `src/vendor/wasmparser/` (wasmparser **0.247.0**, object's dependency; Cargo.lock also has 0.257.1 for other tools):
  `binary_reader.ts`, `parser.ts` (Parser::new/parse/parse_reader/parse_all, section dispatch, code entries),
  `readers.ts` (SectionLimited, Subsections, u32/&str FromReader), `readers/core/{custom,linking,code}.ts`,
  `limits.ts`, `lib.ts`.
- `src/rustc_codegen_ssa/back/metadata.ts`: all 16 fns of metadata.rs. The read half is ported; the write half is stubs.
- `src/rustc_data_structures/memmap.ts` (`Mmap::map` via `Bun.mmap(path, {shared:false})`, a small `File` stand-in for
  `std::fs::File`) and `owned_slice.ts` (`OwnedSlice` = `Uint8Array` view; `try_slice_owned`, `slice_owned`, ...).
- `src/rustc_codegen_ssa/back/metadata.oracle.test.ts`: the oracle test (below).
- `tools/probes/objread/` (rustc-dev: the oracle's own `DefaultMetadataLoader`) and `tools/probes/objlist/`
  (plain cargo probe, `object = "=0.39.1"` with rustc_codegen_ssa's features, `lockfile = "upstream"`).

Changed (call site only): `src/rustc_interface/stand_ins.ts` now imports `DefaultMetadataLoader` from
back/metadata.ts. The placeholder object with two `unported` methods is removed.

## Coverage (`bun scripts/coverage.ts --missing ...`, with the scope entries below)
- `compiler/rustc_codegen_ssa/src/back/metadata.rs`: 16/16 (9 are write-half `unported` stubs, M5).
- `rustc_data_structures/src/memmap.rs` 3/12 (MmapMut not needed); `owned_slice.rs` 5/5.
- object-0.39.1 total 417/2862. Per file:
  - read/archive.rs 35/35; read/util.rs 24/25; read/read_ref.rs 8/11 (the rest are ReadCache);
  - read/elf/file.rs 66/104; read/elf/section.rs 60/108; read/elf/symbol.rs 12/73; read/elf/relocation.rs 2/56;
  - read/macho/file.rs 37/76; read/macho/section.rs 44/66; read/macho/segment.rs 28/54; read/macho/load_command.rs 12/27;
    read/macho/symbol.rs 7/53;
  - read/any.rs 18/93; read/wasm.rs 22/79; read/mod.rs 8/34; endian.rs 20/68; pod.rs 6/13; elf.rs 6/31.
  - Not ported: coff/pe/xcoff readers, dyld cache/fat archives, symbol APIs, relocations, comdats, notes,
    version/hash tables, compression, `write`/`build` (M5).
- wasmparser-0.247.0 total 81/2413: binary_reader.rs 35/74, parser.rs 15/33, readers.rs 16/26,
  readers/core/custom.rs 5/7, linking.rs 7/16, code.rs 3/18.

## Tests
- `metadata.oracle.test.ts` (probe-backed; a visible skip without the probes, a failure under `RUST_TS_REQUIRE_PROBES=1`):
  - **objlist**: for every input, the archive kind, every member (name, offset, size), the object format of `lib.rmeta`
    (or of the whole file), the `.rmeta`/`.rustc` section file range and data length match object 0.39.1.
  - **objread**: `get_rlib_metadata` and `get_dylib_metadata` on every input match the oracle's loader: length, first
    64 bytes and an FNV-1a hash of the whole blob, or the exact error message.
  - The rlib blob is a zero-copy view at member offset plus section offset (checked on more than 10 rlibs).
  - Inputs:
    - all 60 files of the oracle sysroot's x86_64-unknown-linux-gnu `lib`: rlibs, rmeta, `libstd-*.so`, and the
      sanitizer `.a` files;
    - the host's rlibs when the host is linux or apple (here aarch64-apple-darwin: Mach-O members, BSD archives);
    - `#![no_core]` rlibs built by the oracle into `$RUST_TS_DATA/cache/objread` for wasm32, x86_64-apple-darwin,
      i686, armv7, aarch64, powerpc, powerpc64 and s390x linux. These cover Wasm, Mach-O, and ELF32/64 in both
      LE and BE;
    - an `--emit=metadata` rmeta, an empty file, a garbage file, two truncated rlibs, a thin archive, and a missing file.
  - Bug the oracle caught: memmap2 **0.2.3** refuses empty files ("memory map must have a non-zero length"), so the port
    does the same.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3633 pass, 1 skip (pre-existing, unrelated), 0 fail.
- `bun scripts/coverage.ts --check`: fails only on the new vendor markers ("names no harness/scope.json vendor crate");
  `markers ok (7412; vendor 3502)` with the two scope entries below (tested on a temporary copy, not committed).
- `--suite parse --sample 200` (run 20261013-150213-object-read-3xb1): 200/200 MATCH.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"object": "=0.39.1"` and `"wasmparser": "=0.247.0"`. Pass the version
   explicitly: Cargo.lock has two wasmparser and two object versions.
2. Gate hosts must build the probes with `bun scripts/probes.ts build objread objlist`. objlist fetches
   `object 0.39.1` (+ wasmparser, indexmap, hashbrown, crc32fast, memchr) from crates.io on first build.
3. Review the `stand_ins.ts` call-site edit.

## unported(...) left
- object, by format (no rust-ts target uses these):
  - PE: `pe::optional_header_magic` (FileKind::parse_at), `PeFile32/64::parse`;
  - COFF: `coff::anon_object_class_id`, `CoffFile/CoffBigFile::parse`;
  - XCOFF: `XcoffFile32/64::parse`.
- wasmparser item readers. A Wasm file that has these items stops here:
  - `RecGroup`, `Imports`, `Table`, `MemoryType`, `Global`, `Export`, `Element`, `Data`, `TagType` (`from_reader`);
  - the linking subsection items `Segment`, `InitFunc`, `Comdat`, `SymbolInfo`;
  - `Name` subsections;
  - component-model sections in `parse_reader`.

  rustc's wasm32 metadata wrapper reaches none of them. A wasm64 wrapper would, because it has a memory import.
- memmap: mapping a non-regular file, and an empty file on Windows.
- metadata.rs:
  - AIX only: `get_metadata_xcoff`'s symbol lookup, and the `ExactlyOneError` message for AIX dylibs;
  - the write half: `add_gnu_property_note`, `create_object_file`, `elf_os_abi`, `elf_e_flags`,
    `macho_object_build_version_for_target` (+`pack_version`), `create_wrapper_file`,
    `create_compressed_metadata_file`, `create_compressed_metadata_file_for_xcoff`,
    `create_metadata_file_for_wasm` (M5).

## PORT decisions (main ones; all are in file headers)
- **Pod/zero-copy.**
  - A `Pod` type is a `Pod<T>` descriptor (`size`, `align`, `read`).
  - `&'data T` is decoded eagerly into a small object whose byte-array fields stay views.
  - `&'data [T]` is a lazy `PodSlice<T>`, so slicing a big symbol table costs nothing.
  - Every type the port reads has alignment 1 (`unaligned` feature).
- **Endian.**
  - `Endianness` is "Little"/"Big"; `LittleEndian`/`BigEndian` are string values.
  - `U16`/`U32` raw bytes are LE-composed numbers, and `U64` is two u32 halves. `get(e)` byte-swaps for big-endian.
  - ELF/Mach-O are instantiated with `Endianness` only, as `File::parse` does.
- **u64 → number**: exact below 2^53. Every consumed u64 is an offset, size or count checked against a buffer length,
  so larger (rounded) values fail the same bounds check. `parse_u64_digits` computes in bigint, so its overflow checks
  are exact.
- **Generic traits as dictionaries.** `FileHeader`, `SectionHeader`, `MachHeader`, `Segment` and `Section` are
  dictionary values (`FileHeader32_impl`, ...) that hold the required methods plus the associated types (Pods,
  sub-dictionaries).
  - Provided methods are `<Trait>_provided` and take the dictionary first.
  - Generic structs (`ElfFile`, `SectionTable`, `SymbolTable`, `MachOFile`, Mach-O `SymbolTable`) keep it in an
    `Elf`/`Mach` field.
  - The reason: a Rust field and a trait method share names (`e_type` field vs `e_type()`), which a TS class cannot do.
- **`File`** is a class with `$`/`_0` (the enum encoding), so it can implement `Object`. `Section` wraps
  `inner: SectionInternal`.
- **wasmparser features.** `component-model` is on and `features` is off. Evidence: the rustc-dev
  `libwasmparser-*.rmeta` contains `ComponentTypeSection` but not `set_features`. This changes no result on the
  reached path.
- **`METADATA_FILENAME`** (`"lib.rmeta"`) is copied into metadata.ts, because rustc_metadata/fs.rs belongs to the
  locator lane.
- **`Mmap::map`** uses `Bun.mmap(path, {shared:false})` (MAP_PRIVATE, read-only, like memmap2's
  `map_copy_read_only`), with `readFileSync` when not running on Bun. The fd is closed after mapping, as Rust drops
  the `File`.
