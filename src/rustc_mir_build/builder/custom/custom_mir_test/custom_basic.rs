// lane mb-custom-tail: `#[custom_mir]` bodies built by builder/custom (no constants: `as_constant_inner` is lane
// mb-expr-a's).
#![feature(custom_mir, core_intrinsics)]
#![allow(internal_features)]
#![crate_type = "lib"]
extern crate core;
use core::intrinsics::mir::*;

pub struct S {
    pub a: i32,
    pub b: u8,
}

pub enum E {
    A(i32),
    B,
}

#[custom_mir(dialect = "built")]
pub fn simple(x: i32) -> i32 {
    mir! {
        let temp: i32;
        {
            temp = x;
            Goto(bb1)
        }
        bb1 = {
            RET = temp;
            Return()
        }
    }
}

#[custom_mir(dialect = "analysis", phase = "post-cleanup")]
pub fn rvalues(x: i32, y: i32, p: *const i32) -> (i32, i32) {
    mir! {
        let r: &i32;
        let rp: *const i32;
        let s: i32;
        let n: bool;
        let c: i64;
        let sb: u8;
        let st: S;
        let ck: (i32, bool);
        let q: *const i32;
        debug x => x;
        debug r => r;
        {
            StorageLive(r);
            r = &x;
            rp = &raw const y;
            s = x + y;
            n = x == y;
            n = !n;
            c = x as i64;
            sb = s as u8;
            st = S { a: x, b: sb };
            ck = Checked(x + y);
            q = Offset(p, s);
            StorageDead(r);
            RET = (x, st.a);
            Return()
        }
    }
}

#[custom_mir(dialect = "runtime", phase = "optimized")]
pub fn control(x: i32, e: E) -> i32 {
    mir! {
        let d: isize;
        {
            d = Discriminant(e);
            match d {
                0 => bb1,
                1 => bb2,
                _ => bb3,
            }
        }
        bb1 = {
            RET = Move(x);
            Goto(bb4)
        }
        bb2 = {
            RET = x;
            Goto(bb4)
        }
        bb3 = {
            Unreachable()
        }
        bb4 = {
            Return()
        }
        bb5(cleanup) = {
            UnwindResume()
        }
    }
}

#[custom_mir(dialect = "runtime", phase = "initial")]
pub fn places(t: &mut (i32, i32), v: &[i32], i: usize, b: Box<S>) -> i32 {
    mir! {
        {
            (*t).0 = (*v)[i];
            (*t).1 = Move((*b).a);
            RET = (*t).0;
            Drop(b, ReturnTo(bb1), UnwindCleanup(bb2))
        }
        bb1 = {
            Return()
        }
        bb2(cleanup) = {
            UnwindResume()
        }
    }
}
