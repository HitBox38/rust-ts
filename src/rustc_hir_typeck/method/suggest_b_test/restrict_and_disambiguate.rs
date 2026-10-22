#![feature(lang_items, no_core, rustc_attrs, negative_impls)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "unpin"] pub auto trait Unpin {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
pub struct S;
pub struct G<X, Y = u8>(X, Y);
pub trait Zb<X> { fn bar(&self); }
pub trait Ab { fn bar(&self); }
pub trait Neg { fn bar(&self); }
impl !Neg for S {}
pub trait Neg2 { fn bar(&self); }
impl !Neg2 for S {}
pub fn f(s: S) { s.bar(); }
pub fn g<T>(t: T) { t.bar(); }
pub fn h<T: Ab + Zb<u8>>(t: &T) { t.bar(); }
pub fn i(x: impl Copy) { x.bar(); }
pub fn j<T: Copy>(x: &T) { x.bar(); }
pub trait Sup { fn m(&self) { self.bar(); } }
pub trait Sup2: Copy { fn m2(&self) { self.bar(); } }
pub trait Arb { fn ar(self: &Self, x: u8); fn ar2(this: &Self); }
pub fn k(s: S) { s.ar2(); }
