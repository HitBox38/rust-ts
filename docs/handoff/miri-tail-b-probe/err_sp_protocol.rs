#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 7, p.as_mut_ptr()); } }
