#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A method of a shadowed binding: `suggest_use_shadowed_binding_with_method` (the `LetVisitor`).
pub struct A;
impl A { pub fn only_a(&self) {} }
pub struct B;
pub fn f() {
    let x = A;
    let x = B;
    x.only_a();
}
