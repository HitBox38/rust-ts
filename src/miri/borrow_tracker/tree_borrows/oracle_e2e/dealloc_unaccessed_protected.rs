// miri-flags: -Zmiri-tree-borrows
// review miri-tb-b finding 1: `dealloc`'s strong protector check reads `perm.accessed`. A protected `&mut [u8; 0]` never
// accessed the location, so deallocating under it is fine.
use std::alloc::{alloc, dealloc, Layout};
unsafe fn f(_x: &mut [u8; 0], p: *mut u8, layout: Layout) { dealloc(p, layout); eprintln!("dealloc passed"); }
fn main() { unsafe {
    let layout = Layout::from_size_align(4, 1).unwrap();
    let p = alloc(layout);
    p.write_bytes(0, 4);
    f(&mut *(p as *mut [u8; 0]), p, layout);
    eprintln!("done");
} }
