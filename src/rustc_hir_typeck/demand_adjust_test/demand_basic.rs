#![feature(no_core, lang_items)]
#![no_core]
#![allow(dead_code, internal_features, unused_assignments, unused_variables)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver: PointeeSized {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}
impl Copy for u8 {}
impl Copy for bool {}

pub struct W<T>(pub T);
impl<T> W<T> { pub fn put(&mut self, t: T) { loop {} } pub fn new() -> W<T> { loop {} } }

// annotate_expected_due_to_let_ty: `let` with a type
pub fn let_ty() { let _x: u8 = true; }
// annotate_expected_due_to_let_ty: assignment to a parameter
pub fn assign(mut y: u8) { y = true; }
// annotate_expected_due_to_let_ty: assignment to a local
pub fn assign_local() { let mut z = 0u8; z = true; }
// annotate_expected_due_to_let_ty: assignment through a field
pub struct P { pub x: u8 }
pub fn field(p: &mut P) { p.x = true; }
// note_source_of_type_mismatch_constraint: type inferred from a method call argument
pub fn inferred() { let mut w = W::new(); w.put(1u8); let _v: W<bool> = w; }
// annotate_loop_expected_due_to_inference
pub fn lp(b: bool) { let _x = loop { if b { break 1u8; } break true; }; }
// annotate_mut_binding_to_immutable_binding
pub fn mut_bind(mut a: &u8, b: u8) { a = b; }
// explain_self_literal
pub struct G<T>(pub T);
impl<T> G<T> { pub fn mk(t: T) { let _g: G<u8> = Self(t); } }
pub struct H<T> { pub x: T }
impl<T> H<T> { pub fn mk(t: T) { let _h: H<u8> = Self { x: t }; } }
