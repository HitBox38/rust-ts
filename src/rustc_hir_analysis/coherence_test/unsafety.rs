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

pub trait Safe {}
pub unsafe trait Unsafe {}
pub trait Generic<T> {}
pub unsafe trait UnsafeGeneric<T> {}

pub struct S;
pub struct G<T>(T);

// E0199
unsafe impl Safe for S {}
// E0200
impl Unsafe for S {}
// ok
unsafe impl Unsafe for G<S> {}
impl Safe for G<S> {}
// E0199 / E0200 with generics (print_trait_sugared)
unsafe impl<T> Generic<T> for G<T> {}
impl<T> UnsafeGeneric<T> for G<T> {}
