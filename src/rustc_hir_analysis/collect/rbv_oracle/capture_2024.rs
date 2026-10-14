#![feature(no_core, lang_items)]
#![allow(internal_features, unused)]
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
impl Tr for u8 {}

pub fn f<'a, 'b: 'b, 'c>(x: &'a u8, y: &'b u8, z: &'c u8) -> &'a u8 where 'c: 'c { x }
pub fn g<'x>() -> &'x u8 { loop {} }
pub fn h(p: for<'q> fn(&'q u8, for<'r> fn(&'r u8, &'q u8)) -> &'q u8) {}
pub fn d<'o>(a: &'o dyn Tr, b: &dyn Tr, c: &'o (dyn Tr + 'static)) {}
pub fn op<'p, 'u>(p: &'p u8, u: &'u u8) -> impl Tr { *p }
pub fn op2<'v>() -> impl Tr { 0u8 }
pub fn st(s: &'static u8) -> &'static u8 { s }
pub fn body<'m>(m: &'m u8) { let _n: &'m u8 = m; }
pub struct S<'s>(&'s u8);
pub type A<'t> = &'t dyn Tr;
