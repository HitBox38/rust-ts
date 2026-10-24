// `SwitchInt` with a duplicated value (CfgChecker).
#![feature(custom_mir, core_intrinsics)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

#[custom_mir(dialect = "built")]
pub fn f(x: u8) -> u8 {
    mir! {
        {
            match x {
                1 => a,
                1 => b,
                _ => c,
            }
        }
        a = {
            RET = 1;
            Return()
        }
        b = {
            RET = 2;
            Return()
        }
        c = {
            RET = 3;
            Return()
        }
    }
}
