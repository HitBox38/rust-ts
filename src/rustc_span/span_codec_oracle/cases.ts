// The cases of the `spancodec` probe (tools/probes/spancodec/main.rs), in the same order and with the
// same values, plus the test encoder/decoder: the probe's `ProbeEncoder` / `ProbeDecoder`, i.e. the
// SpanEncoder / SpanDecoder scheme of rustc_metadata's EncodeContext / DecodeContext without span and
// symbol shorthands, over rustc_serialize's MemEncoder / MemDecoder (see the probe's header).
import { MemDecoder } from "../../rustc_serialize/opaque.ts";
import { MemEncoder } from "../../rustc_serialize/opaque/mem_encoder.ts";
import { decode_tuple, decode_u32, decode_Vec, type Encodable, encode_tuple, encode_u32, encode_Vec } from "../../rustc_serialize/serialize.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { debug_int, debug_option, debug_vec, type Debug, PLAIN } from "../../std/fmt.ts";
import { Str } from "../../std/str.ts";
import { unwrap } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import {
  decode_ExpnData,
  decode_ExpnHash,
  decode_ExpnKind,
  decode_FileName,
  decode_Ident,
  decode_LocalModId,
  decode_ModId,
  decode_RealFileName,
  decode_Spanned,
  decode_StableCrateId,
  decode_StableSourceFileId,
  decode_Transparency,
  encode_ExpnData,
  encode_ExpnHash,
  encode_ExpnKind,
  encode_FileName,
  encode_Ident,
  encode_LocalModId,
  encode_ModId,
  encode_RealFileName,
  encode_Spanned,
  encode_StableCrateId,
  encode_StableSourceFileId,
  encode_Transparency,
} from "../decodable.gen.ts";
import {
  CrateNum,
  debug_CrateNum,
  debug_DefId,
  debug_DefIndex,
  debug_LocalDefId,
  debug_LocalModId,
  debug_ModId,
  debug_StableCrateId,
  decode_LocalDefId,
  DefId,
  DefIndex,
  encode_LocalDefId,
  LOCAL_CRATE,
  LocalDefId,
  LocalModId,
  ModId,
  StableCrateId,
} from "../def_id.ts";
import type { Edition } from "../edition.ts";
import {
  AstPass,
  debug_ExpnData,
  debug_ExpnId,
  debug_ExpnKind,
  debug_Transparency,
  decode_expn_id,
  decode_syntax_context,
  DesugaringKind,
  ExpnData,
  ExpnHash,
  ExpnId,
  ExpnKind,
  HygieneDecodeContext,
  HygieneEncodeContext,
  register_local_expn_id,
  SyntaxContext,
  type SyntaxContextKey,
  Transparency,
} from "../hygiene.ts";
import {
  AttrId,
  BytePos,
  debug_AttrId,
  debug_FileName,
  debug_MultiByteChar,
  debug_NormalizedPos,
  debug_OffsetOverflowError,
  debug_RealFileName,
  debug_RelativeBytePos,
  debug_RemapPathScopeComponents,
  debug_SourceFileHash,
  debug_Span,
  debug_Spanned,
  decode_AttrId,
  decode_BytePos,
  decode_ByteSymbol,
  decode_CrateNum,
  decode_DefId,
  decode_DefIndex,
  decode_ExpnId,
  decode_RemapPathScopeComponents,
  decode_SourceFile,
  decode_Span,
  decode_Symbol,
  decode_SyntaxContext,
  DUMMY_SP,
  encode_AttrId,
  encode_BytePos,
  encode_ByteSymbol,
  encode_CrateNum,
  encode_DefId,
  encode_DefIndex,
  encode_ExpnId,
  encode_RemapPathScopeComponents,
  encode_SourceFile,
  encode_Span,
  encode_Symbol,
  encode_SyntaxContext,
  type FileName,
  RealFileName,
  RemapPathScopeComponents,
  SourceFile,
  type SourceFileHashAlgorithm,
  Span,
  type SpanDecoder,
  type SpanEncoder,
  SpanEncoder_provided,
  type Spanned,
  type StableSourceFileId,
} from "../lib.ts";
import { FilePathMapping } from "../source_map.ts";
import { ByteSymbol, debug_ByteSymbol, debug_Ident, debug_Symbol, Ident, Symbol } from "../symbol.ts";

export const PROBE_NAME = "spancodec";

// ---- the encoder (probe `ProbeEncoder`) ----

