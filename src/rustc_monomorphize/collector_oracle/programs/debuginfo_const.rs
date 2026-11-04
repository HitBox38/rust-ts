//@ edition: 2021
//@ compile-flags: -g -Copt-level=1
// A constant moved into `var_debug_info` by a MIR pass: only DebugInfo::Full collects what it points at as "used".
#![crate_type = "lib"]
fn only_in_debuginfo() {}
const P: fn() = only_in_debuginfo;
#[no_mangle]
pub fn f() {
    let unused = P;
    let _ = &unused;
}
#[no_mangle]
pub fn g() {
    let dead = P;
}
