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

pub trait A {}
pub struct S;
pub fn need<T: A>(_t: T) {}
impl A for fn() -> S {}
pub fn foo() -> S { S }
pub fn g() { need(foo); }
pub fn h() { need(&foo); }
