#![feature(no_core, lang_items, auto_traits)]
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

pub trait Foreign {}
pub trait Foreign1<T> {}
pub trait Foreign2<T, U> {}
pub unsafe auto trait ForeignAuto {}
