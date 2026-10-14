// Region scope trees of small bodies (lane check-region-intrinsic): blocks, lets, let-else, `if`/`if let`,
// `match` with guards, loops, `&&`/`||` chains, compound assignment, closures, inline consts, const/static
// initializers and the temporary-lifetime-extension rules (`E&`, `P&`, `ET`, `super let`).
#![feature(no_core, lang_items, rustc_attrs, super_let, if_let_guard)]
#![no_core]
#![allow(unused, internal_features, incomplete_features)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}

pub struct S { pub a: u8, pub b: (u8, u8) }
pub struct T(pub u8, pub u8);
pub enum E { A(u8), B { x: u8 } }

fn id(x: u8) -> u8 { x }
fn tmp() -> S { S { a: 1, b: (2, 3) } }

pub fn empty() {}

pub fn lets(p: u8, q: u8) -> u8 {
    let a = p;
    let b;
    b = q;
    let (c, d) = (a, b);
    id(c);
    d
}

pub fn let_else(o: E) -> u8 {
    let E::A(x) = o else { return 0 };
    let y = x;
    y
}

pub fn ifs(c: bool, o: E) -> u8 {
    if c { 1 } else { 2 };
    if c { id(1); }
    if let E::A(v) = o { v } else if c { 3 } else { 4 }
}

pub fn matches(o: E, c: bool) -> u8 {
    match o {
        E::A(v) if c => v,
        E::A(ref v) if let E::B { .. } = o => 7,
        E::B { x } => x,
        _ => 0,
    }
}

pub fn loops(c: bool) {
    loop { if c { break; } }
    while c { id(1); }
}

pub fn chains(a: bool, b: bool, o: E) -> bool {
    let x = a && b || a;
    if a && (b || a) { return true; }
    x
}

pub fn assign_op(mut x: u8) {
    let r = &mut x;
    *r = 3;
}

pub fn closures(k: u8) -> u8 {
    let f = |y: u8| { let z = y; z };
    let g = move || k;
    k
}

pub fn inline_const() -> u8 {
    const { 3 }
}

pub fn extension() {
    let a = &tmp();
    let b = &tmp().a;
    let c = S { a: 1, b: (2, 3) };
    let ref d = tmp();
    let (ref e, f) = (tmp(), 1u8);
    let g = [&tmp(), &tmp()];
    let h = (&tmp(), 1u8);
    let i = { &tmp() };
    let j = if true { &tmp() } else { &tmp() };
    let k = match 1u8 { _ => &tmp() };
    let l = T(1, 2);
    let m = &T(1, 2).0;
    let n = Some3(&tmp());
    let o = &*&tmp();
}

pub enum Opt<X> { None3, Some3(X) }
use Opt::*;

pub fn super_lets() {
    let a = { super let b = tmp(); &b };
    let c = id({ super let d = 1u8; d });
}

pub fn nested_blocks(c: bool) -> u8 {
    let x = { let y = 1u8; { let z = y; z } };
    fn inner() -> u8 { 5 }
    x
}

pub const C: &S = &S { a: 1, b: (2, 3) };
pub static ST: u8 = { let q = 1u8; q };
pub const D: u8 = id(4);

impl S {
    pub fn method(&self, n: u8) -> u8 { let m = n; self.a }
}

pub trait Tr {
    fn provided(&self) -> u8 { 1 }
    const K: u8 = 2;
}
