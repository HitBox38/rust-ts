// `Drop` impls whose where-clauses the ADT does not imply (lane check-region-intrinsic): E0367 from
// `ensure_impl_predicates_are_implied_by_item_defn` (needs rustc_trait_selection's `ObligationCtxt`).
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

pub trait Tr {}

pub struct Ok1<T: Tr>(T);
impl<T: Tr> Drop for Ok1<T> {
    fn drop(&mut self) {}
}

pub struct Bad1<T>(T);
impl<T: Tr> Drop for Bad1<T> {
    fn drop(&mut self) {}
}

pub struct Bad2<'a, T>(&'a T);
impl<'a, T: 'static> Drop for Bad2<'a, T> {
    fn drop(&mut self) {}
}
