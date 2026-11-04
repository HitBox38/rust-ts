// Probe of lane miri-x86-a: every `llvm.x86.sse2.*` arm of intrinsics/x86/sse2.rs (and `sse2.pause` of mod.rs), called
// directly by link name: shift counts at and beyond the width, saturation limits, NaNs, ties and the conversions' limits.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse2.pause"] fn pause();
    #[link_name = "llvm.x86.sse2.psad.bw"] fn psad_bw(a: u8x16, b: u8x16) -> u64x2;
    #[link_name = "llvm.x86.sse2.psll.w"] fn psll_w(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.sse2.psrl.w"] fn psrl_w(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.sse2.psra.w"] fn psra_w(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.sse2.psll.d"] fn psll_d(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.sse2.psrl.d"] fn psrl_d(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.sse2.psra.d"] fn psra_d(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.sse2.psll.q"] fn psll_q(a: i64x2, b: i64x2) -> i64x2;
    #[link_name = "llvm.x86.sse2.psrl.q"] fn psrl_q(a: i64x2, b: i64x2) -> i64x2;
    #[link_name = "llvm.x86.sse2.cvtps2dq"] fn cvtps2dq(a: __m128) -> i32x4;
    #[link_name = "llvm.x86.sse2.cvttps2dq"] fn cvttps2dq(a: __m128) -> i32x4;
    #[link_name = "llvm.x86.sse2.cvtpd2dq"] fn cvtpd2dq(a: __m128d) -> i32x4;
    #[link_name = "llvm.x86.sse2.cvttpd2dq"] fn cvttpd2dq(a: __m128d) -> i32x4;
    #[link_name = "llvm.x86.sse2.packsswb.128"] fn packsswb(a: i16x8, b: i16x8) -> i8x16;
    #[link_name = "llvm.x86.sse2.packuswb.128"] fn packuswb(a: i16x8, b: i16x8) -> u8x16;
    #[link_name = "llvm.x86.sse2.packssdw.128"] fn packssdw(a: i32x4, b: i32x4) -> i16x8;
    #[link_name = "llvm.x86.sse2.min.sd"] fn min_sd(a: __m128d, b: __m128d) -> __m128d;
    #[link_name = "llvm.x86.sse2.max.sd"] fn max_sd(a: __m128d, b: __m128d) -> __m128d;
    #[link_name = "llvm.x86.sse2.min.pd"] fn min_pd(a: __m128d, b: __m128d) -> __m128d;
    #[link_name = "llvm.x86.sse2.max.pd"] fn max_pd(a: __m128d, b: __m128d) -> __m128d;
    #[link_name = "llvm.x86.sse2.cmp.sd"] fn cmp_sd(a: __m128d, b: __m128d, imm: i8) -> __m128d;
    #[link_name = "llvm.x86.sse2.cmp.pd"] fn cmp_pd(a: __m128d, b: __m128d, imm: i8) -> __m128d;
    #[link_name = "llvm.x86.sse2.comieq.sd"] fn comieq(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.comilt.sd"] fn comilt(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.comile.sd"] fn comile(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.comigt.sd"] fn comigt(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.comige.sd"] fn comige(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.comineq.sd"] fn comineq(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomieq.sd"] fn ucomieq(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomilt.sd"] fn ucomilt(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomile.sd"] fn ucomile(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomigt.sd"] fn ucomigt(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomige.sd"] fn ucomige(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.ucomineq.sd"] fn ucomineq(a: __m128d, b: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.cvtsd2si"] fn cvtsd2si(a: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.cvttsd2si"] fn cvttsd2si(a: __m128d) -> i32;
    #[link_name = "llvm.x86.sse2.cvtsd2si64"] fn cvtsd2si64(a: __m128d) -> i64;
    #[link_name = "llvm.x86.sse2.cvttsd2si64"] fn cvttsd2si64(a: __m128d) -> i64;
    #[link_name = "llvm.x86.sse2.cvtsd2ss"] fn cvtsd2ss(a: __m128, b: __m128d) -> __m128;
    #[link_name = "llvm.x86.sse2.pmadd.wd"] fn pmadd_wd(a: i16x8, b: i16x8) -> i32x4;
    #[link_name = "llvm.x86.sse2.pmulh.w"] fn pmulh_w(a: i16x8, b: i16x8) -> i16x8;
    #[link_name = "llvm.x86.sse2.pmulhu.w"] fn pmulhu_w(a: u16x8, b: u16x8) -> u16x8;
}

