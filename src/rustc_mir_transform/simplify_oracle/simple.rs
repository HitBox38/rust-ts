// Fixture of simplify.test.ts (lane mt-skeleton): a no_core crate whose `SimplifyCfg-initial` dumps the oracle writes
// with `-Zdump-mir=SimplifyCfg-initial` (see the test's header).
#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for i32 {}
impl Copy for bool {}
pub fn f(c: bool, x: i32) -> i32 { if c { x } else { 0 } }
pub fn g(x: i32) -> i32 { let _a = { return x; }; }
pub fn h(c: bool, x: i32) -> i32 { loop { if c { break x; } } }
