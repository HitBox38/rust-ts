// Oracle probe of lane miri-eval-fix: the output is src/miri/math.oracle.txt (read by src/miri/math.test.ts).
//
// Part 1 (RNG helpers): Miri's math.rs `apply_random_float_error` / `apply_random_float_error_ulp` and operator.rs
// `generate_nan`, statement for statement, over `(mode, &mut StdRng)` instead of the `ecx` (the `float_nondet` guard
// is the caller's), on one `StdRng::seed_from_u64(0)` stream (Miri's default seed, eval.rs:215). The stream is wrapped
// in `Counting`, and after every line the running numbers of `next_u32` / `next_u64` / `fill_bytes` calls are printed
// (`@ n32 n64 nbytes`): the draws each call makes are checked line by line (rand 0.10's `StdRng` is not `Clone`).
//
// Part 2 (host float operations): `sin cos exp exp2 ln log10 log2 powf powi` of `f64` / `f32` / `f16` over a large
// deterministic sample (`Gen` below; math.test.ts has the same generator), each output folded into an FNV-1a hash.
// These are what the Miri binary computes on this host: calls into the host libm and compiler-builtins'
// `__powi{s,d}f2`, with runtime arguments (`black_box`), `f16` widened to `f32` and rounded back (checked with
// `otool -tV` on both binaries). NaN results are hashed as one canonical NaN: Miri replaces any NaN result
// (`adjust_nan` → `generate_nan`), so a host NaN's sign and payload are not observable.
//
// `mirimath <host tuple>` prints everything; `mirimath <host tuple> dump <width> <op>` prints the outputs of one op of
// part 2, one hex word per line (to locate a hash mismatch).
#![feature(f16, f128)]
use rand::rngs::StdRng;
use rand::seq::IteratorRandom;
use rand::{Rng, RngExt, SeedableRng, TryRng};
use std::convert::Infallible;
use rustc_apfloat::ieee::{Double, Half, Quad, Single};
use rustc_apfloat::{Float, FloatConvert};
use std::hint::black_box;
use std::iter;

/// `StdRng` with call counters (the draw-count fingerprint).
struct Counting {
    rng: StdRng,
    n32: u64,
    n64: u64,
    nbytes: u64,
}
impl TryRng for Counting {
    type Error = Infallible;
    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        self.n32 += 1;
        Ok(self.rng.next_u32())
    }
    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        self.n64 += 1;
        Ok(self.rng.next_u64())
    }
    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible> {
        self.nbytes += 1;
        self.rng.fill_bytes(dst);
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Random,
    Max,
}

// math.rs:71
fn apply_random_float_error<F: Float>(rng: &mut Counting, mode: Mode, val: F, err_scale: i32) -> F {
    if val.is_zero() || !val.is_finite() {
        return val;
    }
    let r = F::from_u128(match mode {
        Mode::Random => rng.random_range(0..(1 << F::PRECISION)),
        Mode::Max => (1 << F::PRECISION) - 1,
    })
    .value;
    let err = r.scalbn(err_scale.strict_sub(F::PRECISION.try_into().unwrap()));
    let err = if rng.random() { -err } else { err };
    (val + (val * err).value).value
}

// math.rs:108
fn apply_random_float_error_ulp<F: Float>(rng: &mut Counting, mode: Mode, val: F, max_error: u32) -> F {
    if val.is_zero() || !val.is_finite() {
        return val;
    }
    let max_error = i64::from(max_error);
    let error = match mode {
        Mode::Random => rng.random_range(-max_error..=max_error),
        Mode::Max => {
            if rng.random() {
                max_error
            } else {
                -max_error
            }
        }
    };
    let ulp = (((val.next_up().value - val).value + (val - val.next_down().value).value).value / F::from_u128(2).value).value;
    (val + (ulp * F::from_i128(error.into()).value).value).value
}

