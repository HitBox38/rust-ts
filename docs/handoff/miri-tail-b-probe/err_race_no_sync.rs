#![feature(rustc_private)]
extern crate libc;
fn main() { unsafe { let mut p = [0; 2]; libc::pipe(p.as_mut_ptr()); let v = Box::leak(Box::new(0u64)) as *mut u64 as usize; let w = p[1]; let t = std::thread::spawn(move || { *(v as *mut u64) = 1; libc::close(w); }); std::thread::yield_now(); println!("{}", *(v as *mut u64)); t.join().unwrap(); } }
