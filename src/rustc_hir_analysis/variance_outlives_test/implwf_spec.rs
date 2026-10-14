#![feature(no_core, lang_items, min_specialization)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub trait Tr {
    fn f();
}
impl<T> Tr for T {
    default fn f() {}
}
impl Tr for &'static () {
    fn f() {}
}
