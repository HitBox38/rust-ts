// coherence_test (lane trait-sel-traits-c): E0119, a blanket impl and a concrete impl of one trait overlap.
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

pub struct A;
pub struct B<T>(T);

pub trait Tr {}
impl<T> Tr for B<T> {}
impl Tr for B<A> {}
