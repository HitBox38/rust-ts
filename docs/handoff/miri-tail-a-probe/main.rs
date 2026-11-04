// For each seed and length: the `Xoshiro128StarStar::seed_from_u64` state stream and `shuffle` permutation that
// compiler/rustc_abi/src/layout.rs:1132-1137 computes. Printed one case per line; src/vendor/rand_xoshiro/shuffle.oracle.txt.
use rand::SeedableRng;
use rand::seq::SliceRandom;
use rand_xoshiro::rand_core::RngCore;

fn main() {
    let seeds: [u64; 8] = [
        0,
        1,
        2,
        42,
        0x9e3779b97f4a7c15,
        0xdeadbeefcafef00d,
        0xffff_ffff_ffff_ffff,
        0x0123_4567_89ab_cdef,
    ];
    for &seed in &seeds {
        let mut rng = rand_xoshiro::Xoshiro128StarStar::seed_from_u64(seed);
        let words: Vec<String> = (0..8).map(|_| rng.next_u32().to_string()).collect();
        let long = rng.next_u64();
        println!("next {seed} {} {long}", words.join(","));
        for n in [0usize, 1, 2, 3, 4, 5, 7, 8, 13, 14, 20, 21, 64, 300, 70000] {
            let mut v: Vec<u32> = (0..n as u32).collect();
            let mut rng = rand_xoshiro::Xoshiro128StarStar::seed_from_u64(seed);
            v.shuffle(&mut rng);
            let shown = v.iter().take(40).map(|x| x.to_string()).collect::<Vec<_>>().join(",");
            // The hash covers the part of a long permutation that is not printed.
            let h = v.iter().fold(0u64, |h, &x| h.wrapping_mul(0x100000001b3) ^ (x as u64));
            println!("shuffle {seed} {n} {h} {shown}");
        }
    }
}
