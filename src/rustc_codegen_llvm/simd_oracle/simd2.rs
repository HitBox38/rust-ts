// The second oracle crate of simd_intrinsic.test.ts (lane cg-intrinsic-b): one `#[no_mangle]` function per arm of
// `generic_simd_intrinsic` (intrinsic.rs:2047) that lane cg-intrinsic-b ported and the IR model can declare (and per element
// kind or cast style where the arm branches on it), over the same minimal `#![no_core]` as simd.rs. The arms whose `llvm.*`
// intrinsic the model does not declare yet are in simd_model.rs.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, repr_simd)]
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
#[lang = "pointee_trait"]
pub trait Pointee: PointeeSized {
    #[lang = "metadata_type"]
    type Metadata: Copy;
}
impl Copy for u8 {}
impl Copy for i8 {}
impl Copy for u16 {}
impl Copy for i16 {}
impl Copy for u32 {}
impl Copy for i32 {}
impl Copy for u64 {}
impl Copy for i64 {}
impl Copy for usize {}
impl Copy for isize {}
impl Copy for f32 {}
impl Copy for f64 {}
impl<T: PointeeSized> Copy for *const T {}
impl<T: PointeeSized> Copy for *mut T {}
impl<T: Copy, const N: usize> Copy for [T; N] {}

#[repr(simd)]
pub struct u8x4([u8; 4]);
#[repr(simd)]
pub struct i8x4([i8; 4]);
#[repr(simd)]
pub struct u16x4([u16; 4]);
#[repr(simd)]
pub struct i16x4([i16; 4]);
#[repr(simd)]
pub struct i32x4([i32; 4]);
#[repr(simd)]
pub struct u32x4([u32; 4]);
#[repr(simd)]
pub struct i64x4([i64; 4]);
#[repr(simd)]
pub struct u64x4([u64; 4]);
#[repr(simd)]
pub struct f32x4([f32; 4]);
#[repr(simd)]
pub struct f64x4([f64; 4]);
#[repr(simd)]
pub struct usizex4([usize; 4]);
#[repr(simd)]
pub struct isizex4([isize; 4]);
#[repr(simd)]
pub struct cptrx4([*const i32; 4]);
#[repr(simd)]
pub struct mptrx4([*mut u8; 4]);
#[repr(simd)]
pub struct m32x4([i32; 4]);
#[repr(simd)]
pub struct m8x4([u8; 4]);
impl Copy for u8x4 {}
impl Copy for i8x4 {}
impl Copy for u16x4 {}
impl Copy for i16x4 {}
impl Copy for i32x4 {}
impl Copy for u32x4 {}
impl Copy for i64x4 {}
impl Copy for u64x4 {}
impl Copy for f32x4 {}
impl Copy for f64x4 {}
impl Copy for usizex4 {}
impl Copy for isizex4 {}
impl Copy for cptrx4 {}
impl Copy for mptrx4 {}
impl Copy for m32x4 {}
impl Copy for m8x4 {}

