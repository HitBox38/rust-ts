// A `PtrToPtr` cast from a non-pointer (TypeChecker, `check_kinds!`).
#![feature(custom_mir, core_intrinsics)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

#[custom_mir(dialect = "built")]
pub fn f(x: usize) -> *const u8 {
    mir! {
        {
            RET = CastPtrToPtr(x);
            Return()
        }
    }
}
