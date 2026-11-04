#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::socketpair(-3, libc::SOCK_STREAM, 0, p.as_mut_ptr()); } }
