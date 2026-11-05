// Shim bodies that stored one `Place` in two positions (lane mir-alias). Checked only through the collector (driver.ts with
// RUST_TS_ALIAS_MONO=1): no pass in `make_shim`'s list renames a local, and `Inline` clones the callee, so no output shows it.
// - `build_fn_ptr_as_ptr_shim`: `raw_ptr`, reached through `fn_addr_eq` -> `FnPtr::addr`.
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

// Review mir-alias F1, F3: each reaches a clone site no other program did: match_branches' unify_by_int_to_int and both of
// unify_by_copy's, promote_consts' BorrowKind, by_move_body's annotations.
#[repr(u8)]
pub enum EnumAu8 { U0 = 0, U127 = 127, U128 = 128, U255 = 255 }
pub fn match_u8_i8(i: EnumAu8) -> i8 {
    match i { EnumAu8::U0 => 0, EnumAu8::U127 => 127, EnumAu8::U128 => -128, EnumAu8::U255 => -1 }
}
pub fn match_option(i: &Option<i32>) -> Option<i32> {
    match i { Some(_) => *i, None => None }
}
pub fn promoted_mut() -> &'static mut [u8] { &mut [] }
pub fn by_move<'a>(y: &'a i32) -> impl AsyncFn() + 'a { async move || { let z: &'a i32 = y; let _ = z; } }
