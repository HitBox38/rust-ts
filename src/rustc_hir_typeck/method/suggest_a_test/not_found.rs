#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// E0599 on a local struct: `create_no_assoc_err`, `set_not_found_span_label`, the "not found for this struct" label.
pub struct S;
impl S { pub fn foo(&self) {} }
pub fn f(s: S) { s.bar(); }
