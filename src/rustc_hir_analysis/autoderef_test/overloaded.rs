#![feature(no_core, lang_items)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

#[lang = "deref"]
pub trait Deref {
    #[lang = "deref_target"]
    type Target: ?Sized;
}

pub struct S;
pub struct W;
impl Deref for W {
    type Target = S;
}

pub fn ad_overloaded(_x: &W) {}
