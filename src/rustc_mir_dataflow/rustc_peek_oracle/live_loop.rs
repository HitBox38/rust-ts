#![feature(core_intrinsics, rustc_attrs)]
use std::intrinsics::rustc_peek;
fn f(x: i32) -> i32 { x }
#[rustc_mir(rustc_peek_liveness, stop_after_dataflow)]
fn foo(n: i32) -> i32 {
    let mut x = 0;
    let mut y = 1;
    let mut i = 0;
    rustc_peek(y);
    while i < n {
        rustc_peek(x);
        x = f(x + y);
        y = 3;
        i = i + 1;
    }
    let z = f(y);
    rustc_peek(z);
    rustc_peek(i);
    x + z
}
fn main() {}
