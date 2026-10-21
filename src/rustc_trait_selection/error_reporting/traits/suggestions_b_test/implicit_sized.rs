// WhereClause on an implicit `Sized` bound: "required by an implicit `Sized` bound".
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

pub struct Need<T>(T);
pub struct Use {
    pub f: Need<[u8]>,
}
