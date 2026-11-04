//@ edition: 2021
//@ compile-flags: -Zforce-intrinsic-fallback
// -Zforce-intrinsic-fallback: fallback bodies even of the intrinsics the backend replaces.
#![crate_type = "lib"]
#![feature(core_intrinsics)]
#![allow(internal_features)]
pub fn f(x: u32, y: u32) -> u32 { (unsafe { std::intrinsics::disjoint_bitor(x, y) }) + x.rotate_left(1) + std::intrinsics::ctlz(x) }
