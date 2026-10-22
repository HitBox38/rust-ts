#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A private method: E0624 (`MethodError::PrivateMatch`).
mod m {
    pub struct S;
    impl S { fn hidden(&self) {} }
}
pub fn f(s: m::S) { s.hidden(); }
