//@ flags: -Ctarget-feature=+avx512f,+avx512vl,+avx512bw,+avx512vbmi,+avx512vnni
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
use std::arch::x86_64::*;
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx512.pternlog.d.128"] fn tern128(a: i32x4, b: i32x4, c: i32x4, imm: i32) -> i32x4;
    #[link_name = "llvm.x86.avx512.pternlog.d.256"] fn tern256(a: i32x8, b: i32x8, c: i32x8, imm: i32) -> i32x8;
    #[link_name = "llvm.x86.avx512.pternlog.d.512"] fn tern512(a: i32x16, b: i32x16, c: i32x16, imm: i32) -> i32x16;
    #[link_name = "llvm.x86.avx512.psad.bw.512"] fn psadbw(a: u8x64, b: u8x64) -> i64x8;
    #[link_name = "llvm.x86.avx512.pmaddw.d.512"] fn pmaddwd(a: i16x32, b: i16x32) -> i32x16;
    #[link_name = "llvm.x86.avx512.pmaddubs.w.512"] fn pmaddubsw(a: u8x64, b: i8x64) -> i16x32;
    #[link_name = "llvm.x86.avx512.permvar.si.512"] fn permd(a: i32x16, b: i32x16) -> i32x16;
    #[link_name = "llvm.x86.avx512.permvar.di.512"] fn permq(a: i64x8, b: i64x8) -> i64x8;
    #[link_name = "llvm.x86.avx512.permvar.qi.512"] fn permb512(a: i8x64, b: i8x64) -> i8x64;
    #[link_name = "llvm.x86.avx512.permvar.qi.256"] fn permb256(a: i8x32, b: i8x32) -> i8x32;
    #[link_name = "llvm.x86.avx512.permvar.qi.128"] fn permb128(a: i8x16, b: i8x16) -> i8x16;
    #[link_name = "llvm.x86.avx512.vpermi2var.q.512"] fn perm2q(a: i64x8, i: i64x8, b: i64x8) -> i64x8;
    #[link_name = "llvm.x86.avx512.vpermi2var.qi.512"] fn perm2b(a: i8x64, i: i8x64, b: i8x64) -> i8x64;
    #[link_name = "llvm.x86.avx512.pshuf.b.512"] fn pshufb(a: i8x64, b: i8x64) -> i8x64;
    #[link_name = "llvm.x86.avx512.vpdpbusd.512"] fn dp512(s: i32x16, a: u8x64, b: i8x64) -> i32x16;
    #[link_name = "llvm.x86.avx512.vpdpbusd.256"] fn dp256(s: i32x8, a: u8x32, b: i8x32) -> i32x8;
    #[link_name = "llvm.x86.avx512.vpdpbusd.128"] fn dp128(s: i32x4, a: u8x16, b: i8x16) -> i32x4;
    #[link_name = "llvm.x86.avx512.packsswb.512"] fn packsswb(a: i16x32, b: i16x32) -> i8x64;
    #[link_name = "llvm.x86.avx512.packuswb.512"] fn packuswb(a: i16x32, b: i16x32) -> u8x64;
    #[link_name = "llvm.x86.avx512.packssdw.512"] fn packssdw(a: i32x16, b: i32x16) -> i16x32;
    #[link_name = "llvm.x86.avx512.packusdw.512"] fn packusdw(a: i32x16, b: i32x16) -> i16x32;
}
fn show512(m: __m512i) -> String {
    let a: i32x16 = unsafe { core::mem::transmute(m) };
    a.show()
}
#[target_feature(enable = "avx512f,avx512vl,avx512bw,avx512vbmi,avx512vnni")]
fn masks(a: __m512i, b: __m512i, c: __m512i) {
    // The mask register forms stdarch builds on these intrinsics: merge (keep `a`) and zero, at the mask's edge values.
    for k in [0u16, 1, 0x8000, 0xaaaa, 0xffff] {
        println!("stdarch _mm512_mask_ternarylogic_epi32::<0xe8> k={:04x} => {}", k, show512(_mm512_mask_ternarylogic_epi32::<0xe8>(a, k, b, c)));
        println!("stdarch _mm512_maskz_ternarylogic_epi32::<0xe8> k={:04x} => {}", k, show512(_mm512_maskz_ternarylogic_epi32::<0xe8>(k, a, b, c)));
        println!("stdarch _mm512_mask_dpbusd_epi32 k={:04x} => {}", k, show512(_mm512_mask_dpbusd_epi32(a, k, b, c)));
        println!("stdarch _mm512_maskz_dpbusd_epi32 k={:04x} => {}", k, show512(_mm512_maskz_dpbusd_epi32(k, a, b, c)));
    }
    for k in [0u64, 1, 1 << 63, 0xaaaa_aaaa_aaaa_aaaa, u64::MAX] {
        println!("stdarch _mm512_mask_shuffle_epi8 k={:016x} => {}", k, show512(_mm512_mask_shuffle_epi8(a, k, b, c)));
        println!("stdarch _mm512_mask_permutexvar_epi8 k={:016x} => {}", k, show512(_mm512_mask_permutexvar_epi8(a, k, b, c)));
    }
}
fn main() {
    let mut r = Bytes(0x0bad_cafe);
    let (a, b, c): (i32x16, i32x16, i32x16) = (r.v::<_, 64>(), r.v::<_, 64>(), r.v::<_, 64>());
    // Identities: 0xf0 = a, 0xcc = b, 0xaa = c, 0x00, 0xff, 0xe8 = majority, 0x96 = xor; high imm bits ignored.
    for imm in [0xf0i32, 0xcc, 0xaa, 0x00, 0xff, 0xe8, 0x96, 0x1ff, -1] {
        t!("llvm.x86.avx512.pternlog.d.512", tern512(a, b, c, imm));
    }
    let (a4, b4, c4): (i32x4, i32x4, i32x4) = (r.v::<_, 16>(), r.v::<_, 16>(), r.v::<_, 16>());
    t!("llvm.x86.avx512.pternlog.d.128", tern128(a4, b4, c4, 0xe8));
    let (a8, b8, c8): (i32x8, i32x8, i32x8) = (r.v::<_, 32>(), r.v::<_, 32>(), r.v::<_, 32>());
    t!("llvm.x86.avx512.pternlog.d.256", tern256(a8, b8, c8, 0x96));

    let (x, y): (u8x64, u8x64) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.psad.bw.512", psadbw(x, y));
    let (x, y): (i16x32, i16x32) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.pmaddw.d.512", pmaddwd(x, y));
    t!("llvm.x86.avx512.pmaddw.d.512", pmaddwd(i16x32([i16::MIN; 32]), i16x32([i16::MIN; 32])));
    t!("llvm.x86.avx512.packsswb.512", packsswb(x, y));
    t!("llvm.x86.avx512.packuswb.512", packuswb(x, y));
    let (xu, yi): (u8x64, i8x64) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.pmaddubs.w.512", pmaddubsw(xu, yi));
    let (x, y): (i32x16, i32x16) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.permvar.si.512", permd(x, y));
    t!("llvm.x86.avx512.packssdw.512", packssdw(x, y));
    t!("llvm.x86.avx512.packusdw.512", packusdw(x, y));
    let (x, y): (i64x8, i64x8) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.permvar.di.512", permq(x, y));
    let z: i64x8 = r.v::<_, 64>();
    t!("llvm.x86.avx512.vpermi2var.q.512", perm2q(x, y, z));
    let (x, y): (i8x64, i8x64) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.permvar.qi.512", permb512(x, y));
    t!("llvm.x86.avx512.pshuf.b.512", pshufb(x, y));
    let z: i8x64 = r.v::<_, 64>();
    t!("llvm.x86.avx512.vpermi2var.qi.512", perm2b(x, y, z));
    let (x, y): (i8x32, i8x32) = (r.v::<_, 32>(), r.v::<_, 32>());
    t!("llvm.x86.avx512.permvar.qi.256", permb256(x, y));
    let (x, y): (i8x16, i8x16) = (r.v::<_, 16>(), r.v::<_, 16>());
    t!("llvm.x86.avx512.permvar.qi.128", permb128(x, y));

    let (s, u, i): (i32x16, u8x64, i8x64) = (r.v::<_, 64>(), r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.avx512.vpdpbusd.512", dp512(s, u, i));
    // The accumulator wraps; the four products are at their extremes.
    t!("llvm.x86.avx512.vpdpbusd.512", dp512(i32x16([i32::MAX; 16]), u8x64([255; 64]), i8x64([127; 64])));
    t!("llvm.x86.avx512.vpdpbusd.512", dp512(i32x16([i32::MIN; 16]), u8x64([255; 64]), i8x64([-128; 64])));
    let (s, u, i): (i32x8, u8x32, i8x32) = (r.v::<_, 32>(), r.v::<_, 32>(), r.v::<_, 32>());
    t!("llvm.x86.avx512.vpdpbusd.256", dp256(s, u, i));
    let (s, u, i): (i32x4, u8x16, i8x16) = (r.v::<_, 16>(), r.v::<_, 16>(), r.v::<_, 16>());
    t!("llvm.x86.avx512.vpdpbusd.128", dp128(s, u, i));

    let (ma, mb, mc): (__m512i, __m512i, __m512i) = (r.v::<_, 64>(), r.v::<_, 64>(), r.v::<_, 64>());
    unsafe { masks(ma, mb, mc) };
}
