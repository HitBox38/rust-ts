//@ edition: 2021
// Lang items defined in this crate, so `should_codegen_locally` holds for them, unlike std's reachable ones:
// `panic_nounwind` through a validity intrinsic, `panic_cannot_unwind` through `UnwindAction::Terminate`.
#![crate_type = "lib"]
#![feature(no_core, lang_items, rustc_attrs, intrinsics, auto_traits, c_unwind)]
#![allow(internal_features, stable_features, unused_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for u8 {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: ?Sized> LegacyReceiver for &T {}
#[rustc_intrinsic] pub const fn assert_inhabited<T>();
#[lang = "panic_nounwind"] fn panic_nounwind(_: &'static str) -> ! { loop {} }
#[lang = "panic_cannot_unwind"] fn panic_cannot_unwind() -> ! { loop {} }
#[lang = "panic_in_cleanup"] fn panic_in_cleanup() -> ! { loop {} }
#[inline(never)] fn may_unwind() { may_unwind() }
#[no_mangle] pub fn validity() { assert_inhabited::<u8>() }
#[no_mangle] pub extern "C" fn no_unwind() { may_unwind() }
