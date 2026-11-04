// ProtectedDealloc: deallocating through a strongly protected tag itself (a child write, so its permission survives).
use std::alloc::{alloc, dealloc, Layout};

unsafe fn f(x: &mut u8, layout: Layout) {
    dealloc(x as *mut u8, layout);
}

fn main() {
    unsafe {
        let layout = Layout::new::<u8>();
        let p = alloc(layout);
        f(&mut *p, layout);
    }
}
