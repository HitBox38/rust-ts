#![feature(no_core, lang_items)]
#![allow(internal_features, unused)]
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

pub trait Tr<'a> {}

pub fn f() -> impl Sized + use<'static> {}
