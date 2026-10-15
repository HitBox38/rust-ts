#![feature(extern_item_impls)]
#![allow(incomplete_features, internal_features, dead_code)]

#[eii(foo)]
fn x(a: u64) -> u64;

#[foo]
fn y(a: u64) -> u64 {
    a
}

fn main() {}
