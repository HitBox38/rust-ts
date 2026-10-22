#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &T {}

pub trait Tr {}
pub struct Good;
pub struct Bad;
impl Tr for Good {}

pub fn need<T: Tr>(_t: T) {}
pub fn need_ty<T: Tr>() {}
pub fn two<'a, A: Tr, B: Tr>(_a: &'a A, _b: &'a B) {}
pub struct Q<T: Tr> { pub x: T }
pub struct S;
impl S {
    pub fn m<T: Tr>(&self, _t: T) {}
    pub fn g<T: Tr>(&self) {}
    pub fn assoc<T: Tr>() {}
}
pub trait Me { fn me(&self) where Self: Tr {} }
impl Me for Bad {}
pub struct G<T>(pub T);
impl<T> G<T> { pub fn new(t: T) -> G<T> where T: Tr { G(t) } }

// turbofish on a call: point_at_path_if_possible
pub fn turbofish_call() { need::<Bad>(Bad); }
// path expression (not called): point_at_path_if_possible
pub fn path_expr() { let _f = need_ty::<Bad>; }
// call of a fn whose param is not in an argument
pub fn no_arg() { need_ty::<Bad>(); }
// lifetimes before the type params (SUBTLE in point_at_generic_if_possible)
pub fn lifetimes(a: &Good, b: &Bad) { two(a, b); }
pub fn lifetimes_turbofish(a: &Good, b: &Bad) { two::<Good, Bad>(a, b); }
// struct expression of a struct with a where clause: point_at_field_if_possible
pub fn struct_expr() { let _q = Q { x: Bad }; }
// method call argument
pub fn method_arg(s: S) { s.m(Bad); }
// method call turbofish
pub fn method_turbofish(s: S) { s.g::<Bad>(); }
// associated fn through a type-relative path
pub fn assoc_path() { S::assoc::<Bad>(); }
// `Self: Tr` on a method: points at the receiver
pub fn self_param(b: Bad) { b.me(); }
// inherent impl generic used through a type-relative call
pub fn ty_relative() { let _g = G::new(Bad); }
