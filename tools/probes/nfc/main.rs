//! Oracle probe for unicode-normalization (=0.1.25, the version rustc_parse uses).
//!   nfc   JSON on stdout:
//!   {"unicode_version":"(17, 0, 0)",
//!    "ccc"|"combining_mark"|"public_assigned"|"qc_nfc"|"qc_nfkc"|"qc_nfd"|"qc_nfkd": [[lo,hi,v],...],
//!    "nfd"|"nfkd"|"nfc"|"nfkc"|"cjk": [[c,[out...]],...],
//!    "compose_a":[...],"compose_b":[...],"compose":[[a,b,r],...],
//!    "strings":[[input...],...],"results":[[nfc,nfd,nfkc,nfkd,stream_safe,flags],...]}
//! Runs are over all scalar values (surrogates excluded): `canonical_combining_class`,
//! `is_combining_mark`, `is_public_assigned`, and `is_*_quick` of the one-char string
//! (0 = Yes, 1 = No, 2 = Maybe). The per-char maps list only chars whose one-char normalization
//! is not the char itself. `compose` lists every `Some` of `char::compose(a, b)` over
//! compose_a x compose_b (all chars occurring in any canonical decomposition, plus all Hangul
//! syllables on the left and all conjoining jamo on the right). `strings` are deterministic
//! pseudo-random strings over composition-relevant chars; `flags` packs is_nfc_quick (2 bits),
//! is_nfc, is_nfd, is_nfkc, is_nfkd, is_nfc_stream_safe, is_nfd_stream_safe (1 bit each, from bit 2).
use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::io::Write;

use unicode_normalization::char::{
    canonical_combining_class, compose, decompose_canonical, decompose_compatible, is_combining_mark,
    is_public_assigned,
};
use unicode_normalization::{
    IsNormalized, UnicodeNormalization, is_nfc, is_nfc_quick, is_nfc_stream_safe, is_nfd,
    is_nfd_quick, is_nfd_stream_safe, is_nfkc, is_nfkc_quick, is_nfkd, is_nfkd_quick,
};

fn scalars() -> impl Iterator<Item = char> {
    (0..=0x10FFFFu32).filter_map(char::from_u32)
}

fn qc(r: IsNormalized) -> u32 {
    match r {
        IsNormalized::Yes => 0,
        IsNormalized::No => 1,
        IsNormalized::Maybe => 2,
    }
}

fn runs(out: &mut String, name: &str, f: &dyn Fn(char) -> u32) {
    write!(out, ",\"{name}\":[").unwrap();
    let mut first = true;
    let mut cur: Option<(u32, u32, u32)> = None;
    let mut flush = |out: &mut String, r: (u32, u32, u32)| {
        if !first {
            out.push(',');
        }
        first = false;
        write!(out, "[{},{},{}]", r.0, r.1, r.2).unwrap();
    };
    for c in scalars() {
        let v = f(c);
        let cp = c as u32;
        match cur {
            Some((lo, hi, cv)) if cv == v && hi + 1 == cp => cur = Some((lo, cp, cv)),
            _ => {
                if let Some(r) = cur {
                    flush(out, r);
                }
                cur = Some((cp, cp, v));
            }
        }
    }
    if let Some(r) = cur {
        flush(out, r);
    }
    out.push(']');
}

fn list(out: &mut String, s: impl Iterator<Item = char>) {
    out.push('[');
    for (i, c) in s.enumerate() {
        if i > 0 {
            out.push(',');
        }
        write!(out, "{}", c as u32).unwrap();
    }
    out.push(']');
}

