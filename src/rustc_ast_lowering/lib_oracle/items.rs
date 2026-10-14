#![feature(no_core, lang_items)]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub mod m {
    pub fn f(x: (), _: !) -> ((), ()) { let _y = x; loop {} }
    pub struct S<'a, T>(&'a T, (T,));
}

pub trait Tr {
    type A;
    const C: ();
    fn g(&self);
}

impl Tr for () {
    type A = ();
    const C: () = ();
    fn g(&self) {}
}

extern "C" {
    pub fn ext(a: *const ());
    pub static X: [(); 0];
}

pub enum E { A(()), B { f: () } }
