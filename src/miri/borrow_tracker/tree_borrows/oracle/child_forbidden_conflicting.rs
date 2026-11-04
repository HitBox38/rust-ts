// ChildAccessForbidden on a parent of the accessed tag: a child write through a Frozen parent.
#![allow(invalid_reference_casting)]

fn main() {
    unsafe {
        let x = &mut 0u8;
        let y = &*x;
        let z = &mut *(y as *const u8 as *mut u8);
        *z = 1;
    }
}
