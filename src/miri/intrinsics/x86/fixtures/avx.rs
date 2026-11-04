//@ flags: -Ctarget-feature=+avx
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx.min.ps.256"] fn minps(a: f32x8, b: f32x8) -> f32x8;
    #[link_name = "llvm.x86.avx.max.ps.256"] fn maxps(a: f32x8, b: f32x8) -> f32x8;
    #[link_name = "llvm.x86.avx.min.pd.256"] fn minpd(a: f64x4, b: f64x4) -> f64x4;
    #[link_name = "llvm.x86.avx.max.pd.256"] fn maxpd(a: f64x4, b: f64x4) -> f64x4;
    #[link_name = "llvm.x86.avx.round.ps.256"] fn roundps(a: f32x8, r: i32) -> f32x8;
    #[link_name = "llvm.x86.avx.round.pd.256"] fn roundpd(a: f64x4, r: i32) -> f64x4;
    #[link_name = "llvm.x86.avx.rcp.ps.256"] fn rcpps(a: f32x8) -> f32x8;
    #[link_name = "llvm.x86.avx.rsqrt.ps.256"] fn rsqrtps(a: f32x8) -> f32x8;
    #[link_name = "llvm.x86.avx.dp.ps.256"] fn dpps(a: f32x8, b: f32x8, imm: i8) -> f32x8;
    #[link_name = "llvm.x86.avx.cmp.ps.256"] fn cmpps(a: f32x8, b: f32x8, imm: i8) -> f32x8;
    #[link_name = "llvm.x86.avx.cmp.pd.256"] fn cmppd(a: f64x4, b: f64x4, imm: i8) -> f64x4;
    #[link_name = "llvm.x86.avx.cvt.ps2dq.256"] fn cvtps(a: f32x8) -> i32x8;
    #[link_name = "llvm.x86.avx.cvtt.ps2dq.256"] fn cvttps(a: f32x8) -> i32x8;
    #[link_name = "llvm.x86.avx.cvt.pd2dq.256"] fn cvtpd(a: f64x4) -> i32x4;
    #[link_name = "llvm.x86.avx.cvtt.pd2dq.256"] fn cvttpd(a: f64x4) -> i32x4;
    #[link_name = "llvm.x86.avx.vpermilvar.ps"] fn permps(a: f32x4, c: i32x4) -> f32x4;
    #[link_name = "llvm.x86.avx.vpermilvar.ps.256"] fn permps256(a: f32x8, c: i32x8) -> f32x8;
    #[link_name = "llvm.x86.avx.vpermilvar.pd"] fn permpd(a: f64x2, c: i64x2) -> f64x2;
    #[link_name = "llvm.x86.avx.vpermilvar.pd.256"] fn permpd256(a: f64x4, c: i64x4) -> f64x4;
    #[link_name = "llvm.x86.avx.ldu.dq.256"] fn ldu(p: *const i8) -> i8x32;
    #[link_name = "llvm.x86.avx.ptestnzc.256"] fn ptestnzc(a: i64x4, b: i64x4) -> i32;
    #[link_name = "llvm.x86.avx.vtestz.pd.256"] fn vtestzpd(a: f64x4, b: f64x4) -> i32;
    #[link_name = "llvm.x86.avx.vtestc.pd.256"] fn vtestcpd(a: f64x4, b: f64x4) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.pd.256"] fn vtestnzcpd(a: f64x4, b: f64x4) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.pd"] fn vtestnzcpd128(a: f64x2, b: f64x2) -> i32;
    #[link_name = "llvm.x86.avx.vtestz.ps.256"] fn vtestzps(a: f32x8, b: f32x8) -> i32;
    #[link_name = "llvm.x86.avx.vtestc.ps.256"] fn vtestcps(a: f32x8, b: f32x8) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.ps.256"] fn vtestnzcps(a: f32x8, b: f32x8) -> i32;
    #[link_name = "llvm.x86.avx.vtestnzc.ps"] fn vtestnzcps128(a: f32x4, b: f32x4) -> i32;
    #[link_name = "llvm.x86.avx.vzeroupper"] fn vzeroupper();
    #[link_name = "llvm.x86.avx.vzeroall"] fn vzeroall();
}
fn main() {
    let nan32 = f32::from_bits(0x7fc0_0000);
    let nan64 = f64::from_bits(0x7ff8_0000_0000_0000);
    let a32 = f32x8([1.5, -1.5, 2.5, 0.0, -0.0, nan32, f32::INFINITY, f32::NEG_INFINITY]);
    let b32 = f32x8([-1.5, 1.5, 3.5, -0.0, 0.0, 1.0, nan32, 3e9]);
    let a64 = f64x4([1.5, -0.0, nan64, f64::INFINITY]);
    let b64 = f64x4([-2.5, 0.0, 1.0, nan64]);
    t!("llvm.x86.avx.min.ps.256", minps(a32, b32));
    t!("llvm.x86.avx.max.ps.256", maxps(a32, b32));
    t!("llvm.x86.avx.min.pd.256", minpd(a64, b64));
    t!("llvm.x86.avx.max.pd.256", maxpd(a64, b64));
    // Nearest, down, up, truncate, current mode; with the exception-suppression bit.
    for r in [0i32, 1, 2, 3, 4, 8, 9, 10, 11, 12] {
        t!("llvm.x86.avx.round.ps.256", roundps(a32, r));
        t!("llvm.x86.avx.round.pd.256", roundpd(a64, r));
    }
    let p32 = f32x8([1.0, 2.0, 4.0, 0.25, 3.0, 1e10, 1e-10, 7.0]);
    t!("llvm.x86.avx.rcp.ps.256", rcpps(p32));
    t!("llvm.x86.avx.rsqrt.ps.256", rsqrtps(p32));
    t!("llvm.x86.avx.rcp.ps.256", rcpps(a32));
    t!("llvm.x86.avx.rsqrt.ps.256", rsqrtps(a32));
    for imm in [-1i8, 0, 0x0f, 0x71, -0x0f] {
        t!("llvm.x86.avx.dp.ps.256", dpps(p32, p32, imm));
    }
    // All 32 predicates are valid here (AVX), including the signalling ones.
    let mut imm = 0i8;
    while imm < 32 {
        t!("llvm.x86.avx.cmp.ps.256", cmpps(a32, b32, imm));
        t!("llvm.x86.avx.cmp.pd.256", cmppd(a64, b64, imm));
        imm += 1;
    }
    let c32 = f32x8([1.5, 2.5, -1.5, -2.5, 3e9, -3e9, nan32, 0.49]);
    let c64 = f64x4([1.5, 2.5, 3e10, nan64]);
    t!("llvm.x86.avx.cvt.ps2dq.256", cvtps(c32));
    t!("llvm.x86.avx.cvtt.ps2dq.256", cvttps(c32));
    t!("llvm.x86.avx.cvt.pd2dq.256", cvtpd(c64));
    t!("llvm.x86.avx.cvtt.pd2dq.256", cvttpd(c64));
    let d4 = f32x4([1.0, 2.0, 3.0, 4.0]);
    let d8 = f32x8([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    // Only the low two bits of each control lane count; high bits are ignored.
    t!("llvm.x86.avx.vpermilvar.ps", permps(d4, i32x4([3, 2, 1, 0])));
    t!("llvm.x86.avx.vpermilvar.ps", permps(d4, i32x4([-1, 4, 0x7fff_fffe, -4])));
    t!("llvm.x86.avx.vpermilvar.ps.256", permps256(d8, i32x8([3, 2, 1, 0, 0, 1, 2, 3])));
    t!("llvm.x86.avx.vpermilvar.ps.256", permps256(d8, i32x8([7, -1, 5, 4, 8, 13, -2, 3])));
    let e2 = f64x2([1.0, 2.0]);
    let e4 = f64x4([1.0, 2.0, 3.0, 4.0]);
    // Bit 1, not bit 0, selects.
    t!("llvm.x86.avx.vpermilvar.pd", permpd(e2, i64x2([2, 0])));
    t!("llvm.x86.avx.vpermilvar.pd", permpd(e2, i64x2([1, -1])));
    t!("llvm.x86.avx.vpermilvar.pd.256", permpd256(e4, i64x4([2, 0, 2, 0])));
    t!("llvm.x86.avx.vpermilvar.pd.256", permpd256(e4, i64x4([1, 3, -1, -2])));
    // Unaligned load, one byte past an alignment boundary.
    let bytes: [u8; 64] = core::array::from_fn(|i| i as u8);
    let v = unsafe { ldu(bytes.as_ptr().add(1) as *const i8) };
    println!("llvm.x86.avx.ldu.dq.256 ptr:+1 => {}", v.show());
    let m = i64x4([-1, 0, -1, 0]);
    for op in [i64x4([0, 0, 0, 0]), i64x4([-1, -1, -1, -1]), i64x4([1, 0, 0, 0]), i64x4([-1, 5, 0, 0])] {
        t!("llvm.x86.avx.ptestnzc.256", ptestnzc(op, m));
    }
    let neg = -1.0f64;
    let ops = [f64x4([0.0, 0.0, 0.0, 0.0]), f64x4([neg, neg, neg, neg]), f64x4([neg, 0.0, 0.0, 0.0]), f64x4([0.0, neg, neg, 0.0])];
    let mask = f64x4([neg, 0.0, neg, 0.0]);
    for op in ops {
        t!("llvm.x86.avx.vtestz.pd.256", vtestzpd(op, mask));
        t!("llvm.x86.avx.vtestc.pd.256", vtestcpd(op, mask));
        t!("llvm.x86.avx.vtestnzc.pd.256", vtestnzcpd(op, mask));
    }
    t!("llvm.x86.avx.vtestnzc.pd", vtestnzcpd128(f64x2([neg, 0.0]), f64x2([neg, neg])));
    let n = -1.0f32;
    let ops = [f32x8([0.0; 8]), f32x8([n; 8]), f32x8([n, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]), f32x8([0.0, n, 0.0, n, n, 0.0, 0.0, 0.0])];
    let mask = f32x8([n, 0.0, n, 0.0, n, 0.0, n, 0.0]);
    for op in ops {
        t!("llvm.x86.avx.vtestz.ps.256", vtestzps(op, mask));
        t!("llvm.x86.avx.vtestc.ps.256", vtestcps(op, mask));
        t!("llvm.x86.avx.vtestnzc.ps.256", vtestnzcps(op, mask));
    }
    t!("llvm.x86.avx.vtestnzc.ps", vtestnzcps128(f32x4([n, 0.0, 0.0, 0.0]), f32x4([n, n, 0.0, 0.0])));
    unsafe {
        vzeroupper();
        vzeroall();
    }
    println!("llvm.x86.avx.vzeroupper,vzeroall ok");
}
