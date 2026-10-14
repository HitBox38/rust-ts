#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
pub trait Tr { type A; }
pub struct S<'a, T: Tr>(&'a T) where T: 'a;
pub type Al = u8;
pub fn f<'a, 'b: 'a, T>(x: &'a T) where T: Tr {}
