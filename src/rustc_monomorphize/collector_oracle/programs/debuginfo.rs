//@ edition: 2021
//@ compile-flags: -g
// `-g` is DebugInfo::Full: the collector walks `var_debug_info`, whose constants can hold pointers to items.
#![crate_type = "lib"]
fn in_debuginfo() {}
#[inline(never)] fn sink<T>(_: T) {}
pub fn f() {
    let unused_fn_ptr: fn() = in_debuginfo;
    let unused_ref = &7u32;
    sink(1u8);
    let _ = (unused_fn_ptr, unused_ref);
}
