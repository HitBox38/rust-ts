#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}

pub trait Tr {}
pub struct Good;
pub struct Bad;
impl Tr for Good {}
impl<A: Tr, B: Tr> Tr for (A, B) {}
impl<'a, T: Tr> Tr for &'a T {}

pub struct W<T> { pub x: T, pub y: u8 }
impl<T: Tr> Tr for W<T> {}
pub struct TupW<T>(pub u8, pub T);
impl<T: Tr> Tr for TupW<T> {}
pub enum E<T> { V(T), N }
impl<T: Tr> Tr for E<T> {}

pub fn need<T: Tr>(_t: T) {}
pub fn need2<T: Tr>(_a: u8, _t: T) {}

// blame_specific_arg_if_possible: the argument
pub fn arg() { need(Bad); }
// second argument
pub fn arg2() { need2(0, Bad); }
// tuple drilling (ImplDerived, blame_specific_part_of_expr_corresponding_to_generic_param)
pub fn tup() { need((Good, Bad)); }
// reference drilling
pub fn reference() { need(&Bad); }
// struct literal drilling
pub fn strukt() { need(W { x: Bad, y: 0 }); }
// tuple-struct constructor drilling
pub fn ctor() { need(TupW(0, Bad)); }
// enum variant constructor drilling
pub fn variant() { need(E::V(Bad)); }
// nested
pub fn nested() { need((Good, W { x: (Bad, Good), y: 1 })); }
