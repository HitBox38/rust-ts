// Correctly declared intrinsics (lane check-region-intrinsic): the oracle accepts this crate, so for each intrinsic
// the signature `check_intrinsic_type` computes must equal the declared one.
#![feature(no_core, lang_items, intrinsics, rustc_attrs, f16, f128)]
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
pub fn size_of<T>() -> usize;
#[rustc_intrinsic]
pub fn align_of<T>() -> usize;
#[rustc_intrinsic]
pub unsafe fn size_of_val<T: ?Sized>(ptr: *const T) -> usize;
#[rustc_intrinsic]
pub fn abort_immediate() -> !;
#[rustc_intrinsic]
pub unsafe fn unreachable() -> !;
#[rustc_intrinsic]
pub fn breakpoint();
#[rustc_intrinsic]
pub fn forget<T>(_: T);
#[rustc_intrinsic]
pub unsafe fn transmute<Src, Dst>(src: Src) -> Dst;
#[rustc_intrinsic]
pub fn needs_drop<T: ?Sized>() -> bool;
#[rustc_intrinsic]
pub fn add_with_overflow<T: Copy>(x: T, y: T) -> (T, bool);
#[rustc_intrinsic]
pub fn ctpop<T: Copy>(x: T) -> u32;
#[rustc_intrinsic]
pub fn rotate_left<T: Copy>(x: T, shift: u32) -> T;
#[rustc_intrinsic]
pub fn sqrtf32(x: f32) -> f32;
#[rustc_intrinsic]
pub fn powif64(a: f64, x: i32) -> f64;
#[rustc_intrinsic]
pub fn fmaf16(a: f16, b: f16, c: f16) -> f16;
#[rustc_intrinsic]
pub fn maximumf128(x: f128, y: f128) -> f128;
#[rustc_intrinsic]
pub unsafe fn copy_nonoverlapping<T>(src: *const T, dst: *mut T, count: usize);
#[rustc_intrinsic]
pub unsafe fn write_bytes<T>(dst: *mut T, val: u8, count: usize);
#[rustc_intrinsic]
pub unsafe fn compare_bytes(left: *const u8, right: *const u8, bytes: usize) -> i32;
#[rustc_intrinsic]
pub unsafe fn volatile_load<T>(src: *const T) -> T;
#[rustc_intrinsic]
pub unsafe fn unchecked_shl<T: Copy, U: Copy>(x: T, y: U) -> T;
#[rustc_intrinsic]
pub fn carrying_mul_add<T: Copy, U>(multiplier: T, multiplicand: T, addend: T, carry: T) -> (U, T);
#[rustc_intrinsic]
pub unsafe fn typed_swap_nonoverlapping<T>(x: *mut T, y: *mut T);
#[rustc_intrinsic]
pub fn select_unpredictable<T>(b: bool, true_val: T, false_val: T) -> T;
#[rustc_intrinsic]
pub fn ub_checks() -> bool;
#[rustc_intrinsic]
pub fn const_eval_select<A, F, G, R>(arg: A, called_in_const: F, called_at_rt: G) -> R;
#[rustc_intrinsic]
pub unsafe fn simd_add<T>(x: T, y: T) -> T;
#[rustc_intrinsic]
pub unsafe fn simd_shuffle<T, U, V>(x: T, y: T, idx: U) -> V;
#[rustc_intrinsic]
pub unsafe fn atomic_load<T: Copy, const ORD: u8, const VOLATILE: bool>(src: *const T) -> T;
#[rustc_intrinsic]
pub unsafe fn atomic_xadd<T: Copy, U: Copy, const ORD: u8>(dst: *mut T, src: U) -> T;
#[rustc_intrinsic]
pub unsafe fn atomic_fence<const ORD: u8>();
#[rustc_intrinsic]
pub fn return_address() -> *const ();
#[rustc_intrinsic]
pub unsafe fn vtable_size(ptr: *const ()) -> usize;
#[rustc_intrinsic]
pub unsafe fn ptr_offset_from<T>(ptr: *const T, base: *const T) -> isize;
#[rustc_intrinsic]
pub const unsafe fn const_allocate(size: usize, align: usize) -> *mut u8;
#[rustc_intrinsic]
pub unsafe fn raw_eq<T>(a: &T, b: &T) -> bool;
