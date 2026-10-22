// lane mb-custom-tail: a `#[custom_mir]` body builder/custom cannot parse (`span_fatal` "Could not parse ..." with the
// `{:?}` of the THIR expression kind).
#![feature(custom_mir, core_intrinsics)]
#![allow(internal_features)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

pub struct S {
    pub a: i32,
    pub b: u8,
}

#[custom_mir(dialect = "built")]
pub fn ok(x: i32) -> i32 {
    mir! {
        {
            RET = x;
            Return()
        }
    }
}

#[custom_mir(dialect = "built")]
pub fn bad(x: i32, s: i32) -> S {
    mir! {
        {
            RET = S { a: x, b: s as u8 };
            Return()
        }
    }
}
