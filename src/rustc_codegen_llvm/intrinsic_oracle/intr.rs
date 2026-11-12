// The oracle crate of intrinsic.test.ts (lane cg-intrinsic-a): one `#[no_mangle]` function per sampled intrinsic, over a
// minimal `#![no_core]` (the lang items of tests/auxiliary/minicore.rs these signatures need).
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits, link_llvm_intrinsics)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "destruct"]
pub trait Destruct: PointeeSized {}
#[lang = "copy"]
pub trait Copy: Sized {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
impl Copy for u8 {}
impl Copy for u16 {}
impl Copy for u32 {}
impl Copy for u64 {}
impl Copy for i16 {}
impl Copy for i32 {}
impl Copy for usize {}
impl Copy for f32 {}
impl Copy for f64 {}
impl Copy for bool {}

#[rustc_intrinsic]
pub const fn ctpop<T: Copy>(x: T) -> u32;
#[rustc_intrinsic]
pub const fn ctlz<T: Copy>(x: T) -> u32;
#[rustc_intrinsic]
pub const unsafe fn cttz_nonzero<T: Copy>(x: T) -> u32;
#[rustc_intrinsic]
pub const fn bswap<T: Copy>(x: T) -> T;
#[rustc_intrinsic]
pub fn sqrtf64(x: f64) -> f64;
#[rustc_intrinsic]
pub const fn fmaf32(a: f32, b: f32, c: f32) -> f32;
#[rustc_intrinsic]
pub fn powif32(a: f32, x: i32) -> f32;
#[rustc_intrinsic]
pub const fn saturating_add<T: Copy>(a: T, b: T) -> T;
#[rustc_intrinsic]
pub const unsafe fn volatile_load<T>(src: *const T) -> T;
#[rustc_intrinsic]
pub fn ptr_mask<T>(ptr: *const T, mask: usize) -> *const T;
#[rustc_intrinsic]
pub const unsafe fn compare_bytes(left: *const u8, right: *const u8, bytes: usize) -> i32;
#[rustc_intrinsic]
pub unsafe fn catch_unwind<Data>(try_fn: unsafe fn(*mut Data), data: *mut Data, catch_fn: unsafe fn(*mut Data, *mut u8)) -> bool;
#[rustc_intrinsic]
pub const fn add_with_overflow<T: Copy>(x: T, y: T) -> (T, bool);
#[rustc_intrinsic]
pub const fn black_box<T>(dummy: T) -> T;
#[rustc_intrinsic]
pub const unsafe fn assume(b: bool);
#[rustc_intrinsic]
pub fn abort_immediate() -> !;

#[no_mangle]
pub fn f_ctpop(x: u32) -> u32 { ctpop(x) }
#[no_mangle]
pub fn f_ctlz(x: u64) -> u32 { ctlz(x) }
#[no_mangle]
pub fn f_cttz_nz(x: u16) -> u32 { unsafe { cttz_nonzero(x) } }
#[no_mangle]
pub fn f_bswap(x: u32) -> u32 { bswap(x) }
#[no_mangle]
pub fn f_bswap8(x: u8) -> u8 { bswap(x) }
#[no_mangle]
pub fn f_sqrt(x: f64) -> f64 { sqrtf64(x) }
#[no_mangle]
pub fn f_fma(a: f32, b: f32, c: f32) -> f32 { fmaf32(a, b, c) }
#[no_mangle]
pub fn f_powi(x: f32, n: i32) -> f32 { powif32(x, n) }
#[no_mangle]
pub fn f_sat(a: i16, b: i16) -> i16 { saturating_add(a, b) }
#[no_mangle]
pub fn f_vload(p: *const u32) -> u32 { unsafe { volatile_load(p) } }
#[no_mangle]
pub fn f_vload_pair(p: *const (u32, u64)) -> (u32, u64) { unsafe { volatile_load(p) } }
#[no_mangle]
pub fn f_ptrmask(p: *const u8, m: usize) -> *const u8 { ptr_mask(p, m) }
#[no_mangle]
pub fn f_cmpb(a: *const u8, b: *const u8, n: usize) -> i32 { unsafe { compare_bytes(a, b, n) } }
#[no_mangle]
pub fn f_try(f: unsafe fn(*mut u8), d: *mut u8, c: unsafe fn(*mut u8, *mut u8)) -> bool { unsafe { catch_unwind(f, d, c) } }
#[no_mangle]
pub fn f_addo(a: i32, b: i32) -> (i32, bool) { add_with_overflow(a, b) }
#[no_mangle]
pub fn f_bb(x: u32) -> u32 { black_box(x) }
#[no_mangle]
pub fn f_assume(x: bool) { unsafe { assume(x) } }
#[no_mangle]
pub fn f_abort() -> ! { abort_immediate() }

extern "C" {
    #[link_name = "llvm.debugtrap"]
    fn llvm_debugtrap();
    #[link_name = "llvm.ctpop.i64"]
    fn llvm_ctpop_i64(x: u64) -> u64;
}
#[no_mangle]
pub fn f_llvm_debugtrap() { unsafe { llvm_debugtrap() } }
#[no_mangle]
pub fn f_llvm_ctpop(x: u64) -> u64 { unsafe { llvm_ctpop_i64(x) } }
