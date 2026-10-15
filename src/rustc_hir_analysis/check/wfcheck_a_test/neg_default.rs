#![feature(no_core, lang_items, negative_impls, specialization)]
#![allow(internal_features, incomplete_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub trait Tr {}
pub trait Tr2 {}
pub struct S;
pub struct G<T>(T);
default impl !Tr for S {}
impl !Tr2 for S {}
default impl<T> !Tr for G<T> {}
