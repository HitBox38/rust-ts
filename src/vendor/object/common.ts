// Port of object 0.39.1 `src/common.rs` (the enums the read path uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `ComdatKind`, `RelocationKind`, `RelocationEncoding` and `RelocationFlags` came with the writer's relocations (lane
// vendor-object-write). `SegmentFlags` and `Permissions` are not ported: nothing reaches them.

/// A binary file format.
export type BinaryFormat = "Coff" | "Elf" | "MachO" | "Pe" | "Wasm" | "Xcoff";

/// The kind of a section.
export type SectionKind =
  /// The section kind is unknown.
  | { $: "Unknown" }
  /// An executable code section.
  ///
  /// Example ELF sections: `.text`
  ///
  /// Example Mach-O sections: `__TEXT/__text`
  | { $: "Text" }
  /// A data section.
  ///
  /// Example ELF sections: `.data`
  ///
  /// Example Mach-O sections: `__DATA/__data`
  | { $: "Data" }
  /// A read only data section.
  ///
  /// Example ELF sections: `.rodata`
  ///
  /// Example Mach-O sections: `__TEXT/__const`, `__DATA/__const`, `__TEXT/__literal4`
  | { $: "ReadOnlyData" }
  /// A read only data section with relocations.
  ///
  /// This is the same as either `Data` or `ReadOnlyData`, depending on the file format.
  /// This value is only used in the API for writing files. It is never returned when reading files.
  | { $: "ReadOnlyDataWithRel" }
  /// A loadable string section.
  ///
  /// Example ELF sections: `.rodata.str`
  ///
  /// Example Mach-O sections: `__TEXT/__cstring`
  | { $: "ReadOnlyString" }
  /// An uninitialized data section.
  ///
  /// Example ELF sections: `.bss`
  ///
  /// Example Mach-O sections: `__DATA/__bss`
  | { $: "UninitializedData" }
  /// An uninitialized common data section.
  ///
  /// Example Mach-O sections: `__DATA/__common`
  | { $: "Common" }
  /// A TLS data section.
  ///
  /// Example ELF sections: `.tdata`
  ///
  /// Example Mach-O sections: `__DATA/__thread_data`
  | { $: "Tls" }
  /// An uninitialized TLS data section.
  ///
  /// Example ELF sections: `.tbss`
  ///
  /// Example Mach-O sections: `__DATA/__thread_bss`
  | { $: "UninitializedTls" }
  /// A TLS variables section.
  ///
  /// This contains TLS variable structures, rather than the variable initializers.
  ///
  /// Example Mach-O sections: `__DATA/__thread_vars`
  | { $: "TlsVariables" }
  /// A non-loadable string section.
  ///
  /// Example ELF sections: `.comment`, `.debug_str`
  | { $: "OtherString" }
  /// Some other non-loadable section.
  ///
  /// Example ELF sections: `.debug_info`
  | { $: "Other" }
  /// Debug information.
  ///
  /// Example Mach-O sections: `__DWARF/__debug_info`
  | { $: "Debug" }
  /// Debug strings.
  ///
  /// This is the same as either `Debug` or `OtherString`, depending on the file format.
  /// This value is only used in the API for writing files. It is never returned when reading files.
  | { $: "DebugString" }
  /// Information for the linker.
  ///
  /// Example COFF sections: `.drectve`
  | { $: "Linker" }
  /// ELF note section.
  | { $: "Note" }
  /// Metadata such as symbols or relocations.
  ///
  /// Example ELF sections: `.symtab`, `.strtab`, `.group`
  | { $: "Metadata" }
  /// Some other ELF section type.
  ///
  /// This is the `sh_type` field in the section header.
  /// The meaning may be dependent on the architecture.
  | { $: "Elf"; _0: number };

