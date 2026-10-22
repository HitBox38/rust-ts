#![feature(lang_items, no_core, rustc_attrs)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "unpin"] pub trait Unpin {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
pub struct S;
pub trait Zb { fn bar(&self); }
pub trait Ab { fn bar(&self); }
pub trait One { fn qux(&self); }
pub fn f(s: S) { s.bar(); s.qux(); }
pub fn g<T>(t: T) { t.bar(); }
pub fn h<T: One>(t: &T) { t.bar(); }
pub trait Sup { fn m(&self) { self.bar(); } }