// operator.rs:74
fn generate_nan<F1: Float + FloatConvert<F2>, F2: Float>(rand: &mut Counting, inputs: &[F1]) -> F2 {
    fn make_signaling<F: Float>(f: F) -> Option<F> {
        let quiet_bit_mask = 1 << (F::PRECISION - 2);
        let f = F::from_bits(f.to_bits() & !quiet_bit_mask);
        if f.is_nan() { Some(f) } else { None }
    }
    let preferred_nan = F2::qnan(Some(0));
    let nans = iter::once(preferred_nan)
        .chain(inputs.iter().filter(|f| f.is_nan()).map(|&f| f.convert(&mut false).value))
        .chain(inputs.iter().filter(|f| f.is_signaling()).filter_map(|&f| {
            let f: F2 = f.convert(&mut false).value;
            make_signaling(f)
        }));
    let nan = nans.choose(&mut *rand).unwrap();
    if rand.random() { -nan } else { nan }
}

fn vals_f64() -> Vec<f64> {
    black_box(vec![1.0, -2.5, 3.141592653589793, 1e-300, 1.7976931348623157e308, 0.1, 123456.789, -7.0e-5, 5e-324])
}
fn vals_f32() -> Vec<f32> {
    black_box(vec![1.0, -2.5, 3.1415927, 1e-30, 3.4028235e38, 0.1, 123456.79, -7.0e-5, 1e-45])
}
fn vals_f16() -> Vec<f16> {
    black_box(vec![1.0, -2.5, 0.1, 65504.0, 6.0e-8, -0.000061])
}
fn vals_f128() -> Vec<f128> {
    black_box(vec![1.0, -2.5, 3.14159265358979323846264338327950288, 1e-4000, 0.1, -7.0e-5, 1.0e4000, 1.2e-4950])
}

/// The draw counts so far (the fingerprint after each line).
fn at(rng: &mut Counting) -> String {
    format!("@ {} {} {}", rng.n32, rng.n64, rng.nbytes)
}

