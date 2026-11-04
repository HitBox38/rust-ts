// Probe of lane miri-x86-a: the arms of intrinsics/x86/mod.rs itself: `addcarry` / `subborrow`, `pclmulqdq{,.256,.512}`
// (`-C target-feature=+pclmulqdq,+vpclmulqdq,+avx512f`).
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, improper_ctypes_definitions, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.addcarry.32"] fn adc32(c: u8, a: u32, b: u32) -> (u8, u32);
    #[link_name = "llvm.x86.addcarry.64"] fn adc64(c: u8, a: u64, b: u64) -> (u8, u64);
    #[link_name = "llvm.x86.subborrow.32"] fn sbb32(c: u8, a: u32, b: u32) -> (u8, u32);
    #[link_name = "llvm.x86.subborrow.64"] fn sbb64(c: u8, a: u64, b: u64) -> (u8, u64);
    #[link_name = "llvm.x86.pclmulqdq"] fn clmul(a: __m128i, b: __m128i, imm: u8) -> __m128i;
    #[link_name = "llvm.x86.pclmulqdq.256"] fn clmul256(a: __m256i, b: __m256i, imm: u8) -> __m256i;
    #[link_name = "llvm.x86.pclmulqdq.512"] fn clmul512(a: __m512i, b: __m512i, imm: u8) -> __m512i;
}

static CS: [u8; 4] = [0, 1, 2, 255];
static AB: [(u32, u32); 6] = [(0, 0), (u32::MAX, 1), (u32::MAX, u32::MAX), (1, 2), (0x8000_0000, 0x8000_0000), (u32::MAX, 0)];
static IMMS: [u8; 6] = [0, 1, 0x10, 0x11, 0xee, 0xff];

/// A `(u8, uN)` as its two fields, so that the padding between them is not read.
fn pair<T>(p: (u8, T)) {
    f("c", p.0);
    f("v", p.1);
}

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    each!(c in CS => { each!(ab in AB => {
        let (a, b) = ab;
        hex(c); put(b' '); hex(a); put(b' '); hex(b);
        pair(adc32(c, a, b)); pair(sbb32(c, a, b));
        let (a, b) = ((a as u64) << 32 | a as u64, (b as u64) << 32 | b as u64);
        pair(adc64(c, a, b)); pair(sbb64(c, a, b));
        nl();
    }); });
    let a: [u64; 8] = [0xdead_beef_cafe_f00d, u64::MAX, 3, u64::MAX, 0x8000_0000_0000_0000, 0xdead_beef_cafe_f00d, 7, 9];
    let b: [u64; 8] = [0x8000_0000_0000_0001, 0x0123_4567_89ab_cdef, 5, u64::MAX, 2, 0x0123_4567_89ab_cdef, 11, 13];
    let (a2, b2): ([u64; 2], [u64; 2]) = ([a[0], a[1]], [b[0], b[1]]);
    let (a4, b4): ([u64; 4], [u64; 4]) = ([a[0], a[1], a[2], a[3]], [b[0], b[1], b[2], b[3]]);
    each!(imm in IMMS => {
        hex(imm);
        f("128", clmul(t(a2), t(b2), imm));
        f("256", clmul256(t(a4), t(b4), imm));
        f("512", clmul512(t(a), t(b), imm));
        nl();
    });
    flush();
    0
} }
