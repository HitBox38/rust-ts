// Test crate of src/rustc_trait_selection/solve.test.ts (lane trait-sel-solve): projection goals. Cases as goals.rs.
#![feature(no_core, lang_items, rustc_attrs)]
#![allow(internal_features, dead_code)]
#![no_core]
#![crate_type = "lib"]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub trait Tr {}
pub trait Assoc {
    type Out;
}
pub struct S;
pub struct W<T>(T);
impl Tr for S {}
impl<T: Tr> Tr for W<T> {}
impl Assoc for S {
    type Out = W<S>;
}

// Impl candidates of `NormalizesTo`.
pub fn env_proj() {}
pub fn goals_proj()
where
    S: Assoc<Out = W<S>>,
    <S as Assoc>::Out: Tr,
    S: Assoc<Out = S>,
{
}

// A rigid alias.
pub fn env_rigid<T: Assoc>() {}
pub fn goals_rigid<T: Assoc>()
where
    <T as Assoc>::Out: Tr,
{
}

// Normalizing into an inference variable.
pub fn env_proj_infer() {}
pub fn goals_proj_infer<I0>()
where
    S: Assoc<Out = I0>,
{
}
