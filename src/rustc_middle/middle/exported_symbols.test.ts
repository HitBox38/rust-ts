// The derived codecs of compiler/rustc_middle/src/middle/exported_symbols.rs (rustc_macros serialize.rs): the variant
// index as a `u8`, then the fields in declaration order. Rmeta bytes against the oracle are the metadata suites'.
import { expect, test } from "bun:test";
import { MAGIC_END_BYTES, MemDecoder } from "../../rustc_serialize/opaque.ts";
import { MemEncoder } from "../../rustc_serialize/opaque/mem_encoder.ts";
import type { TyDecoder, TyEncoder } from "../ty/codec.ts";
import { SymbolName } from "../ty/mod.ts";
import { decode_SymbolExportInfo, encode_ExportedSymbol, encode_SymbolExportInfo, type SymbolExportInfo } from "./exported_symbols.ts";
import { unwrap_result } from "../../std/result.ts";

test("SymbolExportInfo: level, kind, used, rustc_std_internal_symbol", () => {
  const e = MemEncoder.new();
  const info: SymbolExportInfo = { level: "Rust", kind: "Tls", used: true, rustc_std_internal_symbol: false };
  encode_SymbolExportInfo(info, e as unknown as TyEncoder);
  const bytes = e.finish();
  expect([...bytes]).toEqual([1, 2, 1, 0]);
  const d = unwrap_result(MemDecoder.new(Uint8Array.from([...bytes, ...MAGIC_END_BYTES]), 0));
  expect(decode_SymbolExportInfo(d as unknown as TyDecoder)).toEqual(info);
});

test("ExportedSymbol::NoDefId: tag 6, then the name's emit_str", () => {
  const e = MemEncoder.new();
  encode_ExportedSymbol({ $: "NoDefId", _0: new SymbolName("ab") }, e as unknown as TyEncoder);
  const plain = MemEncoder.new();
  plain.emit_str("ab");
  expect([...e.finish()]).toEqual([6, ...plain.finish()]);
});
