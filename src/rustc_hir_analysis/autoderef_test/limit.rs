#![feature(no_core, lang_items)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]
#![recursion_limit = "2"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S;

pub fn ad_deep(_x: &&&&S) {}
pub fn ad_silent_deep(_x: &&&&S) {}
pub fn ad_shallow(_x: &&S) {}
