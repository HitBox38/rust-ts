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
#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}

pub struct Local;
pub struct G<T>(T);

// E0120
impl Drop for u8 {
    fn drop(&mut self) {}
}
// E0120
impl<'a> Drop for &'a Local {
    fn drop(&mut self) {}
}
// ok
impl Drop for Local {
    fn drop(&mut self) {}
}
impl<T> Drop for G<T> {
    fn drop(&mut self) {}
}
