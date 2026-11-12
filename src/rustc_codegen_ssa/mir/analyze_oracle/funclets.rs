// Fixture of mir/analyze.test.ts (lane ssa-mir-core): cleanup blocks for `cleanup_kinds`, built for
// x86_64-pc-windows-msvc (the target wants the new EH instructions, so `codegen_mir` computes the funclet tree).
#![feature(no_core, lang_items, auto_traits)]
#![allow(internal_features, unconditional_recursion)]
#![crate_type = "lib"]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for u32 {}
impl Copy for bool {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}

#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}

#[lang = "drop_glue"]
pub unsafe fn drop_glue<T: PointeeSized>(to_drop: *mut T) {
    unsafe { drop_glue(to_drop) }
}

#[lang = "panic_cannot_unwind"]
fn panic_cannot_unwind() -> ! {
    loop {}
}

#[lang = "panic_in_cleanup"]
fn panic_in_cleanup() -> ! {
    loop {}
}

unsafe extern "Rust" {
    fn may_unwind(x: u32);
}

pub struct D(pub u32);

impl Drop for D {
    fn drop(&mut self) {
        unsafe { may_unwind(self.0) }
    }
}

/// No cleanup at all.
#[no_mangle]
pub fn plain(a: u32) {
    unsafe { may_unwind(a) }
}

/// One value to drop when the call unwinds.
#[no_mangle]
pub fn one(a: u32) {
    let _d = D(a);
    unsafe { may_unwind(a) }
}

/// Two values: the drop of the first is reached both from the call's cleanup and from the second's drop unwinding.
#[no_mangle]
pub fn two(a: u32) {
    let _d1 = D(a);
    let _d2 = D(a);
    unsafe { may_unwind(a) }
}

/// Cleanup reached from two calls, on two paths.
#[no_mangle]
pub fn branchy(c: bool, a: u32) {
    let _d = D(a);
    if c {
        unsafe { may_unwind(a) }
    } else {
        unsafe { may_unwind(7) }
    }
}
