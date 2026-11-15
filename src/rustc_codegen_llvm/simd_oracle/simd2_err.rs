// The second diagnostics crate of simd_intrinsic.test.ts (lane cg-intrinsic-b): calls that fail the checks of the arms of
// `generic_simd_intrinsic` (intrinsic.rs:2047) lane cg-intrinsic-b ported, one per `InvalidMonomorphization` the arm can
// emit before it reaches the IR model. (The `ExpectedReturnType` checks of `simd_gather` and `simd_masked_load` cannot fail:
// typeck makes their return type the type of their `values` argument.) `simd2_err.stderr` is the pinned rustc's stderr (exit 1).
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, repr_simd, adt_const_params, f16)]
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
#[lang = "pointee_trait"]
pub trait Pointee: PointeeSized {
    #[lang = "metadata_type"]
    type Metadata: Copy;
}
impl Copy for u8 {}
impl Copy for u32 {}
impl Copy for i32 {}
impl Copy for i64 {}
impl Copy for usize {}
impl Copy for f16 {}
impl Copy for f32 {}
impl<T: PointeeSized> Copy for *const T {}
impl<T: PointeeSized> Copy for *mut T {}
impl<T: Copy, const N: usize> Copy for [T; N] {}
impl ConstParamTy_ for usize {}

/// `core::intrinsics::simd::SimdAlign`.
pub enum SimdAlign {
    Unaligned,
    Element,
    Vector,
}
impl StructuralPartialEq for SimdAlign {}
impl ConstParamTy_ for SimdAlign {}

#[repr(simd)]
pub struct i32x4([i32; 4]);
#[repr(simd)]
pub struct i32x8([i32; 8]);
#[repr(simd)]
pub struct u32x4([u32; 4]);
#[repr(simd)]
pub struct i64x4([i64; 4]);
#[repr(simd)]
pub struct f16x4([f16; 4]);
#[repr(simd)]
pub struct f32x4([f32; 4]);
#[repr(simd)]
pub struct f32x8([f32; 8]);
#[repr(simd)]
pub struct usizex4([usize; 4]);
#[repr(simd)]
pub struct cptrx4([*const f32; 4]);
#[repr(simd)]
pub struct cptrx8([*const f32; 8]);
#[repr(simd)]
pub struct mptrx4([*mut f32; 4]);
#[repr(simd)]
pub struct iptrx4([*const i32; 4]);
impl Copy for i32x4 {}
impl Copy for i32x8 {}
impl Copy for u32x4 {}
impl Copy for i64x4 {}
impl Copy for f16x4 {}
impl Copy for f32x4 {}
impl Copy for f32x8 {}
impl Copy for usizex4 {}
impl Copy for cptrx4 {}
impl Copy for cptrx8 {}
impl Copy for mptrx4 {}
impl Copy for iptrx4 {}

