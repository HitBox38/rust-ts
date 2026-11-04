// ProtectedDisabled: a foreign write to a protected, accessed tag.
fn f(x: &mut u8, y: *mut u8) {
    *x = 1;
    unsafe { *y = 2 };
}

fn main() {
    let v = &mut 0u8;
    let p = v as *mut u8;
    f(unsafe { &mut *p }, p);
}
