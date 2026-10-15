// Inputs of wf_dyn.test.ts (lane trait-sel-traits-b): traits for dyn_compatibility.rs, type aliases and where-clauses for
// wf.rs. A `#![no_core]` crate without the `Unsize` / `DispatchFromDyn` lang items, so `receiver_is_dispatchable` answers
// `false` for every non-`Self` receiver before it builds a param env.
#![feature(no_core, lang_items, rustc_attrs, auto_traits, arbitrary_self_types, negative_impls)]
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

pub auto trait Auto {}

// ---- dyn_compatibility.rs ----

pub trait Empty {}
pub trait Static: 'static {}
pub trait SubStatic: Static {}
pub trait Two<'a>: 'a {}
pub trait SizedSuper: Sized {}
pub trait WhereSized
where
    Self: Sized,
{
}
pub trait SelfArg: Two<'static> + Gen<Self> {}
pub trait Gen<T: ?Sized> {}
pub trait SuperSelf: Gen<Self> {}
pub trait ConstItem {
    const C: u8;
}
pub trait AssocTy {
    type A;
    type B: Gen<Self>;
}
pub trait Gat {
    type G<T>;
    type H<'a>;
}
pub trait StaticFn {
    fn f();
    fn g(x: u8) -> u8;
    fn h()
    where
        Self: Sized;
}
pub trait ByValue {
    fn by_value(self);
    fn ret_self(self) -> Self;
    fn arg_self(self, other: Self);
    fn generic<T>(self, t: T);
    fn lifetime_generic<'a>(self, x: &'a u8);
}
pub trait Receivers {
    fn by_ref(&self);
    fn by_mut(&mut self) -> u8;
    fn by_ref_lt<'a>(self: &'a Self);
    fn sized_only(&self)
    where
        Self: Sized;
}
pub trait WhereClauses {
    fn outlives(self)
    where
        Self: 'static;
    fn auto_bound(self)
    where
        Self: Auto;
    fn other(self)
    where
        u8: Gen<Self>;
}
pub trait Proj {
    type A;
    fn p(self) -> Self::A;
}
pub trait Mixed: SuperSelf + SizedSuper {
    fn m(&self) -> Self;
}

// ---- wf.rs ----

pub struct S<T: Copy>(T);
pub struct W<'a, T: 'a>(&'a T);
pub struct Plain<T>(T);
pub trait Bound<T: Copy> {}

pub type TySlice = [Plain<u8>];
pub type TyTuple = (u8, Plain<u16>, [u32]);
pub type TyRef<'a> = &'a Plain<u8>;
pub type TyNested<'a, 'b> = &'a &'b Plain<u8>;
pub type TyPtr = *const [u8];
pub type TyAdt = S<u8>;
pub type TyAdtParam<T> = S<T>;
pub type TyW<'a, T> = W<'a, T>;
pub type TyNever = (!, bool, char);

pub fn where_trait<T>()
where
    T: Bound<u8>,
{
}
pub fn where_outlives<'a, T>()
where
    T: 'a,
    S<u8>: Gen<T>,
{
}
pub fn where_wf<'a, T>()
where
    T: 'a,
    &'a T: Gen<[T]>,
{
}

impl Copy for u8 {}
impl Bound<u8> for Plain<u16> {}
pub trait SubB: Bound<u8> {}
impl Bound<u8> for Plain<u32> {}
impl SubB for Plain<u32> {}
impl<T: Copy> Bound<T> for S<T> {}
impl<T> !Auto for Plain<T> {}
