#![feature(no_core, lang_items, rustc_attrs, impl_restriction)]
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
#[lang = "unsize"]
#[rustc_deny_explicit_impl]
pub trait Unsize<T: PointeeSized>: PointeeSized {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}
#[rustc_deny_explicit_impl]
pub trait Denied {}
#[rustc_specialization_trait]
pub trait Spec {}
pub mod m {
    pub impl(self) trait Restricted {}
}

pub struct Local;
pub struct L2;

// E0658 (feature freeze_impls)
unsafe impl Freeze for Local {}
// E0322
impl Denied for Local {}
// E0328
impl Unsize<L2> for Local {}
// specialization trait (E0???)
impl Spec for Local {}
// restricted trait
impl m::Restricted for Local {}
