//@ edition: 2021
// `TailCall` terminators; a tail call to `#[track_caller]` collects the callee as a reified shim.
#![crate_type = "lib"]
#![feature(explicit_tail_calls)]
#![allow(incomplete_features, tail_call_track_caller)] // the lint is emitted by codegen (rustc_codegen_ssa, M7)
#[track_caller] fn tracked(x: u32) -> u32 { std::panic::Location::caller().line() + x }
fn plain(x: u32) -> u32 { x }
pub fn a(x: u32) -> u32 { become tracked(x) }
pub fn b(x: u32) -> u32 { become plain(x) }
