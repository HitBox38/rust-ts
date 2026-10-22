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
#[lang = "copy"]
pub trait Copy {}

pub trait A {}
pub struct S;
pub fn need<T: A>(_t: T) {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &T {}
#[lang = "eq"]
pub trait PartialEq<Rhs: PointeeSized = Self>: PointeeSized { fn eq(&self, other: &Rhs) -> bool; }
impl PartialEq for S { fn eq(&self, _o: &S) -> bool { true } }
pub fn g(a: &S, b: S) -> bool { a == b }
pub fn h(a: S, b: &&S) -> bool { a == b }
pub fn k(a: &&S, b: &S) -> bool { a == b }
