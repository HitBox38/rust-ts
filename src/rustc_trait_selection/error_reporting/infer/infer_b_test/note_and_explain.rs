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

pub trait Tr { type A; fn m(&self) -> Self::A; fn n(&self) -> Self::A; }
pub fn f<A, B>(a: A) -> B { a }
pub fn g() { let _x: f32 = 1; }
pub fn h<T>(t: T) -> u32 { t }
pub fn k<T: Tr>(t: T) -> u32 { t.m() }
pub fn k3<T>(t: T) -> u32 where T: Tr { t.m() }
pub fn z<T: Tr, U>(_t: T, u: U) -> T::A { u }
pub fn cl() { let mut c = || 1u32; c = || 2u32; }
pub fn pc<F: Fn()>() -> F { || {} }
pub fn hh<T>(t: u32) -> T { t }
pub struct S<T>(T);
impl<T: Tr> S<T> { pub fn q(&self, t: &T) -> T::A { 0u32 } }
