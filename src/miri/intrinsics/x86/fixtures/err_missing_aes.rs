//@ flags: 
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![allow(internal_features, improper_ctypes, non_camel_case_types)]
#[repr(simd)]
#[derive(Copy, Clone)]
struct i64x2([i64; 2]);
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.aesni.aesenc"] fn aesenc(a: i64x2, k: i64x2) -> i64x2;
}
fn main() {
    let z = i64x2([0; 2]);
    let _ = unsafe { aesenc(z, z) };
}
