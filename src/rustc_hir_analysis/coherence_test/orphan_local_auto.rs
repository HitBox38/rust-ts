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

pub auto trait LocalAuto {}
pub trait Tr {}
pub struct Local;
pub struct LocalG<T>(T);

// E0321: generic `?Sized` type (the only impl: it would overlap any other)
impl<T: ?Sized> LocalAuto for T {}
