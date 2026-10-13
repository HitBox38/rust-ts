//! Oracle probe for src/rustc_span/span_codec_oracle.test.ts (lane span-decode): rustc_span's
//! `SpanEncoder` / `SpanDecoder` / `BlobDecoder` and hygiene encoding/decoding, with the oracle
//! compiler's own `rustc_span` and `rustc_serialize`.
//!
//!   spancodec
//!
//! Session A builds a few expansions (`register_local_expn_id`) and syntax contexts
//! (`SyntaxContext::apply_mark`), then encodes a fixed list of values (spans with contexts, symbols,
//! def ids, expn ids, idents, file names, source files, expansion data, ...) with `ProbeEncoder`: a
//! `MemEncoder` plus a `HygieneEncodeContext`, whose `SpanEncoder` is the scheme of rustc_metadata's
//! `EncodeContext` without span/symbol shorthands (span = lo, hi, ctxt; ctxt = its encoding index;
//! expn id = crate + index, scheduling local ones; `LocalDefId` = its index). After the values,
//! `HygieneEncodeContext::encode` writes every reachable `SyntaxContextKey` and local
//! `ExpnData` + `ExpnHash`, recording their positions; then session A's `debug_hygiene_data(true)`.
//!
//! Session B (fresh globals) decodes the same bytes with `ProbeDecoder`, the decode side of that
//! scheme over `MemDecoder` (crate numbers are remapped `n -> n + 1`, as a foreign crate's metadata
//! is; contexts and expansions go through `hygiene::decode_syntax_context` / `decode_expn_id` with
//! a `HygieneDecodeContext`), and prints each decoded value with `{:?}`, then
//! `debug_hygiene_data(false)` and `debug_hygiene_data(true)`.
//!
//! Output: one JSON object (see `main`). src/rustc_span/span_codec_oracle/cases.ts builds the same
//! values in the same order.
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_hashes;
extern crate rustc_serialize;
extern crate rustc_span;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rustc_hashes::Hash64;
use rustc_serialize::opaque::mem_encoder::MemEncoder;
use rustc_serialize::opaque::{MAGIC_END_BYTES, MemDecoder};
use rustc_serialize::{Decodable, Decoder, Encodable, Encoder};
use rustc_span::def_id::{CrateNum, DefId, DefIndex, LOCAL_CRATE, LocalDefId, LocalModId, ModId, StableCrateId};
use rustc_span::edition::Edition;
use rustc_span::hygiene::{
    self, AstPass, DesugaringKind, ExpnData, ExpnHash, ExpnId, ExpnKind, HygieneDecodeContext,
    HygieneEncodeContext, MacroKind, SyntaxContext, SyntaxContextKey, Transparency,
};
use rustc_span::source_map::FilePathMapping;
use rustc_span::symbol::{ByteSymbol, Ident, Symbol};
use rustc_span::{
    AttrId, BlobDecoder, BytePos, DUMMY_SP, FileName, RealFileName, RemapPathScopeComponents, SourceFile,
    SourceFileHashAlgorithm, Span, SpanDecoder, SpanEncoder, Spanned, StableSourceFileId,
};

// ---- JSON output ----

fn js(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// `T::decode` of the given bytes (constructs values whose fields are private).
fn decode_from<T: for<'a> Decodable<MemDecoder<'a>>>(bytes: &[u8]) -> T {
    let mut data = bytes.to_vec();
    data.extend_from_slice(MAGIC_END_BYTES);
    let mut d = MemDecoder::new(&data, 0).unwrap();
    T::decode(&mut d)
}

fn expn_hash(a: u64, b: u64) -> ExpnHash {
    let mut bytes = a.to_le_bytes().to_vec();
    bytes.extend_from_slice(&b.to_le_bytes());
    decode_from(&bytes)
}

// ---- the encoder ----

struct ProbeEncoder<'a> {
    opaque: MemEncoder,
    hygiene_ctxt: &'a RefCell<HygieneEncodeContext>,
}

macro_rules! forward_emit {
    ($($m:ident($t:ty)),*) => {
        $(fn $m(&mut self, v: $t) { self.opaque.$m(v) })*
    };
}

impl Encoder for ProbeEncoder<'_> {
    forward_emit!(
        emit_usize(usize), emit_u128(u128), emit_u64(u64), emit_u32(u32), emit_u16(u16), emit_u8(u8),
        emit_isize(isize), emit_i128(i128), emit_i64(i64), emit_i32(i32), emit_i16(i16), emit_i8(i8),
        emit_bool(bool), emit_char(char), emit_str(&str), emit_byte_str(&[u8]), emit_raw_bytes(&[u8])
    );
}

