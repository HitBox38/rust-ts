// Derives without a prelude: every derive path is unresolved.
#![feature(rustc_attrs, decl_macro)]
#[rustc_builtin_macro]
macro derive($item:item) {}
#[derive(Clone, Copy)]
struct S;
#[derive(not_a_macro)]
#[helper]
struct T;
macro_rules! bang { () => {} }
#[derive(bang)]
struct U;
