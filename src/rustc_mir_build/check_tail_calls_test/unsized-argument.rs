// lane mb-custom-tail: the `report_unsized_argument` path of check_tail_calls.rs (after
// tests/ui/explicit-tail-calls/no-unsized-arguments.rs, without minicore), plus a `#[track_caller]` callee
// (accepted) and a tail call through a fn pointer.
#![feature(explicit_tail_calls, unsized_fn_params)]
#![expect(incomplete_features)]
#![allow(internal_features)]

fn unsized_argument(x: [u8]) -> u8 {
    let _ = x;
    0
}

fn vanilla(b: [u8]) -> u8 {
    become unsized_argument(b);
    //~^ ERROR unsized arguments cannot be used in a tail call
}

#[track_caller]
fn tc(x: u32) -> u32 {
    x
}

fn calls_tc(x: u32) -> u32 {
    become tc(x)
}

fn ptr(f: fn(u32) -> u32, x: u32) -> u32 {
    become f(x)
}

fn main() {
    let _ = vanilla;
    let _ = calls_tc;
    let _ = ptr;
}
