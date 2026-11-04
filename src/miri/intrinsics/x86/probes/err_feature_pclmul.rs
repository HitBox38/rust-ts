// Probe of lane miri-x86-a: pclmulqdq without the target feature.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
use std::mem::transmute as t;

#[repr(simd)] #[derive(Copy, Clone)] struct u8x16([u8; 16]);

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.pclmulqdq"] fn clmul(a: __m128i, b: __m128i, imm: u8) -> __m128i;
}

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    clmul(t([0u64; 2]), t([0u64; 2]), 0);
    0
} }
