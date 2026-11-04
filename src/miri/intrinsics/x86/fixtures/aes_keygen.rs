//@ flags: -Ctarget-feature=+aes,+sse2
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.aesni.aeskeygenassist"] fn keygen(a: i64x2, rcon: u8) -> i64x2;
}
fn v(a: u128) -> i64x2 {
    unsafe { core::mem::transmute(a) }
}
fn u(a: i64x2) -> u128 {
    unsafe { core::mem::transmute(a) }
}
/// One step of the AES-128 key schedule from the keygenassist result (word 3, then a running XOR).
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
    let mut r = Bytes(0xa5a5_5a5a);
    for rcon in [0u8, 1, 2, 0x1b, 0x36, 0x80, 0xff] {
        let a: i64x2 = r.v::<_, 16>();
        t!("llvm.x86.aesni.aeskeygenassist", keygen(a, rcon));
    }
    let zero = v(0);
    let ones = v(u128::MAX);
    t!("llvm.x86.aesni.aeskeygenassist", keygen(zero, 0u8));
    t!("llvm.x86.aesni.aeskeygenassist", keygen(ones, 0xffu8));

    // Known vector: the FIPS-197 Appendix A.1 AES-128 key expansion of 2b7e151628aed2a6abf7158809cf4f3c.
    let mut key = u128::from_le_bytes([0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c]);
    for rcon in [0x01u8, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36] {
        key = step(key, u(unsafe { keygen(v(key), rcon) }));
        println!("fips197-a1 rcon {:02x} key {:032x}", rcon, key.swap_bytes());
    }
    assert_eq!(key.swap_bytes(), 0xd014f9a8c9ee2589e13f0cc8b6630ca6);
}
