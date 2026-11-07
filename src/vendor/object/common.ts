// Port of object 0.39.1 `src/common.rs` (the enums the read path uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `RelocationKind`, ... are not ported (unused on rustc's metadata read path).

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
/// PORT: the writer has no symbols yet (write/mod.ts); `CoffSection` and `Xcoff` are not modelled.
export type SymbolFlags = { $: "None" } | { $: "Elf"; st_info: number; st_other: number } | { $: "MachO"; n_desc: number };
