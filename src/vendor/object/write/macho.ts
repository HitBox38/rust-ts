// Port of object 0.39.1 `src/write/macho.rs`: `Object`'s Mach-O methods and the Mach-O writer (lane object-write-macho).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: as in elf/object.ts, the `impl Object` methods are functions taking the object: mod.ts dispatches to them and must
// stay loadable before this module. The two public setters are functions too (`set_macho_cpu_subtype(file, ..)`).
// Relocations are not ported (`Section.relocations` is always empty, mod.ts), so the methods only `add_relocation` and
// `set_symbol_data` reach (`macho_tlv_bootstrap`, `macho_add_thread_var`, `macho_translate_relocation`,
// `macho_adjust_addend`) stop `unported`, and `macho_write` stops `unported` on a section with relocations. Symbols are
// written in upstream's shape, though rustc's wrapper files add none.
// PORT: `buffer.write(&pod)` of the `repr(C)` Mach-O structs writes their fields in order (`FieldWriter`): they have no
// padding. Their sizes are the `POD.size` of the structs in ../macho.ts. `u64` values are `number`s: addresses, sizes and
// offsets of a wrapper object stay below 2^53.
import { panic, unported } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import { AddressSize, Architecture, SectionFlags, SectionKind, type SymbolFlags } from "../common.ts";
import type { Endianness } from "../endian.ts";
import * as macho from "../macho.ts";
import { Error, type Object, type Result, type Section, type StandardSection, type StandardSegment, type Symbol, SymbolSection } from "./mod.ts";
import { type StringId, StringTable } from "./string.ts";
import { align, align_u64, write_align, type WritableBuffer } from "./util.ts";

interface SectionOffsets {
  index: number;
  offset: number;
  address: number;
  reloc_offset: number;
  reloc_count: number;
}

interface SymbolOffsets {
  index: number;
  str_id: StringId | undefined;
}

const encoder = new TextEncoder();
const b = (s: string): Uint8Array => encoder.encode(s);
const EMPTY = new Uint8Array(0);

/// The customizable portion of a [`macho::BuildVersionCommand`].
// #[derive(Debug, Default, Clone, Copy)]
// #[non_exhaustive] // May want to add the tool list?
export class MachOBuildVersion {
  constructor(
    /// One of the `PLATFORM_` constants (for example,
    /// [`object::macho::PLATFORM_MACOS`](macho::PLATFORM_MACOS)).
    public platform: number,
    /// The minimum OS version, where `X.Y.Z` is encoded in nibbles as
    /// `xxxx.yy.zz`.
    public minos: number,
    /// The SDK version as `X.Y.Z`, where `X.Y.Z` is encoded in nibbles as
    /// `xxxx.yy.zz`.
    public sdk: number,
  ) {}

  /** `#[derive(Default)]`. */
  static default(): MachOBuildVersion {
    return new MachOBuildVersion(0, 0, 0);
  }

  // crate: object-0.39.1/src/write/macho.rs:40 cmdsize
  cmdsize(): number {
    // Same size for both endianness, and we don't have `ntools`.
    const sz = macho.BuildVersionCommand.POD.size;
    // debug_assert!(sz <= u32::MAX as usize);
    return sz;
  }
}

// Public methods.

/// Specify the Mach-O CPU subtype.
///
/// Requires `feature = "macho"`.
// crate: object-0.39.1/src/write/macho.rs:54 set_macho_cpu_subtype
export function set_macho_cpu_subtype(self: Object, cpu_subtype: number): void {
  self.macho_cpu_subtype = cpu_subtype;
}

/// Specify information for a Mach-O `LC_BUILD_VERSION` command.
///
/// Requires `feature = "macho"`.
// crate: object-0.39.1/src/write/macho.rs:62 set_macho_build_version
export function set_macho_build_version(self: Object, info: MachOBuildVersion): void {
  self.macho_build_version = info;
}

// Private methods.

// crate: object-0.39.1/src/write/macho.rs:69 macho_segment_name
export function macho_segment_name(segment: StandardSegment): Uint8Array {
  switch (segment) {
    case "Text":
      return b("__TEXT");
    case "Data":
      return b("__DATA");
    case "Debug":
      return b("__DWARF");
  }
}

