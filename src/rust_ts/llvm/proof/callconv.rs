#![crate_type = "lib"]
#![feature(rust_cold_cc)]
// Non-C calling conventions on definitions and call sites: win64cc, preserve_mostcc (`extern "rust-cold"`).
#[inline(never)]
pub extern "win64" fn w(x: u32) -> u32 {
    x ^ 1
}
#[inline(never)]
pub extern "rust-cold" fn cold(x: u32) -> u32 {
    x | 2
}
pub fn call_all(x: u32) -> u32 {
    w(x) & cold(x)
}
