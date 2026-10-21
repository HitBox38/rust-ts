// FieldSized: the struct-field notes, help and the two borrow / `Box` suggestions.
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

pub struct T2 {
    pub a: [u8],
    pub b: u8,
}
pub enum E {
    V([u8], u8),
}
