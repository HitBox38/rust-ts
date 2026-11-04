// ChildAccessForbidden on the accessed tag itself, at a non-zero offset, with a foreign write in its history.
extern "Rust" {
    fn miri_pointer_name(ptr: *const (), nth_parent: u8, name: &[u8]);
}

fn main() {
    unsafe {
        let data: &mut [u8; 8] = &mut [0; 8];
        let p = data.as_mut_ptr();
        let rmut = &mut *std::ptr::slice_from_raw_parts_mut(p, 6);
        miri_pointer_name(rmut.as_ptr() as *const (), 0, b"rmut");
        *p.add(5) = 1;
        rmut[5] += 1;
    }
}
