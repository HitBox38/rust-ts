#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl Copy for u32 {}
impl Copy for bool {}

pub fn same<T>(a: T, b: T, c: T) {}
pub fn pair<T, U>(a: T, b: U, c: T, _: U) {}
pub trait Tr { fn req(&self, x: u32, _: bool); fn prov(&self, y: u32) {} }
extern "C" { fn ext(p: u32, q: bool); fn var(p: u32, ...); }

pub fn g1() { same(1u32, 2u32); }
pub fn g2() { pair(1u32, true, 3u32); }
pub fn g3() { same(); }
pub fn perm() { pair(true, 1u32, false, 2u32, 9u32); }
pub fn reorder(a: u32, b: bool, c: (u32,)) {}
pub fn r() { reorder((1u32,), 2u32, false); }
pub fn ex() { unsafe { ext(1); } }
pub fn va() { unsafe { var(); } }
pub fn multi() {
    reorder(
        1u32,
        true,
    );
}
pub fn four(a: u32, b: u32, c: u32, d: u32) {}
pub fn many() { four(); }
pub fn two_missing() { four(1, 2); }
