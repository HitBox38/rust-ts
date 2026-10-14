#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
pub trait Tr<'a, T = Self, const N: usize = 0, U = Self> {}
pub type A = dyn Tr<'static>;
