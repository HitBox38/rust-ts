#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let mut b = [0u8; 1]; libc::read(p[1], b.as_mut_ptr().cast(), 1); } }
