// `compute_inlined_overlap` (docs/reviews/mono-wire.md W3) at `-Ccodegen-units=2`, and `-Zcodegen-source-order` (W2).
// `top` is the biggest, then `dst`, the first merge's destination. `dst` overlaps two CGUs:
// - `one_big`: one inlined item, the biggest overlap by size, so it is the one merged;
// - `two_small`: two small inlined items, the most items, which is what counting items instead of size would pick.
// `dst` then outgrows `top` by more than `two_small` weighs, so `two_small` goes into `top`. A wrong pick stays with `dst`.
#![crate_type = "lib"]
#![no_std]

macro_rules! x5 { ($v:ident) => { $v ^= 1; $v ^= 2; $v ^= 3; $v ^= 4; $v ^= 5; } }

#[inline(always)]
fn big(x: u32) -> u32 {
    let mut v = x;
    x5!(v); x5!(v); x5!(v);
    v
}

#[inline(always)]
fn small1(x: u32) -> u32 {
    let mut v = x;
    v ^= 1;
    v
}

#[inline(always)]
fn small2(x: u32) -> u32 {
    let mut v = x;
    v ^= 2;
    v
}

pub mod top {
    pub fn zed(x: u32) -> u32 {
        let mut v = x;
        x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod dst {
    pub fn zed(x: u32) -> u32 {
        super::small2(super::small1(super::big(x)))
    }
    pub fn alpha(x: u32) -> u32 {
        let mut v = x;
        x5!(v); x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod one_big {
    pub fn f(x: u32) -> u32 {
        let mut v = super::big(x);
        x5!(v); x5!(v); x5!(v); x5!(v); x5!(v);
        v
    }
}

pub mod two_small {
    pub fn f(x: u32) -> u32 {
        let mut v = super::small2(super::small1(x));
        x5!(v);
        v
    }
}
