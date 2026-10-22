// `UnwindResume` in a non-cleanup block (CfgChecker), built MIR.
#![feature(custom_mir, core_intrinsics)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

#[custom_mir(dialect = "built")]
pub fn f() {
    mir! {
        {
            UnwindResume()
        }
    }
}
