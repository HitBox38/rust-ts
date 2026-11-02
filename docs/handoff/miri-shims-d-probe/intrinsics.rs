// Miri-oracle program of lane miri-shims-d: the intrinsics of src/tools/miri/src/intrinsics/{math,simd}.rs, run by the
// isolated Miri oracle (plan-m6 D1) with `-Zmiri-deterministic-floats` (no ULP error, `generate_nan` = the canonical
// NaN), target x86_64-unknown-linux-gnu. Its stdout is src/miri/intrinsics/intrinsics.oracle.txt, read by
// src/miri/intrinsics/intrinsics.test.ts. Each line: `<intrinsic> <operand bits..> <result bits>` (hex).
// Run: see docs/handoff/miri-shims-d.md ("Probe").
#![feature(core_intrinsics, f16, f128, repr_simd)]
#![allow(internal_features)]
use std::hint::black_box;
use std::intrinsics::{self, simd};

#[repr(simd)]
#[derive(Clone, Copy)]
struct F32x4([f32; 4]);
#[repr(simd)]
#[derive(Clone, Copy)]
struct F64x2([f64; 2]);

const INPUTS: [f64; 18] = [
    0.0, -0.0, 0.5, 1.0, -1.0, 2.0, 3.25, -7.5, 10.0, 100.125, 1e-3, 1e10, 0.1,
    std::f64::consts::PI, std::f64::consts::E, f64::INFINITY, f64::NEG_INFINITY, f64::NAN,
];
const EXPS: [i32; 7] = [0, 1, 2, 3, -1, -3, 11];

fn main() {
    for &x in &INPUTS {
        let (d, s, h) = (x, x as f32, x as f32 as f16);
        let q = x as f128;
        println!("sqrtf64 {:016x} {:016x}", d.to_bits(), intrinsics::sqrtf64(black_box(d)).to_bits());
        println!("sqrtf32 {:08x} {:08x}", s.to_bits(), intrinsics::sqrtf32(black_box(s)).to_bits());
        println!("sqrtf16 {:04x} {:04x}", h.to_bits(), intrinsics::sqrtf16(black_box(h)).to_bits());
        println!("sqrtf128 {:032x} {:032x}", q.to_bits(), intrinsics::sqrtf128(black_box(q)).to_bits());
        macro_rules! unary {
            ($name:ident) => {
                println!(concat!(stringify!($name), " f64 {:016x} {:016x}"), d.to_bits(), intrinsics::$name(black_box(d)).to_bits());
                println!(concat!(stringify!($name), " f32 {:08x} {:08x}"), s.to_bits(), intrinsics::$name(black_box(s)).to_bits());
                println!(concat!(stringify!($name), " f16 {:04x} {:04x}"), h.to_bits(), intrinsics::$name(black_box(h)).to_bits());
            };
        }
        unary!(sin);
        unary!(cos);
        unary!(exp);
        unary!(exp2);
        unary!(log);
        unary!(log10);
        unary!(log2);
        for &y in &INPUTS {
            let (dy, sy, hy) = (y, y as f32, y as f32 as f16);
            println!("powf64 {:016x} {:016x} {:016x}", d.to_bits(), dy.to_bits(), intrinsics::powf64(black_box(d), black_box(dy)).to_bits());
            println!("powf32 {:08x} {:08x} {:08x}", s.to_bits(), sy.to_bits(), intrinsics::powf32(black_box(s), black_box(sy)).to_bits());
            println!("powf16 {:04x} {:04x} {:04x}", h.to_bits(), hy.to_bits(), intrinsics::powf16(black_box(h), black_box(hy)).to_bits());
        }
        for &n in &EXPS {
            println!("powif64 {:016x} {:08x} {:016x}", d.to_bits(), n as u32, intrinsics::powif64(black_box(d), black_box(n)).to_bits());
            println!("powif32 {:08x} {:08x} {:08x}", s.to_bits(), n as u32, intrinsics::powif32(black_box(s), black_box(n)).to_bits());
            println!("powif16 {:04x} {:08x} {:04x}", h.to_bits(), n as u32, intrinsics::powif16(black_box(h), black_box(n)).to_bits());
        }
    }
    // simd_fsqrt / simd_fsin / .. on f32x4 and f64x2 (lanes from INPUTS in order).
    for c in INPUTS.chunks(4) {
        let mut l = [0f32; 4];
        for (i, v) in c.iter().enumerate() {
            l[i] = *v as f32;
        }
        let v = black_box(F32x4(l));
        macro_rules! simd4 {
            ($name:ident) => {{
                let r: F32x4 = unsafe { simd::$name(v) };
                // (no projection into a SIMD type: MCP#838)
                let r: [f32; 4] = unsafe { std::mem::transmute(r) };
                println!(
                    concat!(stringify!($name), " f32x4 {:08x} {:08x} {:08x} {:08x} {:08x} {:08x} {:08x} {:08x}"),
                    l[0].to_bits(), l[1].to_bits(), l[2].to_bits(), l[3].to_bits(),
                    r[0].to_bits(), r[1].to_bits(), r[2].to_bits(), r[3].to_bits()
                );
            }};
        }
        simd4!(simd_fsqrt);
        simd4!(simd_fsin);
        simd4!(simd_fcos);
        simd4!(simd_fexp);
        simd4!(simd_fexp2);
        simd4!(simd_flog);
        simd4!(simd_flog2);
        simd4!(simd_flog10);
    }
    for c in INPUTS.chunks(2) {
        let l = [c[0], c[1]];
        let v = black_box(F64x2(l));
        macro_rules! simd2 {
            ($name:ident) => {{
                let r: F64x2 = unsafe { simd::$name(v) };
                let r: [f64; 2] = unsafe { std::mem::transmute(r) };
                println!(
                    concat!(stringify!($name), " f64x2 {:016x} {:016x} {:016x} {:016x}"),
                    l[0].to_bits(), l[1].to_bits(), r[0].to_bits(), r[1].to_bits()
                );
            }};
        }
        simd2!(simd_fsqrt);
        simd2!(simd_fsin);
        simd2!(simd_flog);
    }
}
