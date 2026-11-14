// The error fixture of simd_intrinsic.test.ts (lane ir-fix-a): calls of `generic_simd_intrinsic`'s ported arms that fail its
// checks (`InvalidMonomorphization`, E0511); compiled as simd.rs is, the compiler's stderr and exit are the expectation.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, repr_simd)]
#![allow(internal_features, non_camel_case_types)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy: Sized {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
impl Copy for u8 {}
impl Copy for u32 {}
impl Copy for i32 {}
impl Copy for f32 {}
impl<T: Copy, const N: usize> Copy for [T; N] {}

#[repr(simd)]
pub struct u8x16([u8; 16]);
#[repr(simd)]
pub struct i8x16([i8; 16]);
#[repr(simd)]
pub struct i32x4([i32; 4]);
#[repr(simd)]
pub struct u32x4([u32; 4]);
#[repr(simd)]
pub struct f32x4([f32; 4]);
#[repr(simd)]
pub struct i32x8([i32; 8]);
#[repr(simd)]
pub struct Idx4([u32; 4]);
#[repr(simd)]
pub struct Idx8([u32; 8]);
impl Copy for i8 {}
impl Copy for u8x16 {}
impl Copy for i8x16 {}
impl Copy for i32x4 {}
impl Copy for u32x4 {}
impl Copy for f32x4 {}
impl Copy for i32x8 {}
impl Copy for Idx4 {}
impl Copy for Idx8 {}

#[rustc_intrinsic]
pub unsafe fn simd_splat<T, U>(x: U) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_eq<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_shuffle<T, U, V>(x: T, y: T, idx: U) -> V;
#[rustc_intrinsic]
pub unsafe fn simd_extract<T, U>(x: T, idx: u32) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_bitmask<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_and<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_or<T>(x: T, y: T) -> T;

#[no_mangle]
pub unsafe fn e_splat_elem(x: u32) -> u8x16 { simd_splat(x) }
#[no_mangle]
pub unsafe fn e_splat_ret(x: u32) -> u32 { simd_splat(x) }
#[no_mangle]
pub unsafe fn e_eq_len(a: i32x4, b: i32x4) -> i8x16 { simd_eq(a, b) }
#[no_mangle]
pub unsafe fn e_eq_float_ret(a: i32x4, b: i32x4) -> f32x4 { simd_eq(a, b) }
#[no_mangle]
pub unsafe fn e_shuffle_array(a: i32x4, b: i32x4) -> i32x8 { simd_shuffle(a, b, const { [0u32, 1, 2, 3, 4, 5, 6, 7] }) }
#[no_mangle]
pub unsafe fn e_shuffle_len(a: i32x4, b: i32x4) -> i32x8 { simd_shuffle(a, b, const { Idx4([0, 1, 2, 3]) }) }
#[no_mangle]
pub unsafe fn e_shuffle_oob(a: i32x4, b: i32x4) -> i32x4 { simd_shuffle(a, b, const { Idx4([0, 1, 9, 3]) }) }
#[no_mangle]
pub unsafe fn e_extract_oob(a: i32x4) -> i32 { simd_extract(a, 4) }
#[no_mangle]
pub unsafe fn e_extract_ret(a: i32x4) -> u32 { simd_extract(a, 0) }
#[no_mangle]
pub unsafe fn e_bitmask_ret(a: i8x16) -> u8 { simd_bitmask(a) }
#[no_mangle]
pub unsafe fn e_bitmask_float(a: f32x4) -> u8 { simd_bitmask(a) }
#[no_mangle]
pub unsafe fn e_reduce_and_float(a: f32x4) -> f32 { simd_reduce_and(a) }
#[no_mangle]
pub unsafe fn e_or_float(a: f32x4, b: f32x4) -> f32x4 { simd_or(a, b) }
#[no_mangle]
pub unsafe fn e_input_scalar(a: u32, b: u32) -> u32 { simd_or(a, b) }
