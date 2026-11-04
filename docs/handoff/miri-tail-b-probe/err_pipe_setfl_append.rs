#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); libc::fcntl(p[0], libc::F_SETFL, libc::O_APPEND); } }