export class ProbeEncoder implements SpanEncoder {
  readonly opaque = MemEncoder.new();
  constructor(readonly hygiene_ctxt: HygieneEncodeContext) {}

  emit_usize(v: number): void {
    this.opaque.emit_usize(v);
  }
  emit_u128(v: bigint): void {
    this.opaque.emit_u128(v);
  }
  emit_u64(v: bigint): void {
    this.opaque.emit_u64(v);
  }
  emit_u32(v: number): void {
    this.opaque.emit_u32(v);
  }
  emit_u16(v: number): void {
    this.opaque.emit_u16(v);
  }
  emit_u8(v: number): void {
    this.opaque.emit_u8(v);
  }
  emit_isize(v: number): void {
    this.opaque.emit_isize(v);
  }
  emit_i128(v: bigint): void {
    this.opaque.emit_i128(v);
  }
  emit_i64(v: bigint): void {
    this.opaque.emit_i64(v);
  }
  emit_i32(v: number): void {
    this.opaque.emit_i32(v);
  }
  emit_i16(v: number): void {
    this.opaque.emit_i16(v);
  }
  emit_i8(v: number): void {
    this.opaque.emit_i8(v);
  }
  emit_bool(v: boolean): void {
    this.opaque.emit_bool(v);
  }
  emit_char(v: number): void {
    this.opaque.emit_char(v);
  }
  emit_str(v: string): void {
    this.opaque.emit_str(v);
  }
  emit_byte_str(v: Uint8Array): void {
    this.opaque.emit_byte_str(v);
  }
  emit_raw_bytes(v: Uint8Array): void {
    this.opaque.emit_raw_bytes(v);
  }

  encode_span(span: Span): void {
    const data = Span.data(span);
    encode_BytePos(data.lo, this);
    encode_BytePos(data.hi, this);
    encode_SyntaxContext(data.ctxt, this);
  }
  encode_symbol(sym: Symbol): void {
    this.emit_str(Symbol.as_str(sym));
  }
  encode_byte_symbol(byte_sym: ByteSymbol): void {
    this.emit_byte_str(ByteSymbol.as_byte_str(byte_sym));
  }
  encode_expn_id(expn_id: ExpnId): void {
    if (expn_id.krate === LOCAL_CRATE) {
      this.hygiene_ctxt.schedule_expn_data_for_encoding(expn_id);
    }
    encode_CrateNum(expn_id.krate, this);
    this.emit_u32(expn_id.local_id);
  }
  encode_syntax_context(syntax_context: SyntaxContext): void {
    const idx = this.hygiene_ctxt.get_syntax_ctxt_encoding_index(syntax_context);
    encode_u32(idx, this);
  }
  encode_crate_num(crate_num: CrateNum): void {
    this.emit_u32(CrateNum.as_u32(crate_num));
  }
  encode_def_index(def_index: DefIndex): void {
    this.emit_u32(DefIndex.as_u32(def_index));
  }
  encode_def_id(def_id: DefId): void {
    encode_CrateNum(def_id.krate, this);
    this.emit_u32(DefIndex.as_u32(def_id.index));
  }
  encode_local_def_id(def_id: LocalDefId): void {
    this.emit_u32(DefIndex.as_u32(LocalDefId.local_def_index(def_id)));
  }
  encode_def_key<T>(parent: DefIndex | undefined, disambiguated_data: T, encode_T: Encodable<T>): void {
    SpanEncoder_provided.encode_def_key(this, parent, disambiguated_data, encode_T);
  }
}

// ---- the decoder (probe `ProbeDecoder`) ----

export class ProbeDecoder implements SpanDecoder {
  constructor(
    public opaque: MemDecoder,
    readonly hygiene_ctxt: HygieneDecodeContext,
    readonly ctxts: ReadonlyMap<number, number>,
    readonly expns: ReadonlyMap<number, readonly [number, number]>,
    readonly next_attr_id: { value: number },
  ) {}

  with_position<T>(pos: number, f: (d: ProbeDecoder) => T): T {
    const new_opaque = this.opaque.split_at(pos);
    const old_opaque = this.opaque;
    this.opaque = new_opaque;
    const r = f(this);
    this.opaque = old_opaque;
    return r;
  }

