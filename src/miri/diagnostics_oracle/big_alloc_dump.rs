// A UB report whose allocation dump (`report_error`'s `eprint!("{extra}")`) is larger than a pipe's buffer: the text after
// it must land after it. 32 KiB of bytes is about 150 KiB of dump, over the 64 KiB of a macOS or Linux pipe.
use std::alloc::{alloc, dealloc, Layout};

fn main() {
    unsafe {
        let layout = Layout::from_size_align(32 * 1024, 8).unwrap();
        let p = alloc(layout);
        p.write_bytes(0x55, 32 * 1024 - 1);
        let last = p.add(32 * 1024 - 1).read();
        println!("{last}");
        dealloc(p, layout);
    }
}
