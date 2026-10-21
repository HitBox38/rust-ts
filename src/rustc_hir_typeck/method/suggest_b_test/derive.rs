#![feature(lang_items, no_core, rustc_attrs)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
#[rustc_diagnostic_item = "PartialEq"] pub trait PartialEq {}
#[rustc_diagnostic_item = "Eq"] pub trait Eq: PartialEq {}
#[rustc_diagnostic_item = "PartialOrd"] pub trait PartialOrd: PartialEq {}
#[rustc_diagnostic_item = "Ord"] pub trait Ord: Eq + PartialOrd {}
#[rustc_diagnostic_item = "Debug"] pub trait Debug {}
#[rustc_diagnostic_item = "Hash"] pub trait Hash {}
pub trait Custom {}
pub struct W<T>(T);
impl<T: Ord + Debug> W<T> { pub fn m(&self) {} }
impl<T: Hash + Custom> W<T> { pub fn n(&self) {} }
pub struct Zs;
pub struct As;
pub fn f(w: W<Zs>, v: W<As>) { w.m(); v.n(); }
