#![feature(no_core, lang_items, )]
#![allow(internal_features, incomplete_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct R<const P: *const u8>;
