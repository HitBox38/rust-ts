#![warn(ffi_unwind_calls)]
#![allow(dead_code)]
extern "C-unwind" { fn ext(); }
extern "C" { fn ext2(); }
fn f() { unsafe { ext(); ext2(); } }
fn g(p: extern "C-unwind" fn()) { p() }
fn main() {}
