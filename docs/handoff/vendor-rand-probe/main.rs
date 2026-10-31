// Oracle probe for src/vendor/{rand_core,rand,chacha20} (lane vendor-rand, plan-m6 D5).
// Prints StdRng (ChaCha12) streams and the draws Miri makes (random::<bool>, random_range over u64/usize/i64/u128,
// random_bool, fill_bytes, IndexedRandom::choose, IteratorRandom::choose), one `name: values` line each.
// Every group ends with `tail=<next_u32>` so the number of words a draw consumed is checked too.
use rand::rngs::StdRng;
use rand::seq::{IndexedRandom, IteratorRandom};
use rand::{Rng, RngExt, SeedableRng};
use std::fmt::Display;

fn line<T: Display>(name: &str, vals: impl IntoIterator<Item = T>, r: &mut StdRng) {
    let v: Vec<String> = vals.into_iter().map(|x| x.to_string()).collect();
    println!("{name}: {} tail={}", v.join(" "), r.next_u32());
}

fn opt<T: Display>(o: Option<T>) -> String {
    match o {
        Some(x) => x.to_string(),
        None => "-".to_string(),
    }
}

fn hex(b: &[u8]) -> String {
    let mut s = String::from("x");
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

/// FNV-1a 64 of the bytes (keeps the long fills short in the output).
fn fnv1a64(b: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

const SEEDS: [u64; 6] = [0, 1, 2, 42, 0xdead_beef, u64::MAX];

fn main() {
    for &seed in &SEEDS {
        let mut r = StdRng::seed_from_u64(seed);
        let v: Vec<u32> = (0..200).map(|_| r.next_u32()).collect();
        line(&format!("u32 {seed}"), v, &mut r);

        let mut r = StdRng::seed_from_u64(seed);
        let v: Vec<u64> = (0..100).map(|_| r.next_u64()).collect();
        line(&format!("u64 {seed}"), v, &mut r);

        // u32/u64 interleavings put next_u64_from_u32 on every index parity and on the block edge.
        let mut r = StdRng::seed_from_u64(seed);
        let mut v = Vec::new();
        for i in 0..300 {
            match i % 3 {
                0 => v.push(r.next_u32() as u64),
                _ => v.push(r.next_u64()),
            }
        }
        line(&format!("mixed {seed}"), v, &mut r);

        let mut r = StdRng::seed_from_u64(seed);
        let mut v = Vec::new();
        for len in [0usize, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 63, 64, 65, 255, 256, 257, 1000] {
            let mut buf = vec![0u8; len];
            r.fill_bytes(&mut buf);
            v.push(format!("{}/{}", hex(&buf), r.next_u32()));
        }
        line(&format!("fill {seed}"), v, &mut r);
    }

    // Every buffer offset: `k` words consumed, then fills / u64s that start on each index of the 64-word block.
    for k in 0..130usize {
        let mut r = StdRng::seed_from_u64(3);
        for _ in 0..k {
            r.next_u32();
        }
        let mut v = Vec::new();
        for len in [1usize, 2, 3, 4, 5, 6, 7, 8, 9, 255, 256, 257] {
            let mut buf = vec![0u8; len];
            r.fill_bytes(&mut buf);
            v.push(if len <= 9 { hex(&buf) } else { format!("fnv{:016x}", fnv1a64(&buf)) });
        }
        let mut r2 = StdRng::seed_from_u64(3);
        for _ in 0..k {
            r2.next_u32();
        }
        v.push(format!("{}/{}/{}", r2.next_u64(), r2.next_u64(), r2.next_u32()));
        line(&format!("offset {k}"), v, &mut r);
    }

    // from_seed and from_rng
    for k in 0u8..4 {
        let mut seed = [0u8; 32];
        for (i, b) in seed.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(37).wrapping_add(k.wrapping_mul(101));
        }
        let mut r = StdRng::from_seed(seed);
        let v: Vec<u64> = (0..20).map(|_| r.next_u64()).collect();
        line(&format!("from_seed {k}"), v, &mut r);
        let mut child = StdRng::from_rng(&mut r);
        let v: Vec<u64> = (0..20).map(|_| child.next_u64()).collect();
        line(&format!("from_rng {k}"), v, &mut r);
    }

    for &seed in &[0u64, 7] {
        let mut r = StdRng::seed_from_u64(seed);
        let v: Vec<bool> = (0..300).map(|_| r.random::<bool>()).collect();
        line(&format!("bool {seed}"), v.iter().map(|&b| b as u8), &mut r);

        let v: Vec<u64> = (0..200).map(|_| r.random_range(0..16)).collect();
        line(&format!("u64range16 {seed}"), v, &mut r);

        let v: Vec<usize> = (0..200).map(|_| r.random_range(0..32usize)).collect();
        line(&format!("usize32 {seed}"), v, &mut r);

        for (lo, hi) in [(3usize, 10usize), (0, 1), (5, 6), (0, 1000), (7, 1 << 20), (1 << 20, 1 << 33), (0, (1 << 32) + 1)] {
            let v: Vec<usize> = (0..50).map(|_| r.random_range(lo..hi)).collect();
            line(&format!("usize {lo}..{hi} {seed}"), v, &mut r);
        }

        for (lo, hi) in [(12u32, 24u32), (0, 0), (0, u32::MAX), (1, u32::MAX)] {
            let v: Vec<u32> = (0..50).map(|_| r.random_range(lo..=hi)).collect();
            line(&format!("u32incl {lo}..={hi} {seed}"), v, &mut r);
        }

        for m in [0i64, 1, 3, 16, 1000, i64::MAX] {
            let v: Vec<i64> = (0..60).map(|_| r.random_range(-m..=m)).collect();
            line(&format!("i64incl {m} {seed}"), v, &mut r);
        }
        let v: Vec<i64> = (0..30).map(|_| r.random_range(i64::MIN..=i64::MAX)).collect();
        line(&format!("i64full {seed}"), v, &mut r);

        for p in [11u32, 24, 53, 64, 113] {
            let v: Vec<u128> = (0..40).map(|_| r.random_range(0..(1u128 << p))).collect();
            line(&format!("u128range {p} {seed}"), v, &mut r);
        }

        for p in [0.0f64, 1e-9, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999, 1.0] {
            let v: Vec<bool> = (0..100).map(|_| r.random_bool(p)).collect();
            line(&format!("random_bool {p} {seed}"), v.iter().map(|&b| b as u8), &mut r);
        }

        for (n, d) in [(1u32, 3u32), (2, 7), (5, 5), (0, 4)] {
            let v: Vec<bool> = (0..60).map(|_| r.random_ratio(n, d)).collect();
            line(&format!("random_ratio {n}/{d} {seed}"), v.iter().map(|&b| b as u8), &mut r);
        }

        let v: Vec<String> = (0..10)
            .map(|_| {
                format!(
                    "{},{},{},{},{},{},{},{}",
                    r.random::<u8>(),
                    r.random::<u16>(),
                    r.random::<i8>(),
                    r.random::<i32>(),
                    r.random::<i64>(),
                    r.random::<u128>(),
                    r.random::<i128>(),
                    r.random::<u64>()
                )
            })
            .collect();
        line(&format!("ints {seed}"), v, &mut r);

        let mut v = Vec::new();
        for n in 0..12u32 {
            let xs: Vec<u32> = (0..n).collect();
            for _ in 0..5 {
                v.push(opt(xs.choose(&mut r)));
            }
        }
        line(&format!("slice_choose {seed}"), v, &mut r);

        let mut v = Vec::new();
        for n in 0..10u32 {
            for _ in 0..3 {
                v.push(opt((0..n).choose(&mut r)));
            }
        }
        line(&format!("iter_exact {seed}"), v, &mut r);

        let mut v = Vec::new();
        for n in 0..40u32 {
            for _ in 0..3 {
                v.push(opt((0..n).filter(|x| x % 3 != 1).choose(&mut r)));
            }
        }
        line(&format!("iter_filter {seed}"), v, &mut r);

        let mut v = Vec::new();
        for (n, m) in [(0u32, 0u32), (1, 0), (2, 0), (2, 5), (5, 9), (10, 1), (3, 30), (17, 17)] {
            for _ in 0..4 {
                v.push(opt((0..n).chain((100..100 + m).filter(|x| x % 2 == 0)).choose(&mut r)));
            }
        }
        line(&format!("iter_chain {seed}"), v, &mut r);

        // The scheduler's shape: skip(k).chain(take(k)).filter(enabled).
        let mut v = Vec::new();
        for len in 1..9usize {
            let threads: Vec<(usize, bool)> = (0..len).map(|i| (i, i % 4 != 2)).collect();
            for k in 0..len {
                let it = threads
                    .iter()
                    .skip(k + 1)
                    .chain(threads.iter().take(k + 1))
                    .filter(|(_, enabled)| *enabled);
                v.push(opt(it.choose(&mut r).map(|(i, _)| *i)));
            }
        }
        line(&format!("iter_sched {seed}"), v, &mut r);

        const SUBSTITUTIONS: &[char; 62] = &[
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u',
            'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
            'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
        ];
        let v: Vec<String> = (0..10).map(|_| (0..6).map(|_| SUBSTITUTIONS.choose(&mut r).unwrap()).collect::<String>()).collect();
        line(&format!("mkstemp {seed}"), v, &mut r);
    }
}
