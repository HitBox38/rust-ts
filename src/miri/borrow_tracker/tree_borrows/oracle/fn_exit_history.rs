// A history event of a protector release ("on every location previously accessed by this tag"): the write on protector
// end disables a tag that is lazy on the first element.
fn f(first: &mut i32, base: *mut i32) -> *mut i32 {
    *first = 42;
    unsafe { (&mut *(base.wrapping_add(1))) as *mut i32 }.wrapping_sub(1)
}

fn main() {
    let mut v = [0, 1];
    let base = v.as_mut_ptr();
    let first = unsafe { &mut *base };
    let lazy = f(first, base);
    let _val = unsafe { *lazy };
}
