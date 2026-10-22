#![allow(dead_code, unused_variables)]
fn foo() {}
fn bar(x: u32, y: u8) -> u32 { x }
unsafe fn baz<T>(t: T) {}
extern "C" fn ext(x: u32) {}
fn take<T: std::fmt::Pointer>(t: T) {}
fn main() {
    take(&foo);
    take(&bar);
    take(&baz::<u8>);
    take(&ext);
    let _: usize = unsafe { std::mem::transmute(&foo) };
}