export const SectionKind = {
  Unknown: { $: "Unknown" },
  Text: { $: "Text" },
  Data: { $: "Data" },
  ReadOnlyData: { $: "ReadOnlyData" },
  ReadOnlyDataWithRel: { $: "ReadOnlyDataWithRel" },
  ReadOnlyString: { $: "ReadOnlyString" },
  UninitializedData: { $: "UninitializedData" },
  Common: { $: "Common" },
  Tls: { $: "Tls" },
  UninitializedTls: { $: "UninitializedTls" },
  TlsVariables: { $: "TlsVariables" },
  OtherString: { $: "OtherString" },
  Other: { $: "Other" },
  Debug: { $: "Debug" },
  DebugString: { $: "DebugString" },
  Linker: { $: "Linker" },
  Note: { $: "Note" },
  Metadata: { $: "Metadata" },
} as const satisfies Record<string, SectionKind>;

/// The kind of a symbol.
export type SymbolKind = "Unknown" | "Text" | "Data" | "Section" | "File" | "Label" | "Tls";

/// A symbol scope.
export type SymbolScope = "Unknown" | "Compilation" | "Linkage" | "Dynamic";

/// A CPU architecture.
export type Architecture =
  | "Unknown"
  | "Aarch64"
  | "Aarch64_Ilp32"
  | "Alpha"
  | "Arm"
  | "Avr"
  | "Bpf"
  | "Csky"
  | "E2K32"
  | "E2K64"
  | "I386"
  | "X86_64"
  | "X86_64_X32"
  | "Hexagon"
  | "Hppa"
  | "LoongArch32"
  | "LoongArch64"
  | "M68k"
  | "Mips"
  | "Mips64"
  | "Mips64_N32"
  | "Msp430"
  | "PowerPc"
  | "PowerPc64"
  | "Riscv32"
  | "Riscv64"
  | "S390x"
  | "Sbf"
  | "Sharc"
  | "Sparc"
  | "Sparc32Plus"
  | "Sparc64"
  | "SuperH"
  | "Wasm32"
  | "Wasm64"
  | "Xtensa";

/// A CPU sub-architecture.
export type SubArchitecture = "Arm64E" | "Arm64EC";

/// The size of an address value for an architecture.
///
/// This may differ from the address size supported by the file format (such as for COFF).
export type AddressSize = "U8" | "U16" | "U32" | "U64";

export const AddressSize = {
  /// The size in bytes of an address value.
  // crate: object-0.39.1/src/common.rs:124 bytes
  bytes(self: AddressSize): number {
    switch (self) {
      case "U8":
        return 1;
      case "U16":
        return 2;
      case "U32":
        return 4;
      case "U64":
        return 8;
    }
  },
};

export const Architecture = {
  /// The size of an address value for this architecture.
  ///
  /// Returns `None` for unknown architectures.
  // crate: object-0.39.1/src/common.rs:65 address_size
  address_size(self: Architecture): AddressSize | undefined {
    switch (self) {
      case "Unknown":
        return undefined;
      case "Aarch64":
        return "U64";
      case "Aarch64_Ilp32":
        return "U32";
      case "Alpha":
        return "U64";
      case "Arm":
        return "U32";
      case "Avr":
        return "U8";
      case "Bpf":
        return "U64";
      case "Csky":
        return "U32";
      case "E2K32":
        return "U32";
      case "E2K64":
        return "U64";
      case "I386":
        return "U32";
      case "X86_64":
        return "U64";
      case "X86_64_X32":
        return "U32";
      case "Hexagon":
        return "U32";
      case "Hppa":
        return "U32";
      case "LoongArch32":
        return "U32";
      case "LoongArch64":
        return "U64";
      case "M68k":
        return "U32";
      case "Mips":
        return "U32";
      case "Mips64":
        return "U64";
      case "Mips64_N32":
        return "U32";
      case "Msp430":
        return "U16";
      case "PowerPc":
        return "U32";
      case "PowerPc64":
        return "U64";
      case "Riscv32":
        return "U32";
      case "Riscv64":
        return "U64";
      case "S390x":
        return "U64";
      case "Sbf":
        return "U64";
      case "Sharc":
        return "U32";
      case "Sparc":
        return "U32";
      case "Sparc32Plus":
        return "U32";
      case "Sparc64":
        return "U64";
      case "SuperH":
        return "U32";
      case "Wasm32":
        return "U32";
      case "Wasm64":
        return "U64";
      case "Xtensa":
        return "U32";
    }
  },
};

