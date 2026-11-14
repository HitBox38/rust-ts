# Handoff: vendor-object-write (M7b, wave 40r): the `object` writer's symbols and relocations, and apple.rs's users of them

**With this lane, default-sysroot (`e3e5797d`) and ssa-link-b (`330371b2`) merged in scratch, plus a one-line change to
link.ts's `xlane.Object_add_symbol` forwarder (below), the port links hello natively on aarch64-apple-darwin. The binary is
byte-identical to the oracle's, and so are a second program (exit 3) and a `-Cprefer-dynamic` dylib.** Every object rustc
writes through `object` on these paths is byte-identical to the oracle's: `symbols.o` (Mach-O and ELF, bin and dylib) and a
dylib's `rmeta.o` (Mach-O and ELF).

Branch `t3/port-vendor-object-writer`, on `main` at b4826411.

## Files touched

| file | what |
|---|---|
| `src/vendor/object/write/mod.ts` | the rest of write/mod.rs: subsections, `section_flags_mut`, comdats, `symbol_map`, `add_symbol` and the other symbol methods, `section_symbol`, `add_symbol_data`/`_bss`, `set_symbol_data`, relocations (`add_relocation`, `_with_subtractor`, `_internal`, `write_relocation_addend`), `write_stream` (stops), `Section::data`/`data_mut`, `Section.symbol`, `SymbolId`, `Relocation`, `RelocationInternal` (whole) and its `From`, `ComdatId`, `Comdat`, `Mangling::global_prefix`, `Error`'s `Display` |
| `src/vendor/object/write/macho.ts` | `macho_tlv_bootstrap`, `macho_add_thread_var`, `macho_translate_relocation`, `macho_adjust_addend`, `macho_relocation_size`, and `macho_write`'s relocation writing (subtractor, explicit addend, descending order). No `unported` left |
| `src/vendor/object/write/elf/object.ts` | `add_elf_gnu_property_u32`, `elf_subsection_name`, `elf_symbol_flags`, `elf_translate_relocation` (all architectures), `elf_adjust_addend`, `elf_relocation_size`, and `elf_write` whole (relocation sections, comdat groups, symbols). No `unported` left |
| `src/vendor/object/write/elf/writer.ts` | `Sym`, `Rel`, `write_symbol`, `require_symtab_shndx`, `reserve_relocations`, `write_align_relocation`, `write_relocation`, `write_relocation_section_header`, the four comdat methods, `Class::rel_size` |
| `src/vendor/object/write/util.ts` | `WritableBuffer`'s required methods (markers on the interface), `BytesMut::write_at`, `write_uleb128`, `write_sleb128`, `align_u32` |
| `src/vendor/object/write/util.test.ts` | new: upstream's `bytes_mut` test; LEB128 examples (DWARF spec) |
| `src/vendor/object/write/string.test.ts` | marker on the already ported `string_table` test |
| `src/vendor/object/common.ts` | `ComdatKind`, `RelocationKind`, `RelocationEncoding`, `RelocationFlags`, and Debug helpers for the writer's error messages |
| `src/vendor/object/macho.ts` | `Relocation`, `RelocationInfo` (`relocation`), the relocation-type constants the writer and apple.rs use |
| `src/vendor/object/elf.ts` | the 149 constants `elf_translate_relocation`, `elf_relocation_size` and the comdat code use (each with its elf.rs line), the four `r_info` constructors |
| `src/rustc_codegen_ssa/back/apple.ts` | `add_data_and_relocation`, `get_sdk_root`, `xcrun_show_sdk_path`, `xcode_select_developer_dir`: no `unported` left |
| `src/rustc_codegen_ssa/back/apple/tests.test.ts` | upstream's `lookup_developer_dir`, `lookup_sdk`, `lookup_sdk_verbose`, `try_lookup_invalid_sdk` |
| `src/rustc_codegen_ssa/back/metadata.ts` | `create_compressed_metadata_file` (outside the lane's list, see below) |
| `src/rustc_codegen_ssa/back/link_objects.test.ts`, `link_objects_oracle/` | new: oracle fixtures and their hand-run `regen.ts` |

**Outside the lane's file list:** `object/common.ts`, `object/macho.ts` and `object/elf.ts` (the types and constants the
writer needs, as lane object-write-macho did), and `metadata.ts`'s `create_compressed_metadata_file`. The brief asks for the
dylib metadata object to be byte-identical, and that function is what writes it. None of these files is owned by a running
lane. If root prefers, the metadata.ts hunk can move to whoever takes metadata.ts.

