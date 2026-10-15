// coherence_test (lane trait-sel-traits-c): `specializes` with specialization enabled: a negative impl never
// specializes a positive one (and back), which `specializes` decides before the trait solver.
#![feature(no_core, lang_items, min_specialization, negative_impls)]
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
pub struct B;
pub struct C<T>(T);

pub trait Tr {}
impl !Tr for A {}
impl Tr for B {}
impl<T> !Tr for C<T> {}
