#![feature(no_core)]
#![no_core]
pub struct P { pub x: u8 }
pub struct T(u8);
pub enum E { A, B(u8) }
pub fn f<'a, U>(r: &'a U, (a, _): (u8, u8)) -> [u8; 2] where U: 'a {
    fn inner() {}
    let P { x, .. } = P { x: a };
    let _w: _ = a;
    match x { 0 => [x, a], _ => [a, x] }
}
