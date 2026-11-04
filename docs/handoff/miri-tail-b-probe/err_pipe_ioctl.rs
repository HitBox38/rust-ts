#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let mut v = 1i32; libc::ioctl(p[0], libc::FIONBIO, &mut v); } }
