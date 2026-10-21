#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
pub struct S<T>(T);
pub trait Tr<'a> {
    type A: 'a;
}
impl<T> Tr<'_> for S<T> {
    type A = T;
}
