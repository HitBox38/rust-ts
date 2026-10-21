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

pub fn g1() { let _x: f32 = 0x10; }
pub fn g2() { let _x: f32 = 1_000; }
pub fn g3() { let _x: f64 = 2; let _y: f32 = 3; }
#[target_feature(enable = "sse2")]
pub fn tf() {}
pub fn tfc() { let _p: fn() = tf; }
pub trait Tr { type A; }
pub fn pr<T: Tr<A = bool>>(x: T::A) -> u32 { x }
pub fn pr2<T: Tr, U: Tr>(x: T::A) -> U::A { x }
