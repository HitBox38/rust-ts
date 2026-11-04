#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { libc::pipe(std::ptr::null_mut()); } }
