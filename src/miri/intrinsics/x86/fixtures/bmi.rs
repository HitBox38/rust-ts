//@ flags: -Ctarget-feature=+bmi1,+bmi2
#![feature(repr_simd, link_llvm_intrinsics, simd_ffi)]
#![allow(internal_features, non_camel_case_types, improper_ctypes, dead_code, unused_macros)]
include!("prelude.rs");
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.bmi.bextr.32"] fn bextr32(a: u32, c: u32) -> u32;
    #[link_name = "llvm.x86.bmi.bextr.64"] fn bextr64(a: u64, c: u64) -> u64;
    #[link_name = "llvm.x86.bmi.bzhi.32"] fn bzhi32(a: u32, c: u32) -> u32;
    #[link_name = "llvm.x86.bmi.bzhi.64"] fn bzhi64(a: u64, c: u64) -> u64;
    #[link_name = "llvm.x86.bmi.pext.32"] fn pext32(a: u32, c: u32) -> u32;
    #[link_name = "llvm.x86.bmi.pext.64"] fn pext64(a: u64, c: u64) -> u64;
    #[link_name = "llvm.x86.bmi.pdep.32"] fn pdep32(a: u32, c: u32) -> u32;
    #[link_name = "llvm.x86.bmi.pdep.64"] fn pdep64(a: u64, c: u64) -> u64;
}
fn main() {
    // Zero inputs, all-ones, single high bit, and patterns.
    let a32 = [0u32, 1, 0xffff_ffff, 0x8000_0000, 0xdead_beef, 0x0f0f_0f0f];
    // bextr control: start = bits 0..8, len = bits 8..16; includes start/len at and past 32 and 64.
    let c32 = [0u32, 1, 0x0808, 0x1f01, 0x2004, 0x0020, 0x4000, 0xff00, 0x00ff, 0xffff, 0x3f3f, 0x0140, 0xffff_0104];
    let m32 = [0u32, 1, 0xffff_ffff, 0x8000_0000, 0xff00_ff00, 0x8000_0001, 0x5555_5555];
    for &a in &a32 {
        for &c in &c32 {
            t!("llvm.x86.bmi.bextr.32", bextr32(a, c));
            t!("llvm.x86.bmi.bzhi.32", bzhi32(a, c));
        }
        for &m in &m32 {
            t!("llvm.x86.bmi.pext.32", pext32(a, m));
            t!("llvm.x86.bmi.pdep.32", pdep32(a, m));
        }
    }
    let a64 = [0u64, 1, u64::MAX, 1 << 63, 0xdead_beef_cafe_f00d, 0x0f0f_0f0f_0f0f_0f0f];
    let c64 = [0u64, 1, 0x0808, 0x3f01, 0x4004, 0x0040, 0x4000, 0xff00, 0x00ff, 0xffff, 0x3f3f, 0x0140, 0xffff_ffff_0000_0104];
    let m64 = [0u64, 1, u64::MAX, 1 << 63, 0xff00_ff00_ff00_ff00, 0x8000_0000_0000_0001, 0x5555_5555_5555_5555];
    for &a in &a64 {
        for &c in &c64 {
            t!("llvm.x86.bmi.bextr.64", bextr64(a, c));
            t!("llvm.x86.bmi.bzhi.64", bzhi64(a, c));
        }
        for &m in &m64 {
            t!("llvm.x86.bmi.pext.64", pext64(a, m));
            t!("llvm.x86.bmi.pdep.64", pdep64(a, m));
        }
    }
}
