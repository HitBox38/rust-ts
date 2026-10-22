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
#[lang = "sync"]
pub unsafe trait Sync {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

pub struct S;
pub static X: S = S;