fn per_char(out: &mut String, name: &str, f: &dyn Fn(char) -> String) {
    write!(out, ",\"{name}\":[").unwrap();
    let mut first = true;
    for c in scalars() {
        let s = f(c);
        if s.chars().eq(std::iter::once(c)) {
            continue;
        }
        if !first {
            out.push(',');
        }
        first = false;
        write!(out, "[{},", c as u32).unwrap();
        list(out, s.chars());
        out.push(']');
    }
    out.push(']');
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn main() {
    let mut out = String::new();
    write!(out, "{{\"unicode_version\":\"{:?}\"", unicode_normalization::UNICODE_VERSION).unwrap();
    runs(&mut out, "ccc", &|c| canonical_combining_class(c) as u32);
    runs(&mut out, "combining_mark", &|c| is_combining_mark(c) as u32);
    runs(&mut out, "public_assigned", &|c| is_public_assigned(c) as u32);
    runs(&mut out, "qc_nfc", &|c| qc(is_nfc_quick(std::iter::once(c))));
    runs(&mut out, "qc_nfkc", &|c| qc(is_nfkc_quick(std::iter::once(c))));
    runs(&mut out, "qc_nfd", &|c| qc(is_nfd_quick(std::iter::once(c))));
    runs(&mut out, "qc_nfkd", &|c| qc(is_nfkd_quick(std::iter::once(c))));
    per_char(&mut out, "nfd", &|c| c.nfd().collect());
    per_char(&mut out, "nfkd", &|c| c.nfkd().collect());
    per_char(&mut out, "nfc", &|c| c.nfc().collect());
    per_char(&mut out, "nfkc", &|c| c.nfkc().collect());
    per_char(&mut out, "cjk", &|c| c.cjk_compat_variants().collect());

    // Chars occurring in the canonical decompositions of chars that decompose.
    let mut d: BTreeSet<char> = BTreeSet::new();
    for c in scalars() {
        let mut v = Vec::new();
        decompose_canonical(c, |x| v.push(x));
        if v != [c] {
            d.extend(v);
        }
    }
    let jamo = (0x1100u32..=0x11FF).filter_map(char::from_u32);
    let hangul: Vec<char> = (0xAC00u32..0xAC00 + 11172).filter_map(char::from_u32).collect();
    let a: BTreeSet<char> = d.iter().copied().chain(hangul.iter().copied()).collect();
    let b: BTreeSet<char> = d.iter().copied().chain(jamo).collect();
    out.push_str(",\"compose_a\":");
    list(&mut out, a.iter().copied());
    out.push_str(",\"compose_b\":");
    list(&mut out, b.iter().copied());
    out.push_str(",\"compose\":[");
    let mut first = true;
    for &x in &a {
        for &y in &b {
            if let Some(r) = compose(x, y) {
                if !first {
                    out.push(',');
                }
                first = false;
                write!(out, "[{},{},{}]", x as u32, y as u32, r as u32).unwrap();
            }
        }
    }
    out.push(']');

    // Pseudo-random strings over: decomposition chars, chars that decompose, combining marks,
    // Hangul syllables and jamo, ASCII, CGJ, and arbitrary scalars.
    let mut compat: BTreeSet<char> = BTreeSet::new();
    for c in scalars() {
        let mut n = 0;
        decompose_compatible(c, |x| {
            n += 1;
            if x != c {
                compat.insert(x);
            }
        });
        if n != 1 || c.nfkd().ne(std::iter::once(c)) {
            compat.insert(c);
        }
    }
    let marks: Vec<char> = scalars().filter(|&c| canonical_combining_class(c) != 0).collect();
    let pools: Vec<Vec<char>> = vec![
        d.iter().copied().collect(),
        compat.iter().copied().collect(),
        marks.clone(),
        hangul,
        (0x1100u32..=0x11FF).filter_map(char::from_u32).collect(),
        ('a'..='z').chain('A'..='Z').chain([' ', '\u{34F}']).collect(),
    ];
    let all: Vec<char> = scalars().collect();
    let mut rng = Rng(0x9E3779B97F4A7C15);
    out.push_str(",\"strings\":[");
    let mut results = String::from(",\"results\":[");
    const N: usize = 30000;
    for i in 0..N {
        // Every 50th string is a long run of combining marks (stream-safe limits).
        let len = if i % 50 == 0 { 25 + rng.below(20) } else { 1 + rng.below(12) };
        let mut s = String::new();
        for _ in 0..len {
            let p = rng.below(16);
            let c = if i % 50 == 0 && p < 13 {
                marks[rng.below(marks.len())]
            } else if p < 15 {
                let pool = &pools[p % pools.len()];
                pool[rng.below(pool.len())]
            } else {
                all[rng.below(all.len())]
            };
            s.push(c);
        }
        if i > 0 {
            out.push(',');
            results.push(',');
        }
        list(&mut out, s.chars());
        results.push('[');
        list(&mut results, s.nfc());
        results.push(',');
        list(&mut results, s.nfd());
        results.push(',');
        list(&mut results, s.nfkc());
        results.push(',');
        list(&mut results, s.nfkd());
        results.push(',');
        list(&mut results, s.stream_safe());
        let flags = qc(is_nfc_quick(s.chars()))
            | (is_nfc(&s) as u32) << 2
            | (is_nfd(&s) as u32) << 3
            | (is_nfkc(&s) as u32) << 4
            | (is_nfkd(&s) as u32) << 5
            | (is_nfc_stream_safe(&s) as u32) << 6
            | (is_nfd_stream_safe(&s) as u32) << 7;
        write!(results, ",{flags}]").unwrap();
    }
    out.push(']');
    results.push(']');
    out.push_str(&results);
    out.push_str("}\n");
    std::io::stdout().lock().write_all(out.as_bytes()).unwrap();
}
