// Edition 2021 with `tail_expr_drop_order` enabled: block tails fill `backwards_incompatible_scope`
// (lane check-region-intrinsic).
#![feature(no_core, lang_items)]
#![no_core]
#![allow(unused, internal_features)]
#![warn(tail_expr_drop_order)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S { pub a: u8 }
fn tmp() -> S { S { a: 1 } }

pub fn f(c: bool) -> u8 {
    let x = { tmp().a };
    let y = if c { tmp().a } else { 2 };
    let z = { let w = 1u8; { w } };
    let a = { 1u8 }; let b = { 2u8 }; let d = { 3u8 }; let e = { 4u8 };
    let g = { 5u8 }; let h = { 6u8 }; let i = { 7u8 }; let j = { 8u8 };
    tmp().a
}
