#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// Two traits with the same method: E0034 (`MethodError::Ambiguity`).
pub trait T1 { fn go(&self); }
pub trait T2 { fn go(&self); }
pub struct S;
impl T1 for S { fn go(&self) {} }
impl T2 for S { fn go(&self) {} }
pub fn f(s: S) { s.go(); }
