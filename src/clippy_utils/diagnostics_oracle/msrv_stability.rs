// Fixture for msrvs.test.ts (review N4): the oracle's `incompatible_msrv` lint reports each use of an item that is stable
// (or, in a `const` context, const-stable) only after the crate's MSRV, with the `since` version that
// `lookup_stability` / `lookup_const_stability` give; `Msrv::is_stable` / `is_const_stable` read the same.
#![feature(custom_inner_attributes)]
#![clippy::msrv = "1.20.0"]
#![allow(unused)]
use std::collections::HashMap;
use std::mem;
fn f() -> bool { mem::needs_drop::<String>() }
const C: bool = mem::needs_drop::<String>();
fn g(a: &mut i32, b: &mut i32) { mem::swap(a, b) }
const fn h(a: &mut i32, b: &mut i32) { mem::swap(a, b) }
const fn r(a: &mut i32) -> i32 { mem::replace(a, 1) }
fn i(x: Option<i32>) { let _ = mem::discriminant(&x); }
const D: usize = mem::size_of_val(&1u8);
fn j(m: &mut HashMap<i32, i32>) { m.insert(1, 2); }
fn main() {}