// crate: object-0.39.1/src/write/macho.rs:77 macho_section_info
export function macho_section_info(section: StandardSection): [Uint8Array, Uint8Array, SectionKind, SectionFlags] {
  switch (section) {
    case "Text":
      return [b("__TEXT"), b("__text"), SectionKind.Text, SectionFlags.None];
    case "Data":
      return [b("__DATA"), b("__data"), SectionKind.Data, SectionFlags.None];
    case "ReadOnlyData":
      return [b("__TEXT"), b("__const"), SectionKind.ReadOnlyData, SectionFlags.None];
    case "ReadOnlyDataWithRel":
      return [b("__DATA"), b("__const"), SectionKind.ReadOnlyDataWithRel, SectionFlags.None];
    case "ReadOnlyString":
      return [b("__TEXT"), b("__cstring"), SectionKind.ReadOnlyString, SectionFlags.None];
    case "UninitializedData":
      return [b("__DATA"), b("__bss"), SectionKind.UninitializedData, SectionFlags.None];
    case "Tls":
      return [b("__DATA"), b("__thread_data"), SectionKind.Tls, SectionFlags.None];
    case "UninitializedTls":
      return [b("__DATA"), b("__thread_bss"), SectionKind.UninitializedTls, SectionFlags.None];
    case "TlsVariables":
      return [b("__DATA"), b("__thread_vars"), SectionKind.TlsVariables, SectionFlags.None];
    case "Common":
      return [b("__DATA"), b("__common"), SectionKind.Common, SectionFlags.None];
    case "GnuProperty":
      // Unsupported section.
      return [EMPTY, EMPTY, SectionKind.Note, SectionFlags.None];
    case "EhFrame":
      return [
        b("__TEXT"),
        b("__eh_frame"),
        SectionKind.ReadOnlyData,
        {
          $: "MachO",
          flags: (macho.S_COALESCED | macho.S_ATTR_LIVE_SUPPORT | macho.S_ATTR_NO_TOC | macho.S_ATTR_STRIP_STATIC_SYMS) >>> 0,
        },
      ];
  }
}

// crate: object-0.39.1/src/write/macho.rs:160 macho_section_flags
export function macho_section_flags(section: Section): SectionFlags {
  let flags: number;
  switch (section.kind.$) {
    case "Text":
      flags = (macho.S_ATTR_PURE_INSTRUCTIONS | macho.S_ATTR_SOME_INSTRUCTIONS) >>> 0;
      break;
    case "Data":
      flags = 0;
      break;
    case "ReadOnlyData":
    case "ReadOnlyDataWithRel":
      flags = 0;
      break;
    case "ReadOnlyString":
      flags = macho.S_CSTRING_LITERALS;
      break;
    case "UninitializedData":
    case "Common":
      flags = macho.S_ZEROFILL;
      break;
    case "Tls":
      flags = macho.S_THREAD_LOCAL_REGULAR;
      break;
    case "UninitializedTls":
      flags = macho.S_THREAD_LOCAL_ZEROFILL;
      break;
    case "TlsVariables":
      flags = macho.S_THREAD_LOCAL_VARIABLES;
      break;
    case "Debug":
    case "DebugString":
      flags = macho.S_ATTR_DEBUG;
      break;
    case "OtherString":
      flags = macho.S_CSTRING_LITERALS;
      break;
    case "Other":
    case "Linker":
    case "Metadata":
      flags = 0;
      break;
    case "Note":
    case "Unknown":
    case "Elf":
      return SectionFlags.None;
  }
  return { $: "MachO", flags };
}

// crate: object-0.39.1/src/write/macho.rs:180 macho_symbol_flags
export function macho_symbol_flags(symbol: Symbol): SymbolFlags {
  let n_desc = 0;
  if (symbol.weak) {
    if (symbol.is_undefined()) {
      n_desc |= macho.N_WEAK_REF;
    } else {
      n_desc |= macho.N_WEAK_DEF;
    }
  }
  // TODO: include n_type
  return { $: "MachO", n_desc };
}

// crate: object-0.39.1/src/write/macho.rs:193 macho_tlv_bootstrap
export function macho_tlv_bootstrap(_self: Object): never {
  // PORT: only `macho_add_thread_var` calls this, and `add_symbol` is not ported (mod.ts).
  return unported("object::write::Object::macho_tlv_bootstrap (Mach-O TLS symbols)");
}

