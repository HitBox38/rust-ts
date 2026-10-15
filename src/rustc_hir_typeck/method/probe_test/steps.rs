#![feature(no_core, lang_items)]
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
pub struct G<T>(T);

pub fn ms_plain(_x: S) {}
pub fn ms_refs(_x: &&S, _y: &'static mut &mut S) {}
pub fn ms_box(_x: &Box<&S>, _y: Box<Box<S>>) {}
pub fn ms_raw(_x: &*const &S, _y: *mut *const S) {}
pub fn ms_array<const N: usize, const M: usize>(_x: &[S; N], _y: *const [&S; M], _z: [G<S>; N]) {}
pub fn ms_slice(_x: &[&S], _y: &str) {}
pub fn ms_generic<T, const N: usize>(_x: &T, _y: G<&T>, _z: &[T; N]) {}
