#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}


#[rustc_std_internal_symbol]
#[no_mangle]
pub fn internal() {}