/// Create the `__thread_vars` entry for a TLS variable.
///
/// The symbol given by `symbol_id` will be updated to point to this entry.
///
/// A new `SymbolId` will be returned. The caller must update this symbol
/// to point to the initializer.
///
/// If `symbol_id` is not for a TLS variable, then it is returned unchanged.
// crate: object-0.39.1/src/write/macho.rs:221 macho_add_thread_var
export function macho_add_thread_var(_self: Object, _symbol_id: number): never {
  // PORT: only `set_symbol_data` calls this, and it is not ported (mod.ts): rustc's wrapper files add no symbols.
  return unported("object::write::Object::macho_add_thread_var (Mach-O TLS symbols)");
}

// crate: object-0.39.1/src/write/macho.rs:291 macho_translate_relocation
export function macho_translate_relocation(_self: Object): never {
  // PORT: only `add_relocation_internal` calls this, and relocations are not ported (mod.ts).
  return unported("object::write::Object::macho_translate_relocation (Mach-O relocations)");
}

// crate: object-0.39.1/src/write/macho.rs:375 macho_adjust_addend
export function macho_adjust_addend(_self: Object): never {
  // PORT: only `add_relocation_internal` calls this, and relocations are not ported (mod.ts).
  return unported("object::write::Object::macho_adjust_addend (Mach-O relocations)");
}

// crate: object-0.39.1/src/write/macho.rs:420 macho_relocation_size
export function macho_relocation_size(_self: Object): never {
  // PORT: only `write_relocation_addend` calls this, and relocations are not ported (mod.ts).
  return unported("object::write::Object::macho_relocation_size (Mach-O relocations)");
}

/** `{:?}` of `Option<SubArchitecture>`. */
function debug_sub_architecture(s: string | undefined): string {
  return s === undefined ? "None" : `Some(${s})`;
}

/** `u64::trailing_zeros` of a power of two (a section alignment). */
function trailing_zeros(v: number): number {
  // PORT: `align` is a power of two and a `number`; counted by halving, so it is exact above 2^32 too.
  if (v === 0) return 64;
  let n = 0;
  while (v % 2 === 0) {
    v /= 2;
    n += 1;
  }
  return n;
}

