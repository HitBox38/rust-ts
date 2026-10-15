#![feature(extern_item_impls)]
#![allow(incomplete_features, internal_features, dead_code)]

#[eii(foo)]
fn x();

#[foo]
fn y(a: u64) -> u64 {
    //~^ ERROR E0806
    a
}

fn main() {}
