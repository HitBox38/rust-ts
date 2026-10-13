// Port of compiler/rustc_structures/src/native_lib_kind.rs
// Types are generated into native_lib_kind.gen.ts; methods live on the companion (PORTING §8).
import * as gen from "./native_lib_kind.gen.ts";

export * from "./native_lib_kind.gen.ts";

export type NativeLibKind = gen.NativeLibKind;

/** `#[derive(PartialEq)]` */
export function NativeLibKind_eq(a: NativeLibKind, b: NativeLibKind): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "Static": {
      const o = b as typeof a;
      return a.bundle === o.bundle && a.whole_archive === o.whole_archive && a.export_symbols === o.export_symbols;
    }
    case "Dylib":
    case "RawDylib":
    case "Framework":
      return a.as_needed === (b as typeof a).as_needed;
    default:
      return true;
  }
}

export const NativeLibKind = {
  ...gen.NativeLibKind,

  // rustc: compiler/rustc_structures/src/native_lib_kind.rs:45 has_modifiers
  has_modifiers(self: NativeLibKind): boolean {
    switch (self.$) {
      case "Static":
        return self.bundle !== undefined || self.whole_archive !== undefined || self.export_symbols !== undefined;
      case "Dylib":
      case "Framework":
      case "RawDylib":
        return self.as_needed !== undefined;
      case "Unspecified":
      case "LinkArg":
      case "WasmImportModule":
        return false;
    }
  },

  // rustc: compiler/rustc_structures/src/native_lib_kind.rs:59 is_statically_included
  is_statically_included(self: NativeLibKind): boolean {
    return self.$ === "Static";
  },

  // rustc: compiler/rustc_structures/src/native_lib_kind.rs:63 is_dllimport
  is_dllimport(self: NativeLibKind): boolean {
    return self.$ === "Dylib" || self.$ === "RawDylib" || self.$ === "Unspecified";
  },
};
