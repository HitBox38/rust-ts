//! Scratch rustc-dev probe for the index-ds lane (rust-ts, plan-m4 D6). Links the pinned nightly's own rustc_index,
//! rustc_data_structures and rustc_serialize (`#![feature(rustc_private)]`) and prints, as JSON, what the u64-word bit
//! sets compute where the words are observable: `StableHash` (Hash128) and `Hash` with `FxHasher` of `DenseBitSet` and
//! `BitMatrix`, `DenseBitSet::to_string`, the opaque encoding of `DenseBitSet<u32>` (what crate metadata holds), the
//! derived `Debug` of `GrowableBitSet` (raw words) and of `SparseBitMatrix`, `IntervalSet`'s derived `Debug`, and the
//! element-level `Debug` of `ChunkedBitSet` / `MixedBitSet`.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hashes;
extern crate rustc_index;
extern crate rustc_serialize;

use std::fmt::Write as _;
use std::hash::{Hash, Hasher};

use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::fx::FxHasher;
use rustc_data_structures::stable_hash::{
    RawDefId, RawSpan, StableHash, StableHashControls, StableHashCtxt, StableHasher,
};
use rustc_hashes::Hash128;
use rustc_index::bit_set::{BitMatrix, ChunkedBitSet, DenseBitSet, GrowableBitSet, MixedBitSet, SparseBitMatrix};
use rustc_index::interval::IntervalSet;
use rustc_serialize::Encodable;
use rustc_serialize::opaque::mem_encoder::MemEncoder;

struct NoCtx;
impl StableHashCtxt for NoCtx {
    fn stable_hash_span(&mut self, _: RawSpan, _: &mut StableHasher) {
        panic!("span")
    }
    fn def_path_hash(&self, _: RawDefId) -> Fingerprint {
        panic!("def_path_hash")
    }
    fn stable_hash_controls(&self) -> StableHashControls {
        panic!("controls")
    }
    fn assert_default_stable_hash_controls(&self, _: &str) {
        panic!("assert")
    }
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u32) -> u32 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % n as u64) as u32
    }
}

fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c if (c as u32) < 0x20 => write!(o, "\\u{:04x}", c as u32).unwrap(),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn nums<T: ToString>(v: impl IntoIterator<Item = T>) -> String {
    format!("[{}]", v.into_iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","))
}

