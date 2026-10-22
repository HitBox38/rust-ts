#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// An associated function called as a method: `suggest_static_method_candidates` (via `note_candidates_on_method_error`).
pub struct S;
impl S { pub fn make() -> S { S } pub fn take(_s: &S) {} }
pub fn f(s: S) { s.make(); s.take(); }
