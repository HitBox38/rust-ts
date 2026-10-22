// Fixture of pretty.test.ts (lane mir-pretty): allocations with provenance (one line, two lines, a pointer across the
// line end in both layouts) and uninit bytes, printed by the oracle with `-Zunpretty=mir -Zmir-opt-level=2`.
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
unsafe impl<T: ?Sized + Sync> Sync for &T {}
unsafe impl<T: Sync, const N: usize> Sync for [T; N] {}
impl Copy for i32 {}
pub static S: i32 = 5;
pub static Q: &i32 = &S;
pub static T: [&i32; 3] = [&S, &S, &S];
pub fn q() -> &'static &'static i32 { &Q }
pub fn t() -> &'static [&'static i32; 3] { &T }
#[repr(C, packed)] pub struct W(pub [u8; 12], pub &'static i32, pub [u8; 2]);
unsafe impl Sync for W {}
pub static WS: W = W([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], &S, [13, 14]);
pub fn w() -> &'static W { &WS }
#[repr(C, packed)] pub struct W2(pub [u8; 14], pub &'static i32);
unsafe impl Sync for W2 {}
pub static WS2: W2 = W2([0x41; 14], &S);
pub fn w2() -> &'static W2 { &WS2 }
pub union MU { a: u32, b: () }
impl Copy for MU {}
pub const U: MU = MU { b: () };
pub fn u() -> MU { U }
unsafe impl Sync for () {}
pub static Z: () = ();
pub fn z() -> &'static () { &Z }