/** `&*self.symbols[index].name`'s `Ord` (`[u8]`, lexicographic). */
function cmp_bytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// crate: object-0.39.1/src/write/macho.rs:428 macho_write
export function macho_write(self: Object, buffer: WritableBuffer): Result<null> {
  const address_size_ = Architecture.address_size(self.architecture());
  if (address_size_ === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const address_size: AddressSize = address_size_;
  const endian = self.endian;
  const macho32 = new MachO32(endian);
  const macho64 = new MachO64(endian);
  let macho_: MachO;
  switch (address_size) {
    case "U8":
    case "U16":
    case "U32":
      macho_ = macho32;
      break;
    case "U64":
      macho_ = macho64;
      break;
  }
  const pointer_align = AddressSize.bytes(address_size);

  // Calculate offsets of everything, and build strtab.
  let offset = 0;

  // Calculate size of Mach-O header.
  offset += macho_.mach_header_size();

  // Calculate size of commands.
  let ncmds = 0;
  const command_offset = offset;

  // Calculate size of segment command and section headers.
  const segment_command_offset = offset;
  const segment_command_len = macho_.segment_command_size() + self.sections.length * macho_.section_header_size();
  offset += segment_command_len;
  ncmds += 1;

  // Calculate size of build version.
  const build_version_offset = offset;
  if (self.macho_build_version !== undefined) {
    const version = self.macho_build_version;
    offset += version.cmdsize();
    ncmds += 1;
  }

  // Calculate size of symtab command.
  const symtab_command_offset = offset;
  const symtab_command_len = macho.SymtabCommand.POD.size;
  offset += symtab_command_len;
  ncmds += 1;

  // Calculate size of dysymtab command.
  const dysymtab_command_offset = offset;
  const dysymtab_command_len = macho.DysymtabCommand.POD.size;
  offset += dysymtab_command_len;
  ncmds += 1;

  const sizeofcmds = offset - command_offset;

  // Calculate size of section data.
  // Section data can immediately follow the load commands without any alignment padding.
  const segment_file_offset = offset;
  const section_offsets: SectionOffsets[] = self.sections.map(() => ({ index: 0, offset: 0, address: 0, reloc_offset: 0, reloc_count: 0 }));
  let address = 0;
  for (const [index, section] of self.sections.entries()) {
    section_offsets[index]!.index = 1 + index;
    if (!section.is_bss()) {
      address = align_u64(address, section.align);
      section_offsets[index]!.address = address;
      section_offsets[index]!.offset = segment_file_offset + address;
      address += section.size;
    }
  }
  const segment_file_size = address;
  offset += address;
  for (const [index, section] of self.sections.entries()) {
    if (section.is_bss()) {
      // debug_assert!(section.data.is_empty());
      address = align_u64(address, section.align);
      section_offsets[index]!.address = address;
      address += section.size;
    }
  }

  // Partition symbols and add symbol strings to strtab.
  const strtab = new StringTable();
  const symbol_offsets: SymbolOffsets[] = self.symbols.map(() => ({ index: 0, str_id: undefined }));
  const local_symbols: number[] = [];
  const external_symbols: number[] = [];
  const undefined_symbols: number[] = [];
  for (const [index, symbol] of self.symbols.entries()) {
    // The unified API allows creating symbols that we don't emit, so filter
    // them out here.
    //
    // Since we don't actually emit the symbol kind, we validate it here too.
    switch (symbol.kind) {
      case "Text":
      case "Data":
      case "Tls":
      case "Unknown":
        break;
      case "Section":
        // AArch64 needs temporary section symbols for relative relocations.
        if (!(self.architecture() === "Aarch64" || self.architecture() === "Aarch64_Ilp32")) {
          continue;
        }
        break;
      case "File":
        continue;
      case "Label":
        return Err(new Error(`unimplemented symbol \`${symbol.name_str() ?? ""}\` kind ${symbol.kind}`));
    }
    if (symbol.name.length !== 0) {
      symbol_offsets[index]!.str_id = strtab.add(symbol.name);
    }
    if (symbol.is_undefined()) {
      undefined_symbols.push(index);
    } else if (symbol.is_local()) {
      local_symbols.push(index);
    } else {
      external_symbols.push(index);
    }
  }

  // PORT: `sort_by_key` is stable, as `Array.prototype.sort` is.
  external_symbols.sort((a, c) => cmp_bytes(self.symbols[a]!.name, self.symbols[c]!.name));
  undefined_symbols.sort((a, c) => cmp_bytes(self.symbols[a]!.name, self.symbols[c]!.name));

  // Count symbols.
  let nsyms = 0;
  for (const index of [...local_symbols, ...external_symbols, ...undefined_symbols]) {
    symbol_offsets[index]!.index = nsyms;
    nsyms += 1;
  }

  // Calculate size of relocations.
  for (const [index, section] of self.sections.entries()) {
    // PORT: `1 + usize::from(reloc.addend != 0) + usize::from(reloc.subtractor.is_some())` per relocation: there are none.
    const count: number = section.relocations.length;
    if (count !== 0) {
      offset = align(offset, pointer_align);
      section_offsets[index]!.reloc_offset = offset;
      section_offsets[index]!.reloc_count = count;
      const len = count * RELOCATION_SIZE;
      offset += len;
    }
  }

  // Calculate size of symtab.
  offset = align(offset, pointer_align);
  const symtab_offset = offset;
  const symtab_len = nsyms * macho_.nlist_size();
  offset += symtab_len;

  // Calculate size of strtab.
  const strtab_offset = offset;
  // Start with null name.
  const strtab_data: number[] = [0];
  strtab.write(1, strtab_data);
  // `write_align(&mut strtab_data, pointer_align)` on the `Vec<u8>`.
  const strtab_len = align(strtab_data.length, pointer_align);
  while (strtab_data.length < strtab_len) strtab_data.push(0);
  offset += strtab_data.length;

  // Start writing.
  // PORT: `buffer.reserve(offset)` cannot fail on `VecBuffer` (the `Cannot allocate buffer` error).
  buffer.reserve(offset);

  // Write file header.
  let cputype: number;
  let cpusubtype: number;
  const sub_architecture = self.sub_architecture();
  const architecture = self.architecture();
  if (architecture === "Arm" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_ARM, macho.CPU_SUBTYPE_ARM_ALL];
  } else if (architecture === "Aarch64" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_ARM64, macho.CPU_SUBTYPE_ARM64_ALL];
  } else if (architecture === "Aarch64" && sub_architecture === "Arm64E") {
    [cputype, cpusubtype] = [macho.CPU_TYPE_ARM64, macho.CPU_SUBTYPE_ARM64E];
  } else if (architecture === "Aarch64_Ilp32" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_ARM64_32, macho.CPU_SUBTYPE_ARM64_32_V8];
  } else if (architecture === "I386" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_X86, macho.CPU_SUBTYPE_I386_ALL];
  } else if (architecture === "X86_64" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_X86_64, macho.CPU_SUBTYPE_X86_64_ALL];
  } else if (architecture === "PowerPc" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_POWERPC, macho.CPU_SUBTYPE_POWERPC_ALL];
  } else if (architecture === "PowerPc64" && sub_architecture === undefined) {
    [cputype, cpusubtype] = [macho.CPU_TYPE_POWERPC64, macho.CPU_SUBTYPE_POWERPC_ALL];
  } else {
    return Err(new Error(`unimplemented architecture ${architecture} with sub-architecture ${debug_sub_architecture(sub_architecture)}`));
  }

  if (self.macho_cpu_subtype !== undefined) {
    cpusubtype = self.macho_cpu_subtype;
  }

  let flags = self.flags.$ === "MachO" ? self.flags.flags : 0;
  if (self.macho_subsections_via_symbols) {
    flags = (flags | macho.MH_SUBSECTIONS_VIA_SYMBOLS) >>> 0;
  }
  macho_.write_mach_header(buffer, {
    cputype,
    cpusubtype,
    filetype: macho.MH_OBJECT,
    ncmds,
    sizeofcmds,
    flags,
  });

  // Write segment command.
  // debug_assert_eq!(segment_command_offset, buffer.len());
  void segment_command_offset;
  macho_.write_segment_command(buffer, {
    cmdsize: segment_command_len,
    segname: new Uint8Array(16),
    vmaddr: 0,
    vmsize: address,
    fileoff: segment_file_offset,
    filesize: segment_file_size,
    maxprot: macho.VM_PROT_READ | macho.VM_PROT_WRITE | macho.VM_PROT_EXECUTE,
    initprot: macho.VM_PROT_READ | macho.VM_PROT_WRITE | macho.VM_PROT_EXECUTE,
    nsects: self.sections.length,
    flags: 0,
  });

  // Write section headers.
  for (const [index, section] of self.sections.entries()) {
    const sectname = new Uint8Array(16);
    if (section.name.length > 16) {
      return Err(new Error(`section name \`${section.name_str() ?? ""}\` is too long`));
    }
    sectname.set(section.name);
    const segname = new Uint8Array(16);
    if (section.segment.length > 16) {
      return Err(new Error(`segment name \`${section.segment_str() ?? ""}\` is too long`));
    }
    segname.set(section.segment);
    const section_flags = self.section_flags(section);
    if (section_flags.$ !== "MachO") {
      return Err(new Error(`unimplemented section \`${section.name_str() ?? ""}\` kind ${debug_section_kind(section.kind)}`));
    }
    const flags = section_flags.flags;
    macho_.write_section(buffer, {
      sectname,
      segname,
      addr: section_offsets[index]!.address,
      size: section.size,
      offset: section_offsets[index]!.offset,
      align: trailing_zeros(section.align),
      reloff: section_offsets[index]!.reloc_offset,
      nreloc: section_offsets[index]!.reloc_count,
      flags,
    });
  }

  // Write build version.
  if (self.macho_build_version !== undefined) {
    const version = self.macho_build_version;
    // debug_assert_eq!(build_version_offset, buffer.len());
    void build_version_offset;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32(macho.LC_BUILD_VERSION)
        .u32(version.cmdsize())
        .u32(version.platform)
        .u32(version.minos)
        .u32(version.sdk)
        .u32(0)
        .done(),
    );
  }

  // Write symtab command.
  // debug_assert_eq!(symtab_command_offset, buffer.len());
  void symtab_command_offset;
  buffer.write_bytes(
    new FieldWriter(endian)
      .u32(macho.LC_SYMTAB)
      .u32(symtab_command_len)
      .u32(symtab_offset)
      .u32(nsyms)
      .u32(strtab_offset)
      .u32(strtab_data.length)
      .done(),
  );

  // Write dysymtab command.
  // debug_assert_eq!(dysymtab_command_offset, buffer.len());
  void dysymtab_command_offset;
  buffer.write_bytes(
    new FieldWriter(endian)
      .u32(macho.LC_DYSYMTAB) // cmd
      .u32(dysymtab_command_len) // cmdsize
      .u32(0) // ilocalsym
      .u32(local_symbols.length) // nlocalsym
      .u32(local_symbols.length) // iextdefsym
      .u32(external_symbols.length) // nextdefsym
      .u32(local_symbols.length + external_symbols.length) // iundefsym
      .u32(undefined_symbols.length) // nundefsym
      .u32(0) // tocoff
      .u32(0) // ntoc
      .u32(0) // modtaboff
      .u32(0) // nmodtab
      .u32(0) // extrefsymoff
      .u32(0) // nextrefsyms
      .u32(0) // indirectsymoff
      .u32(0) // nindirectsyms
      .u32(0) // extreloff
      .u32(0) // nextrel
      .u32(0) // locreloff
      .u32(0) // nlocrel
      .done(),
  );

  // Write section data.
  for (const [index, section] of self.sections.entries()) {
    if (!section.is_bss()) {
      buffer.resize(section_offsets[index]!.offset);
      buffer.write_bytes(section.data);
    }
  }
  // debug_assert_eq!(segment_file_offset + segment_file_size, buffer.len());

  // Write relocations.
  for (const section of self.sections) {
    if (section.relocations.length !== 0) {
      // PORT: `write_reloc` and the descending-order rule; `add_relocation` is not ported, so no section gets here.
      return unported("object::write::Object::macho_write (Mach-O relocations)");
    }
  }

  // Write symtab.
  write_align(buffer, pointer_align);
  // debug_assert_eq!(symtab_offset, buffer.len());
  for (const index of [...local_symbols, ...external_symbols, ...undefined_symbols]) {
    const symbol = self.symbols[index]!;
    // TODO: N_STAB
    let n_type: number;
    let n_sect: number;
    switch (symbol.section.$) {
      case "Undefined":
        [n_type, n_sect] = [macho.N_UNDF | macho.N_EXT, 0];
        break;
      case "Absolute":
        [n_type, n_sect] = [macho.N_ABS, 0];
        break;
      case "Section":
        [n_type, n_sect] = [macho.N_SECT, symbol.section._0 + 1];
        break;
      case "None":
      case "Common":
        return Err(new Error(`unimplemented symbol \`${symbol.name_str() ?? ""}\` section ${symbol.section.$}`));
    }
    switch (symbol.scope) {
      case "Unknown":
      case "Compilation":
        break;
      case "Linkage":
        n_type |= macho.N_EXT | macho.N_PEXT;
        break;
      case "Dynamic":
        n_type |= macho.N_EXT;
        break;
    }

    const symbol_flags = self.symbol_flags(symbol);
    if (symbol_flags.$ !== "MachO") {
      return Err(new Error(`unimplemented symbol \`${symbol.name_str() ?? ""}\` kind ${symbol.kind}`));
    }
    const n_desc = symbol_flags.n_desc;

    const section = SymbolSection.id(symbol.section);
    const n_value = section !== undefined ? section_offsets[section]!.address + symbol.value : symbol.value;

    const str_id = symbol_offsets[index]!.str_id;
    const n_strx = str_id !== undefined ? strtab.get_offset(str_id) : 0;

    macho_.write_nlist(buffer, {
      n_strx,
      n_type,
      n_sect: n_sect & 0xff,
      n_desc,
      n_value,
    });
  }

  // Write strtab.
  // debug_assert_eq!(strtab_offset, buffer.len());
  buffer.write_bytes(Uint8Array.from(strtab_data));

  // debug_assert_eq!(offset, buffer.len());

  return Ok(null);
}

