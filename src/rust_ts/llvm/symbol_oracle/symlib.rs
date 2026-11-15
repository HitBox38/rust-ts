// Archive symbol tables (LLVMRustGetSymbols): exported, mangled, generic, static, weak-ish and hidden symbols.
#![allow(dead_code)]
#[unsafe(no_mangle)]
pub extern "C" fn sym_c_fn(x: u32) -> u32 { x + 1 }
#[unsafe(no_mangle)]
pub static SYM_STATIC: u64 = 7;
#[unsafe(no_mangle)]
pub static mut SYM_MUT: [u8; 16] = [0; 16];
pub fn generic<T: Copy + core::ops::Add<Output = T>>(a: T, b: T) -> T { a + b }
pub fn uses() -> (u8, u64) { (generic(1u8, 2), generic(3u64, 4)) }
pub struct S(pub String);
impl Drop for S { fn drop(&mut self) { std::hint::black_box(&self.0); } }
pub fn make(s: &str) -> S { S(s.replace('a', "b")) }
pub trait T { fn f(&self) -> usize; }
impl T for S { fn f(&self) -> usize { self.0.len() } }
pub fn dynf(t: &dyn T) -> usize { t.f() }
#[inline(never)]
fn private_helper(v: &[u32]) -> u32 { v.iter().sum() }
pub fn public_calls_private() -> u32 { private_helper(&[1, 2, 3]) }
pub static TABLE: [&str; 3] = ["a", "bb", "ccc"];
thread_local! { pub static TLS: core::cell::Cell<u32> = const { core::cell::Cell::new(5) }; }
pub fn tls() -> u32 { TLS.with(|c| c.get()) }
