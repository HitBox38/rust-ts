//@ flags: -Ctarget-feature=+aes,+sse2,+avx2,+vaes,+avx512f
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.aesni.aesenc"] fn aesenc(a: i64x2, k: i64x2) -> i64x2;
    #[link_name = "llvm.x86.aesni.aesenclast"] fn aesenclast(a: i64x2, k: i64x2) -> i64x2;
    #[link_name = "llvm.x86.aesni.aesdec"] fn aesdec(a: i64x2, k: i64x2) -> i64x2;
    #[link_name = "llvm.x86.aesni.aesdeclast"] fn aesdeclast(a: i64x2, k: i64x2) -> i64x2;
    #[link_name = "llvm.x86.aesni.aesimc"] fn aesimc(a: i64x2) -> i64x2;
    #[link_name = "llvm.x86.aesni.aeskeygenassist"] fn keygen(a: i64x2, rcon: u8) -> i64x2;
    #[link_name = "llvm.x86.aesni.aesenc.256"] fn aesenc256(a: i64x4, k: i64x4) -> i64x4;
    #[link_name = "llvm.x86.aesni.aesenclast.256"] fn aesenclast256(a: i64x4, k: i64x4) -> i64x4;
    #[link_name = "llvm.x86.aesni.aesdec.256"] fn aesdec256(a: i64x4, k: i64x4) -> i64x4;
    #[link_name = "llvm.x86.aesni.aesdeclast.256"] fn aesdeclast256(a: i64x4, k: i64x4) -> i64x4;
    #[link_name = "llvm.x86.aesni.aesenc.512"] fn aesenc512(a: i64x8, k: i64x8) -> i64x8;
    #[link_name = "llvm.x86.aesni.aesenclast.512"] fn aesenclast512(a: i64x8, k: i64x8) -> i64x8;
    #[link_name = "llvm.x86.aesni.aesdec.512"] fn aesdec512(a: i64x8, k: i64x8) -> i64x8;
    #[link_name = "llvm.x86.aesni.aesdeclast.512"] fn aesdeclast512(a: i64x8, k: i64x8) -> i64x8;
}
fn v(a: u128) -> i64x2 {
    unsafe { core::mem::transmute(a) }
}
fn u(a: i64x2) -> u128 {
    unsafe { core::mem::transmute(a) }
}
fn step(key: u128, assist: u128) -> u128 {
    let t = (assist >> 96) as u32;
    let mut w = [key as u32, (key >> 32) as u32, (key >> 64) as u32, (key >> 96) as u32];
    w[0] ^= t;
    w[1] ^= w[0];
    w[2] ^= w[1];
    w[3] ^= w[2];
    (w[0] as u128) | ((w[1] as u128) << 32) | ((w[2] as u128) << 64) | ((w[3] as u128) << 96)
}
fn main() {
    let mut r = Bytes(0x5a5a_a5a5);
    for _ in 0..4 {
        let (a, k): (i64x2, i64x2) = (r.v::<_, 16>(), r.v::<_, 16>());
        t!("llvm.x86.aesni.aesenc", aesenc(a, k));
        t!("llvm.x86.aesni.aesenclast", aesenclast(a, k));
        t!("llvm.x86.aesni.aesdec", aesdec(a, k));
        t!("llvm.x86.aesni.aesdeclast", aesdeclast(a, k));
        t!("llvm.x86.aesni.aesimc", aesimc(a));
    }
    let (a, k): (i64x4, i64x4) = (r.v::<_, 32>(), r.v::<_, 32>());
    t!("llvm.x86.aesni.aesenc.256", aesenc256(a, k));
    t!("llvm.x86.aesni.aesenclast.256", aesenclast256(a, k));
    t!("llvm.x86.aesni.aesdec.256", aesdec256(a, k));
    t!("llvm.x86.aesni.aesdeclast.256", aesdeclast256(a, k));
    let (a, k): (i64x8, i64x8) = (r.v::<_, 64>(), r.v::<_, 64>());
    t!("llvm.x86.aesni.aesenc.512", aesenc512(a, k));
    t!("llvm.x86.aesni.aesenclast.512", aesenclast512(a, k));
    t!("llvm.x86.aesni.aesdec.512", aesdec512(a, k));
    t!("llvm.x86.aesni.aesdeclast.512", aesdeclast512(a, k));

    // Known vector: FIPS-197 Appendix C.1 (AES-128), encrypted and decrypted through the round intrinsics.
    let le = |b: u128| b.swap_bytes();
    let plain = le(0x00112233445566778899aabbccddeeff);
    let want = le(0x69c4e0d86a7b0430d8cdb78070b4c55a);
    let mut keys = [le(0x000102030405060708090a0b0c0d0e0f); 11];
    for (i, rcon) in [0x01u8, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36].iter().enumerate() {
        keys[i + 1] = step(keys[i], u(unsafe { keygen(v(keys[i]), *rcon) }));
    }
    let mut s = plain ^ keys[0];
    for key in &keys[1..10] {
        s = u(unsafe { aesenc(v(s), v(*key)) });
    }
    s = u(unsafe { aesenclast(v(s), v(keys[10])) });
    println!("fips197-c1 cipher {:032x}", le(s));
    assert_eq!(s, want);
    let mut s = want ^ keys[10];
    for key in keys[1..10].iter().rev() {
        s = u(unsafe { aesdec(v(s), aesimc(v(*key))) });
    }
    s = u(unsafe { aesdeclast(v(s), v(keys[0])) });
    println!("fips197-c1 plain {:032x}", le(s));
    assert_eq!(s, plain);
}
