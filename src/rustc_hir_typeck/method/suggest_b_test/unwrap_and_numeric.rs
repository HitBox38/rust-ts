#![feature(lang_items, no_core, rustc_attrs, auto_traits)]
#![no_core]
#![crate_type = "lib"]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "unpin"] pub auto trait Unpin {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
#[lang = "owned_box"] pub struct Box<T: ?Sized>(*const T);
impl<T: ?Sized> LegacyReceiver for Box<T> {}
#[rustc_diagnostic_item = "Option"] pub enum Option<T> { None, Some(T) }
#[rustc_diagnostic_item = "Result"] pub enum Result<T, E> { Ok(T), Err(E) }
pub struct S;
impl S { pub fn inner(&self) {} pub fn mm(&mut self) {} }
pub trait Tr { fn boxed(self: Box<Self>); }
impl Tr for S { fn boxed(self: Box<Self>) {} }
pub trait Num { fn numfoo(&self); }
pub fn f(s: S, o: Option<S>, r: Result<S, u8>) { s.boxed(); o.inner(); r.inner(); }
pub fn g() -> Option<u8> { let o: Option<S> = Option::None; o.inner(); Option::None }
pub fn h() { 1.numfoo(); let x = 2.0; x.numfoo(); let y: _ = 3; y.numfoo(); }
pub fn i() { let c = |&v| v.numfoo(); c(&1); }
pub fn j(s: S) { s.mm(); }
