#![feature(no_core)]
#![no_core]
pub struct S<'a, T> {
    pub a: &'a T,
    b: (u8, i32),
}
macro_rules! m {
    ($x:expr) => { $x };
}
pub extern "C" fn g() -> u32 {
    1 + 2u32
}
