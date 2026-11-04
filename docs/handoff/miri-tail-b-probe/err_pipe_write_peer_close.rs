#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let b = vec![0u8; 0x34000]; libc::write(p[1], b.as_ptr().cast(), b.len()); let r = p[0]; let t = std::thread::spawn(move || { libc::close(r); }); libc::write(p[1], b.as_ptr().cast(), 1); t.join().unwrap(); } }
