// A wildcard access hitting a protector: the accessed tag prints as `<wildcard>`.
fn f(x: &mut u8, addr: usize) {
    *x = 1;
    unsafe { *(addr as *mut u8) = 2 };
}

fn main() {
    let v = &mut 0u8;
    let p = v as *mut u8;
    let addr = p as usize;
    f(unsafe { &mut *p }, addr);
}
