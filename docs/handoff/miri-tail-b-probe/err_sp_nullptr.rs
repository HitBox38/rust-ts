#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, std::ptr::null_mut()); } }
