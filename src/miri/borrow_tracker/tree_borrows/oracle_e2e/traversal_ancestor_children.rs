// miri-flags: -Zmiri-tree-borrows
// review fixers-38 F1: which protected tag is reported depends on the order an ancestor's other children are pushed
// (tree_visitor.ts): two siblings at one level below a common ancestor.
use std::ptr;
#[inline(never)]
unsafe fn f(a: &mut u8, b: &mut u8, q: *mut u8) { let _ = (&a, &b); ptr::write(q, 1); }
fn main() { unsafe { let mut x = 0u8; let p: *mut u8 = &mut x; let q: *mut u8 = &mut *p; f(&mut *p, &mut *p, q); } }
