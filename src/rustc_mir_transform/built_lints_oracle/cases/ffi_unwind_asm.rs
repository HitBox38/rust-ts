#![warn(ffi_unwind_calls)]
#![allow(dead_code)]
use std::arch::asm;
fn f() { unsafe { asm!("", options(may_unwind)); asm!(""); } }
fn main() {}
