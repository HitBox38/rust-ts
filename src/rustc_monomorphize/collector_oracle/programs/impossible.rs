//@ edition: 2021
//@ compile-flags: -Clink-dead-code
// `is_instantiable`: items whose predicates cannot hold are no roots, and the eager strategy skips their impls and ADTs.
#![crate_type = "lib"]
#![feature(trivial_bounds)]
#![allow(trivial_bounds, dead_code)]
pub fn impossible<'a>(s: &'a mut ()) where &'a mut (): Clone { let _ = <&mut () as Clone>::clone(&s); }
pub trait Tr { fn a(&self) {} }
pub struct S;
impl Tr for S where u32: Iterator {}
pub struct NoDrop(Vec<u8>) where String: Copy;
pub fn fine() {}
