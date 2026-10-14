#![feature(no_core, lang_items, extern_types)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S<T, const N: usize>(T);
pub struct Unit;
pub enum E<T> {
    A(T),
    B { x: T },
    C,
}
pub union U<T> {
    a: *const T,
}
pub trait Tr<X> {
    type A;
    const K: usize;
    fn f<U>();
}
pub trait Alias2<Y = Unit> {}
pub type Al<T> = S<T, 3>;
impl<T> Tr<T> for S<T, 1> {
    type A = T;
    const K: usize = 0;
    fn f<U>() {}
}
impl<T> S<T, 2> {
    pub fn g<V>() {}
}
pub fn h<A, B, const C: bool>() {}
extern "C" {
    pub type Foreign;
    pub fn ext();
    pub static X: Unit;
}
