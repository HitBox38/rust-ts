#![feature(no_core, lang_items)]
#![no_core]
#![allow(internal_features)]
#![crate_type = "lib"]
#![recursion_limit = "4"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S;

pub fn ms_deep<const N: usize>(_x: &&&&&&S, _y: &&&[S; N]) {}
pub fn ms_shallow(_x: &&&S) {}
