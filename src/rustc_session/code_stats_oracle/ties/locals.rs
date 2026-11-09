// fixers-50: ties between async blocks whose hashes hold upvar, local and variant-name Symbols, in FxHashSet order.
// Generated (scratch gen2.ts, seed 777, case h50). See ../../code_stats.oracle.test.ts.
use std::future::Future;
async fn yld() {}
pub fn mk<T: Copy, U: Copy>(mumble: T, data_50: U) -> impl Future<Output = (T, U)> { async move { let waldo_l50 = data_50; yld().await; (mumble, waldo_l50) } }
pub fn f0(x: u32, y: u16) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f1(x: u16, y: [u8; 6]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f2(x: [u8; 5], y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f3(x: [u8; 3], y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f4(x: u16, y: u16) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f5(x: [u16; 2], y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f6(x: [u8; 5], y: [u16; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f7(x: [u16; 2], y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f8(x: [u8; 12], y: u64) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f9(x: [u8; 12], y: u32) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f10(x: [u8; 7], y: [u16; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f11(x: [u16; 3], y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f12(x: u32, y: u64) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f13(x: [u8; 7], y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f14(x: u64, y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f15(x: [u8; 12], y: [u8; 7]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f16(x: [u8; 5], y: u16) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f17(x: (u8, u16), y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f19(x: u32, y: [u8; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f20(x: [u16; 3], y: [u8; 12]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f21(x: u32, y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f22(x: [u8; 12], y: (u8, u16)) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f23(x: [u16; 3], y: u64) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f24(x: [u8; 5], y: [u16; 2]) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f26(x: [u8; 3], y: u16) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f27(x: u64, y: u64) -> usize { std::mem::size_of_val(&mk(x, y)) }
pub fn f29(x: u16, y: [u32; 3]) -> usize { std::mem::size_of_val(&mk(x, y)) }
