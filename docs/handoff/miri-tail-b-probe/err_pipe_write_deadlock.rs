#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let b = vec![0u8; 0x34001]; libc::write(p[1], b.as_ptr().cast(), b.len()); libc::write(p[1], b.as_ptr().cast(), b.len()); } }
