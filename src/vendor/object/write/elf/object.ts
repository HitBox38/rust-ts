// Port of object 0.39.1 `src/write/elf/object.rs`: `Object`'s ELF methods, without relocations and comdats (mod.ts).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the `impl Object` methods are functions taking the object: mod.ts dispatches to them, and mod.ts must stay loadable
// before this module (the classes are only used at run time). `elf_has_relocation_addend` is ported whole, as `elf_write`
// asks it first. Relocation and comdat code stays in place behind `unported`: `Section.relocations` and `Object.comdats`
// are always empty.
import { assert, unported } from "../../../../std/panic.ts";
import { Err, Ok } from "../../../../std/result.ts";
import { Architecture, SectionFlags, SectionKind } from "../../common.ts";
import * as elf from "../../elf.ts";
import { Error, type Object, type Result, type Section, type StandardSection, type Symbol, SymbolSection } from "../mod.ts";
import type { StringId } from "../string.ts";
import type { WritableBuffer } from "../util.ts";
import { type SectionIndex, type SymbolIndex, SymbolIndex as SymbolIndexOf, Writer } from "./writer.ts";

interface SectionOffsets {
  index: SectionIndex;
  offset: number;
  str_id: StringId;
  // Relocation data is reserved later.
  reloc_offset: number;
  reloc_str_id: StringId | undefined;
}

interface SymbolOffsets {
  index: SymbolIndex;
  str_id: StringId | undefined;
}

const encoder = new TextEncoder();
const b = (s: string): Uint8Array => encoder.encode(s);
const EMPTY = new Uint8Array(0);

// crate: object-0.39.1/src/write/elf/object.rs:63 elf_section_info
export function elf_section_info(self: Object, section: StandardSection): [Uint8Array, Uint8Array, SectionKind, SectionFlags] {
  switch (section) {
    case "Text":
      return [EMPTY, b(".text"), SectionKind.Text, SectionFlags.None];
    case "Data":
      return [EMPTY, b(".data"), SectionKind.Data, SectionFlags.None];
    case "ReadOnlyData":
    case "ReadOnlyString":
      return [EMPTY, b(".rodata"), SectionKind.ReadOnlyData, SectionFlags.None];
    case "ReadOnlyDataWithRel":
      return [EMPTY, b(".data.rel.ro"), SectionKind.ReadOnlyDataWithRel, SectionFlags.None];
    case "UninitializedData":
      return [EMPTY, b(".bss"), SectionKind.UninitializedData, SectionFlags.None];
    case "Tls":
      return [EMPTY, b(".tdata"), SectionKind.Tls, SectionFlags.None];
    case "UninitializedTls":
      return [EMPTY, b(".tbss"), SectionKind.UninitializedTls, SectionFlags.None];
    case "TlsVariables":
      // Unsupported section.
      return [EMPTY, EMPTY, SectionKind.TlsVariables, SectionFlags.None];
    case "Common":
      // Unsupported section.
      return [EMPTY, EMPTY, SectionKind.Common, SectionFlags.None];
    case "GnuProperty":
      return [EMPTY, b(".note.gnu.property"), SectionKind.Note, { $: "Elf", sh_flags: elf.SHF_ALLOC }];
    case "EhFrame":
      return [
        EMPTY,
        b(".eh_frame"),
        self.architecture() === "X86_64" || self.architecture() === "X86_64_X32" ? { $: "Elf", _0: elf.SHT_X86_64_UNWIND } : SectionKind.ReadOnlyData,
        { $: "Elf", sh_flags: elf.SHF_ALLOC },
      ];
  }
}

