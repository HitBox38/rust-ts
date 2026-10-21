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
#[lang = "unsize"]
pub trait Unsize<T: ?Sized>: PointeeSized {}
#[lang = "coerce_unsized"]
pub trait CoerceUnsized<T: ?Sized> {}
impl<'a, 'b: 'a, T: ?Sized + Unsize<U>, U: ?Sized> CoerceUnsized<&'a U> for &'b T {}
pub fn f(x: &u8) -> &'static (dyn Foo + 'static) {
    x
}
