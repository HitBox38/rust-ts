// The cross-target oracle crate of va_arg.test.ts (lane cg-intrinsic-b): the `va_arg` intrinsic, which lowers to `emit_va_arg`
// (va_arg.rs:1053), for each kind of `VaArgSafe` argument, over a minimal `#![no_core]` (the lang items and `VaList` of
// tests/auxiliary/minicore.rs), so it builds for targets the pinned toolchain has no std for. Compiled for one target per
// target-specific body of va_arg.rs: aapcs (aarch64-unknown-linux-gnu), powerpc, s390x, hexagon musl and bare metal,
// and the host (aarch64-apple-darwin, `emit_ptr_va_arg`).
#![feature(no_core, lang_items, intrinsics, rustc_attrs, auto_traits)]
#![allow(internal_features, non_camel_case_types, dead_code)]
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
#[lang = "unsafe_unpin"]
pub unsafe auto trait UnsafeUnpin {}
#[lang = "unpin"]
pub auto trait Unpin {}
#[lang = "phantom_data"]
pub struct PhantomData<T: PointeeSized>;
impl Copy for i32 {}
impl Copy for u32 {}
impl Copy for i64 {}
impl Copy for u64 {}
impl Copy for f64 {}
impl Copy for usize {}
impl<T: PointeeSized> Copy for *const T {}

pub enum c_void {}

#[repr(transparent)]
#[lang = "va_list"]
pub struct VaList<'a> {
    inner: VaListInner,
    _marker: PhantomData<&'a ()>,
}

#[cfg(all(target_arch = "aarch64", not(target_vendor = "apple")))]
#[repr(C)]
struct VaListInner {
    stack: *const c_void,
    gr_top: *const c_void,
    vr_top: *const c_void,
    gr_offs: i32,
    vr_offs: i32,
}
#[cfg(target_arch = "powerpc")]
#[repr(C)]
struct VaListInner {
    gpr: u8,
    fpr: u8,
    reserved: u16,
    overflow_arg_area: *const c_void,
    reg_save_area: *const c_void,
}
#[cfg(target_arch = "s390x")]
#[repr(C)]
struct VaListInner {
    gpr: i64,
    fpr: i64,
    overflow_arg_area: *const c_void,
    reg_save_area: *const c_void,
}
#[cfg(all(target_arch = "hexagon", target_env = "musl"))]
#[repr(C)]
struct VaListInner {
    __current_saved_reg_area_pointer: *const c_void,
    __saved_reg_area_end_pointer: *const c_void,
    __overflow_area_pointer: *const c_void,
}
#[cfg(not(any(
    all(target_arch = "aarch64", not(target_vendor = "apple")),
    target_arch = "powerpc",
    target_arch = "s390x",
    all(target_arch = "hexagon", target_env = "musl")
)))]
#[repr(transparent)]
struct VaListInner {
    ptr: *const c_void,
}

#[rustc_intrinsic]
pub unsafe fn va_arg<T>(ap: &mut VaList<'_>) -> T;

#[no_mangle]
pub unsafe fn va_i32(ap: &mut VaList<'_>) -> i32 { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_u32(ap: &mut VaList<'_>) -> u32 { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_i64(ap: &mut VaList<'_>) -> i64 { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_u64(ap: &mut VaList<'_>) -> u64 { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_f64(ap: &mut VaList<'_>) -> f64 { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_ptr(ap: &mut VaList<'_>) -> *const c_void { va_arg(ap) }
#[no_mangle]
pub unsafe fn va_usize(ap: &mut VaList<'_>) -> usize { va_arg(ap) }
