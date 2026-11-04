#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let w = p[1]; let t = std::thread::spawn(move || { libc::close(w); }); let mut b = [0u8; 1]; libc::read(p[0], b.as_mut_ptr().cast(), 1); t.join().unwrap(); } }
