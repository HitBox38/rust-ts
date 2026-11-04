//@ edition: 2021
//@ compile-flags: -Copt-level=2
// MIR inlining removes uses, while "mentioned" items stay; `#[inline]` items are LocalCopy.
#![crate_type = "lib"]
#[inline] fn small(x: u32) -> u32 { x + 1 }
fn gen_fn<T>(_: T) -> u32 { small(1) }
#[inline(never)]
#[no_mangle]
pub fn f(b: bool) -> u32 {
    if b { gen_fn(1u8) } else { gen_fn("x") + small(2) }
}
