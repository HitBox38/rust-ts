//! Oracle probe for src/rustc_serialize/serialize_oracle.test.ts (lane serialize): encodes a fixed set
//! of values with the oracle compiler's own `rustc_serialize::opaque::MemEncoder` and `FileEncoder`
//! (primitives, strings, sequences, maps, Option/Result/tuples, hashes, the opaque specializations,
//! and rustc_span types whose Encodable is derived), so the port can decode the bytes and re-encode
//! them byte for byte.
//!
//!   serialize <scratch dir>
//!
//! Output, one line per case (src/rustc_serialize/serialize_oracle/cases.ts has the same cases and
//! values, in the same order): `<name> <mem> <file>`, where `<mem>` is the hex of the MemEncoder's
//! bytes (`_` when empty) and `<file>` is `=` when the FileEncoder's file is exactly those bytes plus
//! `MAGIC_END_BYTES`, else the file's hex.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hashes;
extern crate rustc_serialize;
extern crate rustc_span;

use std::collections::{BTreeMap, BTreeSet};
use std::num::NonZero;
use std::path::{Path, PathBuf};

use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::fx::{FxHashMap, FxHashSet, FxIndexMap};
use rustc_hashes::{Hash64, Hash128};
use rustc_serialize::opaque::mem_encoder::MemEncoder;
use rustc_serialize::opaque::{FileEncoder, IntEncodedWithFixedSize, MAGIC_END_BYTES, MemDecoder};
use rustc_serialize::{Decodable, Encodable, Encoder};
use rustc_span::def_id::{DefPathHash, StableCrateId};
use rustc_span::edition::Edition;
use rustc_span::hygiene::{AstPass, DesugaringKind, ExpnHash, MacroKind, Transparency};
use rustc_span::{MultiByteChar, NormalizedPos, RelativeBytePos, SourceFileHash, SourceFileHashAlgorithm};

