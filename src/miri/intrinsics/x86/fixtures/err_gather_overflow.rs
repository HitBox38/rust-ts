//@ flags: -Ctarget-feature=+avx2
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![allow(internal_features, improper_ctypes, non_camel_case_types)]
#[repr(simd)]
#[derive(Copy, Clone)]
struct i64x2([i64; 2]);
#[repr(simd)]
#[derive(Copy, Clone)]
struct i32x4([i32; 4]);
unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.avx2.gather.q.d"] fn g(s: i32x4, p: *const i8, o: i64x2, m: i32x4, sc: i8) -> i32x4;
}
fn main() {
    let d = [0u8; 16];
    let o = i64x2([i64::MAX, 0]);
    let m = i32x4([-1; 4]);
    let _ = unsafe { g(i32x4([0; 4]), d.as_ptr() as *const i8, o, m, 8) };
}
