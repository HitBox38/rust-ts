// Probe of lane miri-x86-a: every `llvm.x86.sse41.*` arm of intrinsics/x86/sse41.rs (`-C target-feature=+sse4.1`), called
// directly by link name: every rounding mode on ties, NaNs and infinities, dot products with NaNs, saturation.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse41.insertps"] fn insertps(a: __m128, b: __m128, imm: u8) -> __m128;
    #[link_name = "llvm.x86.sse41.packusdw"] fn packusdw(a: i32x4, b: i32x4) -> u16x8;
    #[link_name = "llvm.x86.sse41.dpps"] fn dpps(a: __m128, b: __m128, imm: u8) -> __m128;
    #[link_name = "llvm.x86.sse41.dppd"] fn dppd(a: __m128d, b: __m128d, imm: u8) -> __m128d;
    #[link_name = "llvm.x86.sse41.round.ss"] fn round_ss(a: __m128, b: __m128, r: i32) -> __m128;
    #[link_name = "llvm.x86.sse41.round.ps"] fn round_ps(a: __m128, r: i32) -> __m128;
    #[link_name = "llvm.x86.sse41.round.sd"] fn round_sd(a: __m128d, b: __m128d, r: i32) -> __m128d;
    #[link_name = "llvm.x86.sse41.round.pd"] fn round_pd(a: __m128d, r: i32) -> __m128d;
    #[link_name = "llvm.x86.sse41.phminposuw"] fn phminposuw(a: u16x8) -> u16x8;
    #[link_name = "llvm.x86.sse41.mpsadbw"] fn mpsadbw(a: u8x16, b: u8x16, imm: u8) -> u16x8;
    #[link_name = "llvm.x86.sse41.ptestnzc"] fn ptestnzc(a: i64x2, b: i64x2) -> i32;
}

