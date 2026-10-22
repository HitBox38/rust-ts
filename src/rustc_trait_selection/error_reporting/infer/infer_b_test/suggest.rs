#![feature(no_core, lang_items, unboxed_closures, fundamental)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
impl Copy for u32 {}
impl Copy for bool {}
#[lang = "tuple_trait"] pub trait Tuple {}
#[lang = "fn_once"]
#[rustc_paren_sugar]
#[fundamental]
pub trait FnOnce<Args: Tuple> {
    #[lang = "fn_once_output"]
    type Output;
    extern "rust-call" fn call_once(self, args: Args) -> Self::Output;
}
#[lang = "fn_mut"]
#[rustc_paren_sugar]
#[fundamental]
pub trait FnMut<Args: Tuple>: FnOnce<Args> {
    extern "rust-call" fn call_mut(&mut self, args: Args) -> Self::Output;
}
#[lang = "fn"]
#[rustc_paren_sugar]
#[fundamental]
pub trait Fn<Args: Tuple>: FnMut<Args> {
    extern "rust-call" fn call(&self, args: Args) -> Self::Output;
}

pub trait Tr2 {}
impl Tr2 for u32 {}
impl Tr2 for bool {}
pub unsafe fn us() {}
pub fn uf() { let _p: fn() = us; }
pub enum E { V(u32) }
pub enum E2 { A(u32), B(u32), C(bool) }
pub fn tp(x: E) { match x { 5u32 => {} } }
pub fn tp2(x: E2) { match x { 5u32 => {} } }
pub struct W { pub f: u32 }
pub fn af(w: W) { match w { 5u32 => {} } }
pub fn rs() -> u32 { 1u32; }
pub fn rb() -> u32 { let x = 1u32; }
pub fn rb2() -> u32 {
    let x = 1u32;
    let y = 2u32;
}
pub fn a1(_: u32) {}
pub fn a2(_: u32) {}
pub fn fp() { let mut f = a1; f = a2; }
pub fn fp2() { let _g: &fn(u32) = &a1; }
pub fn fp3() { let _g: fn(u32) = &a1; }
pub fn ife(c: bool) -> u32 { let r = if c { 1u32; } else { 2u32; }; r }
