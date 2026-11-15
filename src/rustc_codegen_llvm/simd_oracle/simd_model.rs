// The model-stop oracle crate of simd_intrinsic.test.ts (lane cg-intrinsic-b): the arms of `generic_simd_intrinsic`
// (intrinsic.rs:2047) that lane cg-intrinsic-b ported but whose `llvm.*` intrinsic the IR model (src/rust_ts/llvm/intrinsics.ts)
// does not declare yet: `llvm.masked.{gather,load,store,scatter}` and `llvm.vector.reduce.{fadd,fmul}` (lane ir-fix-b). Until
// the model has them the port stops in the model, naming the signature; once it has them, its IR must be the oracle's.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, repr_simd, adt_const_params)]
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
#[lang = "structural_peq"]
pub trait StructuralPartialEq {}
impl Copy for u8 {}
impl Copy for i32 {}
impl Copy for f32 {}
impl Copy for f64 {}
impl<T: PointeeSized> Copy for *const T {}
impl<T: PointeeSized> Copy for *mut T {}
impl<T: Copy, const N: usize> Copy for [T; N] {}

/// `core::intrinsics::simd::SimdAlign`.
pub enum SimdAlign {
    Unaligned,
    Element,
    Vector,
}
impl StructuralPartialEq for SimdAlign {}
impl ConstParamTy_ for usize {}
impl ConstParamTy_ for SimdAlign {}

#[repr(simd)]
pub struct i32x4([i32; 4]);
#[repr(simd)]
pub struct f32x4([f32; 4]);
#[repr(simd)]
pub struct f64x4([f64; 4]);
#[repr(simd)]
pub struct cptrx4([*const f32; 4]);
#[repr(simd)]
pub struct mptrx4([*mut f32; 4]);
#[repr(simd)]
pub struct m8x4([u8; 4]);
impl Copy for i32x4 {}
impl Copy for f32x4 {}
impl Copy for f64x4 {}
impl Copy for cptrx4 {}
impl Copy for mptrx4 {}
impl Copy for m8x4 {}

#[rustc_intrinsic]
pub unsafe fn simd_gather<T, U, V>(val: T, ptr: U, mask: V) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_scatter<T, U, V>(val: T, ptr: U, mask: V);
#[rustc_intrinsic]
pub unsafe fn simd_masked_load<V, U, T, const ALIGN: SimdAlign>(mask: V, ptr: U, val: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_masked_store<V, U, T, const ALIGN: SimdAlign>(mask: V, ptr: U, val: T);
#[rustc_intrinsic]
pub unsafe fn simd_reduce_add_ordered<T, U>(x: T, y: U) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_mul_ordered<T, U>(x: T, y: U) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_add_unordered<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_mul_unordered<T, U>(x: T) -> U;

#[no_mangle]
pub unsafe fn h_gather(v: f32x4, p: cptrx4, m: i32x4) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn h_scatter(v: f32x4, p: mptrx4, m: m8x4) { simd_scatter(v, p, m) }
#[no_mangle]
pub unsafe fn h_masked_load_element(m: i32x4, p: *const f32, v: f32x4) -> f32x4 {
    simd_masked_load::<_, _, _, { SimdAlign::Element }>(m, p, v)
}
#[no_mangle]
pub unsafe fn h_masked_load_vector(m: m8x4, p: *const f64, v: f64x4) -> f64x4 {
    simd_masked_load::<_, _, _, { SimdAlign::Vector }>(m, p, v)
}
#[no_mangle]
pub unsafe fn h_masked_store_unaligned(m: i32x4, p: *mut f32, v: f32x4) {
    simd_masked_store::<_, _, _, { SimdAlign::Unaligned }>(m, p, v)
}
#[no_mangle]
pub unsafe fn h_reduce_add_ordered_f32(a: f32x4, acc: f32) -> f32 { simd_reduce_add_ordered(a, acc) }
#[no_mangle]
pub unsafe fn h_reduce_mul_ordered_f64(a: f64x4, acc: f64) -> f64 { simd_reduce_mul_ordered(a, acc) }
#[no_mangle]
pub unsafe fn h_reduce_add_unordered_f32(a: f32x4) -> f32 { simd_reduce_add_unordered(a) }
#[no_mangle]
pub unsafe fn h_reduce_mul_unordered_f64(a: f64x4) -> f64 { simd_reduce_mul_unordered(a) }
