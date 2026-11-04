//@ edition: 2021
//@ compile-flags: -Copt-level=2
// Optimized MIR has no temporary before the call, so a moved argument reaches `check_fn_args_move_size` alone: no lint.
#![crate_type = "lib"]
#![feature(large_assignments)]
#![move_size_limit = "1000"]
#![warn(large_assignments)]
pub struct NotCopy(pub [u8; 2000]);
#[inline(never)] #[no_mangle] pub fn take_move(n: NotCopy) -> u8 { n.0[0] }
#[inline(never)] #[no_mangle] pub fn moved(n: NotCopy) -> u8 { take_move(n) + 1 }
#[inline(never)] #[no_mangle] pub fn take_copy(a: &[u8; 2000], b: [u8; 2000]) -> u8 { a[0] + b[1] }
#[inline(never)] #[no_mangle] pub fn copied(a: [u8; 2000]) -> u8 { take_copy(&a, a) + 1 }