impl SpanEncoder for ProbeEncoder<'_> {
    fn encode_span(&mut self, span: Span) {
        let data = span.data();
        data.lo.encode(self);
        data.hi.encode(self);
        data.ctxt.encode(self);
    }

    fn encode_symbol(&mut self, sym: Symbol) {
        self.emit_str(sym.as_str());
    }

    fn encode_byte_symbol(&mut self, byte_sym: ByteSymbol) {
        self.emit_byte_str(byte_sym.as_byte_str());
    }

    fn encode_expn_id(&mut self, expn_id: ExpnId) {
        if expn_id.krate == LOCAL_CRATE {
            self.hygiene_ctxt.borrow_mut().schedule_expn_data_for_encoding(expn_id);
        }
        expn_id.krate.encode(self);
        self.emit_u32(expn_id.local_id.as_u32());
    }

    fn encode_syntax_context(&mut self, syntax_context: SyntaxContext) {
        let idx = self.hygiene_ctxt.borrow_mut().get_syntax_ctxt_encoding_index(syntax_context);
        idx.encode(self);
    }

    fn encode_crate_num(&mut self, crate_num: CrateNum) {
        self.emit_u32(crate_num.as_u32());
    }

    fn encode_def_index(&mut self, def_index: DefIndex) {
        self.emit_u32(def_index.as_u32());
    }

    fn encode_def_id(&mut self, def_id: DefId) {
        def_id.krate.encode(self);
        self.emit_u32(def_id.index.as_u32());
    }

    fn encode_local_def_id(&mut self, def_id: LocalDefId) {
        self.emit_u32(def_id.local_def_index.as_u32());
    }
}

// ---- the decoder ----

struct ProbeDecoder<'a, 'h> {
    opaque: MemDecoder<'a>,
    hygiene_ctxt: &'h HygieneDecodeContext,
    ctxts: &'h BTreeMap<u32, usize>,
    expns: &'h BTreeMap<u32, (usize, usize)>,
    next_attr_id: &'h RefCell<u32>,
}

impl<'a, 'h> ProbeDecoder<'a, 'h> {
    fn with_position<T>(&mut self, pos: usize, f: impl FnOnce(&mut Self) -> T) -> T {
        let new_opaque = self.opaque.split_at(pos);
        let old_opaque = std::mem::replace(&mut self.opaque, new_opaque);
        let r = f(self);
        self.opaque = old_opaque;
        r
    }
}

macro_rules! forward_read {
    ($($m:ident -> $t:ty),*) => {
        $(fn $m(&mut self) -> $t { self.opaque.$m() })*
    };
}

impl Decoder for ProbeDecoder<'_, '_> {
    forward_read!(
        read_usize -> usize, read_u128 -> u128, read_u64 -> u64, read_u32 -> u32, read_u16 -> u16,
        read_u8 -> u8, read_isize -> isize, read_i128 -> i128, read_i64 -> i64, read_i32 -> i32,
        read_i16 -> i16
    );

    fn peek_byte(&self) -> u8 {
        self.opaque.peek_byte()
    }

    fn position(&self) -> usize {
        self.opaque.position()
    }

    fn read_raw_bytes(&mut self, len: usize) -> &[u8] {
        self.opaque.read_raw_bytes(len)
    }
}

impl BlobDecoder for ProbeDecoder<'_, '_> {
    fn decode_symbol(&mut self) -> Symbol {
        Symbol::intern(self.read_str())
    }

    fn decode_byte_symbol(&mut self) -> ByteSymbol {
        ByteSymbol::intern(self.read_byte_str())
    }

    fn decode_def_index(&mut self) -> DefIndex {
        DefIndex::from_u32(self.read_u32())
    }

    fn decode_local_def_id(&mut self) -> LocalDefId {
        LocalDefId { local_def_index: self.decode_def_index() }
    }
}

impl SpanDecoder for ProbeDecoder<'_, '_> {
    fn decode_span(&mut self) -> Span {
        let lo = BytePos::decode(self);
        let hi = BytePos::decode(self);
        let ctxt = SyntaxContext::decode(self);
        Span::new(lo, hi, ctxt, None)
    }

