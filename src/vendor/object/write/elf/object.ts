// Port of object 0.39.1 `src/write/elf/object.rs`: `Object`'s ELF methods.
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: the `impl Object` methods are functions taking the object: mod.ts dispatches to them, and mod.ts must stay loadable
// before this module (the classes are only used at run time).
import { assert, panic } from "../../../../std/panic.ts";
import { Err, Ok } from "../../../../std/result.ts";
import { Architecture, type RelocationEncoding, type RelocationKind, SectionFlags, SectionKind, type SymbolFlags } from "../../common.ts";
import * as elf from "../../elf.ts";
import { debug_RelocationInternal, Error, type Object, type RelocationInternal, type Result, type Section, type StandardSection, type Symbol, SymbolSection } from "../mod.ts";
import type { StringId } from "../string.ts";
import * as util from "../util.ts";
import type { WritableBuffer } from "../util.ts";
import { type SectionIndex, type SymbolIndex, SymbolIndex as SymbolIndexOf, Writer } from "./writer.ts";

interface ComdatOffsets {
  offset: number;
  str_id: StringId;
}

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

// Public methods.

/// Add a property with a u32 value to the ELF ".note.gnu.property" section.
///
/// Requires `feature = "elf"`.
// crate: object-0.39.1/src/write/elf/object.rs:34 add_elf_gnu_property_u32
export function add_elf_gnu_property_u32(self: Object, property: number, value: number): void {
  if (self.format() !== "Elf") {
    return;
  }

  const align = elf_is_64(self) ? 8 : 4;
  const data: number[] = [];
  const n_name = b("GNU\0");
  const u32 = (v: number): number[] => {
    const x = v >>> 0;
    const le = [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
    return self.endian === "Little" ? le : le.reverse();
  };
  // pod::bytes_of(&elf::NoteHeader32 { n_namesz, n_descsz, n_type })
  data.push(...u32(n_name.length), ...u32(util.align(3 * 4, align)), ...u32(elf.NT_GNU_PROPERTY_TYPE_0));
  data.push(...n_name);
  // This happens to already be aligned correctly.
  // debug_assert_eq!(util::align(data.len(), align), data.len());
  data.push(...u32(property));
  // Value size
  data.push(...u32(4));
  data.push(...u32(value));
  // `util::write_align(&mut data, align)`
  while (data.length < util.align(data.length, align)) data.push(0);

  const section = self.section_id("GnuProperty");
  self.append_section_data(section, Uint8Array.from(data), align);
}

// Private methods.

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

// crate: object-0.39.1/src/write/elf/object.rs:129 elf_subsection_name
export function elf_subsection_name(section: Uint8Array, value: Uint8Array): Uint8Array {
  if (value.length === 0) {
    return section.slice();
  }
  const name = new Uint8Array(section.length + 1 + value.length);
  name.set(section);
  name[section.length] = 0x2e; // b'.'
  name.set(value, section.length + 1);
  return name;
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
export function elf_symbol_flags(symbol: Symbol): SymbolFlags {
  let st_type: number;
  switch (symbol.kind) {
    case "Text":
      if (symbol.is_undefined()) {
        st_type = elf.STT_NOTYPE;
      } else {
        st_type = elf.STT_FUNC;
      }
      break;
    case "Data":
      if (symbol.is_undefined()) {
        st_type = elf.STT_NOTYPE;
      } else if (symbol.is_common()) {
        st_type = elf.STT_COMMON;
      } else {
        st_type = elf.STT_OBJECT;
      }
      break;
    case "Section":
      st_type = elf.STT_SECTION;
      break;
    case "File":
      st_type = elf.STT_FILE;
      break;
    case "Tls":
      st_type = elf.STT_TLS;
      break;
    case "Label":
      st_type = elf.STT_NOTYPE;
      break;
    case "Unknown":
      if (symbol.is_undefined()) {
        st_type = elf.STT_NOTYPE;
      } else {
        return { $: "None" };
      }
      break;
  }
  let st_bind: number;
  if (symbol.weak) {
    st_bind = elf.STB_WEAK;
  } else if (symbol.is_undefined()) {
    st_bind = elf.STB_GLOBAL;
  } else if (symbol.is_local()) {
    st_bind = elf.STB_LOCAL;
  } else {
    st_bind = elf.STB_GLOBAL;
  }
  const st_info = ((st_bind << 4) + st_type) & 0xff;
  const st_other = symbol.scope === "Linkage" ? elf.STV_HIDDEN : elf.STV_DEFAULT;
  return { $: "Elf", st_info, st_other };
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

// crate: object-0.39.1/src/write/elf/object.rs:256 elf_translate_relocation
export function elf_translate_relocation(self: Object, reloc: RelocationInternal): Result<null> {
  let kind: RelocationKind;
  let encoding: RelocationEncoding;
  let size: number;
  if (reloc.flags.$ === "Generic") {
    [kind, encoding, size] = [reloc.flags.kind, reloc.flags.encoding, reloc.flags.size];
  } else {
    return Ok(null);
  }

  const unsupported_reloc = (): Result<null> => Err(new Error(`unimplemented ELF relocation ${debug_RelocationInternal(reloc)}`));
  let r_type: number;
  switch (self.architecture()) {
    case "Aarch64":
      if (kind === "None" && encoding === "Generic" && size === 0) r_type = elf.R_AARCH64_NONE;
      else if (kind === "Absolute" && encoding === "Generic" && size === 64) r_type = elf.R_AARCH64_ABS64;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_AARCH64_ABS32;
      else if (kind === "Absolute" && encoding === "Generic" && size === 16) r_type = elf.R_AARCH64_ABS16;
      else if (kind === "Relative" && encoding === "Generic" && size === 64) r_type = elf.R_AARCH64_PREL64;
      else if (kind === "Relative" && encoding === "Generic" && size === 32) r_type = elf.R_AARCH64_PREL32;
      else if (kind === "Relative" && encoding === "Generic" && size === 16) r_type = elf.R_AARCH64_PREL16;
      else if (kind === "Relative" && encoding === "AArch64Call" && size === 26) r_type = elf.R_AARCH64_CALL26;
      else if (kind === "PltRelative" && encoding === "AArch64Call" && size === 26) r_type = elf.R_AARCH64_CALL26;
      else return unsupported_reloc();
      break;
    case "Aarch64_Ilp32":
      if (kind === "None" && encoding === "Generic" && size === 0) r_type = elf.R_AARCH64_NONE;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_AARCH64_P32_ABS32;
      else return unsupported_reloc();
      break;
    case "Alpha":
      if (kind === "None" && size === 0) r_type = elf.R_ALPHA_NONE;
      // Absolute
      else if (kind === "Absolute" && size === 32) r_type = elf.R_ALPHA_REFLONG;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_ALPHA_REFQUAD;
      // Relative to the PC
      else if (kind === "Relative" && size === 16) r_type = elf.R_ALPHA_SREL16;
      else if (kind === "Relative" && size === 32) r_type = elf.R_ALPHA_SREL32;
      else if (kind === "Relative" && size === 64) r_type = elf.R_ALPHA_SREL64;
      else return unsupported_reloc();
      break;
    case "Arm":
      if (kind === "None" && size === 0) r_type = elf.R_ARM_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_ARM_ABS32;
      else return unsupported_reloc();
      break;
    case "Avr":
      if (kind === "None" && size === 0) r_type = elf.R_AVR_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_AVR_32;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_AVR_16;
      else return unsupported_reloc();
      break;
    case "Bpf":
      if (kind === "None" && size === 0) r_type = elf.R_BPF_NONE;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_BPF_64_64;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_BPF_64_32;
      else return unsupported_reloc();
      break;
    case "Csky":
      if (kind === "None" && size === 0) r_type = elf.R_CKCORE_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_CKCORE_ADDR32;
      else if (kind === "Relative" && encoding === "Generic" && size === 32) r_type = elf.R_CKCORE_PCREL32;
      else return unsupported_reloc();
      break;
    case "I386":
      if (kind === "None" && size === 0) r_type = elf.R_386_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_386_32;
      else if (kind === "Relative" && size === 32) r_type = elf.R_386_PC32;
      else if (kind === "Got" && size === 32) r_type = elf.R_386_GOT32;
      else if (kind === "PltRelative" && size === 32) r_type = elf.R_386_PLT32;
      else if (kind === "GotBaseOffset" && size === 32) r_type = elf.R_386_GOTOFF;
      else if (kind === "GotBaseRelative" && size === 32) r_type = elf.R_386_GOTPC;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_386_16;
      else if (kind === "Relative" && size === 16) r_type = elf.R_386_PC16;
      else if (kind === "Absolute" && size === 8) r_type = elf.R_386_8;
      else if (kind === "Relative" && size === 8) r_type = elf.R_386_PC8;
      else return unsupported_reloc();
      break;
    case "E2K32":
    case "E2K64":
      if (kind === "None" && size === 0) r_type = elf.R_E2K_NONE;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_E2K_32_ABS;
      else if (kind === "Absolute" && encoding === "E2KLit" && size === 64) r_type = elf.R_E2K_64_ABS_LIT;
      else if (kind === "Absolute" && encoding === "Generic" && size === 64) r_type = elf.R_E2K_64_ABS;
      else if (kind === "Relative" && encoding === "E2KDisp" && size === 28) r_type = elf.R_E2K_DISP;
      else if (kind === "Got" && size === 32) r_type = elf.R_E2K_GOT;
      else return unsupported_reloc();
      break;
    case "X86_64":
    case "X86_64_X32":
      if (kind === "None" && size === 0) r_type = elf.R_X86_64_NONE;
      else if (kind === "Absolute" && encoding === "Generic" && size === 64) r_type = elf.R_X86_64_64;
      else if (kind === "Relative" && encoding === "X86Branch" && size === 32) r_type = elf.R_X86_64_PLT32;
      else if (kind === "Relative" && size === 32) r_type = elf.R_X86_64_PC32;
      else if (kind === "Got" && size === 32) r_type = elf.R_X86_64_GOT32;
      else if (kind === "PltRelative" && size === 32) r_type = elf.R_X86_64_PLT32;
      else if (kind === "GotRelative" && size === 32) r_type = elf.R_X86_64_GOTPCREL;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_X86_64_32;
      else if (kind === "Absolute" && encoding === "X86Signed" && size === 32) r_type = elf.R_X86_64_32S;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_X86_64_16;
      else if (kind === "Relative" && size === 16) r_type = elf.R_X86_64_PC16;
      else if (kind === "Absolute" && size === 8) r_type = elf.R_X86_64_8;
      else if (kind === "Relative" && size === 8) r_type = elf.R_X86_64_PC8;
      else return unsupported_reloc();
      break;
    case "Hppa":
      if (kind === "None" && size === 0) r_type = elf.R_PARISC_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_PARISC_DIR32;
      else if (kind === "Relative" && size === 32) r_type = elf.R_PARISC_PCREL32;
      else return unsupported_reloc();
      break;
    case "Hexagon":
      if (kind === "None" && size === 0) r_type = elf.R_HEX_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_HEX_32;
      else return unsupported_reloc();
      break;
    case "LoongArch32":
    case "LoongArch64":
      if (kind === "None" && size === 0) r_type = elf.R_LARCH_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_LARCH_32;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_LARCH_64;
      else if (kind === "Relative" && size === 32) r_type = elf.R_LARCH_32_PCREL;
      else if (kind === "Relative" && size === 64) r_type = elf.R_LARCH_64_PCREL;
      else if (kind === "Relative" && encoding === "LoongArchBranch" && size === 16) r_type = elf.R_LARCH_B16;
      else if (kind === "PltRelative" && encoding === "LoongArchBranch" && size === 16) r_type = elf.R_LARCH_B16;
      else if (kind === "Relative" && encoding === "LoongArchBranch" && size === 21) r_type = elf.R_LARCH_B21;
      else if (kind === "PltRelative" && encoding === "LoongArchBranch" && size === 21) r_type = elf.R_LARCH_B21;
      else if (kind === "Relative" && encoding === "LoongArchBranch" && size === 26) r_type = elf.R_LARCH_B26;
      else if (kind === "PltRelative" && encoding === "LoongArchBranch" && size === 26) r_type = elf.R_LARCH_B26;
      else return unsupported_reloc();
      break;
    case "M68k":
      if (kind === "None" && size === 0) r_type = elf.R_68K_NONE;
      else if (kind === "Absolute" && size === 8) r_type = elf.R_68K_8;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_68K_16;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_68K_32;
      else if (kind === "Relative" && size === 8) r_type = elf.R_68K_PC8;
      else if (kind === "Relative" && size === 16) r_type = elf.R_68K_PC16;
      else if (kind === "Relative" && size === 32) r_type = elf.R_68K_PC32;
      else if (kind === "GotRelative" && size === 8) r_type = elf.R_68K_GOT8;
      else if (kind === "GotRelative" && size === 16) r_type = elf.R_68K_GOT16;
      else if (kind === "GotRelative" && size === 32) r_type = elf.R_68K_GOT32;
      else if (kind === "Got" && size === 8) r_type = elf.R_68K_GOT8O;
      else if (kind === "Got" && size === 16) r_type = elf.R_68K_GOT16O;
      else if (kind === "Got" && size === 32) r_type = elf.R_68K_GOT32O;
      else if (kind === "PltRelative" && size === 8) r_type = elf.R_68K_PLT8;
      else if (kind === "PltRelative" && size === 16) r_type = elf.R_68K_PLT16;
      else if (kind === "PltRelative" && size === 32) r_type = elf.R_68K_PLT32;
      else return unsupported_reloc();
      break;
    case "Mips":
    case "Mips64":
    case "Mips64_N32":
      if (kind === "None" && size === 0) r_type = elf.R_MIPS_NONE;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_MIPS_16;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_MIPS_32;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_MIPS_64;
      else return unsupported_reloc();
      break;
    case "Msp430":
      if (kind === "None" && size === 0) r_type = elf.R_MSP430_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_MSP430_32;
      else if (kind === "Absolute" && size === 16) r_type = elf.R_MSP430_16_BYTE;
      else return unsupported_reloc();
      break;
    case "PowerPc":
      if (kind === "None" && size === 0) r_type = elf.R_PPC_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_PPC_ADDR32;
      else return unsupported_reloc();
      break;
    case "PowerPc64":
      if (kind === "None" && size === 0) r_type = elf.R_PPC64_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_PPC64_ADDR32;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_PPC64_ADDR64;
      else return unsupported_reloc();
      break;
    case "Riscv32":
    case "Riscv64":
      if (kind === "None" && size === 0) r_type = elf.R_RISCV_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_RISCV_32;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_RISCV_64;
      else if (kind === "Relative" && encoding === "Generic" && size === 32) r_type = elf.R_RISCV_32_PCREL;
      else return unsupported_reloc();
      break;
    case "S390x":
      if (kind === "None" && encoding === "Generic" && size === 0) r_type = elf.R_390_NONE;
      else if (kind === "Absolute" && encoding === "Generic" && size === 8) r_type = elf.R_390_8;
      else if (kind === "Absolute" && encoding === "Generic" && size === 16) r_type = elf.R_390_16;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_390_32;
      else if (kind === "Absolute" && encoding === "Generic" && size === 64) r_type = elf.R_390_64;
      else if (kind === "Relative" && encoding === "Generic" && size === 16) r_type = elf.R_390_PC16;
      else if (kind === "Relative" && encoding === "Generic" && size === 32) r_type = elf.R_390_PC32;
      else if (kind === "Relative" && encoding === "Generic" && size === 64) r_type = elf.R_390_PC64;
      else if (kind === "Relative" && encoding === "S390xDbl" && size === 16) r_type = elf.R_390_PC16DBL;
      else if (kind === "Relative" && encoding === "S390xDbl" && size === 32) r_type = elf.R_390_PC32DBL;
      else if (kind === "PltRelative" && encoding === "S390xDbl" && size === 16) r_type = elf.R_390_PLT16DBL;
      else if (kind === "PltRelative" && encoding === "S390xDbl" && size === 32) r_type = elf.R_390_PLT32DBL;
      else if (kind === "Got" && encoding === "Generic" && size === 16) r_type = elf.R_390_GOT16;
      else if (kind === "Got" && encoding === "Generic" && size === 32) r_type = elf.R_390_GOT32;
      else if (kind === "Got" && encoding === "Generic" && size === 64) r_type = elf.R_390_GOT64;
      else if (kind === "GotRelative" && encoding === "S390xDbl" && size === 32) r_type = elf.R_390_GOTENT;
      else if (kind === "GotBaseOffset" && encoding === "Generic" && size === 16) r_type = elf.R_390_GOTOFF16;
      else if (kind === "GotBaseOffset" && encoding === "Generic" && size === 32) r_type = elf.R_390_GOTOFF32;
      else if (kind === "GotBaseOffset" && encoding === "Generic" && size === 64) r_type = elf.R_390_GOTOFF64;
      else if (kind === "GotBaseRelative" && encoding === "Generic" && size === 64) r_type = elf.R_390_GOTPC;
      else if (kind === "GotBaseRelative" && encoding === "S390xDbl" && size === 32) r_type = elf.R_390_GOTPCDBL;
      else return unsupported_reloc();
      break;
    case "Sbf":
      if (kind === "None" && size === 0) r_type = elf.R_SBF_NONE;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_SBF_64_64;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_SBF_64_32;
      else return unsupported_reloc();
      break;
    case "Sharc":
      if (kind === "Absolute" && encoding === "SharcTypeA" && size === 32) r_type = elf.R_SHARC_ADDR32_V3;
      else if (kind === "Absolute" && encoding === "Generic" && size === 32) r_type = elf.R_SHARC_ADDR_VAR_V3;
      else if (kind === "Relative" && encoding === "SharcTypeA" && size === 24) r_type = elf.R_SHARC_PCRLONG_V3;
      else if (kind === "Relative" && encoding === "SharcTypeA" && size === 6) r_type = elf.R_SHARC_PCRSHORT_V3;
      else if (kind === "Relative" && encoding === "SharcTypeB" && size === 6) r_type = elf.R_SHARC_PCRSHORT_V3;
      else if (kind === "Absolute" && encoding === "Generic" && size === 16) r_type = elf.R_SHARC_ADDR_VAR16_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeA" && size === 16) r_type = elf.R_SHARC_DATA16_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeB" && size === 16) r_type = elf.R_SHARC_DATA16_VISA_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeA" && size === 24) r_type = elf.R_SHARC_ADDR24_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeA" && size === 6) r_type = elf.R_SHARC_DATA6_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeB" && size === 6) r_type = elf.R_SHARC_DATA6_VISA_V3;
      else if (kind === "Absolute" && encoding === "SharcTypeB" && size === 7) r_type = elf.R_SHARC_DATA7_VISA_V3;
      else return unsupported_reloc();
      break;
    case "Sparc":
    case "Sparc32Plus":
      if (kind === "None" && size === 0) r_type = elf.R_SPARC_NONE;
      // TODO: use R_SPARC_32 if aligned.
      else if (kind === "Absolute" && size === 32) r_type = elf.R_SPARC_UA32;
      else return unsupported_reloc();
      break;
    case "Sparc64":
      if (kind === "None" && size === 0) r_type = elf.R_SPARC_NONE;
      // TODO: use R_SPARC_32/R_SPARC_64 if aligned.
      else if (kind === "Absolute" && size === 32) r_type = elf.R_SPARC_UA32;
      else if (kind === "Absolute" && size === 64) r_type = elf.R_SPARC_UA64;
      else return unsupported_reloc();
      break;
    case "SuperH":
      if (kind === "None" && size === 0) r_type = elf.R_SH_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_SH_DIR32;
      else if (kind === "Relative" && size === 32) r_type = elf.R_SH_REL32;
      else return unsupported_reloc();
      break;
    case "Xtensa":
      if (kind === "None" && size === 0) r_type = elf.R_XTENSA_NONE;
      else if (kind === "Absolute" && size === 32) r_type = elf.R_XTENSA_32;
      else if (kind === "Relative" && encoding === "Generic" && size === 32) r_type = elf.R_XTENSA_32_PCREL;
      else return unsupported_reloc();
      break;
    default:
      return Err(new Error(`unimplemented architecture ${self.architecture()}`));
  }
  reloc.flags = { $: "Elf", r_type };
  return Ok(null);
}

// crate: object-0.39.1/src/write/elf/object.rs:524 elf_adjust_addend
export function elf_adjust_addend(self: Object, _relocation: RelocationInternal): Result<boolean> {
  // Determine whether the addend is stored in the relocation or the data.
  const r = elf_has_relocation_addend(self);
  if (r.$ === "Err") return r;
  const implicit = !r._0;
  return Ok(implicit);
}

// crate: object-0.39.1/src/write/elf/object.rs:533 elf_relocation_size
export function elf_relocation_size(self: Object, reloc: RelocationInternal): Result<number> {
  let r_type: number;
  if (reloc.flags.$ === "Elf") {
    r_type = reloc.flags.r_type;
  } else {
    return Err(new Error("invalid relocation flags"));
  }
  // This only needs to support architectures that use implicit addends.
  let size: number | undefined;
  switch (self.architecture()) {
    case "Arm":
      if (r_type === elf.R_ARM_ABS16) size = 16;
      else if (r_type === elf.R_ARM_ABS32 || r_type === elf.R_ARM_REL32) size = 32;
      else size = undefined;
      break;
    case "Bpf":
      if (r_type === elf.R_BPF_64_32) size = 32;
      else if (r_type === elf.R_BPF_64_64) size = 64;
      else size = undefined;
      break;
    case "I386":
      if (r_type === elf.R_386_8 || r_type === elf.R_386_PC8) size = 8;
      else if (r_type === elf.R_386_16 || r_type === elf.R_386_PC16) size = 16;
      else if (
        r_type === elf.R_386_32 ||
        r_type === elf.R_386_PC32 ||
        r_type === elf.R_386_GOT32 ||
        r_type === elf.R_386_PLT32 ||
        r_type === elf.R_386_GOTOFF ||
        r_type === elf.R_386_GOTPC
      )
        size = 32;
      else size = undefined;
      break;
    case "Mips":
      if (r_type === elf.R_MIPS_16) size = 16;
      else if (r_type === elf.R_MIPS_32) size = 32;
      else if (r_type === elf.R_MIPS_64) size = 64;
      else size = undefined;
      break;
    case "Sbf":
      if (r_type === elf.R_SBF_64_32) size = 32;
      else if (r_type === elf.R_SBF_64_64) size = 64;
      else size = undefined;
      break;
    default:
      return Err(new Error(`unimplemented architecture ${self.architecture()}`));
  }
  if (size === undefined) return Err(new Error(`unsupported relocation for size ${debug_RelocationInternal(reloc)}`));
  return Ok(size);
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
  const is_rela_ = elf_has_relocation_addend(self);
  if (is_rela_.$ === "Err") return is_rela_;
  const is_rela = is_rela_._0;
  const reloc_names: Uint8Array[] = self.sections.map((section) => {
    if (section.relocations.length !== 0) {
      const prefix = is_rela ? b(".rela") : b(".rel");
      const reloc_name = new Uint8Array(prefix.length + section.name.length);
      reloc_name.set(prefix);
      reloc_name.set(section.name, prefix.length);
      return reloc_name;
    }
    return EMPTY;
  });

  // Start calculating offsets of everything.
  const writer = Writer.new(self.endian, elf_is_64(self), buffer);
  writer.reserve_file_header();

  // Calculate size of section data.
  const comdat_offsets: ComdatOffsets[] = [];
  for (const comdat of self.comdats) {
    if (comdat.kind !== "Any") {
      return Err(new Error(`unsupported COMDAT symbol \`${self.symbols[comdat.symbol]!.name_str() ?? ""}\` kind ${comdat.kind}`));
    }

    writer.reserve_section_index();
    const offset = writer.reserve_comdat(comdat.sections.length);
    const str_id = writer.add_section_name(b(".group"));
    comdat_offsets.push({ offset, str_id });
  }
  const section_offsets: SectionOffsets[] = [];
  for (const [i, section] of self.sections.entries()) {
    const reloc_name = reloc_names[i]!;
    const index = writer.reserve_section_index();
    const offset = writer.reserve(section.data.length, section.align);
    const str_id = writer.add_section_name(section.name);
    let reloc_str_id: StringId | undefined = undefined;
    if (section.relocations.length !== 0) {
      writer.reserve_section_index();
      reloc_str_id = writer.add_section_name(reloc_name);
    }
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
  for (const [index, section] of self.sections.entries()) {
    const count = section.relocations.length;
    if (count !== 0) {
      section_offsets[index]!.reloc_offset = writer.reserve_relocations(count, is_rela);
    }
  }

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
  for (const comdat of self.comdats) {
    writer.write_comdat_header();
    for (const section of comdat.sections) {
      writer.write_comdat_entry(section_offsets[section]!.index);
    }
  }
  for (const section of self.sections) {
    writer.write_align(section.align);
    // debug_assert_eq!(section_offsets[index].offset, writer.len());
    writer.write(section.data);
  }

  // Write symbols.
  writer.write_null_symbol();
  const write_symbol = (index: number, symbol: Symbol): Result<null> => {
    const flags = self.symbol_flags(symbol);
    if (flags.$ !== "Elf") {
      return Err(new Error(`unimplemented symbol \`${symbol.name_str() ?? ""}\` kind ${symbol.kind}`));
    }
    const { st_info, st_other } = flags;
    let st_shndx: number;
    let section: SectionIndex | undefined;
    switch (symbol.section.$) {
      case "None":
        // debug_assert_eq!(symbol.kind, SymbolKind::File);
        [st_shndx, section] = [elf.SHN_ABS, undefined];
        break;
      case "Undefined":
        [st_shndx, section] = [elf.SHN_UNDEF, undefined];
        break;
      case "Absolute":
        [st_shndx, section] = [elf.SHN_ABS, undefined];
        break;
      case "Common":
        [st_shndx, section] = [elf.SHN_COMMON, undefined];
        break;
      case "Section":
        [st_shndx, section] = [0, section_offsets[symbol.section._0]!.index];
        break;
    }
    writer.write_symbol({
      name: symbol_offsets[index]!.str_id,
      section,
      st_info,
      st_other,
      st_shndx,
      st_value: symbol.value,
      st_size: symbol.size,
    });
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
  for (const [index, section] of self.sections.entries()) {
    if (section.relocations.length !== 0) {
      writer.write_align_relocation();
      // debug_assert_eq!(section_offsets[index].reloc_offset, writer.len());
      void index;
      for (const reloc of section.relocations) {
        let r_type: number;
        if (reloc.flags.$ === "Elf") {
          r_type = reloc.flags.r_type;
        } else {
          return Err(new Error("invalid relocation flags"));
        }
        const r_sym = symbol_offsets[reloc.symbol]!.index;
        writer.write_relocation(is_rela, {
          r_offset: reloc.offset,
          r_sym,
          r_type,
          r_addend: reloc.addend,
        });
      }
    }
  }

  writer.write_shstrtab();

  // Write section headers.
  writer.write_null_section_header();

  const symtab_index = writer.symtab_index();
  for (const [i, comdat] of self.comdats.entries()) {
    const comdat_offset = comdat_offsets[i]!;
    writer.write_comdat_section_header(
      comdat_offset.str_id,
      symtab_index,
      symbol_offsets[comdat.symbol]!.index,
      comdat_offset.offset,
      comdat.sections.length,
    );
  }
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

    if (section.relocations.length !== 0) {
      const reloc_str_id = section_offsets[index]!.reloc_str_id;
      if (reloc_str_id === undefined) return panic("called `Option::unwrap()` on a `None` value");
      writer.write_relocation_section_header(
        reloc_str_id,
        section_offsets[index]!.index,
        symtab_index,
        section_offsets[index]!.reloc_offset,
        section.relocations.length,
        is_rela,
      );
    }
  }

  writer.write_symtab_section_header(symtab_num_local);
  writer.write_symtab_shndx_section_header();
  writer.write_strtab_section_header();
  writer.write_shstrtab_section_header();

  // debug_assert_eq!(writer.reserved_len(), writer.len());

  return Ok(null);
}