  read_usize(): number {
    return this.opaque.read_usize();
  }
  read_u128(): bigint {
    return this.opaque.read_u128();
  }
  read_u64(): bigint {
    return this.opaque.read_u64();
  }
  read_u32(): number {
    return this.opaque.read_u32();
  }
  read_u16(): number {
    return this.opaque.read_u16();
  }
  read_u8(): number {
    return this.opaque.read_u8();
  }
  read_isize(): number {
    return this.opaque.read_isize();
  }
  read_i128(): bigint {
    return this.opaque.read_i128();
  }
  read_i64(): bigint {
    return this.opaque.read_i64();
  }
  read_i32(): number {
    return this.opaque.read_i32();
  }
  read_i16(): number {
    return this.opaque.read_i16();
  }
  read_i8(): number {
    return this.opaque.read_i8();
  }
  read_bool(): boolean {
    return this.opaque.read_bool();
  }
  read_char(): number {
    return this.opaque.read_char();
  }
  read_str(): string {
    return this.opaque.read_str();
  }
  read_byte_str(): Uint8Array {
    return this.opaque.read_byte_str();
  }
  read_raw_bytes(len: number): Uint8Array {
    return this.opaque.read_raw_bytes(len);
  }
  peek_byte(): number {
    return this.opaque.peek_byte();
  }
  position(): number {
    return this.opaque.position();
  }

  decode_symbol(): Symbol {
    return Symbol.intern(this.read_str());
  }
  decode_byte_symbol(): ByteSymbol {
    return ByteSymbol.intern(this.read_byte_str());
  }
  decode_def_index(): DefIndex {
    return DefIndex.from_u32(this.read_u32());
  }
  decode_local_def_id(): LocalDefId {
    return LocalDefId.of(this.decode_def_index());
  }

  decode_span(): Span {
    const lo = decode_BytePos(this);
    const hi = decode_BytePos(this);
    const ctxt = decode_SyntaxContext(this);
    return Span.new(lo, hi, ctxt, undefined);
  }
  decode_expn_id(): ExpnId {
    const krate = decode_CrateNum(this);
    const index = decode_u32(this);
    return decode_expn_id(krate, index, (expn_id) => {
      const [data_pos, hash_pos] = unwrap(this.expns.get(expn_id.local_id));
      const expn_data = this.with_position(data_pos, (d) => decode_ExpnData(d));
      const expn_hash = this.with_position(hash_pos, (d) => decode_ExpnHash(d));
      return [expn_data, expn_hash];
    });
  }
  decode_syntax_context(): SyntaxContext {
    return decode_syntax_context(this, this.hygiene_ctxt, (d, id) =>
      d.with_position(unwrap(this.ctxts.get(id)), (d): SyntaxContextKey => decode_tuple(d, decode_SyntaxContext, decode_ExpnId, decode_Transparency)),
    );
  }
  decode_crate_num(): CrateNum {
    // The encoding crate's numbers, as seen from a crate that loaded it as crate 1.
    return CrateNum.from_u32(this.read_u32() + 1);
  }
  decode_def_id(): DefId {
    const krate = decode_CrateNum(this);
    const index = decode_DefIndex(this);
    return new DefId(index, krate);
  }
  decode_attr_id(): AttrId {
    const id = this.next_attr_id.value;
    this.next_attr_id.value += 1;
    return AttrId.from_u32(id);
  }
}

/** The `HygieneEncodeContext::encode` callbacks: `SyntaxContextKey`s, then local `ExpnData` + `ExpnHash`. */
export function encode_hygiene(
  e: ProbeEncoder,
  ctxts: Map<number, number>,
  expns: Map<number, [number, number]>,
): void {
  HygieneEncodeContext.encode(
    e.hygiene_ctxt,
    e,
    (e, idx, key) => {
      ctxts.set(idx, e.opaque.position());
      encode_tuple([...key] as [SyntaxContext, ExpnId, Transparency], e, encode_SyntaxContext, encode_ExpnId, encode_Transparency);
    },
    (e, expn, data, hash) => {
      const data_pos = e.opaque.position();
      encode_ExpnData(unwrap(data), e);
      const hash_pos = e.opaque.position();
      encode_ExpnHash(hash, e);
      expns.set(expn.local_id, [data_pos, hash_pos]);
    },
  );
}

// ---- the cases (probe `cases()` / `decoder_for`) ----

export interface Case {
  name: string;
  encode: (e: ProbeEncoder) => void;
  decode: (d: ProbeDecoder) => string;
}

