//! Oracle probe for src/vendor/twox_hash/xxhash3_128.oracle.test.ts (lane vendor-twox-hash).
//!
//! Reads commands from stdin, one per line (whitespace-separated), and prints one line per command:
//!
//!   oneshot <data>                       `Hasher::oneshot(data)`
//!   seed <u64> <data>                    `Hasher::oneshot_with_seed(seed, data)`
//!   secret <secret> <data>               `Hasher::oneshot_with_secret(secret, data)`
//!   seedsecret <u64> <secret> <data>     `Hasher::oneshot_with_seed_and_secret(seed, secret, data)`
//!   stream <ctor> <chunks> <data>        a streaming `Hasher` (`<ctor>`: `new` | `seed=<u64>` |
//!                                        `seedsecret=<u64>,<secret>`) fed `data` in pieces of the
//!                                        comma-separated `<chunks>` sizes (cycled; a 0 is an empty
//!                                        write); prints `finish_128()` after every write
//!   gen <len> <k> <chunks>               `data` = `gen_data(len, k)`; prints `oneshot` then the
//!                                        `stream new` hash (only the final one) of it
//!
//! `<data>` and `<secret>` are `x` followed by lowercase hex (`x` alone is empty). Hashes are printed as
//! 32 lowercase hex digits (`{:032x}`); an `Err` prints `err <display>`.
use std::io::{BufRead, Write};

use twox_hash::XxHash3_128 as Hasher;

fn unhex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix('x').expect("data must start with `x`");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

/// Deterministic test data: an xorshift64* stream seeded by `k` (the same in the TS test).
fn gen_data(len: usize, k: u64) -> Vec<u8> {
    let mut x = k.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    (0..len)
        .map(|_| {
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 56) as u8
        })
        .collect()
}

fn res(r: Result<u128, twox_hash::xxhash3_128::OneshotWithSecretError>) -> String {
    match r {
        Ok(h) => format!("{h:032x}"),
        Err(e) => format!("err {e}"),
    }
}

fn chunks(spec: &str) -> Vec<usize> {
    spec.split(',').map(|c| c.parse().unwrap()).collect()
}

fn stream(mut h: Hasher, sizes: &[usize], data: &[u8], all: bool) -> String {
    let mut out = Vec::new();
    let mut rest = data;
    let mut i = 0;
    loop {
        let n = sizes[i % sizes.len()].min(rest.len());
        let (head, tail) = rest.split_at(n);
        h.write(head);
        rest = tail;
        i += 1;
        if all {
            out.push(format!("{:032x}", h.finish_128()));
        }
        if rest.is_empty() && (n != 0 || i >= sizes.len()) {
            break;
        }
    }
    if !all {
        out.push(format!("{:032x}", h.finish_128()));
    }
    out.join(" ")
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::new(stdout.lock());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let w: Vec<&str> = line.split_whitespace().collect();
        if w.is_empty() {
            continue;
        }
        let r = match w[0] {
            "oneshot" => format!("{:032x}", Hasher::oneshot(&unhex(w[1]))),
            "seed" => format!("{:032x}", Hasher::oneshot_with_seed(w[1].parse().unwrap(), &unhex(w[2]))),
            "secret" => res(Hasher::oneshot_with_secret(&unhex(w[1]), &unhex(w[2]))),
            "seedsecret" => res(Hasher::oneshot_with_seed_and_secret(w[1].parse().unwrap(), &unhex(w[2]), &unhex(w[3]))),
            "stream" => {
                let h = if w[1] == "new" {
                    Some(Hasher::new())
                } else if let Some(s) = w[1].strip_prefix("seed=") {
                    Some(Hasher::with_seed(s.parse().unwrap()))
                } else if let Some(s) = w[1].strip_prefix("seedsecret=") {
                    let (seed, secret) = s.split_once(',').unwrap();
                    Hasher::with_seed_and_secret(seed.parse().unwrap(), unhex(secret)).ok()
                } else {
                    panic!("bad ctor {}", w[1])
                };
                match h {
                    Some(h) => stream(h, &chunks(w[2]), &unhex(w[3]), true),
                    None => "err secret too short".to_string(),
                }
            }
            "gen" => {
                let data = gen_data(w[1].parse().unwrap(), w[2].parse().unwrap());
                format!("{:032x} {}", Hasher::oneshot(&data), stream(Hasher::new(), &chunks(w[3]), &data, false))
            }
            c => panic!("unknown command {c}"),
        };
        writeln!(out, "{r}").unwrap();
    }
}