#[rustc_intrinsic]
pub unsafe fn simd_select<M, T>(m: M, yes: T, no: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fsqrt<T>(x: T) -> T;
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
pub unsafe fn simd_reduce_add_unordered<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_cast_ptr<T, U>(ptr: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_expose_provenance<T, U>(ptr: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_with_exposed_provenance<T, U>(addr: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_cast<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_as<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_bswap<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_saturating_add<T>(x: T, y: T) -> T;

#[no_mangle]
pub unsafe fn e_select_len(m: i32x8, a: f32x4, b: f32x4) -> f32x4 { simd_select(m, a, b) }
#[no_mangle]
pub unsafe fn e_select_mask_float(m: f32x4, a: i32x4, b: i32x4) -> i32x4 { simd_select(m, a, b) }
#[no_mangle]
pub unsafe fn e_select_arg_scalar(m: i32x4, a: f32, b: f32) -> f32 { simd_select(m, a, b) }
#[no_mangle]
pub unsafe fn e_fsqrt_int(a: i32x4) -> i32x4 { simd_fsqrt(a) }
#[no_mangle]
pub unsafe fn e_gather_second(v: f32x4, p: *const f32, m: i32x4) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_gather_third(v: f32x4, p: cptrx4, m: i32) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_gather_second_len(v: f32x4, p: cptrx8, m: i32x4) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_gather_third_len(v: f32x4, p: cptrx4, m: i32x8) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_gather_elem(v: f32x4, p: iptrx4, m: i32x4) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_gather_mask(v: f32x4, p: cptrx4, m: f32x4) -> f32x4 { simd_gather(v, p, m) }
#[no_mangle]
pub unsafe fn e_scatter_const(v: f32x4, p: cptrx4, m: i32x4) { simd_scatter(v, p, m) }
#[no_mangle]
pub unsafe fn e_scatter_third(v: f32x4, p: mptrx4, m: u32) { simd_scatter(v, p, m) }
#[no_mangle]
pub unsafe fn e_masked_load_third(m: i32x4, p: *const f32, v: f32) -> f32 {
    simd_masked_load::<_, _, _, { SimdAlign::Element }>(m, p, v)
}
#[no_mangle]
pub unsafe fn e_masked_load_len(m: i32x4, p: *const f32, v: f32x8) -> f32x8 {
    simd_masked_load::<_, _, _, { SimdAlign::Element }>(m, p, v)
}
#[no_mangle]
pub unsafe fn e_masked_load_ptr(m: i32x4, p: *const i32, v: f32x4) -> f32x4 {
    simd_masked_load::<_, _, _, { SimdAlign::Element }>(m, p, v)
}
#[no_mangle]
pub unsafe fn e_masked_load_mask(m: f32x4, p: *const f32, v: f32x4) -> f32x4 {
    simd_masked_load::<_, _, _, { SimdAlign::Element }>(m, p, v)
}
#[no_mangle]
pub unsafe fn e_masked_store_const(m: i32x4, p: *const f32, v: f32x4) {
    simd_masked_store::<_, _, _, { SimdAlign::Vector }>(m, p, v)
}
#[no_mangle]
pub unsafe fn e_reduce_add_ordered_ret(a: i32x4, acc: u32) -> u32 { simd_reduce_add_ordered(a, acc) }
#[no_mangle]
pub unsafe fn e_reduce_add_ordered_ptr(a: cptrx4, acc: *const f32) -> *const f32 { simd_reduce_add_ordered(a, acc) }
#[no_mangle]
pub unsafe fn e_reduce_add_unordered_f16(a: f16x4) -> f16 { simd_reduce_add_unordered(a) }
#[no_mangle]
pub unsafe fn e_cast_ptr_len(a: cptrx4) -> cptrx8 { simd_cast_ptr(a) }
#[no_mangle]
pub unsafe fn e_cast_ptr_in(a: usizex4) -> cptrx4 { simd_cast_ptr(a) }
#[no_mangle]
pub unsafe fn e_cast_ptr_out(a: cptrx4) -> usizex4 { simd_cast_ptr(a) }
#[no_mangle]
pub unsafe fn e_cast_ptr_ret(a: cptrx4) -> *const f32 { simd_cast_ptr(a) }
#[no_mangle]
pub unsafe fn e_expose_in(a: usizex4) -> usizex4 { simd_expose_provenance(a) }
#[no_mangle]
pub unsafe fn e_expose_out(a: cptrx4) -> i64x4 { simd_expose_provenance(a) }
#[no_mangle]
pub unsafe fn e_expose_len(a: cptrx4) -> i32x8 { simd_expose_provenance(a) }
#[no_mangle]
pub unsafe fn e_with_exposed_in(a: i64x4) -> cptrx4 { simd_with_exposed_provenance(a) }
#[no_mangle]
pub unsafe fn e_with_exposed_out(a: usizex4) -> usizex4 { simd_with_exposed_provenance(a) }
#[no_mangle]
pub unsafe fn e_cast_len(a: i32x4) -> i32x8 { simd_cast(a) }
#[no_mangle]
pub unsafe fn e_cast_ret(a: i32x4) -> i32 { simd_cast(a) }
#[no_mangle]
pub unsafe fn e_cast_unsupported(a: cptrx4) -> usizex4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn e_as_unsupported(a: f32x4) -> cptrx4 { simd_as(a) }
#[no_mangle]
pub unsafe fn e_bswap_float(a: f32x4) -> f32x4 { simd_bswap(a) }
#[no_mangle]
pub unsafe fn e_saturating_add_float(a: f32x4, b: f32x4) -> f32x4 { simd_saturating_add(a, b) }
