//! Oracle probe for src/rust_ts/hash_map.oracle.test.ts (lane hashbrown-order): drives the oracle
//! compiler's own `rustc_data_structures::fx::{FxHashMap, FxHashSet}` (std's hashbrown with
//! rustc-hash's `FxHasher`) through scripts of operations and prints the iteration order.
//!
//!   fxorder < scripts
//!
//! Input: one script per line, `<kind> <op> <op> ...` (tokens separated by single spaces).
//!   kind   collection                          key token
//!   u32    FxHashMap<u32, usize>               decimal
//!   str    FxHashMap<String, usize>            hex of the UTF-8 bytes (`_` = "")
//!   sym    FxHashMap<Symbol, usize>            hex of the UTF-8 bytes, `Symbol::intern`ed
//!   su32   FxHashSet<u32>                      decimal
//!   su8    FxHashSet<u8>                       decimal
//!   ssym   FxHashSet<Symbol>                   hex, interned
//!   def    FxHashMap<DefId, u32>               `<krate>.<index>` (decimal; lane encode-middle:
//!          `Generics::param_def_id_to_index`, whose order crate metadata encodes)
//! Ops (`<k>` a key token, `<ks>` comma-separated key tokens, `<n>` a decimal):
//!   +<k>   insert(k, i)  (maps: the value is the op's index i (`as u32` for `def`); sets: insert(k))
//!   -<k>   remove(&k)
//!   r<n>   reserve(n)            s<n>  shrink_to(n)        S  shrink_to_fit()
//!   x      clear()               C     *self = self.clone()
//!   R<n>   retain(|k, ..| keynum(k) % n != 0)  (keynum: the integer key, or the sum of the key's bytes;
//!          `def`: krate + index)
//!   E<ks>  extend(Vec<K>.into_iter())        (exact size hint)
//!   e<ks>  extend(Vec<K>.into_iter().filter(|_| true))   (size hint lower bound 0)
//!   F<ks>  *self = Vec<K>.into_iter().collect()            (std FromIterator)
//!   W<n>   *self = with_capacity_and_hasher(n, Default::default())
//!   p      checkpoint: print the current state
//! Maps' extend/collect items are `(k, i)`. Symbols are interned inside one
//! `create_default_session_globals_then` for the whole run, so the TS side interns the same
//! strings in the same order of first appearance.
//!
//! Output: one line per script: the checkpoints (each `p`, then the final state) joined by ` | `,
//! each `<capacity>:<keys>` with the keys in iteration order as tokens, comma-separated.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_span;

use std::io::{BufRead, Write};

use rustc_data_structures::fx::{FxHashMap, FxHashSet};
use rustc_span::Symbol;
use rustc_span::def_id::{CrateNum, DefId, DefIndex};

fn unhex(s: &str) -> String {
    if s == "_" {
        return String::new();
    }
    let bytes: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect();
    String::from_utf8(bytes).unwrap()
}

fn hex(s: &str) -> String {
    if s.is_empty() {
        return "_".to_string();
    }
    s.bytes().map(|b| format!("{b:02x}")).collect()
}

trait Key: std::hash::Hash + Eq + Clone {
    fn parse(tok: &str) -> Self;
    fn token(&self) -> String;
    fn keynum(&self) -> u64;
}

impl Key for u32 {
    fn parse(tok: &str) -> Self {
        tok.parse().unwrap()
    }
    fn token(&self) -> String {
        self.to_string()
    }
    fn keynum(&self) -> u64 {
        *self as u64
    }
}

impl Key for u8 {
    fn parse(tok: &str) -> Self {
        tok.parse().unwrap()
    }
    fn token(&self) -> String {
        self.to_string()
    }
    fn keynum(&self) -> u64 {
        *self as u64
    }
}

impl Key for String {
    fn parse(tok: &str) -> Self {
        unhex(tok)
    }
    fn token(&self) -> String {
        hex(self)
    }
    fn keynum(&self) -> u64 {
        self.bytes().map(|b| b as u64).sum()
    }
}

impl Key for Symbol {
    fn parse(tok: &str) -> Self {
        Symbol::intern(&unhex(tok))
    }
    fn token(&self) -> String {
        hex(self.as_str())
    }
    fn keynum(&self) -> u64 {
        self.as_str().bytes().map(|b| b as u64).sum()
    }
}

