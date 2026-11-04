//@ flags: 
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![allow(internal_features, improper_ctypes, non_camel_case_types)]
#[repr(simd)]
#[derive(Copy, Clone)]
struct u8x16([u8; 16]);
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.vgf2p8mulb.128"] fn mul(a: u8x16, b: u8x16) -> u8x16;
}
fn main() {
    let z = u8x16([0; 16]);
    let _ = unsafe { mul(z, z) };
}
