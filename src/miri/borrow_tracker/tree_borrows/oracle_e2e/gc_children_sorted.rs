// miri-flags: -Zmiri-tree-borrows -Zmiri-provenance-gc=1
// review miri-tb-b finding 2: printing sorts a node's children. Order only matters after the GC replaces a dead parent by a
// higher-numbered child.
use std::alloc::{alloc, Layout};
extern "Rust" {
    fn miri_get_alloc_id(ptr: *const ()) -> u64;
    fn miri_print_borrow_state(alloc_id: u64, show_unnamed: bool);
}
fn main() { unsafe {
    let p = alloc(Layout::new::<u8>());
    *p = 0;
    let id = miri_get_alloc_id(p as *const ());
    let mut a = &*p as *const u8;
    let b = &*p as *const u8;
    let a2 = &*a as *const u8;
    miri_print_borrow_state(id, true);
    a = std::ptr::null();
    for _ in 0..8 { std::hint::black_box(&a); }
    miri_print_borrow_state(id, true);
    let _ = (*b, *a2);
    std::alloc::dealloc(p, Layout::new::<u8>());
} }
