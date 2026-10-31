// The derived codecs of compiler/rustc_middle/src/middle/exported_symbols.rs (generated into rustc_middle/decodable.gen.ts
// from rustc_macros serialize.rs): the variant index as a `u8`, then the fields in declaration order. Rmeta bytes against
// the oracle are the metadata suites'.
import { expect, test } from "bun:test";
import { MAGIC_END_BYTES, MemDecoder } from "../../rustc_serialize/opaque.ts";
import { MemEncoder } from "../../rustc_serialize/opaque/mem_encoder.ts";
import { unwrap_result } from "../../std/result.ts";
import { decode_ExportedSymbol, decode_SymbolExportInfo, encode_ExportedSymbol, encode_SymbolExportInfo } from "../decodable.gen.ts";
import type { TyDecoder, TyEncoder } from "../ty/codec.ts";
import { SymbolName } from "../ty/mod.ts";
import type { SymbolExportInfo } from "./exported_symbols.ts";

const decoder = (bytes: readonly number[]): TyDecoder =>
  unwrap_result(MemDecoder.new(Uint8Array.from([...bytes, ...MAGIC_END_BYTES]), 0)) as unknown as TyDecoder;

test("SymbolExportInfo: level, kind, used, rustc_std_internal_symbol", () => {
  const e = MemEncoder.new();
  const info: SymbolExportInfo = { level: "Rust", kind: "Tls", used: true, rustc_std_internal_symbol: false };
  encode_SymbolExportInfo(info, e as unknown as TyEncoder);
  // Rust = 1 (of C, Rust), Tls = 2 (of Text, Data, Tls), the two bools as u8.
  const bytes = [...e.finish()];
  expect(bytes).toEqual([1, 2, 1, 0]);
  expect(decode_SymbolExportInfo(decoder(bytes))).toEqual(info);
});

test("ExportedSymbol::NoDefId: tag 6, then the name's emit_str (LEB128 length, bytes, STR_SENTINEL 0xc1)", () => {
  const e = MemEncoder.new();
  encode_ExportedSymbol({ $: "NoDefId", _0: new SymbolName("ab") }, e as unknown as TyEncoder);
  expect([...e.finish()]).toEqual([6, 2, 0x61, 0x62, 0xc1]);
});

test("ExportedSymbol: an unknown tag panics with the derive's message", () => {
  expect(() => decode_ExportedSymbol(decoder([7]))).toThrow("invalid enum variant tag while decoding `ExportedSymbol`, expected 0..7, actual 7");
});
