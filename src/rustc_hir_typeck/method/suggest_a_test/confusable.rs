#![feature(no_core, lang_items, rustc_attrs)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
// `#[rustc_confusables]`: `confusable_method_name` / `suggest_confusable_or_similarly_named_method`.
pub struct V;
impl V {
    #[rustc_confusables("append", "add")]
    pub fn push(&self, _x: u8) {}
}
pub fn f(v: V) { v.append(1u8); v.add(); }
