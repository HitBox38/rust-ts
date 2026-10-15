// `Drop` impls that are more specialized than their type (lane check-region-intrinsic): E0366 from
// `ensure_impl_params_and_item_params_correspond`, which `check_drop_impl` runs before any trait solving.
#![feature(no_core, lang_items)]
#![no_core]
#![allow(internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}

pub struct A<T>(T);
impl Drop for A<u8> {
    fn drop(&mut self) {}
}

pub struct B<T, U>(T, U);
impl<T> Drop for B<T, T> {
    fn drop(&mut self) {}
}

pub struct C<'a>(&'a u8);
impl Drop for C<'static> {
    fn drop(&mut self) {}
}

pub enum D<'a, T> { X(&'a T) }
impl<'a> Drop for D<'a, &'a u8> {
    fn drop(&mut self) {}
}

pub union F<T: Copy> { x: T }
impl<T: Copy> Drop for F<(T, T)> {
    fn drop(&mut self) {}
}
