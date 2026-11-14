// The oracle crate of va_arg.test.ts (lane ir-fix-a): c-variadic functions reading each kind of `VaArgSafe` argument through
// `VaList::arg`, which lowers to `emit_va_arg` (va_arg.rs:1053); on x86_64-unknown-linux-gnu, `emit_x86_64_sysv64_va_arg`'s
// integer, pointer and float register paths and the memory path.
#![crate_type = "lib"]

use std::ffi::{c_char, c_double, c_int, c_long, c_uint, c_ulonglong};

#[no_mangle]
pub unsafe extern "C" fn va_int(n: c_int, mut ap: ...) -> c_int {
    let mut s = 0;
    for _ in 0..n {
        s += ap.next_arg::<c_int>();
    }
    s
}

#[no_mangle]
pub unsafe extern "C" fn va_mixed(mut ap: ...) -> c_double {
    let a = ap.next_arg::<c_uint>();
    let b = ap.next_arg::<c_double>();
    let c = ap.next_arg::<c_long>();
    let d = ap.next_arg::<c_ulonglong>();
    let p = ap.next_arg::<*const c_char>();
    let u = ap.next_arg::<usize>();
    a as c_double + b + c as c_double + d as c_double + *p as c_double + u as c_double
}
