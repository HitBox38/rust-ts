#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl<T: ?Sized> Copy for &T {}
pub trait Foo {}
impl<T> Foo for T {}
pub trait Bar: 'static {}
impl<T: 'static> Bar for T {}
pub fn f(x: &u8) -> impl Bar {
    x
}