## Coverage

`bun scripts/coverage.ts --crate object-0.39.1`, the write rows:

| upstream file | before | now |
|---|---|---|
| write/mod.rs | 36/70 | **70/70** |
| write/macho.rs | 37/37 (5 stopped) | **37/37, none stops** |
| write/elf/object.rs | 6/11 | **11/11** |
| write/elf/writer.rs | 44/149 | 55/149 |
| write/string.rs | 8/9 | **9/9** |
| write/util.rs | 7/29 | 17/29 |
| write/coff, pe.rs, xcoff.rs | 0 | 0 (stops by name) |
| object TOTAL | 600/2862 | 666/2862 |

`--missing` for back/apple.rs: 8/8, with no `unported` left (it had 4). back/apple/tests.rs: 5/5 (was 1/5). back/metadata.rs:
16/16.

util.rs's 12 missing fns are `StreamingBuffer` (over `std::io::Write`) and the provided `write_pod`/`write_pod_slice`/`write`/
`write_slice`. writer.rs's 94 missing are the segment, dynamic-section, hash, GNU version and attributes helpers. The
executable writer for raw-dylib ELF stubs needs them; `Object` does not.

## Evidence

### Byte-for-byte objects

The oracle's objects come from `-Csave-temps` (the link's temporary directory survives) with `-Clinker=true`.
`link_objects_oracle/regen.ts` copies them. `link_objects.test.ts` rebuilds each one with the ported writer: through
`create_object_file`, apple.ts `add_data_and_relocation` and `create_compressed_metadata_file`, plus a step-for-step copy of
link.rs `add_linked_symbol_object`'s non-COFF path (link.ts is ssa-link-b's). All six are equal (6 tests, 0.2 s together):

| object | target | bytes | writer paths |
|---|---|---|---|
| `symbols.o` of hello | aarch64-apple-darwin | 2,784 | 20 undefined symbols (two duplicates), `MH_SUBSECTIONS_VIA_SYMBOLS`, `__DATA,__data` with 20 `ARM64_RELOC_UNSIGNED` relocations written in descending order |
| `symbols.o` of a dylib | aarch64-apple-darwin | 744 | 4 symbols, 4 relocations |
| `symbols.o` of hello | x86_64-unknown-linux-gnu | 1,784 | 20 undefined ELF symbols, no relocations |
| `symbols.o` of a dylib | x86_64-unknown-linux-gnu | 712 | |
| `rmeta.o` of a dylib | aarch64-apple-darwin | 2,712 | `__DATA,.rustc` and a defined `N_SECT|N_EXT` symbol |
| `rmeta.o` of a dylib | x86_64-unknown-linux-gnu | 2,968 | `.rustc` with `sh_flags = 0`, a global `STT_OBJECT` symbol |

There is no symbols-export object on these targets (only MSVC gets a `.drectve` section), and no `__LLVM` object comes from
`object`: on Mach-O, `add_data_and_relocation` writes into `symbols.o`, as above.

Each test was also run against a mutation: with `macho_write`'s descending-order rule switched off, both Mach-O tests fail.

### A real host link

Scratch worktree (removed afterwards): this branch, plus default-sysroot (`e3e5797d`) and ssa-link-b (`330371b2`) as scratch
merges, both clean. One scratch edit was needed: link.ts's forwarder `xlane.Object_add_symbol` still stops `unported`, so it
was made to call `file.add_symbol(symbol)` (see the requests below). `SDKROOT` was not set, so the port's `get_sdk_root` ran
`xcrun`, as the oracle did. Each command ran with `--edition 2024 --crate-type bin --emit=link`, `RUSTC_ICE=0`.

