// Lane encode-span-hygiene (plan-m5 wave 32): `SpanEncoder for EncodeContext` (encoder.rs:151-244), `bytes_needed`
// (:254), `SpanData`'s encoding (:259), `encode_symbol_or_byte_symbol` (:529), `encode_source_map` (:581) and
// `encode_hygiene` (:2036).
// Each is checked by a round trip: encode with the port's `EncodeContext` (over a `MemEncoder`), decode with the
// port's `MetadataDecodeContext` (decoder.rs, lanes rmeta-decoder-a / span-decode) over a stand-in `CrateMetadata`
// that has only what those decoders read (the crate number map, the hygiene tables, `imported_source_file`), and
// compare. Some byte layouts (span tags, shorthands, symbol tags) are also checked against hand-computed bytes.
import { expect, test } from "bun:test";
import "../lib.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { MAGIC_END_BYTES, MemEncoder, type FileEncoder } from "../../rustc_serialize/opaque.ts";
import { decode_u32, encode_u32 } from "../../rustc_serialize/serialize.ts";
import { decode_SourceFile } from "../../rustc_span/lib.ts";
import { CrateNum, DefId, DefIndex, LOCAL_CRATE, LocalDefId, ModId, StableCrateId } from "../../rustc_span/def_id.ts";
import {
  debug_ExpnData,
  ExpnData,
  ExpnHash,
  ExpnId,
  HygieneData,
  HygieneDecodeContext,
  HygieneEncodeContext,
  register_local_expn_id,
  SyntaxContext,
  Transparency,
} from "../../rustc_span/hygiene.ts";
import {
  StableSourceFileId,
  BytePos,
  create_session_globals_then,
  decode_ByteSymbol,
  decode_CrateNum,
  decode_DefId,
  decode_ExpnId,
  decode_Span,
  decode_Symbol,
  decode_SyntaxContext,
  DUMMY_SP,
  encode_ByteSymbol,
  encode_CrateNum,
  encode_DefId,
  encode_ExpnId,
  encode_Span,
  encode_Symbol,
  encode_SyntaxContext,
  type FileName,
  RealFileName,
  RemapPathScopeComponents,
  type SourceFile,
  Span,
} from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { ByteSymbol, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { CrateMetadata_tcx_decoder, MetadataBlob, type CrateMetadata, type MetadataDecodeContext } from "./decoder.ts";
import { bytes_needed, EncodeContext } from "./encoder.ts";
import { decode_LazyValue, LazyState, type LazyTable, type LazyValue, type SyntaxContextTable, type ExpnDataTable, type ExpnHashTable } from "./mod.ts";
import { fse_Option_LazyValue } from "./table.ts";

const STABLE_CRATE_ID = StableCrateId.of(Hash64.new(0x1234_5678_9abc_def0n));

/** A `TyCtxt` with only what span / source-map encoding reads (`sess.source_map()`, `stable_crate_id`). */
function fake_tcx(sm: SourceMap): TyCtxt {
  return { sess: { source_map: () => sm }, stable_crate_id: (_: CrateNum) => STABLE_CRATE_ID } as unknown as TyCtxt;
}

/** An `EncodeContext` over a `MemEncoder`, as `encode_metadata` builds it (encoder.rs:2716). */
function ecx(sm: SourceMap | undefined, is_proc_macro = false): EncodeContext {
  const none = undefined as never;
  const files = sm?.files().deref() ?? [];
  const e = new EncodeContext(
    MemEncoder.new() as unknown as FileEncoder,
    none,
    sm === undefined ? none : fake_tcx(sm),
    none,
    none,
    LazyState.NoNode,
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    // `source_file_cache: (source_map_files[0].clone(), 0)`
    [files[0] as SourceFile, 0],
    new Map(),
    is_proc_macro,
    HygieneEncodeContext.default(),
    new Map(),
  );
  // positions start at 1 (`NonZero`); the real encoder starts with the header
  e.emit_u8(0xee);
  return e;
}
const finish = (e: EncodeContext): Uint8Array => (e.opaque as unknown as MemEncoder).finish();

interface Tables {
  syntax_contexts?: SyntaxContextTable;
  expn_data?: ExpnDataTable;
  expn_hashes?: ExpnHashTable;
}

/** The decoding side: a stand-in `CrateMetadata` (crate 1, whose encoded `LOCAL_CRATE` maps to 1) over `bytes`. */
function crate_metadata(bytes: Uint8Array, tables: Tables, imported: (index: number) => SourceFile): [CrateMetadata, TyCtxt] {
  const blob = new MetadataBlob(new Uint8Array([...bytes, ...MAGIC_END_BYTES]));
  const cnum = CrateNum.from_u32(1);
  const cdata = {
    cnum,
    blob: () => blob,
    alloc_decoding_state: { new_decoding_session: () => undefined },
    // `CrateMetadata::map_encoded_cnum_to_current`: LOCAL_CRATE is this crate, the others go through `cnum_map`
    map_encoded_cnum_to_current: (c: CrateNum) => (c === LOCAL_CRATE ? cnum : CrateNum.from_u32(CrateNum.as_u32(c) + 10)),
    hygiene_context: HygieneDecodeContext.default(),
    root: { name: () => Symbol.intern("enc"), is_proc_macro_crate: () => false, ...tables },
    imported_source_file: (_tcx: TyCtxt, index: number) => ({ translated_source_file: imported(index) }),
  };
  return [cdata as unknown as CrateMetadata, {} as TyCtxt];
}
const dcx = (m: [CrateMetadata, TyCtxt], pos = 1): MetadataDecodeContext => CrateMetadata_tcx_decoder(m, pos);
const no_files = (_: number): SourceFile => {
  throw new Error("no source files");
};

test("bytes_needed", () => {
  expect([0, 1, 255, 256, 65535, 65536, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1].map(bytes_needed)).toEqual([0, 1, 1, 2, 2, 3, 4, 5, 7]);
});

test("crate nums, def ids, local def ids, def keys round-trip; DefIndex and proc-macro CrateNums panic", () => {
  create_session_globals_then("Edition2021", [], undefined, () => {
    const e = ecx(undefined);
    const ids = [new DefId(DefIndex.from_u32(7), LOCAL_CRATE), new DefId(DefIndex.from_u32(300), CrateNum.from_u32(2))];
    for (const id of ids) encode_DefId(id, e);
    encode_CrateNum(CrateNum.from_u32(5), e);
    e.encode_local_def_id(LocalDefId.of(DefIndex.from_u32(9)));
    e.encode_def_key(DefIndex.from_u32(4), 77, encode_u32);
    e.encode_def_key(undefined, 78, encode_u32);
    // krate, index (u32 LEB128) ..
    expect([...finish(e)]).toEqual([0xee, 0, 7, 2, 0xac, 0x02, 5, 9, 1, 4, 77, 0, 78]);

    const d = dcx(crate_metadata(finish(e), {}, no_files));
    const got = [decode_DefId(d), decode_DefId(d)];
    expect(got.map((id) => [CrateNum.as_u32(id.krate), DefIndex.as_u32(id.index)])).toEqual([
      [1, 7],
      [12, 300],
    ]);
    expect(CrateNum.as_u32(decode_CrateNum(d))).toBe(15);
    expect(d.decode_local_def_id()).toBe(LocalDefId.of(DefIndex.from_u32(9)));

    expect(() => e.encode_def_index(DefIndex.from_u32(1))).toThrow("use LocalDefId or DefId or encode DefIndex manually");
    const p = ecx(undefined, true);
    encode_CrateNum(LOCAL_CRATE, p);
    expect(() => encode_CrateNum(CrateNum.from_u32(3), p)).toThrow("Attempted to encode non-local CrateNum crate3 for proc-macro crate");
  });
});

test("symbols and byte symbols: predefined index, string, then offset to the string", () => {
  create_session_globals_then("Edition2021", [], undefined, () => {
    const e = ecx(undefined);
    const a = Symbol.intern("not_a_predefined_symbol");
    const b = ByteSymbol.intern(new Uint8Array([0xff, 0x00, 0x61]));
    const syms = [kw.As, a, sym.core, a, a];
    for (const s of syms) encode_Symbol(s, e);
    encode_ByteSymbol(b, e);
    encode_ByteSymbol(b, e);
    const bytes = finish(e);
    // the first `a`: SYMBOL_STR at 1 + 2 (kw::As: tag + LEB128 index) = 3, the string at 4
    expect(bytes[3]).toBe(0); // SYMBOL_STR
    expect([...bytes.subarray(0, 3)]).toEqual([0xee, 2, Symbol.as_u32(kw.As)]);
    const after_str = 4 + 1 + "not_a_predefined_symbol".length + 1; // len, bytes, STR_SENTINEL
    expect(bytes[after_str]).toBe(2); // sym::core: SYMBOL_PREDEFINED
    const second = after_str + 1 + Math.ceil(Math.log2(Symbol.as_u32(sym.core) + 1) / 7);
    expect([...bytes.subarray(second, second + 2)]).toEqual([1, 4]); // SYMBOL_OFFSET, the string's position

    const d = dcx(crate_metadata(bytes, {}, no_files));
    expect(syms.map(() => decode_Symbol(d))).toEqual(syms);
    expect([decode_ByteSymbol(d), decode_ByteSymbol(d)]).toEqual([b, b]);
    expect(d.position()).toBe(bytes.length);
  });
});

/** Session A: two local files, one imported file, expansions and contexts the spans refer to. */
function session_a() {
  const sm = SourceMap.new(FilePathMapping.empty());
  const wd = FilePathMapping.empty().to_real_filename(RealFileName.empty(), "/home/u");
  const real = (p: string): FileName => ({ $: "Real", _0: FilePathMapping.empty().to_real_filename(wd, p) });
  const fa = sm.new_source_file(real("src/main.rs"), Str.from("fn main() {\n    let x = 1;\n}\n"));
  const fb = sm.new_source_file(
    { $: "Real", _0: FilePathMapping.new([["/home/u", "/remapped"]], RemapPathScopeComponents.all()).to_real_filename(wd, "/home/u/src/lib.rs") },
    Str.from("pub fn f() {}\n".repeat(40)),
  );
  const fc = sm.new_source_file({ $: "Anon", _0: Hash64.new(5n) }, Str.from("unused"));
  const fi = sm.new_imported_source_file(fa.name, fa.src_hash, undefined, fa.stable_id, fa.normalized_source_len, fa.unnormalized_source_len, CrateNum.from_u32(3), fa.lines_, [], [], 6);
  const at = (f: SourceFile, lo: number, hi: number, ctxt = SyntaxContext.root()): Span => Span.new(BytePos.add(f.start_pos, BytePos(lo)), BytePos.add(f.start_pos, BytePos(hi)), ctxt, undefined);

  const root = SyntaxContext.root();
  const e1 = register_local_expn_id(
    ExpnData.new({ $: "Macro", _0: "Bang", _1: sym.vec }, ExpnId.root(), at(fa, 16, 26), at(fb, 0, 13), [sym.core], "Edition2021", new DefId(DefIndex.from_u32(5), CrateNum.from_u32(2)), ModId.new_unchecked(new DefId(DefIndex.from_u32(0), LOCAL_CRATE)), false, true, false, false),
    ExpnHash.of(Fingerprint.new(0x1111n, 0x2222n)),
  );
  const c1 = SyntaxContext.apply_mark(root, e1, Transparency.SemiOpaque);
  const e2 = register_local_expn_id(
    ExpnData.new({ $: "Macro", _0: "Attr", _1: Symbol.intern("my_attr") }, e1, at(fa, 20, 22, c1), DUMMY_SP, undefined, "Edition2018", undefined, undefined, true, false, true, true),
    ExpnHash.of(Fingerprint.new(0x3333n, 0x4444n)),
  );
  const c2 = SyntaxContext.apply_mark(c1, e2, Transparency.Opaque);
  return { sm, fa, fb, fc, fi, at, e1, e2, c1, c2 };
}

test("spans: local / partial / dummy / foreign tags, shorthands; hygiene and source map tables round-trip", () => {
  create_session_globals_then("Edition2021", [], undefined, () => {
    const { sm, fa, fb, fi, at, e1, e2, c1, c2 } = session_a();
    const e = ecx(sm);

    const s_local = at(fa, 3, 7); // root ctxt, short length: tag only + lo + file index
    const s_long = at(fb, 14, 14 * 39); // length >= 31: stored separately; file b gets on-disk index 1
    const s_ctxt = at(fa, 16, 26, c2);
    const s_dummy = Span.with_ctxt(DUMMY_SP, c1);
    const s_partial = Span.new(BytePos.add(fa.start_pos, BytePos(2)), BytePos.add(fb.start_pos, BytePos(1)), SyntaxContext.root(), undefined);
    const spans = [s_local, s_long, s_ctxt, s_dummy, s_partial, s_local, s_long, s_ctxt];

    const start = e.position();
    encode_Span(s_local, e);
    // Local | root ctxt (0b100) | len 4 << 3; lo 3; metadata index 0
    expect([...finish(e).subarray(start)]).toEqual([0b00100100, 3, 0]);
    const positions = [start];
    for (const s of spans.slice(1)) {
      positions.push(e.position());
      encode_Span(s, e);
    }
    encode_ExpnId(e2, e);
    encode_SyntaxContext(c1, e);
    const values_end = e.position();
    // the second `s_local` is a shorthand to the first (at 1): its offset is not < 1, so the absolute position 1
    // (Indirect | absolute | 1 byte << 3, then 1 LE byte)
    expect([...finish(e).subarray(positions[5]!, positions[5]! + 2)]).toEqual([0b00001011, 1]);

    // a span in an imported file: Foreign, its metadata index and crate (bytes only: decoding needs the CStore)
    const f = ecx(sm);
    encode_Span(at(fi, 1, 4), f);
    expect([...finish(f).subarray(1)]).toEqual([0b00011101, 1, 6, 3]);
    expect([...f.required_source_files!.keys()]).toEqual([]);

    const [syntax_contexts, expn_data, expn_hashes] = e.encode_hygiene();
    const source_map = e.encode_source_map();
    expect(e.required_source_files).toBeUndefined();
    const bytes = finish(e);

    // ---- decode ----
    // the source map table: one `SourceFile` per on-disk index, in first-use order (a, b; c was never used)
    const m0 = crate_metadata(bytes, { syntax_contexts, expn_data, expn_hashes }, no_files);
    const files: SourceFile[] = [];
    for (let i = 0; i < source_map.len; i++) {
      const lazy = unwrap((source_map as LazyTable<number, number, LazyValue<SourceFile> | undefined>).get(fse_Option_LazyValue, m0[0], i));
      files.push(lazy.decode(m0, decode_SourceFile));
    }
    // the exported names drop the local part (`update_for_crate_metadata`: not remapped / fully remapped); the
    // session's own `SourceFile`s keep theirs (the encoder adapts clones)
    const real_names = (fs: SourceFile[]) => fs.map((f) => (f.name as { _0: RealFileName })._0);
    expect(real_names(files).map((n) => n.local)).toEqual([undefined, undefined]);
    expect(real_names(files).map((n) => n.maybe_remapped)).toEqual(real_names([fa, fb]).map((n) => n.maybe_remapped));
    expect(real_names([fa, fb]).every((n) => n.local !== undefined)).toBe(true);
    expect(files.map((f) => [f.src_hash, f.normalized_source_len, f.lines()])).toEqual([fa, fb].map((f) => [f.src_hash, f.normalized_source_len, f.lines()]));
    // the stable id includes the crate
    expect(files[0]!.stable_id.hash()).toEqual(StableSourceFileId.from_filename_for_export(files[0]!.name, STABLE_CRATE_ID).hash());
    expect(files[0]!.stable_id.hash()).not.toEqual(fa.stable_id.hash());
    expect(CrateNum.as_u32(files[0]!.cnum)).toBe(1);

    // spans decode to the same positions (the stand-in imports each file at its original start)
    const by_index = [fa, fb];
    const m = crate_metadata(bytes, { syntax_contexts, expn_data, expn_hashes }, (i) => by_index[i]!);
    const d = dcx(m);
    const got = spans.map(() => decode_Span(d));
    const got_e2 = decode_ExpnId(d);
    const got_c1 = decode_SyntaxContext(d);
    expect(d.position()).toBe(values_end);
    const lohi = (s: Span): number[] => [Span.lo(s), Span.hi(s)];
    expect(got.map(lohi)).toEqual(spans.map((s, i) => (i === 3 || i === 4 ? [0, 0] : lohi(s))));
    // the contexts are rebuilt from the tables: same marks, expansions now foreign (crate 1)
    const describe = (ctxt: SyntaxContext): string =>
      HygieneData.with((data) => {
        const out: string[] = [];
        for (let c = ctxt; !SyntaxContext.is_root(c); c = data.syntax_context_data[c]!.parent) {
          const scd = data.syntax_context_data[c]!;
          const ed = data.expn_data(scd.outer_expn);
          out.push(`${scd.outer_transparency} ${debug_ExpnData(ed, PLAIN).replace(/crate\d+::|#\d+|krate: crate\d+|DefId\([^)]*\)|span: [^,]*/g, "_")} ${data.expn_hash(scd.outer_expn)}`);
        }
        return out.join(" <- ");
      });
    expect(describe(Span.ctxt(got[2]!))).toBe(describe(c2));
    expect(describe(Span.ctxt(got[3]!))).toBe(describe(c1));
    expect(describe(got_c1)).toBe(describe(c1));
    expect(SyntaxContext.is_root(Span.ctxt(got[0]!))).toBe(true);
    expect(SyntaxContext.is_root(Span.ctxt(got[4]!))).toBe(true);
    expect(got_e2.krate).toBe(CrateNum.from_u32(1));
    expect(HygieneData.with((data) => data.expn_hash(got_e2))).toEqual(HygieneData.with((data) => data.expn_hash(e2)));
    const call_site = HygieneData.with((data) => data.expn_data(got_e2).call_site);
    expect(lohi(call_site)).toEqual(lohi(at(fa, 20, 22)));
    expect(describe(Span.ctxt(call_site))).toBe(describe(c1));
    void e1;
  });
});

test("a span shorthand closer than its target is a relative offset; both kinds decode through `with_position`", () => {
  create_session_globals_then("Edition2021", [], undefined, () => {
    const { sm, fa, at } = session_a();
    const e = ecx(sm);
    for (let i = 0; i < 99; i++) e.emit_u8(0);
    const s = at(fa, 12, 15);
    encode_Span(s, e); // at 100: [Local | root | 3 << 3, 12, 0]
    const p = e.position();
    encode_Span(s, e); // at 103: offset 3 < 100, relative
    expect([...finish(e).subarray(100)]).toEqual([0b00011100, 12, 0, 0b00001111, 3]);
    const bytes = finish(e);
    const d = dcx(crate_metadata(bytes, {}, () => fa), p);
    expect(decode_Span(d)).toBe(s);
    expect(d.position()).toBe(bytes.length);
  });
});
