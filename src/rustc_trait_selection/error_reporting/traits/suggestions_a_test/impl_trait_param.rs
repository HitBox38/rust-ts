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
pub trait Tr { type X; }
pub fn need_assoc<T: Tr>(_t: T) where T::X: A {}
pub fn f(t: impl Tr) { need_assoc(t) }
pub fn f2<U: Tr>(t: U) { need_assoc(t) }
