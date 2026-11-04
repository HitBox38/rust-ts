// Probe of lane miri-x86-a: the helpers of intrinsics/x86/mod.rs that only the AVX files (lane miri-x86-b) reach, and their
// multi-chunk paths (`split_simd_to_128bit_chunks` with 2 and 4 chunks): shift_simd_by_simd, test_high_bits_masked, permute,
// permute2, the AVX comparison imm bits of cmp_from_imm. `-C target-feature=+avx2,+avx512f,+avx512bw,+avx512vbmi`.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

simd! {
    i8x32: [i8; 32];
    u8x32: [u8; 32];
    i16x16: [i16; 16];
    u16x16: [u16; 16];
    i32x8: [i32; 8];
    u32x8: [u32; 8];
    i64x4: [i64; 4];
    u64x4: [u64; 4];
    u8x64: [u8; 64];
    i8x64: [i8; 64];
    i16x32: [i16; 32];
    i32x16: [i32; 16];
    i64x8: [i64; 8];
    u64x8: [u64; 8];
}

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse.cmp.ss"] fn cmp_ss(a: __m128, b: __m128, imm: i8) -> __m128;
    #[link_name = "llvm.x86.sse2.cmp.pd"] fn cmp_pd(a: __m128d, b: __m128d, imm: i8) -> __m128d;
    #[link_name = "llvm.x86.avx.cmp.ps.256"] fn cmp_ps256(a: __m256, b: __m256, imm: u8) -> __m256;
    #[link_name = "llvm.x86.avx.cmp.pd.256"] fn cmp_pd256(a: __m256d, b: __m256d, imm: u8) -> __m256d;
    #[link_name = "llvm.x86.avx.min.ps.256"] fn min_ps256(a: __m256, b: __m256) -> __m256;
    #[link_name = "llvm.x86.avx.rcp.ps.256"] fn rcp_ps256(a: __m256) -> __m256;
    #[link_name = "llvm.x86.avx.round.ps.256"] fn round_ps256(a: __m256, r: i32) -> __m256;
    #[link_name = "llvm.x86.avx.round.pd.256"] fn round_pd256(a: __m256d, r: i32) -> __m256d;
    #[link_name = "llvm.x86.avx.cvt.ps2dq.256"] fn cvt_ps2dq256(a: __m256) -> i32x8;
    #[link_name = "llvm.x86.avx.cvtt.ps2dq.256"] fn cvtt_ps2dq256(a: __m256) -> i32x8;
    #[link_name = "llvm.x86.avx.cvt.pd2dq.256"] fn cvt_pd2dq256(a: __m256d) -> i32x4;
    #[link_name = "llvm.x86.avx.dp.ps.256"] fn dp_ps256(a: __m256, b: __m256, imm: i8) -> __m256;
    #[link_name = "llvm.x86.avx.ptestnzc.256"] fn ptestnzc256(a: i64x4, b: i64x4) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.ps"] fn vtestnzc_ps(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.avx.vtestz.ps.256"] fn vtestz_ps256(a: __m256, b: __m256) -> i32;
    #[link_name = "llvm.x86.avx.vtestc.ps.256"] fn vtestc_ps256(a: __m256, b: __m256) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.pd.256"] fn vtestnzc_pd256(a: __m256d, b: __m256d) -> i32;
    #[link_name = "llvm.x86.avx2.psllv.d"] fn psllv_d(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.avx2.psllv.d.256"] fn psllv_d256(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.psllv.q"] fn psllv_q(a: i64x2, b: i64x2) -> i64x2;
    #[link_name = "llvm.x86.avx2.psllv.q.256"] fn psllv_q256(a: i64x4, b: i64x4) -> i64x4;
    #[link_name = "llvm.x86.avx2.psrav.d"] fn psrav_d(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.avx2.psrav.d.256"] fn psrav_d256(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.psrlv.q.256"] fn psrlv_q256(a: i64x4, b: i64x4) -> i64x4;
    #[link_name = "llvm.x86.avx2.psll.w"] fn psll_w256(a: i16x16, b: i16x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.psra.d"] fn psra_d256(a: i32x8, b: i32x4) -> i32x8;
    #[link_name = "llvm.x86.avx2.permd"] fn permd(a: u32x8, b: u32x8) -> u32x8;
    #[link_name = "llvm.x86.avx2.permps"] fn permps(a: __m256, b: i32x8) -> __m256;
    #[link_name = "llvm.x86.avx2.mpsadbw"] fn mpsadbw256(a: u8x32, b: u8x32, imm: i8) -> u16x16;
    #[link_name = "llvm.x86.avx2.packsswb"] fn packsswb256(a: i16x16, b: i16x16) -> i8x32;
    #[link_name = "llvm.x86.avx2.packusdw"] fn packusdw256(a: i32x8, b: i32x8) -> u16x16;
    #[link_name = "llvm.x86.avx2.psad.bw"] fn psadbw256(a: u8x32, b: u8x32) -> u64x4;
    #[link_name = "llvm.x86.avx2.pmadd.wd"] fn pmaddwd256(a: i16x16, b: i16x16) -> i32x8;
    #[link_name = "llvm.x86.avx2.pmadd.ub.sw"] fn pmaddubsw256(a: u8x32, b: i8x32) -> i16x16;
    #[link_name = "llvm.x86.avx2.pmul.hr.sw"] fn pmulhrsw256(a: i16x16, b: i16x16) -> i16x16;
    #[link_name = "llvm.x86.avx2.pshuf.b"] fn pshufb256(a: u8x32, b: u8x32) -> u8x32;
    #[link_name = "llvm.x86.avx2.psign.d"] fn psignd256(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx512.psad.bw.512"] fn psadbw512(a: u8x64, b: u8x64) -> u64x8;
    #[link_name = "llvm.x86.avx512.pmaddw.d.512"] fn pmaddwd512(a: i16x32, b: i16x32) -> i32x16;
    #[link_name = "llvm.x86.avx512.pshuf.b.512"] fn pshufb512(a: i8x64, b: i8x64) -> i8x64;
    #[link_name = "llvm.x86.avx512.permvar.si.512"] fn permvar_si512(a: i32x16, idx: i32x16) -> i32x16;
    #[link_name = "llvm.x86.avx512.vpermi2var.q.512"] fn vpermi2q(a: i64x8, idx: i64x8, b: i64x8) -> i64x8;
}

