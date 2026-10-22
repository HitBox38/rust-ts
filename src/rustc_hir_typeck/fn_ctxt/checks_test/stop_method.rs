#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for u32 {}
impl Copy for bool {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
pub struct S; impl S { pub fn m(&self, a: u32) {} }
pub fn m1(s: S) { s.m(); }
