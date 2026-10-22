#![feature(mut_restriction)]
#![allow(dead_code, unused_variables)]
mod m {
    pub struct S { pub mut(self) x: u32, pub y: u32 }
    pub enum E { V { mut(self) a: u8, b: u8 }, T(pub mut(self) u8) }
    pub union U { pub mut(self) x: u32, pub y: u32 }
    pub struct Tup(pub mut(self) u32);
    pub fn inside(s: &mut S) { s.x = 1; }
}
fn outside(s: &mut m::S, e: &mut m::E, u: &mut m::U) {
    s.x = 1;
    s.y = 2;
    match e { m::E::V { a, b } => { *a = 1; } m::E::T(t) => {} }
    unsafe { u.x = 1; }
    let _ = m::S { x: 0, y: 0 };
    let _ = m::U { x: 0 };
    let f = m::Tup;
}
fn main() {}
