// A negative `Drop` impl (lane check-region-intrinsic): `check_drop_impl` reports it before anything else.
#![feature(no_core, lang_items, negative_impls)]
#![no_core]
#![allow(internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}

pub struct N;
impl !Drop for N {}
