// Fixture of pretty.test.ts (lane mir-pretty): a no_core crate whose MIR the oracle prints with `-Zunpretty=mir`,
// `-Zunpretty=mir -Zmir-include-spans=on` and `-Zdump-mir=built` (see the test's header).
#![feature(no_core, lang_items, auto_traits)]
#![allow(internal_features, dead_code)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "sync"] pub unsafe trait Sync {}
#[lang = "freeze"] pub unsafe auto trait Freeze {}
unsafe impl Sync for i32 {}
unsafe impl Sync for u8 {}
unsafe impl Sync for str {}
unsafe impl<T: Sync, const N: usize> Sync for [T; N] {}
unsafe impl<T: ?Sized + Sync> Sync for &T {}
impl Copy for i32 {}
pub fn f(x: i32) -> i32 { let y = x; y }
pub static S: &str = "hello";
pub static P: &i32 = &5;
pub static L: &[u8; 20] = b"0123456789abcdefghij";
pub const C: i32 = 7;
pub fn g() -> &'static str { "hi" }
