#![feature(no_core, lang_items, supertrait_item_shadowing)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]
#![warn(shadowing_supertrait_items)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub trait A {
    fn f();
    const C: u8;
    type T;
}
pub trait B {
    fn f();
    fn g();
}
pub trait Sub: A {
    fn f();
    const C: u8;
    type T;
    fn h();
}
pub trait Both: A + B {
    fn f();
    fn g();
}
pub trait Deep: Sub {
    fn h();
}
#[allow(shadowing_supertrait_items)]
pub trait Quiet: A {
    fn f();
}
pub struct P<const B: bool, const C: char, const N: u8, const I: i64, const U: usize>;