| program | port | oracle | compared |
|---|---|---|---|
| hello (`println!("hello from rust-ts")`) | builds, runs, stdout `hello from rust-ts`, exit 0 | same | stdout and exit equal; **binary byte-identical**; `symbols.o` identical; `--print link-args` identical after normalising temporary dirs |
| hello, without `--sysroot` (default sysroot from e3e5797d) | builds and runs | same | binary byte-identical to the oracle's |
| exit3 (collects 1..=10 into a `Vec`, prints `sum=55`, `process::exit(3)`) | stdout `sum=55`, exit 3 | same | stdout and exit equal; binary and `symbols.o` byte-identical |
| dl.rs as `--crate-type dylib -Cprefer-dynamic` | builds | same | `symbols.o`, `rmeta.o` and the CGU object identical; **`libdl.dylib` byte-identical** when both run in the same cwd |

Notes:
- The dylib embeds the absolute cwd and its install name (`<out-dir>/libdl.dylib`). Two oracle builds in different
  directories differ from each other, so the oracle and the port were run in the same directory, one after the other.
- `--print link-args` differs only when the two runs are given different argv. The port run with `--sysroot <oracle
  sysroot>` lists the sysroot's tools dir twice in `PATH` (explicit and default sysroots are the same path). The oracle does
  the same with the same `--sysroot`. Without `--sysroot` both list it once.