fn part1() {
    let mut rng = Counting { rng: StdRng::seed_from_u64(0), n32: 0, n64: 0, nbytes: 0 };
    let r = &mut rng;
    for v in vals_f64() {
        let x = apply_random_float_error(r, Mode::Random, Double::from_bits(v.to_bits().into()), -10);
        println!("are64 {:016x} {:016x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f32() {
        let x = apply_random_float_error(r, Mode::Random, Single::from_bits(v.to_bits().into()), -20);
        println!("are32 {:08x} {:08x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    // Production: x86 `rcp` / `rsqrt` (intrinsics/x86/mod.rs) use `f32` with `err_scale = -12`.
    for v in vals_f32() {
        let x = apply_random_float_error(r, Mode::Random, Single::from_bits(v.to_bits().into()), -12);
        println!("are32m12 {:08x} {:08x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f32() {
        let x = apply_random_float_error(r, Mode::Max, Single::from_bits(v.to_bits().into()), -12);
        println!("aremax32m12 {:08x} {:08x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f64() {
        let x = apply_random_float_error(r, Mode::Max, Double::from_bits(v.to_bits().into()), -10);
        println!("aremax64 {:016x} {:016x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f64() {
        let x = apply_random_float_error_ulp(r, Mode::Random, Double::from_bits(v.to_bits().into()), 4);
        println!("ulp64 {:016x} {:016x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f32() {
        let x = apply_random_float_error_ulp(r, Mode::Random, Single::from_bits(v.to_bits().into()), 16);
        println!("ulp32 {:08x} {:08x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f16() {
        let x = apply_random_float_error_ulp(r, Mode::Random, Half::from_bits(v.to_bits().into()), 4);
        println!("ulp16 {:04x} {:04x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f16() {
        let x = apply_random_float_error_ulp(r, Mode::Max, Half::from_bits(v.to_bits().into()), 4);
        println!("ulpmax16 {:04x} {:04x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    // `apply_random_float_error_to_imm` (machine.rs `apply_float_nondet`, max_error 4) dispatches f128 too.
    for v in vals_f128() {
        let x = apply_random_float_error_ulp(r, Mode::Random, Quad::from_bits(v.to_bits()), 4);
        println!("ulp128 {:032x} {:032x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    for v in vals_f128() {
        let x = apply_random_float_error_ulp(r, Mode::Max, Quad::from_bits(v.to_bits()), 4);
        println!("ulpmax128 {:032x} {:032x} {}", v.to_bits(), x.to_bits(), at(r));
    }
    let snan = Double::snan(Some(5));
    let qnan = Double::qnan(Some(7));
    for inputs in [vec![Double::from_bits(1.0f64.to_bits().into())], vec![qnan], vec![snan, qnan], vec![snan]] {
        let x: Single = generate_nan(r, &inputs);
        let x2: Double = generate_nan(r, &inputs);
        let x3: Half = generate_nan(r, &inputs);
        let x4: Quad = generate_nan(r, &inputs);
        println!("nan {:08x} {:016x} {:04x} {:032x} {}", x.to_bits(), x2.to_bits(), x3.to_bits(), x4.to_bits(), at(r));
    }
    println!("next {:016x}", r.rng.next_u64());
    println!(
        "pi {:04x} {:08x} {:016x}",
        core::f16::consts::PI.to_bits(),
        core::f32::consts::PI.to_bits(),
        core::f64::consts::PI.to_bits()
    );
}

/// mulberry32: the input generator of part 2 (math.test.ts has the same).
struct Gen(u32);
impl Gen {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    /// An `f32` bit pattern of class `c`: 0 any, 1 |x| in [2^-10, 2^8), 2 in [2^-2, 2^2), 3 in [2^7, 2^37).
    fn f32_bits(&mut self, c: u32) -> u32 {
        let u = self.next();
        let e = match c {
            0 => return u,
            1 => 117 + self.next() % 18,
            2 => 125 + self.next() % 4,
            _ => 134 + self.next() % 30,
        };
        (u & 0x807F_FFFF) | (e << 23)
    }
    /// An `f64` bit pattern of class `c`: 0 any, 1 [2^-10, 2^8), 2 [2^-2, 2^2), 3 [2^7, 2^67).
    fn f64_bits(&mut self, c: u32) -> u64 {
        let hi = self.next();
        let lo = self.next();
        let hi = match c {
            0 => hi,
            1 => (hi & 0x800F_FFFF) | ((1013 + self.next() % 18) << 20),
            2 => (hi & 0x800F_FFFF) | ((1021 + self.next() % 4) << 20),
            _ => (hi & 0x800F_FFFF) | ((1030 + self.next() % 60) << 20),
        };
        ((hi as u64) << 32) | lo as u64
    }
    /// A `powi` exponent: mostly in [-33, 33], every 16th any `i32`.
    fn powi_exp(&mut self, i: u32) -> i32 {
        let u = self.next();
        if i % 16 == 15 { u as i32 } else { (u % 67) as i32 - 33 }
    }
}

const N: u32 = 200_000;
const OPS: [&str; 9] = ["sin", "cos", "exp", "exp2", "ln", "log10", "log2", "powf", "powi"];
/// `f16` powf exponents (bits): 0.5, 1.37, 2, -1, -2.5, 0.1, 7.75, inf.
const POWF16_Y: [u16; 8] = [0x3800, 0x3d7b, 0x4000, 0xbc00, 0xc100, 0x2e66, 0x47c0, 0x7c00];
/// `f16` powi exponents.
const POWI16_N: [i32; 15] = [-3, -2, -1, 1, 2, 3, 5, 7, -7, 11, 16, 31, -31, i32::MAX, i32::MIN];

/// FNV-1a over 32-bit words.
struct Fnv(u32);
impl Fnv {
    fn word(&mut self, w: u32) {
        for b in w.to_le_bytes() {
            self.0 ^= b as u32;
            self.0 = self.0.wrapping_mul(0x0100_0193);
        }
    }
}

fn f64_op(op: &str, x: f64, y: f64, n: i32) -> f64 {
    let x = black_box(x);
    match op {
        "sin" => x.sin(),
        "cos" => x.cos(),
        "exp" => x.exp(),
        "exp2" => x.exp2(),
        "ln" => x.ln(),
        "log10" => x.log10(),
        "log2" => x.log2(),
        "powf" => x.powf(black_box(y)),
        _ => x.powi(black_box(n)),
    }
}
fn f32_op(op: &str, x: f32, y: f32, n: i32) -> f32 {
    let x = black_box(x);
    match op {
        "sin" => x.sin(),
        "cos" => x.cos(),
        "exp" => x.exp(),
        "exp2" => x.exp2(),
        "ln" => x.ln(),
        "log10" => x.log10(),
        "log2" => x.log2(),
        "powf" => x.powf(black_box(y)),
        _ => x.powi(black_box(n)),
    }
}
fn f16_op(op: &str, x: f16, y: f16, n: i32) -> f16 {
    let x = black_box(x);
    match op {
        "sin" => x.sin(),
        "cos" => x.cos(),
        "exp" => x.exp(),
        "exp2" => x.exp2(),
        "ln" => x.ln(),
        "log10" => x.log10(),
        "log2" => x.log2(),
        "powf" => x.powf(black_box(y)),
        _ => x.powi(black_box(n)),
    }
}

/// The outputs of one op of part 2, as 32-bit words (`f64`: high word, low word), NaN canonical.
fn outputs(width: &str, op: &str) -> Vec<u32> {
    let mut out = Vec::new();
    match width {
        "f64" => {
            let mut g = Gen(0x6d69_7269);
            for i in 0..N {
                let x = f64::from_bits(g.f64_bits(i % 4));
                let y = f64::from_bits(g.f64_bits((i / 4) % 4));
                let n = g.powi_exp(i);
                let r = f64_op(op, x, y, n);
                let b = if r.is_nan() { 0x7ff8_0000_0000_0000 } else { r.to_bits() };
                out.push((b >> 32) as u32);
                out.push(b as u32);
            }
        }
        "f32" => {
            let mut g = Gen(0x6d69_7269);
            for i in 0..N {
                let x = f32::from_bits(g.f32_bits(i % 4));
                let y = f32::from_bits(g.f32_bits((i / 4) % 4));
                let n = g.powi_exp(i);
                let r = f32_op(op, x, y, n);
                out.push(if r.is_nan() { 0x7fc0_0000 } else { r.to_bits() });
            }
        }
        _ => {
            // Exhaustive over the 65,536 `f16` bit patterns (powf: × POWF16_Y, powi: × POWI16_N).
            let push = |out: &mut Vec<u32>, r: f16| out.push(if r.is_nan() { 0x7e00 } else { r.to_bits() as u32 });
            match op {
                "powf" => {
                    for &y in &POWF16_Y {
                        for b in 0..=u16::MAX {
                            push(&mut out, f16_op(op, f16::from_bits(b), f16::from_bits(y), 0));
                        }
                    }
                }
                "powi" => {
                    for &n in &POWI16_N {
                        for b in 0..=u16::MAX {
                            push(&mut out, f16_op(op, f16::from_bits(b), 0.0f16, n));
                        }
                    }
                }
                _ => {
                    for b in 0..=u16::MAX {
                        push(&mut out, f16_op(op, f16::from_bits(b), 0.0f16, 0));
                    }
                }
            }
        }
    }
    out
}

fn part2() {
    for width in ["f64", "f32", "f16"] {
        for op in OPS {
            let out = outputs(width, op);
            let mut h = Fnv(0x811c_9dc5);
            for &w in &out {
                h.word(w);
            }
            println!("host {width} {op} {} {:08x}", out.len(), h.0);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let tuple = args.get(1).expect("usage: mirimath <host tuple> [dump <width> <op>]");
    // The tuple names the host whose libm the outputs are (the test compares it with RUST_TS_HOST_TUPLE).
    assert!(tuple.starts_with(std::env::consts::ARCH), "host tuple {tuple} is not this {} host", std::env::consts::ARCH);
    if args.get(2).map(String::as_str) == Some("dump") {
        for w in outputs(&args[3], &args[4]) {
            println!("{w:08x}");
        }
        return;
    }
    println!("tuple {tuple}");
    part1();
    part2();
}
