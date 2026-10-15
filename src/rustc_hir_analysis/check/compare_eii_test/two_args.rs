#![feature(extern_item_impls)]
#![allow(incomplete_features, internal_features, dead_code)]

#[eii(foo)]
fn x(a: u64, b: u64);

#[foo]
fn y(a: u64) {
    let _ = a;
}

fn main() {}
