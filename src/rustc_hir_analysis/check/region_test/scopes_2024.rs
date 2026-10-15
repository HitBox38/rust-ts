// Edition 2024 scope rules (lane check-region-intrinsic): `IfThenRescope`, terminating block tails, let chains.
#![feature(no_core, lang_items, super_let)]
#![no_core]
#![allow(unused, internal_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}

pub struct S { pub a: u8 }
pub enum E { A(u8), B }
fn tmp() -> S { S { a: 1 } }
fn id(x: u8) -> u8 { x }

pub fn chains(a: bool, b: bool, o: E) -> u8 {
    if let E::A(v) = o && a && let E::A(w) = o { return v; }
    if a || b { 1 } else { 2 }
}

pub fn tails() -> u8 {
    let x = { let y = &tmp(); y.a };
    { id(x) }
}

pub fn super_let_tail() -> u8 {
    let r = { super let s = tmp(); &s };
    let t = id({ super let u = tmp(); u.a });
    r.a
}
