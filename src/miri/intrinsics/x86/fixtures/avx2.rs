//@ flags: -Ctarget-feature=+avx2
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx2.gather.d.d"] fn g_d_d(s: i32x4, p: *const i8, o: i32x4, m: i32x4, sc: i8) -> i32x4;
    #[link_name = "llvm.x86.avx2.gather.d.d.256"] fn g_d_d256(s: i32x8, p: *const i8, o: i32x8, m: i32x8, sc: i8) -> i32x8;
    #[link_name = "llvm.x86.avx2.gather.d.q"] fn g_d_q(s: i64x2, p: *const i8, o: i32x4, m: i64x2, sc: i8) -> i64x2;
    #[link_name = "llvm.x86.avx2.gather.d.q.256"] fn g_d_q256(s: i64x4, p: *const i8, o: i32x4, m: i64x4, sc: i8) -> i64x4;
    #[link_name = "llvm.x86.avx2.gather.q.d"] fn g_q_d(s: i32x4, p: *const i8, o: i64x2, m: i32x4, sc: i8) -> i32x4;
    #[link_name = "llvm.x86.avx2.gather.q.d.256"] fn g_q_d256(s: i32x4, p: *const i8, o: i64x4, m: i32x4, sc: i8) -> i32x4;
    #[link_name = "llvm.x86.avx2.gather.q.q"] fn g_q_q(s: i64x2, p: *const i8, o: i64x2, m: i64x2, sc: i8) -> i64x2;
    #[link_name = "llvm.x86.avx2.gather.q.q.256"] fn g_q_q256(s: i64x4, p: *const i8, o: i64x4, m: i64x4, sc: i8) -> i64x4;
    #[link_name = "llvm.x86.avx2.gather.d.pd"] fn g_d_pd(s: f64x2, p: *const i8, o: i32x4, m: f64x2, sc: i8) -> f64x2;
    #[link_name = "llvm.x86.avx2.gather.d.pd.256"] fn g_d_pd256(s: f64x4, p: *const i8, o: i32x4, m: f64x4, sc: i8) -> f64x4;
    #[link_name = "llvm.x86.avx2.gather.q.pd"] fn g_q_pd(s: f64x2, p: *const i8, o: i64x2, m: f64x2, sc: i8) -> f64x2;
    #[link_name = "llvm.x86.avx2.gather.q.pd.256"] fn g_q_pd256(s: f64x4, p: *const i8, o: i64x4, m: f64x4, sc: i8) -> f64x4;
    #[link_name = "llvm.x86.avx2.gather.d.ps"] fn g_d_ps(s: f32x4, p: *const i8, o: i32x4, m: f32x4, sc: i8) -> f32x4;
    #[link_name = "llvm.x86.avx2.gather.d.ps.256"] fn g_d_ps256(s: f32x8, p: *const i8, o: i32x8, m: f32x8, sc: i8) -> f32x8;
    #[link_name = "llvm.x86.avx2.gather.q.ps"] fn g_q_ps(s: f32x4, p: *const i8, o: i64x2, m: f32x4, sc: i8) -> f32x4;
    #[link_name = "llvm.x86.avx2.gather.q.ps.256"] fn g_q_ps256(s: f32x4, p: *const i8, o: i64x4, m: f32x4, sc: i8) -> f32x4;
    #[link_name = "llvm.x86.avx2.pmadd.ub.sw"] fn pmaddubsw(a: u8x32, b: i8x32) -> i16x16;
    #[link_name = "llvm.x86.avx2.mpsadbw"] fn mpsadbw(a: u8x32, b: u8x32, imm: i8) -> i16x16;
    #[link_name = "llvm.x86.avx2.pmul.hr.sw"] fn pmulhrsw(a: i16x16, b: i16x16) -> i16x16;
    #[link_name = "llvm.x86.avx2.packsswb"] fn packsswb(a: i16x16, b: i16x16) -> i8x32;
    #[link_name = "llvm.x86.avx2.packssdw"] fn packssdw(a: i32x8, b: i32x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.packuswb"] fn packuswb(a: i16x16, b: i16x16) -> u8x32;
    #[link_name = "llvm.x86.avx2.packusdw"] fn packusdw(a: i32x8, b: i32x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.permd"] fn permd(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.permps"] fn permps(a: f32x8, b: i32x8) -> f32x8;
    #[link_name = "llvm.x86.avx2.psad.bw"] fn psadbw(a: u8x32, b: u8x32) -> i64x4;
    #[link_name = "llvm.x86.avx2.pshuf.b"] fn pshufb(a: u8x32, b: u8x32) -> u8x32;
    #[link_name = "llvm.x86.avx2.psign.b"] fn psignb(a: i8x32, b: i8x32) -> i8x32;
    #[link_name = "llvm.x86.avx2.psign.w"] fn psignw(a: i16x16, b: i16x16) -> i16x16;
    #[link_name = "llvm.x86.avx2.psign.d"] fn psignd(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.psll.w"] fn psllw(a: i16x16, b: i16x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.psrl.w"] fn psrlw(a: i16x16, b: i16x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.psra.w"] fn psraw(a: i16x16, b: i16x8) -> i16x16;
    #[link_name = "llvm.x86.avx2.psll.d"] fn pslld(a: i32x8, b: i32x4) -> i32x8;
    #[link_name = "llvm.x86.avx2.psrl.d"] fn psrld(a: i32x8, b: i32x4) -> i32x8;
    #[link_name = "llvm.x86.avx2.psra.d"] fn psrad(a: i32x8, b: i32x4) -> i32x8;
    #[link_name = "llvm.x86.avx2.psll.q"] fn psllq(a: i64x4, b: i64x2) -> i64x4;
    #[link_name = "llvm.x86.avx2.psrl.q"] fn psrlq(a: i64x4, b: i64x2) -> i64x4;
    #[link_name = "llvm.x86.avx2.pmadd.wd"] fn pmaddwd(a: i16x16, b: i16x16) -> i32x8;
    #[link_name = "llvm.x86.avx2.psllv.d"] fn psllvd(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.avx2.psllv.d.256"] fn psllvd256(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.psllv.q"] fn psllvq(a: i64x2, b: i64x2) -> i64x2;
    #[link_name = "llvm.x86.avx2.psllv.q.256"] fn psllvq256(a: i64x4, b: i64x4) -> i64x4;
    #[link_name = "llvm.x86.avx2.psrlv.d"] fn psrlvd(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.avx2.psrlv.d.256"] fn psrlvd256(a: i32x8, b: i32x8) -> i32x8;
    #[link_name = "llvm.x86.avx2.psrlv.q"] fn psrlvq(a: i64x2, b: i64x2) -> i64x2;
    #[link_name = "llvm.x86.avx2.psrlv.q.256"] fn psrlvq256(a: i64x4, b: i64x4) -> i64x4;
    #[link_name = "llvm.x86.avx2.psrav.d"] fn psravd(a: i32x4, b: i32x4) -> i32x4;
    #[link_name = "llvm.x86.avx2.psrav.d.256"] fn psravd256(a: i32x8, b: i32x8) -> i32x8;
}
impl Show for *const i8 {
    fn show(&self) -> String { String::from("ptr") }
}
static DATA: [u8; 128] = {
    let mut a = [0u8; 128];
    let mut i = 0;
    while i < 128 {
        a[i] = i as u8;
        i += 1;
    }
    a
};
fn main() {
    // `p` is the middle of DATA: offsets go both ways. Masks test only the high bit of each lane.
    let p = unsafe { DATA.as_ptr().add(64) } as *const i8;
    let (s4, s8) = (i32x4([-1; 4]), i32x8([-1; 8]));
    let (s2q, s4q) = (i64x2([-1; 2]), i64x4([-1; 4]));
    let m4 = i32x4([-1, 0, i32::MIN, 0x7fff_ffff]);
    let m8 = i32x8([-1, 0, i32::MIN, 0x7fff_ffff, -1, -1, 1, -2]);
    let m2q = i64x2([-1, i64::MAX]);
    let m4q = i64x4([-1, i64::MAX, i64::MIN, 0]);
    let od4 = i32x4([0, 1, -8, 3]);
    let od8 = i32x8([0, 1, -8, 3, 4, -5, 6, 7]);
    let oq2 = i64x2([1, -4]);
    let oq4 = i64x4([1, -4, 2, -3]);
    for sc in [1i8, 2, 4, 8] {
        t!("llvm.x86.avx2.gather.d.d", g_d_d(s4, p, od4, m4, sc));
        t!("llvm.x86.avx2.gather.d.d.256", g_d_d256(s8, p, od8, m8, sc));
        t!("llvm.x86.avx2.gather.d.q", g_d_q(s2q, p, od4, m2q, sc));
        t!("llvm.x86.avx2.gather.d.q.256", g_d_q256(s4q, p, od4, m4q, sc));
        t!("llvm.x86.avx2.gather.q.d", g_q_d(s4, p, oq2, m4, sc));
        t!("llvm.x86.avx2.gather.q.d.256", g_q_d256(s4, p, oq4, m4, sc));
        t!("llvm.x86.avx2.gather.q.q", g_q_q(s2q, p, oq2, m2q, sc));
        t!("llvm.x86.avx2.gather.q.q.256", g_q_q256(s4q, p, oq4, m4q, sc));
    }
    let n = -1.0f32;
    let nd = -1.0f64;
    let fs4 = f32x4([9.0; 4]);
    let fs8 = f32x8([9.0; 8]);
    let ds2 = f64x2([9.0; 2]);
    let ds4 = f64x4([9.0; 4]);
    let fm4 = f32x4([n, 0.0, n, 0.0]);
    let fm8 = f32x8([n, 0.0, n, 0.0, n, n, 0.0, 0.0]);
    let dm2 = f64x2([nd, 0.0]);
    let dm4 = f64x4([nd, 0.0, nd, 0.0]);
    t!("llvm.x86.avx2.gather.d.pd", g_d_pd(ds2, p, od4, dm2, 8i8));
    t!("llvm.x86.avx2.gather.d.pd.256", g_d_pd256(ds4, p, od4, dm4, 4i8));
    t!("llvm.x86.avx2.gather.q.pd", g_q_pd(ds2, p, oq2, dm2, 2i8));
    t!("llvm.x86.avx2.gather.q.pd.256", g_q_pd256(ds4, p, oq4, dm4, 1i8));
    t!("llvm.x86.avx2.gather.d.ps", g_d_ps(fs4, p, od4, fm4, 4i8));
    t!("llvm.x86.avx2.gather.d.ps.256", g_d_ps256(fs8, p, od8, fm8, 2i8));
    t!("llvm.x86.avx2.gather.q.ps", g_q_ps(fs4, p, oq2, fm4, 1i8));
    t!("llvm.x86.avx2.gather.q.ps.256", g_q_ps256(fs4, p, oq4, fm4, 8i8));
    // A zero mask reads nothing, even through a dangling pointer.
    let zero = i32x4([0; 4]);
    let dangling = std::ptr::without_provenance::<i8>(16);
    t!("llvm.x86.avx2.gather.d.d", g_d_d(s4, dangling, od4, zero, 4i8));

    let mut r = Bytes(0xbeef_1234);
    for _ in 0..2 {
        let (a, b): (u8x32, i8x32) = (r.v::<_, 32>(), r.v::<_, 32>());
        t!("llvm.x86.avx2.pmadd.ub.sw", pmaddubsw(a, b));
        let (a, b): (u8x32, u8x32) = (r.v::<_, 32>(), r.v::<_, 32>());
        t!("llvm.x86.avx2.mpsadbw", mpsadbw(a, b, 0x1bi8));
        t!("llvm.x86.avx2.mpsadbw", mpsadbw(a, b, -1i8));
        t!("llvm.x86.avx2.psad.bw", psadbw(a, b));
        t!("llvm.x86.avx2.pshuf.b", pshufb(a, b));
        let (x, y): (i16x16, i16x16) = (r.v::<_, 32>(), r.v::<_, 32>());
        t!("llvm.x86.avx2.pmul.hr.sw", pmulhrsw(x, y));
        t!("llvm.x86.avx2.packsswb", packsswb(x, y));
        t!("llvm.x86.avx2.packuswb", packuswb(x, y));
        t!("llvm.x86.avx2.psign.w", psignw(x, y));
        t!("llvm.x86.avx2.pmadd.wd", pmaddwd(x, y));
        let (x, y): (i32x8, i32x8) = (r.v::<_, 32>(), r.v::<_, 32>());
        t!("llvm.x86.avx2.packssdw", packssdw(x, y));
        t!("llvm.x86.avx2.packusdw", packusdw(x, y));
        t!("llvm.x86.avx2.psign.d", psignd(x, y));
        t!("llvm.x86.avx2.permd", permd(x, y));
        let (x, y): (i8x32, i8x32) = (r.v::<_, 32>(), r.v::<_, 32>());
        t!("llvm.x86.avx2.psign.b", psignb(x, y));
    }
    t!("llvm.x86.avx2.pmadd.wd", pmaddwd(i16x16([i16::MIN; 16]), i16x16([i16::MIN; 16])));
    t!("llvm.x86.avx2.pmul.hr.sw", pmulhrsw(i16x16([i16::MIN; 16]), i16x16([i16::MIN; 16])));
    t!("llvm.x86.avx2.permps", permps(f32x8([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]), i32x8([7, 6, 5, 4, 8, -1, 9, 0])));
    let w = i16x16([1, -1, 0x7fff, i16::MIN, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7]);
    let d = i32x8([1, -1, i32::MAX, i32::MIN, 2, -2, 3, -3]);
    let q = i64x4([1, -1, i64::MAX, i64::MIN]);
    // Shift counts: small, N-1, N and beyond, and a count whose high 64 bits are set (they are ignored).
    for c in [0i64, 1, 15, 16, 31, 32, 63, 64, i64::MAX, -1] {
        let cw: i16x8 = unsafe { core::mem::transmute([c, 0x7777_7777_7777_7777]) };
        let cd: i32x4 = unsafe { core::mem::transmute([c, 0x7777_7777_7777_7777]) };
        let cq = i64x2([c, 0x7777_7777_7777_7777]);
        t!("llvm.x86.avx2.psll.w", psllw(w, cw));
        t!("llvm.x86.avx2.psrl.w", psrlw(w, cw));
        t!("llvm.x86.avx2.psra.w", psraw(w, cw));
        t!("llvm.x86.avx2.psll.d", pslld(d, cd));
        t!("llvm.x86.avx2.psrl.d", psrld(d, cd));
        t!("llvm.x86.avx2.psra.d", psrad(d, cd));
        t!("llvm.x86.avx2.psll.q", psllq(q, cq));
        t!("llvm.x86.avx2.psrl.q", psrlq(q, cq));
    }
    let d4 = i32x4([1, -1, i32::MAX, i32::MIN]);
    let dc4 = i32x4([0, 1, 31, 32]);
    let dc8 = i32x8([0, 1, 31, 32, 33, -1, i32::MAX, i32::MIN]);
    let q2 = i64x2([1, -1]);
    let qc2 = i64x2([63, 64]);
    let qc4 = i64x4([0, 1, 63, 64]);
    t!("llvm.x86.avx2.psllv.d", psllvd(d4, dc4));
    t!("llvm.x86.avx2.psllv.d.256", psllvd256(d, dc8));
    t!("llvm.x86.avx2.psllv.q", psllvq(q2, qc2));
    t!("llvm.x86.avx2.psllv.q.256", psllvq256(q, qc4));
    t!("llvm.x86.avx2.psrlv.d", psrlvd(d4, dc4));
    t!("llvm.x86.avx2.psrlv.d.256", psrlvd256(d, dc8));
    t!("llvm.x86.avx2.psrlv.q", psrlvq(q2, qc2));
    t!("llvm.x86.avx2.psrlv.q.256", psrlvq256(q, qc4));
    t!("llvm.x86.avx2.psrav.d", psravd(d4, dc4));
    t!("llvm.x86.avx2.psrav.d.256", psravd256(d, dc8));
}
