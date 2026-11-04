// Probe of lane miri-x86-a: an SSSE3 intrinsic without the target feature.
#![feature(link_llvm_intrinsics, repr_simd, simd_ffi)]
#![no_main]
#![allow(unused, non_camel_case_types, improper_ctypes, internal_features, unnecessary_transmutes)]
use std::arch::x86_64::*;
use std::mem::transmute as t;

#[repr(simd)] #[derive(Copy, Clone)] struct u8x16([u8; 16]);

unsafe extern "llvm-intrinsic" {
    #[link_name = "llvm.x86.ssse3.pshuf.b.128"] fn pshufb(a: u8x16, b: u8x16) -> u8x16;
}

#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize { unsafe {
    pshufb(t([0u8; 16]), t([0u8; 16]));
    0
} }