const sp = (lo: number, hi: number, ctxt: SyntaxContext): Span => Span.new(BytePos(lo), BytePos(hi), ctxt, undefined);
const def_id = (krate: number, index: number): DefId => new DefId(DefIndex.from_u32(index), CrateNum.from_u32(krate));
const expn_hash = (a: bigint, b: bigint): ExpnHash => ExpnHash.of(Fingerprint.new(a, b));
const sym = (s: string): Symbol => Symbol.intern(s);

function case_<T>(name: string, v: T, encode_T: (v: T, e: ProbeEncoder) => void, decode_T: (d: ProbeDecoder) => T, debug_T: Debug<T>): Case {
  return { name, encode: (e) => encode_T(v, e), decode: (d) => debug_T(decode_T(d), PLAIN) };
}
function vec_case<T>(name: string, v: T[], encode_T: (v: T, e: ProbeEncoder) => void, decode_T: (d: ProbeDecoder) => T, debug_T: Debug<T>): Case {
  return case_(
    name,
    v,
    (v, e) => encode_Vec(v, e, encode_T as Encodable<T>),
    (d) => decode_Vec(d, decode_T),
    (v, f) => debug_vec(v, f, debug_T),
  );
}

/** The probe's `source_file_debug`. */
function source_file_debug(sf: SourceFile): string {
  const f = PLAIN;
  return (
    `name: ${debug_FileName(sf.name, f)}, src_hash: ${debug_SourceFileHash(sf.src_hash, f)}, ` +
    `checksum_hash: ${debug_option(sf.checksum_hash, f, debug_SourceFileHash)}, ` +
    `normalized_source_len: ${debug_RelativeBytePos(sf.normalized_source_len, f)}, unnormalized_source_len: ${sf.unnormalized_source_len}, ` +
    `lines: ${debug_vec(sf.lines(), f, debug_RelativeBytePos)}, multibyte_chars: ${debug_vec(sf.multibyte_chars, f, debug_MultiByteChar)}, ` +
    `normalized_pos: ${debug_vec(sf.normalized_pos, f, debug_NormalizedPos)}, stable_id: ${debug_StableSourceFileId(sf.stable_id)}, ` +
    `cnum: ${debug_CrateNum(sf.cnum, f)}`
  );
}

/** `#[derive(Debug)] struct StableSourceFileId(Hash128)` */
const debug_StableSourceFileId = (v: StableSourceFileId): string => `StableSourceFileId(${v.hash()})`;

function new_source_file(name: FileName, src: string, kind: SourceFileHashAlgorithm, checksum: SourceFileHashAlgorithm | undefined): SourceFile {
  return unwrap_result(SourceFile.new(name, Str.from(src), kind, checksum), debug_OffsetOverflowError);
}