/// File flags that are specific to each file format.
export type FileFlags =
  /// No file flags.
  | { $: "None" }
  /// ELF file flags.
  | { $: "Elf"; os_abi: number; abi_version: number; e_flags: number }
  /// Mach-O file flags.
  | { $: "MachO"; flags: number }
  /// COFF file flags.
  | { $: "Coff"; characteristics: number }
  /// XCOFF file flags.
  | { $: "Xcoff"; f_flags: number };

/// Section flags that are specific to each file format.
export type SectionFlags =
  /// No section flags.
  | { $: "None" }
  /// ELF section flags.
  | { $: "Elf"; sh_flags: number }
  /// Mach-O section flags.
  | { $: "MachO"; flags: number }
  /// COFF section flags.
  | { $: "Coff"; characteristics: number }
  /// XCOFF section flags.
  | { $: "Xcoff"; s_flags: number };

export const SectionFlags = { None: { $: "None" } } as const satisfies Record<string, SectionFlags>;

/// Symbol flags that are specific to each file format.
/// PORT: `CoffSection` and `Xcoff` are not modelled: only the COFF and XCOFF writers, which stop `unported`, make them.
export type SymbolFlags = { $: "None" } | { $: "Elf"; st_info: number; st_other: number } | { $: "MachO"; n_desc: number };

/** `{:?}` of `SymbolFlags` (derived). */
export function debug_SymbolFlags(v: SymbolFlags): string {
  switch (v.$) {
    case "None":
      return "None";
    case "Elf":
      return `Elf { st_info: ${v.st_info}, st_other: ${v.st_other} }`;
    case "MachO":
      return `MachO { n_desc: ${v.n_desc} }`;
  }
}

/// The selection kind for a COMDAT section group.
///
/// This determines the way in which the linker resolves multiple definitions of the COMDAT
/// sections.
export type ComdatKind =
  /// The selection kind is unknown.
  | "Unknown"
  /// Multiple definitions are allowed.
  ///
  /// An arbitrary definition is selected, and the rest are removed.
  ///
  /// This is the only supported selection kind for ELF.
  | "Any"
  /// Multiple definitions are not allowed.
  ///
  /// This is used to group sections without allowing duplicates.
  | "NoDuplicates"
  /// Multiple definitions must have the same size.
  ///
  /// An arbitrary definition is selected, and the rest are removed.
  | "SameSize"
  /// Multiple definitions must match exactly.
  ///
  /// An arbitrary definition is selected, and the rest are removed.
  | "ExactMatch"
  /// Multiple definitions are allowed, and the largest is selected.
  ///
  /// An arbitrary definition with the largest size is selected, and the rest are removed.
  | "Largest"
  /// Multiple definitions are allowed, and the newest is selected.
  | "Newest";

/// The operation used to calculate the result of the relocation.
///
/// The relocation descriptions use the following definitions. Note that
/// these definitions probably don't match any ELF ABI.
///
/// * A - The value of the addend.
/// * G - The address of the symbol's entry within the global offset table.
/// * L - The address of the symbol's entry within the procedure linkage table.
/// * P - The address of the place of the relocation.
/// * S - The address of the symbol.
/// * GotBase - The address of the global offset table.
/// * Image - The base address of the image.
/// * Section - The address of the section containing the symbol.
///
/// 'XxxRelative' means 'Xxx + A - P'.  'XxxOffset' means 'S + A - Xxx'.
export type RelocationKind =
  /// The operation is unknown.
  | "Unknown"
  /// No relocation.
  ///
  /// Example: `elf::R_X86_64_NONE`
  | "None"
  /// S + A
  ///
  /// Example: `elf::R_X86_64_64`
  | "Absolute"
  /// S + A - P
  ///
  /// Example: `elf::R_X86_64_PC32`
  | "Relative"
  /// G + A - GotBase
  ///
  /// Example: `elf::R_X86_64_GOT32`
  | "Got"
  /// G + A - P
  ///
  /// Example: `elf::R_X86_64_GOTPCREL`
  | "GotRelative"
  /// GotBase + A - P
  ///
  /// Example: `elf::R_386_GOTPC`
  | "GotBaseRelative"
  /// S + A - GotBase
  ///
  /// Example: `elf::R_386_GOTOFF`
  | "GotBaseOffset"
  /// L + A - P
  ///
  /// Example: `elf::R_X86_64_PLT32`
  | "PltRelative"
  /// S + A - Image
  ///
  /// Example: `pe::IMAGE_REL_AMD64_ADDR32NB`
  | "ImageOffset"
  /// S + A - Section
  ///
  /// Example: `pe::IMAGE_REL_AMD64_SECREL`
  | "SectionOffset"
  /// The index of the section containing the symbol.
  ///
  /// Example: `pe::IMAGE_REL_AMD64_SECTION`
  | "SectionIndex";

