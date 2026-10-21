// ImplDerived (`required for `W<S>` to implement `B``) under a WhereClause (`required by a bound in `Need``).
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

pub trait A {}
pub trait B {}
pub struct S;
pub struct W<T>(T);
impl<T: A> B for W<T> {}
pub struct Need<T: B>(T);
pub struct Use {
    pub f: Need<W<S>>,
}
