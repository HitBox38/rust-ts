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

pub auto trait Au {}
pub trait Tr {}

// ok: the principal's inherent impls
impl dyn Tr {}
impl dyn Tr + Au {}
// E0785
impl dyn Au {}
