// Test crate of src/rustc_trait_selection/solve.test.ts (lane trait-sel-solve).
// Each case is a pair `env_<name>` / `goals_<name>`: the param env is `env_<name>`'s where-clauses, the goals are
// `goals_<name>`'s. Generic parameters of `goals_<name>` named `I*` become fresh type inference variables; the others
// must line up with `env_<name>`'s (same index and name).
#![feature(no_core, lang_items, auto_traits, negative_impls, rustc_attrs)]
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
pub trait Other {}
pub trait Gen<A> {}
pub struct S;
pub struct U;
pub struct W<T>(T);
pub struct Pair<A, B>(A, B);
impl Tr for S {}
impl<T: Tr> Tr for W<T> {}
impl Other for U {}
impl Gen<S> for U {}
impl Gen<U> for U {}
impl Gen<W<S>> for S {}

pub auto trait Au {}
pub struct NotAu;
impl !Au for NotAu {}

// `T: Sized` from the implicit bound, builtin `Sized` for ADTs.
pub fn env_sized<T>() {}
pub fn goals_sized<T>()
where
    S: Sized,
    W<T>: Sized,
    Pair<S, T>: Sized,
{
}

// `T: ?Sized`: no `T: Sized` in the env.
pub fn env_unsized<T: ?Sized>() {}
pub fn goals_unsized<T: ?Sized>()
where
    T: Sized,
{
}

// Impl candidates, nested impl where-bounds.
pub fn env_impls() {}
pub fn goals_impls()
where
    S: Tr,
    W<S>: Tr,
    W<W<S>>: Tr,
{
}

// An impl where-bound that does not hold.
pub fn env_impl_fails() {}
pub fn goals_impl_fails()
where
    U: Tr,
    W<U>: Tr,
    W<W<U>>: Tr,
{
}

// Param-env candidates.
pub fn env_param<T: Tr>() {}
pub fn goals_param<T: Tr>()
where
    T: Tr,
    W<T>: Tr,
    T: Other,
{
}

// Auto traits: structural, negative impls.
pub fn env_auto() {}
pub fn goals_auto()
where
    S: Au,
    W<S>: Au,
    Pair<S, U>: Au,
    NotAu: Au,
    W<NotAu>: Au,
{
}

// Inference variables: ambiguity, and a unique impl that constrains the variable.
pub fn env_infer() {}
pub fn goals_infer<I0, I1, I2>()
where
    I0: Tr,
    U: Gen<I1>,
    S: Gen<I2>,
{
}