    fn decode_expn_id(&mut self) -> ExpnId {
        let krate = CrateNum::decode(self);
        let index = u32::decode(self);
        let expns = self.expns;
        hygiene::decode_expn_id(krate, index, |expn_id| {
            let (data_pos, hash_pos) = expns[&expn_id.local_id.as_u32()];
            let expn_data = self.with_position(data_pos, |d| ExpnData::decode(d));
            let expn_hash = self.with_position(hash_pos, |d| ExpnHash::decode(d));
            (expn_data, expn_hash)
        })
    }

    fn decode_syntax_context(&mut self) -> SyntaxContext {
        let hygiene_ctxt = self.hygiene_ctxt;
        let ctxts = self.ctxts;
        hygiene::decode_syntax_context(self, hygiene_ctxt, |this, id| {
            this.with_position(ctxts[&id], |d| SyntaxContextKey::decode(d))
        })
    }

    fn decode_crate_num(&mut self) -> CrateNum {
        // The encoding crate's numbers, as seen from a crate that loaded it as crate 1.
        CrateNum::from_u32(self.read_u32() + 1)
    }

    fn decode_def_id(&mut self) -> DefId {
        DefId { krate: Decodable::decode(self), index: Decodable::decode(self) }
    }

    fn decode_attr_id(&mut self) -> AttrId {
        let mut next = self.next_attr_id.borrow_mut();
        let id = *next;
        *next += 1;
        AttrId::from_u32(id)
    }
}

// ---- the cases ----

/// Each case: a name and its encoder (session A); `decoder_for(name)` decodes it (session B).
type Case = (&'static str, Box<dyn Fn(&mut ProbeEncoder<'_>)>);

