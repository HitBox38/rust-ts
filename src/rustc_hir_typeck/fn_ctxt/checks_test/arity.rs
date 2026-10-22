#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for u32 {}
impl Copy for bool {}

pub fn two(a: u32, b: bool) {}
pub fn three(a: u32, b: bool, c: u32) {}
pub struct S(u32, bool);

pub fn missing() { two(1); }
pub fn extra() { two(1, true, 3); }
pub fn none() { three(); }
pub fn swap() { two(true, 1); }
pub fn ctor() { let _ = S(1); }
pub fn extra2() {
    two(1, true, 2, 3);
}
