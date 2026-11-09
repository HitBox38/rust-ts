// fixers-50: ties between async blocks whose hashes hold the Symbols of two upvars and the variant names, in FxHashSet order.
// Generated (scratch gen2.ts, seed 777, case h18). See ../../code_stats.oracle.test.ts.
use std::future::Future;
pub fn mk<T: Copy, U: Copy>(wibble: T, a_18: U) -> impl Future<Output = (T, U)> { async move { (wibble, a_18) } }
pub fn f0(x: u8, y: [u16; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f1(x: [u8; 3], y: [u8; 5]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f2(x: [u32; 3], y: [u8; 6]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f3(x: u8, y: [u16; 2]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f4(x: [u16; 2], y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f5(x: [u8; 5], y: u16) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f6(x: [u16; 3], y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f7(x: u16, y: u8) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f8(x: u16, y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f9(x: u32, y: [u8; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f10(x: [u16; 3], y: u8) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f11(x: [u8; 7], y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f12(x: u8, y: u64) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f13(x: u32, y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f14(x: u32, y: [u8; 12]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f15(x: [u16; 2], y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f16(x: [u32; 3], y: [u8; 12]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f17(x: [u8; 12], y: u8) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f18(x: (u8, u16), y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f19(x: u64, y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f20(x: u16, y: [u16; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f21(x: (u8, u16), y: u8) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f22(x: [u16; 3], y: [u8; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f23(x: [u8; 6], y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f24(x: u16, y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
