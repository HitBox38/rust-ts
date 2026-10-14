#![feature(no_core, lang_items, marker_trait_attr)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

#[marker]
pub trait M {
    const C: u8;
    fn f();
}
