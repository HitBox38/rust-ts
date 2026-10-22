#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
struct S<T, U = u8>(T, U);
impl<T> S<T> { fn new() -> Self { loop {} } }
pub fn f() { S::new(); }
