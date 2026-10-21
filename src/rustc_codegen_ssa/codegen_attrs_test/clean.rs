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

#[cold]
#[inline(never)]
#[track_caller]
pub fn a() {}

#[unsafe(no_mangle)]
pub extern "C" fn b() {}

#[unsafe(export_name = "cc")]
pub fn c() {}

#[target_feature(enable = "avx2")]
pub fn d() {}
