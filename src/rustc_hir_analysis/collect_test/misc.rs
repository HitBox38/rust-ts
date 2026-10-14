#![feature(no_core, lang_items)]
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

pub struct Unit;
pub struct L<'a, T>(&'a T);
pub fn late<'a>(_x: &'a Unit) {}
pub fn early<'a: 'a>(_x: &'a Unit) {}
pub trait WithDefault<T = Unit> {}
pub struct Arr([Unit; 3]);
pub enum D {
    A = 1,
    B,
}
pub const CB: usize = const { 1 };
pub fn rpit() -> impl Sized {
    Unit
}
pub fn fptr(_f: fn(&Unit)) {}