/** `mem::size_of::<macho::Relocation<Endianness>>()`: two `U32`s. */
const RELOCATION_SIZE = 8;

/** `{:?}` of `SectionKind`. */
function debug_section_kind(k: SectionKind): string {
  return k.$ === "Elf" ? `Elf(${k._0})` : k.$;
}

/** The fields of a `repr(C)` Mach-O struct, in order, as bytes (`U16`/`U32`/`U64::new(endian, ..)`). */
class FieldWriter {
  private readonly bytes: number[] = [];
  private readonly little: boolean;
  constructor(endian: Endianness) {
    this.little = endian === "Little";
  }
  u8(v: number): this {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.little ? this.u8(v).u8(v >>> 8) : this.u8(v >>> 8).u8(v);
  }
  u32(v: number): this {
    return this.little ? this.u8(v).u8(v >>> 8).u8(v >>> 16).u8(v >>> 24) : this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }
  u64(v: number): this {
    const hi = Math.floor(v / 0x1_0000_0000);
    const lo = v % 0x1_0000_0000;
    return this.little ? this.u32(lo).u32(hi) : this.u32(hi).u32(lo);
  }
  /** `U32::new(BigEndian, ..)`, whatever the file's endianness. */
  u32_be(v: number): this {
    return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v);
  }
  raw(v: Uint8Array): this {
    for (const x of v) this.u8(x);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

interface MachHeader {
  cputype: number;
  cpusubtype: number;
  filetype: number;
  ncmds: number;
  sizeofcmds: number;
  flags: number;
}

interface SegmentCommand {
  cmdsize: number;
  segname: Uint8Array;
  vmaddr: number;
  vmsize: number;
  fileoff: number;
  filesize: number;
  maxprot: number;
  initprot: number;
  nsects: number;
  flags: number;
}

export interface SectionHeader {
  sectname: Uint8Array;
  segname: Uint8Array;
  addr: number;
  size: number;
  offset: number;
  align: number;
  reloff: number;
  nreloc: number;
  flags: number;
}

interface Nlist {
  n_strx: number;
  n_type: number;
  n_sect: number;
  n_desc: number;
  n_value: number;
}

interface MachO {
  // crate: object-0.39.1/src/write/macho.rs:996 mach_header_size
  mach_header_size(): number;
  // crate: object-0.39.1/src/write/macho.rs:997 segment_command_size
  segment_command_size(): number;
  // crate: object-0.39.1/src/write/macho.rs:998 section_header_size
  section_header_size(): number;
  // crate: object-0.39.1/src/write/macho.rs:999 nlist_size
  nlist_size(): number;
  // crate: object-0.39.1/src/write/macho.rs:1000 write_mach_header
  write_mach_header(buffer: WritableBuffer, section: MachHeader): void;
  // crate: object-0.39.1/src/write/macho.rs:1001 write_segment_command
  write_segment_command(buffer: WritableBuffer, segment: SegmentCommand): void;
  // crate: object-0.39.1/src/write/macho.rs:1002 write_section
  write_section(buffer: WritableBuffer, section: SectionHeader): void;
  // crate: object-0.39.1/src/write/macho.rs:1003 write_nlist
  write_nlist(buffer: WritableBuffer, nlist: Nlist): void;
}

/** PORT: `E: Endian` is the `Endianness` value. */
class MachO32 implements MachO {
  constructor(readonly endian: Endianness) {}

  // crate: object-0.39.1/src/write/macho.rs:1011 mach_header_size
  mach_header_size(): number {
    return macho.MachHeader32.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1015 segment_command_size
  segment_command_size(): number {
    return macho.SegmentCommand32.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1019 section_header_size
  section_header_size(): number {
    return macho.Section32.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1023 nlist_size
  nlist_size(): number {
    return macho.Nlist32.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1027 write_mach_header
  write_mach_header(buffer: WritableBuffer, header: MachHeader): void {
    const endian = this.endian;
    const magic = endian === "Big" ? macho.MH_MAGIC : macho.MH_CIGAM;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32_be(magic)
        .u32(header.cputype)
        .u32(header.cpusubtype)
        .u32(header.filetype)
        .u32(header.ncmds)
        .u32(header.sizeofcmds)
        .u32(header.flags)
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1046 write_segment_command
  write_segment_command(buffer: WritableBuffer, segment: SegmentCommand): void {
    const endian = this.endian;
    // PORT: `as u32` truncations.
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32(macho.LC_SEGMENT)
        .u32(segment.cmdsize)
        .raw(segment.segname)
        .u32(segment.vmaddr % 0x1_0000_0000)
        .u32(segment.vmsize % 0x1_0000_0000)
        .u32(segment.fileoff % 0x1_0000_0000)
        .u32(segment.filesize % 0x1_0000_0000)
        .u32(segment.maxprot)
        .u32(segment.initprot)
        .u32(segment.nsects)
        .u32(segment.flags)
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1064 write_section
  write_section(buffer: WritableBuffer, section: SectionHeader): void {
    const endian = this.endian;
    buffer.write_bytes(
      new FieldWriter(endian)
        .raw(section.sectname)
        .raw(section.segname)
        .u32(section.addr % 0x1_0000_0000)
        .u32(section.size % 0x1_0000_0000)
        .u32(section.offset)
        .u32(section.align)
        .u32(section.reloff)
        .u32(section.nreloc)
        .u32(section.flags)
        .u32(0) // reserved1
        .u32(0) // reserved2
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1082 write_nlist
  write_nlist(buffer: WritableBuffer, nlist: Nlist): void {
    const endian = this.endian;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32(nlist.n_strx)
        .u8(nlist.n_type)
        .u8(nlist.n_sect)
        .u16(nlist.n_desc)
        .u32(nlist.n_value % 0x1_0000_0000)
        .done(),
    );
  }
}

/** PORT: `E: Endian` is the `Endianness` value. */
class MachO64 implements MachO {
  constructor(readonly endian: Endianness) {}

  // crate: object-0.39.1/src/write/macho.rs:1100 mach_header_size
  mach_header_size(): number {
    return macho.MachHeader64.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1104 segment_command_size
  segment_command_size(): number {
    return macho.SegmentCommand64.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1108 section_header_size
  section_header_size(): number {
    return macho.Section64.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1112 nlist_size
  nlist_size(): number {
    return macho.Nlist64.POD.size;
  }

  // crate: object-0.39.1/src/write/macho.rs:1116 write_mach_header
  write_mach_header(buffer: WritableBuffer, header: MachHeader): void {
    const endian = this.endian;
    const magic = endian === "Big" ? macho.MH_MAGIC_64 : macho.MH_CIGAM_64;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32_be(magic)
        .u32(header.cputype)
        .u32(header.cpusubtype)
        .u32(header.filetype)
        .u32(header.ncmds)
        .u32(header.sizeofcmds)
        .u32(header.flags)
        .u32(0) // reserved
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1136 write_segment_command
  write_segment_command(buffer: WritableBuffer, segment: SegmentCommand): void {
    const endian = this.endian;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32(macho.LC_SEGMENT_64)
        .u32(segment.cmdsize)
        .raw(segment.segname)
        .u64(segment.vmaddr)
        .u64(segment.vmsize)
        .u64(segment.fileoff)
        .u64(segment.filesize)
        .u32(segment.maxprot)
        .u32(segment.initprot)
        .u32(segment.nsects)
        .u32(segment.flags)
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1154 write_section
  write_section(buffer: WritableBuffer, section: SectionHeader): void {
    const endian = this.endian;
    buffer.write_bytes(
      new FieldWriter(endian)
        .raw(section.sectname)
        .raw(section.segname)
        .u64(section.addr)
        .u64(section.size)
        .u32(section.offset)
        .u32(section.align)
        .u32(section.reloff)
        .u32(section.nreloc)
        .u32(section.flags)
        .u32(0) // reserved1
        .u32(0) // reserved2
        .u32(0) // reserved3
        .done(),
    );
  }

  // crate: object-0.39.1/src/write/macho.rs:1173 write_nlist
  write_nlist(buffer: WritableBuffer, nlist: Nlist): void {
    const endian = this.endian;
    buffer.write_bytes(
      new FieldWriter(endian)
        .u32(nlist.n_strx)
        .u8(nlist.n_type)
        .u8(nlist.n_sect)
        .u16(nlist.n_desc)
        .u64(nlist.n_value)
        .done(),
    );
  }
}
