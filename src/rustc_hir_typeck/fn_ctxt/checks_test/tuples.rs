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

pub fn wrap(p: (u32, bool)) {}
pub fn w1() { wrap(1, true); }
pub fn w2() {
    let c = |p: (u32, bool)| {};
    c((2, false));
    c(1, true);
}
pub fn w3(x: u32, p: (u32, bool, u32)) {}
pub fn w4() { w3(0, 1, true, 2); }
pub struct Foo;
impl FnOnce<(u32,)> for Foo {
    type Output = ();
    extern "rust-call" fn call_once(self, a: (u32,)) {}
}
pub fn u1() { let f = Foo; f(1, 2); }
