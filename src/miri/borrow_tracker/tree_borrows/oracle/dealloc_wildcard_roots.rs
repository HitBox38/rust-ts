// A wildcard deallocation with two wildcard subtrees, each holding an exposed, strongly protected tag. The second retag
// conflicts the first tag, which so cannot write: the access is foreign to it, and the report shows that history event.
use std::alloc::{alloc, dealloc, Layout};

unsafe fn f(x: &mut u8, y: &mut u8, addr: usize, layout: Layout) {
    let _exposed = x as *mut u8 as usize;
    let _exposed = y as *mut u8 as usize;
    dealloc(addr as *mut u8, layout);
}

fn main() {
    unsafe {
        let layout = Layout::new::<u8>();
        let p = alloc(layout);
        *p = 0;
        let addr = p as usize;
        let a = &mut *(addr as *mut u8);
        let b = &mut *(addr as *mut u8);
        f(a, b, addr, layout);
    }
}
