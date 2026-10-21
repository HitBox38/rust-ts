#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A trait method whose impl has an unsatisfied bound: `handle_unsatisfied_predicates` through a trait impl.
pub trait Bound {}
pub trait Act { fn act(&self); }
pub struct W<T>(T);
pub struct X;
impl<T: Bound> Act for W<T> { fn act(&self) {} }
pub fn f(w: W<X>) { w.act(); }
