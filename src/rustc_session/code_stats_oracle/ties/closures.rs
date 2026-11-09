// fixers-50: ties of size and description between closures (no Symbol in the hash). Insertion order gives the same output here,
// so this file does not pin FxHashSet order (fixers-50 review N1); the other tie files do. See ../../code_stats.oracle.test.ts.
pub fn mk<T: Copy>(t: T) -> impl Fn() -> T { move || t }
pub fn a() -> u64 { mk(1u64)() }
pub fn b() -> (u32, u32) { mk((1u32, 2u32))() }
pub fn c() -> [u16; 4] { mk([1u16; 4])() }
pub fn d() -> (u8, u32) { mk((1u8, 2u32))() }
