// The stop fixture of simd_intrinsic.test.ts (review ir-fix-a N4): one call of an arm of `generic_simd_intrinsic` that is not
// ported (`simd_fsqrt`, which upstream hands to `simd_simple_float_intrinsic`, intrinsic.rs:2496). The port must stop there
// with exit 70 and a stop naming its fill lane, cg-intrinsic-b; the oracle compiles it.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, repr_simd, adt_const_params, unsized_const_params)]
#![allow(internal_features, incomplete_features, non_camel_case_types)]
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
#[lang = "const_param_ty"]
pub trait ConstParamTy_ {}
impl ConstParamTy_ for u32 {}
impl<T: ConstParamTy_> ConstParamTy_ for [T] {}
impl<T: ConstParamTy_ + ?Sized> ConstParamTy_ for &T {}
impl ConstParamTy_ for usize {}
#[lang = "unsize"]
pub trait Unsize<T: PointeeSized>: PointeeSized {}
#[lang = "coerce_unsized"]
pub trait CoerceUnsized<T: PointeeSized> {}
impl<'a, T: PointeeSized + Unsize<U>, U: PointeeSized> CoerceUnsized<&'a U> for &'a T {}
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
pub unsafe fn simd_fsqrt<T>(x: T) -> T;

#[no_mangle]
pub unsafe fn s_fsqrt(a: f32x4) -> f32x4 { simd_fsqrt(a) }
