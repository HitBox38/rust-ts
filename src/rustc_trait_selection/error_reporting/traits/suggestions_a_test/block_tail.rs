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
impl A for S {}
pub fn g() { let x = { S; }; need(x); }
pub fn h() { let x = {}; need(x); }
pub fn k() { let x = { let _y = 1u8; }; need(x); }
