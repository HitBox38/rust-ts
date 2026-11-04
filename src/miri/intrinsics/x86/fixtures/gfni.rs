//@ flags: -Ctarget-feature=+gfni,+avx,+avx512f,+avx512bw
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.vgf2p8mulb.128"] fn mul128(a: u8x16, b: u8x16) -> u8x16;
    #[link_name = "llvm.x86.vgf2p8mulb.256"] fn mul256(a: u8x32, b: u8x32) -> u8x32;
    #[link_name = "llvm.x86.vgf2p8mulb.512"] fn mul512(a: u8x64, b: u8x64) -> u8x64;
    #[link_name = "llvm.x86.vgf2p8affineqb.128"] fn aff128(x: u8x16, a: u8x16, imm: u8) -> u8x16;
    #[link_name = "llvm.x86.vgf2p8affineqb.256"] fn aff256(x: u8x32, a: u8x32, imm: u8) -> u8x32;
    #[link_name = "llvm.x86.vgf2p8affineqb.512"] fn aff512(x: u8x64, a: u8x64, imm: u8) -> u8x64;
    #[link_name = "llvm.x86.vgf2p8affineinvqb.128"] fn inv128(x: u8x16, a: u8x16, imm: u8) -> u8x16;
    #[link_name = "llvm.x86.vgf2p8affineinvqb.256"] fn inv256(x: u8x32, a: u8x32, imm: u8) -> u8x32;
    #[link_name = "llvm.x86.vgf2p8affineinvqb.512"] fn inv512(x: u8x64, a: u8x64, imm: u8) -> u8x64;
}
/// Repeats one 8x8 bit matrix (`u64`, little endian) over a vector of `N` bytes.
fn matrix<const N: usize>(m: u64) -> [u8; N] {
    let b = m.to_le_bytes();
    let mut a = [0u8; N];
    for (i, x) in a.iter_mut().enumerate() {
        *x = b[i % 8];
    }
    a
}
fn main() {
    let mut r = Bytes(0x1234_5678);
    for _ in 0..3 {
        let (a, b) = (u8x16(r.arr()), u8x16(r.arr()));
        t!("llvm.x86.vgf2p8mulb.128", mul128(a, b));
        let (a, b) = (u8x32(r.arr()), u8x32(r.arr()));
        t!("llvm.x86.vgf2p8mulb.256", mul256(a, b));
        let (a, b) = (u8x64(r.arr()), u8x64(r.arr()));
        t!("llvm.x86.vgf2p8mulb.512", mul512(a, b));
    }
    // Every byte times 0, 1, 2 and 0x53 (AES: 0x53 * 0xca = 1).
    for k in [0u8, 1, 2, 0x53] {
        let mut a = [0u8; 64];
        for (i, x) in a.iter_mut().enumerate() {
            *x = (i * 4 + 0xca) as u8;
        }
        let (a, b) = (u8x64(a), u8x64([k; 64]));
        t!("llvm.x86.vgf2p8mulb.512", mul512(a, b));
    }
    // Identity, zero, all-ones, bit-reversal (the matrix with bytes in the other order), and the AES S-box's affine
    // matrix 0xf1e3c78f1f3e7cf8 with 0x63, whose inverse form over the bytes is the AES S-box.
    let matrices = [0x0102_0408_1020_4080u64, 0, u64::MAX, 0x8040_2010_0804_0201, 0xf1e3_c78f_1f3e_7cf8];
    let imms = [0u8, 0xff, 0x63];
    for &m in &matrices {
        for &imm in &imms {
            let x = u8x16(r.arr());
            t!("llvm.x86.vgf2p8affineqb.128", aff128(x, u8x16(matrix(m)), imm));
            t!("llvm.x86.vgf2p8affineinvqb.128", inv128(x, u8x16(matrix(m)), imm));
        }
    }
    // Two different matrices per 128-bit lane: the chunking of eight.
    let mut two = [0u8; 16];
    two[..8].copy_from_slice(&0x0102_0408_1020_4080u64.to_le_bytes());
    two[8..].copy_from_slice(&0xf1e3_c78f_1f3e_7cf8u64.to_le_bytes());
    let x = u8x16(r.arr());
    t!("llvm.x86.vgf2p8affineqb.128", aff128(x, u8x16(two), 0u8));
    let x = u8x32(r.arr());
    t!("llvm.x86.vgf2p8affineqb.256", aff256(x, u8x32(matrix(0xf1e3_c78f_1f3e_7cf8)), 0x63u8));
    t!("llvm.x86.vgf2p8affineinvqb.256", inv256(x, u8x32(matrix(0xf1e3_c78f_1f3e_7cf8)), 0x63u8));
    let x = u8x64(r.arr());
    t!("llvm.x86.vgf2p8affineqb.512", aff512(x, u8x64(matrix(0xf1e3_c78f_1f3e_7cf8)), 0x63u8));
    t!("llvm.x86.vgf2p8affineinvqb.512", inv512(x, u8x64(matrix(0xf1e3_c78f_1f3e_7cf8)), 0x63u8));
    // Known value: the inverse affine form with the AES matrix is the AES S-box.
    let mut x = [0u8; 16];
    x[1] = 0x01;
    x[2] = 0x53;
    x[3] = 0xff;
    let y: [u8; 16] = unsafe { core::mem::transmute(inv128(u8x16(x), u8x16(matrix(0xf1e3_c78f_1f3e_7cf8)), 0x63)) };
    assert_eq!(&y[..4], &[0x63, 0x7c, 0xed, 0x16]);
}
