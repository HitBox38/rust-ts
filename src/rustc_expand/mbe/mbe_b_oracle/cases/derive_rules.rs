#![feature(macro_derive)]
macro_rules! d1 {
    derive() (struct $name:ident;) => { impl $name {} };
    derive() ($($t:tt)*) => { fn other() {} };
}
macro_rules! d2 { derive(x) () => {} }
macro_rules! d3 { derive => {} }
macro_rules! d4 { derive[] () => {} }
macro_rules! d5 { unsafe derive() () => {} }
macro_rules! d6 { derive }
macro_rules! d7 { derive() }
macro_rules! d8 { derive(x) => {} }
#[mbe_derive(d1)]
struct S;
#[mbe_derive(d1)]
enum E {}
macro_rules! d9 { derive() (struct A;) => {} }
#[mbe_derive(d9)]
struct B;
