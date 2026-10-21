// BuiltinDerived (`required because it appears within the type `W`` with the field) under a WhereClause.
#![feature(no_core, lang_items, auto_traits, negative_impls)]
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
#[lang = "sync"]
pub unsafe auto trait Sync {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

pub struct S;
impl !Sync for S {}
pub struct W {
    pub s: S,
}
pub struct Need<T: Sync>(T);
pub struct Use {
    pub f: Need<W>,
}