// crate: object-0.39.1/src/write/elf/object.rs:138 elf_section_flags
export function elf_section_flags(section: Section): SectionFlags {
  let sh_flags: number;
  switch (section.kind.$) {
    case "Text":
      sh_flags = elf.SHF_ALLOC | elf.SHF_EXECINSTR;
      break;
    case "Data":
    case "ReadOnlyDataWithRel":
      sh_flags = elf.SHF_ALLOC | elf.SHF_WRITE;
      break;
    case "Tls":
      sh_flags = elf.SHF_ALLOC | elf.SHF_WRITE | elf.SHF_TLS;
      break;
    case "UninitializedData":
      sh_flags = elf.SHF_ALLOC | elf.SHF_WRITE;
      break;
    case "UninitializedTls":
      sh_flags = elf.SHF_ALLOC | elf.SHF_WRITE | elf.SHF_TLS;
      break;
    case "ReadOnlyData":
      sh_flags = elf.SHF_ALLOC;
      break;
    case "ReadOnlyString":
      sh_flags = elf.SHF_ALLOC | elf.SHF_STRINGS | elf.SHF_MERGE;
      break;
    case "OtherString":
    case "DebugString":
      sh_flags = elf.SHF_STRINGS | elf.SHF_MERGE;
      break;
    case "Other":
    case "Debug":
    case "Metadata":
    case "Linker":
    case "Note":
    case "Elf":
      sh_flags = 0;
      break;
    case "Unknown":
    case "Common":
    case "TlsVariables":
      return SectionFlags.None;
  }
  return { $: "Elf", sh_flags };
}

// crate: object-0.39.1/src/write/elf/object.rs:164 elf_symbol_flags
export function elf_symbol_flags(_symbol: Symbol): never {
  // PORT: no symbol reaches this: `Object.symbols` stays empty (mod.ts).
  return unported("object::write::Object::elf_symbol_flags (ELF symbols)");
}

// crate: object-0.39.1/src/write/elf/object.rs:212 elf_has_relocation_addend
function elf_has_relocation_addend(self: Object): Result<boolean> {
  switch (self.architecture()) {
    case "Aarch64":
      return Ok(true);
    case "Aarch64_Ilp32":
      return Ok(true);
    case "Alpha":
      return Ok(true);
    case "Arm":
      return Ok(false);
    case "Avr":
      return Ok(true);
    case "Bpf":
      return Ok(false);
    case "Csky":
      return Ok(true);
    case "E2K32":
      return Ok(true);
    case "E2K64":
      return Ok(true);
    case "I386":
      return Ok(false);
    case "X86_64":
      return Ok(true);
    case "X86_64_X32":
      return Ok(true);
    case "Hppa":
      return Ok(false);
    case "Hexagon":
      return Ok(true);
    case "LoongArch32":
      return Ok(true);
    case "LoongArch64":
      return Ok(true);
    case "M68k":
      return Ok(true);
    case "Mips":
      return Ok(false);
    case "Mips64":
      return Ok(true);
    case "Mips64_N32":
      return Ok(true);
    case "Msp430":
      return Ok(true);
    case "PowerPc":
      return Ok(true);
    case "PowerPc64":
      return Ok(true);
    case "Riscv64":
      return Ok(true);
    case "Riscv32":
      return Ok(true);
    case "S390x":
      return Ok(true);
    case "Sbf":
      return Ok(false);
    case "Sharc":
      return Ok(true);
    case "Sparc":
      return Ok(true);
    case "Sparc32Plus":
      return Ok(true);
    case "Sparc64":
      return Ok(true);
    case "SuperH":
      return Ok(false);
    case "Xtensa":
      return Ok(true);
    default:
      return Err(new Error(`unimplemented architecture ${self.architecture()}`));
  }
}

// crate: object-0.39.1/src/write/elf/object.rs:583 elf_is_64
export function elf_is_64(self: Object): boolean {
  const a = Architecture.address_size(self.architecture());
  assert(a !== undefined, "called `Option::unwrap()` on a `None` value");
  switch (a!) {
    case "U8":
    case "U16":
    case "U32":
      return false;
    case "U64":
      return true;
  }
}

