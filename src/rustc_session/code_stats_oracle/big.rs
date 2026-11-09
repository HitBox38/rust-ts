// `-Zprint-type-sizes` (code_stats.rs) at sizes of 2^53 bytes or more, where a `number` byte count would stop or round
// (docs/handoff/fixers-46.md "Left", lane fixers-49), beside small types: a struct with reordered fields and end padding, an
// enum with a discriminant and padding inside a variant, a C-like enum, a union (the `offset < min_offset` line) and a packed
// struct. Two types of 4 bytes are ordered by their description. See regen.ts.
#![feature(no_core, lang_items)]
#![crate_type = "lib"]
#![no_core]
#![allow(dead_code, internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

pub struct Big { a: u8, b: [u8; 9007199254740993], c: u32 }
pub enum EBig { A(u8), B([u16; 4503599627370497]), C { x: u64, y: [u8; 9007199254740995] } }
pub union UBig { a: u8, b: [u8; 9007199254740993] }
#[repr(packed)]
pub struct PBig { a: u8, b: [u32; 2251799813685249] }

pub struct S { a: u8, b: u32, c: u16 }
pub enum E { A(u8), B { x: u64, y: u8 }, C }
pub enum CLike { X, Y, Z }
pub struct Four(u32);
pub struct Alpha(u16, u16);

pub fn big(x: &Big) -> u8 { x.a }
pub fn ebig(x: &EBig) -> u8 { match x { EBig::A(a) => *a, _ => 0 } }
pub fn ubig(x: &UBig) -> u8 { unsafe { x.a } }
pub fn pbig(x: &PBig) -> u8 { x.a }
pub fn s(x: &S) -> u8 { x.a }
pub fn e(x: &E) -> u8 { match x { E::A(a) => *a, _ => 0 } }
pub fn clike(x: &CLike) -> u8 { match x { CLike::X => 1, _ => 0 } }
pub fn four(x: &Four) -> u32 { x.0 }
pub fn alpha(x: &Alpha) -> u16 { x.0 }
