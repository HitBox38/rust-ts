#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A method that exists on an earlier receiver of the chain: `lookup_segments_chain_for_no_match_method`.
pub struct A;
pub struct B;
impl A { pub fn to_b(&self) -> B { B } pub fn here(&self) {} }
pub fn f(a: A) { a.to_b().here(); }
