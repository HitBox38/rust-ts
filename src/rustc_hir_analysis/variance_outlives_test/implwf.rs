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
#[lang = "copy"]
pub trait Copy {}

pub struct S;
pub struct G<T>(T);
pub struct G2<T, U>(T, U);
pub struct L<'a>(&'a ());
pub trait Tr {
    type A;
}
pub trait Tr2 {
    type A;
}
pub trait Tr3 {
    type A;
}

impl<T> S {}
impl<T, const N: usize> G<T> {}
impl<'a> Tr for S {
    type A = &'a ();
}
impl<'a> Tr for G<()> {
    type A = ();
}
impl<T> Tr for L<'_> {
    type A = ();
}
impl<'a> Tr2 for L<'_> {
    type A = &'a ();
}
impl<T, U> G2<T, ()> {
    pub fn f(_x: U) {}
}
impl<'b, T> Tr3 for G<T> {
    type A = &'b ();
}
impl<T> G<T> {}
