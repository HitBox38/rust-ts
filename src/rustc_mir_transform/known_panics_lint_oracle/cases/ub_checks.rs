// CheckAlignment / CheckNull / CheckEnums on raw pointer accesses and transmutes into enums
// (known_panics_lint.oracle.test.ts, `KPL_ORACLE_UB_PASSES=1`).
#![crate_type = "lib"]
#![feature(custom_mir, core_intrinsics)]
#![allow(internal_features)]

use core::intrinsics::mir::*;

pub unsafe fn read(p: *const u32) -> u32 {
    *p
}
pub unsafe fn write(p: *mut u64, v: u64) {
    *p = v;
}
pub unsafe fn byte(p: *const u8) -> u8 {
    *p
}
pub unsafe fn field(p: *const (u8, u32)) -> &'static u32 {
    &(*p).1
}
#[repr(u8)]
pub enum E { A = 1, B = 3 }
// `transmute` calls are `Transmute` casts only after `LowerIntrinsics` (runtime cleanup), so the enum cases are custom
// MIR in the runtime dialect.
#[custom_mir(dialect = "runtime", phase = "initial")]
pub unsafe fn to_e(x: u8) -> E {
    mir! {
        {
            RET = CastTransmute(x);
            Return()
        }
    }
}
#[custom_mir(dialect = "runtime", phase = "initial")]
pub unsafe fn to_opt(x: u8) -> Option<bool> {
    mir! {
        {
            RET = CastTransmute(x);
            Return()
        }
    }
}
pub enum D { A(u8), B(u16) }
#[custom_mir(dialect = "runtime", phase = "initial")]
pub unsafe fn to_d(x: u32) -> D {
    mir! {
        {
            RET = CastTransmute(x);
            Return()
        }
    }
}
pub enum Never {}
#[custom_mir(dialect = "runtime", phase = "initial")]
pub unsafe fn to_never(x: ()) -> Never {
    mir! {
        {
            RET = CastTransmute(x);
            Return()
        }
    }
}
pub unsafe fn null_borrow(p: *mut u16) -> &'static mut u16 {
    &mut *p
}
pub unsafe fn zst(p: *const ()) -> () {
    *p
}
