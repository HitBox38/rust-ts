#![feature(no_core, lang_items, arbitrary_self_types, arbitrary_self_types_pointers)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

#[lang = "owned_box"]
pub struct Box<T: ?Sized>(*const T);

pub struct S;

pub fn ms_refs(_x: &&S, _y: &Box<&S>) {}
pub fn ms_raw<const N: usize>(_x: &*const &S, _y: *mut [S; N]) {}
pub fn ms_array<const N: usize>(_x: &[S; N]) {}