#[rustc_intrinsic]
pub unsafe fn simd_select<M, T>(m: M, yes: T, no: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_ceil<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fabs<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fcos<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fexp2<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fexp<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_flog10<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_flog2<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_flog<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_floor<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fma<T>(x: T, y: T, z: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_relaxed_fma<T>(x: T, y: T, z: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fsin<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_fsqrt<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_round<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_round_ties_even<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_trunc<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_add_ordered<T, U>(x: T, y: U) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_mul_ordered<T, U>(x: T, y: U) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_add_unordered<T, U>(x: T) -> U;
#[rustc_intrinsic]
pub unsafe fn simd_reduce_mul_unordered<T, U>(x: T) -> U;
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
pub unsafe fn simd_bitreverse<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_ctlz<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_ctpop<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_cttz<T>(x: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_carryless_mul<T>(a: T, b: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_funnel_shl<T>(a: T, b: T, shift: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_funnel_shr<T>(a: T, b: T, shift: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_arith_offset<T, U>(ptr: T, offset: U) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_saturating_add<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_saturating_sub<T>(x: T, y: T) -> T;

#[no_mangle]
pub unsafe fn g_select_i32(m: m32x4, a: f32x4, b: f32x4) -> f32x4 { simd_select(m, a, b) }
#[no_mangle]
pub unsafe fn g_select_u8(m: m8x4, a: i64x4, b: i64x4) -> i64x4 { simd_select(m, a, b) }
#[no_mangle]
pub unsafe fn g_ceil(a: f32x4) -> f32x4 { simd_ceil(a) }
#[no_mangle]
pub unsafe fn g_fabs(a: f64x4) -> f64x4 { simd_fabs(a) }
#[no_mangle]
pub unsafe fn g_fcos(a: f32x4) -> f32x4 { simd_fcos(a) }
#[no_mangle]
pub unsafe fn g_fexp2(a: f32x4) -> f32x4 { simd_fexp2(a) }
#[no_mangle]
pub unsafe fn g_fexp(a: f32x4) -> f32x4 { simd_fexp(a) }
#[no_mangle]
pub unsafe fn g_flog10(a: f32x4) -> f32x4 { simd_flog10(a) }
#[no_mangle]
pub unsafe fn g_flog2(a: f32x4) -> f32x4 { simd_flog2(a) }
#[no_mangle]
pub unsafe fn g_flog(a: f64x4) -> f64x4 { simd_flog(a) }
#[no_mangle]
pub unsafe fn g_floor(a: f32x4) -> f32x4 { simd_floor(a) }
#[no_mangle]
pub unsafe fn g_fma(a: f32x4, b: f32x4, c: f32x4) -> f32x4 { simd_fma(a, b, c) }
#[no_mangle]
pub unsafe fn g_relaxed_fma(a: f64x4, b: f64x4, c: f64x4) -> f64x4 { simd_relaxed_fma(a, b, c) }
#[no_mangle]
pub unsafe fn g_fsin(a: f32x4) -> f32x4 { simd_fsin(a) }
#[no_mangle]
pub unsafe fn g_fsqrt(a: f32x4) -> f32x4 { simd_fsqrt(a) }
#[no_mangle]
pub unsafe fn g_round(a: f32x4) -> f32x4 { simd_round(a) }
#[no_mangle]
pub unsafe fn g_round_ties_even(a: f32x4) -> f32x4 { simd_round_ties_even(a) }
#[no_mangle]
pub unsafe fn g_trunc(a: f64x4) -> f64x4 { simd_trunc(a) }
#[no_mangle]
pub unsafe fn g_reduce_add_ordered_i32(a: i32x4, acc: i32) -> i32 { simd_reduce_add_ordered(a, acc) }
#[no_mangle]
pub unsafe fn g_reduce_mul_ordered_u64(a: u64x4, acc: u64) -> u64 { simd_reduce_mul_ordered(a, acc) }
#[no_mangle]
pub unsafe fn g_reduce_add_unordered_u32(a: u32x4) -> u32 { simd_reduce_add_unordered(a) }
#[no_mangle]
pub unsafe fn g_reduce_mul_unordered_i16(a: i16x4) -> i16 { simd_reduce_mul_unordered(a) }
#[no_mangle]
pub unsafe fn g_cast_ptr(a: cptrx4) -> mptrx4 { simd_cast_ptr(a) }
#[no_mangle]
pub unsafe fn g_expose_provenance(a: cptrx4) -> usizex4 { simd_expose_provenance(a) }
#[no_mangle]
pub unsafe fn g_with_exposed_provenance(a: usizex4) -> mptrx4 { simd_with_exposed_provenance(a) }
#[no_mangle]
pub unsafe fn g_cast_same(a: i32x4) -> m32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_identity(a: i32x4) -> i32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_trunc(a: i64x4) -> i16x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_sext(a: i8x4) -> i32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_zext(a: u8x4) -> i64x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_isize(a: isizex4) -> i64x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_sitofp(a: i32x4) -> f64x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_uitofp(a: u16x4) -> f32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_fptoui(a: f32x4) -> u8x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_fptosi(a: f64x4) -> i32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_fptrunc(a: f64x4) -> f32x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_cast_fpext(a: f32x4) -> f64x4 { simd_cast(a) }
#[no_mangle]
pub unsafe fn g_as_fptosi(a: f32x4) -> i32x4 { simd_as(a) }
#[no_mangle]
pub unsafe fn g_as_fptoui(a: f64x4) -> u16x4 { simd_as(a) }
#[no_mangle]
pub unsafe fn g_as_sitofp(a: i64x4) -> f32x4 { simd_as(a) }
#[no_mangle]
pub unsafe fn g_bswap_u8(a: u8x4) -> u8x4 { simd_bswap(a) }
#[no_mangle]
pub unsafe fn g_bswap_u32(a: u32x4) -> u32x4 { simd_bswap(a) }
#[no_mangle]
pub unsafe fn g_bitreverse(a: i16x4) -> i16x4 { simd_bitreverse(a) }
#[no_mangle]
pub unsafe fn g_ctlz(a: u32x4) -> u32x4 { simd_ctlz(a) }
#[no_mangle]
pub unsafe fn g_ctpop(a: i64x4) -> i64x4 { simd_ctpop(a) }
#[no_mangle]
pub unsafe fn g_cttz(a: u8x4) -> u8x4 { simd_cttz(a) }
#[no_mangle]
pub unsafe fn g_carryless_mul(a: u64x4, b: u64x4) -> u64x4 { simd_carryless_mul(a, b) }
#[no_mangle]
pub unsafe fn g_funnel_shl(a: u32x4, b: u32x4, c: u32x4) -> u32x4 { simd_funnel_shl(a, b, c) }
#[no_mangle]
pub unsafe fn g_funnel_shr(a: i8x4, b: i8x4, c: i8x4) -> i8x4 { simd_funnel_shr(a, b, c) }
#[no_mangle]
pub unsafe fn g_arith_offset(a: cptrx4, o: isizex4) -> cptrx4 { simd_arith_offset(a, o) }
#[no_mangle]
pub unsafe fn g_arith_offset_u(a: mptrx4, o: usizex4) -> mptrx4 { simd_arith_offset(a, o) }
#[no_mangle]
pub unsafe fn g_saturating_add_i32(a: i32x4, b: i32x4) -> i32x4 { simd_saturating_add(a, b) }
#[no_mangle]
pub unsafe fn g_saturating_add_u8(a: u8x4, b: u8x4) -> u8x4 { simd_saturating_add(a, b) }
#[no_mangle]
pub unsafe fn g_saturating_sub_i16(a: i16x4, b: i16x4) -> i16x4 { simd_saturating_sub(a, b) }
#[no_mangle]
pub unsafe fn g_saturating_sub_u64(a: u64x4, b: u64x4) -> u64x4 { simd_saturating_sub(a, b) }
