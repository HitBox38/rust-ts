#![feature(no_core)]
#![no_core]
macro_rules! m { ($x:ident) => { fn $x() {} } }
macro_rules! n { ($($t:tt)*) => { m!(inner); $($t)* } }
macro_rules! nothing { () => {} }
macro_rules! dup { ($($t:tt)*) => { $($t)* $($t)* } }
m!(f0);
m!(f1);
m!(f2);
m!(f3);
m!(f4);
m!(f5);
m!(f6);
m!(f7);
m!(f8);
mod n0 { n!(m!(g0);); }
mod n1 { n!(m!(g1);); }
mod n2 { n!(m!(g2);); }
dup!(nothing! {});
dup!(dup!(nothing!{}););
