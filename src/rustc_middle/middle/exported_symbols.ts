// Port of compiler/rustc_middle/src/middle/exported_symbols.rs.
// PORT: hand-written types (rustc_middle types are hand-written). The derived `TyEncodable`/`TyDecodable`/`Encodable`/
// `Decodable` of these types are the metadata codec's (rmeta encoder/decoder lanes); `StableHash` and `Hash` are not
// ported (no incremental). Moved here from codegen_ssa lib.ts / back/symbol_export.ts (lane crateinfo-symbols).
import { type DefId, LOCAL_CRATE, lower_hex_StableCrateId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { TyCtxt } from "../ty/context.ts";
import type { GenericArgsRef } from "../ty/generic_args.ts";
import { Instance } from "../ty/instance.ts";
import { RawList } from "../ty/list.ts";
import type { SymbolName, Ty } from "../ty/mod.ts";

/// The SymbolExportLevel of a symbols specifies from which kinds of crates
/// the symbol will be exported. `C` symbols will be exported from any
/// kind of crate, including cdylibs which export very few things.
/// `Rust` will only be exported if the crate produced is a Rust
/// dylib.
// rustc-type: compiler/rustc_middle/src/middle/exported_symbols.rs:12 SymbolExportLevel
// #[derive(Eq, PartialEq, Debug, Copy, Clone, TyEncodable, TyDecodable, StableHash)]
export type SymbolExportLevel = "C" | "Rust";
export const SymbolExportLevel = {
  C: "C",
  Rust: "Rust",
  // rustc: compiler/rustc_middle/src/middle/exported_symbols.rs:18 is_below_threshold
  is_below_threshold(self: SymbolExportLevel, threshold: SymbolExportLevel): boolean {
    return (
      threshold === "Rust" || // export everything from Rust dylibs
      self === "C"
    );
  },
} as const;

/// Kind of exported symbols.
// rustc-type: compiler/rustc_middle/src/middle/exported_symbols.rs:26 SymbolExportKind
// #[derive(Eq, PartialEq, Debug, Copy, Clone, Encodable, Decodable, StableHash, Hash)]
export type SymbolExportKind = "Text" | "Data" | "Tls";
export const SymbolExportKind = { Text: "Text", Data: "Data", Tls: "Tls" } as const;

/// The `SymbolExportInfo` of a symbols specifies symbol-related information
/// that is relevant to code generation and linking.
///
/// The difference between `used` and `rustc_std_internal_symbol` is that the
/// former is exported by LTO while the latter isn't.
// rustc-type: compiler/rustc_middle/src/middle/exported_symbols.rs:38 SymbolExportInfo
// #[derive(Eq, PartialEq, Debug, Copy, Clone, TyEncodable, TyDecodable, StableHash)]
export interface SymbolExportInfo {
  level: SymbolExportLevel;
  kind: SymbolExportKind;
  /// Was the symbol marked as `#[used(compiler)]` or `#[used(linker)]`?
  used: boolean;
  /// Was the symbol marked as `#[rustc_std_internal_symbol]`?
  /// We also use this for externally implementable items.
  rustc_std_internal_symbol: boolean;
}

// rustc-type: compiler/rustc_middle/src/middle/exported_symbols.rs:49 ExportedSymbol
// #[derive(Eq, PartialEq, Debug, Copy, Clone, TyEncodable, TyDecodable, StableHash)]
export type ExportedSymbol =
  | { readonly $: "NonGeneric"; readonly _0: DefId }
  | { readonly $: "Generic"; readonly _0: DefId; readonly _1: GenericArgsRef }
  | { readonly $: "DropGlue"; readonly _0: Ty }
  | { readonly $: "AsyncDropGlueCtorShim"; readonly _0: Ty }
  | { readonly $: "AsyncDropGlue"; readonly _0: DefId; readonly _1: Ty }
  | { readonly $: "ThreadLocalShim"; readonly _0: DefId }
  | { readonly $: "NoDefId"; readonly _0: SymbolName };

export const ExportedSymbol = {
  /// This is the symbol name of an instance if it is instantiated in the
  /// local crate.
  // rustc: compiler/rustc_middle/src/middle/exported_symbols.rs:62 symbol_name_for_local_instance
  symbol_name_for_local_instance(self: ExportedSymbol, tcx: TyCtxt): SymbolName {
    switch (self.$) {
      case "NonGeneric":
        return tcx.symbol_name(Instance.mono(tcx, self._0)) as SymbolName;
      case "Generic":
        return tcx.symbol_name(Instance.new_raw(self._0, self._1)) as SymbolName;
      case "DropGlue":
        return tcx.symbol_name(Instance.resolve_drop_glue(tcx, self._0)) as SymbolName;
      case "AsyncDropGlueCtorShim":
        return tcx.symbol_name(Instance.resolve_async_drop_in_place(tcx, self._0)) as SymbolName;
      case "AsyncDropGlue":
        return tcx.symbol_name(Instance.resolve_async_drop_in_place_poll(tcx, self._0, self._1)) as SymbolName;
      case "ThreadLocalShim":
        return tcx.symbol_name({
          def: { $: "Shim", _0: { $: "ThreadLocal", _0: self._0 } },
          args: RawList.empty(),
        }) as SymbolName;
      case "NoDefId":
        return self._0;
    }
  },
} as const;

// rustc: compiler/rustc_middle/src/middle/exported_symbols.rs:86 metadata_symbol_name
export function metadata_symbol_name(tcx: TyCtxt): string {
  // PORT: `{:08x}` on `StableCrateId` (its `LowerHex` forwards the formatter to the `u64`): zero-padded to 8 digits.
  return `rust_metadata_${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}_${lower_hex_StableCrateId(tcx.stable_crate_id(LOCAL_CRATE), PLAIN).padStart(8, "0")}`;
}
