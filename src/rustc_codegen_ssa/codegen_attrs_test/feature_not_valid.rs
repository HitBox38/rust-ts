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

#[target_feature(enable = "sse5")]
pub unsafe fn a() {}

#[target_feature(enable = "+sse2")]
pub unsafe fn b() {}

#[target_feature(enable = "neon")]
pub unsafe fn c() {}

#[target_feature(enable = "zbb")]
pub unsafe fn d() {}
