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
pub trait Tr { fn m(&self) where Self: Sized { need(self); } }
pub trait Tr2: Copy { fn m2(self) where Self: Sized { need(self); } }
pub trait Tr3: Copy + Sized { fn m3(self) { need(self); } }
pub trait Tr4 { fn m4(self) where Self: Sized { need(self); } }
