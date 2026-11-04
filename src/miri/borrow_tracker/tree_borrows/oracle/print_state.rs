// Tree printing: ranges of different digit counts, nesting, names (with non-ASCII ones), hidden tags, protectors,
// exposed tags, wildcard subtrees and every permission's short name.
use std::cell::Cell;

extern "Rust" {
    fn miri_get_alloc_id(ptr: *const ()) -> u64;
    fn miri_print_borrow_state(alloc_id: u64, show_unnamed: bool);
    fn miri_pointer_name(ptr: *const (), nth_parent: u8, name: &[u8]);
}

unsafe fn name<T: ?Sized>(ptr: *const T, nth_parent: u8, s: &str) {
    miri_pointer_name(ptr as *const (), nth_parent, s.as_bytes());
}

fn main() {
    unsafe {
        ranges();
        structure();
        protectors(&mut 0u8, Box::new(0u8));
        exposed_and_wildcard();
        cells();
        names();
        wide_offsets();
    }
}

// Ranges split at offsets of 1, 2, 3 and 4 digits, and locations that were never accessed.
unsafe fn ranges() {
    let data: &mut [u8] = &mut [0; 1024];
    name(data.as_ptr(), 2, "data");
    name(data.as_ptr(), 2, "data");
    let alloc_id = miri_get_alloc_id(data.as_ptr() as *const ());
    let x = &mut data[1];
    name(x as *mut u8, 0, "data[1]");
    *x = 1;
    let x = &mut data[10];
    name(x as *mut u8, 0, "data[10]");
    *x = 1;
    let x = &mut data[100];
    name(x as *mut u8, 0, "data[100]");
    *x = 1;
    let _val = data[100];
    let x = &mut data[1000];
    name(x as *mut u8, 0, "data[1000]");
    *x = 1;
    miri_print_borrow_state(alloc_id, false);
    miri_print_borrow_state(alloc_id, true);
}

// Named and unnamed tags in a deeper tree: skipped tags' children attach to the nearest shown parent.
unsafe fn structure() {
    let x = &0u8;
    name(x, 0, "x");
    let alloc_id = miri_get_alloc_id(x as *const u8 as *const ());
    let a = &*x;
    name(a, 0, "a");
    let b = &*x;
    let ba = &*b;
    name(ba, 0, "ba");
    let baa = &*ba;
    let baaa = &*baa;
    name(baaa, 0, "baaa");
    let bb = &*b;
    name(bb, 0, "bb");
    let c = &*x;
    name(c, 0, "c");
    miri_print_borrow_state(alloc_id, false);
    miri_print_borrow_state(alloc_id, true);
    let _ = (a, baaa, bb, c);
}

// Strong and weak protectors.
unsafe fn protectors(strong: &mut u8, weak: Box<u8>) {
    name(strong as *mut u8, 0, "strong");
    miri_print_borrow_state(miri_get_alloc_id(strong as *mut u8 as *const ()), true);
    miri_print_borrow_state(miri_get_alloc_id(&*weak as *const u8 as *const ()), true);
}

// Exposed tags, and a tag with wildcard provenance (a wildcard subtree, shown after a gap line).
unsafe fn exposed_and_wildcard() {
    let v: &mut [u8; 2] = &mut [0; 2];
    let alloc_id = miri_get_alloc_id(v.as_ptr() as *const ());
    name(v.as_ptr(), 2, "v");
    let p = v.as_mut_ptr();
    let addr = p as usize;
    miri_print_borrow_state(alloc_id, true);
    let w = &mut *(addr as *mut [u8; 2]);
    name(w as *mut [u8; 2], 0, "w");
    let wc = &mut w[1];
    name(wc as *mut u8, 0, "wc");
    *wc = 1;
    miri_print_borrow_state(alloc_id, false);
    miri_print_borrow_state(alloc_id, true);
}

// Cell and ReservedIM, and a location with a conflicted `Reserved`.
unsafe fn cells() {
    let c = Cell::new(0u8);
    let r = &c;
    name(r, 0, "r");
    miri_print_borrow_state(miri_get_alloc_id(r as *const Cell<u8> as *const ()), true);
    let mut n = Cell::new(0u8);
    let m = &mut n;
    name(m as *mut Cell<u8>, 0, "m");
    miri_print_borrow_state(miri_get_alloc_id(m as *mut Cell<u8> as *const ()), true);
    conflicted(&mut 0u8);
}

unsafe fn conflicted(x: &mut u8) {
    let p = x as *mut u8;
    name(p, 0, "x");
    let y = &mut *p;
    name(y as *mut u8, 0, "y");
    let alloc_id = miri_get_alloc_id(p as *const ());
    miri_print_borrow_state(alloc_id, false);
    let z = &*p;
    let _val = *z;
    name(z, 0, "z");
    miri_print_borrow_state(alloc_id, false);
}

// Width counts `char`s: names beyond the BMP and a name wider than every other line.
unsafe fn names() {
    let x = &0u8;
    let alloc_id = miri_get_alloc_id(x as *const u8 as *const ());
    name(x, 0, "π🦀");
    name(x, 0, "a name that is much wider than the warning line of the tree printing, by a good margin");
    miri_print_borrow_state(alloc_id, false);
}

// Range ends wider than a permission cell: the body cells get padded, as does the gap line of a wildcard subtree.
unsafe fn wide_offsets() {
    let v: &mut [u8; 200000] = &mut [0; 200000];
    let alloc_id = miri_get_alloc_id(v.as_ptr() as *const ());
    let p = v.as_mut_ptr();
    let x = &mut *p.add(12345);
    name(x as *mut u8, 0, "x");
    *x = 1;
    let addr = p.add(123456) as usize;
    let w = &mut *(addr as *mut u8);
    name(w as *mut u8, 0, "w");
    *w = 1;
    miri_print_borrow_state(alloc_id, false);
}
