#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); libc::lseek(p[0], 0, libc::SEEK_SET); } }
