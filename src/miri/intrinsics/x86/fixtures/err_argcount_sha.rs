//@ flags: -Ctarget-feature=+sha,+sse2,+ssse3
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![allow(internal_features, improper_ctypes, non_camel_case_types)]
#[repr(simd)]
#[derive(Copy, Clone)]
struct i32x4([i32; 4]);
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sha256msg1"] fn msg1(a: i32x4) -> i32x4;
}
fn main() {
    let _ = unsafe { msg1(i32x4([0; 4])) };
}
