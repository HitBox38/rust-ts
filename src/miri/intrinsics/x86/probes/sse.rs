// Probe of lane miri-x86-a: every `llvm.x86.sse.*` arm of intrinsics/x86/sse.rs, called directly by link name, on NaNs,
// zeros, infinities, denormals and the conversions' range limits.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
include!("common.rs");

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse.min.ss"] fn min_ss(a: __m128, b: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.max.ss"] fn max_ss(a: __m128, b: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.min.ps"] fn min_ps(a: __m128, b: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.max.ps"] fn max_ps(a: __m128, b: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.rcp.ss"] fn rcp_ss(a: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.rsqrt.ss"] fn rsqrt_ss(a: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.rcp.ps"] fn rcp_ps(a: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.rsqrt.ps"] fn rsqrt_ps(a: __m128) -> __m128;
    #[link_name = "llvm.x86.sse.cmp.ss"] fn cmp_ss(a: __m128, b: __m128, imm: i8) -> __m128;
    #[link_name = "llvm.x86.sse.cmp.ps"] fn cmp_ps(a: __m128, b: __m128, imm: i8) -> __m128;
    #[link_name = "llvm.x86.sse.comieq.ss"] fn comieq(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.comilt.ss"] fn comilt(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.comile.ss"] fn comile(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.comigt.ss"] fn comigt(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.comige.ss"] fn comige(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.comineq.ss"] fn comineq(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomieq.ss"] fn ucomieq(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomilt.ss"] fn ucomilt(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomile.ss"] fn ucomile(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomigt.ss"] fn ucomigt(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomige.ss"] fn ucomige(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.ucomineq.ss"] fn ucomineq(a: __m128, b: __m128) -> i32;
    #[link_name = "llvm.x86.sse.cvtss2si"] fn cvtss2si(a: __m128) -> i32;
    #[link_name = "llvm.x86.sse.cvttss2si"] fn cvttss2si(a: __m128) -> i32;
    #[link_name = "llvm.x86.sse.cvtss2si64"] fn cvtss2si64(a: __m128) -> i64;
    #[link_name = "llvm.x86.sse.cvttss2si64"] fn cvttss2si64(a: __m128) -> i64;
}

// +0, -0, 1, -1, 2.5, min denormal, +inf, -inf, qNaN, -qNaN with payload, sNaN, MAX
static PAIRS: [u32; 12] = [
    0x0000_0000, 0x8000_0000, 0x3f80_0000, 0xbf80_0000, 0x4020_0000, 0x0000_0001, 0x7f80_0000, 0xff80_0000,
    0x7fc0_0000, 0xffc1_2345, 0x7f80_0001, 0x7f7f_ffff,
];
static IMMS: [i8; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 0x10, 0x15];
// ties, denormals, MAX/MIN, infinities, NaNs (quiet, payload, negative, signaling), and the i32/i64 range limits
static VALS: [u32; 29] = [
    0x0000_0000, 0x8000_0000, 0x3f80_0000, 0xbf80_0000, 0x3f00_0000, 0x3fc0_0000, 0x4020_0000, 0xc020_0000,
    0x4040_0000, 0x0000_0001, 0x8000_0001, 0x007f_ffff, 0x7f7f_ffff, 0xff7f_ffff, 0x7f80_0000, 0xff80_0000,
    0x7fc0_0000, 0x7fc1_2345, 0xffc0_0000, 0x7f80_0001, 0xff80_0001, 0x4f00_0000, 0x4eff_ffff, 0xcf00_0000,
    0xcf00_0001, 0x5f00_0000, 0x5eff_ffff, 0xdf00_0000, 0xdf00_0001,
];

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    each!(x in PAIRS => { each!(y in PAIRS => {
        let a: __m128 = t([x, 0x4120_0000, 0x41a0_0000, 0x41f0_0000]);
        let b: __m128 = t([y, 0xc120_0000, 0xc1a0_0000, 0xc1f0_0000]);
        let (pa, pb): (__m128, __m128) = (t([x, y, x, y]), t([y, x, x, y]));
        hex(x); put(b' '); hex(y);
        f("minss", min_ss(a, b)); f("maxss", max_ss(a, b)); f("minps", min_ps(pa, pb)); f("maxps", max_ps(pa, pb));
        nl();
        each!(imm in IMMS => { f("cs", cmp_ss(a, b, imm)); f("cp", cmp_ps(pa, pb, imm)); });
        nl();
        f("c", [comieq(a, b), comilt(a, b), comile(a, b), comigt(a, b), comige(a, b), comineq(a, b)]);
        f("u", [ucomieq(a, b), ucomilt(a, b), ucomile(a, b), ucomigt(a, b), ucomige(a, b), ucomineq(a, b)]);
        nl();
    }); });
    each!(x in VALS => {
        let a: __m128 = t([x, 0x4120_0000, 0x41a0_0000, 0x41f0_0000]);
        let p: __m128 = t([x, 0x4040_0000, x, 0x3f80_0000]);
        hex(x);
        f("rcpss", rcp_ss(a)); f("rsqrtss", rsqrt_ss(a)); f("rcpps", rcp_ps(p)); f("rsqrtps", rsqrt_ps(p));
        f("cvt", cvtss2si(a)); f("cvtt", cvttss2si(a)); f("cvt64", cvtss2si64(a)); f("cvtt64", cvttss2si64(a));
        nl();
    });
    flush();
    0
} }
