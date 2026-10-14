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

#[rustc_dump_variances]
#[rustc_dump_inferred_outlives]
pub struct Contra<'a, T>(fn(&'a T));
#[rustc_dump_variances]
#[rustc_dump_inferred_outlives]
pub struct Hr<'a, T>(for<'x> fn(&'x T), &'a ());
#[rustc_dump_variances]
pub struct B<T>(fn(*const T) -> T);
pub trait Tr<'a, T>
where
    T: 'a,
{
}
#[rustc_dump_variances]
#[rustc_dump_inferred_outlives]
pub struct O5<'a, 'b, T>(&'b (dyn Tr<'a, T> + 'b));
pub trait Iter {
    type Item;
}
#[rustc_dump_variances]
#[rustc_dump_inferred_outlives]
pub struct O6<'a, T: Iter>(&'a T::Item);
