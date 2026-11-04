// Probe of lane miri-x86-a: bit 3 of a comparison imm needs AVX (cmp_from_imm).
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
use std::mem::transmute as t;

#[repr(simd)] #[derive(Copy, Clone)] struct u8x16([u8; 16]);

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.sse.cmp.ss"] fn cmp_ss(a: __m128, b: __m128, imm: i8) -> __m128;
}

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    let z: __m128 = t([0u32; 4]); cmp_ss(z, z, 8);
    0
} }
