#![feature(rustc_attrs)]
#![allow(dead_code, internal_features)]
#[rustc_force_inline]
#[cold]
fn f() {}
#[rustc_force_inline]
fn ok() {}
fn main() { ok(); }
