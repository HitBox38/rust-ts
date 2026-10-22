#![feature(core_intrinsics, rustc_attrs)]
use std::intrinsics::rustc_peek;
struct D(i32);
impl Drop for D { fn drop(&mut self) {} }
enum E { A(D), B(D, D), C }
fn take(_d: D) {}
#[rustc_mir(rustc_peek_maybe_uninit, rustc_peek_maybe_init, stop_after_dataflow)]
fn foo(e: E, x: D) {
    let y: D;
    match e {
        E::A(d) => { take(d); y = D(1); }
        E::B(d1, _) => { unsafe { rustc_peek(&d1); } y = d1; }
        E::C => { y = x; unsafe { rustc_peek(&x); } return; }
    }
    unsafe { rustc_peek(&x); }
    unsafe { rustc_peek(&y); }
    take(y);
    unsafe { rustc_peek(&y); }
}
fn main() {}
