#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// A path to a missing variant: `suggest_enum_variant_for_method_call` (unit, tuple and struct variants).
pub enum E { Alpha, Beta(u8, u8), Gamma { x: u8 } }
pub fn f() {
    let _ = E::Alph;
    let _ = E::Bet(1u8);
    let _ = E::Gama;
}
