//! Oracle probe for src/vendor/odht/odht.oracle.test.ts (lane odht).
//!
//! Reads commands from stdin, one per line (whitespace-separated), and answers on stdout:
//!
//!   build <cfg> <ctor> <k>:<v>...   build a `HashTableOwned<cfg>` and insert the pairs in order;
//!                                   prints `inserts <old|None>...` (not for `iter=`), `len <n>`,
//!                                   `bytes <hex of raw_bytes()>`
//!   debug <cfg> <ctor> <k>:<v>...   the same table's `{:?}`, then a line `END`
//!   get <cfg> <hex> <k>...          `HashTable::<cfg, &[u8]>::from_raw_bytes(bytes)`: `err <display>` or
//!                                   `ok len <n>`, `iter <k> <v>` per entry in iteration order and
//!                                   `get <k> <v|None>` per key
//!   readmeta <file> <pos> <k>...    the `def_path_hash_map` of an `.rmeta` file: `read_usize` at `pos`
//!                                   (the root's `def_path_hash_map` LazyValue position) gives the byte
//!                                   length, the bytes follow (rmeta/def_path_hash_map.rs:57 `decode`);
//!                                   prints `bytes <len> <fnv1a64>` then the `get` output for the rustc
//!                                   config, with `get` lines for every 5th entry and for the given keys
//!
//! A command that panics prints `panic <message>` instead of its output (the panic is caught; the hook is
//! silenced).
//!
//! <cfg>: `rustc` = rustc_hir_id::def_path_hash_map::Config (u64 -> u32, UnHashFn),
//!        `fx8`   = u64 -> u32 with FxHashFn, `fx4` = u32 -> u32 with FxHashFn (odht's own TestConfig).
//! <ctor>: `default` | `cap=<max_item_count>,<pct>` | `iter=<pct>` (`from_iterator` of a Vec).
#![feature(rustc_private)]

extern crate odht;
extern crate rustc_driver;
extern crate rustc_hashes;
extern crate rustc_hir_id;
extern crate rustc_serialize;
extern crate rustc_span;

use std::io::{BufRead, Write};

use odht::{Config, FxHashFn, HashTable, HashTableOwned};
use rustc_hashes::Hash64;
use rustc_serialize::Decoder;
use rustc_serialize::opaque::MemDecoder;
use rustc_span::def_id::DefIndex;

type RustcCfg = rustc_hir_id::def_path_hash_map::Config;

struct Fx8;
impl Config for Fx8 {
    type Key = u64;
    type Value = u32;
    type EncodedKey = [u8; 8];
    type EncodedValue = [u8; 4];
    type H = FxHashFn;
    fn encode_key(k: &u64) -> [u8; 8] {
        k.to_le_bytes()
    }
    fn encode_value(v: &u32) -> [u8; 4] {
        v.to_le_bytes()
    }
    fn decode_key(k: &[u8; 8]) -> u64 {
        u64::from_le_bytes(*k)
    }
    fn decode_value(v: &[u8; 4]) -> u32 {
        u32::from_le_bytes(*v)
    }
}

struct Fx4;
impl Config for Fx4 {
    type Key = u32;
    type Value = u32;
    type EncodedKey = [u8; 4];
    type EncodedValue = [u8; 4];
    type H = FxHashFn;
    fn encode_key(k: &u32) -> [u8; 4] {
        k.to_le_bytes()
    }
    fn encode_value(v: &u32) -> [u8; 4] {
        v.to_le_bytes()
    }
    fn decode_key(k: &[u8; 4]) -> u32 {
        u32::from_le_bytes(*k)
    }
    fn decode_value(v: &[u8; 4]) -> u32 {
        u32::from_le_bytes(*v)
    }
}

