// Shim bodies that stored one `Place` in two positions (lane mir-alias). Checked only through the collector (driver.ts with
// RUST_TS_ALIAS_MONO=1): no pass in `make_shim`'s list renames a local, and `Inline` clones the callee, so no output shows it.
// - `build_fn_ptr_addr_shim`: `raw_ptr`, reached through `fn_addr_eq` -> `FnPtr::addr`.
// - `build_adrop_for_adrop_shim`: `cor_ref_place` and `cor_pin_place`, reached when a future's async drop glue is itself
//   dropped asynchronously (as tests/ui/async-await/async-drop/ex-ice-132103.rs).
#![feature(async_drop)]
#![allow(incomplete_features)]

use core::future::{Future, async_drop_in_place};
use core::mem::MaybeUninit;
use core::pin::pin;
use core::task::{Context, Waker};

async fn test_async_drop<T>(x: T) {
    let mut x = MaybeUninit::new(x);
    pin!(unsafe { async_drop_in_place(&mut *x.as_mut_ptr()) });
}

fn main() {
    let f: fn() = main;
    let _ = std::ptr::fn_addr_eq(f, f);
    let waker = Waker::noop();
    let mut cx = Context::from_waker(&waker);
    let fut = pin!(async {
        test_async_drop(test_async_drop(0)).await;
    });
    let _ = fut.poll(&mut cx);
}
