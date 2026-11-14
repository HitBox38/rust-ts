APPROVE WITH NITS

Independent review of lane `vendor-object-write` (wave 40r), 2026-11-14. Subject: branch `t3/port-vendor-object-writer`, commits
`11845187`, `71006d1c`, `f5bd5e2e` on main `e80bc814` (`git diff e80bc814 f5bd5e2e`); handoff `docs/handoff/vendor-object-write.md`.
Upstream: object 0.39.1 (`bun scripts/crate-src.ts object --version 0.39.1`, the cargo registry copy; `$RUST_TS_DATA/crate-fetch/object-0.39.1/`
holds only `lib.rs`) and rustc at `6f5da406` under `$RUST_TS_DATA/rust/`. Host: aarch64-apple-darwin, AC power throughout, Bun 1.4.4,
`RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`. No `GATE_RUNNING` marker in the main checkout during the review.

**No must-fix findings.** Every new or changed function matches upstream in order, logic and names, and every marker points at its fn.
Nothing is guessed, and every stop is named. The lane's two claims hold, and I reproduced both:
- the six oracle objects are byte-identical, and `regen.ts` reproduces the fixtures exactly;
- in a scratch merge with default-sysroot (`adfcd33f`) and ssa-link-b (`8bd97318`), plus the one-line forwarder, hello links on the
  host and the binary is byte-identical to the oracle's (same SHA-256). So is the `-Cprefer-dynamic` dylib.

**The paths the lane could only read back with llvm-objdump are now verified byte for byte against upstream's own writer.** A scratch
probe links the oracle sysroot's `object` 0.39.1 (through `librustc_driver`) and runs one op list. A TS twin runs the same list on the
port. The list covers:
- x86_64 and aarch64 Mach-O relocations, TLS `__thread_vars`, common symbols, subtractors and explicit addends;
- ELF REL and RELA on eight architectures, including mips64el's `r_info` swap and big-endian targets;
- comdats, and fifteen error messages.

All 14 objects and all 14 operation logs are identical (Evidence §3). That probe is the only thing that catches four of my six
mutations; the committed tests do not (N2).

## Findings

None of class F.

**N1. apple.ts decodes `xcrun`'s output with a BOM-stripping `TextDecoder`.**
- Where: `src/rustc_codegen_ssa/back/apple.ts:262` and `:278`. Upstream: `apple.rs:250` and `:270`,
  `String::from_utf8_lossy_owned(output.stderr / output.stdout)`.
- `new TextDecoder()` defaults to `ignoreBOM: false`, so it drops a leading U+FEFF. `from_utf8_lossy_owned` keeps it.
- link.ts already has `from_utf8_lossy`, built on `new TextDecoder("utf-8", { ignoreBOM: true })` (`link.ts:2081`, `:2091`). Its doc says
  the same replacement rule this lane's PORT note cites.
- Effect: none in practice, since `xcrun` does not print a BOM. Fix: decode with `{ ignoreBOM: true }`. (`apple.ts:306`, in
  `stdout_to_path`, predates this lane and has the same shape.)

**N2. The committed tests do not cover ELF relocations, comdats, Mach-O TLS, x86_64 Mach-O or explicit addends.**
- Where: `src/rustc_codegen_ssa/back/link_objects.test.ts`. None of its six fixtures has an ELF relocation, a comdat, a TLS variable or a
  non-zero addend: rustc writes none of these through `object` on these targets.
