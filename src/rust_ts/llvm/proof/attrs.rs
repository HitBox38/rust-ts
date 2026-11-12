#![crate_type = "lib"]
// Range and dead_on_return attributes (rustc emits them at -Copt-level=1 and up), on definitions and on call sites.
pub struct Big([u64; 8]);
#[inline(never)]
pub fn r_char(c: char) -> char {
    c
}
#[inline(never)]
pub fn r_slice(s: &[u32]) -> usize {
    s.len()
}
#[inline(never)]
pub fn r_big(b: Big) -> u64 {
    b.0[3]
}
pub fn caller(c: char, s: &[u32], b: Big) -> u64 {
    r_char(c) as u64 + r_slice(s) as u64 + r_big(b)
}
