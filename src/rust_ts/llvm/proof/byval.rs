#![crate_type = "lib"]
// A struct passed by value under the C ABI (`byval`), and returned through `sret`.
#[repr(C)]
pub struct S {
    pub a: u64,
    pub b: u32,
    pub c: [u8; 20],
}
pub extern "C" fn take(s: S) -> u64 {
    s.a + s.b as u64 + s.c[3] as u64
}
pub extern "C" fn give(a: u64) -> S {
    S { a, b: 1, c: [7; 20] }
}