**So nothing in the object writer or apple.rs stops a native hello any more.** The next stop is not here: link.ts's
`Object_add_symbol` forwarder (one line, ssa-link-b's file).

### Paths no oracle fixture covers

The oracle toolchain has no x86_64-apple-darwin std, and rustc never asks for ELF relocations, comdats or Mach-O TLS. These
paths were checked once in scratch by writing objects with the port and reading them back with the pinned toolchain's
`llvm-objdump`/`llvm-readobj` (not committed; a sanity check, not a byte comparison):
- x86_64 Mach-O: `X86_64_RELOC_UNSIGNED` and `X86_64_RELOC_BRANCH`, and a TLS variable. The TLS variable gets a
  `__thread_vars` entry with relocations to `__tlv_bootstrap` and `_tvar$tlv$init`.
- aarch64 Mach-O: a relative data relocation becomes `ARM64_RELOC_SUBTRACTOR` (against `ltmp0`) + `UNSIGNED`, with the
  implicit addend written into the data. `BRANCH26` is there too.
- x86_64 ELF: a COMDAT group, `.rela.text.foo` (`R_X86_64_PLT32`, addend -4), `.rela.data`, and local symbols before global.
- i386 ELF: `.rel.data` with the implicit addend (0x1234) written into the data.

### Regressions

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/vendor/object/ ./src/rustc_codegen_ssa/back/ ./scripts/lib/unit-steps.test.ts`:
  131 pass, 0 fail (3.5 s).
- Added unit-test wall time: about 0.5 s. link_objects 0.2 s, util 0.01 s, the four xcrun tests 0.3 s (cached `xcrun`; a cold
  `xcrun` cache after a reboot can take longer, as upstream's comment warns).
- `--sample 200 --jobs 6`, `RUST_TS_AGENT=vendor-object-write`:
  - rmeta-ui: 200/200 MATCH (run 20261114-141001-vendor-object-write-588h)
  - rmeta-std: 200/200 MATCH (run 20261114-141104-vendor-object-write-510d)
  - check-ui: 200/200 MATCH (run 20261114-141127-vendor-object-write-phyn)
- The new tests read no environment variable. Upstream's `lookup_sdk` reads `SDKROOT` for one assertion; that branch is left
  out, with a PORT note. Nothing under `src/` writes to `process.stdout`/`process.stderr`.

## Every `unported(...)` left

write/mod.ts (by name, as before):
- `coff_section_info`, `coff_section_flags`, `coff_symbol_flags`, `coff_write`, `coff_subsection_name`,
  `coff_translate_relocation`, `coff_relocation_size` (COFF object files).
- `xcoff_section_info`, `xcoff_section_flags`, `xcoff_symbol_flags`, `xcoff_write`, `xcoff_translate_relocation`,
  `xcoff_relocation_size` (XCOFF object files).
- `object::write::Object::write_stream (StreamingBuffer over std::io::Write)`. rustc calls only `write`.

metadata.ts: `create_compressed_metadata_file_for_xcoff` and `create_metadata_file_for_wasm`, as before. The new code reaches
them only for XCOFF and wasm targets.

apple.ts, write/macho.ts, write/elf/object.ts: none.

## `// PORT:` decisions

- **`u64` offsets and sizes are `number`s; `i64` addends are `bigint`s** (`Relocation.addend`, `RelocationInternal.addend`,
  `Rel.r_addend`). `reloc.addend -= reloc.offset as i64` and the pc-relative adjustment wrap with `BigInt.asIntN(64, ..)`. A
  64-bit `r_info` is a `bigint` (elf.ts).
- **`symbol_map: HashMap<Vec<u8>, SymbolId>`** is a `Map` keyed by the name's latin-1 spelling: one char per byte, so the key
  is injective.
- **`&mut SectionFlags` / `&mut SymbolFlags`** (`section_flags_mut`, `symbol_flags_mut`) return the section or symbol that
  holds the field, and the caller writes `.flags`. Nothing in rustc calls either.
- **`Section::data()`** is `data_()`, because the field is `data`, in the same way the earlier lane made `name()` `name_str()`.
- **`stub_symbols`** (`cfg(feature = "coff")`) is kept as a field for the COFF writer. Nothing reads it yet.
- **`BytesMut::write_at`** is `write_at(slice, offset, bytes)`, with the `Pod` value passed as its bytes. Both markers (the
  trait declaration and the `&mut [u8]` impl) sit on it.
- **`macho::Relocation`** holds the two words' values. The writer stores them with the file's endianness (`FieldWriter`),
  like the other `repr(C)` structs.
- **`WritableBuffer::reserve`** still returns nothing (`Result<(), ()>` upstream). `VecBuffer`'s cannot fail.
- **Debug output in error messages** (`unimplemented relocation {:?}`, `unsupported relocation subtractor {:?} for {:?}`)
  comes from hand-written `debug_RelocationInternal`, `debug_Relocation`, `debug_SymbolId` and `debug_RelocationFlags`, which
  follow the derived formats. `Error`'s `Debug` uses `debug_str`.
- **apple.ts**: `Command::new("xcrun")` / `("xcode-select")` is `ProcessCommand` (back/command.ts, D15), and
  `format!("{cmd:?}")` is its `debug()`. `String::from_utf8_lossy_owned` is a non-fatal `TextDecoder`, which applies the same
  replacement rule. `.lines()` is `str_lines`, `.trim()` is `string_trim`, and `to_string_lossy()` of the developer dir is the
  string itself.
- **apple/tests.test.ts**: `cfg_attr(not(target_os = "macos"), ignore)` becomes `test.skipIf(process.platform !== "darwin")`.
  `lookup_sdk`'s `SDKROOT` branch is left out because unit tests may not read that variable.
- **Upstream quirk kept:** `add_data_and_relocation` aligns the section to `target.pointer_width` (64, the width in bits), so
  consecutive Mach-O ld64 entries are 64 bytes apart. The oracle's `symbols.o` shows the same stride.

## Requests for other owners

- **link.ts (ssa-link-b):** make `xlane.Object_add_symbol` call `file.add_symbol(symbol)`. It is the one line between the
  port and a native link. `xlane.Object_set_subsections_via_symbols` can call `file.set_subsections_via_symbols()` now, which
  is ported (write/mod.rs:307). The local `WriteSymbolId` can become `object::write::SymbolId`, exported from write/mod.ts with
  the same brand, so the two already type-check together. Also take the rest of this lane's "unported reached in other files"
  list: apple.rs `add_data_and_relocation` and `get_sdk_root`, and metadata.rs `create_compressed_metadata_file`, all ported
  now.
- **raw_dylib.ts (ssa-link-b):** `ElfStubWriter` still needs writer.rs's dynamic-symbol, GNU-version and `.dynamic` helpers
  (not ported here: `Object` does not use them).
- **root:** a follow-up could build hello natively in a unit test or a suite, once link.ts's forwarder is changed. The scratch
  run above is the evidence until then.
