// A field projection whose type is not the field's (TypeChecker).
#![feature(custom_mir, core_intrinsics)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

pub enum E { A(u16, i64) }

#[custom_mir(dialect = "built")]
pub fn f(e: E) -> u8 {
    mir! {
        {
            RET = Field::<u8>(Variant(e, 0), 0);
            Return()
        }
    }
}
