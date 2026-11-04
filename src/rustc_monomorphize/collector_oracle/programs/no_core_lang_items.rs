//@ edition: 2021
// Lang items defined in this crate, so `should_codegen_locally` holds for them, unlike std's reachable ones:
// `panic_nounwind` through a validity intrinsic, `panic_cannot_unwind` through `UnwindAction::Terminate`.
// `#[inline]` keeps them out of `reachable_non_generics`, so only those uses collect them.
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
#[inline] #[lang = "panic_nounwind"] fn panic_nounwind(_: &'static str) -> ! { loop {} }
#[inline] #[lang = "panic_cannot_unwind"] fn panic_cannot_unwind() -> ! { loop {} }
#[inline] #[lang = "panic_in_cleanup"] fn panic_in_cleanup() -> ! { loop {} }
#[inline(never)] fn may_unwind() { may_unwind() }
#[inline(never)] fn validity_gen<T>() { assert_inhabited::<T>() } // generic: `InstSimplify` cannot remove the assertion
#[no_mangle] pub fn validity() { validity_gen::<u8>() }
#[no_mangle] pub extern "C" fn no_unwind() { may_unwind() }
