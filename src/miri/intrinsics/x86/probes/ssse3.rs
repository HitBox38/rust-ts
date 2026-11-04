// Probe of lane miri-x86-a: intrinsics/x86/sse3.rs and ssse3.rs (`-C target-feature=+ssse3`), called directly by link name.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse3.ldu.dq"] fn ldu_dq(p: *const i8) -> i8x16;
    #[link_name = "llvm.x86.ssse3.pshuf.b.128"] fn pshuf_b(a: u8x16, b: u8x16) -> u8x16;
    #[link_name = "llvm.x86.ssse3.pmadd.ub.sw.128"] fn pmadd_ub_sw(a: u8x16, b: i8x16) -> i16x8;
    #[link_name = "llvm.x86.ssse3.pmul.hr.sw.128"] fn pmul_hr_sw(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.ssse3.psign.b.128"] fn psign_b(a: i8x16, b: i8x16) -> i8x16;
    #[link_name = "llvm.x86.ssse3.psign.w.128"] fn psign_w(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.ssse3.psign.d.128"] fn psign_d(a: i32x4, b: i32x4) -> i32x4;
}

static BUF: [u8; 32] = [
    3, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94, 101, 108, 115, 122, 129, 136, 143, 150, 157, 164, 171, 178, 185,
    192, 199, 206, 213, 220,
];
static OFFS: [usize; 5] = [0, 1, 7, 15, 16];
static PATS: [[u8; 16]; 4] = [
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    [0x80, 0x81, 0xff, 0x7f, 0x70, 0x10, 0x1f, 0x8f, 0, 1, 2, 3, 16, 17, 18, 19],
    [0; 16],
    [0x80; 16],
];
static U8S: [[u8; 16]; 3] = [
    [255; 16],
    [0, 1, 2, 127, 128, 200, 255, 254, 3, 4, 5, 6, 7, 8, 9, 10],
    [255, 255, 255, 0, 0, 255, 128, 128, 1, 2, 3, 4, 5, 6, 7, 8],
];
static I8S: [[i8; 16]; 3] = [
    [127; 16],
    [-128; 16],
    [127, 127, -128, -128, 127, -128, -128, 127, 1, -1, 2, -2, 3, -3, 4, -4],
];

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    each!(off in OFFS => { f("lddqu", ldu_dq((&raw const BUF as *const i8).add(off))); nl(); });

    let src: [u8; 16] = [10, 21, 32, 43, 54, 65, 76, 87, 98, 109, 120, 131, 142, 153, 164, 175];
    each!(p in PATS => { f("pshufb", pshuf_b(t(src), t(p))); nl(); });

    each!(a in U8S => { each!(b in I8S => { f("pmaddubsw", pmadd_ub_sw(t(a), t(b))); nl(); }); });

    let w1: [i16; 8] = [i16::MIN, i16::MAX, -1, 1, 0x4000, -0x4000, 0x1234, -0x1234];
    let w2: [i16; 8] = [i16::MIN, i16::MIN, -1, 1, 0x4000, 0x4000, 0x7fff, -0x7fff];
    f("pmulhrsw", pmul_hr_sw(t(w1), t(w2))); f("pmulhrsw", pmul_hr_sw(t(w1), t(w1))); nl();

    let sb: [i8; 16] = [-128, -1, 0, 1, 127, -128, 5, -5, 9, -9, 100, -100, 1, 2, 3, 4];
    let sc: [i8; 16] = [1, 1, 1, 1, 1, -1, -1, -1, 0, 0, 0, 0, 127, -128, 2, -2];
    f("psignb", psign_b(t(sb), t(sc))); nl();
    let wb: [i16; 8] = [i16::MIN, -1, 0, 1, i16::MAX, i16::MIN, 5, -5];
    let wc: [i16; 8] = [1, 1, 1, -1, -1, -1, 0, 0];
    f("psignw", psign_w(t(wb), t(wc))); nl();
    let db: [i32; 4] = [i32::MIN, i32::MIN, 7, -7];
    let dc: [i32; 4] = [1, -1, 0, i32::MIN];
    f("psignd", psign_d(t(db), t(dc))); nl();
    flush();
    0
} }