/// Information about how the result of the relocation operation is encoded in the place.
///
/// This is usually architecture specific, such as specifying an addressing mode or
/// a specific instruction.
export type RelocationEncoding =
  /// The relocation encoding is unknown.
  | "Unknown"
  /// Generic encoding.
  | "Generic"
  /// x86 sign extension at runtime.
  ///
  /// Used with `RelocationKind::Absolute`.
  | "X86Signed"
  /// x86 rip-relative addressing.
  ///
  /// The `RelocationKind` must be PC relative.
  | "X86RipRelative"
  /// x86 rip-relative addressing in movq instruction.
  ///
  /// The `RelocationKind` must be PC relative.
  | "X86RipRelativeMovq"
  /// x86 call target.
  ///
  /// The `RelocationKind` must be PC relative.
  // This name matches Mach-O, but might have been better named `X86Call`.
  | "X86Branch"
  /// s390x PC-relative offset shifted right by one bit.
  ///
  /// The `RelocationKind` must be PC relative.
  | "S390xDbl"
  /// AArch64 call target.
  ///
  /// The `RelocationKind` must be PC relative.
  | "AArch64Call"
  /// LoongArch branch offset with two trailing zeros.
  ///
  /// The `RelocationKind` must be PC relative.
  | "LoongArchBranch"
  /// SHARC+ 48-bit Type A instruction
  ///
  /// (upstream lists the `R_SHARC_*` variants it represents)
  | "SharcTypeA"
  /// SHARC+ 32-bit Type B instruction
  ///
  /// (upstream lists the `R_SHARC_*` variants it represents)
  | "SharcTypeB"
  /// E2K 64-bit value stored in two LTS
  | "E2KLit"
  /// E2K 28-bit value stored in CS0
  | "E2KDisp";

/// Relocation fields that are specific to each file format and architecture.
export type RelocationFlags =
  /// Format independent representation.
  | {
      $: "Generic";
      /// The operation used to calculate the result of the relocation.
      kind: RelocationKind;
      /// Information about how the result of the relocation operation is encoded in the place.
      encoding: RelocationEncoding;
      /// The size in bits of the place of relocation.
      size: number;
    }
  /// ELF relocation fields.
  | { $: "Elf"; r_type: number }
  /// Mach-O relocation fields.
  | { $: "MachO"; r_type: number; r_pcrel: boolean; r_length: number }
  /// COFF relocation fields.
  | { $: "Coff"; typ: number }
  /// XCOFF relocation fields.
  | { $: "Xcoff"; r_rtype: number; r_rsize: number };

/** `{:?}` of `RelocationFlags` (derived). */
export function debug_RelocationFlags(v: RelocationFlags): string {
  switch (v.$) {
    case "Generic":
      return `Generic { kind: ${v.kind}, encoding: ${v.encoding}, size: ${v.size} }`;
    case "Elf":
      return `Elf { r_type: ${v.r_type} }`;
    case "MachO":
      return `MachO { r_type: ${v.r_type}, r_pcrel: ${v.r_pcrel}, r_length: ${v.r_length} }`;
    case "Coff":
      return `Coff { typ: ${v.typ} }`;
    case "Xcoff":
      return `Xcoff { r_rtype: ${v.r_rtype}, r_rsize: ${v.r_rsize} }`;
  }
}
