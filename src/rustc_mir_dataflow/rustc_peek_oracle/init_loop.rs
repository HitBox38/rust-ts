#![feature(core_intrinsics, rustc_attrs)]
use std::intrinsics::rustc_peek;
struct S(i32);
fn make() -> S { S(1) }
fn take(_s: S) {}
#[rustc_mir(rustc_peek_maybe_init, stop_after_dataflow)]
fn foo(c: bool, n: i32) {
    let mut a: S;
    let b: S;
    let mut i = 0;
    a = make();
    unsafe { rustc_peek(&a); }
    while i < n {
        if c { take(a); a = make(); } else { unsafe { rustc_peek(&a); } }
        i = i + 1;
    }
    unsafe { rustc_peek(&a); }
    unsafe { rustc_peek(&b); }
    b = S(2);
    unsafe { rustc_peek(&b); }
    take(b);
    unsafe { rustc_peek(&b); }
    let t = (make(), make());
    take(t.0);
    unsafe { rustc_peek(&t.0); }
    unsafe { rustc_peek(&t.1); }
    unsafe { rustc_peek(&t); }
}
fn main() {}
