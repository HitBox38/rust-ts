#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct A;

// E0390
impl u8 {}
// E0390 with a note (reference)
impl<'a> &'a A {}
// E0118
impl<T> T {}
// E0592 (within one impl)
impl A {
    fn f() {}
    fn f() {}
}
// E0390 (tuple)
impl (A, A) {}