// +0, -0, 1, -1, +inf, qNaN, sNaN, 2.5
static F: [u32; 8] = [0, 0x8000_0000, 0x3f80_0000, 0xbf80_0000, 0x7f80_0000, 0x7fc0_0000, 0x7f80_0001, 0x4020_0000];
static G: [u32; 8] = [0x8000_0000, 0, 0x3f80_0000, 0x3f80_0000, 0x7f80_0000, 0x3f80_0000, 0x7f80_0001, 0xc020_0000];
static D1: [u64; 4] = [0, 0x3ff0_0000_0000_0000, 0x7ff8_0000_0000_0000, 0x8000_0000_0000_0000];
static D2: [u64; 4] = [0x8000_0000_0000_0000, 0x4000_0000_0000_0000, 0x3ff0_0000_0000_0000, 0x8000_0000_0000_0000];
static SHIFT32: [i32; 8] = [0, 1, 31, 32, 33, -1, i32::MIN, 16];
static SHIFT64: [i64; 4] = [0, 63, 64, i64::MIN];
static V32: [i32; 8] = [1, i32::MIN, i32::MAX, -1, 0x1234_5678, -0x1234_5678, 0x4000_0000, -2];
static V64: [i64; 4] = [1, i64::MIN, i64::MAX, -1];
static TEST_F: [[u32; 8]; 4] = [[0; 8], [u32::MAX; 8], [0x8000_0000, 0, 0, 0, 0, 0, 0, 0], [0x7fff_ffff; 8]];
static TEST_D: [[u64; 4]; 3] = [[0; 4], [u64::MAX; 4], [0x8000_0000_0000_0000, 0, 0, 1]];
static NZC: [[u64; 4]; 4] = [[0; 4], [u64::MAX; 4], [1, 0, 0, 0], [0, 0, 0, 0x8000_0000_0000_0000]];
static ROUND: [i32; 6] = [0, 1, 2, 3, 4, 8];
static DP_IMMS: [i8; 4] = [-1, 0x71, 0x1f, 0];
static MPS_IMMS: [i8; 6] = [0, 1, 7, 8, 0x3f, -1];