/** The `e_machine` match of `elf_write`: a `(Architecture, None)` pair. */
function e_machine_of(architecture: Architecture): number | undefined {
  switch (architecture) {
    case "Aarch64":
      return elf.EM_AARCH64;
    case "Aarch64_Ilp32":
      return elf.EM_AARCH64;
    case "Alpha":
      return elf.EM_ALPHA;
    case "Arm":
      return elf.EM_ARM;
    case "Avr":
      return elf.EM_AVR;
    case "Bpf":
      return elf.EM_BPF;
    case "Csky":
      return elf.EM_CSKY;
    case "E2K32":
      return elf.EM_MCST_ELBRUS;
    case "E2K64":
      return elf.EM_MCST_ELBRUS;
    case "I386":
      return elf.EM_386;
    case "X86_64":
      return elf.EM_X86_64;
    case "X86_64_X32":
      return elf.EM_X86_64;
    case "Hppa":
      return elf.EM_PARISC;
    case "Hexagon":
      return elf.EM_HEXAGON;
    case "LoongArch32":
      return elf.EM_LOONGARCH;
    case "LoongArch64":
      return elf.EM_LOONGARCH;
    case "M68k":
      return elf.EM_68K;
    case "Mips":
      return elf.EM_MIPS;
    case "Mips64":
      return elf.EM_MIPS;
    case "Mips64_N32":
      return elf.EM_MIPS;
    case "Msp430":
      return elf.EM_MSP430;
    case "PowerPc":
      return elf.EM_PPC;
    case "PowerPc64":
      return elf.EM_PPC64;
    case "Riscv32":
      return elf.EM_RISCV;
    case "Riscv64":
      return elf.EM_RISCV;
    case "S390x":
      return elf.EM_S390;
    case "Sbf":
      return elf.EM_SBF;
    case "Sharc":
      return elf.EM_SHARC;
    case "Sparc":
      return elf.EM_SPARC;
    case "Sparc32Plus":
      return elf.EM_SPARC32PLUS;
    case "Sparc64":
      return elf.EM_SPARCV9;
    case "SuperH":
      return elf.EM_SH;
    case "Xtensa":
      return elf.EM_XTENSA;
    default:
      return undefined;
  }
}

