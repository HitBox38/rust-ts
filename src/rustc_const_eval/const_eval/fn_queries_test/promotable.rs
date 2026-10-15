#![feature(no_core, lang_items, staged_api, rustc_attrs)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]
#![stable(feature = "promotable_test", since = "1.0.0")]

#[lang = "pointee_sized"]
#[stable(feature = "promotable_test", since = "1.0.0")]
pub trait PointeeSized {}
#[lang = "meta_sized"]
#[stable(feature = "promotable_test", since = "1.0.0")]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
#[stable(feature = "promotable_test", since = "1.0.0")]
pub trait Sized: MetaSized {}

#[stable(feature = "promotable_test", since = "1.0.0")]
#[rustc_const_stable(feature = "promotable_test", since = "1.0.0")]
#[rustc_promotable]
pub const fn promotable() {}

#[stable(feature = "promotable_test", since = "1.0.0")]
#[rustc_const_stable(feature = "promotable_test", since = "1.0.0")]
pub const fn stable_not_promotable() {}

#[stable(feature = "promotable_test", since = "1.0.0")]
#[rustc_const_unstable(feature = "promotable_unstable", issue = "none")]
pub const fn const_unstable() {}

#[stable(feature = "promotable_test", since = "1.0.0")]
pub fn not_const() {}
