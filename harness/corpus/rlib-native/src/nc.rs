// A `#![no_core]` lib crate with the sizedness lang items and one fn (harness/suites.ts `rlib-native`); the native libraries come
// from `-l` on the command line.
#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}

#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}

#[lang = "sized"]
pub trait Sized: MetaSized {}

pub fn f() {}
