//@ edition: 2021
//@ compile-flags: -Zmir-opt-level=0
// Unoptimized MIR keeps the temporaries: overlapping spans lint once (`MoveCheckVisitor::move_size_spans`).
#![crate_type = "lib"]
#![feature(large_assignments)]
#![move_size_limit = "1000"]
#![warn(large_assignments)]
pub fn overlap(a: [u8; 2000]) -> ([u8; 2000], u8) { let c = ({ let x = a; x }, 1u8); c }
