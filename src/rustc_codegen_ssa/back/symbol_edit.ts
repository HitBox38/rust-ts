//! Binary-level symbol editing for staticlib post-processing.
//!
//! - **Hide**: sets STV_HIDDEN (ELF) or N_PEXT (Mach-O) on non-exported symbols.
//! - **Rename**: appends a vendor-specific suffix to non-exported symbol names by
//!   rebuilding the string table.
//
// Port of compiler/rustc_codegen_ssa/src/back/symbol_edit.rs (lane ssa-archive). Reached only from `ArArchiveBuilder::
// build_inner` when `link_staticlib` passes `ArchiveSymbols` (`-Zstaticlib-hide-internal-symbols`,
// `-Zstaticlib-rename-internal-symbols`).
//
// PORT:
// - A symbol's address minus the data's address (`sym as *const _ as usize - data.as_ptr() as usize`) is the entry's
//   offset in `data`: the `PodSlice` of entries is a view into `data`'s buffer, so it is the slice's `byteOffset` minus
//   `data`'s plus the entry's index times its size. The loops walk the slice by index to have that index.
// - `mem::offset_of!` of a field of a `#[repr(C)]` struct of `object`'s byte-array endian types (no padding) is the sum
//   of the sizes of the fields before it; the `*_OFFSET` constants below spell those sums out.
// - `mem::size_of::<Elf::Word>() == 8` is `Elf::is_type_64_sized()` (`Word` is `u64` exactly for the 64-bit header).
// - COFF: `object::File::parse` stops at `unported` for COFF data (vendor/object/read/any.ts), so the `Coff`/`CoffBig`
//   arms of `apply_edits`/`collect_internal_names` are never reached; `object`'s COFF reader (`CoffHeader`,
//   `ImageSymbol`) is not ported, and `coff_symbol_kind`, `coff_collect_impl` and `coff_edit_impl` stop by name.
// - `Cow<'a, [u8]>` is the `Uint8Array`: `data` itself when borrowed, a new array when owned.
import { str_cmp } from "../../rustc_session/options.ts";
import type { SymbolExportKind } from "../../rustc_middle/middle/exported_symbols.ts";
import { assert, panic, unported } from "../../std/panic.ts";
import { from_utf8 } from "../../std/str.ts";
import type { Endianness } from "../../vendor/object/endian.ts";
import * as elf from "../../vendor/object/elf.ts";
import * as macho from "../../vendor/object/macho.ts";
import { File } from "../../vendor/object/read/any.ts";
import { FileHeader32_impl, FileHeader64_impl, FileHeader_provided, type FileHeader, type FileHeaderValue } from "../../vendor/object/read/elf/file.ts";
import type { SectionTable } from "../../vendor/object/read/elf/section.ts";
import { Sym_provided, type SymValue } from "../../vendor/object/read/elf/symbol.ts";
import { MachHeader32_impl, MachHeader64_impl, MachHeader_provided, type MachHeader } from "../../vendor/object/read/macho/file.ts";
import { SymtabCommand_symbols } from "../../vendor/object/read/macho/load_command.ts";
import { Nlist_provided, type NlistValue } from "../../vendor/object/read/macho/symbol.ts";
import { SectionIndex } from "../../vendor/object/read/mod.ts";
import { U32 } from "../../vendor/object/endian.ts";

interface Patch {
  offset: number;
  value: number;
}

interface RenameEntry {
  name_field_offset: number;
  name: string;
}

/** `Option<&(FxHashSet<String>, &str)>`: the names to rename and the suffix. */
export type Rename = [Set<string>, string] | undefined;

/** `mem::offset_of!(elf::Sym64<Endianness>, st_other)`: `st_name` (4) + `st_info` (1). */
const SYM64_ST_OTHER_OFFSET = 4 + 1;
/** `mem::offset_of!(elf::Sym32<Endianness>, st_other)`: `st_name`, `st_value`, `st_size` (4 each) + `st_info` (1). */
const SYM32_ST_OTHER_OFFSET = 4 + 4 + 4 + 1;
/** `mem::offset_of!(macho::Nlist64<Endianness>, n_type)` and `Nlist32`'s: `n_strx` (4). */
const NLIST_N_TYPE_OFFSET = 4;
/** `mem::offset_of!(elf::FileHeader64<Endianness>, e_shoff)`: `e_ident` (16), `e_type`, `e_machine` (2 each),
 *  `e_version` (4), `e_entry`, `e_phoff` (8 each). */
