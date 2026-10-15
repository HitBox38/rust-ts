#![feature(no_core, lang_items, auto_traits)]
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

pub auto trait LocalAuto {}
pub trait Tr {}
pub struct Local;
pub struct LocalG<T>(T);

// ok: anything local goes (but a trait object or a `?Sized` parameter)
impl LocalAuto for Local {}
impl<T> LocalAuto for LocalG<T> {}
impl LocalAuto for (Local, u8) {}
impl<T> LocalAuto for [T] {}
impl LocalAuto for u8 {}
