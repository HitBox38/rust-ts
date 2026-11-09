// fixers-50: ties of size and description between closures (no Symbol in the hash), in FxHashSet order. See ../../code_stats.oracle.test.ts.
pub fn mk<T: Copy>(t: T) -> impl Fn() -> T { move || t }
pub fn a() -> u64 { mk(1u64)() }
pub fn b() -> (u32, u32) { mk((1u32, 2u32))() }
pub fn c() -> [u16; 4] { mk([1u16; 4])() }
pub fn d() -> (u8, u32) { mk((1u8, 2u32))() }
