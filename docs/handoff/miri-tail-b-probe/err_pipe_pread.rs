#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let mut b = [0u8; 1]; libc::pread(p[0], b.as_mut_ptr().cast(), 1, 0); } }
