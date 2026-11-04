// lane mono-partition: `-Zdump-mono-stats` with more than 20 definitions and ties in `total_estimate`, which the
// `sort_unstable_by_key` of `dump_mono_items_stats` orders by core's ipnsort, not stably.
#![crate_type = "lib"]

pub fn generic<T>(x: T) -> T {
    x
}

pub fn use_generic() -> (u8, u16, u32) {
    (generic(1), generic(2), generic(3))
}

pub struct Tied;

impl Tied {
    pub fn method(&self) {}
}

pub static A_STATIC: u32 = 1;

pub fn f00(x: u32) -> u32 {
    x
}

pub fn f01(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f02(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f03(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f04(x: u32) -> u32 {
    x
}

pub fn f05(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f06(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f07(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f08(x: u32) -> u32 {
    x
}

pub fn f09(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f10(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f11(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f12(x: u32) -> u32 {
    x
}

pub fn f13(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f14(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f15(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f16(x: u32) -> u32 {
    x
}

pub fn f17(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f18(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f19(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f20(x: u32) -> u32 {
    x
}

pub fn f21(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f22(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f23(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f24(x: u32) -> u32 {
    x
}

pub fn f25(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f26(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f27(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f28(x: u32) -> u32 {
    x
}

pub fn f29(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f30(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f31(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f32(x: u32) -> u32 {
    x
}

pub fn f33(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f34(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f35(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f36(x: u32) -> u32 {
    x
}

pub fn f37(x: u32) -> u32 {
    let _a = x ^ 1;
    x
}

pub fn f38(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}

pub fn f39(x: u32) -> u32 {
    let _a = x ^ 1;
    let _a = x ^ 1;
    let _a = x ^ 1;
    x
}