/// Key/value text conversions for a config.
trait Io: Config {
    fn key(s: &str) -> Self::Key;
    fn value(s: &str) -> Self::Value;
    fn show_key(k: &Self::Key) -> String;
    fn show_value(v: &Self::Value) -> String;
}
impl Io for RustcCfg {
    fn key(s: &str) -> Hash64 {
        Hash64::new(s.parse().unwrap())
    }
    fn value(s: &str) -> DefIndex {
        DefIndex::from_u32(s.parse().unwrap())
    }
    fn show_key(k: &Hash64) -> String {
        k.as_u64().to_string()
    }
    fn show_value(v: &DefIndex) -> String {
        v.as_u32().to_string()
    }
}
impl Io for Fx8 {
    fn key(s: &str) -> u64 {
        s.parse().unwrap()
    }
    fn value(s: &str) -> u32 {
        s.parse().unwrap()
    }
    fn show_key(k: &u64) -> String {
        k.to_string()
    }
    fn show_value(v: &u32) -> String {
        v.to_string()
    }
}
impl Io for Fx4 {
    fn key(s: &str) -> u32 {
        s.parse().unwrap()
    }
    fn value(s: &str) -> u32 {
        s.parse().unwrap()
    }
    fn show_key(k: &u32) -> String {
        k.to_string()
    }
    fn show_value(v: &u32) -> String {
        v.to_string()
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn fnv1a64(b: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn build<C: Io>(out: &mut String, ctor: &str, pairs: &[&str], debug: bool) {
    let kv: Vec<(C::Key, C::Value)> = pairs
        .iter()
        .map(|p| {
            let (k, v) = p.split_once(':').unwrap();
            (C::key(k), C::value(v))
        })
        .collect();
    let table: HashTableOwned<C> = if let Some(pct) = ctor.strip_prefix("iter=") {
        HashTableOwned::<C>::from_iterator(kv, pct.parse().unwrap())
    } else {
        let mut t = if ctor == "default" {
            HashTableOwned::<C>::default()
        } else {
            let (n, pct) = ctor.strip_prefix("cap=").unwrap().split_once(',').unwrap();
            HashTableOwned::<C>::with_capacity(n.parse().unwrap(), pct.parse().unwrap())
        };
        let mut ins = String::from("inserts");
        for (k, v) in kv.iter() {
            match t.insert(k, v) {
                Some(old) => ins.push_str(&format!(" {}", C::show_value(&old))),
                None => ins.push_str(" None"),
            }
        }
        if !debug {
            out.push_str(&ins);
            out.push('\n');
        }
        t
    };
    if debug {
        out.push_str(&format!("{table:?}"));
        out.push_str("END\n");
    } else {
        out.push_str(&format!("len {}\nbytes {}\n", table.len(), hex(table.raw_bytes())));
    }
}

fn get<C: Io>(out: &mut String, bytes: &[u8], keys: &[&str], every: usize) {
    match HashTable::<C, &[u8]>::from_raw_bytes(bytes) {
        Err(e) => out.push_str(&format!("err {e}\n")),
        Ok(t) => {
            out.push_str(&format!("ok len {}\n", t.len()));
            let mut probe_keys = Vec::new();
            for (i, (k, v)) in t.iter().enumerate() {
                out.push_str(&format!("iter {} {}\n", C::show_key(&k), C::show_value(&v)));
                if every != 0 && i % every == 0 {
                    probe_keys.push(k);
                }
            }
            probe_keys.extend(keys.iter().map(|k| C::key(k)));
            for k in probe_keys.iter() {
                match t.get(k) {
                    Some(v) => out.push_str(&format!("get {} {}\n", C::show_key(k), C::show_value(&v))),
                    None => out.push_str(&format!("get {} None\n", C::show_key(k))),
                }
            }
        }
    }
}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let stdin = std::io::stdin();
    let mut out = String::new();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let w: Vec<&str> = line.split_whitespace().collect();
        if w.is_empty() {
            continue;
        }
        let r = std::panic::catch_unwind(|| {
            let mut out = String::new();
            command(&mut out, &line, &w);
            out
        });
        match r {
            Ok(o) => out.push_str(&o),
            Err(e) => {
                let msg = e
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                out.push_str(&format!("panic {}\n", msg.replace('\n', "\\n")));
            }
        }
    }
    std::io::stdout().write_all(out.as_bytes()).unwrap();
}

fn command(out: &mut String, line: &str, w: &[&str]) {
    let out = out;
    {
        match (w[0], w.get(1).copied()) {
            ("build" | "debug", Some(cfg)) => {
                let debug = w[0] == "debug";
                match cfg {
                    "rustc" => build::<RustcCfg>(out, w[2], &w[3..], debug),
                    "fx8" => build::<Fx8>(out, w[2], &w[3..], debug),
                    "fx4" => build::<Fx4>(out, w[2], &w[3..], debug),
                    _ => panic!("unknown config {cfg}"),
                }
            }
            ("get", Some(cfg)) => {
                let bytes = unhex(w[2]);
                match cfg {
                    "rustc" => get::<RustcCfg>(out, &bytes, &w[3..], 0),
                    "fx8" => get::<Fx8>(out, &bytes, &w[3..], 0),
                    "fx4" => get::<Fx4>(out, &bytes, &w[3..], 0),
                    _ => panic!("unknown config {cfg}"),
                }
            }
            ("readmeta", Some(file)) => {
                let data = std::fs::read(file).unwrap();
                let pos: usize = w[2].parse().unwrap();
                let mut d = MemDecoder::new(&data, pos).unwrap();
                let len = d.read_usize();
                let start = d.position();
                let bytes = &data[start..start + len];
                out.push_str(&format!("bytes {} {:016x}\n", len, fnv1a64(bytes)));
                get::<RustcCfg>(out, bytes, &w[3..], 5);
            }
            _ => panic!("bad command: {line}"),
        }
    }
}
