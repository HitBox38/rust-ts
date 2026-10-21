#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A method with a similar name: `find_likely_intended_associated_item` (same argument count -> suggestion,
// different count -> help on the definition).
pub struct S;
impl S {
    pub fn frobnicate(&self, _x: u8) {}
    pub fn reticulate(&self) {}
}
pub fn f(s: S) {
    s.frobnicat(1u8);
    s.reticulat(1u8, 2u8);
}
