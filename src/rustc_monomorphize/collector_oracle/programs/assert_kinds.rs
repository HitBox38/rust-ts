//@ edition: 2021
//@ compile-flags: -Cdebug-assertions=yes -Zmir-enable-passes=+CheckEnums
// `Assert` terminators: bounds, overflow, division, alignment, null and enum checks each name their own panic lang item.
#![crate_type = "lib"]
#[repr(u8)] pub enum E { A = 1, B = 2 }
pub fn bounds(a: &[u32], i: usize) -> u32 { a[i] }
pub fn overflow(a: u32, b: u32) -> u32 { a + b }
pub fn neg(a: i32) -> i32 { -a }
pub fn div(a: u32, b: u32) -> u32 { a / b }
pub fn rem(a: u32, b: u32) -> u32 { a % b }
pub fn shl(a: u32, b: u32) -> u32 { a << b }
pub unsafe fn deref(p: *const u32) -> u32 { *p }
pub unsafe fn null_ref(p: *const u32) -> &'static u32 { &*p }
pub unsafe fn en(x: u8) -> E { std::mem::transmute(x) }
