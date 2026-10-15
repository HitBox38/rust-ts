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

pub struct NotCopy;
pub struct S(NotCopy);
pub enum E {}

// E0204: the field does not implement `Copy`
impl Copy for S {}
// E0206: not an ADT
impl Copy for &'static mut E {}
