// Intrinsics with the right generic counts but wrong signatures (lane check-region-intrinsic): the oracle reports an
// E0308 for each one (from `check_function_signature`), so the signature `check_intrinsic_type` computes must differ
// from every declared one.
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
pub fn size_of<T>() -> u32;
#[rustc_intrinsic]
pub unsafe fn transmute<Src, Dst>(src: Dst) -> Src;
#[rustc_intrinsic]
pub fn ctpop<T: Copy>(x: T) -> u64;
#[rustc_intrinsic]
pub fn sqrtf32(x: f64) -> f32;
#[rustc_intrinsic]
pub unsafe fn copy_nonoverlapping<T>(src: *mut T, dst: *mut T, count: usize);
#[rustc_intrinsic]
pub fn add_with_overflow<T: Copy>(x: T, y: T) -> (bool, T);
#[rustc_intrinsic]
pub fn breakpoint(x: u8);