impl Key for DefId {
    fn parse(tok: &str) -> Self {
        let (krate, index) = tok.split_once('.').unwrap();
        DefId { krate: CrateNum::from_u32(krate.parse().unwrap()), index: DefIndex::from_u32(index.parse().unwrap()) }
    }
    fn token(&self) -> String {
        format!("{}.{}", self.krate.as_u32(), self.index.as_u32())
    }
    fn keynum(&self) -> u64 {
        self.krate.as_u32() as u64 + self.index.as_u32() as u64
    }
}

fn keys<K: Key>(list: &str) -> Vec<K> {
    if list.is_empty() { Vec::new() } else { list.split(',').map(K::parse).collect() }
}

fn state<'a, K: Key + 'a>(cap: usize, it: impl Iterator<Item = &'a K>) -> String {
    let ks: Vec<String> = it.map(|k| k.token()).collect();
    format!("{cap}:{}", ks.join(","))
}

fn run_map<K: Key, V: Clone>(ops: &[&str], val: fn(usize) -> V) -> String {
    let mut m: FxHashMap<K, V> = FxHashMap::default();
    let mut out = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        let (c, rest) = op.split_at(1);
        match c {
            "+" => {
                m.insert(K::parse(rest), val(i));
            }
            "-" => {
                m.remove(&K::parse(rest));
            }
            "r" => m.reserve(rest.parse().unwrap()),
            "s" => m.shrink_to(rest.parse().unwrap()),
            "S" => m.shrink_to_fit(),
            "x" => m.clear(),
            "C" => m = m.clone(),
            "R" => {
                let n: u64 = rest.parse().unwrap();
                m.retain(|k, _| k.keynum() % n != 0);
            }
            "E" => m.extend(keys::<K>(rest).into_iter().map(|k| (k, val(i)))),
            "e" => m.extend(keys::<K>(rest).into_iter().filter(|_| true).map(|k| (k, val(i)))),
            "F" => m = keys::<K>(rest).into_iter().map(|k| (k, val(i))).collect(),
            "W" => m = FxHashMap::with_capacity_and_hasher(rest.parse().unwrap(), Default::default()),
            "p" => out.push(state(m.capacity(), m.keys())),
            _ => panic!("bad op {op}"),
        }
    }
    out.push(state(m.capacity(), m.keys()));
    out.join(" | ")
}

fn run_set<K: Key>(ops: &[&str]) -> String {
    let mut m: FxHashSet<K> = FxHashSet::default();
    let mut out = Vec::new();
    for op in ops {
        let (c, rest) = op.split_at(1);
        match c {
            "+" => {
                m.insert(K::parse(rest));
            }
            "-" => {
                m.remove(&K::parse(rest));
            }
            "r" => m.reserve(rest.parse().unwrap()),
            "s" => m.shrink_to(rest.parse().unwrap()),
            "S" => m.shrink_to_fit(),
            "x" => m.clear(),
            "C" => m = m.clone(),
            "R" => {
                let n: u64 = rest.parse().unwrap();
                m.retain(|k| k.keynum() % n != 0);
            }
            "E" => m.extend(keys::<K>(rest).into_iter()),
            "e" => m.extend(keys::<K>(rest).into_iter().filter(|_| true)),
            "F" => m = keys::<K>(rest).into_iter().collect(),
            "W" => m = FxHashSet::with_capacity_and_hasher(rest.parse().unwrap(), Default::default()),
            "p" => out.push(state(m.capacity(), m.iter())),
            _ => panic!("bad op {op}"),
        }
    }
    out.push(state(m.capacity(), m.iter()));
    out.join(" | ")
}

fn main() {
    rustc_span::create_default_session_globals_then(|| {
        let stdin = std::io::stdin();
        let stdout = std::io::stdout();
        let mut w = std::io::BufWriter::new(stdout.lock());
        for line in stdin.lock().lines() {
            let line = line.unwrap();
            let mut toks = line.split(' ');
            let kind = toks.next().unwrap();
            let ops: Vec<&str> = toks.filter(|t| !t.is_empty()).collect();
            let r = match kind {
                "u32" => run_map::<u32, usize>(&ops, |i| i),
                "str" => run_map::<String, usize>(&ops, |i| i),
                "sym" => run_map::<Symbol, usize>(&ops, |i| i),
                "def" => run_map::<DefId, u32>(&ops, |i| i as u32),
                "su32" => run_set::<u32>(&ops),
                "su8" => run_set::<u8>(&ops),
                "ssym" => run_set::<Symbol>(&ops),
                _ => panic!("bad kind {kind}"),
            };
            writeln!(w, "{r}").unwrap();
        }
    });
}
