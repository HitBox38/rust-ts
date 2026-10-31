// Port of compiler/rustc_middle/src/middle/exported_symbols.rs.
// PORT: hand-written types (rustc_middle types are hand-written). The derived `TyEncodable`/`TyDecodable`/`Encodable`/
// `Decodable` of these types are the metadata codec's (rmeta encoder/decoder lanes); `StableHash` and `Hash` are not
// ported (no incremental). Moved here from codegen_ssa lib.ts / back/symbol_export.ts (lane crateinfo-symbols).
import { type DefId, LOCAL_CRATE, lower_hex_StableCrateId } from "../../rustc_span/def_id.ts";
import { decode_DefId, encode_DefId } from "../../rustc_span/lib.ts";
import { panic } from "../../std/panic.ts";
import type { Decoder, Encoder } from "../../rustc_serialize/serialize.ts";
import type { SpanDecoder, SpanEncoder } from "../../rustc_span/lib.ts";
import { decode_GenericArgs, decode_SymbolName, decode_Ty, encode_GenericArgs, encode_Ty, type TyDecoder, type TyEncoder } from "../ty/codec.ts";
import { encode_SymbolName } from "../ty/mod.ts";
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

// PORT: the derived `TyEncodable` / `TyDecodable` (fieldless, 2 variants: the variant index as `u8`).
export function encode_SymbolExportLevel(self: SymbolExportLevel, __encoder: TyEncoder): void {
  encode_variant_index(__encoder, SYMBOL_EXPORT_LEVEL_VARIANTS.indexOf(self), "SymbolExportLevel");
}
export function decode_SymbolExportLevel(__decoder: TyDecoder): SymbolExportLevel {
  return SYMBOL_EXPORT_LEVEL_VARIANTS[decode_variant_index(__decoder, SYMBOL_EXPORT_LEVEL_VARIANTS.length, "SymbolExportLevel")]!;
}
const SYMBOL_EXPORT_LEVEL_VARIANTS: readonly SymbolExportLevel[] = ["C", "Rust"];

/// Kind of exported symbols.
// rustc-type: compiler/rustc_middle/src/middle/exported_symbols.rs:26 SymbolExportKind
// #[derive(Eq, PartialEq, Debug, Copy, Clone, Encodable, Decodable, StableHash, Hash)]
export type SymbolExportKind = "Text" | "Data" | "Tls";
export const SymbolExportKind = { Text: "Text", Data: "Data", Tls: "Tls" } as const;

// PORT: the derived `Encodable` / `Decodable` (fieldless, 3 variants: the variant index as `u8`).
export function encode_SymbolExportKind(self: SymbolExportKind, __encoder: SpanEncoder): void {
  encode_variant_index(__encoder, SYMBOL_EXPORT_KIND_VARIANTS.indexOf(self), "SymbolExportKind");
}
export function decode_SymbolExportKind(__decoder: SpanDecoder): SymbolExportKind {
  return SYMBOL_EXPORT_KIND_VARIANTS[decode_variant_index(__decoder, SYMBOL_EXPORT_KIND_VARIANTS.length, "SymbolExportKind")]!;
}
const SYMBOL_EXPORT_KIND_VARIANTS: readonly SymbolExportKind[] = ["Text", "Data", "Tls"];

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

// PORT: the derived `TyEncodable` / `TyDecodable` (the fields in declaration order).
export function encode_SymbolExportInfo(self: SymbolExportInfo, __encoder: TyEncoder): void {
  encode_SymbolExportLevel(self.level, __encoder);
  encode_SymbolExportKind(self.kind, __encoder);
  __encoder.emit_bool(self.used);
  __encoder.emit_bool(self.rustc_std_internal_symbol);
}
export function decode_SymbolExportInfo(__decoder: TyDecoder): SymbolExportInfo {
  const level = decode_SymbolExportLevel(__decoder);
  const kind = decode_SymbolExportKind(__decoder);
  const used = __decoder.read_bool();
  const rustc_std_internal_symbol = __decoder.read_bool();
  return { level, kind, used, rustc_std_internal_symbol };
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

// PORT: the derived `TyEncodable`: the variant index as `u8` (7 variants), then the variant's fields in order.
export function encode_ExportedSymbol(self: ExportedSymbol, __encoder: TyEncoder): void {
  encode_variant_index(__encoder, EXPORTED_SYMBOL_VARIANTS.indexOf(self.$), "ExportedSymbol");
  switch (self.$) {
    case "NonGeneric":
      encode_DefId(self._0, __encoder);
      break;
    case "Generic":
      encode_DefId(self._0, __encoder);
      encode_GenericArgs(self._1, __encoder);
      break;
    case "DropGlue":
      encode_Ty(self._0, __encoder);
      break;
    case "AsyncDropGlueCtorShim":
      encode_Ty(self._0, __encoder);
      break;
    case "AsyncDropGlue":
      encode_DefId(self._0, __encoder);
      encode_Ty(self._1, __encoder);
      break;
    case "ThreadLocalShim":
      encode_DefId(self._0, __encoder);
      break;
    case "NoDefId":
      encode_SymbolName(self._0, __encoder);
      break;
  }
}
// PORT: the derived `TyDecodable`: the variant index as `u8`, then the variant's fields in order.
export function decode_ExportedSymbol(__decoder: TyDecoder): ExportedSymbol {
  switch (decode_variant_index(__decoder, EXPORTED_SYMBOL_VARIANTS.length, "ExportedSymbol")) {
    case 0:
      return { $: "NonGeneric", _0: decode_DefId(__decoder) };
    case 1: {
      const _0 = decode_DefId(__decoder);
      return { $: "Generic", _0, _1: decode_GenericArgs(__decoder) };
    }
    case 2:
      return { $: "DropGlue", _0: decode_Ty(__decoder) };
    case 3:
      return { $: "AsyncDropGlueCtorShim", _0: decode_Ty(__decoder) };
    case 4: {
      const _0 = decode_DefId(__decoder);
      return { $: "AsyncDropGlue", _0, _1: decode_Ty(__decoder) };
    }
    case 5:
      return { $: "ThreadLocalShim", _0: decode_DefId(__decoder) };
    default:
      return { $: "NoDefId", _0: decode_SymbolName(__decoder) };
  }
}
const EXPORTED_SYMBOL_VARIANTS: readonly ExportedSymbol["$"][] = [
  "NonGeneric",
  "Generic",
  "DropGlue",
  "AsyncDropGlueCtorShim",
  "AsyncDropGlue",
  "ThreadLocalShim",
  "NoDefId",
];

/** The derives' discriminant (rustc_macros serialize.rs): `emit_u8` (every enum here has fewer than `u8::MAX` variants). */
function encode_variant_index(e: Encoder, disc: number, ty_name: string): void {
  if (disc < 0) panic(`${ty_name}: not a variant`);
  e.emit_u8(disc);
}
/** The derives' `read_u8` tag, with their panic on an unknown one. */
function decode_variant_index(d: Decoder, len: number, ty_name: string): number {
  const tag = d.read_u8();
  if (tag >= len) {
    panic(`invalid enum variant tag while decoding \`${ty_name}\`, expected 0..${len}, actual ${tag}`);
  }
  return tag;
}

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
