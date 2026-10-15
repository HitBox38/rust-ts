// Test crate of src/rustc_trait_selection/traits/old_solve.test.ts (fixer lane merge-w18c): old-solver goals that
// goals.rs / proj.rs (../../solve_test) do not reach. Cases as goals.rs: `env_<name>` / `goals_<name>`, type params
// named `I*` become inference variables.
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
#[lang = "copy"]
pub trait Copy {}

pub trait Tr {}
pub trait Assoc {
    type Out;
}
pub struct S;
pub struct U;
pub struct W<T>(T);
impl Copy for S {}
impl Tr for S {}
impl<T: Tr> Tr for W<T> {}
impl<T: Tr> Assoc for W<T> {
    type Out = T;
}

pub auto trait Au {}
pub struct NotAu;
impl !Au for NotAu {}
pub struct Node {
    next: *const Node,
    w: W<S>,
}

// Builtin `Sized` (tuples, slices, `str`) and builtin `Copy` (tuples).
pub fn env_builtin() {}
pub fn goals_builtin()
where
    (S, U): Sized,
    [S]: Sized,
    str: Sized,
    (S, S): Copy,
    (S, U): Copy,
    U: Copy,
{
}

// Projection through an impl with where-clauses.
pub fn env_impl_proj() {}
pub fn goals_impl_proj()
where
    W<S>: Assoc<Out = S>,
    <W<S> as Assoc>::Out: Tr,
    W<U>: Assoc<Out = U>,
    W<S>: Assoc<Out = U>,
{
}

// Projection from the param env.
pub fn env_env_proj<T: Assoc<Out = S>>() {}
pub fn goals_env_proj<T: Assoc<Out = S>>()
where
    T: Assoc<Out = S>,
    <T as Assoc>::Out: Tr,
    W<<T as Assoc>::Out>: Tr,
{
}

// Auto traits through raw pointers and a (coinductive) cycle.
pub fn env_auto_cycle() {}
pub fn goals_auto_cycle()
where
    Node: Au,
    *const NotAu: Au,
    W<Node>: Au,
{
}

// An inference variable as the self type and as the projection's term.
pub fn env_infer() {}
pub fn goals_infer<I0, I1>()
where
    I0: Tr,
    W<S>: Assoc<Out = I1>,
    I1: Copy,
{
}

// Object candidates (with a supertrait) and builtin `Copy` of pointers and fn pointers. (No arrays: lowering the
// length const needs the target data layout, not ported yet.)
pub trait Super {}
pub trait Sub: Super {}
pub fn env_object() {}
pub fn goals_object()
where
    dyn Sub: Sub,
    dyn Sub: Super,
    dyn Sub: Tr,
    &'static S: Copy,
    &'static mut S: Copy,
    *const U: Copy,
    fn(U) -> U: Copy,
{
}

// Param-env candidates feeding impl where-clauses, auto traits and projections over a parameter.
pub fn env_param_nested<T: Tr + Au>() {}
pub fn goals_param_nested<T: Tr + Au>()
where
    W<W<T>>: Tr,
    W<T>: Au,
    W<T>: Assoc<Out = T>,
    <W<T> as Assoc>::Out: Tr,
{
}
