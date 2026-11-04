// An error whose cause is a reborrow, from a Disabled parent.
fn main() {
    unsafe {
        let v = &mut 0u8;
        let p = v as *mut u8;
        let x = &mut *p;
        *p = 1;
        let _y = &*x;
    }
}