// crate: object-0.39.1/src/write/elf/object.rs:590 elf_write
export function elf_write(self: Object, buffer: WritableBuffer): Result<null> {
  // Create reloc section header names so we can reference them.
  const is_rela = elf_has_relocation_addend(self);
  if (is_rela.$ === "Err") return is_rela;
  // PORT: `reloc_names` is the `.rel[a]<name>` of every section with relocations: `Section.relocations` is always empty.

  // Start calculating offsets of everything.
  const writer = Writer.new(self.endian, elf_is_64(self), buffer);
  writer.reserve_file_header();

  // Calculate size of section data.
  // PORT: `comdat_offsets` stays empty with `Object.comdats`.
  const section_offsets: SectionOffsets[] = [];
  for (const section of self.sections) {
    const index = writer.reserve_section_index();
    const offset = writer.reserve(section.data.length, section.align);
    const str_id = writer.add_section_name(section.name);
    const reloc_str_id: StringId | undefined = undefined;
    section_offsets.push({
      index,
      offset,
      str_id,
      // Relocation data is reserved later.
      reloc_offset: 0,
      reloc_str_id,
    });
  }

  // Calculate index of symbols and add symbol strings to strtab.
  const symbol_offsets: SymbolOffsets[] = self.symbols.map(() => ({ index: SymbolIndexOf(0), str_id: undefined }));
  writer.reserve_null_symbol_index();
  // Local symbols must come before global.
  for (const [index, symbol] of self.symbols.entries()) {
    if (symbol.is_local()) {
      const s = SymbolSection.id(symbol.section);
      const section_index = s === undefined ? undefined : section_offsets[s]!.index;
      symbol_offsets[index]!.index = writer.reserve_symbol_index(section_index);
    }
  }
  const symtab_num_local = writer.symbol_count();
  for (const [index, symbol] of self.symbols.entries()) {
    if (!symbol.is_local()) {
      const s = SymbolSection.id(symbol.section);
      const section_index = s === undefined ? undefined : section_offsets[s]!.index;
      symbol_offsets[index]!.index = writer.reserve_symbol_index(section_index);
    }
  }
  for (const [index, symbol] of self.symbols.entries()) {
    if (symbol.kind !== "Section" && symbol.name.length !== 0) {
      symbol_offsets[index]!.str_id = writer.add_string(symbol.name);
    }
  }

  // Calculate size of symbols.
  writer.reserve_symtab_section_index();
  writer.reserve_symtab();
  if (writer.symtab_shndx_needed()) {
    writer.reserve_symtab_shndx_section_index();
  }
  writer.reserve_symtab_shndx();
  writer.reserve_strtab_section_index();
  writer.reserve_strtab();

  // Calculate size of relocations.
  // PORT: none (`Section.relocations` is always empty).

  // Calculate size of section headers.
  writer.reserve_shstrtab_section_index();
  writer.reserve_shstrtab();
  writer.reserve_section_headers();

  // Start writing.
  const e_type = elf.ET_REL;
  const e_machine = self.sub_architecture() === undefined ? e_machine_of(self.architecture()) : undefined;
  if (e_machine === undefined) {
    return Err(new Error(`unimplemented architecture ${self.architecture()} with sub-architecture ${self.sub_architecture() === undefined ? "None" : `Some(${self.sub_architecture()})`}`));
  }
  let os_abi: number;
  let abi_version: number;
  let e_flags: number;
  if (self.flags.$ === "Elf") {
    os_abi = self.flags.os_abi;
    abi_version = self.flags.abi_version;
    e_flags = self.flags.e_flags;
  } else {
    os_abi = elf.ELFOSABI_NONE;
    abi_version = 0;
    e_flags = 0;
  }

  if (self.architecture() === "Mips64_N32") {
    e_flags = (e_flags | elf.EF_MIPS_ABI2) >>> 0;
  }

  writer.write_file_header({
    os_abi,
    abi_version,
    e_type,
    e_machine,
    e_entry: 0,
    e_flags,
  });

  // Write section data.
  for (const section of self.sections) {
    writer.write_align(section.align);
    // debug_assert_eq!(section_offsets[index].offset, writer.len());
    writer.write(section.data);
  }

  // Write symbols.
  writer.write_null_symbol();
  const write_symbol = (_index: number, symbol: Symbol): Result<null> => {
    // PORT: `elf_symbol_flags` is `unported`, and no symbol gets here (`Object.symbols` stays empty).
    void self.symbol_flags(symbol);
    return Ok(null);
  };
  for (const [index, symbol] of self.symbols.entries()) {
    if (symbol.is_local()) {
      const r = write_symbol(index, symbol);
      if (r.$ === "Err") return r;
    }
  }
  for (const [index, symbol] of self.symbols.entries()) {
    if (!symbol.is_local()) {
      const r = write_symbol(index, symbol);
      if (r.$ === "Err") return r;
    }
  }
  writer.write_symtab_shndx();
  writer.write_strtab();

  // Write relocations.
  // PORT: none (`Section.relocations` is always empty).

  writer.write_shstrtab();

  // Write section headers.
  writer.write_null_section_header();

  for (const [index, section] of self.sections.entries()) {
    let sh_type: number;
    switch (section.kind.$) {
      case "UninitializedData":
      case "UninitializedTls":
        sh_type = elf.SHT_NOBITS;
        break;
      case "Note":
        sh_type = elf.SHT_NOTE;
        break;
      case "Elf":
        sh_type = section.kind._0;
        break;
      default:
        sh_type = elf.SHT_PROGBITS;
    }
    const flags = self.section_flags(section);
    if (flags.$ !== "Elf") {
      return Err(new Error(`unimplemented section \`${section.name_str() ?? ""}\` kind ${section.kind.$}`));
    }
    const sh_flags = flags.sh_flags;
    // TODO: not sure if this is correct, maybe user should determine this
    const sh_entsize = section.kind.$ === "ReadOnlyString" || section.kind.$ === "OtherString" ? 1 : 0;
    writer.write_section_header({
      name: section_offsets[index]!.str_id,
      sh_type,
      sh_flags,
      sh_addr: 0,
      sh_offset: section_offsets[index]!.offset,
      sh_size: section.size,
      sh_link: 0,
      sh_info: 0,
      sh_addralign: section.align,
      sh_entsize,
    });
  }

  writer.write_symtab_section_header(symtab_num_local);
  writer.write_symtab_shndx_section_header();
  writer.write_strtab_section_header();
  writer.write_shstrtab_section_header();

  // debug_assert_eq!(writer.reserved_len(), writer.len());

  return Ok(null);
}
