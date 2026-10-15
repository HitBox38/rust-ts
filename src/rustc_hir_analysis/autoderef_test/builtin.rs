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

pub fn ad_plain(_x: S) {}
pub fn ad_refs(_x: &&S) {}
pub fn ad_mut(_x: &mut &mut S, _y: &&mut S) {}
pub fn ad_box(_x: &Box<&S>) {}
pub fn ad_box_box(_x: Box<Box<S>>) {}
pub fn ad_noraw(_x: &*const &S) {}
pub fn ad_raw(_x: &*const &S, _y: *mut *const S) {}
pub fn ad_recv(_x: &Box<&S>) {}
pub fn ad_slice(_x: &[&S]) {}
