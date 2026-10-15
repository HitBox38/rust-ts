// Intrinsic declaration errors that `check_intrinsic_type` reports itself (lane check-region-intrinsic): wrong
// numbers of type / const parameters (E0094), unknown intrinsics (E0093) and safety mismatches. A late-bound lifetime
// (`ctpop<'a, T>`) is not counted.
#![feature(no_core, lang_items, intrinsics, rustc_attrs)]
#![no_core]
#![allow(internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

#[rustc_intrinsic]
pub unsafe fn size_of<T, U>() -> usize;
#[rustc_intrinsic]
pub fn ctpop<'a, T: Copy>(x: T) -> u32;
#[rustc_intrinsic]
pub unsafe fn atomic_fence();
#[rustc_intrinsic]
pub unsafe fn atomic_load<T: Copy, const ORD: u8, const VOLATILE: bool, const X: bool>(src: *const T) -> T;
#[rustc_intrinsic]
pub fn not_an_intrinsic(x: u8) -> u8;
#[rustc_intrinsic]
pub unsafe fn bogus_intrinsic<T>();
