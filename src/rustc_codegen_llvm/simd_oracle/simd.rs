// The oracle crate of simd_intrinsic.test.ts (lane ir-fix-a): one `#[no_mangle]` function per arm of `generic_simd_intrinsic`
// (intrinsic.rs:2047) that the port has, over a minimal `#![no_core]` (the lang items of tests/auxiliary/minicore.rs these
// signatures need). `-O` keeps the bodies free of the stack traffic `-Copt-level=0` adds around each call.
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
pub unsafe fn simd_splat<T, U>(x: U) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_eq<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_lt<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_ge<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_shuffle<T, U, V>(x: T, y: T, idx: U) -> V;
#[rustc_intrinsic]
pub unsafe fn simd_insert<T, U>(x: T, idx: u32, val: U) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_extract<T, U>(x: T, idx: u32) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_select_bitmask<M, T>(m: M, yes: T, no: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_bitmask<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_min<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_max<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_and<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_or<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_xor<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_all<T>(x: T) -> bool;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_any<T>(x: T) -> bool;
#[rustc_intrinsic]
pub unsafe fn simd_add<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_sub<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_mul<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_div<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_rem<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_shl<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_shr<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_and<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_or<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_xor<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_neg<T>(x: T) -> T;
// Review ir-fix-a N1: the ported arms the first version of this fixture left out.
#[rustc_intrinsic]
pub unsafe fn simd_shuffle_const_generic<T, U, const IDX: &'static [u32]>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_insert_dyn<T, U>(x: T, idx: u32, val: U) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_extract_dyn<T, U>(x: T, idx: u32) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_ne<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_le<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_gt<T, U>(x: T, y: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_maximum_number_nsz<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_minimum_number_nsz<T>(x: T, y: T) -> T;

#[no_mangle]
pub unsafe fn f_splat_u8(x: u8) -> u8x16 { simd_splat(x) }
#[no_mangle]
pub unsafe fn f_splat_f32(x: f32) -> f32x4 { simd_splat(x) }
#[no_mangle]
pub unsafe fn f_eq_u8(a: u8x16, b: u8x16) -> i8x16 { simd_eq(a, b) }
#[no_mangle]
pub unsafe fn f_lt_i32(a: i32x4, b: i32x4) -> i32x4 { simd_lt(a, b) }
#[no_mangle]
pub unsafe fn f_ge_u32(a: u32x4, b: u32x4) -> i32x4 { simd_ge(a, b) }
#[no_mangle]
pub unsafe fn f_lt_f32(a: f32x4, b: f32x4) -> i32x4 { simd_lt(a, b) }
#[no_mangle]
pub unsafe fn f_shuffle(a: i32x4, b: i32x4) -> i32x4 { simd_shuffle(a, b, const { Idx4([7, 0, 5, 2]) }) }
#[no_mangle]
pub unsafe fn f_shuffle_wide(a: i32x4, b: i32x4) -> i32x8 { simd_shuffle(a, b, const { Idx8([0, 1, 2, 3, 4, 5, 6, 7]) }) }
#[no_mangle]
pub unsafe fn f_insert(a: i32x4, v: i32) -> i32x4 { simd_insert(a, 2, v) }
#[no_mangle]
pub unsafe fn f_extract(a: i32x4) -> i32 { simd_extract(a, 3) }
#[no_mangle]
pub unsafe fn f_select_bitmask(m: u8, a: i32x4, b: i32x4) -> i32x4 { simd_select_bitmask(m, a, b) }
#[no_mangle]
pub unsafe fn f_select_bitmask_array(m: [u8; 1], a: i32x4, b: i32x4) -> i32x4 { simd_select_bitmask(m, a, b) }
#[no_mangle]
pub unsafe fn f_bitmask_u16(a: i8x16) -> u16 { simd_bitmask(a) }
#[no_mangle]
pub unsafe fn f_bitmask_u8(a: i32x4) -> u8 { simd_bitmask(a) }
#[no_mangle]
pub unsafe fn f_bitmask_array(a: i8x16) -> [u8; 2] { simd_bitmask(a) }
#[no_mangle]
pub unsafe fn f_reduce_min_i32(a: i32x4) -> i32 { simd_reduce_min(a) }
#[no_mangle]
pub unsafe fn f_reduce_max_u32(a: u32x4) -> u32 { simd_reduce_max(a) }
#[no_mangle]
pub unsafe fn f_reduce_and(a: u32x4) -> u32 { simd_reduce_and(a) }
#[no_mangle]
pub unsafe fn f_reduce_or(a: u8x16) -> u8 { simd_reduce_or(a) }
#[no_mangle]
pub unsafe fn f_reduce_xor(a: i32x4) -> i32 { simd_reduce_xor(a) }
#[no_mangle]
pub unsafe fn f_reduce_all(a: i8x16) -> bool { simd_reduce_all(a) }
#[no_mangle]
pub unsafe fn f_reduce_any(a: i32x4) -> bool { simd_reduce_any(a) }
#[no_mangle]
pub unsafe fn f_add_f32(a: f32x4, b: f32x4) -> f32x4 { simd_add(a, b) }
#[no_mangle]
pub unsafe fn f_sub_i32(a: i32x4, b: i32x4) -> i32x4 { simd_sub(a, b) }
#[no_mangle]
pub unsafe fn f_mul_u32(a: u32x4, b: u32x4) -> u32x4 { simd_mul(a, b) }
#[no_mangle]
pub unsafe fn f_div_i32(a: i32x4, b: i32x4) -> i32x4 { simd_div(a, b) }
#[no_mangle]
pub unsafe fn f_div_u32(a: u32x4, b: u32x4) -> u32x4 { simd_div(a, b) }
#[no_mangle]
pub unsafe fn f_rem_f32(a: f32x4, b: f32x4) -> f32x4 { simd_rem(a, b) }
#[no_mangle]
pub unsafe fn f_shl(a: u32x4, b: u32x4) -> u32x4 { simd_shl(a, b) }
#[no_mangle]
pub unsafe fn f_shr_i32(a: i32x4, b: i32x4) -> i32x4 { simd_shr(a, b) }
#[no_mangle]
pub unsafe fn f_shr_u32(a: u32x4, b: u32x4) -> u32x4 { simd_shr(a, b) }
#[no_mangle]
pub unsafe fn f_and(a: u8x16, b: u8x16) -> u8x16 { simd_and(a, b) }
#[no_mangle]
pub unsafe fn f_or(a: u8x16, b: u8x16) -> u8x16 { simd_or(a, b) }
#[no_mangle]
pub unsafe fn f_xor(a: i32x4, b: i32x4) -> i32x4 { simd_xor(a, b) }
#[no_mangle]
pub unsafe fn f_neg_i32(a: i32x4) -> i32x4 { simd_neg(a) }
#[no_mangle]
pub unsafe fn f_neg_f32(a: f32x4) -> f32x4 { simd_neg(a) }
#[no_mangle]
pub unsafe fn f_cg(a: i32x4, b: i32x4) -> i32x4 { simd_shuffle_const_generic::<_, _, { &[7, 1, 5, 0] }>(a, b) }
#[no_mangle]
pub unsafe fn f_cg_wide(a: i32x4, b: i32x4) -> i32x8 { simd_shuffle_const_generic::<_, _, { &[0, 1, 2, 3, 4, 5, 6, 7] }>(a, b) }
#[no_mangle]
pub unsafe fn f_insert_dyn(a: i32x4, i: u32, v: i32) -> i32x4 { simd_insert_dyn(a, i, v) }
#[no_mangle]
pub unsafe fn f_extract_dyn(a: i32x4, i: u32) -> i32 { simd_extract_dyn(a, i) }
#[no_mangle]
pub unsafe fn f_ne_i32(a: i32x4, b: i32x4) -> i32x4 { simd_ne(a, b) }
#[no_mangle]
pub unsafe fn f_le_u32(a: u32x4, b: u32x4) -> i32x4 { simd_le(a, b) }
#[no_mangle]
pub unsafe fn f_gt_f32(a: f32x4, b: f32x4) -> i32x4 { simd_gt(a, b) }
#[no_mangle]
pub unsafe fn f_max_nsz(a: f32x4, b: f32x4) -> f32x4 { simd_maximum_number_nsz(a, b) }
#[no_mangle]
pub unsafe fn f_min_nsz(a: f32x4, b: f32x4) -> f32x4 { simd_minimum_number_nsz(a, b) }
#[no_mangle]
pub unsafe fn f_rem_i32(a: i32x4, b: i32x4) -> i32x4 { simd_rem(a, b) }
#[no_mangle]
pub unsafe fn f_rem_u32(a: u32x4, b: u32x4) -> u32x4 { simd_rem(a, b) }
#[no_mangle]
pub unsafe fn f_reduce_any_u8(a: u8x16) -> bool { simd_reduce_any(a) }
