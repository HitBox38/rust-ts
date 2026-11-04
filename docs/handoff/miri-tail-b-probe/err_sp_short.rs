#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0i32; 1]; libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, p.as_mut_ptr()); } }
