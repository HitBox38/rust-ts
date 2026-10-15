// coherence_test (lane trait-sel-traits-c): E0751, a positive and a negative impl of one trait for one type.
#![feature(no_core, lang_items, negative_impls)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct A;

pub trait Tr {}
impl Tr for A {}
impl !Tr for A {}
