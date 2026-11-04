#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe2(p.as_mut_ptr(), libc::O_NONBLOCK | libc::O_DIRECT); } }
