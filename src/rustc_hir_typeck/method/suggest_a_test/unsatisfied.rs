#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A method whose impl has an unsatisfied bound: `handle_unsatisfied_predicates` (the impl note with
// "unsatisfied trait bound introduced here", the "doesn't satisfy" labels of
// `suggest_method_not_found_because_of_unsatisfied_bounds`, the "trait bounds were not satisfied" primary message).
pub trait Tr {}
pub struct S;
pub struct W<T>(T);
impl<T: Tr> W<T> { pub fn m(&self) {} }
pub fn f(w: W<S>) { w.m(); }
