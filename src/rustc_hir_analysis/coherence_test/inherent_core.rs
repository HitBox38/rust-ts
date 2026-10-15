#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features, dead_code)]
#![no_core]
#![crate_type = "lib"]
#![rustc_coherence_is_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

impl u8 {}
impl<T> [T] {}
impl str {}
impl u16 {}
impl<T: ?Sized> *const T {}
impl<T: ?Sized> *mut T {}
impl u8 {
    pub fn second() {}
}
impl<T, const N: usize> [T; N] {}
impl<T> [T] {
    pub fn second() {}
}
impl bool {}
impl () {}
impl<T: ?Sized> &T {}
impl<T: ?Sized> &mut T {}
impl (u8, u16) {}
impl ! {}