macro_rules! case {
    ($name:expr, $t:ty, $v:expr) => {{
        let v: $t = $v;
        let enc: Box<dyn Fn(&mut ProbeEncoder<'_>)> = Box::new(move |e| v.encode(e));
        ($name, enc)
    }};
}

fn sp(lo: u32, hi: u32, ctxt: SyntaxContext) -> Span {
    Span::new(BytePos(lo), BytePos(hi), ctxt, None)
}

fn def_id(krate: u32, index: u32) -> DefId {
    DefId { krate: CrateNum::from_u32(krate), index: DefIndex::from_u32(index) }
}

fn source_file_debug(sf: &SourceFile) -> String {
    format!(
        "name: {:?}, src_hash: {:?}, checksum_hash: {:?}, normalized_source_len: {:?}, unnormalized_source_len: {}, lines: {:?}, multibyte_chars: {:?}, normalized_pos: {:?}, stable_id: {:?}, cnum: {:?}",
        sf.name,
        sf.src_hash,
        sf.checksum_hash,
        sf.normalized_source_len,
        sf.unnormalized_source_len,
        sf.lines(),
        sf.multibyte_chars,
        sf.normalized_pos,
        sf.stable_id,
        sf.cnum,
    )
}

/// Session A: the expansions and contexts the cases refer to, then the cases.
fn cases() -> Vec<Case> {
    let root = SyntaxContext::root();
    let e1 = hygiene::register_local_expn_id(
        ExpnData::new(
            ExpnKind::Macro(MacroKind::Bang, Symbol::intern("m")),
            ExpnId::root(),
            sp(10, 20, root),
            sp(1, 9, root),
            None,
            Edition::Edition2021,
            Some(def_id(0, 5)),
            Some(ModId::new_unchecked(def_id(0, 0))),
            false,
            false,
            false,
            false,
        ),
        expn_hash(0x1111_2222_3333_4444, 0x5555_6666_7777_8888),
    );
    let c1 = root.apply_mark(e1, Transparency::SemiOpaque);
    let e2 = hygiene::register_local_expn_id(
        ExpnData::new(
            ExpnKind::Macro(MacroKind::Attr, Symbol::intern("attr_m")),
            e1,
            sp(30, 40, c1),
            sp(2, 3, root),
            Some(Arc::from([Symbol::intern("x"), Symbol::intern("core_intrinsics")])),
            Edition::Edition2018,
            Some(def_id(2, 7)),
            None,
            true,
            true,
            false,
            true,
        ),
        expn_hash(0x0102_0304_0506_0708, 0xf0e0_d0c0_b0a0_9080),
    );
    let c2 = c1.apply_mark(e2, Transparency::Opaque);
    let e3 = hygiene::register_local_expn_id(
        ExpnData::default(ExpnKind::AstPass(AstPass::StdImports), DUMMY_SP, Edition::Edition2024, None, None),
        expn_hash(7, 9),
    );
    let e4 = hygiene::register_local_expn_id(
        ExpnData::new(
            ExpnKind::Desugaring(DesugaringKind::FormatLiteral { source: true }),
            e2,
            sp(50, 60, c2),
            DUMMY_SP,
            None,
            Edition::Edition2021,
            None,
            Some(ModId::new_unchecked(def_id(0, 3))),
            false,
            true,
            true,
            false,
        ),
        expn_hash(u64::MAX, 1 << 63),
    );
    let c3 = c2.apply_mark(e4, Transparency::Transparent);
    let c4 = root.apply_mark(e3, Transparency::Opaque);
    let c5 = c3.apply_mark(e1, Transparency::SemiOpaque);

    let wd = FilePathMapping::empty().to_real_filename(&RealFileName::empty(), Path::new("/home/u"));
    let plain = FilePathMapping::empty().to_real_filename(&wd, Path::new("src/main.rs"));
    let remapped = FilePathMapping::new(vec![(PathBuf::from("/home/u"), PathBuf::from("/remapped"))], RemapPathScopeComponents::MACRO)
        .to_real_filename(&wd, Path::new("/home/u/src/lib.rs"));
    let virt = RealFileName::from_virtual_path("/rustc/0000/library/core/src/lib.rs".as_ref());

    let long_line = "x".repeat(300);
    let very_long_line = "y".repeat(70_000);
    let sf1 = SourceFile::new(
        FileName::Real(plain.clone()),
        format!("fn main() {{\n    let é = '€';\r\n    // {long_line}\r\n}}\n\u{feff}😀\n"),
        SourceFileHashAlgorithm::Md5,
        Some(SourceFileHashAlgorithm::Sha256),
    )
    .unwrap();
    let sf2 = SourceFile::new(FileName::Custom("<custom>".into()), String::new(), SourceFileHashAlgorithm::Sha1, None).unwrap();
    let sf3 = SourceFile::new(
        FileName::Real(remapped.clone()),
        format!("a\n{very_long_line}\nb"),
        SourceFileHashAlgorithm::Sha256,
        Some(SourceFileHashAlgorithm::Sha256),
    )
    .unwrap();
    let sf4 = SourceFile::new(FileName::Anon(Hash64::new(42)), "x".into(), SourceFileHashAlgorithm::Md5, None).unwrap();
    let stable_id: StableSourceFileId = sf1.stable_id;

    let source_file_case = |name: &'static str, sf: SourceFile| -> Case {
        let sf = Arc::new(sf);
        let enc: Box<dyn Fn(&mut ProbeEncoder<'_>)> = Box::new(move |e| sf.encode(e));
        (name, enc)
    };

    vec![
        case!("span_root", Span, sp(10, 20, root)),
        case!("span_c1", Span, sp(30, 40, c1)),
        case!("span_c3", Span, sp(5, 5, c3)),
        case!("span_c4", Span, sp(100, 200, c4)),
        case!("span_c1_again", Span, sp(31, 41, c1)),
        case!("span_c5", Span, sp(0, 7, c5)),
        case!("span_dummy", Span, DUMMY_SP),
        case!("span_reversed", Span, sp(9, 3, c2)),
        case!(
            "symbols",
            Vec<Symbol>,
            vec![Symbol::intern("foo"), Symbol::intern(""), Symbol::intern("é€😀"), Symbol::intern("self"), Symbol::intern("foo")]
        ),
        case!("byte_symbols", Vec<ByteSymbol>, vec![ByteSymbol::intern(b"\x00\xff abc"), ByteSymbol::intern(b"foo")]),
        case!("def_ids", Vec<DefId>, vec![def_id(0, 0), def_id(0, 42), def_id(3, 7)]),
        case!("def_indices", Vec<DefIndex>, vec![DefIndex::from_u32(0), DefIndex::from_u32(300)]),
        case!(
            "local_def_ids",
            Vec<LocalDefId>,
            vec![LocalDefId { local_def_index: DefIndex::from_u32(17) }, LocalDefId { local_def_index: DefIndex::from_u32(0) }]
        ),
        case!("crate_nums", Vec<CrateNum>, vec![CrateNum::from_u32(0), CrateNum::from_u32(5)]),
        case!("expn_ids", Vec<ExpnId>, vec![ExpnId::root(), e1, e2, e3, e4, e2]),
        case!(
            "idents",
            Vec<Ident>,
            vec![Ident::new(Symbol::intern("x"), sp(1, 2, c2)), Ident::new(Symbol::intern("r#type"), sp(4, 8, c4))]
        ),
        case!("spanned", Spanned<u32>, Spanned { node: 7, span: sp(3, 4, c1) }),
        case!("attr_ids", Vec<AttrId>, vec![AttrId::from_u32(5), AttrId::from_u32(9), AttrId::from_u32(5)]),
        case!(
            "remap_scopes",
            Vec<RemapPathScopeComponents>,
            vec![RemapPathScopeComponents::empty(), RemapPathScopeComponents::MACRO | RemapPathScopeComponents::DEBUGINFO, RemapPathScopeComponents::all()]
        ),
        case!("real_file_names", Vec<RealFileName>, vec![plain.clone(), remapped.clone(), virt.clone(), wd.clone()]),
        case!(
            "file_names",
            Vec<FileName>,
            vec![
                FileName::Real(plain.clone()),
                FileName::CfgSpec(Hash64::new(1)),
                FileName::Anon(Hash64::new(u64::MAX)),
                FileName::MacroExpansion(Hash64::new(3)),
                FileName::ProcMacroSourceCode(Hash64::new(4)),
                FileName::CliCrateAttr(Hash64::new(5)),
                FileName::Custom("custom ü".into()),
                FileName::DocTest(virt.clone(), -3),
                FileName::InlineAsm(Hash64::new(6)),
            ]
        ),
        case!("stable_source_file_id", StableSourceFileId, stable_id),
        source_file_case("source_file_crlf_multibyte", sf1),
        source_file_case("source_file_empty", sf2),
        source_file_case("source_file_long_line", sf3),
        source_file_case("source_file_one_line", sf4),
        case!(
            "expn_kinds",
            Vec<ExpnKind>,
            vec![
                ExpnKind::Root,
                ExpnKind::Macro(MacroKind::Derive, Symbol::intern("D")),
                ExpnKind::AstPass(AstPass::ProcMacroHarness),
                ExpnKind::Desugaring(DesugaringKind::QuestionMark),
            ]
        ),
        case!(
            "expn_data",
            ExpnData,
            ExpnData::new(
                ExpnKind::Desugaring(DesugaringKind::ForLoop),
                e4,
                sp(70, 80, c5),
                sp(1, 2, c4),
                Some(Arc::from([])),
                Edition::Edition2015,
                Some(def_id(1, 1)),
                Some(ModId::new_unchecked(def_id(4, 0))),
                true,
                false,
                true,
                false,
            )
        ),
        case!("mod_ids", Vec<ModId>, vec![ModId::new_unchecked(def_id(0, 0)), ModId::new_unchecked(def_id(2, 9))]),
        case!(
            "local_mod_ids",
            Vec<LocalModId>,
            vec![LocalModId::new_unchecked(LocalDefId { local_def_index: DefIndex::from_u32(4) })]
        ),
        case!(
            "transparencies",
            Vec<Transparency>,
            vec![Transparency::Transparent, Transparency::SemiOpaque, Transparency::Opaque]
        ),
        case!("stable_crate_id", StableCrateId, decode_from(&0x1122_3344_5566_7788u64.to_le_bytes())),
    ]
}

fn main() {
    // ---- session A: encode ----
    let (bytes, values_end, case_ends, ctxts, expns, hygiene_a) = rustc_span::create_session_globals_then(Edition::Edition2021, &[], None, || {
        let cases = cases();
        let hygiene_ctxt = RefCell::new(HygieneEncodeContext::default());
        let mut e = ProbeEncoder { opaque: MemEncoder::new(), hygiene_ctxt: &hygiene_ctxt };
        let mut case_ends = Vec::new();
        for (name, enc) in &cases {
            enc(&mut e);
            case_ends.push((*name, e.opaque.position()));
        }
        let values_end = e.opaque.position();
        let mut ctxts: BTreeMap<u32, usize> = BTreeMap::new();
        let mut expns: BTreeMap<u32, (usize, usize)> = BTreeMap::new();
        HygieneEncodeContext::encode(
            &hygiene_ctxt,
            &mut e,
            |e, idx, key| {
                ctxts.insert(idx, e.opaque.position());
                key.encode(e);
            },
            |e, expn, data, hash| {
                let data_pos = e.opaque.position();
                data.unwrap().encode(e);
                let hash_pos = e.opaque.position();
                hash.encode(e);
                expns.insert(expn.local_id.as_u32(), (data_pos, hash_pos));
            },
        );
        (e.opaque.finish(), values_end, case_ends, ctxts, expns, hygiene::debug_hygiene_data(true))
    });

    // ---- session B: decode ----
    let (decoded, hygiene, hygiene_verbose) = rustc_span::create_session_globals_then(Edition::Edition2024, &[], None, || {
        let mut data = bytes.clone();
        data.extend_from_slice(MAGIC_END_BYTES);
        let hygiene_ctxt = HygieneDecodeContext::default();
        let next_attr_id = RefCell::new(0);
        let mut d = ProbeDecoder {
            opaque: MemDecoder::new(&data, 0).unwrap(),
            hygiene_ctxt: &hygiene_ctxt,
            ctxts: &ctxts,
            expns: &expns,
            next_attr_id: &next_attr_id,
        };
        let mut decoded = Vec::new();
        for &(name, end) in &case_ends {
            let s = decoder_for(name)(&mut d);
            assert_eq!(d.position(), end, "case {name} ends where it was encoded");
            decoded.push((name, s));
        }
        assert_eq!(d.position(), values_end);
        (decoded, hygiene::debug_hygiene_data(false), hygiene::debug_hygiene_data(true))
    });

    let mut out = String::from("{\n");
    out.push_str(&format!("  \"bytes\": {},\n", js(&hex(&bytes))));
    out.push_str(&format!("  \"values_end\": {values_end},\n"));
    let ends: Vec<String> = case_ends.iter().map(|(n, p)| format!("[{}, {p}]", js(n))).collect();
    out.push_str(&format!("  \"case_ends\": [{}],\n", ends.join(", ")));
    let cs: Vec<String> = ctxts.iter().map(|(i, p)| format!("[{i}, {p}]")).collect();
    out.push_str(&format!("  \"ctxts\": [{}],\n", cs.join(", ")));
    let es: Vec<String> = expns.iter().map(|(i, (a, b))| format!("[{i}, {a}, {b}]")).collect();
    out.push_str(&format!("  \"expns\": [{}],\n", es.join(", ")));
    let ds: Vec<String> = decoded.iter().map(|(n, s)| format!("    [{}, {}]", js(n), js(s))).collect();
    out.push_str(&format!("  \"decoded\": [\n{}\n  ],\n", ds.join(",\n")));
    out.push_str(&format!("  \"hygiene_a_verbose\": {},\n", js(&hygiene_a)));
    out.push_str(&format!("  \"hygiene\": {},\n", js(&hygiene)));
    out.push_str(&format!("  \"hygiene_verbose\": {}\n", js(&hygiene_verbose)));
    out.push_str("}\n");
    print!("{out}");
}

fn decoder_for(name: &str) -> Box<dyn Fn(&mut ProbeDecoder<'_, '_>) -> String> {
    macro_rules! dec {
        ($t:ty) => {
            Box::new(|d| format!("{:?}", <$t>::decode(d)))
        };
    }
    match name {
        "span_root" | "span_c1" | "span_c3" | "span_c4" | "span_c1_again" | "span_c5" | "span_dummy" | "span_reversed" => dec!(Span),
        "symbols" => dec!(Vec<Symbol>),
        "byte_symbols" => dec!(Vec<ByteSymbol>),
        "def_ids" => dec!(Vec<DefId>),
        "def_indices" => dec!(Vec<DefIndex>),
        "local_def_ids" => dec!(Vec<LocalDefId>),
        "crate_nums" => dec!(Vec<CrateNum>),
        "expn_ids" => dec!(Vec<ExpnId>),
        "idents" => dec!(Vec<Ident>),
        "spanned" => dec!(Spanned<u32>),
        "attr_ids" => dec!(Vec<AttrId>),
        "remap_scopes" => dec!(Vec<RemapPathScopeComponents>),
        "real_file_names" => dec!(Vec<RealFileName>),
        "file_names" => dec!(Vec<FileName>),
        "stable_source_file_id" => dec!(StableSourceFileId),
        n if n.starts_with("source_file_") => Box::new(|d| source_file_debug(&SourceFile::decode(d))),
        "expn_kinds" => dec!(Vec<ExpnKind>),
        "expn_data" => dec!(ExpnData),
        "mod_ids" => dec!(Vec<ModId>),
        "local_mod_ids" => dec!(Vec<LocalModId>),
        "transparencies" => dec!(Vec<Transparency>),
        "stable_crate_id" => dec!(StableCrateId),
        _ => panic!("no decoder for case {name}"),
    }
}
