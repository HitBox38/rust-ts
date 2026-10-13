#![feature(macro_attr)]
macro_rules! a1 {
    attr() ($($body:tt)*) => { $($body)* };
    attr(x) ($($body:tt)*) => { fn x() {} };
}
macro_rules! a2 { unsafe attr() ($i:item) => { $i } }
macro_rules! a3 { attr[] () => {} }
macro_rules! a4 { attr{x} () => {} }
macro_rules! a5 { attr }
macro_rules! a6 { attr() }
macro_rules! a7 { attr() ($e:expr $t:tt) => {} }
macro_rules! a8 { attr() () => {} () => {} }
#[a1]
struct S;
#[a1(x)]
struct T;
#[a1(y)]
struct U;
#[a2]
struct V;
#[unsafe(a2)]
struct W;
#[unsafe(a1)]
struct X;
