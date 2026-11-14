#![feature(raw_dylib_elf)]
#![allow(incomplete_features)]

#[link(name = "foo", kind = "raw-dylib")]
unsafe extern "C" {
    fn foo_fn() -> i32;
}

fn main() {
    unsafe {
        foo_fn();
    }
}