const FILE_HEADER64_E_SHOFF_OFFSET = 16 + 2 + 2 + 4 + 8 + 8;
/** `mem::offset_of!(elf::FileHeader32<Endianness>, e_shoff)`: `e_ident` (16), `e_type`, `e_machine` (2 each),
 *  `e_version`, `e_entry`, `e_phoff` (4 each). */
const FILE_HEADER32_E_SHOFF_OFFSET = 16 + 2 + 2 + 4 + 4 + 4;
/** `mem::offset_of!(elf::SectionHeader64<Endianness>, sh_offset)` / `sh_size`: `sh_name`, `sh_type` (4 each), `sh_flags`,
 *  `sh_addr` (8 each), then `sh_offset` (8). */
const SECTION_HEADER64_SH_OFFSET_OFFSET = 4 + 4 + 8 + 8;
const SECTION_HEADER64_SH_SIZE_OFFSET = SECTION_HEADER64_SH_OFFSET_OFFSET + 8;
/** `mem::offset_of!(elf::SectionHeader32<Endianness>, sh_offset)` / `sh_size`: `sh_name`, `sh_type`, `sh_flags`,
 *  `sh_addr` (4 each), then `sh_offset` (4). */
const SECTION_HEADER32_SH_OFFSET_OFFSET = 4 + 4 + 4 + 4;
const SECTION_HEADER32_SH_SIZE_OFFSET = SECTION_HEADER32_SH_OFFSET_OFFSET + 4;
/** `mem::offset_of!(macho::SymtabCommand<Endianness>, stroff)` / `strsize`: `cmd`, `cmdsize`, `symoff`, `nsyms` (4 each). */
const SYMTAB_COMMAND_STROFF_OFFSET = 4 + 4 + 4 + 4;
const SYMTAB_COMMAND_STRSIZE_OFFSET = SYMTAB_COMMAND_STROFF_OFFSET + 4;

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:29 apply_edits
export function apply_edits(data: Uint8Array, exported: ReadonlySet<string>, hide: boolean, rename: Rename): Uint8Array {
  // `object::File::parse(data).ok()`
  const f = File.parse(data);
  let result: Uint8Array | undefined;
  switch (f.$ === "Ok" ? f._0.$ : undefined) {
    case "Elf64":
      result = elf_edit_impl(FileHeader64_impl, data, exported, hide, rename, SYM64_ST_OTHER_OFFSET);
      break;
    case "Elf32":
      result = elf_edit_impl(FileHeader32_impl, data, exported, hide, rename, SYM32_ST_OTHER_OFFSET);
      break;
    case "MachO64":
      result = macho_edit_impl(MachHeader64_impl, data, exported, hide, rename, NLIST_N_TYPE_OFFSET);
      break;
    case "MachO32":
      result = macho_edit_impl(MachHeader32_impl, data, exported, hide, rename, NLIST_N_TYPE_OFFSET);
      break;
    // PORT: `Some(object::File::Coff(f)) => coff_edit_impl(data, f.coff_header(), hide, rename)` and the same for
    // `CoffBig`: not reached (see the header).
    default:
      result = undefined;
  }
  if (result !== undefined) {
    return result;
  } else {
    return data;
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:74 collect_internal_names
export function collect_internal_names(data: Uint8Array, exported: ReadonlySet<string>, out: Set<string>): void {
  const file = File.parse(data);
  if (file.$ === "Err") return;
  switch (file._0.$) {
    case "Elf64":
      elf_collect_impl(FileHeader64_impl, data, exported, out);
      break;
    case "Elf32":
      elf_collect_impl(FileHeader32_impl, data, exported, out);
      break;
    case "MachO64":
      macho_collect_impl(MachHeader64_impl, data, exported, out);
      break;
    case "MachO32":
      macho_collect_impl(MachHeader32_impl, data, exported, out);
      break;
    // PORT: `object::File::Coff(f) => coff_collect_impl(data, f.coff_header(), exported, out)` and the same for
    // `CoffBig`: not reached (see the header).
    default:
      break;
  }
}

/// The `SymbolExportKind` of a COFF symbol, so `#`-prefixed `Arm64EC` text symbols are told
/// apart from data symbols during undecoration.
// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:101 coff_symbol_kind
function coff_symbol_kind(_sym: unknown): SymbolExportKind {
  return unported("object::read::coff::ImageSymbol::derived_type (COFF symbol tables: Windows targets)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:109 elf_collect_impl
function elf_collect_impl(Elf: FileHeader, data: Uint8Array, exported: ReadonlySet<string>, out: Set<string>): void {
  const h = FileHeader_provided.parse(Elf, data);
  if (h.$ === "Err") return;
  const header = h._0;
  const e = FileHeader_provided.endian(Elf, header);
  if (e.$ === "Err") return;
  const endian = e._0;
  const s = FileHeader_provided.sections(Elf, header, endian, data);
  if (s.$ === "Err") return;
  const sections = s._0;
  const st = sections.symbols(endian, data, elf.SHT_SYMTAB);
  if (st.$ === "Err") return;
  const symtab = st._0;
  const strings = symtab.strings();

  for (const sym_ of symtab.iter()) {
    const sym = sym_ as SymValue;
    const binding = sym.st_bind();
    if (binding !== elf.STB_GLOBAL && binding !== elf.STB_WEAK) {
      continue;
    }
    if (Sym_provided.is_undefined(sym, endian)) {
      continue;
    }
    const name_bytes = Sym_provided.name(sym, endian, strings);
    if (name_bytes.$ === "Err") continue;
    const name = from_utf8(name_bytes._0);
    if (name.$ === "Err") continue;
    if (!exported.has(name._0)) {
      out.add(name._0);
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:138 macho_collect_impl
function macho_collect_impl(Mach: MachHeader, data: Uint8Array, exported: ReadonlySet<string>, out: Set<string>): void {
  const h = MachHeader_provided.parse(Mach, data, 0);
  if (h.$ === "Err") return;
  const header = h._0;
  const e = MachHeader_provided.endian(Mach, header);
  if (e.$ === "Err") return;
  const endian = e._0;
  const c = MachHeader_provided.load_commands(Mach, header, endian, data, 0);
  if (c.$ === "Err") return;
  const commands = c._0;

  let symtab_cmd: macho.SymtabCommand;
  for (;;) {
    const cmd = commands.next();
    if (cmd.$ === "Err" || cmd._0 === undefined) return;
    const st = cmd._0.symtab();
    if (st.$ === "Ok" && st._0 !== undefined) {
      symtab_cmd = st._0;
      break;
    }
  }
  const t = SymtabCommand_symbols(symtab_cmd, Mach, endian, data);
  if (t.$ === "Err") return;
  const symtab = t._0;
  const strings = symtab.strings();

  for (const nlist_ of symtab.iter()) {
    const nlist = nlist_ as NlistValue;
    if (Nlist_provided.is_stab(nlist)) {
      continue;
    }
    if (Nlist_provided.is_undefined(nlist)) {
      continue;
    }
    if ((nlist.n_type & macho.N_EXT) === 0) {
      continue;
    }
    const name_bytes = Nlist_provided.name(nlist, endian, strings);
    if (name_bytes.$ === "Err") continue;
    const name_ = from_utf8(name_bytes._0);
    if (name_.$ === "Err") continue;
    const name = name_._0.startsWith("_") ? name_._0.slice(1) : name_._0;
    if (!exported.has(name)) {
      out.add(name);
    }
  }
}

// ---------------------------------------------------------------------------
// ELF: single-pass collection + apply
// ---------------------------------------------------------------------------

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:179 elf_edit_impl
function elf_edit_impl(
  Elf: FileHeader,
  data: Uint8Array,
  exported: ReadonlySet<string>,
  hide: boolean,
  rename: Rename,
  st_other_offset: number,
): Uint8Array | undefined {
  const h = FileHeader_provided.parse(Elf, data);
  if (h.$ === "Err") return undefined;
  const header = h._0;
  const e = FileHeader_provided.endian(Elf, header);
  if (e.$ === "Err") return undefined;
  const endian = e._0;
  const s = FileHeader_provided.sections(Elf, header, endian, data);
  if (s.$ === "Err") return undefined;
  const sections = s._0;
  const st = sections.symbols(endian, data, elf.SHT_SYMTAB);
  if (st.$ === "Err") return undefined;
  const symtab = st._0;
  const data_ptr = data.byteOffset;
  const strings = symtab.strings();

  const patches: Patch[] = [];
  const renames: RenameEntry[] = [];

  const syms = symtab.symbols();
  for (let i = 0; i < syms.length; i++) {
    const sym = syms.at(i) as SymValue;
    const binding = sym.st_bind();
    if (binding !== elf.STB_GLOBAL && binding !== elf.STB_WEAK) {
      continue;
    }
    const name_bytes = Sym_provided.name(sym, endian, strings);
    if (name_bytes.$ === "Err") continue;
    const name_ = from_utf8(name_bytes._0);
    if (name_.$ === "Err") continue;
    const name = name_._0;

    const sym_addr = syms.data.byteOffset + i * syms.pod.size;

    if (hide && !Sym_provided.is_undefined(sym, endian) && !exported.has(name)) {
      const offset = sym_addr - data_ptr + st_other_offset;
      const new_vis = (sym.st_other & ~0x03 & 0xff) | elf.STV_HIDDEN;
      patches.push({ offset, value: new_vis });
    }
    if (rename !== undefined) {
      const [rename_set] = rename;
      if (rename_set.has(name)) {
        renames.push({
          name_field_offset: sym_addr - data_ptr,
          name,
        });
      }
    }
  }

  if (patches.length === 0 && renames.length === 0) {
    return undefined;
  }

  let result: Uint8Array = data.slice();
  for (const p of patches) {
    result[p.offset] = p.value;
  }

  if (renames.length !== 0) {
    const suffix = rename![1];
    const renamed = elf_rebuild_strtab(Elf, result, renames, suffix, sections, header, endian);
    if (renamed !== undefined) {
      result = renamed;
    }
  }

  return result;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:245 elf_rebuild_strtab
function elf_rebuild_strtab(
  Elf: FileHeader,
  data: Uint8Array,
  renames: readonly RenameEntry[],
  suffix: string,
  sections: SectionTable,
  header: FileHeaderValue,
  endian: Endianness,
): Uint8Array | undefined {
  const SH = Elf.SectionHeader;
  let strtab_si_: number | undefined = undefined;
  for (const section of sections.iter()) {
    if (SH.sh_type(section, endian) === elf.SHT_SYMTAB) {
      strtab_si_ = SH.sh_link(section, endian);
      break;
    }
  }
  if (strtab_si_ === undefined) return undefined;
  const strtab_si = strtab_si_;

  const e_shoff = Elf.e_shoff(header, endian);
  const e_shentsize = SH.POD.size;
  const e_shnum = sections.len();

  const strtab_section_ = sections.section(SectionIndex(strtab_si));
  if (strtab_section_.$ === "Err") return undefined;
  const strtab_section = strtab_section_._0;
  const old_strtab_offset = SH.sh_offset(strtab_section, endian);
  const old_strtab_size = SH.sh_size(strtab_section, endian);
  // `data.get(old_strtab_offset..old_strtab_offset + old_strtab_size)?`
  if (old_strtab_offset + old_strtab_size > data.length) return undefined;
  const old_strtab = data.subarray(old_strtab_offset, old_strtab_offset + old_strtab_size);

  const [new_strtab, rename_map] = build_renamed_strtab(old_strtab, renames, suffix);

  const is_64 = Elf.is_type_64_sized();
  const new_strtab_file_off = data.length;
  const new_strtab_size = new_strtab.length;
  const new_e_shoff_raw = new_strtab_file_off + new_strtab_size;
  const new_e_shoff = Math.floor((new_e_shoff_raw + 7) / 8) * 8;
  const padding = new_e_shoff - new_e_shoff_raw;
  const section_headers_size = e_shentsize * e_shnum;

  const result_size = new_e_shoff + section_headers_size;
  // `data.get(e_shoff..e_shoff + section_headers_size)?` (checked before the copies, which have no other effect).
  if (e_shoff + section_headers_size > data.length) return undefined;
  const sh_data = data.subarray(e_shoff, e_shoff + section_headers_size);
  const result = new Uint8Array(result_size);
  result.set(data, 0);
  result.set(new_strtab, data.length);
  // `result.resize(result.len() + padding, 0)`: the new array is zero-filled.
  result.set(sh_data, data.length + new_strtab_size + padding);

  if (is_64) {
    write_u64_at(result, FILE_HEADER64_E_SHOFF_OFFSET, new_e_shoff, endian);
  } else {
    write_u32_at(result, FILE_HEADER32_E_SHOFF_OFFSET, new_e_shoff >>> 0, endian);
  }

  const new_strtab_shdr_offset = new_e_shoff + strtab_si * e_shentsize;

  if (is_64) {
    const sh_offset_field = SECTION_HEADER64_SH_OFFSET_OFFSET;
    const sh_size_field = SECTION_HEADER64_SH_SIZE_OFFSET;
    write_u64_at(result, new_strtab_shdr_offset + sh_offset_field, new_strtab_file_off, endian);
    write_u64_at(result, new_strtab_shdr_offset + sh_size_field, new_strtab_size, endian);
  } else {
    const sh_offset_field = SECTION_HEADER32_SH_OFFSET_OFFSET;
    const sh_size_field = SECTION_HEADER32_SH_SIZE_OFFSET;
    write_u32_at(result, new_strtab_shdr_offset + sh_offset_field, new_strtab_file_off >>> 0, endian);
    write_u32_at(result, new_strtab_shdr_offset + sh_size_field, new_strtab_size >>> 0, endian);
  }

  for (const entry of renames) {
    const new_st_name = rename_map.get(entry.name)!;
    write_u32_at(result, entry.name_field_offset, new_st_name, endian);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Mach-O: single-pass collection + apply
// ---------------------------------------------------------------------------

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:354 macho_edit_impl
function macho_edit_impl(
  Mach: MachHeader,
  data: Uint8Array,
  exported: ReadonlySet<string>,
  hide: boolean,
  rename: Rename,
  n_type_offset: number,
): Uint8Array | undefined {
  const h = MachHeader_provided.parse(Mach, data, 0);
  if (h.$ === "Err") return undefined;
  const header = h._0;
  const e = MachHeader_provided.endian(Mach, header);
  if (e.$ === "Err") return undefined;
  const endian = e._0;
  const c = MachHeader_provided.load_commands(Mach, header, endian, data, 0);
  if (c.$ === "Err") return undefined;
  const commands = c._0;

  let symtab_cmd: macho.SymtabCommand;
  let symtab_cmd_offset: number;
  for (;;) {
    const cmd = commands.next();
    if (cmd.$ === "Err" || cmd._0 === undefined) return undefined;
    const st = cmd._0.symtab();
    if (st.$ === "Ok" && st._0 !== undefined) {
      symtab_cmd = st._0;
      symtab_cmd_offset = cmd._0.raw_data().byteOffset - data.byteOffset;
      break;
    }
  }

  const t = SymtabCommand_symbols(symtab_cmd, Mach, endian, data);
  if (t.$ === "Err") return undefined;
  const symtab = t._0;
  const data_ptr = data.byteOffset;
  const strings = symtab.strings();

  const patches: Patch[] = [];
  const renames: RenameEntry[] = [];

  const nlists = symtab.symbols;
  for (let i = 0; i < nlists.length; i++) {
    const nlist = nlists.at(i) as NlistValue;
    if (Nlist_provided.is_stab(nlist)) {
      continue;
    }
    if ((nlist.n_type & macho.N_EXT) === 0) {
      continue;
    }
    const name_bytes = Nlist_provided.name(nlist, endian, strings);
    if (name_bytes.$ === "Err") continue;
    const raw_name_ = from_utf8(name_bytes._0);
    if (raw_name_.$ === "Err") continue;
    const raw_name = raw_name_._0;
    const name = raw_name.startsWith("_") ? raw_name.slice(1) : raw_name;

    const nlist_addr = nlists.data.byteOffset + i * nlists.pod.size;

    if (hide && !Nlist_provided.is_undefined(nlist) && !exported.has(name)) {
      const offset = nlist_addr - data_ptr + n_type_offset;
      patches.push({ offset, value: nlist.n_type | macho.N_PEXT });
    }
    if (rename !== undefined) {
      const [rename_set] = rename;
      if (rename_set.has(name)) {
        renames.push({
          name_field_offset: nlist_addr - data_ptr,
          name: raw_name,
        });
      }
    }
  }

  if (patches.length === 0 && renames.length === 0) {
    return undefined;
  }

  let result: Uint8Array = data.slice();
  for (const p of patches) {
    result[p.offset] = p.value;
  }

  if (renames.length !== 0) {
    const suffix = rename![1];
    const renamed = macho_rebuild_strtab(result, renames, suffix, symtab_cmd, symtab_cmd_offset, endian);
    if (renamed !== undefined) {
      result = renamed;
    }
  }

  return result;
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:428 macho_rebuild_strtab
function macho_rebuild_strtab(
  data: Uint8Array,
  renames: readonly RenameEntry[],
  suffix: string,
  symtab_cmd: macho.SymtabCommand,
  symtab_cmd_offset: number,
  endian: Endianness,
): Uint8Array | undefined {
  const old_stroff = U32.get(symtab_cmd.stroff, endian);
  const old_strsize = U32.get(symtab_cmd.strsize, endian);
  // `data.get(old_stroff..old_stroff + old_strsize)?`
  if (old_stroff + old_strsize > data.length) return undefined;
  const old_strtab = data.subarray(old_stroff, old_stroff + old_strsize);

  const [new_strtab, rename_map] = build_renamed_strtab(old_strtab, renames, suffix);

  const new_strtab_file_off = data.length;
  const new_strtab_size = new_strtab.length;

  const result = new Uint8Array(data.length + new_strtab_size);
  result.set(data, 0);
  result.set(new_strtab, data.length);

  const stroff_off = SYMTAB_COMMAND_STROFF_OFFSET;
  const strsize_off = SYMTAB_COMMAND_STRSIZE_OFFSET;
  write_u32_at(result, symtab_cmd_offset + stroff_off, new_strtab_file_off >>> 0, endian);
  write_u32_at(result, symtab_cmd_offset + strsize_off, new_strtab_size >>> 0, endian);

  for (const entry of renames) {
    const new_strx = rename_map.get(entry.name)!;
    write_u32_at(result, entry.name_field_offset, new_strx, endian);
  }

  return result;
}

// ---------------------------------------------------------------------------
// COFF: single-pass collection + apply
// ---------------------------------------------------------------------------

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:466 coff_collect_impl
function coff_collect_impl(_data: Uint8Array, _header: unknown, _exported: ReadonlySet<string>, _out: Set<string>): void {
  return unported("object::read::coff::CoffHeader::symbols (COFF symbol tables: Windows targets)");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:493 coff_edit_impl
function coff_edit_impl(_data: Uint8Array, _header: unknown, hide: boolean, _rename: Rename): Uint8Array | undefined {
  // COFF has no visibility concept, so hiding is unsupported; the caller
  // has already warned and does not request it.
  assert(!hide, "assertion failed: !hide");

  return unported("object::read::coff::CoffHeader::pointer_to_symbol_table (COFF symbol tables: Windows targets)");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:582 build_renamed_strtab
function build_renamed_strtab(old_strtab: Uint8Array, renames: readonly RenameEntry[], suffix: string): [Uint8Array, Map<string, number>] {
  const new_strtab: number[] = Array.from(old_strtab);
  const rename_map = new Map<string, number>();

  const sorted_names: string[] = renames.map((r) => r.name);
  sorted_names.sort(str_cmp);
  // `dedup`
  const deduped = sorted_names.filter((n, i) => i === 0 || n !== sorted_names[i - 1]);

  for (const name of deduped) {
    const new_offset = new_strtab.length >>> 0;
    for (const b of encoder.encode(name)) new_strtab.push(b);
    for (const b of encoder.encode(suffix)) new_strtab.push(b);
    new_strtab.push(0);
    rename_map.set(name, new_offset);
  }

  return [Uint8Array.from(new_strtab), rename_map];
}

const encoder = new TextEncoder();

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:605 write_u32_at
function write_u32_at(buf: Uint8Array, offset: number, value: number, endian: Endianness): void {
  // `buf[offset..offset + 4].copy_from_slice(&bytes)` panics when out of range.
  if (offset + 4 > buf.length) range_panic(offset, offset + 4, buf.length);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, value, endian === "Little");
}

// rustc: compiler/rustc_codegen_ssa/src/back/symbol_edit.rs:613 write_u64_at
function write_u64_at(buf: Uint8Array, offset: number, value: number, endian: Endianness): void {
  if (offset + 8 > buf.length) range_panic(offset, offset + 8, buf.length);
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setBigUint64(offset, BigInt(value), endian === "Little");
}

/** `slice_end_index_len_fail` (`range end index {end} out of range for slice of length {len}`). */
function range_panic(_start: number, end: number, len: number): never {
  return panic(`range end index ${end} out of range for slice of length ${len}`);
}
