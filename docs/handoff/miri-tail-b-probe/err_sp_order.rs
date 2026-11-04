#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::socketpair(-1, libc::SOCK_DGRAM, 7, p.as_mut_ptr()); } }
