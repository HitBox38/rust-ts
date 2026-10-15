#![feature(extern_item_impls)]
#![allow(incomplete_features, internal_features, dead_code)]

#[eii(hello)]
static HELLO: u64;

#[hello]
static HELLO_IMPL: bool = true;

fn main() {

}
