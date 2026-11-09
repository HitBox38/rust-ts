// A `#![no_core]` lib crate with a `#[link(.., cfg(..))]` library (packed) and a plain one (harness/suites.ts `rlib-native`).
#![feature(no_core, lang_items, link_cfg)]
#![allow(internal_features)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}

#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}

#[lang = "sized"]
pub trait Sized: MetaSized {}

#[link(name = "foo", kind = "static", cfg(target_os = "macos"))]
extern "C" {}

#[link(name = "baz", kind = "static")]
extern "C" {}

pub fn f() {}
