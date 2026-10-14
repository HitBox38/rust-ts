#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

#[lang = "unsize"]
pub trait Unsize<T: PointeeSized>: PointeeSized {}
#[lang = "coerce_unsized"]
pub trait CoerceUnsized<T> {}
#[lang = "dispatch_from_dyn"]
pub trait DispatchFromDyn<T> {}

pub struct P<T: ?Sized>(*const T);
pub struct Two<T: ?Sized, U: ?Sized>(*const T, *const U);

// ok
impl<T: ?Sized + Unsize<U>, U: ?Sized> CoerceUnsized<*const U> for *const T {}
impl<T: ?Sized + Unsize<U>, U: ?Sized> CoerceUnsized<P<U>> for P<T> {}
// E0375: more than one field is coerced
impl<T: ?Sized + Unsize<U>, U: ?Sized> CoerceUnsized<Two<U, U>> for Two<T, T> {}
// E0376: not a struct
impl CoerceUnsized<u16> for u8 {}