static PAIRS: [u64; 12] = [
    0, 0x8000_0000_0000_0000, 0x3ff0_0000_0000_0000, 0xbff0_0000_0000_0000, 0x4004_0000_0000_0000, 1,
    0x7ff0_0000_0000_0000, 0xfff0_0000_0000_0000, 0x7ff8_0000_0000_0000, 0xfff8_1234_5678_9abc, 0x7ff0_0000_0000_0001,
    0x7fef_ffff_ffff_ffff,
];
static IMMS: [i8; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 0x10, 0x15];
static VALS: [u64; 27] = [
    0, 0x8000_0000_0000_0000, 0x3ff0_0000_0000_0000, 0xbff0_0000_0000_0000, 0x3fe0_0000_0000_0000,
    0x3ff8_0000_0000_0000, 0x4004_0000_0000_0000, 0xc004_0000_0000_0000, 1, 0x000f_ffff_ffff_ffff,
    0x7fef_ffff_ffff_ffff, 0xffef_ffff_ffff_ffff, 0x7ff0_0000_0000_0000, 0xfff0_0000_0000_0000,
    0x7ff8_0000_0000_0000, 0x7ff8_1234_5678_9abc, 0xfff8_0000_0000_0000, 0x7ff0_0000_0000_0001,
    0x41df_ffff_ffc0_0000, 0x41df_ffff_ffe0_0000, 0x41e0_0000_0000_0000, 0xc1e0_0000_0000_0000, 0xc1e0_0000_0010_0000,
    0x43e0_0000_0000_0000, 0xc3e0_0000_0000_0000, 0xc3e0_0000_0000_0001, 0x47e0_0000_0000_0000,
];
static F32S: [u32; 13] = [
    0, 0x8000_0000, 0x3f00_0000, 0x3fc0_0000, 0x4020_0000, 0xc020_0000, 0x7f80_0000, 0xff80_0000, 0x7fc0_0000,
    0x7f80_0001, 0x4f00_0000, 0x4eff_ffff, 0xcf00_0001,
];
static COUNTS: [u64; 23] = [
    0, 1, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 0xffff_ffff, 0x1_0000_0000, 0x1_0000_0001,
    0x8000_0000_0000_0000, u64::MAX,
];
static BYTES: [[u8; 16]; 4] = [
    [0, 255, 1, 254, 2, 253, 3, 252, 128, 127, 129, 126, 130, 125, 131, 124],
    [255, 0, 254, 1, 253, 2, 252, 3, 127, 128, 126, 129, 125, 130, 124, 131],
    [0; 16],
    [255; 16],
];
static WS: [[i16; 8]; 3] = [
    [i16::MIN, i16::MAX, -1, 1, 0, 127, 128, -129],
    [-128, 255, 256, -32767, 32766, 1000, -1000, 0x00ff],
    [i16::MIN, i16::MIN, i16::MAX, i16::MAX, -1, -1, 0x4000, -0x4000],
];
static DS: [[i32; 4]; 2] = [[i32::MIN, i32::MAX, -1, 1], [32767, 32768, -32768, -32769]];

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    pause();

    let w: i16x8 = t([0x0001u16, 0x8000, 0x7fff, 0xffff, 0x1234, 0x00ff, 0xff00, 0xaaaa]);
    let dw: i32x4 = t([0x0000_0001u32, 0x8000_0000, 0x7fff_ffff, 0xdead_beef]);
    let q: i64x2 = t([0x8000_0000_0000_0001u64, 0x0123_4567_89ab_cdef]);
    each!(c in COUNTS => {
        let cnt: [u64; 2] = [c, u64::MAX];
        hex(c);
        f("sw", psll_w(w, t(cnt))); f("rw", psrl_w(w, t(cnt))); f("aw", psra_w(w, t(cnt)));
        f("sd", psll_d(dw, t(cnt))); f("rd", psrl_d(dw, t(cnt))); f("ad", psra_d(dw, t(cnt)));
        f("sq", psll_q(q, t(cnt))); f("rq", psrl_q(q, t(cnt)));
        nl();
    });

    each!(x in BYTES => { each!(y in BYTES => { f("psadbw", psad_bw(t(x), t(y))); nl(); }); });

    each!(x in WS => { each!(y in WS => {
        let (a, b): (i16x8, i16x8) = (t(x), t(y));
        f("packsswb", packsswb(a, b)); f("packuswb", packuswb(a, b));
        f("pmaddwd", pmadd_wd(a, b)); f("pmulhw", pmulh_w(a, b)); f("pmulhuw", pmulhu_w(t(a), t(b)));
        nl();
    }); });
    each!(x in DS => { each!(y in DS => { f("packssdw", packssdw(t(x), t(y))); nl(); }); });

    each!(x in F32S => {
        let p: __m128 = t([x, 0x3f80_0000u32, x, 0xbfc0_0000u32]);
        hex(x); f("cvtps2dq", cvtps2dq(p)); f("cvttps2dq", cvttps2dq(p)); nl();
    });
    each!(x in VALS => {
        let v: __m128d = t([x, 0x4024_0000_0000_0000u64]);
        let p: __m128d = t([x, 0x4004_0000_0000_0000u64]);
        let left: __m128 = t([0x4120_0000u32, 0x41a0_0000, 0x41f0_0000, 0x4220_0000]);
        hex(x);
        f("cvtpd2dq", cvtpd2dq(p)); f("cvttpd2dq", cvttpd2dq(p));
        f("cvt", cvtsd2si(v)); f("cvtt", cvttsd2si(v)); f("cvt64", cvtsd2si64(v)); f("cvtt64", cvttsd2si64(v));
        f("cvtsd2ss", cvtsd2ss(left, v));
        nl();
    });

    each!(x in PAIRS => { each!(y in PAIRS => {
        let a: __m128d = t([x, 0x4024_0000_0000_0000u64]);
        let b: __m128d = t([y, 0xc024_0000_0000_0000u64]);
        let (pa, pb): (__m128d, __m128d) = (t([x, y]), t([y, x]));
        hex(x); put(b' '); hex(y);
        f("minsd", min_sd(a, b)); f("maxsd", max_sd(a, b)); f("minpd", min_pd(pa, pb)); f("maxpd", max_pd(pa, pb));
        nl();
        each!(imm in IMMS => { f("cs", cmp_sd(a, b, imm)); f("cp", cmp_pd(pa, pb, imm)); });
        nl();
        f("c", [comieq(a, b), comilt(a, b), comile(a, b), comigt(a, b), comige(a, b), comineq(a, b)]);
        f("u", [ucomieq(a, b), ucomilt(a, b), ucomile(a, b), ucomigt(a, b), ucomige(a, b), ucomineq(a, b)]);
        nl();
    }); });
    flush();
    0
} }
