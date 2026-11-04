// A wildcard deallocation with a strongly protected tag in the allocation: `<wildcard>` in the dealloc error.
use std::alloc::{alloc, dealloc, Layout};

unsafe fn f(x: &mut u8, addr: usize, layout: Layout) {
    let _val = *x;
    dealloc(addr as *mut u8, layout);
}

fn main() {
    unsafe {
        let layout = Layout::new::<u8>();
        let p = alloc(layout);
        *p = 0;
        let addr = p as usize;
        f(&mut *p, addr, layout);
    }
}