// 0, -0, .5, -.5, 1.5, -1.5, 2.5, -2.5, denormals, exact-odd above 2^23, MAX, inf, -inf, qNaN, largest below .5, sNaN, -qNaN
static F32S: [u32; 18] = [
    0, 0x8000_0000, 0x3f00_0000, 0xbf00_0000, 0x3fc0_0000, 0xbfc0_0000, 0x4020_0000, 0xc020_0000, 0x0001_16c2, 0x8001_16c2,
    0x4b00_0001, 0x7f7f_ffff, 0x7f80_0000, 0xff80_0000, 0x7fc0_0000, 0x3eff_ffff, 0x7f80_0001, 0xffc1_2345,
];
static F64S: [u64; 18] = [
    0, 0x8000_0000_0000_0000, 0x3fe0_0000_0000_0000, 0xbfe0_0000_0000_0000, 0x3ff8_0000_0000_0000, 0xbff8_0000_0000_0000,
    0x4004_0000_0000_0000, 0xc004_0000_0000_0000, 1, 0x8000_0000_0000_0001, 0x4330_0000_0000_0001, 0x7fef_ffff_ffff_ffff,
    0x7ff0_0000_0000_0000, 0xfff0_0000_0000_0000, 0x7ff8_0000_0000_0000, 0x3fdf_ffff_ffff_ffff, 0x7ff0_0000_0000_0001,
    0xfff8_1234_5678_9abc,
];
static ROUNDS: [i32; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
static INS: [u8; 22] = [
    0, 1, 2, 4, 8, 0x0f, 0x10, 0x20, 0x30, 0x40, 0x80, 0xc0, 0x50, 0x65, 0x7a, 0x8f, 0x9c, 0xb1, 0xc6, 0xdb, 0xf0, 0xff,
];
static DS: [[i32; 4]; 2] = [[i32::MIN, i32::MAX, -1, 1], [65535, 65536, 0, 32768]];
static PA: [[u32; 4]; 3] = [
    [0x3fc0_0000, 0x4000_0000, 0xc040_0000, 0x3e80_0000],
    [0x7f7f_ffff, 0x7f7f_ffff, 0xff7f_ffff, 0x3f80_0000],
    [0x7f80_0000, 0, 0x7fc0_0000, 0x3f80_0000],
];
static PB: [[u32; 4]; 2] = [[0x4000_0000, 0x4080_0000, 0x3f00_0000, 0x4180_0000], [0x7f80_0000, 0x3f80_0000, 0xbf80_0000, 0x7f80_0001]];
static DPS_IMMS: [u8; 7] = [0xff, 0xf1, 0x1f, 0x35, 0xa2, 0x00, 0x7c];
static DA: [[u64; 2]; 3] = [
    [0x3ff8_0000_0000_0000, 0x4000_0000_0000_0000],
    [0x7fef_ffff_ffff_ffff, 0x7fef_ffff_ffff_ffff],
    [0x7ff0_0000_0000_0000, 0x7ff8_0000_0000_0000],
];
static DB: [[u64; 2]; 2] = [[0x4000_0000_0000_0000, 0x4010_0000_0000_0000], [0x7ff0_0000_0000_0000, 0xbff0_0000_0000_0000]];
static DPD_IMMS: [u8; 6] = [0x33, 0x31, 0x13, 0x22, 0x00, 0xff];
static MINS: [[u16; 8]; 5] = [
    [23, 18, 44, 97, 50, 13, 67, 66], [0, 0, 1, 1, 2, 2, 3, 3], [0xffff; 8], [9, 8, 7, 6, 5, 4, 3, 2],
    [0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xffff, 0xfffe],
];
static TESTS: [[u64; 2]; 6] = [[0, 0], [u64::MAX, u64::MAX], [1, 0], [0, 0x8000_0000_0000_0000], [0xf0f0, 0xff00], [0x0f0f, 0x00ff]];

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    let a: __m128 = t([1.0f32, 2.0, 3.0, 4.0]);
    let b: __m128 = t([5.0f32, 6.0, 7.0, 8.0]);
    each!(imm in INS => { hex(imm); f("insertps", insertps(a, b, imm)); nl(); });

    each!(x in DS => { each!(y in DS => { f("packusdw", packusdw(t(x), t(y))); nl(); }); });

    each!(a in PA => { each!(b in PB => { each!(imm in DPS_IMMS => {
        hex(imm); f("dpps", dpps(t(a), t(b), imm)); nl();
    }); }); });
    each!(a in DA => { each!(b in DB => { each!(imm in DPD_IMMS => {
        hex(imm); f("dppd", dppd(t(a), t(b), imm)); nl();
    }); }); });

    let lf: __m128 = t([100.0f32, 200.0, 300.0, 400.0]);
    let ld: __m128d = t([100.0f64, 200.0]);
    each!(r in ROUNDS => {
        hex(r as u8); nl();
        each!(x in F32S => {
            let v: __m128 = t([x, x ^ 0x8000_0000, x, 0x40f0_0000]);
            hex(x); f("ss", round_ss(lf, v, r)); f("ps", round_ps(v, r)); nl();
        });
        each!(x in F64S => {
            let v: __m128d = t([x, x ^ 0x8000_0000_0000_0000]);
            hex(x); f("sd", round_sd(ld, v, r)); f("pd", round_pd(v, r)); nl();
        });
    });

    each!(m in MINS => { f("phminposuw", phminposuw(t(m))); nl(); });

    let a8: [u8; 16] = [0, 255, 7, 8, 100, 200, 3, 9, 250, 1, 2, 3, 128, 127, 64, 32];
    let b8: [u8; 16] = [255, 0, 9, 1, 200, 100, 13, 88, 5, 250, 4, 1, 90, 91, 92, 93];
    let mut imm = 0u8;
    while imm < 16 {
        hex(imm); f("mpsadbw", mpsadbw(t(a8), t(b8), imm)); nl();
        imm += 1;
    }
    f("mpsadbw", mpsadbw(t(a8), t(b8), 0xff)); nl();

    each!(x in TESTS => { each!(y in TESTS => { f("nzc", ptestnzc(t(x), t(y))); }); nl(); });
    flush();
    0
} }
