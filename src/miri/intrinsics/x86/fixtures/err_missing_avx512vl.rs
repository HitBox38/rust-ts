//@ flags: -Ctarget-feature=+avx512f
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![allow(internal_features, improper_ctypes, non_camel_case_types)]
#[repr(simd)]
#[derive(Copy, Clone)]
struct i32x4([i32; 4]);
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx512.pternlog.d.128"] fn tern(a: i32x4, b: i32x4, c: i32x4, imm: i32) -> i32x4;
}
fn main() {
    let z = i32x4([0; 4]);
    let _ = unsafe { tern(z, z, z, 0) };
}
