// A `#![no_core]` lib crate that names `libfoo.a` in a `#[link]` attribute (harness/suites.ts `rlib-native`).
#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}

#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}

#[lang = "sized"]
pub trait Sized: MetaSized {}

#[link(name = "foo", kind = "static")]
extern "C" {
    pub fn bar_fn() -> i32;
}

pub fn f() {}
