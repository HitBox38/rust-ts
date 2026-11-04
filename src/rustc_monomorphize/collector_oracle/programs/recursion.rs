//@ edition: 2021
//@ compile-flags: -Zwrite-long-types-to-disk=no
// RecursionLimit through check_recursion_limit.
#![crate_type = "lib"]
#![recursion_limit = "16"]
fn rec<T>(n: u32) { if n > 0 { rec::<Option<T>>(n - 1) } }
pub fn f() { rec::<u8>(1) }