- Effect: mutations M2, M4, M5 and M6 below pass all 131 committed tests. Only the scratch probe catches them.
- The port is right today (Evidence §3). A future edit could break these paths unseen.
- Recommendation for root, not this lane: adopt the probe as `tools/probes/objwrite` plus an `.oracle.test.ts` (a `tools/` change, so
  its own reviewed batch). The probe needs no cargo: `rustc +nightly-2026-10-11 -L <sysroot>/lib/rustlib/aarch64-apple-darwin/lib
  --extern object=<that dir>/libobject-0a888d7f84bd0c24.rmeta` with `extern crate rustc_driver;`, run with `DYLD_LIBRARY_PATH=<sysroot>/lib`.
  - The sysroot's other `object` 0.39.1 (`libobject-19b4bca1dbcf3607.rlib`) is built without `write`.
  - The sources are in `$RUST_TS_DATA/tmp/rev-vow-w40r-objw/` (not committed): `objw.rs`, `cases.txt`, and `objw.ts.txt` (the TS
    twin; point its imports at a checkout's `src/`).

**N3. Two small departures in the ported tests.**
- `src/rustc_codegen_ssa/back/apple/tests.test.ts:35`, upstream `apple/tests.rs:30`. `lookup_sdk` drops upstream's
  `xcode_select_developer_dir()` call along with the `SDKROOT`-gated assertion. Upstream makes the call unconditionally; only the
  `assert!` sits behind `var_os("SDKROOT")`.
  - Keeping the call keeps the test's process behaviour (it runs `xcode-select`) without reading the variable.
- `src/vendor/object/write/util.test.ts:30`. The `LEB128 writers (DWARF spec examples)` test is not in upstream's `mod tests`, but the
  file header says the file is that module's port.
  - The test is useful. Say in the header, or in a comment above the test, that it is the lane's own.

## Evidence

### 1. Fidelity (read against upstream, function by function)

- **write/mod.rs.** `add_subsection` through `subsection_name` (mod.rs:286-325), `section_flags_mut`, the comdat accessors,
  `symbol_id`/`symbol`/`symbol_mut`, `add_symbol`, `add_raw_symbol`, `symbol_flags_mut`, `has_uninitialized_tls`, `has_common`,
  `add_common_symbol`, `add_file_symbol`, `section_symbol` (`ltmp<N>` on Mach-O), `add_symbol_data`/`_bss` (the subsections-via-symbols
  size-1 rule), `set_symbol_data` (`macho_add_thread_var` first), `symbol_section_and_offset`, `add_relocation`, `_with_subtractor`,
  `add_relocation_internal`, `write_relocation_addend`, `write_stream` (named stop), `Section::data`/`data_mut`, `RelocationInternal`'s
  `From`, `Mangling::global_prefix` and `Error`'s `Display`.
  - All are in upstream order.
  - The `Object` and `Section` fields are in declaration order, including `symbol_map`, `stub_symbols` and `Section.symbol`.
  - The implicit-addend rule is upstream's: translate, then adjust, then if implicit and the addend is non-zero, write it into the
    data at 32 or 64 bits with the file's endianness and zero it. Any other size is an error.
- **write/macho.rs.**
  - `macho_tlv_bootstrap`, and `macho_add_thread_var`: `$tlv$init` via `add_raw_symbol`, three pointers, and the two `Absolute`
    relocations at `offset` and `offset + 2*size`.
  - `macho_translate_relocation`, arm for arm, including aarch64's 12/21/26 to 32 widening and the `Relative`+`Generic` subtractor.
    Its `addend -= offset` wraps with `BigInt.asIntN(64, ..)`.
  - `macho_adjust_addend`: the pc-relative offsets 4/5/6/8, and implicit is false only for aarch64 `BRANCH26`/`PAGE21`/`PAGEOFF12`.
  - `macho_relocation_size`: `8 << r_length` as `u8`.
  - The relocation half of `macho_write`: the subtractor entry (`r_extern: true`), then the explicit `ARM64_RELOC_ADDEND` entry, then
    the main entry, where a section symbol takes the section ordinal with `r_extern: false`.
  - The descending-order rule (`need_reverse`: reverse when first.offset < last.offset) is upstream's, line for line.
  - `macho::RelocationInfo::relocation` (macho.rs:3202): both endiannesses, field for field. The 19 relocation constants equal
    macho.rs's.
- **write/elf/object.rs.**
  - `add_elf_gnu_property_u32` and `elf_subsection_name`.
  - `elf_symbol_flags`: the full kind/bind/visibility table, with `Unknown`+defined giving `SymbolFlags::None`.
  - `elf_translate_relocation`: I compared all 26 architecture arms entry by entry, including the wildcard-encoding arms and the arms
    that fix it. `elf_adjust_addend` and `elf_relocation_size` too.
  - `elf_write`:
    - `.rel`/`.rela` names per `elf_has_relocation_addend` (RELA on x86_64, aarch64, mips64...; REL on i386, arm, mips, bpf, sbf...);
    - comdat sections reserved before the data sections, each data section followed by its relocation section's index;
    - locals before globals, and `symtab_num_local` as `sh_info`;
    - comdat headers written first, then each section header followed by its relocation section header (`sh_link` = symtab,
      `sh_info` = target section, `SHF_INFO_LINK`);
    - the comdat header's `sh_info` is the symbol index;
    - the `unsupported COMDAT symbol` and `unimplemented symbol` errors, with upstream's text.
- **write/elf/writer.rs.**
  - `write_symbol`: `SHN_XINDEX` at `SHN_LORESERVE`, `Sym64`/`Sym32` field order, `symtab_shndx`.
  - `require_symtab_shndx`, `reserve_relocations`, `write_align_relocation`.
  - `write_relocation`: `Rela64::r_info` with the mips64el swap, `Rel64`, and `Rel32::r_info` for both 32-bit forms, as upstream.
  - `write_relocation_section_header`, the four comdat methods, and `Class::rel_size` (24/16/12/8).
  - I checked all 234 `export const`s in `object/elf.ts` by script against `elf.rs`: every value matches, and every `// elf.rs:<line>`
    the lane wrote is the right line.
- **write/util.rs.**
  - `BytesMut::write_at` takes both markers (trait and `&mut [u8]` impl). Its two `get_mut` checks become `offset > len` and
    `src.len > len - offset`.
  - `write_uleb128`/`write_sleb128` are line for line (`>>` on a negative `bigint` is arithmetic), and so is `align_u32`.
- **common.rs.** `ComdatKind`, `RelocationKind`, `RelocationEncoding` and `RelocationFlags` have upstream's variants, order and field
  names. The hand-written Debug helpers print what the derives print: §3 compares their output with upstream's on 15 error messages.
- **apple.rs.**
  - `add_data_and_relocation` (apple.rs:81): the arm64e authenticated pointer, the 4/8-byte data, the `unimplemented!` text, the
    16-byte x86_64 alignment, and the pointer-width alignment elsewhere. That is the quirk the handoff keeps: 64 is a width in bits,
    used as a byte alignment, and the oracle's `symbols.o` shows the 64-byte stride. Then the three flag forms and `add_relocation`.
  - `get_sdk_root` (apple.rs:160): the warning on non-empty stderr; on error, the note, the developer-dir arg and note, the
    CommandLineTools help when not `MacOSX`, the `DEVELOPER_DIR`/`SDKROOT` help otherwise, and `None`.
  - `xcrun_show_sdk_path` (apple.rs:224) and `xcode_select_developer_dir` (apple.rs:284) are faithful, apart from the decoder (N1).
  - **The `SDKROOT` check is in link.rs at the pin, not in apple.rs.** `get_apple_sdk_root` reads `env::var("SDKROOT")` at
    link.rs:4012, validates it (:4019-:4054), and falls back to `apple::get_sdk_root(sess)` at link.rs:4060. apple.rs reads `SDKROOT`
    only in its help text (apple.rs:200), and `apple/tests.rs:31-32` reads it in a test. So `get_sdk_root` running `xcrun`
    unconditionally is upstream's behaviour.
- **metadata.rs `create_compressed_metadata_file`** (metadata.rs:567): `METADATA_HEADER` plus a `u64` LE length plus `stub_or_full`. With
  no object file: wasm, else the raw bytes. XCOFF goes to its own function (a named stop). Then the `.rustc` section in the `Data`
  segment, `ReadOnlyData`, with `sh_flags = 0` on ELF only, append at alignment 1, and a `Data`/`Dynamic` symbol at the offset. The
  `write().unwrap()` panic text uses `Error`'s derived Debug.
- **Markers.** `bun scripts/coverage.ts --check`: `markers ok (27158, ... vendor 5389 ...)`.
  - Coverage matches the handoff: write/mod.rs 70/70, macho.rs 37/37, elf/object.rs 11/11, elf/writer.rs 55/149, string.rs 9/9,
    util.rs 17/29, object TOTAL 666/2862.
  - `--missing`: back/apple.rs 8/8, apple/tests.rs 5/5, back/metadata.rs 16/16.
- **Stops.** Every `unported(...)` left in the changed files is named:
  - mod.ts: COFF and XCOFF section info, flags, symbol flags, subsection name, translate, relocation size and write; and `write_stream`;
  - metadata.ts: `create_compressed_metadata_file_for_xcoff` and `create_metadata_file_for_wasm`, which predate this lane.
  - apple.ts, write/macho.ts and write/elf/object.ts have none.

### 2. Committed evidence

- `bun test ./src/rustc_codegen_ssa/back/link_objects.test.ts ./src/rustc_codegen_ssa/back/apple/`: 11 pass, 0 fail (6 objects + 5 apple
  tests; the four xcrun tests ran, not skipped).
- **Fixtures are oracle output.** I copied the six `.o` files aside, ran `RUST_TS_AGENT=rev-vow-w40r bun
  src/rustc_codegen_ssa/back/link_objects_oracle/regen.ts`, and `cmp` found all six identical. `git status` stayed clean, and regen.ts
  removes its own work dir.
- `link_objects.test.ts`'s `symbols_object` is link.rs `add_linked_symbol_object`'s non-COFF path step for step (link.rs:2497-2560:
  `set_subsections_via_symbols`, the `__data` helper section, Text/Data/Tls to SymbolKind, `SymbolScope::Unknown`, `Undefined`).
  The rmeta test takes the packed metadata from the fixture itself, so it tests the wrapper, not the encoder: fair, since rmeta
  bytes are the rmeta suites' job.

### 3. Oracle-side byte comparison of the paths no fixture covers (new)

I ran one op list (`cases.txt`, 14 objects) through upstream's writer and through the port's. Ops: `section_id`, `add_subsection`,
`add_section`, `append_section_data`, `add_symbol`, `add_symbol_data`, `add_symbol_bss`, `add_common_symbol`, `add_file_symbol`,
`section_symbol`, `symbol_id`, `symbol_section_and_offset`, `add_relocation` (Generic, MachO and Elf flags),
`add_relocation_with_subtractor`, `add_comdat`, `add_elf_gnu_property_u32`, `write`. Each op's result went into a log.
**All 14 objects and all 14 logs are byte-identical.** What they cover:
- **x86_64 Mach-O**, with subsections via symbols:
  - `BRANCH` (Relative+X86Branch, PltRelative+Generic/X86Branch), `SIGNED` (Generic, X86RipRelative), `GOT`, `GOT_LOAD`;
  - pc-relative addend adjustment with implicit addends written into `__text`;
  - `UNSIGNED` 64/32/16, an `X86_64_RELOC_SUBTRACTOR` pair, and a section-symbol relocation (`r_extern` 0, ordinal 1);
  - TLS: `__thread_data`, `__thread_bss` and `__thread_vars` with `__tlv_bootstrap` + `$tlv$init`;
  - a common symbol, weak and hidden symbols, and the descending order in three sections.
- **aarch64 Mach-O:**
  - `BRANCH26` with an explicit `ARM64_RELOC_ADDEND` (positive and negative);
  - `Relative`+`Generic` becoming `SUBTRACTOR`(`ltmp1`)+`UNSIGNED`, with the implicit `A - offset` written into the data;
  - raw `ARM64_RELOC_AUTHENTICATED_POINTER` flags, an explicit subtractor, TLS, and a zero-size symbol padded to 1;
  - a section whose relocations are already descending (not reversed).
- **x86_64 ELF:** a file symbol, `.text.foo`/`.data.bar` subsections, a `.note.gnu.property` note, locals interleaved with globals
  (locals first), Label, weak, hidden, TLS, bss and common symbols, a section symbol, `.rela.*` with
  `PLT32`/`PC32`/`GOTPCREL`/`GOT32`/`32S`/`8`/`PC16`/`64`/`NONE`, and a COMDAT group.
- **i386 ELF** (`.rel`, implicit addends, comdat). **mips64el** (Rela64 `r_info` byte swap), **mips64 big-endian**, **mips32
  big-endian** (`.rel` with an implicit 64-bit addend), **arm** (`.rel`), **ppc64 big-endian**, **aarch64 ELF** (`CALL26`,
  `PREL32`), **riscv64**, **PowerPc Mach-O** (32-bit, big-endian `RelocationInfo`), **i386 Mach-O**.
- **Error paths, text identical** (15 messages):
  - `unimplemented relocation {:?}` (Mach-O), `unimplemented ELF relocation {:?}`, `unimplemented reloc size {:?}`;
  - `unimplemented relocation addend {:?}` (i386 `R_386_16`) and `invalid relocation offset 400+64 (max 48)`;
  - `unsupported relocation subtractor SymbolId(3) for Relocation { .. }` on ELF;
  - `unsupported COMDAT symbol \`f\` kind NoDuplicates` and `unimplemented symbol \`absy\` kind Unknown` at write.

Not compared byte for byte: COFF and XCOFF (stops), `symtab_shndx` (it needs 0xff00 sections), and the arm64e authenticated-pointer
path through `add_data_and_relocation` (the oracle has no arm64e std; the raw `MachO` flags it produces are covered above).

### 4. Reach (scratch only; removed; nothing committed)

- I made a detached worktree at `f5bd5e2e`, ran `git merge --no-commit --no-ff adfcd33f 8bd97318` (clean octopus merge), and made one
  edit: link.ts `xlane.Object_add_symbol` returns `file.add_symbol(symbol)`. `bunx tsc --noEmit -p .` was clean on the merge.
- **hello** (`fn main() { println!("hello from rust-ts"); }`): `bun src/rust_ts/main.ts --edition 2024 --crate-type bin --emit=link -o
  port/hello hello.rs`, and the same argv to `rustc +nightly-2026-10-11`, with no `--sysroot` (default-sysroot's default).
  - Both print `hello from rust-ts` and exit 0.
  - **The binaries are byte-identical**: `cmp` is clean, and both SHA-256s are `7f29f90b…455db5e` (472,536 bytes).
- **`dl.rs` as `--crate-type dylib -Cprefer-dynamic`**, built in the same directory one after the other: **`libdl.dylib` is
  byte-identical** (33,432 bytes).
- **Without the one-line edit**, hello stops at `unported: object::write::Object::add_symbol (vendor object: symbols are not ported;
  add_linked_symbol_object)`, as the handoff says. No other stop was reached.
- Aside for ssa-link-b, not this lane: the forwarder `Object_set_subsections_via_symbols`'s doc says upstream is
  `debug_assert!(self.format == MachO)`, but write/mod.rs:307 at the pin is `#[cfg(feature = "macho")] if self.format == MachO { .. }`.
  Upstream's caller only reaches it for Mach-O, so nothing changes. Now that the method is ported, the forwarder can call it, as the
  handoff requests.

### 5. Protected suites (`--sample 200 --jobs 6`, `RUST_TS_AGENT=rev-vow-w40r`)

| suite | result | run |
|---|---|---|
| rmeta-ui | 200/200 MATCH | 20261114-141511-rev-vow-w40r-c3wy |
| rmeta-std | 200/200 MATCH | 20261114-141544-rev-vow-w40r-v41e |
| rmeta-core | 200/200 MATCH | 20261114-141623-rev-vow-w40r-rnj2 |
| check-ui | 200/200 MATCH | 20261114-141831-rev-vow-w40r-m084 |

(The handoff did not report rmeta-core; it is 200/200 here.)

### 6. Mutations (each reverted with `git checkout -- src/`; the tree was clean after each)

Each mutation was run against `link_objects.test.ts` + `src/vendor/object/` (21 tests) and against the §3 probe.

| # | mutation | committed tests | probe |
|---|---|---|---|
| M1 | macho.ts:871 `need_reverse` → `false` (no descending order) | **2 fail** | 3 objects differ |
| M2 | elf.ts:906 `Rela64_r_info` with `r_sym`/`r_type` swapped | 21 pass | 6 differ |
| M3 | macho.ts:897 undefined `n_type` without `N_EXT` | **2 fail** | 4 differ |
| M4 | macho.ts TLV entry 2 pointers instead of 3 | 21 pass | 2 differ |
| M5 | writer.ts comdat header `sh_info: 0` | 21 pass | 2 differ |
| M6 | macho.ts:416 `BRANCH26` addend made implicit | 21 pass | 1 differs |

So the committed tests guard the Mach-O paths rustc uses, and only the probe guards the rest (N2).

### 7. Commands

- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/vendor/object/ ./src/rustc_codegen_ssa/back/ ./scripts/lib/unit-steps.test.ts`: **131 pass, 0
  fail** (24 files, 4.2 s).
- **Environment and output.** The diff adds no `process.env`/`Bun.env` read to any test, and `unit-steps.test.ts`'s env-read scan passes.
  The only new `process.env` reads and `console.log` are in the hand-run `link_objects_oracle/regen.ts`, which no test runs. The other
  seven `*_oracle/regen.ts` scripts do the same. Nothing new writes to `process.stdout`/`process.stderr` under `src/`.
