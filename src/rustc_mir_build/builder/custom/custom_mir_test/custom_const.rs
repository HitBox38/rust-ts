// lane mb-custom-tail: a `#[custom_mir]` body with integer literals (`Field(Variant(e, 0), 0)`): `parse_integer_literal`
// goes through `as_constant_inner` (builder/expr/as_constant.rs, lane mb-expr-a), where this stops until that lands.
#![feature(custom_mir, core_intrinsics)]
#![allow(internal_features)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

pub enum E {
    A(i32),
    B,
}

#[custom_mir(dialect = "built")]
pub fn field(e: E) -> i32 {
    mir! {
        {
            RET = Field(Variant(e, 0), 0);
            Return()
        }
    }
}
