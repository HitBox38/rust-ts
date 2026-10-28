// Fixture of alias_check.test.ts (lane fix-ubchecks-alias): bodies that CheckAlignment / CheckNull / CheckEnums
// instrument, promoted constants, ADT constructor shims and drops, compiled with UB checks on (debug).
#![feature(core_intrinsics)]
#![allow(internal_features)]
use std::intrinsics;

pub fn bx(b: Box<(u32, u64)>) -> u64 { let c = &*b; c.1 + (*b).0 as u64 }
pub fn bx2(b: &Box<Box<u8>>) -> u8 { **b.as_ref() + ***b }
pub unsafe fn i10(p: *const u64) -> u64 { unsafe { intrinsics::read_via_copy(p) } }
pub unsafe fn rawd(p: *const *const (u8, u32)) -> u32 { unsafe { (**p).1 } }
pub unsafe fn wr(p: *mut u32, q: *mut u16) { unsafe { *p = 7; *q = *q + 1; } }
pub unsafe fn brw(p: *const (u8, u32)) -> u32 { unsafe { let r = &(*p).1; *r } }
pub unsafe fn zst(p: *const ()) -> () { unsafe { *p } }
pub unsafe fn arrp(p: *const [u16; 3]) -> u16 { unsafe { (*p)[1] } }

#[derive(Clone, Copy)]
pub enum Small { A, B = 5, C }
pub enum Niche { X(&'static u8), Y }
pub fn tre(x: u8) -> Small { unsafe { std::mem::transmute(x) } }
pub fn trn(x: usize) -> Niche { unsafe { std::mem::transmute(x) } }

pub fn arr() -> &'static [u8] { &[1, 2, 3] }
pub fn arr2(i: usize) -> u32 { let a = &[4u32, 5, 6]; a[i % 3] }

pub struct D(pub u32);
impl Drop for D { fn drop(&mut self) {} }
pub enum E { A(u8), B { x: u16 } }
pub fn ctors() -> (fn(u32) -> D, fn(u8) -> E) { (D, E::A) }
pub fn mk(x: u16) -> E { E::B { x } }
pub fn drops(v: Vec<D>, d: D) -> usize { let n = v.len(); drop(d); n }