fn hex(b: &[u8]) -> String {
    if b.is_empty() {
        return "_".to_string();
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn report(name: &str, mem: Vec<u8>, path: &Path) {
    let file = std::fs::read(path).unwrap();
    let mut expect = mem.clone();
    expect.extend_from_slice(MAGIC_END_BYTES);
    println!("{name} {} {}", hex(&mem), if file == expect { "=".to_string() } else { hex(&file) });
}

/// Runs `$body` with `$e` bound to a MemEncoder, then to a FileEncoder writing `<dir>/<name>`.
macro_rules! case {
    ($dir:expr, $name:expr, |$e:ident| $body:block) => {{
        let mut $e = MemEncoder::new();
        $body;
        let mem = $e.finish();
        let path = $dir.join($name);
        let mut $e = FileEncoder::new(&path).unwrap();
        $body;
        $e.finish().unwrap();
        drop($e);
        report($name, mem, &path);
    }};
}

/// A case encoding each value of `$vals` (a slice expression) with its `Encodable` impl.
macro_rules! values {
    ($dir:expr, $name:expr, $vals:expr) => {
        case!($dir, $name, |e| {
            for v in $vals.iter() {
                v.encode(&mut e);
            }
        })
    };
}

/// `T::decode` of the given bytes (constructs values whose fields are private).
fn decode_from<T: for<'a> Decodable<MemDecoder<'a>>>(bytes: &[u8]) -> T {
    let mut data = bytes.to_vec();
    data.extend_from_slice(MAGIC_END_BYTES);
    let mut d = MemDecoder::new(&data, 0).unwrap();
    T::decode(&mut d)
}

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: serialize <scratch dir>"));
    std::fs::create_dir_all(&dir).unwrap();

    // ---- primitives ----
    values!(dir, "u8", (0..=255u8).collect::<Vec<_>>());
    values!(dir, "u16", [0u16, 1, 127, 128, 255, 256, 0x7fff, 0x8000, 0xffff]);
    values!(dir, "u32", [0u32, 1, 127, 128, 16383, 16384, 0x1234_5678, 1 << 31, u32::MAX]);
    values!(dir, "u64", [0u64, 1, 127, 128, 1 << 32, 1 << 53, (1 << 53) + 1, 0x0123_4567_89ab_cdef, u64::MAX]);
    values!(dir, "u128", [0u128, 1, (u64::MAX as u128) + 1, 0x0123_4567_89ab_cdef_fedc_ba98_7654_3210, u128::MAX]);
    values!(dir, "usize", [0usize, 1, 127, 128, 300, 65535, 1 << 32, (1 << 49) - 1, 1 << 49, (1 << 53) - 1]);
    values!(dir, "i8", [i8::MIN, -1, 0, 1, i8::MAX]);
    values!(dir, "i16", [i16::MIN, -129, -128, -65, -64, -1, 0, 1, 63, 64, 127, 128, i16::MAX]);
    values!(dir, "i32", [i32::MIN, -65, -64, -1, 0, 63, 64, 0x1234_5678, i32::MAX]);
    values!(dir, "i64", [i64::MIN, -(1 << 53), -65, -1, 0, 64, 1 << 53, i64::MAX]);
    values!(dir, "i128", [i128::MIN, (i64::MIN as i128) - 1, -1, 0, (u64::MAX as i128) + 1, i128::MAX]);
    values!(dir, "isize", [-((1isize << 53) - 1), -(1 << 49), -65, -64, -1, 0, 63, 64, (1 << 49) - 1, 1 << 49, (1 << 53) - 1]);
    values!(dir, "bool", [false, true, true]);
    values!(dir, "char", ['a', '\0', 'é', '€', '😀', '\u{7f}', '\u{80}', '\u{d7ff}', '\u{e000}', '\u{10ffff}']);
    values!(dir, "unit", [(), ()]);

    // ---- strings and bytes ----
    let long: String = "abcdefghij".repeat(20);
    values!(dir, "String", ["".to_string(), "a".to_string(), "héllo wörld".to_string(), "😀".repeat(10), long.clone()]);
    case!(dir, "byte_str", |e| {
        e.emit_byte_str(b"");
        e.emit_byte_str(b"\x00\xc1\xc2\xff");
        e.emit_byte_str(long.as_bytes());
    });
    values!(dir, "PathBuf", [PathBuf::from("/tmp/a b/c.rs"), PathBuf::from("relative/ü.rs")]);

    // ---- sequences, options, results, tuples, arrays ----
    values!(dir, "Vec_u8", [vec![], vec![1u8, 2, 3], (0..300u32).map(|i| i as u8).collect::<Vec<u8>>()]);
    values!(dir, "Vec_u32", [vec![], vec![0u32, 128, u32::MAX]]);
    values!(dir, "Vec_String", [vec!["x".to_string(), "".to_string(), "ÿ".to_string()]]);
    values!(dir, "Option_u32", [None, Some(0u32), Some(u32::MAX)]);
    values!(dir, "Option_Option_u8", [None, Some(None), Some(Some(7u8))]);
    values!(dir, "Result_u32_String", [Ok::<u32, String>(5), Err("bad".to_string())]);
    values!(dir, "tuple3", [(1u8, "s".to_string(), true), (255u8, "".to_string(), false)]);
    values!(dir, "array_u8_4", [[1u8, 2, 3, 4], [0, 0, 0, 255]]);
    values!(dir, "Box_slice_u32", [Box::<[u32]>::from(vec![]), Box::<[u32]>::from(vec![7u32, 1 << 20])]);
    values!(dir, "NonZero_u32", [NonZero::new(1u32).unwrap(), NonZero::new(u32::MAX).unwrap()]);

    // ---- maps and sets (hash order is the oracle's; the port keeps the decoded order) ----
    let mut bt = BTreeMap::new();
    for (i, s) in ["zero", "one", "two", "three"].iter().enumerate() {
        bt.insert(i as u32 * 1000, s.to_string());
    }
    values!(dir, "BTreeMap_u32_String", [&bt]);
    values!(dir, "BTreeSet_i64", [[-5i64, 0, 3, 1 << 40].into_iter().collect::<BTreeSet<_>>()]);
    let mut fx = FxHashMap::default();
    for i in 0..50u32 {
        fx.insert(i * 7919, (i as u64) << 40);
    }
    values!(dir, "FxHashMap_u32_u64", [&fx]);
    values!(dir, "FxHashSet_u32", [(0..40u32).map(|i| i * 31).collect::<FxHashSet<_>>()]);
    let mut ix = FxIndexMap::default();
    for s in ["b", "a", "c", "ä"] {
        ix.insert(s.to_string(), s.len() as u32);
    }
    values!(dir, "FxIndexMap_String_u32", [&ix]);

    // ---- hashes and the opaque specializations ----
    values!(dir, "Hash64", [Hash64::new(0), Hash64::new(0x0123_4567_89ab_cdef), Hash64::new(u64::MAX)]);
    values!(dir, "Hash128", [Hash128::new(0), Hash128::new(0x0123_4567_89ab_cdef_fedc_ba98_7654_3210)]);
    values!(dir, "Fingerprint", [Fingerprint::new(Hash64::new(1), Hash64::new(2)), Fingerprint::new(Hash64::new(u64::MAX), Hash64::new(0x8000_0000_0000_0000))]);
    values!(dir, "IntEncodedWithFixedSize", [IntEncodedWithFixedSize(0), IntEncodedWithFixedSize(0x0102_0304_0506_0708), IntEncodedWithFixedSize(u64::MAX)]);

    // ---- buffer boundaries: a blob larger than FileEncoder's 64 KiB buffer, then many LEB128 writes ----
    case!(dir, "big", |e| {
        let blob: Vec<u8> = (0..70_000u32).map(|i| (i * 7 % 251) as u8).collect();
        blob.encode(&mut e);
        for i in 0..12_000u64 {
            e.emit_u64(i.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (i % 64));
        }
        e.emit_str("end");
    });

    // ---- rustc_span types (derive(Encodable), generated decoders: src/rustc_span/decodable.gen.ts) ----
    values!(dir, "Edition", [Edition::Edition2015, Edition::Edition2018, Edition::Edition2021, Edition::Edition2024, Edition::EditionFuture]);
    values!(dir, "Transparency", [Transparency::Transparent, Transparency::SemiOpaque, Transparency::Opaque]);
    values!(dir, "MacroKind", [MacroKind::Bang, MacroKind::Attr, MacroKind::Derive]);
    values!(dir, "AstPass", [AstPass::StdImports, AstPass::TestHarness, AstPass::ProcMacroHarness]);
    values!(
        dir,
        "DesugaringKind",
        [
            DesugaringKind::QuestionMark,
            DesugaringKind::TryBlock,
            DesugaringKind::YeetExpr,
            DesugaringKind::OpaqueTy,
            DesugaringKind::Async,
            DesugaringKind::Await,
            DesugaringKind::ForLoop,
            DesugaringKind::WhileLoop,
            DesugaringKind::BoundModifier,
            DesugaringKind::Contract,
            DesugaringKind::PatTyRange,
            DesugaringKind::FormatLiteral { source: true },
            DesugaringKind::FormatLiteral { source: false },
            DesugaringKind::RangeExpr,
        ]
    );
    let algs = [SourceFileHashAlgorithm::Md5, SourceFileHashAlgorithm::Sha1, SourceFileHashAlgorithm::Sha256, SourceFileHashAlgorithm::Blake3];
    values!(dir, "SourceFileHashAlgorithm", algs);
    values!(dir, "SourceFileHash", algs.map(|k| SourceFileHash::new_in_memory(k, b"fn main() {}\n")));
    values!(dir, "MultiByteChar", [MultiByteChar { pos: RelativeBytePos(5), bytes: 3 }, MultiByteChar { pos: RelativeBytePos(70000), bytes: 4 }]);
    values!(dir, "NormalizedPos", [NormalizedPos { pos: RelativeBytePos(0), diff: 1 }, NormalizedPos { pos: RelativeBytePos(300), diff: 1 << 20 }]);
    let scid: StableCrateId = decode_from(&0x1122_3344_5566_7788u64.to_le_bytes());
    values!(dir, "StableCrateId", [scid]);
    values!(dir, "DefPathHash", [DefPathHash::new(scid, Hash64::new(0x99aa_bbcc_ddee_ff00))]);
    let mut eh = 0x0102_0304_0506_0708u64.to_le_bytes().to_vec();
    eh.extend_from_slice(&0xf0e0_d0c0_b0a0_9080u64.to_le_bytes());
    let expn: ExpnHash = decode_from(&eh);
    values!(dir, "ExpnHash", [expn]);
}