/** Session A of the probe: the expansions and contexts the cases refer to, then the cases. */
export function cases(): Case[] {
  const root = SyntaxContext.root();
  const e1 = register_local_expn_id(
    ExpnData.new(
      { $: "Macro", _0: "Bang", _1: sym("m") },
      ExpnId.root(),
      sp(10, 20, root),
      sp(1, 9, root),
      undefined,
      "Edition2021",
      def_id(0, 5),
      ModId.new_unchecked(def_id(0, 0)),
      false,
      false,
      false,
      false,
    ),
    expn_hash(0x1111_2222_3333_4444n, 0x5555_6666_7777_8888n),
  );
  const c1 = SyntaxContext.apply_mark(root, e1, Transparency.SemiOpaque);
  const e2 = register_local_expn_id(
    ExpnData.new(
      { $: "Macro", _0: "Attr", _1: sym("attr_m") },
      e1,
      sp(30, 40, c1),
      sp(2, 3, root),
      [sym("x"), sym("core_intrinsics")],
      "Edition2018",
      def_id(2, 7),
      undefined,
      true,
      true,
      false,
      true,
    ),
    expn_hash(0x0102_0304_0506_0708n, 0xf0e0_d0c0_b0a0_9080n),
  );
  const c2 = SyntaxContext.apply_mark(c1, e2, Transparency.Opaque);
  const e3 = register_local_expn_id(ExpnData.default({ $: "AstPass", _0: AstPass.StdImports }, DUMMY_SP, "Edition2024", undefined, undefined), expn_hash(7n, 9n));
  const e4 = register_local_expn_id(
    ExpnData.new(
      { $: "Desugaring", _0: { $: "FormatLiteral", source: true } },
      e2,
      sp(50, 60, c2),
      DUMMY_SP,
      undefined,
      "Edition2021",
      undefined,
      ModId.new_unchecked(def_id(0, 3)),
      false,
      true,
      true,
      false,
    ),
    expn_hash(0xffff_ffff_ffff_ffffn, 1n << 63n),
  );
  const c3 = SyntaxContext.apply_mark(c2, e4, Transparency.Transparent);
  const c4 = SyntaxContext.apply_mark(root, e3, Transparency.Opaque);
  const c5 = SyntaxContext.apply_mark(c3, e1, Transparency.SemiOpaque);

  const wd = FilePathMapping.empty().to_real_filename(RealFileName.empty(), "/home/u");
  const plain = FilePathMapping.empty().to_real_filename(wd, "src/main.rs");
  const remapped = FilePathMapping.new([["/home/u", "/remapped"]], RemapPathScopeComponents.MACRO).to_real_filename(wd, "/home/u/src/lib.rs");
  const virt = RealFileName.from_virtual_path("/rustc/0000/library/core/src/lib.rs");

  const long_line = "x".repeat(300);
  const very_long_line = "y".repeat(70_000);
  const sf1 = new_source_file({ $: "Real", _0: plain }, `fn main() {\n    let é = '€';\r\n    // ${long_line}\r\n}\n﻿😀\n`, "Md5", "Sha256");
  const sf2 = new_source_file({ $: "Custom", _0: "<custom>" }, "", "Sha1", undefined);
  const sf3 = new_source_file({ $: "Real", _0: remapped }, `a\n${very_long_line}\nb`, "Sha256", "Sha256");
  const sf4 = new_source_file({ $: "Anon", _0: Hash64.new(42n) }, "x", "Md5", undefined);
  const stable_id = sf1.stable_id;

  const source_file_case = (name: string, sf: SourceFile): Case => ({
    name,
    encode: (e) => encode_SourceFile(sf, e),
    decode: (d) => source_file_debug(decode_SourceFile(d)),
  });

  return [
    case_("span_root", sp(10, 20, root), encode_Span, decode_Span, debug_Span),
    case_("span_c1", sp(30, 40, c1), encode_Span, decode_Span, debug_Span),
    case_("span_c3", sp(5, 5, c3), encode_Span, decode_Span, debug_Span),
    case_("span_c4", sp(100, 200, c4), encode_Span, decode_Span, debug_Span),
    case_("span_c1_again", sp(31, 41, c1), encode_Span, decode_Span, debug_Span),
    case_("span_c5", sp(0, 7, c5), encode_Span, decode_Span, debug_Span),
    case_("span_dummy", DUMMY_SP, encode_Span, decode_Span, debug_Span),
    case_("span_reversed", sp(9, 3, c2), encode_Span, decode_Span, debug_Span),
    vec_case("symbols", [sym("foo"), sym(""), sym("é€😀"), sym("self"), sym("foo")], encode_Symbol, decode_Symbol, debug_Symbol),
    vec_case(
      "byte_symbols",
      [ByteSymbol.intern(Uint8Array.from([0x00, 0xff, 0x20, 0x61, 0x62, 0x63])), ByteSymbol.intern(new TextEncoder().encode("foo"))],
      encode_ByteSymbol,
      decode_ByteSymbol,
      debug_ByteSymbol,
    ),
    vec_case("def_ids", [def_id(0, 0), def_id(0, 42), def_id(3, 7)], encode_DefId, decode_DefId, debug_DefId),
    vec_case("def_indices", [DefIndex.from_u32(0), DefIndex.from_u32(300)], encode_DefIndex, decode_DefIndex, debug_DefIndex),
    vec_case("local_def_ids", [LocalDefId.of(DefIndex.from_u32(17)), LocalDefId.of(DefIndex.from_u32(0))], encode_LocalDefId, decode_LocalDefId, debug_LocalDefId),
    vec_case("crate_nums", [CrateNum.from_u32(0), CrateNum.from_u32(5)], encode_CrateNum, decode_CrateNum, debug_CrateNum),
    vec_case("expn_ids", [ExpnId.root(), e1, e2, e3, e4, e2], encode_ExpnId, decode_ExpnId, debug_ExpnId),
    vec_case("idents", [Ident.new(sym("x"), sp(1, 2, c2)), Ident.new(sym("r#type"), sp(4, 8, c4))], encode_Ident, decode_Ident, debug_Ident),
    case_<Spanned<number>>(
      "spanned",
      { node: 7, span: sp(3, 4, c1) },
      (v, e) => encode_Spanned(v, e, encode_u32),
      (d) => decode_Spanned(d, decode_u32),
      (v, f) => debug_Spanned(v, f, debug_int),
    ),
    vec_case("attr_ids", [AttrId.from_u32(5), AttrId.from_u32(9), AttrId.from_u32(5)], encode_AttrId, decode_AttrId, debug_AttrId),
    vec_case(
      "remap_scopes",
      [RemapPathScopeComponents.empty(), RemapPathScopeComponents.MACRO | RemapPathScopeComponents.DEBUGINFO, RemapPathScopeComponents.all()],
      encode_RemapPathScopeComponents,
      decode_RemapPathScopeComponents,
      debug_RemapPathScopeComponents,
    ),
    vec_case("real_file_names", [plain, remapped, virt, wd], encode_RealFileName, decode_RealFileName, debug_RealFileName),
    vec_case<FileName>(
      "file_names",
      [
        { $: "Real", _0: plain },
        { $: "CfgSpec", _0: Hash64.new(1n) },
        { $: "Anon", _0: Hash64.new(0xffff_ffff_ffff_ffffn) },
        { $: "MacroExpansion", _0: Hash64.new(3n) },
        { $: "ProcMacroSourceCode", _0: Hash64.new(4n) },
        { $: "CliCrateAttr", _0: Hash64.new(5n) },
        { $: "Custom", _0: "custom ü" },
        { $: "DocTest", _0: virt, _1: -3 },
        { $: "InlineAsm", _0: Hash64.new(6n) },
      ],
      encode_FileName,
      decode_FileName,
      debug_FileName,
    ),
    case_("stable_source_file_id", stable_id, encode_StableSourceFileId, decode_StableSourceFileId, (v) => debug_StableSourceFileId(v)),
    source_file_case("source_file_crlf_multibyte", sf1),
    source_file_case("source_file_empty", sf2),
    source_file_case("source_file_long_line", sf3),
    source_file_case("source_file_one_line", sf4),
    vec_case<ExpnKind>(
      "expn_kinds",
      [ExpnKind.Root, { $: "Macro", _0: "Derive", _1: sym("D") }, { $: "AstPass", _0: AstPass.ProcMacroHarness }, { $: "Desugaring", _0: DesugaringKind.QuestionMark }],
      encode_ExpnKind,
      decode_ExpnKind,
      debug_ExpnKind,
    ),
    case_(
      "expn_data",
      ExpnData.new(
        { $: "Desugaring", _0: DesugaringKind.ForLoop },
        e4,
        sp(70, 80, c5),
        sp(1, 2, c4),
        [],
        "Edition2015",
        def_id(1, 1),
        ModId.new_unchecked(def_id(4, 0)),
        true,
        false,
        true,
        false,
      ),
      encode_ExpnData,
      decode_ExpnData,
      debug_ExpnData,
    ),
    vec_case("mod_ids", [ModId.new_unchecked(def_id(0, 0)), ModId.new_unchecked(def_id(2, 9))], encode_ModId, decode_ModId, debug_ModId),
    vec_case("local_mod_ids", [LocalModId.new_unchecked(LocalDefId.of(DefIndex.from_u32(4)))], encode_LocalModId, decode_LocalModId, debug_LocalModId),
    vec_case("transparencies", [Transparency.Transparent, Transparency.SemiOpaque, Transparency.Opaque], encode_Transparency, decode_Transparency, debug_Transparency),
    case_("stable_crate_id", StableCrateId.of(Hash64.new(0x1122_3344_5566_7788n)), encode_StableCrateId, decode_StableCrateId, debug_StableCrateId),
  ];
}

/** The probe's output (and the committed fixture). */
export interface ProbeOutput {
  bytes: string;
  values_end: number;
  case_ends: [string, number][];
  ctxts: [number, number][];
  expns: [number, number, number][];
  decoded: [string, string][];
  hygiene_a_verbose: string;
  hygiene: string;
  hygiene_verbose: string;
}

export const SESSION_A_EDITION: Edition = "Edition2021";
export const SESSION_B_EDITION: Edition = "Edition2024";

export function new_decoder(bytes: Uint8Array, out: ProbeOutput, hygiene_ctxt: HygieneDecodeContext): ProbeDecoder {
  return new ProbeDecoder(
    unwrap_result(MemDecoder.new(bytes, 0), () => "()"),
    hygiene_ctxt,
    new Map(out.ctxts.map(([i, p]) => [i, p])),
    new Map(out.expns.map(([i, a, b]) => [i, [a, b] as const])),
    { value: 0 },
  );
}
