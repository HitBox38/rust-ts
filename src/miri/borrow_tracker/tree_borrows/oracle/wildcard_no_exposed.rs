// A wildcard access with no exposed tag allowing it.
fn main() {
    unsafe {
        let v = &mut 0u8;
        let p = v as *mut u8;
        let x = &mut *p;
        let addr = x as *mut u8 as usize;
        *p = 1;
        *(addr as *mut u8) = 2;
    }
}