/// `{:?}` / `{:#?}` output, or `null` for sets with more than 64 elements (element-level Debug does not depend on the
/// word width; this keeps the fixture small).
fn dbg_small(n: usize, s: String) -> String {
    if n <= 64 { js(&s) } else { "null".to_string() }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn stable<T: StableHash>(v: &T) -> String {
    let mut h = StableHasher::new();
    v.stable_hash(&mut NoCtx, &mut h);
    let r: Hash128 = h.finish();
    r.as_u128().to_string()
}

fn fx<T: Hash>(v: &T) -> String {
    let mut h = FxHasher::default();
    v.hash(&mut h);
    h.finish().to_string()
}

/// Elements of `0..domain` picked with the given density (out of 100), deterministic per seed.
fn pick(rng: &mut Lcg, domain: u32, density: u32) -> Vec<u32> {
    (0..domain).filter(|_| rng.next(100) < density).collect()
}

fn main() {
    let mut rng = Lcg(0x1d5_d6);
    let mut out = String::from("{\"dense\":[");
    let domains = [0u32, 1, 2, 7, 8, 9, 31, 32, 33, 63, 64, 65, 95, 96, 97, 100, 127, 128, 129, 200, 300, 2047, 2048, 2049, 5000];
    let mut first = true;
    for &d in &domains {
        for density in [0u32, 3, 50, 100] {
            let elems = pick(&mut rng, d, density);
            let mut s: DenseBitSet<u32> = DenseBitSet::new_empty(d as usize);
            for &e in &elems {
                s.insert(e);
            }
            let mut enc = MemEncoder::new();
            s.encode(&mut enc);
            write!(
                out,
                "{}{{\"domain\":{},\"elems\":{},\"stable\":\"{}\",\"fx\":\"{}\",\"to_string\":{},\"debug\":{},\"encoded\":\"{}\"}}",
                if first { "" } else { "," },
                d,
                nums(elems.iter()),
                stable(&s),
                fx(&s),
                js(&s.to_string()),
                dbg_small(elems.len(), format!("{s:?}")),
                hex(&enc.finish()),
            )
            .unwrap();
            first = false;
        }
    }
    out.push_str("],\"matrix\":[");
    first = true;
    for &(rows, cols) in &[(0u32, 0u32), (1, 1), (1, 2), (3, 20), (4, 32), (5, 33), (2, 64), (3, 65), (7, 100), (2, 129), (40, 40)] {
        for density in [0u32, 10, 60] {
            let mut m: BitMatrix<u32, u32> = BitMatrix::new(rows as usize, cols as usize);
            let mut cells = vec![];
            for r in 0..rows {
                for c in pick(&mut rng, cols, density) {
                    m.insert(r, c);
                    cells.push(format!("[{r},{c}]"));
                }
            }
            write!(
                out,
                "{}{{\"rows\":{},\"cols\":{},\"cells\":[{}],\"stable\":\"{}\",\"fx\":\"{}\",\"debug\":{}}}",
                if first { "" } else { "," },
                rows,
                cols,
                cells.join(","),
                stable(&m),
                fx(&m),
                dbg_small(cells.len(), format!("{m:?}")),
            )
            .unwrap();
            first = false;
        }
    }
    out.push_str("],\"growable\":[");
    first = true;
    for max in [0u32, 1, 31, 32, 33, 63, 64, 65, 100, 128, 129, 300] {
        let elems = if max == 0 { vec![] } else { pick(&mut rng, max, 30).into_iter().chain([max - 1]).collect::<Vec<_>>() };
        let mut g: GrowableBitSet<u32> = GrowableBitSet::new_empty();
        for &e in &elems {
            g.insert(e);
        }
        write!(
            out,
            "{}{{\"elems\":{},\"debug\":{},\"count\":{}}}",
            if first { "" } else { "," },
            nums(elems.iter()),
            js(&format!("{g:?}")),
            g.count(),
        )
        .unwrap();
        first = false;
    }
    out.push_str("],\"mixed\":[");
    first = true;
    for d in [0u32, 1, 100, 2048, 2049, 4096, 5000] {
        for density in [0u32, 1, 50, 100] {
            let elems = pick(&mut rng, d, density);
            let mut c: ChunkedBitSet<u32> = ChunkedBitSet::new_empty(d as usize);
            let mut m: MixedBitSet<u32> = MixedBitSet::new_empty(d as usize);
            for &e in &elems {
                c.insert(e);
                m.insert(e);
            }
            write!(
                out,
                "{}{{\"domain\":{},\"elems\":{},\"count\":{},\"chunked\":{},\"mixed\":{},\"mixed_alt\":{}}}",
                if first { "" } else { "," },
                d,
                nums(elems.iter()),
                c.count(),
                dbg_small(elems.len(), format!("{c:?}")),
                dbg_small(elems.len(), format!("{m:?}")),
                dbg_small(elems.len(), format!("{m:#?}")),
            )
            .unwrap();
            first = false;
        }
    }
    out.push_str("],\"interval\":[");
    first = true;
    for d in [0u32, 10, 300] {
        let mut s: IntervalSet<u32> = IntervalSet::new(d as usize);
        let mut ranges = vec![];
        for _ in 0..(d / 10) {
            let a = rng.next(d);
            let b = a + rng.next(d - a);
            s.insert_range(a..=b);
            ranges.push(format!("[{a},{b}]"));
        }
        write!(
            out,
            "{}{{\"domain\":{},\"ranges\":[{}],\"debug\":{}}}",
            if first { "" } else { "," },
            d,
            ranges.join(","),
            js(&format!("{s:?}")),
        )
        .unwrap();
        first = false;
    }
    out.push_str("],\"sparse\":[");
    first = true;
    for cols in [1u32, 40, 100] {
        let mut m: SparseBitMatrix<u32, u32> = SparseBitMatrix::new(cols as usize);
        let mut cells = vec![];
        for _ in 0..6 {
            let r = rng.next(8);
            let c = rng.next(cols);
            m.insert(r, c);
            cells.push(format!("[{r},{c}]"));
        }
        write!(
            out,
            "{}{{\"cols\":{},\"cells\":[{}],\"debug\":{},\"debug_alt\":{}}}",
            if first { "" } else { "," },
            cols,
            cells.join(","),
            js(&format!("{m:?}")),
            js(&format!("{m:#?}")),
        )
        .unwrap();
        first = false;
    }
    out.push_str("]}");
    println!("{out}");
}
