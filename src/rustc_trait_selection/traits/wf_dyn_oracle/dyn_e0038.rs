// E0038 input of wf_dyn.test.ts (lane trait-sel-traits-b): lowering `dyn SuperSelf` (hir_ty_lowering dyn_trait.rs) finds
// the supertrait `Gen<Self>` through `hir_ty_lowering_dyn_compatibility_violations` and reports E0038.
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

pub trait Gen<T: ?Sized> {}
pub trait SuperSelf: Gen<Self> {}

pub type D = dyn SuperSelf;
