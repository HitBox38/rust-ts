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

pub fn c1() { let c = |x: u32| {}; c(1, 2); }
pub fn c2() { let c = |x: u32, y: bool| {}; c(1); }
pub fn c3<F: Fn(u32)>(f: F) { f(1, 2); }
pub fn c4(f: impl Fn(u32)) { f(); }

pub struct S;
impl S { pub fn m(&self, a: u32) {} pub fn n(self, a: u32, b: bool) {} }
pub enum E { V(u32, bool) }
pub fn e1() { let _ = E::V(1); }
pub fn trailing() { let c = |x: u32| {}; c(1, 2,); }