fn bytes32(seed: u8, step: u8) -> [u8; 32] {
    let mut a = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        a[i] = seed.wrapping_add((i as u8).wrapping_mul(step));
        i += 1;
    }
    a
}

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    // cmp_from_imm's bit 3 (toggles `unord`) and bit 4, with the avx feature on.
    let (a, b): (__m256, __m256) = (t(F), t(G));
    let (da, db): (__m256d, __m256d) = (t(D1), t(D2));
    let mut imm = 0u8;
    while imm < 32 {
        hex(imm);
        f("ss", cmp_ss(t([F[5], F[1], F[2], F[3]]), t([G[5], G[1], G[2], G[3]]), imm as i8));
        f("pd", cmp_pd(t([D1[2], D1[1]]), t([D2[2], D2[1]]), imm as i8));
        f("ps256", cmp_ps256(a, b, imm));
        f("pd256", cmp_pd256(da, db, imm));
        nl();
        imm += 1;
    }
    f("min", min_ps256(a, b)); f("rcp", rcp_ps256(a)); nl();
    each!(r in ROUND => { f("rps", round_ps256(a, r)); f("rpd", round_pd256(da, r)); nl(); });
    f("cvt", cvt_ps2dq256(a)); f("cvtt", cvtt_ps2dq256(a)); f("cvtpd", cvt_pd2dq256(da)); nl();
    let pa: [f32; 8] = [1.5, 2.0, -3.0, 0.25, 4.0, 5.0, 6.0, 7.0];
    let pb: [f32; 8] = [2.0, 4.0, 0.5, 16.0, 1.0, f32::NAN, 2.0, f32::INFINITY];
    each!(imm in DP_IMMS => { f("dp", dp_ps256(t(pa), t(pb), imm)); nl(); });

    // test_bits_masked / test_high_bits_masked
    each!(x in TEST_F => { each!(y in TEST_F => {
        f("n", vtestnzc_ps(t([x[0], x[1], x[2], x[3]]), t([y[0], y[1], y[2], y[3]]))); f("z", vtestz_ps256(t(x), t(y))); f("c", vtestc_ps256(t(x), t(y)));
    }); nl(); });
    each!(x in TEST_D => { each!(y in TEST_D => { f("nzc", vtestnzc_pd256(t(x), t(y))); }); nl(); });
    each!(x in NZC => { each!(y in NZC => { f("ptest", ptestnzc256(t(x), t(y))); }); nl(); });

    // shift_simd_by_simd, shift_simd_by_scalar over 256 bits
    let v4: [i32; 4] = [V32[0], V32[1], V32[2], V32[3]];
    let s4: [i32; 4] = [SHIFT32[1], SHIFT32[2], SHIFT32[3], SHIFT32[5]];
    f("sv", psllv_d(t(v4), t(s4))); f("av", psrav_d(t(v4), t(s4))); nl();
    f("sv8", psllv_d256(t(V32), t(SHIFT32))); f("av8", psrav_d256(t(V32), t(SHIFT32))); nl();
    let (q2, r2): ([i64; 2], [i64; 2]) = ([V64[1], V64[2]], [SHIFT64[1], SHIFT64[2]]);
    f("sq", psllv_q(t(q2), t(r2))); f("sq4", psllv_q256(t(V64), t(SHIFT64))); f("rq4", psrlv_q256(t(V64), t(SHIFT64))); nl();
    let w: [i16; 16] = [1, -32768, 32767, -1, 0x1234, 0x00ff, -256, -21846, 2, 3, 4, 5, 6, 7, 8, 9];
    let c: [u64; 2] = [15, u64::MAX];
    let c2: [u64; 2] = [32, 0];
    f("sw", psll_w256(t(w), t(c))); f("ad", psra_d256(t(V32), t(c2))); nl();

    // permute, permute2 (the index's high bits are ignored)
    let idx: [u32; 8] = [7, 8, 0xffff_fff1, 3, 0x8000_0002, 5, 6, 4];
    f("permd", permd(t(V32), t(idx))); f("permps", permps(a, t(idx))); nl();
    let v16: [i32; 16] = [0, 11, 22, 33, 44, 55, 66, 77, 88, 99, 110, 121, 132, 143, 154, 165];
    let i16_: [i32; 16] = [15, 16, -1, 0, 31, 7, 8, 9, 10, 11, 12, 13, 14, 1, 2, 3];
    f("permvar", permvar_si512(t(v16), t(i16_))); nl();
    let l8: [i64; 8] = [10, 11, 12, 13, 14, 15, 16, 17];
    let r8: [i64; 8] = [20, 21, 22, 23, 24, 25, 26, 27];
    let i8_: [i64; 8] = [0, 7, 8, 15, 16, -1, 0x100, i64::MIN];
    f("permi2", vpermi2q(t(l8), t(i8_), t(r8))); nl();

    // Multi-chunk paths of the shared helpers.
    let (x32, y32) = (bytes32(3, 37), bytes32(250, 91));
    each!(imm in MPS_IMMS => { f("mps", mpsadbw256(t(x32), t(y32), imm)); nl(); });
    let (wa, wb): ([i16; 16], [i16; 16]) = (w, [i16::MIN, i16::MAX, 300, -300, 127, 128, -128, -129, 255, 256, 0, -1, 1, 2, 3, 4]);
    f("packss", packsswb256(t(wa), t(wb))); f("packus", packusdw256(t(V32), t(SHIFT32))); nl();
    f("sad", psadbw256(t(x32), t(y32))); f("madd", pmaddwd256(t(wa), t(wb))); f("maddub", pmaddubsw256(t(x32), t(y32))); nl();
    f("hrs", pmulhrsw256(t(wa), t(wb))); f("shufb", pshufb256(t(x32), t(y32))); f("sign", psignd256(t(V32), t(SHIFT32))); nl();
    let (x64, y64): ([[u8; 32]; 2], [[u8; 32]; 2]) = ([x32, y32], [y32, x32]);
    f("sad5", psadbw512(t(x64), t(y64))); f("madd5", pmaddwd512(t([wa, wb]), t([wb, wa]))); f("shufb5", pshufb512(t(x64), t(y64))); nl();
    flush();
    0
} }
