//@ edition: 2021
// Intrinsics: validity assertions pull in `panic_nounwind`; intrinsics with fallback bodies are collected.
#![crate_type = "lib"]
#![feature(core_intrinsics)]
#![allow(internal_features)]
use std::intrinsics;
pub fn validity<T>() -> T { unsafe { std::mem::zeroed() } }
pub fn z() -> u32 { validity::<u32>() }
pub fn u() -> u8 { unsafe { std::mem::MaybeUninit::uninit().assume_init() } }
pub fn fallback(x: u32, y: u32) -> u32 { intrinsics::carrying_mul_add(x, y, 0, 0).0 + unsafe { intrinsics::disjoint_bitor(x, y) } }
pub fn plain(x: u32) -> u32 { x.rotate_left(3) + intrinsics::ctlz(x) }
