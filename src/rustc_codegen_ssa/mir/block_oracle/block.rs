// Fixture of mir/block.test.ts (lane ssa-block): one `#[no_mangle]` fn per terminator shape the test drives through
// `codegen_block` over a mock backend. Built for the host (aarch64-apple-darwin) and for x86_64-pc-windows-msvc
// (funclets). block_oracle/README.md says how the expected sequences were read off the pinned rustc's IR.
#![feature(no_core, lang_items, auto_traits, rustc_attrs)]
#![allow(internal_features, unconditional_recursion, unused)]
#![crate_type = "lib"]
#![no_core]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
impl Copy for u16 {}
impl Copy for u32 {}
impl Copy for u64 {}
impl Copy for bool {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

#[lang = "drop"]
pub trait Drop {
    fn drop(&mut self);
}

#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
impl<T: PointeeSized> LegacyReceiver for &mut T {}

#[lang = "drop_glue"]
pub unsafe fn drop_glue<T: PointeeSized>(to_drop: *mut T) {
    unsafe { drop_glue(to_drop) }
}

#[lang = "add"]
pub trait Add<Rhs = Self> {
    type Output;
    fn add(self, rhs: Rhs) -> Self::Output;
}
impl Add for u32 {
    type Output = u32;
    fn add(self, rhs: u32) -> u32 {
        self + rhs
    }
}

#[lang = "panic_location"]
pub struct Location<'a> {
    file: &'a str,
    line: u32,
    col: u32,
}

#[lang = "panic_const_add_overflow"]
#[track_caller]
pub fn panic_const_add_overflow() -> ! {
    loop {}
}

#[lang = "panic_cannot_unwind"]
fn panic_cannot_unwind() -> ! {
    loop {}
}

#[lang = "panic_in_cleanup"]
fn panic_in_cleanup() -> ! {
    loop {}
}

pub struct Big(pub [u64; 4]);
impl Copy for Big {}
pub struct Three(pub u16, pub u16, pub u16);

unsafe extern "Rust" {
    fn callee(x: u32, b: Big) -> u32;
}

pub struct D(pub u32);
impl Drop for D {
    fn drop(&mut self) {}
}

// ---- SwitchInt ----
#[no_mangle]
pub fn sw_bool(b: bool) -> u32 {
    if b { 10 } else { 20 }
}
#[no_mangle]
pub fn sw_one(x: u32) -> u32 {
    match x {
        7 => 1,
        _ => 2,
    }
}
#[no_mangle]
pub fn sw_int(x: u32) -> u32 {
    match x {
        1 => 10,
        5 => 50,
        9 => 90,
        _ => 0,
    }
}

// ---- Return, per PassMode ----
#[no_mangle]
pub fn ret_direct(x: u32) -> u32 {
    x
}
#[no_mangle]
pub fn ret_pair(x: u32, y: u32) -> (u32, u32) {
    (x, y)
}
#[no_mangle]
pub fn ret_indirect(b: Big) -> Big {
    b
}
#[no_mangle]
pub fn ret_cast(t: Three) -> Three {
    t
}

// ---- Call: a direct and an indirect argument ----
#[no_mangle]
pub fn call_move(x: u32, b: Big) -> u32 {
    unsafe { callee(x, b) }
}
#[no_mangle]
pub fn call_copy(x: u32, b: &Big) -> u32 {
    unsafe { callee(x, *b) }
}

// ---- Drop ----
#[no_mangle]
pub fn drop_one(d: D) {}
#[no_mangle]
pub fn drop_two(a: D, b: D) {}

// ---- Assert (overflow) ----
#[no_mangle]
pub fn add_u32(a: u32, b: u32) -> u32 {
    a + b
}
