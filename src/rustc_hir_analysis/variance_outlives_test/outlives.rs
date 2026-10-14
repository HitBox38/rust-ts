#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

#[rustc_dump_inferred_outlives]
pub struct O1<'a, T>(&'a T);
#[rustc_dump_inferred_outlives]
pub struct O2<'a, 'b, T>(&'a &'b T);
#[rustc_dump_inferred_outlives]
pub struct O3<'a, T> {
    x: O1<'a, T>,
}
pub struct Ex<'a, T: 'a>(*const &'a (), *const T);
#[rustc_dump_inferred_outlives]
pub struct O4<'a, U>(Ex<'a, U>);
#[rustc_dump_inferred_outlives]
pub struct C1<'a, T>(C2<'a, T>);
#[rustc_dump_inferred_outlives]
pub struct C2<'a, T>(C3<'a, T>);
#[rustc_dump_inferred_outlives]
pub struct C3<'a, T>(C4<'a, T>);
#[rustc_dump_inferred_outlives]
pub struct C4<'a, T>(&'a T);
#[rustc_dump_inferred_outlives]
pub enum En<'a, 'b, 'c, T, U> {
    A(&'a &'b T),
    B(&'c U, &'b ()),
}
#[rustc_dump_inferred_outlives]
pub struct Static<T: 'static>(&'static T);
#[rustc_dump_inferred_outlives]
pub struct Nothing<T>(T);
