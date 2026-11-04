//@ edition: 2021
//@ compile-flags: --crate-type=dylib
// A dylib: exported generics and non-generic reachable items; `#[used]`, `#[no_mangle]`, a thread-local shim user.
use std::cell::Cell;
thread_local! { static TL: Cell<u32> = const { Cell::new(0) }; }
#[used] static KEEP: fn() = kept;
fn kept() {}
#[no_mangle] pub extern "C" fn exported() -> u32 { TL.with(|c| c.get()) }
pub fn generic<T: Default>() -> T { T::default() }
#[inline] pub fn inlined() -> u32 { generic::<u32>() }
