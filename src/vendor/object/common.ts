// Port of object 0.39.1 `src/common.rs` (the enums the read path uses).
//
// Copyright (c) 2015 The Gimli Developers; licensed under MIT OR Apache-2.0 (object).
//
// PORT: `Architecture`, `SymbolKind`, `RelocationKind`, ... are not ported (unused on rustc's
// metadata read path).

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
